import { SCHEMA, VERSION } from "./version";

import {
    TimeCalculator
} from "./bpm";

import {
    BezierEasing,
    Easing,
    NormalEasing,
    rpeEasingArray,
    SegmentedEasing,
    TemplateEasing,
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
    VideoEventNodeSequence,
} from "./video";

import {
    animVarToEventData,
} from "./extra";

import TC from "./time";

import {
    NodeType
} from "./util"

import {
    JudgeLine
} from "./judgeline";

import {
    NNNList,
    type NNNOrTail,
    NNNode,
    Note
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
    type EventDataRPELike,
    InterpreteAs,
    MacroEvaluatorBodyData,
    MacroEvaluatorDataKPA2,
    FinalEventStartNodeDataKPA2,
    MacroData,
    MacroLink,
    NoteMacroLink
} from "./chartTypes";
import { ColorEasedEvaluator, Evaluator, ExpressionEvaluator, NumericEasedEvaluator, TextEasedEvaluator, type EasedEvaluatorOfType } from "./evaluator";
import { err, ERROR_IDS, KPAError }  from "./env";
import { MacroLib, EventMacroTime, EventMacroValue, EventMacro, NoteMacro } from "./macro";
import type { PhiraExtraJson } from "./extraTypes";

/// #declaration:global


export type BasicEventName = "moveX" | "moveY" | "rotate" | "alpha" | "speed";





export type UIName = "combo"  | "combonumber" | "score" | "pause" | "bar" | "name" | "level"

/**
 * 谱面级视频通道
 *
 * 三个序列彼此独立：`name`是阶梯型的视频切换序列，
 * `alpha`与`dim`则是全谱拉通的常规数值序列，取值均为0~1。
 *
 * @since 2.2.0
 */
export interface VideoChannel {
    /** 视频路径序列 */
    name: VideoEventNodeSequence;
    /** 视频不透明度序列，取值0~1 */
    alpha: EventNodeSequence<number>;
    /** 视频变暗程度序列，取值0~1 */
    dim: EventNodeSequence<number>;
}

/**
 * 表示一张谱面的核心数据结构
 * 
 * 包含了谱面的所有元素：判定线、音符、事件序列等信息
 */
export class Chart {
    /** 谱面中所有的判定线列表 */
    judgeLines: JudgeLine[] = [];
    /** 时间计算器，用于处理BPM变化和时间转换 */
    readonly timeCalculator = new TimeCalculator();
    /** 无父级的根判定线列表 */
    orphanLines: JudgeLine[] = [];
    

    
    /** 谱面名称 */
    name: string = "unknown";
    /** 谱面难度等级 */
    level: string = "unknown";
    /** 曲师信息 */
    composer: string = "unknown";
    /** 谱师信息 */
    charter: string = "unknown";
    /** 插画师信息 */
    illustrator: string = "unknown";
    
    /** 谱面偏移时间（秒） */
    offset: number = 0;
    
    /** 模板缓动库，用于管理和复用缓动函数 */
    readonly templateEasingLib = new TemplateEasingLib(EventNodeSequence.newSeq<EventType.easing>, ExpressionEvaluator);
    readonly macroLib = new MacroLib();
    
    /** 事件序列映射表，通过ID索引事件序列 */
    readonly sequenceMap = new Map<string, EventNodeSequence<EventValueESType>>();
    /** 有效节拍数（基于谱面持续时间计算得出） */
    effectiveBeats: number;
    /** 音符节点列表，用于管理谱面上的所有音符 */
    nnnList: NNNList;
    /** 判定线组列表，用于组织和分类判定线 */
    judgeLineGroups: JudgeLineGroup[] = [];
    /** 谱面持续时间（秒） */
    duration: number;

    /**
     * 谱面级视频通道
     *
     * 三条序列彼此独立，均不进入{@linkcode sequenceMap}。
     * @since 2.2.0
     */
    video: VideoChannel = {
        name: VideoEventNodeSequence.newVideoSeq(0),
        alpha: EventNodeSequence.newSeq(EventType.videoAlpha, 0),
        dim: EventNodeSequence.newSeq(EventType.videoDim, 0)
    };

