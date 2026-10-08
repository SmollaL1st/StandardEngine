import { Vec3, clamp, lookAt, multiply4, orthographic, perspective, radians } from './math';

export type Projection = 'Perspective' | 'Orthographic';

export class Camera {
    readonly target = new Vec3(0.35, -1, 0);
    readonly eye = new Vec3();
    yaw = 0;
    pitch = 0.07;
    distance = 11.5;
    projection: Projection = 'Orthographic';
    rightInset = 0;
    private pointer?: { id: number; x: number; y: number; pan: boolean };
    private pointers = new Map<number, { x: number; y: number }>();
    private pinchDistance = 0;
    private readonly canvas: HTMLCanvasElement;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', this.down);
        canvas.addEventListener('pointermove', this.move);
        canvas.addEventListener('pointerup', this.up);
        canvas.addEventListener('pointercancel', this.up);
        canvas.addEventListener('lostpointercapture', this.up);
        canvas.addEventListener('wheel', this.wheel, { passive: false });
        canvas.addEventListener('contextmenu', this.context);
    }
    fit(poleLength: number, reset = false) {
        this.target.set(0.35, -5 + (poleLength + 0.5) / 2, 0);
        this.distance = (poleLength + 0.6) * 1.2 / (2 * Math.tan(radians(45) / 2));
        if (reset) { this.yaw = 0; this.pitch = 0.07; }
    }
    matrix(aspect: number) {
        this.eye.set(this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
            Math.max(-4.85, this.target.y + Math.sin(this.pitch) * this.distance),
            this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance);
        const half = this.distance * Math.tan(radians(45) / 2);
        const projection = this.projection === 'Orthographic' ? orthographic(-half * aspect, half * aspect, -half, half, 0.05, 200)
            : perspective(radians(45), aspect, 0.05, 200);
        // Shift the optical center into the visible viewport beside the controls.
        const offset = clamp(this.rightInset / Math.max(1, this.canvas.clientWidth), 0, 0.45);
        if (this.projection === 'Orthographic') projection[12] -= offset;
        else projection[8] += offset;
        return multiply4(projection, lookAt(this.eye, this.target));
    }
    private down = (e: PointerEvent) => {
        this.canvas.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
        else { this.pointer = undefined; this.pinchDistance = this.pinch(); }
    };
    private move = (e: PointerEvent) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            const distance = this.pinch();
            if (distance > 0 && this.pinchDistance > 0) this.distance = clamp(this.distance * this.pinchDistance / distance, 3, 60);
            this.pinchDistance = distance;
        } else if (this.pointer?.id === e.pointerId) {
            const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
            if (this.pointer.pan) {
                const scale = this.distance * 0.0007;
                this.target.x -= dx * Math.cos(this.yaw) * scale;
                this.target.z += dx * Math.sin(this.yaw) * scale;
                this.target.y += dy * scale;
            } else {
                this.yaw -= dx * 0.006;
                // Keep the camera above the base, including during large touch drags.
                const minPitch = Math.asin(clamp((-4.9 - this.target.y) / this.distance, -0.9, 0));
                this.pitch = clamp(this.pitch + dy * 0.006, minPitch, 1.25);
            }
            this.pointer.x = e.clientX; this.pointer.y = e.clientY;
        }
    };
    private pinch() { const p = [...this.pointers.values()]; return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0; }
    private up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.pointer = undefined; this.pinchDistance = 0; };
    private wheel = (e: WheelEvent) => { e.preventDefault(); this.distance = clamp(this.distance * Math.exp(clamp(e.deltaY, -200, 200) * 0.0015), 3, 60); };
    private context = (e: Event) => e.preventDefault();
    dispose() {
        this.canvas.removeEventListener('pointerdown', this.down); this.canvas.removeEventListener('pointermove', this.move);
        this.canvas.removeEventListener('pointerup', this.up); this.canvas.removeEventListener('pointercancel', this.up);
        this.canvas.removeEventListener('lostpointercapture', this.up); this.canvas.removeEventListener('wheel', this.wheel);
        this.canvas.removeEventListener('contextmenu', this.context);
    }
}
