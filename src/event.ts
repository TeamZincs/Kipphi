import type { Chart } from "./chart";
import { EventType, type TimeT, type EventDataKPA, type RGB, type EventDataRPELike, InterpreteAs, type ValueTypeOfEventType, type EventNodeSequenceDataKPA, type EventDataKPA2, type EventNodeSequenceDataKPA2, type EventValueESType, EventValueType, EventValueTypeOfType } from "./chartTypes";
import { TemplateEasingLib, BezierEasing, Easing, rpeEasingArray, SegmentedEasing, linearEasing, fixedEasing, TemplateEasing, NormalEasing } from "./easing";
import { ColorEasedEvaluator, EasedEvaluator, ExpressionEvaluator, NumericEasedEvaluator, TextEasedEvaluator, type Evaluator } from "./evaluator";
import { JumpArray } from "./jumparray";

import TC from "./time";
import { type TimeCalculator } from "./bpm";
import { NodeType } from "./util";

import { err } from "./env";

/// #declaration:global
export class EventNodeLike<T extends NodeType, VT = number> {
    type: T;
    /** 后一个事件节点 */
    next: [EventStartNode<VT>, null, ENOrTail<VT>][T] | null = null;
    /** 前一个事件节点 */
    previous: [null, EventStartNode<VT>, ENOrHead<VT>][T] | null = null;
    parentSeq!: EventNodeSequence<VT>;
    constructor(type: T) {
        this.type = type;
    }
}
export type ENOrTail<VT = number> = EventNode<VT> | EventNodeLike<NodeType.TAIL, VT>;
export type ENOrHead<VT = number> = EventNode<VT> | EventNodeLike<NodeType.HEAD, VT>;
export type AnyEN<VT = number> = EventNode<VT> | EventNodeLike<NodeType.HEAD, VT> | EventNodeLike<NodeType.TAIL, VT>;
export type EvSoE<VT = number>    = EventEndNode<VT> | EventStartNode<VT>;

/**
 * 事件节点基类
 * event node.
 * 用于代表事件的开始和结束。（EventStartNode表开始，EventEndNode表结束）
 * Used to represent the starts (EventStartNode) and ends (EventEndNode) of events.
 * 事件指的是判定线在某个时间段上的状态变化。
 * Events is the changing of judge line's state in a certain time.
 * 五种事件类型：移动X，移动Y，旋转，透明度，速度。
 * 5 basic types of events: moveX, moveY, rotate, alpha, speed.
 * 事件节点没有类型，类型由它所属的序列决定。
 * Type is not event nodes' property; it is the property of EventNodeSequence.
 * Events' type is determined by which sequence it belongs to.
 * 与RPE不同的是，KPA使用两个节点来表示一个事件，而不是一个对象。
 * Different from that in RPE, KPA uses two nodes rather than one object to represent an event.
 */
