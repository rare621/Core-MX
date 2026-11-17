const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCreatorFiles } = require('../src/lib/creator-files');

test('MXB Hub blends are creator files, filed under Other / Tools', () => {
  assert.equal(isCreatorFiles(['Blends', 'dammlemonn', 'Handlebars', 'UNIVERSAL']), true);
  assert.equal(isCreatorFiles(['Blend Brands', 'KTM']), true);
  assert.equal(isCreatorFiles([' Blends ']), true);
});
test('paints, gear and models are not creator files', () => {
  assert.equal(isCreatorFiles(['Bike Paints', 'Free Mods', 'OHTEA']), false);
  assert.equal(isCreatorFiles(['Gear PNT Creation', 'PNT Creation']), false);
  assert.equal(isCreatorFiles(['Tracks']), false);
  assert.equal(isCreatorFiles([]), false);
  assert.equal(isCreatorFiles(undefined), false);
});
