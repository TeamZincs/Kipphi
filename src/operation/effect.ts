import type { Chart } from "../chart";
import type { PhiraAnimVar, PhiraAnimVarESType, PhiraEffect } from "../extraTypes";
import type { TimeT } from "../chartTypes";
import { err } from "../env";
import type { EventNodeSequence } from "../event";
import {
    EffectNodeSequence,
    EffectStartNode,
    PhiraEffectParser,
} from "../effect";
import TC from "../time";
import { Operation } from "./basic";

/** 特效上可直接修改的恒定属性 */
export type EffectPropName = "shader" | "global";

/** 纯校验时间元组，不产生告警日志 */
const isValidTimeT = (value: unknown): value is TimeT =>
    Array.isArray(value) && value.length === 3
    && value.every(item => typeof item === "number" && Number.isInteger(item))
    && value[2] > 0;

/**
 * 找出谱面中"末尾不晚于`beats`"的首个特效序列
 * @returns 找不到时返回`null`
 */
function pickSequence(chart: Chart, beats: number): EffectNodeSequence | null {
    for (const seq of chart.effects) {
        let last: number | null = null;
        for (const node of seq.effects()) {
            last = TC.toBeats((node.next as { time: TimeT }).time);
        }
        if (last !== null && last <= beats) {
            return seq;
        }
    }
    return null;
}

/**
 * 添加一个谱面级特效
 *
 * 特效以Phira数据的形式给出，内部转换成{@linkcode EffectStartNode}后插入
 * 谱面的特效序列。`line`缺省时自动挑选序列：优先放入第一个"末尾不早于
 * 该特效起点"的序列，都放不下则新开一条；显式给出`line`时若与既有特效
 * 重叠会抛错。
 *
 * @example
 * ```ts
 * operations.do(new EffectAddOperation(chart, {
 *     start: [2, 0, 1],
 *     end: [4, 0, 1],
 *     shader: "chromatic",
 *     vars: { power: 0.05 }
 * }));
 * ```
 * @since 2.3.0
 */
export class EffectAddOperation extends Operation {
    updatesEditor = true;
    /** 插入的序列，`do`时确定 */
    sequence!: EffectNodeSequence;
    /** 插入的特效起始节点，`do`时确定 */
    node!: EffectStartNode;
    /** 是否为本次操作新开的序列（撤销时要一并移除） */
    createdSequence = false;
    constructor(
        public chart: Chart,
        public effect: PhiraEffect,
        public line?: number
    ) {
        super();
        // 构造期就解析并校验，失败直接抛错
        EffectStartNode.fromPhiraEffect(effect, "effect");
    }
    do(chart: Chart) {
        if (!this.sequence || !chart.effects.includes(this.sequence)) {
            let target: EffectNodeSequence;
            if (this.line !== undefined) {
                const found = chart.effects[this.line];
                if (!found) {
                    throw err.EFFECT_NOT_FOUND(`effects[${this.line}]`);
                }
                target = found;
            } else {
                const picked = pickSequence(chart, TC.toBeats(this.effect.start));
                if (picked) {
                    target = picked;
                } else {
                    target = EffectNodeSequence.newEffectSeq(chart.effectiveBeats, chart.effects.length);
                    this.createdSequence = true;
                }
            }
            this.sequence = target;
        }
        this.node = EffectStartNode.fromPhiraEffect(this.effect, "effect");
        this.sequence.insertEffect(this.node, this.effect.end);
        if (this.createdSequence && !chart.effects.includes(this.sequence)) {
            chart.addEffectSequence(this.sequence);
        }
    }
    undo(chart: Chart) {
        this.sequence.removeEffect(this.node);
        if (this.createdSequence) {
            chart.removeEffectSequence(this.sequence);
            this.sequence = undefined as unknown as EffectNodeSequence;
        }
    }
}

/**
 * 移除一个谱面级特效段
 *
 * 采用"就地置空"实现，链表结构不变，撤销时按原值恢复。
 *
 * @example
 * ```ts
 * operations.do(new EffectRemoveOperation(chart, chart.getActiveEffects(4)[0]));
 * ```
 * @since 2.3.0
 */
export class EffectRemoveOperation extends Operation {
    updatesEditor = true;
    sequence: EffectNodeSequence;
    originalShader: string;
    originalGlobal: boolean;
    originalVars: Map<string, EventNodeSequence<PhiraAnimVarESType>>;
    constructor(public chart: Chart, public node: EffectStartNode) {
        super();
        const seq = node.parentSeq;
        if (!(seq instanceof EffectNodeSequence) || node.isEmpty()) {
            this.ineffective = true;
            return;
        }
        this.sequence = seq;
        this.originalShader = node.value;
        this.originalGlobal = node.global;
        this.originalVars = node.vars;
    }
    do() {
        this.sequence.removeEffect(this.node);
    }
    undo() {
        this.node.value = this.originalShader;
        this.node.global = this.originalGlobal;
        this.node.vars = this.originalVars;
        const end = this.node.next;
        if (end.type !== 1 /* TAIL */) {
            (end as { value: string }).value = this.originalShader;
        }
    }
}

