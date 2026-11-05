import { Vec3, clamp, identity, lerp, multiply, rotationY, translation, radians, type Mat4 } from '../core/math';
import type { RGB } from '../core/color';
import { rng } from '../core/random';
import { OrbitCamera } from '../render/Camera';
import { buildRig } from '../render/Lighting';
import { Renderer, type Frame } from '../render/Renderer';
import { blitTile, canvasToBlob, cropViewProjection, download, outputSize, pad, projectBounds, tileRect, tiles, type NdcRect } from '../render/Export';
import { FlagCloth } from '../scene/FlagCloth';
import { Fringe, type FringeStyle } from '../scene/Fringe';
import { buildHardware, layoutFor, type HardwareLayout } from '../scene/Hardware';
import { Geometry, Mesh, material, type ImageTexture, type Material } from '../scene/Mesh';
import { disk } from '../scene/Primitives';
import type { PoseParams } from '../sim/DrapePose';
import { ImageInput, baseName, loadImage } from '../ui/ImageInput';
import { Panel, type ChangeKind } from '../ui/Panel';
import { FABRICS, POLE_HEIGHT, clearSavedSettings, defaultSettings, loadSettings, saveSettings, type Settings } from './Settings';

const GOLD: RGB = [1.0, 0.75, 0.36];
const SILVER: RGB = [0.9, 0.9, 0.88];
const SETTLE_SECONDS = 1.6;

/** Owns the scene, the simulation loop, the panel and image export. */
export class App {
    readonly settings: Settings;
    readonly renderer: Renderer;
    readonly camera = new OrbitCamera();
    private readonly viewport: HTMLElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly toast: HTMLElement;
    private readonly input: ImageInput;
    private readonly panel: Panel;
    private texture: ImageTexture | null = null;
    private imageName = 'flag';
    private aspect = 1.5;
    private readonly layout: HardwareLayout = layoutFor(POLE_HEIGHT);
    private cloth: FlagCloth | null = null;
    private fringe: Fringe | null = null;
    private hardware: Mesh[] = [];
    private readonly metal = material('metal', [1.0, 0.74, 0.33], { roughness: 0.2 });
    private readonly pole = material('lacquer', [0.24, 0.11, 0.05], { roughness: 0.16, grain: 1, specular: 1 });
    private readonly clothMaterial: Material = material('cloth', [1, 1, 1]);
    private readonly clothMesh = new Mesh('cloth', new Geometry(), this.clothMaterial);
    private readonly floor = new Mesh('floor', new Geometry(disk(60, 0)), material('catcher', [0, 0, 0]));
    private flagModel: Mat4 = rotationY(0);
    private settle = 0;
    private dirty = true;
    private exporting = false;
    private animation = 0;
    private last = 0;
    private saveTimer = 0;
    private toastTimer = 0;
    private loadId = 0;
    private readonly resize = new ResizeObserver(() => { this.dirty = true; });

    constructor(viewport: HTMLElement, panelHost: HTMLElement) {
        this.viewport = viewport;
        this.canvas = viewport.querySelector('canvas')!;
        this.toast = viewport.querySelector('.toast')!;
        this.settings = loadSettings();
        this.renderer = new Renderer(this.canvas);
        this.camera.attach(this.canvas);
        this.camera.onChange = () => { this.dirty = true; };
        this.floor.castShadow = false;
        this.input = new ImageInput(viewport, (file, name) => void this.loadFlag(file, name));
        this.panel = new Panel(panelHost, this.settings, {
            upload: () => this.input.open(),
            newFolds: () => this.newFolds(),
            resetView: () => this.fitCamera(true),
            exportPNG: () => void this.exportImage('download'),
            copyPNG: () => void this.exportImage('copy'),
            resetAll: () => this.resetAll(),
            changed: kind => this.changed(kind),
        });
        this.resize.observe(this.canvas);
        this.canvas.addEventListener('rendererror', e => this.notify((e as CustomEvent<string>).detail, true));
        viewport.querySelector('[data-action=upload]')?.addEventListener('click', () => this.input.open());
        viewport.querySelector('[data-action=folds]')?.addEventListener('click', () => this.newFolds());
        viewport.querySelector('[data-action=save]')?.addEventListener('click', () => void this.exportImage('download'));
        this.rebuild();
        this.fitCamera(true);
        this.applyView();
    }

    async start(defaultImage: string) {
        await this.loadFlag(defaultImage, 'Flag.svg', true);
        this.last = performance.now();
        this.animation = requestAnimationFrame(this.frame);
    }

    // ---------------------------------------------------------------- settings

