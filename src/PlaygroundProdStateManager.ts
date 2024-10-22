import { readFile, writeFile } from "fs/promises";
import { PlaygroundPathMananger } from "./PlaygroundPathMananger";
import { PlaygroundOutputChannel } from "./PlaygroundOutputChannel";
import path from "path";

export class PlaygroundProdStateManager implements IPlaygroundStateManager {
    private channel: PlaygroundOutputChannel;
    private stateFileName = "playgroundState.json";
    private stateFilePath: string;
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
        let playgroundState = this.defaultState;
        try {
            const data = await readFile(this.stateFilePath, { encoding: "utf8" } );
            playgroundState = JSON.parse(data);
        } catch (error) {
            this.channel.printErrorToChannel("Could not read state from file", error);
        }

        return playgroundState;
    }

    async updateState(updatedState: PlaygroundState):  Promise<boolean> {
        try {
            await writeFile(this.stateFilePath, JSON.stringify(updatedState), "utf8");
        } catch (error) {
            this.channel.printErrorToChannel("Could not update state", error);
            return false;
        }

        return true;
    }
}