export abstract class EventNode<VT = number> extends EventNodeLike<NodeType.MIDDLE, VT> {
    time: TimeT;
    value: VT;
    evaluator: Evaluator<VT>;
    constructor(time: TimeT, value: VT) {
        super(NodeType.MIDDLE);
        this.time = TC.validateIp([...time]);
        // @ts-ignore 不清楚什么时候会是undefined，但是留着准没错
        this.value = value ?? 0;
        if (typeof value === "number") {
            this.evaluator = NumericEasedEvaluator.default as unknown as Evaluator<VT>;
        } else if (typeof value === "string") {
            this.evaluator = TextEasedEvaluator.default as unknown as Evaluator<VT>;
        } else {
            this.evaluator = ColorEasedEvaluator.default as unknown as Evaluator<VT>;
        }
    }
    clone(offset: TimeT): EventStartNode<VT> | EventEndNode<VT> {
        const ret = new (this.constructor as (typeof EventStartNode | typeof EventEndNode))
                        (offset ? TC.add(this.time, offset) : this.time, this.value);
        ret.evaluator = this.evaluator;
        return ret;
    }
    //#region 
    /**
     * 
     * @param data 
     * @param templates 
     * @returns 
     * @deprecated
     */
    static getEasing(data: EventDataKPA<EventValueESType>, templates: TemplateEasingLib, notSegmented = false): Easing {
        const left = data.easingLeft;
        const right = data.easingRight;
        if (!notSegmented && (left && right) && (left !== 0.0 || right !== 1.0)) {
            return new SegmentedEasing(EventNode.getEasing(data, templates, true), left, right)
        }
        if (data.bezier) {
            const bp = data.bezierPoints
            const easing = new BezierEasing([bp[0], bp[1]], [bp[2], bp[3]]);
            return easing
        } else if (typeof data.easingType === "string") {
            return templates.get(data.easingType);
        } else if (typeof data.easingType === "number" && data.easingType !== 0) {
            return rpeEasingArray[data.easingType];
        } else if (data.start === data.end) {
            return fixedEasing;
        } else {
            return linearEasing;
        }
    }
    /**
     * 
     * @param data 
     * @param templates 
     * @returns 
     * @deprecated
     */
    static getEvaluator<VT extends EventValueESType>(data: EventDataKPA<VT>, templates: TemplateEasingLib, interpreteAs?: InterpreteAs): Evaluator<VT> {
        const left = data.easingLeft;
        const right = data.easingRight;
        const wrap = (easing: Easing): EasedEvaluator<VT> => {
            if (typeof data.start === "number") {
                return new NumericEasedEvaluator(easing) as EasedEvaluator<VT>;
            } else if (typeof data.start === "string") {
                // @ts-expect-error
                return new TextEasedEvaluator(easing, interpreteAs);
            } else {
                return new ColorEasedEvaluator(easing) as EasedEvaluator<VT>;
            }
        };
        if ((left && right) && (left !== 0.0 || right !== 1.0)) {
            return wrap(new SegmentedEasing(EventNode.getEasing(data, templates), left, right))
        }
        if (data.bezier) {
            const bp = data.bezierPoints
            const easing = new BezierEasing([bp[0], bp[1]], [bp[2], bp[3]]);
            return wrap(easing)
        } else if (data.isParametric) {
            if (typeof data.easingType !== "string") {
                throw new Error("Invalid easing: " + data.easingType);
            }
            return new ExpressionEvaluator(data.easingType);
        } else if (typeof data.easingType === "string") {
            return wrap(templates.get(data.easingType));
        } else if (typeof data.easingType === "number" && data.easingType !== 0) {
            return wrap(rpeEasingArray[data.easingType]);
        } else if (data.start === data.end) {
            return wrap(fixedEasing);
        } else {
            return wrap(linearEasing);
        }
    }
    /**
     * constructs EventStartNode and EventEndNode from EventDataRPE
     * @param data 
     * @param templates 
     * @returns 
     */
    static fromEvent<VT extends RGB | number>(data: EventDataRPELike<VT>, chart: Chart): [EventStartNode<VT>, EventEndNode<VT>] {
        const start = new EventStartNode(data.startTime, data.start)
        const end = new EventEndNode(data.endTime, data.end);
        start.evaluator = EventNode.getEvaluator(data, chart.templateEasingLib);
        EventNode.connect(start, end);
        return [start, end]
    }
    static fromTextEvent(data: EventDataRPELike<string>, templates: TemplateEasingLib) : [EventStartNode<string>, EventEndNode<string>] {
        let startValue = data.start;
        let endValue = data.end;
        let interpreteAs: InterpreteAs = InterpreteAs.str;
        if (/%P%/.test(startValue) && /%P%/.test(endValue)) {
            startValue = startValue.replace(/%P%/g, "");
            endValue = endValue.replace(/%P%/g, "");
            if (startValue.includes(".") || startValue.includes("e") || startValue.includes("E")
            ||  endValue.includes(".") || endValue.includes("e") || endValue.includes("E")) {
                startValue = parseFloat(startValue) + "";
                endValue = parseFloat(endValue) + "";
                interpreteAs = InterpreteAs.float;
            } else {
                startValue = parseInt(startValue) + "";
                endValue = parseInt(endValue) + "";
                interpreteAs = InterpreteAs.int;
            }
        }
        const start = new EventStartNode<string>(data.startTime, startValue);
        const end = new EventEndNode<string>(data.endTime, endValue);
        start.evaluator = EventNode.getEvaluator(data, templates, (data as unknown as EventDataKPA).interpreteAs ?? interpreteAs);
        EventNode.connect(start, end)
        return [start, end]
    }
    static connect<VT>(node1: EventStartNode<VT>, node2: EventEndNode<VT> | EventNodeLike<NodeType.TAIL, VT>): void
    static connect<VT>(node1: EventEndNode<VT> | EventNodeLike<NodeType.HEAD, VT>, node2: EventStartNode<VT>): void
    static connect<VT>(node1: ENOrHead<VT>, node2: ENOrTail<VT>): void {
        node1.next = node2;
        node2.previous = node1;
        if (node1 && node2) {
            node2.parentSeq = node1.parentSeq
        }
    }
    /**
     * 
     * @param endNode 
     * @param startNode 
     * @returns 应该在何范围内更新跳数组
     */
    static removeNodePair<VT>(endNode: EventEndNode<VT>, startNode: EventStartNode<VT>): [EventStartNode<VT> | EventNodeLike<NodeType.HEAD, VT>, EventStartNode<VT> | EventNodeLike<NodeType.TAIL,VT>] {
        const prev = endNode.previous;
        const next = startNode.next;
        prev.next = next;
        next.previous = prev;
        endNode.previous = null;
        startNode.next = null;
        endNode.parentSeq = null;
        startNode.parentSeq = null; // 每亩的东西（
        return [this.previousStartOfStart(prev), this.nextStartOfEnd(next)]
    }
    static insert<VT>(node: EventStartNode<VT>, tarPrev: EventStartNode<VT>): [EventNodeLike<NodeType.HEAD, VT> | EventStartNode<VT>, EventStartNode<VT> | EventNodeLike<NodeType.TAIL, VT>] {
        const tarNext = tarPrev.next;
        if (node.previous.type === NodeType.HEAD) {
            throw err.CANNOT_INSERT_BEFORE_HEAD();
        }
        this.connect(tarPrev, node.previous);
        node.parentSeq = node.previous.parentSeq;
        this.connect(node, tarNext);
        return [this.previousStartOfStart(tarPrev), this.nextStartOfEnd(tarNext)]
    }
    /**
     * 
     * @param node 
     * @returns the next node if it is a tailer, otherwise the next start node
     */
    static nextStartOfStart<VT>(node: EventStartNode<VT>) {
        return node.next.type === NodeType.TAIL ? node.next : node.next.next
    }
    /**
     * 
     * @param node 
     * @returns itself if node is a tailer, otherwise the next start node
     */
    static nextStartOfEnd<VT>(node: EventEndNode<VT> | EventNodeLike<NodeType.TAIL, VT>) {
        return node.type === NodeType.TAIL ? node : node.next
    }
    static previousStartOfStart<VT>(node: EventStartNode<VT>): EventStartNode<VT> | EventNodeLike<NodeType.HEAD, VT> {
        return node.previous.type === NodeType.HEAD ? node.previous : node.previous.previous;
    }
    /**
     * It does not return the start node which form an event with it.
     * @param node 
     * @returns 
     */
    static secondPreviousStartOfEnd<VT>(node: EventEndNode<VT>): EventStartNode<VT> | EventNodeLike<NodeType.HEAD, VT> {
        return this.previousStartOfStart(node.previous);
    }
    static nextStartInJumpArray<VT>(node: EventStartNode<VT>): EventStartNode<VT> | EventNodeLike<NodeType.TAIL, VT> {
        if ((node.next as EventEndNode<VT>).next.isLastStart()) {
            return node.next.next.next as EventNodeLike<NodeType.TAIL, VT>;
        } else {
            return node.next.next;
        }
    }
    /**
     * 获得一对背靠背的节点。不适用于第一个StartNode
     * @param node 
     * @returns 
     */
    static getEndStart<VT>(node: EventStartNode<VT> | EventEndNode<VT>): [EventEndNode<VT>, EventStartNode<VT>] {
        if (node instanceof EventStartNode) {
            if (node.isFirstStart()) {
                throw new Error("Cannot get previous start node of the first start node");
            }
            return [<EventEndNode<VT>>node.previous, node]
        } else if (node instanceof EventEndNode) {
            return [node, node.next]
        }
    }
    static getStartEnd<VT>(node: EventStartNode<VT> | EventEndNode<VT>): [EventStartNode<VT>, EventEndNode<VT>] {
        if (node instanceof EventStartNode) {
            return [node, <EventEndNode<VT>>node.next]
        } else if (node instanceof EventEndNode) {
            return [<EventStartNode<VT>>node.previous, node]
        } else {
            throw new Error("unreachable");
        }
    }
    static setToNewOrderedArray<VT>(dest: TimeT, set: Set<EventStartNode<VT>>): [EventStartNode<VT>[], EventStartNode<VT>[]] {
        const nodes = [...set]
        nodes.sort((a, b) => TC.gt(a.time, b.time) ? 1 : -1);
        const offset = TC.sub(dest, nodes[0].time)
        return [nodes, nodes.map(node => node.clonePair(offset))]
    }
    static belongToSequence(nodes: Set<EventStartNode>, sequence: EventNodeSequence): boolean {
        for (const each of nodes) {
            if (each.parentSeq !== sequence) {
                return false;
            }
        }
        return true;
    }
    /**
     * 检验这些节点对是不是连续的
     * 如果不是不能封装为模板缓动
     * @param nodes 有序开始节点数组，必须都是带结束节点的（背靠背）（第一个除外）
     * @returns 
     */
    static isContinuous(nodes: EventStartNode[]) {
        const l = nodes.length;
        let nextNode = nodes[0]
        for (let i = 0; i < l - 1; i++) {
            const node = nextNode;
            nextNode = nodes[i + 1];
            if (node.next !== nextNode.previous) {
                return false;
            }
        }
        return true;
    }
    // #endregion
}

