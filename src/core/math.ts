export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const radians = (deg: number) => deg * Math.PI / 180;
export const smoothstep = (e0: number, e1: number, x: number) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
};

export class Vec3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vec3) { return this.set(v.x, v.y, v.z); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v: Vec3) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v: Vec3) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
    addScaled(v: Vec3, s: number) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
    subVectors(a: Vec3, b: Vec3) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    scale(s: number) { return this.set(this.x * s, this.y * s, this.z * s); }
    dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    crossVectors(a: Vec3, b: Vec3) {
        return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
    }
    lengthSq() { return this.dot(this); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.scale(1 / (this.length() || 1)); }
    distanceTo(v: Vec3) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    lerpVectors(a: Vec3, b: Vec3, t: number) {
        return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    fromArray(a: ArrayLike<number>, i = 0) { return this.set(a[i], a[i + 1], a[i + 2]); }
    toArray(a: { [index: number]: number }, i = 0) { a[i] = this.x; a[i + 1] = this.y; a[i + 2] = this.z; return a; }
}

/** Column-major 4×4 matrix, as WebGL expects. */
export type Mat4 = Float32Array;

export function identity(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
    }
    return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    return new Float32Array([2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0, 0, 0, -2 / (far - near), 0,
        -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1]);
}

export function lookAt(eye: Vec3, target: Vec3, up = new Vec3(0, 1, 0)): Mat4 {
    const z = eye.clone().sub(target).normalize();
    let x = new Vec3().crossVectors(up, z);
    // A light straight overhead has no horizontal direction to align with.
    if (x.lengthSq() < 1e-10) x = new Vec3().crossVectors(new Vec3(0, 0, 1), z);
    x.normalize();
    const y = new Vec3().crossVectors(z, x);
    return new Float32Array([x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, -x.dot(eye), -y.dot(eye), -z.dot(eye), 1]);
}

export function rotationY(angle: number): Mat4 {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function translation(x: number, y: number, z: number): Mat4 {
    const m = identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
}

/** Returns homogeneous clip coordinates of a point. */
export function transformPoint(m: Mat4, x: number, y: number, z: number, out = new Float64Array(4)) {
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return out;
}
