const { test } = require('node:test');
const assert = require('node:assert/strict');
const { titleMatches } = require('../src/lib/site');

test('Get Mods search matches word by word, whatever the dashes and punctuation', () => {
  const kato = { title: 'ZD – Kato Cycle Club', link: 'https://mxb-mods.com/zd-kato-cycle-club/' };
  assert.equal(titleMatches(kato, 'ZD - Kato Cycle Club'), true, 'the game\'s track name, with a plain hyphen');
  assert.equal(titleMatches(kato, 'kato cycle'), true);
  assert.equal(titleMatches(kato, 'ZD_Kato_Cycle_Club'), true);
  assert.equal(titleMatches({ title: 'Bell Moto 10´S different Googles', link: '' }, 'bell moto 10s'), true);
  assert.equal(titleMatches(kato, 'Kato Raceway'), false, 'every word must be there');
});
