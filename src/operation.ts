
import TC from "./time";
import { EventValueESType, ExtendedEventTypeName, NoteType, RGB, TimeT } from "./chartTypes";
import { Chart, JudgeLineGroup, BasicEventName, UIName } from "./chart";
import { TemplateEasing, TemplateEasingLib } from "./easing";
import { EventEndNode, EventStartNode, EventNodeSequence, EventNode, EventNodeLike, NonLastStartNode } from "./event";
import { JudgeLine, ExtendedLayer } from "./judgeline";
import { Note, notePropTypes, NoteNode, HNList, NNList } from "./note";
import { checkType, NodeType } from "./util";
import { EasedEvaluator, Evaluator, NumericEasedEvaluator } from "./evaluator";
import { err, ERROR_IDS, KPAError } from "./env";




// 有点怪异，感觉破坏了纯净性。不管了（
enum JudgeLinesEditorLayoutType {
    ordered = 0b001,
    tree    = 0b010,
    grouped = 0b100
}


class NeedsReflowEvent extends Event {
    constructor(public condition: number) {
        super("needsreflow");
    }
}

class OperationEvent extends Event {
    constructor(t: string, public operation: Operation) {
        super(t);
    }
}

class OperationErrorEvent extends OperationEvent {
    constructor(operation: Operation, public error: Error) {
        super("error", operation);
    }
}

export class OperationList extends EventTarget {
    operations: Operation[];
    undoneOperations: Operation[];
    constructor(public chart: Chart) {
        super()
        this.operations = [];
        this.undoneOperations = [];
    }
    undo() {
        const op = this.operations.pop()
        if (op) {
            if (!this.chart.modified){
                this.chart.modified = true;
                this.dispatchEvent(new Event("firstmodified"))
            }
            
            try {
                op.undo(this.chart);
            } catch (e) {
                this.dispatchEvent(new OperationErrorEvent(op, e as Error))
                return
            }
            this.undoneOperations.push(op)
            this.dispatchEvent(new OperationEvent("undo", op))
            this.processFlags(op);
        } else {
            this.dispatchEvent(new Event("noundo"))
        }
    }
    redo() {
        const op = this.undoneOperations.pop()
        if (op) {
            if (!this.chart.modified){
                this.chart.modified = true;
                this.dispatchEvent(new Event("firstmodified"))
            }
            
            try {
                op.do(this.chart);
            } catch (e) {
                this.dispatchEvent(new OperationErrorEvent(op, e as Error))
                return
            }
            this.operations.push(op)
            this.dispatchEvent(new OperationEvent("redo", op))
            this.processFlags(op);
        } else {
            this.dispatchEvent(new Event("noredo"))
        }
    }
    do(operation: Operation) {
        if (operation.ineffective) {
            return
        }
        if (!this.chart.modified){
            this.chart.modified = true;
            this.dispatchEvent(new Event("firstmodified"))
        }
        // 如果上一个操作是同一个构造器的，那么修改上一个操作而不是推入新的操作
        if (this.operations.length !== 0) {
                
            const lastOp = this.operations[this.operations.length - 1]
            if (operation.constructor === lastOp.constructor) {
                // 返回值指示是否重写成功
                if (lastOp.rewrite(operation)) {
                    this.processFlags(operation)
                    return;
                }
            }
        }
        try {
            operation.do(this.chart);
        } catch (e) {
            this.dispatchEvent(new OperationErrorEvent(operation, e as Error))
            return
        }
        this.dispatchEvent(new OperationEvent("do", operation));
        this.processFlags(operation);
        this.operations.push(operation);
    }
    processFlags(operation: Operation) {

        if (operation.updatesEditor) {
            this.dispatchEvent(new Event("needsupdate"));
        }
        if (operation.needsComboRecount) {
            this.dispatchEvent(new Event("maxcombochanged"));
        }
        if (operation.reflows) {
            this.dispatchEvent(new NeedsReflowEvent(operation.reflows))
        }
    }
    clear() {
        this.operations = [];
    }
}



