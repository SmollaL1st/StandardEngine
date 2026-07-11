import * as THREE from 'three';
import { Solver } from './physics/Solver';
import { Particle } from './physics/Particle';
import { DistanceConstraint } from './physics/Constraint';
import { createFlagMaterial } from './rendering/Material';

export class Flag {
    mesh: THREE.Mesh;
    geometry: THREE.PlaneGeometry;
    solver: Solver;
    
    width: number;
    height: number;
    segmentsW: number;
    segmentsH: number;
    
    particles: Particle[][] = [];
    
    fringeGeometry!: THREE.BufferGeometry;
    fringeMesh!: THREE.Mesh;
    showFringe: boolean = true;
    fringeLength: number = 0.15;
    fringeDensity: number = 60; // Texture repeat for strands
    
    constructor(solver: Solver, width: number = 4, height: number = 3, segmentsW: number = 40, segmentsH: number = 30) {
        this.solver = solver;
        this.width = width;
        this.height = height;
        this.segmentsW = segmentsW;
        this.segmentsH = segmentsH;
        
        // Use a PlaneGeometry to get the index structure and UVs for free
        this.geometry = new THREE.PlaneGeometry(width, height, segmentsW, segmentsH);
        
        // Rotate geometry so it hangs correctly (Three.js plane is in XY by default)
        // Translate it so the left edge is at x=0.05 (the surface of the pole) instead of x=0 (inside the cone)
        this.geometry.translate(width / 2 + 0.05, 0, 0);
        
        // Give the flag a slight 3D curved shape initially so it wraps around the cone 
        // cleanly instead of falling perfectly flat and intersecting itself in the center.
        const posAttribute = this.geometry.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const z = Math.sin((x / width) * Math.PI) * 0.6; // 60cm outward curve
            posAttribute.setZ(i, z);
        }
        
        const material = createFlagMaterial();
        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false; // Prevent culling when vertices move outside bounding box
        
