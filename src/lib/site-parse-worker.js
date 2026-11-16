// Parses mxb-mods.com HTML off the main process so Get Mods never freezes the window.
const { parentPort } = require('worker_threads');
const site = require('./site');
parentPort.on('message', ({ id, op, args }) => {
  try {
    const result = op === 'requirements' ? site.listingRequirements(...args) : args[0].map((p) => site.summarizePost(p, args[1]));
    parentPort.postMessage({ id, result });
  } catch (e) { parentPort.postMessage({ id, error: e.message }); }
});
