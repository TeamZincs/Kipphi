import { Chart, type JudgeLineGroup, type UIName } from "../chart";
import { EventType, EventValueESType, EventValueType, EventValueTypeOfType, ExtendedEventTypeName, InterpreteAs, NoteDataKPA, NoteType, RGB, TimeT } from "../chartTypes";
import { Easing, easingArray, rpeEasingArray } from "../easing";
import { EasedEvaluator, EasedEvaluatorOfType, Evaluator } from "../evaluator";
import { EventEndNode, EventNode, EventNodeLike, EventNodeSequence, EventStartNode } from "../event";
import { JudgeLine, type EventLayer, type ExtendedLayer } from "../judgeline";
import { HEX, NNList, Note, NoteNode, type AnyNN, notePropTypes } from "../note";
import TC from "../time";
import { checkType, NodeType, numberToRatio } from "../util";
import { type Operation } from "./basic";
import { ChartPropChangeOperation, type ChartPropName } from "./chart";
import { EventNodeEvaluatorChangeOperation, EventNodePairAutoInsertOperation, EventNodePairRemoveOperation, EventNodeTimeChangeOperation, EventNodeValueChangeOperation } from "./event";
import { JudgeLineDeleteOperation, JudgeLineENSChangeOperation, JudgeLineExtendENSChangeOperation, JudgeLineInheritanceChangeOperation, JudgeLinePropChangeOperation, type JudgeLinePropName, JudgeLineRegroupOperation, JudgeLineRenameOperation, UIAttachOperation, UIDetachOperation, JudgeLineDetachAllUIOperation } from "./line";
import { HoldEndTimeChangeOperation, NNListAddBlankOperation, NNListTimeRangeDeleteOperation, NoteAddOperation, NoteDeleteOperation, NotePropChangeOperation, NotePropName, NoteTimeChangeOperation, NoteTypeChangeOperation } from "./note"

type IntoOperable = EventNode<EventValueESType> | NoteNode | Note | EventNodeSequence<EventValueESType> | JudgeLine | NNList | Chart;

/**
 * 代表时间
 * 
 * 可以使用时间元组、时间字符串（`"1:2/4"`）、时间数值
 * 
 * Represents a time.
 * 
 * Can use with time tuple, time string (`"1:2/4"`), time number.
 */
type UTime = TimeT | number | string;


/**
 * 代表求值器
 * 
 * 可以使用缓动编号、模板缓动名称、缓动对象、求值器对象
 * 
 * Represents an evaluator.
 * 
 * Can use with easing number, easing template name, easing object, evaluator object.
 */
type UEvaluator = number | string | Evaluator<EventValueESType> | Easing;

export type ToOperable = (<T extends IntoOperable>(o: T) =>
    T extends Note
        ? OperableNote
    : T extends EventNode<infer U>
        ? OperableEventNode<U>
    : T extends NoteNode
        ? OperableNoteNode
    : T extends EventNodeSequence<infer U>
        ? OperableEventNodeSequenceSlice<U>
    : T extends JudgeLine
        ? OperableJudgeLine
    : T extends NNList
        ? OperableNNListSlice
    : T extends Chart
        ? OperableChart
    : never) & { buffer: Operation[] };
const userTimeToTuple = (time: UTime) => {
    if (typeof time === "string") {
        const match = time.match(/^(\d+):(\d+)\/(\d+)$/);
        if (!match) {
            throw new Error(`Invalid time format: ${time}`);
        }
        return userTimeToTuple(match.slice(1, 4).map(s => parseInt(s)) as TimeT);
    } else if (typeof time === "number") {
        const integer = Math.floor(time);
        return TC.validateIp([integer, ...numberToRatio(time - integer)]);
    } else {
        time = [...time]; // 防止从别的什么地方找来一个数据
        TC.validateIp(time); // 原地规范化，如果失败就会抛错误，这里不用捕获
        return time;
    }
}

export const config = {
    useRpeEasingId: true
}

