
import { VERSION } from "./version";

import {
    TimeCalculator,
    BPMSequence
} from "./time";

import {
    BezierEasing,
    Easing,
    rpeEasingArray,
    SegmentedEasing,
    TemplateEasingLib,
} from "./easing";

import {
    EventNodeSequence,
    type AnyEN,
    type ENOrHead,
    type ENOrTail,
    EventNodeLike,
    EventStartNode,
    EventEndNode,
    EventNode,
} from "./event";

import {
    NodeType
} from "./util"

import {
    JudgeLine
} from "./judgeline";

import {
    Note,
    NNList,
    NNNList,
    type NNNOrHead,
    type NNNOrTail,
    NNNode
} from "./note";

import {
    type RGB,
    type TimeT,
    type EventType,
    type EventNodeSequenceDataKPA,
    type ValueTypeOfEventType,
    type BPMSegmentData,
    type ChartDataRPE,
    type ChartDataKPA,
    type JudgeLineDataRPE,
    type EasingDataKPA2,
    EasingType,
    type EvaluatorDataKPA2,
    EvaluatorType,
    type EasedEvaluatorDataOfType,
    EventValueType,
    type EventValueTypeOfType,
    type EventValueESType,
    type ExpressionEvaluatorDataKPA2,
    type TextEasedEvaluatorKPA2,
    type EventNodeSequenceDataKPA2,
    type ChartDataKPA2,
    type EventDataKPA2
} from "./chartTypes";
import { ProgramUpdateLevel } from "typescript";
import { ColorEasedEvaluator, Evaluator, ExpressionEvaluator, NumericEasedEvaluator, TextEasedEvaluator, type EasedEvaluatorOfType } from "./evaluator";



export type BasicEventName = "moveX" | "moveY" | "rotate" | "alpha" | "speed";






type Plain<T> = {[k: string]: T}


/**
 * 相当于 Python 推导式
 * @param obj
 * @param expr 
 * @param guard 
 * @returns 
 */
 function dictForIn<T, RT>(obj: Plain<T>, expr: (v: T) => RT, guard?: (v: T) => boolean): Plain<RT> {
    let ret: Plain<RT> = {}
    for (let key in obj) {
        const each = obj[key]
        if (!guard || guard && guard(each)) {
            ret[key] = expr(each)
        }
    }
    return ret;
}


export type UIName = "combo"  | "combonumber" | "score" | "pause" | "bar" | "name" | "level"

export class Chart {
    judgeLines: JudgeLine[] = [];
    bpmList: BPMSegmentData[] = [];
    timeCalculator = new TimeCalculator();
    orphanLines: JudgeLine[] = [];
    // comboMapping: ComboMapping;
    name: string = "unknown";
    level: string = "unknown";
    composer: string = "unknown";
    charter: string = "unknown";
    illustrator: string = "unknown";
    offset: number = 0;
    
    templateEasingLib = new TemplateEasingLib;
    sequenceMap = new Map<string, EventNodeSequence<any>>();

    effectiveBeats: number;
    nnnList: NNNList;
    /**  */
    judgeLineGroups: JudgeLineGroup[] = [];
    duration: number;

    // 以分钟计
    chartingTime: number;
    rpeChartingTime: number;

    
    modified: boolean = false;
    maxCombo: number = 0;


    pauseAttach:       JudgeLine | null = null;
    combonumberAttach: JudgeLine | null = null;
    comboAttach:       JudgeLine | null = null;
    barAttach:         JudgeLine | null = null;
    scoreAttach:       JudgeLine | null = null;
    nameAttach:        JudgeLine | null = null;
    levelAttach:       JudgeLine | null = null;

