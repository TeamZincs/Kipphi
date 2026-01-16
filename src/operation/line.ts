import { Chart, JudgeLineGroup, BasicEventName, UIName } from "../chart";
import { ExtendedEventTypeName, RGB } from "../chartTypes";
import { EventNodeSequence } from "../event";
import { JudgeLine, ExtendedLayer } from "../judgeline";
import { Operation } from "./basic";



// 有点怪异，感觉破坏了纯净性。不管了（
enum JudgeLinesEditorLayoutType {
    ordered = 0b001,
    tree    = 0b010,
    grouped = 0b100
}


export class JudgeLineInheritanceChangeOperation extends Operation {
    originalValue: JudgeLine | null;
    updatesEditor = true;
    static REFLOWS = JudgeLinesEditorLayoutType.tree;
    reflows = JudgeLineInheritanceChangeOperation.REFLOWS;
    constructor(public chart: Chart, public judgeLine: JudgeLine, public value: JudgeLine | null) {
        super();
        this.originalValue = judgeLine.father;
        // 这里只会让它静默失败，外面调用的时候能够在判断一次并抛错误才是最好的
        if (JudgeLine.checkinterdependency(judgeLine, value)) {
            this.ineffective = true;
        }
    }
    do() {
        const line = this.judgeLine;
        line.father = this.value;
        if (this.originalValue) {
            this.originalValue.children.delete(line);
        } else {
            const index = this.chart.orphanLines.indexOf(line);
            if (index >= 0) // Impossible to be false, theoretically
                this.chart.orphanLines.splice(index, 1)
        }
        if (this.value) {
            this.value.children.add(line);
        } else {
            this.chart.orphanLines.push(line);
        }
    }
    undo() {
        const line = this.judgeLine;
        line.father = this.originalValue;
        if (this.originalValue) {
            this.originalValue.children.add(line);
        } else {
            this.chart.orphanLines.push(line);
        }
        if (this.value) {
            this.value.children.delete(line);
        } else {
            const index = this.chart.orphanLines.indexOf(line);
            if (index >= 0) // Impossible to be false, theoretically
                this.chart.orphanLines.splice(index, 1)
        }
    }
}

export class JudgeLineRenameOperation extends Operation { 
    updatesEditor = true;
    originalValue: string;
    constructor(public judgeLine: JudgeLine, public value: string) {
        super();
        this.originalValue = judgeLine.name;
    }
    do() {
        this.judgeLine.name = this.value;
    }
    undo() {
        this.judgeLine.name = this.originalValue;
    }
}

type JudgeLinePropName = "name" | "rotatesWithFather" | "anchor" | "texture" | "cover" | "zOrder";

export class JudgeLinePropChangeOperation<T extends JudgeLinePropName> extends Operation {
    updatesEditor = true;
    originalValue: JudgeLine[T];
    constructor(public judgeLine: JudgeLine, public field: T, public value: JudgeLine[T]) {
        super();
        this.originalValue = judgeLine[field];
    }
    do() {
        this.judgeLine[this.field] = this.value;
    }
    undo() {
        this.judgeLine[this.field] = this.originalValue;
    }
}

export class JudgeLineRegroupOperation extends Operation {
    updatesEditor = true;
    reflows = JudgeLinesEditorLayoutType.grouped;
    originalValue: JudgeLineGroup;
    constructor(public judgeLine: JudgeLine, public value: JudgeLineGroup) {
        super();
        this.originalValue = judgeLine.group;
    }
    do() {
        this.judgeLine.group = this.value;
        this.value.add(this.judgeLine);
        this.originalValue.remove(this.judgeLine);
    }
    undo() {
        this.judgeLine.group = this.originalValue;
        this.originalValue.add(this.judgeLine);
        this.value.remove(this.judgeLine);
    }
}

