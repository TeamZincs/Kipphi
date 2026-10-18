import { Operation, ComplexOperation, UnionOperation } from "./basic";

import TC from "../time";
import { NoteType, TimeT } from "../chartTypes";
import { JudgeLine } from "../judgeline";
import { Note, notePropTypes, NoteNode, HNList, NNList } from "../note";
import { checkType } from "../util";
import { err } from "../env";


type NotePropNamePhiZone = "judgeSize" | "tint" | "tintHitEffects";

export type NotePropName = "speed" | "type" | "positionX" | "startTime" | "endTime" | "alpha" | "size" | "visibleBeats" | "yOffset" | "above" | "isFake" | NotePropNamePhiZone;

/**
 * 修改 Note 的任意属性值
 * @example
 * // 修改 note 的 above 属性
 * operationList.do(new NotePropChangeOperation(note, "above", true));
 * // 修改 note 的 speed 属性
 * // 一般不会这样做，因为修改 note 的 speed 需要把note换到另一个序列（`NNList`）中
 * // 应使用NoteSpeedChangeOperation。YOffset也是同样的道理。
 * operationList.do(new NotePropChangeOperation(note, "speed", 1.5));
 * @template T - 要修改的属性名，必须是 `NotePropName` 类型
 */
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
        if (value === note[field]) {
            this.ineffective = true
        } else if (field === "isFake") {
            this.comboDelta = value ? -1 : 1;
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
/**
 * 把音符从它所在的 NoteNode / NNList 上摘下来。
 *
 * 只动数据结构，不通知编辑器——这是"物理删除"，语义层的删除请用
 * {@linkcode NoteDeleteOperation}。hold 音符还会顺带修正尾判跳数组。
 *
 * @example
 * ```ts
 * // 通常不直接用，而是作为 NoteAddOperation 的配对操作
 * operations.do(NoteRemoveOperation.lazy(note));
 * ```
 */
export class NoteRemoveOperation extends Operation {
    noteNode: NoteNode;
    note: Note;
    isHold: boolean;
    constructor(note: Note) {
        super()
        this.note = note // In memory of forgettting to add this(
        this.isHold = note.type === NoteType.hold;
        if (!note.parentNode) {
            this.ineffective = true
        } else {
            this.noteNode = note.parentNode
        }
        // 移除假Note不改变物量
        // 这里，一般没有人会在修改一个isFake值之后删除它，因此一般不用懒操作
        this.comboDelta = note.isFake ? 0 : -1;
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
            const updateFrom = tailJump.getNodeAt(endBeats).previous!;
            noteNode.add(note)
            tailJump.updateRange(updateFrom, noteNode.next);
        } else {
            noteNode.add(note);
        }
    }
}

/**
 * 删除一个 note（语义层面的删除）
 * 从语义上删除 Note 要用这个操作
 * 注意：实际移除由 NoteRemoveOperation 完成，NoteDeleteOperation 仅负责更新编辑器
 * @example
 * operationList.do(new NoteDeleteOperation(note));
 */
export class NoteDeleteOperation extends NoteRemoveOperation {
    updatesEditor = true
}

/**
 * 批量删除音符。
 *
 * 每个音符对应一个 {@linkcode NoteDeleteOperation}，物量按个数累计；
 * 空集合时整体无效。
 *
 * @example
 * ```ts
 * operations.do(new MultiNoteDeleteOperation([noteA, noteB, noteC]));
 * ```
 */
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



/**
 * 把一个音符挂到指定的 NoteNode 上。
 *
 * NoteNode 需要调用方先用 `nnList.getNodeOf()` 取到；hold 音符若会让
 * 该节点变长，会同步更新行尾跳数组。物量在这里 +1（假音符不计）。
 *
 * @example
 * ```ts
 * const node = line.getNNList(note.speed, note.yOffset, false, true).getNodeOf(note.startTime);
 * operations.do(new NoteAddOperation(note, node));
 * ```
 */
