import { TimeT } from "./chartTypes";


export interface PhiraExtraJson {
    bpm: PhiraBpmSegment[];
    effects: PhiraEffect[];
    videos: PhiraVideo[];
}

export interface PhiraBpmSegment {
    time: TimeT;
    bpm: number;
}

export type PhiraAnimVarESType = number | [number, number, number, number] | [number, number];

export type PhiraAnimVar<T extends PhiraAnimVarESType> = T | PhiraAnimVarEvent<T>[];

export interface PhiraAnimVarEvent<T extends PhiraAnimVarESType> {
    start: T;
    end: T;
    startTime: TimeT;
    endTime: TimeT;
    easingType: number;
    easingLeft: number;
    easingRight: number;
}

export interface PhiraEffect {
    start: TimeT;
    end: TimeT;
    shader: string;
    vars: { [name: string]: PhiraAnimVar<PhiraAnimVarESType> }
}

export interface PhiraVideo {
    path: string;
    time: TimeT;
    scale: "cropCenter" | "inside" | "fit";
    alpha: number;
    dim: number;
}



