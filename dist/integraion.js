class Parser {
    constructor(action) {
        this.action = action;
    }
    parse(input) {
        const location2 = {
            index: 0,
            line: 1,
            column: 1,
        };
        const context = new Context({
            input,
            location: location2,
        });
        const result = this.skip(eof).action(context);
        if (result.type === "ActionOK") {
            return {
                type: "ParseOK",
                value: result.value,
            };
        }
        return {
            type: "ParseFail",
            location: result.furthest,
            expected: result.expected,
        };
    }
    tryParse(input) {
        const result = this.parse(input);
        if (result.type === "ParseOK") {
            return result.value;
        }
        const { expected, location: location2 } = result;
        const { line, column } = location2;
        const message =
            `parse error at line ${line} column ${column}: expected ${
                expected.join(", ")
            }`;
        throw new Error(message);
    }
    and(parserB) {
        return new Parser((context) => {
            const a = this.action(context);
            if (a.type === "ActionFail") {
                return a;
            }
            context = context.moveTo(a.location);
            const b = context.merge(a, parserB.action(context));
            if (b.type === "ActionOK") {
                const value = [
                    a.value,
                    b.value,
                ];
                return context.merge(b, context.ok(b.location.index, value));
            }
            return b;
        });
    }
    skip(parserB) {
        return this.and(parserB).map(([a]) => a);
    }
    next(parserB) {
        return this.and(parserB).map(([, b]) => b);
    }
    or(parserB) {
        return new Parser((context) => {
            const a = this.action(context);
            if (a.type === "ActionOK") {
                return a;
            }
            return context.merge(a, parserB.action(context));
        });
    }
    chain(fn) {
        return new Parser((context) => {
            const a = this.action(context);
            if (a.type === "ActionFail") {
                return a;
            }
            const parserB = fn(a.value);
            context = context.moveTo(a.location);
            return context.merge(a, parserB.action(context));
        });
    }
    map(fn) {
        return this.chain((a) => {
            return ok(fn(a));
        });
    }
    thru(fn) {
        return fn(this);
    }
    desc(expected) {
        return new Parser((context) => {
            const result = this.action(context);
            if (result.type === "ActionOK") {
                return result;
            }
            return {
                type: "ActionFail",
                furthest: result.furthest,
                expected,
            };
        });
    }
    wrap(before, after) {
        return before.next(this).skip(after);
    }
    trim(beforeAndAfter) {
        return this.wrap(beforeAndAfter, beforeAndAfter);
    }
    repeat(min = 0, max = Infinity) {
        if (!isRangeValid(min, max)) {
            throw new Error(`repeat: bad range (${min} to ${max})`);
        }
        if (min === 0) {
            return this.repeat(1, max).or(ok([]));
        }
        return new Parser((context) => {
            const items = [];
            let result = this.action(context);
            if (result.type === "ActionFail") {
                return result;
            }
            while (result.type === "ActionOK" && items.length < max) {
                items.push(result.value);
                if (result.location.index === context.location.index) {
                    throw new Error(
                        "infinite loop detected; don't call .repeat() with parsers that can accept zero characters",
                    );
                }
                context = context.moveTo(result.location);
                result = context.merge(result, this.action(context));
            }
            if (result.type === "ActionFail" && items.length < min) {
                return result;
            }
            return context.merge(
                result,
                context.ok(context.location.index, items),
            );
        });
    }
    sepBy(separator, min = 0, max = Infinity) {
        if (!isRangeValid(min, max)) {
            throw new Error(`sepBy: bad range (${min} to ${max})`);
        }
        if (min === 0) {
            return this.sepBy(separator, 1, max).or(ok([]));
        }
        if (max === 1) {
            return this.map((x) => [
                x,
            ]);
        }
        return this.chain((first) => {
            return separator.next(this).repeat(min - 1, max - 1).map((rest) => {
                return [
                    first,
                    ...rest,
                ];
            });
        });
    }
    node(name) {
        return all(location, this, location).map(([start, value, end]) => {
            const type = "ParseNode";
            return {
                type,
                name,
                value,
                start,
                end,
            };
        });
    }
}
function isRangeValid(min, max) {
    return min <= max && min >= 0 && max >= 0 && Number.isInteger(min) &&
        min !== Infinity && (Number.isInteger(max) || max === Infinity);
}
const location = new Parser((context) => {
    return context.ok(context.location.index, context.location);
});
function ok(value) {
    return new Parser((context) => {
        return context.ok(context.location.index, value);
    });
}
function fail(expected) {
    return new Parser((context) => {
        return context.fail(context.location.index, expected);
    });
}
const eof = new Parser((context) => {
    if (context.location.index < context.input.length) {
        return context.fail(context.location.index, [
            "<EOF>",
        ]);
    }
    return context.ok(context.location.index, "<EOF>");
});
function text(string) {
    return new Parser((context) => {
        const start = context.location.index;
        const end = start + string.length;
        if (context.input.slice(start, end) === string) {
            return context.ok(end, string);
        }
        return context.fail(start, [
            string,
        ]);
    });
}
function match(regexp) {
    for (const flag of regexp.flags) {
        switch (flag) {
            case "i":
            case "s":
            case "m":
            case "u":
                continue;
            default:
                throw new Error("only the regexp flags 'imsu' are supported");
        }
    }
    const sticky = new RegExp(regexp.source, regexp.flags + "y");
    return new Parser((context) => {
        const start = context.location.index;
        sticky.lastIndex = start;
        const match2 = context.input.match(sticky);
        if (match2) {
            const end = start + match2[0].length;
            const string = context.input.slice(start, end);
            return context.ok(end, string);
        }
        return context.fail(start, [
            String(regexp),
        ]);
    });
}
function all(...parsers) {
    return parsers.reduce((acc, p) => {
        return acc.chain((array) => {
            return p.map((value) => {
                return [
                    ...array,
                    value,
                ];
            });
        });
    }, ok([]));
}
function choice(...parsers) {
    return parsers.reduce((acc, p) => {
        return acc.or(p);
    });
}
function lazy(fn) {
    const parser = new Parser((context) => {
        parser.action = fn().action;
        return parser.action(context);
    });
    return parser;
}
function union(a, b) {
    return [
        ...new Set([
            ...a,
            ...b,
        ]),
    ];
}
class Context {
    constructor(options) {
        this.input = options.input;
        this.location = options.location;
    }
    moveTo(location2) {
        return new Context({
            input: this.input,
            location: location2,
        });
    }
    _internal_move(index) {
        if (index === this.location.index) {
            return this.location;
        }
        const start = this.location.index;
        const end = index;
        const chunk = this.input.slice(start, end);
        let { line, column } = this.location;
        for (const ch of chunk) {
            if (ch === "\n") {
                line++;
                column = 1;
            } else {
                column++;
            }
        }
        return {
            index,
            line,
            column,
        };
    }
    ok(index, value) {
        return {
            type: "ActionOK",
            value,
            location: this._internal_move(index),
            furthest: {
                index: -1,
                line: -1,
                column: -1,
            },
            expected: [],
        };
    }
    fail(index, expected) {
        return {
            type: "ActionFail",
            furthest: this._internal_move(index),
            expected,
        };
    }
    merge(a, b) {
        if (b.furthest.index > a.furthest.index) {
            return b;
        }
        const expected = b.furthest.index === a.furthest.index
            ? union(a.expected, b.expected)
            : a.expected;
        if (b.type === "ActionOK") {
            return {
                type: "ActionOK",
                location: b.location,
                value: b.value,
                furthest: a.furthest,
                expected,
            };
        }
        return {
            type: "ActionFail",
            furthest: a.furthest,
            expected,
        };
    }
}
const mod = function () {
    return {
        default: null,
        Parser,
        all,
        choice,
        eof,
        fail,
        lazy,
        location,
        match,
        ok,
        text,
    };
}();
class Action {
    pretty() {
        return "unimplemented";
    }
    extractUnaryRegisterNumbers() {
        return [];
    }
    extractBinaryRegisterNumbers() {
        return [];
    }
    extractLegacyTRegisterNumbers() {
        return [];
    }
    doesReturnValue() {
        return false;
    }
    isSameComponent(_action) {
        return true;
    }
}
const ADD_A1_STRING = "A1";
const ADD_B0_STRING = "B0";
const ADD_B1_STRING = "B1";
const ADD_STRING = "ADD";
function prettyOp(op) {
    switch (op) {
        case 0:
            return ADD_A1_STRING;
        case 1:
            return ADD_B0_STRING;
        case 2:
            return ADD_B1_STRING;
    }
}
function parseOp(op) {
    switch (op) {
        case ADD_A1_STRING:
            return 0;
        case ADD_B0_STRING:
            return 1;
        case ADD_B1_STRING:
            return 2;
    }
}
class AddAction extends Action {
    constructor(op) {
        super();
        this.op = op;
    }
    pretty() {
        return `${ADD_STRING} ${prettyOp(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [add, reg] = array;
        if (add !== ADD_STRING) {
            return undefined;
        }
        if (
            reg === ADD_A1_STRING || reg === ADD_B0_STRING ||
            reg === ADD_B1_STRING
        ) {
            return new AddAction(parseOp(reg));
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return false;
            case 1:
                return true;
            case 2:
                return true;
        }
    }
    isSameComponent(action) {
        return action instanceof AddAction;
    }
}
const B2D_INC_STRING = "INC";
const B2D_TDEC_STRING = "TDEC";
const B2D_READ_STRING = "READ";
const B2D_SET_STRING = "SET";
const B2D_B2DX_STRING = "B2DX";
const B2D_B2DY_STRING = "B2DY";
const B2D_B2D_STRING = "B2D";
const B2D_LEGACY_TDEC_STRING = "DEC";
const B2D_LEGACY_B2DX_STRING = "SQX";
const B2D_LEGACY_B2DY_STRING = "SQY";
const B2D_LEGACY_B2D_STRING = "SQ";
function parseOp1(op) {
    switch (op) {
        case B2D_INC_STRING:
            return 0;
        case B2D_TDEC_STRING:
            return 1;
        case B2D_READ_STRING:
            return 2;
        case B2D_SET_STRING:
            return 3;
    }
}
function prettyOp1(op) {
    switch (op) {
        case 0:
            return B2D_INC_STRING;
        case 1:
            return B2D_TDEC_STRING;
        case 2:
            return B2D_READ_STRING;
        case 3:
            return B2D_SET_STRING;
    }
}
function parseAxis(op) {
    switch (op) {
        case B2D_B2DX_STRING:
            return 4;
        case B2D_B2DY_STRING:
            return 5;
        case B2D_B2D_STRING:
            return 6;
    }
}
function prettyAxis(op) {
    switch (op) {
        case 4:
            return B2D_B2DX_STRING;
        case 5:
            return B2D_B2DY_STRING;
        case 6:
            return B2D_B2D_STRING;
    }
}
class B2DAction extends Action {
    constructor(op, axis) {
        super();
        this.op = op;
        this.axis = axis;
    }
    pretty() {
        return `${prettyOp1(this.op)} ${prettyAxis(this.axis)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [op, axis] = array;
        if (op === undefined || axis === undefined) {
            return undefined;
        }
        if (op === B2D_INC_STRING || op === B2D_TDEC_STRING) {
            if (axis === B2D_B2DX_STRING || axis === B2D_B2DY_STRING) {
                return new B2DAction(parseOp1(op), parseAxis(axis));
            }
        } else if (op === B2D_READ_STRING || op === B2D_SET_STRING) {
            if (axis === B2D_B2D_STRING) {
                return new B2DAction(parseOp1(op), parseAxis(axis));
            }
        }
        switch (op) {
            case B2D_INC_STRING: {
                switch (axis) {
                    case B2D_LEGACY_B2DX_STRING:
                        return new B2DAction(0, 4);
                    case B2D_LEGACY_B2DY_STRING:
                        return new B2DAction(0, 5);
                    default:
                        return undefined;
                }
            }
            case B2D_LEGACY_TDEC_STRING: {
                switch (axis) {
                    case B2D_LEGACY_B2DX_STRING:
                        return new B2DAction(1, 4);
                    case B2D_LEGACY_B2DY_STRING:
                        return new B2DAction(1, 5);
                    default:
                        return undefined;
                }
            }
            case B2D_READ_STRING: {
                switch (axis) {
                    case B2D_LEGACY_B2D_STRING:
                        return new B2DAction(2, 6);
                    default:
                        return undefined;
                }
            }
            case B2D_SET_STRING: {
                switch (axis) {
                    case B2D_LEGACY_B2D_STRING:
                        return new B2DAction(3, 6);
                    default:
                        return undefined;
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return false;
            case 1:
                return true;
            case 2:
                return true;
            case 3:
                return false;
        }
    }
    isSameComponent(action) {
        if (action instanceof B2DAction) {
            if (this.axis === 4 && action.axis === 5) {
                return false;
            } else if (this.axis === 5 && action.axis === 4) {
                return false;
            }
            return true;
        }
        return false;
    }
}
const B_INC_STRING = "INC";
const B_TDEC_STRING = "TDEC";
const B_READ_STRING = "READ";
const B_SET_STRING = "SET";
const B_STRING = "B";
function prettyOp2(op) {
    switch (op) {
        case 0:
            return B_INC_STRING;
        case 1:
            return B_TDEC_STRING;
        case 2:
            return B_READ_STRING;
        case 3:
            return B_SET_STRING;
    }
}
function parseOp2(op) {
    switch (op) {
        case B_INC_STRING:
            return 0;
        case B_TDEC_STRING:
            return 1;
        case B_READ_STRING:
            return 2;
        case B_SET_STRING:
            return 3;
    }
}
class BRegAction extends Action {
    constructor(op, regNumber) {
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractBinaryRegisterNumbers() {
        return [
            this.regNumber,
        ];
    }
    pretty() {
        return `${prettyOp2(this.op)} ${B_STRING}${this.regNumber}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [op, reg] = array;
        if (op === undefined || reg === undefined) {
            return undefined;
        }
        if (
            op === B_INC_STRING || op === B_TDEC_STRING ||
            op === B_READ_STRING || op === B_SET_STRING
        ) {
            if (reg.startsWith(B_STRING)) {
                const str1 = reg.slice(1);
                if (/^[0-9]+$/u.test(str1)) {
                    return new BRegAction(parseOp2(op), parseInt(str1, 10));
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return false;
            case 1:
                return true;
            case 2:
                return true;
            case 3:
                return false;
        }
    }
    isSameComponent(action) {
        if (action instanceof BRegAction) {
            return this.regNumber === action.regNumber;
        } else {
            return false;
        }
    }
}
const MUL_0_STRING = "0";
const MUL_1_STRING = "1";
const MUL_STRING = "MUL";
function parseOp3(op) {
    switch (op) {
        case MUL_0_STRING:
            return 0;
        case MUL_1_STRING:
            return 1;
    }
}
function prettyOp3(op) {
    switch (op) {
        case 0:
            return MUL_0_STRING;
        case 1:
            return MUL_1_STRING;
    }
}
class MulAction extends Action {
    constructor(op) {
        super();
        this.op = op;
    }
    pretty() {
        return `${MUL_STRING} ${prettyOp3(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [mul, op] = array;
        if (mul !== MUL_STRING) {
            return undefined;
        }
        if (op === MUL_0_STRING || op === MUL_1_STRING) {
            return new MulAction(parseOp3(op));
        }
        return undefined;
    }
    doesReturnValue() {
        return true;
    }
    isSameComponent(action) {
        return action instanceof MulAction;
    }
}
const OUTPUT_STRING = "OUTPUT";
class OutputAction extends Action {
    constructor(digit) {
        super();
        this.digit = digit;
    }
    pretty() {
        return `${OUTPUT_STRING} ${this.digit}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [output, digit] = array;
        if (output !== OUTPUT_STRING) {
            return undefined;
        }
        if (digit === undefined) {
            return undefined;
        }
        return new OutputAction(digit);
    }
    doesReturnValue() {
        return false;
    }
    isSameComponent(action) {
        return action instanceof OutputAction;
    }
}
const SUB_A1_STRING = "A1";
const SUB_B0_STRING = "B0";
const SUB_B1_STRING = "B1";
const SUB_STRING = "SUB";
function prettyOp4(op) {
    switch (op) {
        case 0:
            return SUB_A1_STRING;
        case 1:
            return SUB_B0_STRING;
        case 2:
            return SUB_B1_STRING;
    }
}
function parseOp4(op) {
    switch (op) {
        case SUB_A1_STRING:
            return 0;
        case SUB_B0_STRING:
            return 1;
        case SUB_B1_STRING:
            return 2;
    }
}
class SubAction extends Action {
    constructor(op) {
        super();
        this.op = op;
    }
    pretty() {
        return `${SUB_STRING} ${prettyOp4(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [sub, reg] = array;
        if (sub !== SUB_STRING) {
            return undefined;
        }
        if (
            reg === SUB_A1_STRING || reg === SUB_B0_STRING ||
            reg === SUB_B1_STRING
        ) {
            return new SubAction(parseOp4(reg));
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return false;
            case 1:
                return true;
            case 2:
                return true;
        }
    }
    isSameComponent(action) {
        return action instanceof SubAction;
    }
}
const U_INC_STRING = "INC";
const U_TDEC_STRING = "TDEC";
const U_STRING = "U";
const R_STRING = "R";
function prettyOp5(op) {
    switch (op) {
        case 0:
            return U_INC_STRING;
        case 1:
            return U_TDEC_STRING;
    }
}
function parseOp5(op) {
    switch (op) {
        case U_INC_STRING:
            return 0;
        case U_TDEC_STRING:
            return 1;
    }
}
class URegAction extends Action {
    constructor(op, regNumber) {
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractUnaryRegisterNumbers() {
        return [
            this.regNumber,
        ];
    }
    pretty() {
        return `${prettyOp5(this.op)} ${U_STRING}${this.regNumber}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [op, reg] = array;
        if (op === undefined || reg === undefined) {
            return undefined;
        }
        if (op === U_INC_STRING || op === U_TDEC_STRING) {
            if (reg.startsWith(U_STRING) || reg.startsWith(R_STRING)) {
                const str1 = reg.slice(1);
                if (/^[0-9]+$/u.test(str1)) {
                    return new URegAction(parseOp5(op), parseInt(str1, 10));
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return false;
            case 1:
                return true;
        }
    }
    isSameComponent(action) {
        if (action instanceof URegAction) {
            return this.regNumber === action.regNumber;
        } else {
            return false;
        }
    }
}
const T_INC_STRING = "INC";
const T_DEC_STRING = "DEC";
const T_READ_STRING = "READ";
const T_SET_STRING = "SET";
const T_RESET_STRING = "RESET";
function prettyOp6(op) {
    switch (op) {
        case 0:
            return T_INC_STRING;
        case 1:
            return T_DEC_STRING;
        case 2:
            return T_READ_STRING;
        case 3:
            return T_SET_STRING;
        case 4:
            return T_RESET_STRING;
    }
}
function parseOp6(op) {
    switch (op) {
        case T_INC_STRING:
            return 0;
        case T_DEC_STRING:
            return 1;
        case T_READ_STRING:
            return 2;
        case T_SET_STRING:
            return 3;
        case T_RESET_STRING:
            return 4;
    }
}
class LegacyTRegAction extends Action {
    constructor(op, regNumber) {
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractLegacyTRegisterNumbers() {
        return [
            this.regNumber,
        ];
    }
    pretty() {
        return `${prettyOp6(this.op)} T${this.regNumber}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [op, reg] = array;
        if (op === undefined || reg === undefined) {
            return undefined;
        }
        if (
            op === T_INC_STRING || op === T_DEC_STRING ||
            op === T_READ_STRING || op === T_SET_STRING || op === T_RESET_STRING
        ) {
            if (reg.startsWith("T")) {
                const str1 = reg.slice(1);
                if (/^[0-9]+$/u.test(str1)) {
                    return new LegacyTRegAction(
                        parseOp6(op),
                        parseInt(str1, 10),
                    );
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch (this.op) {
            case 0:
                return true;
            case 1:
                return true;
            case 2:
                return true;
            case 3:
                return false;
            case 4:
                return false;
        }
    }
    isSameComponent(action) {
        if (action instanceof LegacyTRegAction) {
            return this.regNumber === action.regNumber;
        } else {
            return false;
        }
    }
}
typeof BigInt !== "undefined";
const HALT_OUT_STRING = `HALT_OUT`;
class HaltOutAction extends Action {
    constructor() {
        super();
    }
    pretty() {
        return HALT_OUT_STRING;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 1) {
            return undefined;
        }
        const [haltOut] = array;
        if (haltOut !== HALT_OUT_STRING) {
            return undefined;
        }
        return new HaltOutAction();
    }
    doesReturnValue() {
        return false;
    }
    isSameComponent(action) {
        return action instanceof HaltOutAction;
    }
}
function validateActionReturnOnceCommand(command) {
    if (command.actions.some((x) => x instanceof HaltOutAction)) {
        return undefined;
    }
    const valueReturnActions = command.actions.filter((x) =>
        x.doesReturnValue()
    );
    if (valueReturnActions.length === 1) {
        return undefined;
    } else if (valueReturnActions.length === 0) {
        return `Does not produce the return value in "${command.pretty()}"`;
    } else {
        return `Does not contain exactly one action that produces a return value in "${command.pretty()}": Actions that produce value are ${
            valueReturnActions.map((x) => `"${x.pretty()}"`).join(", ")
        }`;
    }
}
function validateActionReturnOnce(commands) {
    const errors = [];
    for (const command of commands) {
        const err = validateActionReturnOnceCommand(command);
        if (typeof err === "string") {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
class NopAction extends Action {
    constructor() {
        super();
    }
    pretty() {
        return `NOP`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 1) {
            return undefined;
        }
        const [nop] = array;
        if (nop !== "NOP") {
            return undefined;
        }
        return new NopAction();
    }
    doesReturnValue() {
        return true;
    }
    isSameComponent(action) {
        return action instanceof NopAction;
    }
}
function parseAction(str) {
    const parsers = [
        BRegAction.parse,
        URegAction.parse,
        B2DAction.parse,
        NopAction.parse,
        AddAction.parse,
        MulAction.parse,
        SubAction.parse,
        OutputAction.parse,
        HaltOutAction.parse,
        LegacyTRegAction.parse,
    ];
    for (const parser of parsers) {
        const result = parser(str);
        if (result !== undefined) {
            return result;
        }
    }
    return undefined;
}
const INITIAL_STATE = "INITIAL";
class ProgramLine {
    pretty() {
        return `unimplemented`;
    }
}
class ComponentsHeader extends ProgramLine {
    constructor(content) {
        super();
        this.content = content;
    }
    static get key() {
        return "#COMPONENTS";
    }
    pretty() {
        return ComponentsHeader.key + " " + this.content;
    }
}
class RegistersHeader extends ProgramLine {
    constructor(content) {
        super();
        this.content = content;
    }
    static get key() {
        return "#REGISTERS";
    }
    pretty() {
        return RegistersHeader.key + " " + this.content;
    }
}
class Comment extends ProgramLine {
    constructor(str) {
        super();
        this.str = str;
    }
    getString() {
        return this.str;
    }
    pretty() {
        return this.getString();
    }
}
class EmptyLine extends ProgramLine {
    constructor() {
        super();
    }
    pretty() {
        return "";
    }
}
function parseInput(inputStr) {
    switch (inputStr) {
        case "Z":
            return inputStr;
        case "NZ":
            return inputStr;
        case "ZZ":
            return inputStr;
        case "*":
            return inputStr;
        default:
            return undefined;
    }
}
class Command extends ProgramLine {
    constructor({ state, input, nextState, actions }) {
        super();
        this.state = state;
        this.input = input;
        this.nextState = nextState;
        this.actions = actions;
        this._string = `${this.state}; ${this.input}; ${this.nextState}; ${
            this.actions.map((a) => a.pretty()).join(", ")
        }`;
    }
    static parse(str) {
        if (typeof str !== "string") {
            throw TypeError("str is not a string");
        }
        const trimmedStr = str.trim();
        if (trimmedStr === "") {
            return new EmptyLine();
        }
        if (trimmedStr.startsWith("#")) {
            if (trimmedStr.startsWith(ComponentsHeader.key)) {
                return new ComponentsHeader(
                    trimmedStr.slice(ComponentsHeader.key.length).trim(),
                );
            } else if (trimmedStr.startsWith(RegistersHeader.key)) {
                return new RegistersHeader(
                    trimmedStr.slice(RegistersHeader.key.length).trim(),
                );
            }
            return new Comment(str);
        }
        const array = trimmedStr.split(/\s*;\s*/u);
        if (array.length < 4) {
            return `Invalid line "${str}"`;
        }
        if (array.length > 4) {
            if (array[4] === "") {
                return `Extraneous semicolon "${str}"`;
            }
            return `Invalid line "${str}"`;
        }
        const state = array[0] ?? this.error();
        const inputStr = array[1] ?? this.error();
        const nextState = array[2] ?? this.error();
        const actionsStr = array[3] ?? this.error();
        const actionStrs = actionsStr.trim().split(/\s*,\s*/u).filter((x) =>
            x !== ""
        );
        const actions = [];
        for (const actionsStr1 of actionStrs) {
            const result = parseAction(actionsStr1);
            if (result === undefined) {
                return `Unknown action "${actionsStr1}" at "${str}"`;
            }
            actions.push(result);
        }
        const input = parseInput(inputStr);
        if (input === undefined) {
            return `Unknown input "${inputStr}" at "${str}". Expect "Z", "NZ", "ZZ", or "*"`;
        }
        return new Command({
            state: state,
            input: input,
            nextState: nextState,
            actions: actions,
        });
    }
    static error() {
        throw Error("internal error");
    }
    pretty() {
        return this._string;
    }
}
function validateNextStateIsNotINITIALCommand(command) {
    if (command.nextState === INITIAL_STATE) {
        return `Return to initial state in "${command.pretty()}"`;
    }
    return undefined;
}
function validateNextStateIsNotINITIAL(commands) {
    const errors = [];
    for (const command of commands) {
        const err = validateNextStateIsNotINITIALCommand(command);
        if (typeof err === "string") {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
function validateNoDuplicatedActionCommand(command) {
    if (command.actions.length <= 1) {
        return undefined;
    }
    const actionStrs = command.actions.map((x) => x.pretty());
    actionStrs.sort();
    for (let i = 0; i < actionStrs.length - 1; i++) {
        const act1 = actionStrs[i];
        const act2 = actionStrs[i + 1];
        if (act1 === act2) {
            return `Duplicated actions "${act1}" in "${command.pretty()}"`;
        }
    }
    return undefined;
}
function validateNoDuplicatedAction(commands) {
    const errors = [];
    for (const command of commands) {
        const err = validateNoDuplicatedActionCommand(command);
        if (typeof err === "string") {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
function internalError() {
    throw Error("internal error");
}
function validateNoSameComponentCommand(command) {
    if (command.actions.find((x) => x instanceof HaltOutAction) !== undefined) {
        return undefined;
    }
    const actions = command.actions;
    const len = actions.length;
    if (len <= 1) {
        return undefined;
    }
    for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
            const a = actions[i] ?? internalError();
            const b = actions[j] ?? internalError();
            if (a.isSameComponent(b)) {
                return `Actions "${a.pretty()}" and "${b.pretty()}" use same component in "${command.pretty()}"`;
            }
        }
    }
    return undefined;
}
function validateNoSameComponent(commands) {
    const errors = [];
    for (const command of commands) {
        const err = validateNoSameComponentCommand(command);
        if (typeof err === "string") {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
function internalError1() {
    throw Error("internal error");
}
function validateZAndNZ(commands) {
    const errMsg = (line) =>
        `Need Z line followed by NZ line at "${line.pretty()}"`;
    for (let i = 0; i < commands.length - 1; i++) {
        const a = commands[i] ?? internalError1();
        const b = commands[i + 1] ?? internalError1();
        if (a.input === "Z" && b.input !== "NZ") {
            return [
                errMsg(a),
            ];
        }
        if (b.input === "NZ" && a.input !== "Z") {
            return [
                errMsg(b),
            ];
        }
        if (a.input === "Z" && b.input === "NZ" && a.state !== b.state) {
            return [
                errMsg(a),
            ];
        }
    }
    const lastLine = commands[commands.length - 1];
    if (lastLine !== undefined) {
        if (lastLine.input === "Z") {
            return [
                errMsg(lastLine),
            ];
        }
    }
    return undefined;
}
class ProgramLines {
    constructor(array) {
        this.array = array;
    }
    getArray() {
        return this.array;
    }
    pretty() {
        return this.getArray().map((line) => line.pretty()).join("\n");
    }
    static parse(str) {
        const lines = str.split(/\r\n|\n|\r/u);
        const programLineWithErrorArray = lines.map((line) =>
            Command.parse(line)
        );
        const errors = programLineWithErrorArray.flatMap((x) =>
            typeof x === "string"
                ? [
                    x,
                ]
                : []
        );
        if (errors.length > 0) {
            return errors.join("\n");
        }
        const programLines = programLineWithErrorArray.flatMap((x) =>
            typeof x !== "string"
                ? [
                    x,
                ]
                : []
        );
        return new ProgramLines(programLines);
    }
}
function validateAll(commands) {
    const validators = [
        validateNoDuplicatedAction,
        validateActionReturnOnce,
        validateNoSameComponent,
        validateNextStateIsNotINITIAL,
        validateZAndNZ,
    ];
    let errors = [];
    for (const validator of validators) {
        const errorsOrUndefined = validator(commands);
        if (Array.isArray(errorsOrUndefined)) {
            errors = errors.concat(errorsOrUndefined);
        }
    }
    if (errors.length > 0) {
        return errors.join("\n");
    }
    return undefined;
}
class Program {
    constructor({ programLines }) {
        this.commands = programLines.getArray().flatMap((x) => {
            if (x instanceof Command) {
                return [
                    x,
                ];
            } else {
                return [];
            }
        });
        this.componentsHeader = undefined;
        for (const x of programLines.getArray()) {
            if (x instanceof ComponentsHeader) {
                if (this.componentsHeader !== undefined) {
                    throw Error(`Multiple ${ComponentsHeader.key}`);
                }
                this.componentsHeader = x;
            }
        }
        this.registersHeader = undefined;
        for (const x1 of programLines.getArray()) {
            if (x1 instanceof RegistersHeader) {
                if (this.registersHeader !== undefined) {
                    throw new Error(`Multiple ${RegistersHeader.key}`);
                }
                this.registersHeader = x1;
            }
        }
        this.programLines = programLines;
    }
    static parse(str) {
        const programLines = ProgramLines.parse(str);
        if (typeof programLines === "string") {
            return programLines;
        }
        const commands = [];
        for (const programLine of programLines.getArray()) {
            if (programLine instanceof Command) {
                commands.push(programLine);
            }
        }
        if (commands.length === 0) {
            return "Program is empty";
        }
        const errorOrUndefined = validateAll(commands);
        if (typeof errorOrUndefined === "string") {
            return errorOrUndefined;
        }
        try {
            return new Program({
                programLines: programLines,
            });
        } catch (error) {
            return error.message;
        }
    }
    _actions() {
        return this.commands.flatMap((command) => command.actions);
    }
    extractUnaryRegisterNumbers() {
        return sortNub(
            this._actions().flatMap((a) => a.extractUnaryRegisterNumbers()),
        );
    }
    extractBinaryRegisterNumbers() {
        return sortNub(
            this._actions().flatMap((a) => a.extractBinaryRegisterNumbers()),
        );
    }
    extractLegacyTRegisterNumbers() {
        return sortNub(
            this._actions().flatMap((a) => a.extractLegacyTRegisterNumbers()),
        );
    }
    pretty() {
        return this.programLines.pretty();
    }
}
function sortNub(array) {
    return [
        ...new Set(array),
    ].sort((a, b) => a - b);
}
const decimalNaturalParser = mod.match(/[0-9]+/).desc([
    "number",
]).map((x) => parseInt(x, 10));
const hexadecimalNaturalParser = mod.match(/0x[a-fA-F0-9]+/).desc([
    "hexadecimal number",
]).map((x) => parseInt(x, 16));
const naturalNumberParser = hexadecimalNaturalParser.or(decimalNaturalParser)
    .desc([
        "number",
    ]);
class APGMExpr {
    constructor() {}
}
class ErrorWithLocation extends Error {
    constructor(message, apgmLocation, options) {
        super(message, options);
        this.apgmLocation = apgmLocation;
    }
    apgmLocation;
}
function formatLocationAt(location) {
    if (location !== undefined) {
        return ` at line ${location.line} column ${location.column}`;
    } else {
        return "";
    }
}
class FuncAPGMExpr extends APGMExpr {
    constructor(name, args, location) {
        super();
        this.name = name;
        this.args = args;
        this.location = location;
    }
    transform(f) {
        return f(
            new FuncAPGMExpr(
                this.name,
                this.args.map((x) => x.transform(f)),
                this.location,
            ),
        );
    }
    pretty() {
        return `${this.name}(${this.args.map((x) => x.pretty()).join(", ")})`;
    }
    name;
    args;
    location;
}
class IfAPGMExpr extends APGMExpr {
    constructor(modifier, cond, thenBody, elseBody) {
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.thenBody = thenBody;
        this.elseBody = elseBody;
    }
    transform(f) {
        return f(
            new IfAPGMExpr(
                this.modifier,
                this.cond.transform(f),
                this.thenBody.transform(f),
                this.elseBody !== undefined
                    ? this.elseBody.transform(f)
                    : undefined,
            ),
        );
    }
    pretty() {
        const el = this.elseBody === undefined
            ? ``
            : ` else ${this.elseBody?.pretty()}`;
        const keyword = `if_${this.modifier === "Z" ? "z" : "nz"}`;
        const cond = this.cond.pretty();
        return `${keyword} (${cond}) ${this.thenBody.pretty()}` + el;
    }
    modifier;
    cond;
    thenBody;
    elseBody;
}
class LoopAPGMExpr extends APGMExpr {
    constructor(body) {
        super();
        this.body = body;
    }
    transform(f) {
        return f(new LoopAPGMExpr(this.body.transform(f)));
    }
    pretty() {
        return `loop ${this.body.pretty()}`;
    }
    body;
}
class Macro {
    constructor(name, args, body, location) {
        this.name = name;
        this.args = args;
        this.body = body;
        this.location = location;
    }
    pretty() {
        return `macro ${this.name}(${
            this.args.map((x) => x.pretty()).join(", ")
        }) ${this.body.pretty()}`;
    }
    name;
    args;
    body;
    location;
}
class Main {
    constructor(macros, headers, seqExpr) {
        this.macros = macros;
        this.headers = headers;
        this.seqExpr = seqExpr;
    }
    macros;
    headers;
    seqExpr;
}
class Header {
    constructor(name, content) {
        this.name = name;
        this.content = content;
    }
    toString() {
        const space = this.content.startsWith(" ") ? "" : " ";
        return `#${this.name}${space}${this.content}`;
    }
    name;
    content;
}
class NumberAPGMExpr extends APGMExpr {
    constructor(value, location) {
        super();
        this.value = value;
        this.location = location;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return this.value.toString();
    }
    value;
    location;
}
class StringAPGMExpr extends APGMExpr {
    constructor(value, location) {
        super();
        this.value = value;
        this.location = location;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return `"` + this.value + `"`;
    }
    value;
    location;
}
class SeqAPGMExpr extends APGMExpr {
    constructor(exprs) {
        super();
        this.exprs = exprs;
    }
    transform(f) {
        return f(new SeqAPGMExpr(this.exprs.map((x) => x.transform(f))));
    }
    pretty() {
        return `{${this.exprs.map((x) => x.pretty() + "; ").join("")}}`;
    }
    exprs;
}
class VarAPGMExpr extends APGMExpr {
    constructor(name, location) {
        super();
        this.name = name;
        this.location = location;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return this.name;
    }
    name;
    location;
}
class WhileAPGMExpr extends APGMExpr {
    constructor(modifier, cond, body) {
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.body = body;
    }
    transform(f) {
        return f(
            new WhileAPGMExpr(
                this.modifier,
                this.cond.transform(f),
                this.body.transform(f),
            ),
        );
    }
    pretty() {
        return `while_${
            this.modifier === "Z" ? "z" : "nz"
        }(${this.cond.pretty()}) ${this.body.pretty()}`;
    }
    modifier;
    cond;
    body;
}
function prettyError(fail, source) {
    const lines = source.split(/\n|\r\n/);
    const above = lines[fail.location.line - 2];
    const errorLine = lines[fail.location.line - 1];
    const below = lines[fail.location.line];
    const arrowLine = " ".repeat(Math.max(0, fail.location.column - 1)) + "^";
    const aboveLines = [
        ...above === undefined ? [] : [
            above,
        ],
        errorLine,
    ];
    const belowLines = [
        ...below === undefined ? [] : [
            below,
        ],
    ];
    const prefix = "| ";
    const errorLines = [
        ...aboveLines.map((x) => prefix + x),
        " ".repeat(prefix.length) + arrowLine,
        ...belowLines.map((x) => prefix + x),
    ];
    return [
        `parse error at line ${fail.location.line} column ${fail.location.column}:`,
        `  expected ${fail.expected.join(", ")}`,
        ``,
        ...errorLines,
    ].join("\n");
}
function parsePretty(parser, source) {
    const res = parser.parse(source);
    if (res.type === "ParseOK") {
        return res.value;
    }
    throw new ErrorWithLocation(prettyError(res, source), res.location);
}
const comment = mod.match(/\/\*(\*(?!\/)|[^*])*\*\//s).desc([]);
const _ = mod.match(/\s*/).desc([
    "space",
]).sepBy(comment).map(() => undefined);
const someSpaces = mod.match(/\s+/).desc([
    "space",
]);
const identifierRexExp = /[a-zA-Z_][a-zA-Z_0-9]*/u;
const identifierOnly = mod.match(identifierRexExp).desc([
    "identifier",
]);
const identifier = _.next(identifierOnly).skip(_);
const identifierWithLocation = _.chain(() => {
    return mod.location.chain((loc) => {
        return identifierOnly.skip(_).map((ident) => {
            return [
                ident,
                loc,
            ];
        });
    });
});
const macroIdentifierRegExp = /[a-zA-Z_][a-zA-Z_0-9]*!/u;
const macroIdentifier = _.next(mod.match(macroIdentifierRegExp)).skip(_).desc([
    "macro name",
]);
function token(s) {
    return _.next(mod.text(s)).skip(_);
}
const comma = token(",").desc([
    "`,`",
]);
const leftParen = token("(").desc([
    "`(`",
]);
const rightParen = token(")").desc([
    "`)`",
]);
const semicolon = token(";").desc([
    "`;`",
]);
const curlyLeft = token("{").desc([
    "`{`",
]);
const curlyRight = token("}").desc([
    "`}`",
]);
const varAPGMExpr = identifierWithLocation.map(([ident, loc]) =>
    new VarAPGMExpr(ident, loc)
);
function argExprs(arg) {
    return mod.lazy(() => arg()).sepBy(comma).wrap(leftParen, rightParen);
}
function funcAPGMExpr() {
    return _.next(mod.location).chain((location) => {
        return mod.choice(macroIdentifier, identifier).chain((ident) => {
            return argExprs(() => apgmExpr()).map((args) => {
                return new FuncAPGMExpr(ident, args, location);
            });
        });
    });
}
const numberAPGMExpr = _.next(mod.location.chain((loc) => {
    return naturalNumberParser.map((x) => new NumberAPGMExpr(x, loc));
})).skip(_);
const stringLit = _.next(mod.text(`"`)).next(mod.match(/[^"]*/)).skip(
    mod.text(`"`),
).skip(_).desc([
    "string",
]);
const stringAPGMExpr = stringLit.map((x) => new StringAPGMExpr(x));
function seqAPGMExprRaw() {
    return mod.lazy(() => statement()).repeat();
}
function seqAPGMExpr() {
    return seqAPGMExprRaw().wrap(curlyLeft, curlyRight).map((x) =>
        new SeqAPGMExpr(x)
    );
}
const whileKeyword = mod.choice(token("while_z"), token("while_nz")).map((x) =>
    x === "while_z" ? "Z" : "NZ"
);
const exprWithParen = mod.lazy(() => apgmExpr()).wrap(leftParen, rightParen);
function whileAPGMExpr() {
    return whileKeyword.chain((mod1) => {
        return exprWithParen.chain((cond) => {
            return mod.lazy(() => apgmExpr()).map((body) =>
                new WhileAPGMExpr(mod1, cond, body)
            );
        });
    });
}
function loopAPGMExpr() {
    return token("loop").next(mod.lazy(() => apgmExpr())).map((x) =>
        new LoopAPGMExpr(x)
    );
}
const ifKeyword = mod.choice(token("if_z"), token("if_nz")).map((x) =>
    x === "if_z" ? "Z" : "NZ"
);
function ifAPGMExpr() {
    return ifKeyword.chain((mod1) => {
        return exprWithParen.chain((cond) => {
            return mod.lazy(() => apgmExpr()).chain((body) => {
                return mod.choice(
                    token("else").next(mod.lazy(() => apgmExpr())),
                    mod.ok(undefined),
                ).map((elseBody) => {
                    return new IfAPGMExpr(mod1, cond, body, elseBody);
                });
            });
        });
    });
}
function macroHead() {
    const macroKeyword = _.chain((_) => {
        return mod.location.chain((location) => {
            return mod.text("macro").next(someSpaces).map((_) => location);
        });
    });
    return macroKeyword.and(macroIdentifier).chain(([location, ident]) => {
        return argExprs(() => varAPGMExpr).map((args) => {
            return {
                loc: location,
                name: ident,
                args: args,
            };
        });
    });
}
function macro() {
    return macroHead().chain(({ loc, name, args }) => {
        return mod.lazy(() => apgmExpr()).map((body) => {
            return new Macro(name, args, body, loc);
        });
    });
}
const anythingLine = mod.match(/.*/);
const header = mod.text("#").next(mod.match(/REGISTERS|COMPONENTS/)).desc([
    "#REGISTERS",
    "#COMPONENTS",
]).chain((x) => anythingLine.map((c) => new Header(x, c)));
const headers = _.next(header).skip(_).repeat();
function main() {
    return macro().repeat().chain((macros) => {
        return headers.chain((h) => {
            return _.next(seqAPGMExprRaw()).skip(_).map((x) => {
                return new Main(macros, h, new SeqAPGMExpr(x));
            });
        });
    });
}
function parseMain(str) {
    return parsePretty(main(), str);
}
function apgmExpr() {
    return mod.choice(
        loopAPGMExpr(),
        whileAPGMExpr(),
        ifAPGMExpr(),
        funcAPGMExpr(),
        seqAPGMExpr(),
        varAPGMExpr,
        numberAPGMExpr,
        stringAPGMExpr,
    );
}
function statement() {
    return mod.choice(
        loopAPGMExpr(),
        whileAPGMExpr(),
        ifAPGMExpr(),
        apgmExpr().skip(semicolon),
    );
}
class APGLExpr {
    constructor() {}
}
class ActionAPGLExpr extends APGLExpr {
    constructor(actions) {
        super();
        this.actions = actions;
    }
    transform(f) {
        return f(this);
    }
    actions;
}
class SeqAPGLExpr extends APGLExpr {
    constructor(exprs) {
        super();
        this.exprs = exprs;
    }
    transform(f) {
        return f(new SeqAPGLExpr(this.exprs.map((x) => x.transform(f))));
    }
    exprs;
}
function isEmptyExpr(expr) {
    return expr instanceof SeqAPGLExpr &&
        expr.exprs.every((e) => isEmptyExpr(e));
}
class IfAPGLExpr extends APGLExpr {
    constructor(cond, thenBody, elseBody) {
        super();
        this.cond = cond;
        this.thenBody = thenBody;
        this.elseBody = elseBody;
    }
    transform(f) {
        return f(
            new IfAPGLExpr(
                this.cond.transform(f),
                this.thenBody.transform(f),
                this.elseBody.transform(f),
            ),
        );
    }
    cond;
    thenBody;
    elseBody;
}
class LoopAPGLExpr extends APGLExpr {
    kind;
    constructor(body) {
        super();
        this.body = body;
        this.kind = "loop";
    }
    transform(f) {
        return f(new LoopAPGLExpr(this.body.transform(f)));
    }
    body;
}
class WhileAPGLExpr extends APGLExpr {
    constructor(modifier, cond, body) {
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.body = body;
    }
    transform(f) {
        return f(
            new WhileAPGLExpr(
                this.modifier,
                this.cond.transform(f),
                this.body.transform(f),
            ),
        );
    }
    modifier;
    cond;
    body;
}
class BreakAPGLExpr extends APGLExpr {
    kind;
    constructor(level) {
        super();
        this.level = level;
        this.kind = "break";
    }
    transform(f) {
        return f(this);
    }
    level;
}
class A {
    static incU(n) {
        return A.nonReturn(`INC U${n}`);
    }
    static incUMulti(...args) {
        return new ActionAPGLExpr([
            ...args.map((x) => `INC U${x}`),
            "NOP",
        ]);
    }
    static tdecU(n) {
        return A.single(`TDEC U${n}`);
    }
    static addA1() {
        return A.nonReturn(`ADD A1`);
    }
    static addB0() {
        return A.single("ADD B0");
    }
    static addB1() {
        return A.single("ADD B1");
    }
    static incB2DX() {
        return A.nonReturn("INC B2DX");
    }
    static tdecB2DX() {
        return A.single("TDEC B2DX");
    }
    static incB2DY() {
        return A.nonReturn("INC B2DY");
    }
    static tdecB2DY() {
        return A.single("TDEC B2DY");
    }
    static readB2D() {
        return A.single("READ B2D");
    }
    static setB2D() {
        return A.nonReturn("SET B2D");
    }
    static incB(n) {
        return A.nonReturn(`INC B${n}`);
    }
    static tdecB(n) {
        return A.single(`TDEC B${n}`);
    }
    static readB(n) {
        return A.single(`READ B${n}`);
    }
    static setB(n) {
        return A.nonReturn(`SET B${n}`);
    }
    static haltOUT() {
        return A.single("HALT_OUT");
    }
    static mul0() {
        return A.single("MUL 0");
    }
    static mul1() {
        return A.single("MUL 1");
    }
    static nop() {
        return A.single("NOP");
    }
    static output(c) {
        return A.nonReturn(`OUTPUT ${c}`);
    }
    static subA1() {
        return A.nonReturn(`SUB A1`);
    }
    static subB0() {
        return A.single(`SUB B0`);
    }
    static subB1() {
        return A.single(`SUB B1`);
    }
    static nonReturn(act) {
        return new ActionAPGLExpr([
            act,
            "NOP",
        ]);
    }
    static single(act) {
        return new ActionAPGLExpr([
            act,
        ]);
    }
}
function transpileEmptyArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 0) {
        throw new ErrorWithLocation(
            `argument given to "${funcExpr.name}"${
                formatLocationAt(funcExpr.location)
            }`,
            funcExpr.location,
        );
    }
    return expr;
}
function transpileNumArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 1) {
        throw new ErrorWithLocation(
            `number of arguments is not 1: "${funcExpr.name}"${
                formatLocationAt(funcExpr.location)
            }`,
            funcExpr.location,
        );
    }
    const arg = funcExpr.args[0];
    if (!(arg instanceof NumberAPGMExpr)) {
        throw new ErrorWithLocation(
            `argument is not a number: "${funcExpr.name}"${
                formatLocationAt(funcExpr.location)
            }`,
            funcExpr.location,
        );
    }
    return expr(arg.value);
}
function transpileStringArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 1) {
        throw new ErrorWithLocation(
            `number of arguments is not 1: "${funcExpr.name}"${
                formatLocationAt(funcExpr.location)
            }`,
            funcExpr.location,
        );
    }
    const arg = funcExpr.args[0];
    if (!(arg instanceof StringAPGMExpr)) {
        throw new ErrorWithLocation(
            `argument is not a string: "${funcExpr.name}"${
                formatLocationAt(funcExpr.location)
            }`,
            funcExpr.location,
        );
    }
    return expr(arg.value);
}
const emptyArgFuncs = new Map([
    [
        "nop",
        A.nop(),
    ],
    [
        "inc_b2dx",
        A.incB2DX(),
    ],
    [
        "inc_b2dy",
        A.incB2DY(),
    ],
    [
        "tdec_b2dx",
        A.tdecB2DX(),
    ],
    [
        "tdec_b2dy",
        A.tdecB2DY(),
    ],
    [
        "read_b2d",
        A.readB2D(),
    ],
    [
        "set_b2d",
        A.setB2D(),
    ],
    [
        "add_a1",
        A.addA1(),
    ],
    [
        "add_b0",
        A.addB0(),
    ],
    [
        "add_b1",
        A.addB1(),
    ],
    [
        "sub_a1",
        A.subA1(),
    ],
    [
        "sub_b0",
        A.subB0(),
    ],
    [
        "sub_b1",
        A.subB1(),
    ],
    [
        "mul_0",
        A.mul0(),
    ],
    [
        "mul_1",
        A.mul1(),
    ],
    [
        "halt_out",
        A.haltOUT(),
    ],
]);
const numArgFuncs = new Map([
    [
        "inc_u",
        A.incU,
    ],
    [
        "tdec_u",
        A.tdecU,
    ],
    [
        "inc_b",
        A.incB,
    ],
    [
        "tdec_b",
        A.tdecB,
    ],
    [
        "read_b",
        A.readB,
    ],
    [
        "set_b",
        A.setB,
    ],
]);
const strArgFuncs = new Map([
    [
        "output",
        A.output,
    ],
]);
function transpileFuncAPGMExpr(funcExpr) {
    const emptyOrUndefined = emptyArgFuncs.get(funcExpr.name);
    if (emptyOrUndefined !== undefined) {
        return transpileEmptyArgFunc(funcExpr, emptyOrUndefined);
    }
    const numArgOrUndefined = numArgFuncs.get(funcExpr.name);
    if (numArgOrUndefined !== undefined) {
        return transpileNumArgFunc(funcExpr, numArgOrUndefined);
    }
    const strArgOrUndefined = strArgFuncs.get(funcExpr.name);
    if (strArgOrUndefined !== undefined) {
        return transpileStringArgFunc(funcExpr, strArgOrUndefined);
    }
    switch (funcExpr.name) {
        case "break": {
            if (funcExpr.args.length === 0) {
                return new BreakAPGLExpr(undefined);
            } else {
                return transpileNumArgFunc(
                    funcExpr,
                    (x) => new BreakAPGLExpr(x),
                );
            }
        }
        case "repeat": {
            if (funcExpr.args.length !== 2) {
                throw new ErrorWithLocation(
                    `"repeat" takes two arguments${
                        formatLocationAt(funcExpr.location)
                    }`,
                    funcExpr.location,
                );
            }
            const n = funcExpr.args[0];
            if (!(n instanceof NumberAPGMExpr)) {
                throw new ErrorWithLocation(
                    `first argument of "repeat" must be a number${
                        formatLocationAt(funcExpr.location)
                    }`,
                    funcExpr.location,
                );
            }
            const expr = funcExpr.args[1];
            const apgl = transpileAPGMExpr(expr);
            return new SeqAPGLExpr(Array(n.value).fill(0).map(() => apgl));
        }
    }
    throw new ErrorWithLocation(
        `Unknown function: "${funcExpr.name}"${
            formatLocationAt(funcExpr.location)
        }`,
        funcExpr.location,
    );
}
function transpileAPGMExpr(e) {
    const t = transpileAPGMExpr;
    if (e instanceof FuncAPGMExpr) {
        return transpileFuncAPGMExpr(e);
    } else if (e instanceof IfAPGMExpr) {
        if (e.modifier === "Z") {
            return new IfAPGLExpr(
                t(e.cond),
                t(e.thenBody),
                e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody),
            );
        } else {
            return new IfAPGLExpr(
                t(e.cond),
                e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody),
                t(e.thenBody),
            );
        }
    } else if (e instanceof LoopAPGMExpr) {
        return new LoopAPGLExpr(t(e.body));
    } else if (e instanceof NumberAPGMExpr) {
        throw new ErrorWithLocation(
            `number is not allowed: ${e.value}${formatLocationAt(e.location)}`,
            e.location,
        );
    } else if (e instanceof SeqAPGMExpr) {
        return new SeqAPGLExpr(e.exprs.map((x) => t(x)));
    } else if (e instanceof StringAPGMExpr) {
        throw Error(`string is not allowed: ${e.pretty()}`);
    } else if (e instanceof VarAPGMExpr) {
        throw new ErrorWithLocation(
            `macro variable is not allowed: variable "${e.name}"${
                formatLocationAt(e.location)
            }`,
            e.location,
        );
    } else if (e instanceof WhileAPGMExpr) {
        return new WhileAPGLExpr(e.modifier, t(e.cond), t(e.body));
    }
    throw Error("internal error");
}
class Context1 {
    constructor(input, output, inputZNZ) {
        this.input = input;
        this.output = output;
        this.inputZNZ = inputZNZ;
    }
    input;
    output;
    inputZNZ;
}
class Transpiler {
    id = 0;
    loopFinalStates = [];
    prefix;
    constructor(options = {}) {
        this.prefix = options.prefix ?? "STATE_";
    }
    getFreshName() {
        this.id++;
        return `${this.prefix}${this.id}`;
    }
    emitLine({ currentState, prevOutput, nextState, actions }) {
        if (actions.length === 0) {
            throw Error("action must be nonempty");
        }
        return [
            `${currentState}; ${prevOutput}; ${nextState}; ${
                actions.join(", ")
            }`,
        ];
    }
    emitTransition(current, next, inputZNZ = "*") {
        return this.emitLine({
            currentState: current,
            prevOutput: inputZNZ,
            nextState: next,
            actions: [
                "NOP",
            ],
        });
    }
    transpile(expr) {
        const initialState = "INITIAL";
        const secondState = this.getFreshName() + "_INITIAL";
        const initial = this.emitTransition(initialState, secondState);
        const endState = this.prefix + "END";
        const body = this.transpileExpr(
            new Context1(secondState, endState, "*"),
            expr,
        );
        const end = this.emitLine({
            currentState: endState,
            prevOutput: "*",
            nextState: endState,
            actions: [
                "HALT_OUT",
            ],
        });
        return [
            ...initial,
            ...body,
            ...end,
        ];
    }
    transpileExpr(ctx, expr) {
        if (expr instanceof ActionAPGLExpr) {
            return this.transpileActionAPGLExpr(ctx, expr);
        } else if (expr instanceof SeqAPGLExpr) {
            return this.transpileSeqAPGLExpr(ctx, expr);
        } else if (expr instanceof IfAPGLExpr) {
            return this.transpileIfAPGLExpr(ctx, expr);
        } else if (expr instanceof LoopAPGLExpr) {
            return this.transpileLoopAPGLExpr(ctx, expr);
        } else if (expr instanceof WhileAPGLExpr) {
            return this.transpileWhileAPGLExpr(ctx, expr);
        } else if (expr instanceof BreakAPGLExpr) {
            return this.transpileBreakAPGLExpr(ctx, expr);
        } else {
            throw Error("unknown expr");
        }
    }
    transpileActionAPGLExpr(ctx, actionExpr) {
        return this.emitLine({
            currentState: ctx.input,
            prevOutput: ctx.inputZNZ,
            nextState: ctx.output,
            actions: actionExpr.actions,
        });
    }
    transpileSeqAPGLExpr(ctx, seqExpr) {
        if (isEmptyExpr(seqExpr)) {
            return this.emitTransition(ctx.input, ctx.output, ctx.inputZNZ);
        }
        if (seqExpr.exprs.length === 1) {
            const expr = seqExpr.exprs[0];
            return this.transpileExpr(ctx, expr);
        }
        let seq = [];
        let state = ctx.input;
        for (const [i, expr1] of seqExpr.exprs.entries()) {
            if (i === 0) {
                const outputState = this.getFreshName();
                seq = seq.concat(
                    this.transpileExpr(
                        new Context1(state, outputState, ctx.inputZNZ),
                        expr1,
                    ),
                );
                state = outputState;
            } else if (i === seqExpr.exprs.length - 1) {
                seq = seq.concat(
                    this.transpileExpr(
                        new Context1(state, ctx.output, "*"),
                        expr1,
                    ),
                );
            } else {
                const outputState1 = this.getFreshName();
                seq = seq.concat(
                    this.transpileExpr(
                        new Context1(state, outputState1, "*"),
                        expr1,
                    ),
                );
                state = outputState1;
            }
        }
        return seq;
    }
    transpileIfAPGLExpr(ctx, ifExpr) {
        if (isEmptyExpr(ifExpr.thenBody) && isEmptyExpr(ifExpr.elseBody)) {
            return this.transpileExpr(ctx, ifExpr.cond);
        }
        const condEndState = this.getFreshName();
        const cond = this.transpileExpr(
            new Context1(ctx.input, condEndState, ctx.inputZNZ),
            ifExpr.cond,
        );
        const [z, ...then] = this.transpileExpr(
            new Context1(condEndState, ctx.output, "Z"),
            ifExpr.thenBody,
        );
        const [nz, ...el] = this.transpileExpr(
            new Context1(condEndState, ctx.output, "NZ"),
            ifExpr.elseBody,
        );
        return [
            ...cond,
            z,
            nz,
            ...then,
            ...el,
        ];
    }
    transpileLoopAPGLExpr(ctx, loopExpr) {
        const loopState = ctx.inputZNZ === "*"
            ? ctx.input
            : this.getFreshName();
        let trans = [];
        if (ctx.inputZNZ !== "*") {
            trans = trans.concat(
                this.emitTransition(ctx.input, loopState, ctx.inputZNZ),
            );
        }
        this.loopFinalStates.push(ctx.output);
        const body = this.transpileExpr(
            new Context1(loopState, loopState, "*"),
            loopExpr.body,
        );
        this.loopFinalStates.pop();
        return [
            ...trans,
            ...body,
        ];
    }
    transpileWhileAPGLExprBodyEmpty(ctx, cond, modifier) {
        const condStartState = ctx.inputZNZ === "*"
            ? ctx.input
            : this.getFreshName();
        let trans = [];
        if (ctx.inputZNZ !== "*") {
            trans = trans.concat(
                this.emitTransition(ctx.input, condStartState, ctx.inputZNZ),
            );
        }
        const condEndState = this.getFreshName();
        const condRes = this.transpileExpr(
            new Context1(condStartState, condEndState, "*"),
            cond,
        );
        const zRes = this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: modifier === "Z" ? condStartState : ctx.output,
            actions: [
                "NOP",
            ],
        });
        const nzRes = this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: modifier === "Z" ? ctx.output : condStartState,
            actions: [
                "NOP",
            ],
        });
        return [
            ...trans,
            ...condRes,
            ...zRes,
            ...nzRes,
        ];
    }
    transpileWhileAPGLExpr(ctx, whileExpr) {
        if (isEmptyExpr(whileExpr.body)) {
            return this.transpileWhileAPGLExprBodyEmpty(
                ctx,
                whileExpr.cond,
                whileExpr.modifier,
            );
        }
        let cond = [];
        let condStartState = ctx.inputZNZ === "*"
            ? ctx.input
            : this.getFreshName();
        if (ctx.inputZNZ !== "*") {
            cond = cond.concat(
                this.emitTransition(ctx.input, condStartState, ctx.inputZNZ),
            );
        }
        const condEndState = this.getFreshName();
        cond = cond.concat(
            this.transpileExpr(
                new Context1(condStartState, condEndState, "*"),
                whileExpr.cond,
            ),
        );
        const bodyStartState = this.getFreshName() + "_WHILE_BODY";
        const zRes = this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: whileExpr.modifier === "Z" ? bodyStartState : ctx.output,
            actions: [
                "NOP",
            ],
        });
        const nzRes = this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: whileExpr.modifier === "Z" ? ctx.output : bodyStartState,
            actions: [
                "NOP",
            ],
        });
        this.loopFinalStates.push(ctx.output);
        const body = this.transpileExpr(
            new Context1(bodyStartState, condStartState, "*"),
            whileExpr.body,
        );
        this.loopFinalStates.pop();
        return [
            ...cond,
            ...zRes,
            ...nzRes,
            ...body,
        ];
    }
    transpileBreakAPGLExpr(ctx, breakExpr) {
        const level = breakExpr.level ?? 1;
        if (level < 1) {
            throw Error("break level is less than 1");
        }
        const finalState =
            this.loopFinalStates[this.loopFinalStates.length - level];
        if (finalState === undefined) {
            if (level === 1) {
                throw Error("break outside while or loop");
            } else {
                throw Error(
                    "break level is greater than number of nests of while or loop",
                );
            }
        }
        return this.emitTransition(ctx.input, finalState, ctx.inputZNZ);
    }
}
function transpileAPGL(expr, options = {}) {
    return new Transpiler(options).transpile(expr);
}
function dups(as) {
    const set = new Set();
    const ds = [];
    for (const a of as) {
        if (set.has(a)) {
            ds.push(a);
        } else {
            set.add(a);
        }
    }
    return ds;
}
function argumentsMessage(num) {
    return `${num} argument${num === 1 ? "" : "s"}`;
}
function replaceVarInBoby(macro, funcExpr) {
    const exprs = funcExpr.args;
    if (exprs.length !== macro.args.length) {
        throw new ErrorWithLocation(
            `argument length mismatch: "${macro.name}"` +
                ` expect ${argumentsMessage(macro.args.length)} but given ${
                    argumentsMessage(exprs.length)
                }${formatLocationAt(funcExpr.location)}`,
            funcExpr.location,
        );
    }
    const nameToExpr = new Map(macro.args.map((a, i) => [
        a.name,
        exprs[i],
    ]));
    return macro.body.transform((x) => {
        if (x instanceof VarAPGMExpr) {
            const expr = nameToExpr.get(x.name);
            if (expr === undefined) {
                throw new ErrorWithLocation(
                    `scope error: "${x.name}"${formatLocationAt(x.location)}`,
                    x.location,
                );
            }
            return expr;
        } else {
            return x;
        }
    });
}
class MacroExpander {
    macroMap;
    count = 0;
    maxCount = 100000;
    main;
    constructor(main) {
        this.main = main;
        this.macroMap = new Map(main.macros.map((m) => [
            m.name,
            m,
        ]));
        if (this.macroMap.size < main.macros.length) {
            const ds = dups(main.macros.map((x) => x.name));
            const d = ds[0];
            const location = main.macros.slice().reverse().find((x) =>
                x.name === d
            )?.location;
            throw new ErrorWithLocation(
                `There is a macro with the same name: "${d}"` +
                    formatLocationAt(location),
                location,
            );
        }
    }
    expand() {
        return this.expandExpr(this.main.seqExpr);
    }
    expandExpr(expr) {
        if (this.maxCount < this.count) {
            throw Error("too many macro expansion");
        }
        this.count++;
        return expr.transform((x) => this.expandOnce(x));
    }
    expandOnce(x) {
        if (x instanceof FuncAPGMExpr) {
            return this.expandFuncAPGMExpr(x);
        } else {
            return x;
        }
    }
    expandFuncAPGMExpr(funcExpr) {
        const macro = this.macroMap.get(funcExpr.name);
        if (macro !== undefined) {
            const expanded = replaceVarInBoby(macro, funcExpr);
            return this.expandExpr(expanded);
        } else {
            return funcExpr;
        }
    }
}
function expand(main) {
    return new MacroExpander(main).expand();
}
function optimize(expr) {
    return expr.transform(optimizeOnce);
}
function optimizeOnce(expr) {
    if (expr instanceof SeqAPGLExpr) {
        return optimizeSeqAPGLExpr(expr);
    }
    return expr;
}
function merge(as, bs) {
    if (as.length === 0) {
        return bs.slice();
    }
    if (bs.length === 0) {
        return as.slice();
    }
    if (as.some((x) => x instanceof HaltOutAction)) {
        return undefined;
    }
    if (bs.some((x) => x instanceof HaltOutAction)) {
        return undefined;
    }
    const asWithoutNOP = as.filter((x) => !(x instanceof NopAction));
    const bsWithoutNOP = bs.filter((x) => !(x instanceof NopAction));
    const asWithoutNOPNonReturn = asWithoutNOP.every((a) =>
        !a.doesReturnValue()
    );
    const bsWithoutNOPNonReturn = bsWithoutNOP.every((b) =>
        !b.doesReturnValue()
    );
    if (!asWithoutNOPNonReturn && !bsWithoutNOPNonReturn) {
        return undefined;
    }
    const distinctComponent = asWithoutNOP.every((a) => {
        return bsWithoutNOP.every((b) => {
            return !a.isSameComponent(b);
        });
    });
    if (!distinctComponent) {
        return undefined;
    }
    const merged = asWithoutNOP.concat(bsWithoutNOP);
    if (asWithoutNOPNonReturn && bsWithoutNOPNonReturn) {
        merged.push(new NopAction());
    }
    return merged;
}
function toActions(actionExpr) {
    return actionExpr.actions.flatMap((x) => {
        const a = parseAction(x);
        return a !== undefined
            ? [
                a,
            ]
            : [];
    });
}
function optimizeSeqAPGLExpr(seqExpr) {
    const newExprs = [];
    let items = [];
    const putItems = () => {
        if (items.length !== 0) {
            newExprs.push(new ActionAPGLExpr(items.map((x) => x.pretty())));
            items = [];
        }
    };
    for (const expr of seqExpr.exprs) {
        if (expr instanceof ActionAPGLExpr) {
            const actions = toActions(expr);
            const merged = merge(items, actions);
            if (merged === undefined) {
                putItems();
                items = actions;
            } else {
                items = merged;
            }
        } else {
            putItems();
            newExprs.push(expr);
        }
    }
    putItems();
    return new SeqAPGLExpr(newExprs);
}
function optimizeSeq(expr) {
    return expr.transform(optimizeOnce1);
}
function optimizeOnce1(expr) {
    if (expr instanceof SeqAPGLExpr) {
        return optimizeSeqAPGLExpr1(expr);
    }
    return expr;
}
function optimizeSeqAPGLExpr1(seqExpr) {
    let newExprs = [];
    for (const expr of seqExpr.exprs) {
        if (expr instanceof SeqAPGLExpr) {
            newExprs = newExprs.concat(expr.exprs);
        } else {
            newExprs.push(expr);
        }
    }
    return new SeqAPGLExpr(newExprs);
}
function removeComment(src) {
    let res = "";
    let isComment = false;
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === "/" && c2 === "*") {
            i += 2;
            isComment = true;
        } else if (c === "*" && c2 === "/") {
            isComment = false;
            i += 2;
        } else {
            if (!isComment) {
                res += c;
            }
            i++;
        }
    }
    return res;
}
function completionParser(src) {
    const array = [];
    const MACRO_DECL_REGEXP =
        /(macro\s+([a-zA-Z_][a-zA-Z_0-9]*?!)\s*\(.*?\))/gs;
    const possibleMacroDecls = removeComment(src).matchAll(MACRO_DECL_REGEXP);
    for (const match of possibleMacroDecls) {
        const result = macroHead().parse(match[0]);
        if (result.type === "ParseOK") {
            array.push({
                name: result.value.name,
                args: result.value.args.map((x) => x.name),
            });
        }
    }
    return array;
}
export {
    emptyArgFuncs as emptyArgFuncs,
    numArgFuncs as numArgFuncs,
    strArgFuncs as strArgFuncs,
};
export { completionParser as completionParser };
function logged(f, x, logMessage = undefined) {
    const y = f(x);
    if (logMessage !== undefined) {
        console.log(logMessage, JSON.stringify(y, null, "  "));
    }
    return y;
}
function integration(str, options = {}, log = false) {
    const apgm = logged(parseMain, str, log ? "apgm" : undefined);
    const expanded = logged(expand, apgm, log ? "apgm expaned" : undefined);
    const apgl = logged(transpileAPGMExpr, expanded, log ? "apgl" : undefined);
    const seqOptimizedAPGL = logged(
        optimizeSeq,
        apgl,
        log ? "optimized apgl seq" : undefined,
    );
    const optimizedAPGL = logged(
        optimize,
        seqOptimizedAPGL,
        log ? "optimized apgl action" : undefined,
    );
    const apgs = transpileAPGL(optimizedAPGL, options);
    const comment = [
        "# State    Input    Next state    Actions",
        "# ---------------------------------------",
    ];
    const head = apgm.headers.map((x) => x.toString());
    return head.concat(comment, apgs);
}
export { integration as integration };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImh0dHBzOi8vY2RuLnNreXBhY2suZGV2Ly0vYnJlYWQtbi1idXR0ZXJAdjAuNi4wLVVpeVJKZzJFVDNhRXNLcVVRaUZNL2Rpc3Q9ZXMyMDE5LG1vZGU9aW1wb3J0cy9vcHRpbWl6ZWQvYnJlYWQtbi1idXR0ZXIuanMiLCJodHRwczovL2Nkbi5za3lwYWNrLmRldi9icmVhZC1uLWJ1dHRlcj9kdHMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL2FjdGlvbnMvQWN0aW9uLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy9hY3Rpb25zL0FkZEFjdGlvbi5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvYWN0aW9ucy9CMkRBY3Rpb24uanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL2FjdGlvbnMvQlJlZ0FjdGlvbi5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvYWN0aW9ucy9NdWxBY3Rpb24uanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL2FjdGlvbnMvT3V0cHV0QWN0aW9uLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy9hY3Rpb25zL1N1YkFjdGlvbi5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvYWN0aW9ucy9VUmVnQWN0aW9uLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy9hY3Rpb25zL0xlZ2FjeVRSZWdBY3Rpb24uanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL2NvbXBvbmVudHMvQlJlZy5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvYWN0aW9ucy9IYWx0T3V0QWN0aW9uLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy92YWxpZGF0b3JzL2FjdGlvbl9yZXR1cm5fb25jZS5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvYWN0aW9ucy9Ob3BBY3Rpb24uanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL2FjdGlvbnMvcGFyc2UuanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL0NvbW1hbmQuanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL3ZhbGlkYXRvcnMvbmV4dF9zdGF0ZV9pc19ub3RfaW5pdGlhbC5qcyIsImh0dHBzOi8vcmVpMTAyNC5naXRodWIuaW8vcHJvai9hcGdzZW1ibHktZW11bGF0b3ItMi9zcmMvdmFsaWRhdG9ycy9ub19kdXBfYWN0aW9uLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy92YWxpZGF0b3JzL25vX3NhbWVfY29tcG9uZW50LmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy92YWxpZGF0b3JzL3pfYW5kX256LmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy9Qcm9ncmFtTGluZXMuanMiLCJodHRwczovL3JlaTEwMjQuZ2l0aHViLmlvL3Byb2ovYXBnc2VtYmx5LWVtdWxhdG9yLTIvc3JjL3ZhbGlkYXRlLmpzIiwiaHR0cHM6Ly9yZWkxMDI0LmdpdGh1Yi5pby9wcm9qL2FwZ3NlbWJseS1lbXVsYXRvci0yL3NyYy9Qcm9ncmFtLmpzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ20vcGFyc2VyL251bWJlci50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtL2FzdC9jb3JlLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ20vYXN0L2Z1bmMudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9hc3QvaWYudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9hc3QvbG9vcC50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtL2FzdC9tYWNyby50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtL2FzdC9tYWluLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ20vYXN0L2hlYWRlci50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtL2FzdC9udW1iZXIudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9hc3Qvc3RyaW5nLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ20vYXN0L3NlcS50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtL2FzdC92YXIudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9hc3Qvd2hpbGUudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9wYXJzZXIvcGFyc2VQcmV0dHkudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9wYXJzZXIvbW9kLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvYXN0L2NvcmUudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbC9hc3QvYWN0aW9uLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvYXN0L3NlcS50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdsL2FzdC9pZi50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdsL2FzdC9sb29wLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvYXN0L3doaWxlLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvYXN0L2JyZWFrLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvYWN0aW9ucy50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdtX3RvX2FwZ2wvdHJhbnNwaWxlci50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdsX3RvX2FwZ3NlbWJseS90cmFuc3BpbGVyLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ20vbWFjcm8vX2R1cHMudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9tYWNyby9leHBhbmRlci50cyIsImZpbGU6Ly8vVXNlcnMvc2F0b3NoaS9ob2JieS9hcGdtL3NyYy9hcGdsL2FjdGlvbl9vcHRpbWl6ZXIvbW9kLnRzIiwiZmlsZTovLy9Vc2Vycy9zYXRvc2hpL2hvYmJ5L2FwZ20vc3JjL2FwZ2wvc2VxX29wdGltaXplci9tb2QudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvYXBnbS9wYXJzZXIvY29tcGxldGlvbl9wYXJzZXIudHMiLCJmaWxlOi8vL1VzZXJzL3NhdG9zaGkvaG9iYnkvYXBnbS9zcmMvaW50ZWdyYXRpb24vbW9kLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImNsYXNzIFBhcnNlciB7XG4gIGNvbnN0cnVjdG9yKGFjdGlvbikge1xuICAgIHRoaXMuYWN0aW9uID0gYWN0aW9uO1xuICB9XG4gIHBhcnNlKGlucHV0KSB7XG4gICAgY29uc3QgbG9jYXRpb24yID0ge2luZGV4OiAwLCBsaW5lOiAxLCBjb2x1bW46IDF9O1xuICAgIGNvbnN0IGNvbnRleHQgPSBuZXcgQ29udGV4dCh7aW5wdXQsIGxvY2F0aW9uOiBsb2NhdGlvbjJ9KTtcbiAgICBjb25zdCByZXN1bHQgPSB0aGlzLnNraXAoZW9mKS5hY3Rpb24oY29udGV4dCk7XG4gICAgaWYgKHJlc3VsdC50eXBlID09PSBcIkFjdGlvbk9LXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHR5cGU6IFwiUGFyc2VPS1wiLFxuICAgICAgICB2YWx1ZTogcmVzdWx0LnZhbHVlXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogXCJQYXJzZUZhaWxcIixcbiAgICAgIGxvY2F0aW9uOiByZXN1bHQuZnVydGhlc3QsXG4gICAgICBleHBlY3RlZDogcmVzdWx0LmV4cGVjdGVkXG4gICAgfTtcbiAgfVxuICB0cnlQYXJzZShpbnB1dCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRoaXMucGFyc2UoaW5wdXQpO1xuICAgIGlmIChyZXN1bHQudHlwZSA9PT0gXCJQYXJzZU9LXCIpIHtcbiAgICAgIHJldHVybiByZXN1bHQudmFsdWU7XG4gICAgfVxuICAgIGNvbnN0IHtleHBlY3RlZCwgbG9jYXRpb246IGxvY2F0aW9uMn0gPSByZXN1bHQ7XG4gICAgY29uc3Qge2xpbmUsIGNvbHVtbn0gPSBsb2NhdGlvbjI7XG4gICAgY29uc3QgbWVzc2FnZSA9IGBwYXJzZSBlcnJvciBhdCBsaW5lICR7bGluZX0gY29sdW1uICR7Y29sdW1ufTogZXhwZWN0ZWQgJHtleHBlY3RlZC5qb2luKFwiLCBcIil9YDtcbiAgICB0aHJvdyBuZXcgRXJyb3IobWVzc2FnZSk7XG4gIH1cbiAgYW5kKHBhcnNlckIpIHtcbiAgICByZXR1cm4gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYWN0aW9uKGNvbnRleHQpO1xuICAgICAgaWYgKGEudHlwZSA9PT0gXCJBY3Rpb25GYWlsXCIpIHtcbiAgICAgICAgcmV0dXJuIGE7XG4gICAgICB9XG4gICAgICBjb250ZXh0ID0gY29udGV4dC5tb3ZlVG8oYS5sb2NhdGlvbik7XG4gICAgICBjb25zdCBiID0gY29udGV4dC5tZXJnZShhLCBwYXJzZXJCLmFjdGlvbihjb250ZXh0KSk7XG4gICAgICBpZiAoYi50eXBlID09PSBcIkFjdGlvbk9LXCIpIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBbYS52YWx1ZSwgYi52YWx1ZV07XG4gICAgICAgIHJldHVybiBjb250ZXh0Lm1lcmdlKGIsIGNvbnRleHQub2soYi5sb2NhdGlvbi5pbmRleCwgdmFsdWUpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBiO1xuICAgIH0pO1xuICB9XG4gIHNraXAocGFyc2VyQikge1xuICAgIHJldHVybiB0aGlzLmFuZChwYXJzZXJCKS5tYXAoKFthXSkgPT4gYSk7XG4gIH1cbiAgbmV4dChwYXJzZXJCKSB7XG4gICAgcmV0dXJuIHRoaXMuYW5kKHBhcnNlckIpLm1hcCgoWywgYl0pID0+IGIpO1xuICB9XG4gIG9yKHBhcnNlckIpIHtcbiAgICByZXR1cm4gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICAgICAgY29uc3QgYSA9IHRoaXMuYWN0aW9uKGNvbnRleHQpO1xuICAgICAgaWYgKGEudHlwZSA9PT0gXCJBY3Rpb25PS1wiKSB7XG4gICAgICAgIHJldHVybiBhO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGNvbnRleHQubWVyZ2UoYSwgcGFyc2VyQi5hY3Rpb24oY29udGV4dCkpO1xuICAgIH0pO1xuICB9XG4gIGNoYWluKGZuKSB7XG4gICAgcmV0dXJuIG5ldyBQYXJzZXIoKGNvbnRleHQpID0+IHtcbiAgICAgIGNvbnN0IGEgPSB0aGlzLmFjdGlvbihjb250ZXh0KTtcbiAgICAgIGlmIChhLnR5cGUgPT09IFwiQWN0aW9uRmFpbFwiKSB7XG4gICAgICAgIHJldHVybiBhO1xuICAgICAgfVxuICAgICAgY29uc3QgcGFyc2VyQiA9IGZuKGEudmFsdWUpO1xuICAgICAgY29udGV4dCA9IGNvbnRleHQubW92ZVRvKGEubG9jYXRpb24pO1xuICAgICAgcmV0dXJuIGNvbnRleHQubWVyZ2UoYSwgcGFyc2VyQi5hY3Rpb24oY29udGV4dCkpO1xuICAgIH0pO1xuICB9XG4gIG1hcChmbikge1xuICAgIHJldHVybiB0aGlzLmNoYWluKChhKSA9PiB7XG4gICAgICByZXR1cm4gb2soZm4oYSkpO1xuICAgIH0pO1xuICB9XG4gIHRocnUoZm4pIHtcbiAgICByZXR1cm4gZm4odGhpcyk7XG4gIH1cbiAgZGVzYyhleHBlY3RlZCkge1xuICAgIHJldHVybiBuZXcgUGFyc2VyKChjb250ZXh0KSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLmFjdGlvbihjb250ZXh0KTtcbiAgICAgIGlmIChyZXN1bHQudHlwZSA9PT0gXCJBY3Rpb25PS1wiKSB7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4ge3R5cGU6IFwiQWN0aW9uRmFpbFwiLCBmdXJ0aGVzdDogcmVzdWx0LmZ1cnRoZXN0LCBleHBlY3RlZH07XG4gICAgfSk7XG4gIH1cbiAgd3JhcChiZWZvcmUsIGFmdGVyKSB7XG4gICAgcmV0dXJuIGJlZm9yZS5uZXh0KHRoaXMpLnNraXAoYWZ0ZXIpO1xuICB9XG4gIHRyaW0oYmVmb3JlQW5kQWZ0ZXIpIHtcbiAgICByZXR1cm4gdGhpcy53cmFwKGJlZm9yZUFuZEFmdGVyLCBiZWZvcmVBbmRBZnRlcik7XG4gIH1cbiAgcmVwZWF0KG1pbiA9IDAsIG1heCA9IEluZmluaXR5KSB7XG4gICAgaWYgKCFpc1JhbmdlVmFsaWQobWluLCBtYXgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHJlcGVhdDogYmFkIHJhbmdlICgke21pbn0gdG8gJHttYXh9KWApO1xuICAgIH1cbiAgICBpZiAobWluID09PSAwKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZXBlYXQoMSwgbWF4KS5vcihvayhbXSkpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICAgICAgY29uc3QgaXRlbXMgPSBbXTtcbiAgICAgIGxldCByZXN1bHQgPSB0aGlzLmFjdGlvbihjb250ZXh0KTtcbiAgICAgIGlmIChyZXN1bHQudHlwZSA9PT0gXCJBY3Rpb25GYWlsXCIpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIHdoaWxlIChyZXN1bHQudHlwZSA9PT0gXCJBY3Rpb25PS1wiICYmIGl0ZW1zLmxlbmd0aCA8IG1heCkge1xuICAgICAgICBpdGVtcy5wdXNoKHJlc3VsdC52YWx1ZSk7XG4gICAgICAgIGlmIChyZXN1bHQubG9jYXRpb24uaW5kZXggPT09IGNvbnRleHQubG9jYXRpb24uaW5kZXgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbmZpbml0ZSBsb29wIGRldGVjdGVkOyBkb24ndCBjYWxsIC5yZXBlYXQoKSB3aXRoIHBhcnNlcnMgdGhhdCBjYW4gYWNjZXB0IHplcm8gY2hhcmFjdGVyc1wiKTtcbiAgICAgICAgfVxuICAgICAgICBjb250ZXh0ID0gY29udGV4dC5tb3ZlVG8ocmVzdWx0LmxvY2F0aW9uKTtcbiAgICAgICAgcmVzdWx0ID0gY29udGV4dC5tZXJnZShyZXN1bHQsIHRoaXMuYWN0aW9uKGNvbnRleHQpKTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQudHlwZSA9PT0gXCJBY3Rpb25GYWlsXCIgJiYgaXRlbXMubGVuZ3RoIDwgbWluKSB7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29udGV4dC5tZXJnZShyZXN1bHQsIGNvbnRleHQub2soY29udGV4dC5sb2NhdGlvbi5pbmRleCwgaXRlbXMpKTtcbiAgICB9KTtcbiAgfVxuICBzZXBCeShzZXBhcmF0b3IsIG1pbiA9IDAsIG1heCA9IEluZmluaXR5KSB7XG4gICAgaWYgKCFpc1JhbmdlVmFsaWQobWluLCBtYXgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHNlcEJ5OiBiYWQgcmFuZ2UgKCR7bWlufSB0byAke21heH0pYCk7XG4gICAgfVxuICAgIGlmIChtaW4gPT09IDApIHtcbiAgICAgIHJldHVybiB0aGlzLnNlcEJ5KHNlcGFyYXRvciwgMSwgbWF4KS5vcihvayhbXSkpO1xuICAgIH1cbiAgICBpZiAobWF4ID09PSAxKSB7XG4gICAgICByZXR1cm4gdGhpcy5tYXAoKHgpID0+IFt4XSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNoYWluKChmaXJzdCkgPT4ge1xuICAgICAgcmV0dXJuIHNlcGFyYXRvci5uZXh0KHRoaXMpLnJlcGVhdChtaW4gLSAxLCBtYXggLSAxKS5tYXAoKHJlc3QpID0+IHtcbiAgICAgICAgcmV0dXJuIFtmaXJzdCwgLi4ucmVzdF07XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuICBub2RlKG5hbWUpIHtcbiAgICByZXR1cm4gYWxsKGxvY2F0aW9uLCB0aGlzLCBsb2NhdGlvbikubWFwKChbc3RhcnQsIHZhbHVlLCBlbmRdKSA9PiB7XG4gICAgICBjb25zdCB0eXBlID0gXCJQYXJzZU5vZGVcIjtcbiAgICAgIHJldHVybiB7dHlwZSwgbmFtZSwgdmFsdWUsIHN0YXJ0LCBlbmR9O1xuICAgIH0pO1xuICB9XG59XG5mdW5jdGlvbiBpc1JhbmdlVmFsaWQobWluLCBtYXgpIHtcbiAgcmV0dXJuIG1pbiA8PSBtYXggJiYgbWluID49IDAgJiYgbWF4ID49IDAgJiYgTnVtYmVyLmlzSW50ZWdlcihtaW4pICYmIG1pbiAhPT0gSW5maW5pdHkgJiYgKE51bWJlci5pc0ludGVnZXIobWF4KSB8fCBtYXggPT09IEluZmluaXR5KTtcbn1cbmNvbnN0IGxvY2F0aW9uID0gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICByZXR1cm4gY29udGV4dC5vayhjb250ZXh0LmxvY2F0aW9uLmluZGV4LCBjb250ZXh0LmxvY2F0aW9uKTtcbn0pO1xuZnVuY3Rpb24gb2sodmFsdWUpIHtcbiAgcmV0dXJuIG5ldyBQYXJzZXIoKGNvbnRleHQpID0+IHtcbiAgICByZXR1cm4gY29udGV4dC5vayhjb250ZXh0LmxvY2F0aW9uLmluZGV4LCB2YWx1ZSk7XG4gIH0pO1xufVxuZnVuY3Rpb24gZmFpbChleHBlY3RlZCkge1xuICByZXR1cm4gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICAgIHJldHVybiBjb250ZXh0LmZhaWwoY29udGV4dC5sb2NhdGlvbi5pbmRleCwgZXhwZWN0ZWQpO1xuICB9KTtcbn1cbmNvbnN0IGVvZiA9IG5ldyBQYXJzZXIoKGNvbnRleHQpID0+IHtcbiAgaWYgKGNvbnRleHQubG9jYXRpb24uaW5kZXggPCBjb250ZXh0LmlucHV0Lmxlbmd0aCkge1xuICAgIHJldHVybiBjb250ZXh0LmZhaWwoY29udGV4dC5sb2NhdGlvbi5pbmRleCwgW1wiPEVPRj5cIl0pO1xuICB9XG4gIHJldHVybiBjb250ZXh0Lm9rKGNvbnRleHQubG9jYXRpb24uaW5kZXgsIFwiPEVPRj5cIik7XG59KTtcbmZ1bmN0aW9uIHRleHQoc3RyaW5nKSB7XG4gIHJldHVybiBuZXcgUGFyc2VyKChjb250ZXh0KSA9PiB7XG4gICAgY29uc3Qgc3RhcnQgPSBjb250ZXh0LmxvY2F0aW9uLmluZGV4O1xuICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgc3RyaW5nLmxlbmd0aDtcbiAgICBpZiAoY29udGV4dC5pbnB1dC5zbGljZShzdGFydCwgZW5kKSA9PT0gc3RyaW5nKSB7XG4gICAgICByZXR1cm4gY29udGV4dC5vayhlbmQsIHN0cmluZyk7XG4gICAgfVxuICAgIHJldHVybiBjb250ZXh0LmZhaWwoc3RhcnQsIFtzdHJpbmddKTtcbiAgfSk7XG59XG5mdW5jdGlvbiBtYXRjaChyZWdleHApIHtcbiAgZm9yIChjb25zdCBmbGFnIG9mIHJlZ2V4cC5mbGFncykge1xuICAgIHN3aXRjaCAoZmxhZykge1xuICAgICAgY2FzZSBcImlcIjpcbiAgICAgIGNhc2UgXCJzXCI6XG4gICAgICBjYXNlIFwibVwiOlxuICAgICAgY2FzZSBcInVcIjpcbiAgICAgICAgY29udGludWU7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJvbmx5IHRoZSByZWdleHAgZmxhZ3MgJ2ltc3UnIGFyZSBzdXBwb3J0ZWRcIik7XG4gICAgfVxuICB9XG4gIGNvbnN0IHN0aWNreSA9IG5ldyBSZWdFeHAocmVnZXhwLnNvdXJjZSwgcmVnZXhwLmZsYWdzICsgXCJ5XCIpO1xuICByZXR1cm4gbmV3IFBhcnNlcigoY29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHN0YXJ0ID0gY29udGV4dC5sb2NhdGlvbi5pbmRleDtcbiAgICBzdGlja3kubGFzdEluZGV4ID0gc3RhcnQ7XG4gICAgY29uc3QgbWF0Y2gyID0gY29udGV4dC5pbnB1dC5tYXRjaChzdGlja3kpO1xuICAgIGlmIChtYXRjaDIpIHtcbiAgICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgbWF0Y2gyWzBdLmxlbmd0aDtcbiAgICAgIGNvbnN0IHN0cmluZyA9IGNvbnRleHQuaW5wdXQuc2xpY2Uoc3RhcnQsIGVuZCk7XG4gICAgICByZXR1cm4gY29udGV4dC5vayhlbmQsIHN0cmluZyk7XG4gICAgfVxuICAgIHJldHVybiBjb250ZXh0LmZhaWwoc3RhcnQsIFtTdHJpbmcocmVnZXhwKV0pO1xuICB9KTtcbn1cbmZ1bmN0aW9uIGFsbCguLi5wYXJzZXJzKSB7XG4gIHJldHVybiBwYXJzZXJzLnJlZHVjZSgoYWNjLCBwKSA9PiB7XG4gICAgcmV0dXJuIGFjYy5jaGFpbigoYXJyYXkpID0+IHtcbiAgICAgIHJldHVybiBwLm1hcCgodmFsdWUpID0+IHtcbiAgICAgICAgcmV0dXJuIFsuLi5hcnJheSwgdmFsdWVdO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sIG9rKFtdKSk7XG59XG5mdW5jdGlvbiBjaG9pY2UoLi4ucGFyc2Vycykge1xuICByZXR1cm4gcGFyc2Vycy5yZWR1Y2UoKGFjYywgcCkgPT4ge1xuICAgIHJldHVybiBhY2Mub3IocCk7XG4gIH0pO1xufVxuZnVuY3Rpb24gbGF6eShmbikge1xuICBjb25zdCBwYXJzZXIgPSBuZXcgUGFyc2VyKChjb250ZXh0KSA9PiB7XG4gICAgcGFyc2VyLmFjdGlvbiA9IGZuKCkuYWN0aW9uO1xuICAgIHJldHVybiBwYXJzZXIuYWN0aW9uKGNvbnRleHQpO1xuICB9KTtcbiAgcmV0dXJuIHBhcnNlcjtcbn1cbmZ1bmN0aW9uIHVuaW9uKGEsIGIpIHtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KFsuLi5hLCAuLi5iXSldO1xufVxuY2xhc3MgQ29udGV4dCB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMpIHtcbiAgICB0aGlzLmlucHV0ID0gb3B0aW9ucy5pbnB1dDtcbiAgICB0aGlzLmxvY2F0aW9uID0gb3B0aW9ucy5sb2NhdGlvbjtcbiAgfVxuICBtb3ZlVG8obG9jYXRpb24yKSB7XG4gICAgcmV0dXJuIG5ldyBDb250ZXh0KHtcbiAgICAgIGlucHV0OiB0aGlzLmlucHV0LFxuICAgICAgbG9jYXRpb246IGxvY2F0aW9uMlxuICAgIH0pO1xuICB9XG4gIF9pbnRlcm5hbF9tb3ZlKGluZGV4KSB7XG4gICAgaWYgKGluZGV4ID09PSB0aGlzLmxvY2F0aW9uLmluZGV4KSB7XG4gICAgICByZXR1cm4gdGhpcy5sb2NhdGlvbjtcbiAgICB9XG4gICAgY29uc3Qgc3RhcnQgPSB0aGlzLmxvY2F0aW9uLmluZGV4O1xuICAgIGNvbnN0IGVuZCA9IGluZGV4O1xuICAgIGNvbnN0IGNodW5rID0gdGhpcy5pbnB1dC5zbGljZShzdGFydCwgZW5kKTtcbiAgICBsZXQge2xpbmUsIGNvbHVtbn0gPSB0aGlzLmxvY2F0aW9uO1xuICAgIGZvciAoY29uc3QgY2ggb2YgY2h1bmspIHtcbiAgICAgIGlmIChjaCA9PT0gXCJcXG5cIikge1xuICAgICAgICBsaW5lKys7XG4gICAgICAgIGNvbHVtbiA9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2x1bW4rKztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtpbmRleCwgbGluZSwgY29sdW1ufTtcbiAgfVxuICBvayhpbmRleCwgdmFsdWUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogXCJBY3Rpb25PS1wiLFxuICAgICAgdmFsdWUsXG4gICAgICBsb2NhdGlvbjogdGhpcy5faW50ZXJuYWxfbW92ZShpbmRleCksXG4gICAgICBmdXJ0aGVzdDoge2luZGV4OiAtMSwgbGluZTogLTEsIGNvbHVtbjogLTF9LFxuICAgICAgZXhwZWN0ZWQ6IFtdXG4gICAgfTtcbiAgfVxuICBmYWlsKGluZGV4LCBleHBlY3RlZCkge1xuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiBcIkFjdGlvbkZhaWxcIixcbiAgICAgIGZ1cnRoZXN0OiB0aGlzLl9pbnRlcm5hbF9tb3ZlKGluZGV4KSxcbiAgICAgIGV4cGVjdGVkXG4gICAgfTtcbiAgfVxuICBtZXJnZShhLCBiKSB7XG4gICAgaWYgKGIuZnVydGhlc3QuaW5kZXggPiBhLmZ1cnRoZXN0LmluZGV4KSB7XG4gICAgICByZXR1cm4gYjtcbiAgICB9XG4gICAgY29uc3QgZXhwZWN0ZWQgPSBiLmZ1cnRoZXN0LmluZGV4ID09PSBhLmZ1cnRoZXN0LmluZGV4ID8gdW5pb24oYS5leHBlY3RlZCwgYi5leHBlY3RlZCkgOiBhLmV4cGVjdGVkO1xuICAgIGlmIChiLnR5cGUgPT09IFwiQWN0aW9uT0tcIikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogXCJBY3Rpb25PS1wiLFxuICAgICAgICBsb2NhdGlvbjogYi5sb2NhdGlvbixcbiAgICAgICAgdmFsdWU6IGIudmFsdWUsXG4gICAgICAgIGZ1cnRoZXN0OiBhLmZ1cnRoZXN0LFxuICAgICAgICBleHBlY3RlZFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFwiQWN0aW9uRmFpbFwiLFxuICAgICAgZnVydGhlc3Q6IGEuZnVydGhlc3QsXG4gICAgICBleHBlY3RlZFxuICAgIH07XG4gIH1cbn1cbmV4cG9ydCB7UGFyc2VyLCBhbGwsIGNob2ljZSwgZW9mLCBmYWlsLCBsYXp5LCBsb2NhdGlvbiwgbWF0Y2gsIG9rLCB0ZXh0fTtcbmV4cG9ydCBkZWZhdWx0IG51bGw7XG4iLCIvKlxuICogU2t5cGFjayBDRE4gLSBicmVhZC1uLWJ1dHRlckAwLjYuMFxuICpcbiAqIExlYXJuIG1vcmU6XG4gKiAgIPCfk5kgUGFja2FnZSBEb2N1bWVudGF0aW9uOiBodHRwczovL3d3dy5za3lwYWNrLmRldi92aWV3L2JyZWFkLW4tYnV0dGVyXG4gKiAgIPCfk5ggU2t5cGFjayBEb2N1bWVudGF0aW9uOiBodHRwczovL3d3dy5za3lwYWNrLmRldi9kb2NzXG4gKlxuICogUGlubmVkIFVSTDogKE9wdGltaXplZCBmb3IgUHJvZHVjdGlvbilcbiAqICAg4pa277iPIE5vcm1hbDogaHR0cHM6Ly9jZG4uc2t5cGFjay5kZXYvcGluL2JyZWFkLW4tYnV0dGVyQHYwLjYuMC1VaXlSSmcyRVQzYUVzS3FVUWlGTS9tb2RlPWltcG9ydHMvb3B0aW1pemVkL2JyZWFkLW4tYnV0dGVyLmpzXG4gKiAgIOKPqSBNaW5pZmllZDogaHR0cHM6Ly9jZG4uc2t5cGFjay5kZXYvcGluL2JyZWFkLW4tYnV0dGVyQHYwLjYuMC1VaXlSSmcyRVQzYUVzS3FVUWlGTS9tb2RlPWltcG9ydHMsbWluL29wdGltaXplZC9icmVhZC1uLWJ1dHRlci5qc1xuICpcbiAqL1xuXG4vLyBCcm93c2VyLU9wdGltaXplZCBJbXBvcnRzIChEb24ndCBkaXJlY3RseSBpbXBvcnQgdGhlIFVSTHMgYmVsb3cgaW4geW91ciBhcHBsaWNhdGlvbiEpXG5leHBvcnQgKiBmcm9tICcvLS9icmVhZC1uLWJ1dHRlckB2MC42LjAtVWl5UkpnMkVUM2FFc0txVVFpRk0vZGlzdD1lczIwMTksbW9kZT1pbXBvcnRzL29wdGltaXplZC9icmVhZC1uLWJ1dHRlci5qcyc7XG5leHBvcnQge2RlZmF1bHR9IGZyb20gJy8tL2JyZWFkLW4tYnV0dGVyQHYwLjYuMC1VaXlSSmcyRVQzYUVzS3FVUWlGTS9kaXN0PWVzMjAxOSxtb2RlPWltcG9ydHMvb3B0aW1pemVkL2JyZWFkLW4tYnV0dGVyLmpzJztcbiIsIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIOOCouOCr+OCt+ODp+ODs1xuICogQGFic3RyYWN0XG4gKi9cbmV4cG9ydCBjbGFzcyBBY3Rpb24ge1xuXG4gICAgLyoqXG4gICAgICogQ29udmVydCB0byBzdHJpbmdcbiAgICAgKiDmloflrZfliJfljJbjgZnjgotcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIFwidW5pbXBsZW1lbnRlZFwiO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOOCouOCr+OCt+ODp+ODs+OBq+WQq+OBvuOCjOOCi+OCueODqeOCpOODh+OCo+ODs+OCsOODrOOCuOOCueOCv+OBruODrOOCuOOCueOCv+eVquWPt+OCkui/lOOBmeOAglxuICAgICAqIEByZXR1cm5zIHtudW1iZXJbXX1cbiAgICAgKi9cbiAgICBleHRyYWN0VW5hcnlSZWdpc3Rlck51bWJlcnMoKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiDjgqLjgq/jgrfjg6fjg7PjgavlkKvjgb7jgozjgovjg5DjgqTjg4rjg6rjg6zjgrjjgrnjgr/jga7jg6zjgrjjgrnjgr/nlarlj7fjgpLov5TjgZnjgIJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyW119XG4gICAgICovXG4gICAgZXh0cmFjdEJpbmFyeVJlZ2lzdGVyTnVtYmVycygpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOOCouOCr+OCt+ODp+ODs+OBq+WQq+OBvuOCjOOCi1Tjg6zjgrjjgrnjgr/jga7jg6zjgrjjgrnjgr/nlarlj7fjgpLov5TjgZnjgIJcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyW119XG4gICAgICovXG4gICAgZXh0cmFjdExlZ2FjeVRSZWdpc3Rlck51bWJlcnMoKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBEb2VzIHRoaXMgYWN0aW9uIHJldHVybiBhIHZhbHVlP1xuICAgICAqIOWApOOCkui/lOOBmeOBi+OBqeOBhuOBi1xuICAgICAqIEByZXR1cm5zIHtib29sZWFufSDlgKTjgpLov5TjgZnloLTlkIh0cnVlXG4gICAgICovXG4gICAgZG9lc1JldHVyblZhbHVlKCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5ZCM44GY44Kz44Oz44Od44O844ON44Oz44OI44Gu44Ki44Kv44K344On44Oz44Gn44GC44KM44GwdHJ1ZeOCkui/lOOBmVxuICAgICAqIEBwYXJhbSB7QWN0aW9ufSBfYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KF9hY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IEFjdGlvbiB9IGZyb20gXCIuL0FjdGlvbi5qc1wiO1xuXG5leHBvcnQgY29uc3QgQUREX0ExID0gMDtcbmV4cG9ydCBjb25zdCBBRERfQjAgPSAxO1xuZXhwb3J0IGNvbnN0IEFERF9CMSA9IDI7XG5cbmNvbnN0IEFERF9BMV9TVFJJTkcgPSBcIkExXCI7XG5jb25zdCBBRERfQjBfU1RSSU5HID0gXCJCMFwiO1xuY29uc3QgQUREX0IxX1NUUklORyA9IFwiQjFcIjtcblxuY29uc3QgQUREX1NUUklORyA9IFwiQUREXCI7XG5cbi8qKlxuICogQHR5cGVkZWYge0FERF9BMSB8IEFERF9CMCB8IEFERF9CMX0gQWRkT3BcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtBRERfQTFfU1RSSU5HIHwgQUREX0IwX1NUUklORyB8IEFERF9CMV9TVFJJTkd9IEFkZE9wU3RyaW5nXG4gKi9cblxuLyoqXG4gKlxuICogQHBhcmFtIHtBZGRPcH0gb3BcbiAqIEByZXR1cm5zIHtBZGRPcFN0cmluZ31cbiAqL1xuZnVuY3Rpb24gcHJldHR5T3Aob3ApIHtcbiAgICBzd2l0Y2ggKG9wKSB7XG4gICAgICAgIGNhc2UgQUREX0ExOiByZXR1cm4gQUREX0ExX1NUUklORztcbiAgICAgICAgY2FzZSBBRERfQjA6IHJldHVybiBBRERfQjBfU1RSSU5HO1xuICAgICAgICBjYXNlIEFERF9CMTogcmV0dXJuIEFERF9CMV9TVFJJTkc7XG4gICAgfVxufVxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge0FkZE9wU3RyaW5nfSBvcFxuICogQHJldHVybnMge0FkZE9wfVxuICovXG5mdW5jdGlvbiBwYXJzZU9wKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIEFERF9BMV9TVFJJTkc6IHJldHVybiBBRERfQTE7XG4gICAgICAgIGNhc2UgQUREX0IwX1NUUklORzogcmV0dXJuIEFERF9CMDtcbiAgICAgICAgY2FzZSBBRERfQjFfU1RSSU5HOiByZXR1cm4gQUREX0IxO1xuICAgIH1cbn1cblxuLyoqXG4gKiBBY3Rpb24gZm9yIGBBRERgXG4gKi9cbmV4cG9ydCBjbGFzcyBBZGRBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtBZGRPcH0gb3BcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihvcCkge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAdHlwZSB7QWRkT3B9XG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5vcCA9IG9wO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIGAke0FERF9TVFJJTkd9ICR7cHJldHR5T3AodGhpcy5vcCl9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiDmloflrZfliJfjgYvjgonlpInmj5vjgZnjgotcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge0FkZEFjdGlvbiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICBzdGF0aWMgcGFyc2Uoc3RyKSB7XG4gICAgICAgIGNvbnN0IGFycmF5ID0gc3RyLnRyaW0oKS5zcGxpdCgvXFxzKy91KTtcbiAgICAgICAgaWYgKGFycmF5Lmxlbmd0aCAhPT0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBbIGFkZCwgcmVnIF0gPSBhcnJheTtcbiAgICAgICAgaWYgKGFkZCAhPT0gQUREX1NUUklORykge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVnID09PSBBRERfQTFfU1RSSU5HIHx8IHJlZyA9PT0gQUREX0IwX1NUUklORyB8fCByZWcgPT09IEFERF9CMV9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgQWRkQWN0aW9uKHBhcnNlT3AocmVnKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBkb2VzUmV0dXJuVmFsdWUoKSB7XG4gICAgICAgIHN3aXRjaCAodGhpcy5vcCkge1xuICAgICAgICAgICAgY2FzZSBBRERfQTE6IHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIGNhc2UgQUREX0IwOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGNhc2UgQUREX0IxOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHBhcmFtIHtBY3Rpb259IGFjdGlvblxuICAgICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgICAqL1xuICAgIGlzU2FtZUNvbXBvbmVudChhY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIGFjdGlvbiBpbnN0YW5jZW9mIEFkZEFjdGlvbjtcbiAgICB9XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vQWN0aW9uLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBCMkRfSU5DID0gMDtcbmV4cG9ydCBjb25zdCBCMkRfVERFQyA9IDE7XG5leHBvcnQgY29uc3QgQjJEX1JFQUQgPSAyO1xuZXhwb3J0IGNvbnN0IEIyRF9TRVQgPSAzO1xuZXhwb3J0IGNvbnN0IEIyRF9CMkRYID0gNDtcbmV4cG9ydCBjb25zdCBCMkRfQjJEWSA9IDU7XG5leHBvcnQgY29uc3QgQjJEX0IyRCA9IDY7XG5cbi8qKlxuICogQHR5cGVkZWYge0IyRF9JTkMgfCBCMkRfVERFQyB8IEIyRF9SRUFEIHwgQjJEX1NFVH0gQjJET3BcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtCMkRfSU5DX1NUUklORyB8IEIyRF9UREVDX1NUUklORyB8XG4gKiAgICAgICAgICBCMkRfUkVBRF9TVFJJTkcgfCBCMkRfU0VUX1NUUklOR30gQjJET3BTdHJpbmdcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtCMkRfQjJEWCB8IEIyRF9CMkRZIHwgQjJEX0IyRH0gQjJEQXhpc1xuICovXG5cbi8qKlxuICogQHR5cGVkZWYge0IyRF9CMkRYX1NUUklORyB8IEIyRF9CMkRZX1NUUklORyB8IEIyRF9CMkRfU1RSSU5HfSBCMkRBeGlzU3RyaW5nXG4gKi9cblxuY29uc3QgQjJEX0lOQ19TVFJJTkcgPSBcIklOQ1wiO1xuY29uc3QgQjJEX1RERUNfU1RSSU5HID0gXCJUREVDXCI7XG5jb25zdCBCMkRfUkVBRF9TVFJJTkcgPSBcIlJFQURcIjtcbmNvbnN0IEIyRF9TRVRfU1RSSU5HID0gXCJTRVRcIjtcbmNvbnN0IEIyRF9CMkRYX1NUUklORyA9IFwiQjJEWFwiO1xuY29uc3QgQjJEX0IyRFlfU1RSSU5HID0gXCJCMkRZXCI7XG5jb25zdCBCMkRfQjJEX1NUUklORyA9IFwiQjJEXCI7XG5cbmNvbnN0IEIyRF9MRUdBQ1lfVERFQ19TVFJJTkcgPSBcIkRFQ1wiO1xuY29uc3QgQjJEX0xFR0FDWV9CMkRYX1NUUklORyA9IFwiU1FYXCI7XG5jb25zdCBCMkRfTEVHQUNZX0IyRFlfU1RSSU5HID0gXCJTUVlcIjtcbmNvbnN0IEIyRF9MRUdBQ1lfQjJEX1NUUklORyA9IFwiU1FcIjtcblxuLyoqXG4gKlxuICogQHBhcmFtIHtCMkRPcFN0cmluZ30gb3BcbiAqIEByZXR1cm5zIHtCMkRPcH1cbiAqL1xuZnVuY3Rpb24gcGFyc2VPcChvcCkge1xuICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgY2FzZSBCMkRfSU5DX1NUUklORzogcmV0dXJuIEIyRF9JTkM7XG4gICAgICAgIGNhc2UgQjJEX1RERUNfU1RSSU5HOiByZXR1cm4gQjJEX1RERUM7XG4gICAgICAgIGNhc2UgQjJEX1JFQURfU1RSSU5HOiByZXR1cm4gQjJEX1JFQUQ7XG4gICAgICAgIGNhc2UgQjJEX1NFVF9TVFJJTkc6IHJldHVybiBCMkRfU0VUO1xuICAgIH1cbn1cblxuLyoqXG4gKlxuICogQHBhcmFtIHtCMkRPcH0gb3BcbiAqIEByZXR1cm5zIHtCMkRPcFN0cmluZ31cbiAqL1xuZnVuY3Rpb24gcHJldHR5T3Aob3ApIHtcbiAgICBzd2l0Y2ggKG9wKSB7XG4gICAgICAgIGNhc2UgQjJEX0lOQzogcmV0dXJuIEIyRF9JTkNfU1RSSU5HO1xuICAgICAgICBjYXNlIEIyRF9UREVDOiByZXR1cm4gQjJEX1RERUNfU1RSSU5HO1xuICAgICAgICBjYXNlIEIyRF9SRUFEOiByZXR1cm4gQjJEX1JFQURfU1RSSU5HO1xuICAgICAgICBjYXNlIEIyRF9TRVQ6IHJldHVybiBCMkRfU0VUX1NUUklORztcbiAgICB9XG59XG4vKipcbiAqXG4gKiBAcGFyYW0ge0IyREF4aXNTdHJpbmd9IG9wXG4gKiBAcmV0dXJucyB7QjJEQXhpc31cbiAqL1xuZnVuY3Rpb24gcGFyc2VBeGlzKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIEIyRF9CMkRYX1NUUklORzogcmV0dXJuIEIyRF9CMkRYO1xuICAgICAgICBjYXNlIEIyRF9CMkRZX1NUUklORzogcmV0dXJuIEIyRF9CMkRZO1xuICAgICAgICBjYXNlIEIyRF9CMkRfU1RSSU5HOiByZXR1cm4gQjJEX0IyRDtcbiAgICB9XG59XG5cbi8qKlxuICpcbiAqIEBwYXJhbSB7QjJEQXhpc30gb3BcbiAqIEByZXR1cm5zIHtCMkRBeGlzU3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcmV0dHlBeGlzKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIEIyRF9CMkRYOiByZXR1cm4gQjJEX0IyRFhfU1RSSU5HO1xuICAgICAgICBjYXNlIEIyRF9CMkRZOiByZXR1cm4gQjJEX0IyRFlfU1RSSU5HO1xuICAgICAgICBjYXNlIEIyRF9CMkQ6IHJldHVybiBCMkRfQjJEX1NUUklORztcbiAgICB9XG59XG5cbi8qKlxuICogQWN0aW9uIGZvciBgQjJEYFxuICovXG5leHBvcnQgY2xhc3MgQjJEQWN0aW9uIGV4dGVuZHMgQWN0aW9uIHtcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QjJET3B9IG9wXG4gICAgICogQHBhcmFtIHtCMkRBeGlzfSBheGlzXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3AsIGF4aXMpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEB0eXBlIHtCMkRPcH1cbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLm9wID0gb3A7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAdHlwZSB7QjJEQXhpc31cbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmF4aXMgPSBheGlzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIGAke3ByZXR0eU9wKHRoaXMub3ApfSAke3ByZXR0eUF4aXModGhpcy5heGlzKX1gO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0clxuICAgICAqL1xuICAgIHN0YXRpYyBwYXJzZShzdHIpIHtcbiAgICAgICAgY29uc3QgYXJyYXkgPSBzdHIudHJpbSgpLnNwbGl0KC9cXHMrL3UpO1xuICAgICAgICBpZiAoYXJyYXkubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IFsgb3AsIGF4aXMgXSA9IGFycmF5O1xuICAgICAgICBpZiAob3AgPT09IHVuZGVmaW5lZCB8fCBheGlzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wID09PSBCMkRfSU5DX1NUUklORyB8fCBvcCA9PT0gQjJEX1RERUNfU1RSSU5HKSB7XG4gICAgICAgICAgICBpZiAoYXhpcyA9PT0gQjJEX0IyRFhfU1RSSU5HIHx8IGF4aXMgPT09IEIyRF9CMkRZX1NUUklORykge1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQjJEQWN0aW9uKHBhcnNlT3Aob3ApLCBwYXJzZUF4aXMoYXhpcykpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9wID09PSBCMkRfUkVBRF9TVFJJTkcgfHwgb3AgPT09IEIyRF9TRVRfU1RSSU5HKSB7XG4gICAgICAgICAgICBpZiAoYXhpcyA9PT0gQjJEX0IyRF9TVFJJTkcpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEIyREFjdGlvbihwYXJzZU9wKG9wKSwgcGFyc2VBeGlzKGF4aXMpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBBUEdzZW1ibHkgMS4wXG4gICAgICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgICAgIGNhc2UgQjJEX0lOQ19TVFJJTkc6IHtcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKGF4aXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBCMkRfTEVHQUNZX0IyRFhfU1RSSU5HOlxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBCMkRBY3Rpb24oQjJEX0lOQywgQjJEX0IyRFgpO1xuICAgICAgICAgICAgICAgICAgICBjYXNlIEIyRF9MRUdBQ1lfQjJEWV9TVFJJTkc6XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEIyREFjdGlvbihCMkRfSU5DLCBCMkRfQjJEWSk7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBCMkRfTEVHQUNZX1RERUNfU1RSSU5HOiB7XG4gICAgICAgICAgICAgICAgc3dpdGNoIChheGlzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgQjJEX0xFR0FDWV9CMkRYX1NUUklORzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQjJEQWN0aW9uKEIyRF9UREVDLCBCMkRfQjJEWCk7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgQjJEX0xFR0FDWV9CMkRZX1NUUklORzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQjJEQWN0aW9uKEIyRF9UREVDLCBCMkRfQjJEWSk7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBCMkRfUkVBRF9TVFJJTkc6IHtcbiAgICAgICAgICAgICAgICBzd2l0Y2ggKGF4aXMpIHtcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBCMkRfTEVHQUNZX0IyRF9TVFJJTkc6XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEIyREFjdGlvbihCMkRfUkVBRCwgQjJEX0IyRCk7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSBCMkRfU0VUX1NUUklORzoge1xuICAgICAgICAgICAgICAgIHN3aXRjaCAoYXhpcykge1xuICAgICAgICAgICAgICAgICAgICBjYXNlIEIyRF9MRUdBQ1lfQjJEX1NUUklORzpcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQjJEQWN0aW9uKEIyRF9TRVQsIEIyRF9CMkQpO1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OiByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIGRvZXNSZXR1cm5WYWx1ZSgpIHtcbiAgICAgICAgc3dpdGNoICh0aGlzLm9wKSB7XG4gICAgICAgICAgICBjYXNlIEIyRF9JTkM6IHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIGNhc2UgQjJEX1RERUM6IHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY2FzZSBCMkRfUkVBRDogcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjYXNlIEIyRF9TRVQ6IHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHBhcmFtIHtBY3Rpb259IGFjdGlvblxuICAgICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgICAqL1xuICAgIGlzU2FtZUNvbXBvbmVudChhY3Rpb24pIHtcbiAgICAgICAgaWYgKGFjdGlvbiBpbnN0YW5jZW9mIEIyREFjdGlvbikge1xuICAgICAgICAgICAgaWYgKHRoaXMuYXhpcyA9PT0gQjJEX0IyRFggJiYgYWN0aW9uLmF4aXMgPT09IEIyRF9CMkRZKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLmF4aXMgPT09IEIyRF9CMkRZICYmIGFjdGlvbi5heGlzID09PSBCMkRfQjJEWCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vQWN0aW9uLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBCX0lOQyA9IDA7XG5leHBvcnQgY29uc3QgQl9UREVDID0gMTtcbmV4cG9ydCBjb25zdCBCX1JFQUQgPSAyO1xuZXhwb3J0IGNvbnN0IEJfU0VUID0gMztcblxuY29uc3QgQl9JTkNfU1RSSU5HID0gXCJJTkNcIjtcbmNvbnN0IEJfVERFQ19TVFJJTkcgPSBcIlRERUNcIjtcbmNvbnN0IEJfUkVBRF9TVFJJTkcgPSBcIlJFQURcIjtcbmNvbnN0IEJfU0VUX1NUUklORyA9IFwiU0VUXCI7XG5cbmNvbnN0IEJfU1RSSU5HID0gXCJCXCI7XG5cbi8qKlxuICogQHR5cGVkZWYge0JfSU5DIHwgQl9UREVDIHwgQl9SRUFEIHwgQl9TRVR9IEJPcFxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge0JfSU5DX1NUUklORyB8IEJfVERFQ19TVFJJTkcgfFxuICogICAgICAgICAgQl9SRUFEX1NUUklORyB8IEJfU0VUX1NUUklOR30gQk9wU3RyaW5nXG4gKi9cblxuLyoqXG4gKlxuICogQHBhcmFtIHtCT3B9IG9wXG4gKiBAcmV0dXJucyB7Qk9wU3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcmV0dHlPcChvcCkge1xuICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgY2FzZSBCX0lOQzogcmV0dXJuIEJfSU5DX1NUUklORztcbiAgICAgICAgY2FzZSBCX1RERUM6IHJldHVybiBCX1RERUNfU1RSSU5HO1xuICAgICAgICBjYXNlIEJfUkVBRDogcmV0dXJuIEJfUkVBRF9TVFJJTkc7XG4gICAgICAgIGNhc2UgQl9TRVQ6IHJldHVybiBCX1NFVF9TVFJJTkc7XG4gICAgfVxufVxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge0JPcFN0cmluZ30gb3BcbiAqIEByZXR1cm5zIHtCT3B9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlT3Aob3ApIHtcbiAgICBzd2l0Y2ggKG9wKSB7XG4gICAgICAgIGNhc2UgQl9JTkNfU1RSSU5HOiByZXR1cm4gQl9JTkM7XG4gICAgICAgIGNhc2UgQl9UREVDX1NUUklORzogcmV0dXJuIEJfVERFQztcbiAgICAgICAgY2FzZSBCX1JFQURfU1RSSU5HOiByZXR1cm4gQl9SRUFEO1xuICAgICAgICBjYXNlIEJfU0VUX1NUUklORzogcmV0dXJuIEJfU0VUO1xuICAgIH1cbn1cblxuLyoqXG4gKiBBY3Rpb24gZm9yIGBCbmBcbiAqL1xuZXhwb3J0IGNsYXNzIEJSZWdBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtCT3B9IG9wXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHJlZ051bWJlclxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wLCByZWdOdW1iZXIpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHR5cGUge0JPcH1cbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLm9wID0gb3A7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5yZWdOdW1iZXIgPSByZWdOdW1iZXI7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHJldHVybnMge251bWJlcltdfVxuICAgICAqL1xuICAgIGV4dHJhY3RCaW5hcnlSZWdpc3Rlck51bWJlcnMoKSB7XG4gICAgICAgIHJldHVybiBbdGhpcy5yZWdOdW1iZXJdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIGAke3ByZXR0eU9wKHRoaXMub3ApfSAke0JfU1RSSU5HfSR7dGhpcy5yZWdOdW1iZXJ9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge0JSZWdBY3Rpb24gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgc3RhdGljIHBhcnNlKHN0cikge1xuICAgICAgICBjb25zdCBhcnJheSA9IHN0ci50cmltKCkuc3BsaXQoL1xccysvdSk7XG4gICAgICAgIGlmIChhcnJheS5sZW5ndGggIT09IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgWyBvcCwgcmVnIF0gPSBhcnJheTtcbiAgICAgICAgaWYgKG9wID09PSB1bmRlZmluZWQgfHwgcmVnID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wID09PSBCX0lOQ19TVFJJTkcgfHwgb3AgPT09IEJfVERFQ19TVFJJTkcgfHxcbiAgICAgICAgICAgIG9wID09PSBCX1JFQURfU1RSSU5HIHx8IG9wID09PSBCX1NFVF9TVFJJTkcpIHtcbiAgICAgICAgICAgIGlmIChyZWcuc3RhcnRzV2l0aChCX1NUUklORykpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdHIgPSByZWcuc2xpY2UoMSk7XG4gICAgICAgICAgICAgICAgaWYgKC9eWzAtOV0rJC91LnRlc3Qoc3RyKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEJSZWdBY3Rpb24ocGFyc2VPcChvcCksIHBhcnNlSW50KHN0ciwgMTApKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBkb2VzUmV0dXJuVmFsdWUoKSB7XG4gICAgICAgIHN3aXRjaCAodGhpcy5vcCkge1xuICAgICAgICAgICAgY2FzZSBCX0lOQzogcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgY2FzZSBCX1RERUM6IHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY2FzZSBCX1JFQUQ6IHJldHVybiB0cnVlO1xuICAgICAgICAgICAgY2FzZSBCX1NFVDogcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcGFyYW0ge0FjdGlvbn0gYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KGFjdGlvbikge1xuICAgICAgICBpZiAoYWN0aW9uIGluc3RhbmNlb2YgQlJlZ0FjdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVnTnVtYmVyID09PSBhY3Rpb24ucmVnTnVtYmVyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IEFjdGlvbiB9IGZyb20gXCIuL0FjdGlvbi5qc1wiO1xuXG5leHBvcnQgY29uc3QgTVVMXzAgPSAwO1xuZXhwb3J0IGNvbnN0IE1VTF8xID0gMTtcblxuY29uc3QgTVVMXzBfU1RSSU5HID0gXCIwXCI7XG5jb25zdCBNVUxfMV9TVFJJTkcgPSBcIjFcIjtcblxuY29uc3QgTVVMX1NUUklORyA9IFwiTVVMXCI7XG5cbi8qKlxuICogQHR5cGVkZWYge01VTF8wIHwgTVVMXzF9IE11bE9wXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7TVVMXzBfU1RSSU5HIHwgTVVMXzFfU1RSSU5HfSBNdWxPcFN0cmluZ1xuICovXG5cbi8qKlxuICpcbiAqIEBwYXJhbSB7TXVsT3BTdHJpbmd9IG9wXG4gKiBAcmV0dXJucyB7TXVsT3B9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlT3Aob3ApIHtcbiAgICBzd2l0Y2ggKG9wKSB7XG4gICAgICAgIGNhc2UgTVVMXzBfU1RSSU5HOiByZXR1cm4gTVVMXzA7XG4gICAgICAgIGNhc2UgTVVMXzFfU1RSSU5HOiByZXR1cm4gTVVMXzE7XG4gICAgfVxufVxuXG4vKipcbiAqXG4gKiBAcGFyYW0ge011bE9wfSBvcFxuICogQHJldHVybnMge011bE9wU3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcmV0dHlPcChvcCkge1xuICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgY2FzZSBNVUxfMDogcmV0dXJuIE1VTF8wX1NUUklORztcbiAgICAgICAgY2FzZSBNVUxfMTogcmV0dXJuIE1VTF8xX1NUUklORztcbiAgICB9XG59XG5cbi8qKlxuICogQWN0aW9uIGZvciBgTVVMYFxuICovXG5leHBvcnQgY2xhc3MgTXVsQWN0aW9uIGV4dGVuZHMgQWN0aW9uIHtcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7TXVsT3B9IG9wXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3ApIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHR5cGUge011bE9wfVxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMub3AgPSBvcDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBgJHtNVUxfU1RSSU5HfSAke3ByZXR0eU9wKHRoaXMub3ApfWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge011bEFjdGlvbiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICBzdGF0aWMgcGFyc2Uoc3RyKSB7XG4gICAgICAgIGNvbnN0IGFycmF5ID0gc3RyLnRyaW0oKS5zcGxpdCgvXFxzKy91KTtcbiAgICAgICAgaWYgKGFycmF5Lmxlbmd0aCAhPT0gMikge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IFsgbXVsLCBvcCBdID0gYXJyYXk7XG4gICAgICAgIGlmIChtdWwgIT09IE1VTF9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAob3AgPT09IE1VTF8wX1NUUklORyB8fCBvcCA9PT0gTVVMXzFfU1RSSU5HKSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IE11bEFjdGlvbihwYXJzZU9wKG9wKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIGRvZXNSZXR1cm5WYWx1ZSgpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcGFyYW0ge0FjdGlvbn0gYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KGFjdGlvbikge1xuICAgICAgICByZXR1cm4gYWN0aW9uIGluc3RhbmNlb2YgTXVsQWN0aW9uO1xuICAgIH1cbn1cbiIsIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBBY3Rpb24gfSBmcm9tIFwiLi9BY3Rpb24uanNcIjtcblxuY29uc3QgT1VUUFVUX1NUUklORyA9IFwiT1VUUFVUXCI7XG5cbmV4cG9ydCBjbGFzcyBPdXRwdXRBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGRpZ2l0XG4gICAgICovXG4gICAgY29uc3RydWN0b3IoZGlnaXQpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmRpZ2l0ID0gZGlnaXQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBgJHtPVVRQVVRfU1RSSU5HfSAke3RoaXMuZGlnaXR9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJcbiAgICAgKiBAcmV0dXJucyB7T3V0cHV0QWN0aW9uIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHN0YXRpYyBwYXJzZShzdHIpIHtcbiAgICAgICAgY29uc3QgYXJyYXkgPSBzdHIudHJpbSgpLnNwbGl0KC9cXHMrL3UpO1xuICAgICAgICBpZiAoYXJyYXkubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IFsgb3V0cHV0LCBkaWdpdCBdID0gYXJyYXk7XG4gICAgICAgIGlmIChvdXRwdXQgIT09IE9VVFBVVF9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRpZ2l0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBPdXRwdXRBY3Rpb24oZGlnaXQpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIGRvZXNSZXR1cm5WYWx1ZSgpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHBhcmFtIHtBY3Rpb259IGFjdGlvblxuICAgICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgICAqL1xuICAgIGlzU2FtZUNvbXBvbmVudChhY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIGFjdGlvbiBpbnN0YW5jZW9mIE91dHB1dEFjdGlvbjtcbiAgICB9XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vQWN0aW9uLmpzXCI7XG5cbmV4cG9ydCBjb25zdCBTVUJfQTEgPSAwO1xuZXhwb3J0IGNvbnN0IFNVQl9CMCA9IDE7XG5leHBvcnQgY29uc3QgU1VCX0IxID0gMjtcblxuY29uc3QgU1VCX0ExX1NUUklORyA9IFwiQTFcIjtcbmNvbnN0IFNVQl9CMF9TVFJJTkcgPSBcIkIwXCI7XG5jb25zdCBTVUJfQjFfU1RSSU5HID0gXCJCMVwiO1xuXG5jb25zdCBTVUJfU1RSSU5HID0gXCJTVUJcIjtcblxuLyoqXG4gKiBAdHlwZWRlZiB7U1VCX0ExIHwgU1VCX0IwIHwgU1VCX0IxfSBTdWJPcFxuICovXG5cbi8qKlxuICogQHR5cGVkZWYge1NVQl9BMV9TVFJJTkcgfCBTVUJfQjBfU1RSSU5HIHwgU1VCX0IxX1NUUklOR30gU3ViT3BTdHJpbmdcbiAqL1xuXG4vKipcbiAqXG4gKiBAcGFyYW0ge1N1Yk9wfSBvcFxuICogQHJldHVybnMge1N1Yk9wU3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcmV0dHlPcChvcCkge1xuICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgY2FzZSBTVUJfQTE6IHJldHVybiBTVUJfQTFfU1RSSU5HO1xuICAgICAgICBjYXNlIFNVQl9CMDogcmV0dXJuIFNVQl9CMF9TVFJJTkc7XG4gICAgICAgIGNhc2UgU1VCX0IxOiByZXR1cm4gU1VCX0IxX1NUUklORztcbiAgICB9XG59XG5cbi8qKlxuICpcbiAqIEBwYXJhbSB7U3ViT3BTdHJpbmd9IG9wXG4gKiBAcmV0dXJucyB7U3ViT3B9XG4gKi9cbiBmdW5jdGlvbiBwYXJzZU9wKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIFNVQl9BMV9TVFJJTkc6IHJldHVybiBTVUJfQTE7XG4gICAgICAgIGNhc2UgU1VCX0IwX1NUUklORzogcmV0dXJuIFNVQl9CMDtcbiAgICAgICAgY2FzZSBTVUJfQjFfU1RSSU5HOiByZXR1cm4gU1VCX0IxO1xuICAgIH1cbn1cblxuLyoqXG4gKiBBY3Rpb24gZm9yIGBTVUJgXG4gKi9cbmV4cG9ydCBjbGFzcyBTdWJBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdWJPcH0gb3BcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihvcCkge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAdHlwZSB7U3ViT3B9XG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5vcCA9IG9wO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIGAke1NVQl9TVFJJTkd9ICR7cHJldHR5T3AodGhpcy5vcCl9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJcbiAgICAgKiBAcmV0dXJucyB7U3ViQWN0aW9uIHwgdW5kZWZpbmVkfVxuICAgICAqL1xuICAgIHN0YXRpYyBwYXJzZShzdHIpIHtcbiAgICAgICAgY29uc3QgYXJyYXkgPSBzdHIudHJpbSgpLnNwbGl0KC9cXHMrL3UpO1xuICAgICAgICBpZiAoYXJyYXkubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgWyBzdWIsIHJlZyBdID0gYXJyYXk7XG4gICAgICAgIGlmIChzdWIgIT09IFNVQl9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVnID09PSBTVUJfQTFfU1RSSU5HIHx8IHJlZyA9PT0gU1VCX0IwX1NUUklORyB8fCByZWcgPT09IFNVQl9CMV9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgU3ViQWN0aW9uKHBhcnNlT3AocmVnKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybnMgQG92ZXJyaWRlXG4gICAgICovXG4gICAgZG9lc1JldHVyblZhbHVlKCkge1xuICAgICAgICBzd2l0Y2ggKHRoaXMub3ApIHtcbiAgICAgICAgICAgIGNhc2UgU1VCX0ExOiByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBjYXNlIFNVQl9CMDogcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjYXNlIFNVQl9CMTogcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqIEBwYXJhbSB7QWN0aW9ufSBhY3Rpb25cbiAgICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICAgKi9cbiAgICBpc1NhbWVDb21wb25lbnQoYWN0aW9uKSB7XG4gICAgICAgIHJldHVybiBhY3Rpb24gaW5zdGFuY2VvZiBTdWJBY3Rpb247XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IEFjdGlvbiB9IGZyb20gXCIuL0FjdGlvbi5qc1wiO1xuXG5leHBvcnQgY29uc3QgVV9JTkMgPSAwO1xuZXhwb3J0IGNvbnN0IFVfVERFQyA9IDE7XG5cbmNvbnN0IFVfSU5DX1NUUklORyA9IFwiSU5DXCI7XG5jb25zdCBVX1RERUNfU1RSSU5HID0gXCJUREVDXCI7XG5cbmNvbnN0IFVfU1RSSU5HID0gXCJVXCI7XG5jb25zdCBSX1NUUklORyA9IFwiUlwiO1xuXG4vKipcbiAqIEB0eXBlZGVmIHtVX0lOQyB8IFVfVERFQ30gVU9wXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7VV9JTkNfU1RSSU5HIHwgVV9UREVDX1NUUklOR30gVU9wU3RyaW5nXG4gKi9cblxuLyoqXG4gKlxuICogQHBhcmFtIHtVT3B9IG9wXG4gKiBAcmV0dXJucyB7VU9wU3RyaW5nfVxuICovXG5mdW5jdGlvbiBwcmV0dHlPcChvcCkge1xuICAgIHN3aXRjaCAob3ApIHtcbiAgICAgICAgY2FzZSBVX0lOQzogcmV0dXJuIFVfSU5DX1NUUklORztcbiAgICAgICAgY2FzZSBVX1RERUM6IHJldHVybiBVX1RERUNfU1RSSU5HO1xuICAgIH1cbn1cblxuLyoqXG4gKlxuICogQHBhcmFtIHtVT3BTdHJpbmd9IG9wXG4gKiBAcmV0dXJucyB7VU9wfVxuICovXG5mdW5jdGlvbiBwYXJzZU9wKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIFVfSU5DX1NUUklORzogcmV0dXJuIFVfSU5DO1xuICAgICAgICBjYXNlIFVfVERFQ19TVFJJTkc6IHJldHVybiBVX1RERUM7XG4gICAgfVxufVxuXG4vKipcbiAqIEFjdGlvbiBmb3IgYFVuYFxuICovXG5leHBvcnQgY2xhc3MgVVJlZ0FjdGlvbiBleHRlbmRzIEFjdGlvbiB7XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1VPcH0gb3BcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gcmVnTnVtYmVyXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3AsIHJlZ051bWJlcikge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAdHlwZSB7VU9wfVxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMub3AgPSBvcDtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLnJlZ051bWJlciA9IHJlZ051bWJlcjtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyW119XG4gICAgICovXG4gICAgZXh0cmFjdFVuYXJ5UmVnaXN0ZXJOdW1iZXJzKCkge1xuICAgICAgICByZXR1cm4gW3RoaXMucmVnTnVtYmVyXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBgJHtwcmV0dHlPcCh0aGlzLm9wKX0gJHtVX1NUUklOR30ke3RoaXMucmVnTnVtYmVyfWA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge1VSZWdBY3Rpb24gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgc3RhdGljIHBhcnNlKHN0cikge1xuICAgICAgICBjb25zdCBhcnJheSA9IHN0ci50cmltKCkuc3BsaXQoL1xccysvdSk7XG4gICAgICAgIGlmIChhcnJheS5sZW5ndGggIT09IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBbIG9wLCByZWcgXSA9IGFycmF5O1xuICAgICAgICBpZiAob3AgPT09IHVuZGVmaW5lZCB8fCByZWcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvcCA9PT0gVV9JTkNfU1RSSU5HIHx8IG9wID09PSBVX1RERUNfU1RSSU5HKSB7XG4gICAgICAgICAgICAvLyBSIGZvciBBUEdzZW1ibHkgMS4wXG4gICAgICAgICAgICBpZiAocmVnLnN0YXJ0c1dpdGgoVV9TVFJJTkcpIHx8IHJlZy5zdGFydHNXaXRoKFJfU1RSSU5HKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHN0ciA9IHJlZy5zbGljZSgxKTtcbiAgICAgICAgICAgICAgICBpZiAoL15bMC05XSskL3UudGVzdChzdHIpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgVVJlZ0FjdGlvbihwYXJzZU9wKG9wKSwgcGFyc2VJbnQoc3RyLCAxMCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICovXG4gICAgZG9lc1JldHVyblZhbHVlKCkge1xuICAgICAgICBzd2l0Y2ggKHRoaXMub3ApIHtcbiAgICAgICAgICAgIGNhc2UgVV9JTkM6IHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIGNhc2UgVV9UREVDOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHBhcmFtIHtBY3Rpb259IGFjdGlvblxuICAgICAqIEByZXR1cm5zIHtib29sZWFufVxuICAgICAqL1xuICAgIGlzU2FtZUNvbXBvbmVudChhY3Rpb24pIHtcbiAgICAgICAgaWYgKGFjdGlvbiBpbnN0YW5jZW9mIFVSZWdBY3Rpb24pIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlZ051bWJlciA9PT0gYWN0aW9uLnJlZ051bWJlcjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgIH1cbn1cbiIsIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBBY3Rpb24gfSBmcm9tIFwiLi9BY3Rpb24uanNcIjtcblxuZXhwb3J0IGNvbnN0IFRfSU5DID0gMDtcbmV4cG9ydCBjb25zdCBUX0RFQyA9IDE7XG5leHBvcnQgY29uc3QgVF9SRUFEID0gMjtcbmV4cG9ydCBjb25zdCBUX1NFVCA9IDM7XG5leHBvcnQgY29uc3QgVF9SRVNFVCA9IDQ7XG5cbmNvbnN0IFRfSU5DX1NUUklORyA9IFwiSU5DXCI7XG5jb25zdCBUX0RFQ19TVFJJTkcgPSBcIkRFQ1wiO1xuY29uc3QgVF9SRUFEX1NUUklORyA9IFwiUkVBRFwiO1xuY29uc3QgVF9TRVRfU1RSSU5HID0gXCJTRVRcIjtcbmNvbnN0IFRfUkVTRVRfU1RSSU5HID0gXCJSRVNFVFwiO1xuXG4vKipcbiAqIEB0eXBlZGVmIHtUX0lOQyB8IFRfREVDIHwgVF9SRUFEIHwgVF9TRVQgfCBUX1JFU0VUfSBUT3BcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHtUX0lOQ19TVFJJTkcgfCBUX0RFQ19TVFJJTkcgfFxuICogICAgICAgICAgVF9SRUFEX1NUUklORyB8IFRfU0VUX1NUUklORyB8IFRfUkVTRVRfU1RSSU5HfSBUT3BTdHJpbmdcbiAqL1xuXG4vKipcbiAqXG4gKiBAcGFyYW0ge1RPcH0gb3BcbiAqIEByZXR1cm5zIHtUT3BTdHJpbmd9XG4gKi9cbmZ1bmN0aW9uIHByZXR0eU9wKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIFRfSU5DOiByZXR1cm4gVF9JTkNfU1RSSU5HO1xuICAgICAgICBjYXNlIFRfREVDOiByZXR1cm4gVF9ERUNfU1RSSU5HO1xuICAgICAgICBjYXNlIFRfUkVBRDogcmV0dXJuIFRfUkVBRF9TVFJJTkc7XG4gICAgICAgIGNhc2UgVF9TRVQ6IHJldHVybiBUX1NFVF9TVFJJTkc7XG4gICAgICAgIGNhc2UgVF9SRVNFVDogcmV0dXJuIFRfUkVTRVRfU1RSSU5HO1xuICAgIH1cbn1cblxuLyoqXG4gKlxuICogQHBhcmFtIHtUT3BTdHJpbmd9IG9wXG4gKiBAcmV0dXJucyB7VE9wfVxuICovXG5mdW5jdGlvbiBwYXJzZU9wKG9wKSB7XG4gICAgc3dpdGNoIChvcCkge1xuICAgICAgICBjYXNlIFRfSU5DX1NUUklORzogcmV0dXJuIFRfSU5DO1xuICAgICAgICBjYXNlIFRfREVDX1NUUklORzogcmV0dXJuIFRfREVDO1xuICAgICAgICBjYXNlIFRfUkVBRF9TVFJJTkc6IHJldHVybiBUX1JFQUQ7XG4gICAgICAgIGNhc2UgVF9TRVRfU1RSSU5HOiByZXR1cm4gVF9TRVQ7XG4gICAgICAgIGNhc2UgVF9SRVNFVF9TVFJJTkc6IHJldHVybiBUX1JFU0VUO1xuICAgIH1cbn1cblxuLyoqXG4gKiBBY3Rpb24gZm9yIGBUbmBcbiAqL1xuZXhwb3J0IGNsYXNzIExlZ2FjeVRSZWdBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtUT3B9IG9wXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IHJlZ051bWJlclxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wLCByZWdOdW1iZXIpIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHR5cGUge1RPcH1cbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLm9wID0gb3A7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5yZWdOdW1iZXIgPSByZWdOdW1iZXI7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHJldHVybnMge251bWJlcltdfVxuICAgICAqL1xuICAgIGV4dHJhY3RMZWdhY3lUUmVnaXN0ZXJOdW1iZXJzKCkge1xuICAgICAgICByZXR1cm4gW3RoaXMucmVnTnVtYmVyXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBgJHtwcmV0dHlPcCh0aGlzLm9wKX0gVCR7dGhpcy5yZWdOdW1iZXJ9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge0xlZ2FjeVRSZWdBY3Rpb24gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgc3RhdGljIHBhcnNlKHN0cikge1xuICAgICAgICBjb25zdCBhcnJheSA9IHN0ci50cmltKCkuc3BsaXQoL1xccysvdSk7XG4gICAgICAgIGlmIChhcnJheS5sZW5ndGggIT09IDIpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgWyBvcCwgcmVnIF0gPSBhcnJheTtcbiAgICAgICAgaWYgKG9wID09PSB1bmRlZmluZWQgfHwgcmVnID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wID09PSBUX0lOQ19TVFJJTkcgfHwgb3AgPT09IFRfREVDX1NUUklORyB8fFxuICAgICAgICAgICAgb3AgPT09IFRfUkVBRF9TVFJJTkcgfHwgb3AgPT09IFRfU0VUX1NUUklORyB8fCBvcCA9PT0gVF9SRVNFVF9TVFJJTkcpIHtcbiAgICAgICAgICAgIGlmIChyZWcuc3RhcnRzV2l0aChcIlRcIikpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzdHIgPSByZWcuc2xpY2UoMSk7XG4gICAgICAgICAgICAgICAgaWYgKC9eWzAtOV0rJC91LnRlc3Qoc3RyKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IExlZ2FjeVRSZWdBY3Rpb24ocGFyc2VPcChvcCksIHBhcnNlSW50KHN0ciwgMTApKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBkb2VzUmV0dXJuVmFsdWUoKSB7XG4gICAgICAgIHN3aXRjaCAodGhpcy5vcCkge1xuICAgICAgICAgICAgY2FzZSBUX0lOQzogcmV0dXJuIHRydWU7XG4gICAgICAgICAgICBjYXNlIFRfREVDOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGNhc2UgVF9SRUFEOiByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIGNhc2UgVF9TRVQ6IHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIGNhc2UgVF9SRVNFVDogcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcGFyYW0ge0FjdGlvbn0gYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KGFjdGlvbikge1xuICAgICAgICBpZiAoYWN0aW9uIGluc3RhbmNlb2YgTGVnYWN5VFJlZ0FjdGlvbikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVnTnVtYmVyID09PSBhY3Rpb24ucmVnTnVtYmVyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7XG4gICAgQlJlZ0FjdGlvbixcbiAgICBCX0lOQyxcbiAgICBCX1RERUMsXG4gICAgQl9TRVQsXG4gICAgQl9SRUFEXG59IGZyb20gXCIuLi9hY3Rpb25zL0JSZWdBY3Rpb24uanNcIjtcblxuLyoqXG4gKiDjg5DjgqTjg4rjg6rjga7mloflrZfliJfjgpIw44GoMeOBrumFjeWIl+OBq+WkieaPm+OBmeOCi1xuICogQHBhcmFtIHtzdHJpbmd9IHN0ciAnMDEwMTExMDEnXG4gKiBAcmV0dXJucyB7KDAgfCAxKVtdfVxuICogQHRocm93c1xuICovXG5mdW5jdGlvbiBwYXJzZUJpdHMoc3RyKSB7XG4gICAgcmV0dXJuIFsuLi5zdHJdLm1hcChjID0+IHtcbiAgICAgICAgaWYgKGMgPT09ICcwJykge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH0gZWxzZSBpZiAoYyA9PT0gJzEnKSB7XG4gICAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKGBJbnZhbGlkICNSRUdJU1RFUlM6IFwiJHtzdHJ9XCJgKTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5jb25zdCBoYXNCaWdJbnQgPSB0eXBlb2YgQmlnSW50ICE9PSAndW5kZWZpbmVkJztcblxuLyoqXG4gKiBCbjogQmluYXJ5IFJlZ2lzdGVyXG4gKi9cbmV4cG9ydCBjbGFzcyBCUmVnIHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgLy8gaW52YXJpYW50OiB0aGlzLnBvaW50ZXIgPCB0aGlzLmJpdHMubGVuZ3RoXG4gICAgICAgIHRoaXMucG9pbnRlciA9IDA7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqIEB0eXBlIHsoMCB8IDEpW119XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmJpdHMgPSBbMF07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0JSZWdBY3Rpb259IGFjdFxuICAgICAqIEByZXR1cm5zIHswIHwgMSB8IHZvaWR9XG4gICAgICovXG4gICAgYWN0aW9uKGFjdCkge1xuICAgICAgICAvLyBpZiAodGhpcy5wb2ludGVyID49IHRoaXMuYml0cy5sZW5ndGgpIHtcbiAgICAgICAgLy8gICAgIHRocm93IEVycm9yKCdmYWlsZWQnKTtcbiAgICAgICAgLy8gfVxuICAgICAgICBzd2l0Y2ggKGFjdC5vcCkge1xuICAgICAgICAgICAgLy8gSU5DICAzMjA3NTAyXG4gICAgICAgICAgICAvLyBUREVDIDMyMTc1MDJcbiAgICAgICAgICAgIC8vIFJFQUQgMzE3NTM0NFxuICAgICAgICAgICAgLy8gU0VUICAgNDA2ODQ0XG4gICAgICAgICAgICBjYXNlIEJfVERFQzogcmV0dXJuIHRoaXMudGRlYygpO1xuICAgICAgICAgICAgY2FzZSBCX0lOQzogcmV0dXJuIHRoaXMuaW5jKCk7XG4gICAgICAgICAgICBjYXNlIEJfUkVBRDogcmV0dXJuIHRoaXMucmVhZCgpO1xuICAgICAgICAgICAgY2FzZSBCX1NFVDogcmV0dXJuIHRoaXMuc2V0KCk7XG4gICAgICAgICAgICBkZWZhdWx0OiB0aHJvdyBFcnJvcignQlJlZyBhY3Rpb246ICcgKyBhY3Qub3ApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHJldHVybnMgeygwIHwgMSlbXX1cbiAgICAgKi9cbiAgICBnZXRCaXRzKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5iaXRzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHsoMCB8IDEpW119IGJpdHNcbiAgICAgKi9cbiAgICBzZXRCaXRzKGJpdHMpIHtcbiAgICAgICAgdGhpcy5iaXRzID0gYml0cztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBgSU5DIEJuYFxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIGluYygpIHtcbiAgICAgICAgdGhpcy5wb2ludGVyKys7XG4gICAgICAgIC8vIHVzaW5nIGludmFyaWFudFxuICAgICAgICBpZiAodGhpcy5wb2ludGVyID09PSB0aGlzLmJpdHMubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aGlzLmJpdHMucHVzaCgwKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGBUREVDIEJuYFxuICAgICAqIEByZXR1cm5zIHswIHwgMX1cbiAgICAgKi9cbiAgICB0ZGVjKCkge1xuICAgICAgICBpZiAodGhpcy5wb2ludGVyID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucG9pbnRlci0tO1xuICAgICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBgUkVBRCBCbmBcbiAgICAgKiBAcmV0dXJucyB7MCB8IDF9XG4gICAgICovXG4gICAgcmVhZCgpIHtcbiAgICAgICAgY29uc3QgcG9pbnRlciA9IHRoaXMucG9pbnRlcjtcbiAgICAgICAgY29uc3QgYml0cyA9IHRoaXMuYml0cztcbiAgICAgICAgaWYgKHBvaW50ZXIgPCBiaXRzLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBiaXRzW3BvaW50ZXJdID8/IHRoaXMuZXJyb3IoKTtcbiAgICAgICAgICAgIGJpdHNbcG9pbnRlcl0gPSAwO1xuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBgU0VUIEJuYFxuICAgICAqIEByZXR1cm5zIHt2b2lkfVxuICAgICAqL1xuICAgIHNldCgpIHtcbiAgICAgICAgY29uc3QgYml0cyA9IHRoaXMuYml0cztcbiAgICAgICAgY29uc3QgcG9pbnRlciA9IHRoaXMucG9pbnRlcjtcbiAgICAgICAgaWYgKHBvaW50ZXIgPj0gYml0cy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuZXh0ZW5kKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFsdWUgPSBiaXRzW3BvaW50ZXJdO1xuICAgICAgICBpZiAodmFsdWUgPT09IDEpIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKFxuICAgICAgICAgICAgICAgICdUaGUgYml0IG9mIGJpbmFyeSByZWdpc3RlciBpcyBhbHJlYWR5IDE6IGJpdHMgPSAnICtcbiAgICAgICAgICAgICAgICBiaXRzLmpvaW4oJycpICsgXCIsIHBvaW50ZXIgPSBcIiArIHBvaW50ZXJcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgYml0c1twb2ludGVyXSA9IDE7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog44Od44Kk44Oz44K/44O844Gu56+E5Zuy44G+44Gn44Oh44Oi44Oq44KS5bqD44GS44KLXG4gICAgICovXG4gICAgZXh0ZW5kKCkge1xuICAgICAgICBjb25zdCBwb2ludGVyID0gdGhpcy5wb2ludGVyO1xuICAgICAgICBjb25zdCBsZW4gPSB0aGlzLmJpdHMubGVuZ3RoO1xuICAgICAgICBpZiAocG9pbnRlciA+PSBsZW4pIHtcbiAgICAgICAgICAgIGlmIChwb2ludGVyID09PSBsZW4pIHtcbiAgICAgICAgICAgICAgICB0aGlzLmJpdHMucHVzaCgwKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICogQHR5cGUgezBbXX1cbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBjb25zdCByZXN0ID0gQXJyYXkocG9pbnRlciAtIGxlbiArIDEpLmZpbGwoMCkubWFwKCgpID0+IDApO1xuICAgICAgICAgICAgICAgIHRoaXMuYml0cy5wdXNoKC4uLnJlc3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBAcmV0dXJucyB7bmV2ZXJ9XG4gICAgICovXG4gICAgZXJyb3IoKSB7XG4gICAgICAgIHRocm93IEVycm9yKCdlcnJvcicpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICB0b0JpbmFyeVN0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0Qml0cygpLnNsaWNlKCkucmV2ZXJzZSgpLmpvaW4oXCJcIik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHBhcmFtIHtudW1iZXJ9IFtiYXNlXSBkZWZhdWx0IGlzIDEwXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICB0b1N0cmluZyhiYXNlID0gMTApIHtcbiAgICAgICAgaWYgKGhhc0JpZ0ludCkge1xuICAgICAgICAgICAgcmV0dXJuIEJpZ0ludChcIjBiXCIgKyB0aGlzLnRvQmluYXJ5U3RyaW5nKCkpLnRvU3RyaW5nKGJhc2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIE51bWJlcihcIjBiXCIgKyB0aGlzLnRvQmluYXJ5U3RyaW5nKCkpLnRvU3RyaW5nKGJhc2UpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5Y2B6YCy5pWwXG4gICAgICogQHJldHVybnMge3N0cmluZ30gXCIxMjNcIlxuICAgICAqL1xuICAgIHRvRGVjaW1hbFN0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudG9TdHJpbmcoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiAxNumAsuaVsFxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IFwiRkZcIlxuICAgICAqL1xuICAgIHRvSGV4U3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gdGhpcy50b1N0cmluZygxNik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogcHJlZml444Goc3VmZml444GMc2xpY2XjgZXjgozjgabjgYTjgovjgZPjgajjga/kv53oqLzjgZnjgotcbiAgICAgKiBAcmV0dXJucyB7e1xuICAgICAgICBwcmVmaXg6ICgwIHwgMSlbXTtcbiAgICAgICAgaGVhZDogMCB8IDE7XG4gICAgICAgIHN1ZmZpeDogKDAgfCAxKVtdO1xuICAgIH19XG4gICAgICovXG4gICAgdG9PYmplY3QoKSB7XG4gICAgICAgIHRoaXMuZXh0ZW5kKCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcmVmaXg6IHRoaXMuYml0cy5zbGljZSgwLCB0aGlzLnBvaW50ZXIpLFxuICAgICAgICAgICAgaGVhZDogdGhpcy5iaXRzW3RoaXMucG9pbnRlcl0gPz8gdGhpcy5lcnJvcigpLFxuICAgICAgICAgICAgc3VmZml4OiB0aGlzLmJpdHMuc2xpY2UodGhpcy5wb2ludGVyICsgMSksXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5XG4gICAgICogQHBhcmFtIHt1bmtub3dufSB2YWx1ZVxuICAgICAqL1xuICAgIHNldEJ5UmVnaXN0ZXJzSW5pdChrZXksIHZhbHVlKSB7XG4gICAgICAgIGNvbnN0IGRlYnVnU3RyID0gYFwiJHtrZXl9XCI6ICR7SlNPTi5zdHJpbmdpZnkodmFsdWUpfWA7XG4gICAgICAgIC8vIOaVsOWtl+OBruWgtOWQiOOBruWHpueQhuOBr+aVsOWtl+OCkuODkOOCpOODiuODquOBq+OBl+OBpumFjee9ruOBmeOCiyBUT0RPIOW/heimgeOBi+eiuuiqjVxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgdGhpcy5zZXRCaXRzKHBhcnNlQml0cyh2YWx1ZS50b1N0cmluZygyKSkucmV2ZXJzZSgpKTtcbiAgICAgICAgICAgIHRoaXMuZXh0ZW5kKCk7XG4gICAgICAgIH0gZWxzZSBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgSW52YWxpZCAjUkVHSVNURVJTICR7ZGVidWdTdHJ9YCk7XG4gICAgICAgIH0gZWxzZSBpZiAodmFsdWUubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihgSW52YWxpZCAjUkVHSVNURVJTICR7ZGVidWdTdHJ9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvKiogQHR5cGUge3Vua25vd259ICovXG4gICAgICAgICAgICBjb25zdCB2YWx1ZTAgPSB2YWx1ZVswXTtcbiAgICAgICAgICAgIC8qKiBAdHlwZSB7dW5rbm93bn0gKi9cbiAgICAgICAgICAgIGNvbnN0IHZhbHVlMSA9IHZhbHVlWzFdO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZTAgIT09ICdudW1iZXInIHx8IHR5cGVvZiB2YWx1ZTEgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoYEludmFsaWQgI1JFR0lTVEVSUyAke2RlYnVnU3RyfWApO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh2YWx1ZTAgPCAwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlMCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBFcnJvcihgSW52YWxpZCAjUkVHSVNURVJTICR7ZGVidWdTdHJ9YCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMucG9pbnRlciA9IHZhbHVlMDtcbiAgICAgICAgICAgICAgICB0aGlzLnNldEJpdHMocGFyc2VCaXRzKHZhbHVlMSkpO1xuICAgICAgICAgICAgICAgIHRoaXMuZXh0ZW5kKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vQWN0aW9uLmpzXCI7XG5cbi8qKlxuICogQHR5cGUge3N0cmluZ31cbiAqL1xuY29uc3QgSEFMVF9PVVRfU1RSSU5HID0gYEhBTFRfT1VUYDtcblxuLyoqXG4gKiBgSEFMVF9PVVRgIGFjdGlvblxuICovXG5leHBvcnQgY2xhc3MgSGFsdE91dEFjdGlvbiBleHRlbmRzIEFjdGlvbiB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBIQUxUX09VVF9TVFJJTkc7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge0hhbHRPdXRBY3Rpb24gfCB1bmRlZmluZWR9XG4gICAgICovXG4gICAgc3RhdGljIHBhcnNlKHN0cikge1xuICAgICAgICBjb25zdCBhcnJheSA9IHN0ci50cmltKCkuc3BsaXQoL1xccysvdSk7XG4gICAgICAgIGlmIChhcnJheS5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgW2hhbHRPdXRdID0gYXJyYXk7XG4gICAgICAgIGlmIChoYWx0T3V0ICE9PSBIQUxUX09VVF9TVFJJTkcpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBIYWx0T3V0QWN0aW9uKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5a6f6Zqb44Gr44Gv5YCk44Gv44Gp44Gh44KJ44Gn44KC6Imv44GEXG4gICAgICogQG92ZXJyaWRlXG4gICAgICovXG4gICAgZG9lc1JldHVyblZhbHVlKCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcGFyYW0ge0FjdGlvbn0gYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KGFjdGlvbikge1xuICAgICAgICByZXR1cm4gYWN0aW9uIGluc3RhbmNlb2YgSGFsdE91dEFjdGlvbjtcbiAgICB9XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgSGFsdE91dEFjdGlvbiB9IGZyb20gXCIuLi9hY3Rpb25zL0hhbHRPdXRBY3Rpb24uanNcIjtcbmltcG9ydCB7IENvbW1hbmQgfSBmcm9tIFwiLi4vQ29tbWFuZC5qc1wiO1xuXG4vKipcbiAqXG4gKiBAcGFyYW0ge0NvbW1hbmR9IGNvbW1hbmRcbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlQWN0aW9uUmV0dXJuT25jZUNvbW1hbmQoY29tbWFuZCkge1xuICAgIC8vIEZJWE1FOiBIQUxUX09VVOOBjOWQq+OBvuOCjOOCi+WgtOWQiOOBr+S4gOaXpueEoeimllxuICAgIGlmIChjb21tYW5kLmFjdGlvbnMuc29tZSh4ID0+IHggaW5zdGFuY2VvZiBIYWx0T3V0QWN0aW9uKSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHZhbHVlUmV0dXJuQWN0aW9ucyA9IGNvbW1hbmQuYWN0aW9ucy5maWx0ZXIoeCA9PiB4LmRvZXNSZXR1cm5WYWx1ZSgpKTtcbiAgICBpZiAodmFsdWVSZXR1cm5BY3Rpb25zLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH0gZWxzZSBpZiAodmFsdWVSZXR1cm5BY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gYERvZXMgbm90IHByb2R1Y2UgdGhlIHJldHVybiB2YWx1ZSBpbiBcIiR7Y29tbWFuZC5wcmV0dHkoKX1cImA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGBEb2VzIG5vdCBjb250YWluIGV4YWN0bHkgb25lIGFjdGlvbiB0aGF0IHByb2R1Y2VzIGEgcmV0dXJuIHZhbHVlIGluIFwiJHtcbiAgICAgICAgICAgIGNvbW1hbmQucHJldHR5KClcbiAgICAgICAgfVwiOiBBY3Rpb25zIHRoYXQgcHJvZHVjZSB2YWx1ZSBhcmUgJHtcbiAgICAgICAgICAgIHZhbHVlUmV0dXJuQWN0aW9ucy5tYXAoeCA9PiBgXCIke3gucHJldHR5KCl9XCJgKS5qb2luKCcsICcpXG4gICAgICAgIH1gO1xuICAgIH1cbn1cblxuLyoqXG4gKiDjgqLjgq/jgrfjg6fjg7PjgYzlgKTjgpLkuIDluqbjgaDjgZHov5TjgZnjgYvmpJzmn7vjgZnjgotcbiAqIOOCqOODqeODvOODoeODg+OCu+ODvOOCuOOCkui/lOWNtOOBmeOCi1xuICogQHBhcmFtIHtDb21tYW5kW119IGNvbW1hbmRzXG4gKiBAcmV0dXJucyB7c3RyaW5nW10gfCB1bmRlZmluZWR9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGlvblJldHVybk9uY2UoY29tbWFuZHMpIHtcbiAgICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IGVycm9ycyA9IFtdO1xuICAgIGZvciAoY29uc3QgY29tbWFuZCBvZiBjb21tYW5kcykge1xuICAgICAgICBjb25zdCBlcnIgPSB2YWxpZGF0ZUFjdGlvblJldHVybk9uY2VDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgICBpZiAodHlwZW9mIGVyciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGVycm9ycy5wdXNoKGVycik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBlcnJvcnM7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vQWN0aW9uLmpzXCI7XG5cbi8qKlxuICogYE5PUGAgYWN0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBOb3BBY3Rpb24gZXh0ZW5kcyBBY3Rpb24ge1xuICAgIGNvbnN0cnVjdG9yKCkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgcHJldHR5KCkge1xuICAgICAgICByZXR1cm4gYE5PUGA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gICAgICogQHJldHVybnMge05vcEFjdGlvbiB8IHVuZGVmaW5lZH1cbiAgICAgKi9cbiAgICBzdGF0aWMgcGFyc2Uoc3RyKSB7XG4gICAgICAgIGNvbnN0IGFycmF5ID0gc3RyLnRyaW0oKS5zcGxpdCgvXFxzKy91KTtcbiAgICAgICAgaWYgKGFycmF5Lmxlbmd0aCAhPT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBbIG5vcCBdID0gYXJyYXk7XG4gICAgICAgIGlmIChub3AgIT09IFwiTk9QXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBOb3BBY3Rpb24oKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIEBvdmVycmlkZVxuICAgICAqL1xuICAgIGRvZXNSZXR1cm5WYWx1ZSgpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKiBAcGFyYW0ge0FjdGlvbn0gYWN0aW9uXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59XG4gICAgICovXG4gICAgaXNTYW1lQ29tcG9uZW50KGFjdGlvbikge1xuICAgICAgICByZXR1cm4gYWN0aW9uIGluc3RhbmNlb2YgTm9wQWN0aW9uO1xuICAgIH1cbn1cbiIsIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBBY3Rpb24gfSBmcm9tIFwiLi9BY3Rpb24uanNcIjtcbmltcG9ydCB7IEFkZEFjdGlvbiB9IGZyb20gXCIuL0FkZEFjdGlvbi5qc1wiO1xuaW1wb3J0IHsgQjJEQWN0aW9uIH0gZnJvbSBcIi4vQjJEQWN0aW9uLmpzXCI7XG5pbXBvcnQgeyBCUmVnQWN0aW9uIH0gZnJvbSBcIi4vQlJlZ0FjdGlvbi5qc1wiO1xuaW1wb3J0IHsgSGFsdE91dEFjdGlvbiB9IGZyb20gXCIuL0hhbHRPdXRBY3Rpb24uanNcIjtcbmltcG9ydCB7IE11bEFjdGlvbiB9IGZyb20gXCIuL011bEFjdGlvbi5qc1wiO1xuaW1wb3J0IHsgTm9wQWN0aW9uIH0gZnJvbSBcIi4vTm9wQWN0aW9uLmpzXCI7XG5pbXBvcnQgeyBPdXRwdXRBY3Rpb24gfSBmcm9tIFwiLi9PdXRwdXRBY3Rpb24uanNcIjtcbmltcG9ydCB7IFN1YkFjdGlvbiB9IGZyb20gXCIuL1N1YkFjdGlvbi5qc1wiO1xuaW1wb3J0IHsgVVJlZ0FjdGlvbiB9IGZyb20gXCIuL1VSZWdBY3Rpb24uanNcIjtcbmltcG9ydCB7IExlZ2FjeVRSZWdBY3Rpb24gfSBmcm9tIFwiLi9MZWdhY3lUUmVnQWN0aW9uLmpzXCI7XG5cbi8qKlxuICog44Ki44Kv44K344On44Oz44KS44OR44O844K544GZ44KLXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyXG4gKiBAcmV0dXJucyB7QWN0aW9uIHwgdW5kZWZpbmVkfVxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VBY3Rpb24oc3RyKSB7XG4gICAgLyoqXG4gICAgICogQHR5cGUgeygoc3RyOiBzdHJpbmcpID0+IEFjdGlvbiB8IHVuZGVmaW5lZClbXX1cbiAgICAgKi9cbiAgICBjb25zdCBwYXJzZXJzID0gW1xuICAgICAgICBCUmVnQWN0aW9uLnBhcnNlLFxuICAgICAgICBVUmVnQWN0aW9uLnBhcnNlLFxuICAgICAgICBCMkRBY3Rpb24ucGFyc2UsXG4gICAgICAgIE5vcEFjdGlvbi5wYXJzZSxcbiAgICAgICAgQWRkQWN0aW9uLnBhcnNlLFxuICAgICAgICBNdWxBY3Rpb24ucGFyc2UsXG4gICAgICAgIFN1YkFjdGlvbi5wYXJzZSxcbiAgICAgICAgT3V0cHV0QWN0aW9uLnBhcnNlLFxuICAgICAgICBIYWx0T3V0QWN0aW9uLnBhcnNlLFxuICAgICAgICBMZWdhY3lUUmVnQWN0aW9uLnBhcnNlLFxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHBhcnNlciBvZiBwYXJzZXJzKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzdHIpO1xuICAgICAgICBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiLy8gQHRzLWNoZWNrXG4vLyBkZW5vLWxpbnQtaWdub3JlLWZpbGUgbm8tdW51c2VkLXZhcnNcblxuaW1wb3J0IHsgQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy9BY3Rpb24uanNcIjtcbmltcG9ydCB7IHBhcnNlQWN0aW9uIH0gZnJvbSBcIi4vYWN0aW9ucy9wYXJzZS5qc1wiO1xuXG4vKipcbiAqIOWIneacn+eKtuaFi1xuICovXG5leHBvcnQgY29uc3QgSU5JVElBTF9TVEFURSA9IFwiSU5JVElBTFwiO1xuXG4vKipcbiAqIEBhYnN0cmFjdFxuICovXG5leHBvcnQgY2xhc3MgUHJvZ3JhbUxpbmUge1xuICAgIC8qKlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgcHJldHR5KCkge1xuICAgICAgICByZXR1cm4gYHVuaW1wbGVtZW50ZWRgO1xuICAgIH1cbn1cblxuLyoqXG4gKiBgI0NPTVBPTkVOVFNgXG4gKi9cbmV4cG9ydCBjbGFzcyBDb21wb25lbnRzSGVhZGVyIGV4dGVuZHMgUHJvZ3JhbUxpbmUge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnRcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihjb250ZW50KSB7XG4gICAgICAgIHN1cGVyKCk7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5jb250ZW50ID0gY29udGVudDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIHN0YXRpYyBnZXQga2V5KCkge1xuICAgICAgICByZXR1cm4gXCIjQ09NUE9ORU5UU1wiO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKiBAb3ZlcnJpZGVcbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiBDb21wb25lbnRzSGVhZGVyLmtleSArIFwiIFwiICsgdGhpcy5jb250ZW50O1xuICAgIH1cbn1cblxuLyoqXG4gKiBgI1JFR0lTVEVSU2BcbiAqL1xuZXhwb3J0IGNsYXNzIFJlZ2lzdGVyc0hlYWRlciBleHRlbmRzIFByb2dyYW1MaW5lIHtcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50XG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29udGVudCkge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuY29udGVudCA9IGNvbnRlbnQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICBzdGF0aWMgZ2V0IGtleSgpIHtcbiAgICAgICAgcmV0dXJuIFwiI1JFR0lTVEVSU1wiO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBvdmVycmlkZVxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgcHJldHR5KCkge1xuICAgICAgICByZXR1cm4gUmVnaXN0ZXJzSGVhZGVyLmtleSArIFwiIFwiICsgdGhpcy5jb250ZW50O1xuICAgIH1cbn1cblxuLyoqXG4gKiDjgrPjg6Hjg7Pjg4hcbiAqL1xuZXhwb3J0IGNsYXNzIENvbW1lbnQgZXh0ZW5kcyBQcm9ncmFtTGluZSB7XG4gICAgLyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc3RyIHdpdGggI1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHN0cikge1xuICAgICAgICBzdXBlcigpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuc3RyID0gc3RyO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOOCt+ODo+ODvOODl+OCkuWQq+OCgFxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICovXG4gICAgZ2V0U3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdHI7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICovXG4gICAgcHJldHR5KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRTdHJpbmcoKTtcbiAgICB9XG59XG5cbi8qKlxuICog56m66KGMXG4gKi9cbmV4cG9ydCBjbGFzcyBFbXB0eUxpbmUgZXh0ZW5kcyBQcm9ncmFtTGluZSB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQG92ZXJyaWRlXG4gICAgICovXG4gICAgcHJldHR5KCkge1xuICAgICAgICByZXR1cm4gXCJcIjtcbiAgICB9XG59XG5cbi8qKlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBpbnB1dFN0clxuICogQHJldHVybnMge1wiWlwiIHwgXCJOWlwiIHwgXCJaWlwiIHwgXCIqXCIgfCB1bmRlZmluZWR9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlSW5wdXQoaW5wdXRTdHIpIHtcbiAgICBzd2l0Y2ggKGlucHV0U3RyKSB7XG4gICAgICAgIGNhc2UgXCJaXCI6IHJldHVybiBpbnB1dFN0cjtcbiAgICAgICAgY2FzZSBcIk5aXCI6IHJldHVybiBpbnB1dFN0cjtcbiAgICAgICAgY2FzZSBcIlpaXCI6IHJldHVybiBpbnB1dFN0cjtcbiAgICAgICAgY2FzZSBcIipcIjogcmV0dXJuIGlucHV0U3RyO1xuICAgICAgICBkZWZhdWx0OiByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbn1cblxuLyoqXG4gKiBBIGxpbmUgb2YgcHJvZ3JhbVxuICovXG5leHBvcnQgY2xhc3MgQ29tbWFuZCBleHRlbmRzIFByb2dyYW1MaW5lIHtcbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7e1xuICAgICAqICAgIHN0YXRlOiBzdHJpbmc7XG4gICAgICogICAgaW5wdXQ6IFwiWlwiIHwgXCJOWlwiIHwgXCJaWlwiIHwgXCIqXCI7XG4gICAgICogICAgbmV4dFN0YXRlOiBzdHJpbmc7XG4gICAgICogICAgYWN0aW9uczogQWN0aW9uW11cbiAgICAgKiB9fSBwYXJhbTBcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcih7IHN0YXRlLCBpbnB1dCwgbmV4dFN0YXRlLCBhY3Rpb25zIH0pIHtcbiAgICAgICAgc3VwZXIoKTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQHJlYWRvbmx5XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLnN0YXRlID0gc3RhdGU7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5pbnB1dCA9IGlucHV0O1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMubmV4dFN0YXRlID0gbmV4dFN0YXRlO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuYWN0aW9ucyA9IGFjdGlvbnM7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5fc3RyaW5nID0gYCR7dGhpcy5zdGF0ZX07ICR7dGhpcy5pbnB1dH07ICR7dGhpcy5uZXh0U3RhdGV9OyAke3RoaXMuYWN0aW9ucy5tYXAoYSA9PiBhLnByZXR0eSgpKS5qb2luKFwiLCBcIil9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb21tYW5k44G+44Gf44GvQ29tbWVudOOBvuOBn+OBr+epuuihjOOBvuOBn+OBr+OCqOODqeODvOODoeODg+OCu+ODvOOCuFxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJcbiAgICAgKiBAcmV0dXJucyB7Q29tbWFuZCB8IFJlZ2lzdGVyc0hlYWRlciB8IENvbXBvbmVudHNIZWFkZXIgfCBDb21tZW50IHwgRW1wdHlMaW5lIHwgc3RyaW5nfVxuICAgICAqL1xuICAgIHN0YXRpYyBwYXJzZShzdHIpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBzdHIgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICB0aHJvdyBUeXBlRXJyb3IoJ3N0ciBpcyBub3QgYSBzdHJpbmcnKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0cmltbWVkU3RyID0gc3RyLnRyaW0oKTtcbiAgICAgICAgaWYgKHRyaW1tZWRTdHIgPT09IFwiXCIpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgRW1wdHlMaW5lKCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRyaW1tZWRTdHIuc3RhcnRzV2l0aChcIiNcIikpIHtcbiAgICAgICAgICAgIC8vIOODmOODg+ODgOODvOOCkuODkeODvOOCueOBmeOCi1xuICAgICAgICAgICAgaWYgKHRyaW1tZWRTdHIuc3RhcnRzV2l0aChDb21wb25lbnRzSGVhZGVyLmtleSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IENvbXBvbmVudHNIZWFkZXIodHJpbW1lZFN0ci5zbGljZShDb21wb25lbnRzSGVhZGVyLmtleS5sZW5ndGgpLnRyaW0oKSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRyaW1tZWRTdHIuc3RhcnRzV2l0aChSZWdpc3RlcnNIZWFkZXIua2V5KSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUmVnaXN0ZXJzSGVhZGVyKHRyaW1tZWRTdHIuc2xpY2UoUmVnaXN0ZXJzSGVhZGVyLmtleS5sZW5ndGgpLnRyaW0oKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbmV3IENvbW1lbnQoc3RyKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhcnJheSA9IHRyaW1tZWRTdHIuc3BsaXQoL1xccyo7XFxzKi91KTtcbiAgICAgICAgaWYgKGFycmF5Lmxlbmd0aCA8IDQpIHtcbiAgICAgICAgICAgIHJldHVybiBgSW52YWxpZCBsaW5lIFwiJHtzdHJ9XCJgO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhcnJheS5sZW5ndGggPiA0KSB7XG4gICAgICAgICAgICBpZiAoYXJyYXlbNF0gPT09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYEV4dHJhbmVvdXMgc2VtaWNvbG9uIFwiJHtzdHJ9XCJgO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGBJbnZhbGlkIGxpbmUgXCIke3N0cn1cImA7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYXJyYXnjga7plbfjgZXjga80XG4gICAgICAgIGNvbnN0IHN0YXRlID0gYXJyYXlbMF0gPz8gdGhpcy5lcnJvcigpO1xuICAgICAgICBjb25zdCBpbnB1dFN0ciA9IGFycmF5WzFdID8/IHRoaXMuZXJyb3IoKTtcbiAgICAgICAgY29uc3QgbmV4dFN0YXRlID0gYXJyYXlbMl0gPz8gdGhpcy5lcnJvcigpO1xuICAgICAgICBjb25zdCBhY3Rpb25zU3RyID0gYXJyYXlbM10gPz8gdGhpcy5lcnJvcigpO1xuICAgICAgICAvLyDnqbrmloflrZfjgpLpmaTjgY9cbiAgICAgICAgY29uc3QgYWN0aW9uU3RycyA9IGFjdGlvbnNTdHIudHJpbSgpLnNwbGl0KC9cXHMqLFxccyovdSkuZmlsdGVyKHggPT4geCAhPT0gXCJcIik7XG5cbiAgICAgICAgLyoqIEB0eXBlIHtBY3Rpb25bXX0gKi9cbiAgICAgICAgY29uc3QgYWN0aW9ucyA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGFjdGlvbnNTdHIgb2YgYWN0aW9uU3Rycykge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VBY3Rpb24oYWN0aW9uc1N0cik7XG4gICAgICAgICAgICBpZiAocmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYFVua25vd24gYWN0aW9uIFwiJHthY3Rpb25zU3RyfVwiIGF0IFwiJHtzdHJ9XCJgO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYWN0aW9ucy5wdXNoKHJlc3VsdCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlSW5wdXQoaW5wdXRTdHIpO1xuICAgICAgICBpZiAoaW5wdXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIGBVbmtub3duIGlucHV0IFwiJHtpbnB1dFN0cn1cIiBhdCBcIiR7c3RyfVwiLiBFeHBlY3QgXCJaXCIsIFwiTlpcIiwgXCJaWlwiLCBvciBcIipcImA7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbmV3IENvbW1hbmQoe1xuICAgICAgICAgICAgc3RhdGU6IHN0YXRlLFxuICAgICAgICAgICAgaW5wdXQ6IGlucHV0LFxuICAgICAgICAgICAgbmV4dFN0YXRlOiBuZXh0U3RhdGUsXG4gICAgICAgICAgICBhY3Rpb25zOiBhY3Rpb25zXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBwcml2YXRlXG4gICAgICogQHJldHVybnMge25ldmVyfVxuICAgICAqL1xuICAgIHN0YXRpYyBlcnJvcigpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJ2ludGVybmFsIGVycm9yJyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5paH5a2X5YiX5YyW44GZ44KLXG4gICAgICogQG92ZXJyaWRlXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9zdHJpbmc7IC8vIGAke3RoaXMuc3RhdGV9OyAke3RoaXMuaW5wdXR9OyAke3RoaXMubmV4dFN0YXRlfTsgJHt0aGlzLmFjdGlvbnMubWFwKGEgPT4gYS5wcmV0dHkoKSkuam9pbihcIiwgXCIpfWA7XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IENvbW1hbmQsIElOSVRJQUxfU1RBVEUgfSBmcm9tIFwiLi4vQ29tbWFuZC5qc1wiO1xuXG4vKipcbiAqXG4gKiBAcGFyYW0ge0NvbW1hbmR9IGNvbW1hbmRcbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlTmV4dFN0YXRlSXNOb3RJTklUSUFMQ29tbWFuZChjb21tYW5kKSB7XG4gICAgaWYgKGNvbW1hbmQubmV4dFN0YXRlID09PSBJTklUSUFMX1NUQVRFKSB7XG4gICAgICAgIHJldHVybiBgUmV0dXJuIHRvIGluaXRpYWwgc3RhdGUgaW4gXCIke2NvbW1hbmQucHJldHR5KCl9XCJgO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIOasoeOBrueKtuaFi+OBjOWIneacn+eKtuaFi+OBp+OBquOBhOOBi+aknOafu+OBmeOCi1xuICog44Ko44Op44O844Oh44OD44K744O844K444KS6L+U5Y2044GZ44KLXG4gKiBAcGFyYW0ge0NvbW1hbmRbXX0gY29tbWFuZHNcbiAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTmV4dFN0YXRlSXNOb3RJTklUSUFMKGNvbW1hbmRzKSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICAgICAgY29uc3QgZXJyb3JzID0gW107XG4gICAgZm9yIChjb25zdCBjb21tYW5kIG9mIGNvbW1hbmRzKSB7XG4gICAgICAgIGNvbnN0IGVyciA9IHZhbGlkYXRlTmV4dFN0YXRlSXNOb3RJTklUSUFMQ29tbWFuZChjb21tYW5kKTtcbiAgICAgICAgaWYgKHR5cGVvZiBlcnIgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBlcnJvcnMucHVzaChlcnIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gZXJyb3JzO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IENvbW1hbmQgfSBmcm9tIFwiLi4vQ29tbWFuZC5qc1wiO1xuXG4vKipcbiAqXG4gKiBAcGFyYW0ge0NvbW1hbmR9IGNvbW1hbmRcbiAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9XG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlTm9EdXBsaWNhdGVkQWN0aW9uQ29tbWFuZChjb21tYW5kKSB7XG4gICAgaWYgKGNvbW1hbmQuYWN0aW9ucy5sZW5ndGggPD0gMSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBjb25zdCBhY3Rpb25TdHJzID0gY29tbWFuZC5hY3Rpb25zLm1hcCh4ID0+IHgucHJldHR5KCkpO1xuICAgIGFjdGlvblN0cnMuc29ydCgpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYWN0aW9uU3Rycy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgICAgY29uc3QgYWN0MSA9IGFjdGlvblN0cnNbaV07XG4gICAgICAgIGNvbnN0IGFjdDIgPSBhY3Rpb25TdHJzW2kgKyAxXTtcbiAgICAgICAgaWYgKGFjdDEgPT09IGFjdDIpIHtcbiAgICAgICAgICAgIHJldHVybiBgRHVwbGljYXRlZCBhY3Rpb25zIFwiJHthY3QxfVwiIGluIFwiJHtjb21tYW5kLnByZXR0eSgpfVwiYDtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIOWQjOOBmOOCouOCr+OCt+ODp+ODs+OBjOikh+aVsOWQq+OBvuOCjOOBpuOBhOOBquOBhOOBi+aknOafu+OBmeOCi1xuICog44Ko44Op44O844Oh44OD44K744O844K444KS6L+U5Y2044GZ44KLXG4gKiBAcGFyYW0ge0NvbW1hbmRbXX0gY29tbWFuZHNcbiAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTm9EdXBsaWNhdGVkQWN0aW9uKGNvbW1hbmRzKSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGNvbW1hbmQgb2YgY29tbWFuZHMpIHtcbiAgICAgICAgY29uc3QgZXJyID0gdmFsaWRhdGVOb0R1cGxpY2F0ZWRBY3Rpb25Db21tYW5kKGNvbW1hbmQpO1xuICAgICAgICBpZiAodHlwZW9mIGVyciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGVycm9ycy5wdXNoKGVycik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBlcnJvcnM7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gXCIuLi9Db21tYW5kLmpzXCI7XG5pbXBvcnQgeyBIYWx0T3V0QWN0aW9uIH0gZnJvbSBcIi4uL2FjdGlvbnMvSGFsdE91dEFjdGlvbi5qc1wiO1xuXG4vKipcbiAqIEByZXR1cm5zIHtuZXZlcn1cbiAqL1xuZnVuY3Rpb24gaW50ZXJuYWxFcnJvcigpIHtcbiAgICB0aHJvdyBFcnJvcignaW50ZXJuYWwgZXJyb3InKTtcbn1cblxuLyoqXG4gKiDjgqLjgq/jgrfjg6fjg7PjgYzlkIzjgZjjgrPjg7Pjg53jg7zjg43jg7Pjg4jjgpLkvb/nlKjjgZfjgabjgYTjgarjgYTjgYvmpJzmn7vjgZnjgotcbiAqIEBwYXJhbSB7Q29tbWFuZH0gY29tbWFuZFxuICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH1cbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVOb1NhbWVDb21wb25lbnRDb21tYW5kKGNvbW1hbmQpIHtcbiAgICAvLyBIQUxUX09VVOOBruWgtOWQiOOBr+S4gOaXpueEoeimllxuICAgIC8vIEZJWE1FXG4gICAgaWYgKGNvbW1hbmQuYWN0aW9ucy5maW5kKHggPT4geCBpbnN0YW5jZW9mIEhhbHRPdXRBY3Rpb24pICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgY29uc3QgYWN0aW9ucyA9IGNvbW1hbmQuYWN0aW9ucztcbiAgICBjb25zdCBsZW4gPSBhY3Rpb25zLmxlbmd0aDtcblxuICAgIGlmIChsZW4gPD0gMSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgZm9yIChsZXQgaiA9IGkgKyAxOyBqIDwgbGVuOyBqKyspIHtcbiAgICAgICAgICAgIC8vIGlmIChpID09PSBqKSB7XG4gICAgICAgICAgICAvLyAgICAgY29udGludWU7XG4gICAgICAgICAgICAvLyB9XG4gICAgICAgICAgICBjb25zdCBhID0gYWN0aW9uc1tpXSA/PyBpbnRlcm5hbEVycm9yKCk7XG4gICAgICAgICAgICBjb25zdCBiID0gYWN0aW9uc1tqXSA/PyBpbnRlcm5hbEVycm9yKCk7XG4gICAgICAgICAgICBpZiAoYS5pc1NhbWVDb21wb25lbnQoYikpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYEFjdGlvbnMgXCIke1xuICAgICAgICAgICAgICAgICAgICBhLnByZXR0eSgpXG4gICAgICAgICAgICAgICAgfVwiIGFuZCBcIiR7XG4gICAgICAgICAgICAgICAgICAgIGIucHJldHR5KClcbiAgICAgICAgICAgICAgICB9XCIgdXNlIHNhbWUgY29tcG9uZW50IGluIFwiJHtjb21tYW5kLnByZXR0eSgpfVwiYDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIOOCouOCr+OCt+ODp+ODs+OBjOWQjOOBmOOCs+ODs+ODneODvOODjeODs+ODiOOCkuS9v+eUqOOBl+OBpuOBhOOBquOBhOOBi+aknOafu+OBmeOCi1xuICog44Ko44Op44O844Oh44OD44K744O844K444KS6L+U5Y2044GZ44KLXG4gKiBAcGFyYW0ge0NvbW1hbmRbXX0gY29tbWFuZHNcbiAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTm9TYW1lQ29tcG9uZW50KGNvbW1hbmRzKSB7XG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBjb25zdCBlcnJvcnMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGNvbW1hbmQgb2YgY29tbWFuZHMpIHtcbiAgICAgICAgY29uc3QgZXJyID0gdmFsaWRhdGVOb1NhbWVDb21wb25lbnRDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgICBpZiAodHlwZW9mIGVyciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIGVycm9ycy5wdXNoKGVycik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBlcnJvcnM7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gXCIuLi9Db21tYW5kLmpzXCI7XG5cbi8qKlxuICogQHJldHVybnMge25ldmVyfVxuICovXG5mdW5jdGlvbiBpbnRlcm5hbEVycm9yKCkge1xuICAgIHRocm93IEVycm9yKCdpbnRlcm5hbCBlcnJvcicpO1xufVxuXG4vKipcbiAqIFrjgahOWuOBjOODmuOCouOBq+OBquOBo+OBpuOBhOOCi+OBk+OBqOOCkuaknOafu+OBmeOCi1xuICog44Ko44Op44O844Oh44OD44K744O844K444KS6L+U5Y2044GZ44KLXG4gKiBAcGFyYW0ge0NvbW1hbmRbXX0gY29tbWFuZHNcbiAqIEByZXR1cm5zIHtzdHJpbmdbXSB8IHVuZGVmaW5lZH1cbiAqL1xuIGV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVpBbmROWihjb21tYW5kcykge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtDb21tYW5kfSBsaW5lXG4gICAgICovXG4gICAgY29uc3QgZXJyTXNnID0gbGluZSA9PiBgTmVlZCBaIGxpbmUgZm9sbG93ZWQgYnkgTlogbGluZSBhdCBcIiR7bGluZS5wcmV0dHkoKX1cImA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbW1hbmRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICBjb25zdCBhID0gY29tbWFuZHNbaV0gPz8gaW50ZXJuYWxFcnJvcigpO1xuICAgICAgICBjb25zdCBiID0gY29tbWFuZHNbaSArIDFdID8/IGludGVybmFsRXJyb3IoKTtcblxuICAgICAgICBpZiAoYS5pbnB1dCA9PT0gXCJaXCIgJiYgYi5pbnB1dCAhPT0gJ05aJykge1xuICAgICAgICAgICAgcmV0dXJuIFtlcnJNc2coYSldO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGIuaW5wdXQgPT09IFwiTlpcIiAmJiBhLmlucHV0ICE9PSAnWicpIHtcbiAgICAgICAgICAgIHJldHVybiBbZXJyTXNnKGIpXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhLmlucHV0ID09PSBcIlpcIiAmJiBiLmlucHV0ID09PSBcIk5aXCIgJiYgYS5zdGF0ZSAhPT0gYi5zdGF0ZSkge1xuICAgICAgICAgICAgcmV0dXJuIFtlcnJNc2coYSldO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbGFzdExpbmUgPSBjb21tYW5kc1tjb21tYW5kcy5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdExpbmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAobGFzdExpbmUuaW5wdXQgPT09ICdaJykge1xuICAgICAgICAgICAgcmV0dXJuIFtlcnJNc2cobGFzdExpbmUpXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG4iLCIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHtcbiAgICBDb21tYW5kLFxuICAgIFByb2dyYW1MaW5lLFxufSBmcm9tIFwiLi9Db21tYW5kLmpzXCI7XG5cbi8qKlxuICog44OX44Ot44Kw44Op44Og44Gu6KGM44Gu6YWN5YiXXG4gKi9cbmV4cG9ydCBjbGFzcyBQcm9ncmFtTGluZXMge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtQcm9ncmFtTGluZVtdfSBhcnJheVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKGFycmF5KSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtQcm9ncmFtTGluZVtdfVxuICAgICAqL1xuICAgIGdldEFycmF5KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5hcnJheTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAqL1xuICAgIHByZXR0eSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0QXJyYXkoKS5tYXAobGluZSA9PiBsaW5lLnByZXR0eSgpKS5qb2luKCdcXG4nKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiAx6KGM44KS44OR44O844K5XG4gICAgICogc3RyaW5n44Gv44Ko44Op44O844Oh44OD44K744O844K4XG4gICAgICogc3RyaW5nIGlzIGFuIGVycm9yXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0clxuICAgICAqIEByZXR1cm5zIHtQcm9ncmFtTGluZXMgfCBzdHJpbmd9XG4gICAgICovXG4gICAgc3RhdGljIHBhcnNlKHN0cikge1xuICAgICAgICBjb25zdCBsaW5lcyA9IHN0ci5zcGxpdCgvXFxyXFxufFxcbnxcXHIvdSk7XG5cbiAgICAgICAgY29uc3QgcHJvZ3JhbUxpbmVXaXRoRXJyb3JBcnJheSA9IGxpbmVzLm1hcChsaW5lID0+IENvbW1hbmQucGFyc2UobGluZSkpO1xuXG4gICAgICAgIGNvbnN0IGVycm9ycyA9IHByb2dyYW1MaW5lV2l0aEVycm9yQXJyYXlcbiAgICAgICAgICAgIC5mbGF0TWFwKHggPT4gdHlwZW9mIHggPT09ICdzdHJpbmcnID8gW3hdIDogW10pO1xuXG4gICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGVycm9ycy5qb2luKCdcXG4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHByb2dyYW1MaW5lcyA9IHByb2dyYW1MaW5lV2l0aEVycm9yQXJyYXlcbiAgICAgICAgICAgIC5mbGF0TWFwKHggPT4gdHlwZW9mIHggIT09ICdzdHJpbmcnID8gW3hdIDogW10pO1xuXG4gICAgICAgIHJldHVybiBuZXcgUHJvZ3JhbUxpbmVzKHByb2dyYW1MaW5lcyk7XG4gICAgfVxufVxuIiwiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7IENvbW1hbmQgfSBmcm9tIFwiLi9Db21tYW5kLmpzXCI7XG5cbmltcG9ydCB7IHZhbGlkYXRlTmV4dFN0YXRlSXNOb3RJTklUSUFMIH0gZnJvbSBcIi4vdmFsaWRhdG9ycy9uZXh0X3N0YXRlX2lzX25vdF9pbml0aWFsLmpzXCI7XG5pbXBvcnQgeyB2YWxpZGF0ZU5vRHVwbGljYXRlZEFjdGlvbiB9IGZyb20gXCIuL3ZhbGlkYXRvcnMvbm9fZHVwX2FjdGlvbi5qc1wiO1xuaW1wb3J0IHsgdmFsaWRhdGVBY3Rpb25SZXR1cm5PbmNlIH0gZnJvbSBcIi4vdmFsaWRhdG9ycy9hY3Rpb25fcmV0dXJuX29uY2UuanNcIjtcbmltcG9ydCB7IHZhbGlkYXRlTm9TYW1lQ29tcG9uZW50IH0gZnJvbSBcIi4vdmFsaWRhdG9ycy9ub19zYW1lX2NvbXBvbmVudC5qc1wiO1xuaW1wb3J0IHsgdmFsaWRhdGVaQW5kTlogfSBmcm9tIFwiLi92YWxpZGF0b3JzL3pfYW5kX256LmpzXCI7XG5cbi8qKlxuICog5YWo44Gm44Gu44OQ44Oq44OH44O844K344On44Oz44KS6YCa44GZXG4gKiBAcGFyYW0ge0NvbW1hbmRbXX0gY29tbWFuZHNcbiAqIEByZXR1cm5zIHt1bmRlZmluZWQgfCBzdHJpbmd9IHN0cmluZyBpcyBlcnJvclxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbGwoY29tbWFuZHMpIHtcbiAgICAvKipcbiAgICAgKiBAdHlwZSB7KChfOiBDb21tYW5kW10pID0+IHN0cmluZ1tdIHwgdW5kZWZpbmVkKVtdfVxuICAgICAqL1xuICAgIGNvbnN0IHZhbGlkYXRvcnMgPSBbXG4gICAgICAgIHZhbGlkYXRlTm9EdXBsaWNhdGVkQWN0aW9uLFxuICAgICAgICB2YWxpZGF0ZUFjdGlvblJldHVybk9uY2UsXG4gICAgICAgIHZhbGlkYXRlTm9TYW1lQ29tcG9uZW50LFxuICAgICAgICB2YWxpZGF0ZU5leHRTdGF0ZUlzTm90SU5JVElBTCxcbiAgICAgICAgdmFsaWRhdGVaQW5kTlpcbiAgICBdO1xuXG4gICAgLyoqIEB0eXBlIHtzdHJpbmdbXX0gKi9cbiAgICBsZXQgZXJyb3JzID0gW107XG4gICAgZm9yIChjb25zdCB2YWxpZGF0b3Igb2YgdmFsaWRhdG9ycykge1xuICAgICAgICBjb25zdCBlcnJvcnNPclVuZGVmaW5lZCA9IHZhbGlkYXRvcihjb21tYW5kcyk7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGVycm9yc09yVW5kZWZpbmVkKSkge1xuICAgICAgICAgICAgZXJyb3JzID0gZXJyb3JzLmNvbmNhdChlcnJvcnNPclVuZGVmaW5lZCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGVycm9ycy5qb2luKCdcXG4nKTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cbiIsIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgeyBDb21tYW5kLCBDb21wb25lbnRzSGVhZGVyLCBSZWdpc3RlcnNIZWFkZXIgfSBmcm9tIFwiLi9Db21tYW5kLmpzXCI7XG5pbXBvcnQgeyBBY3Rpb24gfSBmcm9tIFwiLi9hY3Rpb25zL0FjdGlvbi5qc1wiO1xuaW1wb3J0IHsgUHJvZ3JhbUxpbmVzIH0gZnJvbSBcIi4vUHJvZ3JhbUxpbmVzLmpzXCI7XG5pbXBvcnQgeyB2YWxpZGF0ZUFsbCB9IGZyb20gXCIuL3ZhbGlkYXRlLmpzXCI7XG5cbi8qKlxuICogQVBHc2VtYmx5IHByb2dyYW1cbiAqL1xuZXhwb3J0IGNsYXNzIFByb2dyYW0ge1xuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHt7XG4gICAgICogICBwcm9ncmFtTGluZXM6IFByb2dyYW1MaW5lc1xuICAgICAqIH19IHBhcmFtMFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHtcbiAgICAgICAgcHJvZ3JhbUxpbmVzLFxuICAgIH0pIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKiBAdHlwZSB7Q29tbWFuZFtdfVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5jb21tYW5kcyA9IHByb2dyYW1MaW5lcy5nZXRBcnJheSgpLmZsYXRNYXAoeCA9PiB7XG4gICAgICAgICAgICBpZiAoeCBpbnN0YW5jZW9mIENvbW1hbmQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gW3hdO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcmVhZG9ubHlcbiAgICAgICAgICogQHR5cGUge0NvbXBvbmVudHNIZWFkZXIgfCB1bmRlZmluZWR9XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLmNvbXBvbmVudHNIZWFkZXIgPSB1bmRlZmluZWQ7XG4gICAgICAgIGZvciAoY29uc3QgeCBvZiBwcm9ncmFtTGluZXMuZ2V0QXJyYXkoKSkge1xuICAgICAgICAgICAgaWYgKHggaW5zdGFuY2VvZiBDb21wb25lbnRzSGVhZGVyKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuY29tcG9uZW50c0hlYWRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IEVycm9yKGBNdWx0aXBsZSAke0NvbXBvbmVudHNIZWFkZXIua2V5fWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLmNvbXBvbmVudHNIZWFkZXIgPSB4O1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEByZWFkb25seVxuICAgICAgICAgKiBAdHlwZSB7UmVnaXN0ZXJzSGVhZGVyIHwgdW5kZWZpbmVkfVxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5yZWdpc3RlcnNIZWFkZXIgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgZm9yIChjb25zdCB4IG9mIHByb2dyYW1MaW5lcy5nZXRBcnJheSgpKSB7XG4gICAgICAgICAgICBpZiAoeCBpbnN0YW5jZW9mIFJlZ2lzdGVyc0hlYWRlcikge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlZ2lzdGVyc0hlYWRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTXVsdGlwbGUgJHtSZWdpc3RlcnNIZWFkZXIua2V5fWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLnJlZ2lzdGVyc0hlYWRlciA9IHg7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHJlYWRvbmx5ICovXG4gICAgICAgIHRoaXMucHJvZ3JhbUxpbmVzID0gcHJvZ3JhbUxpbmVzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIOODl+ODreOCsOODqeODoOOBvuOBn+OBr+OCqOODqeODvOODoeODg+OCu+ODvOOCuFxuICAgICAqIFByb2dyYW0gb3IgZXJyb3IgbWVzc2FnZVxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJcbiAgICAgKiBAcmV0dXJucyB7UHJvZ3JhbSB8IHN0cmluZ31cbiAgICAgKi9cbiAgICBzdGF0aWMgcGFyc2Uoc3RyKSB7XG4gICAgICAgIGNvbnN0IHByb2dyYW1MaW5lcyA9IFByb2dyYW1MaW5lcy5wYXJzZShzdHIpO1xuICAgICAgICBpZiAodHlwZW9mIHByb2dyYW1MaW5lcyA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBwcm9ncmFtTGluZXM7XG4gICAgICAgIH1cblxuICAgICAgICAvKiogQHR5cGUge0NvbW1hbmRbXX0gKi9cbiAgICAgICAgY29uc3QgY29tbWFuZHMgPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHByb2dyYW1MaW5lIG9mIHByb2dyYW1MaW5lcy5nZXRBcnJheSgpKSB7XG4gICAgICAgICAgICBpZiAocHJvZ3JhbUxpbmUgaW5zdGFuY2VvZiBDb21tYW5kKSB7XG4gICAgICAgICAgICAgICAgY29tbWFuZHMucHVzaChwcm9ncmFtTGluZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZGF0aW9uXG4gICAgICAgIGlmIChjb21tYW5kcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiAnUHJvZ3JhbSBpcyBlbXB0eSc7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlcnJvck9yVW5kZWZpbmVkID0gdmFsaWRhdGVBbGwoY29tbWFuZHMpO1xuICAgICAgICBpZiAodHlwZW9mIGVycm9yT3JVbmRlZmluZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4gZXJyb3JPclVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb2dyYW0oe1xuICAgICAgICAgICAgICAgIHByb2dyYW1MaW5lczogcHJvZ3JhbUxpbmVzXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgVE9ET1xuICAgICAgICAgICAgcmV0dXJuIGVycm9yLm1lc3NhZ2U7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEByZXR1cm5zIHtBY3Rpb25bXX1cbiAgICAgKi9cbiAgICBfYWN0aW9ucygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29tbWFuZHMuZmxhdE1hcChjb21tYW5kID0+IGNvbW1hbmQuYWN0aW9ucyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHJldHVybnMge251bWJlcltdfVxuICAgICAqL1xuICAgIGV4dHJhY3RVbmFyeVJlZ2lzdGVyTnVtYmVycygpIHtcbiAgICAgICAgcmV0dXJuIHNvcnROdWIodGhpcy5fYWN0aW9ucygpLmZsYXRNYXAoYSA9PiBhLmV4dHJhY3RVbmFyeVJlZ2lzdGVyTnVtYmVycygpKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHJldHVybnMge251bWJlcltdfVxuICAgICAqL1xuICAgIGV4dHJhY3RCaW5hcnlSZWdpc3Rlck51bWJlcnMoKSB7XG4gICAgICAgIHJldHVybiBzb3J0TnViKHRoaXMuX2FjdGlvbnMoKS5mbGF0TWFwKGEgPT4gYS5leHRyYWN0QmluYXJ5UmVnaXN0ZXJOdW1iZXJzKCkpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcmV0dXJucyB7bnVtYmVyW119XG4gICAgICovXG4gICAgZXh0cmFjdExlZ2FjeVRSZWdpc3Rlck51bWJlcnMoKSB7XG4gICAgICAgIHJldHVybiBzb3J0TnViKHRoaXMuX2FjdGlvbnMoKS5mbGF0TWFwKGEgPT4gYS5leHRyYWN0TGVnYWN5VFJlZ2lzdGVyTnVtYmVycygpKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5paH5a2X5YiX5YyW44GZ44KLXG4gICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgKi9cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb2dyYW1MaW5lcy5wcmV0dHkoKTtcbiAgICB9XG59XG5cbi8qKlxuICog6KaB57Sg44KS5LiA5oSP44Gr44GX44Gm44K944O844OI44GZ44KLXG4gKiBAcGFyYW0ge251bWJlcltdfSBhcnJheVxuICogQHJldHVybnMge251bWJlcltdfVxuICovXG5mdW5jdGlvbiBzb3J0TnViKGFycmF5KSB7XG4gICAgcmV0dXJuIFsuLi5uZXcgU2V0KGFycmF5KV0uc29ydCgoYSwgYikgPT4gYSAtIGIpO1xufVxuIiwiaW1wb3J0IHsgYm5iIH0gZnJvbSBcIi4uLy4uL2RlcHMudHNcIjtcblxuZXhwb3J0IGNvbnN0IGRlY2ltYWxOYXR1cmFsUGFyc2VyID0gYm5iLm1hdGNoKC9bMC05XSsvKS5kZXNjKFtcIm51bWJlclwiXSkubWFwKFxuICAgICh4KSA9PiBwYXJzZUludCh4LCAxMCksXG4pO1xuXG5leHBvcnQgY29uc3QgaGV4YWRlY2ltYWxOYXR1cmFsUGFyc2VyID0gYm5iLm1hdGNoKC8weFthLWZBLUYwLTldKy8pLmRlc2MoW1xuICAgIFwiaGV4YWRlY2ltYWwgbnVtYmVyXCIsXG5dKS5tYXAoKHgpID0+IHBhcnNlSW50KHgsIDE2KSk7XG5cbmV4cG9ydCBjb25zdCBuYXR1cmFsTnVtYmVyUGFyc2VyOiBibmIuUGFyc2VyPG51bWJlcj4gPSBoZXhhZGVjaW1hbE5hdHVyYWxQYXJzZXJcbiAgICAub3IoZGVjaW1hbE5hdHVyYWxQYXJzZXIpLmRlc2MoW1wibnVtYmVyXCJdKTtcbiIsIi8qKlxuICogRXhwcmVzc2lvbiBvZiBBUEdNIGxhbmd1YWdlXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUEdNRXhwciB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXBwbHkgcmVjdXJzaXZlIHRyYW5zZm9ybVxuICAgICAqL1xuICAgIGFic3RyYWN0IHRyYW5zZm9ybShmOiAoXzogQVBHTUV4cHIpID0+IEFQR01FeHByKTogQVBHTUV4cHI7XG5cbiAgICAvKipcbiAgICAgKiBDb252ZXJ0IHRvIHN0cmluZ1xuICAgICAqL1xuICAgIGFic3RyYWN0IHByZXR0eSgpOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQVBHTVNvdXJjZUxvY2F0aW9uIHtcbiAgICAvKiogVGhlIHN0cmluZyBpbmRleCBpbnRvIHRoZSBpbnB1dCAoZS5nLiBmb3IgdXNlIHdpdGggYC5zbGljZWApICovXG4gICAgaW5kZXg6IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBUaGUgbGluZSBudW1iZXIgZm9yIGVycm9yIHJlcG9ydGluZy4gT25seSB0aGUgY2hhcmFjdGVyIGBcXG5gIGlzIHVzZWQgdG9cbiAgICAgKiBzaWduaWZ5IHRoZSBiZWdpbm5pbmcgb2YgYSBuZXcgbGluZS5cbiAgICAgKi9cbiAgICBsaW5lOiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogVGhlIGNvbHVtbiBudW1iZXIgZm9yIGVycm9yIHJlcG9ydGluZy5cbiAgICAgKi9cbiAgICBjb2x1bW46IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIEVycm9yV2l0aExvY2F0aW9uIGV4dGVuZHMgRXJyb3Ige1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgICAgIHB1YmxpYyBhcGdtTG9jYXRpb24/OiBBUEdNU291cmNlTG9jYXRpb24gfCB1bmRlZmluZWQsXG4gICAgICAgIG9wdGlvbnM/OiBFcnJvck9wdGlvbnMgfCB1bmRlZmluZWQsXG4gICAgKSB7XG4gICAgICAgIHN1cGVyKG1lc3NhZ2UsIG9wdGlvbnMpO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdExvY2F0aW9uKGxvY2F0aW9uOiBBUEdNU291cmNlTG9jYXRpb24pOiBzdHJpbmcge1xuICAgIHJldHVybiBgbGluZSAke2xvY2F0aW9uLmxpbmV9IGNvbHVtbiAke2xvY2F0aW9uLmNvbHVtbn1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0TG9jYXRpb25BdChcbiAgICBsb2NhdGlvbjogQVBHTVNvdXJjZUxvY2F0aW9uIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHtcbiAgICBpZiAobG9jYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gYCBhdCBsaW5lICR7bG9jYXRpb24ubGluZX0gY29sdW1uICR7bG9jYXRpb24uY29sdW1ufWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFwiXCI7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTUV4cHIsIHR5cGUgQVBHTVNvdXJjZUxvY2F0aW9uIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG4vKipcbiAqIEZ1bmN0aW9uIGNhbGxcbiAqL1xuZXhwb3J0IGNsYXNzIEZ1bmNBUEdNRXhwciBleHRlbmRzIEFQR01FeHByIHtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZyxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGFyZ3M6IEFQR01FeHByW10sXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBsb2NhdGlvbjogQVBHTVNvdXJjZUxvY2F0aW9uIHwgdW5kZWZpbmVkLFxuICAgICkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIG92ZXJyaWRlIHRyYW5zZm9ybShmOiAoXzogQVBHTUV4cHIpID0+IEFQR01FeHByKTogQVBHTUV4cHIge1xuICAgICAgICByZXR1cm4gZihcbiAgICAgICAgICAgIG5ldyBGdW5jQVBHTUV4cHIoXG4gICAgICAgICAgICAgICAgdGhpcy5uYW1lLFxuICAgICAgICAgICAgICAgIHRoaXMuYXJncy5tYXAoKHgpID0+IHgudHJhbnNmb3JtKGYpKSxcbiAgICAgICAgICAgICAgICB0aGlzLmxvY2F0aW9uLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBvdmVycmlkZSBwcmV0dHkoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIGAke3RoaXMubmFtZX0oJHt0aGlzLmFyZ3MubWFwKCh4KSA9PiB4LnByZXR0eSgpKS5qb2luKFwiLCBcIil9KWA7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTUV4cHIgfSBmcm9tIFwiLi9jb3JlLnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBJZkFQR01FeHByIGV4dGVuZHMgQVBHTUV4cHIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgbW9kaWZpZXI6IFwiWlwiIHwgXCJOWlwiLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgY29uZDogQVBHTUV4cHIsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSB0aGVuQm9keTogQVBHTUV4cHIsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBlbHNlQm9keTogQVBHTUV4cHIgfCB1bmRlZmluZWQsXG4gICAgKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgdHJhbnNmb3JtKGY6IChfOiBBUEdNRXhwcikgPT4gQVBHTUV4cHIpOiBBUEdNRXhwciB7XG4gICAgICAgIHJldHVybiBmKFxuICAgICAgICAgICAgbmV3IElmQVBHTUV4cHIoXG4gICAgICAgICAgICAgICAgdGhpcy5tb2RpZmllcixcbiAgICAgICAgICAgICAgICB0aGlzLmNvbmQudHJhbnNmb3JtKGYpLFxuICAgICAgICAgICAgICAgIHRoaXMudGhlbkJvZHkudHJhbnNmb3JtKGYpLFxuICAgICAgICAgICAgICAgIHRoaXMuZWxzZUJvZHkgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgICAgICA/IHRoaXMuZWxzZUJvZHkudHJhbnNmb3JtKGYpXG4gICAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBwcmV0dHkoKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgZWwgPSB0aGlzLmVsc2VCb2R5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8gYGBcbiAgICAgICAgICAgIDogYCBlbHNlICR7dGhpcy5lbHNlQm9keT8ucHJldHR5KCl9YDtcbiAgICAgICAgY29uc3Qga2V5d29yZCA9IGBpZl8ke3RoaXMubW9kaWZpZXIgPT09IFwiWlwiID8gXCJ6XCIgOiBcIm56XCJ9YDtcbiAgICAgICAgY29uc3QgY29uZCA9IHRoaXMuY29uZC5wcmV0dHkoKTtcbiAgICAgICAgcmV0dXJuIGAke2tleXdvcmR9ICgke2NvbmR9KSAke3RoaXMudGhlbkJvZHkucHJldHR5KCl9YCArIGVsO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IEFQR01FeHByIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG5leHBvcnQgY2xhc3MgTG9vcEFQR01FeHByIGV4dGVuZHMgQVBHTUV4cHIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgYm9keTogQVBHTUV4cHIsXG4gICAgKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgdHJhbnNmb3JtKGY6IChfOiBBUEdNRXhwcikgPT4gQVBHTUV4cHIpOiBBUEdNRXhwciB7XG4gICAgICAgIHJldHVybiBmKG5ldyBMb29wQVBHTUV4cHIodGhpcy5ib2R5LnRyYW5zZm9ybShmKSkpO1xuICAgIH1cblxuICAgIHByZXR0eSgpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gYGxvb3AgJHt0aGlzLmJvZHkucHJldHR5KCl9YDtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyBBUEdNRXhwciwgdHlwZSBBUEdNU291cmNlTG9jYXRpb24gfSBmcm9tIFwiLi9jb3JlLnRzXCI7XG5pbXBvcnQgeyBWYXJBUEdNRXhwciB9IGZyb20gXCIuL3Zhci50c1wiO1xuXG4vKipcbiAqIE1hY3JvIGRlY2xhcmF0aW9uXG4gKi9cbmV4cG9ydCBjbGFzcyBNYWNybyB7XG4gICAgLyoqXG4gICAgICogQHBhcmFtIG5hbWUgaW5jbHVkZSAhXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBuYW1lOiBzdHJpbmcsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBhcmdzOiBWYXJBUEdNRXhwcltdLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgYm9keTogQVBHTUV4cHIsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBsb2NhdGlvbjogQVBHTVNvdXJjZUxvY2F0aW9uIHwgdW5kZWZpbmVkLFxuICAgICkge1xuICAgIH1cblxuICAgIHByZXR0eSgpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gYG1hY3JvICR7dGhpcy5uYW1lfSgke1xuICAgICAgICAgICAgdGhpcy5hcmdzLm1hcCgoeCkgPT4geC5wcmV0dHkoKSkuam9pbihcIiwgXCIpXG4gICAgICAgIH0pICR7dGhpcy5ib2R5LnByZXR0eSgpfWA7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgU2VxQVBHTUV4cHIgfSBmcm9tIFwiLi9zZXEudHNcIjtcbmltcG9ydCB7IE1hY3JvIH0gZnJvbSBcIi4vbWFjcm8udHNcIjtcbmltcG9ydCB7IEhlYWRlciB9IGZyb20gXCIuL2hlYWRlci50c1wiO1xuXG5leHBvcnQgY2xhc3MgTWFpbiB7XG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBtYWNyb3M6IE1hY3JvW10sXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBoZWFkZXJzOiBIZWFkZXJbXSxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IHNlcUV4cHI6IFNlcUFQR01FeHByLFxuICAgICkge1xuICAgIH1cbn1cbiIsImV4cG9ydCBjbGFzcyBIZWFkZXIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAvKipcbiAgICAgICAgICogbmFtZSB3aXRob3V0IGAjYFxuICAgICAgICAgKi9cbiAgICAgICAgcHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZyxcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGNvbnRlbnQ6IHN0cmluZyxcbiAgICApIHt9XG5cbiAgICB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgICAgICBjb25zdCBzcGFjZSA9IHRoaXMuY29udGVudC5zdGFydHNXaXRoKFwiIFwiKSA/IFwiXCIgOiBcIiBcIjtcbiAgICAgICAgcmV0dXJuIGAjJHt0aGlzLm5hbWV9JHtzcGFjZX0ke3RoaXMuY29udGVudH1gO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IEFQR01FeHByLCB0eXBlIEFQR01Tb3VyY2VMb2NhdGlvbiB9IGZyb20gXCIuL2NvcmUudHNcIjtcblxuZXhwb3J0IGNsYXNzIE51bWJlckFQR01FeHByIGV4dGVuZHMgQVBHTUV4cHIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgdmFsdWU6IG51bWJlcixcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGxvY2F0aW9uPzogQVBHTVNvdXJjZUxvY2F0aW9uIHwgdW5kZWZpbmVkLFxuICAgICkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIHRyYW5zZm9ybShmOiAoXzogQVBHTUV4cHIpID0+IEFQR01FeHByKTogQVBHTUV4cHIge1xuICAgICAgICByZXR1cm4gZih0aGlzKTtcbiAgICB9XG5cbiAgICBwcmV0dHkoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnZhbHVlLnRvU3RyaW5nKCk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTUV4cHIsIHR5cGUgQVBHTVNvdXJjZUxvY2F0aW9uIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG5leHBvcnQgY2xhc3MgU3RyaW5nQVBHTUV4cHIgZXh0ZW5kcyBBUEdNRXhwciB7XG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHB1YmxpYyByZWFkb25seSB2YWx1ZTogc3RyaW5nLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgbG9jYXRpb24/OiBBUEdNU291cmNlTG9jYXRpb24gfCB1bmRlZmluZWQsXG4gICAgKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgdHJhbnNmb3JtKGY6IChfOiBBUEdNRXhwcikgPT4gQVBHTUV4cHIpOiBBUEdNRXhwciB7XG4gICAgICAgIHJldHVybiBmKHRoaXMpO1xuICAgIH1cblxuICAgIHByZXR0eSgpIHtcbiAgICAgICAgLy8gVE9ETzogZXNjYXBlXG4gICAgICAgIHJldHVybiBgXCJgICsgdGhpcy52YWx1ZSArIGBcImA7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTUV4cHIgfSBmcm9tIFwiLi9jb3JlLnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBTZXFBUEdNRXhwciBleHRlbmRzIEFQR01FeHByIHtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGV4cHJzOiBBUEdNRXhwcltdLFxuICAgICkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIHRyYW5zZm9ybShmOiAoXzogQVBHTUV4cHIpID0+IEFQR01FeHByKTogQVBHTUV4cHIge1xuICAgICAgICByZXR1cm4gZihuZXcgU2VxQVBHTUV4cHIodGhpcy5leHBycy5tYXAoKHgpID0+IHgudHJhbnNmb3JtKGYpKSkpO1xuICAgIH1cblxuICAgIHByZXR0eSgpOiBzdHJpbmcge1xuICAgICAgICByZXR1cm4gYHske3RoaXMuZXhwcnMubWFwKCh4KSA9PiB4LnByZXR0eSgpICsgXCI7IFwiKS5qb2luKFwiXCIpfX1gO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IEFQR01FeHByLCB0eXBlIEFQR01Tb3VyY2VMb2NhdGlvbiB9IGZyb20gXCIuL2NvcmUudHNcIjtcblxuZXhwb3J0IGNsYXNzIFZhckFQR01FeHByIGV4dGVuZHMgQVBHTUV4cHIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgbmFtZTogc3RyaW5nLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgbG9jYXRpb246IEFQR01Tb3VyY2VMb2NhdGlvbiB8IHVuZGVmaW5lZCxcbiAgICApIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG5cbiAgICB0cmFuc2Zvcm0oZjogKF86IEFQR01FeHByKSA9PiBBUEdNRXhwcik6IEFQR01FeHByIHtcbiAgICAgICAgcmV0dXJuIGYodGhpcyk7XG4gICAgfVxuXG4gICAgcHJldHR5KCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiB0aGlzLm5hbWU7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTUV4cHIgfSBmcm9tIFwiLi9jb3JlLnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBXaGlsZUFQR01FeHByIGV4dGVuZHMgQVBHTUV4cHIge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgbW9kaWZpZXI6IFwiWlwiIHwgXCJOWlwiLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgY29uZDogQVBHTUV4cHIsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBib2R5OiBBUEdNRXhwcixcbiAgICApIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICB9XG5cbiAgICB0cmFuc2Zvcm0oZjogKF86IEFQR01FeHByKSA9PiBBUEdNRXhwcik6IEFQR01FeHByIHtcbiAgICAgICAgcmV0dXJuIGYoXG4gICAgICAgICAgICBuZXcgV2hpbGVBUEdNRXhwcihcbiAgICAgICAgICAgICAgICB0aGlzLm1vZGlmaWVyLFxuICAgICAgICAgICAgICAgIHRoaXMuY29uZC50cmFuc2Zvcm0oZiksXG4gICAgICAgICAgICAgICAgdGhpcy5ib2R5LnRyYW5zZm9ybShmKSxcbiAgICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgcHJldHR5KCk6IHN0cmluZyB7XG4gICAgICAgIHJldHVybiBgd2hpbGVfJHtcbiAgICAgICAgICAgIHRoaXMubW9kaWZpZXIgPT09IFwiWlwiID8gXCJ6XCIgOiBcIm56XCJcbiAgICAgICAgfSgke3RoaXMuY29uZC5wcmV0dHkoKX0pICR7dGhpcy5ib2R5LnByZXR0eSgpfWA7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgYm5iIH0gZnJvbSBcIi4uLy4uL2RlcHMudHNcIjtcbmltcG9ydCB7IEVycm9yV2l0aExvY2F0aW9uIH0gZnJvbSBcIi4uL2FzdC9tb2QudHNcIjtcblxuLy8gcGFyc2UgZXJyb3IgYXQgbGluZSA4IGNvbHVtbiA5OiBleHBlY3RlZCBjb21tZW50LCAsLCApXG5cbmV4cG9ydCBmdW5jdGlvbiBwcmV0dHlFcnJvcihmYWlsOiBibmIuUGFyc2VGYWlsLCBzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xcbnxcXHJcXG4vKTtcbiAgICBjb25zdCBhYm92ZSA9IGxpbmVzW2ZhaWwubG9jYXRpb24ubGluZSAtIDJdO1xuICAgIGNvbnN0IGVycm9yTGluZSA9IGxpbmVzW2ZhaWwubG9jYXRpb24ubGluZSAtIDFdO1xuICAgIGNvbnN0IGJlbG93ID0gbGluZXNbZmFpbC5sb2NhdGlvbi5saW5lXTtcbiAgICBjb25zdCBhcnJvd0xpbmUgPSBcIiBcIi5yZXBlYXQoTWF0aC5tYXgoMCwgZmFpbC5sb2NhdGlvbi5jb2x1bW4gLSAxKSkgKyBcIl5cIjtcblxuICAgIGNvbnN0IGFib3ZlTGluZXMgPSBbXG4gICAgICAgIC4uLihhYm92ZSA9PT0gdW5kZWZpbmVkID8gW10gOiBbYWJvdmVdKSxcbiAgICAgICAgZXJyb3JMaW5lLFxuICAgIF07XG5cbiAgICBjb25zdCBiZWxvd0xpbmVzID0gW1xuICAgICAgICAuLi4oYmVsb3cgPT09IHVuZGVmaW5lZCA/IFtdIDogW2JlbG93XSksXG4gICAgXTtcblxuICAgIGNvbnN0IHByZWZpeCA9IFwifCBcIjtcblxuICAgIGNvbnN0IGVycm9yTGluZXMgPSBbXG4gICAgICAgIC4uLmFib3ZlTGluZXMubWFwKCh4KSA9PiBwcmVmaXggKyB4KSxcbiAgICAgICAgXCIgXCIucmVwZWF0KHByZWZpeC5sZW5ndGgpICsgYXJyb3dMaW5lLFxuICAgICAgICAuLi5iZWxvd0xpbmVzLm1hcCgoeCkgPT4gcHJlZml4ICsgeCksXG4gICAgXTtcblxuICAgIHJldHVybiBbXG4gICAgICAgIGBwYXJzZSBlcnJvciBhdCBsaW5lICR7ZmFpbC5sb2NhdGlvbi5saW5lfSBjb2x1bW4gJHtmYWlsLmxvY2F0aW9uLmNvbHVtbn06YCxcbiAgICAgICAgYCAgZXhwZWN0ZWQgJHtmYWlsLmV4cGVjdGVkLmpvaW4oXCIsIFwiKX1gLFxuICAgICAgICBgYCxcbiAgICAgICAgLi4uZXJyb3JMaW5lcyxcbiAgICBdLmpvaW4oXCJcXG5cIik7XG59XG5cbi8qKlxuICogQHBhcmFtIHBhcnNlclxuICogQHBhcmFtIHNvdXJjZSBzb3VyY2Ugc3RyaW5nXG4gKiBAcmV0dXJucyBwYXJzZWQgdmFsdWVcbiAqIEB0aHJvd3MgRXJyb3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUHJldHR5PEE+KHBhcnNlcjogYm5iLlBhcnNlcjxBPiwgc291cmNlOiBzdHJpbmcpOiBBIHtcbiAgICBjb25zdCByZXMgPSBwYXJzZXIucGFyc2Uoc291cmNlKTtcbiAgICBpZiAocmVzLnR5cGUgPT09IFwiUGFyc2VPS1wiKSB7XG4gICAgICAgIHJldHVybiByZXMudmFsdWU7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yV2l0aExvY2F0aW9uKHByZXR0eUVycm9yKHJlcywgc291cmNlKSwgcmVzLmxvY2F0aW9uKTtcbn1cbiIsImltcG9ydCB7IGJuYiB9IGZyb20gXCIuLi8uLi9kZXBzLnRzXCI7XG5cbmltcG9ydCB7IG5hdHVyYWxOdW1iZXJQYXJzZXIgfSBmcm9tIFwiLi9udW1iZXIudHNcIjtcbmltcG9ydCB7IHBhcnNlUHJldHR5IH0gZnJvbSBcIi4vcGFyc2VQcmV0dHkudHNcIjtcblxuaW1wb3J0IHtcbiAgICBBUEdNRXhwcixcbiAgICBGdW5jQVBHTUV4cHIsXG4gICAgSGVhZGVyLFxuICAgIElmQVBHTUV4cHIsXG4gICAgTG9vcEFQR01FeHByLFxuICAgIE1hY3JvLFxuICAgIE1haW4sXG4gICAgTnVtYmVyQVBHTUV4cHIsXG4gICAgU2VxQVBHTUV4cHIsXG4gICAgU3RyaW5nQVBHTUV4cHIsXG4gICAgVmFyQVBHTUV4cHIsXG4gICAgV2hpbGVBUEdNRXhwcixcbn0gZnJvbSBcIi4uL2FzdC9tb2QudHNcIjtcblxuLy8gaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTYxNjAxOTAvcmVndWxhci1leHByZXNzaW9uLXRvLWZpbmQtYy1zdHlsZS1ibG9jay1jb21tZW50cyM6fjp0ZXh0PTM1LSxUcnklMjB1c2luZywtJTVDLyU1QyooJTVDKiglM0YhJTVDLyklN0MlNUIlNUUqJTVEKSolNUMqJTVDL1xuZXhwb3J0IGNvbnN0IGNvbW1lbnQgPSBibmIubWF0Y2goL1xcL1xcKihcXCooPyFcXC8pfFteKl0pKlxcKlxcLy9zKS5kZXNjKFtdIC8qIOeEoeOBlyAqLyk7XG5cbi8qKiDnqbrnmb0gKi9cbmV4cG9ydCBjb25zdCBfOiBibmIuUGFyc2VyPHVuZGVmaW5lZD4gPSBibmIubWF0Y2goL1xccyovKS5kZXNjKFtcInNwYWNlXCJdKS5zZXBCeShcbiAgICBjb21tZW50LFxuKS5tYXAoKCkgPT4gdW5kZWZpbmVkKTtcblxuZXhwb3J0IGNvbnN0IHNvbWVTcGFjZXMgPSBibmIubWF0Y2goL1xccysvKS5kZXNjKFtcInNwYWNlXCJdKTtcblxuLyoqXG4gKiDorZjliKXlrZDjga7mraPopo/ooajnj75cbiAqL1xuY29uc3QgaWRlbnRpZmllclJleEV4cCA9IC9bYS16QS1aX11bYS16QS1aXzAtOV0qL3U7XG5leHBvcnQgY29uc3QgaWRlbnRpZmllck9ubHk6IGJuYi5QYXJzZXI8c3RyaW5nPiA9IGJuYi5tYXRjaChpZGVudGlmaWVyUmV4RXhwKVxuICAgIC5kZXNjKFtcImlkZW50aWZpZXJcIl0pO1xuXG5leHBvcnQgY29uc3QgaWRlbnRpZmllcjogYm5iLlBhcnNlcjxzdHJpbmc+ID0gXy5uZXh0KGlkZW50aWZpZXJPbmx5KS5za2lwKF8pO1xuZXhwb3J0IGNvbnN0IGlkZW50aWZpZXJXaXRoTG9jYXRpb246IGJuYi5QYXJzZXI8W3N0cmluZywgYm5iLlNvdXJjZUxvY2F0aW9uXT4gPVxuICAgIF8uY2hhaW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gYm5iLmxvY2F0aW9uLmNoYWluKChsb2MpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBpZGVudGlmaWVyT25seS5za2lwKF8pLm1hcCgoaWRlbnQpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4gW2lkZW50LCBsb2NdO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4vLyBjb21wbGV0aW9uX3BhcnNlci50c+OBqOWQiOOCj+OBm+OCi1xuY29uc3QgbWFjcm9JZGVudGlmaWVyUmVnRXhwID0gL1thLXpBLVpfXVthLXpBLVpfMC05XSohL3U7XG5cbmV4cG9ydCBjb25zdCBtYWNyb0lkZW50aWZpZXI6IGJuYi5QYXJzZXI8c3RyaW5nPiA9IF8ubmV4dChcbiAgICBibmIubWF0Y2gobWFjcm9JZGVudGlmaWVyUmVnRXhwKSxcbikuc2tpcChfKS5kZXNjKFtcIm1hY3JvIG5hbWVcIl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW4oczogc3RyaW5nKTogYm5iLlBhcnNlcjxzdHJpbmc+IHtcbiAgICByZXR1cm4gXy5uZXh0KGJuYi50ZXh0KHMpKS5za2lwKF8pO1xufVxuXG4vKiogYC5gICovXG5leHBvcnQgY29uc3QgY29tbWEgPSB0b2tlbihcIixcIikuZGVzYyhbXCJgLGBcIl0pO1xuLyoqIGAoYCAqL1xuZXhwb3J0IGNvbnN0IGxlZnRQYXJlbiA9IHRva2VuKFwiKFwiKS5kZXNjKFtcImAoYFwiXSk7XG4vKiogYClgICovXG5leHBvcnQgY29uc3QgcmlnaHRQYXJlbiA9IHRva2VuKFwiKVwiKS5kZXNjKFtcImApYFwiXSk7XG4vKiogYDtgICovXG5leHBvcnQgY29uc3Qgc2VtaWNvbG9uID0gdG9rZW4oXCI7XCIpLmRlc2MoW1wiYDtgXCJdKTtcblxuLyoqIGAoYCAqL1xuZXhwb3J0IGNvbnN0IGN1cmx5TGVmdCA9IHRva2VuKFwie1wiKS5kZXNjKFtcImB7YFwiXSk7XG4vKiogYClgICovXG5leHBvcnQgY29uc3QgY3VybHlSaWdodCA9IHRva2VuKFwifVwiKS5kZXNjKFtcImB9YFwiXSk7XG5cbmV4cG9ydCBjb25zdCB2YXJBUEdNRXhwcjogYm5iLlBhcnNlcjxWYXJBUEdNRXhwcj4gPSBpZGVudGlmaWVyV2l0aExvY2F0aW9uLm1hcCgoXG4gICAgW2lkZW50LCBsb2NdLFxuKSA9PiBuZXcgVmFyQVBHTUV4cHIoaWRlbnQsIGxvYykpO1xuXG5mdW5jdGlvbiBhcmdFeHByczxUPihhcmc6ICgpID0+IGJuYi5QYXJzZXI8VD4pOiBibmIuUGFyc2VyPFRbXT4ge1xuICAgIHJldHVybiBibmIubGF6eSgoKSA9PiBhcmcoKSkuc2VwQnkoY29tbWEpLndyYXAoXG4gICAgICAgIGxlZnRQYXJlbixcbiAgICAgICAgcmlnaHRQYXJlbixcbiAgICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZnVuY0FQR01FeHByKCk6IGJuYi5QYXJzZXI8RnVuY0FQR01FeHByPiB7XG4gICAgcmV0dXJuIF8ubmV4dChibmIubG9jYXRpb24pLmNoYWluKChsb2NhdGlvbikgPT4ge1xuICAgICAgICByZXR1cm4gYm5iLmNob2ljZShtYWNyb0lkZW50aWZpZXIsIGlkZW50aWZpZXIpLmNoYWluKChpZGVudCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGFyZ0V4cHJzKCgpID0+IGFwZ21FeHByKCkpLm1hcChcbiAgICAgICAgICAgICAgICAoYXJncykgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IEZ1bmNBUEdNRXhwcihpZGVudCwgYXJncywgbG9jYXRpb24pO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGNvbnN0IG51bWJlckFQR01FeHByOiBibmIuUGFyc2VyPE51bWJlckFQR01FeHByPiA9IF8ubmV4dChcbiAgICBibmIubG9jYXRpb24uY2hhaW4oKGxvYykgPT4ge1xuICAgICAgICByZXR1cm4gbmF0dXJhbE51bWJlclBhcnNlci5tYXAoKHgpID0+IG5ldyBOdW1iZXJBUEdNRXhwcih4LCBsb2MpKTtcbiAgICB9KSxcbikuc2tpcChfKTtcblxuLy8gVE9ETyBsb2NhdGlvblxuZXhwb3J0IGNvbnN0IHN0cmluZ0xpdDogYm5iLlBhcnNlcjxzdHJpbmc+ID0gXy5uZXh0KGJuYi50ZXh0KGBcImApKS5uZXh0KFxuICAgIGJuYi5tYXRjaCgvW15cIl0qLyksXG4pLnNraXAoXG4gICAgYm5iLnRleHQoYFwiYCksXG4pLnNraXAoXykuZGVzYyhbXCJzdHJpbmdcIl0pO1xuZXhwb3J0IGNvbnN0IHN0cmluZ0FQR01FeHByID0gc3RyaW5nTGl0Lm1hcCgoeCkgPT4gbmV3IFN0cmluZ0FQR01FeHByKHgpKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHNlcUFQR01FeHByUmF3KCk6IGJuYi5QYXJzZXI8QVBHTUV4cHJbXT4ge1xuICAgIHJldHVybiBibmIubGF6eSgoKSA9PiBzdGF0ZW1lbnQoKSkucmVwZWF0KCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXFBUEdNRXhwcigpOiBibmIuUGFyc2VyPFNlcUFQR01FeHByPiB7XG4gICAgcmV0dXJuIHNlcUFQR01FeHByUmF3KCkud3JhcChjdXJseUxlZnQsIGN1cmx5UmlnaHQpLm1hcCgoeCkgPT5cbiAgICAgICAgbmV3IFNlcUFQR01FeHByKHgpXG4gICAgKTtcbn1cblxuZXhwb3J0IGNvbnN0IHdoaWxlS2V5d29yZCA9IGJuYi5jaG9pY2UodG9rZW4oXCJ3aGlsZV96XCIpLCB0b2tlbihcIndoaWxlX256XCIpKS5tYXAoXG4gICAgKHgpID0+IHggPT09IFwid2hpbGVfelwiID8gXCJaXCIgOiBcIk5aXCIsXG4pO1xuXG5jb25zdCBleHByV2l0aFBhcmVuOiBibmIuUGFyc2VyPEFQR01FeHByPiA9IGJuYi5sYXp5KCgpID0+IGFwZ21FeHByKCkpLndyYXAoXG4gICAgbGVmdFBhcmVuLFxuICAgIHJpZ2h0UGFyZW4sXG4pO1xuXG5leHBvcnQgZnVuY3Rpb24gd2hpbGVBUEdNRXhwcigpOiBibmIuUGFyc2VyPFdoaWxlQVBHTUV4cHI+IHtcbiAgICByZXR1cm4gd2hpbGVLZXl3b3JkLmNoYWluKChtb2QpID0+IHtcbiAgICAgICAgcmV0dXJuIGV4cHJXaXRoUGFyZW4uY2hhaW4oKGNvbmQpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBibmIubGF6eSgoKSA9PiBhcGdtRXhwcigpKS5tYXAoKGJvZHkpID0+XG4gICAgICAgICAgICAgICAgbmV3IFdoaWxlQVBHTUV4cHIobW9kLCBjb25kLCBib2R5KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBsb29wQVBHTUV4cHIoKTogYm5iLlBhcnNlcjxMb29wQVBHTUV4cHI+IHtcbiAgICByZXR1cm4gdG9rZW4oXCJsb29wXCIpLm5leHQoYm5iLmxhenkoKCkgPT4gYXBnbUV4cHIoKSkpLm1hcCgoeCkgPT5cbiAgICAgICAgbmV3IExvb3BBUEdNRXhwcih4KVxuICAgICk7XG59XG5cbmV4cG9ydCBjb25zdCBpZktleXdvcmQgPSBibmIuY2hvaWNlKHRva2VuKFwiaWZfelwiKSwgdG9rZW4oXCJpZl9uelwiKSkubWFwKCh4KSA9PlxuICAgIHggPT09IFwiaWZfelwiID8gXCJaXCIgOiBcIk5aXCJcbik7XG5cbmV4cG9ydCBmdW5jdGlvbiBpZkFQR01FeHByKCk6IGJuYi5QYXJzZXI8SWZBUEdNRXhwcj4ge1xuICAgIHJldHVybiBpZktleXdvcmQuY2hhaW4oKG1vZCkgPT4ge1xuICAgICAgICByZXR1cm4gZXhwcldpdGhQYXJlbi5jaGFpbigoY29uZCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGJuYi5sYXp5KCgpID0+IGFwZ21FeHByKCkpLmNoYWluKChib2R5KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJuYi5jaG9pY2UoXG4gICAgICAgICAgICAgICAgICAgIHRva2VuKFwiZWxzZVwiKS5uZXh0KGJuYi5sYXp5KCgpID0+IGFwZ21FeHByKCkpKSxcbiAgICAgICAgICAgICAgICAgICAgYm5iLm9rKHVuZGVmaW5lZCksXG4gICAgICAgICAgICAgICAgKS5tYXAoKGVsc2VCb2R5KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgSWZBUEdNRXhwcihtb2QsIGNvbmQsIGJvZHksIGVsc2VCb2R5KTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuLy8gbWFjcm8gZiEoYSwgYilcbmV4cG9ydCBmdW5jdGlvbiBtYWNyb0hlYWQoKTogYm5iLlBhcnNlcjxcbiAgICB7IGxvYzogYm5iLlNvdXJjZUxvY2F0aW9uOyBuYW1lOiBzdHJpbmc7IGFyZ3M6IFZhckFQR01FeHByW10gfVxuPiB7XG4gICAgY29uc3QgbWFjcm9LZXl3b3JkOiBibmIuUGFyc2VyPGJuYi5Tb3VyY2VMb2NhdGlvbj4gPSBfLmNoYWluKChfKSA9PiB7XG4gICAgICAgIHJldHVybiBibmIubG9jYXRpb24uY2hhaW4oKGxvY2F0aW9uKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYm5iLnRleHQoXCJtYWNyb1wiKS5uZXh0KHNvbWVTcGFjZXMpLm1hcCgoXykgPT4gbG9jYXRpb24pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBtYWNyb0tleXdvcmQuYW5kKG1hY3JvSWRlbnRpZmllcikuY2hhaW4oKFtsb2NhdGlvbiwgaWRlbnRdKSA9PiB7XG4gICAgICAgIHJldHVybiBhcmdFeHBycygoKSA9PiB2YXJBUEdNRXhwcikubWFwKFxuICAgICAgICAgICAgKGFyZ3MpID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBsb2M6IGxvY2F0aW9uLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiBpZGVudCxcbiAgICAgICAgICAgICAgICAgICAgYXJnczogYXJncyxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBtYWNybyBmISh4KSB7XG4gKiAgIHg7XG4gKiB9XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWNybygpOiBibmIuUGFyc2VyPE1hY3JvPiB7XG4gICAgcmV0dXJuIG1hY3JvSGVhZCgpLmNoYWluKCh7IGxvYywgbmFtZSwgYXJncyB9KSA9PiB7XG4gICAgICAgIHJldHVybiBibmIubGF6eSgoKSA9PiBhcGdtRXhwcigpKS5tYXAoKGJvZHkpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgTWFjcm8obmFtZSwgYXJncywgYm9keSwgbG9jKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG5cbmNvbnN0IGFueXRoaW5nTGluZTogYm5iLlBhcnNlcjxzdHJpbmc+ID0gYm5iLm1hdGNoKC8uKi8pO1xuXG4vKiDmlLnooYzjgpLlkKvjgb7jgarjgYQgKi9cbmV4cG9ydCBjb25zdCBoZWFkZXIgPSBibmIudGV4dChcIiNcIikubmV4dChibmIubWF0Y2goL1JFR0lTVEVSU3xDT01QT05FTlRTLykpXG4gICAgLmRlc2MoW1wiI1JFR0lTVEVSU1wiLCBcIiNDT01QT05FTlRTXCJdKS5jaGFpbigoeCkgPT5cbiAgICAgICAgYW55dGhpbmdMaW5lLm1hcCgoYykgPT4gbmV3IEhlYWRlcih4LCBjKSlcbiAgICApO1xuXG5leHBvcnQgY29uc3QgaGVhZGVyczogYm5iLlBhcnNlcjxIZWFkZXJbXT4gPSBfLm5leHQoaGVhZGVyKS5za2lwKF8pLnJlcGVhdCgpO1xuXG5leHBvcnQgZnVuY3Rpb24gbWFpbigpOiBibmIuUGFyc2VyPE1haW4+IHtcbiAgICByZXR1cm4gbWFjcm8oKS5yZXBlYXQoKS5jaGFpbigobWFjcm9zKSA9PiB7XG4gICAgICAgIHJldHVybiBoZWFkZXJzLmNoYWluKChoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gXy5uZXh0KHNlcUFQR01FeHByUmF3KCkpLnNraXAoXykubWFwKCh4KSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBNYWluKG1hY3JvcywgaCwgbmV3IFNlcUFQR01FeHByKHgpKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFpbihzdHI6IHN0cmluZyk6IE1haW4ge1xuICAgIHJldHVybiBwYXJzZVByZXR0eShtYWluKCksIHN0cik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcGdtRXhwcigpOiBibmIuUGFyc2VyPEFQR01FeHByPiB7XG4gICAgcmV0dXJuIGJuYi5jaG9pY2UoXG4gICAgICAgIGxvb3BBUEdNRXhwcigpLFxuICAgICAgICB3aGlsZUFQR01FeHByKCksXG4gICAgICAgIGlmQVBHTUV4cHIoKSxcbiAgICAgICAgZnVuY0FQR01FeHByKCksXG4gICAgICAgIHNlcUFQR01FeHByKCksXG4gICAgICAgIHZhckFQR01FeHByLFxuICAgICAgICBudW1iZXJBUEdNRXhwcixcbiAgICAgICAgc3RyaW5nQVBHTUV4cHIsXG4gICAgKTtcbn1cblxuLy8gc2VxID0geyBzdGF0ZW1lbnQqIH1cbi8vIHN0YXRlbWVudCA9IGxvb3AgfCB3aGlsZSB8IGlmIHwgKGV4cHIgd2l0aCBzZW1pY29sb24pO1xuLy8gZXhwciA9IGxvb3AgfCB3aGlsZSB8IGlmIHwgZnVuYyB8IHNlcSB8IHZhciB8IG51bSB8IHN0clxuXG4vLyBTZXFBUEdNRXhwcuOBruimgee0oFxuLy8gZWxlbWVudCBvZiBTZXFBUEdNRXhwclxuZXhwb3J0IGZ1bmN0aW9uIHN0YXRlbWVudCgpOiBibmIuUGFyc2VyPEFQR01FeHByPiB7XG4gICAgcmV0dXJuIGJuYi5jaG9pY2UoXG4gICAgICAgIGxvb3BBUEdNRXhwcigpLFxuICAgICAgICB3aGlsZUFQR01FeHByKCksXG4gICAgICAgIGlmQVBHTUV4cHIoKSxcbiAgICAgICAgYXBnbUV4cHIoKS5za2lwKHNlbWljb2xvbiksXG4gICAgKTtcbn1cbiIsIi8qKlxuICogTG93IGxldmVsXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBUEdMRXhwciB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgfVxuXG4gICAgYWJzdHJhY3QgdHJhbnNmb3JtKGY6IChfOiBBUEdMRXhwcikgPT4gQVBHTEV4cHIpOiBBUEdMRXhwcjtcbn1cbiIsImltcG9ydCB7IEFQR0xFeHByIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG5leHBvcnQgY2xhc3MgQWN0aW9uQVBHTEV4cHIgZXh0ZW5kcyBBUEdMRXhwciB7XG4gICAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGFjdGlvbnM6IHN0cmluZ1tdKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgb3ZlcnJpZGUgdHJhbnNmb3JtKGY6IChfOiBBUEdMRXhwcikgPT4gQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgICAgIHJldHVybiBmKHRoaXMpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IEFQR0xFeHByIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG5leHBvcnQgY2xhc3MgU2VxQVBHTEV4cHIgZXh0ZW5kcyBBUEdMRXhwciB7XG4gICAgY29uc3RydWN0b3IocHVibGljIHJlYWRvbmx5IGV4cHJzOiBBUEdMRXhwcltdKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgb3ZlcnJpZGUgdHJhbnNmb3JtKGY6IChfOiBBUEdMRXhwcikgPT4gQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgICAgIHJldHVybiBmKG5ldyBTZXFBUEdMRXhwcih0aGlzLmV4cHJzLm1hcCgoeCkgPT4geC50cmFuc2Zvcm0oZikpKSk7XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eUV4cHIoZXhwcjogQVBHTEV4cHIpOiBib29sZWFuIHtcbiAgICByZXR1cm4gZXhwciBpbnN0YW5jZW9mIFNlcUFQR0xFeHByICYmXG4gICAgICAgIGV4cHIuZXhwcnMuZXZlcnkoKGUpID0+IGlzRW1wdHlFeHByKGUpKTtcbn1cbiIsImltcG9ydCB7IEFQR0xFeHByIH0gZnJvbSBcIi4vY29yZS50c1wiO1xuXG5leHBvcnQgY2xhc3MgSWZBUEdMRXhwciBleHRlbmRzIEFQR0xFeHByIHtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGNvbmQ6IEFQR0xFeHByLFxuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgdGhlbkJvZHk6IEFQR0xFeHByLCAvLyBaXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBlbHNlQm9keTogQVBHTEV4cHIsIC8vIE5aXG4gICAgKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgb3ZlcnJpZGUgdHJhbnNmb3JtKGY6IChfOiBBUEdMRXhwcikgPT4gQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgICAgIHJldHVybiBmKFxuICAgICAgICAgICAgbmV3IElmQVBHTEV4cHIoXG4gICAgICAgICAgICAgICAgdGhpcy5jb25kLnRyYW5zZm9ybShmKSxcbiAgICAgICAgICAgICAgICB0aGlzLnRoZW5Cb2R5LnRyYW5zZm9ybShmKSxcbiAgICAgICAgICAgICAgICB0aGlzLmVsc2VCb2R5LnRyYW5zZm9ybShmKSxcbiAgICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgfVxufVxuIiwiaW1wb3J0IHsgQVBHTEV4cHIgfSBmcm9tIFwiLi9jb3JlLnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBMb29wQVBHTEV4cHIgZXh0ZW5kcyBBUEdMRXhwciB7XG4gICAgcHJpdmF0ZSBraW5kOiBzdHJpbmcgPSBcImxvb3BcIjtcbiAgICBjb25zdHJ1Y3RvcihcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGJvZHk6IEFQR0xFeHByLFxuICAgICkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIG92ZXJyaWRlIHRyYW5zZm9ybShmOiAoXzogQVBHTEV4cHIpID0+IEFQR0xFeHByKTogQVBHTEV4cHIge1xuICAgICAgICByZXR1cm4gZihuZXcgTG9vcEFQR0xFeHByKHRoaXMuYm9keS50cmFuc2Zvcm0oZikpKTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyBBUEdMRXhwciB9IGZyb20gXCIuL2NvcmUudHNcIjtcblxuZXhwb3J0IGNsYXNzIFdoaWxlQVBHTEV4cHIgZXh0ZW5kcyBBUEdMRXhwciB7XG4gICAgY29uc3RydWN0b3IoXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBtb2RpZmllcjogXCJaXCIgfCBcIk5aXCIsXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBjb25kOiBBUEdMRXhwcixcbiAgICAgICAgcHVibGljIHJlYWRvbmx5IGJvZHk6IEFQR0xFeHByLFxuICAgICkge1xuICAgICAgICBzdXBlcigpO1xuICAgIH1cblxuICAgIG92ZXJyaWRlIHRyYW5zZm9ybShmOiAoXzogQVBHTEV4cHIpID0+IEFQR0xFeHByKTogQVBHTEV4cHIge1xuICAgICAgICByZXR1cm4gZihcbiAgICAgICAgICAgIG5ldyBXaGlsZUFQR0xFeHByKFxuICAgICAgICAgICAgICAgIHRoaXMubW9kaWZpZXIsXG4gICAgICAgICAgICAgICAgdGhpcy5jb25kLnRyYW5zZm9ybShmKSxcbiAgICAgICAgICAgICAgICB0aGlzLmJvZHkudHJhbnNmb3JtKGYpLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyBBUEdMRXhwciB9IGZyb20gXCIuL2NvcmUudHNcIjtcblxuZXhwb3J0IGNsYXNzIEJyZWFrQVBHTEV4cHIgZXh0ZW5kcyBBUEdMRXhwciB7XG4gICAgcHJpdmF0ZSBraW5kOiBzdHJpbmcgPSBcImJyZWFrXCI7XG4gICAgLyoqXG4gICAgICogQHBhcmFtIGxldmVsIGRlZmF1bHQgaXMgMVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHB1YmxpYyByZWFkb25seSBsZXZlbDogbnVtYmVyIHwgdW5kZWZpbmVkKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgfVxuXG4gICAgb3ZlcnJpZGUgdHJhbnNmb3JtKGY6IChfOiBBUEdMRXhwcikgPT4gQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgICAgIHJldHVybiBmKHRoaXMpO1xuICAgIH1cbn1cbiIsImltcG9ydCB7IEFjdGlvbkFQR0xFeHByIH0gZnJvbSBcIi4vYXN0L21vZC50c1wiO1xuXG4vKipcbiAqIEFjdGlvbnNcbiAqL1xuZXhwb3J0IGNsYXNzIEEge1xuICAgIC8vIFVcbiAgICBzdGF0aWMgaW5jVShuOiBudW1iZXIpIHtcbiAgICAgICAgcmV0dXJuIEEubm9uUmV0dXJuKGBJTkMgVSR7bn1gKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgaW5jVU11bHRpKC4uLmFyZ3M6IG51bWJlcltdKSB7XG4gICAgICAgIHJldHVybiBuZXcgQWN0aW9uQVBHTEV4cHIoWy4uLmFyZ3MubWFwKCh4KSA9PiBgSU5DIFUke3h9YCksIFwiTk9QXCJdKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgdGRlY1UobjogbnVtYmVyKSB7XG4gICAgICAgIHJldHVybiBBLnNpbmdsZShgVERFQyBVJHtufWApO1xuICAgIH1cblxuICAgIC8vIEFERFxuICAgIHN0YXRpYyBhZGRBMSgpIHtcbiAgICAgICAgcmV0dXJuIEEubm9uUmV0dXJuKGBBREQgQTFgKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYWRkQjAoKSB7XG4gICAgICAgIHJldHVybiBBLnNpbmdsZShcIkFERCBCMFwiKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgYWRkQjEoKSB7XG4gICAgICAgIHJldHVybiBBLnNpbmdsZShcIkFERCBCMVwiKTtcbiAgICB9XG5cbiAgICAvLyBCMkRcbiAgICBzdGF0aWMgaW5jQjJEWCgpIHtcbiAgICAgICAgcmV0dXJuIEEubm9uUmV0dXJuKFwiSU5DIEIyRFhcIik7XG4gICAgfVxuXG4gICAgc3RhdGljIHRkZWNCMkRYKCkge1xuICAgICAgICByZXR1cm4gQS5zaW5nbGUoXCJUREVDIEIyRFhcIik7XG4gICAgfVxuXG4gICAgc3RhdGljIGluY0IyRFkoKSB7XG4gICAgICAgIHJldHVybiBBLm5vblJldHVybihcIklOQyBCMkRZXCIpO1xuICAgIH1cblxuICAgIHN0YXRpYyB0ZGVjQjJEWSgpIHtcbiAgICAgICAgcmV0dXJuIEEuc2luZ2xlKFwiVERFQyBCMkRZXCIpO1xuICAgIH1cblxuICAgIHN0YXRpYyByZWFkQjJEKCkge1xuICAgICAgICByZXR1cm4gQS5zaW5nbGUoXCJSRUFEIEIyRFwiKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgc2V0QjJEKCkge1xuICAgICAgICByZXR1cm4gQS5ub25SZXR1cm4oXCJTRVQgQjJEXCIpO1xuICAgIH1cblxuICAgIC8vIEJcbiAgICBzdGF0aWMgaW5jQihuOiBudW1iZXIpIHtcbiAgICAgICAgcmV0dXJuIEEubm9uUmV0dXJuKGBJTkMgQiR7bn1gKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgdGRlY0IobjogbnVtYmVyKSB7XG4gICAgICAgIHJldHVybiBBLnNpbmdsZShgVERFQyBCJHtufWApO1xuICAgIH1cblxuICAgIHN0YXRpYyByZWFkQihuOiBudW1iZXIpIHtcbiAgICAgICAgcmV0dXJuIEEuc2luZ2xlKGBSRUFEIEIke259YCk7XG4gICAgfVxuXG4gICAgc3RhdGljIHNldEIobjogbnVtYmVyKSB7XG4gICAgICAgIHJldHVybiBBLm5vblJldHVybihgU0VUIEIke259YCk7XG4gICAgfVxuXG4gICAgc3RhdGljIGhhbHRPVVQoKSB7XG4gICAgICAgIHJldHVybiBBLnNpbmdsZShcIkhBTFRfT1VUXCIpO1xuICAgIH1cblxuICAgIC8vIE1VTFxuICAgIHN0YXRpYyBtdWwwKCkge1xuICAgICAgICByZXR1cm4gQS5zaW5nbGUoXCJNVUwgMFwiKTtcbiAgICB9XG5cbiAgICBzdGF0aWMgbXVsMSgpIHtcbiAgICAgICAgcmV0dXJuIEEuc2luZ2xlKFwiTVVMIDFcIik7XG4gICAgfVxuXG4gICAgLy8gTk9QXG4gICAgc3RhdGljIG5vcCgpIHtcbiAgICAgICAgcmV0dXJuIEEuc2luZ2xlKFwiTk9QXCIpO1xuICAgIH1cblxuICAgIC8vIE9VVFBVVFxuICAgIHN0YXRpYyBvdXRwdXQoYzogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBBLm5vblJldHVybihgT1VUUFVUICR7Y31gKTtcbiAgICB9XG5cbiAgICAvLyBTVUJcbiAgICBzdGF0aWMgc3ViQTEoKSB7XG4gICAgICAgIHJldHVybiBBLm5vblJldHVybihgU1VCIEExYCk7XG4gICAgfVxuXG4gICAgc3RhdGljIHN1YkIwKCkge1xuICAgICAgICByZXR1cm4gQS5zaW5nbGUoYFNVQiBCMGApO1xuICAgIH1cblxuICAgIHN0YXRpYyBzdWJCMSgpIHtcbiAgICAgICAgcmV0dXJuIEEuc2luZ2xlKGBTVUIgQjFgKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIHN0YXRpYyBub25SZXR1cm4oYWN0OiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBBY3Rpb25BUEdMRXhwcihbYWN0LCBcIk5PUFwiXSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBzdGF0aWMgc2luZ2xlKGFjdDogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBuZXcgQWN0aW9uQVBHTEV4cHIoW2FjdF0pO1xuICAgIH1cbn1cbiIsImltcG9ydCB7XG4gICAgQVBHTUV4cHIsXG4gICAgRXJyb3JXaXRoTG9jYXRpb24sXG4gICAgZm9ybWF0TG9jYXRpb25BdCxcbiAgICBGdW5jQVBHTUV4cHIsXG4gICAgSWZBUEdNRXhwcixcbiAgICBMb29wQVBHTUV4cHIsXG4gICAgTnVtYmVyQVBHTUV4cHIsXG4gICAgU2VxQVBHTUV4cHIsXG4gICAgU3RyaW5nQVBHTUV4cHIsXG4gICAgVmFyQVBHTUV4cHIsXG4gICAgV2hpbGVBUEdNRXhwcixcbn0gZnJvbSBcIi4uL2FwZ20vYXN0L21vZC50c1wiO1xuXG5pbXBvcnQge1xuICAgIEFQR0xFeHByLFxuICAgIEJyZWFrQVBHTEV4cHIsXG4gICAgSWZBUEdMRXhwcixcbiAgICBMb29wQVBHTEV4cHIsXG4gICAgU2VxQVBHTEV4cHIsXG4gICAgV2hpbGVBUEdMRXhwcixcbn0gZnJvbSBcIi4uL2FwZ2wvYXN0L21vZC50c1wiO1xuaW1wb3J0IHsgQSB9IGZyb20gXCIuLi9hcGdsL2FjdGlvbnMudHNcIjtcblxuZnVuY3Rpb24gdHJhbnNwaWxlRW1wdHlBcmdGdW5jKGZ1bmNFeHByOiBGdW5jQVBHTUV4cHIsIGV4cHI6IEFQR0xFeHByKSB7XG4gICAgaWYgKGZ1bmNFeHByLmFyZ3MubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcldpdGhMb2NhdGlvbihcbiAgICAgICAgICAgIGBhcmd1bWVudCBnaXZlbiB0byBcIiR7ZnVuY0V4cHIubmFtZX1cIiR7XG4gICAgICAgICAgICAgICAgZm9ybWF0TG9jYXRpb25BdChmdW5jRXhwci5sb2NhdGlvbilcbiAgICAgICAgICAgIH1gLFxuICAgICAgICAgICAgZnVuY0V4cHIubG9jYXRpb24sXG4gICAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBleHByO1xufVxuXG5mdW5jdGlvbiB0cmFuc3BpbGVOdW1BcmdGdW5jKFxuICAgIGZ1bmNFeHByOiBGdW5jQVBHTUV4cHIsXG4gICAgZXhwcjogKF86IG51bWJlcikgPT4gQVBHTEV4cHIsXG4pIHtcbiAgICBpZiAoZnVuY0V4cHIuYXJncy5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yV2l0aExvY2F0aW9uKFxuICAgICAgICAgICAgYG51bWJlciBvZiBhcmd1bWVudHMgaXMgbm90IDE6IFwiJHtmdW5jRXhwci5uYW1lfVwiJHtcbiAgICAgICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKVxuICAgICAgICAgICAgfWAsXG4gICAgICAgICAgICBmdW5jRXhwci5sb2NhdGlvbixcbiAgICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgYXJnID0gZnVuY0V4cHIuYXJnc1swXTtcbiAgICBpZiAoIShhcmcgaW5zdGFuY2VvZiBOdW1iZXJBUEdNRXhwcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yV2l0aExvY2F0aW9uKFxuICAgICAgICAgICAgYGFyZ3VtZW50IGlzIG5vdCBhIG51bWJlcjogXCIke2Z1bmNFeHByLm5hbWV9XCIke1xuICAgICAgICAgICAgICAgIGZvcm1hdExvY2F0aW9uQXQoZnVuY0V4cHIubG9jYXRpb24pXG4gICAgICAgICAgICB9YCxcbiAgICAgICAgICAgIGZ1bmNFeHByLmxvY2F0aW9uLFxuICAgICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gZXhwcihhcmcudmFsdWUpO1xufVxuXG5mdW5jdGlvbiB0cmFuc3BpbGVTdHJpbmdBcmdGdW5jKFxuICAgIGZ1bmNFeHByOiBGdW5jQVBHTUV4cHIsXG4gICAgZXhwcjogKF86IHN0cmluZykgPT4gQVBHTEV4cHIsXG4pIHtcbiAgICBpZiAoZnVuY0V4cHIuYXJncy5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yV2l0aExvY2F0aW9uKFxuICAgICAgICAgICAgYG51bWJlciBvZiBhcmd1bWVudHMgaXMgbm90IDE6IFwiJHtmdW5jRXhwci5uYW1lfVwiJHtcbiAgICAgICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKVxuICAgICAgICAgICAgfWAsXG4gICAgICAgICAgICBmdW5jRXhwci5sb2NhdGlvbixcbiAgICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgYXJnID0gZnVuY0V4cHIuYXJnc1swXTtcbiAgICBpZiAoIShhcmcgaW5zdGFuY2VvZiBTdHJpbmdBUEdNRXhwcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yV2l0aExvY2F0aW9uKFxuICAgICAgICAgICAgYGFyZ3VtZW50IGlzIG5vdCBhIHN0cmluZzogXCIke2Z1bmNFeHByLm5hbWV9XCIke1xuICAgICAgICAgICAgICAgIGZvcm1hdExvY2F0aW9uQXQoZnVuY0V4cHIubG9jYXRpb24pXG4gICAgICAgICAgICB9YCxcbiAgICAgICAgICAgIGZ1bmNFeHByLmxvY2F0aW9uLFxuICAgICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gZXhwcihhcmcudmFsdWUpO1xufVxuXG5leHBvcnQgY29uc3QgZW1wdHlBcmdGdW5jczogTWFwPHN0cmluZywgQVBHTEV4cHI+ID0gbmV3IE1hcChbXG4gICAgW1wibm9wXCIsIEEubm9wKCldLFxuICAgIC8vIEIyRFxuICAgIFtcImluY19iMmR4XCIsIEEuaW5jQjJEWCgpXSxcbiAgICBbXCJpbmNfYjJkeVwiLCBBLmluY0IyRFkoKV0sXG4gICAgW1widGRlY19iMmR4XCIsIEEudGRlY0IyRFgoKV0sXG4gICAgW1widGRlY19iMmR5XCIsIEEudGRlY0IyRFkoKV0sXG4gICAgW1wicmVhZF9iMmRcIiwgQS5yZWFkQjJEKCldLFxuICAgIFtcInNldF9iMmRcIiwgQS5zZXRCMkQoKV0sXG4gICAgLy8gQUREXG4gICAgW1wiYWRkX2ExXCIsIEEuYWRkQTEoKV0sXG4gICAgW1wiYWRkX2IwXCIsIEEuYWRkQjAoKV0sXG4gICAgW1wiYWRkX2IxXCIsIEEuYWRkQjEoKV0sXG4gICAgLy8gU1VCXG4gICAgW1wic3ViX2ExXCIsIEEuc3ViQTEoKV0sXG4gICAgW1wic3ViX2IwXCIsIEEuc3ViQjAoKV0sXG4gICAgW1wic3ViX2IxXCIsIEEuc3ViQjEoKV0sXG4gICAgLy8gTVVMXG4gICAgW1wibXVsXzBcIiwgQS5tdWwwKCldLFxuICAgIFtcIm11bF8xXCIsIEEubXVsMSgpXSxcbiAgICAvLyBIQUxUX09VVFxuICAgIFtcImhhbHRfb3V0XCIsIEEuaGFsdE9VVCgpXSxcbl0pO1xuXG5leHBvcnQgY29uc3QgbnVtQXJnRnVuY3M6IE1hcDxzdHJpbmcsIChfOiBudW1iZXIpID0+IEFQR0xFeHByPiA9IG5ldyBNYXAoW1xuICAgIC8vIFVcbiAgICBbXCJpbmNfdVwiLCBBLmluY1VdLFxuICAgIFtcInRkZWNfdVwiLCBBLnRkZWNVXSxcbiAgICAvLyBCXG4gICAgW1wiaW5jX2JcIiwgQS5pbmNCXSxcbiAgICBbXCJ0ZGVjX2JcIiwgQS50ZGVjQl0sXG4gICAgW1wicmVhZF9iXCIsIEEucmVhZEJdLFxuICAgIFtcInNldF9iXCIsIEEuc2V0Ql0sXG5dKTtcblxuZXhwb3J0IGNvbnN0IHN0ckFyZ0Z1bmNzOiBNYXA8c3RyaW5nLCAoXzogc3RyaW5nKSA9PiBBUEdMRXhwcj4gPSBuZXcgTWFwKFtcbiAgICAvLyBPVVRQVVRcbiAgICBbXCJvdXRwdXRcIiwgQS5vdXRwdXRdLFxuXSk7XG5cbmZ1bmN0aW9uIHRyYW5zcGlsZUZ1bmNBUEdNRXhwcihmdW5jRXhwcjogRnVuY0FQR01FeHByKTogQVBHTEV4cHIge1xuICAgIGNvbnN0IGVtcHR5T3JVbmRlZmluZWQgPSBlbXB0eUFyZ0Z1bmNzLmdldChmdW5jRXhwci5uYW1lKTtcbiAgICBpZiAoZW1wdHlPclVuZGVmaW5lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB0cmFuc3BpbGVFbXB0eUFyZ0Z1bmMoZnVuY0V4cHIsIGVtcHR5T3JVbmRlZmluZWQpO1xuICAgIH1cblxuICAgIGNvbnN0IG51bUFyZ09yVW5kZWZpbmVkID0gbnVtQXJnRnVuY3MuZ2V0KGZ1bmNFeHByLm5hbWUpO1xuICAgIGlmIChudW1BcmdPclVuZGVmaW5lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJldHVybiB0cmFuc3BpbGVOdW1BcmdGdW5jKGZ1bmNFeHByLCBudW1BcmdPclVuZGVmaW5lZCk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RyQXJnT3JVbmRlZmluZWQgPSBzdHJBcmdGdW5jcy5nZXQoZnVuY0V4cHIubmFtZSk7XG4gICAgaWYgKHN0ckFyZ09yVW5kZWZpbmVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmV0dXJuIHRyYW5zcGlsZVN0cmluZ0FyZ0Z1bmMoZnVuY0V4cHIsIHN0ckFyZ09yVW5kZWZpbmVkKTtcbiAgICB9XG5cbiAgICBzd2l0Y2ggKGZ1bmNFeHByLm5hbWUpIHtcbiAgICAgICAgLy8gYnJlYWtcbiAgICAgICAgY2FzZSBcImJyZWFrXCI6IHtcbiAgICAgICAgICAgIGlmIChmdW5jRXhwci5hcmdzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQnJlYWtBUEdMRXhwcih1bmRlZmluZWQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJhbnNwaWxlTnVtQXJnRnVuYyhcbiAgICAgICAgICAgICAgICAgICAgZnVuY0V4cHIsXG4gICAgICAgICAgICAgICAgICAgICh4KSA9PiBuZXcgQnJlYWtBUEdMRXhwcih4KSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gbWFjcm9cblxuICAgICAgICBjYXNlIFwicmVwZWF0XCI6IHtcbiAgICAgICAgICAgIGlmIChmdW5jRXhwci5hcmdzLmxlbmd0aCAhPT0gMikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcldpdGhMb2NhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgYFwicmVwZWF0XCIgdGFrZXMgdHdvIGFyZ3VtZW50cyR7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKVxuICAgICAgICAgICAgICAgICAgICB9YCxcbiAgICAgICAgICAgICAgICAgICAgZnVuY0V4cHIubG9jYXRpb24sXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IG4gPSBmdW5jRXhwci5hcmdzWzBdO1xuICAgICAgICAgICAgaWYgKCEobiBpbnN0YW5jZW9mIE51bWJlckFQR01FeHByKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcldpdGhMb2NhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgYGZpcnN0IGFyZ3VtZW50IG9mIFwicmVwZWF0XCIgbXVzdCBiZSBhIG51bWJlciR7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKVxuICAgICAgICAgICAgICAgICAgICB9YCxcbiAgICAgICAgICAgICAgICAgICAgZnVuY0V4cHIubG9jYXRpb24sXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGV4cHIgPSBmdW5jRXhwci5hcmdzWzFdO1xuICAgICAgICAgICAgY29uc3QgYXBnbCA9IHRyYW5zcGlsZUFQR01FeHByKGV4cHIpO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBTZXFBUEdMRXhwcihBcnJheShuLnZhbHVlKS5maWxsKDApLm1hcCgoKSA9PiBhcGdsKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3JXaXRoTG9jYXRpb24oXG4gICAgICAgIGBVbmtub3duIGZ1bmN0aW9uOiBcIiR7ZnVuY0V4cHIubmFtZX1cIiR7XG4gICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKVxuICAgICAgICB9YCxcbiAgICAgICAgZnVuY0V4cHIubG9jYXRpb24sXG4gICAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRyYW5zcGlsZUFQR01FeHByKGU6IEFQR01FeHByKTogQVBHTEV4cHIge1xuICAgIGNvbnN0IHQgPSB0cmFuc3BpbGVBUEdNRXhwcjtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIEZ1bmNBUEdNRXhwcikge1xuICAgICAgICByZXR1cm4gdHJhbnNwaWxlRnVuY0FQR01FeHByKGUpO1xuICAgIH0gZWxzZSBpZiAoZSBpbnN0YW5jZW9mIElmQVBHTUV4cHIpIHtcbiAgICAgICAgaWYgKGUubW9kaWZpZXIgPT09IFwiWlwiKSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IElmQVBHTEV4cHIoXG4gICAgICAgICAgICAgICAgdChlLmNvbmQpLFxuICAgICAgICAgICAgICAgIHQoZS50aGVuQm9keSksXG4gICAgICAgICAgICAgICAgZS5lbHNlQm9keSA9PT0gdW5kZWZpbmVkID8gbmV3IFNlcUFQR0xFeHByKFtdKSA6IHQoZS5lbHNlQm9keSksXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBJZkFQR0xFeHByKFxuICAgICAgICAgICAgICAgIHQoZS5jb25kKSxcbiAgICAgICAgICAgICAgICBlLmVsc2VCb2R5ID09PSB1bmRlZmluZWQgPyBuZXcgU2VxQVBHTEV4cHIoW10pIDogdChlLmVsc2VCb2R5KSxcbiAgICAgICAgICAgICAgICB0KGUudGhlbkJvZHkpLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZSBpbnN0YW5jZW9mIExvb3BBUEdNRXhwcikge1xuICAgICAgICByZXR1cm4gbmV3IExvb3BBUEdMRXhwcih0KGUuYm9keSkpO1xuICAgIH0gZWxzZSBpZiAoZSBpbnN0YW5jZW9mIE51bWJlckFQR01FeHByKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcldpdGhMb2NhdGlvbihcbiAgICAgICAgICAgIGBudW1iZXIgaXMgbm90IGFsbG93ZWQ6ICR7ZS52YWx1ZX0ke2Zvcm1hdExvY2F0aW9uQXQoZS5sb2NhdGlvbil9YCxcbiAgICAgICAgICAgIGUubG9jYXRpb24sXG4gICAgICAgICk7XG4gICAgfSBlbHNlIGlmIChlIGluc3RhbmNlb2YgU2VxQVBHTUV4cHIpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBTZXFBUEdMRXhwcihlLmV4cHJzLm1hcCgoeCkgPT4gdCh4KSkpO1xuICAgIH0gZWxzZSBpZiAoZSBpbnN0YW5jZW9mIFN0cmluZ0FQR01FeHByKSB7XG4gICAgICAgIHRocm93IEVycm9yKGBzdHJpbmcgaXMgbm90IGFsbG93ZWQ6ICR7ZS5wcmV0dHkoKX1gKTtcbiAgICB9IGVsc2UgaWYgKGUgaW5zdGFuY2VvZiBWYXJBUEdNRXhwcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3JXaXRoTG9jYXRpb24oXG4gICAgICAgICAgICBgbWFjcm8gdmFyaWFibGUgaXMgbm90IGFsbG93ZWQ6IHZhcmlhYmxlIFwiJHtlLm5hbWV9XCIke1xuICAgICAgICAgICAgICAgIGZvcm1hdExvY2F0aW9uQXQoZS5sb2NhdGlvbilcbiAgICAgICAgICAgIH1gLFxuICAgICAgICAgICAgZS5sb2NhdGlvbixcbiAgICAgICAgKTtcbiAgICB9IGVsc2UgaWYgKGUgaW5zdGFuY2VvZiBXaGlsZUFQR01FeHByKSB7XG4gICAgICAgIHJldHVybiBuZXcgV2hpbGVBUEdMRXhwcihlLm1vZGlmaWVyLCB0KGUuY29uZCksIHQoZS5ib2R5KSk7XG4gICAgfVxuXG4gICAgdGhyb3cgRXJyb3IoXCJpbnRlcm5hbCBlcnJvclwiKTtcbn1cbiIsImltcG9ydCB7XG4gICAgQWN0aW9uQVBHTEV4cHIsXG4gICAgQVBHTEV4cHIsXG4gICAgQnJlYWtBUEdMRXhwcixcbiAgICBJZkFQR0xFeHByLFxuICAgIGlzRW1wdHlFeHByLFxuICAgIExvb3BBUEdMRXhwcixcbiAgICBTZXFBUEdMRXhwcixcbiAgICBXaGlsZUFQR0xFeHByLFxufSBmcm9tIFwiLi4vYXBnbC9hc3QvbW9kLnRzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVHJhbnNwaWxlck9wdGlvbnMge1xuICAgIHByZWZpeD86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIENvbnRleHQge1xuICAgIGNvbnN0cnVjdG9yKFxuICAgICAgICAvKipcbiAgICAgICAgICogaW5wdXTjgYvjgonlp4vjgb7jgovjgrPjg57jg7Pjg4njgpLlh7rlipvjgZnjgotcbiAgICAgICAgICovXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBpbnB1dDogc3RyaW5nLFxuICAgICAgICAvKipcbiAgICAgICAgICog5Ye65Yqb54q25oWLXG4gICAgICAgICAqL1xuICAgICAgICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0OiBzdHJpbmcsXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBpbnB1dOOBruOCs+ODnuODs+ODieOBruWFpeWKm1xuICAgICAgICAgKiBa44CBTlrjga7loLTlkIjjga/mnIDliJ3jga7opoHntKDjgavliIblspDjga7jgrPjg57jg7Pjg4njgpLlh7rlipvjgZnjgovjgZPjgahcbiAgICAgICAgICovXG4gICAgICAgIHB1YmxpYyByZWFkb25seSBpbnB1dFpOWjogXCIqXCIgfCBcIlpcIiB8IFwiTlpcIixcbiAgICApIHt9XG59XG5cbnR5cGUgTGluZSA9IHN0cmluZztcblxuZXhwb3J0IGNsYXNzIFRyYW5zcGlsZXIge1xuICAgIHByaXZhdGUgaWQ6IG51bWJlciA9IDA7XG4gICAgcHJpdmF0ZSBsb29wRmluYWxTdGF0ZXM6IHN0cmluZ1tdID0gW107XG4gICAgcHJpdmF0ZSByZWFkb25seSBwcmVmaXg6IHN0cmluZztcblxuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFRyYW5zcGlsZXJPcHRpb25zID0ge30pIHtcbiAgICAgICAgdGhpcy5wcmVmaXggPSBvcHRpb25zLnByZWZpeCA/PyBcIlNUQVRFX1wiO1xuICAgIH1cblxuICAgIGdldEZyZXNoTmFtZSgpOiBzdHJpbmcge1xuICAgICAgICB0aGlzLmlkKys7XG4gICAgICAgIHJldHVybiBgJHt0aGlzLnByZWZpeH0ke3RoaXMuaWR9YDtcbiAgICB9XG5cbiAgICBlbWl0TGluZShcbiAgICAgICAgeyBjdXJyZW50U3RhdGUsIHByZXZPdXRwdXQsIG5leHRTdGF0ZSwgYWN0aW9ucyB9OiB7XG4gICAgICAgICAgICBjdXJyZW50U3RhdGU6IHN0cmluZztcbiAgICAgICAgICAgIHByZXZPdXRwdXQ6IFwiWlwiIHwgXCJOWlwiIHwgXCIqXCIgfCBcIlpaXCI7XG4gICAgICAgICAgICBuZXh0U3RhdGU6IHN0cmluZztcbiAgICAgICAgICAgIGFjdGlvbnM6IHN0cmluZ1tdO1xuICAgICAgICB9LFxuICAgICk6IExpbmVbXSB7XG4gICAgICAgIGlmIChhY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJhY3Rpb24gbXVzdCBiZSBub25lbXB0eVwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgJHtjdXJyZW50U3RhdGV9OyAke3ByZXZPdXRwdXR9OyAke25leHRTdGF0ZX07ICR7XG4gICAgICAgICAgICAgICAgYWN0aW9ucy5qb2luKFwiLCBcIilcbiAgICAgICAgICAgIH1gLFxuICAgICAgICBdO1xuICAgIH1cblxuICAgIGVtaXRUcmFuc2l0aW9uKFxuICAgICAgICBjdXJyZW50OiBzdHJpbmcsXG4gICAgICAgIG5leHQ6IHN0cmluZyxcbiAgICAgICAgaW5wdXRaTlo6IFwiKlwiIHwgXCJaXCIgfCBcIk5aXCIgPSBcIipcIixcbiAgICApOiBMaW5lW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5lbWl0TGluZSh7XG4gICAgICAgICAgICBjdXJyZW50U3RhdGU6IGN1cnJlbnQsXG4gICAgICAgICAgICBwcmV2T3V0cHV0OiBpbnB1dFpOWixcbiAgICAgICAgICAgIG5leHRTdGF0ZTogbmV4dCxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcIk5PUFwiXSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdHJhbnNwaWxlKGV4cHI6IEFQR0xFeHByKTogTGluZVtdIHtcbiAgICAgICAgY29uc3QgaW5pdGlhbFN0YXRlID0gXCJJTklUSUFMXCI7XG4gICAgICAgIGNvbnN0IHNlY29uZFN0YXRlID0gdGhpcy5nZXRGcmVzaE5hbWUoKSArIFwiX0lOSVRJQUxcIjtcbiAgICAgICAgY29uc3QgaW5pdGlhbCA9IHRoaXMuZW1pdFRyYW5zaXRpb24oaW5pdGlhbFN0YXRlLCBzZWNvbmRTdGF0ZSk7XG5cbiAgICAgICAgY29uc3QgZW5kU3RhdGUgPSB0aGlzLnByZWZpeCArIFwiRU5EXCI7XG5cbiAgICAgICAgY29uc3QgYm9keSA9IHRoaXMudHJhbnNwaWxlRXhwcihcbiAgICAgICAgICAgIG5ldyBDb250ZXh0KHNlY29uZFN0YXRlLCBlbmRTdGF0ZSwgXCIqXCIpLFxuICAgICAgICAgICAgZXhwcixcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBlbmQgPSB0aGlzLmVtaXRMaW5lKHtcbiAgICAgICAgICAgIGN1cnJlbnRTdGF0ZTogZW5kU3RhdGUsXG4gICAgICAgICAgICBwcmV2T3V0cHV0OiBcIipcIixcbiAgICAgICAgICAgIG5leHRTdGF0ZTogZW5kU3RhdGUsXG4gICAgICAgICAgICBhY3Rpb25zOiBbXCJIQUxUX09VVFwiXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIFsuLi5pbml0aWFsLCAuLi5ib2R5LCAuLi5lbmRdO1xuICAgIH1cblxuICAgIHRyYW5zcGlsZUV4cHIoY3R4OiBDb250ZXh0LCBleHByOiBBUEdMRXhwcik6IExpbmVbXSB7XG4gICAgICAgIGlmIChleHByIGluc3RhbmNlb2YgQWN0aW9uQVBHTEV4cHIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zcGlsZUFjdGlvbkFQR0xFeHByKGN0eCwgZXhwcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZXhwciBpbnN0YW5jZW9mIFNlcUFQR0xFeHByKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc3BpbGVTZXFBUEdMRXhwcihjdHgsIGV4cHIpO1xuICAgICAgICB9IGVsc2UgaWYgKGV4cHIgaW5zdGFuY2VvZiBJZkFQR0xFeHByKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc3BpbGVJZkFQR0xFeHByKGN0eCwgZXhwcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZXhwciBpbnN0YW5jZW9mIExvb3BBUEdMRXhwcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNwaWxlTG9vcEFQR0xFeHByKGN0eCwgZXhwcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZXhwciBpbnN0YW5jZW9mIFdoaWxlQVBHTEV4cHIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zcGlsZVdoaWxlQVBHTEV4cHIoY3R4LCBleHByKTtcbiAgICAgICAgfSBlbHNlIGlmIChleHByIGluc3RhbmNlb2YgQnJlYWtBUEdMRXhwcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNwaWxlQnJlYWtBUEdMRXhwcihjdHgsIGV4cHIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJ1bmtub3duIGV4cHJcIik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0cmFuc3BpbGVBY3Rpb25BUEdMRXhwcihcbiAgICAgICAgY3R4OiBDb250ZXh0LFxuICAgICAgICBhY3Rpb25FeHByOiBBY3Rpb25BUEdMRXhwcixcbiAgICApOiBMaW5lW10ge1xuICAgICAgICByZXR1cm4gdGhpcy5lbWl0TGluZSh7XG4gICAgICAgICAgICBjdXJyZW50U3RhdGU6IGN0eC5pbnB1dCxcbiAgICAgICAgICAgIHByZXZPdXRwdXQ6IGN0eC5pbnB1dFpOWixcbiAgICAgICAgICAgIG5leHRTdGF0ZTogY3R4Lm91dHB1dCxcbiAgICAgICAgICAgIGFjdGlvbnM6IGFjdGlvbkV4cHIuYWN0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgdHJhbnNwaWxlU2VxQVBHTEV4cHIoY3R4OiBDb250ZXh0LCBzZXFFeHByOiBTZXFBUEdMRXhwcik6IExpbmVbXSB7XG4gICAgICAgIC8vIGxlbmd0aCA9PT0gMFxuICAgICAgICBpZiAoaXNFbXB0eUV4cHIoc2VxRXhwcikpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmVtaXRUcmFuc2l0aW9uKGN0eC5pbnB1dCwgY3R4Lm91dHB1dCwgY3R4LmlucHV0Wk5aKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzZXFFeHByLmV4cHJzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgY29uc3QgZXhwciA9IHNlcUV4cHIuZXhwcnNbMF07XG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgICAgIGN0eCxcbiAgICAgICAgICAgICAgICBleHByLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBzZXE6IExpbmVbXSA9IFtdO1xuICAgICAgICBsZXQgc3RhdGUgPSBjdHguaW5wdXQ7XG4gICAgICAgIGZvciAoY29uc3QgW2ksIGV4cHJdIG9mIHNlcUV4cHIuZXhwcnMuZW50cmllcygpKSB7XG4gICAgICAgICAgICBpZiAoaSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG91dHB1dFN0YXRlID0gdGhpcy5nZXRGcmVzaE5hbWUoKTtcbiAgICAgICAgICAgICAgICBzZXEgPSBzZXEuY29uY2F0KHRoaXMudHJhbnNwaWxlRXhwcihcbiAgICAgICAgICAgICAgICAgICAgbmV3IENvbnRleHQoc3RhdGUsIG91dHB1dFN0YXRlLCBjdHguaW5wdXRaTlopLFxuICAgICAgICAgICAgICAgICAgICBleHByLFxuICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgICAgIHN0YXRlID0gb3V0cHV0U3RhdGU7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGkgPT09IHNlcUV4cHIuZXhwcnMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgICAgIC8vIOacgOW+jOOBr291dHB1dFxuICAgICAgICAgICAgICAgIHNlcSA9IHNlcS5jb25jYXQodGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgICAgICAgICBuZXcgQ29udGV4dChzdGF0ZSwgY3R4Lm91dHB1dCwgXCIqXCIpLFxuICAgICAgICAgICAgICAgICAgICBleHByLFxuICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zdCBvdXRwdXRTdGF0ZSA9IHRoaXMuZ2V0RnJlc2hOYW1lKCk7XG4gICAgICAgICAgICAgICAgc2VxID0gc2VxLmNvbmNhdChcbiAgICAgICAgICAgICAgICAgICAgdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgICAgICAgICAgICAgbmV3IENvbnRleHQoc3RhdGUsIG91dHB1dFN0YXRlLCBcIipcIiksXG4gICAgICAgICAgICAgICAgICAgICAgICBleHByLFxuICAgICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgc3RhdGUgPSBvdXRwdXRTdGF0ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBzZXE7XG4gICAgfVxuXG4gICAgdHJhbnNwaWxlSWZBUEdMRXhwcihjdHg6IENvbnRleHQsIGlmRXhwcjogSWZBUEdMRXhwcik6IExpbmVbXSB7XG4gICAgICAgIGlmIChpc0VtcHR5RXhwcihpZkV4cHIudGhlbkJvZHkpICYmIGlzRW1wdHlFeHByKGlmRXhwci5lbHNlQm9keSkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zcGlsZUV4cHIoY3R4LCBpZkV4cHIuY29uZCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25kRW5kU3RhdGUgPSB0aGlzLmdldEZyZXNoTmFtZSgpO1xuICAgICAgICBjb25zdCBjb25kID0gdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgbmV3IENvbnRleHQoY3R4LmlucHV0LCBjb25kRW5kU3RhdGUsIGN0eC5pbnB1dFpOWiksXG4gICAgICAgICAgICBpZkV4cHIuY29uZCxcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgW3osIC4uLnRoZW5dID0gdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgbmV3IENvbnRleHQoY29uZEVuZFN0YXRlLCBjdHgub3V0cHV0LCBcIlpcIiksXG4gICAgICAgICAgICBpZkV4cHIudGhlbkJvZHksXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IFtueiwgLi4uZWxdID0gdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgbmV3IENvbnRleHQoY29uZEVuZFN0YXRlLCBjdHgub3V0cHV0LCBcIk5aXCIpLFxuICAgICAgICAgICAgaWZFeHByLmVsc2VCb2R5LFxuICAgICAgICApO1xuXG4gICAgICAgIC8vIFrjgahOWuOCkumao+OBq+OBmeOCi1xuICAgICAgICByZXR1cm4gWy4uLmNvbmQsIHosIG56LCAuLi50aGVuLCAuLi5lbF07XG4gICAgfVxuXG4gICAgdHJhbnNwaWxlTG9vcEFQR0xFeHByKGN0eDogQ29udGV4dCwgbG9vcEV4cHI6IExvb3BBUEdMRXhwcik6IExpbmVbXSB7XG4gICAgICAgIGNvbnN0IGxvb3BTdGF0ZSA9IGN0eC5pbnB1dFpOWiA9PT0gXCIqXCJcbiAgICAgICAgICAgID8gY3R4LmlucHV0XG4gICAgICAgICAgICA6IHRoaXMuZ2V0RnJlc2hOYW1lKCk7XG4gICAgICAgIGxldCB0cmFuczogTGluZVtdID0gW107XG5cbiAgICAgICAgaWYgKGN0eC5pbnB1dFpOWiAhPT0gXCIqXCIpIHtcbiAgICAgICAgICAgIHRyYW5zID0gdHJhbnMuY29uY2F0KFxuICAgICAgICAgICAgICAgIHRoaXMuZW1pdFRyYW5zaXRpb24oY3R4LmlucHV0LCBsb29wU3RhdGUsIGN0eC5pbnB1dFpOWiksXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb29wRmluYWxTdGF0ZXMucHVzaChjdHgub3V0cHV0KTtcblxuICAgICAgICBjb25zdCBib2R5ID0gdGhpcy50cmFuc3BpbGVFeHByKFxuICAgICAgICAgICAgbmV3IENvbnRleHQobG9vcFN0YXRlLCBsb29wU3RhdGUsIFwiKlwiKSxcbiAgICAgICAgICAgIGxvb3BFeHByLmJvZHksXG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5sb29wRmluYWxTdGF0ZXMucG9wKCk7XG5cbiAgICAgICAgcmV0dXJuIFsuLi50cmFucywgLi4uYm9keV07XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICog5Lit6Lqr44GM56m644Gud2hpbGXjgavjgaTjgYTjgabmnIDpganljJZcbiAgICAgKi9cbiAgICB0cmFuc3BpbGVXaGlsZUFQR0xFeHByQm9keUVtcHR5KFxuICAgICAgICBjdHg6IENvbnRleHQsXG4gICAgICAgIGNvbmQ6IEFQR0xFeHByLFxuICAgICAgICBtb2RpZmllcjogXCJaXCIgfCBcIk5aXCIsXG4gICAgKTogTGluZVtdIHtcbiAgICAgICAgY29uc3QgY29uZFN0YXJ0U3RhdGUgPSBjdHguaW5wdXRaTlogPT09IFwiKlwiXG4gICAgICAgICAgICA/IGN0eC5pbnB1dFxuICAgICAgICAgICAgOiB0aGlzLmdldEZyZXNoTmFtZSgpO1xuICAgICAgICBsZXQgdHJhbnM6IExpbmVbXSA9IFtdO1xuICAgICAgICBpZiAoY3R4LmlucHV0Wk5aICE9PSBcIipcIikge1xuICAgICAgICAgICAgdHJhbnMgPSB0cmFucy5jb25jYXQoXG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0VHJhbnNpdGlvbihjdHguaW5wdXQsIGNvbmRTdGFydFN0YXRlLCBjdHguaW5wdXRaTlopLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbmRFbmRTdGF0ZSA9IHRoaXMuZ2V0RnJlc2hOYW1lKCk7XG4gICAgICAgIGNvbnN0IGNvbmRSZXMgPSB0aGlzLnRyYW5zcGlsZUV4cHIoXG4gICAgICAgICAgICBuZXcgQ29udGV4dChjb25kU3RhcnRTdGF0ZSwgY29uZEVuZFN0YXRlLCBcIipcIiksXG4gICAgICAgICAgICBjb25kLFxuICAgICAgICApO1xuXG4gICAgICAgIGNvbnN0IHpSZXMgPSB0aGlzLmVtaXRMaW5lKHtcbiAgICAgICAgICAgIGN1cnJlbnRTdGF0ZTogY29uZEVuZFN0YXRlLFxuICAgICAgICAgICAgcHJldk91dHB1dDogXCJaXCIsXG4gICAgICAgICAgICBuZXh0U3RhdGU6IG1vZGlmaWVyID09PSBcIlpcIiA/IGNvbmRTdGFydFN0YXRlIDogY3R4Lm91dHB1dCxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcIk5PUFwiXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgbnpSZXMgPSB0aGlzLmVtaXRMaW5lKHtcbiAgICAgICAgICAgIGN1cnJlbnRTdGF0ZTogY29uZEVuZFN0YXRlLFxuICAgICAgICAgICAgcHJldk91dHB1dDogXCJOWlwiLFxuICAgICAgICAgICAgbmV4dFN0YXRlOiBtb2RpZmllciA9PT0gXCJaXCIgPyBjdHgub3V0cHV0IDogY29uZFN0YXJ0U3RhdGUsXG4gICAgICAgICAgICBhY3Rpb25zOiBbXCJOT1BcIl0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBbLi4udHJhbnMsIC4uLmNvbmRSZXMsIC4uLnpSZXMsIC4uLm56UmVzXTtcbiAgICB9XG5cbiAgICB0cmFuc3BpbGVXaGlsZUFQR0xFeHByKGN0eDogQ29udGV4dCwgd2hpbGVFeHByOiBXaGlsZUFQR0xFeHByKTogTGluZVtdIHtcbiAgICAgICAgaWYgKGlzRW1wdHlFeHByKHdoaWxlRXhwci5ib2R5KSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNwaWxlV2hpbGVBUEdMRXhwckJvZHlFbXB0eShcbiAgICAgICAgICAgICAgICBjdHgsXG4gICAgICAgICAgICAgICAgd2hpbGVFeHByLmNvbmQsXG4gICAgICAgICAgICAgICAgd2hpbGVFeHByLm1vZGlmaWVyLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBjb25kOiBMaW5lW10gPSBbXTtcbiAgICAgICAgbGV0IGNvbmRTdGFydFN0YXRlID0gY3R4LmlucHV0Wk5aID09PSBcIipcIlxuICAgICAgICAgICAgPyBjdHguaW5wdXRcbiAgICAgICAgICAgIDogdGhpcy5nZXRGcmVzaE5hbWUoKTtcbiAgICAgICAgaWYgKGN0eC5pbnB1dFpOWiAhPT0gXCIqXCIpIHtcbiAgICAgICAgICAgIGNvbmQgPSBjb25kLmNvbmNhdChcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRUcmFuc2l0aW9uKGN0eC5pbnB1dCwgY29uZFN0YXJ0U3RhdGUsIGN0eC5pbnB1dFpOWiksXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29uZEVuZFN0YXRlID0gdGhpcy5nZXRGcmVzaE5hbWUoKTtcbiAgICAgICAgY29uZCA9IGNvbmQuY29uY2F0KHRoaXMudHJhbnNwaWxlRXhwcihcbiAgICAgICAgICAgIG5ldyBDb250ZXh0KGNvbmRTdGFydFN0YXRlLCBjb25kRW5kU3RhdGUsIFwiKlwiKSxcbiAgICAgICAgICAgIHdoaWxlRXhwci5jb25kLFxuICAgICAgICApKTtcblxuICAgICAgICBjb25zdCBib2R5U3RhcnRTdGF0ZSA9IHRoaXMuZ2V0RnJlc2hOYW1lKCkgKyBcIl9XSElMRV9CT0RZXCI7XG5cbiAgICAgICAgY29uc3QgelJlcyA9IHRoaXMuZW1pdExpbmUoe1xuICAgICAgICAgICAgY3VycmVudFN0YXRlOiBjb25kRW5kU3RhdGUsXG4gICAgICAgICAgICBwcmV2T3V0cHV0OiBcIlpcIixcbiAgICAgICAgICAgIG5leHRTdGF0ZTogd2hpbGVFeHByLm1vZGlmaWVyID09PSBcIlpcIiA/IGJvZHlTdGFydFN0YXRlIDogY3R4Lm91dHB1dCxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcIk5PUFwiXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgbnpSZXMgPSB0aGlzLmVtaXRMaW5lKHtcbiAgICAgICAgICAgIGN1cnJlbnRTdGF0ZTogY29uZEVuZFN0YXRlLFxuICAgICAgICAgICAgcHJldk91dHB1dDogXCJOWlwiLFxuICAgICAgICAgICAgbmV4dFN0YXRlOiB3aGlsZUV4cHIubW9kaWZpZXIgPT09IFwiWlwiID8gY3R4Lm91dHB1dCA6IGJvZHlTdGFydFN0YXRlLFxuICAgICAgICAgICAgYWN0aW9uczogW1wiTk9QXCJdLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmxvb3BGaW5hbFN0YXRlcy5wdXNoKGN0eC5vdXRwdXQpO1xuXG4gICAgICAgIGNvbnN0IGJvZHkgPSB0aGlzLnRyYW5zcGlsZUV4cHIoXG4gICAgICAgICAgICBuZXcgQ29udGV4dChib2R5U3RhcnRTdGF0ZSwgY29uZFN0YXJ0U3RhdGUsIFwiKlwiKSxcbiAgICAgICAgICAgIHdoaWxlRXhwci5ib2R5LFxuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMubG9vcEZpbmFsU3RhdGVzLnBvcCgpO1xuXG4gICAgICAgIC8vIHpSZXPjgahuelJlc+OBrzHooYxcbiAgICAgICAgcmV0dXJuIFsuLi5jb25kLCAuLi56UmVzLCAuLi5uelJlcywgLi4uYm9keV07XG4gICAgfVxuXG4gICAgdHJhbnNwaWxlQnJlYWtBUEdMRXhwcihjdHg6IENvbnRleHQsIGJyZWFrRXhwcjogQnJlYWtBUEdMRXhwcik6IExpbmVbXSB7XG4gICAgICAgIGNvbnN0IGxldmVsID0gYnJlYWtFeHByLmxldmVsID8/IDE7XG5cbiAgICAgICAgaWYgKGxldmVsIDwgMSkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJicmVhayBsZXZlbCBpcyBsZXNzIHRoYW4gMVwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGZpbmFsU3RhdGUgPVxuICAgICAgICAgICAgdGhpcy5sb29wRmluYWxTdGF0ZXNbdGhpcy5sb29wRmluYWxTdGF0ZXMubGVuZ3RoIC0gbGV2ZWxdO1xuXG4gICAgICAgIGlmIChmaW5hbFN0YXRlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGlmIChsZXZlbCA9PT0gMSkge1xuICAgICAgICAgICAgICAgIHRocm93IEVycm9yKFwiYnJlYWsgb3V0c2lkZSB3aGlsZSBvciBsb29wXCIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBFcnJvcihcbiAgICAgICAgICAgICAgICAgICAgXCJicmVhayBsZXZlbCBpcyBncmVhdGVyIHRoYW4gbnVtYmVyIG9mIG5lc3RzIG9mIHdoaWxlIG9yIGxvb3BcIixcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZW1pdFRyYW5zaXRpb24oY3R4LmlucHV0LCBmaW5hbFN0YXRlLCBjdHguaW5wdXRaTlopO1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRyYW5zcGlsZUFQR0woXG4gICAgZXhwcjogQVBHTEV4cHIsXG4gICAgb3B0aW9uczogVHJhbnNwaWxlck9wdGlvbnMgPSB7fSxcbik6IExpbmVbXSB7XG4gICAgcmV0dXJuIG5ldyBUcmFuc3BpbGVyKG9wdGlvbnMpLnRyYW5zcGlsZShleHByKTtcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBkdXBzPFQ+KGFzOiBUW10pOiBUW10ge1xuICAgIGNvbnN0IHNldDogU2V0PFQ+ID0gbmV3IFNldCgpO1xuICAgIGNvbnN0IGRzOiBUW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGEgb2YgYXMpIHtcbiAgICAgICAgaWYgKHNldC5oYXMoYSkpIHtcbiAgICAgICAgICAgIGRzLnB1c2goYSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzZXQuYWRkKGEpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBkcztcbn1cbiIsImltcG9ydCB7XG4gICAgQVBHTUV4cHIsXG4gICAgRXJyb3JXaXRoTG9jYXRpb24sXG4gICAgZm9ybWF0TG9jYXRpb25BdCxcbiAgICBGdW5jQVBHTUV4cHIsXG4gICAgTWFjcm8sXG4gICAgTWFpbixcbiAgICBWYXJBUEdNRXhwcixcbn0gZnJvbSBcIi4uL2FzdC9tb2QudHNcIjtcbmltcG9ydCB7IGR1cHMgfSBmcm9tIFwiLi9fZHVwcy50c1wiO1xuXG5mdW5jdGlvbiBhcmd1bWVudHNNZXNzYWdlKG51bTogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7bnVtfSBhcmd1bWVudCR7bnVtID09PSAxID8gXCJcIiA6IFwic1wifWA7XG59XG5cbi8qKlxuICogbWFjcm/jga5ib2R544Gr54++44KM44KL5aSJ5pWw44KS5ZG844Gz5Ye644GX44Gf5byV5pWw44Gn572u44GN5o+b44GIXG4gKi9cbmZ1bmN0aW9uIHJlcGxhY2VWYXJJbkJvYnkobWFjcm86IE1hY3JvLCBmdW5jRXhwcjogRnVuY0FQR01FeHByKTogQVBHTUV4cHIge1xuICAgIGNvbnN0IGV4cHJzID0gZnVuY0V4cHIuYXJncztcbiAgICBpZiAoZXhwcnMubGVuZ3RoICE9PSBtYWNyby5hcmdzLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3JXaXRoTG9jYXRpb24oXG4gICAgICAgICAgICBgYXJndW1lbnQgbGVuZ3RoIG1pc21hdGNoOiBcIiR7bWFjcm8ubmFtZX1cImAgK1xuICAgICAgICAgICAgICAgIGAgZXhwZWN0ICR7YXJndW1lbnRzTWVzc2FnZShtYWNyby5hcmdzLmxlbmd0aCl9IGJ1dCBnaXZlbiAke1xuICAgICAgICAgICAgICAgICAgICBhcmd1bWVudHNNZXNzYWdlKGV4cHJzLmxlbmd0aClcbiAgICAgICAgICAgICAgICB9JHtmb3JtYXRMb2NhdGlvbkF0KGZ1bmNFeHByLmxvY2F0aW9uKX1gLFxuICAgICAgICAgICAgZnVuY0V4cHIubG9jYXRpb24sXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZVRvRXhwcjogTWFwPHN0cmluZywgQVBHTUV4cHI+ID0gbmV3IE1hcChcbiAgICAgICAgbWFjcm8uYXJncy5tYXAoKGEsIGkpID0+IFthLm5hbWUsIGV4cHJzW2ldXSksXG4gICAgKTtcblxuICAgIHJldHVybiBtYWNyby5ib2R5LnRyYW5zZm9ybSgoeCkgPT4ge1xuICAgICAgICBpZiAoeCBpbnN0YW5jZW9mIFZhckFQR01FeHByKSB7XG4gICAgICAgICAgICBjb25zdCBleHByID0gbmFtZVRvRXhwci5nZXQoeC5uYW1lKTtcbiAgICAgICAgICAgIGlmIChleHByID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3JXaXRoTG9jYXRpb24oXG4gICAgICAgICAgICAgICAgICAgIGBzY29wZSBlcnJvcjogXCIke3gubmFtZX1cIiR7Zm9ybWF0TG9jYXRpb25BdCh4LmxvY2F0aW9uKX1gLFxuICAgICAgICAgICAgICAgICAgICB4LmxvY2F0aW9uLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZXhwcjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB4O1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbmV4cG9ydCBjbGFzcyBNYWNyb0V4cGFuZGVyIHtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1hY3JvTWFwOiBNYXA8c3RyaW5nLCBNYWNybz47XG4gICAgcHJpdmF0ZSBjb3VudDogbnVtYmVyID0gMDtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1heENvdW50OiBudW1iZXIgPSAxMDAwMDA7XG4gICAgcHVibGljIHJlYWRvbmx5IG1haW46IE1haW47XG4gICAgY29uc3RydWN0b3IobWFpbjogTWFpbikge1xuICAgICAgICB0aGlzLm1haW4gPSBtYWluO1xuICAgICAgICB0aGlzLm1hY3JvTWFwID0gbmV3IE1hcChtYWluLm1hY3Jvcy5tYXAoKG0pID0+IFttLm5hbWUsIG1dKSk7XG4gICAgICAgIGlmICh0aGlzLm1hY3JvTWFwLnNpemUgPCBtYWluLm1hY3Jvcy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGRzID0gZHVwcyhtYWluLm1hY3Jvcy5tYXAoKHgpID0+IHgubmFtZSkpO1xuICAgICAgICAgICAgY29uc3QgZCA9IGRzWzBdO1xuICAgICAgICAgICAgY29uc3QgbG9jYXRpb24gPSBtYWluLm1hY3Jvcy5zbGljZSgpLnJldmVyc2UoKS5maW5kKCh4KSA9PlxuICAgICAgICAgICAgICAgIHgubmFtZSA9PT0gZFxuICAgICAgICAgICAgKT8ubG9jYXRpb247XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3JXaXRoTG9jYXRpb24oXG4gICAgICAgICAgICAgICAgYFRoZXJlIGlzIGEgbWFjcm8gd2l0aCB0aGUgc2FtZSBuYW1lOiBcIiR7ZH1cImAgK1xuICAgICAgICAgICAgICAgICAgICBmb3JtYXRMb2NhdGlvbkF0KGxvY2F0aW9uKSxcbiAgICAgICAgICAgICAgICBsb2NhdGlvbixcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBleHBhbmQoKTogQVBHTUV4cHIge1xuICAgICAgICByZXR1cm4gdGhpcy5leHBhbmRFeHByKHRoaXMubWFpbi5zZXFFeHByKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV4cGFuZEV4cHIoZXhwcjogQVBHTUV4cHIpOiBBUEdNRXhwciB7XG4gICAgICAgIGlmICh0aGlzLm1heENvdW50IDwgdGhpcy5jb3VudCkge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJ0b28gbWFueSBtYWNybyBleHBhbnNpb25cIik7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5jb3VudCsrO1xuICAgICAgICByZXR1cm4gZXhwci50cmFuc2Zvcm0oKHgpID0+IHRoaXMuZXhwYW5kT25jZSh4KSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBleHBhbmRPbmNlKHg6IEFQR01FeHByKTogQVBHTUV4cHIge1xuICAgICAgICBpZiAoeCBpbnN0YW5jZW9mIEZ1bmNBUEdNRXhwcikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZXhwYW5kRnVuY0FQR01FeHByKHgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHg7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGV4cGFuZEZ1bmNBUEdNRXhwcihmdW5jRXhwcjogRnVuY0FQR01FeHByKTogQVBHTUV4cHIge1xuICAgICAgICBjb25zdCBtYWNybyA9IHRoaXMubWFjcm9NYXAuZ2V0KGZ1bmNFeHByLm5hbWUpO1xuICAgICAgICBpZiAobWFjcm8gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3QgZXhwYW5kZWQgPSByZXBsYWNlVmFySW5Cb2J5KG1hY3JvLCBmdW5jRXhwcik7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5leHBhbmRFeHByKGV4cGFuZGVkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jRXhwcjtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZChtYWluOiBNYWluKTogQVBHTUV4cHIge1xuICAgIHJldHVybiBuZXcgTWFjcm9FeHBhbmRlcihtYWluKS5leHBhbmQoKTtcbn1cbiIsImltcG9ydCB7IEFjdGlvbkFQR0xFeHByLCBBUEdMRXhwciwgU2VxQVBHTEV4cHIgfSBmcm9tIFwiLi4vYXN0L21vZC50c1wiO1xuaW1wb3J0IHsgQWN0aW9uLCBIYWx0T3V0QWN0aW9uLCBOb3BBY3Rpb24sIHBhcnNlQWN0aW9uIH0gZnJvbSBcIi4uLy4uL2RlcHMudHNcIjtcblxuLyoqXG4gKiDmnIDpganljJZcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wdGltaXplKGV4cHI6IEFQR0xFeHByKTogQVBHTEV4cHIge1xuICAgIHJldHVybiBleHByLnRyYW5zZm9ybShvcHRpbWl6ZU9uY2UpO1xufVxuXG5mdW5jdGlvbiBvcHRpbWl6ZU9uY2UoZXhwcjogQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgaWYgKGV4cHIgaW5zdGFuY2VvZiBTZXFBUEdMRXhwcikge1xuICAgICAgICByZXR1cm4gb3B0aW1pemVTZXFBUEdMRXhwcihleHByKTtcbiAgICB9XG4gICAgcmV0dXJuIGV4cHI7XG59XG5cbmZ1bmN0aW9uIG1lcmdlKFxuICAgIGFzOiByZWFkb25seSBBY3Rpb25bXSxcbiAgICBiczogcmVhZG9ubHkgQWN0aW9uW10sXG4pOiBBY3Rpb25bXSB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKGFzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gYnMuc2xpY2UoKTtcbiAgICB9XG5cbiAgICBpZiAoYnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBhcy5zbGljZSgpO1xuICAgIH1cblxuICAgIGlmIChhcy5zb21lKCh4KSA9PiB4IGluc3RhbmNlb2YgSGFsdE91dEFjdGlvbikpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAoYnMuc29tZSgoeCkgPT4geCBpbnN0YW5jZW9mIEhhbHRPdXRBY3Rpb24pKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgYXNXaXRob3V0Tk9QID0gYXMuZmlsdGVyKCh4KSA9PiAhKHggaW5zdGFuY2VvZiBOb3BBY3Rpb24pKTtcbiAgICBjb25zdCBic1dpdGhvdXROT1AgPSBicy5maWx0ZXIoKHgpID0+ICEoeCBpbnN0YW5jZW9mIE5vcEFjdGlvbikpO1xuXG4gICAgY29uc3QgYXNXaXRob3V0Tk9QTm9uUmV0dXJuID0gYXNXaXRob3V0Tk9QLmV2ZXJ5KChhKSA9PlxuICAgICAgICAhYS5kb2VzUmV0dXJuVmFsdWUoKVxuICAgICk7XG5cbiAgICBjb25zdCBic1dpdGhvdXROT1BOb25SZXR1cm4gPSBic1dpdGhvdXROT1AuZXZlcnkoKGIpID0+XG4gICAgICAgICFiLmRvZXNSZXR1cm5WYWx1ZSgpXG4gICAgKTtcblxuICAgIGlmICghYXNXaXRob3V0Tk9QTm9uUmV0dXJuICYmICFic1dpdGhvdXROT1BOb25SZXR1cm4pIHtcbiAgICAgICAgLy8g5Lih5pa544Go44KC5YCk44KS6L+U44GX44Gm44GE44KM44Gw44Oe44O844K45LiN5Y+vXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgZGlzdGluY3RDb21wb25lbnQgPSBhc1dpdGhvdXROT1AuZXZlcnkoKGEpID0+IHtcbiAgICAgICAgcmV0dXJuIGJzV2l0aG91dE5PUC5ldmVyeSgoYikgPT4ge1xuICAgICAgICAgICAgcmV0dXJuICFhLmlzU2FtZUNvbXBvbmVudChiKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpZiAoIWRpc3RpbmN0Q29tcG9uZW50KSB7XG4gICAgICAgIC8vIOWQjOOBmOOCs+ODs+ODneODvOODjeODs+ODiOOBjOOBguOCjOOBsOODnuODvOOCuOS4jeWPr1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IG1lcmdlZCA9IGFzV2l0aG91dE5PUC5jb25jYXQoYnNXaXRob3V0Tk9QKTtcbiAgICBpZiAoYXNXaXRob3V0Tk9QTm9uUmV0dXJuICYmIGJzV2l0aG91dE5PUE5vblJldHVybikge1xuICAgICAgICAvLyDkuKHmlrnjgajjgoLlgKTjgpLov5TjgZXjgarjgZHjgozjgbBOT1DjgpLov73liqBcbiAgICAgICAgbWVyZ2VkLnB1c2gobmV3IE5vcEFjdGlvbigpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbWVyZ2VkO1xufVxuXG5mdW5jdGlvbiB0b0FjdGlvbnMoYWN0aW9uRXhwcjogQWN0aW9uQVBHTEV4cHIpOiBBY3Rpb25bXSB7XG4gICAgcmV0dXJuIGFjdGlvbkV4cHIuYWN0aW9ucy5mbGF0TWFwKCh4KSA9PiB7XG4gICAgICAgIGNvbnN0IGEgPSBwYXJzZUFjdGlvbih4KTtcbiAgICAgICAgcmV0dXJuIGEgIT09IHVuZGVmaW5lZCA/IFthXSA6IFtdO1xuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBvcHRpbWl6ZVNlcUFQR0xFeHByKHNlcUV4cHI6IFNlcUFQR0xFeHByKTogU2VxQVBHTEV4cHIge1xuICAgIGNvbnN0IG5ld0V4cHJzOiBBUEdMRXhwcltdID0gW107XG5cbiAgICBsZXQgaXRlbXM6IEFjdGlvbltdID0gW107XG5cbiAgICBjb25zdCBwdXRJdGVtcyA9ICgpID0+IHtcbiAgICAgICAgaWYgKGl0ZW1zLmxlbmd0aCAhPT0gMCkge1xuICAgICAgICAgICAgbmV3RXhwcnMucHVzaChuZXcgQWN0aW9uQVBHTEV4cHIoaXRlbXMubWFwKCh4KSA9PiB4LnByZXR0eSgpKSkpO1xuICAgICAgICAgICAgaXRlbXMgPSBbXTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IGV4cHIgb2Ygc2VxRXhwci5leHBycykge1xuICAgICAgICBpZiAoZXhwciBpbnN0YW5jZW9mIEFjdGlvbkFQR0xFeHByKSB7XG4gICAgICAgICAgICBjb25zdCBhY3Rpb25zOiBBY3Rpb25bXSA9IHRvQWN0aW9ucyhleHByKTtcbiAgICAgICAgICAgIGNvbnN0IG1lcmdlZCA9IG1lcmdlKGl0ZW1zLCBhY3Rpb25zKTtcbiAgICAgICAgICAgIGlmIChtZXJnZWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHB1dEl0ZW1zKCk7XG4gICAgICAgICAgICAgICAgaXRlbXMgPSBhY3Rpb25zO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpdGVtcyA9IG1lcmdlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHB1dEl0ZW1zKCk7XG4gICAgICAgICAgICBuZXdFeHBycy5wdXNoKGV4cHIpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHB1dEl0ZW1zKCk7XG4gICAgcmV0dXJuIG5ldyBTZXFBUEdMRXhwcihuZXdFeHBycyk7XG59XG4iLCJpbXBvcnQgeyBBUEdMRXhwciwgU2VxQVBHTEV4cHIgfSBmcm9tIFwiLi4vYXN0L21vZC50c1wiO1xuXG4vKipcbiAqIOacgOmBqeWMllxuICovXG5leHBvcnQgZnVuY3Rpb24gb3B0aW1pemVTZXEoZXhwcjogQVBHTEV4cHIpOiBBUEdMRXhwciB7XG4gICAgcmV0dXJuIGV4cHIudHJhbnNmb3JtKG9wdGltaXplT25jZSk7XG59XG5cbmZ1bmN0aW9uIG9wdGltaXplT25jZShleHByOiBBUEdMRXhwcik6IEFQR0xFeHByIHtcbiAgICBpZiAoZXhwciBpbnN0YW5jZW9mIFNlcUFQR0xFeHByKSB7XG4gICAgICAgIHJldHVybiBvcHRpbWl6ZVNlcUFQR0xFeHByKGV4cHIpO1xuICAgIH1cbiAgICByZXR1cm4gZXhwcjtcbn1cblxuZnVuY3Rpb24gb3B0aW1pemVTZXFBUEdMRXhwcihzZXFFeHByOiBTZXFBUEdMRXhwcik6IFNlcUFQR0xFeHByIHtcbiAgICBsZXQgbmV3RXhwcnM6IEFQR0xFeHByW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgZXhwciBvZiBzZXFFeHByLmV4cHJzKSB7XG4gICAgICAgIGlmIChleHByIGluc3RhbmNlb2YgU2VxQVBHTEV4cHIpIHtcbiAgICAgICAgICAgIG5ld0V4cHJzID0gbmV3RXhwcnMuY29uY2F0KGV4cHIuZXhwcnMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3RXhwcnMucHVzaChleHByKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2VxQVBHTEV4cHIobmV3RXhwcnMpO1xufVxuIiwiaW1wb3J0IHsgbWFjcm9IZWFkIH0gZnJvbSBcIi4vbW9kLnRzXCI7XG5cbmludGVyZmFjZSBNYWNyb0RlY2wge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhcmdzOiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiDjg43jgrnjg4jmnKrlr77lv5xcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUNvbW1lbnQoc3JjOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCByZXMgPSBcIlwiO1xuICAgIGxldCBpc0NvbW1lbnQgPSBmYWxzZTtcbiAgICBsZXQgaSA9IDA7XG4gICAgd2hpbGUgKGkgPCBzcmMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IGMgPSBzcmNbaV07XG4gICAgICAgIGNvbnN0IGMyID0gc3JjW2kgKyAxXTtcbiAgICAgICAgaWYgKGMgPT09IFwiL1wiICYmIGMyID09PSBcIipcIikge1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICAgICAgaXNDb21tZW50ID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmIChjID09PSBcIipcIiAmJiBjMiA9PT0gXCIvXCIpIHtcbiAgICAgICAgICAgIGlzQ29tbWVudCA9IGZhbHNlO1xuICAgICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKCFpc0NvbW1lbnQpIHtcbiAgICAgICAgICAgICAgICByZXMgKz0gYztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXM7XG59XG5cbi8qKlxuICog44Ko44OH44Kj44K/6KOc5a6M55So44OR44O844K144O8XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wbGV0aW9uUGFyc2VyKHNyYzogc3RyaW5nKTogTWFjcm9EZWNsW10ge1xuICAgIGNvbnN0IGFycmF5OiBNYWNyb0RlY2xbXSA9IFtdO1xuICAgIC8vIG5vbi1ncmVlZHlcbiAgICAvLyBtb2QudHPjgajjg57jgq/jg63lkI3jga7mraPopo/ooajnj77jgpLlkIjjgo/jgZvjgovjgZPjgahcbiAgICBjb25zdCBNQUNST19ERUNMX1JFR0VYUCA9XG4gICAgICAgIC8obWFjcm9cXHMrKFthLXpBLVpfXVthLXpBLVpfMC05XSo/ISlcXHMqXFwoLio/XFwpKS9ncztcbiAgICBjb25zdCBwb3NzaWJsZU1hY3JvRGVjbHMgPSByZW1vdmVDb21tZW50KHNyYykubWF0Y2hBbGwoTUFDUk9fREVDTF9SRUdFWFApO1xuICAgIGZvciAoXG4gICAgICAgIGNvbnN0IG1hdGNoIG9mIHBvc3NpYmxlTWFjcm9EZWNsc1xuICAgICkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBtYWNyb0hlYWQoKS5wYXJzZShtYXRjaFswXSk7XG4gICAgICAgIGlmIChyZXN1bHQudHlwZSA9PT0gXCJQYXJzZU9LXCIpIHtcbiAgICAgICAgICAgIGFycmF5LnB1c2goe1xuICAgICAgICAgICAgICAgIG5hbWU6IHJlc3VsdC52YWx1ZS5uYW1lLFxuICAgICAgICAgICAgICAgIGFyZ3M6IHJlc3VsdC52YWx1ZS5hcmdzLm1hcCgoeCkgPT4geC5uYW1lKSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGFycmF5O1xufVxuIiwiaW1wb3J0IHsgcGFyc2VNYWluIH0gZnJvbSBcIi4uL2FwZ20vcGFyc2VyL21vZC50c1wiO1xuaW1wb3J0IHtcbiAgICBlbXB0eUFyZ0Z1bmNzLFxuICAgIG51bUFyZ0Z1bmNzLFxuICAgIHN0ckFyZ0Z1bmNzLFxuICAgIHRyYW5zcGlsZUFQR01FeHByLFxufSBmcm9tIFwiLi4vYXBnbV90b19hcGdsL3RyYW5zcGlsZXIudHNcIjtcblxuLy8gZm9yIGVkaXRvclxuLy8gZGVuby1mbXQtaWdub3JlXG5leHBvcnQgeyBlbXB0eUFyZ0Z1bmNzLCBudW1BcmdGdW5jcywgc3RyQXJnRnVuY3MgfVxuXG5leHBvcnQgeyBjb21wbGV0aW9uUGFyc2VyIH0gZnJvbSBcIi4uL2FwZ20vcGFyc2VyL2NvbXBsZXRpb25fcGFyc2VyLnRzXCI7XG5cbmltcG9ydCB7XG4gICAgdHJhbnNwaWxlQVBHTCxcbiAgICB0eXBlIFRyYW5zcGlsZXJPcHRpb25zLFxufSBmcm9tIFwiLi4vYXBnbF90b19hcGdzZW1ibHkvbW9kLnRzXCI7XG5pbXBvcnQgeyBleHBhbmQgfSBmcm9tIFwiLi4vYXBnbS9tYWNyby9leHBhbmRlci50c1wiO1xuaW1wb3J0IHsgb3B0aW1pemUgfSBmcm9tIFwiLi4vYXBnbC9hY3Rpb25fb3B0aW1pemVyL21vZC50c1wiO1xuaW1wb3J0IHsgb3B0aW1pemVTZXEgfSBmcm9tIFwiLi4vYXBnbC9zZXFfb3B0aW1pemVyL21vZC50c1wiO1xuXG5mdW5jdGlvbiBsb2dnZWQ8VCwgUz4oXG4gICAgZjogKF86IFQpID0+IFMsXG4gICAgeDogVCxcbiAgICBsb2dNZXNzYWdlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQsXG4pOiBTIHtcbiAgICBjb25zdCB5ID0gZih4KTtcbiAgICBpZiAobG9nTWVzc2FnZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGxvZ01lc3NhZ2UsIEpTT04uc3RyaW5naWZ5KHksIG51bGwsIFwiICBcIikpO1xuICAgIH1cblxuICAgIHJldHVybiB5O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW50ZWdyYXRpb24oXG4gICAgc3RyOiBzdHJpbmcsXG4gICAgb3B0aW9uczogVHJhbnNwaWxlck9wdGlvbnMgPSB7fSxcbiAgICBsb2cgPSBmYWxzZSxcbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcGdtID0gbG9nZ2VkKHBhcnNlTWFpbiwgc3RyLCBsb2cgPyBcImFwZ21cIiA6IHVuZGVmaW5lZCk7XG4gICAgY29uc3QgZXhwYW5kZWQgPSBsb2dnZWQoZXhwYW5kLCBhcGdtLCBsb2cgPyBcImFwZ20gZXhwYW5lZFwiIDogdW5kZWZpbmVkKTtcbiAgICBjb25zdCBhcGdsID0gbG9nZ2VkKHRyYW5zcGlsZUFQR01FeHByLCBleHBhbmRlZCwgbG9nID8gXCJhcGdsXCIgOiB1bmRlZmluZWQpO1xuICAgIGNvbnN0IHNlcU9wdGltaXplZEFQR0wgPSBsb2dnZWQoXG4gICAgICAgIG9wdGltaXplU2VxLFxuICAgICAgICBhcGdsLFxuICAgICAgICBsb2cgPyBcIm9wdGltaXplZCBhcGdsIHNlcVwiIDogdW5kZWZpbmVkLFxuICAgICk7XG4gICAgY29uc3Qgb3B0aW1pemVkQVBHTCA9IGxvZ2dlZChcbiAgICAgICAgb3B0aW1pemUsXG4gICAgICAgIHNlcU9wdGltaXplZEFQR0wsXG4gICAgICAgIGxvZyA/IFwib3B0aW1pemVkIGFwZ2wgYWN0aW9uXCIgOiB1bmRlZmluZWQsXG4gICAgKTtcbiAgICBjb25zdCBhcGdzID0gdHJhbnNwaWxlQVBHTChvcHRpbWl6ZWRBUEdMLCBvcHRpb25zKTtcblxuICAgIGNvbnN0IGNvbW1lbnQgPSBbXG4gICAgICAgIFwiIyBTdGF0ZSAgICBJbnB1dCAgICBOZXh0IHN0YXRlICAgIEFjdGlvbnNcIixcbiAgICAgICAgXCIjIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVwiLFxuICAgIF07XG4gICAgY29uc3QgaGVhZCA9IGFwZ20uaGVhZGVycy5tYXAoKHgpID0+IHgudG9TdHJpbmcoKSk7XG4gICAgcmV0dXJuIGhlYWQuY29uY2F0KGNvbW1lbnQsIGFwZ3MpO1xufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE1BQU0sTUFBTTtJQUNWLFlBQVksTUFBTSxDQUFFO1FBQ2xCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0tBQ3RCO0lBQ0QsS0FBSyxDQUFDLEtBQUssRUFBRTtRQUNYLE1BQU0sU0FBUyxHQUFHO1lBQUMsS0FBSyxFQUFFLENBQUM7WUFBRSxJQUFJLEVBQUUsQ0FBQztZQUFFLE1BQU0sRUFBRSxDQUFDO1NBQUMsQUFBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQztZQUFDLEtBQUs7WUFBRSxRQUFRLEVBQUUsU0FBUztTQUFDLENBQUMsQUFBQztRQUMxRCxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQUFBQztRQUM5QyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEtBQUssVUFBVSxFQUFFO1lBQzlCLE9BQU87Z0JBQ0wsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsS0FBSyxFQUFFLE1BQU0sQ0FBQyxLQUFLO2FBQ3BCLENBQUM7U0FDSDtRQUNELE9BQU87WUFDTCxJQUFJLEVBQUUsV0FBVztZQUNqQixRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7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