    private changed(kind: ChangeKind) {
        switch (kind) {
            case 'size': this.rebuild(); break;
            case 'yaw': case 'mirror': this.updateModels(); this.applyMaterial(); break;
            case 'fabric': this.applyMaterial(); this.cloth?.setParams(this.physics()); break;
            case 'material': this.applyMaterial(); break;
            case 'pose': this.applyPose(); break;
            case 'sag': this.cloth?.setParams(this.physics()); break;
            case 'fringe': this.fringe?.configure(this.fringeStyle()); this.rebuildHardware(); break;
            case 'view': this.applyView(); break;
            case 'light': case 'style': case 'output': break;
        }
        this.dirty = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => saveSettings(this.settings), 400);
    }

    private resetAll() {
        clearSavedSettings();
        const fresh = defaultSettings();
        for (const key of Object.keys(fresh) as (keyof Settings)[]) Object.assign(this.settings[key], fresh[key]);
        this.panel.refresh();
        this.rebuild(); this.fitCamera(true); this.applyView();
        this.notify('Настройки сброшены');
    }

    private newFolds() {
        const random = rng(Date.now()), d = this.settings.drape;
        d.seed = 1 + Math.floor(random() * 998);
        d.folds = clamp(Math.round(d.folds + (random() - 0.5) * 2.4), 3, 8);
        d.foldDepth = clamp(d.foldDepth + (random() - 0.5) * 0.16, 0.25, 0.7);
        this.panel.refresh();
        this.changed('pose');
    }

    // ------------------------------------------------------------------- scene

    private pose(): PoseParams {
        const d = this.settings.drape;
        return { opening: d.opening, folds: d.folds, foldDepth: d.foldDepth, seed: d.seed };
    }

    /** "Sag" lets gravity win over the chosen dome: 0 keeps the shape, 1 is free cloth. */
    private physics() {
        const fabric = FABRICS[this.settings.flag.fabric];
        return {
            bendingRigidity: 10 ** lerp(-6.3, -3.6, fabric.stiffness),
            shapeHold: lerp(0.85, 0.15, this.settings.drape.sag),
            damping: 0.45,
        };
    }

    private fringeStyle(): FringeStyle {
        const f = this.settings.fringe;
        // Fine twisted fringe of 0.9 mm threads on a narrow braid.
        return {
            visible: f.show, length: clamp(f.length, 1, 12) / 100, radius: 0.00045, density: clamp(f.density, 10, 200) * 10,
            header: true, headerWidth: 0.007, color: f.color === 'gold' ? GOLD : SILVER,
        };
    }

    private rebuild() {
        const s = this.settings, L = this.layout;
        s.flag.height = clamp(s.flag.height, 0.3, L.apexY - L.poleBottom - 0.1);
        this.cloth?.dispose(); this.fringe?.dispose();
        const width = s.flag.height * this.aspect, height = s.flag.height;
        const fringe = this.fringeStyle();
        // Metallic fringe and its braid weigh about 35 g per metre of edge.
        const edgeMass = fringe.visible ? 0.035 : 0;
        const cloth = this.cloth = new FlagCloth({
            width, height, pose: this.pose(), resolution: 44, detail: 4, cuff: 0.07,
            areaDensity: FABRICS[s.flag.fabric].density, edgeMass, hoistOffset: L.hoistOffset, poleRadius: L.poleRadius,
        });
        cloth.setParams(this.physics());
        cloth.setColliders([{ radius: L.poleRadius + 0.0012, min: L.poleBottom - L.apexY - 0.2, max: L.finialTop - L.apexY }], -L.apexY + 0.004);
        this.clothMesh.geometry = cloth.surface;
        this.fringe = new Fringe(cloth, fringe);
        this.fringe.configure(fringe);
        this.rebuildHardware();
        this.applyMaterial();
        this.updateModels();
        this.settle = SETTLE_SECONDS;
    }

    private rebuildHardware() {
        this.hardware.forEach(m => m.geometry.dispose());
        const color = this.settings.fringe.color === 'gold' ? GOLD : SILVER;
        this.metal.color = this.settings.fringe.color === 'gold' ? [1.0, 0.74, 0.33] : [0.94, 0.93, 0.91];
        this.metal.roughness = this.settings.fringe.color === 'gold' ? 0.2 : 0.1;
        this.hardware = buildHardware({
            cord: this.settings.fringe.cord, pole: this.pole, metal: this.metal,
            cordMaterial: material('strand', color, { roughness: 0.4, stripes: [3, 150] }),
        }, this.layout);
        this.updateModels();
    }

    private applyMaterial() {
        const f = this.settings.flag, fabric = FABRICS[f.fabric], m = this.clothMaterial;
        m.roughness = fabric.roughness; m.anisotropy = fabric.anisotropy; m.sheen = fabric.sheen;
        m.translucency = fabric.translucency; m.weave = fabric.weave; m.specular = f.gloss;
        m.texture = this.texture;
        m.size = [f.height * this.aspect, f.height];
        m.flipU = f.flipImage;
        this.dirty = true;
    }

    private applyPose() {
        if (!this.cloth) return;
        this.cloth.setPose(this.pose(), true);
        this.fringe?.update();
        this.settle = SETTLE_SECONDS;
    }

    private applyView() {
        this.viewport.dataset.backdrop = this.settings.view.backdrop;
        this.dirty = true;
    }

    private updateModels() {
        // Mirroring reflects the whole standard: the cone winds the other way and,
        // as on a real flag wound backwards, shows its reverse (mirrored) face.
        const mirror = identity();
        if (this.settings.flag.mirror) mirror[0] = -1;
        const model = multiply(rotationY(radians(this.settings.flag.yaw)), mirror);
        this.flagModel = multiply(model, translation(0, this.layout.apexY, 0));
        for (const m of this.hardware) m.model = model;
        this.clothMesh.model = this.flagModel;
        if (this.fringe) { this.fringe.strands.model = this.flagModel; this.fringe.header.model = this.flagModel; }
        this.dirty = true;
    }

    private fitCamera(resetAngles: boolean) {
        const top = this.layout.finialTop;
        // Leave room under the stand for the toolbar.
        this.camera.fit(new Vec3(0.1, top * 0.47, 0), top * 1.18, resetAngles);
    }

    async loadFlag(source: Blob | string, name: string, quiet = false) {
        const id = ++this.loadId;
        try {
            const texture = await loadImage(source, name, this.renderer.maxTexture);
            if (id !== this.loadId) { texture.dispose(); return; }
            this.texture?.dispose();
            this.texture = texture;
            this.imageName = baseName(name);
            const aspect = texture.width / texture.height;
            if (Math.abs(aspect - this.aspect) > 1e-3) { this.aspect = aspect; this.rebuild(); }
            this.applyMaterial();
            if (!quiet) this.notify(`Загружено: ${name} (${texture.width}×${texture.height})`);
        } catch (error) {
            console.error(error);
            if (id === this.loadId) this.notify('Не удалось открыть изображение. Подойдут PNG, JPEG, WebP или SVG.', true);
        }
    }

    // -------------------------------------------------------------------- loop

    private frame = (time: number) => {
        this.animation = requestAnimationFrame(this.frame);
        const dt = Math.min(0.05, Math.max(0, (time - this.last) / 1000));
        this.last = time;
        if (this.exporting) return;
        if (this.cloth) {
            // A fresh drape falls into place faster than real time.
            const fast = this.settle > 0;
            if (fast) this.settle -= dt;
            if (this.cloth.step(fast ? dt * 4 : dt, { x: 0, y: 0, z: 0 }, 0, fast ? 200 : 48)) {
                this.fringe?.update();
                this.dirty = true;
            }
        }
        if (this.dirty && !this.renderer.isLost) { this.dirty = false; this.render(); }
    };

    private meshes() {
        const list: Mesh[] = [this.floor, ...this.hardware, this.clothMesh];
        if (this.fringe) list.push(this.fringe.strands, this.fringe.header);
        return list;
    }

    private makeFrame(viewProj: Mat4, overrides: Partial<Frame> = {}): Frame {
        this.camera.update();
        const r = this.settings.flag.height * this.aspect + 0.25;
        return {
            meshes: this.meshes(), viewProj, eye: this.camera.eye.clone(),
            rig: buildRig(this.settings.light, this.camera.yaw),
            casterBounds: { min: new Vec3(-r, 0, -r), max: new Vec3(r, this.layout.finialTop + 0.02, r) },
            contact: [0, 0, this.layout.footprint, 0.5],
            catcherOpacity: 0.85,
            clear: [0, 0, 0, 0],
            toon: this.settings.view.style === 'anime'
                ? { line: this.settings.view.lineWidth * this.pixelRatio(), nearFar: this.camera.nearFar() } : null,
            ...overrides,
        };
    }

    private pixelRatio() { return Math.min(window.devicePixelRatio || 1, 2); }

    private render() {
        const target = this.renderer.canvasTarget();
        const frame = this.makeFrame(this.camera.viewProjection(target.width / target.height));
        this.renderer.renderShadows(frame);
        this.renderer.draw(frame, target);
    }

    // ------------------------------------------------------------------ export

    /** World points of everything visible, and of its shadow on the floor, for tight framing. */
    private *exportPoints(includeShadow: boolean): Generator<[number, number, number]> {
        const rig = buildRig(this.settings.light, this.camera.yaw), L = rig.key.dir;
        const castShadow = includeShadow && rig.shadows && L.y > 0.05;
        for (const mesh of this.meshes()) {
            if (!mesh.visible || mesh === this.floor) continue;
            const p = mesh.geometry.positions, m = mesh.model, step = Math.max(1, Math.floor(p.length / 3 / 60000)) * 3;
            for (let i = 0; i < p.length; i += step) {
                const x = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12];
                const y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13];
                const z = m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14];
                yield [x, y, z];
                if (castShadow && i % (step * 4) === 0) {
                    const t = Math.min(y / L.y, 10);
                    yield [x - L.x * t, 0, z - L.z * t];
                }
            }
        }
        if (includeShadow) {
            const r = this.layout.footprint * 1.9;
            for (let k = 0; k < 32; k++) yield [Math.cos(k / 32 * Math.PI * 2) * r, 0, Math.sin(k / 32 * Math.PI * 2) * r];
        }
    }

    async exportImage(mode: 'download' | 'copy') {
        if (this.exporting || !this.cloth) return;
        const o = this.settings.output, cloth = this.cloth, previousDetail = cloth.detail;
        this.exporting = true;
        this.notify('Рендер PNG…', false, 60000);
        await new Promise(r => setTimeout(r, 30));
        const floorWas = this.floor.visible;
        try {
            // Finer surface for print resolution; the silhouette of the folds stays round.
            cloth.setDetail(8);
            this.fringe?.rebuild();
            const view = this.renderer.canvasTarget(), aspect = view.width / view.height;
            const viewProj = this.camera.viewProjection(aspect);
            const shadow = o.shadow !== 'none';
            const bounds = projectBounds(viewProj, this.exportPoints(shadow));
            const rect: NdcRect = bounds ? pad(bounds, shadow ? 0.04 : 0.02, aspect) : { x0: -1, x1: 1, y0: -1, y1: 1 };
            const { width, height } = outputSize(rect, view.width, view.height, o.longSide);
            this.floor.visible = o.shadow === 'with';
            const base = this.makeFrame(viewProj);
            // Outlines keep their look at print size: scale them with the export resolution.
            const scale = width / ((rect.x1 - rect.x0) / 2 * view.width);
            if (base.toon) base.toon = { ...base.toon, line: base.toon.line * scale };
            this.renderer.renderShadows(base);
            const main = this.renderTiles(base, viewProj, rect, width, height);
            let shadowLayer: HTMLCanvasElement | null = null;
            if (o.shadow === 'separate') {
                this.floor.visible = true;
                shadowLayer = this.renderTiles({ ...base, receiversOnly: true }, viewProj, rect, width, height);
            }
            const name = `${this.imageName}_${width}x${height}`;
            const blob = await canvasToBlob(main);
            if (mode === 'copy') {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                this.notify(`Скопировано в буфер: ${width}×${height}`);
            } else {
                download(blob, `${name}.png`);
                if (shadowLayer) download(await canvasToBlob(shadowLayer), `${name}_shadow.png`);
                this.notify(`Сохранено: ${name}.png${shadowLayer ? ' и слой тени' : ''}`);
            }
        } catch (error) {
            console.error(error);
            this.notify(mode === 'copy' ? 'Не удалось скопировать. Попробуйте «Сохранить PNG».' : `Ошибка экспорта: ${(error as Error).message}`, true);
        } finally {
            this.floor.visible = floorWas;
            cloth.setDetail(previousDetail);
            this.fringe?.rebuild();
            this.exporting = false;
            this.dirty = true;
        }
    }

    private renderTiles(frame: Frame, viewProj: Mat4, rect: NdcRect, width: number, height: number) {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Слишком большой размер изображения для браузера.');
        const image = ctx.createImageData(width, height);
        // Outline filters look at neighbouring pixels, so anime tiles overlap by a margin.
        const margin = frame.toon ? Math.ceil(frame.toon.line * 2) + 2 : 0;
        for (const t of tiles(width, height, 1024)) {
            const grown = { x: t.x - margin, y: t.y - margin, width: t.width + margin * 2, height: t.height + margin * 2 };
            const tileFrame = { ...frame, viewProj: cropViewProjection(viewProj, tileRect(rect, width, height, grown)) };
            blitTile(this.renderer.drawToPixels(tileFrame, t.width, t.height, 8, margin), t, image.data, width);
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }

    notify(message: string, error = false, duration = 3200) {
        clearTimeout(this.toastTimer);
        this.toast.textContent = message;
        this.toast.classList.toggle('error', error);
        this.toast.classList.add('visible');
        this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), error ? 6000 : duration);
    }

    dispose() {
        cancelAnimationFrame(this.animation);
        this.resize.disconnect();
        this.input.dispose(); this.panel.dispose(); this.camera.dispose();
        this.cloth?.dispose(); this.fringe?.dispose(); this.hardware.forEach(m => m.geometry.dispose());
        this.texture?.dispose(); this.renderer.dispose();
    }
}
