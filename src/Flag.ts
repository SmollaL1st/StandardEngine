import { RenderMesh } from './engine/Geometry';
import type { Vec3 } from './engine/math';
import { CeremonialDrape, type DrapeSettings } from './drape/CeremonialDrape';
import { Fringe } from './rendering/Fringe';
import { createFlagMaterial, type FlagMaterialStyle } from './rendering/Material';

export class Flag {
    readonly drape: CeremonialDrape;
    readonly fringe: Fringe;
    readonly mesh: RenderMesh;
    get meshes() { return [this.mesh, this.fringe.mesh]; }
    constructor(width: number, height: number, style: FlagMaterialStyle = 'Default') {
        this.drape = new CeremonialDrape(width, height);
        this.mesh = new RenderMesh(this.drape.geometry, createFlagMaterial(style));
        this.fringe = new Fringe(this.drape);
    }
    configure(settings: Partial<DrapeSettings>) { this.drape.configure(settings); this.fringe.rebuild(); }
    resize(width: number, height: number) { this.drape.resize(width, height); this.fringe.rebuild(); }
    setAttachmentHeight(top: number) { this.drape.setAttachmentHeight(top); this.fringe.update(); }
    setFringe(length: number, density: number, visible: boolean) { this.fringe.configure(length, density, visible); }
    setSheen(value: number) { this.mesh.material.sheen = value; }
    setMaterialStyle(style: FlagMaterialStyle) { this.mesh.material.toon = style === 'Anime'; }
    reset() { this.drape.reset(); this.fringe.update(); }
    advance(dt: number, wind: Vec3, softness: number) {
        if (this.drape.advance(dt, wind, softness) && this.fringe.mesh.visible) this.fringe.update();
    }
    dispose() { this.drape.dispose(); this.fringe.dispose(); this.mesh.material.texture?.dispose(); }
}
