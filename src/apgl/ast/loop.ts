import { APGLExpr } from "./core.ts";

export class LoopAPGLExpr extends APGLExpr {
    constructor(
        public readonly body: APGLExpr,
    ) {
        super();
    }
}
