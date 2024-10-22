// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { PlaygroundManager } from "./PlaygroundManager";
import { alertUser } from "./utils";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { PlaygroundCommandResolver } from "./PlaygroundCommandResolver";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { PlaygroundEventHandlerResolver } from "./PlaygroundEventHandlerResolver";
import { extensionName, runPlaygroundCommandFiredKey } from "./constants";
import { PlaygroundProdStateManager } from "./PlaygroundProdStateManager";
import { PlaygroundDevStateManager } from "./PlaygroundDevStateManager";
import { PlaygroundRunner } from "./PlaygroundRunner";

let playgroundManager: PlaygroundManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log(`The "${extensionName}" extension is now active!`);

  // Setup output channel
  const playgroundChannel = new PlaygroundOutputChannel(extensionName);
  playgroundChannel.appendLine(`The "${extensionName}" extension is now active!`);

  const inlayHintsProvider = new PlaygroundInlayHintsProvider();
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { scheme: "file", language: "csharp" },
    inlayHintsProvider
  );
  
  const extensionManager = await PlaygroundExtensionManager.createInstance(context, playgroundChannel);

  const pathManager = PlaygroundPathMananger.getInstance(
    context
  );

  const stateManager: IPlaygroundStateManager = extensionManager.isProduction
    ? new PlaygroundProdStateManager(pathManager, playgroundChannel)
    : new PlaygroundDevStateManager();

  const serverManager = await AnalyzerServerManager.createInstance(
    context,
    pathManager.analyzerServerDirPath,
    inlayHintsProvider,
    playgroundChannel
  );

  playgroundManager = new PlaygroundManager(
    extensionManager,
    pathManager,
    serverManager,
    playgroundChannel
  );

  const playgroundRunner = new PlaygroundRunner(context, playgroundManager, extensionManager, stateManager, pathManager, playgroundChannel);

  // const eventHandlerResolver = new PlaygroundEventHandlerResolver(context, playgroundManager, playgroundRunner);
  // eventHandlerResolver.resolveEventHandlers();

  const commandResolver = new PlaygroundCommandResolver(context, playgroundRunner, extensionManager);
  const [
    newCommandDisposable,
    continueCommandDisposable,
    stopCommandDisposable,
  ] = await commandResolver.resolveRegisterCommands();

  if (!extensionManager.isDotnetInstalled) {
    alertUser(
      `Cant find that the .NET SDK is installed or that PATH is accessible. 
        Make sure that the .NET SDK is installed and that dotnet is added to PATH.`,
      "error"
    );
  }
  
  if (extensionManager.isUpdated()) {
    await playgroundManager.refreshAnalyzerServerOnDisk();
  }

  context.subscriptions.push(inlayHintsDisposable);
  context.subscriptions.push(newCommandDisposable);
  context.subscriptions.push(continueCommandDisposable);
  context.subscriptions.push(stopCommandDisposable);

  const [playgroundStarted, type] = await playgroundRunner.isPlaygroundRequestedOnActivation();

  if (playgroundStarted) {
    playgroundChannel.appendLine("starting playground terminals from extension.ts");
    playgroundRunner.startPlayground(type ?? "New");
  }
}

export async function deactivate() {
  playgroundManager?.shutdown();
}