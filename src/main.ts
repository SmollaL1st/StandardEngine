import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { SceneSetup } from './rendering/SceneSetup';
import { Stand } from './rendering/Stand';
import { Solver } from './physics/Solver';
import { ConeCollider } from './physics/Collider';
import { Flag } from './Flag';
import { UIController, type UICallbacks } from './ui/UIController';

// Create canvas
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const appDiv = document.getElementById('app');
if (appDiv) appDiv.remove();

// 1. Setup Scene & Stand
const sceneSetup = new SceneSetup(canvas);
sceneSetup.camera.position.set(2, 2, 8);

const controls = new OrbitControls(sceneSetup.camera, canvas);
controls.enableDamping = true;
controls.target.set(2, -1.5, 0);

const stand = new Stand(sceneSetup.scene);

// 2. Setup Physics & Initial Flag
const solver = new Solver();
const coneCollider = new ConeCollider(
    new THREE.Vector3(0, 0, 0),
    1.5,
    -1.5,
    0.05,
    0.8
);
solver.addCollider(coneCollider);

// Dummy placeholder flag, not added to scene. Will be replaced on SVG load.
let flag = new Flag(solver, 3, 3, 40, 40);

// 3. Setup UI Controller
const uiCallbacks: UICallbacks = {
    onUploadFlag: () => {}, // Handled directly in UIController 
    onResetFlag: () => flag.reset(),
    onUpdatePole: () => {
        stand.updatePole(uiController.params.poleLength);
    },
    onUpdateCone: () => {
        stand.updateCone(
            uiController.params.coneTopRadius, 
            uiController.params.coneBottomRadius, 
            uiController.params.coneHeight, 
            uiController.params.showDebugCone
        );
        coneCollider.topRadius = uiController.params.coneTopRadius;
        coneCollider.bottomRadius = uiController.params.coneBottomRadius;
        coneCollider.bottomY = 1.5 - uiController.params.coneHeight;
    },
    onFringeToggle: (v: boolean) => {
        flag.showFringe = v;
        if (flag.fringeMesh) flag.fringeMesh.visible = v;
    },
    onFringeChange: () => {
        flag.fringeLength = uiController.params.fringeLength;
        flag.fringeDensity = uiController.params.fringeDensity;
        if (flag.showFringe) {
            flag.mesh.remove(flag.fringeMesh);
            flag.fringeGeometry.dispose();
            (flag.fringeMesh.material as THREE.Material).dispose();
            // @ts-ignore - access private for quick rebuild
            flag.initFringe();
        }
    },
    onGravityChange: (v: number) => solver.gravity.y = v,
    onSubStepsChange: (v: number) => solver.subSteps = v,
};

function rebuildFlag(aspectRatio: number, map: THREE.Texture) {
    sceneSetup.scene.remove(flag.mesh);
    flag.dispose();
    solver.clear();
    
    solver.addCollider(coneCollider);
    
    const width = 3 * aspectRatio;
    const height = 3;
    const segmentsH = 40;
    const segmentsW = Math.round(40 * aspectRatio);
    
    flag = new Flag(solver, width, height, segmentsW, segmentsH);
    
    flag.showFringe = uiController.params.showFringe;
    flag.fringeLength = uiController.params.fringeLength;
    flag.fringeDensity = uiController.params.fringeDensity;
    if (flag.fringeMesh) flag.fringeMesh.visible = flag.showFringe;
    
    const mat = flag.mesh.material as THREE.MeshPhysicalMaterial;
    mat.map = map;
    mat.color.setHex(0xffffff);
    mat.needsUpdate = true;
    
    // Auto-adjust pole length if flag is very long
    const expectedFlagLength = width;
    if (expectedFlagLength > 5) {
        uiController.params.poleLength = expectedFlagLength + 5;
    } else {
        uiController.params.poleLength = 10;
    }
    stand.updatePole(uiController.params.poleLength);
    uiController.updateDisplay();
    
    sceneSetup.scene.add(flag.mesh);
}

const uiController = new UIController(uiCallbacks, rebuildFlag);

// Load default flag with correct base URL for GitHub Pages
uiController.loadDefaultTexture(`${import.meta.env.BASE_URL}Flag.svg`, sceneSetup.renderer.capabilities.getMaxAnisotropy(), rebuildFlag);

// 4. Animation Loop
const clock = new THREE.Clock();
const windDir = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    if (uiController.params.enablePhysics) {
        // Calculate wind vector
        windDir.set(
            uiController.params.windDirectionX, 
            uiController.params.windDirectionY, 
            uiController.params.windDirectionZ
        ).normalize();
        
        let currentWindSpeed = uiController.params.windSpeed;
        if (uiController.params.windSpeed > 0) {
            const time = clock.getElapsedTime();
            const gust = Math.sin(time * 2.0) * 0.5 + 0.5; // 0 to 1
            currentWindSpeed = uiController.params.windSpeed * (0.5 + 0.5 * gust);
        }
        
        windDir.multiplyScalar(currentWindSpeed);

        flag.applyWind(windDir);
        solver.update(1 / 60);
        flag.update();
    }

    controls.update();
    sceneSetup.render();
}

animate();
