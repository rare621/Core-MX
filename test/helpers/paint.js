const { deflateRawSync } = require('node:zlib');
function paint(name = 'helmet', color = 100) {
  const image = deflateRawSync(Buffer.from([color, 0, 0, 255]));
  const plain = Buffer.alloc(244 + image.length);
  plain.write('PNT\0'); plain.writeUInt32LE(1, 104); plain.write(name, 108);
  plain.writeUInt32LE(1, 208); plain.writeUInt32LE(1, 212);
  plain.writeUInt32LE(8 + image.length, 232); image.copy(plain, 244);
  return plain;
}
module.exports = { paint };
