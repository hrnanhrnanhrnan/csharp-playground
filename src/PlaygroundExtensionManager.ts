import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import { extensionName } from "./constants";

export class PlaygroundExtensionManager {
    private extensionId = `hrnan.${extensionName}`;
    private extensionVersionKey = `${extensionName}.extensionVersion`;
    private context: ExtensionContext;

// TODO: implement factorymethod
    constructor(context: ExtensionContext) {
        this.context = context;
    }

    isUpdated() {
        if (this.context.extensionMode !== vscode.ExtensionMode.Production) {
            return false;
        }

        const currentVersion = vscode.extensions.getExtension(this.extensionId)?.packageJSON.version;
        const previousVersion = this.context.globalState.get(this.extensionVersionKey);

        if (currentVersion === previousVersion) {
            return false;
        }

        this.context.globalState.update(this.extensionVersionKey, currentVersion);
        return true;
    }
}