import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
let DrapePose, ClothSim, FlagCloth, Fringe, VERTICES_PER_STRAND, Export, color, math;
try {
    [{ DrapePose }, { ClothSim }, { FlagCloth }, { Fringe, VERTICES_PER_STRAND }, Export, color, math] = await Promise.all([
        server.ssrLoadModule('/src/sim/DrapePose.ts'), server.ssrLoadModule('/src/sim/ClothSim.ts'),
        server.ssrLoadModule('/src/scene/FlagCloth.ts'), server.ssrLoadModule('/src/scene/Fringe.ts'),
        server.ssrLoadModule('/src/render/Export.ts'), server.ssrLoadModule('/src/core/color.ts'),
        server.ssrLoadModule('/src/core/math.ts'),
    ]);
} finally { await server.close(); }

const POSE = { opening: 0.35, folds: 3, foldDepth: 0.35, seed: 7 };
const CLEARANCE = 0.0182;

function flag(width = 1.5, height = 1, pose = POSE) {
    return new FlagCloth({
        width, height, pose, resolution: 36, detail: 3, cuff: 0.07,
        areaDensity: 0.17, edgeMass: 0.06, hoistOffset: CLEARANCE, poleRadius: 0.016,
    });
}

test('the cone keeps every material ray at its length and the cloth outside the staff', () => {
    for (const opening of [0, 0.35, 1]) for (const foldDepth of [0, 0.6]) {
        const pose = new DrapePose();
        pose.build({ ...POSE, opening, foldDepth }, CLEARANCE);
        const out = new Float32Array(3);
        for (let k = 0; k <= 40; k++) for (const r of [0.4, 0.9, 1.6]) {
            const phi = k / 40 * Math.PI / 2;
            pose.map(r * Math.sin(phi), r * Math.cos(phi), out, 0);
            assert.ok(Math.abs(Math.hypot(out[0], out[1], out[2]) / r - 1) < 0.01, `ray length at r=${r}`);
            assert.ok(Math.hypot(out[0], out[2]) >= CLEARANCE - 1e-6, 'inside the staff');
            assert.ok(out[1] < 0, 'cone hangs below its apex');
        }
    }
});

test('the cloth winds round the staff and successive layers lie outside each other', () => {
    const pose = new DrapePose();
    pose.build({ ...POSE, foldDepth: 0 }, CLEARANCE);
    assert.ok(pose.totalTurns > 0.9, `turns: ${pose.totalTurns}`);
    // A ray one full turn later must be further from the axis at the same distance.
    const out = new Float32Array(3), r = 1;
    const radius = phi => { pose.map(r * Math.sin(phi), r * Math.cos(phi), out, 0); return Math.hypot(out[0], out[2]); };
    const perTurn = Math.PI / 2 / pose.totalTurns;
    for (let k = 0; k <= 10; k++) {
        const phi = k / 10 * (Math.PI / 2 - perTurn);
        assert.ok(radius(phi + perTurn) > radius(phi) + 0.01, 'layers overlap');
    }
});

test('the printed side of the cloth faces outwards on the outer layer', () => {
    const pose = new DrapePose();
    pose.build(POSE, CLEARANCE);
    const p = (u, v) => { const o = new Float32Array(3); pose.map(u, v, o, 0); return o; };
    let outwards = 0, samples = 0;
    for (let u = 0.3; u <= 1.4; u += 0.1) {
        const v = 0.05, e = 1e-3, a = p(u, v), du = p(u + e, v), dv = p(u, v + e);
        const pu = [du[0] - a[0], du[1] - a[1], du[2] - a[2]], pv = [dv[0] - a[0], dv[1] - a[1], dv[2] - a[2]];
        // Obverse normal = Pv × Pu (the image reads left to right from this side).
        const n = [pv[1] * pu[2] - pv[2] * pu[1], pv[2] * pu[0] - pv[0] * pu[2], pv[0] * pu[1] - pv[1] * pu[0]];
        if (n[0] * a[0] + n[2] * a[2] > 0) outwards++;
        samples++;
    }
    assert.equal(outwards, samples);
});

test('the cloth settles on its cuff without tearing, sinking into the staff or producing NaN', () => {
    const cloth = flag();
    const sim = cloth.sim, pinned = [];
    for (let i = 0; i < sim.count; i++) if (sim.pinned[i]) pinned.push([i, sim.positions.slice(i * 3, i * 3 + 3)]);
    assert.ok(pinned.length >= 3);
    cloth.setColliders([{ radius: 0.0172, min: -3, max: 0.3 }], -2.3);
    cloth.setParams({ bendingRigidity: 7e-6, shapeHold: 0.6, damping: 0.45 });
    for (let i = 0; i < 150; i++) cloth.step(1 / 60, { x: 0, y: 0, z: 0 }, 0, 48);
    assert.ok(Array.from(sim.positions).every(Number.isFinite));
    assert.ok(Array.from(cloth.surface.normals).every(Number.isFinite));
    for (const [i, p] of pinned) for (let k = 0; k < 3; k++) assert.ok(Math.abs(sim.positions[i * 3 + k] - p[k]) < 1e-7, 'cuff moved');
    assert.ok(sim.maxStrain() < 0.06, `strain ${sim.maxStrain()}`);
    for (let i = 0; i < sim.count; i++) {
        if (!sim.pinned[i]) assert.ok(Math.hypot(sim.positions[i * 3], sim.positions[i * 3 + 2]) >= 0.0172 - 1e-5);
    }
    cloth.dispose();
});

