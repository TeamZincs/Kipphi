import type { Chart } from "../chart";
import { EventType, VideoScale, type EventValueESType, type TimeT } from "../chartTypes";
import { TemplateEasing, TemplateEasingLib } from "../easing";
import { err } from "../env";
import { Evaluator, EasedEvaluator, NumericEasedEvaluator } from "../evaluator";
import { EventEndNode, EventStartNode, EventNodeSequence, EventNode, SpeedENS, NonLastStartNode, EventNodeLike } from "../event";
import TC from "../time";
import { NodeType } from "../util";
import { VideoEventStartNode } from "../video";
import { ComplexOperation, LazyOperation, Operation, UnionOperation } from "./basic";

/**
 * 移除一对节点（背靠背）
 *
 * 内部会连同左侧面对面的 EndNode 一起摘掉，等于删掉
 * `[上一时刻, 该节点时刻]` 这一段事件。首节点或已脱离序列的节点会静默失效。
 *
 * @example
 * ```ts
 * // 删掉 4 拍处的那个事件段
 * operations.do(new EventNodePairRemoveOperation(seq.getNodeAt(4)));
 * ```
 */
export class EventNodePairRemoveOperation extends Operation {
    updatesEditor = true;
    endNode: EventEndNode<any>;
    startNode: EventStartNode<any>;
    sequence: EventNodeSequence<any>;
    originalPrev: EventStartNode<any>;
    updatesFP = false;
    constructor(node: EventStartNode<any>, updatesFP = true) {
        super();
        if (node.previous === null) {
            this.ineffective = true;
            return;
        }
        if (node.isFirstStart()) {
            this.ineffective = true;
            return;
        }
        this.sequence = this.startNode.parentSeq;
        if (!this.sequence) {
            throw err.PARENT_SEQUENCE_NOT_FOUND(node.time);
        }
        if (node.isSpeed()) {
            this.updatesFP = updatesFP;
        }
        [this.endNode, this.startNode] = EventNode.getEndStart(node)
        this.originalPrev = (<EventEndNode>node.previous).previous;
    }
    do(chart: Chart) {
        this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
        if (this.updatesFP) {
            // updatesFP的校验确保了序列为速度序列
            (this.sequence as SpeedENS).updateFloorPositionAfter(this.originalPrev, chart.timeCalculator) 
        }
        
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }
    undo(chart: Chart) {
        this.sequence.updateJump(...EventNode.insert(this.startNode, this.originalPrev))
        if (this.updatesFP) {
            (this.sequence as SpeedENS).updateFloorPositionAfter(this.originalPrev, chart.timeCalculator) 
        }
        
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }
}

/**
 * 将一对孤立的节点对插入到一个开始节点之后的操作。
 * 
 * 如果这个节点对的时刻与节点对的时刻相同，那么抛出错误。
 *
 * @example
 * ```ts
 * const start = new EventStartNode([4, 0, 1], 1);
 * const end = new EventEndNode([6, 0, 1], 2);
 * EventNode.connect(start, end);
 * // 插到 2 拍所在节点之后
 * operations.do(new EventNodePairInsertOperation.lazy(start, seq.getNodeAt(2)));
 * ```
 */
export class EventNodePairInsertOperation <VT extends EventValueESType> extends Operation {
    updatesEditor = true
    node: EventStartNode<VT>;
    tarPrev: EventStartNode<VT>;
    sequence: EventNodeSequence<VT>;
    originalValue: VT;
    value: VT;
    updatesFP = false;
    /**
     * 
     * @param node 要插入的节点 the node to insert 
     * @param targetPrevious 要插在谁后面 The node to insert after, accessed through `EventNodeSequence.getNodeAt(TC.toBeats(node))`
     */
    constructor(node: EventStartNode<VT>, targetPrevious: EventStartNode<VT>, updatesFP = true) {
        super()
        this.node = node;
        this.tarPrev = targetPrevious
        this.sequence = targetPrevious.parentSeq
        if (TC.eq(node.time, targetPrevious.time)) {
            throw err.SEQUENCE_NODE_TIME_OCCUPIED(node.time, this.sequence.id);
        }
        if (!this.sequence) {
            throw err.PARENT_SEQUENCE_NOT_FOUND(targetPrevious?.time);
        }
        this.updatesFP = updatesFP && targetPrevious.isSpeed();
    }
    do(chart: Chart) {
        const [endNode, startNode] = EventNode.insert(this.node, this.tarPrev);
        this.sequence.updateJump(endNode, startNode)
        if (this.updatesFP) {
            // updatesFP的校验确保了序列为速度序列
            (this.sequence as unknown as SpeedENS).updateFloorPositionAfter(this.tarPrev as unknown as EventStartNode<number>, chart.timeCalculator) 
        }
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }
    undo(chart: Chart) {
        this.sequence.updateJump(...EventNode.removeNodePair(...EventNode.getEndStart(this.node)))
        if (this.updatesFP) {
            // updatesFP的校验确保了序列为速度序列
            (this.sequence as unknown as SpeedENS).updateFloorPositionAfter(this.tarPrev as unknown as EventStartNode<number>, chart.timeCalculator) 
        }
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }
}

