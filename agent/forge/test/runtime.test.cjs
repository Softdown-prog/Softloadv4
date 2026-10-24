const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Canvas primitives: projection, collision, stable seed, timed sprites, bounded loop', async () => {
    const r = await import('../html5/runtime.mjs');
    const p = await import('../html5/procedural.mjs');
    const point = r.isoToScreen(3.25, -2);
    assert.deepEqual(r.screenToIso(point.x, point.y), { x: 3.25, y: -2 });
    assert.equal(r.moveAndCollide({ x: 0, y: 0, width: 10, height: 10 }, 1000, 0, [{ x: 30, y: -5, width: 10, height: 20 }]).x, 20);
    assert.deepEqual(p.generateTerrain({ width: 8, height: 8, seed: 7 }), p.generateTerrain({ width: 8, height: 8, seed: 7 }));
    assert.notDeepEqual(p.generateTerrain({ width: 8, height: 8, seed: 7 }), p.generateTerrain({ width: 8, height: 8, seed: 9 }));
    let draw;
    const ctx = { save() {}, restore() {}, drawImage(...args) { draw = args; } };
    r.drawAnimation(ctx, {}, { pixelArt: true, anchor: [4, 8], frames: [{ rect: [0, 0, 16, 16], durationMs: 50 }, { rect: [16, 0, 16, 16], durationMs: 100 }] }, 75, 100, 100);
    assert.deepEqual(draw.slice(1), [16, 0, 16, 16, 96, 92, 16, 16]);
    let next, updates = 0;
    const loop = r.createLoop({ update() { updates++; }, render() {}, requestFrame(fn) { next = fn; return 1; }, cancelFrame() {} });
    loop.start(); next(0); next(3600000); assert.ok(updates <= 5); loop.stop();
});
