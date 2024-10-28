import { readFile, writeFile } from "fs/promises";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import path from "path";
import { tryCatch } from "./utils";

export class PlaygroundProdStateManager implements IPlaygroundStateManager {
    private readonly channel: PlaygroundOutputChannel;
    private readonly stateFileName = "playgroundState.json";
    private readonly stateFilePath: string;
    private readonly defaultState: PlaygroundState = {
        playgroundStarted: false,
        typeOfPlayground: undefined
    };

    constructor(pathManager: PlaygroundPathMananger, channel: PlaygroundOutputChannel) {
        this.channel = channel;
        this.stateFilePath = path.resolve(path.join(pathManager.extensionDirPath, this.stateFileName));
    }

    async resetState() {
        await this.updateState(this.defaultState);
    }

    async getState():  Promise<PlaygroundState> {
        const [error, playgroundState] = await tryCatch(async () => {
            const data = await readFile(this.stateFilePath, { encoding: "utf8" } );
            return JSON.parse(data);
        });

        if (error) {
            this.channel.printErrorToChannel("Could not read state from file", error);
        }

        return playgroundState ?? this.defaultState;
    }

    async updateState(updatedState: PlaygroundState):  Promise<boolean> {
        const [error] = await tryCatch(writeFile(this.stateFilePath, JSON.stringify(updatedState), "utf8"));
        if (error) {
            this.channel.printErrorToChannel("Could not update state", error);
            return false;
        }

        return true;
    }
}