/**
 * 插入或覆盖：目标时刻已有事件就改值，否则插入新事件。
 *
 * 走哪条路由内部的 UnionOperation 在构造时决定，`overlapping` 为 true
 * 表示最终是"覆盖"。插入分支用懒操作包裹，避免构造器误判在连接孤立节点。
 *
 * @example
 * ```ts
 * // 4 拍处有事件就改值，没有就插入
 * operations.do(new EventNodePairInsertOrOverwriteOperation(node, seq.getNodeAt(4)));
 * ```
 */
export class EventNodePairInsertOrOverwriteOperation <VT extends EventValueESType>
extends UnionOperation<LazyOperation<typeof EventNodePairInsertOperation<VT>> | EventNodeValueChangeOperation<VT>> {
    overlapping: boolean = false;
    constructor(node: EventStartNode<VT>, targetPrevious: EventStartNode<VT>, updatesFP = true) {
        const equalTime = TC.eq(node.time, targetPrevious.time);
        super(() => {
            if (equalTime) {
                return new EventNodeValueChangeOperation(targetPrevious, node.value);
            } else {
                return EventNodePairInsertOperation.lazy<typeof EventNodePairInsertOperation<VT>>(node, targetPrevious, updatesFP);
                // 此处使用懒操作，防止构造器认为自己在连接两个孤立节点而报错
            }
        });
        if (equalTime) {
            this.overlapping = true;
        }
    }
}

/**
 * 自动定位插入点的插入操作。
 *
 * 与 {@linkcode EventNodePairInsertOperation} 的区别是不用自己算前一个节点，
 * 内部按节点时刻调用 `parentSeq.getNodeAt()` 去找。
 *
 * @example
 * ```ts
 * const node = new EventStartNode([4, 0, 1], 1.0);
 * operations.do(new EventNodePairAutoInsertOperation(node, seq));
 * ```
 */
export class EventNodePairAutoInsertOperation<VT extends EventValueESType> extends EventNodePairInsertOperation<VT> {
    constructor(node: EventStartNode<VT>, parentSeq: EventNodeSequence<VT>, updatesFP = true) {
        super(node, parentSeq.getNodeAt(TC.toBeats(node.time)), updatesFP);
    }
}

/**
 * 修改某个事件节点的值。
 *
 * 会自动重算速度序列的 floorPosition 与 BPM 缓存；节点已脱离序列时只改值。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeValueChangeOperation(startNode, 2.0));
 * ```
 */
