import { clamp, lerp, radians } from '../core/math';
import { noise1 } from '../core/random';

export interface PoseParams {
    /** 0 is a slim cone hugging the staff, 1 a wide one. */
    opening: number;
    /** Pleats per turn around the staff. */
    folds: number;
    foldDepth: number;
    seed: number;
}

const SAMPLES = 4096;
const DOMAIN = Math.PI / 2;

/**
 * Rest pose of a flag wound into a cone ("купол") around its staff.
 *
 * The top hoist corner sits at the top of the staff. Every material ray from
 * that corner keeps its length, so the print is not stretched: the rays follow
 * a unit-speed curve on the unit sphere that circles the staff at a small
 * angle. The angle grows slowly with each turn, so each layer of cloth lies just
 * outside the previous one, and pleats repeat once per turn so the layers nest.
 * The hoist ends up innermost; the top hem and its fringe are the outer layer.
 *
 * Local frame: the staff axis is x = z = 0 and the apex is at the origin.
 */
export class DrapePose {
    /** Unit directions of the material rays, sampled uniformly in material angle. */
    readonly points = new Float64Array((SAMPLES + 1) * 3);
    /** Turns around the staff at each sample, for layer spacing near the apex. */
    readonly turns = new Float64Array(SAMPLES + 1);
    /** Radius of the staff plus a little cloth: nothing is placed inside it. */
    clearance = 0.02;
    totalTurns = 0;
    private params: PoseParams = { opening: 0.3, folds: 3, foldDepth: 0.4, seed: 1 };

    build(params: PoseParams, clearance: number) {
        this.params = { ...params, folds: Math.max(1, Math.round(params.folds)) };
        this.clearance = clearance;
        const p = this.params;
        const a0 = radians(lerp(5, 17, clamp(p.opening, 0, 1)));
        // Spacing between layers, and a slight lean of the whole cone.
        const growth = radians(1.3), lean = radians(2.5);
        const depth = clamp(p.foldDepth, 0, 1) * a0 * 0.42;
        const angle = (theta: number) => {
            const turn = theta / (2 * Math.PI);
            const variation = 1 + 0.35 * noise1(turn * 1.7 + 0.3, p.seed);
            const pleat = depth * variation * (0.5 + 0.5 * Math.sin(p.folds * theta + p.seed * 2.39996 + 0.8 * noise1(turn * 1.3, p.seed + 9)));
            return a0 + growth * turn + pleat;
        };
        const direction = (theta: number, out: number[]) => {
            const a = angle(theta);
            // Winding towards -z keeps the printed (obverse) side of the cloth outwards.
            const x = Math.sin(a) * Math.cos(theta), y = -Math.cos(a), z = -Math.sin(a) * Math.sin(theta);
            out[0] = x * Math.cos(lean) - y * Math.sin(lean); out[1] = x * Math.sin(lean) + y * Math.cos(lean); out[2] = z;
        };
        // Arc length of the curve; resample it by arc length so each material ray keeps its length.
        const fine = 16384, step = 2 * Math.PI / 512;
        const arc: number[] = [0], thetas: number[] = [0];
        const a = [0, 0, 0], b = [0, 0, 0];
        direction(0, a);
        let s = 0, theta = 0;
        for (let i = 0; i < fine * 8 && s < DOMAIN; i++) {
            theta += step;
            direction(theta, b);
            s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            arc.push(s); thetas.push(theta);
            a[0] = b[0]; a[1] = b[1]; a[2] = b[2];
        }
        let k = 0;
        const out = [0, 0, 0];
        for (let i = 0; i <= SAMPLES; i++) {
            const target = i / SAMPLES * Math.min(DOMAIN, s);
            while (k < arc.length - 2 && arc[k + 1] < target) k++;
            const t = (target - arc[k]) / Math.max(1e-12, arc[k + 1] - arc[k]);
            const th = thetas[k] + (thetas[k + 1] - thetas[k]) * clamp(t, 0, 1);
            direction(th, out);
            this.points[i * 3] = out[0]; this.points[i * 3 + 1] = out[1]; this.points[i * 3 + 2] = out[2];
            this.turns[i] = th / (2 * Math.PI);
        }
        this.totalTurns = this.turns[SAMPLES];
    }

    /** Writes the rest position of material point (u along the top hem, v down the hoist). */
    map(u: number, v: number, out: Float32Array, index: number) {
        const r = Math.hypot(u, v);
        const phi = r < 1e-12 ? 0 : Math.atan2(u, v);
        const f = clamp(phi / DOMAIN * SAMPLES, 0, SAMPLES);
        const a = Math.min(SAMPLES - 1, Math.floor(f)), t = f - a, pts = this.points;
        let x = pts[a * 3] * (1 - t) + pts[a * 3 + 3] * t;
        let y = pts[a * 3 + 1] * (1 - t) + pts[a * 3 + 4] * t;
        let z = pts[a * 3 + 2] * (1 - t) + pts[a * 3 + 5] * t;
        const l = Math.hypot(x, y, z) || 1; x = x / l * r; y = y / l * r; z = z / l * r;
        // Near the apex the cone is narrower than the staff: the cloth gathers round
        // it instead, each layer a few millimetres outside the one below.
        const turns = this.turns[a] * (1 - t) + this.turns[a + 1] * t;
        const rho = Math.hypot(x, z), wanted = this.clearance + 0.0028 * turns;
        const radius = Math.sqrt(rho * rho + wanted * wanted);
        const angle = rho > 1e-9 ? Math.atan2(z, x) : -turns * 2 * Math.PI;
        out[index] = Math.cos(angle) * radius; out[index + 1] = y; out[index + 2] = Math.sin(angle) * radius;
    }
}
