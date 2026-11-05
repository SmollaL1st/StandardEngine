export type RGB = [number, number, number];

export const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export function hexToRgb(hex: string): RGB {
    let value = hex.trim().replace('#', '');
    if (value.length === 3) value = value.split('').map(c => c + c).join('');
    const n = Number.parseInt(value, 16);
    if (!/^[0-9a-f]{6}$/i.test(value) || !Number.isFinite(n)) return [1, 1, 1];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function hexToLinear(hex: string): RGB {
    const [r, g, b] = hexToRgb(hex);
    return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/**
 * Black-body colour (Tanner Helland's fit) in linear RGB, normalised to unit
 * luminance so that temperature and intensity remain independent controls.
 */
export function kelvinToLinear(kelvin: number): RGB {
    const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const rgb = [r, g, b].map(c => srgbToLinear(Math.min(Math.max(c, 0), 255) / 255)) as RGB;
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return rgb.map(c => c / Math.max(luminance, 1e-6)) as RGB;
}

export const scaleRgb = (c: RGB, s: number): RGB => [c[0] * s, c[1] * s, c[2] * s];
