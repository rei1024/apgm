import { test } from "vitest";
import { integration } from "./mod.ts";
import { pi } from "./test_data.ts";

test("integration bench", ({ bench }) => {
    bench("integration", () => {
        integration(pi);
    });
});
