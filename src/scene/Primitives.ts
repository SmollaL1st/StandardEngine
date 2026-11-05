import { Vec3 } from '../core/math';
import type { GeometryData } from './Mesh';

export type Profile = [radius: number, y: number][];

function pack(positions: number[], normals: number[], uvs: number[], tangents: number[], indices: number[]): GeometryData {
    return {
        positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs),
        tangents: Float32Array.from(tangents), indices: Uint32Array.from(indices),
    };
}

/**
 * Surface of revolution about +y. The profile runs from the bottom centre
 * outwards and up to the top centre. Repeating a point makes a crease there.
 * UV: x around (0..1), y along the profile in metres. Tangent follows the profile.
 */
export function lathe(profile: Profile, segments = 64): GeometryData {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], tangents: number[] = [], indices: number[] = [];
    const n = profile.length;
    const same = (a: number, b: number) => b >= 0 && b < n && Math.abs(profile[a][0] - profile[b][0]) < 1e-9 && Math.abs(profile[a][1] - profile[b][1]) < 1e-9;
    const segment = (a: number, b: number) => {
        const dr = profile[b][0] - profile[a][0], dy = profile[b][1] - profile[a][1], l = Math.hypot(dr, dy);
        return l < 1e-12 ? null : [dy / l, -dr / l, dr / l, dy / l];
    };
    let distance = 0;
    for (let k = 0; k < n; k++) {
        if (k > 0) distance += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]);
        const before = k > 0 && !same(k, k + 1) ? segment(k - 1, k) : null;
        const after = k < n - 1 && !same(k, k - 1) ? segment(k, k + 1) : null;
        let nr = (before?.[0] ?? 0) + (after?.[0] ?? 0), ny = (before?.[1] ?? 0) + (after?.[1] ?? 0);
        let tr = (before?.[2] ?? 0) + (after?.[2] ?? 0), ty = (before?.[3] ?? 0) + (after?.[3] ?? 0);
        const nl = Math.hypot(nr, ny) || 1, tl = Math.hypot(tr, ty) || 1;
        nr /= nl; ny /= nl; tr /= tl; ty /= tl;
        for (let i = 0; i <= segments; i++) {
            const phi = i / segments * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
            positions.push(profile[k][0] * c, profile[k][1], profile[k][0] * s);
            normals.push(nr * c, ny, nr * s);
            tangents.push(tr * c, ty, tr * s);
            uvs.push(i / segments, distance);
        }
    }
    for (let k = 0; k < n - 1; k++) for (let i = 0; i < segments; i++) {
        const a = k * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    return pack(positions, normals, uvs, tangents, indices);
}

/** A tube along a polyline. UV: x around, y along in metres. Tangent along the curve. */
export function tube(points: Vec3[], radius: number | ((t: number) => number), sides = 10, caps = true): GeometryData {
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], tangents: number[] = [], indices: number[] = [];
    const r = typeof radius === 'number' ? () => radius : radius;
    const tangent = new Vec3(), side = new Vec3(), up = new Vec3(), reference = new Vec3(0, 0, 1);
    let along = 0;
    for (let k = 0; k < points.length; k++) {
        const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
        tangent.subVectors(b, a).normalize();
        if (k > 0) along += points[k].distanceTo(points[k - 1]);
        if (Math.abs(tangent.dot(reference)) > 0.95) reference.set(1, 0, 0);
        side.crossVectors(tangent, reference).normalize();
        up.crossVectors(side, tangent).normalize();
        reference.copy(up);
        const t = k / (points.length - 1), radiusAt = r(t);
        for (let i = 0; i <= sides; i++) {
            const phi = i / sides * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
            const nx = side.x * c + up.x * s, ny = side.y * c + up.y * s, nz = side.z * c + up.z * s;
            positions.push(points[k].x + nx * radiusAt, points[k].y + ny * radiusAt, points[k].z + nz * radiusAt);
            normals.push(nx, ny, nz); tangents.push(tangent.x, tangent.y, tangent.z); uvs.push(i / sides, along);
        }
    }
    for (let k = 0; k < points.length - 1; k++) for (let i = 0; i < sides; i++) {
        const a = k * (sides + 1) + i, b = a + 1, c = a + sides + 1, d = c + 1;
        indices.push(a, b, c, b, d, c);
    }
    if (caps) for (const [k, sign] of [[0, -1], [points.length - 1, 1]] as const) {
        const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
        tangent.subVectors(b, a).normalize().scale(sign);
        const centre = positions.length / 3;
        positions.push(points[k].x, points[k].y, points[k].z); normals.push(tangent.x, tangent.y, tangent.z);
        tangents.push(1, 0, 0); uvs.push(0.5, along * (sign > 0 ? 1 : 0));
        for (let i = 0; i < sides; i++) {
            const ring = k * (sides + 1);
            if (sign > 0) indices.push(centre, ring + i, ring + i + 1); else indices.push(centre, ring + i + 1, ring + i);
        }
    }
    return pack(positions, normals, uvs, tangents, indices);
}