const uEvaluatorToEvaluator = (uev: UEvaluator, valueType: EventValueType, chart: Chart, interpreteAs?: InterpreteAs) => {
    if (typeof uev === "number") {
        const easing = config.useRpeEasingId ? rpeEasingArray[uev] : easingArray[uev];
        if (!easing) {
            throw new Error(`Invalid easing id: ${uev}`);
        }
        return EasedEvaluator.getEvaluatorFromEasing(valueType, easing, interpreteAs);
    } else if (typeof uev === "string") {
        const easing = chart.templateEasingLib.get(uev);
        if (!easing) {
            throw new Error(`easing not found: ${uev}`);
        }
        return EasedEvaluator.getEvaluatorFromEasing(valueType, easing, interpreteAs);
    } else if (uev instanceof Easing) {
        return EasedEvaluator.getEvaluatorFromEasing(valueType, uev, interpreteAs);
    } else if (uev instanceof Evaluator) {
        return uev;
    } else {
        throw new Error(`Invalid evaluator: ${uev}`);
    }
}

class Operable<T = unknown> {
    static cache = new WeakMap<object, Operable>();
    constructor(public target: T, protected buffer: Operation[], public chart: Chart, skipCache = false) {
        if (!skipCache) {
            const cached = Operable.cache.get(target as object);
            if (cached !== undefined) {
                return cached as any;
            }
            Operable.cache.set(target as object, this);
        }
    }
}


class OperableNote extends Operable<Note> {
    // @ts-expect-error 后面会赋值
    private _fields: {
        [x in NotePropName]: Note[x]
    } = {};
    constructor(target: Note, buffer: Operation[], chart: Chart) {
        const wasCached = Operable.cache.has(target as object);
        super(target, buffer, chart);
        if (wasCached) return this;
        if (target.parentNode === null) {
            throw new Error("Note has no parent node")
        }
        this._fields.startTime = target.startTime;
        this._fields.endTime = target.endTime;
        this._fields.type = target.type;
    }
    get startTime() {
        return this._fields.startTime;
    }
    set startTime(userTime: UTime) {
        const timeT = userTimeToTuple(userTime);
        const beats = TC.toBeats(timeT);
        if (beats < 0) {
            throw new Error("")
        }
        const nnList = this.target.parentNode.parentSeq
        if (beats > nnList.effectiveBeats) {
            throw new Error("")
        }
        this._fields.startTime = timeT;
        const node = nnList.getNodeOf(timeT);
        this.buffer.push(NoteTimeChangeOperation.lazy(this.target, node));
    }
    get endTime() { return this._fields.endTime; }
    set endTime(userTime: UTime) {
        if (this._fields.type !== NoteType.hold) {
            throw new Error("Note is not a hold note");
        }
        const timeT = userTimeToTuple(userTime);
        if (!TC.gt(timeT, this._fields.startTime)) {
            throw new Error("");
        }
        this._fields.endTime = timeT;
        this.buffer.push(HoldEndTimeChangeOperation.lazy(this.target, timeT));
    }
    get type() { return this._fields.type; }
    set type(type: NoteType) {
        if (this._fields.type === type) {
            return;
        }
        this._fields.type = type;
        this.buffer.push(NoteTypeChangeOperation.lazy(this.target, type));
    }
    del() {
        this.buffer.push(NoteDeleteOperation.lazy(this.target));
    }
}

interface OperableNote {
    get above(): boolean;
    set above(above: boolean);
    get alpha(): number;
    set alpha(alpha: number);
    get positionX(): number;
    set positionX(positionX: number);
    get judgeSize(): number;
    set judgeSize(judgeSize: number);
    get isFake(): boolean;
    set isFake(isFake: boolean);
    get size(): number;
    set size(size: number);
    get tint(): HEX;
    set tint(tint: string | RGB | HEX);
    get tintHitEffects(): HEX;
    set tintHitEffects(tintHitEffects: string | RGB | HEX);
    get visibleBeats(): number;
    set visibleBeats(visibleBeats: number);
}

