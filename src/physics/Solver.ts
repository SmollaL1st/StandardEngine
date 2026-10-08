import { Particle } from './Particle';
import type { Constraint } from './Constraint';
import type { Collider } from './Collider';
import { Vec3 as Vector3 } from '../engine/math';

export class Solver {
    particles: Particle[] = [];
    constraints: Constraint[] = [];
    colliders: Collider[] = [];
    
    gravity: Vector3 = new Vector3(0, -9.81, 0);
    subSteps: number = 5;
    constraintIterations: number = 15; // Increased significantly to fix stretching and jitter for 40x40 mesh

    clear() {
        this.particles = [];
        this.constraints = [];
        this.colliders = [];
    }

    addParticle(particle: Particle) {
        this.particles.push(particle);
    }

    addConstraint(constraint: Constraint) {
        this.constraints.push(constraint);
    }

    addCollider(collider: Collider) {
        if (!this.colliders.includes(collider)) this.colliders.push(collider);
    }

    // Apply global forces like gravity and wind
    applyForces() {
        for (const particle of this.particles) {
            if (particle.isPinned) continue;

            // Apply gravity
            particle.acceleration.add(this.gravity);
        }
    }

    // A simplified wind model acting on triangles would go here, 
    // but we can pass wind forces directly from the Flag class 
    // which has topological knowledge (normals, triangles).

    update(dt: number, applyExternalForces?: () => void) {
        if (!Number.isFinite(dt) || dt <= 0) return;

        // Cap dt to prevent explosions on lag spikes
        const maxDt = 1 / 30;
        const actualDt = Math.min(dt, maxDt);
        
        const steps = Math.max(1, Math.floor(this.subSteps));
        const subDt = actualDt / steps;

        for (let step = 0; step < steps; step++) {
            this.applyForces();
            applyExternalForces?.();

            // Integrate positions
            for (const particle of this.particles) {
                particle.integrate(subDt);
            }
            
            // Solve constraints iteratively
            for (let i = 0; i < this.constraintIterations; i++) {
                for (const constraint of this.constraints) {
                    constraint.solve();
                }

                // Resolve collisions AFTER distance constraints in every iteration
                // This prevents distance constraints from pushing particles into the collider
                for (const collider of this.colliders) {
                    for (const particle of this.particles) {
                        if (!particle.isPinned) {
                            collider.solve(particle);
                        }
                    }
                }
            }
            for (const particle of this.particles) particle.updateVelocity(subDt);
        }
    }
}
