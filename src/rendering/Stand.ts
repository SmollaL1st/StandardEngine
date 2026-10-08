import { Geometry, RenderMesh, type Material } from '../engine/Geometry';
import { cylinder, floor, merge, sphere, torus } from '../engine/Primitives';

const material = (kind: Material['kind'], color: Material['color']): Material => ({ kind, color, sheen: 0, toon: false });

export class Stand {
    poleLength = 7.5;
    flagHeight = 3;
    readonly pole = new RenderMesh(new Geometry(), material('wood', [0.22, 0.15, 0.10]));
    readonly gold = new RenderMesh(new Geometry(), material('gold', [0.83, 0.67, 0.31]));
    readonly base = new RenderMesh(cylinder(0.38, 0.5, -5.075, -4.925), material('base', [0.07, 0.07, 0.075]));
    readonly floor = new RenderMesh(floor(22, -5.08), material('floor', [0.15, 0.155, 0.16]));
    get meshes() { return [this.floor, this.base, this.pole, this.gold]; }
    get flagTop() { return -5 + this.poleLength - 0.1; }
    constructor() { this.floor.castShadow = false; this.floor.doubleSided = false; this.updatePole(this.poleLength); }
    updatePole(length: number) {
        this.poleLength = length;
        this.pole.geometry.dispose(); this.pole.geometry = cylinder(0.05, 0.05, -5, -5 + length);
        this.updateAttachments(this.flagHeight);
    }
    updateAttachments(height: number) {
        this.flagHeight = height;
        const top = -5 + this.poleLength;
        this.gold.geometry.dispose();
        this.gold.geometry = merge([
            sphere(0.09, top + 0.05), cylinder(0, 0.045, top + 0.12, top + 0.48),
            ...[0, 0.5, 1].map(t => torus(0.064, 0.01, this.flagTop - height * t)),
        ]);
    }
    dispose() { this.meshes.forEach(mesh => mesh.geometry.dispose()); }
}
