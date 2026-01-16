import type { Chart } from "../chart";
import { EventType, type EventValueESType, type TimeT } from "../chartTypes";
import { TemplateEasing, TemplateEasingLib } from "../easing";
import { err } from "../env";
import { Evaluator, EasedEvaluator, NumericEasedEvaluator } from "../evaluator";
import { EventEndNode, EventStartNode, EventNodeSequence, EventNode, SpeedENS, NonLastStartNode, EventNodeLike } from "../event";
import TC from "../time";
import { NodeType } from "../util";
import { ComplexOperation, LazyOperation, Operation, UnionOperation } from "./basic";

/**
 * 移除一对节点（背靠背）
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
        if (node.isSpeed()) {
            updatesFP = updatesFP;
        }
        [this.endNode, this.startNode] = EventNode.getEndStart(node)
        this.sequence = this.startNode.parentSeq
        this.originalPrev = (<EventEndNode>node.previous).previous
    }
    do(chart: Chart) {
        this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
        if (this.updatesFP) {
            // updatesFP的校验确保了序列为速度序列
            (this.sequence as SpeedENS).updateFloorPositionAfter(this.originalPrev, chart.timeCalculator) 
        }
    }
    undo(chart: Chart) {
        this.sequence.updateJump(...EventNode.insert(this.startNode, this.originalPrev))
        if (this.updatesFP) {
            (this.sequence as SpeedENS).updateFloorPositionAfter(this.originalPrev, chart.timeCalculator) 
        }
    }
}

/**
 * 将一对孤立的节点对插入到一个开始节点之后的操作。
 * 
 * 如果这个节点对的时刻与节点对的时刻相同，那么抛出错误。
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
        this.updatesFP = updatesFP && node.isSpeed();
    }
    do() {
        const [endNode, startNode] = EventNode.insert(this.node, this.tarPrev);
        this.node.parentSeq.updateJump(endNode, startNode)
    }
    undo() {
        this.sequence.updateJump(...EventNode.removeNodePair(...EventNode.getEndStart(this.node)))
    }
}

export class EventNodePairInsertOrOverwriteOperation <VT extends EventValueESType>
extends UnionOperation<EventNodePairInsertOperation<VT> | EventNodeValueChangeOperation<VT>> {
    overlapping: boolean = false;
    constructor(node: EventStartNode<VT>, targetPrevious: EventStartNode<VT>, updatesFP = true) {
        super(() => {
            if (TC.eq(node.time, targetPrevious.time)) {
                this.overlapping = true;
                return new EventNodeValueChangeOperation(targetPrevious, node.value);
            } else {
                return new EventNodePairInsertOperation(node, targetPrevious, updatesFP);
            }
        })
    }
}



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
    do() {
        this.node.value = this.value
    }
    undo() {
        this.node.value = this.originalValue
    }
    rewrite(operation: EventNodeValueChangeOperation<VT>): boolean {
        if (operation.node === this.node) {
            this.value = operation.value;
            this.node.value = operation.value
            return true;
        }
        return false;
    }
}

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
        [this.endNode, this.startNode] = EventNode.getEndStart(node)
        const seq = this.sequence = node.parentSeq
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
    do() { // 这里其实还要设计重新选址的问题
        this.startNode.time = this.endNode.time = this.value;
        if (this.newPrevious !== this.originalPrevious) {
            this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
            EventNode.insert(this.startNode, this.newPrevious)
        }
        this.sequence.updateJump(EventNode.previousStartOfStart(this.endNode.previous), EventNode.nextStartOfStart(this.startNode))
    }
    undo() {
        this.endNode.time = this.startNode.time = this.originalValue;
        if (this.newPrevious !== this.originalPrevious) {
            this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
            EventNode.insert(this.startNode, this.originalPrevious)
        }
        this.sequence.updateJump(this.endNode.previous, EventNode.nextStartOfStart(this.startNode))
    }

}


export class EventNodeEvaluatorChangeOperation <VT extends EventValueESType> extends Operation {
    updatesEditor = true
    originalValue: Evaluator<VT>
    constructor(public node: EventStartNode<VT>, public value: Evaluator<VT>) {
        super();
        this.originalValue = this.node.evaluator
    }
    do() {
        this.node.evaluator = this.value
    }
    undo() {
        this.node.evaluator = this.originalValue
    }
}




// 这个地方得懒一下，不然每亩，导致撤回操作时只能撤回第一个插值节点。
export class EventInterpolationOperation <VT extends EventValueESType> extends ComplexOperation<LazyOperation<typeof EventNodePairInsertOperation>[]> {
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
            subOps.push(EventNodePairInsertOperation.lazy(start, lastStart));
            lastStart = start;
        }
        super(...subOps);
    }
}




export class EventSubstituteOperation<VT extends EventValueESType> extends ComplexOperation<[...LazyOperation<typeof EventNodePairInsertOperation>[], EventNodeEvaluatorChangeOperation<VT>, EventNodeValueChangeOperation<VT>]> {
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
        const srcStartTime = srcSeq.head.next.time;
        const srcEndTime = srcSeq.tail.previous.time;
        const srcTimeDelta = TC.vsub(srcEndTime, srcStartTime);
        const startValue = node.value;
        const endValue = node.next.value;
        const startTime = node.time;
        const timeDelta = TC.vsub(node.next.time, startTime);
        const convert = (progress: number) => (evaluator as EasedEvaluator<VT>).convert(startValue, endValue, progress);

        // startTime + (srcTime - srcStartTime) / srcTimeDelta * timeDelta
        const convertTime = (srcTime: TimeT) => TC.vadd(startTime, TC.vmul(timeDelta, TC.div(TC.vsub(srcTime, srcStartTime), srcTimeDelta)));
        const inserts = [];
        let currentNode = srcSeq.head.next.next as EventEndNode;
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
            inserts.push(EventNodePairInsertOperation.lazy(newStartNode, lastPos));
            lastPos = newStartNode;

            currentNode = next;
        }
        const evaluatorChange = new EventNodeEvaluatorChangeOperation(node, evaluator.deriveWithEasing((srcSeq.head.next.evaluator as NumericEasedEvaluator).easing));
        const valueChange = new EventNodeValueChangeOperation(node.next, convert(currentNode.value));
        super(...inserts, evaluatorChange, valueChange);
    }
} 


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

        return new EncapsuleOperation(oldArray, easing); 
    }
}

/**
 * 批量添加节点对
 * 
 * 节点对需要有序的，且不能有重叠

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
            (this.seq as SpeedENS).updateFloorPositionAfter(this.nodes[0] as EventStartNode<number>, chart.timeCalculator)
        }
    }
    undo(chart: Chart) {
        super.undo();
        if (this.updatesFP) {
            (this.seq as SpeedENS).updateFloorPositionAfter(this.nodes[0] as EventStartNode<number>, chart.timeCalculator)
        }
    }
}

export class MultiNodeDeleteOperation extends ComplexOperation<LazyOperation<typeof EventNodePairRemoveOperation>[]> {
    updatesEditor = true;
    constructor(nodes: EventStartNode<any>[]) {
        super(...nodes.map(node => EventNodePairRemoveOperation.lazy(node)));
    }
}

export class EventNodeSequenceRenameOperation extends Operation { 
    updatesEditor: boolean = true;
    originalName: string;
    constructor(public sequence: EventNodeSequence, public newName: string) {
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