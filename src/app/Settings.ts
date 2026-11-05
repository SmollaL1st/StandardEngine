import { LIGHT_PRESETS, type LightSettings } from '../render/Lighting';

export type FabricId = 'satin' | 'silk' | 'polyester' | 'velvet';
export type FringeColor = 'gold' | 'silver';

export interface Settings {
    flag: { height: number; yaw: number; mirror: boolean; flipImage: boolean; fabric: FabricId; gloss: number };
    drape: { opening: number; folds: number; foldDepth: number; seed: number; sag: number };
    /** Fringe length in centimetres and threads per 10 cm of edge. */
    fringe: { show: boolean; color: FringeColor; length: number; density: number; cord: boolean };
    light: LightSettings;
    view: { backdrop: 'studio' | 'checker' | 'light'; style: 'real' | 'anime'; lineWidth: number };
    output: { longSide: number; shadow: 'none' | 'with' | 'separate' };
}

export interface Fabric {
    label: string; gloss: number; sheen: number; translucency: number; weave: number; roughness: number;
    anisotropy: number; density: number; stiffness: number;
}

export const FABRICS: Record<FabricId, Fabric> = {
    satin: { label: 'Атлас', gloss: 0.8, sheen: 0.28, translucency: 0.35, weave: 0.3, roughness: 0.3, anisotropy: 0.75, density: 0.17, stiffness: 0.42 },
    silk: { label: 'Шёлк', gloss: 0.65, sheen: 0.38, translucency: 0.5, weave: 0.18, roughness: 0.24, anisotropy: 0.55, density: 0.09, stiffness: 0.3 },
    polyester: { label: 'Флажная ткань', gloss: 0.25, sheen: 0.22, translucency: 0.55, weave: 0.55, roughness: 0.6, anisotropy: 0.2, density: 0.12, stiffness: 0.45 },
    velvet: { label: 'Бархат', gloss: 0.05, sheen: 1, translucency: 0.04, weave: 0.08, roughness: 0.8, anisotropy: 0, density: 0.36, stiffness: 0.62 },
};

/** Fixed staff: the dome drape is designed around a standard 2.4 m indoor pole. */
export const POLE_HEIGHT = 2.4;

export function defaultSettings(): Settings {
    return {
        flag: { height: 1.0, yaw: 0, mirror: false, flipImage: false, fabric: 'satin', gloss: FABRICS.satin.gloss },
        drape: { opening: 0.35, folds: 3, foldDepth: 0.35, seed: 7, sag: 0.3 },
        fringe: { show: true, color: 'gold', length: 4.5, density: 100, cord: true },
        light: { preset: 'studio', ...LIGHT_PRESETS.studio.values, shadows: true },
        view: { backdrop: 'studio', style: 'real', lineWidth: 1.6 },
        output: { longSide: 4096, shadow: 'none' },
    };
}

const STORAGE_KEY = 'standard-engine:settings:v3';

/** Restores saved settings over the defaults, ignoring anything of the wrong shape. */
export function loadSettings(): Settings {
    const defaults = defaultSettings();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const saved = JSON.parse(raw) as Record<string, Record<string, unknown>>;
        for (const group of Object.keys(defaults) as (keyof Settings)[]) {
            const target = defaults[group] as Record<string, unknown>, source = saved[group];
            if (!source || typeof source !== 'object') continue;
            for (const key of Object.keys(target)) {
                if (key in source && typeof source[key] === typeof target[key]) target[key] = source[key];
            }
        }
    } catch { /* Private mode or corrupt data: start from defaults. */ }
    return defaults;
}

export function saveSettings(settings: Settings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Storage may be unavailable. */ }
}

export function clearSavedSettings() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
}
