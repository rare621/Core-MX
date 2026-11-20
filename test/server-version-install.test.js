const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const installer = require('../src/lib/installer');

// A track's "Server Version" download (e.g. Jordan River: slcjordanriver.pkz, 283 MB player and
// 22 MB server under the same name) must never replace the player track, nor install without review.
test('a server version never replaces the installed player track', () => {
  const mods = fs.mkdtempSync(path.join(os.tmpdir(), 'mxb-srv-'));
  try {
    fs.mkdirSync(path.join(mods, 'tracks', 'motocross'), { recursive: true });
    fs.writeFileSync(path.join(mods, 'tracks', 'motocross', 'slcjordanriver.pkz'), 'player version');
    const files = [{ rel: 'slcjordanriver.pkz', abs: '', size: 1 }];
    const ctx = { categories: [22], title: 'JORDAN RIVER', modsDir: mods, reinstall: false };
    const player = installer.plan(files, { ...ctx, reinstall: true }, {});
    assert.equal(player.entries[0].status, 'overwrite', 'reinstalling the player version may update it');
    const server = installer.plan(files, { ...ctx, serverVersion: true }, {});
    assert.deepEqual([server.entries[0].status, server.entries[0].dest, server.entries[0].how], ['skip', null, 'server-keeps-player']);
    assert.equal(server.confident, false, 'never installed without review');
    assert.ok(server.warnings.some((w) => /server version/.test(w) && /kept and not replaced/.test(w)));
    // A server copy with its own name installs next to the player track, with a note, after review.
    const own = installer.plan([{ rel: 'radmx_server.pkz', abs: '', size: 1 }], { ...ctx, serverVersion: true }, {});
    assert.deepEqual([own.entries[0].status, own.entries[0].dest, own.confident], ['new', 'tracks/motocross/radmx_server.pkz', false]);
    assert.ok(own.warnings.some((w) => /empty or black/.test(w)));
  } finally { fs.rmSync(mods, { recursive: true, force: true }); }
});
