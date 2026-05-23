import type { RGB, TimeT } from "./chartTypes";

/// #declaration:global

export enum NodeType {
  HEAD=0,
  TAIL=1,
  MIDDLE=2
}

export type TupleCoord = [x: number, y: number]
/**
 * 检查值的类型
 * @param value 
 * @param type 为字符串时，用typeof检测，为构造函数时，用instanceof检测，为数组时，识别为元组类型。
 */
export const checkType = (value: unknown, type: string | (string | typeof Function)[] | typeof Function) => {
    if (Array.isArray(type)) {
        return Array.isArray(value)
        && value.length === type.length
        && type.every((t, i) => checkType(value[i], t))
    } else if (typeof type === "string") {
        if (type.startsWith("int")) {
            if (typeof value !== "number" || !Number.isInteger(value)) {
                return false;
            }
            const match = type.match(/^int(\(|\[)(\-?\d+),(\-?\d+|\+)(\)|\])$/);
            if (!match) { return true; }
            const [,leftBrac, left, right, rightBrac] = match
            if (!leftBrac) { return true; }
            const leftN = left === "-" ? -Infinity : Number(left);
            const rightN = right === "+" ? +Infinity : Number(right);
            if (value < leftN) {
                return false;
            }
            if (leftBrac === "(" && value === leftN) {
                return false;
            }
            
            if (value > rightN) {
                return false;
            }
            if (rightBrac === ")" && value === rightN) {
                return false;
            }
            return true;
        } else if (type.startsWith("number")) {
            
            if (typeof value !== "number") {
                return false;
            }
            const match  = type.match(/^number(\(|\[)(\-?\d+),(\-?\d+|\+)(\)|\])$/)
            if (!match) { return true; }
            const [, leftBrac, left, right, rightBrac] = match
            if (!leftBrac) { return true; }
            const leftN = left === "-" ? -Infinity : Number(left);
            const rightN = right === "+" ? +Infinity : Number(right);
            if (value < leftN) {
                return false;
            }
            if (leftBrac === "(" && value === leftN) {
                return false;
            }
            
            if (value > rightN) {
                return false;
            }
            if (rightBrac === ")" && value === rightN) {
                return false;
            }
            return true;
        }
        return typeof value === type
    } else {
        return value instanceof type
    }
}

export const rgb2hex = (rgb: RGB) => {
    return rgb[0] << 16 | rgb[1] << 8 | rgb[2];
}

export const hex2rgb = (hex: number): RGB => {
    return [hex >> 16, hex >> 8 & 0xFF, hex & 0xFF]
}

// 5个2，4个3，3个5，7、11、13各一个
const DENO = 324324000;

export const numberToRatio = (num: number): [number, number] => {
    return [Math.round(num * DENO), DENO]
}


export const toTimeString = (beaT: TimeT): string =>
    `${beaT[0]}:${beaT[1]}/${beaT[2]}`;

/// #enddeclaration