export class EventStartNode<VT = number> extends EventNode<VT> {
    override next: EventEndNode<VT> | EventNodeLike<NodeType.TAIL, VT>;
    override previous: EventEndNode<VT> | EventNodeLike<NodeType.HEAD, VT>;
    /** 
     * 对于速度事件，从计算时的时刻到此节点的总积分
     */
    cachedIntegral?: number;
    constructor(time: TimeT, value: VT) {
        super(time, value);
    }
    override parentSeq: EventNodeSequence<VT>;
    /**
     * 因为是RPE和KPA共用的方法所以easingType可以为字符串
     * @returns 
     */
    dump(): EventDataKPA2<VT> {

        const endNode = this.next as EventEndNode<VT>;
        return {
            start: this.value,
            end: endNode.value,
            startTime: this.time,
            endTime: endNode.time,
            evaluator: this.evaluator.dump(),
        }
    }
    getValueAt(beats: number): VT {
        // 除了尾部的开始节点，其他都有下个节点
        // 钩定型缓动也有
        if (this.next.type === NodeType.TAIL) {
            return this.value;
        }
        return this.evaluator.eval(this, beats);
    }
    getSpeedValueAt(this: EventStartNode<number>, beats: number) {
        if (this.next.type === NodeType.TAIL) {
            return this.value;
        }
        const timeDelta = TC.getDelta(this.next.time, this.time);
        const valueDelta = this.next.value - this.value;
        const current = beats - TC.toBeats(this.time);
        return this.value + linearEasing.getValue(current / timeDelta) * valueDelta;
    }
    /**
     * 积分获取位移
     */
    getFloorPos(this: EventStartNode<number>, beats: number, timeCalculator: TimeCalculator) {
        return timeCalculator.segmentToSeconds(TC.toBeats(this.time), beats) * (this.value + this.getSpeedValueAt(beats)) / 2 * 120 // 每单位120px
    }
    getFullFloorPos(this: EventStartNode<number>, timeCalculator: TimeCalculator) {
        if (this.next.type === NodeType.TAIL) {
            console.log(this)
            throw err.CANNOT_GET_FULL_INTEGRAL_OF_FINAL_START_NODE();
        }
        const end = this.next;
        const endBeats = TC.toBeats(end.time)
        const startBeats = TC.toBeats(this.time)
        // 原来这里写反了，气死偶咧！
        return timeCalculator.segmentToSeconds(startBeats, endBeats) * (this.value + end.value) / 2 * 120
    }
    isFirstStart() {
        return this.previous && this.previous.type === NodeType.HEAD
    }
    isLastStart() {
        return this.next && this.next.type === NodeType.TAIL
    }
    override clone(offset?: TimeT): EventStartNode<VT> {
        return super.clone(offset) as EventStartNode<VT>;
    };
    clonePair(offset: TimeT): EventStartNode<VT> {
        const endNode = this.previous.type !== NodeType.HEAD ? this.previous.clone(offset) : new EventEndNode(this.time, this.value);
        const startNode = this.clone(offset);
        EventNode.connect(endNode, startNode);
        return startNode;
    };
}

