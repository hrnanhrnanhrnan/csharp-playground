// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import * as os from "os";
import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import { mkdir, readFile, writeFile } from "fs/promises";
import * as signalR from "@microsoft/signalr";

const execPromise = promisify(exec);
const extensionName = "csharp-playground";
const homeDir = null ?? os.homedir();
const extensionDirName = `.csharp_playground`;
const analyzerServerAddress = "http://localhost:5140";
const hubAddress = `${analyzerServerAddress}/hub`;
const analyzerServerDirPath = path.join(homeDir, extensionDirName, "analyzer");
const analyzerServerFilePath = path.join(analyzerServerDirPath, "Program.cs");
const analyzerServerCsProjFilePath = path.join(analyzerServerDirPath, "analyzer.csproj");
const playgroundDirPath = path.join(homeDir, extensionDirName, "playground");
const playgroundDirUri = vscode.Uri.file(playgroundDirPath); 
const playgroundFilePath = path.join(playgroundDirPath, "Program.cs").toLowerCase();
let analyzerServerProcess: ChildProcessWithoutNullStreams | undefined;
let connection: signalR.HubConnection | undefined;
let channel: vscode.OutputChannel | undefined;
let playgroundTerminal: vscode.Terminal | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log(
    `Congratulations, your extension "${extensionName}" is now active!`
  );

  const analyzerServerCsProjResourcePath = path.join(context.extensionPath, "resources", "AnalyzerServerCsProjFile.txt");
  const analyzerServerResourcePath = path.join(context.extensionPath, "resources", "AnalyzerServer.cs");
  // Setup output channel
  channel = vscode.window.createOutputChannel(extensionName);

  // Setup analyzer server connection manager
  connection = AnalyzerConnectionManager.getConnection(hubAddress);

  if (await isAnalyzerServerActive(channel) && connection.state === signalR.HubConnectionState.Disconnected) {
    try {
      await connection.start();
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

  context.subscriptions.push(inlayHintsDisposable);

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
 // The commandId parameter must match the command field in package.json

  const stopDisposable = vscode.commands.registerCommand(
    `${extensionName}.stop`,
    async () => {
      if (connection) {
        await AnalyzerConnectionManager.stopConnection();
        AnalyzerConnectionManager.dispose();
      }
      
      analyzerServerProcess?.kill();
      playgroundTerminal?.dispose();

      const playgroundWorkspaceFolder = vscode.workspace.getWorkspaceFolder(playgroundDirUri);

      if (playgroundWorkspaceFolder) {
        vscode.workspace.updateWorkspaceFolders(
          playgroundWorkspaceFolder.index,
          1
        );
      }

  });

  const playDisposable = vscode.commands.registerCommand(
    `${extensionName}.play`,
    async () => {
      // The code you place here will be executed every time your command is executed
      if (!isPlaygroundInWorkspace()) {
        updateWorkspaceFolders();
        await vscode.commands.executeCommand(`${extensionName}.play`);
        return;
      }

      const success = await createCsharp(playgroundDirPath, channel!);

      if (!success) {
        vscode.window.showErrorMessage(
          "It went wrong creating the project, look in output"
        );
        return;
      }

      channel?.appendLine(playgroundFilePath);

      let document: vscode.TextDocument;
      console.log(
        "Before adding workspace folders:",
        vscode.workspace.workspaceFolders
      );

      try {
        const uri = vscode.Uri.file(playgroundFilePath);
        document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
      } catch (error) {
        await alertUser("It went wrong opening the file, look in output", "error");
        vscode.window.showErrorMessage(
          "It went wrong opening the file, look in output"
        );
        return;
      }

      playgroundTerminal = vscode.window.createTerminal("Playground-runner");
      playgroundTerminal.sendText(`cd ${playgroundDirPath}`);
      playgroundTerminal.sendText("dotnet watch run");
      playgroundTerminal.show(true);

      if (!await tryCreateAanalyzerServer(analyzerServerResourcePath, analyzerServerCsProjResourcePath, channel!)) {
        await alertUser(
          `Something went wrong trying to create analyzer server, check output for more information`,
          "error"
        );
      }

      if (!await isAnalyzerServerActive(channel!)) {
        analyzerServerProcess = spawn("dotnet", ["run", "--urls", analyzerServerAddress],
          {
            cwd: analyzerServerDirPath,
            shell: true
          }
        );

        analyzerServerProcess.stderr.on("data", (data: Buffer) => {
          console.error(`AnalyzerServer stderr: ${data.toString()}`);
        });

        analyzerServerProcess.stdout.on("data", (data: Buffer) => {
          console.log(`AnalyzerServer stdout: ${data.toString()}`);
        });

        if (!await waitForAnalyzerServerReady(channel!)) {
          await alertUser(
            `Something went wrong trying to starting analyzer server, check output for more information`,
            "error"
          );
        }
      }


      if (!updateWorkspaceFolders()) {
        await alertUser(
          `Something went wrong trying to update workspace folders, check output for more information`,
          "error"
        );
      }

      await alertUser(`Succesfully created and launched a playground at ${playgroundFilePath}`, "success");
    }
  );

  context.subscriptions.push(playDisposable);
  context.subscriptions.push(stopDisposable);
}

function updateWorkspaceFolders(): boolean {
  return vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders.length
      : 0,
    null,
    { uri: playgroundDirUri, name: extensionName }
  );
}