    constructor() {}
    getEffectiveBeats() {
        const effectiveBeats = this.timeCalculator.secondsToBeats(this.duration)
        console.log(effectiveBeats)
        this.effectiveBeats = effectiveBeats
        return this.effectiveBeats
    }
    static fromRPEJSON(data: ChartDataRPE, duration: number) {
        const chart = new Chart();
        chart.judgeLineGroups = data.judgeLineGroup.map(group => new JudgeLineGroup(group));
        chart.bpmList = data.BPMList;
        chart.name = data.META.name;
        chart.level = data.META.level;
        chart.offset = data.META.offset;
        chart.composer = data.META.composer ?? "unknown";
        chart.charter = data.META.charter ?? "unknown";
        chart.illustrator = data.META.illustration ?? "unknown";
        chart.duration = duration;
        chart.chartingTime = data.kpaChartTime
        chart.rpeChartingTime = data.chartTime ? Math.round(data.chartTime / 60) : 0;
        chart.chartingTime = 0;
        chart.updateCalculator()
        console.log(chart, chart.getEffectiveBeats())
        chart.nnnList = new NNNList(chart.getEffectiveBeats())
        
        /*
        if (data.envEasings) {
            chart.templateEasingLib.add(...data.envEasings)

        }
        */
        
        // let line = data.judgeLineList[0];
        const judgeLineDataList: JudgeLineDataRPE[] = <JudgeLineDataRPE[]>data.judgeLineList;
        const judgeLineList: JudgeLine[] = judgeLineDataList.map(
            (lineData, id) =>
                JudgeLine.fromRPEJSON(chart, id, lineData, chart.templateEasingLib, chart.timeCalculator)
        );
        const length = judgeLineList.length;
        chart.judgeLines = judgeLineList;
        for (let i = 0; i < length; i++) {
            const data = judgeLineDataList[i];
            const line = judgeLineList[i];
            const father = data.father === -1 ? null : judgeLineList[data.father];
            if (father) {
                father.children.add(line);
            } else {
                chart.orphanLines.push(line);
            }
        }
        chart.countMaxCombo();
        return chart
    }

