import { transpileAPGL } from "./transpiler.ts";
import {
    ActionAPGLExpr,
    IfAPGLExpr,
    LoopAPGLExpr,
    SeqAPGLExpr,
    WhileAPGLExpr,
} from "../apgl/ast/mod.ts";

import { assertEquals, test } from "../deps_test.ts";

test("transpileAPGL", () => {
    const expr = new ActionAPGLExpr(["NOP"]);
    assertEquals(transpileAPGL(expr), [
        "INITIAL; *; STATE_1_INITIAL; NOP",
        "STATE_1_INITIAL; *; STATE_2; NOP",
        "STATE_2; *; STATE_2; HALT_OUT",
    ]);
});

test("transpileAPGL if", () => {
    const expr = new SeqAPGLExpr([
        new IfAPGLExpr(
            new ActionAPGLExpr(["TDEC U0"]),
            new ActionAPGLExpr(["INC U0", "NOP"]),
            new ActionAPGLExpr(["INC U1", "NOP"]),
        ),
    ]);

    assertEquals(transpileAPGL(expr), [
        "INITIAL; *; STATE_1_INITIAL; NOP",
        "STATE_1_INITIAL; *; STATE_2; TDEC U0",
        "STATE_2; Z; STATE_3_IF_Z; NOP",
        "STATE_2; NZ; STATE_4_IF_NZ; NOP",
        "STATE_3_IF_Z; *; STATE_5; INC U0, NOP",
        "STATE_4_IF_NZ; *; STATE_6; INC U1, NOP",
        "STATE_5; *; STATE_6; NOP",
        "STATE_6; *; STATE_6; HALT_OUT",
    ]);
});

test("transpileAPGL loop", () => {
    const expr = new LoopAPGLExpr(
        new ActionAPGLExpr(["INC U0", "NOP"]),
    );

    assertEquals(transpileAPGL(expr), [
        "INITIAL; *; STATE_1_INITIAL; NOP",
        "STATE_1_INITIAL; *; STATE_3; INC U0, NOP",
        "STATE_3; *; STATE_1_INITIAL; NOP",
        "STATE_2_LOOP_BREAK; *; STATE_2_LOOP_BREAK; HALT_OUT",
    ]);
});

test("transpileAPGL while", () => {
    const expr = new WhileAPGLExpr(
        "NZ",
        new ActionAPGLExpr(["TDEC U0"]),
        new SeqAPGLExpr([]),
    );

    assertEquals(transpileAPGL(expr), [
        "INITIAL; *; STATE_1_INITIAL; NOP",
        "STATE_1_INITIAL; *; STATE_2; TDEC U0",
        "STATE_2; Z; STATE_3_WHILE_END; NOP",
        "STATE_2; NZ; STATE_1_INITIAL; NOP",
        "STATE_3_WHILE_END; *; STATE_3_WHILE_END; HALT_OUT",
    ]);
});

test("transpileAPGL options", () => {
    const expr = new ActionAPGLExpr(["NOP"]);
    assertEquals(transpileAPGL(expr, { prefix: "X_" }), [
        "INITIAL; *; X_1_INITIAL; NOP",
        "X_1_INITIAL; *; X_2; NOP",
        "X_2; *; X_2; HALT_OUT",
    ]);
});
