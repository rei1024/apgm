import { APGMExpr, type APGMSourceSpan } from "./core.ts";

export class NumberAPGMExpr extends APGMExpr {
    constructor(
        public readonly value: number,
        public readonly span?: APGMSourceSpan | undefined,
    ) {
        super();
    }

    transform(f: (_: APGMExpr) => APGMExpr): APGMExpr {
        return f(this);
    }

    pretty() {
        return this.value.toString();
    }
}
