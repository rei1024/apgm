import { APGMExpr, type APGMSourceSpan } from "./core.ts";
import { VarAPGMExpr } from "./var.ts";

/**
 * Macro declaration
 */
export class Macro {
    /**
     * @param name include !
     */
    constructor(
        public readonly name: string,
        public readonly args: readonly VarAPGMExpr[],
        public readonly body: APGMExpr,
        public readonly span: APGMSourceSpan | undefined,
    ) {
    }

    pretty(): string {
        return `macro ${this.name}(${
            this.args.map((x) => x.pretty()).join(", ")
        }) ${this.body.pretty()}`;
    }

    prettyHead(): string {
        return `macro ${this.name}(${
            this.args.map((x) => x.pretty()).join(", ")
        })`;
    }
}
