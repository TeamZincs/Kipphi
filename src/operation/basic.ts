import { Chart } from "../chart";




export type OpEventType = "do" | "beforedo" | "undo" | "redo" | "error" | "needsupdate" | "maxcombochanged" | "noundo" | "noredo" | "firstmodified" | "needsreflow";

// 最讲类型安全的一集（
// 当然要有，不然的话编辑器那边检测的时候逆变会出问题

interface DirectlyInstaciableEventMap {
    "noundo": OpEvent;
    "noredo": OpEvent;
    "firstmodified": OpEvent;
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
    "beforedo": OperationEvent;
    "needsupdate": OperationEvent;
    "needsreflow": NeedsReflowEvent;
}


/** 操作的执行方向：`do` 是正向执行（含首次执行与重做），`undo` 是撤销 */
export type OperationDirection = "do" | "undo";

/** 可以被 `onOperation` 监听的操作类 */
export type OperationClass = new (...args: any[]) => Operation;

/** `onOperation` 的监听器 */
export type OperationListener<C extends OperationClass> =
    (operation: InstanceType<C>, direction: OperationDirection) => void;

interface OperationHook {
    klass: OperationClass;
    listener: OperationListener<OperationClass>;
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
    /** 操作尚未构造出来时（如懒操作构造抛错）为undefined */
    constructor(t: "do" | "undo" | "redo" | "error" | "needsupdate" | "beforedo", public operation: Operation | undefined) {
        super(t);
    }
}

export class OperationErrorEvent extends OperationEvent {
    constructor(operation: Operation | undefined, public error: Error) {
        super("error", operation);
    }
}

export class MaxComboChangeEvent extends OpEvent {
    /**
     * @param comboDelta 带符号的增量。**已经应用到 `chart.maxCombo` 上了**，
     * 监听方只应据此刷新 UI，不要再加一遍
     */
    constructor(public comboDelta: number) {
        super("maxcombochanged");
    }
}



export class OperationList extends EventTarget {
    operations: Operation[];
    undoneOperations: Operation[];
    /** 按操作类注册的监听器 */
    private readonly hooks: OperationHook[] = [];
    constructor(public readonly chart: Chart) {
        super()
        this.operations = [];
        this.undoneOperations = [];
    }

    /**
     * 监听某一类操作的执行与撤销
     *
     * 与 `addEventListener("do")` 不同，这里会**穿透**：
     * - {@linkcode ComplexOperation} 的子操作（如 `NoteSpeedChangeOperation` 里的
     *   `NotePropChangeOperation` / `NoteRemoveOperation` / `NoteAddOperation`）
     * - {@linkcode UnionOperation} / {@linkcode LazyOperation} 包装的操作
     *
     * 监听的是**类**，子类也会命中（`instanceof`）。被 {@linkcode Operation.rewrite}
     * 合并掉的变更同样会按 `do` 通知一次——那次变更确实生效了。
     *
     * ```ts
     * operations.onOperation(JudgeLinePropChangeOperation, (op, direction) => {
     *     if (direction === "do" && op.field === "texture") reload(op.value);
     * });
     * ```
     *
     * @since 3.0.0
     */
    onOperation<C extends OperationClass>(klass: C, listener: OperationListener<C>): void {
        this.hooks.push({ klass, listener: listener as OperationListener<OperationClass> });
    }

    /** 取消 `onOperation` 注册的监听器（同一个类 + 同一个函数） */
    offOperation<C extends OperationClass>(klass: C, listener: OperationListener<C>): void {
        const index = this.hooks.findIndex(hook => hook.klass === klass && hook.listener === listener);
        if (index >= 0) this.hooks.splice(index, 1);
    }

