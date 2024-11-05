import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { runExecCommand, tryCatch } from "./utils";
import { extensionName, publisher } from "./constants";

export class PlaygroundExtensionManager {
  private readonly extensionId = `${publisher}.${extensionName}`;
  private readonly extensionVersionKey = `${extensionName}.extensionVersion`;
  private readonly context: ExtensionContext;
  private readonly currentExtensionVersion: string;
  public readonly isDotnetInstalled: boolean;
  public readonly installedDotnetVersions: Record<number, string>;
  public readonly isProduction: boolean;

  private constructor(
    context: ExtensionContext,
    installedDotnetVersions: Record<number, string>
  ) {
    this.context = context;
    this.installedDotnetVersions = installedDotnetVersions;
    this.isDotnetInstalled = Object.keys(installedDotnetVersions).length > 0;
    this.isProduction =
      context.extensionMode === vscode.ExtensionMode.Production;
    this.currentExtensionVersion =
      vscode.extensions.getExtension(this.extensionId)?.packageJSON.version ??
      "";
  }

  static async createInstance(
    context: ExtensionContext,
    channel: PlaygroundOutputChannel
  ) {
    const versions = await this.getInstalledDotnetVersions(channel);
    const installedDotnetVersions =
      this.createInstalledDotnetVersionsRecord(versions);
    const instance = new PlaygroundExtensionManager(
      context,
      installedDotnetVersions
    );

    return instance;
  }

  isUpdated() {
    if (!this.isProduction) {
      return false;
    }

    const previousVersion: string =
      this.context.globalState.get(this.extensionVersionKey) ?? "";

    return this.currentExtensionVersion !== previousVersion;
  }

  updateVersionInGlobalStorage() {
    const previousVersion: string =
      this.context.globalState.get(this.extensionVersionKey) ?? "";

    if (previousVersion === this.currentExtensionVersion) {
      return;
    }

    this.context.globalState.update(
      this.extensionVersionKey,
      this.currentExtensionVersion
    );
  }

  private static createInstalledDotnetVersionsRecord(
    versions: number[]
  ): Record<number, string> {
    const installedVersions: Record<number, string> = {};
    for (let index = 0; index < versions.length; index++) {
      const version = versions[index];
      installedVersions[version] = this.getDotnetVersionAsString(version);
    }

    return installedVersions;
  }

  private static getDotnetVersionAsString(version: number) {
    return `net${version}.0`;
  }

  private static async getInstalledDotnetVersions(
    channel: PlaygroundOutputChannel
  ): Promise<number[]> {
    channel.appendLine(
      "Checking that a .NET SDK is installed and that PATH is accessible"
    );
    const [listSdksError, out] = await runExecCommand(
      "dotnet --list-sdks",
      "",
      channel
    );

    if (listSdksError) {
      channel.printErrorToChannel(
        "Following error occurred trying to list .NET SDKS's",
        listSdksError
      );
      return [];
    }

    const [parseSdksError, versions] = tryCatch(() => {
      const lines = out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      const versions = lines.map((line) =>
        parseInt(line.length > 0 ? line[0] : "")
      );
      return versions.filter((v) => !isNaN(v));
    });

    if (parseSdksError) {
      channel.printErrorToChannel("Following error occurred trying to parse SDK's", parseSdksError);
      return [];
    }

    return versions;
  }
}
