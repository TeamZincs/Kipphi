import { Chart } from "../chart";
import { Operation } from "./basic";

type ChartPropName = "name" | "level" | "composer" | "illustrator" | "charter" | "offset"

export class ChartPropChangeOperation<T extends ChartPropName> extends Operation {
    originalValue: Chart[T];
    constructor(public chart: Chart, public field: T, public value: Chart[T]) {
        super();
        this.originalValue = chart[field];
        if (field === "level" || field === "name") {
            this.updatesEditor = true;
        }
    }
    do() {
        this.chart[this.field] = this.value;
    }
    undo() {
        this.chart[this.field] = this.originalValue;
    }
}