for (const propName of ["above", "alpha", "positionX", "judgeSize", "isFake", "size", "tint", "tintHitEffects", "visibleBeats"] satisfies NotePropName[]) {
    Object.defineProperty(OperableNote.prototype, propName, {
        get() { return this._fields[propName] ?? this.target[propName]},
        set(value) {
            if (this._fields[propName] === value) {
                return;
            }
            if (!checkType(value, notePropTypes[propName])) {
                throw new Error(`Invalid value for ${propName}: ${value}. Expecting ${notePropTypes[propName]}`)
            }
            this._fields[propName] = value;
            this.buffer.push(NotePropChangeOperation.lazy(this.target, propName, value));
        }
    });
}

class OperableNoteNode extends Operable<NoteNode> {
    constructor(target: NoteNode, buffer: Operation[], chart: Chart) {
        super(target, buffer, chart);
    }
    get notes() {
        return this.target.notes.map(note => new OperableNote(note, this.buffer, this.chart));
    }
    get startTime() {
        return this.target.startTime;
    }
    get endTime() {
        return this.target.endTime;
    }
    get isHold() {
        return this.target.isHold;
    }
    get parentSeq() {
        return this.target.parentSeq;
    }
    add(note: Note) {
        if (!this.target.accepts(note)) { 
            throw new Error("NoteNode does not accept this note");
        }
        this.buffer.push(NoteAddOperation.lazy(note, this.target));
    }
}

class OperableEventNode<T extends EventValueESType> extends Operable<EventNode<T>> {
    
    constructor(target: EventNode<T>, buffer: Operation[], chart: Chart) {
        super(target, buffer, chart);
    }
    get isStart() {
        return this.target instanceof EventStartNode;
    }
    get isEnd() {
        return this.target instanceof EventEndNode;
    }
    /** 返回同一个事件内的开始节点。如果此事件是开始节点，返回自己，否则返回面对面的开始节点 */
    get start(): OperableEventNode<T> {
        return this.isStart ? this : this.previous as any;
    }
    /**
     * 获取同一个事件内的结束节点。如果此事件是结束节点，返回自己，否则返回面对面的结束节点。
     * 
     * 注意如果是final节点，会返回TAIL。
     */
    get end(): OperableEventNode<T> | EventNodeLike<NodeType.TAIL, T> {
        return this.isEnd ? this : this.next;
    }
    get isFinal() {
        return this.isStart && this.target.next.type === NodeType.TAIL;
    }
    private _time: TimeT;
    get time() {
        return this._time ?? this.target.time;
    }
    set time(userTime: UTime) {
        const timeT = userTimeToTuple(userTime);
        this._time = timeT;
        this.buffer.push(EventNodeTimeChangeOperation.lazy(this.target as any, timeT));
    }
    private _value: T;
    get value() {
        return this._value ?? this.target.value;
    }
    set value(userValue: T) {
        this._value = userValue;
        this.buffer.push(EventNodeValueChangeOperation.lazy(this.target as any, userValue));
    }
    private _evaluator: Evaluator<T>;
    get evaluator() {
        return this._evaluator ?? this.target.evaluator;
    }
    set evaluator(evaluator: UEvaluator) {
        const parent = this.target.parentSeq;
        const e = uEvaluatorToEvaluator(
            evaluator,
            parent.type === EventType.text ? EventValueType.text : parent.type === EventType.color ? EventValueType.color : EventValueType.numeric,
            this.chart,
            InterpreteAs.str);
        this._evaluator = e as any;
        this.buffer.push(EventNodeEvaluatorChangeOperation.lazy(this.target as any, e));
    }
    get previous(): OperableEventNode<T> | EventNodeLike<NodeType.HEAD, T> {
        const prev = this.target.previous;
        return prev.type === NodeType.HEAD ? prev : new OperableEventNode(prev, this.buffer, this.chart);
    }
    get next(): OperableEventNode<T> | EventNodeLike<NodeType.TAIL, T> {
        const next = this.target.next;
        return next.type === NodeType.TAIL ? next : new OperableEventNode(next, this.buffer, this.chart);
    }
    get parentSeq() {
        return new OperableEventNodeSequenceSlice(this.target.parentSeq, this.buffer, this.chart);
    }
    del() {
        this.buffer.push(EventNodePairRemoveOperation.lazy(this.start.target as any, true));
    }
}


