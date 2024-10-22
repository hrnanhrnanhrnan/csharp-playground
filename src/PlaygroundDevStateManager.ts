export class PlaygroundDevStateManager implements IPlaygroundStateManager {
    private readonly defaultState: PlaygroundState = {
        playgroundStarted: false,
        typeOfPlayground: undefined
    };
    private currentState: PlaygroundState = this.defaultState;

    async getState():  Promise<PlaygroundState> {
        return this.currentState;
    }

    async updateState(updatedState: PlaygroundState):  Promise<boolean> {
        this.currentState = updatedState;
        return true;
    }

    async resetState() {
        this.currentState = this.defaultState;
    }
}