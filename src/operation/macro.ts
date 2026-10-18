import { Operation, ComplexOperation } from "./basic";
import { EventMacroTime, EventMacroValue, NoteMacro} from "../macro"
import { EventStartNode } from "../event";
import { EventValueESType, TimeT } from "../chartTypes";
import { Chart } from "../chart";
import { ExpressionEvaluator, MacroEvaluator } from "../evaluator";
import { EventNodeTimeChangeOperation, EventNodeValueChangeOperation } from "./event";
import { Note, notePropTypes } from "../note";
import { HoldEndTimeChangeOperation, NotePropChangeOperation, NotePropName, NoteSpeedChangeOperation, NoteTimeChangeOperation, NoteYOffsetChangeOperation } from "./note";
import { checkType } from "../util";

/**
 * 重新求值所有绑定了某个时间宏的节点。
 *
 * 宏本质是 JS 表达式，可能带随机性，所以"重做"不等于"还原"；
 * 这里按宏的当前内容重算一遍，并把结果作为一次可撤销操作。
 *
 * @example
 * ```ts
 * operations.do(new MacroTimeReevaluateOperation(macro, chart));
 * ```
 */
export class MacroTimeReevaluateOperation extends ComplexOperation<EventNodeMacroTimeReevaluateOperation[]> {
    constructor(macroTime: EventMacroTime, chart: Chart) {
        const ops: EventNodeMacroTimeReevaluateOperation[] = [];
        for (const [node, _] of macroTime.consumers) {
            ops.push(new EventNodeMacroTimeReevaluateOperation(node as EventStartNode<any>, chart));
        }
        super(...ops);
    }
}

/**
 * 按节点上的时间宏重算该节点的时间。
 *
 * 宏返回的不是合法时间元组时，回退到节点当前时间。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeMacroTimeReevaluateOperation(node, chart));
 * ```
 */
export class EventNodeMacroTimeReevaluateOperation extends EventNodeTimeChangeOperation {
    constructor(node: EventStartNode<any>, chart: Chart) {
        let time: TimeT | undefined = node.macroTime?.eval?.(node, chart);
        if (!(Array.isArray(time) && time.length === 3)) {
            time = node.time;
        }
        super(node, time);
    }
}

/**
 * 给事件节点绑定（或换绑）一个时间宏，并立即求值。
 *
 * 撤销时恢复原宏，并按原宏重新求值。
 *
 * @example
 * ```ts
 * operations.do(new MacroTimeAssignOperation(macro, node));
 * ```
 */
export class MacroTimeAssignOperation extends Operation {
    /** 原本可能没有绑定宏 */
    public originalMacroTime: EventMacroTime | null;
    private timeChangeOperation: EventNodeMacroTimeReevaluateOperation;
    constructor(public macroTime: EventMacroTime, public node: EventStartNode<any>) {
        super();
        this.originalMacroTime = node.macroTime;
    }
    do(chart: Chart) {
        this.node.macroTime = this.macroTime;
        // 宏是可以有随机性的，理论上重做指令可能会产生不同结果
        this.timeChangeOperation = new EventNodeMacroTimeReevaluateOperation(this.node, chart)
        this.timeChangeOperation.do(chart);
    }
    undo(_chart: Chart) {
        this.node.macroTime = this.originalMacroTime;
        this.timeChangeOperation.undo(_chart);
    }
}

/**
 * 解绑事件节点上的时间宏。
 *
 * 解绑后节点时间不再被宏驱动，保留当前值。
 *
 * @example
 * ```ts
 * operations.do(new MacroTimeDeassginOperation(node));
 * ```
 */
export class MacroTimeDeassginOperation extends Operation {
    /** 原本可能没有绑定宏 */
    public originalMacroTime: EventMacroTime | null;
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

/**
 * 重新求值所有绑定了某个值宏的节点。
 *
 * @example
 * ```ts
 * operations.do(new MacroValueReevaluateOperation(macro, chart));
 * ```
 */
export class MacroValueReevaluateOperation extends ComplexOperation<EventNodeMacroValueReevaluateOperation[]> {
    constructor(macroValue: EventMacroValue, chart: Chart) {
        const ops: EventNodeMacroValueReevaluateOperation[] = [];
        for (const [node, _] of macroValue.consumers) {
            ops.push(new EventNodeMacroValueReevaluateOperation(node as EventStartNode<any>, chart));
        }
        super(...ops);
    }
}


/**
 * 按节点上的值宏重算该节点的值。
 *
 * @example
 * ```ts
 * operations.do(new EventNodeMacroValueReevaluateOperation(node, chart));
 * ```
 */
export class EventNodeMacroValueReevaluateOperation extends EventNodeValueChangeOperation<EventValueESType> {
    constructor(node: EventStartNode<any>, chart: Chart) {
        const value = node.macro?.eval?.(node, chart);
        super(node, value);
    }
}

/**
 * 给事件节点绑定（或换绑）一个值宏，并立即求值。
 *
 * @example
 * ```ts
 * operations.do(new MacroValueAssignOperation(macro, node));
 * ```
 */
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
        this.valueChangeOperation.do(chart);
    }
    undo(chart: Chart) {
        this.node.macro = this.originalMacroValue;
        this.valueChangeOperation.undo(chart);
    }
}

