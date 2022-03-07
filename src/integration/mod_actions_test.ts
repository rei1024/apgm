import { integration } from "./mod.ts";
import { assertEquals, assertThrows, test } from "../deps_test.ts";

test("integration 0", () => {
    const src = `
    nop();
    halt_out();
    `;
    const res = integration(src);
    assertEquals(res, [
        "# State    Input    Next state    Actions",
        "# ---------------------------------------",
        "INITIAL; *; STATE_1_INITIAL; NOP",
        "STATE_1_INITIAL; *; STATE_2; NOP",
        "STATE_2; *; STATE_END; HALT_OUT",
        "STATE_END; *; STATE_END; HALT_OUT",
    ]);
});
