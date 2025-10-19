import type { Chart, JudgeLineGroup } from "./chart";
import { EventType, EventValueType, JudgeLineDataKPA2, NoteType, type EventDataRPELike, type EventLayerDataKPA, type JudgeLineDataKPA, type JudgeLineDataRPE, type NNListDataKPA, type NoteDataRPE, type RGB, type TimeT, type ValueTypeOfEventType } from "./chartTypes";
import type { TemplateEasingLib } from "./easing";
import { EventEndNode, EventNode, EventNodeLike, EventNodeSequence, EventStartNode, Monotonicity, SpeedENS } from "./event";
import { HNList, NNList, Note, NoteNode, NNNList } from "./note";
import { type TimeCalculator } from "./bpm";
import TC from "./time";
import { NodeType } from "./util";
import Environment, { err } from "./env";
/// #declaration:global

export interface EventLayer {
    moveX?: EventNodeSequence;
    moveY?: EventNodeSequence;
    rotate?: EventNodeSequence;
    alpha?: EventNodeSequence;
}

export interface ExtendedLayer {
    scaleX?: EventNodeSequence;
    scaleY?: EventNodeSequence;
    text?: EventNodeSequence<string>;
    color?: EventNodeSequence<RGB>;
}


/**
 * 奇谱发生器使用中心来表示一个NNList的y值偏移范围，这个函数根据yOffset算出对应中心值
 * @param yOffset 
 * @returns 
 */
const getRangeMedian = (yOffset: number) => {
    const NNLIST_Y_OFFSET_HALF_SPAN = Environment.NNLIST_Y_OFFSET_HALF_SPAN
    return (Math.floor((Math.abs(yOffset) - NNLIST_Y_OFFSET_HALF_SPAN) / NNLIST_Y_OFFSET_HALF_SPAN / 2) * (NNLIST_Y_OFFSET_HALF_SPAN * 2) + NNLIST_Y_OFFSET_HALF_SPAN * 2) * Math.sign(yOffset);
}



export class JudgeLine {
    texture: string;
    group: JudgeLineGroup;
    cover: boolean;
    hnLists = new Map<string, HNList>();
    nnLists = new Map<string, NNList>();
    eventLayers: EventLayer[] = [];
    speedSequence: SpeedENS;
    extendedLayer: ExtendedLayer = {};
    // notePosition: Float64Array;
    // noteSpeeds: NoteSpeeds;
    father: JudgeLine;
    children: Set<JudgeLine> = new Set();



    zOrder: number = 0;

    anchor: [number, number] = [0.5, 0.5];

    hasAttachUI: boolean = false;

    /**
     * 每帧渲染时所用的变换矩阵，缓存下来用于之后的UI绑定渲染
     * 
     * 已移除，谱面NPM包不需要这个，播放器侧如要使用，可以用同名接口扩展此类
     * @removed since 2.0.1
     */
    // renderMatrix: Matrix;

    rotatesWithFather: boolean = false;

