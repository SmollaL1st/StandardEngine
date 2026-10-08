import { Geometry } from './Geometry';

/** Lathe profiles also build the caps, so all stand parts use the same mesh path. */
export function lathe(profile: [number, number][], segments = 48) {
    const positions: number[] = [], indices: number[] = [];
    profile.forEach(([radius, y]) => {
        for (let i = 0; i <= segments; i++) {
            const phi = i / segments * Math.PI * 2;
            positions.push(radius * Math.cos(phi), y, radius * Math.sin(phi));
        }
    });
    for (let ring = 0; ring < profile.length - 1; ring++) for (let i = 0; i < segments; i++) {
        const a = ring * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    const geometry = new Geometry(new Float32Array(positions), indices); geometry.update(); return geometry;
}
export function cylinder(top: number, bottom: number, low: number, high: number) {
    return lathe([[0, low], [bottom, low], [top, high], [0, high]]);
}
export function sphere(radius: number, centerY: number) {
    const profile: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
        const phi = i / 24 * Math.PI;
        profile.push([radius * Math.sin(phi), centerY - radius * Math.cos(phi)]);
    }
    return lathe(profile);
}
export function torus(major: number, minor: number, centerY: number) {
    const profile: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
        const phi = i / 12 * Math.PI * 2;
        profile.push([major + minor * Math.cos(phi), centerY + minor * Math.sin(phi)]);
    }
    return lathe(profile);
}
export function merge(parts: Geometry[]) {
    const positions = new Float32Array(parts.reduce((sum, part) => sum + part.positions.length, 0));
    const normals = new Float32Array(positions.length), indices: number[] = [];
    let offset = 0;
    for (const part of parts) {
        positions.set(part.positions, offset); normals.set(part.normals, offset);
        for (const id of part.indices) indices.push(id + offset / 3);
        offset += part.positions.length; part.dispose();
    }
    const geometry = new Geometry(positions, indices); geometry.normals.set(normals); geometry.revision++; return geometry;
}
export function floor(radius: number, y: number) {
    const positions = [0, y, 0], indices: number[] = [];
    for (let i = 0; i <= 96; i++) {
        const phi = i / 96 * Math.PI * 2; positions.push(radius * Math.cos(phi), y, radius * Math.sin(phi));
        if (i < 96) indices.push(0, i + 2, i + 1);
    }
    const geometry = new Geometry(new Float32Array(positions), indices); geometry.update(); return geometry;
}
