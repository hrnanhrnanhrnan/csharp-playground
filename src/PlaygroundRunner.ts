import { PlaygroundManager } from "./PlaygroundManager";
import * as vscode from "vscode";
import { alertUser, equalPaths, tryCatchPromise } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { getConfigSettings } from "./config";
import { extensionName } from "./constants";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { existsSync } from "fs";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";

export class PlaygroundRunner {
  private readonly playgroundManager: PlaygroundManager;
  private readonly stateManager: IPlaygroundStateManager;
  private readonly extensionManager: PlaygroundExtensionManager;
  private readonly pathManager: PlaygroundPathMananger;
  private readonly channel: PlaygroundOutputChannel;

  constructor(
    playgroundManager: PlaygroundManager,
    extensionManager: PlaygroundExtensionManager,
    stateManager: IPlaygroundStateManager,
    pathManager: PlaygroundPathMananger,
    channel: PlaygroundOutputChannel
  ) {
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

  async startPlayground(type: PlaygroundType) {
    const tokenSource = new vscode.CancellationTokenSource();

    return tryCatchPromise(
      async () => {
        vscode.window.withProgress(
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
              this.stateManager.resetState();
            });

            await this.stateManager.resetState();
            this.playgroundManager.shutdown();

            const [startPlaygroundError] =
              await this.playgroundManager.startPlaygroundInTerminal();

            if (startPlaygroundError) {
              tokenSource.cancel();
              return alertUser(
                "It went wrong starting playground in terminal",
                "error"
              );
            }

            progress.report({ message: "Waiting for analyzer server..." });

            const isServerReadyPromise =
              this.playgroundManager.waitForAnalyzerServerReady(
                tokenSource.token
              );

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
              tokenSource.cancel();
              return alertUser(
                `Could not start Analyzer server, check output for more information`,
                "error"
              );
            }

            progress.report({ message: "Setting up workspace..." });

            if (!this.playgroundManager.isPlaygroundInWorkspace()) {
              this.playgroundManager.addPlaygroundToWorkspace();
            }

            alertUser(
              `Succesfully created and launched a playground`,
              "success"
            );
          }
        );
      },
      (error) => {
        tokenSource.cancel();
        this.channel.printErrorToChannel(
          "Some unecspected error thrown when starting playground",
          error
        );
      },
      () => tokenSource.dispose()
    );
  }

  stopPlayground() {
    this.playgroundManager.shutdown();
  }

  async isStartPlaygroundRequested(): Promise<[boolean, PlaygroundType]> {
    const state = await this.stateManager.getState();
    return [
      state.playgroundStarted &&
        this.playgroundManager.isPlaygroundInWorkspace(),
      state.typeOfPlayground ?? "New",
    ];
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
          return (errorMessage =
            "Cancellation requested, will not setup analyzer server");
        }

        if (!(await this.playgroundManager.tryCreateAnalyzerServer())) {
          return (errorMessage = `Something went wrong trying to create analyzer server, check output for more information`);
        }
      }
    );

    return [!!errorMessage || !cancellationRequested, errorMessage];
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

  private startPlaygroundInCurrentWindow() {
    return (
      this.playgroundManager.isPlaygroundInWorkspace() ||
      !this.extensionManager.isProduction
    );
  }

  private shouldCreatePlayground(type: PlaygroundType) {
    return (
      type === "New" || !existsSync(this.pathManager.playgroundProgramFilePath)
    );
  }

  private registerOnDidChangeWindowStateEventHandler() {
    vscode.window.onDidChangeWindowState(async () => {
      const [playgroundStarted, type] = await this.isStartPlaygroundRequested();

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
          this.playgroundManager.pathManager.playgroundProgramFilePath
        )
      ) {
        return;
      }

      await this.playgroundManager.analyzeCode(document);
    });
  }
}
