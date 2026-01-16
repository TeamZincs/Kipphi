import { Chart } from "../chart";




export type OpEventType = "do" | "undo" | "redo" | "error" | "needsupdate" | "maxcombochanged" | "noundo" | "noredo" | "firstmodified" | "needsreflow";

// 最讲类型安全的一集（
// 当然要有，不然的话编辑器那边检测的时候逆变会出问题

interface DirectlyInstaciableEventMap {
    "noundo": OpEvent;
    "noredo": OpEvent;
    "firstmodified": OpEvent;
    "needsupdate": OpEvent;
}

// 创建一个类型来检测意外的 override
// AI太好用了你知道吗
type CheckFinalOverrides<T> = {
    [K in keyof T]: K extends keyof OpEventMap ? 
        T[K] extends OpEventMap[K] ? T[K] : never : 
        T[K]
};

interface OpEventMap extends CheckFinalOverrides<DirectlyInstaciableEventMap> {
    "error": OperationErrorEvent;
    "maxcombochanged": MaxComboChangeEvent;
    "undo": OperationEvent;
    "redo": OperationEvent;
    "do": OperationEvent;
    "needsreflow": NeedsReflowEvent;
}


class OpEvent extends Event {
    protected constructor(type: OpEventType) {
        super(type);
    }
    /**
     * 如果这个类型没有对应子类应该用这个
     */
    static create(type: keyof DirectlyInstaciableEventMap) {
        return new OpEvent(type);
    }
}

export class NeedsReflowEvent extends OpEvent {
    constructor(public condition: number) {
        super("needsreflow");
    }
}

export class OperationEvent extends OpEvent {
    constructor(t: "do" | "undo" | "redo" | "error", public operation: Operation) {
        super(t);
    }
}

export class OperationErrorEvent extends OperationEvent {
    constructor(operation: Operation, public error: Error) {
        super("error", operation);
    }
}

export class MaxComboChangeEvent extends OpEvent {
    constructor(public comboDelta: number) {
        super("maxcombochanged");
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
                this.dispatchEvent(OpEvent.create("firstmodified"))
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
            this.dispatchEvent(OpEvent.create("noundo"))
        }
    }
    redo() {
        const op = this.undoneOperations.pop()
        if (op) {
            if (!this.chart.modified){
                this.chart.modified = true;
                this.dispatchEvent(OpEvent.create("firstmodified"))
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
            this.dispatchEvent(OpEvent.create("noredo"))
        }
    }
    do(operation: Operation) {
        if (operation.ineffective) {
            return
        }
        if (!this.chart.modified){
            this.chart.modified = true;
            this.dispatchEvent(OpEvent.create("firstmodified"))
        }
        // 如果上一个操作是同一个构造器的，那么试图修改上一个操作而不是立即推入新的操作
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
            this.dispatchEvent(OpEvent.create("needsupdate"));
        }
        if (operation.comboDelta) {
            this.dispatchEvent(new MaxComboChangeEvent(operation.comboDelta));
        }
        if (operation.reflows) {
            this.dispatchEvent(new NeedsReflowEvent(operation.reflows))
        }
    }
    clear() {
        this.operations = [];
    }
    addEventListener<T extends OpEventType>(type: T, listener: (event: OpEventMap[T]) => void, options?: boolean | AddEventListenerOptions): void {
        super.addEventListener(type, listener, options);
    }
}


export abstract class Operation {
    ineffective: boolean;
    updatesEditor: boolean;
    // 用于判定线编辑区的重排，若操作完成时的布局为这个值就会重排
    reflows: number;
    /** 
     * 此操作对谱面总物量产生了多少影响，正增负减。
     * 
     * 如果操作自身无法评估，应返回NaN，导致全谱重新数清物量
     */
    comboDelta: number;
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
export class LazyOperation<C extends new (...args: any[]) => any> extends Operation {
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


/**
 * C语言借来的概念
 * 
 * 一个不确定类型的子操作
 * 
 * 注意这个操作不懒，会在构造时就实例化子操作
 */
export class UnionOperation<T extends Operation> extends Operation {
    operation: T;
    constructor(matcher: () => T) {
        super();
        this.operation = matcher();
        if (!this.operation) {
            this.ineffective = true;
        }
    }
    // 这样子写不够严密，如果要继承这个类，并且子操作需要谱面，就要重写这个方法的签名
    do(chart?: Chart) {
        this.operation.do(chart);
    }
    undo(chart?: Chart) {
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
        this.comboDelta = sub.reduce((prev, op) => prev + op.comboDelta, 0);
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