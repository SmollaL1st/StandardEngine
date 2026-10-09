import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
let ClothDynamics, Vec3;
try {
    [{ ClothDynamics }, { Vec3 }] = await Promise.all([
        server.ssrLoadModule('/src/physics/ClothDynamics.ts'), server.ssrLoadModule('/src/engine/math.ts'),
    ]);
} finally { await server.close(); }

function mesh(columns = 18, rows = 14, curved = false) {
    const width = 1.8, height = 2.2, count = (columns + 1) * (rows + 1);
    const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2), pinned = new Uint8Array(count);
    const ids = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
        const id = y * (columns + 1) + x, u = x * width / columns;
        positions.set(curved ? [1.5 + Math.sin(u), 2 - y * height / rows, 1 + Math.cos(u)] :
            [1.5 + u, 2 - y * height / rows, 0.2], id * 3);
        uvs.set([x / columns, 1 - y / rows], id * 2); pinned[id] = y === 0 ? 1 : 0;
        if (x < columns && y < rows) {
            const right = id + 1, below = id + columns + 1;
            ids.push(id, right, below, right, below + 1, below);
        }
    }
    const indices = new Uint32Array(ids);
    return { positions, uvs, indices, pinned, width, height };
}

function solver(m) { return new ClothDynamics(m.positions, m.uvs, m.indices, m.width, m.height, m.pinned); }
function edgeError(dynamics, m) {
    let maximum = 0;
    for (let i = 0; i < m.indices.length; i += 3) for (const [a, b] of [[m.indices[i], m.indices[i + 1]],
        [m.indices[i + 1], m.indices[i + 2]], [m.indices[i + 2], m.indices[i]]]) {
        if (m.pinned[a] && m.pinned[b]) continue;
        const material = Math.hypot((m.uvs[a * 2] - m.uvs[b * 2]) * m.width,
            (m.uvs[a * 2 + 1] - m.uvs[b * 2 + 1]) * m.height);
        const p = dynamics.positions, actual = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
        maximum = Math.max(maximum, Math.abs(actual / material - 1));
    }
    return maximum;
}

test('XPBD bends move under aerodynamic pressure while anchors and material lengths remain stable', () => {
    for (const curved of [false, true]) {
        const m = mesh(18, 14, curved), dynamics = solver(m), wind = new Vec3(0, 0, 12);
        dynamics.setParameters({ bending: 0.35, drape: 0.6, damping: 0.5 });
        for (let frame = 0; frame < 120; frame++) dynamics.advance(1 / 60, wind);
        assert.ok(dynamics.positions.every(Number.isFinite));
        for (let id = 0; id < m.pinned.length; id++) if (m.pinned[id])
            assert.deepEqual(Array.from(dynamics.positions.slice(id * 3, id * 3 + 3)), Array.from(m.positions.slice(id * 3, id * 3 + 3)));
        assert.ok(edgeError(dynamics, m) < 0.025, `Material stretch: ${edgeError(dynamics, m)}`);
        let moved = 0;
        for (let i = 0; i < m.positions.length; i++) moved = Math.max(moved, Math.abs(dynamics.positions[i] - m.positions[i]));
        assert.ok(moved > 0.03);
    }
});

test('fixed simulation steps give the same result at 30, 60 and 120 render frames per second', () => {
    const m = mesh(8, 6), results = [];
    for (const fps of [30, 60, 120]) {
        const dynamics = solver(m);
        for (let frame = 0; frame < fps; frame++) dynamics.advance(1 / fps, new Vec3(0, 0, 8));
        results.push(Array.from(dynamics.positions));
    }
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
});

