import type { Chart } from "./chart";
import { PhiraExtraJson } from "./extraTypes";

export class ExtraJsonCompiler {
    constructor(public chart: Chart) {
    }
    compile(): PhiraExtraJson {
        return {
            bpm: this.chart.timeCalculator.bpmSequence.dumpPhiraBPM(),
            effects: [],
            videos: []
        }
    }
}