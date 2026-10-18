
import type { Chart, UIName } from "./chart";
import { type TimeT, type ChartDataRPE, type MetaData, type JudgeLineDataRPE, type EventLayerDataRPE, type EventDataRPELike, EventType, InterpreteAs, type NoteDataRPE, type EventValueESType, EventValueType } from "./chartTypes";
import { SegmentedEasing, BezierEasing, NormalEasing, fixedEasing, TemplateEasing, Easing } from "./easing";
import { err } from "./env";
import { EasedEvaluator, Evaluator, ExpressionEvaluator, NumericEasedEvaluator, TextEasedEvaluator, type EasedEvaluatorConstructorOfType, type EasedEvaluatorOfType } from "./evaluator";
import { EventEndNode, EventNode, EventNodeSequence, EventStartNode, SpeedENS, type EventNodeLike } from "./event";
import type { JudgeLine } from "./judgeline";
import type { NNList, HNList, NNOrHead } from "./note";
import type { PhiraAnimVar, PhiraAnimVarEvent } from "./extraTypes";
import TC from "./time";
import { NodeType, numberToRatio } from "./util";

/// #declaration:global

const getInnerEasing = (easing: Easing) => easing instanceof SegmentedEasing ? easing.easing : easing;

/** 将拍数转换为时间三元组 */
const beatsToTimeT = (beats: number): TimeT => TC.validateIp([0, ...numberToRatio(beats)]);

type EasedStartNode<VT extends EventValueESType> = EventStartNode<VT> & { evaluator: EasedEvaluatorOfType<VT>};

/**
 * 全生命周期只会编译一次，想多次就再构造一个
 */
export class RPEChartCompiler {
    sequenceMap: Map<EventNodeSequence<any>, EventNodeSequence<any>> = new Map();
    interpolationStep: TimeT = [0, 1, 16];
    deletesEmptyLines: boolean = true;
    constructor(public chart: Chart) {

    }

    compileChart(): ChartDataRPE {
        const chart = this.chart;
        const judgeLineGroups = chart.judgeLineGroups.map(group => group.name);
        const hasNotes = (nnList: NNList) => {
            let node = nnList.head.next;
            while (true) {
                if (node.type === NodeType.TAIL) {
                    return false;
                }
                if (node.notes.length > 0) {
                    return true;
                }
                node = node.next;
            }
        }
        const filter = this.deletesEmptyLines ? (line: JudgeLine) => {
            return [...line.nnLists].some(([_, l]) => hasNotes(l))
                || [...line.hnLists].some(([_, l]) => hasNotes(l))
                || line.eventLayers.length > 0
                  && (["moveX", "moveY", "rotate", "alpha"] as const).some((evType) => {
                    const seq = line.eventLayers[0][evType]!;
                    let node = seq.head.next!;
                    for (let i = 0; i < 2; i++) {
                        const endNode = node.next;
                        if (node.value !== 0) {
                            return true;
                        }
                        if (endNode.type === NodeType.TAIL) {
                            return false;
                        }
                        if (endNode.value !== 0) {
                            return true;
                        }
                        node = endNode.next;
                    }
                    return true; // 有超过两个的节点
                })
                || line.children.size > 0;
        } : () => true
        const judgeLineList = chart.judgeLines
            .filter(filter);
        const judgeLineDataList = judgeLineList
            .map(line => this.compileJudgeLine(line, judgeLineList));
        const BPMList = chart.timeCalculator.dump();
        const META: MetaData = {
            RPEVersion: 170,
            background: 'illustration.png',
            charter: chart.charter,
            composer: chart.composer,
            illustration: chart.illustrator,
            id: Math.random().toString().slice(2, 18),
            level: chart.level,
            name: chart.name,
            offset: chart.offset,
            song: chart.name
        };

        for (const uiName of ["bar", "combo", "combonumber", "level", "name", "pause", "score"] satisfies UIName[]) {
            const target: JudgeLine | null = chart[`${uiName}Attach` satisfies keyof Chart];
            if (!target) {
                continue;
            }
            const lineData = judgeLineDataList[judgeLineList.indexOf(target)];
            // RPEJSON里面一条线只能绑一个UI，KPAJSON可以绑多个
            // 所以如果绑了多个，自动给它们创建子线
            if (lineData.attachUI) {
                judgeLineDataList.push({
                    Group: 0,
                    Name: "Auto created for " + uiName,
                    Texture: "line.png",
                    attachUI: uiName,
                    notes: [],
                    bpmfactor: 1.0,
                    eventLayers: [],
                    father: judgeLineList.indexOf(target),
                    isCover: lineData.isCover,
                    numOfNotes: 0,
                    anchor: target.anchor,
                    isGif: 0
                } satisfies Partial<JudgeLineDataRPE> as JudgeLineDataRPE)
            } else {
                lineData.attachUI = uiName;
            }
        }


        return {
            BPMList,
            META,
            judgeLineList: judgeLineDataList,
            judgeLineGroup: judgeLineGroups,
            multiLineString: '',
            multiScale: 1.0,
            chartTime: chart.rpeChartingSeconds,
            kpaChartTime: chart.chartingSeconds,
        };
    }

