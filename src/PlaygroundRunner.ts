import * as vscode from "vscode";
import { exec } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { copyFile, mkdir } from "fs/promises";
import * as signalR from "@microsoft/signalr";
import { AnalyzerConnectionManager } from "./AnalyzerConnectionManager";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import {
  extensionName,
  maxServerRetries,
  playgroundRunnerTerminalName,
  analyzerServerTerminalName,
  platform,
} from "./Constants";

const execPromise = promisify(exec);

export class PlaygroundRunner {
  public pathManager: PlaygroundPathMananger;
  private connection: signalR.HubConnection;
  private channel: vscode.OutputChannel;
  private shell = platform === "win32" ? "powershell.exe" : "/bin/bash";

  constructor(context: vscode.ExtensionContext, channel: vscode.OutputChannel) {
    this.pathManager = PlaygroundPathMananger.getInstance(context, channel);
    this.connection = AnalyzerConnectionManager.getConnection(
      this.pathManager.analyzerServerAddress
    );
    this.channel = channel;
  }

  public getActiveConnectionState() {
    return this.connection.state;
  }

  async setupAnalyzerClient(context: vscode.ExtensionContext) {
    this.connection = AnalyzerConnectionManager.getConnection(
      this.pathManager.hubAddress
    );

    if (
      (await this.isAnalyzerServerActive()) &&
      this.connection.state === signalR.HubConnectionState.Disconnected &&
      !(await this.tryStartAanalyzerHubConnection())
    ) {
      this.alertUser(
        "Something went wrong trying to start the Hub Connection to the Analyzer Server, check output for more information",
        "error"
      );
    }

    // Setup inlayhints
    const inlayHintsProvider = new PlaygroundInlayHintsProvider();
    const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
      { scheme: "file", language: "csharp" },
      inlayHintsProvider
    );

    AnalyzerConnectionManager.setInlayHintsProvider(inlayHintsProvider);
    AnalyzerConnectionManager.setOutputChannel(this.channel);
    context.subscriptions.push(inlayHintsDisposable);
  }

  printErrorToChannel(message: string, error: unknown) {
    this.channel.appendLine(
      `${message}: ${(error as Error)?.message ?? error}`
    );
  }

  async tryStartAanalyzerHubConnection() {
    try {
      await this.connection.start();
    } catch (error) {
      this.printErrorToChannel(
        "Following error occurred when trying to start the Analyzer server",
        error
      );
      await this.shutdown();
      return false;
    }

    return true;
  }

  async openTextDocument(filePath: string): Promise<{
    error: Error | undefined;
    document: vscode.TextDocument | undefined;
  }> {
    let document: vscode.TextDocument | undefined;
    try {
      const uri = vscode.Uri.file(filePath);
      document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      this.printErrorToChannel(
        `Error occurred when trying to open file at "${filePath}"`,
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

  setupAndRunTerminals() {
    const playgroundTerminal = vscode.window.createTerminal({
      name: playgroundRunnerTerminalName,
      cwd: this.pathManager.playgroundDirPath,
      shellPath: this.shell,
    });

    const analyzerServerTerminal = vscode.window.createTerminal({
      name: analyzerServerTerminalName,
      cwd: this.pathManager.analyzerServerDirPath,
      shellPath: this.shell,
      location: {
        parentTerminal: playgroundTerminal,
      },
    });

    playgroundTerminal.sendText("dotnet watch run");
    playgroundTerminal.show(true);
    analyzerServerTerminal.sendText(
      `dotnet run -c Release --urls ${this.pathManager.analyzerServerAddress} `
    );

    analyzerServerTerminal.show(true);
  }

  disposeTerminals() {
    const terminals = vscode.window.terminals.filter(
      (x) =>
        x.name === playgroundRunnerTerminalName ||
        x.name === analyzerServerTerminalName
    );

    for (let index = 0; index < terminals.length; index++) {
      terminals[index].dispose();
    }
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
        shell: this.shell,
      });

      if (stdout) {
        this.channel.appendLine(stdout);
      }

      if (stderr) {
        this.channel.appendLine(stderr);
      }
    } catch (error) {
      this.printErrorToChannel(
        `Error occurred when trying to run command "${command}"`,
        error
      );
      return false;
    }

    return true;
  }

  async refreshPlaygroundState() {
    PlaygroundPathMananger.refreshAnalyzerServerAddresses();
    this.disposeTerminals();
    await AnalyzerConnectionManager.stopConnection();
    this.connection = AnalyzerConnectionManager.getConnection(
      this.pathManager.hubAddress
    );
  }

  async shutdown(disposeConnection: boolean = false) {
    this.disposeTerminals();
    try {
      await AnalyzerConnectionManager.stopConnection();
    } catch (error) {
      this.printErrorToChannel(
        "Following error occurred when trying to stop Analyzer connection manager",
        error
      );
    }

    this.removePlaygroundFromWorkspace();

    if (disposeConnection) {
      AnalyzerConnectionManager.dispose();
    }
  }

  async isAnalyzerServerActive(): Promise<boolean> {
    try {
      const response = await fetch(
        this.pathManager.analyzerServerStatusAddress
      );

      if (!response.ok) {
        this.channel.appendLine(
          `Analyzer server responding with not ok. Message: ${await response.text()}`
        );
        return false;
      }
    } catch (error) {
      this.printErrorToChannel(
        "Error occurred when trying to check if Analyzer server is alive",
        error
      );
      return false;
    }

    return true;
  }

  async safeCopyFile(
    srcFilePath: string,
    destFilePath: string
  ): Promise<boolean> {
    try {
      const parentDir = path.dirname(destFilePath);
      await mkdir(parentDir, { recursive: true });
      await copyFile(srcFilePath, destFilePath);
    } catch (error) {
      this.printErrorToChannel(
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
      this.printErrorToChannel(
        "Error when trying to create and setup Analyzer server",
        error
      );

      return false;
    }

    return true;
  }

  alertUser(message: string, type: "error" | "success") {
    const alertMessage = `${extensionName}: 
          ${message}`;

    if (type === "error") {
      vscode.window.showErrorMessage(alertMessage);
      return;
    }

    vscode.window.showInformationMessage(alertMessage);
  }

  public async analyzeCode(document: vscode.TextDocument) {
    return this.connection.invoke("AnalyzeCode", document.getText());
  }

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

        if (await this.isAnalyzerServerActive()) {
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

  async isDotnetAvailable() {
    try {
      this.channel.appendLine(
        "Checking that .NET SDK is installed and that PATH is accessible"
      );
      await execPromise("dotnet --version");
    } catch (error) {
      this.printErrorToChannel(
        "Cant find that the .NET SDK is installed or that PATH is accessible",
        error
      );
      return false;
    }

    return true;
  }
}