import {
    EasedEvaluator,
    type Evaluator,
    NumericEasedEvaluator,
    VectorEasedEvaluator,
} from "./evaluator";

import {
    EventEndNode,
    EventNode,
    EventNodeLike,
    EventNodeSequence,
    EventStartNode,
    type AnyEN,
    type ENOrHead,
    type ENOrTail,
} from "./event";

import {
    EventType,
    EasingType,
    EventValueType,
    EvaluatorType,
    type EffectEventDataKPA2,
    type EffectNodeSequenceDataKPA2,
    type EventNodeSequenceDataKPA2,
    type EvaluatorDataKPA2,
    type PhiraAnimVarESType,
    type TimeT,
} from "./chartTypes";

import {
    type PhiraAnimVar,
    type PhiraAnimVarEvent,
    type PhiraEffect,
    type PhiraEffectVars,
} from "./extraTypes";

import { CONST_EVALUATOR } from "./evaluator";
import { Easing, linearEasing, rpeEasingArray, SegmentedEasing } from "./easing";
import { err } from "./env";
import TC from "./time";
import { NodeType } from "./util";
import type { Chart } from "./chart";

/// #declaration:global

/** 特效序列ID的前缀，遵循`#${line}.fx`格式以便RPE侧识别 @since 2.3.0 */
export const EFFECT_SEQUENCE_ID_PREFIX = "#";

/**
 * {@linkcode PhiraEffect.global} 的缺省值
 *
 * 省略 `global` 字段时，特效不影响UI元素。
 * @since 2.3.0
 */
export const PHIRA_EFFECT_DEFAULT_GLOBAL = false;

/**
 * 空着色器名
 *
 * 特效序列是稠密的：段与段之间的空隙由着色器名为空串的填充节点占据，
 * 空串即"该时段没有特效"。
 *
 * @since 2.3.0
 */
export const EMPTY_EFFECT_SHADER = "";

/**
 * 动画变量关键帧的缺省缓动编号（RPE编号，1为线性）
 * @since 2.3.0
 */
const DEFAULT_EASING_TYPE = 1;

/** 常量型动画变量：数值或长度2/4的数值元组 */
const isAnimVarConstant = (value: unknown): value is PhiraAnimVarESType => {
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    return Array.isArray(value)
        && (value.length === 2 || value.length === 4)
        && value.every(item => typeof item === "number" && Number.isFinite(item));
};

/**
 * 区分常量型与动画型动画变量
 *
 * 常量元组（如`[1, 2]`）与关键帧数组都是数组，靠首元素是否为对象区分。
 */
const isAnimVarEvents = (
    animVar: PhiraAnimVar<PhiraAnimVarESType>
): animVar is PhiraAnimVarEvent<PhiraAnimVarESType>[] =>
    Array.isArray(animVar) && animVar.length > 0
    && typeof animVar[0] === "object" && animVar[0] !== null && !Array.isArray(animVar[0]);

/** 深拷贝一个动画变量的值（元组要拷贝，标量原样返回） */
const cloneAnimVarValue = (value: PhiraAnimVarESType): PhiraAnimVarESType =>
    Array.isArray(value) ? [...value] as PhiraAnimVarESType : value;

/**
 * 特效事件起始节点
 *
 * 值即着色器名，在段内恒定（因此求值器被强制为{@linkcode CONST_EVALUATOR}，
 * 与{@linkcode VideoEventStartNode}一致）。`global`与`vars`是段的附加属性。
 *
 * 序列是稠密的：节点的分管区间是`[time, next.time)`，尾节点之前的节点
 * 无限延伸。区间内没有特效时由着色器名为{@linkcode EMPTY_EFFECT_SHADER}
 * 的填充节点占据。
 *
 * @since 2.3.0
 */