    /** 谱面制作所用时间（以秒计） */
    chartingSeconds: number;
    /** RPE格式的谱面制作时间（以秒计） */
    rpeChartingSeconds: number;

    
    /** 标记谱面是否已被修改 */
    modified: boolean = false;
    /** 谱面最大连击数 */
    maxCombo: number = 0;


    /** 暂停按钮绑定的判定线 */
    pauseAttach:       JudgeLine | null = null;
    /** 连击数字绑定的判定线 */
    combonumberAttach: JudgeLine | null = null;
    /** 连击标识绑定的判定线 */
    comboAttach:       JudgeLine | null = null;
    /** 进度条绑定的判定线 */
    barAttach:         JudgeLine | null = null;
    /** 分数显示绑定的判定线 */
    scoreAttach:       JudgeLine | null = null;
    /** 歌曲名称显示绑定的判定线 */
    nameAttach:        JudgeLine | null = null;
    /** 难度等级显示绑定的判定线 */
    levelAttach:       JudgeLine | null = null;

    /** 仅用于构造时检查 
     * @internal
     */
    segmentedTemplates: Map<(SegmentedEasing & { easing: TemplateEasing}), [string, TimeT]> = new Map();

    constructor() {
        this.video.name.id = "@video.name";
        this.video.alpha.id = "@video.alpha";
        this.video.dim.id = "@video.dim";
    }
    
    /**
     * 获取有效节拍数
     * @returns 基于谱面持续时间计算的有效节拍数
     */
    getEffectiveBeats() {
        const effectiveBeats = this.timeCalculator.secondsToBeats(this.duration)
        this.effectiveBeats = effectiveBeats
        return this.effectiveBeats
    }
    
