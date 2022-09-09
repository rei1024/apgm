import { bundle } from "https://deno.land/x/emit@0.9.0/mod.ts";

import * as swc from "https://deno.land/x/swc@0.2.1/mod.ts";

const result = await bundle("./src/integration/mod.ts");

const { code } = result;

const { code: minify } = swc.print(
    swc.parse(
        code,
        { syntax: "ecmascript", script: false, importAssertions: true },
    ),
    { minify: true },
);

const outputPath = "./dist/integration.js";

if (Deno.args.includes("check")) {
    const current = await Deno.readTextFile(outputPath);
    if (current.trim() !== minify.trim()) {
        console.error("%cRun `deno task bundle`.", "color: red");
        Deno.exit(1);
    }
} else {
    await Deno.writeTextFile(outputPath, minify);
}