export class EffectStartNode extends EventStartNode<string> {
    /** 是否影响UI元素（连击、暂停按钮等） */
    global: boolean = false;
    /**
     * uniform变量表：变量名 -> 事件序列
     *
     * 每个序列的时间区间都被裁剪进本特效的`[start, end]`，
     * 求值时用`getValueAt(beats)`即可。
     */
    vars: Map<string, EventNodeSequence<PhiraAnimVarESType>> = new Map();
    override next!: EffectEndNode | EventNodeLike<NodeType.TAIL, string>;
    override previous!: EffectEndNode | EventNodeLike<NodeType.HEAD, string>;
    /**
     * @param time 特效起始时间
     * @param shader 着色器名，空串表示没有特效
     * @param global 是否影响UI元素
     */
    constructor(time: TimeT, shader: string, global: boolean = false) {
        super(time, shader);
        this.global = global;
        // 段内着色器名恒定，缓动没有任何意义
        // @ts-expect-error 去哪那么多规矩啊
        this.evaluator = CONST_EVALUATOR;
    }
    /** 是否为代表"没有特效"的填充节点 */
    isEmpty(): boolean {
        return this.value === EMPTY_EFFECT_SHADER;
    }
    /**
     * 该特效所属序列在`chart.effects`中的下标
     *
     * **与判定线无关**，仅为兼容RPE侧"事件序列归属某条线"的编号习惯而存在。
     */
    get line(): number {
        return this.parentSeq instanceof EffectNodeSequence ? this.parentSeq.line : 0;
    }
    /** 特效结束时间。尾节点之前的节点无限延伸，此时返回`null` */
    getEndTime(): TimeT | null {
        return this.next.type === NodeType.TAIL ? null : this.next.time;
    }
    /** 该特效在指定拍数处是否激活 */
    isActiveAt(beats: number): boolean {
        if (this.isEmpty() || beats < TC.toBeats(this.time)) {
            return false;
        }
        return this.next.type === NodeType.TAIL || beats < TC.toBeats(this.next.time);
    }
    /**
     * 求指定uniform在指定拍数处的值
     * @returns 变量不存在时返回`undefined`
     */
    evalVar(name: string, beats: number): PhiraAnimVarESType | undefined {
        return this.vars.get(name)?.getValueAt(beats);
    }
    /** 求所有uniform在指定拍数处的值 */
    evalVars(beats: number): Record<string, PhiraAnimVarESType> {
        const ret: Record<string, PhiraAnimVarESType> = {};
        for (const [name, seq] of this.vars) {
            ret[name] = seq.getValueAt(beats);
        }
        return ret;
    }
    /**
     * 由Phira特效数据创建特效起始节点
     *
     * `vars`中的每个动画变量都会被转换成区间与特效一致的事件序列。
     *
     * @param effect Phira特效数据
     * @param pos 用于报错的位置标识
     * @throws {KPAError<ERROR_IDS.INVALID_EFFECT>} 数据结构不合法时
     */
    static fromPhiraEffect(effect: PhiraEffect, pos: string = "effect"): EffectStartNode {
        if (!effect || typeof effect !== "object") {
            throw err.INVALID_EFFECT(pos, effect);
        }
        if (!Array.isArray(effect.start) || !Array.isArray(effect.end)) {
            throw err.INVALID_EFFECT_TIME(pos, effect.start);
        }
        if (typeof effect.shader !== "string" || effect.shader === "") {
            throw err.INVALID_EFFECT_SHADER(pos, effect.shader);
        }
        if (!TC.gt(effect.end, effect.start)) {
            throw err.EFFECT_END_NOT_AFTER_START(pos, effect.start, effect.end);
        }
        const node = new EffectStartNode(effect.start, effect.shader, effect.global ?? PHIRA_EFFECT_DEFAULT_GLOBAL);
        const vars = effect.vars ?? {};
        for (const name of Object.keys(vars)) {
            const animVar = PhiraEffectParser.parseAnimVar(vars[name], `${pos}.vars.${name}`, effect.start, effect.end);
            if (animVar === undefined) {
                throw err.INVALID_EFFECT_ANIM_VAR(`${pos}.vars.${name}`, vars[name]);
            }
            const seq = PhiraEffectParser.animVarToSequence(animVar, effect.start, effect.end, `${pos}.vars.${name}`);
            if (seq) {
                node.vars.set(name, seq);
            }
        }
        return node;
    }

    /** 导出为Phira特效数据 */
    toPhiraEffect(): PhiraEffect {
        const end = this.next as EffectEndNode;
        const vars: PhiraEffectVars = {};
        for (const [name, seq] of this.vars) {
            vars[name] = PhiraEffectParser.sequenceToAnimVar(seq);
        }
        return {
            start: [...this.time] as TimeT,
            end: [...end.time] as TimeT,
            shader: this.value,
            global: this.global,
            vars
        };
    }

    override clone(offset?: TimeT): EffectStartNode {
        const ret = super.clone(offset) as EffectStartNode;
        ret.global = this.global;
        ret.vars = new Map();
        for (const [name, seq] of this.vars) {
            ret.vars.set(name, EffectStartNode.cloneVarSequence(seq, offset));
        }
        return ret;
    }

    /** 深拷贝一个uniform变量序列，offset为整体时间偏移 */
    private static cloneVarSequence(
        seq: EventNodeSequence<PhiraAnimVarESType>,
        offset?: TimeT
    ): EventNodeSequence<PhiraAnimVarESType> {
        const ret = new EventNodeSequence<PhiraAnimVarESType>(EventType.effect, seq.effectiveBeats);
        ret.id = seq.id;
        // 链表游标：head -> (Start -> End)* -> tail
        let last: any = ret.head;
        let listLength = 0;
        let node = seq.head.next as EventStartNode<PhiraAnimVarESType> | null;
        while (node) {
            const start = new EventStartNode<PhiraAnimVarESType>(
                offset ? TC.add(node.time, offset) : node.time,
                cloneAnimVarValue(node.value)
            );
            start.evaluator = node.evaluator;
            EventNode.connect(last, start);
            last = start;
            listLength++;
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                break;
            }
            const endNode = new EventEndNode<PhiraAnimVarESType>(
                offset ? TC.add(end.time, offset) : end.time,
                cloneAnimVarValue(end.value)
            );
            EventNode.connect(start, endNode);
            last = endNode;
            listLength++;
            node = end.next as EventStartNode<PhiraAnimVarESType>;
        }
        EventNode.connect(last, ret.tail);
        ret.listLength = listLength;
        ret.initJump();
        return ret;
    }
}

/**
 * 特效事件结束节点
 *
 * 与{@linkcode EffectStartNode}背靠背，附加属性代理到前一个起始节点
 * （与{@linkcode VideoEventEndNode}的做法一致）。
 *
 * @since 2.3.0
 */
export class EffectEndNode extends EventEndNode<string> {
    override previous!: EffectStartNode;
    override next!: EventStartNode<string>;

    constructor(time: TimeT) {
        super(time, EMPTY_EFFECT_SHADER);
    }
}

