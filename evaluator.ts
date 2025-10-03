import {
    Easing,
    linearEasing,
    NormalEasing,
    rpeEasingArray,
} from "./easing";


import { TimeCalculator as TC } from "./time" 

import type { Chart } from "./chart";
import type { EventEndNode, EventStartNode } from "./event";
import { EvaluatorType, EventValueType, InterpreteAs, type ColorEasedEvaluatorKPA2, type EasedEvaluatorDataOfType, type EvaluatorDataKPA2, type EventValueESType, type EventValueTypeOfType, type ExpressionEvaluatorDataKPA2, type NumericEasedEvaluatorKPA2, type RGB, type TextEasedEvaluatorKPA2 } from "./chartTypes";


/**
 * **求值器**
 * 
 * 基于给定的事件和拍数，返回事件在此点的值。
 * 
 * 被求值的事件必须是拥有下一个节点的事件。序列尾部的节点（与尾节点相连的节点）不能被求值。
 * @immutable
 * @since 2.0.0
 */
export abstract class Evaluator<T> {
    abstract eval(event: EventStartNode<T>, beats: number): T;
    abstract dump(): EvaluatorDataKPA2<T>;
}


export abstract class EasedEvaluator<T> extends Evaluator<T> {
    readonly easing: Easing;
    constructor(easing: Easing) {
        super();
        this.easing = easing;
    }
    override eval(startNode: EventStartNode<T> & { next: EventEndNode }, beats: number): T {
        const next = startNode.next;
        const timeDelta = TC.getDelta(next.time, startNode.time)
        const current = beats - TC.toBeats(startNode.time)
        const nextValue = startNode.next.value;
        const value = startNode.value;
        if (nextValue === value) {
            return value;
        }
        // 其他类型，包括普通缓动和非钩定模板缓动
        return this.convert(value, nextValue, this.easing.getValue(current / timeDelta));
    }
    abstract convert(start: T, end: T, t: number): T;
}

export type EasedEvaluatorOfType<T extends EventValueESType> = T extends number ? NumericEasedEvaluator : T extends RGB ? ColorEasedEvaluator : TextEasedEvaluator;
export type EasedEvaluatorConstructorOfType<T extends EventValueESType> = T extends number ? typeof NumericEasedEvaluator : T extends RGB ? typeof ColorEasedEvaluator : typeof TextEasedEvaluator;

export class NumericEasedEvaluator extends EasedEvaluator<number> {
    constructor(easing: Easing) {
        super(easing);
    }
    private cache?: NumericEasedEvaluatorKPA2
    override dump(): NumericEasedEvaluatorKPA2 {
        return this.cache ??= {
            type: EvaluatorType.eased,
            easing: this.easing.dump()
        }
    }
    override convert(start: number, end: number, progress: number): number {
        return start + progress * (end - start);
    }
    static default = new NumericEasedEvaluator(linearEasing);
    static evaluatorsOfNormalEasing: NumericEasedEvaluator[] = rpeEasingArray.map(easing => new NumericEasedEvaluator(easing));
}

export class ColorEasedEvaluator extends EasedEvaluator<RGB> {
    constructor(easing: Easing) {
        super(easing);
    }
    override dump(): ColorEasedEvaluatorKPA2 {
        return {
            type: EvaluatorType.eased,
            easing: this.easing.dump()
        }
    }
    override convert(start: RGB, end: RGB, progress: number): RGB {
        const r = start[0] === end[0] ? start[0] : start[0] + (end[0] - start[0]) * progress;
        const g = start[1] === end[1] ? start[1] : start[1] + (end[1] - start[1]) * progress;
        const b = start[2] === end[2] ? start[2] : start[2] + (end[2] - start[2]) * progress;
        return [r, g, b];
    }
    static default = new ColorEasedEvaluator(linearEasing);
    static evaluatorsOfNormalEasing: ColorEasedEvaluator[] = rpeEasingArray.map(easing => new ColorEasedEvaluator(easing));
}


/**
 * 文本缓动求值器
 * 
 * 文本缓动求值器可以将文本解读为字符串、浮点数和整形。
 * 
 * 行为与RPE的`%P%`相似
 */
export class TextEasedEvaluator extends EasedEvaluator<string> {
    constructor(easing: Easing,
        public readonly interpretedAs: InterpreteAs = InterpreteAs.str,
        public readonly font: string = "cmdysj.ttf"
    )
    {
        super(easing);
    }
    override dump(): TextEasedEvaluatorKPA2 {
        return {
            type: EvaluatorType.eased,
            easing: this.easing.dump(),
            interpretedAs: this.interpretedAs,
            font: this.font
        }
    }
    override convert(value: string, nextValue: string, progress: number): string {
        const interpretedAs = this.interpretedAs;
        if (interpretedAs === InterpreteAs.float) {
            const start = parseFloat(value);
            const delta = parseFloat(nextValue as string) - start;
            return start + progress * delta + "";
        } else if (interpretedAs === InterpreteAs.int) {
            const start = parseInt(value);
            const delta = parseInt(nextValue as string) - start;
            return start + Math.round(progress * delta) + "";
        } else 
            if (value.startsWith(nextValue as string)) {
                const startLen = (nextValue as string).length;
                const deltaLen = value.length - startLen;
                const len = startLen + Math.floor(deltaLen * progress);
                return value.substring(0, len);
            } else if ((nextValue as string).startsWith(value)) {
                const startLen = value.length;
                const deltaLen = (nextValue as string).length - startLen;
                const len = startLen + Math.floor(deltaLen * progress);
                return (nextValue as string).substring(0, len);
            }
        else {
            return value;
        }
    }
    static default = new TextEasedEvaluator(linearEasing, InterpreteAs.str);
    static evaluatorsOfNoEzAndItpAs: TextEasedEvaluator[][] = rpeEasingArray.map(easing => [
        new TextEasedEvaluator(easing, InterpreteAs.str),
        new TextEasedEvaluator(easing, InterpreteAs.int),
        new TextEasedEvaluator(easing, InterpreteAs.float),
    ]);
}

export class ExpressionEvaluator<T> extends Evaluator<T> {
    readonly func: (t: number) => T;
    constructor(public readonly jsExpr: string) {
        super();
        this.func = new Function("t", "return " + jsExpr) as (t: number) => T;
    }
    override eval(startNode: EventStartNode<T> & { next: EventEndNode }, beats: number): T {
        const next = startNode.next;
        const timeDelta = TC.getDelta(next.time, startNode.time)
        const current = beats - TC.toBeats(startNode.time)
        return this.func(current / timeDelta);
    }
    override dump(): ExpressionEvaluatorDataKPA2 {
        return {
            type: EvaluatorType.expressionbased,
            jsExpr: this.jsExpr
        }
    }
}
