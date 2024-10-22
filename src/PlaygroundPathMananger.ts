import * as vscode from "vscode";
import * as os from "os";
import path from "path";

export class PlaygroundPathMananger {
  private static instance: PlaygroundPathMananger | null;
  public homeDir = os.homedir();
  public extensionDirName = `.csharp_playground`;
  public extensionDirPath = path.resolve(
    path.join(this.homeDir, this.extensionDirName)
  );
  public analyzerServerDirPath = path.resolve(
    path.join(this.extensionDirPath, "analyzer")
  );
  public analyzerServerFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "Program.cs")
  );
  public analyzerServerCsProjFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "analyzer.csproj")
  );
  public playgroundDirPath = path.resolve(
    path.join(this.extensionDirPath, "playground")
  );
  public playgroundDirUri = vscode.Uri.file(this.playgroundDirPath);
  public playgroundFilePath = path.resolve(
    path.join(this.playgroundDirPath, "Program.cs")
  );
  public analyzerServerCsProjResourcePath: string = "";
  public analyzerServerResourcePath: string = "";
  public analyzerWelcomeMessageResourcePath: string = "";
  public playgroundInitalizationFilePath: string = "";
  public analyzerServerStatusAddress: string = "";

  private constructor() {}

  public static getInstance(
    context: vscode.ExtensionContext,
  ) : PlaygroundPathMananger {
    if (!this.instance) {
      this.instance = new PlaygroundPathMananger();

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
      this.instance.playgroundInitalizationFilePath = path.resolve(
        path.join(context.extensionPath, "resources", ".playground")
      );

    }
     return this.instance;
  }

  public static dispose() {
    this.instance = null;
  }
}
