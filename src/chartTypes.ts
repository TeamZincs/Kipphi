

/// #declaration:global

/** 尽管JSON中有布尔值字面量，RPEJSON中没有使用它 */
export type Bool = 1 | 0
/** 三元组，用带分数表示的时间 */
export type TimeT = [number, number, number]
export type RGB = [number, number, number]
export interface ChartDataRPE {
    /** BPM列表 */
    BPMList: BPMSegmentData[];
    /** 元数据 */
    META: MetaData;
    /** 判定线组 */
    judgeLineGroup: string[];
    /** 判定线列表 */
    judgeLineList: JudgeLineDataRPE[];
    chartTime?: number;
    kpaChartTime?: number;
    multiLineString: string;
    multiScale: number;

}

export interface BPMSegmentData {
    bpm: number;
    startTime: TimeT;
    // endTime?: TimeT;
}
export interface MetaData {
    /** RPE版本（int） */
    RPEVersion: number;
    /** 背景图片路径 */
    background: string;
    /** 画师名称 */
    illustration: string;
    /** 谱师名称 */
    charter: string;
    /** 曲师名称 */
    composer: string;
    /** 谱面ID，即Resources文件夹下的文件夹名称 */
    id: string;
    /** 谱面难度 */
    level: string;
    /** 谱面名称 */
    name: string;
    /** 谱面偏移（以毫秒计量） */
    offset: number;
    /** 音乐文件路径 */
    song: string;
    /** 音乐时长（1.6(存疑)新增） */
    duration?: number;
}

export interface NoteDataRPE {
    /** 音符是否在判定线上方 （2为下方） */
    above: Bool | 2;
    /** 音符不透明度 */
    alpha: number;
    /** 音符结束时间，无论是否为Hold都有该属性 */
    endTime: TimeT;
    /** 音符是否为假 */
    isFake: Bool;
    /** 音符在判定线上落点位置 */
    positionX: number;
    /** 音符大小（默认1.0） */
    size: number;
    /** 音符速度 */
    speed: number;
    /** 音符开始时间 */
    startTime: TimeT;
    /** 音符类型（1 为 Tap，2 为 Hold，3 为 Flick，4 为 Drag）*/
    type: NoteType;
    /** 音符可视时间（打击前多少秒开始显现，默认99999.0） */
    visibleTime: number;
    /** y值偏移，使音符被打击时的位置偏离判定线 */
    yOffset: number;

    // 下面是PhiZone Player扩展的内容
    /** Sets the Z index for the object. */
    zIndex?: number;
    /**
     * Sets the Z index for the hit effects of the note. Defaults to 7.
     */
    zIndexHitEffects?: number;
    /** Sets the tint for the hit effects of the note. Defaults to null. */
    tint?: RGB;
    tintHitEffects?: RGB;
    
    /** Determines the width of the judgment area of the note. Defaults to size. */
    judgeSize?: number;
}

export interface NoteDataKPA {
    /** 音符是否在判定线上方 （2为下方） */
    above: Bool | 2;
    /** 音符不透明度 */
    alpha: number;
    /** 音符结束时间，无论是否为Hold都有该属性 */
    endTime: TimeT;
    /** 音符是否为假 */
    isFake: Bool;
    /** 音符在判定线上落点位置 */
    positionX: number;
    /** 音符大小（默认1.0） */
    size: number;
    /** 音符速度 */
    speed: number;
    /** 音符开始时间 */
    startTime: TimeT;
    /** 音符类型（1 为 Tap，2 为 Hold，3 为 Flick，4 为 Drag）*/
    type: NoteType;
    /** 音符可视时间（打击前多少秒开始显现，默认99999.0） */
    visibleTime?: number;
    /** y值偏移，使音符被打击时的位置偏离判定线 */
    yOffset: number;

    // 下面是PhiZone Player扩展的内容
    /** Sets the Z index for the object. */
    zIndex?: number;
    /**
     * Sets the Z index for the hit effects of the note. Defaults to 7.
     */
    zIndexHitEffects?: number;
    /** Sets the tint for the hit effects of the note. Defaults to null. */
    tint?: RGB;
    tintHitEffects?: RGB;
    
    /** Determines the width of the judgment area of the note. Defaults to size. */
    judgeSize?: number;
    visibleBeats?: number;
    absoluteYOffset: number;
}

/** 事件 */
export interface EventDataRPELike<T = number> {
    /** 是否使用贝塞尔曲线 */
    bezier: Bool;
    /** 贝塞尔控制点 */
    bezierPoints: [number, number, number, number];
    /** 截取缓动左边界 */
    easingLeft: number;
    /** 截取缓动右边界 */
    easingRight: number;
    /** 缓动类型 */
    easingType: number | string;
    /** 结束值 */
    end: T;
    /** 结束时间 */
    endTime: TimeT;
    /** 链接组 */
    linkgroup: number;
    /** 开始值 */
    start: T;
    /** 开始时间 */
    startTime: TimeT;
}

// 不得更改数值
export enum InterpreteAs {
    str = 0,
    int = 1,
    float = 2
}


// 多年才想起来，根本没做参数方程缓动的相关适配

