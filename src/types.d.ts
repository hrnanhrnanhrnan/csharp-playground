type AnalyzedDataItem = {
  line: string;
  value: string;
};

type ConfigSettings = {
    dotnetVersion?: number
}

type PlaygroundType = "New" | "Continue";

type Result<T> = [T, null] | [null, Error];