export class JudgeLineCreateOperation extends Operation {
    reflows = JudgeLinesEditorLayoutType.grouped | JudgeLinesEditorLayoutType.tree | JudgeLinesEditorLayoutType.ordered;
    // 之前把=写成了:半天不知道咋错了
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
    }
    do() {
        const id = this.chart.judgeLines.length;
        this.judgeLine.id = id;
        this.chart.judgeLines.push(this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.chart.judgeLineGroups[0].add(this.judgeLine);
    }
    undo() {
        this.chart.judgeLineGroups[0].remove(this.judgeLine);
        this.chart.judgeLines.splice(this.chart.judgeLines.indexOf(this.judgeLine), 1);
        this.chart.orphanLines.splice(this.chart.orphanLines.indexOf(this.judgeLine), 1);
    }
}

export class JudgeLineDeleteOperation extends Operation {
    readonly originalGroup: JudgeLineGroup;
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
        if (!this.chart.judgeLines.includes(this.judgeLine)) {
            this.ineffective = true;
        }
        this.originalGroup = judgeLine.group;
    }
    do() {
        this.chart.judgeLines.splice(this.chart.judgeLines.indexOf(this.judgeLine), 1);
        if (this.chart.orphanLines.includes(this.judgeLine)) {
            this.chart.orphanLines.splice(this.chart.orphanLines.indexOf(this.judgeLine), 1);
        }
        this.originalGroup.remove(this.judgeLine);
    }
    undo() {
        this.chart.judgeLines.push(this.judgeLine);
        this.chart.orphanLines.push(this.judgeLine);
        this.originalGroup.add(this.judgeLine);
    }
}



export class JudgeLineENSChangeOperation extends Operation {
    originalValue: EventNodeSequence;
    constructor(public judgeLine: JudgeLine, public layerId: number, public typeStr: BasicEventName, public value: EventNodeSequence) {
        super();
        this.originalValue = judgeLine.eventLayers[layerId][typeStr];
    }
    do() {
        this.judgeLine.eventLayers[this.layerId][this.typeStr] = this.value;
    }
    undo() {
        this.judgeLine.eventLayers[this.layerId][this.typeStr] = this.originalValue;
    }
}


export type ENSOfTypeName<T extends ExtendedEventTypeName> = {
    "scaleX": EventNodeSequence<number>,
    "scaleY": EventNodeSequence<number>
    "text": EventNodeSequence<string>,
    "color": EventNodeSequence<RGB> 
}[T]
export class JudgeLineExtendENSChangeOperation<T extends ExtendedEventTypeName> extends Operation {
    originalValue: ENSOfTypeName<T>;
    constructor(public judgeLine: JudgeLine, public typeStr: T, public value: ENSOfTypeName<T> | null) {
        super();
        this.originalValue = judgeLine.extendedLayer[typeStr satisfies keyof ExtendedLayer] as ENSOfTypeName<T>;
    }
    do() {
        this.judgeLine.extendedLayer[this.typeStr] = this.value
    }
    undo() {
        this.judgeLine.extendedLayer[this.typeStr] = this.originalValue
    }

}

export class UIAttachOperation extends Operation {
    updatesEditor = true;
    constructor(public chart: Chart, public judgeLine: JudgeLine, public ui: UIName) {
        super();
    }
    do() {
        this.chart.attachUIToLine(this.ui, this.judgeLine);
    }
    undo() {
        this.chart.detachUI(this.ui);
    }
}

export class UIDetachOperation extends Operation {
    updatesEditor = true;
    judgeLine: JudgeLine;
    constructor(public chart: Chart, public ui: UIName) {
        super();
        if (chart[`${ui}Attach` satisfies keyof Chart]) {
            this.judgeLine = chart[`${ui}Attach` satisfies keyof Chart];
        } else {
            this.ineffective = true;
        }
    }
    do() {
        this.chart.detachUI(this.ui);
    }
    undo() {
        this.chart.attachUIToLine(this.ui, this.judgeLine);
    }
}

export class JudgeLineDetachAllUIOperation extends Operation {
    updatesEditor = true;
    uinames: UIName[];
    constructor(public chart: Chart, public judgeLine: JudgeLine) {
        super();
        this.uinames = chart.queryJudgeLineUI(this.judgeLine);
    }
    do() {
        for (const ui of this.uinames) {
            this.chart.detachUI(ui);
        }
    }
    undo() {
        for (const ui of this.uinames) {
            this.chart.attachUIToLine(ui, this.judgeLine);
        }
    }
}