    /**
     * 从RPE格式的JSON数据创建谱面对象
     * @param data RPE格式的谱面数据
     * @param duration 谱面持续时间（秒）
     * @param extraJson Phira的extra.json，传入时用它初始化视频通道
     * @returns 创建的Chart对象
     */
    static fromRPEJSON(data: ChartDataRPE, duration: number, extraJson?: PhiraExtraJson) {
        const chart = new Chart();
        chart.judgeLineGroups = (data.judgeLineGroup || ["Default"]).map(group => new JudgeLineGroup(group));
        chart.name = data.META.name;
        chart.level = data.META.level;
        chart.offset = data.META.offset;
        chart.composer = data.META.composer ?? "unknown";
        chart.charter = data.META.charter ?? "unknown";
        chart.illustrator = data.META.illustration ?? "unknown";
        chart.duration = duration;
        chart.chartingSeconds = data.kpaChartTime ?? 0;
        chart.rpeChartingSeconds = data.chartTime ?? 0;
        chart.chartingSeconds = 0;
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
                line.father = father;
            } else {
                chart.orphanLines.push(line);
            }
        }
        if (extraJson) {
            chart.initVideoFromExtraJson(extraJson, chart.getEffectiveBeats());
        }
        chart.countMaxCombo();
        return chart
    }

    /**
     * 从KPA格式的JSON数据创建谱面对象
     * @param data KPA格式的谱面数据
     * @returns 创建的Chart对象
     */
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
        
        const interpreteAsSecs = data.version && data.version >= 203;
        if (interpreteAsSecs) {
            chart.chartingSeconds = data.chartTime ?? 0;
            chart.rpeChartingSeconds = data.rpeChartTime ?? 0;
        } else {
            chart.chartingSeconds = data.chartTime ? data.chartTime * 60 : 0;
            chart.rpeChartingSeconds = data.rpeChartTime ? data.rpeChartTime * 60 : 0;
        }

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
                    seqData.final as FinalEventStartNodeDataKPA2<VT>
                );
                sequence.id = seqData.id;
                chart.sequenceMap.set(sequence.id, sequence);
            }

            chart.macroLib.readTimeMacros((data as ChartDataKPA2).timeMacros ?? []);
            chart.macroLib.readValueMacros((data as ChartDataKPA2).valueMacros ?? []);
            chart.initVideo(data as ChartDataKPA2, chart.getEffectiveBeats());
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
            if (!sequence) {
                continue; // 后面check的时候会错误处理
            }
            if (sequence.type !== EventType.easing) {
                throw err.CANNOT_IMPLEMENT_TEMEAS_WITH_NON_EASING_ENS(easingData.name);
            }
            if (typeof sequence.head.next.value !== "number") {
                throw err.CANNOT_IMPLEMENT_TEMEAS_WITH_NON_NUMERIC_ENS(easingData.name);
            }
            chart.templateEasingLib.implement(easingData.name, sequence as EventNodeSequence<number>);
        }
        for (let i = 0; i < len; i++) {
            const easingData = templateEasings[i];
            const sequence = chart.sequenceMap.get(easingData.content) as EventNodeSequence;
            // 遍历该序列检查循环依赖
            if (sequence.hasReferenceTo(sequence)) {
                throw err.TEMPLATE_EASING_CIRCULAR_REFERENCE(easingData.name);
            }
        }

        chart.templateEasingLib.check();

        chart.checkSegmentedTemplates();

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
    
    /**
     * 初始化时间计算器
     * @param bpmList BPM变化列表
     */
    initCalculator(bpmList: BPMSegmentData[]) {
        this.timeCalculator.bpmList = bpmList;
        this.timeCalculator.duration = this.duration;
        this.timeCalculator.initSequence()
    }

    /**
     * 初始化视频通道
     *
     * KPA1没有视频通道，此时保留构造时的默认空序列。
     *
     * @param data KPA2谱面数据
     * @param effectiveBeats 谱面有效拍数
     * @since 2.2.0
     */
    initVideo(data: ChartDataKPA2, effectiveBeats: number) {
        const videoData = data.video;
        const name = VideoEventNodeSequence.fromKPA2JSON(videoData?.name, effectiveBeats, "video.name");
        const alpha = videoData?.alpha
            ? EventNodeSequence.fromKPA2JSON<EventType.videoAlpha, number>(
                EventType.videoAlpha, videoData.alpha.events, this, "video.alpha", videoData.alpha.final)
            : EventNodeSequence.newSeq(EventType.videoAlpha, effectiveBeats);
        const dim = videoData?.dim
            ? EventNodeSequence.fromKPA2JSON<EventType.videoDim, number>(
                EventType.videoDim, videoData.dim.events, this, "video.dim", videoData.dim.final)
            : EventNodeSequence.newSeq(EventType.videoDim, effectiveBeats);
        name.id  = videoData?.name?.id  ?? "@video.name";
        alpha.id = videoData?.alpha?.id ?? "@video.alpha";
        dim.id   = videoData?.dim?.id   ?? "@video.dim";
        this.video = { name, alpha, dim };
    }

    /**
     * 从Phira的extra.json初始化视频通道
     *
     * 每个视频各自的alpha与dim动画变量会按时间顺序拼接成两条全谱拉通的序列。
     * 视频之间的空档由{@linkcode EventNodeSequence.fromRPEJSON}自动补成常量段。
     *
     * @param extraJson Phira的extra.json
     * @param effectiveBeats 谱面有效拍数
     * @since 2.2.0
     */
    initVideoFromExtraJson(extraJson: PhiraExtraJson, effectiveBeats: number) {
        const videos = (extraJson.videos ?? []).slice();
        videos.sort((a, b) => TC.cmp(a.time, b.time));
        const alphaEvents: EventDataRPELike<number>[] = [];
        const dimEvents: EventDataRPELike<number>[] = [];
        const length = videos.length;
        for (let i = 0; i < length; i++) {
            const video = videos[i]!;
            const next = videos[i + 1];
            // 最后一个视频一直持续到谱面结束。这里给常量型动画变量一个占位区间即可，
            // 因为序列末尾节点的值会无限延伸
            const to = next ? next.time : TC.vadd(video.time, [1, 0, 1]);
            // extra.json里这两个字段可能整个缺失，回落到各自的默认值
            alphaEvents.push(...animVarToEventData(video.alpha ?? 1, video.time, to));
            dimEvents.push(...animVarToEventData(video.dim ?? 0, video.time, to));
        }
        const name = VideoEventNodeSequence.fromPhiraVideos(videos, effectiveBeats);
        const alpha = alphaEvents.length
            ? EventNodeSequence.fromRPEJSON(EventType.videoAlpha, alphaEvents, this, "video.alpha")
            : EventNodeSequence.newSeq(EventType.videoAlpha, effectiveBeats);
        const dim = dimEvents.length
            ? EventNodeSequence.fromRPEJSON(EventType.videoDim, dimEvents, this, "video.dim")
            : EventNodeSequence.newSeq(EventType.videoDim, effectiveBeats);
        name.id  = "@video.name";
        alpha.id = "@video.alpha";
        dim.id   = "@video.dim";
        this.video = { name, alpha, dim };
    }
    
    /**
     * 更新有效节拍数
     * @param duration 新的持续时间
     */
    updateEffectiveBeats(duration: number) {
        const EB = this.timeCalculator.secondsToBeats(duration);
        for (let i = 0; i < this.judgeLines.length; i++) {
            const judgeLine = this.judgeLines[i]
            judgeLine.updateEffectiveBeats(EB);
        }
        // 视频序列不隶属于任何判定线，需要单独更新
        for (const seq of [this.video.name, this.video.alpha, this.video.dim]) {
            seq.effectiveBeats = EB;
            seq.initJump();
        }
    }
    
    /**
     * 导出为KPA格式数据
     * @returns KPA格式的谱面数据对象
     */
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
            $schema: SCHEMA,
            duration: this.duration,
            bpmList: this.timeCalculator.dump(),
            templateEasings: envEasings,
            wrapperEasings: this.templateEasingLib.dumpWrapperEasings(),
            macroEvaluators: this.macroLib.dumpMacroEvaluators(),
            timeMacros: this.macroLib.dumpTimeMacros(),
            valueMacros: this.macroLib.dumpValueMacros(),
            noteMacros: this.macroLib.dumpNoteMacros(),
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
            video: {
                name: this.video.name.dumpVideo(),
                alpha: this.video.alpha.dump(),
                dim: this.video.dim.dump()
            },
            orphanLines: orphanLines,
            judgeLineGroups: this.judgeLineGroups.map(g => g.name),
            chartTime: this.chartingSeconds,
            rpeChartTime: this.rpeChartingSeconds
        };
    }
    
    /**
     * 创建一个新的二级音符节点
     * @param time 节点时间
     * @returns 新创建的NNNode对象
     */
    createNNNode(time: TimeT) {
        return new NNNode(time)
    }
    
    /**
     * 创建一个新的事件节点序列
     * @param type 事件类型
     * @param name 序列名称（ID）
     * @returns 新创建的事件节点序列
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

    registerEventNodeSequence<T extends EventType>(type: T, name: string, seq: EventNodeSequence<T>) {
        if (this.sequenceMap.has(name)) {
            throw err.SEQUENCE_NAME_OCCUPIED(name);
        }
        seq.id = name;
        this.sequenceMap.set(name, seq);
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
    
    /**
     * 查询指定判定线上绑定的UI组件
     * @param judgeLine 目标判定线
     * @returns 绑定到该判定线上的UI组件名称数组
     */
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
     * @returns 所有使用的纹理名称集合
     */
    scanAllTextures() {
        const textures: Set<string> = new Set;
        for (const line of this.judgeLines) {
            textures.add(line.texture);
        }
        return textures
    }

    scanAllVideos() {
        const videos: Set<string> = new Set();
        for (const seg of this.video.name.segments()) {
            if (seg.node.value === "") {
                continue;
            }
            videos.add(seg.node.value);
        }
        return videos;
    }
    
    /**
     * 使用KPA2数据创建一个缓动对象。
     * 
     * 只有对贝塞尔缓动和截段缓动才会创建新对象，其他几种缓动从缓动库等中的对象池获取
     * @param data 缓动数据
     * @returns 创建的缓动对象
     */
    createEasingFromData(data: EasingDataKPA2) {
        switch (data.type) {
            case EasingType.bezier:
                return new BezierEasing([data.bezier[0], data.bezier[1]], [data.bezier[2], data.bezier[3]]);
            case EasingType.normal:
                return rpeEasingArray[data.identifier];
            case EasingType.segmented:
                return new SegmentedEasing(this.createEasingFromData(data.inner), data.left, data.right);
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
     * @param data 求值器数据
     * @param type 事件值类型
     * @returns 创建的求值器对象
     */
    bindEvaluator<T extends EventValueESType>(node: EventStartNode<T>, data: EvaluatorDataKPA2<T>, type: EventValueTypeOfType<T>, pos: string) {
        switch (data.type) {
            case EvaluatorType.eased:
                // 我管你这的那的 —— 小奶椰
                node.evaluator = this.createEasedEvaluator(data, type) as unknown as Evaluator<T>;
                break;
            case EvaluatorType.expressionbased:
                node.evaluator = this.createExpressionEvaluator(data) as ExpressionEvaluator<T>;
                break;
            case EvaluatorType.macro:
                this.bindMacroEvaluator(node, data, pos);
        }
    }
    
    /**
     * 使用KPA2数据创建一个缓动求值器。
     * 
     * 对于普通缓动，这些求值器是从对应类构造器的静态对象池属性中获取的。
     * @param data 缓动求值器数据
     * @param type 事件值类型
     * @returns 创建的缓动求值器对象
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
     * @param easing 缓动对象
     * @param type 事件值类型
     * @param interpreteAs 文本解释方式
     * @returns 对应类型的缓动求值器
     */
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
    
    /**
     * 根据JavaScript表达式创建表达式求值器
     * @param data 表达式求值器数据
     * @returns 创建的表达式求值器对象
     */
    createExpressionEvaluator<T extends EventValueESType>(data: ExpressionEvaluatorDataKPA2) {
        return new ExpressionEvaluator<T>(data.jsExpr);
    }

    bindMacroEvaluator(node: EventStartNode<EventValueESType>, data: MacroEvaluatorDataKPA2, pos: string) {
        const key = data.name;
        if (!key) {
            throw err.MISSING_MACRO_EVALUATOR_KEY(pos);
        }
        const evaluator = this.macroLib.macroEvaluators.get(key);
        if (!evaluator) {
            throw err.MACRO_EVALUATOR_NOT_FOUND(key, pos);
        }
        node.evaluator = evaluator;
        evaluator.consumers.set(node, new ExpressionEvaluator(data.compiled || "0"));
    }
    
    /**
     * 使用KPA2JSON创建一对面对面节点
     * @param data 事件数据
     * @param type 事件值类型
     * @returns 包含起始节点和结束节点的元组
     */
    createEventFromData<VT extends EventValueESType>(data: EventDataKPA2<VT>, type: EventValueTypeOfType<VT>, pos: string): [EventStartNode<VT>, EventEndNode<VT>] {
        const start = new EventStartNode(data.startTime, data.start);
        const end = new EventEndNode(data.endTime, data.end);
        this.bindEvaluator(start, data.evaluator, type, pos);
        if (data.macroStart) {
            this.bindValueMacro(start, data.macroStart, pos)
        }
        if (data.macroEnd) {
            this.bindValueMacro(end, data.macroEnd, pos)
        }
        if (data.macroStartTime) {
            this.bindTimeMacro(start, data.macroStartTime, pos)
        }
        if (data.startLinkedMacro) {
            for (const macroLink of data.startLinkedMacro) {
                this.linkMacro(start, macroLink, pos)
            }
        }
        if (data.endLinkedMacro) {
            for (const macroLink of data.endLinkedMacro) {
                this.linkMacro(end, macroLink, pos)
            }
        }
        EventNode.connect(start, end);
        return [start, end];
    }
    createFinalEventStartNodeFromData<VT extends EventValueESType>(data: FinalEventStartNodeDataKPA2<VT>, type: EventValueTypeOfType<VT>, pos: string): EventStartNode<VT> {
        const node = new EventStartNode(data.startTime, data.start);
        this.bindEvaluator(node, data.evaluator, type, pos);
        if (typeof data.macro === "string") {
            this.bindValueMacro(node, data.macro, pos);
        }
        if (typeof data.macroTime === "string") {
            this.bindTimeMacro(node, data.macroTime, pos);
        }
        if (data.linkedMacro) {
            for (const macroLink of data.linkedMacro) {
                this.linkMacro(node, macroLink, pos)
            }
        }
        return node;
    }
    bindTimeMacro(node: EventStartNode<any>, macroData: MacroData, pos: string) {
        const id = Array.isArray(macroData) ? macroData[0] : macroData;
        const macro = this.macroLib.timeMacros.get(id);
        if (typeof macro === "object" && macro instanceof EventMacroTime) {
            node.macroTime = macro;
            macro.bindNode(node, macroData, pos);
        } else {
            err.TIME_MACRO_NOT_FOUND(id, pos).warn();
        }
        return null;
    }
    bindValueMacro(node: EventNode<any>, macroData: MacroData, pos: string) {
        const id = Array.isArray(macroData) ? macroData[0] : macroData;
        const macro = this.macroLib.valueMacros.get(id);
        if (typeof macro === "object" && macro instanceof EventMacroValue) {
            node.macro = macro;
            macro.bindNode(node, macroData, pos);
        } else {
            err.VALUE_MACRO_NOT_FOUND(id, pos).warn();
        }
        return null;
    }
    linkMacro(node: EventNode<EventValueESType>, linkData: MacroLink, pos: string) {
        const prefix = linkData[0].split(":")[0] as 'time' | 'value';
        const macroDict = prefix === 'time' ? this.macroLib.timeMacros : this.macroLib.valueMacros;
        const realName = linkData[0].substring(prefix.length + 1);
        const macro = macroDict.get(realName);
        if (typeof macro === "object" && macro instanceof EventMacro) {
            macro.linkProtoNode(node, linkData[1]);
        } else {
            err[`${prefix.toUpperCase() as 'TIME' | 'VALUE'}_MACRO_NOT_FOUND`](realName, pos).warn();
        }
        return null;
    }
    bindNoteMacro(note: Note, macroData: MacroData, pos: string) {
        const id = Array.isArray(macroData) ? macroData[0] : macroData;
        const macro = this.macroLib.noteMacros.get(id);
        if (typeof macro === "object" && macro instanceof NoteMacro) {
            note.macro = macro;
            macro.bindNote(note, macroData, pos);
        } else {
            err.NOTE_MACRO_NOT_FOUND(id, pos).warn();
        }
        return null;
    }
    linkNoteMacro(note: Note, linkData: NoteMacroLink, pos: string) {
        const macro = this.macroLib.noteMacros.get(linkData[0]);
        if (typeof macro === "object" && macro instanceof NoteMacro) {
            macro.linkProtoNote(note, linkData[1]);
        } else {
            err.NOTE_MACRO_NOT_FOUND(linkData[0], pos).warn();
        }
        return null;
    }
    /* 暂时不用此方法，因为谱面播放器里面还是用反解法弄的
    updateNNListsFromENS(speedENS: SpeedENS) {
        
    }
    */
    checkErrors() {
        KPAError.flush();
        for (const [_, seq] of this.sequenceMap) {
            seq.checkErrors();
        }
        // 视频的三条序列不在sequenceMap中，单独检查
        this.video.alpha.checkErrors();
        this.video.dim.checkErrors();
    }
    updateAllFloorPositions() {
        for (const [_, seq] of this.sequenceMap) {
            if (seq.type === EventType.speed) {
                (seq as SpeedENS).updateFloorPositionAfter(seq.head.next, this.timeCalculator);
            }
        }
    }
    /**
     * 用于构造谱面时检查
     */
    protected checkSegmentedTemplates() {
        for (const [easing, [pos, time]] of this.segmentedTemplates) {
            const inner = easing.easing;
            if (inner.getValue(easing.left) === inner.getValue(easing.right)) {
                err.EASING_DELTA_CANNOT_BE_ZERO(pos, time).warn();
            }
        }
        this.segmentedTemplates.clear();
        // 查完就清除，不再需要
    }
}

/**
 * 表示一组判定线的容器
 * 
 * 用于组织和管理具有相同属性或用途的判定线集合
 */
export class JudgeLineGroup {
    /**
     * 该只读标记只是为了防止外部修改，内部可以修改
     * 
     * 属于该组的判定线列表，按ID升序排列
     */
    judgeLines: readonly JudgeLine[];
    
    /**
     * 创建一个新的判定线组
     * @param name 组名称
     */
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
     * @param judgeLine 要移除的判定线
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
     * 检查该判定线组是否为默认组
     * @returns 该判定线组是否为默认判定线组，默认的判断标准是：名称为 "Default"（大小写不敏感）
     */
    isDefault() {
        return this.name.toLowerCase() === "default";
    }
}


/// #enddeclaration