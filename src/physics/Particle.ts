import { Vec3 as Vector3 } from '../engine/math';

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
        this.previousPosition.copy(this.position);
        this.velocity.addScaledVector(this.acceleration, dt);
        // Damping is measured in seconds, so changing substeps does not change the fabric's weight.
        this.velocity.multiplyScalar(Math.exp(-2.8 * dt));
        this.position.addScaledVector(this.velocity, dt);
        this.acceleration.set(0, 0, 0);
    }

    updateVelocity(dt: number) {
        if (!this.isPinned) {
            this.velocity.subVectors(this.position, this.previousPosition).divideScalar(dt);
        }
    }
}