    compileJudgeLine(judgeLine: JudgeLine, lines: JudgeLine[]): JudgeLineDataRPE {
        const chart = this.chart;
        const notes = this.compileNNLists([...judgeLine.nnLists.values()], [...judgeLine.hnLists.values()]);

        const father = judgeLine.father ? lines.indexOf(judgeLine.father) : -1;

        return {
            notes: notes,
            Group: chart.judgeLineGroups.indexOf(judgeLine.group),
            Name: judgeLine.name,
            Texture: RPEChartCompiler.replaceFilename(judgeLine.texture),
            bpmfactor: 1.0,
            eventLayers: judgeLine.eventLayers.map((layer, index): EventLayerDataRPE => ({
                moveXEvents: layer.moveX ? this.dumpEventNodeSequence(layer.moveX) : undefined,
                moveYEvents: layer.moveY ? this.dumpEventNodeSequence(layer.moveY) : undefined,
                rotateEvents: layer.rotate ? this.dumpEventNodeSequence(layer.rotate) : undefined,
                alphaEvents: layer.alpha ? this.dumpEventNodeSequence(layer.alpha) : undefined,
                speedEvents: index === 0 ? this.dumpSpeedENS(judgeLine.speedSequence) : undefined
            })),
            extended: {
                scaleXEvents: judgeLine.extendedLayer.scaleX ? this.dumpEventNodeSequence(judgeLine.extendedLayer.scaleX) : undefined,
                scaleYEvents: judgeLine.extendedLayer.scaleY ? this.dumpEventNodeSequence(judgeLine.extendedLayer.scaleY) : undefined,
                textEvents: judgeLine.extendedLayer.text ? this.dumpEventNodeSequence(judgeLine.extendedLayer.text) : undefined,
                colorEvents: judgeLine.extendedLayer.color ? this.dumpEventNodeSequence(judgeLine.extendedLayer.color) : undefined
            },
            father: father,
            isCover: judgeLine.cover ? 1 : 0,
            numOfNotes: notes.length,
            anchor: judgeLine.anchor,
            rotateWithFather: judgeLine.rotatesWithFather,
            isGif: 0,
            zOrder: judgeLine.zOrder
        };
    }
    
    compileEasedEvent<VT extends EventValueESType>(
        snode: EventStartNode<VT> & { evaluator: EasedEvaluatorOfType<VT>},
        getValue: (node: EventStartNode<VT> | EventEndNode<VT>) => VT
    ): EventDataRPELike<VT> {
        const endNode = snode.next as EventEndNode<VT>;
        const evaluator = snode.evaluator;
        const easing = evaluator.easing;
        const isSegmented = easing instanceof SegmentedEasing;
        const innerEasing = isSegmented ? easing.easing : easing;
        const start = getValue(snode);
        const end = getValue(easing === fixedEasing ? snode : endNode)
        return {
            bezier: innerEasing instanceof BezierEasing ? 1 : 0,
            bezierPoints: innerEasing instanceof BezierEasing ?
                [innerEasing.cp1[0], innerEasing.cp1[1], innerEasing.cp2[0], innerEasing.cp2[1]] : // 修正了这里 cp2.y 的引用
                [0, 0, 0, 0],
            easingLeft: isSegmented ? easing.left : 0.0,
            easingRight: isSegmented ? easing.right : 1.0,
            easingType: isSegmented ? (
                easing.easing instanceof NormalEasing ? easing.easing.rpeId ?? 1 : null
            ) : (easing instanceof NormalEasing ?
                    easing.rpeId ?? 1 :
                    null),
            end,
            endTime: endNode.time,
            linkgroup: 0, // 假设默认值为 0
            start,
            startTime: snode.time
        }
    }

