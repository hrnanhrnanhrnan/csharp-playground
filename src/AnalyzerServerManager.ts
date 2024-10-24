import * as vscode from "vscode";
import { PlaygroundInlayHintsProvider } from "./PlaygroundInlayHintsProvider";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import { Server } from "net";
import { shell } from "./constants";
import { tryCatch } from "./utils";

export class AnalyzerServerManager {
  private context: vscode.ExtensionContext;
  private inlayHintsProvider: PlaygroundInlayHintsProvider;
  private channel: PlaygroundOutputChannel;
  private connectionDetails: AnalyzerServerConnectionDetails | undefined;
  private analyzerServerTerminalName = "Analyzer-runner";
  private serverDirPath: string;
  private localHost = "http://localhost";
  private serverStatusPath = "/alive";
  private serverAnalyzePath = "/analyze";
  private debugDefaultPort = 5041;
  private minPort = 5000;
  private maxPort = 5040;

  constructor(
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

  async startServerInTerminal(): Promise<vscode.Terminal> {
    const { serverBaseUrl, serverAnalyzeUrl, serverStatusUrl } =
      await this.getAnalyzerServerEndpoints();

    this.connectionDetails = {
      serverBaseUrl,
      serverAnalyzeUrl,
      serverStatusUrl,
    };

    const analyzerServerTerminal = vscode.window.createTerminal({
      name: this.analyzerServerTerminalName,
      cwd: this.serverDirPath,
      shellPath: shell,
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

  private async runAnalyzeCode(endpoint: string, code: string) {
    return tryCatch(async () => {
      const payload = { code: code };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Following error occurred trying to analyze the code: ${response.statusText}`
        );
      }

      const json = await response.json();
      this.inlayHintsProvider.setData(json);
    });
  }

  async analyzeCode(code: string) {
    return this.runAnalyzeCode(this.connectionDetails?.serverAnalyzeUrl ?? "", code);
  }

  async isAnalyzerServerAlive(): Promise<boolean> {
    const [error] = await this.runIsAnalyzerServerAlive(
      this.connectionDetails?.serverStatusUrl ?? ""
    );

    if (error) {
      this.channel.printErrorToChannel("Following error occurred checking server is alive", error);
      return false;
    }

    return true;
  }

  private async runIsAnalyzerServerAlive(
    endpoint: string
  ): Promise<Result<void>> {
    return tryCatch(
      async () => {
        const response = await fetch(endpoint);

        if (!response.ok) {
          throw new Error(`Analyzer server responding with not ok. Message: ${await response.text()}`);
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
    if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
      return this.buildServerBaseUrl(this.debugDefaultPort);
    }

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
    return tryCatch(async () => {
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
  
          server.listen(portToCheck, "127.0.0.1");
  
          timeoutFunc = setTimeout(() => {
            server.close();
            return [
              new Error(
                `Timeout when checking that port ${portToCheck} is available`
              ),
            ];
          }, 3000);
        };
  
        checkPortAvailable(this.minPort);
      });
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
