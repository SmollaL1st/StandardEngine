import * as THREE from 'three';

export class Stand {
    group: THREE.Group;
    poleMesh: THREE.Mesh;
    finialMesh: THREE.Mesh;
    spireMesh: THREE.Mesh;
    debugConeMesh: THREE.Mesh;
    
    metalMat: THREE.MeshStandardMaterial;

    constructor(scene: THREE.Scene) {
        this.group = new THREE.Group();

        this.metalMat = new THREE.MeshStandardMaterial({ 
            color: 0xffaa00,
            metalness: 1.0, 
            roughness: 0.1 
        });

        // Pole placeholder
        const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 10, 32);
        this.poleMesh = new THREE.Mesh(poleGeometry, this.metalMat);
        this.poleMesh.castShadow = true;
        this.group.add(this.poleMesh);

        // Base
        const baseGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.15, 32);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.5 });
        const baseMesh = new THREE.Mesh(baseGeometry, baseMat);
        baseMesh.position.y = -5.0;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        this.group.add(baseMesh);

        // Finial Sphere
        const finialSphere = new THREE.SphereGeometry(0.08, 32, 32);
        this.finialMesh = new THREE.Mesh(finialSphere, this.metalMat);
        this.finialMesh.position.y = 5.05;
        this.group.add(this.finialMesh);

        // Finial Spire
        const finialSpire = new THREE.ConeGeometry(0.04, 0.3, 16);
        this.spireMesh = new THREE.Mesh(finialSpire, this.metalMat);
        this.spireMesh.position.y = 5.25;
        this.group.add(this.spireMesh);

        this.group.position.set(0, -2, 0); // Offset down so flag is near the top
        scene.add(this.group);

        // Debug Cone
        const debugConeMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.3 });
        this.debugConeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.8, 3.0, 16), debugConeMat);
        this.debugConeMesh.position.y = 0; // 1.5 - 3.0/2
        this.debugConeMesh.visible = false;
        scene.add(this.debugConeMesh);
    }

    updatePole(poleLength: number) {
        this.poleMesh.geometry.dispose();
        this.poleMesh.geometry = new THREE.CylinderGeometry(0.05, 0.05, poleLength, 32);
        // Base is at y=-5, so center of pole is -5 + length/2
        this.poleMesh.position.y = -5 + poleLength / 2;
        this.finialMesh.position.y = -5 + poleLength + 0.05;
        this.spireMesh.position.y = -5 + poleLength + 0.25;
    }

    updateCone(topRadius: number, bottomRadius: number, height: number, showDebug: boolean) {
        // Update debug cone visualizer
        this.debugConeMesh.geometry.dispose();
        this.debugConeMesh.geometry = new THREE.CylinderGeometry(
            topRadius, 
            bottomRadius, 
            height, 
            16
        );
        this.debugConeMesh.position.y = 1.5 - height / 2;
        this.debugConeMesh.visible = showDebug;
    }
}
