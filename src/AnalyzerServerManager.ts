import * as vscode from "vscode";
import { getConfigSettings } from "./config";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { shell } from "./constants";

export class AnalyzerServerManager {
  private inlayHintsProvider: PlaygroundInlayHintsProvider;
  private channel: PlaygroundOutputChannel;
  public serverAddress: string | undefined;
  public serverAnalyzeAddress: string | undefined;
  public serverStatusAddress: string | undefined;
  private analyzerServerTerminalName = "Analyzer-runner";
  private serverDirPath: string;

  constructor(
    serverDirPath: string,
    inlayHintsProvider: PlaygroundInlayHintsProvider,
    channel: PlaygroundOutputChannel
  ) {
    this.inlayHintsProvider = inlayHintsProvider;
    this.channel = channel;
    this.serverDirPath = serverDirPath;

    this.setLatestServerAddress();
  }

  private setLatestServerAddress() {
    const { serverAddress, serverAnalyzeAddress, serverStatusAddress } =
      this.getAnalyzerServerEndpoints();
    this.serverAddress = serverAddress;
    this.serverAnalyzeAddress = serverAnalyzeAddress;
    this.serverStatusAddress = serverStatusAddress;
  }

  runServerInTerminal(): vscode.Terminal {
    const analyzerServerTerminal = vscode.window.createTerminal({
      name: this.analyzerServerTerminalName,
      cwd: this.serverDirPath,
      shellPath: shell,
    });

    this.setLatestServerAddress();

    analyzerServerTerminal.sendText(
      `dotnet run -c Release --urls ${this.serverAddress} `
    );

    return analyzerServerTerminal;
  }

  disposeServer() {
    const terminal = vscode.window.terminals.find(
      (x) => x.name === this.analyzerServerTerminalName
    );

    if (!terminal) {
      return;
    }

    terminal.dispose();
  }

  async analyzeCode(code: string) {
    try {
      const payload = { code: code };
      const response = await fetch(this.serverAnalyzeAddress!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.log(`fetch failed: ${response.statusText}`);
        this.channel.appendLine(
          `Following error occurred trying to analyze the code: ${response.statusText}`
        );
      }
      const json = await response.json();
      this.inlayHintsProvider.setData(json);
    } catch (error) {
      console.log(`fetch failed: ${error}`);
      this.channel.printErrorToChannel(
        "Following error occurred trying to analyze the code",
        error
      );
    }
  }

  async isAnalyzerServerActive(): Promise<boolean> {
    try {
      const response = await fetch(this.serverStatusAddress!);

      if (!response.ok) {
        this.channel.appendLine(
          `Analyzer server responding with not ok. Message: ${await response.text()}`
        );
        return false;
      }
    } catch (error) {
      this.channel.printErrorToChannel(
        "Error occurred when trying to check if Analyzer server is alive",
        error
      );
      return false;
    }

    return true;
  }

  private getAnalyzerServerEndpoints() {
    const serverAddress = `http://localhost:${
      getConfigSettings().analyzerServerPort
    }`;
    const serverAnalyzeAddress = `${serverAddress}/analyze`;
    const serverStatusAddress = `${serverAddress}/alive`;

    return { serverAddress, serverAnalyzeAddress, serverStatusAddress };
  }
}