/**
 * 特效事件节点序列
 *
 * 即Phira extra.json的`effects`在谱面模型中的形态。序列内的特效段
 * **互不重叠**，且都带有相同的{@linkcode EffectStartNode.line}——
 * 它等于本序列在`chart.effects`中的下标，与判定线无关。
 *
 * ```
 * HEAD -> ES0(t=0, 空) -> EE0(t1) -> ES1(t1) -> EE1(t2) -> ... -> ESn -> TAIL
 * ```
 *
 * 序列始终至少有一个节点（位于`[0, 0, 1]`的填充节点），
 * 与{@linkcode VideoEventNodeSequence}一致。
 *
 * @since 2.3.0
 */
// @ts-expect-error 静态工厂签名与基类不同（基类是泛型的事件序列工厂），与VideoEventNodeSequence同一处理
export class EffectNodeSequence extends EventNodeSequence<string> {
    /** 本序列在`chart.effects`中的下标，与判定线无关，仅为兼容RPE侧 */
    line: number;
    constructor(effectiveBeats: number, line: number = 0) {
        super(EventType.effect, effectiveBeats);
        this.line = line;
    }
    /**
     * 创建一个仅含一个填充节点的空特效序列
     *
     * @param effectiveBeats 谱面有效拍数
     * @param line 序列在`chart.effects`中的下标
     */
    static newEffectSeq(effectiveBeats: number, line: number = 0): EffectNodeSequence {
        const sequence = new EffectNodeSequence(effectiveBeats, line);
        sequence.id = `${EFFECT_SEQUENCE_ID_PREFIX}${line}.fx`;
        const node = new EffectStartNode([0, 0, 1], EMPTY_EFFECT_SHADER);
        EventNode.connect(sequence.head, node);
        EventNode.connect(node, sequence.tail);
        sequence.listLength = 1;
        sequence.initJump();
        return sequence;
    }
    /** 遍历序列中的特效段（跳过填充节点） */
    *effects(): Generator<EffectStartNode> {
        let node = this.head.next as EffectStartNode;
        while (true) {
            if (!node.isEmpty()) {
                yield node;
            }
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                return;
            }
            node = (end as EffectEndNode).next as EffectStartNode;
        }
    }
    /** 遍历指定拍数处激活的特效段 */
    *activeAt(beats: number): Generator<EffectStartNode> {
        for (const node of this.effects()) {
            if (node.isActiveAt(beats)) {
                yield node;
            }
        }
    }
    /** 序列中的特效个数 */
    get effectCount(): number {
        let count = 0;
        for (const _ of this.effects()) { count++; }
        return count;
    }
    /**
     * 把一个特效段插入序列
     *
     * 会切开覆盖插入点的填充节点来容纳新区间，保证序列稠密、
     * 特效段互不重叠。插入点已被真实特效占用时抛错。
     *
     * @param node 起始节点，其`next`会被设置
     * @param endTime 特效结束时间
     * @throws {KPAError<ERROR_IDS.EFFECT_TIME_OVERLAP>}
     */
    insertEffect(node: EffectStartNode, endTime: TimeT): void {
        const startBeats = TC.toBeats(node.time);
        const endBeats = TC.toBeats(endTime);
        if (!(endBeats > startBeats)) {
            throw err.EFFECT_END_NOT_AFTER_START(this.id, node.time, endTime);
        }
        const atStart = this.getNodeAt(startBeats) as EffectStartNode;
        if (!atStart.isEmpty()) {
            throw err.EFFECT_TIME_OVERLAP(this.id, node.time);
        }
        const oldEnd = atStart.next;
        const rangeEnd = oldEnd.type === NodeType.TAIL
            ? Infinity
            : TC.toBeats((oldEnd as EffectEndNode).time);
        if (endBeats > rangeEnd) {
            throw err.EFFECT_TIME_OVERLAP(this.id, node.time);
        }

        // 先把node接入链表，parentSeq才能被正确设置
        // （结束节点的parentSeq是派生属性，过早连接会拿到undefined）
        if (TC.eq(atStart.time, node.time)) {
            // 插入点正好是填充节点的起点：用特效段顶替该填充节点
            EventNode.connect(atStart.previous as any, node as any);
        } else {
            // 插入点在填充节点内部：先把填充节点截到插入点
            const atEnd = new EffectEndNode(node.time);
            EventNode.connect(atStart, atEnd);
            EventNode.connect(atEnd, node);
        }

        const newEnd = new EffectEndNode(endTime);
        EventNode.connect(node, newEnd);

        if (endBeats === rangeEnd) {
            // 正好占到原区间末尾。
            // rangeEnd为Infinity时不可能与有限的endBeats相等，故oldEnd必定不是TAIL
            EventNode.connect(newEnd as any, (oldEnd as EffectEndNode).next as any);
        } else {
            // 原区间更大，后面补一个填充段
            const fillerStart = new EffectStartNode(endTime, EMPTY_EFFECT_SHADER);
            EventNode.connect(newEnd, fillerStart);
            if (oldEnd.type === NodeType.TAIL) {
                EventNode.connect(fillerStart, this.tail);
            } else {
                EventNode.connect(fillerStart, oldEnd as EventEndNode<string>);
            }
        }
        this.initJump();
    }
    /**
     * 原地修改一个特效段的起止时刻
     *
     * 直接改链表上相关节点的时刻并按需插入/收缩填充节点，
     * **节点对象保持不变**，因此外部引用不会失效。
     * 向前移动起点、向后移动终点时，若邻位是真实特效（无法收缩）
     * 会抛错。
     *
     * @param node 特效起始节点
     * @param startTime 新的起始时间
     * @param endTime 新的结束时间
     * @throws {KPAError<ERROR_IDS.EFFECT_TIME_OVERLAP>}
     * @throws {KPAError<ERROR_IDS.EFFECT_END_NOT_AFTER_START>}
     */
    setEffectTime(node: EffectStartNode, startTime: TimeT, endTime: TimeT): void {
        if (node.isEmpty()) {
            throw err.EFFECT_NOT_FOUND(this.id);
        }
        if (!TC.gt(endTime, startTime)) {
            throw err.EFFECT_END_NOT_AFTER_START(this.id, startTime, endTime);
        }
        const startBeats = TC.toBeats(startTime);
        const endBeats = TC.toBeats(endTime);

        // ---- 终点 ----
        const oldEnd = node.next;
        const oldEndBeats = oldEnd.type === NodeType.TAIL
            ? Infinity
            : TC.toBeats((oldEnd as EffectEndNode).time);
        if (endBeats < oldEndBeats) {
            // 提前：在[新终点, 原终点)补一个填充段
            if (oldEnd.type === NodeType.TAIL) {
                // 原来是最后一个节点（无限延伸），补上结束节点与填充节点
                const newEnd = new EffectEndNode(endTime);
                EventNode.connect(node, newEnd);
                const fillerStart = new EffectStartNode(endTime, EMPTY_EFFECT_SHADER);
                EventNode.connect(newEnd, fillerStart);
                EventNode.connect(fillerStart, this.tail);
            } else {
                const oldEndNode = oldEnd as EffectEndNode;
                const nextStart = oldEndNode.next;
                const fillerStart = new EffectStartNode(endTime, EMPTY_EFFECT_SHADER);
                const fillerEnd = new EffectEndNode(oldEndNode.time);
                oldEndNode.time = endTime;
                EventNode.connect(oldEndNode, fillerStart);
                EventNode.connect(fillerStart, fillerEnd);
                EventNode.connect(fillerEnd as any, nextStart as any);
            }
        } else if (endBeats > oldEndBeats) {
            // 延后：要求后一个节点是填充节点（可以收缩），否则与之重叠
            if (oldEnd.type === NodeType.TAIL) {
                // 已经无限延伸，无需改动
            } else {
                const oldEndNode = oldEnd as EffectEndNode;
                const nextStart = oldEndNode.next as EffectStartNode;
                if (!nextStart.isEmpty()) {
                    throw err.EFFECT_TIME_OVERLAP(this.id, endTime);
                }
                const nextEnd = nextStart.next as EffectEndNode;
                oldEndNode.time = endTime;
                nextStart.time = endTime;
                if (nextStart.next.type !== NodeType.TAIL
                    && TC.eq(endTime, nextEnd.time)) {
                    // 填充节点被压缩成零长，直接摘掉
                    EventNode.connect(oldEndNode as any, nextEnd.next as any);
                }
            }
        }

        // ---- 起点 ----
        const oldStartBeats = TC.toBeats(node.time);
        if (startBeats > oldStartBeats) {
            // 后移：在[原起点, 新起点)补一个填充段
            const fillerStart = new EffectStartNode(node.time, EMPTY_EFFECT_SHADER);
            const fillerEnd = new EffectEndNode(startTime);
            EventNode.connect(node.previous as any, fillerStart as any);
            EventNode.connect(fillerStart, fillerEnd);
            EventNode.connect(fillerEnd as any, node as any);
            node.time = startTime;
        } else if (startBeats < oldStartBeats) {
            // 前移：要求前一个节点是填充节点（可以收缩），否则与之重叠
            const previous = node.previous;
            if (previous.type === NodeType.HEAD) {
                if (startBeats < 0) {
                    throw err.INVALID_EFFECT_TIME(this.id, startTime);
                }
                // 首节点必须位于[0, 0, 1]
                startTime = [0, 0, 1];
            } else {
                const prevStart = (previous as EffectEndNode).previous as EffectStartNode;
                if (!prevStart.isEmpty()) {
                    throw err.EFFECT_TIME_OVERLAP(this.id, startTime);
                }
                (previous as EffectEndNode).time = startTime;
            }
            node.time = startTime;
        }

        this.initJump();
    }

    /**
     * 从序列中移除一个特效段
     *
     * 采用"就地置空"：节点退化成填充节点，链表结构不变，
     * 因此无需更新跳数组。节点不在序列中时抛错。
     *
     * @throws {KPAError<ERROR_IDS.EFFECT_NOT_FOUND>}
     */
    removeEffect(node: EffectStartNode): void {
        if ((node.parentSeq as unknown) !== this) {
            throw err.EFFECT_NOT_FOUND(this.id);
        }
        node.value = EMPTY_EFFECT_SHADER;
        node.global = false;
        node.vars = new Map();
        // @ts-expect-error 常量求值器
        node.evaluator = CONST_EVALUATOR;
        if (node.next.type !== NodeType.TAIL) {
            (node.next as EffectEndNode).value = EMPTY_EFFECT_SHADER;
        }
    }
    /**
     * 从KPA2数据创建特效序列
     * @param data 序列数据
     * @param effectiveBeats 谱面有效拍数
     * @param pos 用于报错的位置标识
     */
    static fromKPA2JSON(
        data: EffectNodeSequenceDataKPA2 | null | undefined,
        effectiveBeats: number,
        pos: string = "effects"
    ): EffectNodeSequence {
        const sequence = new EffectNodeSequence(effectiveBeats, data?.line ?? 0);
        sequence.id = data?.id ?? `${EFFECT_SEQUENCE_ID_PREFIX}${sequence.line}.fx`;
        const node = new EffectStartNode([0, 0, 1], EMPTY_EFFECT_SHADER);
        EventNode.connect(sequence.head, node);
        EventNode.connect(node, sequence.tail);
        sequence.listLength = 1;
        sequence.initJump();
        const events = (data?.events ?? []).slice().sort((a, b) => TC.cmp(a.startTime, b.startTime));
        for (let i = 0; i < events.length; i++) {
            const event = events[i]!;
            const effect = EffectStartNode.fromPhiraEffect(
                PhiraEffectParser.effectFromKPA2(event, `${pos}[${i}]`)
            );
            sequence.insertEffect(effect, event.endTime);
        }
        return sequence;
    }
    /**
     * 导出为KPA2数据
     *
     * 与基类的{@linkcode EventNodeSequence.dump}不同：特效序列没有
     * 求值器与final节点，且只导出真实特效段（跳过填充节点）。
     */
    dumpEffect(): EffectNodeSequenceDataKPA2 {
        const events: EffectEventDataKPA2[] = [];
        for (const node of this.effects()) {
            const end = node.next as EffectEndNode;
            const vars: { [name: string]: EventNodeSequenceDataKPA2<PhiraAnimVarESType> } = {};
            for (const [name, seq] of node.vars) {
                vars[name] = seq.dump();
            }
            events.push({
                startTime: [...node.time] as TimeT,
                endTime: [...end.time] as TimeT,
                shader: node.value,
                global: node.global,
                vars
            });
        }
        return {
            events,
            id: this.id,
            line: this.line
        };
    }

    /**
     * 把Phira的`effects`数组打包成特效序列数组
     *
     * 采用贪心首次适配的区间分组：每个特效被放入第一个
     * "末尾时间不晚于其起始时间"的序列，放不下则新开一条序列（新line）。
     * 这样同一序列内的特效必然互不重叠，序列数等于最大重叠深度。
     *
     * @param effects 特效列表，会按起始时间排序（不改入参数）
     * @param effectiveBeats 谱面有效拍数
     * @returns 特效序列数组，下标即各序列的`line`
     */
    static fromPhiraEffects(effects: PhiraEffect[], effectiveBeats: number): EffectNodeSequence[] {
        const sorted = effects.slice().sort((a, b) => TC.cmp(a.start, b.start));
        const sequences: EffectNodeSequence[] = [];
        for (const effect of sorted) {
            const node = EffectStartNode.fromPhiraEffect(effect);
            let target: EffectNodeSequence | undefined;
            for (const seq of sequences) {
                const last = EffectNodeSequence.lastEffectEndBeats(seq);
                if (last !== null && last <= TC.toBeats(node.time)) {
                    target = seq;
                    break;
                }
            }
            if (!target) {
                target = EffectNodeSequence.newEffectSeq(effectiveBeats, sequences.length);
                sequences.push(target);
            }
            target.insertEffect(node, effect.end);
        }
        return sequences;
    }

    /**
     * 把特效序列数组导出为Phira的`effects`数组
     *
     * 结果按起始时间升序，与Phira的extra.json一致。
     */
    static toPhiraEffects(sequences: EffectNodeSequence[]): PhiraEffect[] {
        const effects: PhiraEffect[] = [];
        for (const seq of sequences) {
            for (const node of seq.effects()) {
                effects.push(node.toPhiraEffect());
            }
        }
        effects.sort((a, b) => TC.cmp(a.start, b.start));
        return effects;
    }

    /** 序列中最后一个特效的结束拍数，没有特效时返回`null` */
    private static lastEffectEndBeats(seq: EffectNodeSequence): number | null {
        let last: number | null = null;
        for (const node of seq.effects()) {
            const end = node.next as EffectEndNode;
            last = TC.toBeats(end.time);
        }
        return last;
    }
}

