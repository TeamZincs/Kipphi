import { Chart } from "../chart";
import { Operation } from "./basic";

export type ChartPropName = "name" | "level" | "composer" | "illustrator" | "charter" | "offset"

/**
 * 修改谱面元信息的操作。
 *
 * 只覆盖 `name` / `level` / `composer` / `illustrator` / `charter` / `offset`
 * 这几个标量字段，改动 `name` 或 `level` 时会通知编辑器刷新。
 *
 * @example
 * ```ts
 * // 撤销后自动恢复为原谱师
 * operations.do(new ChartPropChangeOperation(chart, "charter", "Zes"));
 * ```
 */
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
