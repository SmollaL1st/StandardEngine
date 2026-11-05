import { Vec3, radians } from '../core/math';
import { kelvinToLinear, scaleRgb } from '../core/color';
import type { LightRig } from './Renderer';

export interface LightSettings {
    preset: string;
    /** Degrees relative to the camera: 0 = from the camera, −90 = from the left, ±180 = from behind. */
    keyAzimuth: number;
    keyElevation: number;
    keyIntensity: number;
    keyTemperature: number;
    /** 0 hard, 1 very soft shadows. */
    softness: number;
    fillAzimuth: number;
    fillIntensity: number;
    fillTemperature: number;
    rimAzimuth: number;
    rimElevation: number;
    rimIntensity: number;
    rimTemperature: number;
    ambient: number;
    ambientTemperature: number;
    exposure: number;
    shadows: boolean;
}

type Preset = Omit<LightSettings, 'preset' | 'shadows'>;

export const LIGHT_PRESETS: Record<string, { label: string; values: Preset }> = {
    studio: {
        label: 'Студия (нейтральный)', values: {
            keyAzimuth: -35, keyElevation: 32, keyIntensity: 1.0, keyTemperature: 5600, softness: 0.45,
            fillAzimuth: 55, fillIntensity: 0.28, fillTemperature: 6200,
            rimAzimuth: 150, rimElevation: 30, rimIntensity: 0.6, rimTemperature: 6800,
            ambient: 0.3, ambientTemperature: 6000, exposure: 0,
        },
    },
    hall: {
        label: 'Зал заседаний', values: {
            keyAzimuth: -18, keyElevation: 58, keyIntensity: 1.1, keyTemperature: 4300, softness: 0.65,
            fillAzimuth: 40, fillIntensity: 0.45, fillTemperature: 4600,
            rimAzimuth: 170, rimElevation: 45, rimIntensity: 0.45, rimTemperature: 4800,
            ambient: 0.46, ambientTemperature: 4500, exposure: 0,
        },
    },
    office: {
        label: 'Кабинет, тёплый свет', values: {
            keyAzimuth: -55, keyElevation: 40, keyIntensity: 1.2, keyTemperature: 3200, softness: 0.55,
            fillAzimuth: 50, fillIntensity: 0.28, fillTemperature: 3600,
            rimAzimuth: 140, rimElevation: 28, rimIntensity: 0.55, rimTemperature: 3400,
            ambient: 0.3, ambientTemperature: 3500, exposure: 0,
        },
    },
    window: {
        label: 'Дневной свет из окна', values: {
            keyAzimuth: -85, keyElevation: 22, keyIntensity: 1.5, keyTemperature: 6500, softness: 0.75,
            fillAzimuth: 70, fillIntensity: 0.18, fillTemperature: 7500,
            rimAzimuth: 160, rimElevation: 20, rimIntensity: 0.25, rimTemperature: 7000,
            ambient: 0.42, ambientTemperature: 8000, exposure: 0,
        },
    },
    press: {
        label: 'Пресс-подход (вспышка)', values: {
            keyAzimuth: 4, keyElevation: 12, keyIntensity: 1.35, keyTemperature: 5500, softness: 0.12,
            fillAzimuth: -60, fillIntensity: 0.15, fillTemperature: 5000,
            rimAzimuth: 180, rimElevation: 40, rimIntensity: 0.2, rimTemperature: 4500,
            ambient: 0.22, ambientTemperature: 4500, exposure: 0,
        },
    },
    dramatic: {
        label: 'Драматичный', values: {
            keyAzimuth: -62, keyElevation: 30, keyIntensity: 1.6, keyTemperature: 5200, softness: 0.25,
            fillAzimuth: 60, fillIntensity: 0.06, fillTemperature: 6500,
            rimAzimuth: 145, rimElevation: 35, rimIntensity: 1.7, rimTemperature: 7600,
            ambient: 0.1, ambientTemperature: 7000, exposure: 0,
        },
    },
};

/** Direction towards a light given relative to the camera's horizontal heading. */
export function lightDirection(cameraYaw: number, azimuth: number, elevation: number) {
    const a = radians(azimuth), e = radians(elevation);
    const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    const h = Math.cos(e);
    return new Vec3((Math.cos(a) * fx + Math.sin(a) * rx) * h, Math.sin(e), (Math.cos(a) * fz + Math.sin(a) * rz) * h).normalize();
}

export function buildRig(s: LightSettings, cameraYaw: number): LightRig {
    const ambient = kelvinToLinear(s.ambientTemperature);
    return {
        key: { dir: lightDirection(cameraYaw, s.keyAzimuth, s.keyElevation), color: scaleRgb(kelvinToLinear(s.keyTemperature), s.keyIntensity) },
        fill: { dir: lightDirection(cameraYaw, s.fillAzimuth, 12), color: scaleRgb(kelvinToLinear(s.fillTemperature), s.fillIntensity) },
        rim: { dir: lightDirection(cameraYaw, s.rimAzimuth, s.rimElevation), color: scaleRgb(kelvinToLinear(s.rimTemperature), s.rimIntensity) },
        sky: scaleRgb(ambient, s.ambient),
        ground: scaleRgb(ambient, s.ambient * 0.45),
        lightRadius: radians(0.4 + s.softness * s.softness * 9),
        shadows: s.shadows,
        exposure: s.exposure,
    };
}
