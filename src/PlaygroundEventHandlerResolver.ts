import * as vscode from "vscode";

import { equalPaths } from "./utils";
import { PlaygroundManager } from "./PlaygroundManager";

export class PlaygroundEventHandlerResolver {
    private playgroundManager: PlaygroundManager;

    constructor(playgroundManager: PlaygroundManager) {
        this.playgroundManager = playgroundManager;
    }

    resolveEventHandlers() {
        this.registerOnDidSaveTextDocumentEventHandler();
    }

  private registerOnDidSaveTextDocumentEventHandler() {
    vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (
        !equalPaths(
        document.uri.fsPath,
        this.playgroundManager.pathManager.playgroundFilePath ?? ""
        )
    ) {
        return;
    }

    return this.playgroundManager.analyzeCode(document);
    });
  }
}