import * as vscode from 'vscode';

export class PlaygroundOutputChannel {
    private channel: vscode.OutputChannel;

    constructor(channelName: string) {
        this.channel = vscode.window.createOutputChannel(channelName);
    }

  printErrorToChannel(message: string, error: unknown) {
    this.channel.appendLine(
      `${message}: ${(error as Error)?.message ?? error}`
    );
  }

  appendLine(message: string) {
    this.channel.appendLine(message);
  }

    clear(): void {
        this.channel.clear();
    }

    show(preserveFocus?: boolean): void {
        this.channel.show(preserveFocus);
    }

    dispose(): void {
        this.channel.dispose();
    }
}
