import { multiply, transformPoint, type Mat4 } from '../core/math';

export interface NdcRect { x0: number; x1: number; y0: number; y1: number }
export interface PixelRect { x: number; y: number; width: number; height: number }

/** Clip-space matrix that maps an NDC rectangle onto the full viewport (an off-axis crop). */
export function cropMatrix(r: NdcRect): Mat4 {
    const hx = (r.x1 - r.x0) / 2, hy = (r.y1 - r.y0) / 2, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    return new Float32Array([1 / hx, 0, 0, 0, 0, 1 / hy, 0, 0, 0, 0, 1, 0, -cx / hx, -cy / hy, 0, 1]);
}

export function cropViewProjection(viewProj: Mat4, r: NdcRect) { return multiply(cropMatrix(r), viewProj); }

/** NDC bounds of world points in front of the camera. */
export function projectBounds(viewProj: Mat4, points: Iterable<[number, number, number]>): NdcRect | null {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const out = new Float64Array(4);
    for (const [x, y, z] of points) {
        transformPoint(viewProj, x, y, z, out);
        if (out[3] <= 1e-6) continue;
        const nx = out[0] / out[3], ny = out[1] / out[3];
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x0, x1, y0, y1 } : null;
}

/**
 * Size of an export of the NDC rectangle with square pixels, given the viewport
 * the rectangle was measured in and the requested longer side.
 */
export function outputSize(r: NdcRect, viewportWidth: number, viewportHeight: number, longSide: number) {
    const w = (r.x1 - r.x0) / 2 * viewportWidth, h = (r.y1 - r.y0) / 2 * viewportHeight;
    const scale = longSide / Math.max(w, h);
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Grows a rectangle by a fraction of its larger side, keeping pixels square. */
export function pad(r: NdcRect, fraction: number, aspect: number): NdcRect {
    const w = (r.x1 - r.x0) * aspect, h = r.y1 - r.y0, p = Math.max(w, h) * fraction;
    return { x0: r.x0 - p / aspect, x1: r.x1 + p / aspect, y0: r.y0 - p, y1: r.y1 + p };
}

/** Splits an image into tiles no larger than `tile` pixels; rows run top to bottom. */
export function tiles(width: number, height: number, tile: number): PixelRect[] {
    const out: PixelRect[] = [];
    for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) {
        out.push({ x, y, width: Math.min(tile, width - x), height: Math.min(tile, height - y) });
    }
    return out;
}

/** The part of the full NDC rectangle that a pixel tile covers (y in the image runs downwards). */
export function tileRect(full: NdcRect, width: number, height: number, t: PixelRect): NdcRect {
    const sx = (full.x1 - full.x0) / width, sy = (full.y1 - full.y0) / height;
    return { x0: full.x0 + t.x * sx, x1: full.x0 + (t.x + t.width) * sx, y0: full.y1 - (t.y + t.height) * sy, y1: full.y1 - t.y * sy };
}

/** Copies GL rows (bottom first, premultiplied) into straight-alpha image rows (top first). */
export function blitTile(source: Uint8Array, t: PixelRect, target: Uint8ClampedArray, width: number) {
    for (let row = 0; row < t.height; row++) {
        const from = (t.height - 1 - row) * t.width * 4, to = ((t.y + row) * width + t.x) * 4;
        for (let i = 0; i < t.width * 4; i += 4) {
            const a = source[from + i + 3];
            if (a === 0) { target[to + i] = target[to + i + 1] = target[to + i + 2] = target[to + i + 3] = 0; continue; }
            const s = 255 / a;
            target[to + i] = Math.min(255, Math.round(source[from + i] * s));
            target[to + i + 1] = Math.min(255, Math.round(source[from + i + 1] * s));
            target[to + i + 2] = Math.min(255, Math.round(source[from + i + 2] * s));
            target[to + i + 3] = a;
        }
    }
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
}

export function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
