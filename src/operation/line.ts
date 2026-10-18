import { Chart, JudgeLineGroup, BasicEventName, UIName } from "../chart";
import { EventType, ExtendedEventTypeName, RGB } from "../chartTypes";
import { EventNodeSequence } from "../event";
import { JudgeLine, ExtendedLayer } from "../judgeline";
import { ComplexOperation, LazyOperation, Operation } from "./basic";
import { EventNodeSequenceRenameOperation } from "./event";



// 有点怪异，感觉破坏了纯净性。不管了（
enum JudgeLinesEditorLayoutType {
    ordered = 0b001,
    tree    = 0b010,
    grouped = 0b100
}


/**
 * 修改判定线的父判定线（或脱离父线）。
 *
 * 传入 `null` 表示脱离，此时判定线会进入 `chart.orphanLines`。
 * 若目标父线是本线的后代，会形成环，构造时判定为 `ineffective` 静默失效，
 * 调用方应当先用 {@linkcode JudgeLine.checkinterdependency} 自行判断并抛错。
 *
 * @example
 * ```ts
 * // 挂到另一条线下；传 null 表示脱离
 * operations.do(new JudgeLineInheritanceChangeOperation(chart, line, father));
 * operations.do(new JudgeLineInheritanceChangeOperation(chart, line, null));
 * ```
 */
export class JudgeLineInheritanceChangeOperation extends Operation {
    originalValue: JudgeLine | null;
    updatesEditor = true;
    static REFLOWS = JudgeLinesEditorLayoutType.tree;
    reflows = JudgeLineInheritanceChangeOperation.REFLOWS;
    constructor(public chart: Chart, public judgeLine: JudgeLine, public value: JudgeLine | null) {
        super();
        this.originalValue = judgeLine.father;
        if (this.originalValue === this.value) {
            this.ineffective = true;
        }
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

/**
 * 修改判定线名称。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineRenameOperation(line, "新名字"));
 * ```
 */
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

export type JudgeLinePropName = "name" | "rotatesWithFather" | "anchor" | "texture" | "cover" | "zOrder";

/**
 * 修改判定线的单个标量属性。
 *
 * 只处理 {@linkcode JudgeLinePropName} 里的字段，事件序列请用
 * {@linkcode JudgeLineENSChangeOperation}，扩展层请用
 * {@linkcode JudgeLineExtendENSChangeOperation}。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLinePropChangeOperation(line, "texture", "line.png"));
 * operations.do(new JudgeLinePropChangeOperation(line, "rotatesWithFather", true));
 * ```
 */
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

/**
 * 把判定线移动到另一个判定线组。
 *
 * 会同时处理旧组与新组的增删，撤销时原样恢复。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineRegroupOperation(line, chart.judgeLineGroups[1]));
 * ```
 */
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
        this.originalValue?.remove(this.judgeLine);
        this.value?.add(this.judgeLine);
    }
    undo() {
        this.judgeLine.group = this.originalValue;
        this.value?.remove(this.judgeLine);
        this.originalValue?.add(this.judgeLine);
    }
}

/**
 * 新建一条判定线。
 *
 * 线在构造时就已由调用方创建好，`do` 时才真正分配 id、挂进
 * `judgeLines` / `orphanLines` / 第 0 个组，并补出 scaleX/scaleY 扩展序列。
 *
 * @example
 * ```ts
 * const line = new JudgeLine(chart);
 * operations.do(new JudgeLineCreateOperation(chart, line));
 * ```
 */