export abstract class Operation {
    ineffective: boolean;
    updatesEditor: boolean;
    // 用于判定线编辑区的重排，若操作完成时的布局为这个值就会重排
    reflows: number;
    needsComboRecount: boolean;
    constructor() {

    }
    abstract do(chart: Chart): void
    abstract undo(chart: Chart): void
    rewrite(op: typeof this): boolean {return false;}
    toString(): string {
        return this.constructor.name;
    }
    static lazy<C extends new (...args: any[]) => any = typeof this>(this: C, ...args: ConstructorParameters<C>) {
        return new LazyOperation<C>(this, ...args)
    }
}




/**
 * 懒操作，实例化的时候不记录任何数据，do的时候才执行真正实例化
 * 防止连续的操作中状态改变导致的错误
 */
class LazyOperation<C extends new (...args: any[]) => any> extends Operation {
    public operationClass: C;
    public args: ConstructorParameters<C>;
    public operation: InstanceType<C> | null = null;
    constructor(
        operationClass: C,
        ...args: ConstructorParameters<C>
    ) {
        super();
        this.operationClass = operationClass;
        this.args = args;
    }
    do(chart: Chart) {
        this.operation = new this.operationClass(...this.args);
        this.operation.do(chart);
    }
    undo(chart: Chart) {
        this.operation.undo(chart);
    }
}


export class ComplexOperation<T extends Operation[]> extends Operation {
    subOperations: T;
    length: number;
    constructor(...sub: T) {
        super()
        this.subOperations = sub
        this.length = sub.length
        this.reflows = sub.reduce((prev, op) => prev | op.reflows, 0);
        this.updatesEditor = sub.some((op) => op.updatesEditor);
        this.needsComboRecount = sub.some((op) => op.needsComboRecount);
    }
    // 这样子写不够严密，如果要继承这个类，并且子操作需要谱面，就要重写这个方法的签名
    do(chart?: Chart) {
        const length = this.length
        for (let i = 0; i < length; i++) {
            const op = this.subOperations[i]
            if (op.ineffective) {
                continue;
            }
            op.do(chart)
        }
    }
    undo(chart?: Chart) {
        const length = this.length
        for (let i = length - 1; i >= 0; i--) {
            const op = this.subOperations[i]
            if (op.ineffective) { continue; }
            op.undo(chart)
        }
    }
}

type NotePropNamePhiZone = "judgeSize" | "tint" | "tintHitEffects";

type NotePropName = "speed" | "type" | "positionX" | "startTime" | "endTime" | "alpha" | "size" | "visibleBeats" | "yOffset" | "above" | "isFake" | NotePropNamePhiZone;

export class NotePropChangeOperation<T extends NotePropName> extends Operation {
    field: T;
    note: Note;
    previousValue: Note[T]
    value: Note[T];
    updatesEditor = true;
    constructor(note: Note, field: T, value: Note[T]) {
        super()
        this.field = field
        this.note = note;
        this.value = value;
        if (!checkType(value, notePropTypes[field])) {
            throw err.INVALID_NOTE_PROP_TYPE(field, value, notePropTypes[field]);
        }
        this.previousValue = note[field]
        if (field === "isFake") {
            this.needsComboRecount = true;
        }
        if (value === note[field]) {
            this.ineffective = true
        }
    }
    do() {
        this.note[this.field] = this.value
    }
    undo() {
        this.note[this.field] = this.previousValue
    }
    override rewrite(operation: NotePropChangeOperation<T>): boolean {
        if (operation.note === this.note && this.field === operation.field) {
            this.value = operation.value;
            this.note[this.field] = operation.value
            return true;
        }
        return false;
    }
}
export class NoteRemoveOperation extends Operation {
    noteNode: NoteNode;
    note: Note;
    isHold: boolean;
    override needsComboRecount = true;
    constructor(note: Note) {
        super()
        this.note = note // In memory of forgettting to add this(
        this.isHold = note.type === NoteType.hold;
        if (!note.parentNode) {
            this.ineffective = true
        } else {
            this.noteNode = note.parentNode
        }
    }
    do() {
        const {note, noteNode} = this;
        noteNode.remove(note);
        const needsUpdate = this.isHold && TC.lt(noteNode.endTime, note.endTime)
        if (needsUpdate) {
            const endBeats = TC.toBeats(note.endTime);
            const tailJump = (noteNode.parentSeq as HNList).holdTailJump;
            const updateFrom = tailJump.header
            const updateTo = tailJump.tailer;
            // tailJump.getPreviousOf(noteNode, endBeats);
            tailJump.updateRange(updateFrom, noteNode.next);
        }
    }
    undo() {
        const {note, noteNode} = this;
        const needsUpdate = this.isHold && TC.lt(noteNode.endTime, note.endTime);
        if (needsUpdate) {
            const endBeats = TC.toBeats(note.endTime);
            const tailJump = (noteNode.parentSeq as HNList).holdTailJump;
            const updateFrom = tailJump.getNodeAt(endBeats).previous;
            noteNode.add(note)
            tailJump.updateRange(updateFrom, noteNode.next);
        } else {
            noteNode.add(note);
        }
    }
}

