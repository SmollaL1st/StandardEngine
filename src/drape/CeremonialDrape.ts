import { Geometry } from '../engine/Geometry';
import { Vec3, clamp, radians } from '../engine/math';
import { FoldCurve } from './FoldCurve';
import { ClothDynamics } from '../physics/ClothDynamics';

export type DrapeSettings = {
    size: number; opening: number; gather: number; shoulder: number;
    hoist: number; fall: number; folds: number; foldDepth: number;
    twist: number; rotation: number;
    bendNear: number; bendMiddle: number; bendOuter: number; edgeCurl: number;
    coneAmount: number; bending: number; shapeHold: number; damping: number;
};

export const defaultDrape: Readonly<DrapeSettings> = Object.freeze({
    size: 1, opening: 18, gather: 0.65, shoulder: 0.18, hoist: 1,
    fall: 1, folds: 5, foldDepth: 0.4, twist: 0, rotation: 0,
    bendNear: 80, bendMiddle: -90, bendOuter: 75, edgeCurl: -65,
    coneAmount: 1, bending: 0.35, shapeHold: 0.55, damping: 0.45,
});

export type HemSegment = { a: number; b: number; inward: number };

/** Fit by the textile diagonal, so a square flag is not shorter than a 3:2 flag. */
export function textileSizeForPole(aspect: number, poleLength: number) {
    if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(poleLength) || poleLength <= 0.3) {
        throw new RangeError('Invalid flag aspect ratio or pole length');
    }
    const diagonal = (poleLength - 0.3) * 0.84;
    const height = diagonal / Math.hypot(aspect, 1);
    return { width: height * aspect, height };
}

/**
 * A material-length-preserving rest surface and a separate, coarser cloth simulation.
 * The spherical curve becomes a great circle at zero cone amount: a flat textile
 * hanging by its diagonal. Only the short upper cuff is fixed to the staff.
 */
export class CeremonialDrape {
    readonly geometry = new Geometry();
    readonly sleeveColumns = 10;
    readonly bodyColumns = 160;
    readonly rows = 96;
    readonly columns = this.sleeveColumns + this.bodyColumns;
    readonly hem: HemSegment[] = [];
    readonly settings: DrapeSettings = { ...defaultDrape };
    attachmentY = 2.4;
    width: number;
    height: number;
    private readonly positions: Float32Array;
    private readonly rest: Float32Array;
    private readonly us: Float64Array;
    private readonly vs: Float64Array;
    private readonly poleRadius = 0.067;
    private dynamics!: ClothDynamics;
    private controlRest!: Float32Array;
    private readonly controlSleeve = 5;
    private readonly controlColumns = 45;
    private readonly controlRows = 24;
    private readonly weights: Float32Array;
    private readonly cells: Uint32Array;
    private baseWidth: number;
    private baseHeight: number;

