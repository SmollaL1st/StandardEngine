import GUI from 'lil-gui';
import { ImageTexture } from '../engine/Geometry';
import type { Projection } from '../engine/Camera';
import pkg from '../../package.json';
import type { FlagMaterialStyle } from '../rendering/Material';
import { defaultDrape, type DrapeSettings } from '../drape/CeremonialDrape';

export class UIParams {
    drape: DrapeSettings = { ...defaultDrape };
    bendStrength = 100;
    projection: Projection = 'Orthographic';
    windSpeed = 0;
    windDirectionX = 1;
    windDirectionZ = 0.5;
    softness = 0.5;
    enableMotion = true;
    showFringe = true;
    fringeLength = 0.075;
    fringeDensity = 60;
    poleLength = 7.5;
    sheen = 0.3;
    materialType: FlagMaterialStyle = 'Default';
    version = 'v' + pkg.version;
}

export type UICallbacks = {
    onProjectionChange: (value: Projection) => void;
    onResetView: () => void;
    onLoadError: (message: string) => void;
    onResetFlag: () => void;
    onDrapeChange: () => void;
    onUpdatePole: () => void;
    onFringeChange: () => void;
    onSheenChange: (value: number) => void;
    onMaterialChange: (value: FlagMaterialStyle) => void;
};

export class UIController {
    readonly gui: GUI;
    readonly params = new UIParams();
    readonly fileInput: HTMLInputElement;
    private loadId = 0;

    constructor(callbacks: UICallbacks, onTextureLoaded: (aspect: number, texture: ImageTexture) => void) {
        this.gui = new GUI({ title: 'Ceremonial Standard', width: 290 });
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'image/*';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            const id = ++this.loadId;
            ImageTexture.load(url).then(texture => {
                if (id !== this.loadId) { texture.dispose(); return; }
                onTextureLoaded(texture.width / texture.height, texture);
            }).catch(() => {
                if (id === this.loadId) callbacks.onLoadError('Unable to load this image. Try PNG, JPEG or SVG.');
            }).finally(() => {
                URL.revokeObjectURL(url);
                if (id === this.loadId) this.fileInput.value = '';
            });
        });

        const flag = this.gui.addFolder('Flag Settings');
        flag.add({ upload: () => this.fileInput.click() }, 'upload').name('Upload Image (Auto-Size)');
        flag.add(this.params, 'materialType', { Satin: 'Default', Anime: 'Anime' }).name('Fabric').onChange(callbacks.onMaterialChange);
        flag.add(this.params, 'sheen', 0, 1, 0.01).name('Silk Sheen').onChange(callbacks.onSheenChange);
        flag.add({ reset: () => {
            Object.assign(this.params.drape, defaultDrape);
            callbacks.onResetFlag();
            this.updateDisplay();
        } }, 'reset').name('Reset Shape');

        const drape = this.gui.addFolder('Drape Shape');
        const shape = this.params.drape;
        drape.add(shape, 'size', 0.65, 1.1, 0.01).name('Size').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'opening', 16, 36, 0.5).name('Opening °').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'gather', 0, 1, 0.01).name('Gather').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'shoulder', 0.04, 0.45, 0.01).name('Shoulder').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'hoist', 0.65, 1, 0.01).name('Neck Ease').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'fall', 0.7, 1, 0.01).name('Fall').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'folds', 2, 10, 1).name('Fold Count').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'foldDepth', 0, 1, 0.01).name('Fold Depth').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'twist', -45, 45, 1).name('Twist °').onChange(callbacks.onDrapeChange);
        drape.add(shape, 'rotation', -180, 180, 1).name('Rotation °').onChange(callbacks.onDrapeChange);

        const bends = this.gui.addFolder('Bend Profile (− inward)');
        bends.add(shape, 'bendNear', -120, 120, 1).name('Near Pole °').onChange(callbacks.onDrapeChange);
        bends.add(shape, 'bendMiddle', -120, 120, 1).name('Middle Bend °').onChange(callbacks.onDrapeChange);
        bends.add(shape, 'bendOuter', -120, 120, 1).name('Outer Bend °').onChange(callbacks.onDrapeChange);
        bends.add(shape, 'edgeCurl', -120, 120, 1).name('Edge Curl °').onChange(callbacks.onDrapeChange);
        bends.add(this.params, 'bendStrength').name('Applied Bend %').disable().listen();

        const fringe = this.gui.addFolder('Fringe Settings').close();
        fringe.add(this.params, 'showFringe').name('Show Fringe').onChange(callbacks.onFringeChange);
        fringe.add(this.params, 'fringeLength', 0.015, 0.2, 0.005).name('Length').onChange(callbacks.onFringeChange);
        fringe.add(this.params, 'fringeDensity', 10, 100, 1).name('Density').onChange(callbacks.onFringeChange);

        this.gui.addFolder('Flagpole').add(this.params, 'poleLength', 5, 20, 0.1).name('Pole Length').onChange(callbacks.onUpdatePole);
        const motion = this.gui.addFolder('Motion').close();
        motion.add(this.params, 'enableMotion').name('Animate');
        motion.add(this.params, 'softness', 0, 1, 0.01).name('Softness');
        motion.add(this.params, 'windSpeed', 0, 30, 0.5).name('Wind Speed');
        motion.add(this.params, 'windDirectionX', -1, 1, 0.01).name('Wind X');
        motion.add(this.params, 'windDirectionZ', -1, 1, 0.01).name('Wind Z');
        const view = this.gui.addFolder('View');
        view.add(this.params, 'projection', ['Orthographic', 'Perspective']).name('Projection').onChange(callbacks.onProjectionChange);
        view.add({ reset: callbacks.onResetView }, 'reset').name('Reset View');
        this.gui.add(this.params, 'version').name('Version').disable();
    }

    updateDisplay() { this.gui.controllersRecursive().forEach(c => c.updateDisplay()); }

    loadDefaultTexture(url: string, onLoaded: (aspect: number, texture: ImageTexture) => void) {
        const id = ++this.loadId;
        ImageTexture.load(url).then(texture => {
            if (id !== this.loadId) { texture.dispose(); return; }
            onLoaded(texture.width / texture.height, texture);
        }).catch(error => console.error('Default flag image failed to load', error));
    }
    dispose() { this.loadId++; this.gui.destroy(); this.fileInput.remove(); }
}
