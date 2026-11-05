import { identity, type Mat4 } from '../core/math';
import type { RGB } from '../core/color';

export interface GeometryData {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    /** Thread / strand direction for anisotropic shading. */
    tangents?: Float32Array;
    /** Occlusion of the front (x) and back (y) side of thin cloth. */
    ao?: Float32Array;
    indices: Uint32Array;
}

/** CPU mesh data. `revision` asks for a data upload, `layout` for new GPU buffers. */
export class Geometry {
    positions: Float32Array = new Float32Array();
    normals: Float32Array = new Float32Array();
    uvs: Float32Array = new Float32Array();
    tangents: Float32Array | null = null;
    ao: Float32Array | null = null;
    indices: Uint32Array = new Uint32Array();
    revision = 0;
    layout = 0;
    disposed = false;
    constructor(data?: GeometryData) { if (data) this.set(data); }
    set(data: GeometryData) {
        this.positions = data.positions; this.normals = data.normals; this.uvs = data.uvs;
        this.tangents = data.tangents ?? null; this.ao = data.ao ?? null; this.indices = data.indices;
        this.layout++; this.revision++;
        return this;
    }
    touch() { this.revision++; }
    dispose() { this.disposed = true; }
}

export class ImageTexture {
    readonly source: TexImageSource;
    readonly width: number;
    readonly height: number;
    readonly name: string;
    disposed = false;
    constructor(source: TexImageSource, width: number, height: number, name = 'flag') {
        this.source = source; this.width = width; this.height = height; this.name = name;
    }
    dispose() { this.disposed = true; }
}

export type MaterialType = 'cloth' | 'metal' | 'lacquer' | 'strand' | 'floor' | 'catcher';

export interface Material {
    type: MaterialType;
    /** Linear base colour; for metals this is F0. */
    color: RGB;
    roughness: number;
    specular: number;
    sheen: number;
    anisotropy: number;
    translucency: number;
    weave: number;
    grain: number;
    /** Stripe frequencies across (x) and along (y) the UV direction, for twisted cords. */
    stripes: [number, number];
    texture: ImageTexture | null;
    /** Physical size of the textile, for the weave pattern. */
    size: [number, number];
    /** Mirror the image left to right. */
    flipU: boolean;
}

export function material(type: MaterialType, color: RGB, values: Partial<Material> = {}): Material {
    return {
        type, color, roughness: 0.5, specular: 0.5, sheen: 0, anisotropy: 0, translucency: 0, weave: 0, grain: 0,
        stripes: [0, 0], texture: null, size: [1, 1], flipU: false, ...values,
    };
}

export class Mesh {
    geometry: Geometry;
    material: Material;
    model: Mat4 = identity();
    visible = true;
    castShadow = true;
    readonly name: string;
    constructor(name: string, geometry: Geometry, mat: Material) {
        this.name = name; this.geometry = geometry; this.material = mat;
    }
}
