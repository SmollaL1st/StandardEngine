import { Geometry } from '../engine/Geometry';
import { Vec3, clamp, radians } from '../engine/math';
import { FoldCurve } from './FoldCurve';

export type DrapeSettings = {
    size: number; opening: number; gather: number; shoulder: number;
    hoist: number; fall: number; folds: number; foldDepth: number;
    twist: number; rotation: number;
    bendNear: number; bendMiddle: number; bendOuter: number; edgeCurl: number;
};

export const defaultDrape: Readonly<DrapeSettings> = Object.freeze({
    size: 1, opening: 18, gather: 0.65, shoulder: 0.18, hoist: 1,
    fall: 1, folds: 5, foldDepth: 0.4, twist: 0, rotation: 0,
    bendNear: 80, bendMiddle: -90, bendOuter: 75, edgeCurl: -65,
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
 * Controlled hanging textile, independent of the outdoor particle solver.
 * A unit-speed spherical fold curve preserves both material directions. The shoulder avoids
 * the singular apex; the hoist wrap shares vertices with the free cloth.
 * Wind changes the fold curvature without scaling material coordinates.
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
    private readonly us: Float64Array;
    private readonly vs: Float64Array;
    private readonly poleRadius = 0.067;
    private sleeveWidth = 0;
    private sway = 0;
    private phase = 0;
    private elapsed = 0;
    private baseWidth: number;
    private baseHeight: number;

    constructor(baseWidth: number, baseHeight: number) {
        if (![baseWidth, baseHeight].every(n => Number.isFinite(n) && n > 0)) {
            throw new RangeError('Textile dimensions must be finite and positive');
        }
        this.baseWidth = this.width = baseWidth;
        this.baseHeight = this.height = baseHeight;
        this.positions = new Float32Array((this.columns + 1) * (this.rows + 1) * 3);
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
        // Only free edges carry fringe; the wrapped hoist stays clean.
        for (let x = this.sleeveColumns; x < this.columns; x++) this.hem.push({ a: this.index(x, 0), b: this.index(x + 1, 0), inward: this.index(x, 1) });
        for (let y = 0; y < this.rows; y++) this.hem.push({ a: this.index(this.columns, y), b: this.index(this.columns, y + 1), inward: this.index(this.columns - 1, y) });
        for (let x = this.columns; x > this.sleeveColumns; x--) this.hem.push({ a: this.index(x, this.rows), b: this.index(x - 1, this.rows), inward: this.index(x, this.rows - 1) });
        this.rebuildCoordinates();
        this.updateGeometry(true);
    }

    index(x: number, y: number) { return y * (this.columns + 1) + x; }

    configure(values: Partial<DrapeSettings>) {
        const limits: Record<keyof DrapeSettings, [number, number]> = {
            size: [0.65, 1.1], opening: [16, 36], gather: [0, 1], shoulder: [0.04, 0.45],
            hoist: [0.65, 1], fall: [0.7, 1], folds: [2, 10], foldDepth: [0, 1],
            twist: [-45, 45], rotation: [-180, 180],
            bendNear: [-120, 120], bendMiddle: [-120, 120], bendOuter: [-120, 120], edgeCurl: [-120, 120],
        };
        for (const key of Object.keys(values) as (keyof DrapeSettings)[]) {
            const value = values[key];
            if (value !== undefined && Number.isFinite(value) && limits[key]) this.settings[key] = clamp(value, ...limits[key]);
        }
        this.settings.folds = Math.round(this.settings.folds);
        this.rebuildCoordinates();
        this.updateGeometry(true);
    }

    resize(width: number, height: number) {
        if (![width, height].every(n => Number.isFinite(n) && n > 0)) return;
        this.baseWidth = width;
        this.baseHeight = height;
        this.rebuildCoordinates();
        this.updateGeometry(true);
    }

    setAttachmentHeight(top: number) {
        if (!Number.isFinite(top)) return;
        this.attachmentY = top;
        this.updateGeometry();
    }

    reset() {
        this.sway = this.phase = this.elapsed = 0;
        this.updateGeometry(true);
    }

    /** Smooth bounded indoor motion. Zero wind settles into the chosen pose. */
    advance(dt: number, wind: Vec3, softness: number) {
        if (!Number.isFinite(dt) || dt <= 0) return false;
        dt = Math.min(dt, 0.1);
        this.elapsed += dt;
        const speed = Math.min(30, wind.length());
        const response = clamp(softness, 0, 1);
        const target = speed / 30 * (0.06 + response * 0.2)
            * Math.sin(this.elapsed * (0.9 + response) + Math.atan2(wind.z, wind.x));
        const previous = this.sway;
        this.sway += (target - this.sway) * -Math.expm1(-dt * (2 + response * 3));
        if (speed === 0 && Math.abs(this.sway) < 1e-6) this.sway = 0;
        const phase = speed / 30 * 0.18 * Math.sin(this.elapsed * 1.3);
        const changed = Math.abs(previous - this.sway) > 1e-8 || Math.abs(this.phase - phase) > 1e-8;
        this.phase = phase;
        if (changed) this.updateGeometry();
        return changed;
    }

    private rebuildCoordinates() {
        this.width = this.baseWidth * this.settings.size;
        this.height = this.baseHeight * this.settings.size;
        this.sleeveWidth = Math.min(0.24, this.width * 0.06);
        // Concentrate vertices at the shoulder, where angular pleats change fastest.
        // Unlike compressing positions at the apex, this keeps every triangle open.
        const shoulderU = this.settings.shoulder / this.settings.fall;
        const shoulderV = this.settings.shoulder / this.settings.hoist;
        const widthCurve = Math.log1p((this.width - this.sleeveWidth) / shoulderU);
        const heightCurve = Math.log1p(this.height / shoulderV);
        for (let x = 0; x <= this.columns; x++) this.us[x] = x <= this.sleeveColumns ? this.sleeveWidth * x / this.sleeveColumns
            : this.sleeveWidth + shoulderU * Math.expm1((x - this.sleeveColumns) / this.bodyColumns * widthCurve);
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
    private yaw = 0;
    get appliedBendStrength() { return this.curve.bendScale; }

    private updateGeometry(reorient = false) {
        const s = this.settings, neck = s.shoulder / s.hoist;
        this.curve.build(s, neck, this.sway, this.phase);
        if (reorient) {
            const u = this.width - this.sleeveWidth, v = this.height + neck;
            const radius = Math.hypot(u, v);
            this.curve.sample(Math.atan2(u, v), this.sample);
            this.yaw = Math.PI / 2 - Math.atan2(radius * this.sample.z, this.poleRadius + radius * this.sample.x) + radians(s.rotation);
        }
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        for (let y = 0; y <= this.rows; y++) {
            const v = this.vs[y];
            for (let x = 0; x <= this.columns; x++) {
                const i = this.index(x, y) * 3;
                let px: number, py: number, pz: number;
                if (x <= this.sleeveColumns) {
                    const angle = -(1 - x / this.sleeveColumns) * this.sleeveWidth / this.poleRadius;
                    px = this.poleRadius * Math.cos(angle); pz = this.poleRadius * Math.sin(angle); py = this.attachmentY - v;
                } else {
                    const u = this.us[x] - this.sleeveWidth;
                    const radius = Math.hypot(u, v + neck);
                    this.curve.sample(Math.atan2(u, v + neck), this.sample);
                    px = this.poleRadius + radius * this.sample.x;
                    py = this.attachmentY + neck + radius * this.sample.y;
                    pz = radius * this.sample.z;
                }
                this.positions[i] = px * cy - pz * sy;
                this.positions[i + 1] = py;
                this.positions[i + 2] = px * sy + pz * cy;
            }
        }
        this.geometry.update();
    }

    dispose() { this.geometry.dispose(); }
}