test('coarse curved chords retain the fine material arc instead of forcing the folds open', () => {
    const m = mesh(3, 6), dynamics = solver(m), curvedTarget = m.positions.slice();
    const radius = 0.45;
    for (let id = 0; id < m.pinned.length; id++) {
        const angle = m.uvs[id * 2] * m.width / radius;
        curvedTarget[id * 3] = 1.5 + radius * Math.sin(angle);
        curvedTarget[id * 3 + 2] = 0.8 + radius * Math.cos(angle);
    }
    // Each horizontal coarse chord is visibly shorter than its source arc.
    // Stretching it back to the UV arc would silently unfold the display mesh.
    const chord = Math.hypot(curvedTarget[3] - curvedTarget[0], curvedTarget[5] - curvedTarget[2]);
    assert.ok(chord / (m.width / 3) < 0.94);
    dynamics.setTarget(curvedTarget, true);
    dynamics.advance(1 / 120, new Vec3());
    let largestMovement = 0;
    for (let i = 0; i < curvedTarget.length; i++) largestMovement = Math.max(largestMovement, Math.abs(dynamics.positions[i] - curvedTarget[i]));
    assert.ok(largestMovement < 0.005, `Curved target unfolded by ${largestMovement}`);
});

test('nonuniform shoulder cells transfer hanging load to the cuff without excessive material stretch', () => {
    const m = mesh(24, 18);
    for (let id = 0; id < m.pinned.length; id++) {
        const u = 0.05 * Math.expm1(m.uvs[id * 2] * Math.log1p(m.width / 0.05));
        const v = 0.05 * Math.expm1((1 - m.uvs[id * 2 + 1]) * Math.log1p(m.height / 0.05));
        m.uvs[id * 2] = u / m.width; m.uvs[id * 2 + 1] = 1 - v / m.height;
        m.positions.set([1.5 + u, 2 - v, 0.2], id * 3);
        m.pinned[id] = id === 0 ? 1 : 0;
    }
    const dynamics = solver(m);
    for (let frame = 0; frame < 120; frame++) dynamics.advance(1 / 60, new Vec3(0, 0, 8));
    assert.ok(edgeError(dynamics, m) < 0.1, `Nonuniform material stretch: ${edgeError(dynamics, m)}`);
});

test('target edits, translation, pause gaps and reset preserve finite state', () => {
    const m = mesh(8, 6), dynamics = solver(m);
    const target = m.positions.slice();
    for (let i = 0; i < target.length; i += 3) target[i + 2] += 0.3;
    dynamics.setTarget(target);
    for (let i = 0; i < m.pinned.length; i++) if (m.pinned[i]) assert.equal(dynamics.positions[i * 3 + 2], target[i * 3 + 2]);
    for (let frame = 0; frame < 30; frame++) dynamics.advance(frame % 2 ? 1 / 60 : 500, new Vec3(40, 10, -40));
    assert.ok(dynamics.positions.every(Number.isFinite)); assert.ok(dynamics.velocities.every(Number.isFinite));
    dynamics.translate(0.25, 1, -0.1); dynamics.reset();
    for (let i = 0; i < target.length; i += 3) {
        assert.ok(Math.abs(dynamics.positions[i] - target[i] - 0.25) < 1e-6);
        assert.ok(Math.abs(dynamics.positions[i + 1] - target[i + 1] - 1) < 1e-6);
        assert.ok(Math.abs(dynamics.positions[i + 2] - target[i + 2] + 0.1) < 1e-6);
    }
    assert.ok(dynamics.velocities.every(value => value === 0));
    assert.equal(dynamics.advance(NaN, new Vec3()), false);
    assert.equal(dynamics.advance(-1, new Vec3()), false);
});

test('staff and floor contact apply only to free vertices', () => {
    const m = mesh(5, 5);
    for (let i = 0; i < m.positions.length; i += 3) {
        m.positions[i] = 0.001; m.positions[i + 1] -= 7; m.positions[i + 2] = 0.001;
    }
    const dynamics = solver(m); dynamics.advance(1 / 120, new Vec3());
    for (let id = 0; id < m.pinned.length; id++) {
        const i = id * 3;
        if (m.pinned[id]) assert.deepEqual(Array.from(dynamics.positions.slice(i, i + 3)), Array.from(m.positions.slice(i, i + 3)));
        else {
            assert.ok(Math.hypot(dynamics.positions[i], dynamics.positions[i + 2]) >= 0.057 - 1e-7);
            assert.ok(dynamics.positions[i + 1] >= -5.02 - 1e-6);
        }
    }
});
