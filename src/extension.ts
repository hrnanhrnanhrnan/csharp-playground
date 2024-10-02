// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { exec } from "child_process";
import * as os from "os";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { copyFile, mkdir, writeFile } from "fs/promises";
import * as signalR from "@microsoft/signalr";

const execPromise = promisify(exec);
const extensionName = "csharp-playground";
const homeDir = null ?? os.homedir();
const extensionDirName = `.csharp_playground`;
const analyzerServerAddress = "http://localhost:5140";
const hubAddress = `${analyzerServerAddress}/hub`;
const analyzerServerDirPath = path.join(homeDir, extensionDirName, "analyzer");
const analyzerServerFilePath = path.join(analyzerServerDirPath, "Program.cs");
const analyzerServerCsProjFilePath = path.join(
  analyzerServerDirPath,
  "analyzer.csproj"
);
const playgroundDirPath = path.join(homeDir, extensionDirName, "playground");
const playgroundDirUri = vscode.Uri.file(playgroundDirPath);
const playgroundFilePath = path
  .join(playgroundDirPath, "Program.cs")
  .toLowerCase();
let connection: signalR.HubConnection | undefined;
const maxServerRetries = 30;
let channel: vscode.OutputChannel | undefined;
let analyzerServerCsProjResourcePath: string = "";
let analyzerServerResourcePath: string = "";
let analyzerWelcomeMessageResourcePath: string = "";
const analyzerServerTerminalName = "Analyzer-runner";
const playgorundRunnerTerminalName = "Playground-runner";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    `Congratulations, your extension "${extensionName}" is now active!`
  );

  analyzerServerCsProjResourcePath = path.join(
    context.extensionPath,
    "resources",
    "AnalyzerServerCsProjFile.txt"
  );
  analyzerServerResourcePath = path.join(
    context.extensionPath,
    "resources",
    "AnalyzerServer.cs"
  );
  analyzerWelcomeMessageResourcePath = path.join(
    context.extensionPath,
    "resources",
    "WelcomeMessage.cs"
  );

  // Setup output channel
  channel = vscode.window.createOutputChannel(extensionName);

  // Setup analyzer server connection manager
  connection = AnalyzerConnectionManager.getConnection(hubAddress);

  if (
    (await isAnalyzerServerActive(channel!)) &&
    connection!.state === signalR.HubConnectionState.Disconnected
  ) {
    try {
      await connection!.start();
    } catch (error) {
      console.log(error);
    }
  }

  // Setup inlayhints
  const inlayHintsProvider = new PlaygroundInlayHintsProvider();
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { scheme: "file", language: "csharp" },
    inlayHintsProvider
  );

  AnalyzerConnectionManager.setInlayHintsProvider(inlayHintsProvider);

  const stopDisposable = vscode.commands.registerCommand(
    `${extensionName}.stop`,
    stopCommand
  );

  const playDisposable = vscode.commands.registerCommand(
    `${extensionName}.play`,
    playCommand
  );

  context.subscriptions.push(inlayHintsDisposable);
  context.subscriptions.push(playDisposable);
  context.subscriptions.push(stopDisposable);
}

async function stopCommand() {
  await AnalyzerConnectionManager.stopConnection();
  AnalyzerConnectionManager.dispose();

  disposeTerminals();
  removePlaygroundFromWorkspace();
}

async function playCommand() {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
      title: `${extensionName}: Setting up and running...`,
    },
    async (progress, token) => {
      disposeTerminals();

      const success = await createCsharp(playgroundDirPath, channel!);

      if (!success) {
        alertUser(
          "It went wrong creating the project, look in output",
          "error"
        );
        return;
      }

      if (
        !(await tryCreateAanalyzerServer(
          analyzerServerResourcePath,
          analyzerServerCsProjResourcePath,
          channel!
        ))
      ) {
        alertUser(
          `Something went wrong trying to create analyzer server, check output for more information`,
          "error"
        );

        return;
      }

      setupAndRunTerminals();

      const isServerReadyPromise = waitForAnalyzerServerReady(channel!);

      const { error, document } = await openTextDocument(playgroundFilePath);
      if (error) {
        alertUser("It went wrong opening the file, look in output", "error");
        return;
      }

      const isServerReady = await isServerReadyPromise;
      if (!isServerReady) {
        disposeTerminals();
        alertUser(
          `Something went wrong trying to starting analyzer server, check output for more information`,
          "error"
        );

        return;
      }

      if (connection?.state === signalR.HubConnectionState.Disconnected) {
        try {
          await connection.start();
        } catch (error) {
          alertUser(
            `Something went wrong trying to connect to analyzer server, check output for more information`,
            "error"
          );
          return;
        }
      }

      if (!isPlaygroundInWorkspace()) {
        addPlaygroundToWorkspace();
      }

      alertUser(
        `Succesfully created and launched a playground at ${playgroundFilePath}`,
        "success"
      );
    }
  );
}