export class JudgeLineCreateOperation extends Operation {
    reflows = JudgeLinesEditorLayoutType.grouped | JudgeLinesEditorLayoutType.tree | JudgeLinesEditorLayoutType.ordered;
    //judgeLine: JudgeLine;
    // 之前把=写成了:半天不知道咋错了
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
        //this.judgeLine = new JudgeLine(chart);
    }
    do(chart: Chart) {
        const id = this.chart.judgeLines.length;
        this.judgeLine.id = id;
        this.chart.judgeLines.push(this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.chart.judgeLineGroups[0].add(this.judgeLine);
        this.judgeLine.extendedLayer.scaleX = chart.createEventNodeSequence(EventType.scaleX, `#${id}.ex.scaleX`);
        this.judgeLine.extendedLayer.scaleY = chart.createEventNodeSequence(EventType.scaleY, `#${id}.ex.scaleY`);
        debugger
    }
    undo() {
        this.chart.judgeLineGroups[0].remove(this.judgeLine);
        this.chart.judgeLines.splice(this.chart.judgeLines.indexOf(this.judgeLine), 1);
        this.chart.orphanLines.splice(this.chart.orphanLines.indexOf(this.judgeLine), 1);
    }
}

/**
 * 把判定线从谱面中摘下来的内部操作。
 *
 * 不对外导出：单独使用会让后面的线 id 出现空洞，应当走
 * {@linkcode JudgeLineDeleteOperation}。
 */
class JudgeLineRemoveOperation extends Operation {
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
        this.chart.judgeLines.splice(this.judgeLine.id, 0, this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.originalGroup.add(this.judgeLine);
    }
}

/**
 * 删除一条判定线，并把后面所有线的 id 依次前移。
 *
 * 是"移除 + 批量改 id"的复合操作，保证 `judgeLines` 里 id 连续。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineDeleteOperation(chart, chart.judgeLines[3]));
 * // 原来 id 为 4、5… 的线会变成 3、4…
 * ```
 */
export class JudgeLineDeleteOperation extends ComplexOperation<[JudgeLineRemoveOperation, ...LazyOperation<typeof JudgeLineIdChangeOperation>[]]> {
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super(new JudgeLineRemoveOperation(chart, judgeLine), ...chart.judgeLines.slice(judgeLine.id + 1).map(line => JudgeLineIdChangeOperation.lazy(line)));
    }
}


/**
 * 替换判定线某个事件层上的整条事件序列。
 *
 * `typeStr` 只接受事件层上真实存在的四种类型（`moveX` / `moveY` /
 * `rotate` / `alpha`），速度序列请直接改 `judgeLine.speedSequence`。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineENSChangeOperation(
 *     line, 0, "alpha", chart.createEventNodeSequence(EventType.alpha, "#0.0.alpha")
 * ));
 * ```
 */