/**
 * 修改特效的着色器名或`global`标志
 *
 * 这两个属性在段内恒定，直接改节点字段即可。时间的修改请用
 * {@linkcode EffectTimeChangeOperation} / {@linkcode EffectMoveOperation}。
 *
 * @example
 * ```ts
 * // 让特效也影响UI
 * operations.do(new EffectPropChangeOperation(chart, node, "global", true));
 * ```
 * @template T - 要修改的属性名
 * @since 2.3.0
 */
export class EffectPropChangeOperation<T extends EffectPropName> extends Operation {
    updatesEditor = true;
    originalValue: T extends "shader" ? string : boolean;
    constructor(public chart: Chart, public node: EffectStartNode, public field: T, public value: T extends "shader" ? string : boolean) {
        super();
        if (field === "shader") {
            if (typeof this.value !== "string" || this.value === "") {
                throw err.INVALID_EFFECT_SHADER("effect.shader", this.value);
            }
            this.originalValue = node.value as T extends "shader" ? string : boolean;
        } else {
            if (typeof this.value !== "boolean") {
                throw err.INVALID_EFFECT_GLOBAL("effect.global", this.value);
            }
            this.originalValue = node.global as T extends "shader" ? string : boolean;
        }
        if (this.value === this.originalValue) {
            this.ineffective = true;
        }
    }
    do() {
        if (this.field === "shader") {
            this.node.value = this.value as string;
        } else {
            this.node.global = this.value as boolean;
        }
        this.syncEndValue();
    }
    undo() {
        if (this.field === "shader") {
            this.node.value = this.originalValue as string;
        } else {
            this.node.global = this.originalValue as boolean;
        }
        this.syncEndValue();
    }
    override rewrite(operation: EffectPropChangeOperation<T>, chart: Chart): boolean {
        if (operation.node === this.node && operation.field === this.field) {
            this.value = operation.value;
            if (this.field === "shader") {
                this.node.value = this.value as string;
            } else {
                this.node.global = this.value as boolean;
            }
            this.syncEndValue();
            return true;
        }
        return false;
    }
    /** 结束节点的值与起始节点保持一致 */
    private syncEndValue() {
        const end = this.node.next;
        if (end.type !== 1 /* TAIL */) {
            (end as { value: string }).value = this.node.value;
        }
    }
}

/**
 * 修改特效的起止时间
 *
 * 内部调用{@linkcode EffectNodeSequence.setEffectTime}原地修改链表，
 * **节点对象不变**，外部引用保持有效。
 *
 * @example
 * ```ts
 * operations.do(new EffectTimeChangeOperation(chart, node, [3, 0, 1], [6, 0, 1]));
 * ```
 * @since 2.3.0
 */
export class EffectTimeChangeOperation extends Operation {
    updatesEditor = true;
    sequence: EffectNodeSequence;
    originalStart: TimeT;
    originalEnd: TimeT;
    constructor(
        public chart: Chart,
        public node: EffectStartNode,
        public startTime: TimeT,
        public endTime: TimeT
    ) {
        super();
        const seq = node.parentSeq;
        if (!(seq instanceof EffectNodeSequence) || node.isEmpty()) {
            this.ineffective = true;
            return;
        }
        if (!isValidTimeT(startTime) || !isValidTimeT(endTime)) {
            throw err.INVALID_EFFECT_TIME("effect", startTime);
        }
        if (!TC.gt(endTime, startTime)) {
            throw err.EFFECT_END_NOT_AFTER_START("effect", startTime, endTime);
        }
        this.sequence = seq;
        this.originalStart = node.time;
        this.originalEnd = (node.next as { time: TimeT }).time;
        if (TC.eq(startTime, this.originalStart) && TC.eq(endTime, this.originalEnd)) {
            this.ineffective = true;
        }
    }
    do() {
        this.sequence.setEffectTime(this.node, this.startTime, this.endTime);
    }
    undo() {
        this.sequence.setEffectTime(this.node, this.originalStart, this.originalEnd);
    }
    override rewrite(operation: EffectTimeChangeOperation, chart: Chart): boolean {
        if (operation.node === this.node) {
            this.startTime = operation.startTime;
            this.endTime = operation.endTime;
            this.sequence.setEffectTime(this.node, this.startTime, this.endTime);
            return true;
        }
        return false;
    }
}

/**
 * 整体平移一个特效（保持时长不变）
 *
 * 与{@linkcode EffectTimeChangeOperation}一样原地修改，节点对象不变。
 *
 * @example
 * ```ts
 * // 往后挪1拍
 * operations.do(new EffectMoveOperation(chart, node, [1, 0, 1]));
 * ```
 * @since 2.3.0
 */
