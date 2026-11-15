const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const records = require('../src/lib/install-records');

test('deleted gear clears its install record while surviving paints, disabled mods and graphics stay installed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mxb-records-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modsDir = path.join(root, 'mods'), disabledDir = path.join(root, 'disabled');
  await fs.mkdir(modsDir); await fs.mkdir(disabledDir);
  await fs.writeFile(path.join(modsDir, 'remaining.pnt'), 'keep');
  await fs.writeFile(path.join(disabledDir, 'disabled.pkz'), 'keep');
  const before = { gone: { postId: 10, files: ['deleted.pnt'] }, partial: { files: ['deleted.pnt', 'remaining.pnt'] }, disabled: { files: ['disabled.pkz'] }, graphics: { files: ['game:plugins/overhaul.bin'] } };
  const missing = await records.missingFiles(before, { modsDir, disabledDir });
  assert.deepEqual([...missing], ['deleted.pnt']);
  const after = records.prune(before, missing);
  assert.equal(after.gone, undefined);
  assert.deepEqual(after.partial.files, ['remaining.pnt']);
  assert.equal(after.disabled, before.disabled); assert.equal(after.graphics, before.graphics);
  assert.equal((await records.missingFiles(before, { modsDir: path.join(root, 'offline-drive'), disabledDir })).size, 0);
});

test('My Gear bulk deletion sends files to the Recycle Bin and refreshes records even if one deletion fails', async () => {
  const source = await fs.readFile(path.join(__dirname, '../main.js'), 'utf8');
  const recycled = [], events = []; let reconciled = 0;
  const context = vm.createContext({ path, findItem: () => ({ title: 'Gear', parts: ['one.pnt', 'locked.pnt'] }), rootFor: () => 'mods', shell: { trashItem: async (file) => { if (file.endsWith('locked.pnt')) throw Error('locked'); recycled.push(file); } }, reconcileInstallRecords: async () => reconciled++, send: (...args) => events.push(args) });
  vm.runInContext(source.slice(source.indexOf('async function trash(ids)'), source.indexOf('async function reconcileInstallRecords(')), context);
  const result = await context.trash(['gear']);
  assert.deepEqual(recycled, [path.join('mods', 'one.pnt')]);
  assert.equal(result.errors.length, 1); assert.equal(reconciled, 1);
  assert.equal(events[0][0], 'library:changed');
});

test('reconciliation resets completed download jobs and preserves failed-to-delete or newly installed files', async () => {
  const source = await fs.readFile(path.join(__dirname, '../main.js'), 'utf8');
  let state = { removed: { files: ['gone.pnt'] }, kept: { files: ['locked.pnt'] } };
  const done = { status: 'done', installed: ['gone.pnt'] }, partial = { status: 'done', installed: ['gone.pnt', 'locked.pnt'] };
  const emitted = [];
  const context = vm.createContext({ require: () => ({ ...records, missingFiles: async () => { state = { ...state, replacement: { files: ['new.pnt'] } }; return new Set(['gone.pnt']); } }), store: { get: () => state, update: (_, fn) => { state = fn(state); } }, modsDir: () => 'mods', disabledDir: () => 'disabled', jobs: new Map([['done', done], ['partial', partial]]), emitJob: (job) => emitted.push(job) });
  vm.runInContext(source.slice(source.indexOf('async function reconcileInstallRecords('), source.indexOf('async function deleteRiderModel(')), context);
  await context.reconcileInstallRecords();
  assert.equal(state.removed, undefined); assert.ok(state.kept); assert.ok(state.replacement);
  assert.equal(done.filesDeleted, true); assert.equal(done.status, 'error');
  assert.deepEqual(partial.installed, ['locked.pnt']); assert.equal(partial.status, 'done'); assert.equal(emitted.length, 2);
});
