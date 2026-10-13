import { defineConfig } from "vitest/config";

export default defineConfig({
    base: "./",
    test: {
        include: ["src/**/*_test.ts", "src/**/test.ts"],
        exclude: ["src/deps_test.ts", "**/node_modules/**"],
        passWithNoTests: true,
        coverage: {
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*_test.ts",
                "src/**/test.ts",
                "src/deps_test.ts",
                "src/types/**",
                "src/integration/integration_bench.ts",
            ],
        },
    },
});
