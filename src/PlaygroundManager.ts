import * as vscode from "vscode";
import { existsSync } from "fs";
import path from "path";
import { mkdir, rm } from "fs/promises";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import {
  extensionName,
  shell,
} from "./constants";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { runExecCommand, safeCopyFile, tryCatchPromise } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";

export class PlaygroundManager {
  private readonly playgroundRunnerTerminalName = "Playground-runner";
  private readonly maxServerRetries = 15;
  private readonly extensionManager: PlaygroundExtensionManager;
  private readonly serverManager: AnalyzerServerManager;
  private readonly channel: PlaygroundOutputChannel;
  public readonly pathManager: PlaygroundPathMananger;

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
    const [error] = await tryCatchPromise(async () => {
      if (!existsSync(this.pathManager.analyzerServerDirPath)) {
        return true;
      }

      await rm(this.pathManager.analyzerServerDirPath, {
        recursive: true,
        force: true,
      });

      return await this.tryCreateAnalyzerServer();
    });

    if (error) {
      this.channel.printErrorToChannel(
        "Could not refresh analyzer server on disk",
        error
      );
      return false;
    }

    return true;
  }

  async openTextDocument(): Promise<Result<vscode.TextDocument>> {
    return tryCatchPromise(async () => {
      const document = await vscode.workspace.openTextDocument(
        this.pathManager.playgroundProgramFileUri
      );
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
    return tryCatchPromise(async () => {
      const analyzerServerTerminal =
        await this.serverManager.startServerInTerminal();

      const playgroundTerminal = vscode.window.createTerminal({
        name: this.playgroundRunnerTerminalName,
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
      (x) => x.name === this.playgroundRunnerTerminalName
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
    const [createDirError] = await tryCatchPromise(mkdir(dirPath, { recursive: true }));

    if (createDirError) {
      this.channel.printErrorToChannel(
        `Could not create directory for playground at path: ${dirPath}`,
        createDirError
      );
      return false;
    }

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

    const [copyInitFileError] = await safeCopyFile(
      this.pathManager.playgroundInitalizationResourceFilePath,
      this.pathManager.playgroundInitalizationFilePath
    );

    if (copyInitFileError) {
      this.channel.printErrorToChannel(
        `Could not copy playground intitialization file`,
        copyInitFileError
      );
      return false;
    }

    const [copyWelcomeFileError] = await safeCopyFile(
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

  dispose() {
    this.serverManager.dispose();
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

    const [copyServerError] = await safeCopyFile(
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
    const [error] = await this.serverManager.analyzeCode(document.getText());
    if (error) {
      this.channel.printErrorToChannel("Could not analyze code", error);
    }
  }

  async waitForAnalyzerServerReady(token: vscode.CancellationToken) {
    let tryCount = 1;

    while (tryCount <= this.maxServerRetries) {
      this.channel.appendLine(
        `Checking if Analyzer server is ready, try ${tryCount} of ${this.maxServerRetries}`
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