export class EventNodeValueChangeOperation <VT extends EventValueESType> extends Operation {
    updatesEditor = true
    node: EventNode<VT>
    value: VT;
    originalValue: VT
    constructor(node: EventNode<VT>, val: VT) {
        super()
        this.node = node
        this.value = val;
        this.originalValue = node.value
    }
    do(chart: Chart) {
        this.node.value = this.value;
        if (!this.node.parentSeq) {
            return;
        }
        if (this.node.parentSeq.type === EventType.speed) {
            this.updateSpeedENS(chart, this.node.parentSeq as unknown as SpeedENS);
        } else if (this.node.parentSeq.type === EventType.bpm) {
            chart.timeCalculator.bpmSequence.updateSecondJump();
            chart.updateAllFloorPositions();
        }
    }
    undo(chart: Chart) {
        this.node.value = this.originalValue;
        if (!this.node.parentSeq) {
            return;
        }
        if (this.node.parentSeq.type === EventType.speed) {
            this.updateSpeedENS(chart, this.node.parentSeq as unknown as SpeedENS);
        } else if (this.node.parentSeq.type === EventType.bpm) {
            chart.timeCalculator.bpmSequence.updateSecondJump();
            chart.updateAllFloorPositions();
        }
    }
    updateSpeedENS(chart: Chart, seq: SpeedENS) {
        seq.updateFloorPositionAfter(
            EventNode.getStartEnd(this.node as unknown as EventStartNode<number> | EventEndNode<number>)[0],
            chart.timeCalculator
        );
    }
    rewrite(operation: EventNodeValueChangeOperation<VT>, chart: Chart): boolean {
        if (operation.node === this.node) {
            this.value = operation.value;
            this.node.value = operation.value;
            
            if (!this.node.parentSeq) {
                return true;
            }
            if (this.node.parentSeq.type === EventType.speed) {
                this.updateSpeedENS(chart, this.node.parentSeq as unknown as SpeedENS);
            } else if (this.node.parentSeq.type === EventType.bpm) {
                chart.timeCalculator.bpmSequence.updateSecondJump();
                chart.updateAllFloorPositions();
            }
            return true;
        }
        return false;
    }
}

/**
 * 修改事件的发生时刻。
 *
 * 传入 StartNode 或 EndNode 都可以，内部会把它所属的一对背靠背节点整体
 * 搬到新时刻，并重新接好前后连接与跳数组。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeTimeChangeOperation(startNode, [4, 0, 1]));
 * ```
 */
export class EventNodeTimeChangeOperation extends Operation {
    updatesEditor = true
    sequence: EventNodeSequence;
    /**
     * 这里两个node不是面对面，而是背靠背
     * i. e. EndNode -> StartNode
     */
    startNode: EventStartNode<any>;
    endNode: EventEndNode<any>;
    value: TimeT;
    originalValue: TimeT;
    originalPrevious: EventStartNode<any>;
    newPrevious: EventStartNode<any>;
    constructor(node: EventStartNode<any> | EventEndNode<any>, val: TimeT) {
        super()
        if (node.previous.type === NodeType.HEAD) {
            this.ineffective = true;
            return;
        }
        if (!TC.gt(val, [0, 0, 1])) {
            this.ineffective = true;
            return;
        }
        [this.endNode, this.startNode] = EventNode.getEndStart(node);
        const seq = this.sequence = node.parentSeq;
        if (!seq) {
            throw err.PARENT_SEQUENCE_NOT_FOUND(node.time);
        }
        const mayBeThere = seq.getNodeAt(TC.toBeats(val))
        if (mayBeThere && TC.eq(mayBeThere.time, val)) { // 不是arrayEq，这里踩坑
            this.ineffective = true;
            return;
        }
        this.originalPrevious = this.endNode.previous;
        this.newPrevious = mayBeThere === this.startNode ? (<EventEndNode>this.startNode.previous).previous : mayBeThere
        this.value = val;
        this.originalValue = node.time
        console.log("操作：", this)
    }
    do(chart: Chart) { // 这里其实还要设计重新选址的问题
        this.startNode.time = this.endNode.time = this.value;
        if (this.newPrevious !== this.originalPrevious) {
            this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
            EventNode.insert(this.startNode, this.newPrevious)
        }
        this.sequence.updateJump(EventNode.previousStartOfStart(this.endNode.previous), EventNode.nextStartOfStart(this.startNode));
        
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }
    undo(chart: Chart) {
        this.endNode.time = this.startNode.time = this.originalValue;
        if (this.newPrevious !== this.originalPrevious) {
            this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
            EventNode.insert(this.startNode, this.originalPrevious)
        }
        this.sequence.updateJump(this.endNode.previous, EventNode.nextStartOfStart(this.startNode));
        
        if (this.sequence.type === EventType.bpm) {
            chart.updateAllFloorPositions();
        }
    }

}