class OperableEventNodeSequenceSlice<T extends EventValueESType> extends Operable<EventNodeSequence<T>> {
    constructor(target: EventNodeSequence<T>, buffer: Operation[], chart: Chart, public start?: number, public end?: number) {
        super(target, buffer, chart, true);
    }
    *[Symbol.iterator]() {
        let node: EventStartNode<T>;
        if (this.start) {
            node = this.target.getNodeAt(this.start);
            if (node.next.type === NodeType.TAIL) {
                return;
            }
            node = node.next.next;
        } else {
            node = this.target.head.next;
        }
        while (true) {
            const end = node.next;
            yield new OperableEventNode(node, this.buffer, this.chart);
            if (end.type === NodeType.TAIL || (this.end && TC.toBeats(end.time) >= this.end)) {
                break;
            }
            node = end.next;
        }
    }
    get type() {
        return this.target.type;
    }
    getNodeAtBeats(time: UTime) {
        const timeT = userTimeToTuple(time);
        return new OperableEventNode(this.target.getNodeAt(TC.toBeats(timeT)), this.buffer, this.chart);
    }
    slice(start: number, end: number) {
        return new OperableEventNodeSequenceSlice(this.target, this.buffer, this.chart, start, end);
    }
    /**
     * 该方法不返回添加的节点对。
     * 
     * This method does not return the added node pair.
     * @param param0 
     * @returns 
     */
    newPair({ time, end, start, evaluator, interpreteAs }: {
        time: UTime, 
        end: T, 
        start: T, 
        /** 能代表求值器的东西，可以是缓动编号、模板缓动名称、缓动函数、缓动对象、求值器求值器本身 */
        evaluator?: UEvaluator,
        interpreteAs?: InterpreteAs,
    }): this {
        const timeT = userTimeToTuple(time);
        const endNode = new EventEndNode(timeT, end);
        const startNode = new EventStartNode(timeT, start);
        const valueType = (this.type === EventType.color ? EventValueType.color
                            : this.type === EventType.text  ? EventValueType.text
                            : EventValueType.numeric) as EventValueTypeOfType<T>;
        startNode.evaluator = uEvaluatorToEvaluator(evaluator, valueType, this.chart, interpreteAs ?? InterpreteAs.str) as any;
        EventNode.connect(startNode, endNode);
        this.buffer.push(EventNodePairAutoInsertOperation.lazy(startNode, this.target));
        return this;
    }
}

