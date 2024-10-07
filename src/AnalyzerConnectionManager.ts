import * as signalR from "@microsoft/signalr";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { OutputChannel } from "vscode";

export class AnalyzerConnectionManager {
  private static instance: signalR.HubConnection | null;
  private static inlayHintsProvider: PlaygroundInlayHintsProvider | null = null;
  private static channel: OutputChannel | null = null;

  public static setInlayHintsProvider(
    inlayhintsProvider: PlaygroundInlayHintsProvider
  ) {
    this.inlayHintsProvider = inlayhintsProvider;
  }
  public static setOutputChannel(
    channel: OutputChannel
  ) {
    this.channel = channel;
  }

  public static getConnection(serverAddress: string) {
    if (!this.instance) {
      this.instance = new signalR.HubConnectionBuilder()
        .withUrl(serverAddress)
        .withAutomaticReconnect()
        .configureLogging(signalR.LogLevel.Debug)
        .build();

      this.instance.on("AnalyzedData", (data) => {
        const analyzerData = JSON.parse(data);
        this.inlayHintsProvider?.setData(analyzerData);
      });

      this.instance.onreconnecting((error) => {
        this.channel?.appendLine(`Connection trying to reconnect to ${this.instance?.baseUrl}.`);
        if (error) {
          this.channel?.appendLine(`Error on reconnecting: ${error}`);
        }
      });

      this.instance.onreconnected((connectionId) => {
        this.channel?.appendLine(
          `Connection has reconnected to ${this.instance?.baseUrl}. Connection ID: ${connectionId}`
        );
      });

      this.instance.onclose((error) => {
        this.channel?.appendLine(`Connection closed to ${this.instance?.baseUrl}.`);
        if (error) {
          this.channel?.appendLine(`Error on close: ${error}`);
        }
        setTimeout(async () => await this.instance?.start(), 5000);
      });

      return this.instance;
    }

    this.instance.baseUrl = serverAddress;
    return this.instance;
  }

  public static stopConnection() {
    return this.instance?.stop() || Promise.resolve();
  }

  public static dispose() {
    this.instance = null;
  }
}