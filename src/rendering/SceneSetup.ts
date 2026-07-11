import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class SceneSetup {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    directionalLight!: THREE.DirectionalLight;
    ambientLight!: THREE.AmbientLight;

    constructor(canvas: HTMLCanvasElement) {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x202020);
        this.scene.fog = new THREE.Fog(0x202020, 20, 100);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(10, 10, 20);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Enable shadows and physically correct lighting
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.6; // Lower exposure to reduce brightness

        this.setupLighting();
        this.setupEnvironment();
        
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    private setupLighting() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
        this.directionalLight.position.set(10, 20, 10);
        this.directionalLight.castShadow = true;
        
        // High quality shadows
        this.directionalLight.shadow.mapSize.width = 2048;
        this.directionalLight.shadow.mapSize.height = 2048;
        this.directionalLight.shadow.camera.near = 0.5;
        this.directionalLight.shadow.camera.far = 50;
        
        const d = 15;
        this.directionalLight.shadow.camera.left = -d;
        this.directionalLight.shadow.camera.right = d;
        this.directionalLight.shadow.camera.top = d;
        this.directionalLight.shadow.camera.bottom = -d;
        this.directionalLight.shadow.bias = -0.0001; // Less aggressive bias
        this.directionalLight.shadow.normalBias = 0.05; // Prevent self-shadowing acne on double-sided thin cloth

        this.scene.add(this.directionalLight);
    }

    private setupEnvironment() {
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();
        
        const environment = new RoomEnvironment();
        this.scene.environment = pmremGenerator.fromScene(environment).texture;
        
        // Let's also keep the background dark but maybe slightly warmer/lighter
        this.scene.background = new THREE.Color(0x2a2a2a);
        
        // Optional: you can lower the ambient/directional light since IBL provides a lot of light
        this.ambientLight.intensity = 0.05; // Almost off, rely on IBL
        this.directionalLight.intensity = 0.5; // Lower sun intensity
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
