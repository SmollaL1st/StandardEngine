import { clamp, smoothstep } from '../core/math';
import { hash } from '../core/random';
import type { RGB } from '../core/color';
import type { FlagCloth } from './FlagCloth';
import { Geometry, Mesh, material } from './Mesh';

export interface FringeStyle {
    visible: boolean;
    /** Strand length, m. */
    length: number;
    /** Strand radius, m. */
    radius: number;
    /** Strands per metre of edge. */
    density: number;
    header: boolean;
    /** Width of the braid that carries the fringe, m. */
    headerWidth: number;
    color: RGB;
}

const RINGS = 6;
const SIDES = 4;
export const VERTICES_PER_STRAND = RINGS * (SIDES + 1) + 1;
const PER_STRAND = VERTICES_PER_STRAND;
const VARIATION = 6;

/**
 * Fine twisted fringe on the free edges: hundreds of thin metallic threads per
 * metre that leave the hem and hang limp under their own weight, plus the braid
 * (galloon) sewn over the hem. Each thread has its own length, lean, twist phase
 * and shade; threads are darker near the hem, where their neighbours shade them.
 * Roots are fixed in material coordinates, so they never slide along a moving edge.
 */
export class Fringe {
    readonly strands = new Mesh('fringe', new Geometry(), material('strand', [1, 0.77, 0.34], { roughness: 0.38, stripes: [1, 450] }));
    // Woven galloon: a fine diagonal twill rather than coarse ribs.
    readonly header = new Mesh('fringe-header', new Geometry(), material('strand', [1, 0.77, 0.34], { roughness: 0.5, stripes: [5, 900] }));
    style: FringeStyle;
    private readonly cloth: FlagCloth;
    private path = { points: new Int32Array(), inward: new Int32Array() };
    private segment = new Int32Array();
    private param = new Float32Array();
    private variation = new Float32Array();
    private along = new Float32Array();

    constructor(cloth: FlagCloth, style: FringeStyle) {
        this.cloth = cloth;
        this.style = style;
        this.rebuild();
    }

    configure(style: FringeStyle) {
        const rebuild = style.density !== this.style.density || style.header !== this.style.header;
        this.style = style;
        this.strands.material.color = style.color; this.header.material.color = style.color;
        this.strands.visible = style.visible; this.header.visible = style.visible && style.header;
        if (rebuild) this.rebuild(); else this.update();
    }

