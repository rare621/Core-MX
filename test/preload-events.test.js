const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every message main.js sends to the window must be on the preload allowlist, or the window never
// receives it (the FrostMod pop-up and synced-gear note once were missing).
test('every event main.js sends is allowed through preload', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const allowed = new Set([...preload.match(/EVENTS = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const sent = new Set([...main.matchAll(/\bsend\('([a-z]+:[A-Za-z]+)'/g)].map((m) => m[1]));
  assert.ok(sent.size > 10);
  assert.deepEqual([...sent].filter((e) => !allowed.has(e)), []);
});
