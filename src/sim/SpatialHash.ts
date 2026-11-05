/** Dense counting-sort spatial hash for particle neighbourhood queries. */
export class SpatialHash {
    spacing = 1;
    readonly ids: Int32Array;
    count = 0;
    private readonly tableSize: number;
    private readonly cellStart: Int32Array;
    private readonly cellEntries: Int32Array;
    private readonly stamp: Int32Array;
    private query = 0;

    constructor(maxParticles: number) {
        this.tableSize = Math.max(16, maxParticles * 2);
        this.cellStart = new Int32Array(this.tableSize + 1);
        this.cellEntries = new Int32Array(maxParticles);
        this.ids = new Int32Array(maxParticles);
        this.stamp = new Int32Array(maxParticles);
    }

    private cell(xi: number, yi: number, zi: number) {
        const h = Math.imul(xi, 92837111) ^ Math.imul(yi, 689287499) ^ Math.imul(zi, 283923481);
        return (h >>> 0) % this.tableSize;
    }

    build(positions: Float32Array, particles: number, spacing: number) {
        this.spacing = spacing;
        const start = this.cellStart, s = 1 / spacing;
        start.fill(0);
        for (let i = 0; i < particles; i++) {
            start[this.cell(Math.floor(positions[i * 3] * s), Math.floor(positions[i * 3 + 1] * s), Math.floor(positions[i * 3 + 2] * s))]++;
        }
        let sum = 0;
        for (let i = 0; i < this.tableSize; i++) { sum += start[i]; start[i] = sum; }
        start[this.tableSize] = sum;
        for (let i = 0; i < particles; i++) {
            const h = this.cell(Math.floor(positions[i * 3] * s), Math.floor(positions[i * 3 + 1] * s), Math.floor(positions[i * 3 + 2] * s));
            this.cellEntries[--start[h]] = i;
        }
    }

    /** Collects candidate particles within `radius` of a point into `ids[0..count)`. */
    gather(x: number, y: number, z: number, radius: number) {
        const s = 1 / this.spacing;
        const x0 = Math.floor((x - radius) * s), x1 = Math.floor((x + radius) * s);
        const y0 = Math.floor((y - radius) * s), y1 = Math.floor((y + radius) * s);
        const z0 = Math.floor((z - radius) * s), z1 = Math.floor((z + radius) * s);
        const mark = ++this.query;
        this.count = 0;
        for (let xi = x0; xi <= x1; xi++) for (let yi = y0; yi <= y1; yi++) for (let zi = z0; zi <= z1; zi++) {
            const h = this.cell(xi, yi, zi);
            for (let k = this.cellStart[h], end = this.cellStart[h + 1]; k < end; k++) {
                const id = this.cellEntries[k];
                // Distinct cells can share a bucket; report each particle once.
                if (this.stamp[id] === mark) continue;
                this.stamp[id] = mark;
                this.ids[this.count++] = id;
            }
        }
        return this.count;
    }
}
