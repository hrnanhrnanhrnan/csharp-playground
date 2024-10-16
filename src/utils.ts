import path from "path";
import { extensionName, platform, shell } from "./constants";
import * as vscode from "vscode";
import { promisify } from "util";
import { exec } from "child_process";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";

export const execPromise = promisify(exec);

export function equalPaths(firstPath: string, secondPath: string) {
  const firstPathNorm = path.resolve(firstPath);
  const secodPathNorm = path.resolve(secondPath);

  if (platform === "win32") {
    return firstPathNorm.toLowerCase() === secodPathNorm.toLowerCase();
  }

  return firstPathNorm === secodPathNorm;
}

  export function alertUser(message: string, type: "error" | "success") {
    const alertMessage = `${extensionName}: 
          ${message}`;

    if (type === "error") {
      vscode.window.showErrorMessage(alertMessage);
      return;
    }

    vscode.window.showInformationMessage(alertMessage);
  }

  export async function runExecCommand(command: string, cwd: string, channel: PlaygroundOutputChannel): Promise<[string, boolean]> {
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        shell: shell,
      });

      if (stdout) {
        channel.appendLine(stdout);
        return [stdout, true];
      }

      if (stderr) {
        channel.appendLine(stderr);
        return [stderr, false];
      }
    } catch (error) {
      channel.printErrorToChannel(
        `Error occurred when trying to run command "${command}"`,
        error
      );
      return [new Error(String(error)).message, false];
    }

    return ["", true];
  }