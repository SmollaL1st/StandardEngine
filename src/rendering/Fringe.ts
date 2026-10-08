import { Geometry, RenderMesh } from '../engine/Geometry';
import { Vec3, clamp } from '../engine/math';
import type { CeremonialDrape, HemSegment } from '../drape/CeremonialDrape';

type Sample = HemSegment & { t: number };

/** Rounded cords follow the actual hem; density is measured per world-space metre. */
export class Fringe {
    readonly mesh = new RenderMesh(new Geometry(), { kind: 'cloth', color: [0.83, 0.7, 0.35], sheen: 0.5, toon: false });
    length = 0.075;
    density = 60;
    private samples: Sample[] = [];
    private count = 0;
    private readonly point = new Vec3();
    private readonly a = new Vec3();
    private readonly b = new Vec3();
    private readonly inward = new Vec3();
    private readonly tangent = new Vec3();
    private readonly outward = new Vec3();
    private readonly direction = new Vec3();
    private readonly side = new Vec3();
    private readonly normal = new Vec3();
    private readonly vertex = new Vec3();
    private readonly drape: CeremonialDrape;

    constructor(drape: CeremonialDrape) {
        this.drape = drape;
        this.rebuild();
    }

    configure(length: number, density: number, visible: boolean) {
        this.length = clamp(length, 0.015, 0.2);
        const nextDensity = clamp(density, 10, 100);
        this.mesh.visible = visible;
        if (nextDensity !== this.density) {
            this.density = nextDensity;
            this.rebuild();
        } else this.update();
    }

    rebuild() {
        const pos = this.drape.geometry.positions;
        const distances = [0];
        for (const edge of this.drape.hem) {
            this.a.fromArray(pos, edge.a * 3);
            this.b.fromArray(pos, edge.b * 3);
            distances.push(distances.at(-1)! + this.a.distanceTo(this.b));
        }
        const perimeter = distances.at(-1)!;
        this.count = Math.min(2600, Math.max(120, Math.round(perimeter * this.density * 2)));
        this.samples = [];
        const indices: number[] = [];
        let segment = 0;
        for (let i = 0; i < this.count; i++) {
            const distance = (i + 0.5) / this.count * perimeter;
            while (segment < this.drape.hem.length - 1 && distances[segment + 1] < distance) segment++;
            this.samples.push({ ...this.drape.hem[segment], t: (distance - distances[segment]) / (distances[segment + 1] - distances[segment]) });
            for (let ring = 0; ring < 4; ring++) {
                for (let side = 0; side < 5; side++) {
                    const a = i * 25 + ring * 5 + side;
                    const b = i * 25 + ring * 5 + (side + 1) % 5;
                    indices.push(a, b, b + 5, a, b + 5, a + 5);
                }
            }
            const tip = i * 25 + 20;
            indices.push(tip, tip + 2, tip + 1, tip, tip + 3, tip + 2, tip, tip + 4, tip + 3);
        }
        const borderOffset = this.count * 25;
        this.drape.hem.forEach((edge, i) => {
            this.samples.push({ ...edge, t: 0 });
            const a = borderOffset + i * 2;
            indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
        });
        this.samples.push({ ...this.drape.hem.at(-1)!, t: 1 });
        this.mesh.geometry.dispose();
        const geometry = new Geometry(new Float32Array((borderOffset + (this.drape.hem.length + 1) * 2) * 3), indices);
        this.mesh.geometry = geometry;
        this.update();
    }

    update() {
        const cloth = this.drape.geometry.positions;
        const positions = this.mesh.geometry.positions;
        let offset = 0;
        this.samples.forEach((sample, i) => {
            this.a.fromArray(cloth, sample.a * 3);
            this.b.fromArray(cloth, sample.b * 3);
            this.inward.fromArray(cloth, sample.inward * 3);
            this.point.lerpVectors(this.a, this.b, sample.t);
            this.tangent.subVectors(this.b, this.a).normalize();
            this.outward.subVectors(this.a, this.inward);
            this.outward.addScaledVector(this.tangent, -this.outward.dot(this.tangent)).normalize();
            if (i >= this.count) {
                this.point.toArray(positions, offset);
                this.point.addScaledVector(this.outward, -Math.min(0.017, this.drape.width * 0.1, this.drape.height * 0.1)).toArray(positions, offset + 3);
                offset += 6;
                return;
            }
            const noise = Math.sin(i * 12.9898) * 43758.5453;
            const length = this.length * (0.82 + 0.23 * (noise - Math.floor(noise)));
            const bend = Math.min(0.015, length * 0.23);
            for (let ring = 0; ring < 5; ring++) {
                const t = ring / 4;
                const radius = 0.0022 * (1 - t * 0.15);
                this.direction.copy(this.outward).multiplyScalar(bend * 4 * Math.exp(-4 * t));
                this.direction.y -= length;
                this.direction.normalize();
                this.side.crossVectors(this.direction, this.tangent).normalize();
                if (this.side.lengthSq() < 0.1) this.side.set(0, 0, 1);
                this.normal.crossVectors(this.side, this.direction).normalize();
                for (let side = 0; side < 5; side++) {
                    const angle = side / 5 * Math.PI * 2 + t * 0.6;
                    this.vertex.copy(this.point).addScaledVector(this.outward, bend * (1 - Math.exp(-4 * t)))
                        .addScaledVector(this.side, Math.cos(angle) * radius)
                        .addScaledVector(this.normal, Math.sin(angle) * radius)
                        .addScaledVector(this.tangent, t * t * 0.003 * Math.sin(i * 2.14));
                    this.vertex.y -= length * t;
                    this.vertex.toArray(positions, offset);
                    offset += 3;
                }
            }
        });
        this.mesh.geometry.update();
    }

    dispose() {
        this.mesh.geometry.dispose();
    }
}
