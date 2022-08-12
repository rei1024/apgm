export {
    assertEquals,
    assertThrows,
} from "https://deno.land/std@0.152.0/testing/asserts.ts";

export { runAPGsembly } from "https://rei1024.github.io/proj/apgsembly-emulator-2/src/exports.js?2022_08_07";

export function test(name: string, fn: () => void) {
    return Deno.test(name, fn);
}
