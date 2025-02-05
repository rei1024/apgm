import { APGMExpr, APGMSourceSpan } from "./core.ts";

/**
 * var x: U
 */
export class VarDeclAPGMExpr extends APGMExpr {
    constructor(public readonly name: string,
        public readonly type: 'U' | 'B',
        public readonly span: APGMSourceSpan | undefined) {
        super();
    }

    override transform(f: (_: APGMExpr) => APGMExpr): APGMExpr {
        return f(this);
    }

    override pretty(): string {
        return `var ${this.name}: ${this.type}`;
    }

    override getSpan(): APGMSourceSpan | undefined {
        return this.span;
    }
}
