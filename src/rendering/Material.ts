import * as THREE from 'three';

export function createFlagMaterial(): THREE.MeshPhysicalMaterial {
    // Generate a placeholder texture (e.g., a simple checkerboard or color gradient)
    // A real texture would be loaded using THREE.TextureLoader
    
    // For now, let's use a nice red color, but enable the physical properties requested.
    const material = new THREE.MeshPhysicalMaterial({
        color: 0xcc2222,
        side: THREE.DoubleSide,
        
        // As requested in stack.md for textiles:
        roughness: 0.8,      // 0.7-0.9 to eliminate unnatural gloss
        metalness: 0.1,      // low metalness for fabric
        
        // Sheen (microfiber fuzz)
        sheen: 1.0,          
        sheenColor: new THREE.Color(0xffaaaa),
        sheenRoughness: 0.5,

        // Anisotropy (highlights along threads)
        anisotropy: 1.0,
        
        // Make it slightly translucent
        transmission: 0.1,
        thickness: 0.05,
    });

    return material;
}