    id: number;
    name: string = "Untitled";
    readonly chart: Chart;
    constructor(chart: Chart) {
        //this.notes = [];
        this.chart = chart;
        this.texture = "line.png";
        this.cover = true;
        // this.noteSpeeds = {};
    }
    static fromRPEJSON(chart: Chart, id: number, data: JudgeLineDataRPE, templates: TemplateEasingLib, timeCalculator: TimeCalculator) {
        const line = new JudgeLine(chart)
        line.id = id;
        line.name = data.Name;
        chart.judgeLineGroups[data.Group].add(line);
        line.cover = Boolean(data.isCover);
        line.rotatesWithFather = data.rotateWithFather;
        line.anchor = data.anchor ?? [0.5, 0.5];
        line.texture = data.Texture || "line.png";
        line.zOrder = data.zOrder ?? 0;

        // Process UI
        if (data.attachUI) {
            // Must use template string, otherwise TypeScript would not recognize it as `keyof Chart`
            // because the type is broadened to `string`
            // And you cannot assign it to a variable
            chart[`${data.attachUI}Attach` satisfies keyof Chart] = line;
            line.hasAttachUI = true;
        }

        const noteNodeTree = chart.nnnList;
        if (data.notes) {
            const holdLists = line.hnLists;
            const noteLists = line.nnLists;
            const notes = data.notes;
            notes.sort((n1: NoteDataRPE, n2: NoteDataRPE) => {
                if (TC.ne(n1.startTime, n2.startTime)) {
                    return TC.gt(n1.startTime, n2.startTime) ? 1 : -1
                }
                return TC.gt(n1.endTime, n2.endTime) ? -1 : 1 // 这里曾经排反了（
            })
            const len = notes.length;
            // let lastTime: TimeT = [-1, 0, 1];
            // let comboInfoEntity: ComboInfoEntity;
                    
            for (let i = 0; i < len; i++) {
                const note: Note = new Note(notes[i]);
                note.computeVisibleBeats(timeCalculator);
                const tree = line.getNNList(note.speed, note.yOffset, note.type === NoteType.hold, false)
                const cur = tree.currentPoint
                const lastHoldTime: TimeT = cur.type === NodeType.HEAD ? [-1, 0, 1] : cur.startTime
                if (TC.eq(lastHoldTime, note.startTime)) {
                    (tree.currentPoint as NoteNode).add(note)
                } else {
                    const node = new NoteNode(note.startTime)
                    node.add(note); // 这里之前没写，特此留念！
                    NoteNode.connect(tree.currentPoint, node)
                    tree.currentPoint = node;
                    noteNodeTree.addNoteNode(node);
                }
                tree.timesWithNotes++
            }
            for (const lists of [holdLists, noteLists]) {
                for (const [_, list] of lists) {
                    NoteNode.connect(list.currentPoint, list.tail)
                    list.initJump();
                    // tree.initPointers()
                }
            }
        }
        const eventLayers = data.eventLayers;
        const length = eventLayers.length;
        const createSequence = (type: EventType, events: EventDataRPELike[], index: number) =>  {
            if (events) {
                const seqId = `#${id}.${index}.${EventType[type]}`;
                const sequence = EventNodeSequence.fromRPEJSON(type, events, chart, seqId);
                sequence.id = seqId
                chart.sequenceMap.set(sequence.id, sequence);
                return sequence;
            }
        }
        const createExtendedSequence = <T extends EventType>(type: T, events: EventDataRPELike<ValueTypeOfEventType<T>>[]) =>  {
            if (events) {
                const seqId = `#${id}.ex.${EventType[type]}`;
                const sequence = EventNodeSequence.fromRPEJSON(type, events, chart, seqId);
                sequence.id = seqId;
                chart.sequenceMap.set(sequence.id, sequence);
                return sequence;
            }
        }
        const speedSequences: SpeedENS[] = [];
        for (let index = 0; index < length; index++) {
            const layerData = eventLayers[index];
            if (!layerData) {
                continue;
            }
            const layer: EventLayer = {
                moveX: createSequence(EventType.moveX, layerData.moveXEvents, index),
                moveY: createSequence(EventType.moveY, layerData.moveYEvents, index),
                rotate: createSequence(EventType.rotate, layerData.rotateEvents, index),
                alpha: createSequence(EventType.alpha, layerData.alphaEvents, index)
            };
            if (layerData.speedEvents) {
                const seq = createSequence(EventType.speed, layerData.speedEvents, index);
                speedSequences.push(seq as SpeedENS);
            }
            line.eventLayers[index] = layer;
        }
        if (speedSequences.length > 1) {
            line.speedSequence = EventNodeSequence.mergeSequences(speedSequences) as SpeedENS;
            line.speedSequence.updateFloorPositionAfter(line.speedSequence.head.next, timeCalculator);
        } else {
            line.speedSequence = chart.createEventNodeSequence(EventType.speed, `#${id}.speed`) as SpeedENS;
        }
        if (data.extended) {
            if (data.extended.scaleXEvents) {
                line.extendedLayer.scaleX = createExtendedSequence(EventType.scaleX, data.extended.scaleXEvents);
            } else {
                line.extendedLayer.scaleX = chart.createEventNodeSequence(EventType.scaleX, `#${id}.ex.scaleX`);
            }
            if (data.extended.scaleYEvents) {
                line.extendedLayer.scaleY = createExtendedSequence(EventType.scaleY, data.extended.scaleYEvents);
            } else {
                line.extendedLayer.scaleY = chart.createEventNodeSequence(EventType.scaleY, `#${id}.ex.scaleY`);
            }
            if (data.extended.textEvents) {
                line.extendedLayer.text = createExtendedSequence(EventType.text, data.extended.textEvents);
            }
            if (data.extended.colorEvents) {
                line.extendedLayer.color = createExtendedSequence(EventType.color, data.extended.colorEvents);
            }
        }
        // line.updateNoteSpeeds();
        // line.computeNotePositionY(timeCalculator);
        return line;
    }
    static fromKPAJSON(
        version: number,
        chart: Chart,
        id: number,
        data: JudgeLineDataKPA | JudgeLineDataKPA2,
        templates: TemplateEasingLib, 
        timeCalculator: TimeCalculator
    )
    {
        const withNewEventStructure = version >= 150;
        const independentSpeedENS = version >= 201;
        const lowerCaseNameAndTexture = version >= 201;

        const line = new JudgeLine(chart)
        line.id = id;
        line.name = lowerCaseNameAndTexture ? (data as JudgeLineDataKPA2).name : (data as JudgeLineDataKPA).Name;
        line.rotatesWithFather = data.rotatesWithFather;
        line.anchor = data.anchor ?? [0.5, 0.5];
        line.texture = (lowerCaseNameAndTexture ? (data as JudgeLineDataKPA2).texture : (data as JudgeLineDataKPA).Texture)  ?? "line.png";
        line.cover = data.cover ?? true;
        line.zOrder = data.zOrder ?? 0;



        chart.judgeLineGroups[data.group].add(line);
        const nnnList = chart.nnnList;
        for (const isHold of [false, true]) {
            const key: "hnLists" | "nnLists" = `${isHold ? "hn" : "nn"}Lists`
            const listsData: Record<string, NNListDataKPA>= data[key];
            for (const name in listsData) {
                const listData = listsData[name];
                if (withNewEventStructure) {
                        
                    const list = NNList.fromKPAJSON(isHold, chart.effectiveBeats, listData, nnnList, timeCalculator);
                    list.parentLine = line;
                    list.id = name;
                    // isHold为真则lists为Map<string, HNList>，且list为HNList，能够匹配
                    // @ts-expect-error 这里我也不知道怎么让它知道这里是匹配的
                    line[key].set(name, list);
                } else {
                    line.getNNListFromOldKPAJSON(line[key], name, isHold, chart.effectiveBeats, listData, nnnList, timeCalculator);
                }
            }
        }
        for (const child of data.children) {
            line.children.add(JudgeLine.fromKPAJSON(version, chart, child.id, child, templates, timeCalculator));
        }
        const unwrap = <VT>(sequence: EventNodeSequence<unknown>, predicate: (value: unknown) => boolean, typeStr: keyof typeof EventValueType) => {
            const value = sequence.head.next.value
            if (!predicate(value)) {
                throw err.EXPECTED_TYPED_ENS(typeStr, sequence.id, value);
            }
            return sequence as EventNodeSequence<VT>;
        }
        for (const eventLayerData of data.eventLayers) {
            const eventLayer: EventLayer = {} as EventLayer;
            for (const key in eventLayerData) {
                // use "fromRPEJSON" for they have the same logic
                eventLayer[key] = unwrap(chart.sequenceMap.get(eventLayerData[key]), v => typeof v === "number", "numeric");
            }
            line.eventLayers.push(eventLayer);
        }
        if (independentSpeedENS) {
            const seq = unwrap(
                chart.sequenceMap.get((data as JudgeLineDataKPA2).speedEventNodeSeq),
                v => typeof v === "number",
                "numeric"
            );
            line.speedSequence = seq as SpeedENS;
        } else {
            // 合并多个层级上的速度序列，合并完以后置空
            const oldSequences: SpeedENS[] = [];
            for (const layer of line.eventLayers) {
                const ly = layer as {speed: SpeedENS};
                if (ly.speed) {
                    oldSequences.push(ly.speed);
                    ly.speed = null;
                }
            }
            let seq: EventNodeSequence<number>;
            if (oldSequences.length > 0) {
                
                seq = EventNodeSequence.mergeSequences(
                    oldSequences
                );
                (seq as SpeedENS).updateFloorPositionAfter((seq as SpeedENS).head.next, timeCalculator);
            } else {
                seq = chart.createEventNodeSequence(EventType.speed, `#${line.id}.speed`);

            }
            line.speedSequence = seq as SpeedENS;
        }
        line.extendedLayer.scaleX = data.extended?.scaleXEvents
                                ? unwrap(chart.sequenceMap.get(
                                    data.extended.scaleXEvents),
                                    v => typeof v === "number",
                                    "numeric"
                                )
                                : chart.createEventNodeSequence(EventType.scaleX, `#${line.id}.ex.scaleX`);
        line.extendedLayer.scaleY = data.extended?.scaleYEvents
                                ? unwrap(chart.sequenceMap.get(
                                    data.extended.scaleYEvents),
                                    v => typeof v === "number",
                                    "numeric"
                                )
                                : chart.createEventNodeSequence(EventType.scaleY, `#${line.id}.ex.scaleY`);
        if (data.extended) {
            if (data.extended.textEvents) {
                line.extendedLayer.text = unwrap(chart.sequenceMap.get(data.extended.textEvents), v => typeof v === "string", "text");
            }
            if (data.extended.colorEvents) {
                line.extendedLayer.color = unwrap(chart.sequenceMap.get(data.extended.colorEvents), v => Array.isArray(v), "color");
            }
        }
        
        chart.judgeLines.push(line);
        return line;
    }
    getNNListFromOldKPAJSON(lists: Map<string, NNList>, namePrefix: string, isHold: boolean, effectiveBeats: number, listData: NNListDataKPA, nnnList: NNNList, timeCalculator: TimeCalculator) {
        const speed = listData.speed;
        const constructor = isHold ? HNList : NNList;
        const createdLists = new Set<NNList>();
        const getOrCreateNNList = (median: number, name: string) => {
            if (lists.has(name)) {
                return lists.get(name);
            }
            const list: NNList = new constructor(speed, median, effectiveBeats);
            list.id = name;
            list.parentLine = this;
            lists.set(name, list);
            createdLists.add(list);
            return list;
        };
        const nns = listData.noteNodes;
        const len = nns.length;
        for (let i = 0; i < len; i++) {
            const nodeData = nns[i];
            const l = nodeData.notes.length;
            for (let j = 0; j < l; j++) {
                const noteData = nodeData.notes[j];
                const note = new Note(noteData);
                const median = getRangeMedian(note.yOffset)
                const list = getOrCreateNNList(median, namePrefix + "o" + median);
                const cur = list.currentPoint;
                if (!note.visibleBeats) {
                    note.computeVisibleBeats(timeCalculator)
                }
                if (!(cur.type === NodeType.HEAD) && TC.eq(noteData.startTime, cur.startTime)) {
                    cur.add(note);
                } else {
                    const node = new NoteNode(noteData.startTime);
                    node.add(note);
                    NoteNode.connect(cur, node);
                    nnnList.addNoteNode(node);
                    list.currentPoint = node;
                }
            }
        }
        for (const list of createdLists) {
            NoteNode.connect(list.currentPoint, list.tail);
            list.initJump();
        }
    }
    getLayer(index: "0" | "1" | "2" | "3" | "ex") {
        if (index === "ex") {
            return this.extendedLayer;
        } else {
            return this.eventLayers[index];
        }
    }
    /*
    应该是古老代码，现在不用了，暂时不移除
    updateSpeedIntegralFrom(beats: number, timeCalculator: TimeCalculator) {
        for (const eventLayer of this.eventLayers) {
            eventLayer?.speed?.updateNodesIntegralFrom(beats, timeCalculator);
        }
    }
    //*/
    /**
     * 判定线当前所在的FloorPosition
     * 
     * 可以理解为：有一个假想的充满音符的瀑布流，判定线在其中或前进或后退
     */
    currentFloorPosition: number;
    cachedFloorPositions: Float64Array;
    computeCurrentFloorPosition(beats: number, timeCalculator: TimeCalculator) {
        this.currentFloorPosition = this.speedSequence.getFloorPositionAt(beats, timeCalculator);
    }
    getRelativeFloorPositionAt(beats: number, timeCalculator: TimeCalculator) {
        return this.speedSequence.getFloorPositionAt(beats, timeCalculator) - this.currentFloorPosition;
    }
    /**
     * 通过速度序列的FloorPosition反解出一个时间范围。
     * 
     * KPA内核代码中最大的一坨史山，没有之一。
     * 
     * 谱面渲染时最耗时的函数
     * 
     * startY and endY must not be negative
     * @param beats 
     * @param timeCalculator 
     * @param startY 
     * @param endY 
     * @returns 
     * /
    computeTimeRange(beats: number, timeCalculator: TimeCalculator , startY: number, endY: number): [number, number][] {
        //return [[0, Infinity]]
        //*
        // 提取所有有变化的时间点
        let times: number[] = [];
        const result: [number, number][] = [];
        for (const eventLayer of this.eventLayers) {
            const sequence = eventLayer?.speed;
            if (!sequence) {
                continue;
            }
            let node: EventStartNode = sequence.getNodeAt(beats);
            let endNode: EventEndNode | EventNodeLike<NodeType.TAIL>
            while (true) {
                times.push(TC.toBeats(node.time))
                if ((endNode = node.next).type === NodeType.TAIL) {
                    break;
                }

                node = endNode.next
            }
        }
        times = [...new Set(times)].sort((a, b) => a - b)
        const len = times.length;
        let nextTime = times[0]
        let nextPosY = this.getStackedFloorPosition(nextTime, timeCalculator)
        let nextSpeed = this.getStackedValue("speed", nextTime, true)
        let range: [number, number] = [undefined, undefined];
        // console.log(times)
        const computeTime = (speed: number, currentPos: number, fore: number) => timeCalculator.secondsToBeats(currentPos / (speed * 120) + timeCalculator.toSeconds(fore));
        for (let i = 0; i < len - 1;) {
            const thisTime = nextTime;
            const thisPosY = nextPosY;
            let thisSpeed = this.getStackedValue("speed", thisTime);
            if (Math.abs(thisSpeed) < 1e-8) {
                thisSpeed = 0; // 不这样做可能导致下面异号判断为真从而死循环
            }
            nextTime = times[i + 1]
            nextPosY = this.getStackedFloorPosition(nextTime, timeCalculator);
            nextSpeed = this.getStackedValue("speed", nextTime, true)
            // console.log(thisSpeed, nextSpeed, thisSpeed * nextSpeed < 0, i, [...result])
            if (thisSpeed * nextSpeed < 0) { // 有变号零点，再次切断，保证处理的每个区间单调性
                //debugger;
                nextTime = (nextTime - thisTime) * (0 - thisSpeed) / (nextSpeed - thisSpeed) + thisTime;
                nextSpeed = 0
                nextPosY = this.getStackedFloorPosition(nextTime, timeCalculator)
                //debugger
            } else {
                // console.log("i++")
                i++
            }
            if (range[0] === undefined) {
                // 变速区间直接全部囊括，匀速要算一下，因为好算
                /*
                设两个时间点的位置为a,b
                开始结束点为s,e
                选中小段一部分在区间内：
                a < s <= b
                或a > e >= b
                全部在区间内
                s <= a <= b
                * /
                if (thisPosY < startY && startY <= nextPosY
                || thisPosY > endY && endY >= nextPosY) {
                    range[0] = thisSpeed !== nextSpeed ? thisTime : computeTime(
                        thisSpeed,
                        (thisPosY < nextPosY ? startY : endY) - thisPosY, thisTime)
                } else if (startY <= thisPosY && thisPosY <= endY) {
                    range[0] = thisTime;
                }
            }
            // 要注意这里不能合成双分支if因为想要的Y片段可能在一个区间内
            if (range[0] !== undefined) {
                if (thisPosY < endY && endY <= nextPosY || thisPosY > startY && startY >= nextPosY) {
                    range[1] = thisSpeed !== nextSpeed ? nextTime : computeTime(
                        thisSpeed,
                        (thisPosY > nextPosY ? startY : endY) - thisPosY, thisTime)
                    result.push(range)
                    range = [undefined, undefined];
                }
            }
        }
        const thisPosY = nextPosY;
        const thisTime = nextTime;
        const thisSpeed = this.getStackedValue("speed", thisTime);
        const inf = thisSpeed > 0 ? Infinity : (thisSpeed < 0 ? -Infinity : thisPosY)
        if (range[0] === undefined) {
            // 变速区间直接全部囊括，匀速要算一下，因为好算
            if (thisPosY < startY && startY <= inf || thisPosY >= endY && endY > inf) {
                range[0] = computeTime(
                    thisSpeed,
                    (thisPosY < inf ? startY : endY) - thisPosY,
                    thisTime)
            } else if (thisSpeed === 0) {
                range[0] = 0;
            }
        }
        // 要注意这里不能合成双分支if因为想要的Y片段可能在一个区间内
        if (range[0] !== undefined) {
            if (thisPosY < endY && endY <= inf || thisPosY >= startY && startY > inf) {
                range[1] = computeTime(
                    thisSpeed,
                    (thisPosY > inf ? startY : endY) - thisPosY,
                    thisTime)
                result.push(range)
            } else if (thisSpeed === 0) {
                range[1] = Infinity;
                result.push(range)
            }
        }
        return result;
        //* /
    }*/
   /**
     * 通过速度序列的FloorPosition反解出一个时间范围。
     * 
     * KPA内核代码中最大的一坨史山，没有之一。
     * 
     * 谜面渲染时最耗时的函数
     * 
     * 调用此方法前需要先更新判定线当前的FP。
     * 
     * startY and endY must not be negative
     * @param beats 
     * @param timeCalculator 
     * @param startY 
     * @param endY 
     * @returns 
     */
    computeTimeRange(beats: number, timeCalculator: TimeCalculator, startY: number, endY: number): [number, number][] {
        //return [[0, Infinity]]
        //*
        const result: [number, number][] = [];
        
        // 直接使用speedSequence，不再遍历所有事件层
        if (!this.speedSequence) {
            return result;
        }
        const speedSequence = this.speedSequence;
        const lineMonotonicity = speedSequence.monotonicity ?? Monotonicity.swinging;

        const currentJudgeLineFloorPos = this.currentFloorPosition;
        
        // 获取起始节点
        let startNode: EventStartNode<number> = this.speedSequence.getNodeAt(beats);
        let range: [number, number] = [undefined, undefined];
        // 启用遮罩时，两个Y边界都是正数，直接返回空数组
        if (lineMonotonicity === Monotonicity.decreasing && startY >= 0 && endY > 0) {

            return result;
        }

        
        const computeTime = (speed: number, currentPos: number, fore: number) => 
            timeCalculator.secondsToBeats(currentPos / (speed * 120) + timeCalculator.toSeconds(fore));
        
        // 遍历所有事件节点直到结尾
        while (true) {
            const thisTime = TC.toBeats(startNode.time);
            const endNode = startNode.next;
            const nextStart = endNode.next;
            if (endNode.type === NodeType.TAIL) {
                // 处理最后一个节点到无穷大的情况
                const thisPosY = startNode.floorPosition - currentJudgeLineFloorPos;
                const thisSpeed = startNode.value;
                
                const inf = thisSpeed > 0 ? Infinity : (thisSpeed < 0 ? -Infinity : thisPosY);
                
                if (range[0] === undefined) {
                    if (thisPosY < startY && startY <= inf || thisPosY >= endY && endY > inf) {
                        range[0] = computeTime(
                            thisSpeed,
                            (thisPosY < inf ? startY : endY) - thisPosY,
                            thisTime)
                    } else if (thisSpeed === 0) {
                        range[0] = 0;
                    }
                }
                
                if (range[0] !== undefined) {
                    if (thisPosY < endY && endY <= inf || thisPosY >= startY && startY > inf) {
                        range[1] = computeTime(
                            thisSpeed,
                            (thisPosY > inf ? startY : endY) - thisPosY,
                            thisTime)
                        result.push(range)
                    } else if (thisSpeed === 0) {
                        range[1] = Infinity;
                        result.push(range)
                    }
                }
                break;
            }
        
            
            const nextTime = TC.toBeats(nextStart.time);
            
            const thisPosY = startNode.floorPosition - currentJudgeLineFloorPos;
            const nextPosY = nextStart.floorPosition - currentJudgeLineFloorPos;
            
            let thisSpeed = startNode.value;
            let nextSpeed = nextStart.value;
            
            if (Math.abs(thisSpeed) < 1e-8) {
                thisSpeed = 0;
            }
            
            if (Math.abs(nextSpeed) < 1e-8) {
                nextSpeed = 0;
            }
            
            // 处理速度变号的情况
            if (thisSpeed * nextSpeed < 0) {
                // 计算速度为0的时间点
                const zeroTime = (nextTime - thisTime) * (0 - thisSpeed) / (nextSpeed - thisSpeed) + thisTime;
                const zeroPosY = speedSequence.getFloorPositionAt(zeroTime, timeCalculator) - currentJudgeLineFloorPos;
                const zeroSpeed = 0;
                
                // 处理第一段(开始到零点)
                if (range[0] === undefined) {
                    if (thisPosY < startY && startY <= zeroPosY || thisPosY > endY && endY >= zeroPosY) {
                        range[0] = thisSpeed !== zeroSpeed ? thisTime : computeTime(
                            thisSpeed,
                            (thisPosY < zeroPosY ? startY : endY) - thisPosY, thisTime
                        );
                    } else if (startY <= thisPosY && thisPosY <= endY) {
                        range[0] = thisTime;
                    }
                }
                
                if (range[0] !== undefined) {
                    if (thisPosY < endY && endY <= zeroPosY || thisPosY > startY && startY >= zeroPosY) {
                        range[1] = thisSpeed !== zeroSpeed ? zeroTime : computeTime(
                            thisSpeed,
                            (thisPosY > zeroPosY ? startY : endY) - thisPosY, thisTime)
                        result.push(range);
                        if (lineMonotonicity !== Monotonicity.swinging) {
                            // 单调的FloorPosition函数只能产生一个符合条件的区间，可以提前返回达到优化目的
                            return result;
                        }
                        range = [undefined, undefined];
                    }
                }
                
                // 处理第二段(零点到结束)
                if (range[0] === undefined) {
                    if (zeroPosY < startY && startY <= nextPosY || zeroPosY > endY && endY >= nextPosY) {
                        range[0] = zeroSpeed !== nextSpeed ? zeroTime : computeTime(
                            nextSpeed,
                            (zeroPosY < nextPosY ? startY : endY) - zeroPosY, zeroTime)
                    } else if (startY <= zeroPosY && zeroPosY <= endY) {
                        range[0] = zeroTime;
                    }
                }
                
                if (range[0] !== undefined) {
                    if (zeroPosY < endY && endY <= nextPosY || zeroPosY > startY && startY >= nextPosY) {
                        range[1] = zeroSpeed !== nextSpeed ? nextTime : computeTime(
                            nextSpeed,
                            (zeroPosY > nextPosY ? startY : endY) - zeroPosY, zeroTime)
                        result.push(range)
                        if (lineMonotonicity !== Monotonicity.swinging) {
                            // 单调的FloorPosition函数只能产生一个符合条件的区间，可以提前返回达到优化目的
                            return result;
                        }
                        range = [undefined, undefined];
                    }
                }
            } else {
                // 正常情况处理
                if (range[0] === undefined) {
                    if (thisPosY < startY && startY <= nextPosY || thisPosY > endY && endY >= nextPosY) {
                        range[0] = thisSpeed !== nextSpeed ? thisTime : computeTime(
                            thisSpeed,
                            (thisPosY < nextPosY ? startY : endY) - thisPosY, thisTime)
                    } else if (startY <= thisPosY && thisPosY <= endY) {
                        range[0] = thisTime;
                    }
                }
                
                if (range[0] !== undefined) {
                    if (thisPosY < endY && endY <= nextPosY || thisPosY > startY && startY >= nextPosY) {
                        range[1] = thisSpeed !== nextSpeed ? nextTime : computeTime(
                            thisSpeed,
                            (thisPosY > nextPosY ? startY : endY) - thisPosY, thisTime)
                        result.push(range);
                        if (lineMonotonicity !== Monotonicity.swinging) {
                            // 单调的FloorPosition函数只能产生一个符合条件的区间，可以提前返回达到优化目的
                            return result;
                        }
                        range = [undefined, undefined];
                    }
                }
                // 我挺希望能够显式内联上面的……复用性也太低了
            }
            
            // 移动到下一个节点
            startNode = nextStart;
        }
        
        return result;
        //*/
    }

