import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
});
let Flag, CeremonialDrape, FoldCurve, defaultDrape, textileSizeForPole, Solver, Particle, Vec3, ImageTexture, perspective, orthographic, lookAt, multiply4;
try {
    [{ Flag }, { CeremonialDrape, defaultDrape, textileSizeForPole }, { Solver }, { Particle }, { Vec3, perspective, orthographic, lookAt, multiply4 }, { ImageTexture }, { FoldCurve }] = await Promise.all([
        server.ssrLoadModule('/src/Flag.ts'), server.ssrLoadModule('/src/drape/CeremonialDrape.ts'),
        server.ssrLoadModule('/src/physics/Solver.ts'), server.ssrLoadModule('/src/physics/Particle.ts'),
        server.ssrLoadModule('/src/engine/math.ts'), server.ssrLoadModule('/src/engine/Geometry.ts'),
        server.ssrLoadModule('/src/drape/FoldCurve.ts'),
    ]);
} finally { await server.close(); }

const position = (drape, x, y) => new Vec3().fromArray(drape.geometry.positions, drape.index(x, y) * 3);
const positions = drape => Array.from(drape.geometry.positions);

function assertSurface(drape) {
    const p = drape.geometry.positions, n = drape.geometry.normals, ids = drape.geometry.indices;
    assert.ok(Array.from(p).every(Number.isFinite)); assert.ok(Array.from(n).every(Number.isFinite));
    const a = new Vec3(), b = new Vec3(), c = new Vec3();
    for (let i = 0; i < ids.length; i += 3) {
        a.fromArray(p, ids[i] * 3); b.fromArray(p, ids[i + 1] * 3); c.fromArray(p, ids[i + 2] * 3);
        const ab = b.sub(a), ac = c.sub(a);
        const areaRatio = ab.clone().cross(ac).length() / (ab.length() * ac.length());
        assert.ok(areaRatio > 0.00005, `Collapsed triangle ${i / 3}: ${areaRatio}`);
    }
}

test('square, portrait and landscape textiles preserve source ratio and fit the same stand', () => {
    for (const aspect of [0.01, 0.5, 1, 1.5, 3, 100]) for (const pole of [5, 7.5, 20]) {
        const { width, height } = textileSizeForPole(aspect, pole);
        assert.ok(Math.abs(width / height - aspect) < 1e-10);
        assert.ok(Math.abs(Math.hypot(width, height) - (pole - 0.3) * 0.84) < 1e-10);
        const drape = new CeremonialDrape(width, height);
        try {
            drape.setAttachmentHeight(-5 + pole - 0.1); drape.configure({ size: 1.1 }); assertSurface(drape);
            assert.ok(Math.min(...positions(drape).filter((_, i) => i % 3 === 1)) > -4.85);
        } finally { drape.dispose(); }
    }
});

test('the hoist and body share one indexed surface with no internal boundary', () => {
    const drape = new CeremonialDrape(4, 4);
    try {
        const edges = new Map(), ids = drape.geometry.indices;
        for (let i = 0; i < ids.length; i += 3) for (const [a, b] of [[ids[i], ids[i + 1]], [ids[i + 1], ids[i + 2]], [ids[i + 2], ids[i]]]) {
            const key = a < b ? `${a},${b}` : `${b},${a}`; edges.set(key, (edges.get(key) ?? 0) + 1);
        }
        assert.equal([...edges.values()].filter(count => count === 1).length, 2 * (drape.columns + drape.rows));
        assert.ok([...edges.values()].every(count => count <= 2));
        for (let y = 0; y < drape.rows; y++) {
            const a = drape.index(drape.sleeveColumns, y), b = drape.index(drape.sleeveColumns, y + 1);
            assert.equal(edges.get(`${a},${b}`), 2);
        }
        assertSurface(drape);
    } finally { drape.dispose(); }
});

