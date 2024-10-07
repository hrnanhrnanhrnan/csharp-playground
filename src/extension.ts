// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { exec } from "child_process";
import * as os from "os";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { copyFile, mkdir } from "fs/promises";
import * as signalR from "@microsoft/signalr";
import { AnalyzerConnectionManager } from "./AnalyzerConnectionManager";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";

const execPromise = promisify(exec);
const extensionName = "csharp-playground";
const homeDir = os.homedir();
const extensionDirName = `.csharp_playground`;
const analyzerServerDirPath = path.resolve(
  path.join(homeDir, extensionDirName, "analyzer")
);
const analyzerServerFilePath = path.resolve(
  path.join(analyzerServerDirPath, "Program.cs")
);
const analyzerServerCsProjFilePath = path.resolve(
  path.join(analyzerServerDirPath, "analyzer.csproj")
);
const playgroundDirPath = path.resolve(
  path.join(homeDir, extensionDirName, "playground")
);
const playgroundDirUri = vscode.Uri.file(playgroundDirPath);
const playgroundFilePath = path.resolve(
  path.join(playgroundDirPath, "Program.cs")
);
const maxServerRetries = 30;
const analyzerServerTerminalName = "Analyzer-runner";
const playgorundRunnerTerminalName = "Playground-runner";
let isDotnetInstalled = false;
const defaultPort = 5140;
const platform = os.platform();
const shell = platform === "win32" ? "powershell.exe" : "/bin/bash";
let analyzerServerAddress = "";
let hubAddress = "";
let analyzerServerCsProjResourcePath: string = "";
let analyzerServerResourcePath: string = "";
let analyzerWelcomeMessageResourcePath: string = "";
let connection: signalR.HubConnection | undefined;
let channel: vscode.OutputChannel | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(`The "${extensionName}" extension is now active!`);

  // Setup output channel
  channel = vscode.window.createOutputChannel(extensionName);

  isDotnetInstalled = await isDotnetAvailable();

  await runSetup(context);

  const stopDisposable = vscode.commands.registerCommand(
    `${extensionName}.stop`,
    stopCommand
  );

  const playDisposable = vscode.commands.registerCommand(
    `${extensionName}.play`,
    playCommand
  );

  context.subscriptions.push(playDisposable);
  context.subscriptions.push(stopDisposable);
}