export interface EventDataKPA<T = number> extends EventDataRPELike<T> {
    /** 若设为真，则easingType当做JS表达式解读 */
    isParametric?: boolean;
    interpreteAs?: InterpreteAs;
}

export enum EasingType {
    normal,
    template,
    bezier,
    segmented,
    wrapper
}

export interface NormalEasingData {
    type: EasingType.normal
    identifier: number;
}

export interface TemplateEasingData {
    identifier: string;
    type: EasingType.template;
}

export interface WrapperEasingData {
    type: EasingType.wrapper;
    identifier: string;
}

export interface BezierEasingData {
    type: EasingType.bezier;
    bezier: [number, number, number, number];
}

export interface SegmentedEasingData {
    type: EasingType.segmented;
    left: number;
    right: number;
    inner: EasingDataKPA2;
}

export type EasingDataKPA2 = NormalEasingData | TemplateEasingData | BezierEasingData | SegmentedEasingData | WrapperEasingData;

export enum EvaluatorType {
    eased,
    expressionbased
}

// Eased

interface EasedEvaluatorDataKPA2<T> {
    type: EvaluatorType.eased;
    easing: EasingDataKPA2;
}

export type NumericEasedEvaluatorKPA2 = EasedEvaluatorDataKPA2<number>;
export type ColorEasedEvaluatorKPA2 = EasedEvaluatorDataKPA2<RGB>;
export interface TextEasedEvaluatorKPA2 extends EasedEvaluatorDataKPA2<string> {
    interpretedAs: InterpreteAs;
}

export type EasedEvaluatorDataOfType<T> = T extends number ? NumericEasedEvaluatorKPA2 : T extends RGB ? ColorEasedEvaluatorKPA2 : TextEasedEvaluatorKPA2;

// Expression-based

export interface ExpressionEvaluatorDataKPA2 {
    type: EvaluatorType.expressionbased;
    jsExpr: string;
}


export type EvaluatorDataKPA2<T> = EasedEvaluatorDataOfType<T> | ExpressionEvaluatorDataKPA2;
export interface EventDataKPA2<T = number> {
    startTime: TimeT;
    endTime: TimeT;
    start: T;
    end: T;
    evaluator: EvaluatorDataKPA2<T>;
}

export enum EventValueType {
    numeric,
    color,
    text,
}

export type EventValueTypeOfType<T extends EventValueESType> = T extends number ? EventValueType.numeric : T extends RGB ? EventValueType.color : EventValueType.text;
export type EventValueESType = string | number | RGB
/**
 * 五个种类的事件的start/end含义：
 * X/Y方向移动：像素
 * 旋转：角度（以度计）
 * 不透明度改变：不透明度（0-255的整数）
 * 速度改变：RPE速度单位（每个单位代表每秒下降120px）
 */

/** 每条判定线的前四个事件层级。第五个是特殊事件，这里没有列入 */
export interface EventLayerDataRPE {
    moveXEvents?: EventDataRPELike[];
    moveYEvents?: EventDataRPELike[];
    rotateEvents?: EventDataRPELike[];
    alphaEvents?: EventDataRPELike[];
    speedEvents?: EventDataRPELike[];
}



export interface Control {
    easing: number;
    x: number;
}

export interface AlphaControl extends Control {
    alpha: number;
}
export interface PosControl extends Control {
    pos: number;
}
export interface SizeControl extends Control {
    size: number;
}
export interface SkewControl extends Control {
    skew: number;
}
export interface YControl extends Control {
    y: number;
}

/** 判定线 */
export interface JudgeLineDataRPE {
    /** 音符数据
     * 对音符的顺序没有要求，但RPE生成的标准RPEJSON中应当按照时间升序排列，
     * 且非Hold类型与Hold分开排列，非Hold在前
     */
    notes: NoteDataRPE[];
    /** 所在的判定线组，对应judgeLineGroup数组中的字符串的下标 */
    Group: number;
    /** 线名 */
    Name: string;
    /** 纹理图片的路径 */
    Texture: string;
    /** BPM因数 */
    bpmfactor: 1.0;
    /** 事件层级，这里没有介绍第五个 */
    eventLayers: (EventLayerDataRPE | null)[];
    /** 扩展事件 */
    extended?: {
        colorEvents?: EventDataRPELike<RGB>[];
        inclineEvents?: EventDataRPELike[];
        scaleXEvents?: EventDataRPELike[];
        scaleYEvents?: EventDataRPELike[];
        textEvents?: EventDataRPELike<string>[];
        gifEvents?: EventDataRPELike<number>[];
    };
    /** 父线线号，没有父线则为-1 */
    father: number;
    /** 有无遮罩 */
    isCover: Bool;
    /** 音符数量 */
    numOfNotes: number;

    alphaControl?: AlphaControl[];
    posControl?: PosControl[];
    sizeControl?: SizeControl[];
    skewControl?: SkewControl[];
    yControl?: YControl[];
    /** z轴顺序，决定重叠的顺序 */
    zOrder?: number;

    // 锚点相对于贴图的位置
    anchor: [number, number];