/**
 * 删除一个note
 * 从语义上删除Note要用这个操作
 * 结果上，这个会更新编辑器
 */
export class NoteDeleteOperation extends NoteRemoveOperation {
    updatesEditor = true
}

export class MultiNoteDeleteOperation extends ComplexOperation<NoteDeleteOperation[]> {
    updatesEditor = true
    constructor(notes: Set<Note> | Note[]) {
        if (notes instanceof Set) {
            notes = [...notes];
        }
        super(...notes.map(note => new NoteDeleteOperation(note)))
        if (notes.length === 0) {
            this.ineffective = true
        }
    }

}

export class NoteAddOperation extends Operation {
    noteNode: NoteNode
    note: Note;
    isHold: boolean;
    updatesEditor = true
    needsComboRecount = true;
    constructor(note: Note, node: NoteNode) {
        super()
        this.note = note;
        this.isHold = note.type === NoteType.hold;
        this.noteNode = node
    }
    do() {
        const {note, noteNode} = this;
        const needsUpdate = this.isHold && TC.lt(noteNode.endTime, note.endTime);
        if (needsUpdate) {
            const endBeats = TC.toBeats(note.endTime);
            const tailJump = (noteNode.parentSeq as HNList).holdTailJump;
            const updateFrom = tailJump.header 
            // tailJump.getNodeAt(endBeats).previous;
            noteNode.add(note)
            tailJump.updateRange(updateFrom, noteNode.next);
        } else {
            noteNode.add(note);
        }
    }
    undo() {
        const {note, noteNode} = this;
        noteNode.remove(note);
        const needsUpdate = this.isHold && TC.lt(noteNode.endTime, note.endTime)
        if (needsUpdate) {
            const endBeats = TC.toBeats(note.endTime);
            const tailJump = (noteNode.parentSeq as HNList).holdTailJump;
            const updateFrom = tailJump.getPreviousOf(noteNode, endBeats);
            tailJump.updateRange(updateFrom, noteNode.next);
        }
    }
}

export class MultiNoteAddOperation extends ComplexOperation<NoteAddOperation[]> {
    updatesEditor = true
    needsComboRecount = true;
    constructor(notes: Set<Note> | Note[], judgeLine: JudgeLine) {
        if (notes instanceof Set) {
            notes = [...notes];
        }
        super(...notes.map(note => {
            const node = judgeLine.getNode(note, true)
            return new NoteAddOperation(note, node);
        }))
        if (notes.length === 0) {
            this.ineffective = true
        }
    }
}

