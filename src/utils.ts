import path from "path";
import { extensionName, platform } from "./constants";
import * as vscode from "vscode";

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
