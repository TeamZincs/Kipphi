import { EventType, InterpreteAs, VideoScale, type TimeT, type VideoEventNodeDataKPA2, type VideoEventNodeSequenceDataKPA2 } from "./chartTypes";
import type { PhiraVideo } from "./extraTypes";
import { EventEndNode, EventNode, EventNodeLike, EventNodeSequence, EventStartNode } from "./event";
import { CONST_EVALUATOR } from "./evaluator";
import { fixedEasing } from "./easing";
import { NodeType } from "./util";
import TC from "./time";
import { err } from "./env";

/// #declaration:global

/**
 * 与{@linkcode VideoScale}一一对应的Phira缩放模式字符串
 */
export const PHIRA_VIDEO_SCALES = ["cropCenter", "inside", "fit"] as const;

/**
 * 将{@linkcode VideoScale}转换为Phira的缩放模式字符串
 */
export const toPhiraScale = (scale: VideoScale) =>
    PHIRA_VIDEO_SCALES[scale] ?? PHIRA_VIDEO_SCALES[VideoScale.cropCenter];

/**
 * 将Phira的缩放模式字符串转换为{@linkcode VideoScale}
 */
export const fromPhiraScale = (scale: string): VideoScale => {
    const index = PHIRA_VIDEO_SCALES.indexOf(scale as typeof PHIRA_VIDEO_SCALES[number]);
    return index < 0 ? VideoScale.cropCenter : index;
};

/**
 * 视频事件起始节点
 *
 * 与{@linkcode EventStartNode}的区别：多了一个{@linkcode scale}字段，
 * 且节点到下一节点之间视频恒定（没有缓动的意义）。
 *
 * @since 2.2.0
 */
export class VideoEventStartNode extends EventStartNode<string> {
    /** 视频缩放模式 */
    scale: VideoScale = VideoScale.cropCenter;
    override next!: VideoEventEndNode | EventNodeLike<NodeType.TAIL, string>;
    override previous!: VideoEventEndNode | EventNodeLike<NodeType.HEAD, string>;
    /**
     * @param time 节点时间
     * @param value 视频路径，空串表示无视频
     * @param scale 缩放模式
     */
    constructor(time: TimeT, value: string, scale: VideoScale = VideoScale.cropCenter) {
        super(time, value);
        this.scale = scale;
        // 视频段内恒定的值，缓动没有任何意义
        // @ts-expect-error 去哪那么多规矩啊
        this.evaluator = CONST_EVALUATOR;
    }
    override clone(offset?: TimeT): VideoEventStartNode {
        const ret = super.clone(offset) as VideoEventStartNode;
        ret.scale = this.scale;
        return ret;
    }
}

/**
 * 视频事件结束节点
 *
 * 与{@linkcode EventEndNode}的区别：值和缩放模式都代理到前一个起始节点，
 * 因为视频在段内是恒定的。（与{@linkcode BPMEndNode}的做法一致）
 *
 * @since 2.2.0
 */
export class VideoEventEndNode extends EventEndNode<string> {
    override previous!: VideoEventStartNode;
    override next!: VideoEventStartNode;

    // @ts-expect-error 强加一个getter
    override get value(): string {
        return this.previous.value;
    }
    override set value(value: string) {
        if (!this.previous) { return; }
        this.previous.value = value;
    }
    /** 缩放模式同样代理到前一个起始节点 */
    get scale(): VideoScale {
        return this.previous.scale;
    }
    set scale(scale: VideoScale) {
        if (!this.previous) { return; }
        this.previous.scale = scale;
    }
    constructor(time: TimeT) {
        super(time, "");
    }
}

/** 视频段，即一个视频的播放区间 */
export interface VideoSegment {
    /** 该视频段的起始节点 */
    node: VideoEventStartNode;
    /** 起始拍数 */
    startBeats: number;
    /** 结束拍数。最后一个视频段为Infinity */
    endBeats: number;
}

/**
 * 视频事件节点序列
 *
 * 结构与{@linkcode EventNodeSequence}完全一致（背靠背的Start/End对），
 * 但序列的语义是阶梯型的：节点处切换视频，节点之间视频恒定。
 *
 * 序列中的第一个节点必定位于[0, 0, 1]，缺失时会自动补一个空路径节点。
 *
 * ```
 * HEAD -> VS0(t=0) -> VE0(t1) -> VS1(t1) -> VE1(t2) -> ... -> VSn -> TAIL
 * ```
 *
 * 与事件序列不同，本序列使用独立的{@linkcode VideoEventNodeSequenceDataKPA2}格式，
 * 不导出求值器、宏和final节点。
 *
 * @since 2.2.0
 */