export class NoteTimeChangeOperation extends ComplexOperation<
[NoteRemoveOperation, NotePropChangeOperation<"startTime">, NoteAddOperation]
| [NoteRemoveOperation, NotePropChangeOperation<"startTime">, NoteAddOperation, NotePropChangeOperation<"endTime">]> {
    note: Note
    constructor(note: Note, noteNode: NoteNode) {
        if (note.type === NoteType.hold) {
            super(
                new NoteRemoveOperation(note),
                new NotePropChangeOperation(note, "startTime", noteNode.startTime),
                new NoteAddOperation(note, noteNode)
            );
        } else {
            super(
                new NoteRemoveOperation(note),
                new NotePropChangeOperation(note, "startTime", noteNode.startTime),
                new NoteAddOperation(note, noteNode),
                new NotePropChangeOperation(note, "endTime", noteNode.startTime)
            )
        }
        this.updatesEditor = true
        this.needsComboRecount = false;
        if (note.type === NoteType.hold && !TC.gt(note.endTime, noteNode.startTime)) {
            this.ineffective = true
        }
        this.note = note
        if (note.parentNode === noteNode) {
            this.ineffective = true
        }
    }
    // 真的是巨坑啊
    rewrite(operation: NoteTimeChangeOperation): boolean {
        if (operation.note === this.note) {
            this.subOperations[0] = new NoteRemoveOperation(this.note)
            if (!this.subOperations[0].ineffective) {
                this.subOperations[0].do()
            }
            this.subOperations[1].value = operation.subOperations[1].value
            this.subOperations[1].do()
            this.subOperations[2].noteNode = operation.subOperations[2].noteNode
            this.subOperations[2].do()
            if (operation.subOperations.length === 4) {
                if (this.subOperations[3]) {
                    this.subOperations[3].value = operation.subOperations[3].value;
                    this.subOperations[3].do();
                } else {
                    // @ts-expect-error TS2322
                    this.subOperations[4] = operation.subOperations[3];
                    this.subOperations[3].do();
                }
            }
            return true;
        }
        return false
    }
}

export class HoldEndTimeChangeOperation extends NotePropChangeOperation<"endTime"> {
    
    needsComboRecount = false;
    constructor(note: Note, value: TimeT) {
        super(note, "endTime", value)
        if (!TC.gt(value, note.startTime)) {
            this.ineffective = true
        }
    }
    do() {
        super.do()
        const node = this.note.parentNode;
        node.sort(this.note);
        const tailJump = (node.parentSeq as HNList).holdTailJump;
        tailJump.updateRange(tailJump.header, tailJump.tailer);
    }
    undo() {
        super.undo()
        const node = this.note.parentNode;
        node.sort(this.note);
        const tailJump = (node.parentSeq as HNList).holdTailJump;
        tailJump.updateRange(tailJump.header, tailJump.tailer);
    }
    rewrite(operation: HoldEndTimeChangeOperation): boolean { // 看懂了，不重写的话会出问题
        if (operation.note === this.note && this.field === operation.field) {
            if (operation.value === this.value) {
                return true;
            }
            this.value = operation.value;
            this.note[this.field] = operation.value;
            const tailJump = (this.note.parentNode.parentSeq as HNList).holdTailJump;
            tailJump.updateRange(tailJump.header, tailJump.tailer);
            return true;
        }
        return false;
    }
}


export class NoteSpeedChangeOperation
extends ComplexOperation<[NotePropChangeOperation<"speed">, NoteRemoveOperation, NoteAddOperation]> {
    updatesEditor = true
    originalTree: NNList;
    judgeLine: JudgeLine;
    targetTree: NNList
    constructor(note: Note, value: number, line: JudgeLine) {
        const valueChange = new NotePropChangeOperation(note, "speed", value);
        const tree = line.getNNList(value, note.yOffset, note.type === NoteType.hold, true)
        const node = tree.getNodeOf(note.startTime);
        const removal = new NoteRemoveOperation(note);
        const insert = new NoteAddOperation(note, node)
        super(valueChange, removal, insert);
    }
}

export class NoteYOffsetChangeOperation
extends ComplexOperation<[NotePropChangeOperation<"yOffset">, NoteRemoveOperation, NoteAddOperation]> {
    updatesEditor = true
    originalTree: NNList;
    judgeLine: JudgeLine;
    targetTree: NNList
    constructor(note: Note, value: number, line: JudgeLine) {
        const valueChange = new NotePropChangeOperation(note, "yOffset", value);
        const tree = line.getNNList(note.speed, value, note.type === NoteType.hold, true)
        const node = tree.getNodeOf(note.startTime);
        const removal = new NoteRemoveOperation(note);
        const insert = new NoteAddOperation(note, node)
        super(valueChange, removal, insert);
    }
}


