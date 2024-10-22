type AnalyzedDataItem = {
  line: string;
  value: string;
};

type ConfigSettings = {
    dotnetVersion?: number
}

type PlaygroundType = "New" | "Continue";

type Result<T> = [T, null] | [null, Error];

interface IPlaygroundStateManager {
    getState: () => Promise<PlaygroundState>
    updateState: (updatedState: PlaygroundState) => Promise<boolean>
    resetState: () => Promise<void>
}

type PlaygroundState = {
    playgroundStarted: boolean
    typeOfPlayground?: PlaygroundType
}

type AnalyzerServerConnectionDetails = {
  serverBaseUrl: string;
  serverAnalyzeUrl: string;
  serverStatusUrl: string;
}