/**
 * 替换事件节点的求值器（缓动 / 表达式）。
 *
 * 若序列本身是缓动序列、且新求值器用的是模板缓动，构造时会检查循环引用。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeEvaluatorChangeOperation(
 *     startNode, new NumericEasedEvaluator(easeInOutSine)
 * ));
 * ```
 */
export class EventNodeEvaluatorChangeOperation <VT extends EventValueESType> extends Operation {
    updatesEditor = true
    originalValue: Evaluator<VT>
    constructor(public node: EventStartNode<VT>, public value: Evaluator<VT>) {
        super();
        this.originalValue = this.node.evaluator
        const seq = node.parentSeq;
        if (seq && seq.type === EventType.easing && value instanceof EasedEvaluator && value.easing instanceof TemplateEasing) {
            const circular = TemplateEasing.checkCircularReference(seq as unknown as EventNodeSequence<number>, value.easing);
            if (circular) {
                throw err.TEMPLATE_EASING_CIRCULAR_REFERENCE(value.easing.name);
            }
        }
    }
    do() {
        this.node.evaluator = this.value
    }
    undo() {
        this.node.evaluator = this.originalValue
    }
}




/**
 * 把一个事件按固定步长切分成多个节点。
 *
 * 只切分、不改形状——中间节点的值取自原事件曲线，所以撤销前后外观一致，
 * 之后就能单独编辑其中某一段。最后一刀不会落在终点上。
 *
 * @example
 * ```ts
 * // 每 1/4 拍切一刀
 * operations.do(new EventInterpolationOperation(startNode, [0, 1, 4]));
 * ```
 */
// 这个地方得懒一下，不然每亩，导致撤回操作时只能撤回第一个插值节点。
export class EventInterpolationOperation <VT extends EventValueESType> extends ComplexOperation<LazyOperation<typeof EventNodePairInsertOperation<VT>>[]> {
    updatesEditor = true;
    constructor(public eventStartNode: EventStartNode<VT>, public step: TimeT) {
        if (eventStartNode.next.type === NodeType.TAIL) {
            throw err.CANNOT_INTERPOLATE_TAILING_START_NODE();
        } 
        const subOps = [];
        const endTime = eventStartNode.next.time;
        let time = TC.validateIp(TC.add(eventStartNode.time, step));
        let lastStart = eventStartNode;
        for (; TC.lt(time, endTime); time = TC.validateIp(TC.add(time, step))) {
            const value = eventStartNode.getValueAt(TC.toBeats(time));
            const start = new EventStartNode(time, value);
            const end = new EventEndNode(time, value);
            EventNode.connect(end, start); // 之前搞成面对面了，写注释留念
            subOps.push(EventNodePairInsertOperation.lazy<typeof EventNodePairInsertOperation<VT>>(start, lastStart));
            lastStart = start;
        }
        super(...subOps);
    }
}




/**
 * 把使用模板缓动的事件，替换成模板内部节点展开后的等价事件序列。
 *
 * 结果曲线与模板缓动一致，但不再依赖模板库，便于导出到不支持模板的目标格式。
 *
 * @throws CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR 求值器不是缓动型
 * @throws MUST_INTERPOLATE_TEMPLATE_EASING 缓动不是模板缓动
 *
 * @example
 * ```ts
 * // 展开后这一段就变成普通事件，可以单独编辑
 * operations.do(new EventSubstituteOperation(startNode as NonLastStartNode<number>));
 * ```
 */