export class NoteTypeChangeOperation 
extends ComplexOperation</*[NoteValueChangeOperation<"type">, NoteInsertOperation]*/ any> {
    constructor(note: Note, value: number) {
        const isHold = note.type === NoteType.hold
        const valueChange = new NotePropChangeOperation(note, "type", value);
        if (isHold !== (value === NoteType.hold)) {
            const tree = note.parentNode.parentSeq.parentLine.getNNList(note.speed, note.yOffset, !isHold, true)
            const node = tree.getNodeOf(note.startTime);
            const removal = new NoteRemoveOperation(note);
            const insert = new NoteAddOperation(note, node);
            super(valueChange, removal, insert);
        } else {
            super(valueChange);
        }
        this.updatesEditor = true;
    }
}

class NoteTreeChangeOperation extends NoteAddOperation {

}

export class EventNodePairRemoveOperation extends Operation {
    updatesEditor = true;
    endNode: EventEndNode<any>;
    startNode: EventStartNode<any>;
    sequence: EventNodeSequence<any>;
    originalPrev: EventStartNode<any>;
    constructor(node: EventStartNode<any>) {
        super();
        if (node.previous === null) {
            this.ineffective = true;
            return;
        }
        if (node.isFirstStart()) {
            this.ineffective = true;
            return;
        }
        [this.endNode, this.startNode] = EventNode.getEndStart(node)
        this.sequence = this.startNode.parentSeq
        this.originalPrev = (<EventEndNode>node.previous).previous
    }
    do() {
        this.sequence.updateJump(...EventNode.removeNodePair(this.endNode, this.startNode))
    }
    undo() {
        this.sequence.updateJump(...EventNode.insert(this.startNode, this.originalPrev))
    }
}

/**
 * 将一对孤立的节点对插入到一个开始节点之后的操作。
 * 
 * 如果这个节点对的时刻与节点对的时刻相同，那么该节点对将不会被插入。
 * 
 * 而是把原来开始节点的值修改。
 */
export class EventNodePairInsertOperation<VT> extends Operation {
    updatesEditor = true
    node: EventStartNode<VT>;
    tarPrev: EventStartNode<VT>;
    originalSequence: EventNodeSequence<VT>;
    overlapped: boolean;
    originalValue: VT;
    value: VT
    /**
     * 
     * @param node the node to insert
     * @param targetPrevious The node to insert before, accessed through EventNodeSequence.getNodeAt(TC.toBeats(node))
     * If the targetPrevious's time is the same as node's time, the node will not be inserted,
     * and the targetPrevious' value will be replaced with the node's value.
     */
    constructor(node: EventStartNode<VT>, targetPrevious: EventStartNode<VT>) {
        super()
        this.node = node;
        this.tarPrev = targetPrevious
        this.originalSequence = targetPrevious.parentSeq
        if (TC.eq(node.time, targetPrevious.time)) {
            this.overlapped = true;
            this.value = node.value;
            this.originalValue = targetPrevious.value;
        }
    }
    do() {
        if (this.overlapped) {
            this.tarPrev.value = this.value;
            return;
        }
        const [endNode, startNode] = EventNode.insert(this.node, this.tarPrev);
        this.node.parentSeq.updateJump(endNode, startNode)
    }
    undo() {
        if (this.overlapped) {
            this.tarPrev.value = this.originalValue;
            return;
        }
        this.originalSequence?.updateJump(...EventNode.removeNodePair(...EventNode.getEndStart(this.node)))
    }
}


/**
 * 批量添加节点对
 * 
 * 节点对需要有序的，且不能有重叠

 */
