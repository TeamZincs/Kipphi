import { Operation, ComplexOperation } from "./basic";
import { EventMacroTime, EventMacroValue} from "../macro"
import { EventStartNode } from "../event";
import { TimeT } from "../chartTypes";
import { Chart } from "../chart";
import { EventNodeTimeChangeOperation } from "./event";



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

export class MacroTimeReevaluateOperation extends ComplexOperation<EventNodeMacroTimeReevaluateOperation[]> {
    constructor(macroTime: EventMacroTime, chart: Chart) {
        const ops: EventNodeMacroTimeReevaluateOperation[] = [];
        for (const node of macroTime.consumers) {
            ops.push(new EventNodeMacroTimeReevaluateOperation(node, chart));
        }
        super(...ops);
    }
}
