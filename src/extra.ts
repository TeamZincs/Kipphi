import type { Chart } from "./chart";
import { EventNodeSequence } from "./event";
import { type EventDataRPELike, type TimeT } from "./chartTypes";
import { PhiraAnimVar, PhiraEffect, PhiraExtraJson, PhiraVideo } from "./extraTypes";
import { RPEChartCompiler } from "./rpeChartCompiler";
import { toPhiraScale } from "./video";

/**
 * 将Phira的动画变量转换为RPE风格的事件数据列表
 *
 * Phira的动画变量与RPE事件共用同一套缓动编号，也没有贝塞尔缓动，
 * 所以可以直接一对一转换。
 *
 * 动画变量的时间被当作谱面绝对时间。
 *
 * @param animVar 常量或动画事件数组
 * @param from 区间起点，仅当animVar为常量时用到
 * @param to 区间终点，仅当animVar为常量时用到
 * @since 2.2.0
 */
export function animVarToEventData(
    animVar: PhiraAnimVar<number>,
    from: TimeT,
    to: TimeT
): EventDataRPELike<number>[] {
    if (!Array.isArray(animVar)) {
        return [{
            bezier: 0,
            bezierPoints: [0, 0, 0, 0],
            easingLeft: 0.0,
            easingRight: 1.0,
            easingType: 1,
            start: animVar,
            end: animVar,
            startTime: from,
            endTime: to,
            linkgroup: 0
        }];
    }
    return animVar.map((event) => ({
        bezier: 0,
        bezierPoints: [0, 0, 0, 0],
        easingLeft: event.easingLeft ?? 0.0,
        easingRight: event.easingRight ?? 1.0,
        easingType: event.easingType,
        start: event.start,
        end: event.end,
        startTime: event.startTime,
        endTime: event.endTime,
        linkgroup: 0
    }));
}

/**
 * 将谱面编译为Phira的extra.json
 *
 * @example
 * const extra = new ExtraJsonCompiler(chart).compile();
 */
export class ExtraJsonCompiler {
    /**
     * 用于编译动画变量，懒创建
     *
     * 因为模板缓动的展开结果会被缓存，所以整个生命周期内复用同一个实例。
     */
    protected rpeCompiler: RPEChartCompiler | null = null;
    constructor(public chart: Chart) {
    }
    compile(): PhiraExtraJson {
        return {
            bpm: this.chart.timeCalculator.bpmSequence.dumpPhiraBPM(),
            effects: this.dumpEffects(),
            videos: this.dumpVideos()
        }
    }
    /**
     * 导出特效为Phira的`effects`数组
     *
     * 由谱面模型中的特效序列拆平而来，按起始时间升序。
     * 变量序列在构建时已保证关键帧不越出特效区间。
     *
     * @returns 特效列表
     * @since 2.3.0
     */
    dumpEffects(): PhiraEffect[] {
        return this.chart.dumpPhiraEffects();
    }
    /**
     * 导出视频列表
     *
     * 每个视频的不透明度与变暗程度都由对应的全谱拉通序列在
     * 该视频播放区间内的片段编译而来。
     *
     * Phira的动画变量不支持贝塞尔缓动与表达式缓动，
     * 这两者会被{@linkcode RPEChartCompiler.interpolationStep}插值成折线。
     *
     * @returns 视频列表，空路径的节点会被跳过
     */
    dumpVideos(): PhiraVideo[] {
        const chart = this.chart;
        const ret: PhiraVideo[] = [];
        for (const { node, startBeats, endBeats } of chart.video.name.segments()) {
            if (!node.value) {
                continue; // 无视频
            }
            // 最后一个视频段一直持续到谱面结束
            const to = endBeats === Infinity ? chart.getEffectiveBeats() : endBeats;
            ret.push({
                path: node.value,
                time: node.time,
                scale: toPhiraScale(node.scale),
                alpha: this.dumpAnimVar(chart.video.alpha, startBeats, to),
                dim: this.dumpAnimVar(chart.video.dim, startBeats, to)
            });
        }
        return ret;
    }
    /**
     * 将数值序列的某个区间编译为Phira的动画变量
     * @see {@linkcode RPEChartCompiler.dumpAnimVar}
     */
    dumpAnimVar(sequence: EventNodeSequence<number>, from: number, to: number): PhiraAnimVar<number> {
        return (this.rpeCompiler ??= new RPEChartCompiler(this.chart)).dumpAnimVar(sequence, from, to);
    }
}