export type NonLastStartNode<VT extends EventValueESType> = EventStartNode<VT> & {next: EventEndNode<VT>}

export class EventEndNode<VT = number> extends EventNode<VT> {
    override next!: EventStartNode<VT>;
    override previous!: EventStartNode<VT>;
    override get parentSeq(): EventNodeSequence<VT> {return this.previous?.parentSeq || null}
    override set parentSeq(_parent: EventNodeSequence<VT>) {}
    constructor(time: TimeT, value: VT) {
        super(time, value);
    }
    getValueAt(beats: number) {
        return this.previous.getValueAt(beats);
    }
    override clone(offset?: TimeT): EventEndNode<VT> {
        return super.clone(offset) as EventEndNode<VT>;
    }
}


/**
 * 为一个链表结构。会有一个数组进行快跳。
 * is the list of event nodes, but not purely start nodes.
 * 
 * 结构如下：Header -> (StartNode -> [EndNode) -> (StartNode] -> [EndNode) -> ... -> StartNode] -> Tailer.
 * The structure is like this: Header -> (StartNode -> [EndNode) -> (StartNode] -> [EndNode) -> ... -> StartNode] -> Tailer.
 * 
 * 用括号标出的两个节点是一个事件，用方括号标出的两个节点是同一时间点的节点。
 * The each 2 nodes marked by parentheses is an event; the each 2 nodes marked by brackets have the same time.
 * 
 * 注意尾节点之前的节点不是一个结束节点，而是一个开始节点，其缓动无效。
 * Note that the node before the tailer is not an end node, but a start node whose easing is meaningless.
 * 
 * 就是说最后一个节点后取值，显然会取得这个节点的值，与缓动无关。
 * (i. e. the value after the last event node is its value, not subject to easing, obviously.)
 * 
 * 如果尾之前的节点是一个结束节点，那么取值会返回undefined，这是不期望的。
 * If so, the value after that will be undefined, which is not expected.
 * ("so" refers to the assumption that the node before the tailer is an end node)
 * 
 * 和NNList和NNNList一样，有跳数组以加速随机读取。
 * Like NNList and NNNList, it has a jump array to speed up random reading.
 * 
 * 插入或删除节点时，需要更新跳数组。
 * Remember to update the jump array when inserting or deleting nodes.
 */
