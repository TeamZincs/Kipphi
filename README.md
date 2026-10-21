# Kipphi（奇谱）

> 用"奇谱"谱面内核将谱面解析为编辑器友好的格式！
>
> This is a Phigros KipphiApparatus / Re:PhiEdit ChartJSON parser and chart operating system.

Kipphi 是一个 **Phigros 自制谱的谱面内核**：它把 RPE / KPA 谱面 JSON 解析成一套面向编辑器的对象模型，并提供**可撤销重做的操作体系**（operation）、缓动求值、宏、跳数组加速、以及 Phira `extra.json` 与 RPE 的互转能力。

它是 [KPA（奇谱发生器）](https://github.com/TeamZincs/KPA) 的子项目。

"奇谱"来自荷兰化学家启普（Kipp），他发明了"启普发生器"，用于生产气体并随时停止反应。

在 [Phigros 自制谱 Wiki](https://pgrfm.miraheze.org/wiki) 了解更多。

---

## 目录

- [快速上手](#快速上手)
- [核心概念](#核心概念)
- [时间表示](#时间表示)
- [谱面模型](#谱面模型)
- [事件系统](#事件系统)
  - [事件不直接拥有缓动](#事件不直接拥有缓动)
- [缓动与求值器](#缓动与求值器)
- [宏](#宏)
- [操作与撤销重做](#操作与撤销重做)
  - [用 ComplexOperation 组合多步改动](#用-complexoperation-组合多步改动)
  - [高级 API：Op.ez](#高级-apiopez)
- [视频通道](#视频通道)
- [特效](#特效)
- [格式互转](#格式互转)
- [错误处理](#错误处理)
- [运行时配置](#运行时配置)
- [导出速查](#导出速查)
- [开发与构建](#开发与构建)

---

## 快速上手

### 读取谱面

```ts
import { Chart, RPEChartCompiler, ExtraJsonCompiler } from "kipphi";

// RPE → Kipphi。duration 是音乐时长（秒），extraJson 可选，用于同时导入视频
const chart = Chart.fromRPEJSON(rpeData, 120, phiraExtraJson);

// KPA / KPA2 → Kipphi
const chart2 = Chart.fromKPAJSON(kpaData);
```

### 导出谱面

```ts
// → KPA2（KPA 原生格式）
const kpa2 = chart.dumpKPA();

// → RPE
const rpe = new RPEChartCompiler(chart).compileChart();

// → Phira extra.json
const extra = new ExtraJsonCompiler(chart).compile();
```

### 遍历与读取

```ts
import { TC } from "kipphi";  // 时间工具

// 判定线
for (const line of chart.judgeLines) {
    const alpha = line.eventLayers[0]?.alpha;      // 事件序列
    if (alpha) {
        const node = alpha.getNodeAt(4);           // 4 拍处的起始节点
        console.log(node.value, alpha.getValueAt(4.5));
    }
    const stacked = line.getStackedValue("moveX", 4);   // 含父线叠加的最终值
}

// 音符
for (const [_, list] of chart.judgeLines[0].nnLists) {
    for (const node of list.getNodesAfterOne(list.head.next)) {
        for (const note of node.notes) console.log(note.startTime, note.type);
    }
}

// 时间换算（拍 ↔ 秒）
const seconds = chart.timeCalculator.toSeconds(4);
const beats = chart.timeCalculator.secondsToBeats(seconds);
```

---

## 核心概念

| 概念 | 类 | 说明 |
|---|---|---|
| 谱面 | `Chart` | 根对象，持有判定线、BPM、视频通道、宏库、UI 挂载 |
| 判定线 | `JudgeLine` | 事件层 + 音符树 + 父子继承关系 |
| 事件序列 | `EventNodeSequence<VT>` | 一条时间轴上的事件链，用跳数组加速随机访问 |
| 事件节点 | `EventStartNode` / `EventEndNode` | 成对的节点构成一个事件（段） |
| 音符 | `Note` | 语义层面的音符数据 |
| 音符节点 | `NoteNode` / `NNList` / `NNNList` | 按（速度, y偏移）分桶的音符树，按时间组织 |
| BPM | `BPMSequence` / `TimeCalculator` | 拍 ↔ 秒换算 |
| 视频 | `VideoEventNodeSequence` | 视频路径（阶梯型），配合 `alpha` / `dim` 两条数值序列 |
| 操作 | `Operation` / `OperationList` | 可撤销重做的改动单元 |
| 宏 | `MacroLib` / `EventMacroTime` 等 | 用 JS 表达式驱动节点时间/值 |

### 数据结构示意

```
Chart
├── judgeLines: JudgeLine[]
│   ├── eventLayers: EventLayer[]        // { moveX, moveY, rotate, alpha }，可多层
│   │   └── moveX: EventNodeSequence<number>
│   │       └── HEAD → S(t0) → E(t1) → S(t1) → E(t2) → … → S(final) → TAIL
│   ├── extendedLayer                   // { scaleX, scaleY, text, color }
│   ├── speedSequence: SpeedENS         // 判定线速度（影响 floorPosition）
│   ├── nnLists / hnLists: NNList[]     // 普通 / hold 音符树
│   ├── father / children               // 父子继承
│   └── group: JudgeLineGroup
├── nnnList: NNNList                    // 跨判定线的音符总索引
├── timeCalculator: TimeCalculator      // 拍 ↔ 秒
├── video: { name, alpha, dim }
└── macroLib: MacroLib
```

---

## 时间表示

时间用**带分数三元组** `TimeT = [整数部分, 分子, 分母]`，例如 `[4, 1, 2]` = 4.5 拍。这样可以在不动浮点数的前提下精确保存 1/3 拍之类的值。

```ts
import { TC } from "kipphi";

TC.toBeats([4, 1, 2]);        // 4.5
TC.add([1, 1, 2], [2, 1, 3]); // 相加，不约简
TC.vadd([1, 1, 2], [2, 1, 3]); // 相加并约简（推荐）
TC.eq / TC.ne / TC.gt / TC.lt / TC.cmp   // 比较（精确）
TC.validateIp(t)              // 原地规范化（约分、进位），失败抛 INVALID_TIME_TUPLE
```

需要拍数的地方（`getNodeAt(beats)` 等）都用 `number`；需要存进谱面的地方用 `TimeT`。

---

## 谱面模型

### Chart

```ts
class Chart {
    // 构造 / 解析
    static fromRPEJSON(data: ChartDataRPE, duration: number, extraJson?: PhiraExtraJson): Chart;
    static fromKPAJSON(data: ChartDataKPA | ChartDataKPA2): Chart;

    // 导出
    dumpKPA(): Required<ChartDataKPA2>;
    countMaxCombo(): void;      // 重算 chart.maxCombo
    checkErrors(): void;        // 全谱自检，错误进入 KPAError.buffer

    // 结构
    judgeLines: JudgeLine[];
    orphanLines: JudgeLine[];   // 没有父线的判定线
    judgeLineGroups: JudgeLineGroup[];
    nnnList: NNNList;
    video: VideoChannel;

    // 元信息
    name / level / composer / charter / illustrator: string;
    offset: number;             // 毫秒
    duration: number;           // 秒
    getEffectiveBeats(): number;
    updateEffectiveBeats(duration: number): void;

    // UI 挂载点（combo / score / bar / pause / name / level / combonumber）
    attachUIToLine(ui: UIName, judgeLine: JudgeLine): void;
    detachUI(ui: UIName): void;
    queryJudgeLineUI(judgeLine: JudgeLine): UIName[];

    // 资源扫描（给播放器预加载用）
    scanAllTextures(): Set<string>;
    scanAllVideos(): Set<string>;
}
```

### JudgeLine

```ts
class JudgeLine {
    id: number;
    name / texture: string;
    cover / rotatesWithFather: boolean;
    zOrder: number;
    anchor: [number, number];

    father: JudgeLine | null;       // null 表示游离
    children: Set<JudgeLine>;
    group: JudgeLineGroup;

    eventLayers: EventLayer[];      // { moveX?, moveY?, rotate?, alpha? }
    extendedLayer: ExtendedLayer;   // { scaleX?, scaleY?, text?, color? }
    speedSequence: SpeedENS;
    nnLists / hnLists: Map<string, NNList>;

    // 取值
    getStackedValue(type: keyof EventLayer, beats: number, usePrev?: boolean): number;
    getStackedValueBySeconds(type, beats, seconds, timeCalculator, usePrev?): number;
    getStackedFloorPosition(beats: number, timeCalculator: TimeCalculator): number;
    computeCurrentFloorPosition(beats: number, timeCalculator: TimeCalculator): void;
    computeTimeRange(beats, timeCalculator, startY, endY): [number, number][];  // 谜面渲染用

    // 音符树
    getNNList(speed: number, yOffset: number, isHold: boolean, initsJump: boolean): NNList;
    getNode(note: Note, initsJump: boolean): NoteNode;

    static checkinterdependency(judgeLine: JudgeLine, toBeFather: JudgeLine | null): boolean;
}
```

> 判定线的"父线"决定叠加：`getStackedValue` 会把父链上同名事件的值累加进来。设置父线前建议先用 `checkinterdependency` 排除成环。

### Note / NoteNode / NNList

`Note` 是音符本身，`NoteNode` 是同一时刻的一批音符，`NNList` 是按（速度, yOffset）分桶的一条时间链，`NNNList` 是跨判定线的总索引。

```ts
class Note {
    type: NoteType;             // tap / hold / flick / drag
    startTime / endTime: TimeT;
    positionX / size / speed / alpha / yOffset: number;
    isFake / above: boolean;
    visibleBeats: number;
    tint / tintHitEffects?: number;   // HEX
    judgeSize: number;
    parentNode: NoteNode;

    computeVisibleBeats(timeCalculator: TimeCalculator): void;
    dumpRPE(timeCalculator): NoteDataRPE;
    dumpKPA(): NoteDataKPA;
}

class NNList {
    speed: number;
    medianYOffset: number;
    getNodeOf(time: TimeT): NoteNode;     // 取或创建
    getNodeAt(beats: number): NNOrTail;
    clearEmptyNodes(updatesJump?: boolean): void;
}
```

> `Note.startTime` 不要直接改——音符归属哪个 `NoteNode` 由它决定。要移动请用 `Op.NoteTimeChangeOperation`（或 `Op.ez` 的 `to(note).startTime = ...`）。

---

## 事件系统

一条事件序列是**背靠背**的节点链：

```
HEAD → S₀(t₀) → E₀(t₁) → S₁(t₁) → E₁(t₂) → … → Sₙ(final) → TAIL
        └──── 事件0 ────┘        └──── 事件1 ────┘
```

- 第 i 个事件覆盖 `[Sᵢ.time, Eᵢ.time]`，值从 `Sᵢ.value` 变到 `Eᵢ.value`
- **插值方式由 `Sᵢ.evaluator` 决定 —— 事件本身不持有缓动**（见下节）
- 最后一个 `Sₙ`（final node）没有配对的 EndNode，它的值**向后无限延伸**
- 序列强制从 `[0, 0, 1]` 开始、节点时间严格递增、段与段首尾相接

```ts
class EventNodeSequence<VT extends EventValueESType = number> {
    constructor(type: EventType, effectiveBeats: number);
    id: string;                     // 默认 `#${lineId}.${layerId}.${typeName}`
    type: EventType;
    effectiveBeats: number;

    getNodeAt(beats: number, usePrev?: boolean): EventStartNode<VT>;
    getValueAt(beats: number, usePrev?: boolean): VT;
    getValueAtBySecs(beats, seconds, timeCalculator, usePrev?): VT;
    getFloorPositionAt(beats, timeCalculator): number;   // 仅 speed

    initJump(): void;               // 重建跳数组
    updateJump(from, to): void;     // 局部更新
    dump(): EventNodeSequenceDataKPA2<VT>;
    checkErrors(): void;

    static getDefaultValueFromEventType(type: EventType): EventValueESType;
    static mergeSequences(sequences: EventNodeSequence[]): EventNodeSequence;
}
```

### 事件不直接拥有缓动

这一点和 RPE 的直觉不一样，务必注意：**KPA 的事件节点上没有"缓动"字段，只有求值器**。缓动是求值器内部的成员：

```
EventStartNode
└── evaluator: Evaluator          ← 节点只持有这个
    └── EasedEvaluator
        └── easing: Easing        ← 缓动在这里
```

分层的目的是把"**怎么插值**"和"**插什么类型的值**"分开：同一个 `Easing`（比如 `easeInOutSine`）给出 0~1 的进度→插值结果，而数值 / 文本 / 颜色三种 `EasedEvaluator` 各自负责把它换算成对应类型的值。因此一个缓动可以被三种值类型共用。

由此产生几条实践规则：

- 想改变事件的手感，改的是 `node.evaluator`，**不是**给节点赋一个缓动
- RPE 里的 `easingType` 编号、`bezier` 控制点、表达式字符串，在 KPA 里统一落到某一种 `Evaluator`（`EasedEvaluator` / `ExpressionEvaluator` / `MacroEvaluator`）上
- `EventType.easing` 序列是**模板缓动**自己用的（模板缓动本身就是一条事件序列），不是所有事件的缓动存放处

```ts
import { Op, NumericEasedEvaluator, rpeEasingArray } from "kipphi";

const node = seq.getNodeAt(4);

// ❌ 没有这种写法：node.easing = ...
// ✅ 替换求值器
node.evaluator = new NumericEasedEvaluator(rpeEasingArray[5]);

// ✅ 可撤销的做法
list.do(new Op.EventNodeEvaluatorChangeOperation(
    node, new NumericEasedEvaluator(rpeEasingArray[5])
));
```

### 事件类型

```ts
enum EventType {
    moveX, moveY, rotate, alpha, speed, easing, bpm,
    scaleX, scaleY, text, color,
    video, videoAlpha, videoDim      // 2.2.0 起
}
```

`ValueTypeOfEventType<T>` 给出每个类型对应的值类型（`number` / `string` / `RGB`）。

> `EventType.alpha` 是 0~255；`EventType.videoAlpha` / `videoDim` 是 0~1，别混用。

---

## 缓动与求值器

> **缓动不挂在事件上，它挂在求值器上。** 事件节点只有一个 `evaluator: Evaluator`，缓动是 `EasedEvaluator` 内部的成员 —— 参见 [事件不直接拥有缓动](#事件不直接拥有缓动)。

下面是类层次：

```ts
// 缓动对象：只负责"进度 → 插值结果"，与值类型无关
Easing
├── NormalEasing        // 常规缓动，带 rpeId（如 easeInOutSine）
├── BezierEasing        // 贝塞尔
├── SegmentedEasing     // 截取缓动的 [left, right] 区间
├── TemplateEasing      // 由事件序列定义的模板缓动
└── WrapperEasing       // 由 JS 表达式定义

// 求值器：持有缓动，并把 0~1 的插值结果换算成具体值类型
Evaluator
├── EasedEvaluator ── NumericEasedEvaluator / TextEasedEvaluator / ColorEasedEvaluator
├── ExpressionEvaluator // easingType 当 JS 表达式解读
├── MacroEvaluator
└── ConstEvaluator      // CONST_EVALUATOR
```

即：`事件节点 → Evaluator → Easing`。同一个 `Easing` 可以被三种 `EasedEvaluator` 复用。

常用入口：

```ts
import { rpeEasingArray, easingMap, linearEasing, fixedEasing } from "kipphi";

const easing = rpeEasingArray[1];                 // RPE 编号 1 = 线性
const e = new NumericEasedEvaluator(easing);
chart.templateEasingLib.getOrNew("myEasing");     // 模板缓动
```

模板缓动需要"实现"：先用 `getOrNew` 创建并拿到它的事件序列，往里填数值节点；导出到不支持模板的目标（如 Phira）时，用 `EventSubstituteOperation` 或 `RPEChartCompiler.substitute` 展开。

---

## 宏

宏是一段 JS 表达式，可以在求值时替换成实际值，用于让一批节点共享同一个公式。

```ts
// 内置可用变量（见 EVENT_MACROS / NOTE_MACROS）
// @line.id  @line.name  @line.group  @node.time  @node.value
// @note.type @note.size @note.speed @note.startTime …

// 参数宏：@proto.value / @proto.time 引用绑定的原形节点
```

三类宏：

- `EventMacroTime` —— 驱动节点时间
- `EventMacroValue` —— 驱动节点值
- `NoteMacro` —— 驱动音符属性

绑定与解绑都有对应的操作（`Op.MacroTimeAssignOperation` 等）；改完宏内容需要"重求值"（`Op.MacroTimeReevaluateOperation`）。

> 宏表达式用 `new Function` 执行，**不要加载不可信的谱面后开启宏求值**。

---

## 操作与撤销重做

### 低级 API：`Operation` + `OperationList`

```ts
import { Op } from "kipphi";

const list = new Op.OperationList(chart);

list.do(new Op.EventNodeValueChangeOperation(node, 2.0));
list.undo();
list.redo();

list.addEventListener("do", e => console.log(e.operation));
list.addEventListener("error", e => console.error(e.error));
```

要点：

- `do(chart)` / `undo(chart)` 必须严格互逆
- `ineffective` 的操作会被 `OperationList` 跳过
- 连续的同类型操作会尝试 `rewrite` 合并（如连续拖动同一节点只留一条记录）
- 构造还有副作用的操作请用 `lazy`：`Op.EventNodePairRemoveOperation.lazy(node)` —— 真正 `do` 时才实例化，避免构造时读到已被前一步改掉的状态
- `UnionOperation` 装一个可能为空的子操作（比如"非 hold 音符才需要改 endTime"）

### 按操作类监听：`onOperation`

`addEventListener("do")` 只能拿到最外层的那一个操作。想知道「某类操作什么时候真的执行了」，用 `onOperation`：

```ts
list.onOperation(Op.JudgeLinePropChangeOperation, (op, direction) => {
    // direction: "do" | "undo"（redo 也算 "do"）
    if (direction === "do" && op.field === "texture") reloadTexture(op.value);
});
list.offOperation(Op.JudgeLinePropChangeOperation, listener);
```

- 会**穿透**容器操作：`ComplexOperation` 的子操作、`UnionOperation` / `LazyOperation` 包装的操作
- 匹配用 `instanceof`，所以监听基类（比如 `Op.Operation`）能收到所有操作
- 被 `rewrite` 合并掉的变更也会按 `do` 通知一次（那次变更确实生效了）
- 通知发生在操作**生效之后**，回调里读到的是新状态；监听器抛错只会 `console.error`，不影响操作本身

穿透靠的是 `Operation.find(predicate)`：返回自己内部（含自己）第一个满足条件的操作，没有返回 `null`。
默认只检查自己，容器操作重写它——先测自己，再逐个问子操作；`onOperation` 就是靠一次这样的
遍历把所有命中的操作收集起来的。

```ts
class Batch extends Op.Operation {
    constructor(private inner: Op.Operation[]) { super(); }
    override find(predicate: (op: Op.Operation) => boolean) {
        return super.find(predicate)
            ?? this.inner.reduce<Op.Operation | null>((found, op) => found ?? op.find(predicate), null);
    }
    do(chart: Chart) { this.inner.forEach(op => op.do(chart)); }
    undo(chart: Chart) { [...this.inner].reverse().forEach(op => op.undo(chart)); }
}
```

这样 `onOperation` 会顺着 `Batch` 找到里面每一层子操作，`new Batch([a, b]).find(op => op === a)` 也会返回 `a`。

### 用 `ComplexOperation` 组合多步改动

一次用户动作常常要改好几处。若逐个 `do`，撤销就要点 N 次；用 `ComplexOperation` 打包后它们是一个原子操作：

- `do` 按子操作顺序**正序**执行，`undo` 按**逆序**回滚（顺序写错会撤销不干净）
- `ineffective` 的子操作会被跳过
- 懒操作（`…Operation.lazy`）同样可以直接当子操作
- 现有的复合操作都是这么实现的：`Op.JudgeLineDeleteOperation`（移除 + 后续线批量改 id）、`Op.MultiNoteDeleteOperation`、`Op.NoteTimeChangeOperation`

```ts
// 一次动作改三处，撤销只需一次
const op = new Op.ComplexOperation(
    new Op.EventNodeValueChangeOperation(alphaNode, 128),
    new Op.EventNodeValueChangeOperation(moveXNode, 100),
    Op.EventNodePairRemoveOperation.lazy(extraNode)
);
list.do(op);     // 正序执行三处
list.undo();     // 逆序还原三处
```

自定义时更推荐继承而不是手动 `new`：

```ts
class MoveLineToGroupOp extends Op.ComplexOperation<
    [Op.JudgeLineRegroupOperation, Op.JudgeLineRenameOperation]
> {
    constructor(line: JudgeLine, group: JudgeLineGroup, name: string) {
        super(new Op.JudgeLineRegroupOperation(line, group),
              new Op.JudgeLineRenameOperation(line, name));
    }
}
```

这样 `subOperations` 有精确类型，`rewrite` 也能直接改到某个子操作上。

### 高级 API：`Op.ez`

面向脚本的包装层，属性赋值即产生操作：

```ts
import { Op } from "kipphi";

const ops = Op.ez.operate(chart, o => {
    const line = o(chart.judgeLines[0]);
    line.name = "新名字";                    // 产生 JudgeLineRenameOperation
    line.texture = "line.png";

    const seq = o(line.eventLayers[0].alpha!);
    seq.getNodeAtBeats(4).value = 128;      // 产生 EventNodeValueChangeOperation
    seq.newPair({ time: 8, start: 255, end: 0, evaluator: 1 });

    for (const note of line.notes()) {       // 遍历音符
        note.size = 1.5;
    }

    o(chart).charter = "Me";
});

`ops` 是本次产生的 `Operation[]`。想让这一批改动作为**一步**被撤销，就用 `ComplexOperation` 打包：

```ts
import { Op } from "kipphi";

const ops = Op.ez.operate(chart, o => {
    const line = o(chart.judgeLines[0]);
    line.name = "新名字";
    o(line.eventLayers[0].alpha!).getNodeAtBeats(4).value = 128;
    for (const note of line.notes()) note.size = 1.5;   // 可能几十个操作
});

// 若干处改动 → 一条撤销记录
const batch = new Op.ComplexOperation(...ops);
list.do(batch);    // 一次完成全部
list.undo();       // 一次还原全部（按逆序）
```

这也是 `Op.ez` 的推荐用法：`operate()` 只负责描述"改什么"，打包交给 `ComplexOperation`，撤销粒度由你自己决定。

`Op.ez.config.useRpeEasingId` 控制 `evaluator` 传数字时按 RPE 编号还是 KPA 编号解读（默认 `true`）。

---

## 视频通道

2.2.0 起，谱面自带一条视频通道，三条序列彼此独立：

```ts
chart.video = {
    name : VideoEventNodeSequence,     // 视频切换（阶梯型，值在段内恒定）
    alpha: EventNodeSequence<number>,  // 0~1，全谱拉通
    dim  : EventNodeSequence<number>,  // 0~1，全谱拉通
};
```

```
name  |──── A.mp4 ──────────|──── B.mp4 ─────────────────>
alpha |─ 1 ────────┐────── 0.5 ───────────────────────────>
dim   |─ 0 ───────────────────────┐─── 0.3 ───────────────>
```

- `name` 的 `value` 是视频路径，**空串**表示该段无视频
- 序列强制 `t = [0,0,1]` 有节点，缺则自动补空路径节点
- `scale` 用 `VideoScale`（`cropCenter` / `inside` / `fit`），与 Phira 一一对应，可用 `toPhiraScale` / `fromPhiraScale` 转换
- 三条序列不进 `chart.sequenceMap`，`checkErrors()` 与 `updateEffectiveBeats()` 都会单独处理

---

## 特效


2.3.0 起支持 Phira 的 effect 系统。特效**不属于任何判定线**，`chart.effects` 是一个 `EffectNodeSequence[]`：

```ts
chart.effects: EffectNodeSequence[];

for (const sequence of chart.effects) {
    for (const effect of sequence.effects()) {
        effect.value;        // 着色器名，空串表示该段没有特效
        effect.global;       // 是否影响 UI（连击、暂停按钮等）
        effect.vars;         // Map<string, EventNodeSequence<PhiraAnimVarESType>>
        effect.getEndTime(); // 结束时间；null 表示无限延伸
    }
}
```

某一时刻正在生效的特效：

```ts
const active = chart.getActiveEffects(beats);
for (const effect of active) {
    effect.value;                            // 着色器名
    const uniforms = effect.evalVars(beats); // { 变量名: 数值 或 长度 2/4 的元组 }
}
```

几处约定：

- 序列是**稠密**的：没有特效的时段由着色器名为 `EMPTY_EFFECT_SHADER`（空串）的填充节点占据，用 `isEmpty()` 判断
- 区间是 `[time, next.time)`，尾节点之前的节点无限延伸（此时 `getEndTime()` 为 `null`）
- `global` 缺省为 `PHIRA_EFFECT_DEFAULT_GLOBAL`（`false`），即只影响谱面、不影响 UI
- 每个 uniform 的时间区间都被裁剪进特效自身的区间，直接 `getValueAt(beats)` 即可
- 特效序列的 id 形如 `#${line}.fx`（`EFFECT_SEQUENCE_ID_PREFIX`），只是为了对齐 RPE 侧「序列归属某条线」的编号习惯，**与判定线无关**

### 作用范围（PhiZone 的 `targetRange`）

[PhiZone Player](https://github.com/PhiZone/Player) 给 Phira 补了一个可选字段，让一个特效只作用于 Z 轴上一段相邻的对象：

```json
{
  "start": [293, 0, 1],
  "end": [300, 0, 1],
  "shader": "/example.glsl",
  "targetRange": { "minZIndex": 3, "maxZIndex": 4 },
  "vars": {}
}
```

- `minZIndex` 含、`maxZIndex` 不含
- `exclusive`（可选）：与另一个特效的范围**相交但互不包含**时，是否把交集「吞掉」归自己
- `global` 为 `true` 时该字段无效
- Z 序号是**各播放器自己的图层划分**，不能跨实现通用；kipphi 播放器里 `0` 是底图、`3`~`8` 是音符层、`9` 是谱面 UI、`10` 是只放帧率/时间的覆盖层

kipphi 只负责**解析并保存**：`EffectStartNode.targetRange` 是 `PhiraTargetRange | null`，怎么解释交给播放器（多个范围交叠时谁先谁后也由播放器决定）。

唯一会主动检查的是「谁都决定不了」的情况：两个非 global 特效**时间重叠**、范围**相交但不互相包含**、且**都没写 `exclusive`** 时，交集归谁没有依据。`chart.checkShaderConflicts()` 会在加载（`initEffects*`）时 warn 一条 `SHADER_CONFLICT`，`chart.checkErrors()` 里也包含这一项。

自定义着色器（Phira 约定：名字以 `/` 开头，指向谱面包内的文件）用 `chart.scanAllShaders()` 收集，返回 `Set<string>`（保留开头的 `/`，内置着色器不在其中），播放器可在加载阶段据此向谱面包索取文件。

编辑走 `Operation`，和别的事件一样支持撤销重做：`EffectAddOperation` / `EffectRemoveOperation` / `EffectPropChangeOperation` / `EffectTimeChangeOperation` / `EffectMoveOperation` / `EffectVarChangeOperation` / `EffectVarRemoveOperation`。

Phira `extra.json` 里的 `effects` 由 `ExtraJsonCompiler` 负责导入导出，`Chart.fromRPEJSON(data, duration, extraJson)` 也会一并读取。

---

## 格式互转

| 目标 | 入口 | 说明 |
|---|---|---|
| RPE → Kipphi | `Chart.fromRPEJSON(data, duration, extraJson?)` | 第三参数可同时导入 Phira 的视频通道 |
| KPA/KPA2 → Kipphi | `Chart.fromKPAJSON(data)` | 自动识别版本 |
| Kipphi → KPA2 | `chart.dumpKPA()` | KPA 原生格式 |
| Kipphi → RPE | `new RPEChartCompiler(chart).compileChart()` | 模板缓动会被展开成折线 |
| Kipphi → Phira extra.json | `new ExtraJsonCompiler(chart).compile()` | 输出 BPM 列表 + 视频（含 alpha/dim 动画变量） |

注意事项：

- 导出 Phira 时，**贝塞尔缓动与表达式缓动无法用缓动编号表达**，会按 `interpolationStep`（默认 1/16 拍）插值成一串 `easingType: 1` 的线性段
- Phira 的 `alpha` / `dim` 是**动画变量**（常量或事件数组），不是标量；视频区间与动画区间不重合时会自动截断并保留缓动窗口
- `chartType2.schema.json` 是 KPA2 的 JSON Schema，`VERSION`（当前 220）标记格式版本

---

## 错误处理

所有错误都是 `KPAError`，带一个 `ERROR_IDS` 编号（十六进制，形如 `KP621`）：

```ts
import { KPAError, Environment } from "kipphi";

chart.checkErrors();                 // 把问题收集进缓冲区
for (const e of KPAError.buffer) {
    console.error(e.id, e.message);  // 例如 EVENT_NODE_NOT_DENSE
}
KPAError.flush();                    // 清空，下一轮自检前调用

Environment.ERROR_IDS               // 全部错误编号
Environment.NNLIST_Y_OFFSET_HALF_SPAN   // 等可调参数
```

错误分两类：

- `warn()` —— 数据有问题但已自动修正（会进 buffer，`fixed` 为 true）
- 直接 `throw` —— 数据无法继续处理（如序列 id 找不到、hold 没有时长）

---

## 运行时配置

```ts
import { Environment } from "kipphi";

Environment.DEFAULT_TEMPLATE_LENGTH      // 模板缓动默认长度
Environment.BEZIER_INTERPOLATION_DENSITY // 贝塞尔采样密度
Environment.NNLIST_Y_OFFSET_HALF_SPAN    // 音符分桶的 yOffset 半宽
Environment.JUMPARRAY_MIN_LENGTH / MAX_LENGTH / MINOR_SCALE_COUNT
Environment.freeze()                     // 冻结配置
```

---

## 导出速查

```ts
// 时间与工具
TC, TimeT, numberToRatio, hex2rgb, rgb2hex, NodeType, checkType

// 数据模型
Chart, JudgeLine, JudgeLineGroup, UIName, ChartPropName
EventNodeSequence, EventNode, EventStartNode, EventEndNode, SpeedENS
Note, NoteNode, NNList, HNList, NNNList, NoteType
BPMSequence, TimeCalculator, BPMSegmentData
VideoEventNodeSequence, VideoEventStartNode, VideoEventEndNode, VideoScale

// 缓动 / 求值器
Easing, NormalEasing, BezierEasing, SegmentedEasing, TemplateEasing, WrapperEasing
rpeEasingArray, easingArray, easingMap, linearEasing, fixedEasing, TemplateEasingLib
Evaluator, EasedEvaluator, NumericEasedEvaluator, TextEasedEvaluator,
ColorEasedEvaluator, ExpressionEvaluator, MacroEvaluator, ConstEvaluator, CONST_EVALUATOR

// 宏
MacroLib, EventMacro, EventMacroTime, EventMacroValue, NoteMacro,
EVENT_MACROS, NOTE_MACROS

// 操作
Op            // Operation, OperationList, 各领域操作类
Op.ez         // operate(), useToOperable(), config

// 互转
RPEChartCompiler, ExtraJsonCompiler

// 其它
Environment, err, KPAError, VERSION, SCHEMA
```

---

## 开发与构建

```bash
bun install
bun test           # 运行测试
bun run docs       # 生成 API 文档到 docs/（typedoc，配置见 typedoc.json）
bunx eslint src    # 静态检查
```

- 源码在 `src/`，入口 `src/index.ts`
- **没有构建步骤**：npm 包直接发布 `src/` 源码（`package.json` 的 `main` / `exports` 都指向 `src/index.ts`，`files` 只带 `src`），下游用 bun / vite 等自带 TS 打包的运行时直接消费
- 因此仓库里不需要 `dist/`、`build/`，两者都在 `.gitignore` 里
- 类型检查配置在 `src/tsconfig.json`（已开启 `strict` 与 `strictNullChecks`）
- 生成的 API 文档在 `docs/`，**不入库**：push 到主分支后由 `.github/workflows/docs.yml` 构建并部署到 GitHub Pages
- JSON Schema：`src/chartType.schema.json`（KPA1）、`src/chartType2.schema.json`（KPA2）

### 目录结构

```
src/
├── index.ts            统一导出
├── chart.ts            谱面
├── judgeline.ts        判定线
├── event.ts            事件节点与序列
├── note.ts             音符与音符树
├── bpm.ts              BPM 与拍秒换算
├── video.ts            视频序列（2.2.0）
├── effect.ts           Phira 特效序列与着色器参数（2.3.0）
├── easing.ts           缓动
├── evaluator.ts        求值器
├── macro.ts            宏
├── jumparray.ts        跳数组（随机访问加速）
├── time.ts             时间工具 TC
├── util.ts             杂项
├── chartTypes.ts       所有数据类型 + EventType 等枚举
├── extraTypes.ts       Phira extra.json 类型
├── extra.ts            → Phira extra.json
├── rpeChartCompiler.ts → RPE
├── env.ts              错误定义与运行时配置
├── version.ts          版本号与 schema 地址
└── operation/          操作体系
    ├── basic.ts        基类与 OperationList
    ├── event.ts        事件节点操作
    ├── note.ts         音符操作
    ├── line.ts         判定线操作
    ├── chart.ts        谱面属性操作
    ├── macro.ts        宏操作
    ├── effect.ts       特效操作
    └── easy.ts         Op.ez 高层封装
```

---

## 许可与相关

- 父项目：[KPA（奇谱发生器）](https://github.com/TeamZincs/KPA)
- 格式参考：[Phigros 自制谱 Wiki](https://pgrfm.miraheze.org/wiki)
- RPE：Re:PhiEdit；KPA：KipphiApparatus
