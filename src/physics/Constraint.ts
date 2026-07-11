import { Particle } from './Particle';
import { Vector3 } from 'three';

export interface Constraint {
    solve(): void;
}

export class DistanceConstraint implements Constraint {
    p1: Particle;
    p2: Particle;
    restLength: number;
    stiffness: number;

    // A reusable vector to avoid garbage collection during solve loop
    private diff: Vector3 = new Vector3();

    constructor(p1: Particle, p2: Particle, stiffness: number = 1.0) {
        this.p1 = p1;
        this.p2 = p2;
        this.stiffness = stiffness;
        this.restLength = p1.position.distanceTo(p2.position);
    }

    solve() {
        const w1 = this.p1.invMass;
        const w2 = this.p2.invMass;
        const w = w1 + w2;

        if (w === 0) return;

        this.diff.subVectors(this.p2.position, this.p1.position);
        const currentLength = this.diff.length();

        if (currentLength === 0) return;

        // Position Based Dynamics correction vector
        // delta_p1 = (w1 / (w1 + w2)) * (currentLength - restLength) * (diff / currentLength) * stiffness
        const correction = (currentLength - this.restLength) / currentLength;
        const force = correction * this.stiffness;
        
        this.diff.multiplyScalar(force);

        if (!this.p1.isPinned) {
            this.p1.position.addScaledVector(this.diff, w1 / w);
        }
        if (!this.p2.isPinned) {
            this.p2.position.addScaledVector(this.diff, -w2 / w);
        }
    }
}
