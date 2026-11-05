import { Vec3, clamp, lookAt, multiply, orthographic, perspective, radians, type Mat4 } from '../core/math';

export type Projection = 'perspective' | 'orthographic';
export type ViewPreset = 'front' | 'threeQuarter' | 'side' | 'low' | 'high';

export const VIEW_PRESETS: Record<ViewPreset, { label: string; yaw: number; pitch: number }> = {
    front: { label: 'Анфас', yaw: 0, pitch: 0.04 },
    threeQuarter: { label: '3/4 справа', yaw: radians(32), pitch: 0.06 },
    side: { label: 'Сбоку', yaw: radians(80), pitch: 0.04 },
    low: { label: 'Снизу', yaw: radians(20), pitch: radians(-14) },
    high: { label: 'Сверху', yaw: radians(25), pitch: radians(28) },
};

/** Orbit camera with a physical focal length, measured on a 24 mm full-frame sensor height. */
export class OrbitCamera {
    readonly target = new Vec3(0, 1.4, 0);
    readonly eye = new Vec3();
    yaw = 0;
    pitch = 0.05;
    distance = 5;
    focal = 50;
    projection: Projection = 'perspective';
    onChange: () => void = () => undefined;
    private canvas?: HTMLCanvasElement;
    private pointers = new Map<number, { x: number; y: number }>();
    private drag?: { id: number; x: number; y: number; pan: boolean };
    private pinch = 0;
    private fitHeight = 2.5;
    private fitCentre = new Vec3(0, 1.3, 0);

    get fovY() { return 2 * Math.atan(12 / this.focal); }

    attach(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', this.down);
        canvas.addEventListener('pointermove', this.move);
        canvas.addEventListener('pointerup', this.up);
        canvas.addEventListener('pointercancel', this.up);
        canvas.addEventListener('wheel', this.wheel, { passive: false });
        canvas.addEventListener('contextmenu', this.context);
    }

    /** Frames an object of the given height so it fills most of the view. */
    fit(centre: Vec3, height: number, resetAngles = false) {
        this.fitCentre.copy(centre); this.fitHeight = height;
        this.target.copy(centre);
        this.distance = height * 1.12 / (2 * Math.tan(this.fovY / 2));
        if (resetAngles) { this.yaw = VIEW_PRESETS.front.yaw; this.pitch = VIEW_PRESETS.front.pitch; }
        this.onChange();
    }

    /** Keeps the framing when the focal length changes, like zooming while stepping back. */
    setFocal(focal: number) {
        const before = Math.tan(this.fovY / 2);
        this.focal = clamp(focal, 12, 300);
        this.distance *= before / Math.tan(this.fovY / 2);
        this.onChange();
    }

    setView(preset: ViewPreset) {
        const v = VIEW_PRESETS[preset];
        this.yaw = v.yaw; this.pitch = v.pitch;
        this.fit(this.fitCentre, this.fitHeight);
    }

    update() {
        const c = Math.cos(this.pitch);
        this.eye.set(this.target.x + Math.sin(this.yaw) * c * this.distance, this.target.y + Math.sin(this.pitch) * this.distance,
            this.target.z + Math.cos(this.yaw) * c * this.distance);
    }

    view(): Mat4 { this.update(); return lookAt(this.eye, this.target); }

    /** Clip planes of the perspective projection. */
    nearFar(): [number, number] { return [Math.max(0.01, this.distance * 0.02), this.distance * 20 + 50]; }

    projectionMatrix(aspect: number): Mat4 {
        const [near, far] = this.nearFar();
        if (this.projection === 'orthographic') {
            const half = this.distance * Math.tan(this.fovY / 2);
            return orthographic(-half * aspect, half * aspect, -half, half, -far, far);
        }
        return perspective(this.fovY, aspect, near, far);
    }

    viewProjection(aspect: number) { return multiply(this.projectionMatrix(aspect), this.view()); }

    private down = (e: PointerEvent) => {
        this.canvas?.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
        else { this.drag = undefined; this.pinch = this.pinchDistance(); }
    };
    private move = (e: PointerEvent) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) {
            const d = this.pinchDistance();
            if (d > 0 && this.pinch > 0) this.distance = clamp(this.distance * this.pinch / d, 0.1, 80);
            this.pinch = d; this.onChange();
            return;
        }
        if (this.drag?.id !== e.pointerId) return;
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (this.drag.pan) {
            const scale = this.distance * Math.tan(this.fovY / 2) * 2 / Math.max(1, this.canvas?.clientHeight ?? 600);
            this.target.x -= dx * Math.cos(this.yaw) * scale;
            this.target.z += dx * Math.sin(this.yaw) * scale;
            this.target.y += dy * scale;
        } else {
            this.yaw -= dx * 0.006;
            this.pitch = clamp(this.pitch + dy * 0.005, radians(-35), radians(80));
        }
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        this.onChange();
    };
    private pinchDistance() {
        const p = [...this.pointers.values()];
        return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
    }
    private up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.drag = undefined; this.pinch = 0; };
    private wheel = (e: WheelEvent) => {
        e.preventDefault();
        this.distance = clamp(this.distance * Math.exp(clamp(e.deltaY, -200, 200) * 0.0012), 0.1, 80);
        this.onChange();
    };
    private context = (e: Event) => e.preventDefault();

    dispose() {
        const c = this.canvas;
        if (!c) return;
        c.removeEventListener('pointerdown', this.down); c.removeEventListener('pointermove', this.move);
        c.removeEventListener('pointerup', this.up); c.removeEventListener('pointercancel', this.up);
        c.removeEventListener('wheel', this.wheel); c.removeEventListener('contextmenu', this.context);
    }
}