    static fromKPAJSON(data: ChartDataKPA | ChartDataKPA2) {
        const chart = new Chart();
        
        chart.bpmList = data.bpmList;
        chart.duration = data.duration;
        chart.name = data.info.name;
        chart.level = data.info.level;
        chart.illustrator = data.info.illustrator ?? "unknown";
        chart.composer = data.info.composer ?? "unknown";
        chart.charter = data.info.charter ?? "unknown";
        chart.offset = data.offset;
        chart.judgeLineGroups = data.judgeLineGroups.map(group => new JudgeLineGroup(group));
        chart.chartingTime = data.chartTime ?? 0;
        chart.rpeChartingTime = data.rpeChartTime ?? 0;
        chart.updateCalculator()
        chart.nnnList = new NNNList(chart.getEffectiveBeats())
        const envEasings = data.envEasings;
        const len = envEasings.length
        for (let i = 0; i < len; i++) {
            const easingData = envEasings[i];
            chart.templateEasingLib.require(easingData.name);
        }

        if (data.version >= 200) {
            const sequences = (data as ChartDataKPA2).eventNodeSequences;
            const length = sequences.length;
            for (let i = 0; i < length; i++) {
                const seqData = sequences[i];
                const sequence = EventNodeSequence.fromRPEJSON<typeof seqData.type, ValueTypeOfEventType<typeof seqData.type>>(seqData.type, seqData.events, chart, seqData.endValue);
                sequence.id = seqData.id;
                chart.sequenceMap.set(sequence.id, sequence);
            }
        } else {
            
            const sequences = (data as ChartDataKPA).eventNodeSequences
            const length = sequences.length
            for (let i = 0; i < length; i++) {
                const seqData = sequences[i];
                const sequence = EventNodeSequence.fromRPEJSON<typeof seqData.type, ValueTypeOfEventType<typeof seqData.type>>(seqData.type, seqData.events, chart, seqData.endValue);
                sequence.id = seqData.id;
                chart.sequenceMap.set(sequence.id, sequence);
            }
        }

        for (let i = 0; i < len; i++) {
            const easingData = envEasings[i];
            chart.templateEasingLib.implement(easingData.name, chart.sequenceMap.get(easingData.content));
        }
        chart.templateEasingLib.check()
        const isOld = !data.version || data.version < 150
        for (let lineData of data.orphanLines) {
            const line: JudgeLine = JudgeLine.fromKPAJSON(isOld, chart, lineData.id, lineData, chart.templateEasingLib, chart.timeCalculator)
            chart.orphanLines.push(line)
        }
        chart.judgeLines.sort((a, b) => a.id - b.id);
        chart.countMaxCombo();
        
        const ui = data.ui;
        if (ui) for (const uiname of ["combo", "combonumber", "score", "pause", "bar", "name", "level"] satisfies UIName[]) {
            if (typeof ui[uiname] === "number") { // 踩坑，线号可为0
                const line = chart.judgeLines[ui[uiname]]
                if (!line) {
                    continue;
                }
                chart.attachUIToLine(uiname, line);
            }
        }
        return chart;
    }
    updateCalculator() {
        this.timeCalculator.bpmList = this.bpmList;
        this.timeCalculator.duration = this.duration;
        this.timeCalculator.update()
    }
    updateEffectiveBeats(duration: number) {
        const EB = this.timeCalculator.secondsToBeats(duration);
        for (let i = 0; i < this.judgeLines.length; i++) {
            const judgeLine = this.judgeLines[i]
            judgeLine.updateEffectiveBeats(EB);
        }
    }
    dumpKPA(): Required<ChartDataKPA2> {
        const eventNodeSequenceCollector = new Set<EventNodeSequence>();
        const orphanLines = [];
        for (let line of this.orphanLines) {
            orphanLines.push(line.dumpKPA(eventNodeSequenceCollector, this.judgeLineGroups));
        }
        const envEasings = this.templateEasingLib.dump(eventNodeSequenceCollector);
        const eventNodeSequenceData: EventNodeSequenceDataKPA2<any>[] = [];
        for (let sequence of eventNodeSequenceCollector) {
            eventNodeSequenceData.push(sequence.dump());
        }
        return {
            version: VERSION,
            duration: this.duration,
            bpmList: this.timeCalculator.dump(),
            envEasings: envEasings,
            eventNodeSequences: eventNodeSequenceData,
            info: {
                level: this.level,
                name: this.name,
                charter: this.charter,
                illustrator: this.illustrator,
                composer: this.composer
            },
            ui: {
                combo: this.comboAttach?.id,
                combonumber: this.combonumberAttach?.id,
                score: this.scoreAttach?.id,
                pause: this.pauseAttach?.id,
                bar: this.barAttach?.id,
                name: this.nameAttach?.id,
                level: this.levelAttach?.id
            },
            offset: this.offset,
            orphanLines: orphanLines,
            judgeLineGroups: this.judgeLineGroups.map(g => g.name),
            chartTime: this.chartingTime,
            rpeChartTime: this.rpeChartingTime
        };
    }
    createNNNode(time: TimeT) {
     return new NNNode(time)
    }
    createEventNodeSequence<T extends EventType>(type: T, name: string) {
        if (this.sequenceMap.has(name)) {
            throw new Error(`The name ${name} is occupied.`)
        }
        const seq = EventNodeSequence.newSeq(type, this.getEffectiveBeats());
        seq.id = name;
        this.sequenceMap.set(name, seq);
        return seq;
    }
    countMaxCombo() {
        let combo = 0;
        const nnnlist = this.nnnList;
        for (let node: NNNOrTail = nnnlist.head.next; node.type !== NodeType.TAIL; node = node.next) {
            const nns = node.noteNodes;
            const nnsLength = nns.length;
            for (let i = 0; i < nnsLength; i++) {
                const nn = nns[i];
                combo += nn.notes.reduce((prev, note) => prev + (note.isFake ? 0 : 1), 0);
            }
            const hns = node.holdNodes;
            const hnsLength = hns.length;
            for (let i = 0; i < hnsLength; i++) {
                const hn = hns[i];
                combo += hn.notes.reduce((prev, hold) => prev + (hold.isFake ? 0 : 1), 0);
            }
        }
        this.maxCombo = combo;
    }
    attachUIToLine(ui: UIName, judgeLine: JudgeLine) {
        const key = `${ui}Attach` satisfies keyof Chart;
        if (this[key]) {
            throw new Error(`UI ${ui} is occupied`);
        }
        this[key] = judgeLine;
        judgeLine.hasAttachUI = true;
    }
    detachUI(ui: UIName) {
        const key = `${ui}Attach` satisfies keyof Chart;
        const judgeLine = this[key];
        if (!judgeLine) {
            return;
        }
        this[key] = null;
        if (![ // 看着好丑
            this.barAttach,
            this.nameAttach,
            this.comboAttach,
            this.scoreAttach,
            this.combonumberAttach,
            this.levelAttach,
            this.pauseAttach
        ].includes(judgeLine)) {
                judgeLine.hasAttachUI = false;
            }
    }
    queryJudgeLineUI(judgeLine: JudgeLine): UIName[] {
        const arr: UIName[] = [];
        for (const ui of ["combo", "combonumber", "score", "pause", "bar", "name", "level"] satisfies UIName[]) {
            if (this[`${ui}Attach` satisfies keyof Chart] === judgeLine) {
                arr.push(ui);
            }
        }
        return arr;
    }
    scanAllTextures() {
        const textures: Set<string> = new Set;
        for (const line of this.judgeLines) {
            textures.add(line.texture);
        }
        return textures
    }
    createEasingFromData(data: EasingDataKPA2) {
        switch (data.type) {
            case EasingType.bezier:
                return new BezierEasing([data.bezier[0], data.bezier[1]], [data.bezier[2], data.bezier[3]]);
            case EasingType.normal:
                return rpeEasingArray[data.identifier];
            case EasingType.segmented:
                return new SegmentedEasing(this.createEasingFromData(data), data.left, data.right);
            case EasingType.template:
                return this.templateEasingLib.get(data.identifier);
        }
    }
    createEvaluator<T extends EventValueESType>(data: EvaluatorDataKPA2<T>, type: EventValueTypeOfType<T>): Evaluator<T> {
        switch (data.type) {
            case EvaluatorType.eased:
                return this.createEasedEvaluator(data, type);
            case EvaluatorType.expressionbased:
                return this.createExpressionEvaluator(data) as ExpressionEvaluator<T>;
        }
    }
    createEasedEvaluator<T extends EventValueESType>(data: EasedEvaluatorDataOfType<T>, type: EventValueTypeOfType<T>): EasedEvaluatorOfType<T> {
        switch (type) {
            case EventValueType.numeric:
                return data.easing.type === EasingType.normal
                    ? NumericEasedEvaluator.evaluatorsOfNormalEasing[data.easing.identifier] as EasedEvaluatorOfType<T>
                    : new NumericEasedEvaluator(this.createEasingFromData(data.easing)) as EasedEvaluatorOfType<T>;
            case EventValueType.color:
                return data.easing.type === EasingType.normal
                    ? ColorEasedEvaluator.evaluatorsOfNormalEasing[data.easing.identifier] as EasedEvaluatorOfType<T>
                    : new ColorEasedEvaluator(this.createEasingFromData(data.easing)) as EasedEvaluatorOfType<T>;
            case EventValueType.text:
                return data.easing.type === EasingType.normal
                    ? TextEasedEvaluator.evaluatorsOfNoEzAndItpAs[data.easing.identifier][(data as TextEasedEvaluatorKPA2).interpretedAs] as EasedEvaluatorOfType<T>
                    : new TextEasedEvaluator(this.createEasingFromData(data.easing), (data as TextEasedEvaluatorKPA2).interpretedAs) as EasedEvaluatorOfType<T>
        }
    }
    createExpressionEvaluator<T extends EventValueESType>(data: ExpressionEvaluatorDataKPA2) {
        return new ExpressionEvaluator<T>(data.jsExpr);
    }
    /**
     * 使用KPA2JSON创建一对面对面节点
     * @param data 
     * @param type 
     * @returns 
     */
    createEventFromData<VT extends EventValueESType>(data: EventDataKPA2<VT>, type: EventValueTypeOfType<VT>): [EventStartNode<VT>, EventEndNode<VT>] {
        const start = new EventStartNode(data.startTime, data.start);
        const end = new EventEndNode(data.endTime, data.end);
        start.evaluator = this.createEvaluator(data.evaluator, type);
        EventNode.connect(start, end);
        return [start, end];
    }
}

export class JudgeLineGroup {
    judgeLines: JudgeLine[];
    constructor(public name: string) {
        this.judgeLines = []
    }
    add(judgeLine: JudgeLine) {
        // 加入之前已经按照ID升序排列
        // 加入时将新判定线插入到正确位置
        if (judgeLine.group) {
            judgeLine.group.remove(judgeLine);
        }
        judgeLine.group = this;
        
        // 找到正确的位置插入，保持按ID升序排列
        for (let i = 0; i < this.judgeLines.length; i++) {
            if (this.judgeLines[i].id > judgeLine.id) {
                this.judgeLines.splice(i, 0, judgeLine);
                return;
            }
        }
        // 如果没有找到比它大的ID，则插入到末尾
        this.judgeLines.push(judgeLine);
        
    }
    remove(judgeLine: JudgeLine) {
        const index = this.judgeLines.indexOf(judgeLine);
        if (index !== -1) {
            this.judgeLines.splice(index, 1);
        }
    }
    isDefault() {
        return this.name.toLowerCase() === "default";
    }
}


