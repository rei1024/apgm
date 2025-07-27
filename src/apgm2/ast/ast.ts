export class VarName {
    constructor(public readonly value: string) {}
}

export type VarType = "unarynat";

export class VarDecl {
    /**
     * `let <varName>: <varType> = <initExpr>`
     */
    constructor(
        public readonly varName: VarName,
        public readonly varType: VarType,
        public readonly initExpr: Expr,
    ) {}
}

export abstract class Expr {
}

export class NumberExpr extends Expr {
    constructor(public readonly value: number) {
        super();
    }
}

export class VarExpr extends Expr {
    constructor(public readonly varName: VarName) {
        super();
    }
}

export class Fn {
    // TODO: args
    constructor(public readonly name: string, public readonly body: Block) {}
}

export abstract class Statement {
}

export class AssignmentStatement extends Statement {
    constructor(public readonly name: VarName, public readonly expr: Expr) {
        super();
    }
}

export class Block {
    constructor(public readonly stmts: readonly Statement[]) {}
}

export class APGM2Program {
    constructor(
        public readonly globalVariables: VarDecl[],
        public readonly main: Fn,
    ) {
    }
}
