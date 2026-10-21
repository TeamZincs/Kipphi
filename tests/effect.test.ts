import { it, expect, describe } from "bun:test";
import {
    Chart,
    EffectNodeSequence,
    EffectStartNode,
    ExtraJsonCompiler,
    Op,
    PhiraEffectParser,
    type ChartDataKPA2,
    type ChartDataRPE,
    type PhiraExtraJson,
} from "../src";

const rpeChart = {
    BPMList: [{ bpm: 120, startTime: [0, 0, 1] }],
    META: {
        RPEVersion: 3,
        background: "",
        illustration: "",
        charter: "",
        composer: "",
        id: "",
        level: "",
        name: "effect test",
        offset: 0,
        song: "",
    },
    judgeLineGroup: ["Default"],
    judgeLineList: [],
    chartTime: 0,
    kpaChartTime: 0,
    multiLineString: "",
    multiScale: 1,
} as unknown as ChartDataRPE;

/** Phira文档中的chromatic示例 */
const docExtraJson: PhiraExtraJson = {
    bpm: [{ time: [0, 0, 1], bpm: 120 }],
    effects: [
        {
            start: [2, 0, 1],
            end: [4, 0, 1],
            shader: "chromatic",
            vars: {
                power: [
                    {
                        startTime: [2, 0, 1],
                        endTime: [4, 0, 1],
                        easingType: 2,
                        start: 0.0,
                        end: 0.1,
                    },
                ],
                sampleCount: 5,
            },
        },
    ],
    videos: [],
};

const makeChart = (extra: PhiraExtraJson = docExtraJson) =>
    Chart.fromRPEJSON(rpeChart, 30, extra);

describe("PhiraEffectParser", () => {
    it("parses the documented chromatic example", () => {
        const effects = PhiraEffectParser.parse(docExtraJson.effects);
        expect(effects).toHaveLength(1);
        const effect = effects[0]!;
        expect(effect.shader).toBe("chromatic");
        expect(effect.start).toEqual([2, 0, 1]);
        expect(effect.end).toEqual([4, 0, 1]);
        expect(effect.global).toBe(false);
        expect(effect.vars!.sampleCount).toBe(5);
        const power = effect.vars!.power as any[];
        expect(power).toHaveLength(1);
        // 缺省的缓动窗口被补成0/1
        expect(power[0].easingLeft).toBe(0);
        expect(power[0].easingRight).toBe(1);
    });

    it("skips invalid entries and keeps valid ones", () => {
        const effects = PhiraEffectParser.parse([
            null,
            { start: [1, 0, 1], end: [0, 0, 1], shader: "bad" }, // end早于start
            { start: [1, 0, 1], end: [2, 0, 1], shader: "" }, // 空shader
            { start: [1, 0, 1], end: [2, 0, 1], shader: "ok" },
            { start: [3, 0, 1], end: [4, 0, 1], shader: "later" },
        ]);
        expect(effects.map(e => e.shader)).toEqual(["ok", "later"]);
    });

    it("clips out-of-range keyframes and drops degenerate ones", () => {
        const effects = PhiraEffectParser.parse([
            {
                start: [2, 0, 1],
                end: [4, 0, 1],
                shader: "s",
                vars: {
                    // 整体越界：裁剪后起止相同，应被丢弃
                    dead: [
                        { startTime: [5, 0, 1], endTime: [6, 0, 1], easingType: 1, start: 0, end: 1 },
                    ],
                    // 左越界：起点被裁剪到特效起点
                    clipped: [
                        { startTime: [1, 0, 1], endTime: [3, 0, 1], easingType: 1, start: 0, end: 1 },
                    ],
                    // 无效缓动号：回落到线性
                    badEasing: [
                        { startTime: [2, 0, 1], endTime: [4, 0, 1], easingType: 9999, start: 0, end: 1 },
                    ],
                    // 常量元组
                    vec: [1, 2],
                    // 无效值
                    broken: "nope",
                },
            },
        ]);
        const vars = effects[0]!.vars!;
        expect("dead" in vars).toBe(false);
        expect(vars.clipped[0]).toMatchObject({ startTime: [2, 0, 1], endTime: [3, 0, 1] });
        expect((vars.badEasing as any[])[0].easingType).toBe(1);
        expect(vars.vec).toEqual([1, 2]);
        expect("broken" in vars).toBe(false);
    });

    it("keeps back-to-back keyframes but drops overlapping ones", () => {
        const effects = PhiraEffectParser.parse([
            {
                start: [0, 0, 1],
                end: [4, 0, 1],
                shader: "s",
                vars: {
                    v: [
                        { startTime: [2, 0, 1], endTime: [4, 0, 1], easingType: 1, start: 1, end: 2 },
                        { startTime: [0, 0, 1], endTime: [2, 0, 1], easingType: 1, start: 0, end: 1 },
                        // 与上一帧重叠，应被剔除
                        { startTime: [1, 0, 1], endTime: [3, 0, 1], easingType: 1, start: 9, end: 9 },
                    ],
                },
            },
        ]);
        expect(effects[0]!.vars!.v).toHaveLength(2);
        expect((effects[0]!.vars!.v as any[]).map(e => e.start)).toEqual([0, 1]);
    });
});

