import { PlaygroundRunner } from "./PlaygroundRunner";
import * as vscode from "vscode";
import { alertUser } from "./utils";
import { extensionName } from "./constants";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";

export class PlaygroundCommandResolver {
  private newPlaygroundCommandName = `${extensionName}.newPlayground`;
  private continuePlaygroundCommandName = `${extensionName}.continuePlayground`;
  private stopPlaygroundCommandName = `${extensionName}.stopPlayground`;
  private playgroundRunner: PlaygroundRunner;
  private extensionManager: PlaygroundExtensionManager;

  constructor(
    playgroundRunner: PlaygroundRunner,
    extensionManager: PlaygroundExtensionManager
  ) {
    this.playgroundRunner = playgroundRunner;
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
    this.playgroundRunner.shutdown();
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

        this.playgroundRunner.clearPlayground();

        progress.report({ message: "Setting up the playgorund..." });

        if (type === "New" && !(await this.playgroundRunner.createCsharp())) {
          alertUser(
            "It went wrong creating the project, look in output",
            "error"
          );
          return;
        }

        progress.report({ message: "Setting up the analyzer server..." });

        if (!(await this.playgroundRunner.tryCreateAnalyzerServer())) {
          alertUser(
            `Something went wrong trying to create analyzer server, check output for more information`,
            "error"
          );

          return;
        }

        this.playgroundRunner.runPlaygroundInTerminal();

        progress.report({ message: "Waiting for analyzer server..." });

        const isServerReadyPromise =
          this.playgroundRunner.waitForAnalyzerServerReady(token);

        const { error, document } =
          await this.playgroundRunner.openTextDocument();
        if (error) {
          alertUser("It went wrong opening the file, look in output", "error");
          return;
        }

        const isServerReady = await isServerReadyPromise;
        if (!isServerReady) {
          this.playgroundRunner.disposeTerminals();
          alertUser(
            `Could not start Analyzer server, check output for more information`,
            "error"
          );

          return;
        }

        progress.report({ message: "Setting up workspace..." });

        if (!this.playgroundRunner.isPlaygroundInWorkspace()) {
          this.playgroundRunner.addPlaygroundToWorkspace();
        }

        alertUser(`Succesfully created and launched a playground`, "success");
      }
    );
  }
}
