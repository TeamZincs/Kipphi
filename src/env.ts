
// chart              1
// bpm                2
// nnnlist            3
// judgeline          4
// nnList             5
// EventNodeSequence  6
// notenode           7
// eventnode          8
// evaluator          9
// easing             a
// note               b


// 就挺神奇的！明明typeof后面跟值，这里却可以写成类型导入
import { type EventValueType } from "./chartTypes";

// occupied 1
// invalid data 2
// invalid usage 3

const
    CHART = 0x100,
    BPM = 0x200,
    NNN_LIST = 0x300,
    JUDGE_LINE = 0x400,
    NN_LIST = 0x500,
    ENS = 0x600,
    NOTE_NODE = 0x700,
    EVENT_NODE = 0x800,
    EVALUATOR = 0x900,
    EASING = 0xA00,
    NOTE = 0xB00,
    TC = 0xC00,
    INTERNAL = 0xF00,

    OCCPIED = 0x10,
    INVALID_DATA = 0x20,
    INVALID_USAGE = 0x30,
    INVALID_TYPE = 0x40 // 这里的type指ECMAScript数据类型
    ;



export enum ERROR_IDS {
    UI_OCCUPIED =                                   CHART      | OCCPIED,


    SEQUENCE_NAME_OCCUPIED =                        ENS        | OCCPIED,
    INVALID_EVENT_NODE_SEQUENCE_TYPE =              ENS        | INVALID_DATA  | 0,
    EVENT_NODE_TIME_NOT_INCREMENTAL =               ENS        | INVALID_DATA  | 1,
    EXPECTED_TYPED_ENS =                            ENS        | INVALID_TYPE  | 0,

    CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR =        EVENT_NODE | INVALID_USAGE | 0,
    CANNOT_INSERT_BEFORE_HEAD =                     EVENT_NODE | INVALID_USAGE | 1,
    CANNOT_GET_FULL_INTEGRAL_OF_FINAL_START_NODE =  EVENT_NODE | INVALID_USAGE | 2,
    CANNOT_INTERPOLATE_TAILING_START_NODE =         EVENT_NODE | INVALID_USAGE | 3,

    INVALID_EASING_ID =                             EASING     | INVALID_DATA  | 0,
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_EASING_ENS =   EASING     | INVALID_DATA  | 1,
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_NUMERIC_ENS =  EASING     | INVALID_DATA  | 2,
    MUST_INTERPOLATE_TEMPLATE_EASING =              EASING     | INVALID_USAGE | 0,
    NODES_NOT_CONTINUOUS =                          EASING     | INVALID_USAGE | 1,
    NODES_NOT_BELONG_TO_SAME_SEQUENCE =             EASING     | INVALID_USAGE | 2,
    NODES_HAS_ZERO_DELTA =                          EASING     | INVALID_USAGE | 3,
    

    INVALID_NOTE_PROP_TYPE =                        NOTE       | INVALID_TYPE  | 0,


    INVALID_TIME_TUPLE =                            TC         | INVALID_DATA  | 0
}

export const ERRORS = {
    UI_OCCUPIED: (name: string) =>
        `UI '${name}' is occupied`,

    
    SEQUENCE_NAME_OCCUPIED: (name: string) =>
        `Sequence name '${name}' is occupied`,
    INVALID_EVENT_NODE_SEQUENCE_TYPE: (type: any) =>
        `Invalid event node sequence type: '${type}'`,
    EXPECTED_TYPED_ENS: (typeStr: keyof typeof EventValueType, id: string, value: unknown) =>
        `Expected EventNodeSequence for ${typeStr} but seen value ${value} (Processing ${id})`,
    EVENT_NODE_TIME_NOT_INCREMENTAL: (pos: string) =>
        `EventNode time is not incremental (at ${pos})`,

    
    CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR: () =>
        `Cannot substitute ExpressionEvaluator`,
    CANNOT_INSERT_BEFORE_HEAD: () =>
        "Cannot insert before the first EventStartNode",
    CANNOT_GET_FULL_INTEGRAL_OF_FINAL_START_NODE: () =>
        "Cannot get full integral of final start node",
    CANNOT_INTERPOLATE_TAILING_START_NODE: () =>
        "Cannot interpolate tailing start node",

    INVALID_EASING_ID: (id: string) =>
        `Invalid easing id: '${id}'`,
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_EASING_ENS: (temEasName: string) =>
        `Cannot implement TemplateEasing with a non-easing-typed EventNodeSequence (Processing template '${temEasName}')`, 
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_NUMERIC_ENS: (temEasName: string) =>
        `Cannot implement TemplateEasing with a non-numeric EventNodeSequence (Processing template '${temEasName}')`, 
    MUST_INTERPOLATE_TEMPLATE_EASING: () =>
        "Must interpolate template easing",
    
    NODES_NOT_CONTINUOUS: () =>
        "The EventNodes to encapsulate are not continuous",
    NODES_NOT_BELONG_TO_SAME_SEQUENCE: () =>
        "The EventNodes to encapsulate does not belong to same sequence",
    NODES_HAS_ZERO_DELTA: () =>
        "The EventNodes to encapsulate has zero delta",

    INVALID_NOTE_PROP_TYPE: (prop: string, value: any, type: any) =>
        `Invalid type for ${prop}. Got *${value}*, expected ${type}`,

    INVALID_TIME_TUPLE: (tuple: any) =>
        `Invalid time tuple: '${typeof tuple === "undefined" ? 'undefined' : tuple.valueOf()}'`
} satisfies Record<keyof typeof ERROR_IDS, (...args: any[]) => string>

export class KPAError<ET extends ERROR_IDS> extends Error {
    constructor(message: string, public id: ET) {
        super(message);
    }
    /**
     * 对于解析谱面等场景，有时可能需要找出全部的错误，不宜直接抛出错误中断代码执行
     * 
     * 此时可以调用该方法，该方法会输出错误并把它保存到KPAError的一个`buffer`静态属性下。
     */
    warn() {
        console.warn(this.stack);
        KPAError.buffer.push(this);
    }
    static buffer: KPAError<ERROR_IDS>[];
    static flush() {
        KPAError.buffer = [];
    }
}

export const err = new Proxy(ERRORS, {
    get(target, name) {
        return (...args: any[]) => new KPAError(target[name](...args) + `(KP${ERROR_IDS[name].toString(16)})`, ERROR_IDS[name]);
    }
}) as unknown as { [key in keyof typeof ERRORS]: (...args: Parameters<typeof ERRORS[key]>) => KPAError<typeof ERROR_IDS[key]>};

export default {
    DEFAULT_TEMPLATE_LENGTH: 16,
    BEZIER_INTERPOLATION_DENSITY: 256,
    NNLIST_Y_OFFSET_HALF_SPAN: 100,
    JUMPARRAY_MIN_LENGTH: 64,
    JUMPARRAY_MAX_LENGTH: 4096,
    JUMPARRAY_MINOR_SCALE_COUNT: 16,
    ERROR_IDS,
    err,
    freeze() { Object.freeze(this); }
}