type OperableJudgeLineProps = Pick<JudgeLine, "texture" | "cover" | "zOrder" | "anchor" | "rotatesWithFather">;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
interface OperableJudgeLine extends OperableJudgeLineProps {}
class OperableJudgeLine extends Operable<JudgeLine> {
    constructor(target: JudgeLine, buffer: Operation[], chart: Chart) {
        super(target, buffer, chart);
    }
    get name() {
        return this.target.name;
    }
    set name(value: string) {
        if (this.target.name === value) return;
        if (typeof name !== "string") {
            throw new Error("name must be a string.");
        }
        this.buffer.push(JudgeLineRenameOperation.lazy(this.target, value));
    }
    get id() {
        return this.target.id;
    }
    get father(): OperableJudgeLine | null {
        return this.target.father ? new OperableJudgeLine(this.target.father, this.buffer, this.chart) : null;
    }
    set father(value: OperableJudgeLine | JudgeLine | null) {
        const line = value instanceof OperableJudgeLine ? value.target : value;
        this.buffer.push(JudgeLineInheritanceChangeOperation.lazy(this.chart, this.target, line));
    }
    get children(): ReadonlySet<OperableJudgeLine> {
        return new Set([...this.target.children].map(child => new OperableJudgeLine(child, this.buffer, this.chart)));
    }
    get group() { return this.target.group; }
    set group(value: JudgeLineGroup) {
        if (this.target.group === value) return;
        this.buffer.push(JudgeLineRegroupOperation.lazy(this.target, value));
    }
    get nnLists(): ReadonlyMap<string, OperableNNListSlice> {
        return new Map([...this.target.nnLists].map(([k, v]) => [k, new OperableNNListSlice(v, this.buffer, this.chart)]));
    }
    get hnLists(): ReadonlyMap<string, OperableNNListSlice> {
        return new Map([...this.target.hnLists].map(([k, v]) => [k, new OperableNNListSlice(v, this.buffer, this.chart)]));
    }
    notes(start: number, end: number): Generator<OperableNote>;
    notes(): Generator<OperableNote>;
    *notes(start?: number, end?: number) {
        for (const note of this.target.notes(start, end)) {
            yield new OperableNote(note, this.buffer, this.chart);
        }
    }
    getNNList(speed: number, yOffset: number, isHold: boolean) {
        const list = this.target.getNNList(speed, yOffset, isHold, true);
        return new OperableNNListSlice(list, this.buffer, this.chart);
    }
    get eventLayers(): (EventLayer & { [K in keyof EventLayer]?: OperableEventNodeSequenceSlice<number> })[] {
        return this.target.eventLayers.map(layer => {
            const result: any = {};
            for (const key in layer) {
                const seq = layer[key as keyof EventLayer];
                if (seq) {
                    result[key] = new OperableEventNodeSequenceSlice(seq as EventNodeSequence<EventValueESType>, this.buffer, this.chart);
                }
            }
            return result;
        });
    }
    get extendedLayer(): { [K in keyof ExtendedLayer]?: OperableEventNodeSequenceSlice<EventValueESType> } {
        const result: any = {};
        const ext = this.target.extendedLayer;
        for (const key in ext) {
            const seq = ext[key as keyof ExtendedLayer];
            if (seq) {
                result[key] = new OperableEventNodeSequenceSlice(seq as EventNodeSequence<EventValueESType>, this.buffer, this.chart);
            }
        }
        return result;
    }
    get speedSequence(): OperableEventNodeSequenceSlice<number> | undefined {
        return this.target.speedSequence ? new OperableEventNodeSequenceSlice(this.target.speedSequence as EventNodeSequence<number>, this.buffer, this.chart) : undefined;
    }
    setENS(layerId: number, typeStr: keyof EventLayer, value: EventNodeSequence) {
        this.buffer.push(JudgeLineENSChangeOperation.lazy(this.target, layerId, typeStr, value));
    }
    setExtendedENS<T extends ExtendedEventTypeName>(typeStr: T, value: EventNodeSequence | null) {
        this.buffer.push(JudgeLineExtendENSChangeOperation.lazy(this.target, typeStr, value as any));
    }
    attachUI(ui: UIName) {
        if (!UI_NAMES.includes(ui)) {
            throw new Error(`Invalid UI name: ${ui}. Must be one of: ${UI_NAMES.join(", ")}`);
        }
        this.buffer.push(UIAttachOperation.lazy(this.chart, this.target, ui));
    }
    detachUI(ui: UIName) {
        if (!UI_NAMES.includes(ui)) {
            throw new Error(`Invalid UI name: ${ui}. Must be one of: ${UI_NAMES.join(", ")}`);
        }
        this.buffer.push(UIDetachOperation.lazy(this.chart, ui));
    }
    detachAllUI() {
        this.buffer.push(JudgeLineDetachAllUIOperation.lazy(this.chart, this.target));
    }
    del() {
        this.buffer.push(JudgeLineDeleteOperation.lazy(this.chart, this.target));
    }
    /** 新增一个音符。 */
    newNote(params: Partial<Pick<NoteDataKPA, Exclude<keyof NoteDataKPA, "type" | "startTime" | "endTime" | "positionX">>>
        & { type: NoteType, startTime: UTime, endTime?: UTime, positionX: number }) {
        const startTime = userTimeToTuple(params.startTime);
        const endTime = params.endTime && userTimeToTuple(params.endTime)
        if (params.type === NoteType.hold && !params.endTime) {
            throw new Error("Hold notes must have an endTime");
        } else if (params.type !== NoteType.hold && endTime && TC.ne(endTime, startTime)) {
            throw new Error("Non-hold notes must have the same startTime and endTime");
        }
        const data: NoteDataKPA = {
            type: params.type,
            startTime: startTime,
            endTime: endTime || startTime,
            positionX: params.positionX,
            size: params.size ?? 1.0,
            judgeSize: params.judgeSize ?? 1.0,
            speed: params.speed ?? 1.0,
            alpha: params.alpha ?? 1.0,
            isFake: params.isFake ?? 0,
            above: params.above ?? 1,
            visibleTime: params.visibleTime ?? 99999.0,
            absoluteYOffset: params.absoluteYOffset ?? 0,
            yOffset: params.yOffset,
            tintHitEffects: params.tintHitEffects ?? null,
            tint: params.tint ?? null,
            // zIndex: params.zIndex ?? null,
            // zIndexHitEffects: params.zIndexHitEffects ?? null,
            visibleBeats: params.visibleBeats ?? 0
        };
        const note = new Note(data);
        note.computeVisibleBeats(this.chart.timeCalculator);

        this.buffer.push(
            NoteAddOperation.lazy(
                note,
                this.target.getNNList(
                    note.speed, 
                    note.yOffset, 
                    note.type === NoteType.hold, 
                    true)
                .getNodeOf(note.startTime)
            ));
        return this;
    }
}

