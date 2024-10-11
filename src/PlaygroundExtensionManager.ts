import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import { extensionName } from "./constants";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { execPromise, runExecCommand } from "./utils";

export class PlaygroundExtensionManager {
  private extensionId = `hrnan.${extensionName}`;
  private extensionVersionKey = `${extensionName}.extensionVersion`;
  private context: ExtensionContext;
  public isDotnetInstalled = false;

  private constructor(
    context: ExtensionContext,
  ) {
    this.context = context;
  }

  static async createInstance(
    context: ExtensionContext,
    channel: PlaygroundOutputChannel
  ) {
    const instance = new PlaygroundExtensionManager(context);
    instance.isDotnetInstalled = await instance.checkIfDotnetInstalled(channel);

    return instance;
  }

  private async checkIfDotnetInstalled(channel: PlaygroundOutputChannel) {
    try {
      channel.appendLine(
        "Checking that .NET SDK is installed and that PATH is accessible"
      );

      execPromise("dotnet --version");
    } catch (error) {
      channel.printErrorToChannel(
        "Cant find that the .NET SDK is installed or that PATH is accessible",
        error
      );
      return false;
    }

    return true;
  }

  isUpdated() {
    if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
      return false;
    }

    const currentVersion = vscode.extensions.getExtension(this.extensionId)
      ?.packageJSON.version;
    const previousVersion = this.context.globalState.get(
      this.extensionVersionKey
    );

    if (currentVersion === previousVersion) {
      return false;
    }

    this.context.globalState.update(this.extensionVersionKey, currentVersion);
    return true;
  }
}
