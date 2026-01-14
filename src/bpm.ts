import { EventType, type BPMSegmentData, type TimeT } from "./chartTypes";
import { EventEndNode, EventNodeLike, EventNodeSequence, EventStartNode, type AnyEN, type ENOrHead, type ENOrTail } from "./event";
import { JumpArray } from "./jumparray";
import { NodeType } from "./util";
import TC from "./time";


/// #declaration:global

/**
 * BPM起始节点类，表示BPM变化的开始点
 * 每个BPMStartNode代表一个BPM值的开始，直到下一个BPM节点
 */
export class BPMStartNode extends EventStartNode {
    /** 每拍的秒数(Seconds Per Beat) */
    spb: number;
    /** 缓存的起始积分值，用于时间计算 */
    cachedStartIntegral?: number;
    /** 缓存的积分值，用于时间计算 */
    cachedIntegral?: number;
    /** 下一个BPM结束节点或尾部节点 */
    override next: BPMEndNode | BPMNodeLike<NodeType.TAIL>;
    /** 上一个BPM结束节点或头部节点 */
    override previous: BPMEndNode | BPMNodeLike<NodeType.HEAD>;
    
    /**
     * 创建一个新的BPM起始节点
     * @param startTime 节点开始时间
     * @param bpm BPM值
     */
    constructor(startTime: TimeT, bpm: number) {
        super(startTime, bpm);
        this.spb = 60 / bpm;
    }
    
    /**
     * 计算指定拍数对应的秒数
     * @param beats 拍数
     * @returns 对应的秒数
     */
    getSeconds(beats: number): number {
        return (beats - TC.toBeats(this.time)) * 60 / this.value;
    }
    
    /**
     * 获取当前BPM段的完整持续时间（秒）
     * @this NonLastBPMStartNode 非最后一个BPM节点
     * @returns 当前BPM段的持续时间（秒）
     */
    getFullSeconds(this: NonLastBPMStartNode): number {
        return (TC.toBeats(this.next.time) - TC.toBeats(this.time)) * 60 / this.value;
    }
}

/**
 * BPM结束节点类，表示BPM段的结束点
 * 用于标记BPM段的结束位置
 */
export class BPMEndNode extends EventEndNode {
    /** 每拍的秒数(Seconds Per Beat) */
    spb: number;
    /** 前一个BPM起始节点 */
    override previous: BPMStartNode;
    /** 下一个BPM起始节点 */
    override next: BPMStartNode;
    
    /**
     * 创建一个新的BPM结束节点
     * @param endTime 节点结束时间
     */
    constructor(endTime: TimeT) {
        super(endTime, null);
    }
}

/** 非最后一个BPM起始节点类型 */
type NonLastBPMStartNode = BPMStartNode & { next: BPMEndNode };

/**
 * BPM节点接口，定义了BPM节点的基本结构
 */
interface BPMNodeLike<T extends NodeType> extends EventNodeLike<T> {
    /** 下一个节点 */
    next: [BPMStartNode, null, BNOrTail][T] | null;
    /** 上一个节点 */
    previous: [null, BPMStartNode, BNOrHead][T] | null;
}

/** BPM节点类型 */
type BPMNode = BPMStartNode | BPMEndNode;

/** 任意BPM节点类型 */
type AnyBN = (BPMNode | BPMNodeLike<NodeType.TAIL> | BPMNodeLike<NodeType.HEAD>);

/** BPM节点或尾部节点类型 */
type BNOrTail = BPMNode | BPMNodeLike<NodeType.TAIL>;

/** BPM节点或头部节点类型 */
type BNOrHead = BPMNode | BPMNodeLike<NodeType.HEAD>;

/**
 * BPM序列类，管理BPM变化序列
 * 拥有与事件类似的逻辑，每对节点之间代表一个BPM相同的片段
 * 片段之间BPM可以发生改变
 */
export class BPMSequence extends EventNodeSequence {
    /** 头部节点 */
    declare head: BPMNodeLike<NodeType.HEAD>;
    /** 尾部节点 */
    declare tail: BPMNodeLike<NodeType.TAIL>;
    /** 从拍数访问节点的跳转数组 */
    declare jump: JumpArray<AnyBN>;
    /** 以秒计时的跳转数组，处理从秒访问节点 */
    secondJump: JumpArray<AnyBN>;
    
    /**
     * 创建BPM序列
     * @param bpmList BPM片段数据列表
     * @param duration 总持续时间
     */
    constructor(bpmList: BPMSegmentData[], public duration: number) {
        super(EventType.bpm, null);
        let curPos: BPMNodeLike<NodeType.HEAD> | BPMEndNode = this.head;
        let next = bpmList[0];
        this.listLength = bpmList.length;
        for (let i = 1; i < bpmList.length; i++) {
            const each = next;
            next = bpmList[i];
            const startNode = new BPMStartNode(each.startTime, each.bpm);
            const endNode = new BPMEndNode(next.startTime);
            BPMStartNode.connect(startNode, endNode);
            BPMStartNode.connect(curPos, startNode);
            curPos = endNode;
        }
        const last = new BPMStartNode(next.startTime, next.bpm)
        BPMStartNode.connect(curPos, last);
        BPMStartNode.connect(last, this.tail);
        this.initJump();
    }
    