export class EventSubstituteOperation<VT extends EventValueESType> extends ComplexOperation<[...LazyOperation<typeof EventNodePairInsertOperation<VT>>[], EventNodeEvaluatorChangeOperation<VT>, EventNodeValueChangeOperation<VT>]> {
    updatesEditor = true;
    /**
     * 
     * @param node 
     * @throws {KPAError<ERROR_IDS.CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR>}
     * @throws {KPAError<ERROR_IDS.MUST_INTERPOLATE_TEMPLATE_EASING>}
     */
    constructor(public node: NonLastStartNode<VT>) {
        const evaluator = node.evaluator;
        if (!(evaluator instanceof EasedEvaluator)) {
            throw err.CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR();
        }
        const easing = evaluator.easing;
        if (!(easing instanceof TemplateEasing)) {
            throw err.MUST_INTERPOLATE_TEMPLATE_EASING();
        }
        const srcSeq = easing.eventNodeSequence;
        const srcStartTime = srcSeq.head.next!.time;
        const srcEndTime = srcSeq.tail.previous!.time;
        const srcTimeDelta = TC.vsub(srcEndTime, srcStartTime);
        const startValue = node.value;
        const endValue = node.next.value;
        const startTime = node.time;
        const timeDelta = TC.vsub(node.next.time, startTime);
        const convert = (progress: number) => (evaluator as EasedEvaluator<VT>).convert(startValue, endValue, progress);

        // startTime + (srcTime - srcStartTime) / srcTimeDelta * timeDelta
        const convertTime = (srcTime: TimeT) => TC.vadd(startTime, TC.vmul(timeDelta, TC.div(TC.vsub(srcTime, srcStartTime), srcTimeDelta)));
        const inserts = [];
        let currentNode = srcSeq.head.next!.next as EventEndNode;
        let lastPos: EventStartNode<VT> = node;
        while (true) {
            const startNode = currentNode.next;
            const next = startNode.next;
            // 最后一个节点对在循环外处理
            if (next.type === NodeType.TAIL) {
                break;
            }
            const newEndNode = new EventEndNode(convertTime(currentNode.time), convert(currentNode.value));
            const newStartNode = new EventStartNode(convertTime(startNode.time), convert(startNode.value));
            const srcEvaluator = startNode.evaluator;
            if (!(srcEvaluator instanceof EasedEvaluator)) {
                throw new Error()
            }
            newStartNode.evaluator = (evaluator as EasedEvaluator<VT>).deriveWithEasing(srcEvaluator.easing)
            EventNode.connect(newEndNode, newStartNode);
            inserts.push(EventNodePairInsertOperation.lazy<typeof EventNodePairInsertOperation<VT>>(newStartNode, lastPos));
            lastPos = newStartNode;

            currentNode = next;
        }
        const evaluatorChange = new EventNodeEvaluatorChangeOperation(node, evaluator.deriveWithEasing((srcSeq.head.next!.evaluator as NumericEasedEvaluator).easing));
        const valueChange = new EventNodeValueChangeOperation(node.next, convert(currentNode.value));
        super(...inserts, evaluatorChange, valueChange);
    }
} 


/**
 * 把一段连续的节点打包成一个模板缓动，并用单个事件替代原区间。
 *
 * 是 {@linkcode EventSubstituteOperation} 的逆过程。通常用静态方法
 * {@linkcode EncapsuleOperation.encapsule} 构造，它会先校验这些节点
 * 是否同属一条序列、首尾值是否相差过大。
 *
 * @example
 * ```ts
 * const op = EncapsuleOperation.encapsule(
 *     chart.templateEasingLib, seq, selectedNodes, "myEasing"
 * );
 * operations.do(op);
 * ```
 */
export class EncapsuleOperation extends ComplexOperation<[MultiNodeDeleteOperation, EventNodeEvaluatorChangeOperation<number>, EventNodeValueChangeOperation<number>]> {
    updatesEditor = true;
    constructor(nodes: EventStartNode<number>[], easing: TemplateEasing) {
        const len = nodes.length;
        super(
            new MultiNodeDeleteOperation(nodes.slice(1, -1)),
            new EventNodeEvaluatorChangeOperation(nodes[0], (nodes[0].evaluator as NumericEasedEvaluator).deriveWithEasing(easing)),
            // 这里nodes至少都有两个，最后一个node不可能是第一个StartNode
            new EventNodeValueChangeOperation(<EventEndNode>nodes[len - 1].previous, nodes[len - 1].value)
        )
    }
    /**
     * 将一些来自sourceSequence的节点打包为一个用于模板缓动的事件序列
     * 然后把sourceSequence中的源节点集合替换为单个使用了该模板的事件
     * @param sourceSequence 
     * @param sourceNodes
     */ 
    static encapsule(templateEasingLib: TemplateEasingLib, sourceSequence: EventNodeSequence, sourceNodes: Set<EventStartNode>, name: string): EncapsuleOperation {
        if (!EventNode.belongToSequence(sourceNodes, sourceSequence)) {
            throw err.NODES_NOT_BELONG_TO_SAME_SEQUENCE();
        }
        const [oldArray, nodeArray] = EventNode.setToNewOrderedArray([0, 0, 1], sourceNodes);
        if (Math.abs(nodeArray[0].value - nodeArray[nodeArray.length - 1].value) < 1e-10) {
            throw err.NODES_HAS_ZERO_DELTA();
        }
        if (!EventNode.isContinuous(oldArray)) {
            throw err.NODES_NOT_CONTINUOUS();
        }
        const easing = templateEasingLib.getOrNew(name);
        const sequence = easing.eventNodeSequence;
        sequence.effectiveBeats = TC.toBeats(nodeArray[nodeArray.length - 1].time);
        // 直接do，这个不需要做成可撤销的
        // @ts-expect-error 这里序列类型确定，为easing，不需要传入谱面
        new MultiNodeAddOperation(nodeArray, sequence).do();
        // 上面这个操作不能顶替原来的第一个startnode，所以手动来一遍
        const first = sequence.head.next!;
        first.evaluator = nodeArray[0].evaluator;
        first.value = nodeArray[0].value;

        return new EncapsuleOperation(oldArray, easing); 
    }
}

