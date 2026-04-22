import "bun";
import { it, expect } from "bun:test";
import { BezierEasing, Chart, ChartDataKPA2, Easing, easingFns, EasingType, EventEndNode, EventNode, EventNodeSequence, EventStartNode, EventType, InterpreteAs, linearEasing, NonLastStartNode, NormalEasing, Note, NoteType, RPEChartCompiler, SegmentedEasing, SegmentedEasingData, TextEasedEvaluator, TimeCalculator } from "../src"

const chartData = {
    "version":212,
    "$schema":"https://cdn.jsdelivr.net/npm/kipphi@2.1.0/chartType2.schema.json",
    "duration":143.9,
    "bpmList":[{"bpm":120,"startTime":[0,0,1]},{"bpm":60,"startTime":[3,0,1]}],
    "templateEasings":[],"wrapperEasings":[],"macroEvaluators":[],"timeMacros":[],"valueMacros":[],
    "eventNodeSequences":[
        {"type":0,"events":[
            {"start":0,"end":0,"startTime":[0,0,1],"endTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]},
            {"start":405,"end":0,"startTime":[1,0,1],"endTime":[2,0,4],"evaluator":{"type":0,"easing":{"type":EasingType.segmented,"left":0.2,"right": 1.0,"inner":{type: 0, "identifier":24}} satisfies SegmentedEasingData},"startLinkedMacro":[],"endLinkedMacro":[]},
            {"start":0,"end":405,"startTime":[2,0,4],"endTime":[4,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]}],"id":"#0.0.moveX","final":{"start":405,"startTime":[4,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":1,"events":[{"start":0,"end":0,"startTime":[0,0,1],"endTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]}],"id":"#0.0.moveY","final":{"start":0,"startTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":2,"events":[{"start":0,"end":0,"startTime":[0,0,1],"endTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]}],"id":"#0.0.rotate","final":{"start":0,"startTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":3,"events":[{"start":0,"end":0,"startTime":[0,0,1],"endTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]}],"id":"#0.0.alpha","final":{"start":0,"startTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":7,"events":[],"id":"#0.ex.scaleX","final":{"start":1,"startTime":[0,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":8,"events":[],"id":"#0.ex.scaleY","final":{"start":1,"startTime":[0,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}},
        {"type":4,"events":[{"start":10,"end":10,"startTime":[0,0,1],"endTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"startLinkedMacro":[],"endLinkedMacro":[]}],"id":"#0.speed","final":{"start":10,"startTime":[1,0,1],"evaluator":{"type":0,"easing":{"type":0,"identifier":1}},"linkedMacro":[]}}],"info":{"level":"0","name":"ccb","charter":"","illustrator":"","composer":""},"ui":{},"offset":0,
    "orphanLines":[{"group":0,"id":0,"name":"untitled","texture":"line.png","anchor":[0.5,0.5],"rotatesWithFather":false,"children":[],"eventLayers":[{"moveX":"#0.0.moveX","moveY":"#0.0.moveY","rotate":"#0.0.rotate","alpha":"#0.0.alpha"}],"speedEventNodeSeq":"#0.speed","hnLists":{},"nnLists":{"#1o0":{"speed":1,"medianYOffset":0,"noteNodes":[{"notes":[{"above":1,"alpha":255,"endTime":[0,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[0,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[0,0,1]},{"notes":[{"above":1,"alpha":255,"endTime":[1,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[1,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[1,0,1]},{"notes":[{"above":1,"alpha":255,"endTime":[2,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[2,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[2,0,1]},{"notes":[{"above":1,"alpha":255,"endTime":[3,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[3,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[3,0,1]},{"notes":[{"above":1,"alpha":255,"endTime":[4,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[4,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[4,0,1]},{"notes":[{"above":1,"alpha":255,"endTime":[5,0,1],"isFake":0,"positionX":0,"size":1,"startTime":[5,0,1],"type":1,"yOffset":0,"absoluteYOffset":0,"speed":1}],"startTime":[5,0,1]}]}},"cover":true,"extended":{"scaleXEvents":"#0.ex.scaleX","scaleYEvents":"#0.ex.scaleY"}}],"judgeLineGroups":["Default"],"chartTime":240,"rpeChartTime":0}

const chart = Chart.fromKPAJSON(chartData as any);

const chartDataRpe = new RPEChartCompiler(chart).compileChart();
const chartRpe = Chart.fromRPEJSON(chartDataRpe, chartData.duration);

it("supports bezier easing", () => {
    expect(new BezierEasing([0, 0], [1, 1]).getValue(0.5)).toBeCloseTo(0.5);
    expect(new BezierEasing([1.0, 0.0], [0.0, 1.0]).getValue(0.25)).toBeCloseTo(0.029);
});
it("supports SegmentedEasing (this test also tests chart compilation)", () => {
    const expected = (easingFns.easeOutElastic(0.6) - easingFns.easeOutElastic(0.2)) / (1 - easingFns.easeOutElastic(0.2));
    const easing: SegmentedEasing = chart.orphanLines[0].eventLayers[0].moveX!.getNodeAt(1.5).evaluator.easing;
    const seqFromRpe = chartRpe.orphanLines[0].eventLayers[0].moveX!
    console.log(easing, expected)
    expect(easing).toBeInstanceOf(SegmentedEasing);
    expect(easing.easing.rpeId).toBe(24);
    expect(chart.orphanLines[0].eventLayers[0].moveX!.getValueAt(1.5)).toBeCloseTo(405 - 405 * expected);
    expect(seqFromRpe.getNodeAt(1.5).evaluator.easing.easing).toBeInstanceOf(NormalEasing);
    console.log(seqFromRpe.getNodeAt(1.5).evaluator)
    expect(seqFromRpe.getValueAt(1.5)).toBeCloseTo(405 - 405 * expected)
});
it("supports text events", () => {
    const ev = new TextEasedEvaluator(linearEasing, InterpreteAs.str);
    const node = new EventStartNode([0, 0, 1], "" as string) as NonLastStartNode<string>;
    const endNode = new EventEndNode([1, 0, 1], "A" as string);
    node.next = endNode;
    expect(ev.eval(node, 0.52)).toBe(""); // 始终floor
    
    endNode.value = "ABC";
    expect(ev.eval(node, 0.52)).toBe("A");
    expect(ev.eval(node, 0.67)).toBe("AB");
    endNode.value = "10";
    node.value = "0";
    const evaluator2 = new TextEasedEvaluator(linearEasing, InterpreteAs.int);
    expect(evaluator2.eval(node, 0.52)).toBe("5");
    expect(evaluator2.eval(node, 0.67)).toBe("6"); // floor
    const evaluator3 = new TextEasedEvaluator(linearEasing, InterpreteAs.float);
    expect(evaluator3.eval(node, 0.52)).toBe("5.2");
    expect(evaluator3.eval(node, 0.67)).toBe("6.7");
});

it("supports getting value by seconds or beats", () => {
    const moveX = chart.orphanLines[0].eventLayers[0].moveX!;
    expect(moveX.getValueAt(3)).toBeCloseTo(202.5);
    expect(moveX.getValueAtBySecs( // 由于下游通常能提供两种时间，因此转换责任在下游不在kipphi
        3, // 这个只用来找时间，真正计算用的秒数
        chart.timeCalculator.toSeconds(3),
        chart.timeCalculator)).toBeCloseTo(135);
});

it("should not consider visible time 0 as Infinity", () => {
    const timeCalculator = new TimeCalculator();
    timeCalculator.bpmList = [
        { startTime: [0, 0, 1], bpm: 120 },
        { startTime: [1, 0, 1], bpm: 120 },
    ]
    timeCalculator.duration = 114;
    timeCalculator.initSequence();
    const note = new Note({
        startTime: [0, 0, 1],
        visibleTime: 0,
        type: NoteType.tap,
        above: 1,
        alpha: 255,
        endTime: [0, 0, 1],
        positionX: 0,
        isFake: 0,
        size: 1.0,
        speed: 1.0,
        yOffset: 0.0
    })
    note.computeVisibleBeats(timeCalculator); // 在一个过去的版本，由于 0 被视为假值，visibleBeats 会 fallback 到 Infinity
    expect(note.visibleBeats).toBe(0);
});

it("should process RPE yOffset to KPA defined absoluteYOffset", () => {
    const note = new Note({
        startTime: [0, 0, 1],
        visibleTime: 0,
        type: NoteType.tap,
        above: 1,
        alpha: 255,
        endTime: [0, 0, 1],
        positionX: 0,
        isFake: 0,
        size: 1.0,


        speed: 1.2,
        yOffset: 100.0,
    });
    expect(note.yOffset).toBe(120.0);
    expect(note.dumpKPA().absoluteYOffset).toBe(120.0);
});