    /**
     * 初始化跳转数组
     */
    override initJump(): void {
        this.effectiveBeats = TC.toBeats(this.tail.previous.time)
        if (this.effectiveBeats !== 0) {
            super.initJump(); // 为0可以跳过jumpArray，用不到
            // 只有一个BPM片段就会这样
        }
        this.updateSecondJump();
    }
    
    /**
     * 更新秒跳转数组
     */
    updateSecondJump(): void {
        let integral = 0;
        // 计算积分并缓存到BPMNode
        let node: BPMStartNode = this.head.next;
        while (true) {
            node.cachedStartIntegral = integral;
            if (node.next.type === NodeType.TAIL) {
                break;
            }
            integral += (node as NonLastBPMStartNode).getFullSeconds();

            const endNode = <BPMEndNode>(<BPMStartNode>node).next;
            node.cachedIntegral = integral;

            node = endNode.next;
        }
        node.cachedStartIntegral = integral;
        if (this.effectiveBeats  === 0) {
            return;
        }
        const originalListLength = this.listLength;
        this.secondJump = new JumpArray<AnyBN>(
            this.head,
            this.tail,
            originalListLength,
            this.duration,
            (node: AnyBN) => {
                if (node.type === NodeType.TAIL) {
                    return [null, null];
                }
                if (node.type === NodeType.HEAD) {
                    return [0, node.next];
                }
                const endNode = <BPMEndNode>(<BPMStartNode>node).next;
                const time = node.cachedIntegral;
                const nextNode = endNode.next;
                if (nextNode.next.type === NodeType.TAIL) {
                    return [time, nextNode.next]; // Tailer代替最后一个StartNode去占位
                } else {
                    return [time, nextNode];
                }
            },
            (node: BPMStartNode, seconds: number) => {
                return node.cachedIntegral > seconds ? false : (<BPMEndNode>node.next).next;
            }
        );
    }
    
    /**
     * 更新跳转数组
     * @param from 起始节点
     * @param to 结束节点
     */
    override updateJump(from: ENOrHead, to: ENOrTail): void {
        super.updateJump(from, to);
        this.updateSecondJump();
    }

    /**
     * 根据秒数获取BPM起始节点
     * @param seconds 秒数
     * @returns 对应的BPM起始节点
     */
    getNodeBySeconds(seconds: number): BPMStartNode {
        if (this.effectiveBeats === 0) {
            return this.tail.previous
        }
        const node = this.secondJump.getNodeAt(seconds);
        if (node.type === NodeType.TAIL) {
            return node.previous;
        }
        return node as BPMStartNode;
    }
    
    /**
     * 导出BPM数据
     * @returns BPM片段数据数组
     */
    dumpBPM(): BPMSegmentData[] {
        let cur = this.head.next;
        const ret: BPMSegmentData[] = [];
        while (true) {
            ret.push({
                bpm: cur.value,
                startTime: cur.time
            })
            const end = cur.next;
            if (end.type === NodeType.TAIL) {
                break;
            }
            cur = end.next;
        } 
        return ret;
    }
    
    /**
     * 根据拍数获取节点
     * @param beats 拍数
     * @param usePrev 是否使用前一个节点
     * @returns 对应的BPM起始节点
     */
    getNodeAt(beats: number, usePrev?: boolean): BPMStartNode {
        return super.getNodeAt(beats, usePrev) as BPMStartNode;
    }
}

/**
 * 时间计算器类，用于处理拍数与秒数之间的转换
 */
export class TimeCalculator {
    /** BPM片段数据列表 */
    bpmList: BPMSegmentData[];
    /** BPM序列 */
    bpmSequence: BPMSequence;
    /** 总持续时间 */
    duration: number;

    /**
     * 创建时间计算器
     */
    constructor() {
    }

    /**
     * 初始化BPM序列
     */
    initSequence() {
        const bpmList = this.bpmList;
        this.bpmSequence = new BPMSequence(bpmList, this.duration);
    }
    
    /**
     * 将拍数转换为秒数
     * @param beats 拍数
     * @returns 对应的秒数
     */
    toSeconds(beats: number) {
        const node: BPMStartNode = this.bpmSequence.getNodeAt(beats);
        return node.cachedStartIntegral + node.getSeconds(beats)
    }
    
    /**
     * 获取从beats1到beats2的秒数
     * @param beats1 起始拍数
     * @param beats2 结束拍数
     * @returns 两拍数之间的秒数差
     */
    segmentToSeconds(beats1: number, beats2: number): number {
        const ret = this.toSeconds(beats2) - this.toSeconds(beats1)
        return ret
    }
    
    /**
     * 将秒数转换为拍数
     * @param seconds 秒数
     * @returns 对应的拍数
     */
    secondsToBeats(seconds: number) {
        const node = this.bpmSequence.getNodeBySeconds(seconds);
        // console.log("node:", node)
        const beats = (seconds - node.cachedStartIntegral) / node.spb;
        return TC.toBeats(node.time) + beats
    }
    
    /**
     * 导出BPM数据
     * @returns BPM片段数据数组
     */
    dump(): BPMSegmentData[] {
        return this.bpmSequence.dumpBPM();
    }

}


/// #enddeclaration