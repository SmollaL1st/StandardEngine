import { clamp, lerp } from '../core/math';
import { SpatialHash } from './SpatialHash';

export interface ClothSetup {
    /** Cells along the hem (u) and the hoist (v). */
    nx: number;
    ny: number;
    width: number;
    height: number;
    /** Fabric weight, kg/m². */
    areaDensity: number;
    /** Extra weight of fringe on the free edges, kg per metre of edge. */
    edgeMass: number;
    /** Material within this distance of the top hoist corner is tied to the staff. */
    cuff: number;
    /** Rest pose, (nx + 1)(ny + 1) points in the local frame. */
    pose: Float32Array;
}

export interface ClothParams {
    /** Bending rigidity of the fabric, N·m. */
    bendingRigidity: number;
    /** 0 leaves the cloth to gravity; higher values keep the chosen drape. */
    shapeHold: number;
    /** 0..1 air and internal damping. */
    damping: number;
}

/** Vertical collision cylinder centred on x = z = 0. */
export interface Cylinder { radius: number; min: number; max: number }
export interface Wind { x: number; y: number; z: number }

const GRAVITY = 9.81;
export const SUBSTEP = 1 / 960;

/**
 * Small-step XPBD cloth: inextensible structure, compliant shear, triangle
 * bending constraints with physically scaled compliance, long-range tethers to
 * the sleeve, self-collision and staff / bar / floor contact.
 */
export class ClothSim {
    readonly nx: number;
    readonly ny: number;
    readonly columns: number;
    readonly count: number;
    readonly du: number;
    readonly dv: number;
    readonly positions: Float32Array;
    readonly previous: Float32Array;
    readonly velocities: Float32Array;
    readonly target: Float32Array;
    readonly normals: Float32Array;
    readonly invMass: Float32Array;
    readonly pinned: Uint8Array;
    /** Self-collision distance; layers of a fold never come closer than this. */
    readonly thickness: number;
    colliders: Cylinder[] = [];
    floorY = -Infinity;
    sleeping = false;
    time = 0;
    maxSpeed = 0;
    private readonly area: Float32Array;
    private readonly gust: Float32Array;
    private readonly stretchA: Int32Array;
    private readonly stretchB: Int32Array;
    private readonly stretchRest: Float32Array;
    private readonly shearA: Int32Array;
    private readonly shearB: Int32Array;
    private readonly shearRest: Float32Array;
    private readonly bend: Int32Array;
    private readonly tetherP: Int32Array;
    private readonly tetherA: Int32Array;
    private readonly tetherL: Float32Array;
    private readonly hash: SpatialHash;
    private pairs = new Int32Array(8192);
    private pairMin = new Float32Array(4096);
    private pairCount = 0;
    private accumulator = 0;
    private calmFrames = 0;
    private bendAlpha = 0;
    private holdRate = 0;
    private dampingRate = 1;

    constructor(setup: ClothSetup) {
        const { nx, ny, width, height } = setup;
        if (!(nx >= 2 && ny >= 2 && width > 0 && height > 0) || setup.pose.length !== (nx + 1) * (ny + 1) * 3) {
            throw new RangeError('Invalid cloth setup');
        }
        this.nx = nx; this.ny = ny; this.columns = nx + 1;
        const count = this.count = (nx + 1) * (ny + 1);
        const du = this.du = width / nx, dv = this.dv = height / ny;
        // Layers of the wound cone lie a few millimetres apart; this keeps them from passing through.
        this.thickness = Math.min(0.006, Math.min(du, dv) * 0.3);
        this.positions = setup.pose.slice();
        this.previous = setup.pose.slice();
        this.target = setup.pose.slice();
        this.velocities = new Float32Array(count * 3);
        this.normals = new Float32Array(count * 3);
        this.invMass = new Float32Array(count);
        this.pinned = new Uint8Array(count);
        this.area = new Float32Array(count);
        this.gust = new Float32Array(count);
        this.hash = new SpatialHash(count);

        const mass = new Float64Array(count);
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const i = this.index(x, y);
            const wu = x === 0 || x === nx ? 0.5 : 1, wv = y === 0 || y === ny ? 0.5 : 1;
            this.area[i] = du * dv * wu * wv;
            mass[i] = this.area[i] * setup.areaDensity;
            if (x > 0 && (y === 0 || y === ny)) mass[i] += setup.edgeMass * du * wu;
            if (x === nx) mass[i] += setup.edgeMass * dv * wv;
            // A short cuff under the top ring holds the cone on the staff.
            if (Math.hypot(x * du, y * dv) <= setup.cuff + 1e-9) this.pinned[i] = 1;
            this.invMass[i] = this.pinned[i] ? 0 : 1 / mass[i];
        }

