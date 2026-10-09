import { clamp, type Vec3 } from '../engine/math';

export interface ClothParameters {
    /** Resistance to changing the target's folds; zero gives a supple cloth. */
    bending: number;
    /** Weak attraction to the chosen pose. Zero leaves the cloth free to hang. */
    drape: number;
    /** Air and internal damping, independent of the render frame rate. */
    damping: number;
}

/** A small XPBD cloth solver. Rendering can interpolate this simulation mesh. */
export class ClothDynamics {
    readonly positions: Float32Array;
    readonly velocities: Float32Array;
    private readonly previous: Float32Array;
    private readonly target: Float32Array;
    private readonly pinned: Uint8Array;
    private readonly inverseMass: Float32Array;
    private readonly normals: Float32Array;
    private readonly indices: Uint32Array;
    private readonly edgeA: Uint32Array;
    private readonly edgeB: Uint32Array;
    private readonly lengths: Float32Array;
    private readonly materialLengths: Float32Array;
    private readonly lambdas: Float32Array;
    private readonly bendA: Uint32Array;
    private readonly bendB: Uint32Array;
    private readonly bendLengths: Float32Array;
    private readonly bendLambdas: Float32Array;
    private readonly targetLambdas: Float32Array;
    private readonly tetherAnchors: Uint32Array;
    private readonly tetherLengths: Float32Array;
    private parameters: ClothParameters = { bending: 0.35, drape: 0.6, damping: 0.45 };
    private accumulator = 0;
    private readonly step = 1 / 120;
    private readonly iterations = 24;
    // Leave room for curved display triangles interpolated between these nodes.
    private readonly poleRadius = 0.064;
    private readonly floor = -5.02;

    constructor(positions: Float32Array, uvs: Float32Array, indices: Uint32Array,
        width: number, height: number, pinned: Uint8Array) {
        const count = positions.length / 3;
        if (!Number.isInteger(count) || count < 3 || uvs.length !== count * 2 || pinned.length !== count ||
            indices.length % 3 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
            !positions.every(Number.isFinite) || !uvs.every(Number.isFinite) || !indices.every(id => id < count)) {
            throw new Error('Invalid cloth mesh');
        }
        this.positions = positions.slice();
        this.velocities = new Float32Array(positions.length);
        this.previous = positions.slice();
        this.target = positions.slice();
        this.pinned = pinned.slice();
        this.inverseMass = new Float32Array(count);
        this.normals = new Float32Array(positions.length);
        this.indices = indices.slice();
        this.targetLambdas = new Float32Array(positions.length);
        this.tetherAnchors = new Uint32Array(count);
        this.tetherLengths = new Float32Array(count);
        const anchors: number[] = [];
        for (let i = 0; i < count; i++) if (pinned[i]) anchors.push(i);
        for (let i = 0; i < count; i++) {
            let nearest = Infinity;
            for (const anchor of anchors) {
                const distance = Math.hypot((uvs[i * 2] - uvs[anchor * 2]) * width,
                    (uvs[i * 2 + 1] - uvs[anchor * 2 + 1]) * height);
                if (distance < nearest) { nearest = distance; this.tetherAnchors[i] = anchor; }
            }
            // A maximum geodesic distance transfers load to the cuff without
            // waiting for many local iterations along tiny shoulder cells.
            this.tetherLengths[i] = nearest * 1.02;
        }

        const edges = new Map<string, { a: number; b: number; opposite: number }>();
        const bends = new Map<string, [number, number]>();
        for (let i = 0; i < indices.length; i += 3) {
            const a = indices[i], b = indices[i + 1], c = indices[i + 2];
            const abU = (uvs[b * 2] - uvs[a * 2]) * width, abV = (uvs[b * 2 + 1] - uvs[a * 2 + 1]) * height;
            const acU = (uvs[c * 2] - uvs[a * 2]) * width, acV = (uvs[c * 2 + 1] - uvs[a * 2 + 1]) * height;
            const areaPerVertex = Math.abs(abU * acV - abV * acU) / 6;
            this.inverseMass[a] += areaPerVertex; this.inverseMass[b] += areaPerVertex; this.inverseMass[c] += areaPerVertex;
            for (const [first, second, opposite] of [[a, b, c], [b, c, a], [c, a, b]]) {
                const lo = Math.min(first, second), hi = Math.max(first, second), key = `${lo},${hi}`;
                const shared = edges.get(key);
                if (!shared) edges.set(key, { a: lo, b: hi, opposite });
                else if (shared.opposite !== opposite) {
                    const left = Math.min(shared.opposite, opposite), right = Math.max(shared.opposite, opposite);
                    bends.set(`${left},${right}`, [left, right]);
                }
            }
        }
        const averageArea = this.inverseMass.reduce((sum, area) => sum + area, 0) / count;
        if (!Number.isFinite(averageArea) || averageArea <= 0) throw new Error('Cloth material must have a positive area');
        for (let i = 0; i < count; i++) {
            // Small shoulder cells should not carry the mass of large hem cells.
            // Normalising keeps the compliance scale independent of mesh density.
            this.inverseMass[i] = pinned[i] ? 0 : averageArea / Math.max(this.inverseMass[i], averageArea * 1e-4);
        }
        this.edgeA = new Uint32Array(edges.size); this.edgeB = new Uint32Array(edges.size);
        this.lengths = new Float32Array(edges.size); this.materialLengths = new Float32Array(edges.size);
        this.lambdas = new Float32Array(edges.size);
        let edgeIndex = 0;
        for (const { a, b } of edges.values()) {
            const du = (uvs[a * 2] - uvs[b * 2]) * width;
            const dv = (uvs[a * 2 + 1] - uvs[b * 2 + 1]) * height;
            const length = Math.hypot(du, dv);
            if (length < 1e-7) throw new Error('Cloth vertices must have distinct material coordinates');
            this.edgeA[edgeIndex] = a; this.edgeB[edgeIndex] = b; this.materialLengths[edgeIndex++] = length;
        }
        const bendPairs = Array.from(bends.entries()).filter(([key]) => !edges.has(key));
        this.bendA = new Uint32Array(bendPairs.map(([, pair]) => pair[0]));
        this.bendB = new Uint32Array(bendPairs.map(([, pair]) => pair[1]));
        this.bendLengths = new Float32Array(bendPairs.length);
        this.bendLambdas = new Float32Array(bendPairs.length);
        this.updateRestLengths();
    }

