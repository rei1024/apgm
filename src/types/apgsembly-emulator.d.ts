declare module "apgsembly-emulator/src/exports.js" {
    export class Action {
        constructor(...args: any[]);
        doesReturnValue(): boolean;
        isSameComponent(other: Action): boolean;
        pretty(): string;
    }
    export class HaltOutAction extends Action {}
    export class NopAction extends Action {}
    export function parseAction(str: string): Action;
    export function runAPGsembly(src: string): any;
    export function formatAPGsembly(src: string): string;
    export function generateComponentsHeaderForSource(src: string): string;
}
