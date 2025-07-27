import {
    assertEquals,
    assertThrows,
    runAPGsembly,
    test,
} from "../deps_test.ts";
import {
    APGM2Program,
    AssignmentStatement,
    Block,
    Fn,
    NumberExpr,
    VarDecl,
    VarExpr,
    VarName,
} from "./ast/ast.ts";
import { programToAPGsembly } from "./mod.ts";

test("integrationAPGM2 #REGISTERS unary", () => {
    assertEquals(
        programToAPGsembly(
            new APGM2Program(
                [new VarDecl(new VarName("x"), "unarynat", new NumberExpr(1))],
                new Fn("main", new Block([])),
            ),
        ),
        [
            '#REGISTERS {"U0":1}',
            "INITIAL; ZZ; STATE_1; NOP",
            "STATE_1;  *; STATE_END; NOP",
            "STATE_END;  *; STATE_END; HALT",
        ],
    );
});

test("integrationAPGM2 #REGISTERS unary negative", () => {
    assertThrows(() => {
        programToAPGsembly(
            new APGM2Program(
                [new VarDecl(new VarName("x"), "unarynat", new NumberExpr(-1))],
                new Fn("main", new Block([])),
            ),
        );
    });
});

test("integrationAPGM2 #REGISTERS unary 0", () => {
    assertEquals(
        programToAPGsembly(
            new APGM2Program(
                [new VarDecl(new VarName("x"), "unarynat", new NumberExpr(0))],
                new Fn("main", new Block([])),
            ),
        ),
        [
            "INITIAL; ZZ; STATE_1; NOP",
            "STATE_1;  *; STATE_END; NOP",
            "STATE_END;  *; STATE_END; HALT",
        ],
    );
});

test("integrationAPGM2 copy", () => {
    const code = programToAPGsembly(
        new APGM2Program(
            [
                new VarDecl(
                    new VarName("x"),
                    "unarynat",
                    new NumberExpr(3),
                ),
                new VarDecl(
                    new VarName("y"),
                    "unarynat",
                    new NumberExpr(0),
                ),
            ],
            new Fn(
                "main",
                new Block([
                    new AssignmentStatement(
                        new VarName("y"),
                        new VarExpr(new VarName("x")),
                    ),
                ]),
            ),
        ),
    );
    assertEquals(
        code,
        [
            '#REGISTERS {"U0":3}',
            "INITIAL; ZZ; STATE_1; NOP",
            "STATE_1;  *; STATE_3; TDEC U1",
            "STATE_3;  Z; STATE_2; NOP",
            "STATE_3; NZ; STATE_3; TDEC U1",
            "STATE_2;  *; STATE_5; TDEC U0",
            "STATE_5;  Z; STATE_4; NOP",
            "STATE_5; NZ; STATE_6_WHILE_BODY; NOP",
            "STATE_6_WHILE_BODY;  *; STATE_7; INC U1, NOP",
            "STATE_7;  *; STATE_2; INC U2, NOP",
            "STATE_4;  *; STATE_8; TDEC U2",
            "STATE_8;  Z; STATE_END; NOP",
            "STATE_8; NZ; STATE_8; INC U0, TDEC U2",
            "STATE_END;  *; STATE_END; HALT",
        ],
    );

    const machine = runAPGsembly(code.join("\n"));
    assertEquals(machine.actionExecutor.getUReg(0)?.getValue(), 3);
    assertEquals(machine.actionExecutor.getUReg(1)?.getValue(), 3);
    assertEquals(machine.actionExecutor.getUReg(2)?.getValue(), 0);
});