export class EventNodeSequence<VT = number> { // 泛型的传染性这一块
    chart: Chart;
    /** id follows the format `#${lineid}.${layerid}.${typename}` by default */
    id: string;
    /** has no time or value */
    head: EventNodeLike<NodeType.HEAD, VT>;
    /** has no time or value */
    tail: EventNodeLike<NodeType.TAIL, VT>;
    jump?: JumpArray<AnyEN<VT>>;
    listLength: number;
    /** 一定是二的幂，避免浮点误差 */
    jumpAverageBeats: number;
    // nodes: EventNode[];
    // startNodes: EventStartNode[];
    // endNodes: EventEndNode[];
    // eventTime: Float64Array;
    constructor(public type: EventType, public effectiveBeats: number) {
        this.head = new EventNodeLike(NodeType.HEAD);
        this.tail = new EventNodeLike(NodeType.TAIL);
        this.head.parentSeq = this.tail.parentSeq = this;
        this.listLength = 1;
        // this.head = this.tail = new EventStartNode([0, 0, 0], 0)
        // this.nodes = [];
        // this.startNodes = [];
        // this.endNodes = [];
    }
    static getDefaultValueFromEventType(type: EventType) {
        
        return type === EventType.speed                               ? 10  :
               type === EventType.scaleX || type === EventType.scaleY ? 1.0 :
               type === EventType.text                                ? ""  :
               type === EventType.color                               ? [0, 0, 0] :
               0
    }
    static fromRPEJSON<T extends EventType, VT = number>(type: T, data: EventDataRPELike<VT>[], chart: Chart, pos: string, endValue?: number) {
        const {templateEasingLib: templates} = chart
        const length = data.length;
        // const isSpeed = type === EventType.Speed;
        // console.log(isSpeed)
        const seq = new EventNodeSequence<VT>(type, type === EventType.easing ? TC.toBeats(data[length - 1].endTime) : chart.effectiveBeats);
        let listLength = length;
        let lastEnd: EventEndNode<VT> | EventNodeLike<NodeType.HEAD, VT> = seq.head;
        // 如果第一个事件不从0时间开始，那么添加一对面对面节点来垫背
        if (data[0] && TC.ne(data[0].startTime, [0, 0, 1])) {
            const value = data[0].start
            const start = new EventStartNode<VT>([0, 0, 1], value as VT);
            const end = new EventEndNode<VT>(data[0].startTime, value as VT);
            EventNode.connect(lastEnd, start);
            EventNode.connect(start, end);
            lastEnd = end;
        }

        let lastEndTime: TimeT = [0, 0, 1];
        for (let index = 0; index < length; index++) {
            const event = data[index];
            if (TC.lt(event.startTime, lastEndTime)) { // event.startTime < lastEndTime
                err.EVENT_NODE_TIME_NOT_INCREMENTAL(`${pos}.events[${index}] and the previous`).warn()
            }
            if (!TC.lt(event.startTime, event.endTime)) {
                err.EVENT_NODE_TIME_NOT_INCREMENTAL(`${pos}.events[${index}]`).warn()
            }
            lastEndTime = event.endTime;
            const [start, end] = (type === EventType.text ? EventNode.fromTextEvent(event as EventDataRPELike<string>, templates) : EventNode.fromEvent(event as EventDataRPELike<number | RGB>, chart)) as unknown as [EventStartNode<VT>, EventEndNode<VT>];
            if (lastEnd.type === NodeType.HEAD) {
                EventNode.connect(lastEnd, start)
            // 如果上一个是钩定事件，那么一块捋平
            } else if (lastEnd.value === lastEnd.previous.value && lastEnd.previous.evaluator instanceof EasedEvaluator) {
                lastEnd.time = start.time
                EventNode.connect(lastEnd, start)
            } else if (TC.toBeats(lastEnd.time) !== TC.toBeats(start.time)) {
                const val = lastEnd.value;
                const midStart = new EventStartNode(lastEnd.time, val);
                const midEnd = new EventEndNode(start.time, val);
                midStart.evaluator = lastEnd.previous.evaluator;
                EventNode.connect(lastEnd, midStart);
                EventNode.connect(midStart, midEnd);
                EventNode.connect(midEnd, start)
                // seq.startNodes.push(midStart);
                // seq.endNodes.push(midEnd);
                listLength++;
            } else {
                
                EventNode.connect(lastEnd, start)
            }
            
            // seq.startNodes.push(start);
            // seq.endNodes.push(end);
            lastEnd = end;
            // seq.nodes.push(start, end);
        }
        const last = lastEnd;
        const tail = new EventStartNode(
            last.type === NodeType.HEAD ? [0, 0, 1] : last.time,
            endValue ?? last.value
        );
        EventNode.connect(last, tail);
        // last can be a header, in which case easing is undefined.
        // then we use the easing that initialized in the EventStartNode constructor.
        tail.evaluator = last.previous?.evaluator ?? tail.evaluator;
        EventNode.connect(tail, seq.tail)
        seq.listLength = listLength;
        seq.initJump();
        return seq;
    }
    static fromKPA2JSON<T extends EventType, VT extends EventValueESType = number>(type: T, data: EventDataKPA2<VT>[], chart: Chart, pos: string, endValue?: VT) {
        const {templateEasingLib: templates} = chart
        const length = data.length;
        // const isSpeed = type === EventType.Speed;
        // console.log(isSpeed)
        const seq = new EventNodeSequence<VT>(type, type === EventType.easing ? TC.toBeats(data[length - 1].endTime) : chart.effectiveBeats);
        let listLength = length;
        let lastEnd: EventEndNode<VT> | EventNodeLike<NodeType.HEAD, VT> = seq.head;
        // 如果第一个事件不从0时间开始，那么添加一对面对面节点来垫背
        if (data[0] && TC.ne(data[0].startTime, [0, 0, 1])) {
            const value = data[0].start
            const start = new EventStartNode<VT>([0, 0, 1], value as VT);
            const end = new EventEndNode<VT>(data[0].startTime, value as VT);
            EventNode.connect(lastEnd, start);
            EventNode.connect(start, end);
            lastEnd = end;
        }

        const valueType = (type === EventType.color ? EventValueType.color
                        : type === EventType.text  ? EventValueType.text
                        : EventValueType.numeric) as EventValueTypeOfType<VT>;



        let lastEndTime: TimeT = [0, 0, 1];
        for (let index = 0; index < length; index++) {
            const event = data[index];
            const [start, end] = chart.createEventFromData<VT>(event, valueType);
            // 复用性减一
            if (TC.lt(event.startTime, lastEndTime)) { // event.startTime < lastEndTime
                err.EVENT_NODE_TIME_NOT_INCREMENTAL(`${pos}.events[${index}] and the previous`).warn()
            }
            if (!TC.lt(event.startTime, event.endTime)) {
                err.EVENT_NODE_TIME_NOT_INCREMENTAL(`${pos}.events[${index}]`).warn()
            }
            lastEndTime = event.endTime;
            if (lastEnd.type === NodeType.HEAD) {
                EventNode.connect(lastEnd, start)
            // 如果上一个是钩定事件，那么一块捋平
            } else if (lastEnd.value === lastEnd.previous.value && lastEnd.previous.evaluator instanceof EasedEvaluator) {
                lastEnd.time = start.time
                EventNode.connect(lastEnd, start)
            } else if (TC.toBeats(lastEnd.time) !== TC.toBeats(start.time)) {
                const val = lastEnd.value;
                const midStart = new EventStartNode(lastEnd.time, val);
                const midEnd = new EventEndNode(start.time, val);
                midStart.evaluator = lastEnd.previous.evaluator;
                EventNode.connect(lastEnd, midStart);
                EventNode.connect(midStart, midEnd);
                EventNode.connect(midEnd, start);
                listLength++;
            } else {
                
                EventNode.connect(lastEnd, start)
            }
            
            lastEnd = end;
        }
        const last = lastEnd;
        const tail = new EventStartNode(
            last.type === NodeType.HEAD ? [0, 0, 1] : last.time,
            last.type === NodeType.HEAD ? endValue : last.value
        );
        EventNode.connect(last, tail);
        // last can be a header, in which case easing is undefined.
        // then we use the easing that initialized in the EventStartNode constructor.
        tail.evaluator = last.previous?.evaluator ?? tail.evaluator;
        EventNode.connect(tail, seq.tail)
        seq.listLength = listLength;
        seq.initJump();
        return seq;
    }
    /**
     * 生成一个新的事件节点序列，仅拥有一个节点。
     * 需要分配ID！！！！！！
     * @param type 
     * @param effectiveBeats 
     * @returns 
     */
    static newSeq<T extends EventType>(type: T, effectiveBeats: number): EventNodeSequence<ValueTypeOfEventType<T>> {
        type V = ValueTypeOfEventType<T>
        const sequence = new EventNodeSequence<V>(type, effectiveBeats);
        const node = new EventStartNode<V>(
            [0, 0, 1], EventNodeSequence.getDefaultValueFromEventType(type) as V
        );
        EventNode.connect(sequence.head, node)
        EventNode.connect(node, sequence.tail)
        sequence.initJump();
        return sequence;
    }
    initJump() {
        const originalListLength = this.listLength;
        const effectiveBeats: number = this.effectiveBeats;
        if (this.head.next === this.tail.previous) {
            return;
        }
        this.jump = new JumpArray<AnyEN<VT>>(
            this.head,
            this.tail,
            originalListLength,
            effectiveBeats,
            (node) => {
                // console.log(node)
                if (node.type === NodeType.TAIL) {
                    return [null, null]
                }
                if (node.type === NodeType.HEAD) {
                    if (node.next.next.type === NodeType.TAIL) {
                        return [0, node.next.next]
                    }
                    return [0, node.next]
                }
                const endNode = (node as EventStartNode<VT>).next as EventEndNode<VT>;
                const time = TC.toBeats(endNode.time);
                const nextNode = endNode.next;
                if (nextNode.next.type === NodeType.TAIL) {
                    return [time, nextNode.next] // Tailer代替最后一个StartNode去占位
                } else {
                    return [time, nextNode]
                }
            },
            (node: EventStartNode<VT>, beats: number) => {
                return TC.toBeats((node.next as EventEndNode<VT>).time) > beats ? false : EventNode.nextStartInJumpArray(node)
            },
            (node: EventStartNode) => {
                return node.next && node.next.type === NodeType.TAIL ? node.next : node;
            }
            /*(node: EventStartNode) => {
                const prev = node.previous;
                return prev.type === NodeType.HEAD ? node : prev.previous;
            }*/
            )
    }
    updateJump(from: ENOrHead<VT>, to: ENOrTail<VT>) {
        if (!this.jump || this.effectiveBeats !== this.jump.effectiveBeats) {
            this.initJump();

        }
        this.jump.updateRange(from, to);
    }
    insert() {

    }
    getNodeAt(beats: number, usePrev: boolean = false): EventStartNode<VT> {
        let node = this.jump?.getNodeAt(beats) as (EventStartNode<VT> | EventNodeLike<NodeType.TAIL, VT>)
                || this.head.next as (EventStartNode<VT> | EventNodeLike<NodeType.TAIL, VT>);
        if (node.type === NodeType.TAIL) {
            if (usePrev) {
                return node.previous.previous.previous;
            }
            // 最后一个事件节点本身具有无限延伸的特性
            return node.previous;
        }
        if (usePrev && TC.toBeats(node.time) === beats) {
            const prev = node.previous;
            if (!(prev.type === NodeType.HEAD)) {
                node = prev.previous;
            }
        }
        if (TC.toBeats(node.time) > beats && beats >= 0) {
            console.warn("Got a node after the given beats. This would only happen when the given beats is negative. Beats and Node:", beats, node)
        }
        return node;
    }
    getValueAt(beats: number, usePrev: boolean = false): VT {
        return this.getNodeAt(beats, usePrev).getValueAt(beats);
    }
    getIntegral(this: EventNodeSequence<number>, beats: number, timeCalculator: TimeCalculator) {
        const node: EventStartNode<number> = this.getNodeAt(beats);
        return node.getFloorPos(beats, timeCalculator) + node.cachedIntegral
    }
    updateNodesIntegralFrom(this: EventNodeSequence<number>, beats: number, timeCalculator: TimeCalculator) {
        let previousStartNode = this.getNodeAt(beats);
        previousStartNode.cachedIntegral = -previousStartNode.getFloorPos(beats, timeCalculator);
        let totalIntegral: number = previousStartNode.cachedIntegral
        let endNode: EventEndNode | EventNodeLike<NodeType.TAIL>;
        while ((endNode = previousStartNode.next).type !== NodeType.TAIL) {
            const currentStartNode = endNode.next
            totalIntegral += previousStartNode.getFullFloorPos(timeCalculator);
            currentStartNode.cachedIntegral = totalIntegral;
            previousStartNode = currentStartNode;
        }
    }
    dump(): EventNodeSequenceDataKPA2<VT> {
        const nodes: EventDataKPA2<VT>[] = [];
        let currentNode: EventStartNode<VT> = this.head.next;

        while (currentNode && !(currentNode.next.type === NodeType.TAIL)) {
            const eventData = currentNode.dump();
            nodes.push(eventData);
            currentNode = currentNode.next.next;
        }

        return {
            type: this.type,
            events: nodes,
            id: this.id,
            endValue: currentNode.value
        };
    }

    getNodesFromOneAndRangeRight(node: EventStartNode<VT>, rangeRight: TimeT) {
        const arr = []
        for (; !TC.gt(node.time, rangeRight); ) {
            const next = node.next;
            arr.push(node);
            if (next.type === NodeType.TAIL) {
                break;
            }
            node = next.next;
        }
        return arr;
    }
    getNodesAfterOne(node: EventStartNode<VT>) {
        const arr = []
        while (true) {
            const next = node.next;
            if (next.type === NodeType.TAIL) {
                break;
            }
            node = next.next;
            arr.push(node);
        }
        return arr;
    }
}

/// #enddeclaration