export class MultiNodeAddOperation<VT> extends ComplexOperation<EventNodePairInsertOperation<VT>[]> {
    updatesEditor = true
    nodes: EventStartNode<VT>[];
    constructor(nodes: EventStartNode<VT>[], seq: EventNodeSequence<VT>) {
        let prev = seq.getNodeAt(TC.toBeats(nodes[0].time));
        super(...nodes.map(node => {
            const op = new EventNodePairInsertOperation(node, prev);
            if (!op.overlapped) prev = node; // 有种reduce的感觉
            return op
        }));
        this.nodes = nodes
    }
}

export class MultiNodeDeleteOperation extends ComplexOperation<LazyOperation<typeof EventNodePairRemoveOperation>[]> {
    updatesEditor = true;
    constructor(nodes: EventStartNode<any>[]) {
        super(...nodes.map(node => EventNodePairRemoveOperation.lazy(node)));
    }
}

export class EventNodeValueChangeOperation<VT> extends Operation {
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


export class EventNodeEvaluatorChangeOperation<VT> extends Operation {
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
export class EventInterpolationOperation<VT> extends ComplexOperation<LazyOperation<typeof EventNodePairInsertOperation>[]> {
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
        new MultiNodeAddOperation(nodeArray, sequence).do();

        return new EncapsuleOperation(oldArray, easing); 
    }
}






export class JudgeLineInheritanceChangeOperation extends Operation {
    originalValue: JudgeLine | null;
    updatesEditor = true;
    static REFLOWS = JudgeLinesEditorLayoutType.tree;
    reflows = JudgeLineInheritanceChangeOperation.REFLOWS;
    constructor(public chart: Chart, public judgeLine: JudgeLine, public value: JudgeLine | null) {
        super();
        this.originalValue = judgeLine.father;
        // 这里只会让它静默失败，外面调用的时候能够在判断一次并抛错误才是最好的
        if (JudgeLine.checkinterdependency(judgeLine, value)) {
            this.ineffective = true;
        }
    }
    do() {
        const line = this.judgeLine;
        line.father = this.value;
        if (this.originalValue) {
            this.originalValue.children.delete(line);
        } else {
            const index = this.chart.orphanLines.indexOf(line);
            if (index >= 0) // Impossible to be false, theoretically
                this.chart.orphanLines.splice(index, 1)
        }
        if (this.value) {
            this.value.children.add(line);
        } else {
            this.chart.orphanLines.push(line);
        }
    }
    undo() {
        const line = this.judgeLine;
        line.father = this.originalValue;
        if (this.originalValue) {
            this.originalValue.children.add(line);
        } else {
            this.chart.orphanLines.push(line);
        }
        if (this.value) {
            this.value.children.delete(line);
        } else {
            const index = this.chart.orphanLines.indexOf(line);
            if (index >= 0) // Impossible to be false, theoretically
                this.chart.orphanLines.splice(index, 1)
        }
    }
}

export class JudgeLineRenameOperation extends Operation { 
    updatesEditor = true;
    originalValue: string;
    constructor(public judgeLine: JudgeLine, public value: string) {
        super();
        this.originalValue = judgeLine.name;
    }
    do() {
        this.judgeLine.name = this.value;
    }
    undo() {
        this.judgeLine.name = this.originalValue;
    }
}

type JudgeLinePropName = "name" | "rotatesWithFather" | "anchor" | "texture" | "cover" | "zOrder";

export class JudgeLinePropChangeOperation<T extends JudgeLinePropName> extends Operation {
    updatesEditor = true;
    originalValue: JudgeLine[T];
    constructor(public judgeLine: JudgeLine, public field: T, public value: JudgeLine[T]) {
        super();
        this.originalValue = judgeLine[field];
    }
    do() {
        this.judgeLine[this.field] = this.value;
    }
    undo() {
        this.judgeLine[this.field] = this.originalValue;
    }
}

export class JudgeLineRegroupOperation extends Operation {
    updatesEditor = true;
    reflows = JudgeLinesEditorLayoutType.grouped;
    originalValue: JudgeLineGroup;
    constructor(public judgeLine: JudgeLine, public value: JudgeLineGroup) {
        super();
        this.originalValue = judgeLine.group;
    }
    do() {
        this.judgeLine.group = this.value;
        this.value.add(this.judgeLine);
        this.originalValue.remove(this.judgeLine);
    }
    undo() {
        this.judgeLine.group = this.originalValue;
        this.originalValue.add(this.judgeLine);
        this.value.remove(this.judgeLine);
    }
}

export class JudgeLineCreateOperation extends Operation {
    reflows = JudgeLinesEditorLayoutType.grouped | JudgeLinesEditorLayoutType.tree | JudgeLinesEditorLayoutType.ordered;
    // 之前把=写成了:半天不知道咋错了
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
    }
    do() {
        const id = this.chart.judgeLines.length;
        this.judgeLine.id = id;
        this.chart.judgeLines.push(this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.chart.judgeLineGroups[0].add(this.judgeLine);
    }
    undo() {
        this.chart.judgeLineGroups[0].remove(this.judgeLine);
        this.chart.judgeLines.splice(this.chart.judgeLines.indexOf(this.judgeLine), 1);
        this.chart.orphanLines.splice(this.chart.orphanLines.indexOf(this.judgeLine), 1);
    }
}

export class JudgeLineDeleteOperation extends Operation {
    readonly originalGroup: JudgeLineGroup;
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
        if (!this.chart.judgeLines.includes(this.judgeLine)) {
            this.ineffective = true;
        }
        this.originalGroup = judgeLine.group;
    }
    do() {
        this.chart.judgeLines.splice(this.chart.judgeLines.indexOf(this.judgeLine), 1);
        if (this.chart.orphanLines.includes(this.judgeLine)) {
            this.chart.orphanLines.splice(this.chart.orphanLines.indexOf(this.judgeLine), 1);
        }
        this.originalGroup.remove(this.judgeLine);
    }
    undo() {
        this.chart.judgeLines.push(this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.originalGroup.add(this.judgeLine);
    }
}



export class JudgeLineENSChangeOperation extends Operation {
    originalValue: EventNodeSequence;
    constructor(public judgeLine: JudgeLine, public layerId: number, public typeStr: BasicEventName, public value: EventNodeSequence) {
        super();
        this.originalValue = judgeLine.eventLayers[layerId][typeStr];
    }
    do() {
        this.judgeLine.eventLayers[this.layerId][this.typeStr] = this.value;
    }
    undo() {
        this.judgeLine.eventLayers[this.layerId][this.typeStr] = this.originalValue;
    }
}


export type ENSOfTypeName<T extends ExtendedEventTypeName> = {
    "scaleX": EventNodeSequence<number>,
    "scaleY": EventNodeSequence<number>
    "text": EventNodeSequence<string>,
    "color": EventNodeSequence<RGB> 
}[T]
export class JudgeLineExtendENSChangeOperation<T extends ExtendedEventTypeName> extends Operation {
    originalValue: ENSOfTypeName<T>;
    constructor(public judgeLine: JudgeLine, public typeStr: T, public value: ENSOfTypeName<T> | null) {
        super();
        this.originalValue = judgeLine.extendedLayer[typeStr satisfies keyof ExtendedLayer] as ENSOfTypeName<T>;
    }
    do() {
        this.judgeLine.extendedLayer[this.typeStr] = this.value
    }
    undo() {
        this.judgeLine.extendedLayer[this.typeStr] = this.originalValue
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

export class AttachUIOperation extends Operation {
    updatesEditor = true;
    constructor(public chart: Chart, public judgeLine: JudgeLine, public ui: UIName) {
        super();
    }
    do() {
        this.chart.attachUIToLine(this.ui, this.judgeLine);
    }
    undo() {
        this.chart.detachUI(this.ui);
    }
}

export class DetachUIOperation extends Operation {
    updatesEditor = true;
    judgeLine: JudgeLine;
    constructor(public chart: Chart, public ui: UIName) {
        super();
        if (chart[`${ui}Attach` satisfies keyof Chart]) {
            this.judgeLine = chart[`${ui}Attach` satisfies keyof Chart];
        } else {
            this.ineffective = true;
        }
    }
    do() {
        this.chart.detachUI(this.ui);
    }
    undo() {
        this.chart.attachUIToLine(this.ui, this.judgeLine);
    }
}

export class DetachJudgeLineOperation extends Operation {
    updatesEditor = true;
    uinames: UIName[];
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
        this.uinames = chart.queryJudgeLineUI(this.judgeLine);
    }
    do() {
        for (const ui of this.uinames) {
            this.chart.detachUI(ui);
        }
    }
    undo() {
        for (const ui of this.uinames) {
            this.chart.attachUIToLine(ui, this.judgeLine);
        }
    }
}

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

// 按照规矩，音符节点的时间不可变，所以不会对音符节点动手。
// 依旧不用组合的NoteTimeChangeOperation的方式，因为那需要多次更新跳数组。
// @ts-expect-error
export class MultiNoteOffsetOperation extends Operation {
    constructor(public nnList: NNList, public notes: readonly Note[], public offset: TimeT) {
        super();
    }
    do() {
        const offset = this.offset;
        const notes = this.notes;
        const len = notes.length;
        const nnList = this.nnList;
        for (let i = 0; i < len; i++) {
            const note = notes[i];
            const startTime = TC.vadd(note.startTime, offset);
            note.startTime = startTime;
            note.endTime = TC.vadd(note.endTime, offset);
            note.parentNode.remove(note);
            nnList.getNodeOf(startTime).add(note);
        }
        nnList.jump.updateRange(nnList.head, nnList.tail);
        if (nnList instanceof HNList) {
            nnList.holdTailJump.updateRange(nnList.head, nnList.tail);
        }
    }
    undo() {
        const offset = this.offset;
        const notes = this.notes;
        const len = notes.length;
        const nnList = this.nnList;
        for (let i = 0; i < len; i++) {
            const note = notes[i];
            const startTime = TC.vsub(note.startTime, offset);
            note.startTime = startTime;
            note.endTime = TC.vsub(note.endTime, offset);
            note.parentNode.remove(note);
            nnList.getNodeOf(startTime).add(note);
        }
        nnList.jump.updateRange(nnList.head, nnList.tail);
        if (nnList instanceof HNList) {
            nnList.holdTailJump.updateRange(nnList.head, nnList.tail);
        }
    }
    // 禁用，因为无效
    private static lazy() {}
}


export class NNListTimeRangeDeleteOperation extends ComplexOperation<[MultiNoteDeleteOperation, MultiNoteOffsetOperation]> {
    constructor(public nnList: NNList, public timeRange: TimeRange, public updatesJump: boolean = true) {
        const delNodes = nnList.getNodesFromOneAndRangeRight(nnList.getNodeOf(timeRange[0]), timeRange[1]);
        const delNotes = [];
        const dlen = delNodes.length;
        for (let i = 0; i < dlen; i++) {
            delNotes.push(...delNodes[i].notes);
        }
        const offsetNodes = nnList.getNodesAfterOne(delNodes[dlen - 1]);
        const offsetNotes = [];
        const olen = offsetNodes.length;
        for (let i = 0; i < olen; i++) {
            offsetNotes.push(...offsetNodes[i].notes);
        }
        super(new MultiNoteDeleteOperation(delNotes), new MultiNoteOffsetOperation(nnList, offsetNotes, TC.vsub(timeRange[0], timeRange[1])));
    }
    do() {
        super.do();
        this.nnList.clearEmptyNodes(this.updatesJump)
    }
    undo() {
        super.undo();
        this.nnList.clearEmptyNodes(this.updatesJump)
    }
}

export class NNListAddBlankOperation extends MultiNoteOffsetOperation {
    updatesEditor = true;
    constructor(nnList: NNList, pos: TimeT, length: TimeT) {
        const nns = nnList.getNodesAfterOne(nnList.getNodeOf(pos));
        const notes = [];
        const len = nns.length;
        for (let i = 0; i < len; i++) {
            notes.push(...nns[i].notes);
        }
        super(nnList, notes, length);
    }
}

