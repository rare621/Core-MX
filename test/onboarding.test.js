const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The onboarding pictures ship with the app and every numbered marker sits on the picture.
test('onboarding pages point at pictures that exist, with markers inside them', () => {
  const dir = path.join(__dirname, '../src/renderer');
  const src = fs.readFileSync(path.join(dir, 'onboarding.js'), 'utf8');
  const images = [...src.matchAll(/img: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(images.length, 5);
  for (const img of images) assert.ok(fs.statSync(path.join(dir, img)).size < 200 * 1024, `${img} exists and is small`);
  for (const [, x, y] of src.matchAll(/\{ x: (\d+), y: (\d+), t:/g)) assert.ok(+x >= 0 && +x <= 100 && +y >= 0 && +y <= 100);
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const steps = app.split('\n').find((line) => line.startsWith('const SETUP_STEPS = ['));
  for (const step of ['get', 'library', 'rider', 'play', 'friends', 'online']) assert.ok(steps.includes("'" + step + "'"), step);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<script src="onboarding.js"><\/script>/);
});
