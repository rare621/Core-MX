const { parentPort } = require('worker_threads');
const { withLocalPreview } = require('./assetread');
let queue = Promise.resolve();
parentPort.on('message', ({ id, type, options }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      if (!['rider', 'bike'].includes(type)) throw new Error('Unknown preview type');
      const model = await withLocalPreview(() => require(type === 'rider' ? './rider3d' : './bike3d').build(options));
      parentPort.postMessage({ id, model });
    } catch (e) { parentPort.postMessage({ id, error: e.message }); }
  });
});