type VecMap = (v: Vec3) => void;

/**
 * Applies an affine map: `point` maps positions, `direction` the linear part
 * (tangents) and `normal` the inverse transpose of that linear part.
 */
export function transform(data: GeometryData, point: VecMap, direction: VecMap, normal: VecMap = direction): GeometryData {
    const v = new Vec3();
    const positions = data.positions.slice(), normals = data.normals.slice(), tangents = data.tangents?.slice();
    for (let i = 0; i < positions.length; i += 3) {
        point(v.fromArray(positions, i)); v.toArray(positions, i);
        normal(v.fromArray(normals, i)); v.normalize().toArray(normals, i);
        if (tangents) { direction(v.fromArray(tangents, i)); v.normalize().toArray(tangents, i); }
    }
    return { ...data, positions, normals, tangents };
}

export const translate = (data: GeometryData, x: number, y: number, z: number) =>
    transform(data, p => { p.x += x; p.y += y; p.z += z; }, () => undefined);

export function rotateY(data: GeometryData, angle: number) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (v: Vec3) => { const x = v.x * c + v.z * s, z = -v.x * s + v.z * c; v.x = x; v.z = z; };
    return transform(data, rotate, rotate);
}

/** Rotates about the z axis around a pivot, for tilted tripod legs and similar parts. */
export function rotateZ(data: GeometryData, angle: number) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (v: Vec3) => { const x = v.x * c - v.y * s, y = v.x * s + v.y * c; v.x = x; v.y = y; };
    return transform(data, rotate, rotate);
}

/** Squashes along z, for flat blades turned on a lathe. */
export function flattenZ(data: GeometryData, factor: number) {
    return transform(data, p => { p.z *= factor; }, t => { t.z *= factor; }, n => { n.z /= factor; });
}

export function merge(parts: GeometryData[]): GeometryData {
    const vertices = parts.reduce((sum, part) => sum + part.positions.length / 3, 0);
    const indexCount = parts.reduce((sum, part) => sum + part.indices.length, 0);
    const out: GeometryData = {
        positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), uvs: new Float32Array(vertices * 2),
        tangents: new Float32Array(vertices * 3), indices: new Uint32Array(indexCount),
    };
    let v = 0, ix = 0;
    for (const part of parts) {
        out.positions.set(part.positions, v * 3); out.normals.set(part.normals, v * 3); out.uvs.set(part.uvs, v * 2);
        if (part.tangents) out.tangents!.set(part.tangents, v * 3);
        for (let i = 0; i < part.indices.length; i++) out.indices[ix + i] = part.indices[i] + v;
        v += part.positions.length / 3; ix += part.indices.length;
    }
    return out;
}

export function disk(radius: number, y: number, segments = 128): GeometryData {
    const positions = [0, y, 0], normals = [0, 1, 0], uvs = [0, 0], tangents = [1, 0, 0], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const phi = i / segments * Math.PI * 2;
        positions.push(radius * Math.cos(phi), y, radius * Math.sin(phi));
        normals.push(0, 1, 0); uvs.push(Math.cos(phi), Math.sin(phi)); tangents.push(1, 0, 0);
        if (i < segments) indices.push(0, i + 2, i + 1);
    }
    return pack(positions, normals, uvs, tangents, indices);
}

/** Sphere as a lathe, so it shares the crease-free normal path. */
export function sphere(radius: number, centreY: number, rings = 24, segments = 48): GeometryData {
    const profile: Profile = [];
    for (let i = 0; i <= rings; i++) {
        const phi = i / rings * Math.PI;
        profile.push([radius * Math.sin(phi), centreY - radius * Math.cos(phi)]);
    }
    return lathe(profile, segments);
}
