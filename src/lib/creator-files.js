// MXB Hub "Blends" are Blender models + PSD templates of bike parts (bars, levers, exhausts...) for people
// who make liveries. They don't install into the game, so the app files them under Other / Tools and never
// offers them as a required model or a mod picture.
const BLEND_CATEGORY = /^blends?$|^blend brands$/i;
const isCreatorFiles = (categories) => (categories || []).some((name) => BLEND_CATEGORY.test(String(name).trim()));
module.exports = { BLEND_CATEGORY, isCreatorFiles };
