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
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { extensionName, maxServerRetries, playgroundRunnerTerminalName, analyzerServerTerminalName, defaultPort } from "./Constants";
import { PlaygroundRunner } from "./PlaygroundRunner";

const execPromise = promisify(exec);
const platform = os.platform();
const shell = platform === "win32" ? "powershell.exe" : "/bin/bash";
let isDotnetInstalled = false;
let connection: signalR.HubConnection | undefined;
let channel: vscode.OutputChannel | undefined;
let pathManager: PlaygroundPathMananger | undefined;
let playgroundRunner: PlaygroundRunner | undefined;

export async function deactivate() {
  await shutdown();
  AnalyzerConnectionManager.dispose();
}

export async function activate(context: vscode.ExtensionContext) {
  console.log(`The "${extensionName}" extension is now active!`);

  // Setup output channel
  channel = vscode.window.createOutputChannel(extensionName);

  pathManager = PlaygroundPathMananger.getInstance(context, channel);
  playgroundRunner = new PlaygroundRunner(pathManager);

  isDotnetInstalled = await isDotnetAvailable();
  if (!isDotnetInstalled) {
    alertUser(
      `Cant find that the .NET SDK is installed or that PATH is accessible. 
      Make sure that the .NET SDK is installed and that dotnet is added to PATH`,
      "error"
    );
  }
  await setupAnalyzerClient(context);

  const stopDisposable = vscode.commands.registerCommand(
    `${extensionName}.stop`,
    stopCommand
  );

  const playDisposable = vscode.commands.registerCommand(
    `${extensionName}.play`,
    playCommand
  );

  context.subscriptions.push(stopDisposable);
  context.subscriptions.push(playDisposable);
}

async function stopCommand() {
  return shutdown();
}

async function playCommand() {
  if (!isDotnetInstalled) {
    alertUser(
      "Cant find that .NET SDK is installed or that PATH is accessible. Have you recently installed, try to reload vscode",
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

      PlaygroundPathMananger.refreshAnalyzerServerAddresses();

      disposeTerminals();
      await AnalyzerConnectionManager.stopConnection();
      connection = AnalyzerConnectionManager.getConnection(pathManager!.hubAddress);

      progress.report({ message: "Setting up the playgorund..." });

      if (!(await createCsharp(pathManager!.playgroundDirPath))) {
        alertUser(
          "It went wrong creating the project, look in output",
          "error"
        );
        return;
      }

      progress.report({ message: "Setting up the analyzer server..." });

      if (
        !(await tryCreateAnalyzerServer(
          pathManager!.analyzerServerResourcePath,
          pathManager!.analyzerServerCsProjResourcePath
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

      const isServerReadyPromise = waitForAnalyzerServerReady(
        maxServerRetries,
        token
      );

      const { error, document } = await openTextDocument(pathManager!.playgroundFilePath);
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
        `Succesfully created and launched a playground at ${pathManager!.playgroundFilePath}`,
        "success"
      );
    }
  );
}

async function setupAnalyzerClient(context: vscode.ExtensionContext) {
  connection = AnalyzerConnectionManager.getConnection(pathManager!.hubAddress);

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
  AnalyzerConnectionManager.setOutputChannel(channel!);
  context.subscriptions.push(inlayHintsDisposable);
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
    { uri: pathManager!.playgroundDirUri, name: extensionName }
  );
}

function removePlaygroundFromWorkspace() {
  const playgroundWorkspaceFolder =
    vscode.workspace.getWorkspaceFolder(pathManager!.playgroundDirUri);

  if (!playgroundWorkspaceFolder) {
    return;
  }

  vscode.workspace.updateWorkspaceFolders(playgroundWorkspaceFolder.index, 1);
}

function setupAndRunTerminals() {
  const playgroundTerminal = vscode.window.createTerminal({
    name: playgroundRunnerTerminalName,
    cwd: pathManager!.playgroundDirPath,
    shellPath: shell,
  });

  const analyzerServerTerminal = vscode.window.createTerminal({
    name: analyzerServerTerminalName,
    cwd: pathManager!.analyzerServerDirPath,
    shellPath: shell,
    location: {
      parentTerminal: playgroundTerminal,
    },
  });

  playgroundTerminal.sendText("dotnet watch run");
  playgroundTerminal.show(true);
  analyzerServerTerminal.sendText(
    `dotnet run -c Release --urls ${pathManager!.analyzerServerAddress} `
  );

  analyzerServerTerminal.show(true);
}

function disposeTerminals() {
  const terminals = vscode.window.terminals.filter(
    (x) =>
      x.name === playgroundRunnerTerminalName ||
      x.name === analyzerServerTerminalName
  );

  for (let index = 0; index < terminals.length; index++) {
    terminals[index].dispose();
  }
}

function isPlaygroundInWorkspace() {
  const playgroundWorkspaceFolder =
    vscode.workspace.getWorkspaceFolder(pathManager!.playgroundDirUri);

  return playgroundWorkspaceFolder !== undefined;
}

async function createCsharp(dirPath: string): Promise<boolean> {
  await mkdir(dirPath, { recursive: true });

  return (
    (await runExecCommand("dotnet new console --force", dirPath)) &&
    (await safeCopyFile(
      pathManager!.analyzerWelcomeMessageResourcePath,
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
    const response = await fetch(pathManager!.analyzerServerStatusAddress);

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
    if (existsSync(pathManager!.analyzerServerFilePath)) {
      return true;
    }

    await mkdir(pathManager!.analyzerServerDirPath, { recursive: true });
    await runExecCommand("dotnet new web --force", pathManager!.analyzerServerDirPath);

    await safeCopyFile(
      analyzerServerProjFileResourcePath,
      pathManager!.analyzerServerCsProjFilePath
    );
    await safeCopyFile(analyzerServerResourcePath, pathManager!.analyzerServerFilePath);
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
  if (!equalPaths(document.uri.fsPath, pathManager!.playgroundFilePath)) {
    return;
  }

  await connection?.invoke("AnalyzeCode", document.getText());
});

async function waitForAnalyzerServerReady(
  maxServerRetries: number,
  token: vscode.CancellationToken
) {
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


function equalPaths(firstPath: string, secondPath: string) {
  const firstPathNorm = path.resolve(firstPath);
  const secodPathNorm = path.resolve(secondPath);

  if (platform === "win32") {
    return firstPathNorm.toLowerCase() === secodPathNorm.toLowerCase();
  }

  return firstPathNorm === secodPathNorm;
}