/**
 * 解绑事件节点上的值宏。
 *
 * @example
 * ```ts
 * operations.do(new MacroValueDeassginOperation(node));
 * ```
 */
export class MacroValueDeassginOperation extends Operation {
    public originalMacroValue: EventMacroValue;
    constructor(public node: EventStartNode<any>) {
        super();
        this.originalMacroValue = node.macro;
    }
    do(chart: Chart) {
        // 置null表示已解绑，使用处都走了 `macro?.` 之类的守卫
        this.node.macro = null as unknown as EventMacroValue;
    }
    undo(_chart: Chart) {
        this.node.macro = this.originalMacroValue;
    }
}

/**
 * 重新求值所有绑定了某个宏的音符。
 *
 * @example
 * ```ts
 * operations.do(new NoteMacroReevaluateOperation(macro, chart));
 * ```
 */
export class NoteMacroReevaluateOperation extends ComplexOperation<NoteNoteMacroReevaluateOperation[]> {
    constructor(macroValue: NoteMacro, chart: Chart) {
        const ops: NoteNoteMacroReevaluateOperation[] = [];
        for (const [node, _] of macroValue.consumers) {
            ops.push(new NoteNoteMacroReevaluateOperation(node, chart));
        }
        super(...ops);
    }
}


/**
 * 按音符上的宏重算该音符的各项属性。
 *
 * 只为宏实际返回了的字段生成子操作（时间、hold 结束时间、位置、透明度、
 * 大小、是否假音符、可见拍、yOffset、speed），因此同一个宏在不同音符上
 * 可能产生不同数量的子操作。
 *
 * @example
 * ```ts
 * operations.do(new NoteNoteMacroReevaluateOperation(note, chart));
 * ```
 */
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

/**
 * 给音符绑定（或换绑）一个宏，并立即求值。
 *
 * @example
 * ```ts
 * operations.do(new NoteMacroAssignOperation(macro, note));
 * ```
 */
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
        this.changeOperation.do(chart);
    }
    undo(chart: Chart) {
        this.note.macro = this.originalMacro;
        this.changeOperation.undo(chart);
    }
}

/**
 * 解绑音符上的宏。
 *
 * @example
 * ```ts
 * operations.do(new NoteMacroDeassginOperation(note));
 * ```
 */
export class NoteMacroDeassginOperation extends Operation {
    public originalMacro: NoteMacro;
    constructor(public note: Note) {
        super();
        this.originalMacro = note.macro;
    }
    do(chart: Chart) {
        // 置null表示已解绑，使用处都走了 `macro?.` 之类的守卫
        this.note.macro = null as unknown as NoteMacro;
    }
    undo(_chart: Chart) {
        this.note.macro = this.originalMacro;
    }
}

/**
 * 修改宏的表达式，可撤销
 *
 * 宏求值器的表达式字段为expression，其余宏为macro。
 *
 * 只改文本，不会自动重新求值；改完通常再接一次
 * {@linkcode MacroEvaluatorReevaluateOperation} 或对应的 Reevaluate 操作。
 *
 * @example
 * ```ts
 * operations.do(new MacroExpressionChangeOperation(macro, "@node.time + 0.5"));
 * ```
 */
export class MacroExpressionChangeOperation extends Operation {
    public originalExpression: string;
    constructor(
        public macro: NoteMacro | EventMacroTime | EventMacroValue | MacroEvaluator<any>,
        public expression: string
    ) {
        super();
        this.originalExpression = this.read();
    }
    private read(): string {
        return this.macro instanceof MacroEvaluator ? this.macro.expression : this.macro.macro;
    }
    private write(expression: string) {
        if (this.macro instanceof MacroEvaluator) {
            this.macro.expression = expression;
        } else {
            this.macro.macro = expression;
        }
    }
    do(_chart: Chart) {
        this.write(this.expression);
    }
    undo(_chart: Chart) {
        this.write(this.originalExpression);
    }
}

/**
 * 重新编译宏求值器在所有绑定节点上的表达式，可撤销
 *
 * 与 {@linkcode MacroExpressionChangeOperation} 搭配使用：前者改文本，
 * 本操作把新表达式编译到每个消费者节点上。
 *
 * @example
 * ```ts
 * operations.do(new MacroEvaluatorReevaluateOperation(evaluator, chart));
 * ```
 */
export class MacroEvaluatorReevaluateOperation extends Operation {
    private originals: [EventStartNode<any>, ExpressionEvaluator<any>][];
    constructor(public evaluator: MacroEvaluator<any>, public chart: Chart) {
        super();
        this.updatesEditor = true;
        this.originals = [];
        evaluator.consumers.forEach((expressionEvaluator, node) => {
            this.originals.push([node, expressionEvaluator]);
        });
    }
    do(_chart: Chart) {
        for (const [node] of this.originals) {
            this.evaluator.assignTo(node, this.chart);
        }
    }
    undo(_chart: Chart) {
        for (const [node, expressionEvaluator] of this.originals) {
            this.evaluator.consumers.set(node, expressionEvaluator);
        }
    }
}



