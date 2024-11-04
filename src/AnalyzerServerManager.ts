import * as vscode from "vscode";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { Server } from "net";
import { shell } from "./constants";
import { tryCatchPromise } from "./utils";

export class AnalyzerServerManager {
  private readonly channel: PlaygroundOutputChannel;
  private readonly analyzerServerTerminalName = "Analyzer-runner";
  private readonly serverDirPath: string;
  private readonly localhostUrl = "http://localhost";
  private readonly localhostIp = "127.0.0.1";
  private readonly serverStatusPath = "/alive";
  private readonly serverAnalyzePath = "/analyze";
  private readonly debugDefaultPort = 5041;
  private readonly minPort = 5000;
  private readonly maxPort = 5040;
  private connectionDetails: AnalyzerServerConnectionDetails | undefined;
  private readonly _onCodeAnalyzed = new vscode.EventEmitter<
    AnalyzedCodeItem[]
  >();
  public readonly onCodeAnalyzed = this._onCodeAnalyzed.event;

  constructor(serverDirPath: string, channel: PlaygroundOutputChannel) {
    this.channel = channel;
    this.serverDirPath = serverDirPath;
    // Testing
  }

  async startServerInTerminal(): Promise<vscode.Terminal> {
    const { serverBaseUrl, serverAnalyzeUrl, serverStatusUrl } =
      await this.getAnalyzerServerEndpoints();

    this.connectionDetails = {
      serverBaseUrl,
      serverAnalyzeUrl,
      serverStatusUrl
    };

    const analyzerServerTerminal = vscode.window.createTerminal({
      name: this.analyzerServerTerminalName,
      cwd: this.serverDirPath,
      shellPath: shell
    });

    analyzerServerTerminal.sendText(
      `dotnet run -c Release --urls ${this.connectionDetails.serverBaseUrl} `
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

  dispose() {
    this._onCodeAnalyzed.dispose();
  }

  async analyzeCode(code: string) {
    return this.runAnalyzeCode(
      this.connectionDetails?.serverAnalyzeUrl ?? "",
      code
    );
  }

  async isAnalyzerServerAlive(): Promise<boolean> {
    const [error] = await this.runIsAnalyzerServerAlive(
      this.connectionDetails?.serverStatusUrl ?? ""
    );

    if (error) {
      this.channel.printErrorToChannel(
        "Following error occurred checking server is alive",
        error
      );
      return false;
    }

    return true;
  }

  private async runAnalyzeCode(endpoint: string, code: string) {
    return tryCatchPromise(async () => {
      const payload = { code: code };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(
          `Following error occurred trying to analyze the code: ${response.statusText}`
        );
      }

      const obj = await response.json();

      if (obj.error) {
        throw new Error(
          obj.error
        );
      }

      this._onCodeAnalyzed.fire(obj.analyzedCodeItems);
    });
  }

  private async runIsAnalyzerServerAlive(
    endpoint: string
  ): Promise<Result<void>> {
    return tryCatchPromise(async () => {
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(
          `Analyzer server responding with not ok. Message: ${await response.text()}`
        );
      }
    });
  }

  private async getAnalyzerServerEndpoints() {
    const serverBaseUrl = await this.getAnalyserServerBaseUrl();
    const serverAnalyzeUrl = this.buildServerAnalyzeUrl(serverBaseUrl);
    const serverStatusUrl = this.buildServerStatusUrl(serverBaseUrl);

    return { serverBaseUrl, serverAnalyzeUrl, serverStatusUrl };
  }

  private async getAnalyserServerBaseUrl() {
    const [error, availablePort] = await this.getAvaiablePort();

    if (error) {
      this.channel.printErrorToChannel(
        `Could not find available port, will fallback to use debugPort ${this.debugDefaultPort}. 
        Following error occured when trying to fetch available port.`,
        error
      );
    }

    return this.buildServerBaseUrl(availablePort ?? this.debugDefaultPort);
  }

  private async getAvaiablePort(): Promise<Result<number>> {
    return tryCatchPromise(async () => {
      return new Promise<number>((resolve, reject) => {
        const checkPortAvailable = (portToCheck: number) => {
          const server = new Server();
          let timeoutFunc: NodeJS.Timeout;

          server.once("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timeoutFunc);
            server.close();

            if (error.code !== "EADDRINUSE") {
              return [new Error(`Unknown error occured: ${error}`)];
            }

            const nextPortToTry = portToCheck + 1;

            if (nextPortToTry > this.maxPort) {
              return [new Error("All ports are occupied")];
            }

            return checkPortAvailable(nextPortToTry);
          });

          server.once("listening", () => {
            clearTimeout(timeoutFunc);
            server.close();
            resolve(portToCheck); // Porten är tillgänglig
          });

          server.listen(portToCheck, this.localhostIp);

          timeoutFunc = setTimeout(() => {
            server.close();
            return [
              new Error(
                `Timeout when checking that port ${portToCheck} is available`
              )
            ];
          }, 3000);
        };

        checkPortAvailable(this.minPort);
      });
    });
  }

  private buildServerBaseUrl(port: number) {
    return `${this.localhostUrl}:${port}`;
  }

  private buildServerStatusUrl(serverBaseUrl: string) {
    return `${serverBaseUrl}${this.serverStatusPath}`;
  }

  private buildServerAnalyzeUrl(serverBaseUrl: string) {
    return `${serverBaseUrl}${this.serverAnalyzePath}`;
  }
}