// Substeps are fixed; only air drag normals and collision candidates refresh per frame.
test('fixed substeps give nearly the same drape at 30, 60 and 120 frames per second', () => {
    const results = [30, 60, 120].map(fps => {
        const cloth = flag(1.2, 0.8);
        cloth.setParams({ bendingRigidity: 7e-6, shapeHold: 0.5, damping: 0.45 });
        for (let i = 0; i < fps; i++) cloth.sim.step(1 / fps, { x: 0, y: 0, z: 0 }, 0, 64);
        return Array.from(cloth.sim.positions);
    });
    for (const other of results.slice(1)) {
        const error = Math.max(...other.map((v, i) => Math.abs(v - results[0][i])));
        assert.ok(error < 2e-3, `frame-rate dependence ${error}`);
    }
});

test('fringe density follows the free edges and its geometry stays finite', () => {
    const cloth = flag();
    const fringe = new Fringe(cloth, { visible: true, length: 0.045, radius: 0.00045, density: 700, header: true, headerWidth: 0.009, color: [1, 0.8, 0.4] });
    const edges = 1.5 + 1 + 1.5;
    const strands = fringe.strands.geometry.positions.length / 3 / VERTICES_PER_STRAND;
    assert.ok(Math.abs(strands / (edges * 700) - 1) < 0.03, `strands ${strands}`);
    // Threads hang down: every tip is below its root.
    const p = fringe.strands.geometry.positions;
    for (let s = 0; s < strands; s += 37) assert.ok(p[(s * VERTICES_PER_STRAND + VERTICES_PER_STRAND - 1) * 3 + 1] < p[s * VERTICES_PER_STRAND * 3 + 1]);
    assert.ok(Array.from(fringe.strands.geometry.positions).every(Number.isFinite));
    cloth.setDetail(6); fringe.rebuild();
    assert.ok(Array.from(fringe.header.geometry.positions).every(Number.isFinite));
    fringe.dispose(); cloth.dispose();
});

test('export crop maps the framed rectangle onto the image and tiles cover it exactly once', () => {
    const rect = { x0: -0.3, x1: 0.5, y0: -0.9, y1: 0.7 };
    const m = Export.cropMatrix(rect);
    const out = math.transformPoint(m, rect.x0, rect.y1, 0);
    assert.ok(Math.abs(out[0] + 1) < 1e-6 && Math.abs(out[1] - 1) < 1e-6);
    const size = Export.outputSize(rect, 1600, 900, 4096);
    assert.equal(Math.max(size.width, size.height), 4096);
    assert.ok(Math.abs(size.width / size.height - (0.8 * 1600) / (1.6 * 900)) < 2e-3);
    const parts = Export.tiles(2500, 1300, 1024), covered = new Uint8Array(2500 * 1300);
    for (const t of parts) for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) covered[y * 2500 + x]++;
    assert.ok(covered.every(c => c === 1));
    const first = Export.tileRect(rect, 2500, 1300, parts[0]);
    assert.ok(Math.abs(first.x0 - rect.x0) < 1e-12 && Math.abs(first.y1 - rect.y1) < 1e-12);
    // Anime tiles are rendered with an overlap; the grown rectangle keeps the pixel scale.
    const t = parts[1], margin = 12;
    const grown = Export.tileRect(rect, 2500, 1300, { x: t.x - margin, y: t.y - margin, width: t.width + 2 * margin, height: t.height + 2 * margin });
    const inner = Export.tileRect(rect, 2500, 1300, t);
    const px = (rect.x1 - rect.x0) / 2500;
    assert.ok(Math.abs((inner.x0 - grown.x0) / px - margin) < 1e-6 && Math.abs((grown.x1 - inner.x1) / px - margin) < 1e-6);
});

test('read-back flips rows and removes premultiplied alpha', () => {
    const source = new Uint8Array([
        100, 50, 0, 128, 0, 0, 0, 0, // bottom row
        255, 255, 255, 255, 10, 20, 30, 255, // top row
    ]);
    const target = new Uint8ClampedArray(16);
    Export.blitTile(source, { x: 0, y: 0, width: 2, height: 2 }, target, 2);
    assert.deepEqual(Array.from(target.slice(0, 8)), [255, 255, 255, 255, 10, 20, 30, 255]);
    assert.deepEqual(Array.from(target.slice(8, 12)), [199, 100, 0, 128]);
    assert.equal(target[15], 0);
});

test('colour temperature: warm light is red, cool light is blue, luminance is normalised', () => {
    const [wr, , wb] = color.kelvinToLinear(3000), [cr, , cb] = color.kelvinToLinear(9000);
    assert.ok(wr > wb && cb > cr);
    for (const k of [2500, 5600, 8000]) {
        const [r, g, b] = color.kelvinToLinear(k);
        assert.ok(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b - 1) < 1e-6);
    }
});
