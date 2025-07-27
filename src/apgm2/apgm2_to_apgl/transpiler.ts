import { APGLExpr, SeqAPGLExpr } from "../../apgl/ast/mod.ts";
import {
    APGM2Program,
    AssignmentStatement,
    NumberExpr,
    Statement,
    VarExpr,
    VarName,
} from "../ast/ast.ts";
import { APGLTemplate } from "./apgl_template.ts";

class APGsemblyRegisterHeader {
    private object: Record<string, unknown> = {};
    constructor() {}

    toLines(): string[] {
        if (Object.keys(this.object).length === 0) {
            return [];
        }
        return ["#REGISTERS " + JSON.stringify(this.object)];
    }

    setUnary(n: number, value: number) {
        if (!Number.isInteger(value)) {
            throw new Error("Not a integer");
        }
        if (value < 0) {
            throw new Error("is negative: " + value);
        }
        this.object["U" + n] = value;
    }
}

abstract class Variable {}

class UnaryNat extends Variable {
    constructor(public readonly registerNumber: number) {
        super();
    }
}

class APGM2Transpiler {
    private registerHeader: APGsemblyRegisterHeader =
        new APGsemblyRegisterHeader();
    private nextUnary: number = 0;

    /**
     * key is variable name
     */
    private globalVarMap: Map<string, Variable> = new Map();

    constructor() {}

    transpileAPGM2Program(apgm2Program: APGM2Program): APGLExpr {
        for (const decl of apgm2Program.globalVariables) {
            switch (decl.varType) {
                case "unarynat": {
                    const registerNum = this.getNextUnaryNum();
                    if (this.globalVarMap.has(decl.varName.value)) {
                        throw new Error("duplicated global variable name");
                    }
                    this.globalVarMap.set(
                        decl.varName.value,
                        new UnaryNat(registerNum),
                    );
                    if (decl.initExpr instanceof NumberExpr) {
                        if (decl.initExpr.value !== 0) {
                            this.registerHeader.setUnary(
                                registerNum,
                                decl.initExpr.value,
                            );
                        }
                    } else {
                        throw Error("non number initialization");
                    }

                    break;
                }
                default: {
                    decl.varType satisfies never;
                }
            }
        }
        return new SeqAPGLExpr(
            apgm2Program.main.body.stmts.map((stmt) =>
                this.transpileStatment(stmt)
            ),
        );
    }

    private resolveRegisterNumber(varName: VarName): number {
        const v = this.globalVarMap.get(varName.value);
        if (v instanceof UnaryNat) {
            return v.registerNumber;
        }

        throw new Error("variable declaration not found");
    }

    private transpileStatment(stmt: Statement): APGLExpr {
        if (stmt instanceof AssignmentStatement) {
            const expr = stmt.expr;
            if (expr instanceof VarExpr) {
                if (stmt.name.value === expr.varName.value) {
                    // no op
                    return new SeqAPGLExpr([]);
                } else {
                    return this.temporaryUnaryNum((tempURegNum) => {
                        return APGLTemplate.assignUnary(
                            this.resolveRegisterNumber(stmt.name),
                            this.resolveRegisterNumber(expr.varName),
                            tempURegNum,
                        );
                    });
                }
            } else {
                throw new Error("Complicated expression");
            }
        }

        throw new Error("Unknown statement type");
    }

    getRegistersHeader(): string[] {
        return this.registerHeader.toLines();
    }

    getGlobalMap(): ReadonlyMap<string, Variable> {
        return this.globalVarMap;
    }

    private getNextUnaryNum() {
        const num = this.nextUnary;
        this.nextUnary++;
        return num;
    }

    private temporaryUnaryNum<T>(fn: (tempNum: number) => T): T {
        const num = this.nextUnary;
        this.nextUnary++;
        const result = fn(num);
        this.nextUnary--;
        return result;
    }
}

export function transpileAPGM2Program(apgm2Program: APGM2Program): {
    registersHeader: string[];
    expr: APGLExpr;
} {
    const transpiler = new APGM2Transpiler();
    const expr = transpiler.transpileAPGM2Program(apgm2Program);

    return {
        registersHeader: transpiler.getRegistersHeader(),
        expr,
    };
}
