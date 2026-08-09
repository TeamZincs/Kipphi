import { Operation, ComplexOperation } from "./basic";
import { EventMacroTime, EventMacroValue, NoteMacro} from "../macro"
import { EventStartNode } from "../event";
import { EventValueESType, TimeT } from "../chartTypes";
import { Chart } from "../chart";
import { EventNodeTimeChangeOperation, EventNodeValueChangeOperation } from "./event";
import { Note, notePropTypes } from "../note";
import { HoldEndTimeChangeOperation, NotePropChangeOperation, NotePropName, NoteSpeedChangeOperation, NoteTimeChangeOperation, NoteYOffsetChangeOperation } from "./note";
import { checkType } from "../util";

export class MacroTimeReevaluateOperation extends ComplexOperation<EventNodeMacroTimeReevaluateOperation[]> {
    constructor(macroTime: EventMacroTime, chart: Chart) {
        const ops: EventNodeMacroTimeReevaluateOperation[] = [];
        for (const [node, _] of macroTime.consumers) {
            ops.push(new EventNodeMacroTimeReevaluateOperation(node, chart));
        }
        super(...ops);
    }
}

export class EventNodeMacroTimeReevaluateOperation extends EventNodeTimeChangeOperation {
    constructor(node: EventStartNode<any>, chart: Chart) {
        let time: TimeT = node.macroTime?.eval?.(node, chart);
        if (!(Array.isArray(time) && time.length === 3)) {
            time = node.time;
        }
        super(node, time);
    }
}

export class MacroTimeAssignOperation extends Operation {
    public originalMacroTime: EventMacroTime;
    private timeChangeOperation: EventNodeMacroTimeReevaluateOperation;
    constructor(public macroTime: EventMacroTime, public node: EventStartNode<any>) {
        super();
        this.originalMacroTime = node.macroTime;
    }
    do(chart: Chart) {
        this.node.macroTime = this.macroTime;
        // 宏是可以有随机性的，理论上重做指令可能会产生不同结果
        this.timeChangeOperation = new EventNodeMacroTimeReevaluateOperation(this.node, chart)
    }
    undo(_chart: Chart) {
        this.node.macroTime = this.originalMacroTime;
        this.timeChangeOperation.undo();
    }
}

export class MacroTimeDeassginOperation extends Operation {
    public originalMacroTime: EventMacroTime;
    constructor(public node: EventStartNode<any>) {
        super();
        this.originalMacroTime = node.macroTime;
    }
    do(chart: Chart) {
        this.node.macroTime = null;
    }
    undo(_chart: Chart) {
        this.node.macroTime = this.originalMacroTime;
    }
}

export class MacroValueReevaluateOperation extends ComplexOperation<EventNodeMacroValueReevaluateOperation[]> {
    constructor(macroValue: EventMacroValue, chart: Chart) {
        const ops: EventNodeMacroValueReevaluateOperation[] = [];
        for (const [node, _] of macroValue.consumers) {
            ops.push(new EventNodeMacroValueReevaluateOperation(node, chart));
        }
        super(...ops);
    }
}


export class EventNodeMacroValueReevaluateOperation extends EventNodeValueChangeOperation<EventValueESType> {
    constructor(node: EventStartNode<any>, chart: Chart) {
        const value = node.macro?.eval?.(node, chart);
        super(node, value);
    }
}

export class MacroValueAssignOperation extends Operation {
    public originalMacroValue: EventMacroValue;
    private valueChangeOperation: EventNodeMacroValueReevaluateOperation;
    constructor(public macroValue: EventMacroValue, public node: EventStartNode<any>) {
        super();
        this.originalMacroValue = node.macro;
    }
    do(chart: Chart) {
        this.node.macro = this.macroValue;
        // 宏是可以有随机性的，理论上重做指令可能会产生不同结果
        this.valueChangeOperation = new EventNodeMacroValueReevaluateOperation(this.node, chart)
    }
    undo(chart: Chart) {
        this.node.macro = this.originalMacroValue;
        this.valueChangeOperation.undo(chart);
    }
}

export class MacroValueDeassginOperation extends Operation {
    public originalMacroValue: EventMacroValue;
    constructor(public node: EventStartNode<any>) {
        super();
        this.originalMacroValue = node.macro;
    }
    do(chart: Chart) {
        this.node.macro = null;
    }
    undo(_chart: Chart) {
        this.node.macro = this.originalMacroValue;
    }
}

export class NoteMacroReevaluateOperation extends ComplexOperation<NoteNoteMacroReevaluateOperation[]> {
    constructor(macroValue: NoteMacro, chart: Chart) {
        const ops: NoteNoteMacroReevaluateOperation[] = [];
        for (const [node, _] of macroValue.consumers) {
            ops.push(new NoteNoteMacroReevaluateOperation(node, chart));
        }
        super(...ops);
    }
}


export class NoteNoteMacroReevaluateOperation extends ComplexOperation<Operation[]> {
    constructor(note: Note, chart: Chart) {
        const mnote = note.macro?.eval?.(note, chart);
        const arr: Operation[] = [];
        if (mnote.startTime) {
            checkType(mnote.startTime, notePropTypes.startTime);
            arr.push(NoteTimeChangeOperation.byTime(note, mnote.startTime))
        }
        if (mnote.endTime) {
            checkType(mnote.endTime, notePropTypes.endTime);
            arr.push(new HoldEndTimeChangeOperation(note, mnote.endTime))
        }
        for (const propName of ["positionX", "alpha", "size", "above", "isFake", "visibleBeats"] as const) {
            if (mnote[propName] !== undefined) {
                checkType(mnote[propName], notePropTypes[propName]);
                arr.push(new NotePropChangeOperation(note, propName, mnote[propName]));
            }
        }
        if (mnote.yOffset !== undefined) {
            checkType(mnote.yOffset, notePropTypes.yOffset);
            arr.push(new NoteYOffsetChangeOperation(note, mnote.yOffset, note.parentNode.parentSeq.parentLine));
        }
        if (mnote.speed !== undefined) {
            checkType(mnote.speed, notePropTypes.speed);
            arr.push(new NoteSpeedChangeOperation(note, mnote.speed, note.parentNode.parentSeq.parentLine));
        }

        super(...arr);
    }
}

export class NoteMacroAssignOperation extends Operation {
    public originalMacro: NoteMacro;
    private changeOperation: NoteNoteMacroReevaluateOperation;
    constructor(public macro: NoteMacro, public note: Note) {
        super();
        this.originalMacro = note.macro;
    }
    do(chart: Chart) {
        this.note.macro = this.macro;
        // 宏是可以有随机性的，理论上重做指令可能会产生不同结果
        this.changeOperation = new NoteNoteMacroReevaluateOperation(this.note, chart);
    }
    undo(chart: Chart) {
        this.note.macro = this.originalMacro;
        this.changeOperation.undo(chart);
    }
}

export class NoteMacroDeassginOperation extends Operation {
    public originalMacro: NoteMacro;
    constructor(public note: Note) {
        super();
        this.originalMacro = note.macro;
    }
    do(chart: Chart) {
        this.note.macro = null;
    }
    undo(_chart: Chart) {
        this.note.macro = this.originalMacro;
    }
}



