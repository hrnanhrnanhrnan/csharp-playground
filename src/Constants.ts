import * as os from "os";

export const publisher = "hrnan";
export const extensionName = "csharp-playground";
export const platform = os.platform();
export const shell = platform === "win32" ? "powershell.exe" : "/bin/bash";