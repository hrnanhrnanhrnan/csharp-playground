import { PlaygroundManager } from "./PlaygroundManager";
import * as vscode from "vscode";
import { alertUser, equalPaths } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { getConfigSettings } from "./config";
import { extensionName } from "./constants";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { existsSync } from "fs";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";

export class PlaygroundRunner {
  private playgroundManager: PlaygroundManager;
  private stateManager: IPlaygroundStateManager;
  private extensionManager: PlaygroundExtensionManager;
  private pathManager: PlaygroundPathMananger;
  private context: vscode.ExtensionContext;
  private channel: PlaygroundOutputChannel;


  constructor(
    context: vscode.ExtensionContext,
    playgroundManager: PlaygroundManager,
    extensionManager: PlaygroundExtensionManager,
    stateManager: IPlaygroundStateManager,
    pathManager: PlaygroundPathMananger,
    channel: PlaygroundOutputChannel
  ) {
    this.context = context;
    this.playgroundManager = playgroundManager;
    this.extensionManager = extensionManager;
    this.stateManager = stateManager;
    this.pathManager = pathManager;
    this.channel = channel;

    this.registerOnDidSaveTextDocumentEventHandler();

    if (this.extensionManager.isProduction) {
      this.registerOnDidChangeWindowStateEventHandler();
    }
  }

  async initializePlayground(type: PlaygroundType) {
    if (!this.extensionManager.isDotnetInstalled) {
      alertUser(
        "Cant find that .NET SDK is installed or that PATH is accessible. Have you recently installed, try to reload vscode",
        "error"
      );
      return;
    }

    let continueRun = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `${extensionName}: ${type} -> `,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          this.playgroundManager.shutdown();
        });

        const config = getConfigSettings();

        progress.report({ message: "Setting up the playground..." });

        if (
          (type === "New" ||
            !existsSync(this.pathManager.playgroundFilePath)) &&
          !(await this.playgroundManager.createCsharp(config.dotnetVersion))
        ) {
          alertUser(
            "It went wrong creating the project, look in output",
            "error"
          );
          return;
        }

        progress.report({ message: "Setting up the analyzer server..." });

        if (!(await this.playgroundManager.tryCreateAnalyzerServer())) {
          alertUser(
            `Something went wrong trying to create analyzer server, check output for more information`,
            "error"
          );

          return;
        }

        continueRun = true;
      }
    );

    if (!continueRun) {
      return;
    }

    if (
      this.playgroundManager.isPlaygroundInWorkspace() ||
      !this.extensionManager.isProduction
    ) {
      this.channel.appendLine("starting playground from initialize");
      return this.startPlayground(type);
    }

    await this.stateManager.updateState({
      playgroundStarted: true,
      typeOfPlayground: type,
    });

    this.channel.appendLine("opening folder from initiazie");
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      this.pathManager.playgroundDirUri,
      true
    );
  }

  async startPlayground(type: PlaygroundType) {
    // const state = await this.stateManager.getState();
    // if (!state.playgroundStarted) {
    //   return;
    // }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `${extensionName}: ${type} -> `,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          this.playgroundManager.shutdown();
        });
        
        this.playgroundManager.clearPlayground();

        const state = await this.stateManager.getState();
        this.channel.appendLine(`in startPlayground, status for playgroundStarted state is: ${state.playgroundStarted}`);

        await this.playgroundManager.runPlaygroundInTerminal();

        progress.report({ message: "Waiting for analyzer server..." });

        const isServerReadyPromise =
          this.playgroundManager.waitForAnalyzerServerReady(token);

        const [document, error] =
          await this.playgroundManager.openTextDocument();
        if (error) {
          alertUser("It went wrong opening the file, look in output", "error");
          return;
        }

        const isServerReady = await isServerReadyPromise;
        if (!isServerReady) {
          this.playgroundManager.disposeTerminals();
          alertUser(
            `Could not start Analyzer server, check output for more information`,
            "error"
          );

          return;
        }

        progress.report({ message: "Setting up workspace..." });

        if (!this.playgroundManager.isPlaygroundInWorkspace()) {
          this.playgroundManager.addPlaygroundToWorkspace();
        }

        await this.stateManager.resetState();
        alertUser(`Succesfully created and launched a playground`, "success");
      }
    );
  }

  stopPlayground() {
    this.playgroundManager.shutdown();
  }

  async isPlaygroundRequestedOnActivation(): Promise<
    [boolean, PlaygroundType?]
  > {
    const state = await this.stateManager.getState();
    return [
      state.playgroundStarted &&
        this.playgroundManager.isPlaygroundInWorkspace(),
      state.typeOfPlayground,
    ];
  }

  private registerOnDidChangeWindowStateEventHandler() {
    vscode.window.onDidChangeWindowState(async (state) => {
      const [playgroundStarted, type] =
        await this.isPlaygroundRequestedOnActivation();

      this.channel.appendLine(`in eventhandler playgorund started state is: ${playgroundStarted}`);
      if (!playgroundStarted) {
        return;
      }

      this.channel.appendLine(`in eventhandler playgorund, will now run startplayground`);
      return this.startPlayground(type ?? "New");
      // await this.stateManager.resetState();
    });
  }

  private registerOnDidSaveTextDocumentEventHandler() {
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (
        !equalPaths(
          document.uri.fsPath,
          this.playgroundManager.pathManager.playgroundFilePath ?? ""
        )
      ) {
        return;
      }

      return this.playgroundManager.analyzeCode(document);
    });
  }
}
