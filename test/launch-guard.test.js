const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const start = source.indexOf('async function confirmRiderBeforeGame(');
const end = source.indexOf('\n// Removing a row from Downloads', start);

function guardFixture() {
  assert.ok(start >= 0 && end > start);
  const buttons = {}, calls = [];
  let closeModal;
  const rider = { profile: 'Rider', bike: 'KX250', drafts: { 'Rider|KX250': { helmet: 'Bell' } }, identityDraft: {}, selectionDirty: false };
  const context = vm.createContext({
    S: { rider, view: 'game' },
    riderDirty: () => !!rider.drafts['Rider|KX250'] || rider.selectionDirty,
    riderDraftKey: () => 'Rider|KX250',
    riderChanges: () => ({ ...rider.drafts['Rider|KX250'], ...rider.identityDraft }),
    api: { invoke: async (...args) => { calls.push(args); return args[0] === 'game:running' ? false : { saved: true }; } },
    modal: ({ onClose }) => { closeModal = onClose; return { close: onClose }; },
    $: (selector) => ({ addEventListener: (_event, fn) => { buttons[selector] = fn; } }),
  });
  vm.runInContext(source.slice(start, end) + '\nthis.guard = confirmRiderBeforeGame;', context);
  return { context, buttons, calls, rider, close: () => closeModal() };
}

async function choose(fixture, button) {
  const result = fixture.context.guard('join');
  await new Promise(setImmediate);
  fixture.buttons[button]();
  return result;
}

test('continue with saved setup keeps the unsaved Rider draft', async () => {
  const f = guardFixture();
  assert.equal(await choose(f, '[data-use-saved]'), 'saved');
  assert.equal(f.rider.drafts['Rider|KX250'].helmet, 'Bell');
  assert.equal(f.calls.some(([name]) => name === 'rider:apply'), false);
});

test('Apply before joining saves and clears the Rider draft', async () => {
  const f = guardFixture();
  assert.equal(await choose(f, '[data-apply-first]'), 'applied');
  assert.equal(f.calls.find(([name]) => name === 'rider:apply')[3].helmet, 'Bell');
  assert.equal(f.rider.drafts['Rider|KX250'], undefined);
});

test('canceling the launch keeps the unsaved Rider draft', async () => {
  const f = guardFixture();
  const result = f.context.guard('join');
  await new Promise(setImmediate);
  f.close();
  assert.equal(await result, 'cancel');
  assert.equal(f.rider.drafts['Rider|KX250'].helmet, 'Bell');
});