    /**
     * 
     * @deprecated 1.7.0
     * @param beats 
     * @param usePrev 如果取到节点，将使用EndNode的值。默认为FALSE
     * @returns 
     */
    getValues(beats: number, usePrev: boolean=false): [x: number, y: number, theta: number, alpha: number] {
        return [
            this.getStackedValue("moveX", beats, usePrev),
            this.getStackedValue("moveY", beats, usePrev),
            this.getStackedValue("rotate", beats, usePrev) / 180 * Math.PI, // 转换为弧度制
            this.getStackedValue("alpha", beats, usePrev),
        ]
    }
    getStackedValue(type: keyof EventLayer, beats: number, usePrev: boolean = false) {
        const length = this.eventLayers.length;
        let current = 0;
        for (let index = 0; index < length; index++) {
            const layer = this.eventLayers[index];
            if (!layer || !layer[type]) {
                break;
            }
            current += layer[type].getValueAt(beats, usePrev);
        }
        return current
    }
    /**
     * 获取指定时间点的FloorPosition。
     * 
     * <del>为了向后兼容，保留了多层速度事件的机制。</del>
     * 
     * 已经删除了多层速度事件
     * @param beats 
     * @param timeCalculator 
     * @returns 
     * /
    getStackedFloorPosition(beats: number, timeCalculator: TimeCalculator) {
        
        const length = this.eventLayers.length;
        let current = 0;
        for (let index = 0; index < length; index++) {
            const layer = this.eventLayers[index];
            if (!layer || !layer.speed) {
                break;
            }
            current += layer.speed.getFloorPositionAt(beats, timeCalculator);
        }
        // console.log("integral", current)
        return current;
    }//*/
    /**
     * 获取对应速度和类型的Note树,没有则创建
     */
    getNNList(speed: number, yOffset: number, isHold: boolean, initsJump: boolean) {
        const lists = isHold ? this.hnLists : this.nnLists;
        const medianYOffset = getRangeMedian(yOffset);
        for (const [_, list] of lists) {
            if (list.speed === speed && list.medianYOffset === medianYOffset) {
                return list;
            }
        }
        const list = isHold ? new HNList(speed, medianYOffset, this.chart.timeCalculator.duration) : new NNList(speed, medianYOffset, this.chart.timeCalculator.duration)
        list.parentLine = this;
        NoteNode.connect(list.head, list.tail)
        if (initsJump) list.initJump();
        const id = (isHold ? "$" : "#") + speed + "o" + medianYOffset;
        lists.set(id, list);
        list.id = id;
        return list;
    }
    getNode(note: Note, initsJump: boolean) {
        const speed = note.speed;
        const yOffset = note.yOffset;
        const isHold = note.type === NoteType.hold;
        const tree = this.getNNList(speed, yOffset, isHold, initsJump);
        return tree.getNodeOf(note.startTime);
    }
    /**
     * 
     * @param eventNodeSequences To Collect the sequences used in this line
     * @returns 
     */
    dumpKPA(eventNodeSequences: Set<EventNodeSequence<any>>, judgeLineGroups: JudgeLineGroup[]): JudgeLineDataKPA2 {
        const children: JudgeLineDataKPA2[] = [];
        for (const line of this.children) {
            children.push(line.dumpKPA(eventNodeSequences, judgeLineGroups))
        }
        const eventLayers: EventLayerDataKPA[] = [];
        for (let i = 0; i < this.eventLayers.length; i++) {
            const layer = this.eventLayers[i];
            if (!layer) continue;
            const layerData = {}
            for (const type in layer) {
                const sequence = layer[type as keyof EventLayer];
                if (!sequence) continue;
                eventNodeSequences.add(sequence);
                layerData[type] = sequence.id;
            }
            eventLayers.push(layerData as EventLayerDataKPA);
        }
        const hnListsData = {};
        const nnListsData = {};
        for (const [id, list] of this.hnLists) {
            hnListsData[id] = list.dumpKPA();
        }
        for (const [id, list] of this.nnLists) {
            nnListsData[id] = list.dumpKPA();
        }
        const extended = {
            scaleXEvents: this.extendedLayer.scaleX?.id,
            scaleYEvents: this.extendedLayer.scaleY?.id,
            textEvents: this.extendedLayer.text?.id,
            colorEvents: this.extendedLayer.color?.id,
        };
        eventNodeSequences.add(this.extendedLayer.scaleX)
        eventNodeSequences.add(this.extendedLayer.scaleY)
        
        if (this.extendedLayer.color) {
            eventNodeSequences.add(this.extendedLayer.color);
        }
        if (this.extendedLayer.text) {
            eventNodeSequences.add(this.extendedLayer.text);
        }
        return {
            group: judgeLineGroups.indexOf(this.group),
            id: this.id,
            name: this.name,
            texture: this.texture,
            anchor: this.anchor,
            rotatesWithFather: this.rotatesWithFather,
            children: children,
            eventLayers: eventLayers,
            speedEventNodeSeq: this.speedSequence?.id,
            hnLists: hnListsData,
            nnLists: nnListsData,
            cover: this.cover,
            extended: extended,
            zOrder: this.zOrder === 0 ? undefined : this.zOrder

        }
    }

    /*
    暂时不用此方法
    updateNNListFloorPositions() {
        for (const lists of [this.nnLists, this.hnLists]) {
            for (const list of lists) {

            }
        }
    }
        */
    
    updateEffectiveBeats(EB: number) {
        for (let i = 0; i < this.eventLayers.length; i++) {
            const layer = this.eventLayers[i];
            for (const type in layer) {
                const sequence = layer[type as keyof EventLayer];
                sequence.effectiveBeats = EB;
            }
        }
        for (const lists of [this.nnLists, this.hnLists]) {
            for (const [_, list] of lists) {
                list.effectiveBeats = EB;
            }
        }
    }
    static checkinterdependency(judgeLine: JudgeLine, toBeFather: JudgeLine) { 
        const descendantsAndSelf = new Set<JudgeLine>();
        const add = (line: JudgeLine) => {
            descendantsAndSelf.add(line);
            for (const child of line.children) {
                add(child);
            }
        }
        add(judgeLine);
        return descendantsAndSelf.has(toBeFather);
    }
}
/// #enddeclaration