        const sa: number[] = [], sb: number[] = [], sr: number[] = [];
        const ha: number[] = [], hb: number[] = [], hr: number[] = [], bend: number[] = [];
        const diagonal = Math.hypot(du, dv), pose = setup.pose;
        // Where the cone gathers round the staff the pose spreads the cloth wider than
        // the material allows; accept that there instead of fighting the staff.
        const rest = (a: number, b: number, length: number) => Math.max(length,
            Math.hypot(pose[a * 3] - pose[b * 3], pose[a * 3 + 1] - pose[b * 3 + 1], pose[a * 3 + 2] - pose[b * 3 + 2]));
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const i = this.index(x, y);
            if (x < nx) { sa.push(i); sb.push(i + 1); sr.push(rest(i, i + 1, du)); }
            if (y < ny) { sa.push(i); sb.push(i + this.columns); sr.push(rest(i, i + this.columns, dv)); }
            if (x < nx && y < ny) {
                const c = this.columns;
                ha.push(i, i + 1); hb.push(i + c + 1, i + c); hr.push(rest(i, i + c + 1, diagonal), rest(i + 1, i + c, diagonal));
            }
            if (x > 0 && x < nx) bend.push(i - 1, i, i + 1);
            if (y > 0 && y < ny) bend.push(i - this.columns, i, i + this.columns);
        }
        this.stretchA = Int32Array.from(sa); this.stretchB = Int32Array.from(sb); this.stretchRest = Float32Array.from(sr);
        this.shearA = Int32Array.from(ha); this.shearB = Int32Array.from(hb); this.shearRest = Float32Array.from(hr);
        this.bend = Int32Array.from(bend);

        // Long-range attachments to the top corner carry the weight of the cloth and
        // its fringe without waiting for corrections to travel across the whole grid.
        const tp: number[] = [], ta: number[] = [], tl: number[] = [];
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const i = this.index(x, y);
            if (this.pinned[i]) continue;
            const length = Math.max(Math.hypot(x * du, y * dv), Math.hypot(pose[i * 3] - pose[0], pose[i * 3 + 1] - pose[1], pose[i * 3 + 2] - pose[2]));
            tp.push(i); ta.push(0); tl.push(length * 1.003);
        }
        this.tetherP = Int32Array.from(tp); this.tetherA = Int32Array.from(ta); this.tetherL = Float32Array.from(tl);
        this.setParams({ bendingRigidity: 2e-5, shapeHold: 0.3, damping: 0.4 });
        this.computeNormals();
    }

    index(x: number, y: number) { return y * this.columns + x; }

    setParams(params: ClothParams) {
        const spacing = Math.sqrt(this.du * this.dv);
        const rigidity = Math.max(1e-9, params.bendingRigidity);
        // A triangle constraint C = |x_mid - centroid| ≈ κs²/3 stores ½C²/α; matching
        // the continuum energy ½Bκ²·s² gives α = s²/(9B), independent of the flag size.
        this.bendAlpha = spacing * spacing / (9 * rigidity) / (SUBSTEP * SUBSTEP);
        const hold = clamp(params.shapeHold, 0, 1);
        this.holdRate = hold <= 0 ? 0 : 10 ** lerp(-2.4, 1, hold);
        this.dampingRate = lerp(0.12, 3.5, clamp(params.damping, 0, 1));
        this.wake();
    }

    /** Changes the drape the cloth is attracted to and where the sleeve is held. */
    setTarget(pose: Float32Array, reset = false) {
        if (pose.length !== this.target.length) throw new RangeError('Pose size mismatch');
        this.target.set(pose);
        if (reset) {
            this.positions.set(pose); this.previous.set(pose); this.velocities.fill(0); this.accumulator = 0;
        } else {
            for (let i = 0; i < this.count; i++) if (this.pinned[i]) {
                for (let k = 0; k < 3; k++) this.positions[i * 3 + k] = pose[i * 3 + k];
            }
        }
        this.computeNormals();
        this.wake();
    }

    wake() { this.sleeping = false; this.calmFrames = 0; }

    /**
     * Advances by a fixed number of substeps derived from `dt`, so the result
     * does not depend on the display frame rate. Returns true if anything moved.
     */
    step(dt: number, wind: Wind, turbulence = 0.5, maxSubsteps = 32) {
        if (!(dt > 0)) return false;
        const windy = Math.hypot(wind.x, wind.y, wind.z) > 1e-3;
        if (windy) this.wake();
        if (this.sleeping) return false;
        this.accumulator = Math.min(this.accumulator + dt, SUBSTEP * maxSubsteps);
        const steps = Math.floor(this.accumulator / SUBSTEP + 1e-9);
        if (steps <= 0) return false;
        this.accumulator -= steps * SUBSTEP;
        this.computeNormals();
        this.updateGusts(turbulence);
        this.findCollisionPairs(steps * SUBSTEP);
        const gustiness = 0.8 + 0.2 * Math.sin(this.time * 0.7) + 0.12 * Math.sin(this.time * 1.93 + 1.1);
        const w = { x: wind.x * gustiness, y: wind.y * gustiness, z: wind.z * gustiness };
        for (let s = 0; s < steps; s++) { this.time += SUBSTEP; this.substep(w); }
        let maxSpeed = 0;
        const v = this.velocities;
        for (let i = 0; i < v.length; i += 3) maxSpeed = Math.max(maxSpeed, v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2]);
        this.maxSpeed = Math.sqrt(maxSpeed);
        if (this.maxSpeed < 0.004 && !windy) {
            if (++this.calmFrames > 40) { this.sleeping = true; this.velocities.fill(0); }
        } else this.calmFrames = 0;
        return true;
    }

    computeNormals() {
        const p = this.positions, n = this.normals, nx = this.nx, ny = this.ny, c = this.columns;
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const l = (y * c + Math.max(0, x - 1)) * 3, r = (y * c + Math.min(nx, x + 1)) * 3;
            const u = (Math.max(0, y - 1) * c + x) * 3, d = (Math.min(ny, y + 1) * c + x) * 3;
            const ax = p[r] - p[l], ay = p[r + 1] - p[l + 1], az = p[r + 2] - p[l + 2];
            const bx = p[d] - p[u], by = p[d + 1] - p[u + 1], bz = p[d + 2] - p[u + 2];
            let qx = ay * bz - az * by, qy = az * bx - ax * bz, qz = ax * by - ay * bx;
            const length = Math.hypot(qx, qy, qz) || 1;
            qx /= length; qy /= length; qz /= length;
            const i = (y * c + x) * 3;
            n[i] = qx; n[i + 1] = qy; n[i + 2] = qz;
        }
    }

    private updateGusts(turbulence: number) {
        const p = this.positions, t = this.time;
        for (let i = 0; i < this.count; i++) {
            const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
            const g = Math.sin(x * 3.1 + t * 2.3 + Math.sin(y * 1.7 - t * 0.9)) * Math.sin(y * 2.6 - t * 1.6 + z * 2.0);
            this.gust[i] = 1 + turbulence * 0.8 * g;
        }
    }

    private findCollisionPairs(frameDt: number) {
        const p = this.positions, thickness = this.thickness;
        const radius = thickness + Math.min(0.05, this.maxSpeed * frameDt * 2 + 0.002);
        this.hash.build(p, this.count, radius);
        const minRest2 = (1.6 * Math.max(this.du, this.dv)) ** 2;
        this.pairCount = 0;
        for (let i = 0; i < this.count; i++) {
            const n = this.hash.gather(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], radius);
            const xi = i % this.columns, yi = (i - xi) / this.columns;
            for (let k = 0; k < n; k++) {
                const j = this.hash.ids[k];
                if (j <= i) continue;
                const dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
                if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
                const xj = j % this.columns, yj = (j - xj) / this.columns;
                const rest2 = ((xi - xj) * this.du) ** 2 + ((yi - yj) * this.dv) ** 2;
                // Neighbours in the weave are kept apart by the structural constraints.
                if (rest2 < minRest2) continue;
                if (this.pairCount * 2 + 2 > this.pairs.length) {
                    const pairs = new Int32Array(this.pairs.length * 2); pairs.set(this.pairs); this.pairs = pairs;
                    const min = new Float32Array(this.pairMin.length * 2); min.set(this.pairMin); this.pairMin = min;
                }
                this.pairs[this.pairCount * 2] = i; this.pairs[this.pairCount * 2 + 1] = j;
                this.pairMin[this.pairCount++] = Math.min(thickness, Math.sqrt(rest2));
            }
        }
    }

    private substep(wind: Wind) {
        const h = SUBSTEP, p = this.positions, prev = this.previous, v = this.velocities, n = this.normals;
        const damp = Math.exp(-this.dampingRate * h);
        for (let i = 0; i < this.count; i++) {
            const k = i * 3;
            prev[k] = p[k]; prev[k + 1] = p[k + 1]; prev[k + 2] = p[k + 2];
            if (this.pinned[i]) continue;
            // Air acts on the cloth normal: drag while settling, pressure in a breeze.
            const g = this.gust[i];
            const rx = wind.x * g - v[k], ry = wind.y * g - v[k + 1], rz = wind.z * g - v[k + 2];
            const vn = n[k] * rx + n[k + 1] * ry + n[k + 2] * rz;
            const a = (0.6 * vn + 0.75 * Math.abs(vn) * vn) * this.area[i] * this.invMass[i] * h;
            v[k] = (v[k] + n[k] * a) * damp;
            v[k + 1] = (v[k + 1] + n[k + 1] * a - GRAVITY * h) * damp;
            v[k + 2] = (v[k + 2] + n[k + 2] * a) * damp;
            p[k] += v[k] * h; p[k + 1] += v[k + 1] * h; p[k + 2] += v[k + 2] * h;
        }
        for (let i = 0; i < this.count; i++) if (this.pinned[i]) {
            const k = i * 3;
            p[k] = this.target[k]; p[k + 1] = this.target[k + 1]; p[k + 2] = this.target[k + 2];
        }
        this.solveDistances(this.stretchA, this.stretchB, this.stretchRest, 0);
        this.solveDistances(this.shearA, this.shearB, this.shearRest, 0.6);
        this.solveBending();
        this.solveTethers();
        this.solveShapeHold();
        this.solveSelfCollisions();
        this.solveColliders();
        for (let i = 0; i < this.count; i++) {
            const k = i * 3;
            if (this.pinned[i]) { v[k] = v[k + 1] = v[k + 2] = 0; continue; }
            let vx = (p[k] - prev[k]) / h, vy = (p[k + 1] - prev[k + 1]) / h, vz = (p[k + 2] - prev[k + 2]) / h;
            const speed = Math.hypot(vx, vy, vz);
            if (speed > 12) { const s = 12 / speed; vx *= s; vy *= s; vz *= s; }
            v[k] = vx; v[k + 1] = vy; v[k + 2] = vz;
        }
    }

    /** `softness` is the XPBD compliance relative to the pair's inverse mass. */
    private solveDistances(aIds: Int32Array, bIds: Int32Array, rest: Float32Array, softness: number) {
        const p = this.positions, w = this.invMass;
        for (let n = 0; n < aIds.length; n++) {
            const a = aIds[n], b = bIds[n], wa = w[a], wb = w[b], sum = wa + wb;
            if (sum === 0) continue;
            const ia = a * 3, ib = b * 3;
            const dx = p[ia] - p[ib], dy = p[ia + 1] - p[ib + 1], dz = p[ia + 2] - p[ib + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-9) continue;
            const s = -(d - rest[n]) / (sum * (1 + softness)) / d;
            p[ia] += wa * dx * s; p[ia + 1] += wa * dy * s; p[ia + 2] += wa * dz * s;
            p[ib] -= wb * dx * s; p[ib + 1] -= wb * dy * s; p[ib + 2] -= wb * dz * s;
        }
    }

    private solveBending() {
        const p = this.positions, w = this.invMass, ids = this.bend, alpha = this.bendAlpha;
        for (let n = 0; n < ids.length; n += 3) {
            const a = ids[n], m = ids[n + 1], b = ids[n + 2];
            const wa = w[a], wm = w[m], wb = w[b];
            const denominator = (4 / 9) * wm + (wa + wb) / 9 + alpha;
            if (wa + wm + wb === 0) continue;
            const ia = a * 3, im = m * 3, ib = b * 3;
            const dx = p[im] - (p[ia] + p[im] + p[ib]) / 3;
            const dy = p[im + 1] - (p[ia + 1] + p[im + 1] + p[ib + 1]) / 3;
            const dz = p[im + 2] - (p[ia + 2] + p[im + 2] + p[ib + 2]) / 3;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < 1e-10) continue;
            const lambda = -d / denominator / d;
            const sm = wm * (2 / 3) * lambda, sa = -wa / 3 * lambda, sb = -wb / 3 * lambda;
            p[im] += dx * sm; p[im + 1] += dy * sm; p[im + 2] += dz * sm;
            p[ia] += dx * sa; p[ia + 1] += dy * sa; p[ia + 2] += dz * sa;
            p[ib] += dx * sb; p[ib + 1] += dy * sb; p[ib + 2] += dz * sb;
        }
    }

    private solveTethers() {
        const p = this.positions;
        for (let n = 0; n < this.tetherP.length; n++) {
            const i = this.tetherP[n] * 3, a = this.tetherA[n] * 3, max = this.tetherL[n];
            const dx = p[i] - p[a], dy = p[i + 1] - p[a + 1], dz = p[i + 2] - p[a + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= max * max) continue;
            const s = max / Math.sqrt(d2);
            p[i] = p[a] + dx * s; p[i + 1] = p[a + 1] + dy * s; p[i + 2] = p[a + 2] + dz * s;
        }
    }

    private solveShapeHold() {
        if (this.holdRate <= 0) return;
        const f = 1 - Math.exp(-this.holdRate * SUBSTEP), p = this.positions, t = this.target;
        for (let i = 0; i < p.length; i++) p[i] += (t[i] - p[i]) * f;
    }

    private solveSelfCollisions() {
        const p = this.positions, w = this.invMass;
        for (let n = 0; n < this.pairCount; n++) {
            const i = this.pairs[n * 2], j = this.pairs[n * 2 + 1], min = this.pairMin[n];
            const ii = i * 3, jj = j * 3;
            const dx = p[ii] - p[jj], dy = p[ii + 1] - p[jj + 1], dz = p[ii + 2] - p[jj + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= min * min || d2 < 1e-14) continue;
            const wi = w[i], wj = w[j], sum = wi + wj;
            if (sum === 0) continue;
            const d = Math.sqrt(d2), s = (min - d) / d / sum;
            p[ii] += dx * s * wi; p[ii + 1] += dy * s * wi; p[ii + 2] += dz * s * wi;
            p[jj] -= dx * s * wj; p[jj + 1] -= dy * s * wj; p[jj + 2] -= dz * s * wj;
        }
    }

    private solveColliders() {
        const p = this.positions;
        for (let i = 0; i < this.count; i++) {
            if (this.pinned[i]) continue;
            const k = i * 3;
            for (const c of this.colliders) {
                if (p[k + 1] < c.min || p[k + 1] > c.max) continue;
                const dx = p[k], dz = p[k + 2], r2 = dx * dx + dz * dz;
                if (r2 >= c.radius * c.radius) continue;
                const r = Math.sqrt(r2);
                if (r < 1e-9) { p[k] = c.radius; continue; }
                p[k] = dx / r * c.radius; p[k + 2] = dz / r * c.radius;
            }
            if (p[k + 1] < this.floorY) p[k + 1] = this.floorY;
        }
    }

    /** Largest relative stretch of a structural edge; used by tests and diagnostics. */
    maxStrain() {
        let max = 0;
        const p = this.positions;
        for (let n = 0; n < this.stretchA.length; n++) {
            const a = this.stretchA[n] * 3, b = this.stretchB[n] * 3;
            const d = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
            max = Math.max(max, d / this.stretchRest[n] - 1);
        }
        return max;
    }
}