    setParameters(parameters: Partial<ClothParameters>) {
        for (const key of ['bending', 'drape', 'damping'] as const) {
            const value = parameters[key];
            if (value !== undefined && Number.isFinite(value)) this.parameters[key] = clamp(value, 0, 1);
        }
    }

    setTarget(target: Float32Array, reset = false) {
        if (target.length !== this.positions.length || !target.every(Number.isFinite)) throw new Error('Invalid cloth target');
        this.target.set(target);
        this.updateRestLengths();
        if (reset) this.reset();
        else this.pinVertices();
    }

    reset() {
        this.positions.set(this.target); this.previous.set(this.target); this.velocities.fill(0);
        this.lambdas.fill(0); this.bendLambdas.fill(0); this.targetLambdas.fill(0);
        this.accumulator = 0;
    }

    translate(dx: number, dy: number, dz: number) {
        if (![dx, dy, dz].every(Number.isFinite)) return;
        for (let i = 0; i < this.positions.length; i += 3) {
            this.positions[i] += dx; this.positions[i + 1] += dy; this.positions[i + 2] += dz;
            this.previous[i] += dx; this.previous[i + 1] += dy; this.previous[i + 2] += dz;
            this.target[i] += dx; this.target[i + 1] += dy; this.target[i + 2] += dz;
        }
    }

    advance(dt: number, wind: Vec3): boolean {
        if (!Number.isFinite(dt) || dt <= 0) return false;
        // A tab resuming after a pause must not attempt to simulate the whole gap.
        this.accumulator = Math.min(this.accumulator + dt, this.step * 8);
        let changed = false;
        while (this.accumulator + 1e-10 >= this.step) {
            changed = this.substep(wind) || changed;
            this.accumulator = Math.max(0, this.accumulator - this.step);
        }
        return changed;
    }

