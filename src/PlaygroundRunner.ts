import * as vscode from "vscode";
import { exec } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { copyFile, mkdir, rm } from "fs/promises";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import {
  extensionName,
  maxServerRetries,
  playgroundRunnerTerminalName,
  shell,
} from "./constants";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";

const execPromise = promisify(exec);

export class PlaygroundRunner {
  public pathManager: PlaygroundPathMananger;
  private serverManager: AnalyzerServerManager;
  private channel: PlaygroundOutputChannel;

  constructor(context: vscode.ExtensionContext, pathManager: PlaygroundPathMananger, serverManager: AnalyzerServerManager, channel: PlaygroundOutputChannel) {
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
      await rm(this.pathManager.analyzerServerDirPath, { recursive: true, force: true });
    } catch (error) {
      this.channel.printErrorToChannel("Following error occurred trying to remove Analyzer server from disk", error);
    }
  }

  async openTextDocument(): Promise<{
    error: Error | undefined;
    document: vscode.TextDocument | undefined;
  }> {
    let document: vscode.TextDocument | undefined;
    try {
      const uri = vscode.Uri.file(this.pathManager.playgroundFilePath);
      document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      this.channel.printErrorToChannel(
        `Error occurred when trying to open file at "${this.pathManager.playgroundFilePath}"`,
        error
      );
      if (error instanceof Error) {
        return { error, document };
      }

      return { error: new Error(String(error)), document };
    }

    return { error: undefined, document };
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

  runPlaygroundInTerminal() {
    const analyzerServerTerminal = this.serverManager.runServerInTerminal();
    
    const playgroundTerminal = vscode.window.createTerminal({
      name: playgroundRunnerTerminalName,
      cwd: this.pathManager.playgroundDirPath,
      shellPath: shell,
      location: {
        parentTerminal: analyzerServerTerminal,
      },
    });

    analyzerServerTerminal.show(true);
    playgroundTerminal.sendText("dotnet watch run");
    playgroundTerminal.show(true);
  }

  disposeTerminals() {
    this.serverManager.disposeServer();
    const playgroundTerminal = vscode.window.terminals.find(
      (x) =>
        x.name === playgroundRunnerTerminalName
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

  async createCsharp(): Promise<boolean> {
    const dirPath = this.pathManager.playgroundDirPath;
    await mkdir(dirPath, { recursive: true });

    return (
      (await this.runExecCommand("dotnet new console --force", dirPath)) &&
      (await this.safeCopyFile(
        this.pathManager.analyzerWelcomeMessageResourcePath,
        path.resolve(path.join(dirPath, "Program.cs"))
      ))
    );
  }

  async runExecCommand(command: string, cwd: string): Promise<boolean> {
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        shell: shell,
      });

      if (stdout) {
        this.channel.appendLine(stdout);
      }

      if (stderr) {
        this.channel.appendLine(stderr);
      }
    } catch (error) {
      this.channel.printErrorToChannel(
        `Error occurred when trying to run command "${command}"`,
        error
      );
      return false;
    }

    return true;
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
      await this.runExecCommand(
        "dotnet new web --force",
        this.pathManager.analyzerServerDirPath
      );

      await this.safeCopyFile(
        this.pathManager.analyzerServerCsProjResourcePath,
        this.pathManager.analyzerServerCsProjFilePath
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

  public async analyzeCode(document: vscode.TextDocument) {
    return this.serverManager.analyzeCode(document.getText());
  }

// TODO: change to while loop and maybe return tuple or specified type
  async waitForAnalyzerServerReady(token: vscode.CancellationToken) {
    let tryCount = 0;

    return new Promise<boolean>((resolve, reject) => {
      const checkIfServerAlive = async () => {
        this.channel.appendLine(
          `Checking if Analyzer server is ready, try ${tryCount} of ${maxServerRetries}`
        );
        if (token.isCancellationRequested) {
          this.channel.appendLine(
            "Cancellation has been requested, cancelling checking analyzer server"
          );
          return;
        }

        if (await this.serverManager.isAnalyzerServerActive()) {
          this.channel.appendLine("Analyzer server is ready");
          resolve(true);
          return;
        }

        tryCount++;
        if (tryCount <= maxServerRetries) {
          setTimeout(checkIfServerAlive, 1000);
        } else {
          reject(false);
        }
      };

      checkIfServerAlive();
    });
  }

// TODO: move to extension manager
  async isDotnetAvailable() {
    try {
      this.channel.appendLine(
        "Checking that .NET SDK is installed and that PATH is accessible"
      );
      await execPromise("dotnet --version");
    } catch (error) {
      this.channel.printErrorToChannel(
        "Cant find that the .NET SDK is installed or that PATH is accessible",
        error
      );
      return false;
    }

    return true;
  }
}