        this.initPhysics();
        this.initFringe();
        this.reset(); // Pre-warm physics so it starts perfectly draped
    }
    
    dispose() {
        this.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) this.mesh.material.dispose();
        if (this.fringeGeometry) this.fringeGeometry.dispose();
        if (this.fringeMesh && this.fringeMesh.material instanceof THREE.Material) this.fringeMesh.material.dispose();
    }
    
    reset() {
        // Reset to initial flat curved state
        for (const row of this.particles) {
            for (const p of row) {
                p.position.copy(p.originalPosition);
                p.previousPosition.copy(p.originalPosition);
                p.velocity.set(0, 0, 0);
            }
        }
        
        // Update visual mesh
        this.update();
    }
    
    private initPhysics() {
        const positions = this.geometry.attributes.position.array as Float32Array;
        
        const mass = 1.0;
        
        // 1. Create Particles
        let index = 0;
        for (let y = 0; y <= this.segmentsH; y++) {
            this.particles[y] = [];
            for (let x = 0; x <= this.segmentsW; x++) {
                const px = positions[index * 3];
                const py = positions[index * 3 + 1];
                const pz = positions[index * 3 + 2];
                
                const particle = new Particle(px, py, pz, mass);
                
                // Pin the top 10% of the left edge (flagpole attachment)
                // In Three.js PlaneGeometry, y=0 is the top row of vertices.
                if (x === 0 && y <= this.segmentsH * 0.1) {
                    particle.isPinned = true;
                    particle.mass = 0;
                    particle.invMass = 0;
                }
                
                this.particles[y][x] = particle;
                this.solver.addParticle(particle);
                index++;
            }
        }
        
        // 2. Create Constraints
        const structuralStiffness = 1.0;
        const shearStiffness = 1.0;
        const bendingStiffness = 0.9; // Higher for ceremonial folds
        
        for (let y = 0; y <= this.segmentsH; y++) {
            for (let x = 0; x <= this.segmentsW; x++) {
                
                // Structural Constraints (Horizontal & Vertical)
                if (x < this.segmentsW) {
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y][x], this.particles[y][x + 1], structuralStiffness));
                }
                if (y < this.segmentsH) {
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y][x], this.particles[y + 1][x], structuralStiffness));
                }
                
                // Shear Constraints (Diagonal)
                if (x < this.segmentsW && y < this.segmentsH) {
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y][x], this.particles[y + 1][x + 1], shearStiffness));
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y + 1][x], this.particles[y][x + 1], shearStiffness));
                }
                
                // Bending Constraints (Skip one vertex)
                if (x < this.segmentsW - 1) {
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y][x], this.particles[y][x + 2], bendingStiffness));
                }
                if (y < this.segmentsH - 1) {
                    this.solver.addConstraint(new DistanceConstraint(this.particles[y][x], this.particles[y + 2][x], bendingStiffness));
                }
            }
        }
    }
    
    applyWind(windVector: THREE.Vector3) {
        // Simple wind model: apply force based on triangle normals
        const positions = this.geometry.attributes.position;
        const index = this.geometry.index;
        
        if (!index) return;
        
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();
        const normal = new THREE.Vector3();
        
        const force = new THREE.Vector3();
        
        for (let i = 0; i < index.count; i += 3) {
            const i1 = index.getX(i);
            const i2 = index.getX(i + 1);
            const i3 = index.getX(i + 2);
            
            pA.fromBufferAttribute(positions, i1);
            pB.fromBufferAttribute(positions, i2);
            pC.fromBufferAttribute(positions, i3);
            
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            normal.crossVectors(cb, ab).normalize();
            
            // Calculate wind force proportional to the dot product of wind and normal
            const dot = normal.dot(windVector);
            force.copy(normal).multiplyScalar(dot);
            
            // Add some noise/turbulence only if wind is blowing
            const windSpeed = windVector.length();
            if (windSpeed > 0) {
                const noise = (Math.random() - 0.5) * 0.2 * windSpeed;
                force.addScalar(noise);
            }

            // Distribute force to the 3 vertices
            const fX = force.x / 3;
            const fY = force.y / 3;
            const fZ = force.z / 3;
            
            // We map 1D index to our 2D array
            const distribute = (idx: number) => {
                const y = Math.floor(idx / (this.segmentsW + 1));
                const x = idx % (this.segmentsW + 1);
                const p = this.particles[y][x];
                if (!p.isPinned) {
                    p.acceleration.x += fX * p.invMass;
                    p.acceleration.y += fY * p.invMass;
                    p.acceleration.z += fZ * p.invMass;
                }
            };
            
            distribute(i1);
            distribute(i2);
            distribute(i3);
        }
    }
    
    update() {
        // Sync particle positions back to Three.js BufferGeometry
        const positions = this.geometry.attributes.position.array as Float32Array;
        
        let i = 0;
        for (let y = 0; y <= this.segmentsH; y++) {
            for (let x = 0; x <= this.segmentsW; x++) {
                const p = this.particles[y][x].position;
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z;
                i++;
            }
        }
        
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals(); // Recompute normals for PBR shading
        
        if (this.showFringe && this.fringeMesh) {
            this.updateFringe();
        }
    }
    
    private initFringe() {
        // Create a procedural fringe texture
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        // Draw gold background
        ctx.fillStyle = '#d4af37';
        ctx.fillRect(0, 0, 64, 256);
        // Draw strands (transparency)
        ctx.clearRect(0, 50, 64, 206); // clear bottom part
        // Finer strands (every 2px instead of 4px)
        for (let i = 0; i < 64; i += 2) {
            ctx.fillRect(i, 50, 1, 206);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        
        const fringeMat = new THREE.MeshStandardMaterial({
            map: tex,
            bumpMap: tex,
            bumpScale: 0.05,
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0.7, // Higher metalness for shiny voluminous threads
            side: THREE.DoubleSide,
            alphaTest: 0.5,
            transparent: true
        });
        
        const numEdges = this.segmentsW + this.segmentsH + this.segmentsW;
        const numVerts = (numEdges + 1) * 2;
        const positions = new Float32Array(numVerts * 3);
        const uvs = new Float32Array(numVerts * 2);
        const indices = [];
        
        // UVs and Indices
        for (let i = 0; i <= numEdges; i++) {
            uvs[i * 4] = (i / numEdges) * this.fringeDensity; // Repeat density
            uvs[i * 4 + 1] = 1; // top (solid part)
            uvs[i * 4 + 2] = (i / numEdges) * this.fringeDensity;
            uvs[i * 4 + 3] = 0; // bottom (strands)
            
            if (i < numEdges) {
                const a = i * 2;
                const b = i * 2 + 1;
                const c = (i + 1) * 2;
                const d = (i + 1) * 2 + 1;
                indices.push(a, b, d, a, d, c);
            }
        }
        
        this.fringeGeometry = new THREE.BufferGeometry();
        this.fringeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.fringeGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        this.fringeGeometry.setIndex(indices);
        
        this.fringeMesh = new THREE.Mesh(this.fringeGeometry, fringeMat);
        this.fringeMesh.frustumCulled = false;
        this.fringeMesh.castShadow = true;
        this.mesh.add(this.fringeMesh);
    }
    
    private updateFringe() {
        const positions = this.fringeGeometry.attributes.position.array as Float32Array;
        let vIdx = 0;
        
        // Helper to add a fringe segment
        const addFringeVert = (x: number, y: number) => {
            const p = this.particles[y][x].position;
            // Base vertex (attached to flag)
            positions[vIdx++] = p.x;
            positions[vIdx++] = p.y;
            positions[vIdx++] = p.z;
            // Tip vertex (hanging down)
            positions[vIdx++] = p.x;
            positions[vIdx++] = p.y - this.fringeLength;
            positions[vIdx++] = p.z;
        };
        
        // Top edge (left to right)
        for (let x = 0; x <= this.segmentsW; x++) addFringeVert(x, 0);
        // Right edge (top to bottom, skip first to avoid duplicate)
        for (let y = 1; y <= this.segmentsH; y++) addFringeVert(this.segmentsW, y);
        // Bottom edge (right to left, skip first)
        for (let x = this.segmentsW - 1; x >= 0; x--) addFringeVert(x, this.segmentsH);
        
        this.fringeGeometry.attributes.position.needsUpdate = true;
    }
}
