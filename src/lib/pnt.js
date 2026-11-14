// MX Bikes paint (.pnt) reader. A paint is a list of named textures, each stored as raw-deflate
// RGBA pixels. Layout documented by MXB App (github.com/Frostn1/mxb-app, MIT, crates/core/src/paint.rs):
//   header (108 B): "PNT\0" ... u32 texture count at 104
//   per texture: name[100], u32 width, u32 height, md5[16], u32 dataSize, 8 B padding, deflate(dataSize-8)
// Creator-sealed paints are unwrapped by assetread before parsing these headers.
const zlib = require('zlib');
const { decodeBlob } = require('./assetread');

const HEADER_SIZE = 108, NAME_SIZE = 100, IMAGE_HEADER_SIZE = NAME_SIZE + 4 + 4 + 16 + 4, PAD = 8;
const MAX_TEXTURES = 256, MAX_BYTES = 16384 * 16384 * 4;

function isPnt(buf) { return buf.length >= HEADER_SIZE && buf.slice(0, 4).equals(Buffer.from('PNT\0', 'latin1')); }

function headers(buf) {
  if (!isPnt(buf)) throw new Error('not a .pnt file');
  const count = buf.readUInt32LE(HEADER_SIZE - 4);
  if (count > MAX_TEXTURES) throw new Error('not a readable paint (sealed or damaged)');
  const out = [];
  let off = HEADER_SIZE;
  for (let i = 0; i < count; i++) {
    if (off + IMAGE_HEADER_SIZE + PAD > buf.length) throw new Error('truncated paint');
    const raw = buf.slice(off, off + NAME_SIZE);
    const name = raw.slice(0, raw.indexOf(0) >= 0 ? raw.indexOf(0) : NAME_SIZE).toString('latin1');
    const width = buf.readUInt32LE(off + NAME_SIZE);
    const height = buf.readUInt32LE(off + NAME_SIZE + 4);
    const size = buf.readUInt32LE(off + NAME_SIZE + 8 + 16);
    if (size < PAD || width * height * 4 > MAX_BYTES) throw new Error(`texture ${i}: bad header`);
    const start = off + IMAGE_HEADER_SIZE + PAD, end = start + size - PAD;
    if (end > buf.length) throw new Error(`texture ${i}: runs past end of file`);
    out.push({ name, width, height, start, end });
    off = end;
  }
  return out;
}

// -> [{ name, width, height, rgba: Buffer }]
function decode(buf, want) {
  buf = decodeBlob(buf);
  return headers(buf).filter((h) => !want || want(h.name)).map((h) => {
    const rgba = zlib.inflateRawSync(buf.subarray(h.start, h.end), { maxOutputLength: h.width * h.height * 4 + 16 });
    if (rgba.length !== h.width * h.height * 4) throw new Error(`'${h.name}': wrong pixel count`);
    return { name: h.name, width: h.width, height: h.height, rgba };
  });
}

function names(buf) { return headers(decodeBlob(buf)).map((h) => h.name); }

module.exports = { isPnt, decode, names };