    constructor(baseWidth: number, baseHeight: number) {
        if (![baseWidth, baseHeight].every(n => Number.isFinite(n) && n > 0)) {
            throw new RangeError('Textile dimensions must be finite and positive');
        }
        this.baseWidth = this.width = baseWidth;
        this.baseHeight = this.height = baseHeight;
        this.positions = new Float32Array((this.columns + 1) * (this.rows + 1) * 3);
        this.rest = new Float32Array(this.positions.length);
        this.weights = new Float32Array(this.positions.length / 3 * 2);
        this.cells = new Uint32Array(this.positions.length / 3);
        this.us = new Float64Array(this.columns + 1);
        this.vs = new Float64Array(this.rows + 1);
        this.geometry.positions = this.positions;
        this.geometry.normals = new Float32Array(this.positions.length);
        this.geometry.uvs = new Float32Array((this.columns + 1) * (this.rows + 1) * 2);
        const indices: number[] = [];
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.columns; x++) {
                const a = this.index(x, y), b = this.index(x + 1, y);
                const c = this.index(x, y + 1), d = this.index(x + 1, y + 1);
                indices.push(a, c, b, b, c, d);
            }
        }
        this.geometry.indices = new Uint32Array(indices);
        // Only free edges carry fringe; the hoist stays clean.
        for (let x = 0; x < this.columns; x++) this.hem.push({ a: this.index(x, 0), b: this.index(x + 1, 0), inward: this.index(x, 1) });
        for (let y = 0; y < this.rows; y++) this.hem.push({ a: this.index(this.columns, y), b: this.index(this.columns, y + 1), inward: this.index(this.columns - 1, y) });
        for (let x = this.columns; x > 0; x--) this.hem.push({ a: this.index(x, this.rows), b: this.index(x - 1, this.rows), inward: this.index(x, this.rows - 1) });
        this.rebuildCoordinates();
        this.buildRest();
        this.buildDynamics();
        this.updateGeometry();
    }

    index(x: number, y: number) { return y * (this.columns + 1) + x; }

    configure(values: Partial<DrapeSettings>) {
        const limits: Record<keyof DrapeSettings, [number, number]> = {
            size: [0.65, 1.1], opening: [16, 36], gather: [0, 1], shoulder: [0.04, 0.45],
            hoist: [0.65, 1], fall: [0.7, 1], folds: [2, 10], foldDepth: [0, 1],
            twist: [-45, 45], rotation: [-180, 180],
            bendNear: [-120, 120], bendMiddle: [-120, 120], bendOuter: [-120, 120], edgeCurl: [-120, 120],
            coneAmount: [0, 1], bending: [0, 1], shapeHold: [0, 1], damping: [0, 1],
        };
        let shapeChanged = false;
        for (const key of Object.keys(values) as (keyof DrapeSettings)[]) {
            const value = values[key];
            if (value === undefined || !Number.isFinite(value) || !limits[key]) continue;
            const next = clamp(value, ...limits[key]);
            if (next !== this.settings[key] && !['bending', 'shapeHold', 'damping'].includes(key)) shapeChanged = true;
            this.settings[key] = next;
        }
        this.settings.folds = Math.round(this.settings.folds);
        if (shapeChanged) {
            this.rebuildCoordinates(); this.buildRest(); this.buildDynamics();
            this.updateGeometry();
        } else this.setPhysicsParameters();
    }

    resize(width: number, height: number) {
        if (![width, height].every(n => Number.isFinite(n) && n > 0)) return;
        this.baseWidth = width;
        this.baseHeight = height;
        this.rebuildCoordinates();
        this.buildRest(); this.buildDynamics(); this.updateGeometry();
    }

    setAttachmentHeight(top: number) {
        if (!Number.isFinite(top)) return;
        const delta = top - this.attachmentY;
        this.attachmentY = top;
        for (let i = 1; i < this.rest.length; i += 3) this.rest[i] += delta;
        for (let i = 1; i < this.controlRest.length; i += 3) this.controlRest[i] += delta;
        this.dynamics.translate(0, delta, 0);
        this.updateGeometry();
    }

    reset() {
        this.dynamics.reset(); this.updateGeometry();
    }

    /** Gravity and wind act on free particles, even with no wind selected. */
    advance(dt: number, wind: Vec3, softness: number) {
        const response = Number.isFinite(softness) ? clamp(softness, 0, 1) : 0.5;
        const changed = this.dynamics.advance(dt, this.wind.copy(wind).multiplyScalar(0.25 + response * 0.75));
        if (changed) this.updateGeometry();
        return changed;
    }
    private readonly wind = new Vec3();

    private rebuildCoordinates() {
        this.width = this.baseWidth * this.settings.size;
        this.height = this.baseHeight * this.settings.size;
        // Concentrate vertices at the shoulder, where angular pleats change fastest.
        // Unlike compressing positions at the apex, this keeps every triangle open.
        const shoulderU = this.settings.shoulder / this.settings.fall;
        const shoulderV = this.settings.shoulder / this.settings.hoist;
        const widthCurve = Math.log1p(this.width / shoulderU);
        const heightCurve = Math.log1p(this.height / shoulderV);
        for (let x = 0; x <= this.columns; x++) this.us[x] = shoulderU * Math.expm1(x / this.columns * widthCurve);
        for (let y = 0; y <= this.rows; y++) this.vs[y] = shoulderV * Math.expm1(y / this.rows * heightCurve);
        const uvs = this.geometry.uvs;
        for (let y = 0; y <= this.rows; y++) {
            for (let x = 0; x <= this.columns; x++) {
                const i = this.index(x, y) * 2; uvs[i] = this.us[x] / this.width; uvs[i + 1] = 1 - this.vs[y] / this.height;
            }
        }
    }

    private readonly curve = new FoldCurve(this.poleRadius);
    private readonly sample = new Vec3();
    get appliedBendStrength() { return this.curve.bendScale; }

    private buildRest() {
        const s = this.settings, neck = s.shoulder / s.hoist;
        const tilt = (1 - s.coneAmount) * Math.atan2(this.width, this.height);
        this.curve.build(s, neck, 0, 0, tilt);
        const u = this.width, v = this.height + neck, radius = Math.hypot(u, v);
        this.curve.sample(Math.atan2(u, v), this.sample);
        const coneYaw = Math.PI / 2 - Math.atan2(radius * this.sample.z, this.poleRadius + radius * this.sample.x);
        // The lower corner has no horizontal direction in the flat limit.
        // Blend frame angles instead of positions to avoid flattening the texture.
        const yaw = coneYaw * s.coneAmount + Math.PI / 2 * (1 - s.coneAmount) + radians(s.rotation);
        const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
        for (let y = 0; y <= this.rows; y++) {
            const v = this.vs[y];
            for (let x = 0; x <= this.columns; x++) {
                const i = this.index(x, y) * 3;
                const u = this.us[x], radius = Math.hypot(u, v + neck);
                this.curve.sample(Math.atan2(u, v + neck), this.sample);
                const px = this.poleRadius + radius * this.sample.x;
                const py = this.attachmentY + (neck + radius * this.sample.y) * ct - radius * this.sample.z * st;
                const pz = (neck + radius * this.sample.y) * st + radius * this.sample.z * ct;
                this.rest[i] = px * cy - pz * sy;
                this.rest[i + 1] = py;
                this.rest[i + 2] = px * sy + pz * cy;
            }
        }
    }

    private controlX(x: number) {
        return x <= this.controlSleeve ? x * 2 : this.sleeveColumns + (x - this.controlSleeve) * 4;
    }

    private setPhysicsParameters() {
        this.dynamics.setParameters({ bending: this.settings.bending, drape: this.settings.shapeHold, damping: this.settings.damping });
    }

    private buildDynamics() {
        const stride = this.controlColumns + 1, count = stride * (this.controlRows + 1);
        this.controlRest = new Float32Array(count * 3);
        const uv = new Float32Array(count * 2), pinned = new Uint8Array(count), indices: number[] = [];
        for (let y = 0; y <= this.controlRows; y++) for (let x = 0; x <= this.controlColumns; x++) {
            const vertex = y * stride + x, dense = this.index(this.controlX(x), y * 4);
            this.controlRest.set(this.rest.subarray(dense * 3, dense * 3 + 3), vertex * 3);
            uv.set(this.geometry.uvs.subarray(dense * 2, dense * 2 + 2), vertex * 2);
            // Fix only the upper cuff. A full vertical hoist would prevent the
            // flat diagonal textile from hanging without stretching its print.
            pinned[vertex] = this.us[this.controlX(x)] <= 0.05 && y === 0 ? 1 : 0;
            if (x < this.controlColumns && y < this.controlRows) {
                indices.push(vertex, vertex + stride, vertex + 1, vertex + 1, vertex + stride, vertex + stride + 1);
            }
        }
        this.dynamics = new ClothDynamics(this.controlRest, uv, new Uint32Array(indices), this.width, this.height, pinned);
        this.setPhysicsParameters();
        // Interpolate in material coordinates: the dense grid is not uniformly
        // spaced near the shoulder, so index-based weights would distort it.
        for (let y = 0; y <= this.rows; y++) for (let x = 0; x <= this.columns; x++) {
            const cx = Math.min(this.controlColumns - 1, Math.floor(x <= this.sleeveColumns ? x / 2 : this.controlSleeve + (x - this.sleeveColumns) / 4));
            const ry = Math.min(this.controlRows - 1, Math.floor(y / 4)), id = this.index(x, y);
            this.cells[id] = ry * stride + cx;
            const left = this.controlX(cx), right = this.controlX(cx + 1);
            this.weights[id * 2] = (this.us[x] - this.us[left]) / (this.us[right] - this.us[left]);
            this.weights[id * 2 + 1] = (this.vs[y] - this.vs[ry * 4]) / (this.vs[(ry + 1) * 4] - this.vs[ry * 4]);
        }
    }

    private updateGeometry() {
        const p = this.dynamics.positions, target = this.controlRest, stride = this.controlColumns + 1;
        for (let vertex = 0; vertex < this.cells.length; vertex++) {
            const a = this.cells[vertex], b = a + 1, c = a + stride, d = c + 1;
            const u = this.weights[vertex * 2], v = this.weights[vertex * 2 + 1];
            for (let axis = 0; axis < 3; axis++) {
                const delta = (p[a * 3 + axis] - target[a * 3 + axis]) * (1 - u) * (1 - v)
                    + (p[b * 3 + axis] - target[b * 3 + axis]) * u * (1 - v)
                    + (p[c * 3 + axis] - target[c * 3 + axis]) * (1 - u) * v
                    + (p[d * 3 + axis] - target[d * 3 + axis]) * u * v;
                this.positions[vertex * 3 + axis] = this.rest[vertex * 3 + axis] + delta;
            }
            // Coarse contacts do not guarantee that the interpolated surface
            // stays outside the cylinder between simulation nodes.
            const i = vertex * 3, radius = Math.hypot(this.positions[i], this.positions[i + 2]);
            if (radius < 0.064) {
                const angle = radius > 1e-7 ? Math.atan2(this.positions[i + 2], this.positions[i])
                    : Math.atan2(this.rest[i + 2], this.rest[i]);
                this.positions[i] = Math.cos(angle) * 0.064; this.positions[i + 2] = Math.sin(angle) * 0.064;
            }
            this.positions[i + 1] = Math.max(-5.02, this.positions[i + 1]);
        }
        this.geometry.update();
    }

    dispose() { this.geometry.dispose(); }
}
