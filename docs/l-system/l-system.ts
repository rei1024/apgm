// F + - X Y
// 1 2 3 4 5

// 1 1111

// 1

// nwse
// 1234

interface LSystem<T> {
    axiom: Map<T, T[]>;
    initial: T[];
}

/**
 * Lindenmayer system
 */
export function* lSystem<T>(
    { axiom, initial }: LSystem<T>,
): Generator<T[], void, unknown> {
    let current = initial;
    while (true) {
        yield current;
        current = current.flatMap((c) => axiom.get(c) ?? [c]);
    }
}

export function lSystemArray<T>(
    { axiom, initial }: LSystem<T>,
    n: number,
): T[][] {
    if (!Number.isInteger(n)) {
        throw Error("error");
    }
    const array: T[][] = [];
    let i = 0;
    for (const c of lSystem({ axiom, initial })) {
        array.push(c);
        i++;
        if (n <= i) {
            break;
        }
    }

    return array;
}

export function dragonAt(n: number): string[] {
    return lSystemArray(dragon, n)[n - 1] ?? [];
}

export function analysis(n: number) {
    const array = dragonAt(n);
    const res = array.filter((y) => y !== "X" && y !== "Y").join("").split("F")
        .map((c) => {
            if (c === "++-") {
                return "+";
            } else if (c === "+--") {
                return "-";
            }
            return c;
        });
    // console.log(res);

    return res;
}

export function* lSystemN<T>(
    { axiom, initial }: LSystem<T>,
    n: number,
    i: number = 0,
) {
    for (const x of initial) {
        if (n <= i) {
            yield x;
        } else {
            const d = axiom.get(x);
            if (d === undefined) {
                yield x;
            } else {
                lSystemN({ axiom, initial: d }, n, i + 1);
            }
        }
    }
}

export const dragon: LSystem<string> = {
    axiom: new Map([
        ["X", "X+YF+".split("")],
        ["Y", "-FX-Y".split("")],
    ]),
    initial: [..."FX"],
};

// FX
// [F]X
// F[X]
// F[X] X+[Y]F+
// F[X] +F+

// X -> +F+
// Y -> -F-