// Reconstruct material lengths from UVs. This directly catches the old transverse
// contraction that stretched a square flag's printed emblem into a narrow oval.
function metricErrors(drape) {
    const uv = drape.geometry.uvs, errors = [];
    for (let y = 0; y < drape.rows; y++) for (let x = 0; x < drape.columns; x++) {
        const a = position(drape, x, y), b = position(drape, x + 1, y), c = position(drape, x, y + 1);
        const id = drape.index(x, y), right = drape.index(x + 1, y), below = drape.index(x, y + 1);
        const du = (uv[right * 2] - uv[id * 2]) * drape.width;
        const dv = (uv[id * 2 + 1] - uv[below * 2 + 1]) * drape.height;
        errors.push(Math.abs(a.distanceTo(b) / du - 1), Math.abs(a.distanceTo(c) / dv - 1));
    }
    return errors;
}

function areaWeightedStrain(drape, quantile) {
    const uv = drape.geometry.uvs, samples = [];
    let total = 0;
    for (let y = 0; y < drape.rows; y++) for (let x = 0; x < drape.columns; x++) {
        const a = drape.index(x, y), b = drape.index(x + 1, y), c = drape.index(x, y + 1);
        const du = (uv[b * 2] - uv[a * 2]) * drape.width, dv = (uv[a * 2 + 1] - uv[c * 2 + 1]) * drape.height;
        const weight = du * dv;
        samples.push({ error: Math.abs(position(drape, x, y).distanceTo(position(drape, x + 1, y)) / du - 1), weight },
            { error: Math.abs(position(drape, x, y).distanceTo(position(drape, x, y + 1)) / dv - 1), weight });
        total += weight * 2;
    }
    samples.sort((a, b) => a.error - b.error);
    let covered = 0;
    for (const sample of samples) { covered += sample.weight; if (covered >= total * quantile) return sample.error; }
    return samples.at(-1).error;
}

test('bends preserve BOTH material directions for square, portrait and landscape images', () => {
    for (const aspect of [0.5, 1, 1.5, 3]) {
        const { width, height } = textileSizeForPole(aspect, 7.5);
        const drape = new CeremonialDrape(width, height);
        try {
            assert.ok(Math.max(...metricErrors(drape)) < 0.02, 'material contraction must remain below 2% at mesh resolution');
            drape.configure({ opening: 28, folds: 8, foldDepth: 0.8, twist: 30, fall: 0.75, hoist: 0.7 });
            assert.ok(Math.max(...metricErrors(drape)) < 0.02);
        } finally { drape.dispose(); }
    }
});

test('square and landscape flags keep a vertical drape, a centered lower corner, and pole clearance', () => {
    for (const aspect of [1, 1.5]) {
        const { width, height } = textileSizeForPole(aspect, 7.5), drape = new CeremonialDrape(width, height);
        try {
            const p = positions(drape), xs = p.filter((_, i) => i % 3 === 0), ys = p.filter((_, i) => i % 3 === 1);
            assert.ok((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys)) < 0.65);
            assert.ok(Math.abs(position(drape, drape.columns, drape.rows).x) < 0.02);
            for (let i = 0; i < p.length; i += 3) assert.ok(Math.hypot(p[i], p[i + 2]) > 0.066);
        } finally { drape.dispose(); }
    }
});

test('all shape controls change the pose without rebuilding topology or cropping image corners', () => {
    const drape = new CeremonialDrape(4, 4);
    try {
        const topology = drape.geometry.indices;
        for (const [key, value] of Object.entries({ coneAmount: 0.4, size: 0.8, opening: 26, gather: 0.2, shoulder: 0.4, hoist: 0.7, fall: 0.75, folds: 8, foldDepth: 0.9, twist: 35, rotation: 120, bendNear: 90, bendMiddle: 100, bendOuter: 90, edgeCurl: 110 })) {
            drape.configure(defaultDrape); const before = positions(drape); drape.configure({ [key]: value });
            assert.ok(positions(drape).some((n, i) => Math.abs(n - before[i]) > 0.001), `${key} must change the pose`);
            assert.equal(drape.geometry.indices, topology);
            for (const [x, y, u, v] of [[0, 0, 0, 1], [drape.columns, 0, 1, 1], [0, drape.rows, 0, 0], [drape.columns, drape.rows, 1, 0]]) {
                const i = drape.index(x, y) * 2;
                assert.ok(Math.abs(drape.geometry.uvs[i] - u) < 1e-7); assert.ok(Math.abs(drape.geometry.uvs[i + 1] - v) < 1e-7);
            }
            assertSurface(drape);
        }
    } finally { drape.dispose(); }
});

