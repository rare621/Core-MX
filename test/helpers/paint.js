const { deflateRawSync } = require('node:zlib');
function paint(name = 'helmet', color = 100) {
  const image = deflateRawSync(Buffer.from([color, 0, 0, 255]));
  const plain = Buffer.alloc(244 + image.length);
  plain.write('PNT\0'); plain.writeUInt32LE(1, 104); plain.write(name, 108);
  plain.writeUInt32LE(1, 208); plain.writeUInt32LE(1, 212);
  plain.writeUInt32LE(8 + image.length, 232); image.copy(plain, 244);
  return plain;
}
function multiPaint(names) {
  const header = Buffer.from(paint().subarray(0, 108)); header.writeUInt32LE(names.length, 104);
  return Buffer.concat([header, ...names.map((n) => paint(n).subarray(108))]);
}
module.exports = { paint, multiPaint };
