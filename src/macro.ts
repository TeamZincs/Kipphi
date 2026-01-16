import type { Chart } from "./chart";
import type { EventValueESType, MacroEvaluatorBodyData, MacroTimeBodyData, MacroValueBodyData, TimeT } from "./chartTypes";
import { MacroEvaluator } from "./evaluator";
import type { EventNode, EventStartNode } from "./event";
import type { JudgeLine } from "./judgeline";


const getLine = (node: EventStartNode<EventValueESType>, chart: Chart) => {
    const canBeId = node.parentSeq.id.match(/#(\d+)/);
    if (!canBeId) {
        return null;
    }
    return chart.judgeLines[parseInt(canBeId[1])]
}


// 添加表达式宏，通过@表示。如@line.id表示判定线ID，会在构造函数中被替换为实际值
export const MACROS = {
    "line.id": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.id,
    "line.name": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.name,
    "line.group": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.group,
    "node.time": (node: EventStartNode<EventValueESType>) => node.time,
    "seq.id": (node: EventStartNode<EventValueESType>) => node.parentSeq.id,
    "seq.type": (node: EventStartNode<EventValueESType>) => node.parentSeq.type
}


export class MacroValue {
    public readonly consumers: Set<EventNode<EventValueESType>> = new Set();
    constructor(public macro: string, public id: string) {
    }
    eval(node: EventNode<EventValueESType>, chart: Chart): EventValueESType {
        const jsExpr = this.macro.replace(/@([a-z\.]+)/, (k) => {
            return JSON.stringify(MACROS[k](node, chart)) + " "
        });
        return new Function("return " + jsExpr)() as EventValueESType;
    }
    assignTo(node: EventStartNode<EventValueESType>, chart: Chart): void {
        node.value = this.eval(node, chart);
        this.consumers.add(node);
    }
    deassignFrom(node: EventStartNode<EventValueESType>): void {
        this.consumers.delete(node);
    }
    dumpContent(): MacroValueBodyData {
        return {
            id: this.id,
            macro: this.macro
        }
    }
}

export class MacroTime {
    public readonly consumers: Set<EventNode<any>> = new Set();
    constructor(public macro: string, public id: string) {
    }
    eval(node: EventNode<any>, chart: Chart): TimeT {
        const jsExpr = this.macro.replace(/@([a-z\.]+)/, (k) => {
            return JSON.stringify(MACROS[k](node, chart)) + " "
        });

        return new Function("return " + jsExpr)() as TimeT;
    }

    assignTo(node: EventStartNode<any>, chart: Chart): void {
        node.time = this.eval(node, chart);
        this.consumers.add(node);
    }

    deassignFrom(node: EventStartNode<any>): void {
        this.consumers.delete(node);
    }

    dumpContent(): MacroTimeBodyData {
        return {
            id: this.id,
            macro: this.macro
        }

    }
}

export class MacroLib {
    timeMacros: Map<string, MacroTime> = new Map();
    valueMacros: Map<string, MacroValue> = new Map();
    macroEvaluators: Map<string, MacroEvaluator<EventValueESType>> = new Map();
    dumpTimeMacros(): MacroTimeBodyData[] {
        const arr: MacroTimeBodyData[] = [];
        for (const [_, macro] of this.timeMacros) {
            arr.push({
                id: macro.id,
                macro: macro.macro
            });
        }
        return arr;
    }
    readTimeMacros(data: MacroTimeBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];

            this.timeMacros.set(datum.id, new MacroTime(datum.macro, datum.id));
        }
    }

    dumpValueMacros(): MacroValueBodyData[] {
        const arr: MacroValueBodyData[] = [];
        for (const [_, macro] of this.valueMacros) {
            arr.push({
                id: macro.id,
                macro: macro.macro
            });
        }
        return arr;
    }
    readValueMacros(data: MacroValueBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];
            this.valueMacros.set(datum.id, new MacroValue(datum.macro, datum.id));
        }
    }

    dumpMacroEvaluators(): MacroEvaluatorBodyData[] {
        const arr: MacroEvaluatorBodyData[] = [];
        for (const [_, ev] of this.macroEvaluators) {
            arr.push({
                id: ev.id,
                macro: ev.expression
            })
        }
        return arr;
    }
    readMacroEvaluators(data: MacroEvaluatorBodyData[]): void {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];
            this.macroEvaluators.set(datum.id, new MacroEvaluator(datum.macro, datum.id));
        }
    }
}