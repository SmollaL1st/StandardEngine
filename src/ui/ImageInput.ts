import { ImageTexture } from '../scene/Mesh';

async function decode(url: string) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
}

/** Intrinsic aspect of an SVG from width/height or viewBox; browsers may report 300×150 otherwise. */
function svgAspect(text: string) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    const width = Number.parseFloat(svg.getAttribute('width') ?? ''), height = Number.parseFloat(svg.getAttribute('height') ?? '');
    if (width > 0 && height > 0) return width / height;
    const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    return box.length === 4 && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : null;
}

function rasterize(image: HTMLImageElement, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
}

/**
 * Loads a flag image. Vector images are rasterised at the largest texture size,
 * raster images are only scaled down when they exceed it.
 */
export async function loadImage(source: Blob | string, name: string, maxSize: number): Promise<ImageTexture> {
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    const isSvg = blob.type.includes('svg') || /\.svg$/i.test(name);
    const url = URL.createObjectURL(blob);
    try {
        const image = await decode(url);
        let aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
        if (isSvg) aspect = svgAspect(await blob.text()) ?? aspect;
        if (!(aspect > 0) || !Number.isFinite(aspect)) throw new Error('Image has no size');
        const limit = Math.min(maxSize, 8192);
        if (isSvg) {
            const long = Math.min(limit, 4096);
            const width = aspect >= 1 ? long : Math.round(long * aspect), height = aspect >= 1 ? Math.round(long / aspect) : long;
            return new ImageTexture(rasterize(image, width, height), width, height, name);
        }
        const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
        return new ImageTexture(scale < 1 ? rasterize(image, width, height) : image, width, height, name);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'flag';

/** File picker, drag-and-drop onto the viewport and paste from the clipboard. */
export class ImageInput {
    private readonly input = document.createElement('input');
    private readonly target: HTMLElement;
    private readonly onFile: (file: Blob, name: string) => void;
    private depth = 0;

    constructor(target: HTMLElement, onFile: (file: Blob, name: string) => void) {
        this.target = target; this.onFile = onFile;
        this.input.type = 'file';
        this.input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/avif';
        this.input.hidden = true;
        document.body.appendChild(this.input);
        this.input.addEventListener('change', this.picked);
        target.addEventListener('dragenter', this.enter);
        target.addEventListener('dragover', this.over);
        target.addEventListener('dragleave', this.leave);
        target.addEventListener('drop', this.drop);
        window.addEventListener('paste', this.paste);
    }

    open() { this.input.click(); }

    private picked = () => {
        const file = this.input.files?.[0];
        if (file) this.onFile(file, file.name);
        this.input.value = '';
    };
    private enter = (e: DragEvent) => { e.preventDefault(); this.depth++; this.target.classList.add('dragging'); };
    private over = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    private leave = () => { if (--this.depth <= 0) { this.depth = 0; this.target.classList.remove('dragging'); } };
    private drop = (e: DragEvent) => {
        e.preventDefault(); this.depth = 0; this.target.classList.remove('dragging');
        const file = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith('image/') || /\.svg$/i.test(f.name));
        if (file) this.onFile(file, file.name);
    };
    private paste = (e: ClipboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
        const file = item?.getAsFile();
        if (file) { e.preventDefault(); this.onFile(file, file.name || 'pasted'); }
    };

    dispose() {
        this.input.remove();
        this.target.removeEventListener('dragenter', this.enter); this.target.removeEventListener('dragover', this.over);
        this.target.removeEventListener('dragleave', this.leave); this.target.removeEventListener('drop', this.drop);
        window.removeEventListener('paste', this.paste);
    }
}