/**
 * Phira特效解析器
 *
 * 负责把extra.json里的原始`effects`数据解析、校验、规范化成
 * {@linkcode PhiraEffect}。解析遵循宽容策略：
 * 无效条目跳过并`warn`，可自动修复的问题（如关键帧越出特效区间）
 * 会裁剪并`fix`，最终结果保证：
 *
 * - `start` / `end` 为合法时间元组，且 `end` 晚于 `start`；
 * - `vars` 中每个动画变量的关键帧时间递增、不重叠，且都落在特效区间内；
 * - 缺省的 `global` 补为 {@linkcode PHIRA_EFFECT_DEFAULT_GLOBAL}，
 *   缺省的 `easingLeft` / `easingRight` 补为 `0` / `1`。
 *
 * @since 2.3.0
 */
export class PhiraEffectParser {
    /**
     * 解析extra.json的`effects`数组
     *
     * @param raw 原始数据，缺省（`null`/`undefined`）时返回空列表
     * @param pos 用于报错的位置标识
     * @returns 按`start`升序排列的特效列表
     */
    static parse(raw: unknown, pos: string = "effects"): PhiraEffect[] {
        if (raw === undefined || raw === null) {
            return [];
        }
        if (!Array.isArray(raw)) {
            err.INVALID_EFFECT_LIST(pos, raw).warn();
            return [];
        }
        const effects: PhiraEffect[] = [];
        for (let i = 0; i < raw.length; i++) {
            const effect = this.parseEffect(raw[i], `${pos}[${i}]`);
            if (effect) {
                effects.push(effect);
            }
        }
        effects.sort((a, b) => TC.cmp(a.start, b.start));
        return effects;
    }

