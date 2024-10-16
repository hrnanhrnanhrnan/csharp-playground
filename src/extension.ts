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
import { extensionName } from "./constants";

let playgroundManager: PlaygroundManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log(`The "${extensionName}" extension is now active!`);

  // Setup output channel
  const playgroundChannel = new PlaygroundOutputChannel(extensionName);

  const inlayHintsProvider = new PlaygroundInlayHintsProvider();
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { scheme: "file", language: "csharp" },
    inlayHintsProvider
  );

  const extensionManager = await PlaygroundExtensionManager.createInstance(context, playgroundChannel);

  const pathManager = PlaygroundPathMananger.getInstance(
    context
  );

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

  const eventHandlerResolver = new PlaygroundEventHandlerResolver(playgroundManager);
  eventHandlerResolver.resolveEventHandlers();

  const commandResolver = new PlaygroundCommandResolver(playgroundManager, extensionManager);
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
    await playgroundManager.removeAnalyzerServerFromDisk();
  }

  context.subscriptions.push(inlayHintsDisposable);
  context.subscriptions.push(newCommandDisposable);
  context.subscriptions.push(continueCommandDisposable);
  context.subscriptions.push(stopCommandDisposable);
}

export async function deactivate() {
  playgroundManager?.shutdown();
}