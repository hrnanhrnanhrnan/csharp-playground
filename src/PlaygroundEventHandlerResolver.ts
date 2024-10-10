import * as vscode from "vscode";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { equalPaths } from "./utils";

export class PlaygroundEventHandlerResolver {
    private playgroundRunner: PlaygroundRunner;

    constructor(playgroundRunner: PlaygroundRunner) {
        this.playgroundRunner = playgroundRunner;
    }

    resolveEventHandlers() {
        this.registerOnDidSaveTextDocumentEventHandler();
    }

  private registerOnDidSaveTextDocumentEventHandler() {
    vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (
        !equalPaths(
        document.uri.fsPath,
        this.playgroundRunner.pathManager.playgroundFilePath ?? ""
        )
    ) {
        return;
    }

    await this.playgroundRunner.analyzeCode(document);
    });
  }
}