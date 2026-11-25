const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const profile = require('../src/lib/profile');
const game = require('../src/lib/game');

test('selecting a bike updates both game selection sections', async () => {
  const write = mock.method(profile, 'writeValues', async (_dir, _name, values) => values);
  try {
    const bike = 'MX2OEM_2023_Kawasaki_KX250';
    const values = await game.quickStart('unused', 'Rider', { bike });
    for (const expected of [
      ['info', 'bikeid', bike], ['info', 'class', 'MX2 OEM'],
      ['category', 'MX2 OEM', bike], ['bike', 'MX2 OEM', bike],
    ]) assert.ok(values.some((entry) => entry.every((part, i) => part === expected[i])), expected.join('/'));
  } finally { write.mock.restore(); }
});
