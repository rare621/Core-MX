const { crc32 } = require('node:zlib');

// Original tiny fixtures, with the layout accepted by our EDF reader.
function model(name) {
  const vertexStart = 0x54 + 4, count = 8, indexStart = vertexStart + count * 72;
  const buf = Buffer.alloc(indexStart + 8 + 12 + name.length + 1);
  buf.write('EDF\0', 0, 'latin1');
  buf.writeUInt32LE(count, 0x54);
  for (let i = 0; i < count; i++) {
    buf.writeFloatLE(i / 10, vertexStart + i * 12);
    buf.writeFloatLE(1, vertexStart + count * 44 + i * 12 + 4);
  }
  buf.writeUInt32LE(1, indexStart);
  [0, 1, 2].forEach((v, i) => buf.writeUInt32LE(v, indexStart + 4 + i * 4));
  buf.write(name, indexStart + 8 + 12, 'latin1');
  return buf;
}

// Minimal ZIP with stored entries. No third-party/game assets in the tests.
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = Buffer.from(name), body = Buffer.from(data);
    const header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(body), 14);
    header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(crc32(body), 16);
    record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    local.push(header, filename, body); central.push(record, filename);
    offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}


module.exports = { model, zip };
