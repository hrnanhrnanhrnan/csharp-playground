// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { extensionName } from "./constants";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { alertUser } from "./utils";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { PlaygroundCommandResolver } from "./PlaygroundCommandResolver";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { PlaygroundEventHandlerResolver } from "./PlaygroundEventHandlerResolver";

let playgroundRunner: PlaygroundRunner | undefined;

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

  const serverManager = new AnalyzerServerManager(
    pathManager.analyzerServerDirPath,
    inlayHintsProvider,
    playgroundChannel
  );

  playgroundRunner = new PlaygroundRunner(
    pathManager,
    serverManager,
    playgroundChannel
  );

  const eventHandlerResolver = new PlaygroundEventHandlerResolver(playgroundRunner);
  eventHandlerResolver.resolveEventHandlers();

  const commandResolver = new PlaygroundCommandResolver(playgroundRunner, extensionManager);
  const [
    newCommandDisposable,
    continueCommandDisposable,
    stopCommandDisposable,
  ] = await commandResolver.resolveRegisterCommands();

  if (!extensionManager.isDotnetInstalled) {
    alertUser(
      `Cant find that the .NET SDK is installed or that PATH is accessible. 
        Make sure that the .NET SDK is installed and that dotnet is added to PATH`,
      "error"
    );
  }
  
  if (extensionManager.isUpdated()) {
    await playgroundRunner.removeAnalyzerServerFromDisk();
  }

  context.subscriptions.push(inlayHintsDisposable);
  context.subscriptions.push(newCommandDisposable);
  context.subscriptions.push(continueCommandDisposable);
  context.subscriptions.push(stopCommandDisposable);
}

export async function deactivate() {
  playgroundRunner?.shutdown();
}