import { A } from "../../apgl/actions.ts";
import { SeqAPGLExpr, WhileAPGLExpr } from "../../apgl/ast/mod.ts";

export class APGLTemplate {
    /**
     * a = a + b
     *
     * Precondition: temp = 0
     */
    static addUnary(a: number, b: number, temp: number) {
        return new SeqAPGLExpr([
            new WhileAPGLExpr(
                "NZ",
                A.tdecU(b),
                new SeqAPGLExpr([A.incU(a), A.incU(temp)]),
            ),
            new WhileAPGLExpr("NZ", A.tdecU(temp), A.incU(b)),
        ]);
    }

    /**
     * a = 0
     */
    static zeroUnary(a: number) {
        return new WhileAPGLExpr("NZ", A.tdecU(a), new SeqAPGLExpr([]));
    }

    /**
     * a = b
     *
     * Precondition: temp = 0
     */
    static assignUnary(a: number, b: number, temp: number) {
        return new SeqAPGLExpr([
            APGLTemplate.zeroUnary(a),
            APGLTemplate.addUnary(a, b, temp),
        ]);
    }
}