describe("targetRange（PhiZone 的扩展）", () => {
    /** 走一遍解析器，再构建节点 */
    const make = (targetRange: unknown) => {
        const parsed = PhiraEffectParser.parseEffect({
            start: [0, 0, 1],
            end: [4, 0, 1],
            shader: "/a.frag",
            targetRange,
        }, "effects[0]");
        return EffectStartNode.fromPhiraEffect(parsed!);
    };

    it("解析并在互转时保留", () => {
        const targetRange = { minZIndex: 3, maxZIndex: 4, exclusive: true };
        expect(make(targetRange).targetRange).toEqual(targetRange);

        // 走一遍序列，确认 dump 回 Phira 时也带得出去
        const effects = PhiraEffectParser.parse([
            { start: [0, 0, 1], end: [4, 0, 1], shader: "/a.frag", targetRange },
        ]);
        const sequences = EffectNodeSequence.fromPhiraEffects(effects, 30);
        expect(EffectNodeSequence.toPhiraEffects(sequences)[0]!.targetRange).toEqual(targetRange);
    });

    it("exclusive 缺省为 false", () => {
        expect(make({ minZIndex: 0, maxZIndex: 9 }).targetRange)
            .toEqual({ minZIndex: 0, maxZIndex: 9, exclusive: false });
    });

    it("不写 targetRange 时为 null", () => {
        expect(make(undefined).targetRange).toBeNull();
    });

    it("非法区间只忽略这一项，特效本身保留", () => {
        const node = make({ minZIndex: 4, maxZIndex: 4 });
        expect(node.targetRange).toBeNull();
        expect(node.value).toBe("/a.frag");
    });

    it("clone 是深拷贝", () => {
        const node = make({ minZIndex: 1, maxZIndex: 2 });
        const copy = node.clone();
        expect(copy.targetRange).toEqual({ minZIndex: 1, maxZIndex: 2, exclusive: false });
        copy.targetRange!.minZIndex = 5;
        expect(node.targetRange!.minZIndex).toBe(1);
    });

    /** 收集构建期间的 warn */
    const captureWarnings = (run: () => void) => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
        try {
            run();
        } finally {
            console.warn = original;
        }
        return warnings;
    };

    const conflicts = (warnings: string[]) => warnings.filter(w => w.includes("conflict"));

    const chartWith = (effects: any[]) => makeChart({ bpm: [], effects, videos: [] });

    it("部分相交且都没 exclusive → SHADER_CONFLICT", () => {
        const warnings = captureWarnings(() => chartWith([
            { start: [0, 0, 1], end: [4, 0, 1], shader: "/a.frag", targetRange: { minZIndex: 3, maxZIndex: 7 } },
            { start: [0, 0, 1], end: [4, 0, 1], shader: "/b.frag", targetRange: { minZIndex: 5, maxZIndex: 9 } },
        ]));
        expect(conflicts(warnings)).toHaveLength(1);
    });

    it("嵌套 / exclusive / 时间不重叠 / global 都不算冲突", () => {
        const cases: any[][] = [
            // 嵌套
            [
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/a.frag", targetRange: { minZIndex: 0, maxZIndex: 9 } },
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/b.frag", targetRange: { minZIndex: 3, maxZIndex: 4 } },
            ],
            // 有一方 exclusive
            [
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/a.frag", targetRange: { minZIndex: 3, maxZIndex: 7, exclusive: true } },
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/b.frag", targetRange: { minZIndex: 5, maxZIndex: 9 } },
            ],
            // 时间不重叠
            [
                { start: [0, 0, 1], end: [2, 0, 1], shader: "/a.frag", targetRange: { minZIndex: 3, maxZIndex: 7 } },
                { start: [4, 0, 1], end: [6, 0, 1], shader: "/b.frag", targetRange: { minZIndex: 5, maxZIndex: 9 } },
            ],
            // global 不看 targetRange
            [
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/a.frag", global: true, targetRange: { minZIndex: 3, maxZIndex: 7 } },
                { start: [0, 0, 1], end: [4, 0, 1], shader: "/b.frag", targetRange: { minZIndex: 5, maxZIndex: 9 } },
            ],
        ];
        for (const effects of cases) {
            expect(conflicts(captureWarnings(() => chartWith(effects)))).toHaveLength(0);
        }
    });
});