test('cone-to-flat shapes preserve textile dimensions, including a square hanging by its diagonal', () => {
    for (const aspect of [0.5, 1, 1.5, 3]) {
        const { width, height } = textileSizeForPole(aspect, 7.5), drape = new CeremonialDrape(width, height);
        try {
            for (const coneAmount of [1, 0.9, 0.75, 0.5, 0.25, 0.1, 0]) {
                drape.configure({ coneAmount }); assertSurface(drape);
                assert.ok(Math.max(...metricErrors(drape)) < 0.02, `material dimensions at cone amount ${coneAmount}`);
                assert.ok(minimumStaffDistance(drape) > 0.05, `rest surface clears the staff at cone amount ${coneAmount}`);
                assert.ok(Math.abs(position(drape, 0, 0).y - drape.attachmentY) < 1e-6);
            }
            const top = position(drape, 0, 0), right = position(drape, drape.columns, 0);
            const left = position(drape, 0, drape.rows), bottom = position(drape, drape.columns, drape.rows);
            assert.ok(Math.abs(top.y - drape.attachmentY) < 1e-6, 'upper corner stays below the finial');
            assert.ok(Math.abs(bottom.x - top.x) < 1e-6, 'opposite corner hangs below the upper attachment');
            assert.ok(Math.abs(top.distanceTo(right) - width) < 1e-6);
            assert.ok(Math.abs(top.distanceTo(left) - height) < 1e-6);
            assert.ok(Math.abs(top.distanceTo(bottom) - Math.hypot(width, height)) < 1e-6);
            for (let i = 2; i < drape.geometry.positions.length; i += 3) {
                assert.ok(Math.abs(drape.geometry.positions[i] - top.z) < 1e-6, 'flat means a plane rather than a shallow cone');
            }
        } finally { drape.dispose(); }
    }
});

test('the default fold profile has inward and outward curvature and reaches behind the staff', () => {
    const curve = new FoldCurve(0.067);
    curve.build(defaultDrape, defaultDrape.shoulder / defaultDrape.hoist, 0, 0);
    const p = curve.points, a = new Vec3(), b = new Vec3(), c = new Vec3();
    let positive = 0, negative = 0, minX = 0;
    const step = Math.PI / 2 / (p.length / 3 - 1);
    for (let i = 3; i < p.length - 3; i += 3) {
        a.fromArray(p, i - 3); b.fromArray(p, i); c.fromArray(p, i + 3);
        const turn = new Vec3().crossVectors(b.clone().sub(a), c.clone().sub(b)).dot(b);
        if (turn > 1e-11) positive++; if (turn < -1e-11) negative++;
        minX = Math.min(minX, b.x);
        assert.ok(Math.abs(b.length() - 1) < 1e-9);
        assert.ok(Math.abs(a.distanceTo(b) / step - 1) < 1e-5, 'curve must remain unit speed');
    }
    assert.ok(positive > 100 && negative > 100, 'concave folds must coexist with convex folds');
    assert.ok(minX < -0.03, 'the body must be allowed behind the old half-plane restriction');
    assert.equal(curve.bendScale, 1, 'the reference pose must be achievable without contact limiting');
});

// Distance of each rendered triangle's horizontal footprint from the staff axis.
// Checking vertices alone misses triangles that cut through the cylinder.
function minimumStaffDistance(drape) {
    const p = drape.geometry.positions, ids = drape.geometry.indices;
    const edgeDistance = (ax, az, bx, bz) => {
        const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
        const t = lengthSq ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / lengthSq)) : 0;
        return Math.hypot(ax + dx * t, az + dz * t);
    };
    let minimum = Infinity;
    for (let i = 0; i < ids.length; i += 3) {
        const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
        const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
        const ab = ax * bz - az * bx, bc = bx * cz - bz * cx, ca = cx * az - cz * ax;
        if (Math.abs(ab + bc + ca) > 1e-12 && ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0))) return 0;
        minimum = Math.min(minimum, edgeDistance(ax, az, bx, bz), edgeDistance(bx, bz, cx, cz), edgeDistance(cx, cz, ax, az));
    }
    return minimum;
}

