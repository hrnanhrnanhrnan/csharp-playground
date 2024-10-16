import * as vscode from "vscode";
import { getConfigSettings } from "./config";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { Server } from "net";
import { extensionName, shell } from "./constants";

export class AnalyzerServerManager {
  private context: vscode.ExtensionContext;
  private inlayHintsProvider: PlaygroundInlayHintsProvider;
  private channel: PlaygroundOutputChannel;
  public serverBaseUrl: string | undefined;
  public serverAnalyzeUrl: string | undefined;
  public serverStatusUrl: string | undefined;
  private analyzerServerTerminalName = "Analyzer-runner";
  private savedPortKey = `${extensionName}.savedPort`;
  private serverDirPath: string;
  private localHost = "http://localhost";
  private serverStatusPath = "/alive";
  private serverAnalyzePath = "/analyze";
  private debugDefaultPort = 5041;
  private minPort = 5000;
  private maxPort = 5040;

  private constructor(
    context: vscode.ExtensionContext,
    serverDirPath: string,
    inlayHintsProvider: PlaygroundInlayHintsProvider,
    channel: PlaygroundOutputChannel
  ) {
    this.context = context;
    this.inlayHintsProvider = inlayHintsProvider;
    this.channel = channel;
    this.serverDirPath = serverDirPath;
  }

  static async createInstance(
    context: vscode.ExtensionContext,
    serverDirPath: string,
    inlayHintsProvider: PlaygroundInlayHintsProvider,
    channel: PlaygroundOutputChannel
  ) {
    const instance = new AnalyzerServerManager(
      context,
      serverDirPath,
      inlayHintsProvider,
      channel
    );
    await instance.setLatestServerAddress();

    return instance;
  }

  private async setLatestServerAddress() {
    const { serverBaseUrl, serverAnalyzeUrl, serverStatusUrl } =
      await this.getAnalyzerServerEndpoints();
    this.serverBaseUrl = serverBaseUrl;
    this.serverAnalyzeUrl = serverAnalyzeUrl;
    this.serverStatusUrl = serverStatusUrl;
  }

  async runServerInTerminal(): Promise<vscode.Terminal> {
    await this.setLatestServerAddress();
    const analyzerServerTerminal = vscode.window.createTerminal({
      name: this.analyzerServerTerminalName,
      cwd: this.serverDirPath,
      shellPath: shell,
    });

    analyzerServerTerminal.sendText(
      `dotnet run -c Release --urls ${this.serverBaseUrl} `
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
      const response = await fetch(this.serverAnalyzeUrl!, {
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
    return this.isAnalyzerServerAlive(this.serverStatusUrl ?? "");
  }

  private async isAnalyzerServerAlive(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(endpoint);

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

  private async getAnalyzerServerEndpoints() {
    const serverBaseUrl = await this.getAnalyserServerBaseUrl();
    const serverAnalyzeUrl = this.buildServerAnalyzeUrl(serverBaseUrl);
    const serverStatusUrl = this.buildServerStatusUrl(serverBaseUrl);

    return { serverBaseUrl, serverAnalyzeUrl, serverStatusUrl };
  }

  private async getAnalyserServerBaseUrl() {
    if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
      return this.buildServerBaseUrl(this.debugDefaultPort);
    }

    const savedPort = this.context.globalState.get<number>(this.savedPortKey);

    if (
      savedPort &&
      (await this.isAnalyzerServerAlive(
        this.buildServerStatusUrl(this.buildServerBaseUrl(savedPort))
      ))
    ) {
      console.log(`analyzer server is alive at savedport: ${savedPort}`);
      return this.buildServerBaseUrl(savedPort);
    }

    const [availablePort, error] = await this.getAvaiablePort();
    const newPort = availablePort ?? this.debugDefaultPort;
    this.context.globalState.update(this.savedPortKey, newPort);

    if (error) {
      this.channel.printErrorToChannel(
        `Could not find available port, will fallback to use debugPort ${this.debugDefaultPort}. 
        Following error occured when trying to fetch available port.`,
        error
      );
    }

    return this.buildServerBaseUrl(newPort);
  }

  private async getAvaiablePort(): Promise<Result<number>> {
    return new Promise<Result<number>>((resolve, reject) => {
      const checkPortAvailable = (portToCheck: number) => {
        const server = new Server();
        let timeoutFunc: NodeJS.Timeout;

        server.once("error", (error: NodeJS.ErrnoException) => {
          clearTimeout(timeoutFunc);
          server.close();

          if (error.code !== "EADDRINUSE") {
            return [null, new Error(`Unknown error occured: ${error}`)];
          }

          const nextPortToTry = portToCheck + 1;

          if (nextPortToTry > this.maxPort) {
            return [null, new Error("All ports are occupied")];
          }

          return checkPortAvailable(nextPortToTry);
        });

        server.once("listening", () => {
          clearTimeout(timeoutFunc);
          server.close();
          resolve([portToCheck, null]); // Porten är tillgänglig
        });

        server.listen(portToCheck, "127.0.0.1");

        timeoutFunc = setTimeout(() => {
          server.close();
          reject(
            new Error(
              `Timeout when checking that port ${portToCheck} is available`
            )
          );
        }, 3000);
      };

      checkPortAvailable(this.minPort);
    });
  }

  private buildServerBaseUrl(port: number) {
    return `${this.localHost}:${port}`;
  }

  private buildServerStatusUrl(serverBaseUrl: string) {
    return `${serverBaseUrl}${this.serverStatusPath}`;
  }

  private buildServerAnalyzeUrl(serverBaseUrl: string) {
    return `${serverBaseUrl}${this.serverAnalyzePath}`;
  }
}
