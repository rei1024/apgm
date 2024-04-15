export {
    assertEquals,
    assertThrows,
} from "https://deno.land/std@0.222.1/assert/mod.ts";

export { runAPGsembly } from "./deps.ts";

export function test(name: string, fn: () => void) {
    return Deno.test(name, fn);
}
