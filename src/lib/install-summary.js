function category(file) {
  const p = file.replace(/^(game|user):/, '').toLowerCase();
  if (/^profiles\/[^/]+\/setups\//.test(p)) return 'setups';
  if (/^ui\/[^/]+\.str$/.test(p)) return 'translations';
  if (/^tracks\//.test(p)) return 'tracks';
  if (/^bikes\/.+\/paints\//.test(p)) return 'bike liveries';
  if (/^bikes\//.test(p)) return 'bikes';
  if (/^rider\/(?:riders\/[^/]+\/)?helmets\/.+\/goggles\//.test(p)) return 'goggles';
  if (/^rider\/(?:riders\/[^/]+\/)?helmets\/.+\/paints\//.test(p)) return 'helmet paints';
  if (/^rider\/(?:riders\/[^/]+\/)?helmets\//.test(p)) return 'helmets';
  if (/^rider\/(?:riders\/[^/]+\/)?gloves\//.test(p)) return 'gloves';
  if (/^rider\/(?:riders\/[^/]+\/)?paints\//.test(p)) return 'rider kit paints';
  if (/^rider\/(?:riders\/[^/]+\/)?boots/.test(p)) return 'boots and boot paints';
  if (/^rider\/(?:riders\/[^/]+\/)?protections\//.test(p)) return 'protection';
  return 'other files';
}
function summary(files) {
  const groups = new Map();
  for (const file of files) { const kind = category(file); groups.set(kind, (groups.get(kind) || 0) + 1); }
  return [...groups].map(([kind, count]) => `${count} ${kind}`).join(', ');
}
module.exports = { category, summary };
