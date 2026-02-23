import { type TemplateEasingBodyData, type EasingDataKPA2, EasingType, EventType, type SegmentedEasingData, type NormalEasingData, type BezierEasingData, type TemplateEasingData, WrapperEasingData, WrapperEasingBodyData } from "./chartTypes";
import { type EventNodeSequence } from "./event";
import { type TupleCoord } from "./util";
import Environment, { err } from "./env";
import { type ExpressionEvaluator } from "./evaluator";


/// #declaration:global

const easeOutElastic = (x: number): number => {
    const c4 = (2 * Math.PI) / 3;
    
    return x === 0
      ? 0
      : x === 1
      ? 1
      : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
}

const easeOutBounce = (x: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    
    if (x < 1 / d1) {
        return n1 * x * x;
    } else if (x < 2 / d1) {
        return n1 * (x -= 1.5 / d1) * x + 0.75;
    } else if (x < 2.5 / d1) {
        return n1 * (x -= 2.25 / d1) * x + 0.9375;
    } else {
        return n1 * (x -= 2.625 / d1) * x + 0.984375;
    }
}

const easeOutExpo = (x: number): number =>{
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

const easeOutBack = (x: number): number =>{
    const c1 = 1.70158;
    const c3 = c1 + 1;
    
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

const linear = (x: number): number => x

const easeOutSine = (x: number): number => Math.sin((x * Math.PI) / 2);


const easeInQuad = (x: number): number => Math.pow(x, 2)


const easeInCubic = (x: number): number => Math.pow(x, 3)


const easeInQuart = (x: number): number => Math.pow(x, 4)


const easeInQuint = (x: number): number => Math.pow(x, 5)


const easeInCirc = (x: number): number => 1 - Math.sqrt(1 - Math.pow(x, 2))


function mirror(easeOut: (x: number) => number) {
    return (x: number) => 1 - easeOut(1 - x);
}

function toEaseInOut(easeIn: (x: number) => number, easeOut: (x: number) => number) {
    return (x: number) => x < 0.5 ? easeIn(2 * x) / 2 : (1 + easeOut(2 * x - 1)) / 2
}

const easeOutQuad = mirror(easeInQuad);
const easeInSine = mirror(easeOutSine);
const easeOutQuart = mirror(easeInQuart);
const easeOutCubic = mirror(easeInCubic);
const easeOutQuint = mirror(easeInQuint);
const easeOutCirc = mirror(easeInCirc);
const easeInExpo = mirror(easeOutExpo);
const easeInElastic = mirror(easeOutElastic);
const easeInBounce = mirror(easeOutBounce);
const easeInBack = mirror(easeOutBack);
const easeInOutSine = toEaseInOut(easeInSine, easeOutSine);
const easeInOutQuad = toEaseInOut(easeInQuad, easeOutQuad);
const easeInOutCubic = toEaseInOut(easeInCubic, easeOutCubic);
const easeInOutQuart = toEaseInOut(easeInQuart, easeOutQuart);
const easeInOutQuint = toEaseInOut(easeInQuint, easeOutQuint);
const easeInOutExpo = toEaseInOut(easeInExpo, easeOutExpo);
const easeInOutCirc = toEaseInOut(easeInCirc, easeOutCirc);
const easeInOutBack = toEaseInOut(easeInBack, easeOutBack);
const easeInOutElastic = toEaseInOut(easeInElastic, easeOutElastic);
const easeInOutBounce = toEaseInOut(easeInBounce, easeOutBounce);


type FuncType = "linear" | "sine" | "quad" | "cubic" | "quart" | "quint" | "expo" | "circ" | "back" | "elastic" | "bounce"

export const easingFnMap: {
    [k in FuncType]: [(x: number) => number, (x: number) => number, (x: number) => number]
} = {
    "linear": [linear, linear, linear],
    "sine": [easeInSine, easeOutSine, toEaseInOut(easeInSine, easeOutSine)],
    "quad": [easeInQuad, easeOutQuad, toEaseInOut(easeInQuad, easeOutQuad)],
    "cubic": [easeInCubic, easeOutCubic, toEaseInOut(easeInCubic, easeOutCubic)],
    "quart": [easeInQuart, easeOutQuart, toEaseInOut(easeInQuart, easeOutQuart)],
    "quint": [easeInQuint, easeOutQuint, toEaseInOut(easeInQuint, easeOutQuint)],
    "expo": [easeInExpo, easeOutExpo, toEaseInOut(easeInExpo, easeOutExpo)],
    "circ": [easeInCirc, easeOutCirc, toEaseInOut(easeInCirc, easeOutCirc)],
    "back": [easeInBack, easeOutBack, toEaseInOut(easeInBack, easeOutBack)],
    "elastic": [easeInElastic, easeOutElastic, toEaseInOut(easeInElastic, easeOutElastic)],
    "bounce": [easeInBounce, easeOutBounce, toEaseInOut(easeInBounce, easeOutBounce)]
}
/**
 * 缓动基类
 * Easings are used to describe the rate of change of a parameter over time.
 * They are used in events, curve note filling, etc.
 */
export abstract class Easing {
    constructor() {

    }
    /**
     * 返回当前变化量与变化量之比
     * 或者当前数值。（参数方程）
     * @param t 一个0-1的浮点数，代表当前经过时间与总时间之比
     */
    abstract getValue(t: number): number;
    abstract dump(): EasingDataKPA2;
    segmentedValueGetter(easingLeft: number, easingRight: number) {
        const leftValue = this.getValue(easingLeft);
        const rightValue =  this.getValue(easingRight);
        const timeDelta = easingRight - easingLeft;
        const delta = rightValue - leftValue;
        if (delta === 0) {
            throw new Error('Easing delta cannot be zero.');
        }
        return (t: number) => (this.getValue(easingLeft + timeDelta * t) - leftValue) / delta;
    }
}




/**
 * @immutable
 */
export class SegmentedEasing extends Easing {
    getter: (t: number) => number;
    constructor(public readonly easing: Easing, public readonly left: number, public readonly right: number) {
        super()
        this.getter = easing.segmentedValueGetter(left, right)
    }
    getValue(t: number): number {
        return this.getter(t)
    }
    replace(easing: Easing): Easing {
        return new SegmentedEasing(easing, this.left, this.right)
    }
    dump(): SegmentedEasingData {
        return {
            left: this.left,
            right: this.right,
            inner: this.easing.dump(),
            type: EasingType.segmented
        }
    }
}


/**
 * 普通缓动
 * See https://easings.net/zh-cn to learn about the basic types of easing.
 * 
 */
export class NormalEasing extends Easing {
    rpeId: number;
    id: number;
    funcType: string;
    easeType: string;
    _getValue: (t: number) => number;
    constructor(fn: (t: number) => number);
    constructor(fn: (t: number) => number);
    constructor(fn: (t: number) => number) {
        super()
        this._getValue = fn;
    }
    getValue(t: number): number {
        return this._getValue(t)
    }
    private dumpCache: NormalEasingData;
    dump(): NormalEasingData {
        return this.dumpCache ??= {
            type: EasingType.normal,
            identifier: this.rpeId
        }
    }
}





/**
 * 贝塞尔曲线缓动
 * uses the Bezier curve formula to describe an easing.
 */
export class BezierEasing extends Easing {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly jumper: Uint8Array;
    constructor(public readonly cp1: TupleCoord, public readonly cp2: TupleCoord) {
        super()
        const BEZIER_INTERPOLATION_DENSITY = Environment.BEZIER_INTERPOLATION_DENSITY;
        const BEZIER_INTERPOLATION_STEP = 1 / BEZIER_INTERPOLATION_DENSITY;
        // 插值，把贝塞尔曲线近似成256段折线
        const xs = new Float64Array(BEZIER_INTERPOLATION_DENSITY - 1);
        const ys = new Float64Array(BEZIER_INTERPOLATION_DENSITY - 1);
        /** 一把尺子，刻度均匀，从`插值步长*下标`映射到xs里面的下标 */
        const jumper = new Uint8Array(BEZIER_INTERPOLATION_DENSITY);
        let nextToFill = 0;
        for (let i = 1; i < BEZIER_INTERPOLATION_DENSITY; i++) {
            // 这个t是贝塞尔曲线生成参数
            const t = i * BEZIER_INTERPOLATION_STEP;
            const s = 1 - t;
            const x = 3 * cp1[0] * Math.pow(s, 2) * t + 3 * cp2[0] * Math.pow(t, 2) * s + Math.pow(t, 3);
            xs[i - 1] = x
            ys[i - 1] = 3 * cp1[1] * Math.pow(s, 2) * t + 3 * cp2[1] * Math.pow(t, 2) * s + Math.pow(t, 3);
            for (; x > nextToFill * BEZIER_INTERPOLATION_STEP; nextToFill++) {
                jumper[nextToFill] = i - 1;
            }
        }
        for (; 1 > nextToFill * BEZIER_INTERPOLATION_STEP; nextToFill++) {
            jumper[nextToFill] = BEZIER_INTERPOLATION_DENSITY - 1;
        }
        this.xs = xs;
        this.ys = ys;
        this.jumper = jumper;
    }
    /**
     * 从横坐标获得纵坐标
     * @param t 并不是贝塞尔曲线的参数，它对应一个横坐标数值，范围[0, 1]
     * @returns 
     */
    getValue(t: number): number {
        if (t === 0 || t === 1) return t;
        const BEZIER_INTERPOLATION_DENSITY = Environment.BEZIER_INTERPOLATION_DENSITY;
        let index = this.jumper[Math.floor(t * BEZIER_INTERPOLATION_DENSITY)];
        const xs = this.xs;
        const ys = this.ys;
        let next!: number;
        for (; index < BEZIER_INTERPOLATION_DENSITY - 1; index++) {
            next = xs[index + 1];
            if (t < next) {
                break;
            }
        }
        const atLastSegment = index === BEZIER_INTERPOLATION_DENSITY - 1;
        const here = atLastSegment ? 1 : xs[index];
        const yhere = atLastSegment ? 1 : ys[index];
        const yprev = ys[index - 1] || 0;
        const k = (yprev - yhere) / ((xs[index - 1] || 0) - here);
        return k * (t - here) + yhere;
    }
    dump(): BezierEasingData {
        return {
            type: EasingType.bezier,
            bezier: [this.cp1[0], this.cp1[1], this.cp2[0], this.cp2[1]]
        }
    }
}

/**
 * 模板缓动
 * to implement an easing with an eventNodeSequence.
 * 这是受wikitext的模板概念启发的。
 * This is inspired by the "template" concept in wikitext.
 */
export class TemplateEasing extends Easing {
    eventNodeSequence: EventNodeSequence;
    name: string;
    constructor(name: string, sequence: EventNodeSequence) {
        super()
        this.eventNodeSequence = sequence;
        this.name = name;
    }
    getValue(t: number) {
        const seq = this.eventNodeSequence;
        const delta = this.valueDelta;
        if (delta === 0) {
            throw new Error('Easing delta cannot be zero.');
        }
        const frac = seq.getValueAt(t * seq.effectiveBeats, true) - this.headValue
        return delta === 0 ? frac : frac / delta;
    }
    dump(): TemplateEasingData {
        return {
            type: EasingType.template,
            identifier: this.name
        }
    }
    get valueDelta(): number {
        const seq = this.eventNodeSequence;
        return seq.tail.previous.value - seq.head.next.value;
    }
    get headValue(): number {
        return this.eventNodeSequence.head.next.value;
    }
}

export class WrapperEasing extends Easing {
    // 需要一对面对面节点
    constructor(public evaluator: ExpressionEvaluator<number>, public start: number, public end: number, public name: string) {
        super()
    }
    getValue(t: number): number {
        const end = this.end;
        const start = this.start;
        return (this.evaluator.func(t) - start) / (end - start);
    }
    dump(): WrapperEasingData {
        return {
            type: EasingType.wrapper,
            identifier: this.name
        }
    }
}




/**
 * 缓动库
 * 用于管理模板缓动
 * for template easing management
 * 
 * 谱面的一个属性
 * a property of chart
 * 
 * 加载谱面时，先加载事件序列，所需的模板缓动会被加入到缓动库，但并不立即实现，在读取模板缓动时，才实现缓动。
 * To load a chart, the eventNodeSquences will be first loaded, during which process
 * the easings will be added to the easing library but not implemented immediately.
 * They will be implemented when the template easings are read from data.
 * 
 */
export class TemplateEasingLib {
    easings = new Map<string, TemplateEasing>();
    wrapperEasings = new Map<string, WrapperEasing>();
    // 被迫给一个静态方法进行依赖注入，恨死你了，ESM
    constructor(public getNewSequence: (type: EventType, effectiveBeats: number) => EventNodeSequence<number>, public ExpressionEvaluatorCon: typeof ExpressionEvaluator) {
    }
    getOrNew(name: string): TemplateEasing {
        const DEFAULT_TEMPLATE_LENGTH = Environment.DEFAULT_TEMPLATE_LENGTH;
        if (this.easings.has(name)) {
            return this.easings.get(name);
        } else {
            const easing = new TemplateEasing(name, this.getNewSequence(EventType.easing, DEFAULT_TEMPLATE_LENGTH));
            easing.eventNodeSequence.id = "*" + name;
            this.easings.set(name, easing)
            return easing;
        }
    }
    readWrapperEasings(data: WrapperEasingBodyData[]) {
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const datum = data[i];
            // 属于是油饼
            this.wrapperEasings.set(datum.id, new WrapperEasing(new this.ExpressionEvaluatorCon(datum.jsExpr), datum.start, datum.end, datum.id))
        }
    }
    getWrapper(name: string): WrapperEasing {
        return this.wrapperEasings.get(name);
    }
    /**
     * 注册一个模板缓动，但不会实现它
     * register a template easing when reading eventNodeSequences, but does not implement it immediately
     */
    require(name: string) {
        this.easings.set(name, new TemplateEasing(name, null));
    }
    implement(name: string, sequence: EventNodeSequence) {
        this.easings.get(name).eventNodeSequence = sequence;
    }
    /**
     * 检查所有模板缓动是否实现
     * check if all easings are implemented
     * 应当在读取完所有模板缓动后调用
     * should be invoked after all template easings are read
     */
    check() {
        for (const [name, easing] of this.easings) {
            if (!easing.eventNodeSequence) {
                err.UNIMPLEMENTED_TEMPLATE_EASING(name).warn();
            }
        }
    }
    get(key: string): TemplateEasing | undefined {
        return this.easings.get(key);
    }
    
    dump(eventNodeSequences: Set<EventNodeSequence>): TemplateEasingBodyData[] {
        const customEasingDataList: TemplateEasingBodyData[] = [];
        for (const [key, templateEasing] of this.easings) {
            const eventNodeSequence = templateEasing.eventNodeSequence;
            if (eventNodeSequences.has(eventNodeSequence)) {
                continue;
            }
            eventNodeSequences.add(eventNodeSequence);
            customEasingDataList.push({
                name: key,
                content: eventNodeSequence.id // 这里只存储编号，具体内容在保存时再编码
            });
        }
        return customEasingDataList;
    }
    dumpWrapperEasings(): WrapperEasingBodyData[] {
        const wrapperEasingDataList: WrapperEasingBodyData[] = [];
        for (const [key, wrapperEasing] of this.wrapperEasings) {
            wrapperEasingDataList.push({
                id: key,
                jsExpr: wrapperEasing.evaluator.jsExpr,
                start: wrapperEasing.start,
                end: wrapperEasing.end
            })
        }
        return wrapperEasingDataList;
    }
}

export const linearEasing = new NormalEasing(linear);
export const fixedEasing = new NormalEasing((x: number): number => (x === 1 ? 1 : 0));

export const easingMap = {
    "fixed": {out: fixedEasing, in: fixedEasing, inout: fixedEasing},
    "linear": {out: linearEasing, in: linearEasing, inout: linearEasing},
    "sine": {in: new NormalEasing(easeInSine), out: new NormalEasing(easeOutSine), inout: new NormalEasing(easeInOutSine)},
    "quad": {in: new NormalEasing(easeInQuad), out: new NormalEasing(easeOutQuad), inout: new NormalEasing(easeInOutQuad)},
    "cubic": {in: new NormalEasing(easeInCubic), out: new NormalEasing(easeOutCubic), inout: new NormalEasing(easeInOutCubic)},
    "quart": {in: new NormalEasing(easeInQuart), out: new NormalEasing(easeOutQuart), inout: new NormalEasing(easeInOutQuart)},
    "quint": {in: new NormalEasing(easeInQuint), out: new NormalEasing(easeOutQuint), inout: new NormalEasing(easeInOutQuint)},
    "expo": {in: new NormalEasing(easeInExpo), out: new NormalEasing(easeOutExpo), inout: new NormalEasing(easeInOutExpo)},
    "circ": {in: new NormalEasing(easeInCirc), out: new NormalEasing(easeOutCirc), inout: new NormalEasing(easeInOutCirc)},
    "back": {in: new NormalEasing(easeInBack), out: new NormalEasing(easeOutBack), inout: new NormalEasing(easeInOutBack)},
    "elastic": {in: new NormalEasing(easeInElastic), out: new NormalEasing(easeOutElastic), inout: new NormalEasing(easeInOutElastic)},
    "bounce": {in: new NormalEasing(easeInBounce), out: new NormalEasing(easeOutBounce), inout: new NormalEasing(easeInOutBounce)}
}

for (const funcType in easingMap) {
    for (const easeType in easingMap[funcType]) {
        const easing = easingMap[funcType][easeType];
        easing.funcType = funcType;
        easing.easeType = easeType;
    }
}
fixedEasing.funcType = "fixed";
fixedEasing.easeType = "in"

/**
 * 按照KPA的编号
 */
export const easingArray = [
    fixedEasing,
    linearEasing,
    easingMap.sine.out,
    easingMap.sine.in,
    easingMap.sine.inout,
    easingMap.quad.out,
    easingMap.quad.in,
    easingMap.quad.inout,
    easingMap.cubic.out,
    easingMap.cubic.in,
    easingMap.cubic.inout,
    easingMap.quart.out,
    easingMap.quart.in,
    easingMap.quart.inout,
    easingMap.quint.out,
    easingMap.quint.in,
    easingMap.quint.inout,
    easingMap.circ.out,
    easingMap.circ.in,
    easingMap.circ.inout,
    easingMap.expo.out,
    easingMap.expo.in,
    easingMap.expo.inout,
    easingMap.back.out,
    easingMap.back.in,
    easingMap.back.inout,
    easingMap.elastic.out,
    easingMap.elastic.in,
    easingMap.elastic.inout,
    easingMap.bounce.out,
    easingMap.bounce.in,
    easingMap.bounce.inout
]

easingArray.forEach((easing, index) => {
    easing.id = index;
})

export const rpeEasingArray = [
    fixedEasing,
    linearEasing, // 1
    easingMap.sine.out, // 2
    easingMap.sine.in, // 3
    easingMap.quad.out, // 4
    easingMap.quad.in, // 5
    easingMap.sine.inout, // 6
    easingMap.quad.inout, // 7
    easingMap.cubic.out, // 8
    easingMap.cubic.in, // 9
    easingMap.quart.out, // 10
    easingMap.quart.in, // 11
    easingMap.cubic.inout, // 12
    easingMap.quart.inout, // 13
    easingMap.quint.out, // 14
    easingMap.quint.in, // 15
    // easingMap.quint.inout,
    easingMap.expo.out, // 16
    easingMap.expo.in, // 17
    // easingMap.expo.inout,
    easingMap.circ.out, // 18
    easingMap.circ.in, // 19
    easingMap.back.out, // 20
    easingMap.back.in, // 21
    easingMap.circ.inout, // 22
    easingMap.back.inout, // 23
    easingMap.elastic.out, // 24
    easingMap.elastic.in, // 25
    easingMap.bounce.out, // 26
    easingMap.bounce.in, // 27
    easingMap.bounce.inout, //28
    easingMap.elastic.inout // 29
]

rpeEasingArray.forEach((easing, index) => {
    if (!easing) {
        return;
    }
    easing.rpeId = index;
})
// 强行添加，避免存储不了这些缓动
easingMap.expo.inout.rpeId = 101;
easingMap.quint.inout.rpeId = 102;

/// #enddeclaration
