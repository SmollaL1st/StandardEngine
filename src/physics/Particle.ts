import { Vector3 } from 'three';

export class Particle {
    position: Vector3;
    previousPosition: Vector3;
    originalPosition: Vector3;
    velocity: Vector3;
    acceleration: Vector3;
    mass: number;
    invMass: number;
    isPinned: boolean;

    constructor(x: number, y: number, z: number, mass: number = 1.0) {
        this.position = new Vector3(x, y, z);
        this.previousPosition = new Vector3(x, y, z);
        this.originalPosition = new Vector3(x, y, z);
        this.velocity = new Vector3();
        this.acceleration = new Vector3();
        this.mass = mass;
        this.invMass = mass > 0 ? 1.0 / mass : 0;
        this.isPinned = mass === 0;
    }

    addForce(force: Vector3) {
        if (this.isPinned) return;
        this.acceleration.addScaledVector(force, this.invMass);
    }

    integrate(dt: number) {
        if (this.isPinned) return;

        // Verlet Integration: x_{i+1} = x_i + (x_i - x_{i-1}) + a * dt^2
        const dtSq = dt * dt;

        this.velocity.subVectors(this.position, this.previousPosition);
        
        // Add some damping (increased slightly for stability against jitter)
        this.velocity.multiplyScalar(0.98); 
        
        this.previousPosition.copy(this.position);

        this.position.add(this.velocity);
        this.position.addScaledVector(this.acceleration, dtSq);

        // Reset acceleration
        this.acceleration.set(0, 0, 0);
    }
}
