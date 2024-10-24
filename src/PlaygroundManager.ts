import * as vscode from "vscode";
import { existsSync } from "fs";
import path from "path";
import { copyFile, mkdir, rm } from "fs/promises";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import {
  extensionName,
  maxServerRetries,
  playgroundRunnerTerminalName,
  shell,
} from "./constants";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { runExecCommand, tryCatch } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";

export class PlaygroundManager {
  private extensionManager: PlaygroundExtensionManager;
  private serverManager: AnalyzerServerManager;
  private channel: PlaygroundOutputChannel;
  public pathManager: PlaygroundPathMananger;

  constructor(
    extensionManager: PlaygroundExtensionManager,
    pathManager: PlaygroundPathMananger,
    serverManager: AnalyzerServerManager,
    channel: PlaygroundOutputChannel
  ) {
    this.extensionManager = extensionManager;
    this.pathManager = pathManager;
    this.channel = channel;
    this.serverManager = serverManager;
  }

  clearPlayground() {
    this.disposeTerminals();
  }

  async refreshAnalyzerServerOnDisk() {
    return tryCatch(async () => {
      if (!existsSync(this.pathManager.analyzerServerDirPath)) {
        return true;
      }

      await rm(this.pathManager.analyzerServerDirPath, {
        recursive: true,
        force: true,
      });

      await this.tryCreateAnalyzerServer();

      return true;
    });
  }

  async openTextDocument(): Promise<Result<vscode.TextDocument>> {
    return tryCatch(async () => {
      const uri = vscode.Uri.file(this.pathManager.playgroundFilePath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      return document;
    });
  }

  addPlaygroundToWorkspace(): boolean {
    return vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders.length
        : 0,
      null,
      { uri: this.pathManager.playgroundDirUri, name: extensionName }
    );
  }

  removePlaygroundFromWorkspace() {
    const playgroundWorkspaceFolder = vscode.workspace.getWorkspaceFolder(
      this.pathManager.playgroundDirUri
    );

    if (!playgroundWorkspaceFolder) {
      return;
    }

    vscode.workspace.updateWorkspaceFolders(playgroundWorkspaceFolder.index, 1);
  }

  async startPlaygroundInTerminal() {
    return tryCatch(async () => {
      const analyzerServerTerminal =
        await this.serverManager.startServerInTerminal();

      const playgroundTerminal = vscode.window.createTerminal({
        name: playgroundRunnerTerminalName,
        cwd: this.pathManager.playgroundDirPath,
        shellPath: shell,
        location: {
          parentTerminal: analyzerServerTerminal,
        },
      });

      playgroundTerminal.sendText("dotnet watch run");
      analyzerServerTerminal.show(true);
      playgroundTerminal.show(true);
    });
  }

  disposeTerminals() {
    this.serverManager.disposeServer();
    const playgroundTerminal = vscode.window.terminals.find(
      (x) => x.name === playgroundRunnerTerminalName
    );

    if (!playgroundTerminal) {
      return;
    }

    playgroundTerminal.dispose();
  }

  isPlaygroundInWorkspace() {
    const playgroundWorkspaceFolder = vscode.workspace.getWorkspaceFolder(
      this.pathManager.playgroundDirUri
    );

    return playgroundWorkspaceFolder !== undefined;
  }

  async createPlayground(dotneVersion: number | undefined): Promise<boolean> {
    const dirPath = this.pathManager.playgroundDirPath;
    await mkdir(dirPath, { recursive: true });

    const wantedVersion =
      this.extensionManager.installedDotnetVersions[dotneVersion ?? 0];
    const versionArg = wantedVersion ? `-f ${wantedVersion}` : "";

    const [newConsoleError] = await runExecCommand(
      `dotnet new console --force ${versionArg}`,
      dirPath,
      this.channel
    );

    if (newConsoleError) {
      this.channel.printErrorToChannel(
        `Could not create new console application template at path: ${dirPath}`,
        newConsoleError
      );
      return false;
    }

    const [copyInitFileError] = await this.safeCopyFile(
      this.pathManager.playgroundInitalizationFilePath,
      path.resolve(path.join(dirPath, ".playground"))
    );

    if (copyInitFileError) {
      this.channel.printErrorToChannel(
        `Could not copy playground intitialization file to path: `,
        copyInitFileError
      );
      return false;
    }

    const [copyWelcomeFileError] = await this.safeCopyFile(
      this.pathManager.analyzerWelcomeMessageResourcePath,
      path.resolve(path.join(dirPath, "Program.cs"))
    );

    if (copyWelcomeFileError) {
      this.channel.printErrorToChannel(
        `Could not copy welcome message file`,
        copyInitFileError
      );
      return false;
    }

    return true;
  }

  shutdown(clearWorkspace: boolean = false) {
    this.disposeTerminals();
    if (clearWorkspace) {
      this.removePlaygroundFromWorkspace();
    }
  }

  // TODO: add to some filemanager
  async safeCopyFile(
    srcFilePath: string,
    destFilePath: string
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const parentDir = path.dirname(destFilePath);
      await mkdir(parentDir, { recursive: true });
      await copyFile(srcFilePath, destFilePath);
    });
  }

  async tryCreateAnalyzerServer() {
    if (existsSync(this.pathManager.analyzerServerFilePath)) {
      return true;
    }

    await mkdir(this.pathManager.analyzerServerDirPath, { recursive: true });

    const [newWebTemplateError] = await runExecCommand(
      "dotnet new web --force",
      this.pathManager.analyzerServerDirPath,
      this.channel
    );
    if (newWebTemplateError) {
      this.channel.printErrorToChannel(
        `Could not create new web api template at path: ${this.pathManager.analyzerServerDirPath}`,
        newWebTemplateError
      );
      return false;
    }

    const [addNugetError] = await runExecCommand(
      "dotnet add package Microsoft.CodeAnalysis.CSharp.Scripting",
      this.pathManager.analyzerServerDirPath,
      this.channel
    );
    if (addNugetError) {
      this.channel.printErrorToChannel(
        `Could not add nuget package to web api`,
        addNugetError
      );
      return false;
    }

    const [copyServerError] = await this.safeCopyFile(
      this.pathManager.analyzerServerResourcePath,
      this.pathManager.analyzerServerFilePath
    );
    if (copyServerError) {
      this.channel.printErrorToChannel(
        `Could not copy web server to path: ${this.pathManager.analyzerServerFilePath}`,
        copyServerError
      );
      return false;
    }

    return true;
  }

  async analyzeCode(document: vscode.TextDocument) {
    return this.serverManager.analyzeCode(document.getText());
  }

  async waitForAnalyzerServerReady(token: vscode.CancellationToken) {
    let tryCount = 1;

    while (tryCount <= maxServerRetries) {
      this.channel.appendLine(
        `Checking if Analyzer server is ready, try ${tryCount} of ${maxServerRetries}`
      );

      if (token.isCancellationRequested) {
        this.channel.appendLine(
          "Cancellation has been requested, cancelling checking analyzer server"
        );
        return false;
      }

      if (await this.serverManager.isAnalyzerServerAlive()) {
        this.channel.appendLine("Analyzer server is ready");
        return true;
      }

      tryCount++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }
}
