import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { execPromise, runExecCommand } from "./utils";
import { extensionName, publisher } from "./constants";

export class PlaygroundExtensionManager {
  private extensionId = `${publisher}.${extensionName}`;
  private extensionVersionKey = `${extensionName}.extensionVersion`;
  private context: ExtensionContext;
  public isDotnetInstalled = false;
  public installedDotnetVersions: Record<number, string>;

  private constructor(
    context: ExtensionContext,
    installedDotnetVersions: Record<number, string>
  ) {
    this.context = context;
    this.installedDotnetVersions = installedDotnetVersions;
    this.isDotnetInstalled = Object.keys(installedDotnetVersions).length > 0;
  }

  static async createInstance(
    context: ExtensionContext,
    channel: PlaygroundOutputChannel
  ) {
    const versions = await this.getInstalledDotnetVersions(channel);
    const installedDotnetVersions = this.createInstalledDotnetVersionsRecord(versions);
    const instance = new PlaygroundExtensionManager(context, installedDotnetVersions);

    return instance;
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

  private static createInstalledDotnetVersionsRecord(versions: number[]) : Record<number, string> {
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

  private static async getInstalledDotnetVersions(channel: PlaygroundOutputChannel) : Promise<number[]> {
    channel.appendLine("Checking that .NET SDK is installed and that PATH is accessible");
    const [out, success] = await runExecCommand("dotnet --list-sdks", "", channel);

    if (!success) {
      channel.appendLine("Cant find that the .NET SDK is installed or that PATH is accessible");
      return [];
    }

    const lines = out.split("\n").map(line => line.trim()).filter(line => line !== "");
    const versions = lines.map(line => parseInt(line.length > 0 ? line[0] : ""));
    return versions.filter(v => !isNaN(v));
  }
}
