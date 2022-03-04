// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually

class Parser {
    constructor(action){
        this.action = action;
    }
    parse(input) {
        const location2 = {
            index: 0,
            line: 1,
            column: 1
        };
        const context = new Context({
            input,
            location: location2
        });
        const result = this.skip(eof).action(context);
        if (result.type === "ActionOK") {
            return {
                type: "ParseOK",
                value: result.value
            };
        }
        return {
            type: "ParseFail",
            location: result.furthest,
            expected: result.expected
        };
    }
    tryParse(input) {
        const result = this.parse(input);
        if (result.type === "ParseOK") {
            return result.value;
        }
        const { expected , location: location2  } = result;
        const { line , column  } = location2;
        const message = `parse error at line ${line} column ${column}: expected ${expected.join(", ")}`;
        throw new Error(message);
    }
    and(parserB) {
        return new Parser((context)=>{
            const a = this.action(context);
            if (a.type === "ActionFail") {
                return a;
            }
            context = context.moveTo(a.location);
            const b = context.merge(a, parserB.action(context));
            if (b.type === "ActionOK") {
                const value = [
                    a.value,
                    b.value
                ];
                return context.merge(b, context.ok(b.location.index, value));
            }
            return b;
        });
    }
    skip(parserB) {
        return this.and(parserB).map(([a])=>a
        );
    }
    next(parserB) {
        return this.and(parserB).map(([, b])=>b
        );
    }
    or(parserB) {
        return new Parser((context)=>{
            const a = this.action(context);
            if (a.type === "ActionOK") {
                return a;
            }
            return context.merge(a, parserB.action(context));
        });
    }
    chain(fn) {
        return new Parser((context)=>{
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
        return this.chain((a)=>{
            return ok(fn(a));
        });
    }
    thru(fn) {
        return fn(this);
    }
    desc(expected) {
        return new Parser((context)=>{
            const result = this.action(context);
            if (result.type === "ActionOK") {
                return result;
            }
            return {
                type: "ActionFail",
                furthest: result.furthest,
                expected
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
        return new Parser((context)=>{
            const items = [];
            let result = this.action(context);
            if (result.type === "ActionFail") {
                return result;
            }
            while(result.type === "ActionOK" && items.length < max){
                items.push(result.value);
                if (result.location.index === context.location.index) {
                    throw new Error("infinite loop detected; don't call .repeat() with parsers that can accept zero characters");
                }
                context = context.moveTo(result.location);
                result = context.merge(result, this.action(context));
            }
            if (result.type === "ActionFail" && items.length < min) {
                return result;
            }
            return context.merge(result, context.ok(context.location.index, items));
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
            return this.map((x)=>[
                    x
                ]
            );
        }
        return this.chain((first)=>{
            return separator.next(this).repeat(min - 1, max - 1).map((rest)=>{
                return [
                    first,
                    ...rest
                ];
            });
        });
    }
    node(name) {
        return all(location, this, location).map(([start, value, end])=>{
            const type = "ParseNode";
            return {
                type,
                name,
                value,
                start,
                end
            };
        });
    }
}
function isRangeValid(min, max) {
    return min <= max && min >= 0 && max >= 0 && Number.isInteger(min) && min !== Infinity && (Number.isInteger(max) || max === Infinity);
}
const location = new Parser((context)=>{
    return context.ok(context.location.index, context.location);
});
function ok(value) {
    return new Parser((context)=>{
        return context.ok(context.location.index, value);
    });
}
function fail(expected) {
    return new Parser((context)=>{
        return context.fail(context.location.index, expected);
    });
}
const eof = new Parser((context)=>{
    if (context.location.index < context.input.length) {
        return context.fail(context.location.index, [
            "<EOF>"
        ]);
    }
    return context.ok(context.location.index, "<EOF>");
});
function text(string) {
    return new Parser((context)=>{
        const start = context.location.index;
        const end = start + string.length;
        if (context.input.slice(start, end) === string) {
            return context.ok(end, string);
        }
        return context.fail(start, [
            string
        ]);
    });
}
function match(regexp) {
    for (const flag of regexp.flags){
        switch(flag){
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
    return new Parser((context)=>{
        const start = context.location.index;
        sticky.lastIndex = start;
        const match2 = context.input.match(sticky);
        if (match2) {
            const end = start + match2[0].length;
            const string = context.input.slice(start, end);
            return context.ok(end, string);
        }
        return context.fail(start, [
            String(regexp)
        ]);
    });
}
function all(...parsers) {
    return parsers.reduce((acc, p)=>{
        return acc.chain((array)=>{
            return p.map((value)=>{
                return [
                    ...array,
                    value
                ];
            });
        });
    }, ok([]));
}
function choice(...parsers) {
    return parsers.reduce((acc, p)=>{
        return acc.or(p);
    });
}
function lazy(fn) {
    const parser = new Parser((context)=>{
        parser.action = fn().action;
        return parser.action(context);
    });
    return parser;
}
function union(a, b) {
    return [
        ...new Set([
            ...a,
            ...b
        ])
    ];
}
class Context {
    constructor(options){
        this.input = options.input;
        this.location = options.location;
    }
    moveTo(location2) {
        return new Context({
            input: this.input,
            location: location2
        });
    }
    _internal_move(index) {
        if (index === this.location.index) {
            return this.location;
        }
        const start = this.location.index;
        const end = index;
        const chunk = this.input.slice(start, end);
        let { line , column  } = this.location;
        for (const ch of chunk){
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
            column
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
                column: -1
            },
            expected: []
        };
    }
    fail(index, expected) {
        return {
            type: "ActionFail",
            furthest: this._internal_move(index),
            expected
        };
    }
    merge(a, b) {
        if (b.furthest.index > a.furthest.index) {
            return b;
        }
        const expected = b.furthest.index === a.furthest.index ? union(a.expected, b.expected) : a.expected;
        if (b.type === "ActionOK") {
            return {
                type: "ActionOK",
                location: b.location,
                value: b.value,
                furthest: a.furthest,
                expected
            };
        }
        return {
            type: "ActionFail",
            furthest: a.furthest,
            expected
        };
    }
}
const mod = function() {
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
        text
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
function prettyOp(op) {
    switch(op){
        case 0:
            return ADD_A1_STRING;
        case 1:
            return ADD_B0_STRING;
        case 2:
            return ADD_B1_STRING;
    }
}
function parseOp(op) {
    switch(op){
        case ADD_A1_STRING:
            return 0;
        case ADD_B0_STRING:
            return 1;
        case ADD_B1_STRING:
            return 2;
    }
}
class AddAction extends Action {
    constructor(op){
        super();
        this.op = op;
    }
    pretty() {
        return `ADD ${prettyOp(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [add, reg] = array;
        if (add !== "ADD") {
            return undefined;
        }
        if (reg === ADD_A1_STRING || reg === ADD_B0_STRING || reg === ADD_B1_STRING) {
            return new AddAction(parseOp(reg));
        }
        return undefined;
    }
    doesReturnValue() {
        switch(this.op){
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
    switch(op){
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
    switch(op){
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
    switch(op){
        case B2D_B2DX_STRING:
            return 4;
        case B2D_B2DY_STRING:
            return 5;
        case B2D_B2D_STRING:
            return 6;
    }
}
function prettyAxis(op) {
    switch(op){
        case 4:
            return B2D_B2DX_STRING;
        case 5:
            return B2D_B2DY_STRING;
        case 6:
            return B2D_B2D_STRING;
    }
}
class B2DAction extends Action {
    constructor(op, axis){
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
        switch(op){
            case B2D_INC_STRING:
                {
                    switch(axis){
                        case B2D_LEGACY_B2DX_STRING:
                            return new B2DAction(0, 4);
                        case B2D_LEGACY_B2DY_STRING:
                            return new B2DAction(0, 5);
                        default:
                            return undefined;
                    }
                }
            case B2D_LEGACY_TDEC_STRING:
                {
                    switch(axis){
                        case B2D_LEGACY_B2DX_STRING:
                            return new B2DAction(1, 4);
                        case B2D_LEGACY_B2DY_STRING:
                            return new B2DAction(1, 5);
                        default:
                            return undefined;
                    }
                }
            case B2D_READ_STRING:
                {
                    switch(axis){
                        case B2D_LEGACY_B2D_STRING:
                            return new B2DAction(2, 6);
                        default:
                            return undefined;
                    }
                }
            case B2D_SET_STRING:
                {
                    switch(axis){
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
        switch(this.op){
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
    switch(op){
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
    switch(op){
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
    constructor(op, regNumber){
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractBinaryRegisterNumbers() {
        return [
            this.regNumber
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
        if (op === B_INC_STRING || op === B_TDEC_STRING || op === B_READ_STRING || op === B_SET_STRING) {
            if (reg.startsWith(B_STRING)) {
                const str = reg.slice(1);
                if (/^[0-9]+$/u.test(str)) {
                    return new BRegAction(parseOp2(op), parseInt(str, 10));
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch(this.op){
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
function parseOp3(op) {
    switch(op){
        case MUL_0_STRING:
            return 0;
        case MUL_1_STRING:
            return 1;
    }
}
function prettyOp3(op) {
    switch(op){
        case 0:
            return MUL_0_STRING;
        case 1:
            return MUL_1_STRING;
    }
}
class MulAction extends Action {
    constructor(op){
        super();
        this.op = op;
    }
    pretty() {
        return `MUL ${prettyOp3(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [mul, op] = array;
        if (mul !== "MUL") {
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
    constructor(digit){
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
function prettyOp4(op) {
    switch(op){
        case 0:
            return SUB_A1_STRING;
        case 1:
            return SUB_B0_STRING;
        case 2:
            return SUB_B1_STRING;
    }
}
function parseOp4(op) {
    switch(op){
        case SUB_A1_STRING:
            return 0;
        case SUB_B0_STRING:
            return 1;
        case SUB_B1_STRING:
            return 2;
    }
}
class SubAction extends Action {
    constructor(op){
        super();
        this.op = op;
    }
    pretty() {
        return `SUB ${prettyOp4(this.op)}`;
    }
    static parse(str) {
        const array = str.trim().split(/\s+/u);
        if (array.length !== 2) {
            return undefined;
        }
        const [sub, reg] = array;
        if (sub !== "SUB") {
            return undefined;
        }
        if (reg === SUB_A1_STRING || reg === SUB_B0_STRING || reg === SUB_B1_STRING) {
            return new SubAction(parseOp4(reg));
        }
        return undefined;
    }
    doesReturnValue() {
        switch(this.op){
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
    switch(op){
        case 0:
            return U_INC_STRING;
        case 1:
            return U_TDEC_STRING;
    }
}
function parseOp5(op) {
    switch(op){
        case U_INC_STRING:
            return 0;
        case U_TDEC_STRING:
            return 1;
    }
}
class URegAction extends Action {
    constructor(op, regNumber){
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractUnaryRegisterNumbers() {
        return [
            this.regNumber
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
                const str = reg.slice(1);
                if (/^[0-9]+$/u.test(str)) {
                    return new URegAction(parseOp5(op), parseInt(str, 10));
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch(this.op){
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
    switch(op){
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
    switch(op){
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
    constructor(op, regNumber){
        super();
        this.op = op;
        this.regNumber = regNumber;
    }
    extractLegacyTRegisterNumbers() {
        return [
            this.regNumber
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
        if (op === T_INC_STRING || op === T_DEC_STRING || op === T_READ_STRING || op === T_SET_STRING || op === T_RESET_STRING) {
            if (reg.startsWith("T")) {
                const str = reg.slice(1);
                if (/^[0-9]+$/u.test(str)) {
                    return new LegacyTRegAction(parseOp6(op), parseInt(str, 10));
                }
            }
        }
        return undefined;
    }
    doesReturnValue() {
        switch(this.op){
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
const HALT_OUT_STRING = `HALT_OUT`;
class HaltOutAction extends Action {
    constructor(){
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
    if (command.actions.find((x)=>x instanceof HaltOutAction
    ) !== undefined) {
        return undefined;
    }
    const valueReturnActions = command.actions.filter((x)=>x.doesReturnValue()
    );
    if (valueReturnActions.length === 1) {
        return undefined;
    } else if (valueReturnActions.length === 0) {
        return `Does not produce the return value in "${command.pretty()}"`;
    } else {
        return `Does not contain exactly one action that produces a return value in "${command.pretty()}": Actions that produce value are ${valueReturnActions.map((x)=>`"${x.pretty()}"`
        ).join(', ')}`;
    }
}
function validateActionReturnOnce(commands) {
    const errors = [];
    for (const command of commands){
        const err = validateActionReturnOnceCommand(command);
        if (typeof err === 'string') {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
class NopAction extends Action {
    constructor(){
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
        AddAction.parse,
        MulAction.parse,
        SubAction.parse,
        NopAction.parse,
        OutputAction.parse,
        HaltOutAction.parse,
        LegacyTRegAction.parse, 
    ];
    for (const parser of parsers){
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
    constructor(content){
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
    constructor(content){
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
    constructor(str){
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
    constructor(){
        super();
    }
    pretty() {
        return "";
    }
}
function parseInput(inputStr) {
    switch(inputStr){
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
    constructor({ state , input , nextState , actions  }){
        super();
        this.state = state;
        this.input = input;
        this.nextState = nextState;
        this.actions = actions;
        this._string = `${this.state}; ${this.input}; ${this.nextState}; ${this.actions.map((a)=>a.pretty()
        ).join(", ")}`;
    }
    static parse(str) {
        if (typeof str !== 'string') {
            throw TypeError('str is not a string');
        }
        const trimmedStr = str.trim();
        if (trimmedStr === "") {
            return new EmptyLine();
        }
        if (trimmedStr.startsWith("#")) {
            if (trimmedStr.startsWith(ComponentsHeader.key)) {
                return new ComponentsHeader(trimmedStr.slice(ComponentsHeader.key.length).trim());
            } else if (trimmedStr.startsWith(RegistersHeader.key)) {
                return new RegistersHeader(trimmedStr.slice(RegistersHeader.key.length).trim());
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
        const actionStrs = actionsStr.trim().split(/\s*,\s*/u).filter((x)=>x !== ""
        );
        const actions = [];
        for (const actionsStr1 of actionStrs){
            const result = parseAction(actionsStr1);
            if (result === undefined) {
                return `Unknown action "${actionsStr1}" at "${str}"`;
            }
            actions.push(result);
        }
        const input = parseInput(inputStr);
        if (input === undefined) {
            return `Unknown input "${inputStr}" at "${str}"`;
        }
        return new Command({
            state: state,
            input: input,
            nextState: nextState,
            actions: actions
        });
    }
    static error() {
        throw Error('internal error');
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
    for (const command of commands){
        const err = validateNextStateIsNotINITIALCommand(command);
        if (typeof err === 'string') {
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
    const actionStrs = command.actions.map((x)=>x.pretty()
    );
    actionStrs.sort();
    for(let i = 0; i < actionStrs.length - 1; i++){
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
    for (const command of commands){
        const err = validateNoDuplicatedActionCommand(command);
        if (typeof err === 'string') {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
function internalError() {
    throw Error('internal error');
}
function validateNoSameComponentCommand(command) {
    if (command.actions.find((x)=>x instanceof HaltOutAction
    ) !== undefined) {
        return undefined;
    }
    const actions = command.actions;
    const len = actions.length;
    if (len <= 1) {
        return undefined;
    }
    for(let i = 0; i < len; i++){
        for(let j = i + 1; j < len; j++){
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
    for (const command of commands){
        const err = validateNoSameComponentCommand(command);
        if (typeof err === 'string') {
            errors.push(err);
        }
    }
    if (errors.length > 0) {
        return errors;
    }
    return undefined;
}
function internalError1() {
    throw Error('internal error');
}
function validateZAndNZ(commands) {
    const errMsg = (line)=>`Need Z line followed by NZ line at "${line.pretty()}"`
    ;
    for(let i = 0; i < commands.length - 1; i++){
        const a = commands[i] ?? internalError1();
        const b = commands[i + 1] ?? internalError1();
        if (a.input === "Z" && b.input !== 'NZ') {
            return [
                errMsg(a)
            ];
        }
        if (b.input === "NZ" && a.input !== 'Z') {
            return [
                errMsg(b)
            ];
        }
        if (a.input === "Z" && b.input === "NZ" && a.state !== b.state) {
            return [
                errMsg(a)
            ];
        }
    }
    const lastLine = commands[commands.length - 1];
    if (lastLine !== undefined) {
        if (lastLine.input === 'Z') {
            return [
                errMsg(lastLine)
            ];
        }
    }
    return undefined;
}
class ProgramLines {
    constructor(array){
        this.array = array;
    }
    getArray() {
        return this.array;
    }
    pretty() {
        return this.getArray().map((line)=>line.pretty()
        ).join('\n');
    }
    static parse(str) {
        const lines = str.split(/\r\n|\n|\r/u);
        const programLineWithErrorArray = lines.map((line)=>Command.parse(line)
        );
        const errors = programLineWithErrorArray.flatMap((x)=>typeof x === 'string' ? [
                x
            ] : []
        );
        if (errors.length > 0) {
            return errors.join('\n');
        }
        const programLines = programLineWithErrorArray.flatMap((x)=>typeof x !== 'string' ? [
                x
            ] : []
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
        validateZAndNZ
    ];
    let errors = [];
    for (const validator of validators){
        const errorsOrUndefined = validator(commands);
        if (Array.isArray(errorsOrUndefined)) {
            errors = errors.concat(errorsOrUndefined);
        }
    }
    if (errors.length > 0) {
        return errors.join('\n');
    }
    return undefined;
}
class Program {
    constructor({ commands , componentsHeader , registersHeader , programLines ,  }){
        this.commands = commands;
        this.componentsHeader = componentsHeader;
        this.registersHeader = registersHeader;
        this.programLines = programLines;
    }
    static parse(str) {
        const programLines = ProgramLines.parse(str);
        if (typeof programLines === 'string') {
            return programLines;
        }
        const commands = [];
        let registersHeader = undefined;
        let componentsHeader = undefined;
        for (const programLine of programLines.getArray()){
            if (programLine instanceof Command) {
                commands.push(programLine);
            } else if (programLine instanceof ComponentsHeader) {
                if (componentsHeader !== undefined) {
                    return `Multiple ${ComponentsHeader.key}`;
                }
                componentsHeader = programLine;
            } else if (programLine instanceof RegistersHeader) {
                if (registersHeader !== undefined) {
                    return `Multiple ${RegistersHeader.key}`;
                }
                registersHeader = programLine;
            }
        }
        if (commands.length === 0) {
            return 'Program is empty';
        }
        const errorOrUndefined = validateAll(commands);
        if (typeof errorOrUndefined === 'string') {
            return errorOrUndefined;
        }
        return new Program({
            commands: commands,
            registersHeader: registersHeader,
            componentsHeader: componentsHeader,
            programLines: programLines
        });
    }
    reconstructProgramLines() {
        return new Program({
            commands: this.commands,
            componentsHeader: this.componentsHeader,
            registersHeader: this.registersHeader,
            programLines: new ProgramLines(this.commands.slice())
        });
    }
    _actions() {
        return this.commands.flatMap((command)=>command.actions
        );
    }
    extractUnaryRegisterNumbers() {
        return sortNub(this._actions().flatMap((a)=>a.extractUnaryRegisterNumbers()
        ));
    }
    extractBinaryRegisterNumbers() {
        return sortNub(this._actions().flatMap((a)=>a.extractBinaryRegisterNumbers()
        ));
    }
    extractLegacyTRegisterNumbers() {
        return sortNub(this._actions().flatMap((a)=>a.extractLegacyTRegisterNumbers()
        ));
    }
    pretty() {
        if (this.commands.length >= 1 && this.programLines.getArray().length === 0) {
            let str = "";
            if (this.componentsHeader !== undefined) {
                str += this.componentsHeader.pretty() + "\n";
            }
            if (this.registersHeader !== undefined) {
                str += this.registersHeader.pretty() + "\n";
            }
            str += this.commands.map((command)=>command.pretty()
            ).join('\n');
            return str.trim();
        } else {
            return this.programLines.pretty();
        }
    }
}
function sortNub(array) {
    return [
        ...new Set(array)
    ].sort((a, b)=>a - b
    );
}
const decimalNaturalParser = mod.match(/[0-9]+/).desc([
    "number"
]).map((x)=>parseInt(x, 10)
);
const hexadecimalNaturalParser = mod.match(/0x[0-9]+/).desc([
    "hexadecimal number", 
]).map((x)=>parseInt(x, 16)
);
const naturalNumberParser = hexadecimalNaturalParser.or(decimalNaturalParser).desc([
    "number"
]);
function prettyError(fail1, source) {
    const lines = source.split(/\n|\r\n/);
    const above = lines[fail1.location.line - 2];
    const errorLine = lines[fail1.location.line - 1];
    const below = lines[fail1.location.line];
    const arrowLine = " ".repeat(Math.max(0, fail1.location.column - 1)) + "^";
    const errorLines = [
        ...above === undefined ? [] : [
            above
        ],
        errorLine,
        arrowLine,
        ...below === undefined ? [] : [
            below
        ], 
    ].map((x)=>"| " + x
    );
    return [
        `parse error at line ${fail1.location.line} column ${fail1.location.column}:`,
        `  expected ${fail1.expected.join(", ")}`,
        ``,
        ...errorLines, 
    ].join("\n");
}
function parsePretty(parser, source) {
    const res = parser.parse(source);
    if (res.type === "ParseOK") {
        return res.value;
    }
    throw Error(prettyError(res, source));
}
class APGMExpr {
    constructor(){}
}
function formatLocationAt(location1) {
    if (location1 !== undefined) {
        return ` at line ${location1.line} column ${location1.column}`;
    } else {
        return "";
    }
}
class FuncAPGMExpr extends APGMExpr {
    name;
    args;
    location;
    constructor(name, args, location2){
        super();
        this.name = name;
        this.args = args;
        this.location = location2;
    }
    transform(f) {
        return f(new FuncAPGMExpr(this.name, this.args.map((x)=>x.transform(f)
        ), this.location));
    }
    pretty() {
        return `${this.name}(${this.args.map((x)=>x.pretty()
        ).join(", ")})`;
    }
}
class IfAPGMExpr extends APGMExpr {
    modifier;
    cond;
    thenBody;
    elseBody;
    constructor(modifier, cond, thenBody, elseBody){
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.thenBody = thenBody;
        this.elseBody = elseBody;
    }
    transform(f) {
        return f(new IfAPGMExpr(this.modifier, this.cond.transform(f), this.thenBody.transform(f), this.elseBody !== undefined ? this.elseBody.transform(f) : undefined));
    }
    pretty() {
        return `if_${this.modifier === "Z" ? "z" : "nz"}(${this.cond.pretty()}) ${this.thenBody.pretty()}` + this.elseBody === undefined ? `` : ` else ${this.elseBody?.pretty()}`;
    }
}
class LoopAPGMExpr extends APGMExpr {
    body;
    constructor(body){
        super();
        this.body = body;
    }
    transform(f) {
        return f(new LoopAPGMExpr(this.body.transform(f)));
    }
    pretty() {
        return `loop ${this.body.pretty()}`;
    }
}
class Macro {
    name;
    args;
    body;
    location;
    constructor(name, args, body, location3){
        this.name = name;
        this.args = args;
        this.body = body;
        this.location = location3;
    }
}
class Main {
    macros;
    headers;
    seqExpr;
    constructor(macros, headers1, seqExpr){
        this.macros = macros;
        this.headers = headers1;
        this.seqExpr = seqExpr;
        if (macros.length >= 1) {
            if (!(macros[0] instanceof Macro)) {
                throw TypeError("internal error");
            }
        }
    }
}
class Header {
    name;
    content;
    constructor(name, content){
        this.name = name;
        this.content = content;
    }
    toString() {
        const space = this.content.startsWith(" ") ? "" : " ";
        return `#${this.name}${space}${this.content}`;
    }
}
class NumberAPGMExpr extends APGMExpr {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return this.value.toString();
    }
}
class StringAPGMExpr extends APGMExpr {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return this.value;
    }
}
class SeqAPGMExpr extends APGMExpr {
    exprs;
    constructor(exprs){
        super();
        this.exprs = exprs;
    }
    transform(f) {
        return f(new SeqAPGMExpr(this.exprs.map((x)=>x.transform(f)
        )));
    }
    pretty() {
        return `{${this.exprs.map((x)=>x.pretty() + "; "
        ).join("")}}`;
    }
}
class VarAPGMExpr extends APGMExpr {
    name;
    location;
    constructor(name, location4){
        super();
        this.name = name;
        this.location = location4;
    }
    transform(f) {
        return f(this);
    }
    pretty() {
        return this.name;
    }
}
class WhileAPGMExpr extends APGMExpr {
    modifier;
    cond;
    body;
    constructor(modifier, cond, body){
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.body = body;
    }
    transform(f) {
        return f(new WhileAPGMExpr(this.modifier, this.cond.transform(f), this.body.transform(f)));
    }
    pretty() {
        return `while_${this.modifier === "Z" ? "z" : "nz"}(${this.cond.pretty()}) ${this.body.pretty()}`;
    }
}
const comment = mod.match(/\/\*(\*(?!\/)|[^*])*\*\//s).desc([]);
const _ = mod.match(/\s*/).desc([
    "space"
]).sepBy(comment).map(()=>undefined
);
const someSpaces = mod.match(/\s+/).desc([
    "space"
]);
const identifierRexExp = /[a-zA-Z_][a-zA-Z_0-9]*/u;
const identifierOnly = mod.match(identifierRexExp).desc([
    "identifier"
]);
const identifier = _.next(identifierOnly).skip(_);
const identifierWithLocation = _.chain(()=>{
    return mod.location.chain((loc)=>{
        return identifierOnly.skip(_).map((ident)=>{
            return [
                ident,
                loc
            ];
        });
    });
});
const macroIdentifierRegExp = /[a-zA-Z_][a-zA-Z_0-9]*!/u;
const macroIdentifier = _.next(mod.match(macroIdentifierRegExp)).skip(_).desc([
    "macro name"
]);
function token(s) {
    return _.next(mod.text(s)).skip(_);
}
const comma = token(",").desc([
    "`,`"
]);
const leftParen = token("(").desc([
    "`(`"
]);
const rightParen = token(")").desc([
    "`)`"
]);
const semicolon = token(";").desc([
    "`;`"
]);
const curlyLeft = token("{").desc([
    "`{`"
]);
const curlyRight = token("}").desc([
    "`}`"
]);
const varAPGMExpr = identifierWithLocation.map((x)=>new VarAPGMExpr(x[0], x[1])
);
function funcAPGMExpr() {
    return _.next(mod.location).chain((location5)=>{
        return mod.choice(macroIdentifier, identifier).chain((ident)=>{
            return mod.lazy(()=>apgmExpr()
            ).sepBy(comma).wrap(leftParen, rightParen).map((args)=>{
                return new FuncAPGMExpr(ident, args, location5);
            });
        });
    });
}
const numberAPGMExpr = _.next(naturalNumberParser.map((x)=>new NumberAPGMExpr(x)
)).skip(_);
const stringLit = _.next(mod.text(`"`)).next(mod.match(/[^"]*/)).skip(mod.text(`"`)).skip(_).desc([
    "string"
]);
const stringAPGMExpr = stringLit.map((x)=>new StringAPGMExpr(x)
);
function seqAPGMExprRaw() {
    return mod.lazy(()=>statement()
    ).repeat();
}
function seqAPGMExpr() {
    return seqAPGMExprRaw().wrap(curlyLeft, curlyRight).map((x)=>new SeqAPGMExpr(x)
    );
}
const whileKeyword = mod.choice(token("while_z"), token("while_nz")).map((x)=>x === "while_z" ? "Z" : "NZ"
);
const exprWithParen = mod.lazy(()=>apgmExpr()
).wrap(leftParen, rightParen);
function whileAPGMExpr() {
    return whileKeyword.chain((mod1)=>{
        return exprWithParen.chain((cond)=>{
            return mod.lazy(()=>apgmExpr()
            ).map((body)=>new WhileAPGMExpr(mod1, cond, body)
            );
        });
    });
}
function loopAPGMExpr() {
    return token("loop").next(mod.lazy(()=>apgmExpr()
    )).map((x)=>new LoopAPGMExpr(x)
    );
}
const ifKeyword = mod.choice(token("if_z"), token("if_nz")).map((x)=>x === "if_z" ? "Z" : "NZ"
);
function ifAPGMExpr() {
    return ifKeyword.chain((mod2)=>{
        return exprWithParen.chain((cond)=>{
            return mod.lazy(()=>apgmExpr()
            ).chain((body)=>{
                return mod.choice(token("else").next(mod.lazy(()=>apgmExpr()
                )), mod.ok(undefined)).map((elseBody)=>{
                    return new IfAPGMExpr(mod2, cond, body, elseBody);
                });
            });
        });
    });
}
function macro() {
    const macroKeyword = _.chain((_)=>{
        return mod.location.chain((location6)=>{
            return mod.text("macro").next(someSpaces).map((_)=>location6
            );
        });
    });
    return macroKeyword.chain((location7)=>{
        return macroIdentifier.chain((ident)=>{
            return varAPGMExpr.sepBy(comma).wrap(leftParen, rightParen).chain((args)=>{
                return mod.lazy(()=>apgmExpr()
                ).map((body)=>{
                    return new Macro(ident, args, body, location7);
                });
            });
        });
    });
}
const header = mod.text("#").next(mod.match(/REGISTERS|COMPONENTS/)).desc([
    "#REGISTERS",
    "#COMPONENT"
]).chain((x)=>mod.match(/.*/).map((c)=>new Header(x, c)
    )
);
const headers = _.next(header).skip(_).repeat();
function main() {
    return macro().repeat().chain((macros)=>{
        return headers.chain((h)=>{
            return _.next(seqAPGMExprRaw()).skip(_).map((x)=>{
                return new Main(macros, h, new SeqAPGMExpr(x));
            });
        });
    });
}
function parseMain(str) {
    return parsePretty(main(), str);
}
function apgmExpr() {
    return mod.choice(loopAPGMExpr(), whileAPGMExpr(), ifAPGMExpr(), funcAPGMExpr(), seqAPGMExpr(), varAPGMExpr, numberAPGMExpr, stringAPGMExpr);
}
function statement() {
    return mod.choice(loopAPGMExpr(), whileAPGMExpr(), ifAPGMExpr(), apgmExpr().skip(semicolon));
}
class APGLExpr {
    constructor(){}
}
class ActionAPGLExpr extends APGLExpr {
    actions;
    constructor(actions){
        super();
        this.actions = actions;
    }
    transform(f) {
        return f(this);
    }
}
class SeqAPGLExpr extends APGLExpr {
    exprs;
    constructor(exprs){
        super();
        this.exprs = exprs;
    }
    transform(f) {
        return f(new SeqAPGLExpr(this.exprs.map((x)=>x.transform(f)
        )));
    }
}
class IfAPGLExpr extends APGLExpr {
    cond;
    thenBody;
    elseBody;
    constructor(cond, thenBody, elseBody){
        super();
        this.cond = cond;
        this.thenBody = thenBody;
        this.elseBody = elseBody;
    }
    transform(f) {
        return f(new IfAPGLExpr(this.cond.transform(f), this.thenBody.transform(f), this.elseBody.transform(f)));
    }
}
class LoopAPGLExpr extends APGLExpr {
    body;
    kind = "loop";
    constructor(body){
        super();
        this.body = body;
    }
    transform(f) {
        return f(new LoopAPGLExpr(this.body.transform(f)));
    }
}
class WhileAPGLExpr extends APGLExpr {
    modifier;
    cond;
    body;
    constructor(modifier, cond, body){
        super();
        this.modifier = modifier;
        this.cond = cond;
        this.body = body;
    }
    transform(f) {
        return f(new WhileAPGLExpr(this.modifier, this.cond.transform(f), this.body.transform(f)));
    }
}
class BreakAPGLExpr extends APGLExpr {
    level;
    kind = "break";
    constructor(level){
        super();
        this.level = level;
        if (level !== undefined && level < 1) {
            throw Error("break level is less than 1");
        }
    }
    transform(f) {
        return f(this);
    }
}
class A {
    static incU(n) {
        return A.nonReturn(`INC U${n}`);
    }
    static incUMulti(...args) {
        return new ActionAPGLExpr([
            ...args.map((x)=>`INC U${x}`
            ),
            "NOP"
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
            "NOP"
        ]);
    }
    static single(act) {
        return new ActionAPGLExpr([
            act
        ]);
    }
}
function transpileEmptyArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 0) {
        throw Error(`argument given to "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
    }
    return expr;
}
function transpileNumArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 1) {
        throw Error(`number of arguments is not 1: "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
    }
    const arg = funcExpr.args[0];
    if (!(arg instanceof NumberAPGMExpr)) {
        throw Error(`argument is not a number: "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
    }
    return expr(arg.value);
}
function transpileStringArgFunc(funcExpr, expr) {
    if (funcExpr.args.length !== 1) {
        throw Error(`number of arguments is not 1: "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
    }
    const arg = funcExpr.args[0];
    if (!(arg instanceof StringAPGMExpr)) {
        throw Error(`argument is not a string: "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
    }
    return expr(arg.value);
}
function transpileFuncAPGMExpr(funcExpr) {
    const e = (a)=>transpileEmptyArgFunc(funcExpr, a)
    ;
    const n = (a)=>transpileNumArgFunc(funcExpr, a)
    ;
    const s = (a)=>transpileStringArgFunc(funcExpr, a)
    ;
    switch(funcExpr.name){
        case "inc_u":
            return n((x)=>A.incU(x)
            );
        case "tdec_u":
            return n((x)=>A.tdecU(x)
            );
        case "inc_b":
            return n((x)=>A.incB(x)
            );
        case "tdec_b":
            return n((x)=>A.tdecB(x)
            );
        case "read_b":
            return n((x)=>A.readB(x)
            );
        case "set_b":
            return n((x)=>A.setB(x)
            );
        case "inc_b2dx":
            return e(A.incB2DX());
        case "inc_b2dy":
            return e(A.incB2DY());
        case "tdec_b2dx":
            return e(A.tdecB2DX());
        case "tdec_b2dy":
            return e(A.tdecB2DY());
        case "read_b2d":
            return e(A.readB2D());
        case "set_b2d":
            return e(A.setB2D());
        case "add_a1":
            return e(A.addA1());
        case "add_b0":
            return e(A.addB0());
        case "add_b1":
            return e(A.addB1());
        case "sub_a1":
            return e(A.subA1());
        case "sub_b0":
            return e(A.subB0());
        case "sub_b1":
            return e(A.subB1());
        case "mul_0":
            return e(A.mul0());
        case "mul_1":
            return e(A.mul1());
        case "nop":
            return e(A.nop());
        case "halt_out":
            return e(A.haltOUT());
        case "output":
            return s((x)=>A.output(x)
            );
        case "break":
            {
                if (funcExpr.args.length === 0) {
                    return e(new BreakAPGLExpr(undefined));
                } else {
                    return n((x)=>new BreakAPGLExpr(x)
                    );
                }
            }
        case "repeat":
            {
                if (funcExpr.args.length !== 2) {
                    throw Error(`"repeat" takes two arguments${formatLocationAt(funcExpr.location)}`);
                }
                const n = funcExpr.args[0];
                if (!(n instanceof NumberAPGMExpr)) {
                    throw Error(`first argument of "repeat" must be a number${formatLocationAt(funcExpr.location)}`);
                }
                const expr = funcExpr.args[1];
                const apgl = transpileAPGMExpr(expr);
                return new SeqAPGLExpr(Array(n.value).fill(0).map(()=>apgl
                ));
            }
    }
    throw Error(`Unknown function: "${funcExpr.name}"${formatLocationAt(funcExpr.location)}`);
}
function transpileAPGMExpr(e) {
    const t = transpileAPGMExpr;
    if (e instanceof FuncAPGMExpr) {
        return transpileFuncAPGMExpr(e);
    } else if (e instanceof IfAPGMExpr) {
        if (e.modifier === "Z") {
            return new IfAPGLExpr(t(e.cond), t(e.thenBody), e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody));
        } else {
            return new IfAPGLExpr(t(e.cond), e.elseBody === undefined ? new SeqAPGLExpr([]) : t(e.elseBody), t(e.thenBody));
        }
    } else if (e instanceof LoopAPGMExpr) {
        return new LoopAPGLExpr(t(e.body));
    } else if (e instanceof NumberAPGMExpr) {
        throw Error(`number is not allowed: ${e.value}`);
    } else if (e instanceof SeqAPGMExpr) {
        return new SeqAPGLExpr(e.exprs.map((x)=>t(x)
        ));
    } else if (e instanceof StringAPGMExpr) {
        throw Error(`string is not allowed: ${e.value}`);
    } else if (e instanceof VarAPGMExpr) {
        throw Error(`macro variable is not allowed: variable "${e.name}"${formatLocationAt(e.location)}`);
    } else if (e instanceof WhileAPGMExpr) {
        return new WhileAPGLExpr(e.modifier, t(e.cond), t(e.body));
    }
    throw Error("internal error");
}
function isEmptyExpr(expr) {
    return expr instanceof SeqAPGLExpr && expr.exprs.length === 0;
}
class Context1 {
    input;
    output;
    constructor(input, output){
        this.input = input;
        this.output = output;
    }
}
class Transpiler {
    lines = [];
    id = 0;
    loopFinalStates = [];
    prefix;
    constructor(options = {}){
        this.prefix = options.prefix ?? "STATE_";
    }
    getFreshName() {
        this.id++;
        return `${this.prefix}${this.id}`;
    }
    emitLine({ currentState , prevOutput , nextState , actions  }) {
        if (actions.length === 0) {
            throw Error("action must be nonempty");
        }
        this.lines.push(`${currentState}; ${prevOutput}; ${nextState}; ${actions.join(", ")}`);
    }
    emitTransition(current, next) {
        this.emitLine({
            currentState: current,
            prevOutput: "*",
            nextState: next,
            actions: [
                "NOP"
            ]
        });
    }
    transpile(expr) {
        const initialState = "INITIAL";
        const secondState = this.getFreshName() + "_INITIAL";
        this.emitTransition(initialState, secondState);
        const maybeEndState = this.prefix + "END";
        const endState = this.transpileExpr(new Context1(secondState, maybeEndState), expr);
        this.emitLine({
            currentState: endState,
            prevOutput: "*",
            nextState: endState,
            actions: [
                "HALT_OUT"
            ]
        });
        return this.lines;
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
        }
        throw Error("error");
    }
    transpileActionAPGLExpr(ctx, actionExpr) {
        const nextState = ctx.output ?? this.getFreshName();
        this.emitLine({
            currentState: ctx.input,
            prevOutput: "*",
            nextState: nextState,
            actions: actionExpr.actions
        });
        return nextState;
    }
    transpileSeqAPGLExpr(ctx, seqExpr) {
        if (seqExpr.exprs.length === 0) {
            if (ctx.output !== undefined) {
                if (ctx.output !== ctx.input) {
                    this.emitTransition(ctx.input, ctx.output);
                }
                return ctx.output;
            } else {
                return ctx.input;
            }
        }
        let state = ctx.input;
        for (const [i, expr] of seqExpr.exprs.entries()){
            if (ctx.output && i === seqExpr.exprs.length - 1) {
                state = this.transpileExpr(new Context1(state, ctx.output), expr);
            } else {
                state = this.transpileExpr(new Context1(state), expr);
            }
        }
        return state;
    }
    transpileIfAPGLExpr(ctx, ifExpr) {
        if (isEmptyExpr(ifExpr.elseBody)) {
            return this.transpileIfAPGLExprOnlyZ(ctx, ifExpr.cond, ifExpr.thenBody);
        }
        if (isEmptyExpr(ifExpr.thenBody)) {
            return this.transpileIfAPGLExprOnlyNZ(ctx, ifExpr.cond, ifExpr.elseBody);
        }
        const condEndState = this.transpileExpr(new Context1(ctx.input), ifExpr.cond);
        const thenStartState = this.getFreshName() + "_IF_Z";
        const elseStartState = this.getFreshName() + "_IF_NZ";
        this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: thenStartState,
            actions: [
                "NOP"
            ]
        });
        this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: elseStartState,
            actions: [
                "NOP"
            ]
        });
        const thenEndState = this.transpileExpr(new Context1(thenStartState, ctx.output), ifExpr.thenBody);
        const elseEndState = this.transpileExpr(new Context1(elseStartState, ctx.output), ifExpr.elseBody);
        if (thenEndState !== elseEndState) {
            this.emitTransition(thenEndState, elseEndState);
        }
        return elseEndState;
    }
    transpileIfAPGLExprOnlyZ(ctx, cond, body) {
        const condEndState = this.transpileExpr(new Context1(ctx.input), cond);
        const thenStartState = this.getFreshName() + "_IF_Z";
        const endState = this.transpileExpr(new Context1(thenStartState, ctx.output), body);
        this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: thenStartState,
            actions: [
                "NOP"
            ]
        });
        this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: endState,
            actions: [
                "NOP"
            ]
        });
        return endState;
    }
    transpileIfAPGLExprOnlyNZ(ctx, cond, body) {
        const condEndState = this.transpileExpr(new Context1(ctx.input), cond);
        const bodyStartState = this.getFreshName() + "_IF_NZ";
        const endState = this.transpileExpr(new Context1(bodyStartState, ctx.output), body);
        this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: endState,
            actions: [
                "NOP"
            ]
        });
        this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: bodyStartState,
            actions: [
                "NOP"
            ]
        });
        return endState;
    }
    transpileLoopAPGLExpr(ctx, loopExpr) {
        const breakState = ctx.output ?? this.getFreshName() + "_LOOP_BREAK";
        this.loopFinalStates.push(breakState);
        const nextState = this.transpileExpr(new Context1(ctx.input, ctx.input), loopExpr.body);
        this.loopFinalStates.pop();
        if (nextState !== ctx.input) {
            this.emitTransition(nextState, ctx.input);
        }
        return breakState;
    }
    transpileWhileAPGLExprBodyEmpty(ctx, cond, modifier) {
        const condEndState = this.transpileExpr(new Context1(ctx.input), cond);
        const finalState = ctx.output ?? this.getFreshName() + "_WHILE_END";
        this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: modifier === "Z" ? ctx.input : finalState,
            actions: [
                "NOP"
            ]
        });
        this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: modifier === "Z" ? finalState : ctx.input,
            actions: [
                "NOP"
            ]
        });
        return finalState;
    }
    transpileWhileAPGLExpr(ctx, whileExpr) {
        if (isEmptyExpr(whileExpr.body)) {
            return this.transpileWhileAPGLExprBodyEmpty(ctx, whileExpr.cond, whileExpr.modifier);
        }
        const condEndState = this.transpileExpr(new Context1(ctx.input), whileExpr.cond);
        const bodyStartState = this.getFreshName() + "_WHILE_BODY";
        const finalState = ctx.output ?? this.getFreshName() + "_WHILE_END";
        this.emitLine({
            currentState: condEndState,
            prevOutput: "Z",
            nextState: whileExpr.modifier === "Z" ? bodyStartState : finalState,
            actions: [
                "NOP"
            ]
        });
        this.emitLine({
            currentState: condEndState,
            prevOutput: "NZ",
            nextState: whileExpr.modifier === "Z" ? finalState : bodyStartState,
            actions: [
                "NOP"
            ]
        });
        this.loopFinalStates.push(finalState);
        const bodyEndState = this.transpileExpr(new Context1(bodyStartState, ctx.input), whileExpr.body);
        this.loopFinalStates.pop();
        if (bodyEndState !== ctx.input) {
            this.emitTransition(bodyEndState, ctx.input);
        }
        return finalState;
    }
    transpileBreakAPGLExpr(ctx, breakExpr) {
        if (breakExpr.level !== undefined && breakExpr.level < 1) {
            throw Error("break level is less than 1");
        }
        if (breakExpr.level === undefined || breakExpr.level === 1) {
            const breakState = this.loopFinalStates[this.loopFinalStates.length - 1];
            if (breakState === undefined) {
                throw Error("break outside while or loop");
            }
            if (ctx.input !== breakState) {
                this.emitTransition(ctx.input, breakState);
            }
        } else {
            const breakState = this.loopFinalStates[this.loopFinalStates.length - breakExpr.level];
            if (breakState === undefined) {
                throw Error("break level is greater than number of nests of while or loop");
            }
            if (ctx.input !== breakState) {
                this.emitTransition(ctx.input, breakState);
            }
        }
        return ctx.output ?? this.getFreshName() + "_BREAK_UNUSED";
    }
}
function transpileAPGL(expr, options = {}) {
    return new Transpiler(options).transpile(expr);
}
function dups(as) {
    const set = new Set();
    const ds = [];
    for (const a of as){
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
function replaceVarInBoby(macro1, funcExpr) {
    const exprs = funcExpr.args;
    if (exprs.length !== macro1.args.length) {
        throw Error(`argument length mismatch: "${macro1.name}"` + ` expect ${argumentsMessage(macro1.args.length)} but given ${argumentsMessage(exprs.length)}${formatLocationAt(funcExpr.location)}`);
    }
    const nameToExpr = new Map(macro1.args.map((a, i)=>[
            a.name,
            exprs[i]
        ]
    ));
    return macro1.body.transform((x)=>{
        if (x instanceof VarAPGMExpr) {
            const expr = nameToExpr.get(x.name);
            if (expr === undefined) {
                throw Error(`scope error: "${x.name}"${formatLocationAt(x.location)}`);
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
    constructor(main1){
        this.main = main1;
        this.macroMap = new Map(main1.macros.map((m)=>[
                m.name,
                m
            ]
        ));
        if (this.macroMap.size < main1.macros.length) {
            const ds = dups(main1.macros.map((x)=>x.name
            ));
            const d = ds[0];
            const location8 = main1.macros.slice().reverse().find((x)=>x.name === d
            )?.location;
            throw Error(`There is a macro with the same name: "${d}"` + formatLocationAt(location8));
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
        return expr.transform((x)=>this.expandOnce(x)
        );
    }
    expandOnce(x) {
        if (x instanceof FuncAPGMExpr) {
            return this.expandFuncAPGMExpr(x);
        } else {
            return x;
        }
    }
    expandFuncAPGMExpr(funcExpr) {
        const macro2 = this.macroMap.get(funcExpr.name);
        if (macro2 !== undefined) {
            const expanded = replaceVarInBoby(macro2, funcExpr);
            return this.expandExpr(expanded);
        } else {
            return funcExpr;
        }
    }
}
function expand(main2) {
    return new MacroExpander(main2).expand();
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
        return bs;
    }
    if (bs.length === 0) {
        return as;
    }
    if (as.some((x)=>x instanceof HaltOutAction
    )) {
        return undefined;
    }
    if (bs.some((x)=>x instanceof HaltOutAction
    )) {
        return undefined;
    }
    const asWithoutNOP = as.filter((x)=>!(x instanceof NopAction)
    );
    const bsWithoutNOP = bs.filter((x)=>!(x instanceof NopAction)
    );
    if (asWithoutNOP.every((a)=>!a.doesReturnValue()
    ) && bsWithoutNOP.every((b)=>!b.doesReturnValue()
    )) {
        const distinctComponent = asWithoutNOP.every((a)=>{
            return bsWithoutNOP.every((b)=>{
                return !a.isSameComponent(b);
            });
        });
        if (distinctComponent) {
            const merged = asWithoutNOP.concat(bsWithoutNOP);
            merged.push(new NopAction());
            return merged;
        }
    }
    return undefined;
}
function toActions(actionExpr) {
    return actionExpr.actions.flatMap((x)=>{
        const a = parseAction(x);
        return a !== undefined ? [
            a
        ] : [];
    });
}
function optimizeSeqAPGLExpr(seqExpr) {
    const newExprs = [];
    let items = [];
    const putItems = ()=>{
        if (items.length !== 0) {
            newExprs.push(new ActionAPGLExpr(items.map((x)=>x.pretty()
            )));
            items = [];
        }
    };
    for (const expr of seqExpr.exprs){
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
function integration(str, options = {}, log = false) {
    const apgm = parseMain(str);
    if (log) {
        console.log("apgm", JSON.stringify(apgm, null, "  "));
    }
    const expanded = expand(apgm);
    if (log) {
        console.log("apgm expaned", JSON.stringify(expanded, null, "  "));
    }
    const apgl = transpileAPGMExpr(expanded);
    if (log) {
        console.log("apgl", JSON.stringify(apgl, null, "  "));
    }
    const optimizedAPGL = optimize(apgl);
    if (log) {
        console.log("optimized apgl", JSON.stringify(optimizedAPGL, null, "  "));
    }
    const apgs = transpileAPGL(optimizedAPGL, options);
    const comment1 = [
        "# State    Input    Next state    Actions",
        "# ---------------------------------------", 
    ];
    const head = apgm.headers.map((x)=>x.toString()
    );
    return head.concat(comment1, apgs);
}
export { integration as integration };