function isPlaygroundInWorkspace() {
    return vscode.workspace.workspaceFolders?.some(x => x.uri.fsPath.toLowerCase() === playgroundDirPath.toLowerCase());
}

function ensureWorkspace(): boolean {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return false;
  }
  return true;
}

async function createCsharp(
  dirPath: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath);
  }

  return (
    (await runExecCommand("dotnet new console --force", dirPath, channel)) &&
    (await writeHelloMessage(dirPath, channel))
  );
}

async function writeHelloMessage(
  filePath: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  try {
    const data = `// Thank you for using "${extensionName}"
// If you want to save the work, run the "Save progress" command

Console.WriteLine("Hello Playground!");`;

    await writeFile(path.join(filePath, "Program.cs"), data, {
      encoding: "utf-8",
    });
    return true;
  } catch (error) {
    console.log("wrong");
    channel.appendLine(`Error occured: ${error}`);
    return false;
  }
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
export function deactivate() {
  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    connection.stop();
  } 
  if (analyzerServerProcess) {
    analyzerServerProcess.kill();
  }
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

async function tryCreateAanalyzerServer(analyzerServerResourcePath: string, analyzerServerProjFileResourcePath: string, channel: vscode.OutputChannel) {
  if (!existsSync(analyzerServerFilePath)) {
    try {
      await mkdir(analyzerServerDirPath, { recursive: true });
      await runExecCommand("dotnet new web --force", analyzerServerDirPath, channel);
      const serverProjContent = await readFile(analyzerServerProjFileResourcePath, { encoding: "utf8" });
      const serverContent = await readFile(analyzerServerResourcePath, { encoding: "utf8" });
      await writeFile(analyzerServerCsProjFilePath, serverProjContent);
      await writeFile(analyzerServerFilePath, serverContent);

      return true;
    } catch (error) {
      channel.appendLine(`Error when trying to create analyzerServer: ${error}`);

      return false;
    }
  }

  return true;
}

async function alertUser(message: string, type: "error" | "success") {
  const alertMessage = 
          `${extensionName}: 
          ${message}`;

  if (type === "error") {
    await vscode.window.showErrorMessage(alertMessage);
    return;
  }

  await vscode.window.showInformationMessage(alertMessage);
}

type AnalyzedDataItem = {
  Line: string
  Value: string
}

class AnalyzerConnectionManager {
  private static instance: signalR.HubConnection | null;
  private static inlayHintsProvider: PlaygroundInlayHintsProvider | null = null;

  public static setInlayHintsProvider(inlayhintsProvider: PlaygroundInlayHintsProvider){
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
        console.log(analyzerData ?? "no data");
        AnalyzerConnectionManager.inlayHintsProvider?.setData(analyzerData);
        vscode.window.showInformationMessage(`Ny data mottagen: ${data}`);
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
      console.log('Current analyzerData:', JSON.stringify(this.analyzerData, null, 2));
      console.log(`Processing line ${i}: "${line.text}"`);

      const match = this.analyzerData.find(x => x.Line === line.text);

      if (match) {
        const position = new vscode.Position(i, line.text.length);
        const value = JSON.stringify(match.Value);
        const hint = new vscode.InlayHint(position, value, vscode.InlayHintKind.Type);
        hint.paddingLeft = hint.paddingRight = true;
        hint.tooltip = JSON.stringify(match.Value, null, 4);
        
        hints.push(
          hint
        );
      }
    }

    return hints;
  }

  public setData(analyzerDataItems: AnalyzedDataItem[]) {
    console.log('setData called with', analyzerDataItems);
    this.analyzerData = analyzerDataItems;
    this._onDidChangeInlayHints.fire();
  }
}

vscode.workspace.onDidCloseTextDocument(document => {
  // if document.uri.path === path of playground file, shut down connection to analyzer server
});

vscode.workspace.onDidSaveTextDocument(async document => {
  // if document.uri.path === path of playground file, shut down connection to analyzer server
  if (document.uri.fsPath.toLowerCase() !== playgroundFilePath.toLowerCase()) {
    return;
  }

  await connection?.invoke("AnalyzeCode", document.getText());
});


async function waitForAnalyzerServerReady(channel: vscode.OutputChannel) {
  let tries = 0;
  const maxRetries = 10;

  return new Promise<boolean>((resolve, reject) => {
    const checkServerAlive = async () => {
      if (await isAnalyzerServerActive(channel)) {
        resolve(true);
      }

      tries++;
      if (tries < maxRetries) {
        setTimeout(checkServerAlive, 1000);
      }
      else {
        reject(false);
      }
    };

    checkServerAlive();
  });
}