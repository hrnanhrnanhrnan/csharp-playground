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

export async function runExecCommand(
  command: string,
  cwd: string,
  channel: PlaygroundOutputChannel
): Promise<Result<string>> {
  return tryCatch(
    async () => {
      const { stdout, stderr } = await execPromise(command, {
        cwd,
        shell: shell,
      });

      if (stderr) {
        throw new Error(
          stderr ?? `Unknown error when running command: "${command}"`
        );
      }

      return stdout;
    },
    (error) =>
      channel.printErrorToChannel(
        `Following error occurred when running command "${command}`,
        error
      )
  );
}

export async function tryCatch<T>(
  promise: Promise<T> | (() => Promise<T>),
  errorCallback?: (error: Error) => void,
  finallyCallback?: () => void
): Promise<Result<T>> {
  try {
    const result =
      typeof promise === "function" ? await promise() : await promise;
    return [undefined, result];
  } catch (error) {
    const typedError = (error as Error) ?? new Error(String(error));

    if (errorCallback) {
      errorCallback(typedError);
    }

    return [typedError];
  }
  finally{
    if (finallyCallback) {
      finallyCallback();
    }
  }
}