export class NoteAddOperation extends Operation {
    noteNode: NoteNode
    note: Note;
    isHold: boolean;
    updatesEditor = true;
    constructor(note: Note, node: NoteNode) {
        super()
        this.note = note;
        this.isHold = note.type === NoteType.hold;
        if (this.isHold) {
            if (TC.lt(note.endTime, note.startTime)) {
                throw err.HOLD_HAS_NO_DURATION();
            }
        }
        this.noteNode = node;
        // 一般来说，操作是对于在谱里面的NoteNode，谱外面的不需要操作
        this.comboDelta = note.isFake ? 0 : +1;
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

/**
 * 批量添加音符。
 *
 * 内部会按每个音符的 speed / yOffset 找到它该去的 NNList，再各自生成
 * {@linkcode NoteAddOperation}。空集合时整体无效。
 *
 * @example
 * ```ts
 * operations.do(new MultiNoteAddOperation([noteA, noteB], line));
 * ```
 */
export class MultiNoteAddOperation extends ComplexOperation<NoteAddOperation[]> {
    updatesEditor = true;
    constructor(notes: Set<Note> | Note[], judgeLine: JudgeLine) {
        if (notes instanceof Set) {
            notes = [...notes];
        }
        super(...notes.map(note => {
            const node = judgeLine.getNode(note, true)
            return new NoteAddOperation(note, node);
        }));
        // 以上，一般能数清楚加了多少物量
        if (notes.length === 0) {
            this.ineffective = true
        }
    }
}

/**
 * 修改 Note 的时间位置（不直接修改 startTime，而是将 Note 移动到另一个 NoteNode）
 * 注意：不能直接修改 note.startTime 属性，需要通过 getNodeOf 获取目标时间的 NoteNode
 * @example
 * // 将 note 移动到目标时间位置
 * const targetNode = note.parentNode.parentSeq.getNodeOf(targetTime);
 * operationList.do(new NoteTimeChangeOperation(note, targetNode));
 */
export class NoteTimeChangeOperation extends ComplexOperation<[
    NoteRemoveOperation,
    NotePropChangeOperation<"startTime">,
    NoteAddOperation,
    UnionOperation<NotePropChangeOperation<"endTime"> | null>
]>
{
    note: Note;
    comboDelta = 0;
    constructor(note: Note, noteNode: NoteNode) {
        super(
            new NoteRemoveOperation(note),
            new NotePropChangeOperation(note, "startTime", noteNode.startTime),
            new NoteAddOperation(note, noteNode),
            new UnionOperation(() => {
                if (note.type !== NoteType.hold) { // 非hold，endTime跟随startTime
                    return new NotePropChangeOperation(note, "endTime", noteNode.startTime)
                }
                return null;
            })
        );
        this.updatesEditor = true;
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
            const changed = this.subOperations[3];
            const source = operation.subOperations[3];
            if (changed.operation && source.operation) {
                changed.operation.value = source.operation.value;
                changed.operation.do();
            } else {
                this.subOperations[3] = source;
                this.subOperations[3].do();
            }
            return true;
        }
        return false
    }
    static byTime(note: Note, startTime: TimeT) {
        if (!note.parentNode) {
            throw new Error();
        }
        const node = note.parentNode.parentSeq.getNodeOf(startTime)
        return new NoteTimeChangeOperation(note, node);
    }
}

/**
 * 修改 hold 音符的 endTime 属性
 * 直接修改 hold 音符的 endTime（不同于 NoteTimeChangeOperation）
 * @example
 * // 修改 hold 音符的结束时间
 * operationList.do(new HoldEndTimeChangeOperation(note, newEndTime));
 */
export class HoldEndTimeChangeOperation extends NotePropChangeOperation<"endTime"> {
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



/**
 * 修改 Note 的 speed 属性
 * 需要传入 JudgeLine 参数，因为 speed 变化会影响 note 在何 NNList 中
 * @example
 * // 修改 note 的 speed 值
 * operationList.do(new NoteSpeedChangeOperation(note, 2.0, judgeLine));
 */
export class NoteSpeedChangeOperation
extends ComplexOperation<[NotePropChangeOperation<"speed">, NoteRemoveOperation, NoteAddOperation]> {
    updatesEditor = true
    constructor(public note: Note, value: number, line: JudgeLine) {
        const valueChange = new NotePropChangeOperation(note, "speed", value);
        const tree = line.getNNList(value, note.yOffset, note.type === NoteType.hold, true)
        const node = tree.getNodeOf(note.startTime);
        const removal = new NoteRemoveOperation(note);
        const insert = new NoteAddOperation(note, node)
        super(valueChange, removal, insert);
        if (value === 0 && note.yOffset !== 0) {
            this.ineffective = true;
        }
    }
}

/**
 * 修改 Note 的 yOffset 属性。
 *
 * 与 {@linkcode NoteSpeedChangeOperation} 同理，yOffset 决定了音符落在哪个
 * NNList，所以要"改值 + 摘除 + 重新插入"。speed 为 0 时 yOffset 必须为 0，
 * 否则操作无效。
 *
 * @example
 * ```ts
 * operations.do(new NoteYOffsetChangeOperation(note, 50, judgeLine));
 * ```
 */
export class NoteYOffsetChangeOperation
extends ComplexOperation<[NotePropChangeOperation<"yOffset">, NoteRemoveOperation, NoteAddOperation]> {
    updatesEditor = true
    constructor(public note: Note, value: number, line: JudgeLine) {
        const valueChange = new NotePropChangeOperation(note, "yOffset", value);
        const tree = line.getNNList(note.speed, value, note.type === NoteType.hold, true)
        const node = tree.getNodeOf(note.startTime);
        const removal = new NoteRemoveOperation(note);
        const insert = new NoteAddOperation(note, node);
        super(valueChange, removal, insert);
        if (note.speed === 0 && value !== 0) {
            this.ineffective = true;
        }
    }
}


/**
 * 修改 Note 的 type 属性（音符类型）
 * 在 tap/drag/flick/hold 之间切换，切换到/从 hold 时需要重新定位 NoteNode
 * @example
 * // 将 note 改为 hold 类型
 * operationList.do(new NoteTypeChangeOperation(note, NoteType.hold));
 */
export class NoteTypeChangeOperation
extends ComplexOperation<[NotePropChangeOperation<"type">, NoteRemoveOperation, NoteAddOperation] | [NotePropChangeOperation<"type">]> {
    note: Note;
    value: number;
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
        this.note = note;
        this.value = value;
        this.updatesEditor = true;
    }
}

// 按照规矩，音符节点的时间不可变，所以不会对音符节点动手。
// 依旧不用组合的NoteTimeChangeOperation的方式，因为那需要多次更新跳数组。
/**
 * 把一组音符整体平移指定拍数。
 *
 * 音符时刻本身不可变，所以做法是改所属 NoteNode —— 这里直接操作内部结构
 * 而不是组合多个 {@linkcode NoteTimeChangeOperation}，因为后者会反复重建
 * 跳数组。`lazy` 静态方法被显式禁用（无效操作，不应延迟构造）。
 *
 * @author Zes Minkey Young
 *
 * @example
 * ```ts
 * // 把 4 拍之后的所有音符往后推 2 拍
 * const notes = nnList.getNodesAfterOne(nnList.getNodeOf([4, 0, 1])).flatMap(n => n.notes);
 * operations.do(new MultiNoteOffsetOperation(nnList, notes, [2, 0, 1]));
 * ```
 */
// @ts-expect-error 我需要明确禁用掉lazy静态方法，这不会破坏类型安全。
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


type TimeRange = [TimeT, TimeT]

/**
 * 删除 NNList 上一段时间内的所有音符，并把后面的音符整体前移，补上空缺。
 *
 * 等价于"删掉区间 + 后续左移区间长度"，结束后会清理空节点。
 *
 * @example
 * ```ts
 * // 删掉 4~8 拍，后面的音符整体前移 4 拍
 * operations.do(new NNListTimeRangeDeleteOperation(nnList, [[4, 0, 1], [8, 0, 1]]));
 * ```
 */
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

/**
 * 在 NNList 的指定位置插入一段空白，后面的音符整体后移。
 *
 * @example
 * ```ts
 * // 在 4 拍处插入 2 拍空白
 * operations.do(new NNListAddBlankOperation(nnList, [4, 0, 1], [2, 0, 1]));
 * ```
 */
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


