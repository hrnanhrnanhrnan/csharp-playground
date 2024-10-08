// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as signalR from "@microsoft/signalr";
import { extensionName } from "./Constants";
import { PlaygroundRunner } from "./PlaygroundRunner";
import { equalPaths } from "./utils";

let isDotnetInstalled = false;
let channel: vscode.OutputChannel | undefined;
let playgroundRunner: PlaygroundRunner | undefined;

export async function deactivate() {
  await playgroundRunner?.shutdown(true);
}

export async function activate(context: vscode.ExtensionContext) {
  console.log(`The "${extensionName}" extension is now active!`);

  // Setup output channel
  channel = vscode.window.createOutputChannel(extensionName);

  playgroundRunner = new PlaygroundRunner(context, channel);

  isDotnetInstalled = await playgroundRunner.isDotnetAvailable();
  if (!isDotnetInstalled) {
    playgroundRunner.alertUser(
      `Cant find that the .NET SDK is installed or that PATH is accessible. 
      Make sure that the .NET SDK is installed and that dotnet is added to PATH`,
      "error"
    );
  }

  await playgroundRunner.setupAnalyzerClient(context);

  const stopDisposable = vscode.commands.registerCommand(
    `${extensionName}.stop`,
    stopCommand
  );

  const playDisposable = vscode.commands.registerCommand(
    `${extensionName}.play`,
    playCommand
  );

  context.subscriptions.push(stopDisposable);
  context.subscriptions.push(playDisposable);
}

async function stopCommand() {
  return playgroundRunner!.shutdown();
}

async function playCommand() {
  if (!isDotnetInstalled) {
    playgroundRunner!.alertUser(
      "Cant find that .NET SDK is installed or that PATH is accessible. Have you recently installed, try to reload vscode",
      "error"
    );
    return;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: `${extensionName}: Play -> `,
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        playgroundRunner!.shutdown();
      });

      if (!playgroundRunner) {
        return;
      }

      await playgroundRunner.refreshPlaygroundState();

      progress.report({ message: "Setting up the playgorund..." });

      if (!(await playgroundRunner.createCsharp())) {
        playgroundRunner.alertUser(
          "It went wrong creating the project, look in output",
          "error"
        );
        return;
      }

      progress.report({ message: "Setting up the analyzer server..." });

      if (
        !(await playgroundRunner.tryCreateAnalyzerServer())
      ) {
        playgroundRunner.alertUser(
          `Something went wrong trying to create analyzer server, check output for more information`,
          "error"
        );

        return;
      }

      playgroundRunner.setupAndRunTerminals();

      progress.report({ message: "Waiting for analyzer server..." });

      const isServerReadyPromise = playgroundRunner.waitForAnalyzerServerReady(token);

      const { error, document } = await playgroundRunner.openTextDocument(playgroundRunner.pathManager.playgroundFilePath);
      if (error) {
        playgroundRunner.alertUser("It went wrong opening the file, look in output", "error");
        return;
      }

      const isServerReady = await isServerReadyPromise;
      if (!isServerReady) {
        playgroundRunner.disposeTerminals();
        playgroundRunner.alertUser(
          `Could not start Analyzer server, check output for more information`,
          "error"
        );

        return;
      }

      if (
        playgroundRunner.getActiveConnectionState() === signalR.HubConnectionState.Disconnected &&
        !(await playgroundRunner.tryStartAanalyzerHubConnection())
      ) {
        await playgroundRunner.shutdown();
        playgroundRunner.alertUser(
          `Something went wrong trying to connect to analyzer server, check output for more information`,
          "error"
        );
        return;
      }

      progress.report({ message: "Setting up workspace..." });

      if (!playgroundRunner.isPlaygroundInWorkspace()) {
        playgroundRunner.addPlaygroundToWorkspace();
      }

      playgroundRunner.alertUser(
        `Succesfully created and launched a playground at ${playgroundRunner.pathManager.playgroundFilePath}`,
        "success"
      );
    }
  );
}

vscode.workspace.onDidSaveTextDocument(async (document) => {
  if (!equalPaths(document.uri.fsPath, playgroundRunner?.pathManager.playgroundFilePath ?? "")) {
    return;
  }

  await playgroundRunner?.analyzeCode(document);
});