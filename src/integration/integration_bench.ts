import { integration } from "./mod.ts";
import { pi } from "./test_data.ts";

// deno bench src/integration/integration_bench.ts

Deno.bench("integration", () => {
    integration(pi);
});
