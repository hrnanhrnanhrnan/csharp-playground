import { extensionName, defaultPort } from "./Constants";
import { workspace } from "vscode";

export function getConfigSettings(): ConfigSettings {
  const config = workspace.getConfiguration(extensionName);

  return {
    analyzerServerPort: config.get<number>("analyzerServerPort") ?? defaultPort,
  };
}