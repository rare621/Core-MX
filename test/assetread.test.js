const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { deflateRawSync } = require('node:zlib');
const { decodeBlob, openArchive } = require('../src/lib/assetread');
const pnt = require('../src/lib/pnt');
const { zip } = require('./helpers/assets');

// Test-only reference RC4 encoder, also checked against the standard test vector.
function rc4(key, drop, bytes) {
  const table = Array.from({ length: 256 }, (_, i) => i);
  let a = 0, b = 0;
  for (let n = 0; n < 256; n++) {
    b = (b + table[n] + key[n % key.length]) % 256;
    [table[n], table[b]] = [table[b], table[n]];
  }
  b = 0;
  const out = Buffer.alloc(bytes.length);
  for (let n = -drop; n < bytes.length; n++) {
    a = (a + 1) % 256; b = (b + table[a]) % 256;
    [table[a], table[b]] = [table[b], table[a]];
    if (n >= 0) out[n] = bytes[n] ^ table[(table[a] + table[b]) % 256];
  }
  return out;
}

function sealed(plain, archive = false, bound = false) {
  const start = archive ? plain.readUInt32LE(plain.length - 6) : 0;
  const directory = plain.subarray(start), footer = Buffer.alloc(62);
  const key = Buffer.from('0123456789abcdef');
  footer.write('KCOL'); footer.writeUInt32LE(17, 4);
  footer.writeUInt32LE(directory.length, 56);
  footer.writeUInt16LE([...directory].reduce((a, b) => (a + b) & 65535, 0), 60);
  const mask = Buffer.from(footer.subarray(56));
  [0xfd, 0xc7, 0x1c, 0xaf, 0x35, 0x71].forEach((v, i) => { mask[i] ^= v; });
  for (let i = 0; i < 16; i++) {
    footer[8 + i] = key[i] ^ mask[(32 + i) % 6];
    footer[24 + i] = mask[i % 6] ^ (bound && i === 0 ? 1 : 0);
    footer[40 + i] = mask[(16 + i) % 6];
  }
  const data = Buffer.from(plain);
  if (archive) {
    let at = 0;
    while (at < start) {
      const length = 30 + plain.readUInt16LE(at + 26) + plain.readUInt16LE(at + 28);
      rc4(key, 273, plain.subarray(at, at + length)).copy(data, at);
      at += length + plain.readUInt32LE(at + 18);
    }
  }
  rc4(key, 273, directory).copy(data, start);
  return Buffer.concat([data, footer]);
}

function tempFile(t, buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxb-kcol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'asset.pkz'); fs.writeFileSync(file, buf);
  return file;
}

test('reference encoder matches the standard RC4 vector', () => {
  assert.equal(rc4(Buffer.from('Key'), 0, Buffer.from('Plaintext')).toString('hex'), 'bbf316e8d940af0ad3');
});

test('sealed assets decode byte for byte and plain inputs pass through', () => {
  const plain = Buffer.from('original synthetic asset');
  assert.deepEqual(decodeBlob(sealed(plain)), plain);
  assert.strictEqual(decodeBlob(plain), plain);
});

test('sealed PNT bytes reach the real texture decoder', () => {
  const pixels = Buffer.from([12, 34, 56, 255]);
  const image = deflateRawSync(pixels), plain = Buffer.alloc(244 + image.length);
  plain.write('PNT\0', 0, 'latin1'); plain.writeUInt32LE(1, 104);
  plain.write('gloves', 108); plain.writeUInt32LE(1, 208); plain.writeUInt32LE(1, 212);
  plain.writeUInt32LE(8 + image.length, 232); image.copy(plain, 244);
  const decoded = pnt.decode(sealed(plain));
  assert.equal(decoded[0].name, 'gloves'); assert.deepEqual(decoded[0].rgba, pixels);
});

test('corrupt content, invalid footer bounds and account bindings fail clearly', () => {
  const bad = sealed(Buffer.from('asset')); bad[0] ^= 1;
  assert.throws(() => decodeBlob(bad), /checksum/);
  const badSize = sealed(Buffer.from('asset')); badSize.writeUInt32LE(0xffffffff, badSize.length - 6);
  assert.throws(() => decodeBlob(badSize), /bounds/);
  assert.throws(() => decodeBlob(sealed(Buffer.from('asset'), false, true)), /Account-bound/);
  assert.throws(() => decodeBlob(sealed(Buffer.alloc(1024)), 512), /too large/);
});

test('sealed archives list and read individual entries without decoding the entire archive', async (t) => {
  const source = zip({ 'bike/gfx.cfg': 'model = bike.hrc', 'bike/bike.edf': 'synthetic mesh bytes' });
  const a = await openArchive(tempFile(t, sealed(source, true)));
  try {
    assert.deepEqual(a.entries.map((e) => e.fileName), ['bike/gfx.cfg', 'bike/bike.edf']);
    assert.equal((await a.read(a.entries[0])).toString(), 'model = bike.hrc');
    assert.equal((await a.read(a.entries[1])).toString(), 'synthetic mesh bytes');
    await assert.rejects(a.read(a.entries[1], 1), /too large/);
  } finally { await a.close(); }
});

test('sealed archive payload corruption is caught by ZIP CRC', async (t) => {
  const data = sealed(zip({ 'bike.edf': 'synthetic mesh bytes' }), true);
  data[30 + Buffer.byteLength('bike.edf')] ^= 1;
  const a = await openArchive(tempFile(t, data));
  try { await assert.rejects(a.read(a.entries[0]), /checksum/); }
  finally { await a.close(); }
});
