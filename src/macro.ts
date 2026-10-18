import type { Chart } from "./chart";
import type { EventValueESType, MacroData, MacroEvaluatorBodyData, MacroLink, MacroTimeBodyData, MacroValueBodyData, NoteMacroBodyData, NoteMacroLink, NoteType, RGB, TimeT } from "./chartTypes";
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
const getLineForNote = (note: Note) => {
    return note.parentNode.parentSeq.parentLine
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

export const NOTE_MACROS = {
    "note.type": (note: Note) => note.type,
    "note.size": (note: Note) => note.size,
    "note.speed": (note: Note) => note.speed,
    "note.alpha": (note: Note) => note.alpha,
    "note.yOffset": (note: Note) => note.yOffset,
    "note.positionX": (note: Note) => note.positionX,
    "note.visibleBeats": (note: Note) => note.visibleBeats,
    "note.above": (note: Note) => note.above,
    "note.isFake": (note: Note) => note.isFake,
    "note.startTime": (note: Note) => note.startTime,
    "note.endTime": (note: Note) => note.endTime,
    "line.id": (note: Note) => getLineForNote(note).id,
    "line.name": (note: Note) => getLineForNote(note).name,
    "line.group": (note: Note) => getLineForNote(note).group,
}

/** 音符宏中可以作为原形参数引用的属性名 */
const NOTE_PROTO_PROPS = "above|alpha|endTime|isFake|positionX|size|speed|startTime|type|visibleBeats|yOffset";
const NOTE_PROTO_REGEX = new RegExp(`@proto\\.(${NOTE_PROTO_PROPS})`);

export interface MNote {
    above?: boolean;
    alpha?: number;
    endTime?: TimeT;
    isFake?: boolean;
    positionX?: number;
    size?: number;
    speed?: number;
    startTime?: TimeT;
    type?: NoteType;
    visibleBeats?: number;
    yOffset?: number;
}
export type Macroable = number | string | TimeT | RGB | boolean | MNote;
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

export abstract class EventMacro<T extends Macroable> extends Macro<T, EventNode<any>, EventNode<any>> {
    eval(node: EventNode<any>, chart: Chart): T {
        let jsExpr = this.macro;
        if (this.parametric) {
            jsExpr = jsExpr.replace(/@proto\.(value|time)/, (_k, prop: "value" | "time") => {
                return JSON.stringify(this.protoNodes[this.consumers.get(node)!][prop]) + " "
            });
        }
        jsExpr = jsExpr.replace(/@([a-z]+\.[a-z]+)/, (k) => {
            if (!(k in EVENT_MACROS)) {
                throw err.UNKNOWN_MACRO_EXPRESSION(k, this.id);
            }
            return JSON.stringify(EVENT_MACROS[k as keyof typeof EVENT_MACROS](node as EventStartNode<any>, chart)) + " "
        });
        return new Function("return " + jsExpr)() as T;
    }
    checkSyntax(): KPAError<any> | null {
        let jsExpr = this.macro;
        if (this.parametric) {
            jsExpr = jsExpr.replace(/@proto\.(value|time)/, () => '"aaa" ');
        } else if (/@proto/.test(this.macro)) {
            return err.PROTO_PRESENT_IN_NONPARAMETRIC(this.id);
        }
        try {
            jsExpr = jsExpr.replace(/@([a-z]+\.[a-z]+)/, (k) => {
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
            return err.JAVASCRIPT_SYNTAX_ERROR(e instanceof Error ? e : new Error(String(e)), this.id);
        }
    }
    bindNode(node: EventNode<any>, macroData: MacroData, pos?: string) {
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
    linkProtoNode(node: EventNode<any>, id: number): void {
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
    dumpForNode(node: EventNode<any>): MacroData {
        if (this.parametric) {
            return [this.id, this.consumers.get(node)!]
        } else {
            return this.id
        }
    }
    abstract dumpLinkForNode(node: EventNode<any>): MacroLink;
}

export class EventMacroValue extends EventMacro<EventValueESType> {
    dumpLinkForNode(node: EventNode<any>): MacroLink {
        return [`value:${this.id}`, this.protoNodes.indexOf(node)];
    }
}

export class EventMacroTime extends EventMacro<TimeT> {
    dumpLinkForNode(node: EventNode<any>): MacroLink {
        return [`time:${this.id}`, this.protoNodes.indexOf(node)];
    }
}

export class NoteMacro extends Macro<MNote, Note, Note> {
    eval(note: Note, chart: Chart): MNote {
        let jsExpr = this.macro;
        if (this.parametric) {
            jsExpr = jsExpr.replace(NOTE_PROTO_REGEX, (_k, prop: keyof MNote) => {
                return JSON.stringify(this.protoNodes[this.consumers.get(note)!][prop]) + " "
            });
        }
        jsExpr = jsExpr.replace(/@([a-z]+\.[a-z]+)/, (k) => {
            if (!(k in NOTE_MACROS)) {
                throw err.UNKNOWN_MACRO_EXPRESSION(k, this.id);
            }
            return JSON.stringify(NOTE_MACROS[k as keyof typeof NOTE_MACROS](note)) + " "
        });
        return new Function("return " + jsExpr)() as MNote;
    }
    checkSyntax(): KPAError<any> | null {
        let jsExpr = this.macro;
        if (this.parametric) {
            jsExpr = jsExpr.replace(NOTE_PROTO_REGEX, () => '"aaa" ');
        } else if (/@proto/.test(this.macro)) {
            return err.PROTO_PRESENT_IN_NONPARAMETRIC(this.id);
        }
        try {
            jsExpr = jsExpr.replace(/@([a-z]+\.[a-z]+)/, (k) => {
                if (!(k in NOTE_MACROS)) {
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
            return err.JAVASCRIPT_SYNTAX_ERROR(e instanceof Error ? e : new Error(String(e)), this.id);
        }
    }
    bindNote(note: Note, macroData: MacroData, pos?: string) {
        if (this.parametric) {
            if (typeof macroData === "string") {
                throw err.PARAMETRIC_MACRO_REQUIRES_PROTO_KEY(pos)
            }
            this.consumers.set(note, macroData[1]);
        } else {
            if (Array.isArray(macroData)) {
                throw err.MACRO_NOT_PARAMETRIC(this.id, pos);
            }
            this.consumers.set(note, -1);
        }
    }
    linkProtoNote(note: Note, id: number): void {
        this.protoNodes[id] = note;
        note.linkedMacros.add(this);
    }
    dumpContent(): NoteMacroBodyData {
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
    dumpForNote(node: Note): MacroData {
        if (this.parametric) {
            return [this.id, this.consumers.get(node)!]
        } else {
            return this.id
        }
    }
    dumpLinkForNote(note: Note): NoteMacroLink {
        return [this.id, this.protoNodes.indexOf(note)]
    }
}

export class MacroLib {
    timeMacros: Map<string, EventMacroTime> = new Map();
    valueMacros: Map<string, EventMacroValue> = new Map();
    noteMacros: Map<string, NoteMacro> = new Map();
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
            const datum = data[i]!;
            const macro = new EventMacroTime(datum.macro, datum.id, datum.parametric);
            this.timeMacros.set(datum.id, macro);
        }
    }
    dumpNoteMacros(): NoteMacroBodyData[] {
        const arr: NoteMacroBodyData[] = [];
        for (const [_, macro] of this.noteMacros) {
            arr.push(macro.dumpContent());
        }
        return arr;
    }
    readNoteMacros(data: NoteMacroBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i]!;
            const macro = new NoteMacro(datum.macro, datum.id, datum.parametric);
            this.noteMacros.set(datum.id, macro);
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
            const datum = data[i]!;
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