/**
 * 批量添加节点对
 * 
 * 节点对需要有序的，且不能有重叠
 *
 * 内部把每个节点都交给 {@linkcode EventNodePairInsertOrOverwriteOperation}，
 * 用"上一个插入点"做游标；速度序列会在整体结束后重算一次 floorPosition。
 *
 * @example
 * ```ts
 * operations.do(new MultiNodeAddOperation([nodeA, nodeB, nodeC], seq));
 * ```
 */
export class MultiNodeAddOperation <VT extends EventValueESType> extends ComplexOperation<EventNodePairInsertOrOverwriteOperation<VT>[]> {
    updatesEditor = true
    updatesFP = false;
    constructor(public nodes: EventStartNode<VT>[], public seq: EventNodeSequence<VT>) {
        let prev = seq.getNodeAt(TC.toBeats(nodes[0].time));
        super(...nodes.map(node => {
            const op = new EventNodePairInsertOrOverwriteOperation(node, prev,false);
            if (!op.overlapping) prev = node; // 有种reduce的感觉
            return op
        }));
        this.updatesFP = seq.type === EventType.speed
    }
    do(chart: Chart) {
        super.do();
        if (this.updatesFP) {
            (this.seq as unknown as SpeedENS).updateFloorPositionAfter(this.nodes[0] as unknown as EventStartNode<number>, chart.timeCalculator)
        }
    }
    undo(chart: Chart) {
        super.undo();
        if (this.updatesFP) {
            (this.seq as unknown as SpeedENS).updateFloorPositionAfter(this.nodes[0] as unknown as EventStartNode<number>, chart.timeCalculator)
        }
    }
}

/**
 * 批量移除事件段。
 *
 * 内部按顺序生成懒操作，避免前一次删除影响后一个节点在链表中的定位。
 *
 * @example
 * ```ts
 * operations.do(new MultiNodeDeleteOperation([seq.getNodeAt(2), seq.getNodeAt(4)]));
 * ```
 */
export class MultiNodeDeleteOperation extends ComplexOperation<LazyOperation<typeof EventNodePairRemoveOperation>[]> {
    updatesEditor = true;
    constructor(nodes: EventStartNode<any>[]) {
        super(...nodes.map(node => EventNodePairRemoveOperation.lazy(node)));
    }
}

/**
 * 重命名事件序列的 id，并同步维护 `chart.sequenceMap` 的索引。
 *
 * 新旧名字相同时操作无效。判定线 id 变化时由
 * {@linkcode JudgeLineIdChangeOperation} 批量调用。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeSequenceRenameOperation(seq, "#0.alpha"));
 * ```
 */
export class EventNodeSequenceRenameOperation extends Operation { 
    updatesEditor: boolean = true;
    originalName: string;
    constructor(public sequence: EventNodeSequence<any>, public newName: string) {
        super();
        this.originalName = sequence.id;
        if (this.originalName === newName) {
            this.ineffective = true;
        }
    }
    do(chart: Chart) {
        chart.sequenceMap.set(this.newName, this.sequence)
        chart.sequenceMap.delete(this.originalName);
        this.sequence.id = this.newName;
    }
    undo(chart: Chart) {
        chart.sequenceMap.set(this.originalName, this.sequence)
        chart.sequenceMap.delete(this.newName);
        this.sequence.id = this.originalName;
    }
}






