import { PlaygroundManager } from "./PlaygroundManager";
import * as vscode from "vscode";
import { alertUser } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { getConfigSettings } from "./config";
import { extensionName } from "./constants";

export class PlaygroundCommandResolver {
  private newPlaygroundCommandName = `${extensionName}.newPlayground`;
  private continuePlaygroundCommandName = `${extensionName}.continuePlayground`;
  private stopPlaygroundCommandName = `${extensionName}.stopPlayground`;
  private playgroundManager: PlaygroundManager;
  private extensionManager: PlaygroundExtensionManager;

  constructor(
    playgroundManager: PlaygroundManager,
    extensionManager: PlaygroundExtensionManager
  ) {
    this.playgroundManager = playgroundManager;
    this.extensionManager = extensionManager;
  }

  async resolveRegisterCommands() {
    return [
      this.registerNewPlaygroundCommand(),
      this.registerContinuePlaygroundCommand(),
      this.registerStopPlaygroundCommand(),
    ];
  }

  private registerNewPlaygroundCommand() {
    return vscode.commands.registerCommand(this.newPlaygroundCommandName, () =>
      this.startPlayground("New")
    );
  }

  private registerContinuePlaygroundCommand() {
    return vscode.commands.registerCommand(
      this.continuePlaygroundCommandName,
      () => this.startPlayground("Continue")
    );
  }

  private registerStopPlaygroundCommand() {
    return vscode.commands.registerCommand(this.stopPlaygroundCommandName, () =>
      this.stopPlayground()
    );
  }

  private stopPlayground() {
    this.playgroundManager.shutdown();
  }

  private async startPlayground(type: PlaygroundType) {
    if (!this.extensionManager.isDotnetInstalled) {
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
        title: `${extensionName}: ${type} -> `,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          this.stopPlayground();
        });

        const config = getConfigSettings();

        this.playgroundManager.clearPlayground();

        progress.report({ message: "Setting up the playground..." });

        if (type === "New" && !(await this.playgroundManager.createCsharp(config.dotnetVersion))) {
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

        alertUser(`Succesfully created and launched a playground`, "success");
      }
    );
  }
}
