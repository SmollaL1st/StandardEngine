import { ClothSim, type ClothParams, type Cylinder, type Wind } from '../sim/ClothSim';
import { DrapePose, type PoseParams } from '../sim/DrapePose';
import { SpatialHash } from '../sim/SpatialHash';
import { Geometry } from './Mesh';

export interface FlagClothSetup {
    width: number;
    height: number;
    pose: PoseParams;
    /** Simulation cells along the longer side. */
    resolution: number;
    /** Render subdivisions per simulation cell. */
    detail: number;
    areaDensity: number;
    edgeMass: number;
    /** Innermost radius of the cloth around the staff. */
    hoistOffset: number;
    /** Size of the cuff tied to the staff, m. */
    cuff: number;
    poleRadius: number;
}

/** Catmull–Rom weights for t in [0, 1). */
function catmullRom(t: number, out: Float32Array, i: number) {
    const t2 = t * t, t3 = t2 * t;
    out[i] = (-t3 + 2 * t2 - t) / 2;
    out[i + 1] = (3 * t3 - 5 * t2 + 2) / 2;
    out[i + 2] = (-3 * t3 + 4 * t2 + t) / 2;
    out[i + 3] = (t3 - t2) / 2;
}

/**
 * The textile: a cloth simulation, a smooth dense surface interpolated from it
 * and per-side ambient occlusion for the folds and the layers of the cone.
 * Everything is in the flag's local frame (staff axis at x = z = 0, apex at y = 0).
 */
export class FlagCloth {
    readonly width: number;
    readonly height: number;
    readonly sim: ClothSim;
    readonly pose = new DrapePose();
    readonly surface = new Geometry();
    readonly setup: FlagClothSetup;
    detail = 4;
    rnx = 0;
    rny = 0;
    private padded: Float32Array;
    private rowPass = new Float32Array();
    private weightsU = new Float32Array();
    private weightsV = new Float32Array();
    private cellU = new Int32Array();
    private cellV = new Int32Array();
    private readonly simAO: Float32Array;
    private readonly poseBuffer: Float32Array;
    private readonly aoHash: SpatialHash;

    constructor(setup: FlagClothSetup) {
        this.setup = setup;
        this.width = setup.width; this.height = setup.height;
        const long = Math.max(setup.width, setup.height);
        const nx = Math.max(8, Math.round(setup.resolution * setup.width / long));
        const ny = Math.max(8, Math.round(setup.resolution * setup.height / long));
        this.poseBuffer = new Float32Array((nx + 1) * (ny + 1) * 3);
        this.pose.build(setup.pose, setup.hoistOffset);
        this.writePose(nx, ny);
        this.sim = new ClothSim({
            nx, ny, width: setup.width, height: setup.height, areaDensity: setup.areaDensity,
            edgeMass: setup.edgeMass, cuff: setup.cuff, pose: this.poseBuffer,
        });
        this.padded = new Float32Array((nx + 3) * (ny + 3) * 3);
        this.simAO = new Float32Array(this.sim.count * 2);
        this.aoHash = new SpatialHash(this.sim.count);
        this.setDetail(setup.detail);
    }

