
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
import { type TimeT, type EventValueType } from "./chartTypes";
import { EventNode } from "./event";
import { toTimeString } from "./util";

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
    MACRO = 0xD00,
    INTERNAL = 0xF00,

    OCCPIED = 0x10,
    INVALID_DATA = 0x20, // 一般是指读取谱面时的无效事件类型、缓动号等等
    INVALID_USAGE = 0x30, // 不知道归入哪里就放这吧（（（
    INVALID_TYPE = 0x40 // 这里的type指ECMAScript数据类型，事件类型错误可以归入此类
    ;



export enum ERROR_IDS {
    UI_OCCUPIED =                                   CHART      | OCCPIED,


    SEQUENCE_NAME_OCCUPIED =                        ENS        | OCCPIED       | 0,
    SEQUENCE_NODE_TIME_OCCUPIED =                   ENS        | OCCPIED       | 1,
    INVALID_EVENT_NODE_SEQUENCE_TYPE =              ENS        | INVALID_DATA  | 0,
    EVENT_NODE_TIME_NOT_INCREMENTAL =               ENS        | INVALID_DATA  | 1,
    PARENT_SEQUENCE_NOT_FOUND =                     ENS        | INVALID_USAGE | 1,
    NEEDS_AT_LEAST_ONE_ENS =                        ENS        | INVALID_USAGE | 2,
    SEQUENCE_TYPE_NOT_CONSISTENT =                  ENS        | INVALID_USAGE | 3,
    
    EXPECTED_TYPED_ENS =                            ENS        | INVALID_TYPE  | 0,

    CANNOT_SUBSTITUTE_EXPRESSION_EVALUATOR =        EVENT_NODE | INVALID_USAGE | 0,
    CANNOT_INSERT_BEFORE_HEAD =                     EVENT_NODE | INVALID_USAGE | 1,
    CANNOT_GET_FULL_INTEGRAL_OF_FINAL_START_NODE =  EVENT_NODE | INVALID_USAGE | 2,
    CANNOT_INTERPOLATE_TAILING_START_NODE =         EVENT_NODE | INVALID_USAGE | 3,

    INVALID_EASING_ID =                             EASING     | INVALID_DATA  | 0,
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_EASING_ENS =   EASING     | INVALID_DATA  | 1,
    CANNOT_IMPLEMENT_TEMEAS_WITH_NON_NUMERIC_ENS =  EASING     | INVALID_DATA  | 2,
    UNIMPLEMENTED_TEMPLATE_EASING =                 EASING     | INVALID_DATA  | 3,
    MUST_INTERPOLATE_TEMPLATE_EASING =              EASING     | INVALID_USAGE | 0,
    NODES_NOT_CONTINUOUS =                          EASING     | INVALID_USAGE | 1,
    NODES_NOT_BELONG_TO_SAME_SEQUENCE =             EASING     | INVALID_USAGE | 2,
    NODES_HAS_ZERO_DELTA =                          EASING     | INVALID_USAGE | 3,

    CANNOT_DIVIDE_EXPRESSION_EVALUATOR =            EVALUATOR  | INVALID_USAGE | 0,
    MISSING_MACRO_EVALUATOR_KEY =                   EVALUATOR  | INVALID_DATA  | 0,
    MACRO_EVALUATOR_NOT_FOUND =                     EVALUATOR  | INVALID_DATA  | 1,
    
    

    INVALID_NOTE_PROP_TYPE =                        NOTE       | INVALID_TYPE  | 0,


    INVALID_TIME_TUPLE =                            TC         | INVALID_DATA  | 0,

