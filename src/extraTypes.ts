import { PhiraAnimVarESType, PhiraTargetRange, TimeT } from "./chartTypes";


export interface PhiraExtraJson {
    bpm: PhiraBpmSegment[];
    effects: PhiraEffect[];
    videos: PhiraVideo[];
}

export interface PhiraBpmSegment {
    time: TimeT;
    bpm: number;
}

export type { PhiraAnimVarESType };

export type PhiraAnimVar<T extends PhiraAnimVarESType> = T | PhiraAnimVarEvent<T>[];

export interface PhiraAnimVarEvent<T extends PhiraAnimVarESType> {
    start: T;
    end: T;
    startTime: TimeT;
    endTime: TimeT;
    easingType: number;
    /** 缓动窗口左端，缺省0。kipphi扩展字段，Phira的JSON中没有 */
    easingLeft?: number;
    /** 缓动窗口右端，缺省1。kipphi扩展字段，Phira的JSON中没有 */
    easingRight?: number;
}

/**
 * 特效的着色器uniform变量表
 *
 * 键为uniform变量名，值为常量或动画（关键帧数组）。
 * @since 2.3.0
 */
export type PhiraEffectVars = { [name: string]: PhiraAnimVar<PhiraAnimVarESType> };

export type { PhiraTargetRange };

/**
 * Phira谱面特效
 *
 * 在`[start, end]`区间内对整个谱面应用着色器特效。
 * 见 [Phira谱面标准·特效](https://teamflos.github.io/phira-docs/chart-standard/extra/effect/index.html)。
 *
 * @since 2.3.0
 */
export interface PhiraEffect {
    /** 特效起始时间，`[小节, 分子, 分母]` */
    start: TimeT;
    /** 特效结束时间，必须晚于{@linkcode start} */
    end: TimeT;
    /** 着色器名，可以是内置着色器或自定义着色器 */
    shader: string;
    /** 是否影响UI元素（连击、暂停按钮等），缺省`false` */
    global?: boolean;
    /** 着色器uniform变量表，可缺省 */
    vars?: PhiraEffectVars;
    /**
     * 作用范围（PhiZone Player 的扩展），缺省表示整个谱面
     *
     * `global` 为 `true` 时该字段无效。
     */
    targetRange?: PhiraTargetRange;
}

export interface PhiraVideo {
    path: string;
    time: TimeT;
    scale: "cropCenter" | "inside" | "fit";
    /** 不透明度，可以是常量或动画序列 */
    alpha: PhiraAnimVar<number>;
    /** 变暗程度，可以是常量或动画序列 */
    dim: PhiraAnimVar<number>;
}



