
import { VERSION } from "./version";

import {
    TimeCalculator} from "./bpm";

import {
    BezierEasing,
    Easing,
    NormalEasing,
    rpeEasingArray,
    SegmentedEasing,
    TemplateEasingLib,
} from "./easing";

import {
    EventNodeSequence,
    EventStartNode,
    EventEndNode,
    EventNode,
    SpeedENS,
} from "./event";

import {
    NodeType
} from "./util"

import {
    JudgeLine
} from "./judgeline";

import {
    NNNList,
    type NNNOrTail,
    NNNode
} from "./note";

import {
    type TimeT,
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
    EventType,
    EventValueType,
    type EventValueTypeOfType,
    type EventValueESType,
    type ExpressionEvaluatorDataKPA2,
    type TextEasedEvaluatorKPA2,
    type EventNodeSequenceDataKPA2,
    type ChartDataKPA2,
    type EventDataKPA2,
    InterpreteAs
} from "./chartTypes";
import { ColorEasedEvaluator, Evaluator, ExpressionEvaluator, NumericEasedEvaluator, TextEasedEvaluator, type EasedEvaluatorOfType } from "./evaluator";
import { err, ERROR_IDS, KPAError }  from "./env";

/// #declaration:global


export type BasicEventName = "moveX" | "moveY" | "rotate" | "alpha" | "speed";





export type UIName = "combo"  | "combonumber" | "score" | "pause" | "bar" | "name" | "level"

export class Chart {
    judgeLines: JudgeLine[] = [];
    timeCalculator = new TimeCalculator();
    orphanLines: JudgeLine[] = [];
    // comboMapping: ComboMapping;
    name: string = "unknown";
    level: string = "unknown";
    composer: string = "unknown";
    charter: string = "unknown";
    illustrator: string = "unknown";
    offset: number = 0;
    