const judgeLinePropTypes: { [K in "texture" | "cover" | "zOrder" | "anchor" | "rotatesWithFather"]: string | (string | typeof Function)[] | typeof Function } = {
    texture: "string",
    cover: "boolean",
    zOrder: "number",
    anchor: ["number", "number"],
    rotatesWithFather: "boolean",
};

const jlProps: ("texture" | "cover" | "zOrder" | "anchor" | "rotatesWithFather")[] = ["texture", "cover", "zOrder", "anchor", "rotatesWithFather"];
for (const prop of jlProps) {
    Object.defineProperty(OperableJudgeLine.prototype, prop, {
        get(this: OperableJudgeLine) { return this.target[prop]; },
        set(this: OperableJudgeLine, value: JudgeLine[typeof prop]) {
            if (this.target[prop] === value) return;
            if (!checkType(value, judgeLinePropTypes[prop])) {
                throw new Error(`Invalid value for ${prop}: ${value}. Expecting ${judgeLinePropTypes[prop]}`);
            }
            this.buffer.push(JudgeLinePropChangeOperation.lazy(this.target, prop as JudgeLinePropName, value));
        },
        configurable: true,
        enumerable: true,
    });
}

class OperableNNListSlice extends Operable<NNList> {
    constructor(target: NNList, buffer: Operation[], chart: Chart, public start?: number, public end?: number) {
        super(target, buffer, chart, true);
    }
    get speed() { return this.target.speed; }
    get medianYOffset() { return this.target.medianYOffset; }
    get id() { return this.target.id; }
    get effectiveBeats() { return this.target.effectiveBeats; }
    get parentLine(): OperableJudgeLine {
        return new OperableJudgeLine(this.target.parentLine, this.buffer, this.chart);
    }
    /** Iterate over NoteNodes in this slice as OperableNoteNodes */
    *[Symbol.iterator]() {
        let node: AnyNN;
        if (this.start !== undefined) {
            const nnOrTail = this.target.getNodeAt(this.start);
            if (nnOrTail.type === NodeType.TAIL) return;
            node = nnOrTail as AnyNN;
        } else {
            node = this.target.head.next;
        }
        while (node.type !== NodeType.TAIL) {
            yield new OperableNoteNode(node as NoteNode, this.buffer, this.chart);
            if (this.end !== undefined && TC.toBeats((node as NoteNode).startTime) >= this.end) {
                break;
            }
            node = node.next;
        }
    }
    /** Get the NoteNode at a given time */
    getNodeOf(time: UTime): OperableNoteNode {
        const timeT = userTimeToTuple(time);
        return new OperableNoteNode(this.target.getNodeOf(timeT), this.buffer, this.chart);
    }
    /** Create a sub-slice of this NNList */
    slice(start: number, end: number) {
        return new OperableNNListSlice(this.target, this.buffer, this.chart, start, end);
    }
    /** Delete notes in a time range */
    deleteTimeRange(start: UTime, end: UTime, updatesJump: boolean = true) {
        const startT = userTimeToTuple(start);
        const endT = userTimeToTuple(end);
        this.buffer.push(NNListTimeRangeDeleteOperation.lazy(this.target, [startT, endT], updatesJump));
    }
    /** Insert a blank time range, shifting notes after pos */
    insertBlank(pos: UTime, length: UTime) {
        const posT = userTimeToTuple(pos);
        const lengthT = userTimeToTuple(length);
        this.buffer.push(new NNListAddBlankOperation(this.target, posT, lengthT));
    }
}

