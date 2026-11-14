// Inspect a local package or write one readable asset to a new output file.
// Usage: node scripts/read-asset.js INPUT [--entry PATH_IN_PKZ] [--output NEW_FILE]
const fs = require('fs');
const path = require('path');
const { openArchive, decodeBlob } = require('../src/lib/assetread');
const edf = require('../src/lib/edf');
const pnt = require('../src/lib/pnt');

async function main() {
  const [input, ...args] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--entry', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Use --entry NAME and/or --output NEW_FILE');
    opts[args[i]] = args[i + 1];
  }
  if (!input) throw new Error('Usage: node scripts/read-asset.js INPUT [--entry PATH_IN_PKZ] [--output NEW_FILE]');
  let bytes, name = input;
  if (/\.(pkz|zip)$/i.test(input)) {
    const archive = await openArchive(input);
    try {
      if (!opts['--entry']) {
        if (opts['--output']) throw new Error('Select an --entry to save from the archive');
        console.log(JSON.stringify(archive.entries.map((e) => ({ name: e.fileName, bytes: e.uncompressedSize })), null, 2));
        return;
      }
      name = opts['--entry'].replace(/\\/g, '/');
      const entry = archive.entries.find((e) => e.fileName.toLowerCase() === name.toLowerCase());
      if (!entry) throw new Error('Entry not found in package');
      bytes = decodeBlob(await archive.read(entry));
    } finally { await archive.close(); }
  } else {
    if (opts['--entry']) throw new Error('--entry applies only to .pkz/.zip packages');
    bytes = decodeBlob(await fs.promises.readFile(input));
  }
  const result = { name, bytes: bytes.length };
  if (edf.isEdf(bytes)) {
    const model = edf.parse(bytes);
    result.meshes = model.nodes.length;
    result.triangles = model.nodes.reduce((n, m) => n + m.indices.length / 3, 0);
  } else if (pnt.isPnt(bytes)) result.textures = pnt.names(bytes);
  if (opts['--output']) {
    const output = path.resolve(opts['--output']);
    await fs.promises.writeFile(output, bytes, { flag: 'wx' });
    result.output = output;
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