    templateEasingLib = new TemplateEasingLib(EventNodeSequence.newSeq<EventType.easing>, ExpressionEvaluator);
    sequenceMap = new Map<string, EventNodeSequence<EventValueESType>>();

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
        this.effectiveBeats = effectiveBeats
        return this.effectiveBeats
    }
    static fromRPEJSON(data: ChartDataRPE, duration: number) {
        const chart = new Chart();
        chart.judgeLineGroups = data.judgeLineGroup.map(group => new JudgeLineGroup(group));
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
        chart.initCalculator(data.BPMList)
        chart.nnnList = new NNNList(chart.getEffectiveBeats())
        
        
        
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


        chart.initCalculator(data.bpmList);
        chart.nnnList = new NNNList(chart.getEffectiveBeats());
        /**
         * 影响事件的格式、是否存在“求值器”这一中间层以及判定线的属性名
         */
        const isKPA2 = data.version >= 200;
        const templateEasings = isKPA2 ? (data as ChartDataKPA2).templateEasings : (data as ChartDataKPA).envEasings;
        const len = templateEasings.length
        for (let i = 0; i < len; i++) {
            const easingData = templateEasings[i];
            chart.templateEasingLib.require(easingData.name);
        }

        if (isKPA2) {
            chart.templateEasingLib.readWrapperEasings((data as ChartDataKPA2).wrapperEasings);
            const sequences = (data as ChartDataKPA2).eventNodeSequences;
            const length = sequences.length;
            for (let i = 0; i < length; i++) {
                const seqData = sequences[i];
                type VT = ValueTypeOfEventType<typeof seqData.type>
                const sequence = EventNodeSequence.fromKPA2JSON<typeof seqData.type, VT>(
                    seqData.type,
                    seqData.events as EventDataKPA2<VT>[],
                    chart,
                    seqData.id,
                    seqData.endValue as VT
                );
                sequence.id = seqData.id;
                chart.sequenceMap.set(sequence.id, sequence);
            }
        } else {
            
            const sequences = (data as ChartDataKPA).eventNodeSequences
            const length = sequences.length
            for (let i = 0; i < length; i++) {
                const seqData = sequences[i];
                const sequence = EventNodeSequence.fromRPEJSON<typeof seqData.type, ValueTypeOfEventType<typeof seqData.type>>(
                    seqData.type,
                    seqData.events,
                    chart,
                    seqData.id,
                    seqData.endValue);
                sequence.id = seqData.id;
                chart.sequenceMap.set(sequence.id, sequence);
            }
        }

        for (let i = 0; i < len; i++) {
            const easingData = templateEasings[i];
            const sequence = chart.sequenceMap.get(easingData.content);
            if (sequence.type !== EventType.easing) {
                throw err.CANNOT_IMPLEMENT_TEMEAS_WITH_NON_EASING_ENS(easingData.name);
            }
            if (typeof sequence.head.next.value !== "number") {
                throw err.CANNOT_IMPLEMENT_TEMEAS_WITH_NON_NUMERIC_ENS(easingData.name);
            }
            chart.templateEasingLib.implement(easingData.name, sequence as EventNodeSequence<number>);
        }
        chart.templateEasingLib.check()
        for (const lineData of data.orphanLines) {
            const line: JudgeLine = JudgeLine.fromKPAJSON(data.version, chart, lineData.id, lineData, chart.templateEasingLib, chart.timeCalculator)
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
    initCalculator(bpmList: BPMSegmentData[]) {
        this.timeCalculator.bpmList = bpmList;
        this.timeCalculator.duration = this.duration;
        this.timeCalculator.initSequence()
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
        for (const line of this.orphanLines) {
            orphanLines.push(line.dumpKPA(eventNodeSequenceCollector, this.judgeLineGroups));
        }
        const envEasings = this.templateEasingLib.dump(eventNodeSequenceCollector);
        const eventNodeSequenceData: EventNodeSequenceDataKPA2<EventValueESType>[] = [];
        for (const sequence of eventNodeSequenceCollector) {
            eventNodeSequenceData.push(sequence.dump());
        }
        return {
            version: VERSION,
            duration: this.duration,
            bpmList: this.timeCalculator.dump(),
            templateEasings: envEasings,
            wrapperEasings: this.templateEasingLib.dumpWrapperEasings(),
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
    /**
     * 
     * @param type 
     * @param name 
     * @returns 
     * @throws {KPAError<ERROR_IDS.SEQUENCE_NAME_OCCUPIED>}
     */
    createEventNodeSequence<T extends EventType>(type: T, name: string) {
        if (this.sequenceMap.has(name)) {
            throw err.SEQUENCE_NAME_OCCUPIED(name);
        }
        const seq = EventNodeSequence.newSeq(type, this.getEffectiveBeats());
        seq.id = name;
        this.sequenceMap.set(name, seq);
        return seq;
    }
    /**
     * 对谱面物量进行重新计数。
     * 
     * 不会返回值，谱面物量存储在 `this.maxCombo` 中。
     */
    countMaxCombo(): void {
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
    /**
     * 将UI绑定到某判定线
     * @param ui UI名称，与RPEJSON中的代号相同
     * @param judgeLine 所要绑定的目标判定线
     * @throws {KPAError<ERROR_IDS.UI_OCCUPIED>}
     */
    attachUIToLine(ui: UIName, judgeLine: JudgeLine) {
        const key = `${ui}Attach` satisfies keyof Chart;
        if (this[key]) {
            throw err.UI_OCCUPIED(ui);
        }
        this[key] = judgeLine;
        judgeLine.hasAttachUI = true;
    }
    /**
     * 移除谱面中某个UI的绑定，使UI进入未绑定状态
     * @param ui UI名称，与RPEJSON中的相同
     * @returns 
     */
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
    /**
     * 扫描所有用到的判定线贴图（纹理）并返回
     * 
     * 给谱面播放器的接口，谱面播放器需要在初加载时提供贴图
     * @returns 
     */
    scanAllTextures() {
        const textures: Set<string> = new Set;
        for (const line of this.judgeLines) {
            textures.add(line.texture);
        }
        return textures
    }
    /**
     * 使用KPA2数据创建一个缓动对象。
     * 
     * 只有对贝塞尔缓动和截段缓动才会创建新对象，其他几种缓动从缓动库等中的对象池获取
     * @param data 
     * @returns 
     */
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
            case EasingType.wrapper:
                return this.templateEasingLib.getWrapper(data.identifier);
        }
    }
    /**
     * 使用KPA2数据创建一个求值器对象。
     * 
     * 求值器只有缓动型和表达式型两类。
     * @param data 
     * @param type 
     * @returns 
     */
    createEvaluator<T extends EventValueESType>(data: EvaluatorDataKPA2<T>, type: EventValueTypeOfType<T>): Evaluator<T> {
        switch (data.type) {
            case EvaluatorType.eased:
                // 我管你这的那的 —— 小奶椰
                return this.createEasedEvaluator(data, type) as unknown as Evaluator<T>;
            case EvaluatorType.expressionbased:
                return this.createExpressionEvaluator(data) as ExpressionEvaluator<T>;
        }
    }
    /**
     * 使用KPA2数据创建一个缓动求值器。
     * 
     * 对于普通缓动，这些求值器是从对应类构造器的静态对象池属性中获取的。
     * @param data 
     * @param type 
     * @returns 
     */
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
    /**
     * 用一个缓动和事件类型获取一个缓动求值器
     * @param easing 
     * @param type 
     * @param interpreteAs 
     */
    getEasedEvaluator<T extends string>(easing: Easing, type: EventValueType.text, interpreteAs: InterpreteAs): TextEasedEvaluator;
    getEasedEvaluator<T extends EventValueESType>(easing: Easing, type: EventValueTypeOfType<T>, interpreteAs?: InterpreteAs): EasedEvaluatorOfType<T> {
        const easingIsNormal = easing instanceof NormalEasing;
        switch (type) {
            case EventValueType.numeric:
                return easingIsNormal
                    ? NumericEasedEvaluator.evaluatorsOfNormalEasing[easing.rpeId] as EasedEvaluatorOfType<T>
                    : new NumericEasedEvaluator(easing) as EasedEvaluatorOfType<T>;
            case EventValueType.color:
                return easingIsNormal
                    ? ColorEasedEvaluator.evaluatorsOfNormalEasing[easing.rpeId] as EasedEvaluatorOfType<T>
                    : new ColorEasedEvaluator(easing) as EasedEvaluatorOfType<T>;
            case EventValueType.text:
                return easingIsNormal
                    ? TextEasedEvaluator.evaluatorsOfNoEzAndItpAs[easing.rpeId][interpreteAs] as EasedEvaluatorOfType<T>
                    : new TextEasedEvaluator(easing, interpreteAs) as EasedEvaluatorOfType<T>
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
    /* 暂时不用此方法，因为谱面播放器里面还是用反解法弄的
    updateNNListsFromENS(speedENS: SpeedENS) {
        
    }
    */
}

export class JudgeLineGroup {
    /**
     * 该只读标记只是为了防止外部修改，内部可以修改
     */
    judgeLines: readonly JudgeLine[];
    constructor(public name: string) {
        this.judgeLines = []
    }
    /**
     * 向判定线组添加一条判定线，并且保证其内部的判定线ID是升序排列的。
     * @param judgeLine 要添加的判定线
     * @returns 
     */
    add(judgeLine: JudgeLine) {
        // 加入之前已经按照ID升序排列
        // 加入时将新判定线插入到正确位置
        const judgeLines = this.judgeLines as JudgeLine[];
        if (judgeLine.group) {
            judgeLine.group.remove(judgeLine);
        }
        judgeLine.group = this;
        
        // 找到正确的位置插入，保持按ID升序排列
        for (let i = 0; i < judgeLines.length; i++) {
            if (judgeLines[i].id > judgeLine.id) {
                judgeLines.splice(i, 0, judgeLine);
                return;
            }
        }
        // 如果没有找到比它大的ID，则插入到末尾
        judgeLines.push(judgeLine);
        
    }
    /**
     * 从判定线组移除一条判定线
     * @param judgeLine 
     */
    remove(judgeLine: JudgeLine) {
        // 只读仅对外部作限制
        const judgeLines = this.judgeLines as JudgeLine[];
        const index = judgeLines.indexOf(judgeLine);
        if (index !== -1) {
            judgeLines.splice(index, 1);
        }
    }
    /**
     * 
     * @returns 该判定线组是否为默认判定线组，默认的判断标准是：名称为 "Default"（大小写不敏感）
     */
    isDefault() {
        return this.name.toLowerCase() === "default";
    }
}


/// #enddeclaration