async function openTextDocument(filePath: string): Promise<{
  error: Error | undefined;
  document: vscode.TextDocument | undefined;
}> {
  let document: vscode.TextDocument | undefined;
  try {
    const uri = vscode.Uri.file(filePath);
    document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    if (error instanceof Error) {
      return { error, document };
    }

    return { error: new Error(String(error)), document };
  }

  return { error: undefined, document };
}

function addPlaygroundToWorkspace(): boolean {
  return vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders.length
      : 0,
    null,
    { uri: playgroundDirUri, name: extensionName }
  );
}

function removePlaygroundFromWorkspace() {
  const playgroundWorkspaceFolder =
    vscode.workspace.getWorkspaceFolder(playgroundDirUri);

  if (!playgroundWorkspaceFolder) {
    return;
  }

  vscode.workspace.updateWorkspaceFolders(playgroundWorkspaceFolder.index, 1);
}

function setupAndRunTerminals() {
  const playgroundTerminal = vscode.window.createTerminal({
    name: playgorundRunnerTerminalName,
    cwd: playgroundDirPath,
  });

  const analyzerServerTerminal = vscode.window.createTerminal({
    name: analyzerServerTerminalName,
    cwd: analyzerServerDirPath,
    location: {
      parentTerminal: playgroundTerminal,
    },
  });

  playgroundTerminal.sendText("dotnet watch run");
  playgroundTerminal.show(true);
  analyzerServerTerminal.sendText(
    `dotnet run -c Release --urls ${analyzerServerAddress} `
  );

  analyzerServerTerminal.show();
}

function disposeTerminals() {
  const terminals = vscode.window.terminals.filter(
    (x) =>
      x.name === playgorundRunnerTerminalName ||
      x.name === analyzerServerTerminalName
  );

  for (let index = 0; index < terminals.length; index++) {
    terminals[index].dispose();
  }
}

function isPlaygroundInWorkspace() {
  const playgroundWorkspaceFolder =
    vscode.workspace.getWorkspaceFolder(playgroundDirUri);

  return playgroundWorkspaceFolder !== undefined;
}

async function createCsharp(
  dirPath: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  await mkdir(dirPath, { recursive: true });

  return (
    (await runExecCommand("dotnet new console --force", dirPath, channel)) &&
    (await safeCopyFile(
      analyzerWelcomeMessageResourcePath,
      path.join(dirPath, "Program.cs")
    ))
  );
}

async function runExecCommand(
  command: string,
  cwd: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  try {
    const { stdout, stderr } = await execPromise(command, { cwd });

    if (stdout) {
      channel.appendLine(stdout);
    }

    if (stderr) {
      channel.appendLine(stderr);
    }
  } catch (error) {
    channel.appendLine(`Error occured: ${error}`);
    return false;
  }

  return true;
}

// This method is called when your extension is deactivated
export async function deactivate() {
  await AnalyzerConnectionManager.stopConnection();
  AnalyzerConnectionManager.dispose();
  disposeTerminals();
}

async function isAnalyzerServerActive(
  channel: vscode.OutputChannel
): Promise<boolean> {
  try {
    const response = await fetch(`${analyzerServerAddress}/alive`);

    if (!response.ok) {
      console.log("analyzer server responding with not ok");
      return false;
    }
  } catch (error) {
    channel.appendLine(
      `Aanalyzer server is not running, following error occured: ${error}`
    );
    console.log(
      `Aanalyzer server is not running, following error occured: ${error}`
    );
    return false;
  }

  return true;
}

async function safeCopyFile(
  srcFilePath: string,
  destFilePath: string
): Promise<boolean> {
  try {
    const parentDir = path.dirname(destFilePath);
    await mkdir(parentDir, { recursive: true });
    await copyFile(srcFilePath, destFilePath);
  } catch (error) {
    channel!.appendLine(
      `Could not copy file, following error occured: ${error}`
    );
    return false;
  }

  return true;
}

