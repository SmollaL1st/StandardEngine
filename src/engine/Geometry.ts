/** CPU mesh data owned by this engine; GPU buffers are owned by Renderer. */
export class Geometry {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
    revision = 0;
    disposed = false;
    constructor(positions = new Float32Array(), indices: number[] | Uint32Array = [], uvs?: Float32Array) {
        this.positions = positions;
        this.normals = new Float32Array(positions.length);
        this.uvs = uvs ?? new Float32Array(positions.length / 3 * 2);
        this.indices = new Uint32Array(indices);
    }
    update() {
        const p = this.positions, n = this.normals, ids = this.indices;
        n.fill(0);
        for (let i = 0; i < ids.length; i += 3) {
            const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
            const ax = p[b] - p[a], ay = p[b + 1] - p[a + 1], az = p[b + 2] - p[a + 2];
            const bx = p[c] - p[a], by = p[c + 1] - p[a + 1], bz = p[c + 2] - p[a + 2];
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
            n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
            n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
        }
        for (let i = 0; i < n.length; i += 3) {
            const length = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
            n[i] /= length; n[i + 1] /= length; n[i + 2] /= length;
        }
        this.revision++;
    }
    dispose() { this.disposed = true; }
}

export class ImageTexture {
    readonly image: HTMLImageElement;
    disposed = false;
    constructor(image: HTMLImageElement) { this.image = image; }
    get width() { return this.image.naturalWidth; }
    get height() { return this.image.naturalHeight; }
    dispose() { this.disposed = true; }
    static async load(url: string) {
        const image = new Image();
        image.src = url;
        await image.decode();
        return new ImageTexture(image);
    }
}

export type Material = {
    color: [number, number, number]; kind: 'cloth' | 'gold' | 'wood' | 'base' | 'floor';
    sheen: number; toon: boolean; texture?: ImageTexture;
};
export class RenderMesh {
    geometry: Geometry;
    material: Material;
    visible = true;
    castShadow = true;
    doubleSided = true;
    constructor(geometry: Geometry, material: Material) { this.geometry = geometry; this.material = material; }
}