    /** 遍历操作树，给匹配的监听器发通知 */
    private notifyOperation(operation: Operation | undefined, direction: OperationDirection) {
        if (!operation || this.hooks.length === 0) return;

        // 一次遍历把命中的（操作, 监听器）全收下来。predicate 恒返回 false，
        // 这样 find 会走完整棵树——容器操作的 find 应当「先测自己，再逐个问子操作」。
        const matches: { hook: OperationHook; operation: Operation }[] = [];
        operation.find(op => {
            for (const hook of this.hooks) {
                if (op instanceof hook.klass) matches.push({ hook, operation: op });
            }
            return false;
        });

        for (const { hook, operation: matched } of matches) {
            try {
                hook.listener(matched, direction);
            } catch (error) {
                // 监听器自己的问题不该影响操作本身
                console.error(error);
            }
        }
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
            this.notifyOperation(op, "undo");
            // 撤销要把物量增量反向应用
            this.processFlags(op, "undo");
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
            this.notifyOperation(op, "do");
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
        const event = new OperationEvent("beforedo", operation);
        this.dispatchEvent(event);
        if (event.defaultPrevented) {
            return;
        }
        // 如果上一个操作是同一个构造器的，那么试图修改上一个操作而不是立即推入新的操作
        if (this.operations.length !== 0) {
                
            const lastOp = this.operations[this.operations.length - 1]
            if (operation.constructor === lastOp.constructor) {
                // 返回值指示是否重写成功
                if (lastOp.rewrite(operation, this.chart)) {
                    // 这次变更确实生效了，只是被合并进上一条操作，规格上仍算一次 do
                    this.notifyOperation(operation, "do");
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
        this.undoneOperations = [];
        this.operations.push(operation);
        this.dispatchEvent(new OperationEvent("do", operation));
        this.notifyOperation(operation, "do");
        this.processFlags(operation);
    }
    tryDo(returnOperation: () => Operation) {
        let op: Operation;
        try {
            op = returnOperation();
        } catch (e) {
            // 操作没能构造出来，此时op还是undefined
            this.dispatchEvent(new OperationErrorEvent(undefined, e as Error))
            return
        }
        this.do(op);
    } 
    /**
     * 处理操作留下的标记
     *
     * `maxCombo` 也在这里维护：库自己应用增量（撤销时取负），之后派的
     * `maxcombochanged` 只是通知，监听方不要再加到 `chart.maxCombo` 上。
     */
    processFlags(operation: Operation, direction: OperationDirection = "do") {
        if (operation.updatesEditor) {
            this.dispatchEvent(new OperationEvent("needsupdate", operation));
        }
        // NaN 表示操作自己说不清，交给 applyComboDelta 去全谱重数
        if (typeof operation.comboDelta === "number" && operation.comboDelta !== 0) {
            const delta = direction === "undo" ? -operation.comboDelta : operation.comboDelta;
            this.chart.applyComboDelta(delta);
            this.dispatchEvent(new MaxComboChangeEvent(delta));
        }
        if (operation.reflows) {
            this.dispatchEvent(new NeedsReflowEvent(operation.reflows))
        }
    }
    clear() {
        this.operations = [];
    }
    addEventListener<T extends OpEventType>(type: T, listener: (event: OpEventMap[T]) => void, options?: boolean | AddEventListenerOptions): void {
        // 这里是自定义事件名，EventTarget的DOM类型声明不认识，运行时由自身派发
        super.addEventListener(type, listener as unknown as EventListener, options);
    }
}


/**
 * 所有可撤销操作的基类。
 *
 * 操作只记录"从什么变成了什么"，不关心何时被调用。`do` 与 `undo`
 * 必须严格互逆，且一次 `do` 之后紧跟一次 `undo` 应当让谱面回到原状。
 *
 * 编辑器通常不直接调用 `do` / `undo`，而是把操作推入
 * {@linkcode OperationList}，由其负责调用与事件通知。
 *
 * @example
 * ```ts
 * class ChartRenameOperation extends Operation {
 *     private original: string;
 *     constructor(private chart: Chart, public name: string) {
 *         super();
 *         this.original = chart.name;
 *     }
 *     do() { this.chart.name = this.name; }
 *     undo() { this.chart.name = this.original; }
 * }
 * ```
 */
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
    rewrite(op: this, chart: Chart): boolean {return false;}
    /**
     * 在自己内部（含自己）查找操作，返回第一个让 `predicate` 为 `true` 的
     *
     * 找不到返回 `null`。默认只检查自己（没有内部操作）；容器操作重写它：
     * 先用 `predicate(this)` 测自己，再逐个询问子操作。
     */
    find(predicate: (operation: Operation) => boolean): Operation | null {
        return predicate(this) ? this : null;
    }
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
 *
 * @example
 * ```ts
 * // 不要这样写：构造时就会读取 note 的当前状态
 * buffer.push(new NoteRemoveOperation(note));
 * // 而应这样写：真正 do 的时候才去读状态
 * buffer.push(NoteRemoveOperation.lazy(note));
 * ```
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
    override find(predicate: (operation: Operation) => boolean): Operation | null {
        // do 之前还没实例化
        return super.find(predicate) ?? this.operation?.find(predicate) ?? null;
    }
    do(chart: Chart) {
        this.operation = new this.operationClass(...this.args);
        this.operation!.do(chart);
    }
    undo(chart: Chart) {
        // do之前operation尚未实例化
        this.operation?.undo(chart);
    }
}


/**
 * C语言借来的概念
 * 
 * 一个不确定类型的子操作
 * 
 * 注意这个操作不懒，会在构造时就实例化子操作
 *
 * @example
 * ```ts
 * // 根据音符类型决定要不要顺带改 endTime，hold以外返回null表示无需子操作
 * new UnionOperation(() => {
 *     if (note.type !== NoteType.hold) {
 *         return new NotePropChangeOperation(note, "endTime", node.startTime);
 *     }
 *     return null;
 * });
 * ```
 */
export class UnionOperation<T extends Operation | null> extends Operation {
    operation: T;
    constructor(matcher: () => T) {
        super();
        this.operation = matcher();
        if (!this.operation) {
            this.ineffective = true;
        }
    }
    override find(predicate: (operation: Operation) => boolean): Operation | null {
        return super.find(predicate) ?? this.operation?.find(predicate) ?? null;
    }
    // 这样子写不够严密，如果要继承这个类，并且子操作需要谱面，就要重写这个方法的签名
    do(chart?: Chart) {
        // 需要谱面的子操作会重写本方法并收窄参数类型
        this.operation?.do(chart!);
    }
    undo(chart?: Chart) {
        // 同上
        this.operation?.undo(chart!);
    }
}


/**
 * 由若干子操作拼成的复合操作。
 *
 * `do` 按正序执行子操作，`undo` 按逆序回滚；`ineffective` 的子操作会被跳过。
 * 组合顺序决定了撤销的正确性，因此子操作之间有依赖时要先想清楚顺序。
 *
 * @example
 * ```ts
 * // 删除判定线：先移除，再把后面所有线的id依次前移
 * new JudgeLineDeleteOperation(chart, line);
 * //= ComplexOperation<[JudgeLineRemoveOperation, ...LazyOperation<...>[]]>
 * ```
 */
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
    override find(predicate: (operation: Operation) => boolean): Operation | null {
        if (predicate(this)) return this;
        for (const sub of this.subOperations) {
            const found = sub.find(predicate);
            if (found) return found;
        }
        return null;
    }
    // 这样子写不够严密，如果要继承这个类，并且子操作需要谱面，就要重写这个方法的签名
    do(chart?: Chart) {
        const length = this.length
        for (let i = 0; i < length; i++) {
            const op = this.subOperations[i]
            if (op.ineffective) {
                continue;
            }
            op.do(chart!)
        }
    }
    undo(chart?: Chart) {
        const length = this.length
        for (let i = length - 1; i >= 0; i--) {
            const op = this.subOperations[i]
            if (op.ineffective) { continue; }
            op.undo(chart!)
        }
    }
}