async function tryCreateAanalyzerServer(
  analyzerServerResourcePath: string,
  analyzerServerProjFileResourcePath: string,
  channel: vscode.OutputChannel
) {
  try {
    if (existsSync(analyzerServerFilePath)) {
      return true;
    }

    await mkdir(analyzerServerDirPath, { recursive: true });
    await runExecCommand(
      "dotnet new web --force",
      analyzerServerDirPath,
      channel
    );

    await safeCopyFile(
      analyzerServerProjFileResourcePath,
      analyzerServerCsProjFilePath
    );
    await safeCopyFile(analyzerServerResourcePath, analyzerServerFilePath);
  } catch (error) {
    channel.appendLine(`Error when trying to create analyzerServer: ${error}`);

    return false;
  }

  return true;
}

function alertUser(message: string, type: "error" | "success") {
  const alertMessage = `${extensionName}: 
          ${message}`;

  if (type === "error") {
    vscode.window.showErrorMessage(alertMessage);
    return;
  }

  vscode.window.showInformationMessage(alertMessage);
}

type AnalyzedDataItem = {
  Line: string;
  Value: string;
};

class AnalyzerConnectionManager {
  private static instance: signalR.HubConnection | null;
  private static inlayHintsProvider: PlaygroundInlayHintsProvider | null = null;

  public static setInlayHintsProvider(
    inlayhintsProvider: PlaygroundInlayHintsProvider
  ) {
    this.inlayHintsProvider = inlayhintsProvider;
  }

  public static getConnection(serverAddress: string) {
    if (!this.instance) {
      this.instance = new signalR.HubConnectionBuilder()
        .withUrl(serverAddress)
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Debug)
        .build();

      this.instance.on("AnalyzedData", (data) => {
        const analyzerData = JSON.parse(data);
        AnalyzerConnectionManager.inlayHintsProvider?.setData(analyzerData);
      });

      this.instance.onreconnecting((error) => {
        console.log(`Anslutningen försöker återansluta. Fel: ${error}`);
      });

      this.instance.onreconnected((connectionId) => {
        console.log(
          `Anslutningen har återanslutits. this.instance ID: ${connectionId}`
        );
      });

      this.instance.onclose((error) => {
        console.log("SignalR-anslutningen stängdes", error);
        setTimeout(async () => await this.instance?.start(), 5000);
      });
    }

    return this.instance;
  }

  public static stopConnection() {
    return this.instance?.stop() || Promise.resolve();
  }

  public static dispose() {
    this.instance = null;
  }
}

class PlaygroundInlayHintsProvider implements vscode.InlayHintsProvider {
  analyzerData: AnalyzedDataItem[] = [];

  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    if (this.analyzerData.length === 0) {
      return;
    }

    const hints: vscode.InlayHint[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      console.log(
        "Current analyzerData:",
        JSON.stringify(this.analyzerData, null, 2)
      );
      console.log(`Processing line ${i}: "${line.text}"`);

      const match = this.analyzerData.find(
        (x) => x.Line.trim() === line.text.trim()
      );

      if (match) {
        const position = new vscode.Position(i, line.text.length);
        const value = JSON.stringify(match.Value);
        const hint = new vscode.InlayHint(
          position,
          value,
          vscode.InlayHintKind.Type
        );
        hint.paddingLeft = hint.paddingRight = true;
        hint.tooltip = JSON.stringify(match.Value, null, 4);

        hints.push(hint);
      }
    }

    return hints;
  }

  public setData(analyzerDataItems: AnalyzedDataItem[]) {
    console.log("setData called with", analyzerDataItems);
    this.analyzerData = analyzerDataItems;
    this._onDidChangeInlayHints.fire();
  }
}

vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
  // if document.uri.path === path of playground file, shut down connection to analyzer server
  if (
    event.removed &&
    !isPlaygroundInWorkspace() &&
    !(await isAnalyzerServerActive(channel!))
  ) {
    AnalyzerConnectionManager.stopConnection();
    AnalyzerConnectionManager.dispose();
    disposeTerminals();
  }
});

vscode.workspace.onDidSaveTextDocument(async (document) => {
  // if document.uri.path === path of playground file, shut down connection to analyzer server
  if (document.uri.fsPath.toLowerCase() !== playgroundFilePath.toLowerCase()) {
    return;
  }

  await connection?.invoke("AnalyzeCode", document.getText());
});

async function waitForAnalyzerServerReady(channel: vscode.OutputChannel) {
  let tries = 0;

  return new Promise<boolean>((resolve, reject) => {
    const checkServerAlive = async () => {
      console.log(
        `Trying analyzer server, try ${tries} of ${maxServerRetries}`
      );
      if (await isAnalyzerServerActive(channel)) {
        resolve(true);
        return;
      }

      tries++;
      if (tries <= maxServerRetries) {
        setTimeout(checkServerAlive, 1000);
      } else {
        reject(false);
      }
    };

    checkServerAlive();
  });
}