describe("uniform variable sequences", () => {
    const FROM: [number, number, number] = [0, 0, 1];
    const TO: [number, number, number] = [4, 0, 1];
    /** 从原始动画变量构建变量序列（走一遍解析器的规范化） */
    const build = (animVar: unknown) => {
        const parsed = PhiraEffectParser.parseAnimVar(animVar, "v", FROM, TO)!;
        return PhiraEffectParser.animVarToSequence(parsed, FROM, TO, "v")!;
    };

    it("returns constants as-is", () => {
        expect(build(5).getValueAt(2)).toBe(5);
        expect(build([1, 2, 3, 4]).getValueAt(2)).toEqual([1, 2, 3, 4]);
    });

    it("interpolates linearly between keyframes", () => {
        const seq = build([
            { startTime: [0, 0, 1], endTime: [4, 0, 1], easingType: 1, start: 0, end: 1 },
        ]);
        expect(seq.getValueAt(1)).toBeCloseTo(0.25);
        expect(seq.getValueAt(3)).toBeCloseTo(0.75);
    });

    it("clamps outside the keyframe range", () => {
        const seq = build([
            { startTime: [2, 0, 1], endTime: [4, 0, 1], easingType: 1, start: 3, end: 7 },
        ]);
        expect(seq.getValueAt(0)).toBe(3); // 早于所有帧
        expect(seq.getValueAt(6)).toBe(7); // 晚于所有帧
    });

    it("interpolates tuples component-wise", () => {
        const seq = build([
            { startTime: [0, 0, 1], endTime: [2, 0, 1], easingType: 1, start: [0, 0], end: [2, 4] },
        ]);
        expect(seq.getValueAt(1)).toEqual([1, 2]);
    });

    it("holds the value across gaps between keyframes", () => {
        const seq = build([
            { startTime: [0, 0, 1], endTime: [1, 0, 1], easingType: 1, start: 1, end: 2 },
            { startTime: [3, 0, 1], endTime: [4, 0, 1], easingType: 1, start: 5, end: 6 },
        ]);
        expect(seq.getValueAt(2)).toBe(2); // 空档内保持前一段的终点值
        expect(seq.getValueAt(3.5)).toBeCloseTo(5.5);
    });

    it("honors easing window (easingLeft/easingRight)", () => {
        // 线性缓动在任意窗口内归一化后仍是线性
        const linear = build([
            { startTime: [0, 0, 1], endTime: [4, 0, 1], easingType: 1, easingLeft: 0.25, easingRight: 0.75, start: 0, end: 10 },
        ]);
        expect(linear.getValueAt(1)).toBeCloseTo(2.5);
        expect(linear.getValueAt(3)).toBeCloseTo(7.5);

        // sine.out（RPE编号2）在窗口[0.5, 1]内归一化
        const seq = build([
            { startTime: [0, 0, 1], endTime: [4, 0, 1], easingType: 2, easingLeft: 0.5, easingRight: 1, start: 0, end: 10 },
        ]);
        const ease = (x: number) => Math.sin((x * Math.PI) / 2);
        const expected = 10 * (ease(0.75) - ease(0.5)) / (ease(1) - ease(0.5));
        expect(seq.getValueAt(2)).toBeCloseTo(expected);
    });

    it("falls back to linear for unknown easing ids", () => {
        const seq = build([
            { startTime: [0, 0, 1], endTime: [4, 0, 1], easingType: 9999, start: 0, end: 1 },
        ]);
        expect(seq.getValueAt(1)).toBeCloseTo(0.25);
    });
});

