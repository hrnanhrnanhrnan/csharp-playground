import { PlaygroundManager } from "./PlaygroundManager";
import * as vscode from "vscode";
import { alertUser, equalPaths, tryCatch } from "./utils";
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
      return alertUser(
        "Cant find that .NET SDK is installed or that PATH is accessible. Have you recently installed, try to reload vscode",
        "error"
      );
    }

    const [successfullIntialization, errorMessage] =
      await this.initializePlaygroundProcess(type);

    if (!successfullIntialization) {
      return alertUser(errorMessage, "error");
    }

    if (this.startPlaygroundInCurrentWindow()) {
      return this.startPlayground(type);
    }

    await this.setPlaygroundStartedState(type);
    await this.openPlaygroundInNewWindow();
  }

  private async openPlaygroundInNewWindow() {
    return vscode.commands.executeCommand(
      "vscode.openFolder",
      this.pathManager.playgroundDirUri,
      true
    );
  }

  private async setPlaygroundStartedState(type: PlaygroundType) {
    return this.stateManager.updateState({
      playgroundStarted: true,
      typeOfPlayground: type,
    });
  }

  private async initializePlaygroundProcess(
    type: PlaygroundType
  ): Promise<[boolean, string]> {
    let errorMessage = "";
    let cancellationRequested = false;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `${extensionName}: ${type} -> `,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          this.playgroundManager.shutdown();
          cancellationRequested = true;
        });

        const config = getConfigSettings();

        progress.report({ message: "Setting up the playground..." });

        if (
          this.shouldCreatePlayground(type) &&
          !(await this.playgroundManager.createPlayground(config.dotnetVersion))
        ) {
          return (errorMessage =
            "It went wrong creating the project, look in output");
        }

        progress.report({ message: "Setting up the analyzer server..." });

        if (token.isCancellationRequested) {
          return (errorMessage = "Cancellation requested, will not setup analyzer server");
        }

        if (!(await this.playgroundManager.tryCreateAnalyzerServer())) {
          return (errorMessage = `Something went wrong trying to create analyzer server, check output for more information`);
        }
      }
    );

    return [!!errorMessage || !cancellationRequested, errorMessage];
  }

  private startPlaygroundInCurrentWindow() {
    return (
      this.playgroundManager.isPlaygroundInWorkspace() ||
      !this.extensionManager.isProduction
    );
  }

  private shouldCreatePlayground(type: PlaygroundType) {
    return type === "New" || !existsSync(this.pathManager.playgroundFilePath);
  }

  async startPlayground(type: PlaygroundType) {
    const tokenSource = new vscode.CancellationTokenSource();

    return tryCatch(
      async () => {
        return vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
            title: `${extensionName}: ${type} -> `,
          },
          async (progress, token) => {
            token.onCancellationRequested(() => {
              tokenSource.cancel();
            });

            tokenSource.token.onCancellationRequested(() => {
              this.playgroundManager.shutdown();
            });

            this.playgroundManager.shutdown();

            const [startPlaygroundError] =
              await this.playgroundManager.startPlaygroundInTerminal();

            if (startPlaygroundError) {
              return alertUser(
                "It went wrong starting playground in terminal",
                "error"
              );
            }

            progress.report({ message: "Waiting for analyzer server..." });

            const isServerReadyPromise =
              this.playgroundManager.waitForAnalyzerServerReady(tokenSource.token);

            const [openDocumentError] =
              await this.playgroundManager.openTextDocument();

            if (openDocumentError) {
              tokenSource.cancel();
              return alertUser(
                "It went wrong opening the file, look in output",
                "error"
              );
            }

            const isServerReady = await isServerReadyPromise;
            if (!isServerReady) {
              this.playgroundManager.disposeTerminals();
              return alertUser(
                `Could not start Analyzer server, check output for more information`,
                "error"
              );
            }

            progress.report({ message: "Setting up workspace..." });

            if (!this.playgroundManager.isPlaygroundInWorkspace()) {
              this.playgroundManager.addPlaygroundToWorkspace();
            }

            await this.stateManager.resetState();
            alertUser(
              `Succesfully created and launched a playground`,
              "success"
            );
          }
        );
      },
      (error) => this.channel.printErrorToChannel("Some unecspected error thrown when starting playground", error),
      () => tokenSource.dispose()
    );
  }

  stopPlayground() {
    this.playgroundManager.shutdown();
  }

  async isPlaygroundRequestedOnActivation(): Promise<
    [boolean, PlaygroundType]
  > {
    const state = await this.stateManager.getState();
    return [
      state.playgroundStarted &&
        this.playgroundManager.isPlaygroundInWorkspace(),
      state.typeOfPlayground ?? "New",
    ];
  }

  private registerOnDidChangeWindowStateEventHandler() {
    vscode.window.onDidChangeWindowState(async (state) => {
      const [playgroundStarted, type] =
        await this.isPlaygroundRequestedOnActivation();

      if (!playgroundStarted) {
        return;
      }

      return this.startPlayground(type);
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

      const [error] = await this.playgroundManager.analyzeCode(document);
      if (error) {
        this.channel.printErrorToChannel("Could not analyze code", error);
      }
    });
  }
}
