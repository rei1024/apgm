import {
    APGMExpr,
    ErrorWithSpan,
    formatLocationAt,
    FuncAPGMExpr,
    IfAPGMExpr,
    LoopAPGMExpr,
    NumberAPGMExpr,
    SeqAPGMExpr,
    StringAPGMExpr,
    VarAPGMExpr,
    WhileAPGMExpr,
} from "../apgm/ast/mod.ts";

import {
    APGLExpr,
    IfAPGLExpr,
    LoopAPGLExpr,
    SeqAPGLExpr,
    WhileAPGLExpr,
} from "../apgl/ast/mod.ts";
import { transpileFuncAPGMExpr } from "./lib/transpile_func.ts";

export { strArgFuncs, numArgFuncs, emptyArgFuncs } from "./lib/transpile_func.ts";

export function transpileAPGMExpr(e: APGMExpr): APGLExpr {
    const t = transpileAPGMExpr;
    if (e instanceof FuncAPGMExpr) {
        return transpileFuncAPGMExpr(e, transpileAPGMExpr);
    } else if (e instanceof IfAPGMExpr) {
        if (e.modifier === "Z") {
            return new IfAPGLExpr(
                t(e.cond),
                t(e.thenBody),
                e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody),
            );
        } else {
            return new IfAPGLExpr(
                t(e.cond),
                e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody),
                t(e.thenBody),
            );
        }
    } else if (e instanceof LoopAPGMExpr) {
        return new LoopAPGLExpr(t(e.body));
    } else if (e instanceof NumberAPGMExpr) {
        throw new ErrorWithSpan(
            `number is not allowed: ${e.raw ?? e.value}${
                formatLocationAt(e.span?.start)
            }`,
            e.span,
        );
    } else if (e instanceof SeqAPGMExpr) {
        return new SeqAPGLExpr(e.exprs.map((x) => t(x)));
    } else if (e instanceof StringAPGMExpr) {
        throw new ErrorWithSpan(
            `string is not allowed: ${e.pretty()}${
                formatLocationAt(e.span?.start)
            }`,
            e.span,
        );
    } else if (e instanceof WhileAPGMExpr) {
        return new WhileAPGLExpr(e.modifier, t(e.cond), t(e.body));
    } else if (e instanceof VarAPGMExpr) {
        throw new ErrorWithSpan(
            `macro variable is not allowed: variable "${e.name}"${
                formatLocationAt(e.span?.start)
            }`,
            e.span,
        );
    }

    throw Error("internal error");
}
