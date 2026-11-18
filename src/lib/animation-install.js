'use strict';

function destination(instructions = '', description = '') {
  const text = `${instructions} ${description}`.replace(/<[^>]*>/g, ' ').replace(/\\/g, '/').replace(/\s+/g, ' ').toLowerCase();
  if (/mx bikes\/rider\/animations\/mx|steam\/steamapps\/common\/mx bikes\/rider\/animations|(?:installation|game) folder[^.]{0,120}rider\/animations|mods[^.]{0,70}(?:does not work|do not work)/.test(text)) return 'game';
  if (/installation into mods folder|(?:move|copy|put)[^.]{0,110}(?:mods folder|mods\/rider\/animations)|mods\/rider\/animations/.test(text)) return 'mods';
  return null;
}

module.exports = { destination };
