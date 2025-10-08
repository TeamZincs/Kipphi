import { EventType, type BPMSegmentData, type TimeT } from "./chartTypes";
import { EventEndNode, EventNodeLike, EventNodeSequence, EventStartNode, type AnyEN, type ENOrHead, type ENOrTail } from "./event";
import { JumpArray } from "./jumparray";
import { NodeType } from "./util";
import TC from "./time";


/// #declaration:global

/**
 * 
 */
export class BPMStartNode extends EventStartNode {
    spb: number;
    cachedStartIntegral?: number;
    override cachedIntegral?: number;
    override next: BPMEndNode | BPMNodeLike<NodeType.TAIL>;
    override previous: BPMEndNode | BPMNodeLike<NodeType.HEAD>;
    constructor(startTime: TimeT, bpm: number) {
        super(startTime, bpm);
        this.spb = 60 / bpm;
    }
    getSeconds(beats: number): number {
        return (beats - TC.toBeats(this.time)) * 60 / this.value;
    }
    getFullSeconds(this: NonLastBPMStartNode): number {
        return (TC.toBeats(this.next.time) - TC.toBeats(this.time)) * 60 / this.value;
    }
}
export class BPMEndNode extends EventEndNode {
    spb: number;
    override previous: BPMStartNode;
    override next: BPMStartNode;
    constructor(endTime: TimeT) {
        super(endTime, null);
    }
}

type NonLastBPMStartNode = BPMStartNode & { next: BPMEndNode };

interface BPMNodeLike<T extends NodeType> extends EventNodeLike<T> {
    next: [BPMStartNode, null, BNOrTail][T] | null;
    previous: [null, BPMStartNode, BNOrHead][T] | null;
}
type BPMNode = BPMStartNode | BPMEndNode;
type AnyBN = (BPMNode | BPMNodeLike<NodeType.TAIL> | BPMNodeLike<NodeType.HEAD>);
type BNOrTail = BPMNode | BPMNodeLike<NodeType.TAIL>;
type BNOrHead = BPMNode | BPMNodeLike<NodeType.HEAD>;

/**
 * 拥有与事件类似的逻辑
 * 每对节点之间代表一个BPM相同的片段
 * 片段之间BPM可以发生改变
 */

export class BPMSequence extends EventNodeSequence {
    declare head: BPMNodeLike<NodeType.HEAD>;
    declare tail: BPMNodeLike<NodeType.TAIL>;
    /** 从拍数访问节点 */
    override jump: JumpArray<AnyEN>;
    /** 以秒计时的跳数组，处理从秒访问节点 */
    secondJump: JumpArray<AnyBN>;
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
    override initJump(): void {
        console.log(this)
        this.effectiveBeats = TC.toBeats(this.tail.previous.time)
        if (this.effectiveBeats !== 0) {
            super.initJump(); // 为0可以跳过jumpArray，用不到
            // 只有一个BPM片段就会这样
        }
        this.updateSecondJump();
    }
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
            (node: BPMStartNode) => {
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
    override updateJump(from: ENOrHead, to: ENOrTail): void {
        super.updateJump(from, to);
        this.updateSecondJump();
    }

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
    getNodeAt(beats: number, usePrev?: boolean): BPMStartNode {
        return super.getNodeAt(beats, usePrev) as BPMStartNode;
    }
}

export class TimeCalculator {
    bpmList: BPMSegmentData[];
    bpmSequence: BPMSequence;
    duration: number;

    constructor() {
    }

    initSequence() {
        const bpmList = this.bpmList;
        this.bpmSequence = new BPMSequence(bpmList, this.duration);
    }
    toSeconds(beats: number) {
        const node: BPMStartNode = this.bpmSequence.getNodeAt(beats);
        return node.cachedStartIntegral + node.getSeconds(beats)
    }
    /**
     * 获取从beats1到beats2的秒数
     * @param beats1 
     * @param beats2 
     * @returns 
     */
    segmentToSeconds(beats1: number, beats2: number): number {
        const ret = this.toSeconds(beats2) - this.toSeconds(beats1)
        return ret
    }
    secondsToBeats(seconds: number) {
        const node = this.bpmSequence.getNodeBySeconds(seconds);
        // console.log("node:", node)
        const beats = (seconds - node.cachedStartIntegral) / node.spb;
        return TC.toBeats(node.time) + beats
    }
    dump(): BPMSegmentData[] {
        return this.bpmSequence.dumpBPM();
    }

}


/// #enddeclaration