describe("EffectNodeSequence", () => {
    it("creates an empty sequence with a filler head node", () => {
        const seq = EffectNodeSequence.newEffectSeq(30, 2);
        expect(seq.line).toBe(2);
        expect(seq.effectCount).toBe(0);
        expect([...seq.effects()]).toEqual([]);
        expect([...seq.activeAt(4)]).toEqual([]);
    });

    it("inserts non-overlapping effects and rejects overlaps", () => {
        const seq = EffectNodeSequence.newEffectSeq(30);
        seq.insertEffect(
            new EffectStartNode([2, 0, 1], "a"),
            [4, 0, 1]
        );
        seq.insertEffect(
            new EffectStartNode([4, 0, 1], "b", true),
            [6, 0, 1]
        );
        expect([...seq.effects()].map(n => n.value)).toEqual(["a", "b"]);
        expect([...seq.effects()].map(n => n.global)).toEqual([false, true]);
        expect([...seq.effects()].map(n => n.line)).toEqual([0, 0]);
        // 与a重叠
        expect(() => seq.insertEffect(new EffectStartNode([3, 0, 1], "c"), [5, 0, 1])).toThrow();
        // 与b重叠
        expect(() => seq.insertEffect(new EffectStartNode([5, 0, 1], "c"), [7, 0, 1])).toThrow();
        // 首尾相接合法
        seq.insertEffect(new EffectStartNode([6, 0, 1], "c"), [8, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["a", "b", "c"]);
    });

    it("inserts at beat 0 by replacing the filler", () => {
        const seq = EffectNodeSequence.newEffectSeq(30);
        seq.insertEffect(new EffectStartNode([0, 0, 1], "zero"), [2, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["zero"]);
        seq.insertEffect(new EffectStartNode([2, 0, 1], "next"), [4, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["zero", "next"]);
        // 区间查询
        expect([...seq.activeAt(0)].map(n => n.value)).toEqual(["zero"]);
        expect([...seq.activeAt(1)].map(n => n.value)).toEqual(["zero"]);
        expect([...seq.activeAt(2)].map(n => n.value)).toEqual(["next"]);
        expect([...seq.activeAt(4)].map(n => n.value)).toEqual([]);
    });

    it("reports active range inclusively/exclusively", () => {
        const seq = EffectNodeSequence.newEffectSeq(30);
        const node = new EffectStartNode([2, 0, 1], "a");
        seq.insertEffect(node, [4, 0, 1]);
        expect(node.isActiveAt(1)).toBe(false);
        expect(node.isActiveAt(2)).toBe(true);
        expect(node.isActiveAt(3)).toBe(true);
        expect(node.isActiveAt(4)).toBe(false);
    });

    it("removes an effect by blanking it in place", () => {
        const seq = EffectNodeSequence.newEffectSeq(30);
        const a = new EffectStartNode([2, 0, 1], "a");
        seq.insertEffect(a, [4, 0, 1]);
        const b = new EffectStartNode([4, 0, 1], "b");
        seq.insertEffect(b, [6, 0, 1]);
        seq.removeEffect(a);
        expect([...seq.effects()].map(n => n.value)).toEqual(["b"]);
        expect(a.isEmpty()).toBe(true);
        // 置空后原区间可再次插入
        seq.insertEffect(new EffectStartNode([3, 0, 1], "c"), [4, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["c", "b"]);
        expect(() => seq.removeEffect(new EffectStartNode([0, 0, 1], "x"))).toThrow();
    });

    it("changes effect times in place, keeping node identity", () => {
        const seq = EffectNodeSequence.newEffectSeq(30);
        const a = new EffectStartNode([2, 0, 1], "a");
        seq.insertEffect(a, [4, 0, 1]);
        const b = new EffectStartNode([6, 0, 1], "b");
        seq.insertEffect(b, [8, 0, 1]);

        // 后移起点：原区间让出的部分由填充节点补上
        seq.setEffectTime(a, [3, 0, 1], [4, 0, 1]);
        expect(a.time).toEqual([3, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["a", "b"]);

        // 延后终点：要求邻位是填充节点
        seq.setEffectTime(a, [3, 0, 1], [6, 0, 1]);
        expect((a.next as any).time).toEqual([6, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["a", "b"]);
        expect([...seq.activeAt(5)].map(n => n.value)).toEqual(["a"]);

        // 与b重叠时应抛错
        expect(() => seq.setEffectTime(a, [3, 0, 1], [7, 0, 1])).toThrow();

        // 提前终点：让出的部分补填充节点
        seq.setEffectTime(b, [6, 0, 1], [7, 0, 1]);
        expect([...seq.effects()].map(n => n.value)).toEqual(["a", "b"]);
        expect([...seq.activeAt(7.5)]).toEqual([]);

        // 前移起点：前位是真实特效时抛错
        expect(() => seq.setEffectTime(b, [5, 0, 1], [7, 0, 1])).toThrow();
    });

    it("evaluates uniform vars through their sequences", () => {
        const chart = makeChart();
        const node = chart.getActiveEffects(3)[0]!;
        expect(node.value).toBe("chromatic");
        expect(node.evalVar("sampleCount", 3)).toBe(5);
        expect(node.evalVar("power", 2) as number).toBeCloseTo(0.0);
        expect(node.evalVar("power", 4) as number).toBeCloseTo(0.1);
        const mid = node.evalVar("power", 3) as number;
        expect(mid).toBeGreaterThan(0.0);
        expect(mid).toBeLessThan(0.1);
        expect(node.evalVar("nonexistent", 3)).toBeUndefined();
        expect(node.evalVars(2)).toEqual({ power: 0, sampleCount: 5 });
    });

    it("supports vec uniforms", () => {
        const chart = makeChart({
            bpm: [],
            effects: [{
                start: [0, 0, 1],
                end: [4, 0, 1],
                shader: "s",
                vars: {
                    // 常量vec2
                    center2: [1, 2],
                    // 动画vec2
                    center: [{ startTime: [0, 0, 1], endTime: [4, 0, 1], easingType: 1, start: [0, 0], end: [2, 4] }],
                    // 常量vec4
                    color: [0.1, 0.2, 0.3, 0.4],
                },
            }],
            videos: [],
        });
        const node = chart.getActiveEffects(2)[0]!;
        expect(node.evalVar("center2", 2)).toEqual([1, 2]);
        expect(node.evalVar("center", 2)).toEqual([1, 2]);
        expect(node.evalVar("color", 2)).toEqual([0.1, 0.2, 0.3, 0.4]);
    });
});

describe("pack / unpack", () => {
    it("packs overlapping effects into separate lines", () => {
        const effects = PhiraEffectParser.parse([
            { start: [0, 0, 1], end: [2, 0, 1], shader: "a" },
            { start: [1, 0, 1], end: [3, 0, 1], shader: "b" },
            { start: [2, 0, 1], end: [4, 0, 1], shader: "c" },
            { start: [8, 0, 1], end: [9, 0, 1], shader: "d" },
        ]);
        const sequences = EffectNodeSequence.fromPhiraEffects(effects, 30);
        // a/b重叠需两条线，c可放进line0，d也可
        expect(sequences).toHaveLength(2);
        expect(sequences.map(s => s.line)).toEqual([0, 1]);
        expect([...sequences[0]!.effects()].map(n => n.value)).toEqual(["a", "c", "d"]);
        expect([...sequences[1]!.effects()].map(n => n.value)).toEqual(["b"]);
    });

    it("round-trips through unpack", () => {
        const chart = makeChart();
        const unpacked = EffectNodeSequence.toPhiraEffects(chart.effects);
        expect(unpacked).toHaveLength(1);
        expect(unpacked[0]!.shader).toBe("chromatic");
        expect(unpacked[0]!.vars!.sampleCount).toBe(5);
        expect(unpacked[0]!.vars!.power).toHaveLength(1);
    });

    it("node.toPhiraEffect dumps a detached copy", () => {
        const chart = makeChart();
        const node = chart.effects[0]!.effects().next().value!;
        const dumped = node.toPhiraEffect();
        dumped.start[0] = 99;
        dumped.vars!.sampleCount = 999;
        expect(node.time).toEqual([2, 0, 1]);
        expect(node.evalVar("sampleCount", 3)).toBe(5);
    });
});

describe("Chart integration", () => {
    it("loads effects from extra.json", () => {
        const chart = makeChart();
        expect(chart.effects).toHaveLength(1);
        expect(chart.effects[0]!.line).toBe(0);
        expect(chart.effects[0]!.effectCount).toBe(1);
        expect(chart.getActiveEffects(3).map(n => n.value)).toEqual(["chromatic"]);
        expect(chart.getActiveEffects(6)).toEqual([]);
    });

    it("compiles effects back to extra.json", () => {
        const chart = makeChart();
        const extra = new ExtraJsonCompiler(chart).compile();
        expect(extra.effects).toEqual([
            {
                start: [2, 0, 1],
                end: [4, 0, 1],
                shader: "chromatic",
                global: false,
                vars: {
                    power: [
                        {
                            start: 0.0,
                            end: 0.1,
                            startTime: [2, 0, 1],
                            endTime: [4, 0, 1],
                            easingType: 2,
                            easingLeft: 0,
                            easingRight: 1,
                        },
                    ],
                    sampleCount: 5,
                },
            },
        ]);
    });

    it("keeps effects on an empty chart", () => {
        const chart = makeChart({ bpm: [], effects: [], videos: [] });
        expect(chart.effects).toEqual([]);
        expect(new ExtraJsonCompiler(chart).compile().effects).toEqual([]);
    });

    it("scans custom effect shaders only", () => {
        const chart = makeChart({
            bpm: [],
            effects: [
                { start: [0, 0, 1], end: [2, 0, 1], shader: "chromatic" },
                { start: [0, 0, 1], end: [2, 0, 1], shader: "/custom/factor.frag" },
                { start: [2, 0, 1], end: [4, 0, 1], shader: "/custom/factor.frag" },
                { start: [1, 0, 1], end: [3, 0, 1], shader: "/another.frag" },
            ],
            videos: [],
        });
        // 内置着色器（不以 / 开头）不参与扫描，重复路径只保留一份
        expect([...chart.scanAllShaders()].sort()).toEqual(["/another.frag", "/custom/factor.frag"]);
        expect(makeChart({ bpm: [], effects: [], videos: [] }).scanAllShaders().size).toBe(0);
    });

    it("round-trips through KPA2", () => {
        const chart = makeChart();
        const dumped = chart.dumpKPA();
        expect(dumped.effects).toHaveLength(1);
        expect(dumped.effects[0]!.line).toBe(0);
        expect(dumped.effects[0]!.events).toHaveLength(1);
        const reloaded = Chart.fromKPAJSON(dumped as unknown as ChartDataKPA2);
        expect(reloaded.effects).toHaveLength(1);
        expect(reloaded.effects[0]!.effectCount).toBe(1);
        expect(reloaded.getActiveEffects(3).map(n => n.value)).toEqual(["chromatic"]);
        expect(reloaded.getActiveEffects(3)[0]!.evalVar("sampleCount", 3)).toBe(5);
        expect(reloaded.getActiveEffects(3)[0]!.evalVar("power", 3) as number)
            .toBeCloseTo(chart.getActiveEffects(3)[0]!.evalVar("power", 3) as number);
    });

    it("renumbers lines after removing a sequence", () => {
        const chart = makeChart({
            bpm: [],
            effects: [
                { start: [0, 0, 1], end: [2, 0, 1], shader: "a" },
                { start: [1, 0, 1], end: [3, 0, 1], shader: "b" },
            ],
            videos: [],
        });
        expect(chart.effects).toHaveLength(2);
        expect(chart.removeEffectSequence(chart.effects[0]!)).toBe(0);
        expect(chart.effects).toHaveLength(1);
        expect(chart.effects[0]!.line).toBe(0);
        expect([...chart.effects[0]!.effects()].map(n => n.value)).toEqual(["b"]);
        expect(chart.dumpKPA().effects[0]!.line).toBe(0);
    });
});

describe("effect operations", () => {
    it("adds and removes with undo/redo", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        ops.do(new Op.EffectAddOperation(chart, {
            start: [6, 0, 1],
            end: [8, 0, 1],
            shader: "bloom",
        }));
        expect(chart.effects).toHaveLength(1);
        expect(chart.effects[0]!.effectCount).toBe(2);
        expect(chart.getActiveEffects(7).map(n => n.value)).toEqual(["bloom"]);
        ops.undo();
        expect(chart.effects[0]!.effectCount).toBe(1);
        expect(chart.getActiveEffects(7)).toEqual([]);
        ops.redo();
        expect(chart.getActiveEffects(7).map(n => n.value)).toEqual(["bloom"]);
    });

    it("opens a new line when nothing fits", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        // 与chromatic([2,4])重叠，应新开一条线
        ops.do(new Op.EffectAddOperation(chart, {
            start: [3, 0, 1],
            end: [5, 0, 1],
            shader: "overlap",
        }));
        expect(chart.effects).toHaveLength(2);
        expect(chart.effects[1]!.line).toBe(1);
        expect(chart.getActiveEffects(3).map(n => n.value)).toEqual(["chromatic", "overlap"]);
        ops.undo();
        expect(chart.effects).toHaveLength(1);
        ops.redo();
        expect(chart.effects).toHaveLength(2);
    });

    it("rejects invalid effects", () => {
        const chart = makeChart();
        expect(() => new Op.EffectAddOperation(chart, { start: [2, 0, 1], end: [1, 0, 1], shader: "x" })).toThrow();
        expect(() => new Op.EffectAddOperation(chart, { start: [2, 0, 1], end: [3, 0, 1], shader: "" })).toThrow();
        expect(() => new Op.EffectAddOperation(chart, { start: "nope", end: [3, 0, 1], shader: "x" } as any)).toThrow();
        // 指定的line不存在，do时抛错
        const bad = new Op.EffectAddOperation(chart, { start: [8, 0, 1], end: [9, 0, 1], shader: "x" }, 5);
        expect(() => bad.do(chart)).toThrow();
    });

    it("changes props with validation", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectPropChangeOperation(chart, node, "global", true));
        expect(node.global).toBe(true);
        ops.undo();
        expect(node.global).toBe(false);

        ops.do(new Op.EffectPropChangeOperation(chart, node, "shader", "chromatic2"));
        expect(node.value).toBe("chromatic2");
        ops.undo();
        expect(node.value).toBe("chromatic");

        expect(() => new Op.EffectPropChangeOperation(chart, node, "shader", "")).toThrow();
        expect(() => new Op.EffectPropChangeOperation(chart, node, "global", 1 as any)).toThrow();
    });

    it("moves an effect keeping its duration", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectMoveOperation(chart, node, [1, 0, 1]));
        const moved = chart.effects[0]!.effects().next().value!;
        expect(moved.time).toEqual([3, 0, 1]);
        expect((moved.next as any).time).toEqual([5, 0, 1]);
        expect(chart.getActiveEffects(4).map(n => n.value)).toEqual(["chromatic"]);
        ops.undo();
        const restored = chart.effects[0]!.effects().next().value!;
        expect(restored.time).toEqual([2, 0, 1]);
        expect((restored.next as any).time).toEqual([4, 0, 1]);
        // 移动到负数应抛错
        expect(() => new Op.EffectMoveOperation(chart, restored, [-3, 0, 1])).toThrow();
    });

    it("changes effect times", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectTimeChangeOperation(chart, node, [1, 0, 1], [5, 0, 1]));
        const changed = chart.effects[0]!.effects().next().value!;
        expect(changed.time).toEqual([1, 0, 1]);
        expect((changed.next as any).time).toEqual([5, 0, 1]);
        // 变量序列随之重建，仍在新区间内有定义
        expect(changed.evalVar("sampleCount", 1)).toBe(5);
        ops.undo();
        const restored = chart.effects[0]!.effects().next().value!;
        expect(restored.time).toEqual([2, 0, 1]);
        expect(restored.evalVar("sampleCount", 3)).toBe(5);
        expect(() => new Op.EffectTimeChangeOperation(chart, restored, [3, 0, 1], [3, 0, 1])).toThrow();
    });

    it("changes and removes vars", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectVarChangeOperation(chart, node, "sampleCount", 9));
        expect(node.evalVar("sampleCount", 3)).toBe(9);
        ops.undo();
        expect(node.evalVar("sampleCount", 3)).toBe(5);

        // 新变量
        ops.do(new Op.EffectVarChangeOperation(chart, node, "radius", 0.5));
        expect(node.evalVar("radius", 3)).toBe(0.5);
        ops.undo();
        expect(node.evalVar("radius", 3)).toBeUndefined();

        // 越界关键帧被裁剪进区间
        ops.do(new Op.EffectVarChangeOperation(chart, node, "power", [
            { startTime: [0, 0, 1], endTime: [9, 0, 1], easingType: 1, start: 0, end: 1 },
        ]));
        expect(node.evalVar("power", 2) as number).toBeCloseTo(0);
        expect(node.evalVar("power", 4) as number).toBeCloseTo(1);
        ops.undo();
        expect(node.evalVar("power", 4) as number).toBeCloseTo(0.1);

        // 无效值抛错
        expect(() => new Op.EffectVarChangeOperation(chart, node, "bad", "nope" as any)).toThrow();

        // 删除变量
        ops.do(new Op.EffectVarRemoveOperation(chart, node, "sampleCount"));
        expect(node.evalVar("sampleCount", 3)).toBeUndefined();
        ops.undo();
        expect(node.evalVar("sampleCount", 3)).toBe(5);
        expect(new Op.EffectVarRemoveOperation(chart, node, "nope").ineffective).toBe(true);
    });

    it("removes an effect node", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectRemoveOperation(chart, node));
        expect(chart.effects[0]!.effectCount).toBe(0);
        expect(chart.getActiveEffects(3)).toEqual([]);
        ops.undo();
        expect(chart.effects[0]!.effectCount).toBe(1);
        expect(chart.getActiveEffects(3).map(n => n.value)).toEqual(["chromatic"]);
        expect(new Op.EffectRemoveOperation(chart, node).ineffective).toBeFalsy();
    });

    it("rewrites consecutive operations of the same kind", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.effects[0]!.effects().next().value!;
        ops.do(new Op.EffectVarChangeOperation(chart, node, "sampleCount", 7));
        ops.do(new Op.EffectVarChangeOperation(chart, node, "sampleCount", 8));
        expect(node.evalVar("sampleCount", 3)).toBe(8);
        expect(ops.operations).toHaveLength(1);
        ops.undo();
        expect(node.evalVar("sampleCount", 3)).toBe(5);
    });
});
