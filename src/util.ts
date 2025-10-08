import type { RGB } from "./chartTypes";

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

// 四位精度小数变分数
export const numberToRatio = (num: number): [number, number] => {
    return [Math.round(num * 10000), 10000]
}

/// #enddeclaration
