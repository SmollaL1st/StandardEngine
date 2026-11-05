import { Vec3 } from '../core/math';
import { Geometry, Mesh, material, type GeometryData, type Material } from './Mesh';
import { flattenZ, lathe, merge, sphere, translate, tube, type Profile } from './Primitives';

export interface HardwareLayout {
    poleRadius: number;
    poleBottom: number;
    poleTop: number;
    /** Height of the top of the hoist. */
    apexY: number;
    finialTop: number;
    /** Innermost radius of the cloth wound round the staff. */
    hoistOffset: number;
    /** Radius of the base on the floor, for contact shading. */
    footprint: number;
}

export interface HardwareOptions {
    cord: boolean;
    pole: Material;
    metal: Material;
    cordMaterial: Material;
}

/** A floor standard: 32 mm staff in a weighted round base, spear finial on top. */
export function layoutFor(poleHeight: number): HardwareLayout {
    const poleRadius = 0.016, poleBottom = 0.1, poleTop = Math.max(poleHeight, 0.6);
    return {
        poleRadius, poleBottom, poleTop,
        apexY: poleTop - 0.036,
        finialTop: poleTop + 0.215,
        hoistOffset: poleRadius + 0.0022,
        footprint: 0.165,
    };
}

function ring(radius: number, y: number, height: number, bevel = 0.25): GeometryData {
    const b = height * bevel;
    return lathe([[0, y], [radius - b, y], [radius - b, y], [radius, y + b], [radius, y + height - b], [radius - b, y + height], [radius - b, y + height], [0, y + height]]);
}

function torus(major: number, minor: number, y: number): GeometryData {
    const profile: Profile = [];
    for (let i = 0; i <= 16; i++) {
        const phi = -Math.PI / 2 + i / 16 * Math.PI * 2;
        profile.push([major + minor * Math.cos(phi), y + minor * Math.sin(phi)]);
    }
    return lathe(profile, 48);
}

function spearFinial(top: number, rp: number): GeometryData[] {
    const collar: Profile = [[0, top], [rp * 1.18, top], [rp * 1.18, top], [rp * 1.18, top + 0.010], [rp * 1.55, top + 0.014],
        [rp * 1.55, top + 0.021], [rp * 1.2, top + 0.026], [0.0075, top + 0.031], [0.0075, top + 0.031], [0.0075, top + 0.04], [0, top + 0.04]];
    const blade: Profile = [[0, top + 0.06]];
    for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        blade.push([0.036 * Math.sin(Math.PI * t ** 0.62) ** 0.95 + 0.0035 * (1 - t), top + 0.062 + 0.15 * t]);
    }
    blade.push([0, top + 0.215]);
    // The flat leaf of the spear lies in the plane of the flag.
    return [lathe(collar, 64), sphere(0.0155, top + 0.05), flattenZ(lathe(blade, 64), 0.2), ring(0.0105, top + 0.058, 0.006)];
}

function bezier(a: Vec3, b: Vec3, c: Vec3, d: Vec3, steps: number) {
    const points: Vec3[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        points.push(new Vec3(
            u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
            u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
            u * u * u * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t * t * t * d.z));
    }
    return points;
}

function tassel(at: Vec3): GeometryData[] {
    const s = 1;
    const L = 0.088 * s;
    const skirt: Profile = [[0, -L], [0.021 * s, -L], [0.021 * s, -L], [0.0225 * s, -L * 0.93], [0.0205 * s, -L * 0.62],
        [0.015 * s, -L * 0.3], [0.0095 * s, -L * 0.08], [0.0075 * s, 0], [0, 0.001 * s]];
    return [
        translate(lathe(skirt, 48), at.x, at.y - 0.016 * s, at.z),
        sphere(0.0115 * s, at.y - 0.004 * s, 16, 32), ring(0.0085 * s, at.y - 0.018 * s, 0.004 * s),
    ].map((part, i) => i === 0 ? part : translate(part, at.x, 0, at.z));
}

/** Staff, finial, base, sleeve rings and the cord with tassels, in the flag's local frame. */
export function buildHardware(o: HardwareOptions, L: HardwareLayout): Mesh[] {
    const rp = L.poleRadius;
    const meshes: Mesh[] = [];
    const add = (name: string, parts: GeometryData[], mat: Material) => {
        if (parts.length) meshes.push(new Mesh(name, new Geometry(merge(parts)), mat));
    };
    add('pole', [lathe([[0, L.poleBottom], [rp, L.poleBottom], [rp, L.poleBottom], [rp, L.poleTop], [rp, L.poleTop], [0, L.poleTop]], 64)], o.pole);

    const metal: GeometryData[] = [...spearFinial(L.poleTop, rp)];
    // The ring that ties the top of the cone to the staff.
    metal.push(ring(rp * 1.55, L.apexY - 0.012, 0.03, 0.2));
    metal.push(ring(rp * 1.25, L.poleBottom - 0.002, 0.03, 0.2));
    const R = 0.165;
    metal.push(lathe([[0, 0], [R, 0], [R, 0], [R, 0.010], [R, 0.010], [R * 0.985, 0.016], [R * 0.93, 0.022], [R * 0.76, 0.034],
        [R * 0.52, 0.05], [R * 0.32, 0.066], [0.034, 0.077], [0.034, 0.077], [0.034, 0.092], [0.034, 0.092], [0.029, 0.096],
        [0.029, 0.1], [0.025, 0.104], [0, 0.104]], 96));
    add('fittings', metal, o.metal);

    if (o.cord) {
        const y = L.apexY + 0.02, start = -rp * 1.1;
        const cord: GeometryData[] = [torus(rp * 1.12, 0.0042, y)], tassels: GeometryData[] = [];
        const ends = [new Vec3(-0.042, y - 0.36, 0.03), new Vec3(-0.026, y - 0.44, -0.016)];
        for (const [k, end] of ends.entries()) {
            const a = new Vec3(start, y - 0.004, k ? -0.004 : 0.004);
            const path = bezier(a, a.clone().add(new Vec3(-0.03, -0.06, k ? -0.01 : 0.015)), end.clone().add(new Vec3(0, 0.15, 0)), end, 40);
            cord.push(tube(path, 0.0028, 10));
            tassels.push(...tassel(end));
        }
        add('cord', cord, o.cordMaterial);
        // Tassel skirts are many fine threads: stripes run around, not along.
        add('tassels', tassels, material('strand', o.cordMaterial.color, { roughness: o.cordMaterial.roughness + 0.1, stripes: [64, 0] }));
    }
    return meshes;
}
