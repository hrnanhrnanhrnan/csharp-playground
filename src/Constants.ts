import * as os from "os";

export const publisher = "hrnan";
export const extensionName = "csharp-playground";
export const extensionDirName = `.csharp_playground`;
export const maxServerRetries = 15;
export const playgroundRunnerTerminalName = "Playground-runner";
export const platform = os.platform();
export const shell = platform === "win32" ? "powershell.exe" : "/bin/bash";
export const runPlaygroundCommandFiredKey = "runPlaygroundCommandFired";