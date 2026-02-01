import type { Chart } from "./chart";
import type { EventValueESType, MacroData, MacroEvaluatorBodyData, MacroLink, MacroTimeBodyData, MacroValueBodyData, RGB, TimeT } from "./chartTypes";
import { err, ERROR_IDS, KPAError } from "./env";
import { MacroEvaluator } from "./evaluator";
import type { EventNode, EventStartNode } from "./event";
import type { JudgeLine } from "./judgeline";
import { Note } from "./note";


const getLine = (node: EventStartNode<EventValueESType>, chart: Chart) => {
    const canBeId = node.parentSeq.id.match(/#(\d+)/);
    if (!canBeId) {
        return null;
    }
    return chart.judgeLines[parseInt(canBeId[1])]
}


// 添加表达式宏，通过@表示。如@line.id表示判定线ID，会在构造函数中被替换为实际值
export const EVENT_MACROS = {
    "line.id": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.id,
    "line.name": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.name,
    "line.group": (node: EventStartNode<EventValueESType>, chart: Chart) => getLine(node, chart)?.group,
    "node.time": (node: EventStartNode<EventValueESType>) => node.time,
    "node.value": (node: EventStartNode<EventValueESType>) => node.value,
    "seq.id": (node: EventStartNode<EventValueESType>) => node.parentSeq.id,
    "seq.type": (node: EventStartNode<EventValueESType>) => node.parentSeq.type
}

export type Macroable = number | string | TimeT | RGB | boolean;
export type Macroee = EventNode<EventValueESType> | Note;

export abstract class Macro<T extends Macroable, C extends Macroee, P extends Macroee> {
    public readonly consumers: Map<C, number> = new Map();
    /**
     * **原形节点**
     * 
     * 作为参数，向其他节点派生数值。
     * 
     * 需要parametric为true。
     * 
     * 如：若节点A存在于这个数组，下标为1：
     * 
     * 节点B设有数值宏，即这个宏，宏表达式： @proto.value + 2。
     * 
     * 那么评估B的宏时可以调用节点A的数值。
     * 
     * 在转储时，是节点存储宏的ID，而不是宏去找节点，因为节点并没有全谱面编号系统。
     */
    public readonly protoNodes: P[] = [];
    /**
     * 
     * @param macro 
     * @param id 
     * @param parametric 是否为参数宏，即是否可以把一个节点作为参数。     
     */
    constructor(public macro: string, public id: string, public readonly parametric: boolean) {
    }
    abstract eval(consumer: C, chart: Chart): T;
}

export abstract class EventMacro<T extends Macroable> extends Macro<T, EventNode<EventValueESType>, EventNode<EventValueESType>> {
    eval(node: EventNode<EventValueESType>, chart: Chart): T {
        let jsExpr = this.parametric ? this.macro.replace(/@proto\.(value|time)/, (k) => {
            return JSON.stringify(this.protoNodes[this.consumers.get(node)!][k]) + " "
        }): this.macro;
        jsExpr =  this.macro.replace(/@([a-z]+\.[a-z])/, (k) => {
            return JSON.stringify(EVENT_MACROS[k](node, chart)) + " "
        });
        return new Function("return " + jsExpr)() as T;
    }
    checkSyntax(): KPAError<ERROR_IDS.PROTO_PRESENT_IN_NONPARAMETRIC | ERROR_IDS.UNKNOWN_MACRO_EXPRESSION | ERROR_IDS.JAVASCRIPT_SYNTAX_ERROR> | null {
        let jsExpr: string;
        if (this.parametric) {
            jsExpr = this.macro.replace(/@proto\.(value|time)/, (k) => {
                return '"aaa" '
            });
        } else {
            if (/@proto/.test(this.macro)) {
                return err.PROTO_PRESENT_IN_NONPARAMETRIC(this.id);
            }
        }
        try {
            jsExpr =  this.macro.replace(/@([a-z]+\.[a-z])/, (k) => {
                if (!(k in EVENT_MACROS)) {
                    throw err.UNKNOWN_MACRO_EXPRESSION(k, this.id);
                }
                return '"aaa" '
            });
        } catch (e) {
            if (e instanceof KPAError) {
                return e;
            } else {
                throw e;
            }
        }
        try {
            new Function("return " + jsExpr); // 仅检查语法，不执行
        } catch (e) {
            return err.JAVASCRIPT_SYNTAX_ERROR(e, this.id);
        }
    }
    bindNode(node: EventNode<EventValueESType>, macroData: MacroData, pos?: string) {
        if (this.parametric) {
            if (typeof macroData === "string") {
                throw err.PARAMETRIC_MACRO_REQUIRES_PROTO_KEY(pos)
            }
            this.consumers.set(node, macroData[1]);
        } else {
            if (Array.isArray(macroData)) {
                throw err.MACRO_NOT_PARAMETRIC(this.id, pos);
            }
            this.consumers.set(node, -1);
        }
    }
    linkProtoNode(node: EventNode<EventValueESType>, id: number): void {
        this.protoNodes[id] = node;
        node.linkedMacros.add(this);
    }
    dumpContent(): MacroValueBodyData {
        return {
            id: this.id,
            macro: this.macro,
            parametric: this.parametric ? true : undefined
        }
    }
    /**
     * 为单个节点导出宏名称和参数（若有）
     * @param node 
     * @example
     * return {
     *     start: node.value,
     *     end: node.next.value,
     *     macroStart: node.valueMacro.dumpForNode(node),
     *     macroEnd: node.valueMacro.dumpForNode(node.next),
     *     ...
     * } satisfies EvenDataKPA2
     * 
     */
    dumpForNode(node: EventNode<EventValueESType>): MacroData {
        if (this.parametric) {
            return [this.id, this.consumers.get(node)!]
        } else {
            return this.id
        }
    }
    abstract dumpLinkForNode(node: EventNode<EventValueESType>): MacroLink;
}

export class EventMacroValue extends EventMacro<EventValueESType> {
    dumpLinkForNode(node: EventNode<EventValueESType>): MacroLink {
        return [`value:${this.id}`, this.protoNodes.indexOf(node)];
    }
}

export class EventMacroTime extends EventMacro<TimeT> {
    dumpLinkForNode(node: EventNode<EventValueESType>): MacroLink {
        return [`time:${this.id}`, this.protoNodes.indexOf(node)];
    }
}

export class MacroLib {
    timeMacros: Map<string, EventMacroTime> = new Map();
    valueMacros: Map<string, EventMacroValue> = new Map();
    macroEvaluators: Map<string, MacroEvaluator<EventValueESType>> = new Map();
    dumpTimeMacros(): MacroTimeBodyData[] {
        const arr: MacroTimeBodyData[] = [];
        for (const [_, macro] of this.timeMacros) {
            arr.push(macro.dumpContent());
        }
        return arr;
    }
    readTimeMacros(data: MacroTimeBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];
            const macro = new EventMacroTime(datum.macro, datum.id, datum.parametric);
            this.timeMacros.set(datum.id, macro);
        }
    }

    dumpValueMacros(): MacroValueBodyData[] {
        const arr: MacroValueBodyData[] = [];
        for (const [_, macro] of this.valueMacros) {
            arr.push(macro.dumpContent());
        }
        return arr;
    }
    readValueMacros(data: MacroValueBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];
            const macro = new EventMacroValue(datum.macro, datum.id, datum.parametric);
            this.valueMacros.set(datum.id, macro);
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