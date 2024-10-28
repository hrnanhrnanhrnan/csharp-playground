import * as vscode from "vscode";
import { extensionName } from "./constants";
import { PlaygroundRunner } from "./PlaygroundRunner";

export class PlaygroundCommandResolver {
  private readonly newPlaygroundCommandName = `${extensionName}.newPlayground`;
  private readonly continuePlaygroundCommandName = `${extensionName}.continuePlayground`;
  private readonly stopPlaygroundCommandName = `${extensionName}.stopPlayground`;
  private readonly playgroundRunner: PlaygroundRunner;

  constructor(playgroundRunner: PlaygroundRunner) {
    this.playgroundRunner = playgroundRunner;
  }

  async resolveRegisterCommands() {
    return [
      this.registerNewPlaygroundCommand(),
      this.registerContinuePlaygroundCommand(),
      this.registerStopPlaygroundCommand(),
    ];
  }

  private registerNewPlaygroundCommand() {
    return vscode.commands.registerCommand(
      this.newPlaygroundCommandName,
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