// @ts-expect-error 去，哪那么多规矩啊.png
export class VideoEventNodeSequence extends EventNodeSequence<string> {
    constructor(effectiveBeats: number) {
        super(EventType.video, effectiveBeats);
    }
    /**
     * 创建一个仅含一个空路径节点的视频序列
     */
    static newVideoSeq(effectiveBeats: number): VideoEventNodeSequence {
        const sequence = new VideoEventNodeSequence(effectiveBeats);
        const node = new VideoEventStartNode([0, 0, 1], "");
        EventNode.connect(sequence.head, node);
        EventNode.connect(node, sequence.tail);
        sequence.listLength = 1;
        sequence.initJump();
        return sequence;
    }
    /**
     * 从KPA2数据创建视频事件节点序列
     * @param data
     * @param effectiveBeats 谱面有效拍数
     * @param pos 用于报错的位置标识
     */
    static fromKPA2JSON(
        data: VideoEventNodeSequenceDataKPA2 | null | undefined,
        effectiveBeats: number,
        pos: string = "video.name"
    ): VideoEventNodeSequence {
        const sequence = new VideoEventNodeSequence(effectiveBeats);
        const raw = (data?.events ?? []).slice();
        raw.sort((a, b) => TC.cmp(a.time, b.time));
        // 序列可以为空，此时补一个位于0时刻的空路径节点
        if (!raw.length || TC.ne(raw[0]!.time, [0, 0, 1])) {
            raw.unshift({ time: [0, 0, 1], value: "", scale: VideoScale.cropCenter });
        }
        // 剔除时间不递增的节点
        const events: VideoEventNodeDataKPA2[] = [];
        let lastTime: TimeT | null = null;
        for (let i = 0; i < raw.length; i++) {
            const event = raw[i]!;
            if (lastTime && !TC.gt(event.time, lastTime)) {
                err.EVENT_NODE_TIME_NOT_INCREMENTAL(`${pos}.events[${i}]`)
                    .warn(new VideoEventStartNode(event.time, event.value ?? ""));
                continue;
            }
            lastTime = event.time;
            events.push(event);
        }
        let previous: VideoEventEndNode | null = null;
        for (let i = 0; i < events.length; i++) {
            const event = events[i]!;
            const start = new VideoEventStartNode(
                event.time,
                event.value ?? "",
                event.scale ?? VideoScale.cropCenter
            );
            if (previous) {
                EventNode.connect(previous, start);
            } else {
                EventNode.connect(sequence.head, start);
            }
            const next = events[i + 1];
            if (!next) {
                // 最后一个起始节点直接连到尾节点，它的值无限延伸
                EventNode.connect(start, sequence.tail);
                break;
            }
            previous = new VideoEventEndNode(next.time);
            EventNode.connect(start, previous);
        }
        sequence.listLength = events.length;
        sequence.initJump();
        return sequence;
    }
    /**
     * 从Phira的extra.json视频列表创建视频事件节点序列
     *
     * 视频的alpha与dim不在这里处理，它们是全谱拉通的独立序列。
     *
     * @param videos Phira视频列表
     * @param effectiveBeats 谱面有效拍数
     * @since 2.2.0
     */
    static fromPhiraVideos(
        videos: PhiraVideo[] | null | undefined,
        effectiveBeats: number,
        pos: string = "video.name"
    ): VideoEventNodeSequence {
        return VideoEventNodeSequence.fromKPA2JSON({
            id: "@video.name",
            events: (videos ?? []).map(video => ({
                time: video.time,
                value: video.path,
                scale: fromPhiraScale(video.scale)
            }))
        }, effectiveBeats, pos);
    }
    /**
     * 导出为KPA2数据
     */
    dumpVideo(): VideoEventNodeSequenceDataKPA2 {
        const events: VideoEventNodeDataKPA2[] = [];
        let node = this.head.next as VideoEventStartNode;
        while (true) {
            events.push({
                time: [...node.time] as TimeT,
                value: node.value,
                scale: node.scale
            });
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                break;
            }
            node = end.next;
        }
        return {
            events,
            id: this.id
        };
    }
    /**
     * 依次遍历所有视频段
     */
    *segments(): Generator<VideoSegment> {
        let node = this.head.next as VideoEventStartNode;
        while (true) {
            const end = node.next;
            if (end.type === NodeType.TAIL) {
                yield { node, startBeats: TC.toBeats(node.time), endBeats: Infinity };
                return;
            }
            yield { node, startBeats: TC.toBeats(node.time), endBeats: TC.toBeats(end.time) };
            node = end.next;
        }
    }
    /**
     * 获取指定拍数处的缩放模式
     */
    getScaleAt(beats: number): VideoScale {
        return (this.getNodeAt(beats) as VideoEventStartNode).scale;
    }
}

/// #enddeclaration
