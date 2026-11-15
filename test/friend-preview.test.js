const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selection, build } = require('../src/lib/friend-preview');
const outfit = { bike: 'FriendBike', equipped: [{ slot: 'helmet', value: 'FriendHelmet' }, { slot: 'suitPaint', value: 'FriendKit' }, { slot: 'bikePaint', value: 'FriendLivery' }, { slot: 'tyres', value: 'FriendTyres' }, { slot: 'protection', value: 'None' }], items: [] };
test('friend scene uses shared paints and tyres without reading or writing the local outfit', async () => {
  const calls = [];
  const scene = await build(outfit, { modsDir: 'missing-test-mods', buildModel: async (type, opts) => { calls.push({ type, opts }); return { parts: [{}] }; } });
  assert.ok(scene.rider && scene.bike);
  assert.equal(calls.find((c) => c.type === 'rider').opts.current.suitPaint, 'FriendKit');
  assert.equal(calls.find((c) => c.type === 'rider').opts.current.protection, '');
  assert.equal(calls.find((c) => c.type === 'bike').opts.paint, 'FriendLivery');
  assert.equal(calls.find((c) => c.type === 'bike').opts.tyresOverride, 'FriendTyres');
});
test('missing or conflicting gear hides only the affected actor, unreadable assets never substitute another outfit', async () => {
  const scene = await build({ ...outfit, items: [{ slot: 'helmet', state: 'name-taken' }] }, { modsDir: 'missing-test-mods', buildModel: async () => ({ parts: [{}] }) });
  assert.equal(scene.rider, null); assert.ok(scene.bike); assert.equal(scene.pending, 1);
  const unreadable = await build(outfit, { modsDir: 'missing-test-mods', buildModel: async () => ({ parts: [{}], unreadable: ['paint'] }) });
  assert.equal(unreadable.rider, null); assert.equal(unreadable.bike, null);
  assert.throws(() => selection({ ...outfit, bike: '../other' }), /valid bike/);
  assert.throws(() => selection({ ...outfit, equipped: [{ slot: 'helmet', value: '../other' }] }), /invalid gear/);
});