type TimeRange = [TimeT, TimeT]

/**
 * 所有节点事件加上一个值。
 * 此操作假定了节点被偏移时不会产生“碰撞”。
 * 节点要有序
 * @private
 */
export class MultiNodeOffsetOperation extends Operation {
    constructor(public nodes: readonly EventStartNode<any>[], public offset: TimeT) {
        super();
    }
    do() {
        const offset = this.offset;
        const nodes = this.nodes;
        const len = nodes.length;
        const node = nodes[0];
        if (node.previous.type !== NodeType.HEAD) {
            node.time = TC.validateIp(TC.add(node.time, offset));
            node.previous.time = TC.validateIp(TC.add(node.previous.time, offset));
        }
        for (let i = 1; i < len; i++) {
            const node = nodes[i];
            node.time = TC.validateIp(TC.add(node.time, offset));
            const previous = node.previous as EventEndNode<any>;
            previous.time = TC.validateIp(TC.add(previous.time, offset));
        }
    }
    undo() {
        const offset = this.offset;
        const nodes = this.nodes;
        const len = nodes.length;
        const node = nodes[0];
        if (node.previous.type !== NodeType.HEAD) {
            node.time = TC.vadd(node.time, offset);
            node.previous.time = TC.vadd(node.previous.time, offset);
        }
        for (let i = 1; i < len; i++) {
            const node = nodes[i];
            node.time = TC.vadd(node.time, offset);
            const previous = node.previous as EventEndNode<any>;
            previous.time = TC.vadd(previous.time, offset);
        }
    }
}


export class ENSTimeRangeDeleteOperation extends ComplexOperation<[MultiNodeDeleteOperation, MultiNodeOffsetOperation]> {
    beforeToStart: EventStartNode<any> | EventNodeLike<NodeType.HEAD, any>;
    constructor(public eventNodeSequence: EventNodeSequence<any>, public timeRange: TimeRange) {
        // 找出所有在范围内的节点并删除
        const node = eventNodeSequence.getNodeAt(TC.toBeats(timeRange[0]));
        const beforeToStart = EventNode.previousStartOfStart(node);
        const toBeDeleted = eventNodeSequence.getNodesFromOneAndRangeRight(node, timeRange[1]);
        // 将后续所有节点加入
        const toBeOffset = eventNodeSequence.getNodesAfterOne(toBeDeleted[toBeDeleted.length - 1]);
        super(new MultiNodeDeleteOperation(toBeDeleted), new MultiNodeOffsetOperation(toBeOffset, TC.vsub(timeRange[0], timeRange[1])))
        this.beforeToStart = beforeToStart;
    }
    do() {
        super.do();
        const ens = this.eventNodeSequence;
        ens.updateJump(this.beforeToStart, ens.tail);
    }
    undo() {
        super.undo();
        const ens = this.eventNodeSequence;
        ens.updateJump(this.beforeToStart, ens.tail);
    }
}

export class ENSAddBlankOperation extends MultiNodeOffsetOperation {
    updatesEditor = true;
    constructor(public ens: EventNodeSequence<any>, pos: TimeT, length: TimeT) {
        super(
            ens.getNodesAfterOne(ens.getNodeAt(TC.toBeats(pos))),
            length
        );
    }

    do() {
        super.do();
        const ens = this.ens;
        ens.updateJump(ens.head, ens.tail);
    }
    undo() {
        super.undo();
        const ens = this.ens;
        ens.updateJump(ens.head, ens.tail);
    }
}

export class VideoEventScaleChangeOperation extends Operation {
    updatesEditor = true;
    originalScale: VideoScale;
    constructor(public node: VideoEventStartNode, public scale: VideoScale) {
        super();
        this.ineffective = node.scale === scale;
        this.originalScale = node.scale;
    }
    
    do() {
        this.node.scale = this.scale;
    }
    
    undo() {
        this.node.scale = this.originalScale;
    }
}
