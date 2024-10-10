import * as vscode from "vscode";

export class PlaygroundInlayHintsProvider implements vscode.InlayHintsProvider {
  analyzerData: AnalyzedDataItem[] = [];

  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.InlayHint[]> {
    if (this.analyzerData.length === 0) {
      return;
    }

    const hints: vscode.InlayHint[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);

      const match = this.analyzerData.find(
        (x) => x.line.trim() === line.text.trim()
      );

      if (match) {
        const position = new vscode.Position(i, line.text.length);
        const value = JSON.stringify(match.value);
        const hint = new vscode.InlayHint(
          position,
          value,
          vscode.InlayHintKind.Type
        );
        hint.paddingLeft = hint.paddingRight = true;
        hint.tooltip = JSON.stringify(match.value, null, 4);

        hints.push(hint);
      }
    }

    return hints;
  }

  public setData(analyzerDataItems: AnalyzedDataItem[]) {
    this.analyzerData = analyzerDataItems;
    this._onDidChangeInlayHints.fire();
  }
}