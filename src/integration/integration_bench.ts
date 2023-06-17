import { integration } from "./mod.ts";
import { pi } from "./test_data.ts";

Deno.bench("integration", () => {
    integration(pi);
});
