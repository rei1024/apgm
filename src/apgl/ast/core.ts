/**
 * Low level expression
 */
export abstract class APGLExpr {
    constructor() {
    }

    abstract transform(f: (_: APGLExpr) => APGLExpr): APGLExpr;
}
