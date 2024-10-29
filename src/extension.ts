import * as vscode from "vscode";
import { PlaygroundManager } from "./PlaygroundManager";
import { alertUser } from "./utils";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { AnalyzerServerManager } from "./AnalyzerServerManager";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { PlaygroundCommandResolver } from "./PlaygroundCommandResolver";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { extensionName } from "./constants";
import { PlaygroundProdStateManager } from "./PlaygroundProdStateManager";
import { PlaygroundDevStateManager } from "./PlaygroundDevStateManager";
import { PlaygroundRunner } from "./PlaygroundRunner";

let playgroundManager: PlaygroundManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const playgroundChannel = new PlaygroundOutputChannel(extensionName);
  playgroundChannel.appendLine(
    `The "${extensionName}" extension is now active!`
  );

  const extensionManager = await PlaygroundExtensionManager.createInstance(
    context,
    playgroundChannel
  );

  const pathManager = PlaygroundPathMananger.getInstance(context);

  const stateManager: IPlaygroundStateManager = extensionManager.isProduction
    ? new PlaygroundProdStateManager(pathManager, playgroundChannel)
    : new PlaygroundDevStateManager();

  const serverManager = new AnalyzerServerManager(
    pathManager.analyzerServerDirPath,
    playgroundChannel
  );

  const inlayHintsProvider = new PlaygroundInlayHintsProvider(serverManager);
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { scheme: "file", language: "csharp" },
    inlayHintsProvider
  );

  playgroundManager = new PlaygroundManager(
    extensionManager,
    pathManager,
    serverManager,
    playgroundChannel
  );

  const playgroundRunner = new PlaygroundRunner(
    playgroundManager,
    extensionManager,
    stateManager,
    pathManager,
    playgroundChannel
  );

  const commandResolver = new PlaygroundCommandResolver(playgroundRunner);

  const [
    newCommandDisposable,
    continueCommandDisposable,
    stopCommandDisposable,
  ] = await commandResolver.resolveRegisterCommands();

  context.subscriptions.push(inlayHintsDisposable);
  context.subscriptions.push(newCommandDisposable);
  context.subscriptions.push(continueCommandDisposable);
  context.subscriptions.push(stopCommandDisposable);

  if (!extensionManager.isDotnetInstalled) {
    alertUser(
      `Cant find that the .NET SDK is installed or that PATH is accessible. 
        Make sure that the .NET SDK is installed and that dotnet is added to PATH.`,
      "error"
    );
  }

  if (
    extensionManager.isUpdated() &&
    (await playgroundManager.refreshAnalyzerServerOnDisk())
  ) {
    extensionManager.updateVersionInGlobalStorage();
  }

  const [playgroundStarted, type] =
    await playgroundRunner.isStartPlaygroundRequested();

  if (playgroundStarted) {
    playgroundRunner.startPlayground(type);
  }
}

export async function deactivate() {
  if (playgroundManager) {
    playgroundManager.shutdown();
    playgroundManager.dispose();
  }
}