    /** 背景是否为GIF */
    isGif: Bool;

    rotateWithFather?: boolean;
    attachUI?: "pause" | "combonumber" | "combo" | "score" | "bar" | "name" | "level";

    /** Decides how scaleX events affect notes. Defaults to 0.
     * 0: none; 1: scale; 2: clip
    */
    scaleOnNotes?: 0 | 1 | 2;
    /** Decides how the line will be displayed when a UI component or any video is attached to it.
     * Color events will override the color defined by these options. Defaults to 0.
     * 0: hidden; 1: white colored; 2: FC/AP colored
     */
    appearanceOnAttach?: 0 | 1 | 2;
    /** Sets the Z index for the object.
     * For a judgeline, this property, if set, overrides the zOrder property,
     * allowing for more control over on which layer the line should be displayed. */
    zIndex?: number;
}



export interface TemplateEasingBodyData {
    content: string;
    name: string;
    // usedBy: string[];
    // dependencies: string[];
}



// 使用对应标识符来标记事件节点序列

export interface EventLayerDataKPA {
    moveX: string;
    moveY: string;
    rotate: string;
    alpha: string;
    speed: string;
}

export interface EventLayerDataKPA2 {
    moveX: string;
    moveY: string;
    rotate: string;
    alpha: string;
    // 移除了速度事件可以有多层的性质
}


export interface NoteNodeDataKPA {
    notes: NoteDataKPA[];
    startTime: TimeT;
}

export interface NNListDataKPA {
    speed: number;
    medianYOffset: number;
    noteNodes: NoteNodeDataKPA[];
}

export interface JudgeLineDataKPA {
    cover: boolean;
    id: number;
    group: number;
    nnLists: {[k: string]: NNListDataKPA};
    hnLists: {[k: string]: NNListDataKPA};
    Name: string;
    Texture: string;
    eventLayers: EventLayerDataKPA[];
    children: JudgeLineDataKPA[];
    rotatesWithFather: boolean;

    anchor: [number, number];
    extended?: {
        scaleXEvents: string;
        scaleYEvents: string;
        textEvents?: string;
        colorEvents?: string;
    }
    zOrder: number;
}

export interface JudgeLineDataKPA2 {
    cover: boolean;
    id: number;
    group: number;
    nnLists: {[k: string]: NNListDataKPA};
    hnLists: {[k: string]: NNListDataKPA};
    name: string;
    texture: string;
    eventLayers: EventLayerDataKPA2[];
    speedEventNodeSeq: string;
    children: JudgeLineDataKPA2[];
    rotatesWithFather: boolean;

    anchor: [number, number];
    extended?: {
        scaleXEvents: string;
        scaleYEvents: string;
        textEvents?: string;
        colorEvents?: string;
    }
    zOrder: number;
}


export interface EventNodeSequenceDataKPA<VT> {
    events: EventDataKPA<VT>[];
    id: string;
    type: EventType;
    endValue: VT;
}

export interface EventNodeSequenceDataKPA2<VT> {
    events: EventDataKPA2<VT>[];
    id: string;
    type: EventType;
    endValue: VT;
}

export interface WrapperEasingBodyData {
    jsExpr: string;
    start: number;
    end: number;
    id: string;
}

export interface ChartDataKPA {
    version: number;
    offset: number;
    duration: number;
    info: {
        level: string;
        name: string;
        charter: string;
        illustrator: string;
        composer: string;
    };
    ui: {
        pause: number;
        combonumber: number;
        combo: number;
        score: number;
        bar: number;
        name: number;
        level: number;
    }
    envEasings: TemplateEasingBodyData[]; // New!
    eventNodeSequences: EventNodeSequenceDataKPA<any>[];
    orphanLines: JudgeLineDataKPA[];
    bpmList: BPMSegmentData[];
    judgeLineGroups: string[];
    chartTime?: number;
    rpeChartTime?: number;
}

export interface ChartDataKPA2 {
    version: number;
    $schema: string;
    offset: number;
    duration: number;
    info: {
        level: string;
        name: string;
        charter: string;
        illustrator: string;
        composer: string;
    };
    ui: {
        pause: number;
        combonumber: number;
        combo: number;
        score: number;
        bar: number;
        name: number;
        level: number;
    }
    templateEasings: TemplateEasingBodyData[];
    wrapperEasings: WrapperEasingBodyData[]
    eventNodeSequences: EventNodeSequenceDataKPA2<unknown>[];
    orphanLines: JudgeLineDataKPA2[];
    bpmList: BPMSegmentData[];
    judgeLineGroups: string[];
    chartTime?: number;
    rpeChartTime?: number;
}

export enum EventType {
    moveX,
    moveY,
    rotate,
    alpha,
    speed,
    easing,
    bpm,
    scaleX,
    scaleY,
    text,
    color
}
export enum NoteType {
    tap=1,
    drag=4,
    flick=3,
    hold=2
}


export type ValueTypeOfEventType<T extends EventType> = [number, number, number, number, number, number, number, number, number, string, RGB][T]

export type ExtendedEventTypeName = "scaleX" | "scaleY" | "text" | "color"
/// #enddeclaration