export class JudgeLineENSChangeOperation extends Operation {
    originalValue: EventNodeSequence;
    constructor(public judgeLine: JudgeLine, public layerId: number, public typeStr: BasicEventName, public value: EventNodeSequence) {
        super();
        this.originalValue = judgeLine.eventLayers[layerId][typeStr]!;
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
/**
 * 设置或清空判定线的某个扩展层序列（`scaleX` / `scaleY` / `text` / `color`）。
 *
 * `value` 传 `null` 表示移除该扩展层。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineExtendENSChangeOperation(line, "text", textSeq));
 * operations.do(new JudgeLineExtendENSChangeOperation(line, "text", null)); // 移除
 * ```
 */
export class JudgeLineExtendENSChangeOperation<T extends ExtendedEventTypeName> extends Operation {
    originalValue: ENSOfTypeName<T>;
    constructor(public judgeLine: JudgeLine, public typeStr: T, public value: ENSOfTypeName<T> | null) {
        super();
        this.originalValue = judgeLine.extendedLayer[typeStr satisfies keyof ExtendedLayer] as ENSOfTypeName<T>;
    }
    do() {
        // ExtendedLayer的成员是可选的，用undefined表示置空
        this.judgeLine.extendedLayer[this.typeStr] = this.value ?? undefined
    }
    undo() {
        this.judgeLine.extendedLayer[this.typeStr] = this.originalValue
    }

}

/**
 * 把某个 UI（combo / score / bar 等）挂到判定线上。
 *
 * 一个 UI 同时只能挂一条线，挂到新线上会顶掉原来的。
 *
 * @example
 * ```ts
 * operations.do(new UIAttachOperation(chart, chart.judgeLines[0], "combo"));
 * ```
 */
export class UIAttachOperation extends Operation {
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

/**
 * 把某个 UI 从它当前所在的判定线上摘下来。
 *
 * 该 UI 本来就没挂载时操作无效（`ineffective`）。
 *
 * @example
 * ```ts
 * operations.do(new UIDetachOperation(chart, "combo"));
 * ```
 */
export class UIDetachOperation extends Operation {
    updatesEditor = true;
    // ineffective时不会赋值，但这类操作会被跳过
    judgeLine!: JudgeLine;
    constructor(public chart: Chart, public ui: UIName) {
        super();
        const attached = chart[`${ui}Attach` satisfies keyof Chart];
        if (attached) {
            this.judgeLine = attached;
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

/**
 * 一次性摘掉挂在某条判定线上的所有 UI。
 *
 * 挂载关系在构造时快照，撤销时按快照还原。
 *
 * @example
 * ```ts
 * operations.do(new JudgeLineDetachAllUIOperation(chart, chart.judgeLines[2]));
 * ```
 */
export class JudgeLineDetachAllUIOperation extends Operation {
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

/**
 * 修改判定线id
 * 不需要自己传入ID
 *
 * 新 id 取该线在当前 `judgeLines` 里的下标，并同步把所有挂在它名下的事件
 * 序列 id（形如 `#3.alpha`）改名。通常在删除判定线后由
 * {@linkcode JudgeLineDeleteOperation} 内部以懒操作的形式使用。
 *
 * @example
 * ```ts
 * // id 从 5 变成 3，`#5.alpha` 一并变成 `#3.alpha`
 * operations.do(new JudgeLineIdChangeOperation(chart.judgeLines[3]));
 * // 只改 id、不动序列名
 * operations.do(new JudgeLineIdChangeOperation(line, false));
 * ```
 */
export class JudgeLineIdChangeOperation extends ComplexOperation<EventNodeSequenceRenameOperation[]> {
    originalValue: number;
    public value: number;
    public judgeLine: JudgeLine;
    /**
     * 
     * @param judgeLine 
     * @param renamesENS 是否对事件序列进行重命名
     */
    constructor(judgeLine: JudgeLine, renamesENS: boolean = true) {
        const value = judgeLine.chart.judgeLines.indexOf(judgeLine);
        const extendedLayer = judgeLine.extendedLayer;
        const ineffective = value === judgeLine.id;
        if (renamesENS && !ineffective) {
            super(
                ...judgeLine.eventLayers
                .flatMap((layer) => [layer.alpha, layer.moveX, layer.moveY, layer.rotate])
                .filter((seq): seq is EventNodeSequence => !!seq && /^#\d+\./.test(seq.id))
                .map(seq => new EventNodeSequenceRenameOperation(
                    seq,
                    `#${value}.${seq.id.substring(seq.id.indexOf(".") + 1)}`
                )),
                ...[extendedLayer.scaleX, extendedLayer.scaleY, extendedLayer.text, extendedLayer.color,
                    judgeLine.speedSequence]
                .filter((seq): seq is EventNodeSequence => !!seq && /^#\d+\./.test(seq.id))
                .map(seq => new EventNodeSequenceRenameOperation(
                    seq,
                    `#${value}.${seq.id.substring(seq.id.indexOf(".") + 1)}`
                ))
            );
        } else {
            super();
        }
        this.ineffective = ineffective;
        this.judgeLine = judgeLine;
        this.originalValue = judgeLine.id;
        this.value = value;
    }
    do(chart: Chart) {
        this.judgeLine.id = this.value;
        super.do(chart);
    }
    undo(chart: Chart) {
        this.judgeLine.id = this.originalValue;
        super.do(chart);
    }
}
