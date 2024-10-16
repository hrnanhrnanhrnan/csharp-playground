import { workspace } from "vscode";
import { extensionName } from "./constants";

export function getConfigSettings(): ConfigSettings {
  const config = workspace.getConfiguration(extensionName);

  return {
    dotnetVersion: config.get<number>("dotnetVersion"),
  };
}