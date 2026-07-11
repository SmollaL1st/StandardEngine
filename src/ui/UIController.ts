import GUI from 'lil-gui';
import * as THREE from 'three';
import pkg from '../../package.json';

export class UIParams {
    windSpeed: number = 0.0;
    windDirectionX: number = 1.0;
    windDirectionY: number = 0.2;
    windDirectionZ: number = 0.5;
    gravity: number = -9.81;
    subSteps: number = 5;
    showFringe: boolean = true;
    fringeLength: number = 0.15;
    fringeDensity: number = 60;
    poleLength: number = 10;
    coneTopRadius: number = 0.05;
    coneBottomRadius: number = 0.8;
    coneHeight: number = 3.0;
    enablePhysics: boolean = true;
    showDebugCone: boolean = false;
    version: string = 'v' + pkg.version;
}

export type UICallbacks = {
    onUploadFlag: () => void;
    onResetFlag: () => void;
    onUpdatePole: () => void;
    onUpdateCone: () => void;
    onFringeToggle: (v: boolean) => void;
    onFringeChange: () => void;
    onGravityChange: (v: number) => void;
    onSubStepsChange: (v: number) => void;
};

export class UIController {
    gui: GUI;
    params: UIParams;
    fileInput: HTMLInputElement;
    textureLoader: THREE.TextureLoader;

    constructor(callbacks: UICallbacks, onTextureLoaded: (aspect: number, tex: THREE.Texture) => void) {
        this.params = new UIParams();
        this.gui = new GUI();
        this.textureLoader = new THREE.TextureLoader();

        // 1. Setup File Input
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'image/*';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);

        this.fileInput.addEventListener('change', (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const url = URL.createObjectURL(file);
                this.textureLoader.load(url, (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    // Note: max anisotropy needs a renderer reference if we want hardware max, 
                    // but we can just use 16 as a safe default for modern devices.
                    texture.anisotropy = 16; 
                    texture.minFilter = THREE.LinearMipmapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    
                    const aspect = texture.image.width / texture.image.height;
                    onTextureLoaded(aspect, texture);
                });
            }
        });

        // 2. Setup GUI Folders
        const flagFolder = this.gui.addFolder('Flag Settings');
        flagFolder.add({ upload: () => this.fileInput.click() }, 'upload').name('Upload Image (Auto-Size)');
        flagFolder.add({ reset: callbacks.onResetFlag }, 'reset').name('Reset Position');

        const fringeFolder = this.gui.addFolder('Fringe Settings');
        fringeFolder.add(this.params, 'showFringe').name('Show Fringe').onChange(callbacks.onFringeToggle);
        fringeFolder.add(this.params, 'fringeLength', 0.05, 0.5, 0.01).name('Length').onChange(callbacks.onFringeChange);
        fringeFolder.add(this.params, 'fringeDensity', 10, 100, 1).name('Density').onChange(callbacks.onFringeChange);

        const standFolder = this.gui.addFolder('Pole & Cone');
        standFolder.add(this.params, 'poleLength', 5, 20, 0.1).name('Pole Length').onChange(callbacks.onUpdatePole);
        standFolder.add(this.params, 'coneTopRadius', 0.01, 0.5, 0.01).name('Cone Top').onChange(callbacks.onUpdateCone);
        standFolder.add(this.params, 'coneBottomRadius', 0.1, 2.0, 0.05).name('Cone Bottom').onChange(callbacks.onUpdateCone);
        standFolder.add(this.params, 'coneHeight', 1.0, 5.0, 0.1).name('Cone Height').onChange(callbacks.onUpdateCone);
        standFolder.add(this.params, 'showDebugCone').name('Show Debug Cone').onChange(callbacks.onUpdateCone);

        const physicsFolder = this.gui.addFolder('Physics');
        physicsFolder.add(this.params, 'enablePhysics').name('Enable Physics');
        physicsFolder.add(this.params, 'gravity', -20, 0).name('Gravity Y').onChange(callbacks.onGravityChange);
        physicsFolder.add(this.params, 'subSteps', 1, 10, 1).name('Substeps').onChange(callbacks.onSubStepsChange);

        const windFolder = this.gui.addFolder('Wind');
        windFolder.add(this.params, 'windSpeed', 0, 30).name('Speed');
        windFolder.add(this.params, 'windDirectionX', -1, 1).name('Dir X');
        windFolder.add(this.params, 'windDirectionY', -1, 1).name('Dir Y');
        windFolder.add(this.params, 'windDirectionZ', -1, 1).name('Dir Z');

        this.gui.add(this.params, 'version').name('Version').disable();
    }

    updateDisplay() {
        this.gui.controllersRecursive().forEach(c => c.updateDisplay());
    }

    loadDefaultTexture(url: string, maxAnisotropy: number, onLoaded: (aspect: number, tex: THREE.Texture) => void) {
        this.textureLoader.load(url, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = maxAnisotropy;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            const aspect = texture.image.width / texture.image.height;
            onLoaded(aspect, texture);
        });
    }
}
