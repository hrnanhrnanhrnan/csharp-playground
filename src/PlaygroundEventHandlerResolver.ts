import * as vscode from "vscode";

import { equalPaths } from "./utils";
import { PlaygroundManager } from "./PlaygroundManager";
import { runPlaygroundCommandFiredKey } from "./constants";
import { PlaygroundRunner } from "./PlaygroundRunner";

export class PlaygroundEventHandlerResolver {
    private playgroundManager: PlaygroundManager;
    private playgroundRunner: PlaygroundRunner;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, playgroundManager: PlaygroundManager, playgroundRunner: PlaygroundRunner) {
        this.context = context;
        this.playgroundManager = playgroundManager;
        this.playgroundRunner = playgroundRunner;
    }

    resolveEventHandlers() {
        this.registerOnDidSaveTextDocumentEventHandler();
        this.registerOnDidChangeWindowStateEventHandler();
    }

    private registerOnDidChangeWindowStateEventHandler() {
        vscode.window.onDidChangeWindowState(async state => {
            const [playgroundStarted, type] = await this.playgroundRunner.isPlaygroundRequestedOnActivation();

            if (!playgroundStarted) {
                return;
            }

            this.playgroundRunner.startPlayground(type ?? "New");
        });
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