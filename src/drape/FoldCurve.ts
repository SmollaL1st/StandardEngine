import { Vec3, clamp, radians } from '../engine/math';
import type { DrapeSettings } from './CeremonialDrape';

const STEPS = 4096;
const DOMAIN = Math.PI / 2;

/** Two opposite smooth turns form a pleat without flattening the whole cone. */
function pleat(t: number, center: number, angle: number) {
    const distance = (t - center) / 0.18;
    return Math.abs(distance) < 1 ? radians(angle) / (0.18 / 2)
        * Math.sin(Math.PI * distance) * (0.5 + 0.5 * Math.cos(Math.PI * distance)) : 0;
}

/** A unit-speed spherical curve with concave folds and staff clearance. */
export class FoldCurve {
    readonly points = new Float64Array((STEPS + 1) * 3);
    bendScale = 1;
    private readonly point = new Vec3();
    private readonly tangent = new Vec3();
    private readonly binormal = new Vec3();
    private readonly poleRadius: number;
    constructor(poleRadius: number) { this.poleRadius = poleRadius; }

    build(s: DrapeSettings, neck: number, sway: number, phase: number) {
        if (this.integrate(s, neck, sway, phase, 1)) { this.bendScale = 1; return; }
        // Pull an impossible profile back to a safe bend strength.
        // Moving vertices out of the staff or reflecting a sampled curve would
        // shorten triangle edges and squeeze the printed image at the contact.
        let safe = 0, blocked = 1;
        for (let i = 0; i < 10; i++) {
            const strength = (safe + blocked) / 2;
            if (this.integrate(s, neck, sway, phase, strength)) safe = strength; else blocked = strength;
        }
        this.bendScale = safe;
        this.integrate(s, neck, sway, phase, safe);
    }

    private integrate(s: DrapeSettings, neck: number, sway: number, phase: number, strength: number) {
        const beta = radians(clamp(s.opening + (0.65 - s.gather) * 6 + (1 - s.fall) * 20, 16, 40));
        const curvature = 1 / Math.tan(beta), step = DOMAIN / STEPS;
        const q = this.point.set(0, -1, 0), t = this.tangent.set(0, 0, 1);
        q.toArray(this.points);
        for (let i = 1; i <= STEPS; i++) {
            const theta = (i - 0.5) * step, u = theta / DOMAIN;
            const k = curvature + strength * (s.foldDepth * 6 * Math.sin(theta * s.folds * 4 + phase)
                + pleat(u, 0.15, s.bendNear) + pleat(u, 0.4, s.bendMiddle)
                + pleat(u, 0.65, s.bendOuter) + pleat(u, 0.9, s.edgeCurl)
                + (radians(s.twist) + sway) * Math.sin(theta) * 0.4);
            this.turn(-k * step / 2);
            const qx = q.x, qy = q.y, qz = q.z, tx = t.x, ty = t.y, tz = t.z;
            const c = Math.cos(step), sn = Math.sin(step);
            q.set(qx * c + tx * sn, qy * c + ty * sn, qz * c + tz * sn);
            t.set(tx * c - qx * sn, ty * c - qy * sn, tz * c - qz * sn);
            this.turn(-k * step / 2);
            // All material rays have r >= neck. This checks the cylinder itself,
            // so the free cloth can use both sides of the staff.
            if (2 * this.poleRadius * q.x + neck * (q.x * q.x + q.z * q.z) < -1e-12) return false;
            q.toArray(this.points, i * 3);
        }
        return true;
    }

    private turn(angle: number) {
        this.binormal.crossVectors(this.point, this.tangent);
        this.tangent.multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal, Math.sin(angle));
    }

    sample(theta: number, out: Vec3) {
        const index = clamp(theta / DOMAIN * STEPS, 0, STEPS);
        const a = Math.min(STEPS - 1, Math.floor(index)), t = index - a, p = this.points;
        return out.set(p[a * 3] * (1 - t) + p[(a + 1) * 3] * t,
            p[a * 3 + 1] * (1 - t) + p[(a + 1) * 3 + 1] * t,
            p[a * 3 + 2] * (1 - t) + p[(a + 1) * 3 + 2] * t).normalize();
    }
}
