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
import { runExecCommand } from "./utils";
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

  async clearPlayground() {
    this.disposeTerminals();
  }

  async removeAnalyzerServerFromDisk() {
    if (!existsSync(this.pathManager.analyzerServerDirPath)) {
      return;
    }

    try {
      await rm(this.pathManager.analyzerServerDirPath, {
        recursive: true,
        force: true,
      });
    } catch (error) {
      this.channel.printErrorToChannel(
        "Following error occurred trying to remove Analyzer server from disk",
        error
      );
    }
  }

  async openTextDocument(): Promise<Result<vscode.TextDocument>> {
    let document: vscode.TextDocument | null;
    try {
      const uri = vscode.Uri.file(this.pathManager.playgroundFilePath);
      document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      this.channel.printErrorToChannel(
        `Error occurred when trying to open file at "${this.pathManager.playgroundFilePath}"`,
        error
      );

      return [null, (error as Error) ?? new Error(String(error))];
    }

    return [document, null];
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

  async runPlaygroundInTerminal() {
    const analyzerServerTerminal =
      await this.serverManager.runServerInTerminal();

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

  async createCsharp(dotneVersion: number | undefined): Promise<boolean> {
    const dirPath = this.pathManager.playgroundDirPath;
    await mkdir(dirPath, { recursive: true });

    const wantedVersion = this.extensionManager.installedDotnetVersions[dotneVersion ?? 0];
    const versionArg = wantedVersion
      ? `-f ${wantedVersion}`
      : "";

    return (
      (await runExecCommand(
          `dotnet new sln --force`,
        dirPath,
        this.channel
      )) &&
      (await runExecCommand(
        `dotnet new console --force ${versionArg}`,
        dirPath,
        this.channel
      )) &&
      (await runExecCommand(
        `dotnet sln add ${path.basename(dirPath)}.csproj`,
        dirPath,
        this.channel
      )) &&
      (await this.safeCopyFile(
        this.pathManager.analyzerWelcomeMessageResourcePath,
        path.resolve(path.join(dirPath, "Program.cs"))
      ))
    );
  }

  shutdown() {
    this.disposeTerminals();
    this.removePlaygroundFromWorkspace();
  }

  // TODO: add to some filemanager
  async safeCopyFile(
    srcFilePath: string,
    destFilePath: string
  ): Promise<boolean> {
    try {
      const parentDir = path.dirname(destFilePath);
      await mkdir(parentDir, { recursive: true });
      await copyFile(srcFilePath, destFilePath);
    } catch (error) {
      this.channel.printErrorToChannel(
        "Could not copy file, following error occured",
        error
      );
      return false;
    }

    return true;
  }

  async tryCreateAnalyzerServer() {
    try {
      if (existsSync(this.pathManager.analyzerServerFilePath)) {
        return true;
      }

      await mkdir(this.pathManager.analyzerServerDirPath, { recursive: true });
      await runExecCommand(
        "dotnet new web --force",
        this.pathManager.analyzerServerDirPath,
        this.channel
      );

      await runExecCommand(
        "dotnet add package Microsoft.CodeAnalysis.CSharp.Scripting",
        this.pathManager.analyzerServerDirPath,
        this.channel
      );

      await this.safeCopyFile(
        this.pathManager.analyzerServerResourcePath,
        this.pathManager.analyzerServerFilePath
      );
    } catch (error) {
      this.channel.printErrorToChannel(
        "Error when trying to create and setup Analyzer server",
        error
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

      if (await this.serverManager.isAnalyzerServerActive()) {
        this.channel.appendLine("Analyzer server is ready");
        return true;
      }

      tryCount++;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }
}