test('deep signed profiles keep material lengths and rendered triangles outside the staff', () => {
    for (const aspect of [0.5, 1, 1.5, 3]) for (const shoulder of [0.04, 0.18, 0.45]) {
        const { width, height } = textileSizeForPole(aspect, 7.5), drape = new CeremonialDrape(width, height);
        try {
            for (const bends of [
                { bendNear: -120, bendMiddle: -120, bendOuter: -120, edgeCurl: -120 },
                { bendNear: 120, bendMiddle: -120, bendOuter: 120, edgeCurl: -120 },
                { bendNear: -120, bendMiddle: 120, bendOuter: -120, edgeCurl: 120 },
            ]) {
                drape.configure({ ...bends, shoulder });
                assertSurface(drape);
                assert.ok(Math.max(...metricErrors(drape)) < 0.02, `contraction at ${aspect}:1, shoulder ${shoulder}`);
                assert.ok(minimumStaffDistance(drape) > 0.05, 'no rendered triangle may intersect the wooden staff');
            }
        } finally { drape.dispose(); }
    }
    const curve = new FoldCurve(0.067);
    curve.build({ ...defaultDrape, bendNear: 120, bendMiddle: -120, bendOuter: 120, edgeCurl: -120 }, 0.04, 0, 0);
    assert.ok(curve.bendScale > 0 && curve.bendScale < 1, 'impossible bends must be limited before entering the staff');
});

test('extreme control combinations do not collapse the upper cloth', () => {
    const drape = new CeremonialDrape(4, 4);
    try {
        for (const settings of [
            { opening: 16, gather: 1, shoulder: 0.04, hoist: 0.65, fall: 0.7, folds: 10, foldDepth: 1, twist: -45 },
            { opening: 36, gather: 0, shoulder: 0.45, hoist: 1, fall: 1, folds: 2, foldDepth: 0, twist: 45 },
            { opening: 36, gather: 1, shoulder: 0.04, hoist: 0.65, fall: 0.7, folds: 10, foldDepth: 1, twist: 45 },
        ]) { drape.configure(settings); assertSurface(drape); }
    } finally { drape.dispose(); }
});

test('wind releases the hoist below the upper cuff; pause and reset preserve the chosen pose', () => {
    const drape = new CeremonialDrape(4, 4);
    try {
        const rest = positions(drape), wind = new Vec3(25, 0, 20);
        let peakMotion = 0;
        for (let i = 0; i < 90; i++) {
            drape.advance(1 / 60, wind, 1);
            for (let j = 0; j < rest.length; j++) peakMotion = Math.max(peakMotion, Math.abs(drape.geometry.positions[j] - rest[j]));
        }
        const moving = positions(drape);
        assert.ok(peakMotion > 0.01, 'wind must produce visible motion somewhere in its oscillation');
        for (let x = 0; x <= 2; x++) {
            const i = drape.index(x, 0) * 3; assert.deepEqual(moving.slice(i, i + 3), rest.slice(i, i + 3));
        }
        const lowerHoist = drape.index(0, drape.rows) * 3;
        assert.ok(moving.slice(lowerHoist, lowerHoist + 3).some((value, i) => Math.abs(value - rest[lowerHoist + i]) > 0.01));
        assertSurface(drape);
        assert.equal(drape.advance(0, wind, 1), false); assert.deepEqual(positions(drape), moving);
        drape.reset(); assert.deepEqual(positions(drape), rest);
    } finally { drape.dispose(); }
});

