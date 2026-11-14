// Synthetic container writer used only by tests.
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


module.exports = { sealed };