    /** Re-samples strand roots; needed when density or the cloth's render detail changes. */
    rebuild() {
        const cloth = this.cloth, cols = cloth.rnx + 1;
        this.path = cloth.edgePath();
        const { points } = this.path, m = points.length;
        this.along = new Float32Array(m);
        const materialAt = (id: number) => [(id % cols) / cloth.rnx * cloth.width, Math.floor(id / cols) / cloth.rny * cloth.height];
        for (let k = 1; k < m; k++) {
            const [ax, ay] = materialAt(points[k - 1]), [bx, by] = materialAt(points[k]);
            this.along[k] = this.along[k - 1] + Math.hypot(bx - ax, by - ay);
        }
        const total = this.along[m - 1];
        const count = clamp(Math.round(total * this.style.density), 0, 12000);
        this.segment = new Int32Array(count); this.param = new Float32Array(count); this.variation = new Float32Array(count * VARIATION);
        let k = 0;
        for (let s = 0; s < count; s++) {
            const distance = (s + 0.5) / count * total;
            while (k < m - 2 && this.along[k + 1] < distance) k++;
            this.segment[s] = k;
            this.param[s] = (distance - this.along[k]) / Math.max(1e-9, this.along[k + 1] - this.along[k]);
            const v = s * VARIATION;
            this.variation[v] = 0.86 + 0.22 * hash(s * 1.37 + 0.5) ** 1.5;      // length
            this.variation[v + 1] = hash(s * 7.11 + 2.3) < 0.5 ? -1 : 1;         // which face it falls on
            this.variation[v + 2] = hash(s * 3.91 + 9.7) * 2 - 1;                // lean along the hem
            this.variation[v + 3] = hash(s * 5.37 + 4.1) * 2 - 1;                // lean off the face
            this.variation[v + 4] = hash(s * 2.17 + 7.3);                        // twist phase
            this.variation[v + 5] = hash(s * 9.13 + 1.9);                        // shade
        }
        const indices: number[] = [];
        for (let s = 0; s < count; s++) {
            const base = s * PER_STRAND;
            for (let r = 0; r < RINGS - 1; r++) for (let i = 0; i < SIDES; i++) {
                const a = base + r * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
                indices.push(a, b, c, b, d, c);
            }
            const tip = base + PER_STRAND - 1, last = base + (RINGS - 1) * (SIDES + 1);
            for (let i = 0; i < SIDES; i++) indices.push(last + i, last + i + 1, tip);
        }
        const vertices = count * PER_STRAND;
        this.strands.geometry.set({
            positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3),
            uvs: new Float32Array(vertices * 2), tangents: new Float32Array(vertices * 3), ao: new Float32Array(vertices * 2),
            indices: Uint32Array.from(indices),
        });
        const headerIndices: number[] = [];
        for (let k = 0; k < m - 1; k++) for (let side = 0; side < 2; side++) {
            const a = k * 4 + side * 2, b = a + 1, c = a + 4, d = c + 1;
            headerIndices.push(a, b, c, b, d, c);
        }
        this.header.geometry.set({
            positions: new Float32Array(m * 4 * 3), normals: new Float32Array(m * 4 * 3), uvs: new Float32Array(m * 4 * 2),
            tangents: new Float32Array(m * 4 * 3), indices: Uint32Array.from(headerIndices),
        });
        this.update();
    }

    update() {
        if (!this.strands.visible && !this.header.visible) return;
        const surface = this.cloth.surface, cp = surface.positions, cn = surface.normals;
        const { points, inward } = this.path, m = points.length;
        const st = this.style, g = this.strands.geometry;
        const P = g.positions, N = g.normals, UV = g.uvs, T = g.tangents!, AO = g.ao!;
        const scratch = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, ox: 0, oy: 0, oz: 0, ex: 0, ey: 0, ez: 0 };
        const frameAt = (k: number, t: number) => {
            const a = points[k] * 3, b = points[Math.min(m - 1, k + 1)] * 3;
            const ia = inward[k] * 3, ib = inward[Math.min(m - 1, k + 1)] * 3;
            const s = scratch;
            s.px = cp[a] + (cp[b] - cp[a]) * t; s.py = cp[a + 1] + (cp[b + 1] - cp[a + 1]) * t; s.pz = cp[a + 2] + (cp[b + 2] - cp[a + 2]) * t;
            s.nx = cn[a] + (cn[b] - cn[a]) * t; s.ny = cn[a + 1] + (cn[b + 1] - cn[a + 1]) * t; s.nz = cn[a + 2] + (cn[b + 2] - cn[a + 2]) * t;
            let l = Math.hypot(s.nx, s.ny, s.nz) || 1; s.nx /= l; s.ny /= l; s.nz /= l;
            s.ex = cp[b] - cp[a]; s.ey = cp[b + 1] - cp[a + 1]; s.ez = cp[b + 2] - cp[a + 2];
            if (k === m - 1) { const c = points[k - 1] * 3; s.ex = cp[a] - cp[c]; s.ey = cp[a + 1] - cp[c + 1]; s.ez = cp[a + 2] - cp[c + 2]; }
            l = Math.hypot(s.ex, s.ey, s.ez) || 1; s.ex /= l; s.ey /= l; s.ez /= l;
            const ix = cp[ia] + (cp[ib] - cp[ia]) * t, iy = cp[ia + 1] + (cp[ib + 1] - cp[ia + 1]) * t, iz = cp[ia + 2] + (cp[ib + 2] - cp[ia + 2]) * t;
            let ox = s.px - ix, oy = s.py - iy, oz = s.pz - iz;
            const along = ox * s.ex + oy * s.ey + oz * s.ez;
            ox -= s.ex * along; oy -= s.ey * along; oz -= s.ez * along;
            const normal = ox * s.nx + oy * s.ny + oz * s.nz;
            ox -= s.nx * normal; oy -= s.ny * normal; oz -= s.nz * normal;
            l = Math.hypot(ox, oy, oz) || 1; s.ox = ox / l; s.oy = oy / l; s.oz = oz / l;
            return s;
        };
        if (this.strands.visible) {
            const count = this.segment.length, radius = st.radius, segment = st.length / (RINGS - 1);
            const pitch = 1 / Math.max(1, this.strands.material.stripes[1]);
            for (let s = 0; s < count; s++) {
                const f = frameAt(this.segment[s], this.param[s]), v = s * VARIATION;
                const scale = this.variation[v], side = this.variation[v + 1], leanEdge = this.variation[v + 2];
                const leanFace = this.variation[v + 3], phase = this.variation[v + 4] * pitch, shade = this.variation[v + 5];
                // The thread leaves the hem just off one face of the cloth...
                const lift = radius * (1.2 + 1.6 * Math.abs(leanFace));
                let x = f.px + f.ox * radius * 0.5 + f.nx * side * lift;
                let y = f.py + f.oy * radius * 0.5 + f.ny * side * lift;
                let z = f.pz + f.oz * radius * 0.5 + f.nz * side * lift;
                const d0x = f.ox * 0.55 + f.nx * side * 0.25 + f.ex * leanEdge * 0.15;
                const d0y = f.oy * 0.55 + f.ny * side * 0.25 + f.ey * leanEdge * 0.15 - 0.25;
                const d0z = f.oz * 0.55 + f.nz * side * 0.25 + f.ez * leanEdge * 0.15;
                // ...and, being limp, soon hangs straight down, fanned out a little.
                const hx = f.ex * leanEdge * 0.07 + f.nx * (side * 0.06 + leanFace * 0.05);
                const hz = f.ez * leanEdge * 0.07 + f.nz * (side * 0.06 + leanFace * 0.05);
                let along = 0;
                for (let r = 0; r < RINGS; r++) {
                    const t = r / (RINGS - 1), w = smoothstep(0, 0.32, t);
                    let dx = d0x * (1 - w) + hx * w, dy = d0y * (1 - w) - w, dz = d0z * (1 - w) + hz * w;
                    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
                    if (r > 0) { x += dx * segment * scale; y += dy * segment * scale; z += dz * segment * scale; along += segment * scale; }
                    // Cross-section frame: perpendicular to the thread, roughly along the hem.
                    let sx = dy * f.ez - dz * f.ey, sy = dz * f.ex - dx * f.ez, sz = dx * f.ey - dy * f.ex;
                    let sl = Math.hypot(sx, sy, sz);
                    if (sl < 0.2) { sx = dy * f.nz - dz * f.ny; sy = dz * f.nx - dx * f.nz; sz = dx * f.ny - dy * f.nx; sl = Math.hypot(sx, sy, sz) || 1; }
                    sx /= sl; sy /= sl; sz /= sl;
                    const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
                    // Cut ends untwist slightly and flare.
                    const rr = radius * (r === RINGS - 1 ? 1.15 : 1 - 0.12 * t);
                    // Neighbouring threads and the braid shade the roots.
                    const occlusion = 0.55 * (1 - t) ** 1.6 + 0.2 * shade;
                    for (let i = 0; i <= SIDES; i++) {
                        const phi = i / SIDES * Math.PI * 2 + t * 1.3, c = Math.cos(phi), sn = Math.sin(phi);
                        const nx = sx * c + ux * sn, ny = sy * c + uy * sn, nz = sz * c + uz * sn;
                        const o = (s * PER_STRAND + r * (SIDES + 1) + i);
                        P[o * 3] = x + nx * rr; P[o * 3 + 1] = y + ny * rr; P[o * 3 + 2] = z + nz * rr;
                        N[o * 3] = nx; N[o * 3 + 1] = ny; N[o * 3 + 2] = nz;
                        T[o * 3] = dx; T[o * 3 + 1] = dy; T[o * 3 + 2] = dz;
                        UV[o * 2] = i / SIDES; UV[o * 2 + 1] = along + phase;
                        AO[o * 2] = occlusion; AO[o * 2 + 1] = occlusion;
                    }
                    if (r === RINGS - 1) {
                        const o = s * PER_STRAND + PER_STRAND - 1;
                        P[o * 3] = x + dx * rr * 0.5; P[o * 3 + 1] = y + dy * rr * 0.5; P[o * 3 + 2] = z + dz * rr * 0.5;
                        N[o * 3] = dx; N[o * 3 + 1] = dy; N[o * 3 + 2] = dz;
                        T[o * 3] = dx; T[o * 3 + 1] = dy; T[o * 3 + 2] = dz;
                        UV[o * 2] = 0.5; UV[o * 2 + 1] = along + phase;
                        AO[o * 2] = occlusion; AO[o * 2 + 1] = occlusion;
                    }
                }
            }
            g.touch();
        }
        if (this.header.visible) {
            const h = this.header.geometry, HP = h.positions, HN = h.normals, HU = h.uvs, HT = h.tangents!;
            const offset = Math.max(0.0006, st.radius * 0.5), width = st.headerWidth;
            for (let k = 0; k < m; k++) {
                const f = frameAt(Math.min(k, m - 1), 0);
                for (let side = 0; side < 2; side++) {
                    const sign = side === 0 ? 1 : -1;
                    for (let e = 0; e < 2; e++) {
                        const o = k * 4 + side * 2 + e, inset = e === 0 ? -width * 0.15 : width;
                        HP[o * 3] = f.px - f.ox * inset + f.nx * sign * offset;
                        HP[o * 3 + 1] = f.py - f.oy * inset + f.ny * sign * offset;
                        HP[o * 3 + 2] = f.pz - f.oz * inset + f.nz * sign * offset;
                        HN[o * 3] = f.nx * sign + f.ox * (e === 0 ? 0.6 : 0); HN[o * 3 + 1] = f.ny * sign + f.oy * (e === 0 ? 0.6 : 0);
                        HN[o * 3 + 2] = f.nz * sign + f.oz * (e === 0 ? 0.6 : 0);
                        const l = Math.hypot(HN[o * 3], HN[o * 3 + 1], HN[o * 3 + 2]) || 1;
                        HN[o * 3] /= l; HN[o * 3 + 1] /= l; HN[o * 3 + 2] /= l;
                        HT[o * 3] = f.ex; HT[o * 3 + 1] = f.ey; HT[o * 3 + 2] = f.ez;
                        HU[o * 2] = e; HU[o * 2 + 1] = this.along[k];
                    }
                }
            }
            h.touch();
        }
    }

    dispose() { this.strands.geometry.dispose(); this.header.geometry.dispose(); }
}