test('simulated flat, intermediate and conical flags retain print scale and clear the staff', () => {
    for (const coneAmount of [0, 0.5, 1]) {
        const drape = new CeremonialDrape(4, 4);
        try {
            drape.configure({ coneAmount }); const uv = Array.from(drape.geometry.uvs);
            for (let frame = 0; frame < 120; frame++) drape.advance(1 / 60, new Vec3(0, 0, 20), 0.5);
            assertSurface(drape); assert.deepEqual(Array.from(drape.geometry.uvs), uv);
            // Check represented textile area, rather than giving a tiny cuff
            // cell the same importance as a large region of the printed emblem.
            assert.ok(areaWeightedStrain(drape, 0.95) < 0.025);
            assert.ok(areaWeightedStrain(drape, 0.99) < 0.05);
            assert.ok(minimumStaffDistance(drape) > 0.05);
            const moving = positions(drape);
            drape.configure({ bending: 0.8, shapeHold: 0.7, damping: 0.9 });
            assert.deepEqual(positions(drape), moving, 'physics sliders must not reset the fabric');
        } finally { drape.dispose(); }
    }
});

test('released cloth clears the staff after a long gravity settle with shape hold disabled', () => {
    const drape = new CeremonialDrape(4, 4);
    try {
        drape.configure({ shapeHold: 0 });
        for (let frame = 0; frame < 300; frame++) drape.advance(1 / 30, new Vec3(), 0.5);
        assert.ok(positions(drape).every(Number.isFinite));
        assert.ok(minimumStaffDistance(drape) > 0.05);
    } finally { drape.dispose(); }
});

test('fringe follows edited and moving edges; replacements and images are released', () => {
    const flag = new Flag(4, 4);
    try {
        const material = flag.fringe.mesh.material, geometry = flag.fringe.mesh.geometry;
        flag.setFringe(0.12, 80, false); assert.ok(geometry.disposed); assert.equal(flag.fringe.mesh.material, material);
        flag.configure({ opening: 28, rotation: 50 }); flag.advance(0.1, new Vec3(30, 0, 0), 1); flag.setFringe(0.12, 80, true);
        const fringe = flag.fringe.mesh.geometry.positions;
        assert.ok(Array.from(fringe).every(Number.isFinite));
        const count = (fringe.length / 3 - (flag.drape.hem.length + 1) * 2) / 25;
        flag.drape.hem.forEach((edge, i) => {
            const root = new Vec3().fromArray(fringe, (count * 25 + i * 2) * 3);
            const cloth = new Vec3().fromArray(flag.drape.geometry.positions, edge.a * 3); assert.ok(root.distanceTo(cloth) < 1e-7);
        });
        const texture = new ImageTexture({ naturalWidth: 600, naturalHeight: 600 }); flag.mesh.material.texture = texture;
        for (const style of ['Anime', 'Default']) { flag.setMaterialStyle(style); assert.equal(flag.mesh.material.texture, texture); assert.equal(texture.disposed, false); }
        flag.dispose(); assert.ok(texture.disposed); assert.ok(flag.mesh.geometry.disposed);
    } catch (error) { flag.dispose(); throw error; }
});

test('own projection and view matrices preserve a square in front view across viewport ratios', () => {
    const view = lookAt(new Vec3(0, 0, 10), new Vec3());
    for (const aspect of [0.5, 1, 2]) for (const projection of [perspective(Math.PI / 4, aspect, 0.1, 100), orthographic(-5 * aspect, 5 * aspect, -5, 5, 0.1, 100)]) {
        const m = multiply4(projection, view);
        const project = (x, y) => {
            const w = m[3] * x + m[7] * y + m[15];
            return [(m[0] * x + m[4] * y + m[12]) / w * aspect, (m[1] * x + m[5] * y + m[13]) / w];
        };
        const a = project(0, 0), b = project(1, 0), c = project(0, 1);
        assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.hypot(c[0] - a[0], c[1] - a[1]) - 1) < 1e-6);
    }
});

test('legacy solver still accelerates different masses equally using own vectors', () => {
    const solver = new Solver(), a = new Particle(0, 0, 0, 1), b = new Particle(1, 0, 0, 4);
    solver.addParticle(a); solver.addParticle(b); for (let i = 0; i < 60; i++) solver.update(1 / 60); assert.equal(a.position.y, b.position.y);
});
