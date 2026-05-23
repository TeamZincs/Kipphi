import { Chart } from "../chart";
import { EventType, EventValueESType, EventValueType, EventValueTypeOfType, InterpreteAs, NoteType, RGB, TimeT } from "../chartTypes";
import { Easing, easingArray, rpeEasingArray } from "../easing";
import { EasedEvaluator, Evaluator, ExpressionEvaluator } from "../evaluator";
import { EventEndNode, EventNode, EventNodeLike, EventNodeSequence, EventStartNode } from "../event";
import { HEX, Note, NoteNode } from "../note";
import TC from "../time";
import { NodeType, numberToRatio } from "../util";
import { type Operation } from "./basic";
import { EventNodeEvaluatorChangeOperation, EventNodePairAutoInsertOperation, EventNodePairRemoveOperation, EventNodeTimeChangeOperation, EventNodeValueChangeOperation } from "./event";
import { HoldEndTimeChangeOperation, NoteAddOperation, NoteDeleteOperation, NotePropChangeOperation, NotePropName, NoteTimeChangeOperation, NoteTypeChangeOperation } from "./note"

type IntoOperable = EventNode<EventValueESType> | NoteNode | Note | EventNodeSequence<EventValueESType>;

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

type ToOperable = (<T extends IntoOperable>(o: T) =>
    T extends Note
        ? OperableNote
    : T extends EventNode<infer U>
        ? OperableEventNode<U>
    : T extends NoteNode
        ? OperableNoteNode
    : T extends EventNodeSequence<infer U>
        ? OperableEventNodeSequenceSlice<U>
    : never) & { buffer: Operation[] };
const userTimeToTuple = (time: UTime) => {
    if (typeof time === "string") {
        const match = time.match(/^(\d+):(\d+)\/(\d+)$/);
        if (!match) {
            throw new Error(`Invalid time format: ${time}`);
        }
        return userTimeToTuple(match.map(s => parseInt(s)) as TimeT);
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

class Operable {
    constructor(protected buffer: Operation[], public chart: Chart) {}
}


class OperableNote extends Operable {
    // @ts-expect-error 后面会赋值
    private _fields: {
        [x in NotePropName]: Note[x]
    } = {};
    constructor(public target: Note, buffer: Operation[], chart: Chart) {
        super(buffer, chart);
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
            this._fields[propName] = value;
            this.buffer.push(NotePropChangeOperation.lazy(this.target, propName, value));
        }
    });
}

class OperableNoteNode extends Operable {
    constructor(public target: NoteNode, buffer: Operation[], chart: Chart) {
        super(buffer, chart);
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

class OperableEventNode<T extends EventValueESType> extends Operable {
    constructor(public target: EventNode<T>, buffer: Operation[], chart: Chart) {
        super(buffer, chart);
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
    get time() {
        return this.target.time;
    }
    get isFinal() {
        return this.isStart && this.target.next.type === NodeType.TAIL;
    }
    set time(userTime: UTime) {
        const timeT = userTimeToTuple(userTime);
        this.buffer.push(EventNodeTimeChangeOperation.lazy(this.target as any, timeT));
    }
    get value() {
        return this.target.value;
    }
    set value(userValue: T) {
        this.buffer.push(EventNodeValueChangeOperation.lazy(this.target as any, userValue));
    }
    get evaluator() {
        return this.target.evaluator;
    }

    set evaluator(evaluator: Evaluator<T>) {
        this.buffer.push(EventNodeEvaluatorChangeOperation.lazy(this.target as any, evaluator));
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


class OperableEventNodeSequenceSlice<T extends EventValueESType> extends Operable {
    constructor(public target: EventNodeSequence<T>, buffer: Operation[], chart: Chart, public start?: number, public end?: number) {
        super(buffer, chart);
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

export function useToOperable(chart: Chart): ToOperable {
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