// A model owns its model files, not artwork from paints/accessories installed
// beneath that model's directory (notably default_mx/gloves).
function ownsInstallFile(part, file) {
  const parent = part.replace(/\\/g, '/').toLowerCase();
  const child = file.replace(/\\/g, '/').toLowerCase();
  if (child === parent) return true;
  if (!child.startsWith(parent + '/')) return false;
  const relative = child.slice(parent.length + 1);
  return !/\.pnt$/i.test(relative) && !/(?:^|\/)(?:paints|goggles|gloves|helmets|boots|protections|riders)\//.test(relative);
}
module.exports = { ownsInstallFile };