async function runSetup(context: vscode.ExtensionContext) {
  analyzerServerAddress = getAnalyzerServerAddress();
  hubAddress = getAnalyzerServerHubAddress(analyzerServerAddress);

  analyzerServerCsProjResourcePath = path.resolve(
    path.join(
      context.extensionPath,
      "resources",
      "AnalyzerServerCsProjFile.txt"
    )
  );
  analyzerServerResourcePath = path.resolve(
    path.join(context.extensionPath, "resources", "AnalyzerServer.cs")
  );
  analyzerWelcomeMessageResourcePath = path.resolve(
    path.join(context.extensionPath, "resources", "WelcomeMessage.cs")
  );

  // Setup analyzer server connection manager
  connection = AnalyzerConnectionManager.getConnection(hubAddress);

  if (
    (await isAnalyzerServerActive()) &&
    connection.state === signalR.HubConnectionState.Disconnected &&
    !(await tryStartAanalyzerHubConnection(connection))
  ) {
    alertUser(
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
  context.subscriptions.push(inlayHintsDisposable);
}

async function stopCommand() {
  return shutdown();
}

async function playCommand() {
  if (!isDotnetInstalled) {
    alertUser(
      "Cant find that .NET SDK is installed or that PATH is accessible",
      "error"
    );
    return;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `${extensionName}: Play -> `,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        shutdown();
      });

      analyzerServerAddress = getAnalyzerServerAddress();
      hubAddress = getAnalyzerServerHubAddress(analyzerServerAddress);

      disposeTerminals();
      await AnalyzerConnectionManager.stopConnection();
      connection = AnalyzerConnectionManager.getConnection(hubAddress);

      progress.report({ message: "Setting up the playgorund..." });

      if (!(await createCsharp(playgroundDirPath!))) {
        alertUser(
          "It went wrong creating the project, look in output",
          "error"
        );
        return;
      }

      progress.report({ message: "Setting up the analyzer server..." });
      if (
        !(await tryCreateAnalyzerServer(
          analyzerServerResourcePath,
          analyzerServerCsProjResourcePath
        ))
      ) {
        alertUser(
          `Something went wrong trying to create analyzer server, check output for more information`,
          "error"
        );

        return;
      }

      setupAndRunTerminals();

      progress.report({ message: "Waiting for analyzer server..." });
      const isServerReadyPromise = waitForAnalyzerServerReady(token);

      const { error, document } = await openTextDocument(playgroundFilePath);
      if (error) {
        alertUser("It went wrong opening the file, look in output", "error");
        return;
      }

      const isServerReady = await isServerReadyPromise;
      if (!isServerReady) {
        disposeTerminals();
        alertUser(
          `Could not start Analyzer server, check output for more information`,
          "error"
        );

        return;
      }
      if (
        connection.state === signalR.HubConnectionState.Disconnected &&
        !(await tryStartAanalyzerHubConnection(connection))
      ) {
        await shutdown();
        alertUser(
          `Something went wrong trying to connect to analyzer server, check output for more information`,
          "error"
        );
        return;
      }

      progress.report({ message: "Setting up workspace..." });
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

function printErrorToChannel(message: string, error: unknown) {
  channel?.appendLine(`${message}: ${(error as Error)?.message ?? error}`);
}

async function tryStartAanalyzerHubConnection(
  connection: signalR.HubConnection
) {
  try {
    await connection.start();
  } catch (error) {
    printErrorToChannel(
      "Following error occurred when trying to start the Analyzer server",
      error
    );
    await shutdown();
    return false;
  }

  return true;
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
    printErrorToChannel(
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
    shellPath: shell,
  });

  const analyzerServerTerminal = vscode.window.createTerminal({
    name: analyzerServerTerminalName,
    cwd: analyzerServerDirPath,
    shellPath: shell,
    location: {
      parentTerminal: playgroundTerminal,
    },
  });

  playgroundTerminal.sendText("dotnet watch run");
  playgroundTerminal.show(true);
  analyzerServerTerminal.sendText(
    `dotnet run -c Release --urls ${analyzerServerAddress} `
  );

  analyzerServerTerminal.show(true);
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

async function createCsharp(dirPath: string): Promise<boolean> {
  await mkdir(dirPath, { recursive: true });

  return (
    (await runExecCommand("dotnet new console --force", dirPath)) &&
    (await safeCopyFile(
      analyzerWelcomeMessageResourcePath,
      path.resolve(path.join(dirPath, "Program.cs"))
    ))
  );
}

async function runExecCommand(command: string, cwd: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execPromise(command, { cwd, shell });

    if (stdout) {
      channel?.appendLine(stdout);
    }

    if (stderr) {
      channel?.appendLine(stderr);
    }
  } catch (error) {
    printErrorToChannel(
      `Error occurred when trying to run command "${command}"`,
      error
    );
    return false;
  }

  return true;
}

// This method is called when your extension is deactivated
export function deactivate() {
  shutdown();
  AnalyzerConnectionManager.dispose();
}

async function shutdown() {
  disposeTerminals();

  try {
    await AnalyzerConnectionManager.stopConnection();
  } catch (error) {
    printErrorToChannel(
      "Following error occurred when trying to stop Analyzer connection manager",
      error
    );
  }

  removePlaygroundFromWorkspace();
}

async function isAnalyzerServerActive(): Promise<boolean> {
  try {
    const response = await fetch(`${analyzerServerAddress}/alive`);

    if (!response.ok) {
      channel?.appendLine(
        `Analyzer server responding with not ok. Message: ${await response.text()}`
      );
      return false;
    }
  } catch (error) {
    printErrorToChannel(
      "Error occurred when trying to check if Analyzer server is alive",
      error
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
    printErrorToChannel("Could not copy file, following error occured", error);
    return false;
  }

  return true;
}

async function tryCreateAnalyzerServer(
  analyzerServerResourcePath: string,
  analyzerServerProjFileResourcePath: string
) {
  try {
    if (existsSync(analyzerServerFilePath)) {
      return true;
    }

    await mkdir(analyzerServerDirPath, { recursive: true });
    await runExecCommand("dotnet new web --force", analyzerServerDirPath);

    await safeCopyFile(
      analyzerServerProjFileResourcePath,
      analyzerServerCsProjFilePath
    );
    await safeCopyFile(analyzerServerResourcePath, analyzerServerFilePath);
  } catch (error) {
    printErrorToChannel(
      "Error when trying to create and setup Analyzer server",
      error
    );

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

vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
  if (event.removed && !(await isAnalyzerServerActive())) {
    shutdown();
  }
});

vscode.workspace.onDidSaveTextDocument(async (document) => {
  if (!equalPaths(document.uri.fsPath, playgroundFilePath)) {
    return;
  }

  await connection?.invoke("AnalyzeCode", document.getText());
});

async function waitForAnalyzerServerReady(token: vscode.CancellationToken) {
  let tryCount = 0;

  return new Promise<boolean>((resolve, reject) => {
    const checkIfServerAlive = async () => {
      channel?.appendLine(
        `Checking if Analyzer server is ready, try ${tryCount} of ${maxServerRetries}`
      );
      if (token.isCancellationRequested) {
        channel?.appendLine(
          "Cancellation has been requested, cancelling checking analyzer server"
        );
        return;
      }

      if (await isAnalyzerServerActive()) {
        channel?.appendLine("Analyzer server is ready");
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

async function isDotnetAvailable() {
  try {
    channel?.appendLine(
      "Checking that .NET SDK is installed and that PATH is accessible"
    );
    await execPromise("dotnet --version");
  } catch (error) {
    printErrorToChannel(
      "Cant find that the .NET SDK is installed or that PATH is accessible",
      error
    );
    return false;
  }

  return true;
}

function getConfigSettings(): ConfigSettings {
  const config = vscode.workspace.getConfiguration(extensionName);

  return {
    analyzerServerPort: config.get<number>("analyzerServerPort") ?? defaultPort,
  };
}

function getAnalyzerServerAddress() {
  return `http://localhost:${getConfigSettings().analyzerServerPort}`;
}

function getAnalyzerServerHubAddress(serverAddress: string) {
  return `${serverAddress}/hub`;
}

function equalPaths(firstPath: string, secondPath: string) {
  const firstPathNorm = path.resolve(firstPath);
  const secodPathNorm = path.resolve(secondPath);

  if (platform === "win32") {
    return firstPathNorm.toLowerCase() === secodPathNorm.toLowerCase();
  }

  return firstPathNorm === secodPathNorm;
}