    TIME_MACRO_NOT_FOUND =                          MACRO      | INVALID_DATA  | 0,
    VALUE_MACRO_NOT_FOUND =                         MACRO      | INVALID_DATA  | 1,
    UNKNOWN_MACRO_EXPRESSION =                      MACRO      | INVALID_DATA  | 2,
    JAVASCRIPT_SYNTAX_ERROR =                       MACRO      | INVALID_DATA  | 3,
    PROTO_PRESENT_IN_NONPARAMETRIC =                MACRO      | INVALID_USAGE | 0,
    PARAMETRIC_MACRO_REQUIRES_PROTO_KEY =           MACRO      | INVALID_DATA  | 4,
    MACRO_NOT_PARAMETRIC =                          MACRO      | INVALID_DATA  | 5,
}

export const ERRORS = {
    UI_OCCUPIED: (name: string) =>
        `UI '${name}' is occupied`,

    
    SEQUENCE_NAME_OCCUPIED: (name: string) =>
        `Sequence name '${name}' is occupied`,
    SEQUENCE_NODE_TIME_OCCUPIED: (time: TimeT, id: string) => 
        `Time ${toTimeString(time)} already has a node (in sequence ${id})`,
    INVALID_EVENT_NODE_SEQUENCE_TYPE: (type: any) =>
        `Invalid event node sequence type: '${type}'`,
    EXPECTED_TYPED_ENS: (typeStr: keyof typeof EventValueType, id: string, value: unknown) =>
        `Expected EventNodeSequence for ${typeStr} but seen value ${value} (Processing ${id})`,
    EVENT_NODE_TIME_NOT_INCREMENTAL: (pos: string) =>
        `EventNode time is not incremental (at ${pos})`,
    PARENT_SEQUENCE_NOT_FOUND: (nodeTime: TimeT) =>
        `Parent EventNodeSequence not found for an EventNode at time ${toTimeString(nodeTime)} (Did you forget to add it to a sequence?)`,
    NEEDS_AT_LEAST_ONE_ENS: () =>
        `Needs at least one EventNodeSequence`,
    SEQUENCE_TYPE_NOT_CONSISTENT: (typeStr: string, but: string) =>
        `EventNodeSequence type is not consistent (expected ${typeStr} but seen value ${but})`,
    
    
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
        `Invalid time tuple: '${typeof tuple === "undefined" ? 'undefined' : tuple.valueOf()}'`,




    CANNOT_DIVIDE_EXPRESSION_EVALUATOR: (id: string) =>
        `Cannot divide ExpressionEvaluator (Compiling ${id})`,


    UNIMPLEMENTED_TEMPLATE_EASING: (temEasName: string) =>
        `Unimplemented template easing: '${temEasName}'`,

    MISSING_MACRO_EVALUATOR_KEY: (pos: string) =>
        `Missing Macro Evaluator key. At ${pos}`,
    MACRO_EVALUATOR_NOT_FOUND: (evaluatorId: string, pos: string) =>
        `Macro Evaluator '${evaluatorId}' not found. At ${pos}`,
    TIME_MACRO_NOT_FOUND: (macroId: string, pos: string) =>
        `Time Macro '${macroId}' not found. At ${pos}`,
    VALUE_MACRO_NOT_FOUND: (macroId: string, pos: string) =>
        `Value Macro '${macroId}' not found. At ${pos}`,
    UNKNOWN_MACRO_EXPRESSION: (expression: string, macroId: string) =>
        `Unknown Macro Expression '${expression}'. At ${macroId}`,
    PROTO_PRESENT_IN_NONPARAMETRIC: (macroId: string) =>
        `'@proto can only be used in parametric Macros. At ${macroId}'`,
    JAVASCRIPT_SYNTAX_ERROR: (error: Error, macroId: string) =>
        `JavaScript Syntax Error: ${error.message}. At ${macroId}`,
    PARAMETRIC_MACRO_REQUIRES_PROTO_KEY: (pos) =>
        `Parametric Macro requires key. At ${pos}`,
    MACRO_NOT_PARAMETRIC: (macroId: string, pos) =>
        `Macro '${macroId}' is not parametric. At ${pos}`,
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
    static buffer: KPAError<ERROR_IDS>[] = [];
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