    private updateRestLengths() {
        for (let i = 0; i < this.edgeA.length; i++) {
            const a = this.edgeA[i] * 3, b = this.edgeB[i] * 3;
            const chord = Math.hypot(this.target[a] - this.target[b], this.target[a + 1] - this.target[b + 1],
                this.target[a + 2] - this.target[b + 2]);
            // A coarse edge spans a curved material arc. Forcing its straight
            // chord to match that arc would open the fine rendered folds. The
            // exact display surface supplies the arc; these nodes keep its chord.
            this.lengths[i] = Math.min(this.materialLengths[i], Math.max(this.materialLengths[i] * 1e-4, chord));
        }
        for (let i = 0; i < this.bendA.length; i++) {
            const a = this.bendA[i] * 3, b = this.bendB[i] * 3;
            // Rest chords follow the chosen shape. Flat rest chords would force a
            // conical flag to open even when its material edge lengths are correct.
            this.bendLengths[i] = Math.max(1e-6, Math.hypot(this.target[a] - this.target[b],
                this.target[a + 1] - this.target[b + 1], this.target[a + 2] - this.target[b + 2]));
        }
    }

    private pinVertices() {
        for (let vertex = 0; vertex < this.pinned.length; vertex++) if (this.pinned[vertex]) {
            const i = vertex * 3;
            for (let axis = 0; axis < 3; axis++) {
                this.positions[i + axis] = this.target[i + axis]; this.velocities[i + axis] = 0;
            }
        }
    }

    private calculateNormals() {
        const p = this.positions, n = this.normals, ids = this.indices;
        n.fill(0);
        for (let i = 0; i < ids.length; i += 3) {
            const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
            const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
            const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
            const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
            n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
            n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
            n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
        }
        for (let i = 0; i < n.length; i += 3) {
            const inverse = 1 / (Math.hypot(n[i], n[i + 1], n[i + 2]) || 1);
            n[i] *= inverse; n[i + 1] *= inverse; n[i + 2] *= inverse;
        }
    }

    private substep(wind: Vec3) {
        const p = this.positions, velocity = this.velocities, old = this.previous, h = this.step;
        const wx = Number.isFinite(wind.x) ? clamp(wind.x, -40, 40) : 0;
        const wy = Number.isFinite(wind.y) ? clamp(wind.y, -40, 40) : 0;
        const wz = Number.isFinite(wind.z) ? clamp(wind.z, -40, 40) : 0;
        const retention = Math.exp(-(0.6 + this.parameters.damping * 9) * h);
        this.calculateNormals(); old.set(p);
        for (let vertex = 0; vertex < this.pinned.length; vertex++) {
            if (this.pinned[vertex]) continue;
            const i = vertex * 3, n = this.normals;
            const rx = wx - velocity[i], ry = wy - velocity[i + 1], rz = wz - velocity[i + 2];
            const pressure = n[i] * rx + n[i + 1] * ry + n[i + 2] * rz;
            const force = clamp(pressure * Math.abs(pressure) * 0.035, -45, 45);
            velocity[i] = velocity[i] * retention + (n[i] * force + rx * 0.04) * h;
            velocity[i + 1] = velocity[i + 1] * retention + (-9.81 + n[i + 1] * force + ry * 0.04) * h;
            velocity[i + 2] = velocity[i + 2] * retention + (n[i + 2] * force + rz * 0.04) * h;
            p[i] += velocity[i] * h; p[i + 1] += velocity[i + 1] * h; p[i + 2] += velocity[i + 2] * h;
        }
        this.pinVertices(); this.lambdas.fill(0); this.bendLambdas.fill(0); this.targetLambdas.fill(0);
        const stretchAlpha = 1e-9 / (h * h);
        const bendAlpha = (0.0002 * (1 - this.parameters.bending) ** 3 + 1e-7) / (h * h);
        const attraction = this.parameters.drape ** 2 * 350;
        const targetAlpha = attraction > 0 ? 1 / (attraction * h * h) : Infinity;
        for (let iteration = 0; iteration < this.iterations; iteration++) {
            this.solveTarget(targetAlpha);
            this.solveDistances(this.bendA, this.bendB, this.bendLengths, this.bendLambdas, bendAlpha, iteration % 2 !== 0);
            this.solveDistances(this.edgeA, this.edgeB, this.lengths, this.lambdas, stretchAlpha, iteration % 2 !== 0);
            this.solveTethers();
            this.collide();
        }
        let changed = false;
        for (let vertex = 0; vertex < this.pinned.length; vertex++) {
            const i = vertex * 3;
            if (this.pinned[vertex]) continue;
            for (let axis = 0; axis < 3; axis++) {
                const displacement = p[i + axis] - old[i + axis];
                velocity[i + axis] = clamp(displacement / h, -20, 20);
                if (Math.abs(displacement) > 1e-7) changed = true;
            }
            // Remove velocity into either obstacle; sliding friction damps contact.
            const radius = Math.hypot(p[i], p[i + 2]);
            if (radius <= this.poleRadius + 1e-5) {
                const nx = p[i] / radius, nz = p[i + 2] / radius;
                const into = Math.min(0, velocity[i] * nx + velocity[i + 2] * nz);
                velocity[i] = (velocity[i] - into * nx) * 0.9;
                velocity[i + 2] = (velocity[i + 2] - into * nz) * 0.9;
            }
            if (p[i + 1] <= this.floor + 1e-5) {
                velocity[i + 1] = Math.max(0, velocity[i + 1]); velocity[i] *= 0.9; velocity[i + 2] *= 0.9;
            }
        }
        return changed;
    }

