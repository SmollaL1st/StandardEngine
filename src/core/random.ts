/** Small deterministic generators, so a fold variant can be reproduced from its number. */
export function rng(seed: number) {
    let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function hash(n: number) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/** Smooth value noise in [-1, 1]. */
export function noise1(x: number, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const offset = seed * 57.31;
    const a = hash(i + offset), b = hash(i + 1 + offset);
    return (a + (b - a) * u) * 2 - 1;
}