type OperableChartProps = Pick<Chart, ChartPropName>;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging
interface OperableChart extends OperableChartProps {}
class OperableChart extends Operable<Chart> {
    constructor(target: Chart, buffer: Operation[], chart: Chart) {
        super(target, buffer, chart);
    }
    get judgeLines(): OperableJudgeLine[] {
        return this.target.judgeLines.map(line => new OperableJudgeLine(line, this.buffer, this.chart));
    }
    get orphanLines(): OperableJudgeLine[] {
        return this.target.orphanLines.map(line => new OperableJudgeLine(line, this.buffer, this.chart));
    }
    getJudgeLineById(id: number): OperableJudgeLine | undefined {
        const line = this.target.judgeLines[id];
        return line ? new OperableJudgeLine(line, this.buffer, this.chart) : undefined;
    }
}

const chartPropTypes: { [K in ChartPropName]: string | (string | typeof Function)[] | typeof Function } = {
    name: "string",
    level: "string",
    composer: "string",
    illustrator: "string",
    charter: "string",
    offset: "number",
};

const UI_NAMES: readonly UIName[] = ["combo", "combonumber", "score", "pause", "bar", "name", "level"];

const chartProps: ChartPropName[] = ["name", "level", "composer", "illustrator", "charter", "offset"];
for (const prop of chartProps) {
    Object.defineProperty(OperableChart.prototype, prop, {
        get(this: OperableChart) { return this.target[prop]; },
        set(this: OperableChart, value: Chart[typeof prop]) {
            if (this.target[prop] === value) return;
            if (!checkType(value, chartPropTypes[prop])) {
                throw new Error(`Invalid value for ${prop}: ${value}. Expecting ${chartPropTypes[prop]}`);
            }
            this.buffer.push(ChartPropChangeOperation.lazy(this.target, prop, value));
        },
        configurable: true,
        enumerable: true,
    });
}

export function useToOperable(chart: Chart): ToOperable {
    Operable.cache = new WeakMap();
    const toOperable = (o: IntoOperable) => {
        if (typeof o !== "object") {
            throw new Error("o must be an object");
        }
        if (o instanceof Operable) {
            return o;
        }
        const buffer = (toOperable as ToOperable).buffer
        if (o instanceof Note) {
            return new OperableNote(o, buffer, chart);
        } else if (o instanceof EventNode) {
            return new OperableEventNode(o, buffer, chart);
        } else if (o instanceof EventNodeSequence) {
            return new OperableEventNodeSequenceSlice(o, buffer, chart);
        } else if (o instanceof NoteNode) {
            return new OperableNoteNode(o, buffer, chart);
        } else if (o instanceof JudgeLine) {
            return new OperableJudgeLine(o, buffer, chart);
        } else if (o instanceof NNList) {
            return new OperableNNListSlice(o, buffer, chart);
        } else if (o instanceof Chart) {
            return new OperableChart(o, buffer, chart);
        } else {
            throw new Error("Unsupported object");
        }
    };
    (toOperable as ToOperable).buffer = [];
    return toOperable as ToOperable;
}

export function operate(chart: Chart, fn: (o: ToOperable) => void) {
    const o = useToOperable(chart);
    fn(o);
    return o.buffer;
}
