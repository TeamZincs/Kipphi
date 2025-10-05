import type { RGB } from "./chartTypes";

/// #declaration:global

export enum NodeType {
  HEAD=0,
  TAIL=1,
  MIDDLE=2
}

export type TupleCoord = [x: number, y: number]

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
