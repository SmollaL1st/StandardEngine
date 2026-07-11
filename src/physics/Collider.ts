import { Vector3 } from 'three';
import { Particle } from './Particle';

export interface Collider {
    solve(particle: Particle): void;
}

export class ConeCollider implements Collider {
    position: Vector3;
    topRadius: number;
    bottomRadius: number;
    topY: number;
    bottomY: number;

    // To prevent object creation in tight loop
    private diff: Vector3 = new Vector3();

    constructor(position: Vector3, topY: number, bottomY: number, topRadius: number, bottomRadius: number) {
        this.position = position;
        this.topY = topY;
        this.bottomY = bottomY;
        this.topRadius = topRadius;
        this.bottomRadius = bottomRadius;
    }

    solve(particle: Particle): void {
        const py = particle.position.y;
        
        // Check if particle is vertically within the cone's bounds
        if (py > this.topY || py < this.bottomY) return;

        // Calculate the expected radius at this Y
        const t = (this.topY - py) / (this.topY - this.bottomY);
        const currentRadius = this.topRadius + t * (this.bottomRadius - this.topRadius);

        // Calculate horizontal distance from central axis
        const dx = particle.position.x - this.position.x;
        const dz = particle.position.z - this.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq < currentRadius * currentRadius && distSq > 0) {
            const dist = Math.sqrt(distSq);
            
            // Push particle radially outward to the surface of the cone
            this.diff.set(dx, 0, dz).multiplyScalar(1 / dist); // Normalize
            
            // The position on the surface of the cone
            particle.position.x = this.position.x + this.diff.x * currentRadius;
            particle.position.z = this.position.z + this.diff.z * currentRadius;
            
        } else if (distSq === 0) {
            // Edge case: exactly on center, push along X
            particle.position.x = this.position.x + currentRadius;
        }
    }
}
