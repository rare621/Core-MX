const path = require('path');
const profile = require('./profile');
const { validName } = require('./gear-assets');

function selection(outfit) {
  if (!outfit || !validName(outfit.bike) || outfit.bike.length > 200) throw new Error('This friend has not shared a valid bike setup yet.');
  if (!Array.isArray(outfit.equipped) || !outfit.equipped.length) throw new Error('Ask this friend to sync their outfit with the latest manager first.');
  const current = Object.fromEntries(profile.SLOTS.map((slot) => [slot.id, slot.default || '']));
  for (const entry of outfit.equipped || []) {
    if (!profile.SLOTS.some((slot) => slot.id === entry.slot)) continue;
    const value = entry.slot === 'protection' && entry.value === 'None' ? '' : entry.value;
    if (typeof value !== 'string' || value.length > 200 || /[\r\n]/.test(value) || value && !validName(value)) throw new Error('The shared outfit contains an invalid gear selection.');
    current[entry.slot] = value;
  }
  return current;
}

async function build(outfit, { modsDir, installDir, buildModel, resolveAppearance = () => ({}) }) {
  const current = selection(outfit), warnings = [];
  const appearance = resolveAppearance(outfit.bike, outfit.unavailable?.find((entry) => entry.slot === 'bikeAppearance'));
  const isBike = (slot) => ['bikePaint', 'tyres', 'tyreBase', 'bikeAppearance'].includes(slot);
  const pending = [...(outfit.items || []), ...(outfit.unavailable || [])].filter((item) => !['have', 'downloaded'].includes(item.state) && !(item.slot === 'bikeAppearance' && appearance));
  const render = async (type) => {
    const needed = pending.filter((item) => isBike(item.slot) === (type === 'bike'));
    if (needed.length) {
      warnings.push(`${type === 'bike' ? 'Bike' : 'Rider'} preview needs ${needed.length} equipped file${needed.length === 1 ? '' : 's'}. Sync the free files and install any owned paid gear first.`);
      return null;
    }
    try {
      let model;
      if (type === 'rider') model = await buildModel('rider', { modsDir, gd: profile.gearDir(modsDir, current.rider), stockPkz: installDir ? path.join(installDir, 'rider.pkz') : null, current, texMax: 512 });
      else model = await buildModel('bike', { modsDir, installDir, bike: outfit.bike, bikeDir: await profile.findBikeDir(modsDir, outfit.bike), paint: current.bikePaint, tyresOverride: current.tyres, texMax: 512, ...appearance });
      if (!model.parts?.length || model.unreadable?.length) {
        warnings.push(`${type === 'bike' ? 'Bike' : 'Rider'} preview is unavailable because some selected assets could not be read. No substitute outfit is shown.`);
        return null;
      }
      warnings.push(...(model.warnings || []));
      return model;
    } catch (error) {
      warnings.push(`${type === 'bike' ? 'Bike' : 'Rider'} preview unavailable: ${error.message}`);
      return null;
    }
  };
  const [rider, bike] = await Promise.all([render('rider'), render('bike')]);
  return { rider, bike, warnings: [...new Set(warnings)], pending: pending.length };
}
module.exports = { selection, build };