    private solveTarget(alpha: number) {
        if (!Number.isFinite(alpha)) return;
        for (let vertex = 0; vertex < this.pinned.length; vertex++) if (!this.pinned[vertex]) {
            const i = vertex * 3;
            const weight = this.inverseMass[vertex], weightedAlpha = alpha * weight;
            for (let axis = 0; axis < 3; axis++) {
                const k = i + axis, delta = (this.target[k] - this.positions[k] - weightedAlpha * this.targetLambdas[k]) / (weight + weightedAlpha);
                this.targetLambdas[k] += delta; this.positions[k] += weight * delta;
            }
        }
    }

    private solveDistances(aIds: Uint32Array, bIds: Uint32Array, rest: Float32Array,
        lambda: Float32Array, alpha: number, reverse: boolean) {
        const p = this.positions;
        for (let n = 0; n < aIds.length; n++) {
            const i = reverse ? aIds.length - n - 1 : n;
            const aId = aIds[i], bId = bIds[i], wa = this.inverseMass[aId], wb = this.inverseMass[bId];
            if (wa + wb === 0) continue;
            const a = aId * 3, b = bId * 3, dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
            const distance = Math.hypot(dx, dy, dz);
            if (distance < 1e-9) continue;
            const weightedAlpha = alpha * (wa + wb) / 2;
            const deltaLambda = (-(distance - rest[i]) - weightedAlpha * lambda[i]) / (wa + wb + weightedAlpha);
            lambda[i] += deltaLambda;
            const scale = deltaLambda / distance;
            p[a] += wa * dx * scale; p[a + 1] += wa * dy * scale; p[a + 2] += wa * dz * scale;
            p[b] -= wb * dx * scale; p[b + 1] -= wb * dy * scale; p[b + 2] -= wb * dz * scale;
        }
    }

    private collide() {
        const p = this.positions;
        for (let vertex = 0; vertex < this.pinned.length; vertex++) if (!this.pinned[vertex]) {
            const i = vertex * 3, radius = Math.hypot(p[i], p[i + 2]);
            if (radius < this.poleRadius) {
                const targetRadius = Math.hypot(this.target[i], this.target[i + 2]);
                const nx = radius > 1e-7 ? p[i] / radius : targetRadius > 1e-7 ? this.target[i] / targetRadius : 1;
                const nz = radius > 1e-7 ? p[i + 2] / radius : targetRadius > 1e-7 ? this.target[i + 2] / targetRadius : 0;
                p[i] = nx * this.poleRadius; p[i + 2] = nz * this.poleRadius;
            }
            p[i + 1] = Math.max(this.floor, p[i + 1]);
        }
    }

    private solveTethers() {
        const p = this.positions;
        for (let vertex = 0; vertex < this.pinned.length; vertex++) if (!this.pinned[vertex]) {
            const a = vertex * 3, b = this.tetherAnchors[vertex] * 3;
            const dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
            const distance = Math.hypot(dx, dy, dz), maximum = this.tetherLengths[vertex];
            if (distance > maximum) {
                const scale = maximum / distance;
                p[a] = p[b] + dx * scale; p[a + 1] = p[b + 1] + dy * scale; p[a + 2] = p[b + 2] + dz * scale;
            }
        }
    }
}