    private writePose(nx: number, ny: number) {
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            this.pose.map(x / nx * this.width, y / ny * this.height, this.poseBuffer, (y * (nx + 1) + x) * 3);
        }
    }

    /** Rebuilds the target drape. `redrape` restarts the cloth from it. */
    setPose(params: PoseParams, redrape: boolean) {
        this.setup.pose = { ...params };
        this.pose.build(this.setup.pose, this.setup.hoistOffset);
        this.writePose(this.sim.nx, this.sim.ny);
        this.sim.setTarget(this.poseBuffer, redrape);
        this.updateSurface();
    }

    setParams(params: ClothParams) { this.sim.setParams(params); }

    setColliders(colliders: Cylinder[], floorY: number) {
        this.sim.colliders = colliders; this.sim.floorY = floorY; this.sim.wake();
    }

    step(dt: number, wind: Wind, turbulence: number, maxSubsteps?: number) {
        const moved = this.sim.step(dt, wind, turbulence, maxSubsteps);
        if (moved) this.updateSurface();
        return moved;
    }

    setDetail(detail: number) {
        this.detail = Math.max(1, Math.round(detail));
        const { nx, ny } = this.sim, r = this.detail;
        this.rnx = nx * r; this.rny = ny * r;
        const cols = this.rnx + 1, rows = this.rny + 1;
        this.weightsU = new Float32Array(cols * 4); this.cellU = new Int32Array(cols);
        this.weightsV = new Float32Array(rows * 4); this.cellV = new Int32Array(rows);
        for (let i = 0; i < cols; i++) {
            const cell = Math.min(nx - 1, Math.floor(i / r));
            this.cellU[i] = cell; catmullRom(i / r - cell, this.weightsU, i * 4);
        }
        for (let j = 0; j < rows; j++) {
            const cell = Math.min(ny - 1, Math.floor(j / r));
            this.cellV[j] = cell; catmullRom(j / r - cell, this.weightsV, j * 4);
        }
        this.rowPass = new Float32Array(cols * (ny + 3) * 3);
        const count = cols * rows;
        const uvs = new Float32Array(count * 2), indices = new Uint32Array(this.rnx * this.rny * 6);
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const k = j * cols + i;
            uvs[k * 2] = i / this.rnx; uvs[k * 2 + 1] = 1 - j / this.rny;
        }
        let n = 0;
        for (let j = 0; j < this.rny; j++) for (let i = 0; i < this.rnx; i++) {
            const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
            indices[n++] = a; indices[n++] = b; indices[n++] = c;
            indices[n++] = b; indices[n++] = d; indices[n++] = c;
        }
        this.surface.set({
            positions: new Float32Array(count * 3), normals: new Float32Array(count * 3), uvs,
            tangents: new Float32Array(count * 3), ao: new Float32Array(count * 2), indices,
        });
        this.updateSurface();
    }

    /** Smooth surface from the simulation grid, with normals, thread tangents and fold occlusion. */
    updateSurface() {
        const { nx, ny, positions: sim } = this.sim, pw = nx + 3, pad = this.padded;
        // Copy into a grid with one ghost ring, extrapolated linearly.
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const s = (y * (nx + 1) + x) * 3, d = ((y + 1) * pw + x + 1) * 3;
            pad[d] = sim[s]; pad[d + 1] = sim[s + 1]; pad[d + 2] = sim[s + 2];
        }
        for (let y = 1; y <= ny + 1; y++) for (let k = 0; k < 3; k++) {
            const row = y * pw * 3;
            pad[row + k] = 2 * pad[row + 3 + k] - pad[row + 6 + k];
            pad[row + (nx + 2) * 3 + k] = 2 * pad[row + (nx + 1) * 3 + k] - pad[row + nx * 3 + k];
        }
        for (let x = 0; x < pw; x++) for (let k = 0; k < 3; k++) {
            pad[x * 3 + k] = 2 * pad[(pw + x) * 3 + k] - pad[(2 * pw + x) * 3 + k];
            const last = (ny + 2) * pw;
            pad[(last + x) * 3 + k] = 2 * pad[((ny + 1) * pw + x) * 3 + k] - pad[(ny * pw + x) * 3 + k];
        }
        const cols = this.rnx + 1, rows = this.rny + 1, row = this.rowPass, wu = this.weightsU, wv = this.weightsV;
        for (let y = 0; y < ny + 3; y++) for (let i = 0; i < cols; i++) {
            const base = (y * pw + this.cellU[i]) * 3, o = (y * cols + i) * 3;
            for (let k = 0; k < 3; k++) {
                row[o + k] = wu[i * 4] * pad[base + k] + wu[i * 4 + 1] * pad[base + 3 + k]
                    + wu[i * 4 + 2] * pad[base + 6 + k] + wu[i * 4 + 3] * pad[base + 9 + k];
            }
        }
        const p = this.surface.positions;
        const minRadius = this.setup.poleRadius + 0.0015;
        for (let j = 0; j < rows; j++) {
            const base = this.cellV[j];
            for (let i = 0; i < cols; i++) {
                const o = (j * cols + i) * 3;
                for (let k = 0; k < 3; k++) {
                    p[o + k] = wv[j * 4] * row[(base * cols + i) * 3 + k] + wv[j * 4 + 1] * row[((base + 1) * cols + i) * 3 + k]
                        + wv[j * 4 + 2] * row[((base + 2) * cols + i) * 3 + k] + wv[j * 4 + 3] * row[((base + 3) * cols + i) * 3 + k];
                }
                // Cubic overshoot must not push the cloth into the staff.
                const r = Math.hypot(p[o], p[o + 2]);
                if (r < minRadius && r > 1e-9) { p[o] *= minRadius / r; p[o + 2] *= minRadius / r; }
            }
        }
        this.computeFrames();
        this.computeOcclusion();
        this.surface.touch();
    }

    private computeFrames() {
        const p = this.surface.positions, n = this.surface.normals, t = this.surface.tangents!;
        const cols = this.rnx + 1, rows = this.rny + 1;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const l = (j * cols + Math.max(0, i - 1)) * 3, r = (j * cols + Math.min(cols - 1, i + 1)) * 3;
            const u = (Math.max(0, j - 1) * cols + i) * 3, d = (Math.min(rows - 1, j + 1) * cols + i) * 3;
            const ax = p[r] - p[l], ay = p[r + 1] - p[l + 1], az = p[r + 2] - p[l + 2];
            const bx = p[d] - p[u], by = p[d + 1] - p[u + 1], bz = p[d + 2] - p[u + 2];
            let qx = ay * bz - az * by, qy = az * bx - ax * bz, qz = ax * by - ay * bx;
            const ql = Math.hypot(qx, qy, qz) || 1, al = Math.hypot(ax, ay, az) || 1, o = (j * cols + i) * 3;
            qx /= ql; qy /= ql; qz /= ql;
            n[o] = qx; n[o + 1] = qy; n[o + 2] = qz;
            t[o] = ax / al; t[o + 1] = ay / al; t[o + 2] = az / al;
        }
    }

    /**
     * Cavity occlusion for each side of the cloth: concave curvature plus nearby
     * layers of other folds. Computed on the coarse grid, then interpolated.
     */
    private computeOcclusion() {
        const sim = this.sim, p = sim.positions, n = sim.normals, ao = this.simAO, { nx, ny, du, dv } = sim;
        const c = nx + 1, ring = 2;
        for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
            const i = y * c + x, k = i * 3;
            let sx = 0, sy = 0, sz = 0, count = 0, r2 = 0;
            for (const [ox, oy, d] of [[-ring, 0, du], [ring, 0, du], [0, -ring, dv], [0, ring, dv]] as const) {
                const xx = x + ox, yy = y + oy;
                if (xx < 0 || xx > nx || yy < 0 || yy > ny) continue;
                const j = (yy * c + xx) * 3;
                sx += p[j]; sy += p[j + 1]; sz += p[j + 2]; count++; r2 += (d * ring) ** 2;
            }
            let front = 0, back = 0;
            if (count >= 2) {
                const lx = sx / count - p[k], ly = sy / count - p[k + 1], lz = sz / count - p[k + 2];
                const curvature = (lx * n[k] + ly * n[k + 1] + lz * n[k + 2]) / (r2 / count);
                const occlusion = curvature * 0.075;
                if (occlusion > 0) front = occlusion; else back = -occlusion;
            }
            ao[i * 2] = front; ao[i * 2 + 1] = back;
        }
        // Other layers within reach shade the side that faces them.
        const reach = Math.max(0.03, this.height * 0.1), reach2 = reach * reach;
        const exclude2 = (reach * 1.4) ** 2;
        this.aoHash.build(p, sim.count, reach);
        for (let i = 0; i < sim.count; i++) {
            const k = i * 3, xi = i % c, yi = (i - xi) / c;
            const found = this.aoHash.gather(p[k], p[k + 1], p[k + 2], reach);
            let front = 0, back = 0;
            for (let m = 0; m < found; m++) {
                const j = this.aoHash.ids[m];
                const dx = p[j * 3] - p[k], dy = p[j * 3 + 1] - p[k + 1], dz = p[j * 3 + 2] - p[k + 2];
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > reach2 || d2 < 1e-12) continue;
                const xj = j % c, yj = (j - xj) / c;
                if (((xi - xj) * du) ** 2 + ((yi - yj) * dv) ** 2 < exclude2) continue;
                const d = Math.sqrt(d2), side = (dx * n[k] + dy * n[k + 1] + dz * n[k + 2]) / d;
                const weight = (1 - d / reach) ** 2 * 0.22;
                if (side > 0) front += weight * side; else back -= weight * side;
            }
            ao[i * 2] = Math.min(0.8, ao[i * 2] + front);
            ao[i * 2 + 1] = Math.min(0.8, ao[i * 2 + 1] + back);
        }
        // Bilinear to the dense surface.
        const out = this.surface.ao!, cols = this.rnx + 1, r = this.detail;
        for (let j = 0; j <= this.rny; j++) {
            const cy = Math.min(ny - 1, Math.floor(j / r)), fy = j / r - cy;
            for (let i = 0; i <= this.rnx; i++) {
                const cx = Math.min(nx - 1, Math.floor(i / r)), fx = i / r - cx;
                const a = cy * c + cx, b = a + 1, d = a + c, e = d + 1, o = (j * cols + i) * 2;
                for (let side = 0; side < 2; side++) {
                    out[o + side] = (ao[a * 2 + side] * (1 - fx) + ao[b * 2 + side] * fx) * (1 - fy)
                        + (ao[d * 2 + side] * (1 - fx) + ao[e * 2 + side] * fx) * fy;
                }
            }
        }
    }

    /** Free edges of the dense surface, in order, for the fringe. */
    edgePath() {
        const cols = this.rnx + 1, index = (i: number, j: number) => j * cols + i;
        const points: number[] = [], inward: number[] = [];
        const push = (i: number, j: number, ii: number, ij: number) => { points.push(index(i, j)); inward.push(index(ii, ij)); };
        for (let i = 1; i < this.rnx; i++) push(i, 0, i, 1);
        push(this.rnx, 0, this.rnx - 1, 1);
        for (let j = 1; j < this.rny; j++) push(this.rnx, j, this.rnx - 1, j);
        push(this.rnx, this.rny, this.rnx - 1, this.rny - 1);
        for (let i = this.rnx - 1; i >= 1; i--) push(i, this.rny, i, this.rny - 1);
        return { points: Int32Array.from(points), inward: Int32Array.from(inward) };
    }

    bounds() {
        const p = this.surface.positions, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]);
        }
        return { min, max };
    }

    dispose() { this.surface.dispose(); }
}