    dumpEventNodeSequence<VT extends EventValueESType>(sequence: EventNodeSequence<VT>): EventDataRPELike<VT>[] {
        const nodes: EventDataRPELike<VT>[] = [];
        const interpolationStep = this.interpolationStep;
        sequence = this.substitute(sequence);
        
        let node = sequence.head.next!;
        // 唯一真史
        const getValue = (sequence.type === EventType.text
            ? (node: EventStartNode<string> | EventEndNode<string>) => {
                const evaluator = (node instanceof EventStartNode ? node.evaluator : node.previous.evaluator) as TextEasedEvaluator;
                const interpretedAs = evaluator.interpretedAs;
                return interpretedAs === InterpreteAs.str ? node.value : "%P%" + node.value;
            }
            : (node: EventStartNode<number> | EventEndNode<number>) => node.value) as unknown as (node: EventStartNode<VT> | EventEndNode<VT>) => VT;
        while (true) {
            const end = node.next;
            if (end.type === NodeType.TAIL) break;
            if (node.evaluator instanceof ExpressionEvaluator) {
                // 插值
                let cur = node.time;
                const endTime = end.time;
                let value = getValue(node);
                for (; TC.lt(cur, endTime);) {
                    const nextTime = TC.validateIp(TC.add(cur, interpolationStep));
                    const nextValue = node.getValueAt(TC.toBeats(nextTime))
                    nodes.push({
                        bezier: 0,
                        bezierPoints: [0, 0, 0, 0],
                        easingLeft: 0.0,
                        easingRight: 0.0,
                        easingType: 1,
                        start: value,
                        startTime: cur,
                        end: nextValue,
                        endTime: nextTime,
                        linkgroup: 0
                    });
                    cur = nextTime;
                    value = nextValue;
                }
                // 所切割的事件长度并不必然是step的整数倍
                nodes.push({
                    bezier: 0,
                    bezierPoints: [0, 0, 0, 0],
                    easingLeft: 0.0,
                    easingRight: 0.0,
                    easingType: 1,
                    start: value,
                    startTime: cur,
                    end: end.value,
                    endTime: endTime,
                    linkgroup: 0
                })
                
            } else {
                nodes.push(this.compileEasedEvent(node as EasedStartNode<VT>, getValue));
            }
            node = end.next;
        }
        // 刻意造一个事件，并给它加一个结束节点，距离一拍长（用于处理endValue）
        const newStart = node!.clone();
        // 只是占位而已，并不重要，我们这里期望最后一个事件的缓动为1号，特别注意不要写成0了
        newStart.evaluator = NumericEasedEvaluator.evaluatorsOfNormalEasing[1] as unknown as EasedEvaluator<VT>;
        const newEnd = new EventEndNode(TC.vadd(newStart.time, [1, 0, 1]), newStart.value);
        EventNode.connect(newStart, newEnd);
        nodes.push(this.compileEasedEvent(newStart as EasedStartNode<VT>, getValue));

        return nodes
    }
    /**
     * 将数值事件节点序列的某个区间编译为Phira的动画变量
     *
     * Phira的动画变量与RPE事件共用同一套缓动编号，但不支持模板缓动
     * （会先由{@linkcode substitute}展开）、表达式缓动与贝塞尔缓动
     * （二者会被按{@linkcode interpolationStep}插值成折线）。
     *
     * 若区间内恒为同一个值，则返回裸数值而非动画数组。
     *
     * @param sequence 数值事件节点序列
     * @param from 起始拍数（含）
     * @param to 结束拍数（含）
     * @returns 常量或动画事件数组
     * @since 2.2.0
     */
    dumpAnimVar(sequence: EventNodeSequence<number>, from: number, to: number): PhiraAnimVar<number> {
        const seq = this.substitute(sequence);
        if (!(to > from)) {
            return seq.getValueAt(from);
        }
        const events: PhiraAnimVarEvent<number>[] = [];
        let node: EventStartNode<number> = seq.getNodeAt(from);
        while (true) {
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                // 最后一个起始节点的值无限延伸
                const startBeats = Math.max(TC.toBeats(node.time), from);
                if (startBeats < to) {
                    events.push({
                        start: node.value,
                        end: node.value,
                        startTime: beatsToTimeT(startBeats),
                        endTime: beatsToTimeT(to),
                        easingType: 1,
                        easingLeft: 0.0,
                        easingRight: 1.0
                    });
                }
                break;
            }
            const startBeats = TC.toBeats(node.time);
            const endBeats = TC.toBeats(end.time);
            if (startBeats >= to) {
                break;
            }
            const segFrom = Math.max(startBeats, from);
            const segTo = Math.min(endBeats, to);
            if (segTo > segFrom) {
                this.pushAnimVarSegment(
                    events,
                    node,
                    startBeats,
                    endBeats,
                    segFrom,
                    segTo,
                    segFrom === startBeats ? node.value : node.getValueAt(segFrom),
                    segTo === endBeats ? end.value : node.getValueAt(segTo)
                );
            }
            if (endBeats >= to) {
                break;
            }
            node = end.next;
        }
        if (!events.length) {
            return seq.getValueAt(from);
        }
        // 区间内恒定时直接返回常量
        const first = events[0]!.start;
        for (const event of events) {
            if (event.start !== first || event.end !== first) {
                return events;
            }
        }
        return first;
    }
    /**
     * 向动画变量数组中压入一个区间。
     *
     * 区间可能只是原事件的一部分（当视频的边界截在事件中间时），
     * 此时需要把缓动窗口按比例重新映射；若原事件本身就带
     * easingLeft/easingRight，则是在其基础上再截一段。
     *
     * 表达式缓动与贝塞尔缓动无法用Phira的缓动编号表达，按步长插值成折线。
     *
     * @param startBeats 原事件起始拍数
     * @param endBeats 原事件结束拍数
     * @param from 截取后的起始拍数
     * @param to 截取后的结束拍数
     */
    private pushAnimVarSegment(
        events: PhiraAnimVarEvent<number>[],
        node: EventStartNode<number>,
        startBeats: number,
        endBeats: number,
        from: number,
        to: number,
        startValue: number,
        endValue: number
    ) {
        const evaluator = node.evaluator;
        const easing = evaluator instanceof EasedEvaluator ? evaluator.easing : null;
        const innerEasing = easing ? getInnerEasing(easing) : null;
        if (evaluator instanceof ExpressionEvaluator || innerEasing instanceof BezierEasing) {
            const stepBeats = TC.toBeats(this.interpolationStep);
            let cur = from;
            let value = startValue;
            while (cur < to) {
                const next = Math.min(cur + stepBeats, to);
                const nextValue = next >= to ? endValue : node.getValueAt(next);
                events.push({
                    start: value,
                    end: nextValue,
                    startTime: beatsToTimeT(cur),
                    endTime: beatsToTimeT(next),
                    easingType: 1,
                    easingLeft: 0.0,
                    easingRight: 1.0
                });
                cur = next;
                value = nextValue;
            }
            return;
        }
        // 截取后的缓动窗口
        // 设原事件跨度为[s, e]、原缓动窗口为[L, R]，由于SegmentedEasing会把
        // 窗口内的取值归一化到0~1，原事件在进度p处取的是easing(L + p(R - L))。
        // 截到[a, b]后，新进度p'对应的原进度为p = α + p'(β - α)，
        // 其中α = (a - s)/(e - s)、β = (b - s)/(e - s)，
        // 于是新窗口为L' = L + α(R - L)、R' = L + β(R - L)。
        // 若原事件本来就带缓动窗口，这就是在已有基础上再截一段。
        const windowLeft = easing instanceof SegmentedEasing ? easing.left : 0.0;
        const windowRight = easing instanceof SegmentedEasing ? easing.right : 1.0;
        const span = endBeats - startBeats;
        const alpha = span > 0 ? (from - startBeats) / span : 0.0;
        const beta = span > 0 ? (to - startBeats) / span : 1.0;
        const easingLeft = windowLeft + alpha * (windowRight - windowLeft);
        const easingRight = windowLeft + beta * (windowRight - windowLeft);
        // 截出来的窗口内变化量为0时（例如fixed缓动被截在平台段），
        // 退化为常量段，否则Phira会算出NaN
        const flat = !!innerEasing
            && innerEasing.getValue(easingLeft) === innerEasing.getValue(easingRight);
        events.push({
            start: startValue,
            end: flat ? startValue : endValue,
            startTime: beatsToTimeT(from),
            endTime: beatsToTimeT(to),
            easingType: !flat && innerEasing instanceof NormalEasing ? innerEasing.rpeId ?? 1 : 1,
            easingLeft: flat ? 0.0 : easingLeft,
            easingRight: flat ? 1.0 : easingRight
        });
    }
    dumpSpeedENS(seq: SpeedENS): EventDataRPELike<number>[] {
        const ret: EventDataRPELike<number>[] = [];
        let node = seq.head.next!;
        while (true) {
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                break;
            }
            ret.push({
                start: node.value,
                end: end.value,
                startTime: node.time,
                endTime: end.time,
                linkgroup: 0
            } as EventDataRPELike<number>);
            node = end.next;
        }
        ret.push({
            start: node.value,
            end: node.value,
            startTime: node.time,
            endTime: TC.vadd(node.time, [1, 0, 1]),
            linkgroup: 0
        } as EventDataRPELike<number>);
        return ret;
    }

    compileNNLists(nnLists: NNList[], hnLists: HNList[]): NoteDataRPE[] {
        const noteLists = nnLists.map(list => this.nnListToArray(list));
        const holdLists = hnLists.map(list => this.nnListToArray(list));
        const ret: NoteDataRPE[] = []
        const time = (list: NoteDataRPE[]) => list.length === 0 ? [Infinity, 0, 1] as TimeT : list[list.length - 1].startTime;
        const concatWithOrder = (lists: NoteDataRPE[][]) => {
            if (lists.length === 0) return;
            // 先按最早的时间排序
            lists.sort((a, b) => {
                return TC.gt(time(a), time(b)) ? 1 : -1;
            });
            // 每次从lists中第一个list pop一个data加入到结果，然后冒泡调整这个list的位置
            while (lists[0].length > 0) {
                const list = lists[0];
                // 只需要pop就可以了，pop复杂度O(1)，这是倒序的原因
                const node = list.pop();
                // !:  上面保证了list一定还有至少一个元素，否则的话不满足循环条件
                ret.push(node!);
                let i = 0;
                while (i + 1 < lists.length && TC.gt(time(lists[i]), time(lists[i + 1]))) {
                    const temp = lists[i];
                    lists[i] = lists[i + 1];
                    lists[i + 1] = temp;
                    i++;
                }
            }

        };
        concatWithOrder(noteLists);
        concatWithOrder(holdLists);
        return ret;
    }
    /**
     * 倒序转换为数组
     * @param nnList 
     * @returns 一个按照时间降序排列的数组
     */
    nnListToArray(nnList: NNList) {
        const notes: NoteDataRPE[] = [];
        // 这个地方正常来讲不会为null或undefined
        let node: NNOrHead = nnList.tail.previous!;
        // 从最尾往前遍历
        while (node.type !== NodeType.HEAD) {
            for (const each of node.notes) {
                notes.push(each.dumpRPE(this.chart.timeCalculator));
            }
            // 同上，正常来讲不会为null或undefined
            node = node.previous!;
        }
        return notes;
    }

    /**
     * 将当前序列中所有通过模板缓动引用了其他序列的事件直接展开为被引用的序列内容
     * transform all events that reference other sequences by template easing
     * into the content of the referenced sequence
     * 
     * 有点类似于MediaWiki的`{{subst:templateName}}`
     * @returns 
     */
    substitute<VT extends EventValueESType>(seq: EventNodeSequence<VT>): EventNodeSequence<VT> {
        const map = this.sequenceMap;
        if (map.has(seq)) {
            // 都has了还担心啥undefined，TSC也是个人机
            return map.get(seq)!;
        }
        // 一般不会为null
        let currentNode: EventStartNode<VT> = seq.head.next!;
        const newSeq = new EventNodeSequence<VT>(seq.type, seq.effectiveBeats);
        const valueType = seq.type === EventType.color 
            ? EventValueType.color : seq.type === EventType.text
            ? EventValueType.text : EventValueType.numeric;
        // 加入哈希表缓存，避免重复计算
        map.set(seq, newSeq);
        let currentPos: EventNodeLike<NodeType.HEAD, VT> | EventEndNode<VT> = newSeq.head;
        while (true) {
            if (!currentNode || (currentNode.next.type === NodeType.TAIL)) {
                break;
            }
            /** 原序列当前结束节点 */
            const endNode = currentNode.next;
            /** 原序列当前节点的求值器 */
            const evaluator = currentNode.evaluator;
            let innerEasing: Easing;
            if (   evaluator
                && evaluator instanceof EasedEvaluator
                && (innerEasing = getInnerEasing(evaluator.easing)) instanceof TemplateEasing
            ) {
                const EvaluatorConstructor = evaluator.constructor as EasedEvaluatorConstructorOfType<VT>;
                const srcSeq = this.substitute(innerEasing.eventNodeSequence);
                const easing = evaluator.easing;
                const isSegmented = easing instanceof SegmentedEasing;
                const startValue = currentNode.value;
                const endValue = currentNode.next.value;
                const startTime = currentNode.time;
                const timeDelta = TC.sub(currentNode.next.time, startTime);


                let srcStart: number, srcEnd: number, leftDividedNodeSrc: EventStartNode, rightDividedNodeSrc: EventStartNode,
                    srcStartTime: TimeT, srcTimeDelta: TimeT, toStopAt: EventStartNode;
                if (isSegmented) {
                    const totalDuration = TC.sub(srcSeq.tail.previous!.time, srcSeq.head.next!.time);
                    srcStart = srcSeq.getValueAt(easing.left * srcSeq.effectiveBeats)
                    srcEnd = srcSeq.getValueAt(easing.right * srcSeq.effectiveBeats, true);
                    leftDividedNodeSrc = srcSeq.getNodeAt(easing.left * srcSeq.effectiveBeats);
                    rightDividedNodeSrc = srcSeq.getNodeAt(easing.right * srcSeq.effectiveBeats, true);
                    toStopAt = rightDividedNodeSrc.next.next!;
                    srcStartTime = TC.mul(totalDuration, numberToRatio(easing.left));
                    const srcEndTime = TC.mul(totalDuration, numberToRatio(easing.right));
                    TC.validateIp(srcStartTime);
                    TC.validateIp(srcEndTime);
                    srcTimeDelta = TC.sub(srcEndTime, srcStartTime);
                    TC.validateIp(srcTimeDelta);
                } else {
                    srcStart = srcSeq.head.next!.value;
                    srcEnd = srcSeq.tail.previous!.value;
                    leftDividedNodeSrc = srcSeq.head.next!;
                    rightDividedNodeSrc = srcSeq.tail.previous!.previous.previous!;
                    toStopAt = srcSeq.tail.previous!;
                    srcStartTime = srcSeq.head.next!.time;
                    srcTimeDelta = TC.sub(srcSeq.tail.previous!.time, srcStartTime);
                }
                
                const srcDelta = srcEnd - srcStart;
                const ratio = TC.div(timeDelta, srcTimeDelta)
                
                const convert: (v: number) => VT
                    = (value: number) => evaluator.convert(startValue, endValue, (value - srcStart) / srcDelta);
                // 我恨TS没有运算符重载
                const convertTime: (t: TimeT) => TimeT
                    = (time: TimeT) => TC.validateIp(TC.add(startTime, TC.mul(TC.sub(time, srcStartTime), ratio)));

                /** 目标序列中某次参与替换操作的第一个节点 */
                const first = currentNode.clone();
                EventNode.connect(currentPos, first)
                // 处理第一个节点的截段
                if (
                    isSegmented
                    && (
                        easing.left * srcSeq.effectiveBeats - TC.toBeats(leftDividedNodeSrc.time) > 1e-6
                    )
                ) {
                    const left = easing.left * srcSeq.effectiveBeats;
                    // 断言：这里left不会大于有效拍数
                    const newLeft = left / (TC.toBeats((leftDividedNodeSrc.next as EventEndNode).time) - TC.toBeats(leftDividedNodeSrc.time))
                    // 如果切到的这个位置是表达式求值器，这是没办法保留缓动的，只能运用表达式求值器
                    if (leftDividedNodeSrc.evaluator instanceof ExpressionEvaluator) {
                        throw err.CANNOT_DIVIDE_EXPRESSION_EVALUATOR(seq.id);
                    } else {
                        // 否则就是带缓动求值器
                        first.evaluator = evaluator.deriveWithEasing(
                            new SegmentedEasing((leftDividedNodeSrc.evaluator as NumericEasedEvaluator).easing, newLeft, 1.0)
                        ) as unknown as Evaluator<VT>;
                        // TypeScript Compiler我*你娘啊

                    }
                } else {
                    if (leftDividedNodeSrc.evaluator instanceof ExpressionEvaluator) {
                        throw err.CANNOT_DIVIDE_EXPRESSION_EVALUATOR(seq.id);
                    } else {
                        first.evaluator = evaluator.deriveWithEasing(
                            (leftDividedNodeSrc.evaluator as NumericEasedEvaluator).easing
                        ) as unknown as Evaluator<VT>;
                    }
                }
                let prev = first
                // 这里在到toStopAt之前一直都是非尾的
                for (let n: EventEndNode<number> = leftDividedNodeSrc.next as EventEndNode<number>; n.next !== toStopAt; ) {
                    const endNode = n;
                    const startNode = n.next;
                    // 断言：TSC不理解序列结构，这里截止得可能还早些，一定不是尾结点
                    n = startNode.next as EventEndNode<number>;
                    const newEnd = new EventEndNode(convertTime(endNode.time), convert(endNode.value));
                    const newStart = new EventStartNode(convertTime(startNode.time), convert(startNode.value));
                    if (startNode.evaluator instanceof ExpressionEvaluator) {
                        throw err.CANNOT_DIVIDE_EXPRESSION_EVALUATOR(seq.id);
                    } else {
                        newStart.evaluator = evaluator.deriveWithEasing(
                            (startNode.evaluator as NumericEasedEvaluator).easing,
                        ) as unknown as Evaluator<VT>;
                    }
                    EventNode.connect(prev, newEnd)
                    EventNode.connect(newEnd, newStart);
                    prev = newStart;
                }
                // 处理最后一个节点的截段
                if (
                      isSegmented
                    && (
                        TC.toBeats((rightDividedNodeSrc.next as EventEndNode).time) - easing.right * srcSeq.effectiveBeats > 1e-6
                    )
                ) {
                    const right = easing.right * srcSeq.effectiveBeats
                    // 断言：这里left不会大于有效拍数
                    const newRight = right / (TC.toBeats((rightDividedNodeSrc.next as EventEndNode).time) - TC.toBeats(rightDividedNodeSrc.time))
                    // 如果切到的这个位置是表达式求值器，这是没办法保留缓动的，只能运用表达式求值器
                    if (rightDividedNodeSrc.evaluator instanceof ExpressionEvaluator) {
                        throw err.CANNOT_DIVIDE_EXPRESSION_EVALUATOR(seq.id);
                    } else {
                        // 否则就是带缓动求值器
                        prev.evaluator = evaluator.deriveWithEasing(
                            new SegmentedEasing((rightDividedNodeSrc.evaluator as NumericEasedEvaluator).easing, 0.0, newRight)
                        ) as unknown as Evaluator<VT>;
                        // TypeScript Compiler我*你娘啊

                    }
                } else {
                    if (rightDividedNodeSrc.evaluator instanceof ExpressionEvaluator) {
                        throw err.CANNOT_DIVIDE_EXPRESSION_EVALUATOR(seq.id);
                    } else {
                        prev.evaluator = evaluator.deriveWithEasing(
                            (rightDividedNodeSrc.evaluator as NumericEasedEvaluator).easing
                        ) as unknown as Evaluator<VT>;
                    }
                }
                const endNode = currentNode.next.clone();
                EventNode.connect(prev, endNode);
                currentPos = endNode;
                endNode.value =  isSegmented ? endNode.value : convert((srcSeq.tail.previous!.previous as EventEndNode).value);
            } else {
                const newStartNode = currentNode.clone();
                const newEndNode = endNode.clone();
                EventNode.connect(currentPos, newStartNode)
                EventNode.connect(newStartNode, newEndNode);
                currentPos = newEndNode;
            }
            currentNode = endNode.next;
        }
        const lastStart = currentNode.clone();
        EventNode.connect(currentPos, lastStart);
        EventNode.connect(lastStart, newSeq.tail)
        return newSeq;
    }

    static replaceFilename(filename: string) {
        const arr = [];
        for (const char of filename) {
            if (char.charCodeAt(0) >= 128) {
                arr.push(`u(${char.charCodeAt(0).toString(16)})`);
            } else {
                arr.push(char);
            }
        }
        return arr.join("");
    }
}
// 现在是2025年10月18日，杨哲思已经改掉了此项目最史山的代码之一，但是还是一坨

/// #enddeclaration
