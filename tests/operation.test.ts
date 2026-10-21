import { it, expect, describe } from "bun:test";

import {
    Chart,
    Op,
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
        name: "op test",
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

const extraJson: PhiraExtraJson = {
    bpm: [{ time: [0, 0, 1], bpm: 120 }],
    effects: [{ start: [0, 0, 1], end: [4, 0, 1], shader: "chromatic" }],
    videos: [],
};

const makeChart = () => Chart.fromRPEJSON(rpeChart, 30, extraJson);

describe("OperationList.onOperation", () => {
    it("直接执行与撤销都会通知", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];

        ops.onOperation(Op.ChartPropChangeOperation, (op, direction) => {
            seen.push(`${direction}:${String(op.value)}`);
        });

        ops.do(new Op.ChartPropChangeOperation(chart, "name", "renamed"));
        expect(chart.name).toBe("renamed");
        ops.undo();
        expect(chart.name).toBe("op test");
        ops.redo();
        expect(chart.name).toBe("renamed");

        expect(seen).toEqual(["do:renamed", "undo:renamed", "do:renamed"]);
    });

    it("嵌套的子操作也会通知", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];

        ops.onOperation(Op.ChartPropChangeOperation, (op, direction) => {
            seen.push(`${direction}:${String(op.value)}`);
        });

        ops.do(new Op.ComplexOperation(
            new Op.ChartPropChangeOperation(chart, "name", "a"),
            new Op.ChartPropChangeOperation(chart, "name", "b"),
        ));

        expect(seen).toEqual(["do:a", "do:b"]);
    });

    it("被 UnionOperation / LazyOperation 包装的也会通知", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];

        ops.onOperation(Op.ChartPropChangeOperation, (op, direction) => {
            seen.push(`${direction}:${String(op.value)}`);
        });

        ops.do(new Op.UnionOperation(() => new Op.ChartPropChangeOperation(chart, "name", "union")));
        ops.do(new Op.LazyOperation(Op.ChartPropChangeOperation, chart, "name", "lazy"));

        expect(seen).toEqual(["do:union", "do:lazy"]);
    });

    it("子类也会命中", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];

        ops.onOperation(Op.Operation, (op) => seen.push(op.constructor.name));
        ops.do(new Op.ChartPropChangeOperation(chart, "name", "x"));

        expect(seen).toEqual(["ChartPropChangeOperation"]);
    });

    it("被 rewrite 合并掉的变更也按 do 通知一次", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const node = chart.getActiveEffects(1)[0]!;
        const seen: string[] = [];

        ops.onOperation(Op.EffectPropChangeOperation, (op, direction) => {
            seen.push(`${direction}:${String(op.value)}`);
        });

        ops.do(new Op.EffectPropChangeOperation(chart, node, "shader", "/a.frag"));
        ops.do(new Op.EffectPropChangeOperation(chart, node, "shader", "/b.frag"));

        // 第二条被合并进上一条，但变更确实生效了
        expect(ops.operations).toHaveLength(1);
        expect(node.value).toBe("/b.frag");
        expect(seen).toEqual(["do:/a.frag", "do:/b.frag"]);
    });

    it("自定义容器只要重写 find 就能被穿透", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];

        class MyContainer extends Op.Operation {
            constructor(public inner: Op.Operation) {
                super();
            }
            override find(predicate: (operation: Op.Operation) => boolean): Op.Operation | null {
                return super.find(predicate) ?? this.inner.find(predicate);
            }
            do(c: any) { this.inner.do(c); }
            undo(c: any) { this.inner.undo(c); }
        }

        ops.onOperation(Op.ChartPropChangeOperation, (op) => seen.push(String(op.value)));
        const inner = new Op.ChartPropChangeOperation(chart, "name", "deep");
        ops.do(new MyContainer(inner));

        expect(seen).toEqual(["deep"]);
        expect(new MyContainer(inner).find(op => op === inner)).toBe(inner);
        expect(new Op.ChartPropChangeOperation(chart, "name", "x").find(op => op === inner)).toBeNull();
    });

    it("maxCombo 由库自己维护，事件里是带符号的增量", () => {
        const chart = makeChart();
        chart.maxCombo = 0;
        const ops = new Op.OperationList(chart);
        const deltas: number[] = [];
        ops.addEventListener("maxcombochanged", (e) => deltas.push(e.comboDelta));

        const makeOp = (delta: number) => {
            const op = new (class extends Op.Operation {
                do() { }
                undo() { }
            })();
            op.comboDelta = delta;
            return op;
        };

        ops.do(makeOp(1));
        expect(chart.maxCombo).toBe(1);
        ops.undo();
        expect(chart.maxCombo).toBe(0);
        ops.redo();
        expect(chart.maxCombo).toBe(1);
        expect(deltas).toEqual([1, -1, 1]);
    });

    it("comboDelta 为 NaN 时全谱重数", () => {
        const chart = makeChart();
        chart.maxCombo = 999;
        const ops = new Op.OperationList(chart);
        const op = new (class extends Op.Operation {
            do() { }
            undo() { }
        })();
        op.comboDelta = NaN;

        ops.do(op);
        expect(chart.maxCombo).toBe(0);   // 空谱面
    });

    it("offOperation 之后不再通知", () => {
        const chart = makeChart();
        const ops = new Op.OperationList(chart);
        const seen: string[] = [];
        const listener = (op: Op.ChartPropChangeOperation<"name">) => {
            seen.push(String(op.value));
        };

        ops.onOperation(Op.ChartPropChangeOperation, listener);
        ops.do(new Op.ChartPropChangeOperation(chart, "name", "first"));
        ops.offOperation(Op.ChartPropChangeOperation, listener);
        ops.do(new Op.ChartPropChangeOperation(chart, "name", "second"));

        expect(seen).toEqual(["first"]);
    });
});
