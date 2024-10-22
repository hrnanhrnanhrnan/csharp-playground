import { PlaygroundManager } from "./PlaygroundManager";
import * as vscode from "vscode";
import { alertUser } from "./utils";
import { PlaygroundExtensionManager } from "./PlaygroundExtensionManager";
import { getConfigSettings } from "./config";
import { extensionName, runPlaygroundCommandFiredKey } from "./constants";
import { PlaygroundRunner } from "./PlaygroundRunner";

export class PlaygroundCommandResolver {
  private newPlaygroundCommandName = `${extensionName}.newPlayground`;
  private continuePlaygroundCommandName = `${extensionName}.continuePlayground`;
  private stopPlaygroundCommandName = `${extensionName}.stopPlayground`;
  private playgroundRunner: PlaygroundRunner;
  private extensionManager: PlaygroundExtensionManager;
  private context: vscode.ExtensionContext;

  constructor(
    context: vscode.ExtensionContext,
    playgroundRunner: PlaygroundRunner,
    extensionManager: PlaygroundExtensionManager
  ) {
    this.context = context;
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
    return vscode.commands.registerCommand(this.newPlaygroundCommandName,
      async () => await this.playgroundRunner.initializePlayground("New")
    );
  }

  private registerContinuePlaygroundCommand() {
    return vscode.commands.registerCommand(
      this.continuePlaygroundCommandName,
      async () => await this.playgroundRunner.initializePlayground("Continue")
    );
  }

  private registerStopPlaygroundCommand() {
    return vscode.commands.registerCommand(this.stopPlaygroundCommandName, () =>
      this.playgroundRunner.stopPlayground()
    );
  }
}