    /**
     * 解析单个特效
     * @returns 无效时返回`null`（已warn）
     */
    static parseEffect(raw: unknown, pos: string): PhiraEffect | null {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            err.INVALID_EFFECT(pos, raw).warn();
            return null;
        }
        const obj = raw as Record<string, unknown>;
        const start = this.parseTime(obj.start, `${pos}.start`);
        const end = this.parseTime(obj.end, `${pos}.end`);
        if (!start || !end) {
            return null;
        }
        if (typeof obj.shader !== "string" || obj.shader === "") {
            err.INVALID_EFFECT_SHADER(pos, obj.shader).warn();
            return null;
        }
        if (!TC.gt(end, start)) {
            err.EFFECT_END_NOT_AFTER_START(pos, start, end).warn();
            return null;
        }
        const global = typeof obj.global === "boolean" ? obj.global : PHIRA_EFFECT_DEFAULT_GLOBAL;
        const vars = this.parseVars(obj.vars, pos, start, end);
        return { start, end, shader: obj.shader, global, vars };
    }

    /**
     * 解析`vars`变量表
     * @returns 变量表，无效变量会被跳过（已warn）
     */
    static parseVars(raw: unknown, pos: string, from: TimeT, to: TimeT): PhiraEffectVars {
        const vars: PhiraEffectVars = {};
        if (raw === undefined || raw === null) {
            return vars;
        }
        if (typeof raw !== "object" || Array.isArray(raw)) {
            err.INVALID_EFFECT_VARS(pos, raw).warn();
            return vars;
        }
        const obj = raw as Record<string, unknown>;
        for (const name of Object.keys(obj)) {
            const animVar = this.parseAnimVar(obj[name], `${pos}.vars.${name}`, from, to);
            if (animVar !== undefined) {
                vars[name] = animVar;
            }
        }
        return vars;
    }

    /**
     * 解析一个动画变量（常量或关键帧数组）
     *
     * 关键帧会被按起始时间排序，并剔除重叠的帧（已warn）；
     * 越出`[from, to]`区间的关键帧时间会被裁剪（`fix`）。
     *
     * @returns 无效时返回`undefined`（已warn）
     */
    static parseAnimVar(
        raw: unknown,
        pos: string,
        from: TimeT,
        to: TimeT
    ): PhiraAnimVar<PhiraAnimVarESType> | undefined {
        if (isAnimVarConstant(raw)) {
            return raw;
        }
        if (!Array.isArray(raw) || raw.length === 0 || typeof raw[0] !== "object" || raw[0] === null) {
            err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
            return undefined;
        }
        const events: PhiraAnimVarEvent<PhiraAnimVarESType>[] = [];
        for (let i = 0; i < raw.length; i++) {
            const event = this.parseAnimVarEvent(raw[i], `${pos}[${i}]`, from, to);
            if (event) {
                events.push(event);
            }
        }
        if (!events.length) {
            err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
            return undefined;
        }
        events.sort((a, b) => TC.cmp(a.startTime, b.startTime));
        // 剔除重叠关键帧，保证时间递增且互不重叠
        // 注意首尾相接（startTime == last.endTime）是合法的，不能误删
        const result: PhiraAnimVarEvent<PhiraAnimVarESType>[] = [];
        for (const event of events) {
            const last = result[result.length - 1];
            if (last && !TC.gt(event.startTime, last.endTime) && !TC.eq(event.startTime, last.endTime)) {
                err.EFFECT_ANIM_VAR_TIME_NOT_INCREMENTAL(pos).warn();
                continue;
            }
            result.push(event);
        }
        return result;
    }

    /**
     * 解析单个关键帧
     * @returns 无效时返回`undefined`（已warn）
     */
    static parseAnimVarEvent(
        raw: unknown,
        pos: string,
        from: TimeT,
        to: TimeT
    ): PhiraAnimVarEvent<PhiraAnimVarESType> | undefined {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
            return undefined;
        }
        const obj = raw as Record<string, unknown>;
        const startTime = this.parseTime(obj.startTime, `${pos}.startTime`);
        const endTime = this.parseTime(obj.endTime, `${pos}.endTime`);
        if (!startTime || !endTime) {
            return undefined;
        }
        const startValue = this.parseAnimVarValue(obj.start, `${pos}.start`);
        const endValue = this.parseAnimVarValue(obj.end, `${pos}.end`);
        if (startValue === undefined || endValue === undefined) {
            return undefined;
        }
        // 起止值形状必须一致
        if (Array.isArray(startValue) !== Array.isArray(endValue)
            || (Array.isArray(startValue) && startValue.length !== (endValue as unknown[]).length)) {
            err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
            return undefined;
        }
        let easingType = DEFAULT_EASING_TYPE;
        if (obj.easingType !== undefined && obj.easingType !== null) {
            if (typeof obj.easingType === "number" && Number.isInteger(obj.easingType) && rpeEasingArray[obj.easingType]) {
                easingType = obj.easingType;
            } else {
                err.INVALID_EFFECT_ANIM_VAR_EASING(pos, obj.easingType).warn();
            }
        }
        let easingLeft = typeof obj.easingLeft === "number" ? obj.easingLeft : 0.0;
        let easingRight = typeof obj.easingRight === "number" ? obj.easingRight : 1.0;
        if (!(easingLeft < easingRight)) {
            easingLeft = 0.0;
            easingRight = 1.0;
        }
        let start = startTime;
        let end = endTime;
        if (TC.lt(start, from) || TC.gt(end, to)) {
            // 关键帧越出特效区间，裁剪进来
            err.EFFECT_ANIM_VAR_OUT_OF_RANGE(pos).fix();
            if (TC.lt(start, from)) { start = [...from] as TimeT; }
            if (TC.gt(end, to)) { end = [...to] as TimeT; }
        }
        if (!TC.gt(end, start)) {
            // 裁剪后退化成了空段，丢弃
            err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
            return undefined;
        }
        return {
            start: startValue,
            end: endValue,
            startTime: start,
            endTime: end,
            easingType,
            easingLeft,
            easingRight
        };
    }

    /**
     * 解析关键帧的起止值（数值或长度2/4的数值元组）
     * @returns 无效时返回`undefined`（已warn）
     */
    static parseAnimVarValue(raw: unknown, pos: string): PhiraAnimVarESType | undefined {
        if (isAnimVarConstant(raw)) {
            return raw;
        }
        err.INVALID_EFFECT_ANIM_VAR(pos, raw).warn();
        return undefined;
    }

    /**
     * 解析时间元组`[小节, 分子, 分母]`
     * @returns 无效时返回`null`（已warn）
     */
    static parseTime(raw: unknown, pos: string): TimeT | null {
        if (!Array.isArray(raw) || raw.length !== 3
            || !raw.every(item => typeof item === "number" && Number.isInteger(item))
            || raw[2] <= 0) {
            err.INVALID_EFFECT_TIME(pos, raw).warn();
            return null;
        }
        return TC.validateIp([raw[0], raw[1], raw[2]]);
    }

    /**
     * 把KPA2的特效事件数据转成Phira特效数据
     *
     * 变量序列数据会被转回动画变量，随后由
     * {@linkcode EffectStartNode.fromPhiraEffect} 统一构建。
     *
     * @param data KPA2特效事件数据
     * @param pos 用于报错的位置标识
     */
    static effectFromKPA2(data: EffectEventDataKPA2, pos: string = "effect"): PhiraEffect {
        return {
            start: data.startTime,
            end: data.endTime,
            shader: data.shader,
            global: data.global ?? PHIRA_EFFECT_DEFAULT_GLOBAL,
            vars: data.vars
                ? Object.fromEntries(
                    Object.entries(data.vars).map(([name, seqData]) => [
                        name,
                        this.varSeqToPhiraAnimVar(seqData)
                    ])
                )
                : {}
        };
    }

    /** 由缓动编号与缓动窗口构造求值器（缓动编号沿用RPE编号，1为线性） */
    private static createVarEvaluator(
        easingType: number,
        easingLeft: number,
        easingRight: number,
        value: PhiraAnimVarESType
    ) {
        const easing = rpeEasingArray[easingType] ?? linearEasing;
        const finalEasing = (easingLeft !== 0 || easingRight !== 1)
            ? new SegmentedEasing(easing, easingLeft, easingRight)
            : easing;
        const valueType = typeof value === "number" ? EventValueType.numeric : EventValueType.vector;
        return EasedEvaluator.getEvaluatorFromEasing(valueType, finalEasing);
    }

    /**
     * 由Phira的动画变量创建一个uniform变量事件序列
     *
     * 序列的时间区间被裁剪进`[from, to]`：
     * 关键帧越界会被裁剪，首个关键帧之前会补一个常量节点，
     * 因此序列在`[from, to]`内始终有定义。
     *
     * @param animVar 常量或关键帧数组
     * @param from 区间起点（特效起始时间）
     * @param to 区间终点（特效结束时间）
     * @param pos 用于报错的位置标识
     * @returns 变量序列；`animVar`无效时返回`null`（已warn）
     */
    static animVarToSequence(
        animVar: PhiraAnimVar<PhiraAnimVarESType>,
        from: TimeT,
        to: TimeT,
        pos: string = "effect.vars"
    ): EventNodeSequence<PhiraAnimVarESType> | null {
        const seq = new EventNodeSequence<PhiraAnimVarESType>(EventType.effect, TC.toBeats(to));
        seq.id = pos;
        if (!isAnimVarEvents(animVar)) {
            // 常量：单个节点即可，值无限延伸
            const node = new EventStartNode<PhiraAnimVarESType>(from, animVar);
            EventNode.connect(seq.head, node);
            EventNode.connect(node, seq.tail);
            seq.listLength = 1;
            seq.initJump();
            return seq;
        }
        const events = animVar;
        // 首个关键帧之前补一个常量节点，值取首个关键帧的起始值
        if (TC.lt(from, events[0].startTime)) {
            const head = new EventStartNode<PhiraAnimVarESType>(from, events[0].start);
            const headEnd = new EventEndNode<PhiraAnimVarESType>(events[0].startTime, events[0].start);
            EventNode.connect(seq.head, head);
            EventNode.connect(head, headEnd);
            this.appendVarEvents(seq, events, headEnd);
        } else {
            this.appendVarEvents(seq, events, seq.head);
        }
        seq.initJump();
        return seq;
    }

    /**
     * 把uniform变量事件序列导出为Phira的动画变量
     *
     * 只有单个节点（值无限延伸）时导出为常量，否则导出为关键帧数组。
     */
    static sequenceToAnimVar(
        seq: EventNodeSequence<PhiraAnimVarESType>
    ): PhiraAnimVar<PhiraAnimVarESType> {
        const first = seq.head.next as EventStartNode<PhiraAnimVarESType> | null;
        if (!first) {
            return 0;
        }
        if (first.next.type === NodeType.TAIL) {
            // 单个节点即常量
            return cloneAnimVarValue(first.value);
        }
        const events: PhiraAnimVarEvent<PhiraAnimVarESType>[] = [];
        let node: EventStartNode<PhiraAnimVarESType> = first;
        while (node.next.type !== NodeType.TAIL) {
            const end = node.next as EventEndNode<PhiraAnimVarESType>;
            events.push({
                start: cloneAnimVarValue(node.value),
                end: cloneAnimVarValue(end.value),
                startTime: [...node.time] as TimeT,
                endTime: [...end.time] as TimeT,
                easingType: this.varEvaluatorEasingType(node),
                easingLeft: this.varEvaluatorEasingLeft(node),
                easingRight: this.varEvaluatorEasingRight(node)
            });
            node = end.next as EventStartNode<PhiraAnimVarESType>;
        }
        // 合并首尾相接且参数一致的节点，减少冗余
        return this.mergeVarEvents(events);
    }

    /** 把关键帧数组按稠密链规则接到`last`之后 */
    private static appendVarEvents(
        seq: EventNodeSequence<PhiraAnimVarESType>,
        events: PhiraAnimVarEvent<PhiraAnimVarESType>[],
        last: any
    ): void {
        let listLength = 0;
        for (let i = 0; i < events.length; i++) {
            const event = events[i]!;
            const start = new EventStartNode<PhiraAnimVarESType>(event.startTime, event.start);
            start.evaluator = this.createVarEvaluator(
                event.easingType,
                event.easingLeft ?? 0,
                event.easingRight ?? 1,
                event.start
            ) as unknown as Evaluator<PhiraAnimVarESType>;
            const end = new EventEndNode<PhiraAnimVarESType>(event.endTime, event.end);
            EventNode.connect(last, start);
            EventNode.connect(start, end);
            last = end;
            listLength += 2;

            const next = events[i + 1];
            if (!next) { continue; }
            if (TC.lt(event.endTime, next.startTime)) {
                // 关键帧之间有空隙：补一个保持值的填充段
                const fillerStart = new EventStartNode<PhiraAnimVarESType>(event.endTime, event.end);
                const fillerEnd = new EventEndNode<PhiraAnimVarESType>(next.startTime, event.end);
                EventNode.connect(last, fillerStart);
                EventNode.connect(fillerStart, fillerEnd);
                last = fillerEnd;
                listLength += 2;
            }
        }
        // 收尾：最后一个起始节点的值无限延伸
        const tail = new EventStartNode<PhiraAnimVarESType>(events[events.length - 1].endTime, events[events.length - 1].end);
        EventNode.connect(last, tail);
        EventNode.connect(tail, seq.tail);
        seq.listLength += listLength + 1;
    }

    /** 把KPA2的变量序列数据转回Phira动画变量 */
    private static varSeqToPhiraAnimVar(
        data: EventNodeSequenceDataKPA2<PhiraAnimVarESType>
    ): PhiraAnimVar<PhiraAnimVarESType> {
        const events = (data.events ?? []).map(event => {
            const { easingType, easingLeft, easingRight } = this.evaluatorDataEasing(event.evaluator);
            return {
                start: event.start,
                end: event.end,
                startTime: event.startTime,
                endTime: event.endTime,
                easingType,
                easingLeft,
                easingRight
            };
        });
        if (!events.length) {
            // 没有事件段：整个序列是一个常量
            return data.final?.start ?? 0;
        }
        return events;
    }

    /** 从求值器数据中取出缓动编号与缓动窗口 */
    private static evaluatorDataEasing(data: EvaluatorDataKPA2<any> | undefined): {
        easingType: number;
        easingLeft: number;
        easingRight: number;
    } {
        const fallback = { easingType: DEFAULT_EASING_TYPE, easingLeft: 0, easingRight: 1 };
        if (!data || data.type !== EvaluatorType.eased) {
            return fallback;
        }
        const easing = data.easing;
        if (easing.type === EasingType.normal) {
            return { ...fallback, easingType: easing.identifier };
        }
        if (easing.type === EasingType.segmented) {
            const inner = easing.inner;
            return {
                easingType: inner.type === EasingType.normal ? inner.identifier : DEFAULT_EASING_TYPE,
                easingLeft: easing.left,
                easingRight: easing.right
            };
        }
        return fallback;
    }

    private static varEvaluatorEasingType(node: EventStartNode<PhiraAnimVarESType>): number {
        const easing = node.evaluator instanceof EasedEvaluator ? node.evaluator.easing : null;
        const inner = easing instanceof SegmentedEasing ? easing.easing : easing;
        return inner && "rpeId" in inner ? (inner.rpeId as number) : DEFAULT_EASING_TYPE;
    }
    private static varEvaluatorEasingLeft(node: EventStartNode<PhiraAnimVarESType>): number {
        const easing = node.evaluator instanceof EasedEvaluator ? node.evaluator.easing : null;
        return easing instanceof SegmentedEasing ? easing.left : 0;
    }
    private static varEvaluatorEasingRight(node: EventStartNode<PhiraAnimVarESType>): number {
        const easing = node.evaluator instanceof EasedEvaluator ? node.evaluator.easing : null;
        return easing instanceof SegmentedEasing ? easing.right : 1;
    }

    /** 合并首尾相接且参数一致的关键帧，减少导出冗余 */
    private static mergeVarEvents(
        events: PhiraAnimVarEvent<PhiraAnimVarESType>[]
    ): PhiraAnimVarEvent<PhiraAnimVarESType>[] {
        const result: PhiraAnimVarEvent<PhiraAnimVarESType>[] = [];
        for (const event of events) {
            const last = result[result.length - 1];
            if (last && TC.eq(last.endTime, event.startTime)
                && last.easingType === event.easingType
                && last.easingLeft === event.easingLeft
                && last.easingRight === event.easingRight) {
                last.end = event.end;
                last.endTime = event.endTime;
                continue;
            }
            result.push({ ...event });
        }
        return result;
    }
}

/// #enddeclaration
