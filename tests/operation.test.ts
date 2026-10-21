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
