import { TimeT } from "./chartTypes";
import { err } from "./env";
/**
 * @static @final
 */
export default class TC {
    private constructor() {}
    static toBeats(beaT: TimeT): number {
        return beaT[0] + beaT[1] / beaT[2]
    }
    static getDelta(beaT1: TimeT, beaT2: TimeT): number {
        return this.toBeats(beaT1) - this.toBeats(beaT2)
    }
    /**
     * @returns beaT1 == beaT2
     */
    static eq(beaT1: TimeT, beaT2: TimeT): boolean {
        return beaT1[0] === beaT2 [0] && beaT1[1] * beaT2[2] === beaT1[2] * beaT2[1] // 这里曾经把两个都写成beaT1，特此留念（
    }
    /** @returns beaT1 > beaT2 */
    static gt(beaT1:TimeT, beaT2: TimeT): boolean {
        return beaT1[0] > beaT2[0] || beaT1[0] === beaT2[0] && beaT1[1] * beaT2[2] > beaT1[2] * beaT2[1]
    }
    /** @returns beaT1 < beaT2 */
    static lt(beaT1:TimeT, beaT2: TimeT): boolean {
        return beaT1[0] < beaT2[0] || beaT1[0] === beaT2[0] && beaT1[1] * beaT2[2] < beaT1[2] * beaT2[1]
    }
    /** @returns beaT1 != beaT2 */
    static ne(beaT1:TimeT, beaT2: TimeT): boolean {
        return beaT1[0] !== beaT2[0] || beaT1[1] * beaT2[2] !== beaT1[2] * beaT2[1]
    }
    /**
     * @returns beaT1 + beaT2
     */
    static add(beaT1: TimeT, beaT2: TimeT): TimeT {
        return [beaT1[0] + beaT2[0], beaT1[1] * beaT2[2] + beaT1[2] * beaT2[1], beaT1[2] * beaT2[2]]
    }
    /**
     * @returns beaT1 - beaT2
     */
    static sub(beaT1: TimeT, beaT2: TimeT): TimeT {
        return [beaT1[0] - beaT2[0], beaT1[1] * beaT2[2] - beaT1[2] * beaT2[1], beaT1[2] * beaT2[2]]
    }
    /**
     * @returns Ratio(a 2-number tuple) = beaT1 / beaT2
     */
    static div(beaT1: TimeT, beaT2: TimeT): [number, number] {
        return [(beaT1[0] * beaT1[2] + beaT1[1]) * beaT2[2], (beaT2[0] * beaT2[2] + beaT2[1]) * beaT1[2]]
    }
    /**
     * @returns beaT1 * [numerator, denominator]
     */
    static mul(beaT: TimeT, ratio: [number, number]): TimeT {
        // 将带分数beaT: TimeT乘一个分数[number, number]得到一个新的带分数returnval: TimeT，不要求这个带分数分子不超过分母，但所有的数都是整数
        // （输入的两个元组都是整数元组）
        const [numerator, denominator] = ratio
        const b0nume = beaT[0] * numerator;
        const remainder = b0nume % denominator;
        if (remainder === 0) {
            return [b0nume / denominator, beaT[1] * numerator, beaT[2] * denominator]
        } else {
            return [Math.floor(b0nume / denominator), beaT[1] * numerator + remainder * beaT[2], beaT[2] * denominator]
        }
    }
    /**
     * 原地规范化时间元组，但仍然返回这个元组，方便使用
     * validate TimeT in place
     * @param beaT 
     */
    static validateIp(beaT: TimeT): TimeT {
        if (beaT === undefined || beaT[2] === 0) {
            throw err.INVALID_TIME_TUPLE(beaT);
        }
        if (beaT[1] >= beaT[2]) {
            const quotient = Math.floor(beaT[1] / beaT[2]);
            const remainder = beaT[1] % beaT[2];
            beaT[0] += quotient;
            beaT[1] = remainder;
        } else if (beaT[1] < 0) {
            const quotient = Math.floor(beaT[1] / beaT[2]);
            const remainder = beaT[2] + beaT[1] % beaT[2];
            beaT[0] += quotient;
            beaT[1] = remainder;
        }
        if (beaT[1] === 0) {
            beaT[2] = 1;
            return beaT;
        }
        const gcd = this.gcd(beaT[2], beaT[1]);
        if (gcd > 1) {
            beaT[1] /= gcd;
            beaT[2] /= gcd;
        }
        return beaT;
    }
    /**
     * 相加并约简
     */
    static vadd(beaT1: TimeT, beaT2: TimeT) { return this.validateIp(this.add(beaT1, beaT2)); }
    /**
     * 相减并约简
     */
    static vsub(beaT1: TimeT, beaT2: TimeT) { return this.validateIp(this.sub(beaT1, beaT2)); }
    /**
     * 相乘并约简
     */
    static vmul(beaT: TimeT, ratio: [number, number]): TimeT { return this.validateIp(this.mul(beaT, ratio)); }
    static gcd(a: number, b: number): number {
        if (a === 0 || b === 0) {
            return 0;
        }
        while (b !== 0) {
            const r = a % b;
            a = b;
            b = r;
        }
        return a;
    }
}