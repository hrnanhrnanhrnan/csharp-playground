import * as os from "os";

export const extensionName = "csharp-playground";
export const extensionDirName = `.csharp_playground`;
export const maxServerRetries = 30;
export const playgroundRunnerTerminalName = "Playground-runner";
export const defaultPort = 5140;
export const platform = os.platform();
export const shell = platform === "win32" ? "powershell.exe" : "/bin/bash";