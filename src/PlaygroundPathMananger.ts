import * as vscode from "vscode";
import { OutputChannel } from "vscode";
import * as os from "os";
import path from "path";
import { getConfigSettings } from "./config";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";


export class PlaygroundPathMananger {
  private static instance: PlaygroundPathMananger | null;
  public channel: PlaygroundOutputChannel | null = null;
  public extensionName = "csharp-playground";
  public homeDir = os.homedir();
  public extensionDirName = `.csharp_playground`;
  public analyzerServerDirPath = path.resolve(
    path.join(this.homeDir, this.extensionDirName, "analyzer")
  );
  public analyzerServerFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "Program.cs")
  );
  public analyzerServerCsProjFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "analyzer.csproj")
  );
  public playgroundDirPath = path.resolve(
    path.join(this.homeDir, this.extensionDirName, "playground")
  );
  public playgroundDirUri = vscode.Uri.file(this.playgroundDirPath);
  public playgroundFilePath = path.resolve(
    path.join(this.playgroundDirPath, "Program.cs")
  );
  public maxServerRetries = 30;
  public analyzerServerTerminalName = "Analyzer-runner";
  public playgorundRunnerTerminalName = "Playground-runner";
  public platform = os.platform();
  public shell = this.platform === "win32" ? "powershell.exe" : "/bin/bash";
  public analyzerServerAddress = "";
  public hubAddress = "";
  public analyzerServerCsProjResourcePath: string = "";
  public analyzerServerResourcePath: string = "";
  public analyzerWelcomeMessageResourcePath: string = "";
  public analyzerServerStatusAddress: string = "";

  private constructor() {}

  public static getInstance(
    context: vscode.ExtensionContext,
    channel: PlaygroundOutputChannel
  ) : PlaygroundPathMananger {
    if (!this.instance) {
      this.instance = new PlaygroundPathMananger();
      this.instance.channel = channel;

      this.instance.analyzerServerCsProjResourcePath = path.resolve(
        path.join(
          context.extensionPath,
          "resources",
          "AnalyzerServerCsProjFile.txt"
        )
      );
      this.instance.analyzerServerResourcePath = path.resolve(
        path.join(context.extensionPath, "resources", "AnalyzerServer.cs")
      );
      this.instance.analyzerWelcomeMessageResourcePath = path.resolve(
        path.join(context.extensionPath, "resources", "WelcomeMessage.cs")
      );

    }
     return this.instance;
  }

  public static dispose() {
    this.instance = null;
  }
}