export class EffectMoveOperation extends Operation {
    updatesEditor = true;
    sequence: EffectNodeSequence;
    originalStart: TimeT;
    originalEnd: TimeT;
    constructor(
        public chart: Chart,
        public node: EffectStartNode,
        public delta: TimeT
    ) {
        super();
        const seq = node.parentSeq;
        if (!(seq instanceof EffectNodeSequence) || node.isEmpty()) {
            this.ineffective = true;
            return;
        }
        if (!isValidTimeT(delta)) {
            throw err.INVALID_EFFECT_TIME("effect delta", delta);
        }
        const newStart = TC.vadd(node.time, delta);
        if (!TC.gt(newStart, [0, 0, 1]) && !TC.eq(newStart, [0, 0, 1])) {
            throw err.INVALID_EFFECT_TIME("effect.start after moving", newStart);
        }
        this.sequence = seq;
        this.originalStart = node.time;
        this.originalEnd = (node.next as { time: TimeT }).time;
        if (delta[0] === 0 && delta[1] === 0) {
            this.ineffective = true;
        }
    }
    do() {
        this.sequence.setEffectTime(
            this.node,
            TC.vadd(this.originalStart, this.delta),
            TC.vadd(this.originalEnd, this.delta)
        );
    }
    undo() {
        this.sequence.setEffectTime(this.node, this.originalStart, this.originalEnd);
    }
    override rewrite(operation: EffectMoveOperation, chart: Chart): boolean {
        if (operation.node === this.node) {
            this.delta = TC.vadd(this.delta, operation.delta);
            this.sequence.setEffectTime(
                this.node,
                TC.vadd(this.originalStart, this.delta),
                TC.vadd(this.originalEnd, this.delta)
            );
            return true;
        }
        return false;
    }
}

/**
 * 设置特效的一个着色器uniform变量
 *
 * 值可以是常量，也可以是关键帧数组；关键帧数组会经
 * {@linkcode PhiraEffectParser.parseAnimVar} 规范化——
 * 越出特效区间的关键帧时间会被裁剪进来，无效值直接抛错。
 *
 * @example
 * ```ts
 * // 常量
 * operations.do(new EffectVarChangeOperation(chart, node, "sampleCount", 5));
 * // 动画
 * operations.do(new EffectVarChangeOperation(chart, node, "power", [
 *     { start: 0, end: 0.1, startTime: [2, 0, 1], endTime: [4, 0, 1], easingType: 2 }
 * ]));
 * ```
 * @since 2.3.0
 */
export class EffectVarChangeOperation extends Operation {
    updatesEditor = true;
    /** 变量此前是否存在 */
    hasOriginal: boolean;
    originalValue?: EventNodeSequence<PhiraAnimVarESType>;
    value: PhiraAnimVar<PhiraAnimVarESType>;
    constructor(
        public chart: Chart,
        public node: EffectStartNode,
        public name: string,
        value: PhiraAnimVar<PhiraAnimVarESType>
    ) {
        super();
        const pos = `effect.vars.${name}`;
        const startTime = node.time;
        const endTime = (node.next as { time: TimeT }).time;
        // 规范化（含越界裁剪），无效时抛错
        const parsed = PhiraEffectParser.parseAnimVar(value, pos, startTime, endTime);
        if (parsed === undefined) {
            throw err.INVALID_EFFECT_ANIM_VAR(pos, value);
        }
        this.value = parsed;
        if (node.vars.has(name)) {
            this.hasOriginal = true;
            this.originalValue = node.vars.get(name);
        } else {
            this.hasOriginal = false;
        }
    }
    do() {
        const seq = PhiraEffectParser.animVarToSequence(
            this.value,
            this.node.time,
            (this.node.next as { time: TimeT }).time,
            `effect.vars.${this.name}`
        );
        if (seq) {
            this.node.vars.set(this.name, seq);
        }
    }
    undo() {
        if (this.hasOriginal) {
            this.node.vars.set(this.name, this.originalValue!);
        } else {
            this.node.vars.delete(this.name);
        }
    }
    override rewrite(operation: EffectVarChangeOperation, chart: Chart): boolean {
        if (operation.node === this.node && operation.name === this.name) {
            this.value = operation.value;
            const seq = PhiraEffectParser.animVarToSequence(
                this.value,
                this.node.time,
                (this.node.next as { time: TimeT }).time,
                `effect.vars.${this.name}`
            );
            if (seq) {
                this.node.vars.set(this.name, seq);
            }
            return true;
        }
        return false;
    }
}

/**
 * 删除特效的一个着色器uniform变量
 *
 * 撤销时按原值恢复。变量不存在时操作无效。
 *
 * @example
 * ```ts
 * operations.do(new EffectVarRemoveOperation(chart, node, "sampleCount"));
 * ```
 * @since 2.3.0
 */
export class EffectVarRemoveOperation extends Operation {
    updatesEditor = true;
    originalValue: EventNodeSequence<PhiraAnimVarESType>;
    constructor(public chart: Chart, public node: EffectStartNode, public name: string) {
        super();
        const seq = node.vars.get(name);
        if (!seq) {
            this.ineffective = true;
            return;
        }
        this.originalValue = seq;
    }
    do() {
        this.node.vars.delete(this.name);
    }
    undo() {
        this.node.vars.set(this.name, this.originalValue);
    }
}
