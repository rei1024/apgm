import {
    APGMExpr,
    ErrorWithSpan,
    formatLocationAt,
    FuncAPGMExpr,
    Macro,
    Main,
    SeqAPGMExpr,
    VarAPGMExpr,
} from "../ast/mod.ts";
import { VarDeclAPGMExpr } from "../ast/var_decl.ts";
import { dups } from "./_dups.ts";

function argumentsMessage(num: number): string {
    return `${num} argument${num === 1 ? "" : "s"}`;
}

function internalError(): never {
    throw new Error("internal error");
}

/**
 * macroのbodyに現れる変数を呼び出した引数で置き換え
 */
function replaceVarInBoby(macro: Macro, funcExpr: FuncAPGMExpr): APGMExpr {
    const exprs = funcExpr.args;
    if (exprs.length !== macro.args.length) {
        throw new ErrorWithSpan(
            `Error at "${macro.name}": this macro takes ${
                argumentsMessage(macro.args.length)
            } but ${argumentsMessage(exprs.length)} was supplied` +
                `${formatLocationAt(funcExpr.span?.start)}`,
            funcExpr.span,
        );
    }

    const nameToExpr: Map<string, APGMExpr> = new Map(
        macro.args.map((a, i) => [a.name, exprs[i] ?? internalError()]),
    );

    return macro.body.transform((x) => {
        if (x instanceof VarAPGMExpr) {
            const expr = nameToExpr.get(x.name);
            if (expr === undefined) {
                throw new ErrorWithSpan(
                    `Error: Unknown variable "${x.name}"${
                        formatLocationAt(x.span?.start)
                    }`,
                    x.span,
                );
            }
            return expr;
        } else {
            return x;
        }
    });
}

const MAX_COUNT = 100000;

type Vars = Map<string,
    {
        type: 'B' | 'U',
        value: number,
    }
>

export class MacroExpander {
    readonly #macroMap: Map<string, Macro>;
    readonly #globalVarMap: Vars;
    #count = 0;
    readonly #mainSeqExpr: APGMExpr;

    constructor(main: SeqAPGMExpr, macroMap: Map<string, Macro>, globalVarMap: Vars) {
        this.#mainSeqExpr = main;
        this.#macroMap = macroMap;
        this.#globalVarMap = globalVarMap;
    }

    static make(main: Main): MacroExpander {
        const macroMap = new Map(main.macros.map((m) => [m.name, m]));
        if (macroMap.size < main.macros.length) {
            const ds = dups(main.macros.map((x) => x.name));
            const d = ds[0];
            const span = main.macros.slice().reverse().find((x) => x.name === d)
                ?.span;
            const location = span?.start;
            throw new ErrorWithSpan(
                `There is a macro with the same name: "${d}"` +
                    formatLocationAt(location),
                span,
            );
        }

        const globalVarMap: Vars = new Map();
        let lastB = 0;
        let lastU = 0;

        const withoutDeclSeq = [...main.seqExpr.exprs]
        for (const expr of main.seqExpr.exprs) {
            if (expr instanceof VarDeclAPGMExpr) {
                if (globalVarMap.has(expr.name)) {
                    throw new ErrorWithSpan(
                        `Error: variable "${expr.name}" is already defined`,
                        expr.span,
                    );
                }

                globalVarMap.set(expr.name, {
                    type: expr.type,
                    value: expr.type === 'B' ? lastB++ : lastU++,
                });
            } else {
                withoutDeclSeq.push(expr);
            }
        }

        return new MacroExpander(new SeqAPGMExpr(withoutDeclSeq), macroMap, globalVarMap);
    }

    expand(): APGMExpr {
        return this.#expandExpr(this.#mainSeqExpr);
    }

    #expandExpr(expr: APGMExpr): APGMExpr {
        if (MAX_COUNT < this.#count) {
            throw Error("too many macro expansion");
        }
        this.#count++;
        return expr.transform((x) => this.#expandOnce(x));
    }

    #expandOnce(x: APGMExpr): APGMExpr {
        if (x instanceof FuncAPGMExpr) {
            return this.#expandFuncAPGMExpr(x);
        } else {
            return x;
        }
    }

    #expandFuncAPGMExpr(funcExpr: FuncAPGMExpr): APGMExpr {
        const macro = this.#macroMap.get(funcExpr.name);
        if (macro !== undefined) {
            const expanded = replaceVarInBoby(macro, funcExpr);
            return this.#expandExpr(expanded);
        } else {
            return funcExpr;
        }
    }
}

/**
 * Expand macro
 */
export function expand(main: Main): APGMExpr {
    return MacroExpander.make(main).expand();
}
