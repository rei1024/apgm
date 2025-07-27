import { transpileAPGL } from "../apgl_to_apgsembly/mod.ts";
import { transpileAPGM2Program } from "./apgm2_to_apgl/transpiler.ts";
import { APGM2Program } from "./ast/ast.ts";
import { parseAPGM2Program } from "./parser/mod.ts";

/**
 * export for testing
 */
export function programToAPGsembly(program: APGM2Program): string[] {
    const { expr: apglExpr, registersHeader } = transpileAPGM2Program(program);
    const apgsembly = transpileAPGL(apglExpr);
    return [...registersHeader, ...apgsembly];
}

export function integrationAPGM2(src: string): string[] {
    const program = parseAPGM2Program(src);
    return programToAPGsembly(program);
}
