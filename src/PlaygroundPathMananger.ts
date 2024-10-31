import * as vscode from "vscode";
import * as os from "os";
import path from "path";

export class PlaygroundPathMananger {
  private static instance: PlaygroundPathMananger | null;
  public readonly homeDir = os.homedir();
  public readonly extensionDirName = `.csharp_playground`;
  public readonly extensionDirPath = path.resolve(
    path.join(this.homeDir, this.extensionDirName)
  );
  public readonly analyzerServerDirPath = path.resolve(
    path.join(this.extensionDirPath, "analyzer")
  );
  public readonly analyzerServerFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "Program.cs")
  );
  public readonly analyzerServerCsProjFilePath = path.resolve(
    path.join(this.analyzerServerDirPath, "analyzer.csproj")
  );
  public readonly playgroundDirPath = path.resolve(
    path.join(this.extensionDirPath, "playground")
  );
  public readonly playgroundDirUri = vscode.Uri.file(this.playgroundDirPath);
  public readonly playgroundProgramFilePath = path.resolve(
    path.join(this.playgroundDirPath, "Program.cs")
  );
  public readonly playgroundProgramFileUri = vscode.Uri.file(
    this.playgroundProgramFilePath
  );
  public readonly playgroundInitalizationFilePath = path.resolve(
    path.join(this.playgroundDirPath, ".playground")
  );
  public readonly analyzerServerCsProjResourcePath: string;
  public readonly analyzerServerResourcePath: string;
  public readonly playgroundWelcomeMessageResourcePath: string;
  public readonly playgroundInitalizationResourceFilePath: string;

  private constructor(context: vscode.ExtensionContext) {
    this.analyzerServerCsProjResourcePath = path.resolve(
      path.join(
        context.extensionPath,
        "resources",
        "AnalyzerServerCsProjFile.txt"
      )
    );
    this.analyzerServerResourcePath = path.resolve(
      path.join(context.extensionPath, "resources", "AnalyzerServer.cs")
    );
    this.playgroundWelcomeMessageResourcePath = path.resolve(
      path.join(context.extensionPath, "resources", "WelcomeMessage.cs")
    );
    this.playgroundInitalizationResourceFilePath = path.resolve(
      path.join(context.extensionPath, "resources", ".playground")
    );
  }

  public static getInstance(
    context: vscode.ExtensionContext
  ): PlaygroundPathMananger {
    return this.instance ?? new PlaygroundPathMananger(context);
  }
}
