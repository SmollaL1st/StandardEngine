import type { Material } from '../engine/Geometry';

export type FlagMaterialStyle = 'Anime' | 'Default';
export function createFlagMaterial(style: FlagMaterialStyle = 'Default'): Material {
    return { kind: 'cloth', color: [1, 1, 1], sheen: 0.3, toon: style === 'Anime' };
}
