import { Particle } from './Particle';
import type { Constraint } from './Constraint';
import type { Collider } from './Collider';
import { Vector3 } from 'three';

export class Solver {
    particles: Particle[] = [];
    constraints: Constraint[] = [];
    colliders: Collider[] = [];
    
    gravity: Vector3 = new Vector3(0, -9.81, 0);
    wind: Vector3 = new Vector3(0, 0, 0);
    windSpeed: number = 0;
    
    subSteps: number = 5;
    constraintIterations: number = 15; // Increased significantly to fix stretching and jitter for 40x40 mesh

    clear() {
        this.particles = [];
        this.constraints = [];
    }

    addParticle(particle: Particle) {
        this.particles.push(particle);
    }

    addConstraint(constraint: Constraint) {
        this.constraints.push(constraint);
    }

    addCollider(collider: Collider) {
        this.colliders.push(collider);
    }

    // Apply global forces like gravity and wind
    applyForces() {
        for (const particle of this.particles) {
            if (particle.isPinned) continue;

            // Apply gravity
            particle.addForce(this.gravity);
        }
    }

    // A simplified wind model acting on triangles would go here, 
    // but we can pass wind forces directly from the Flag class 
    // which has topological knowledge (normals, triangles).

    update(dt: number) {
        if (dt <= 0) return;

        // Cap dt to prevent explosions on lag spikes
        const maxDt = 1 / 30;
        const actualDt = Math.min(dt, maxDt);
        
        const subDt = actualDt / this.subSteps;

        for (let step = 0; step < this.subSteps; step++) {
            this.applyForces();

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
        }
    }
}
