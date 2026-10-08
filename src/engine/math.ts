export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const radians = (v: number) => v * Math.PI / 180;

export class Vec3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vec3) { return this.set(v.x, v.y, v.z); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v: Vec3) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v: Vec3) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
    addScaledVector(v: Vec3, s: number) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
    subVectors(a: Vec3, b: Vec3) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    multiplyScalar(s: number) { return this.set(this.x * s, this.y * s, this.z * s); }
    divideScalar(s: number) { return this.multiplyScalar(1 / s); }
    dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    lengthSq() { return this.dot(this); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.divideScalar(this.length() || 1); }
    distanceTo(v: Vec3) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    crossVectors(a: Vec3, b: Vec3) { return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
    cross(v: Vec3) { return this.crossVectors(this.clone(), v); }
    lerpVectors(a: Vec3, b: Vec3, t: number) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
    fromArray(a: ArrayLike<number>, i = 0) { return this.set(a[i], a[i + 1], a[i + 2]); }
    toArray(a: number[] | Float32Array | Float64Array = [], i = 0) { a[i] = this.x; a[i + 1] = this.y; a[i + 2] = this.z; return a; }
    equals(v: Vec3) { return this.x === v.x && this.y === v.y && this.z === v.z; }
}

export function multiply4(a: Float32Array, b: Float32Array) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    }
    return out;
}
export function perspective(fov: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number) {
    return new Float32Array([2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0, 0, 0, -2 / (far - near), 0,
        -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1]);
}
export function lookAt(eye: Vec3, target: Vec3) {
    const z = eye.clone().sub(target).normalize();
    const x = new Vec3().crossVectors(new Vec3(0, 1, 0), z).normalize();
    const y = new Vec3().crossVectors(z, x);
    return new Float32Array([x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, -x.dot(eye), -y.dot(eye), -z.dot(eye), 1]);
}
