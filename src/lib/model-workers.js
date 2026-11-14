const { Worker } = require('worker_threads');
const path = require('path');
function create() {
  const lanes = new Map(); let serial = 0;
  function lane(name) {
    if (lanes.has(name)) return lanes.get(name);
    const worker = new Worker(path.join(__dirname, 'model-worker.js')), pending = new Map();
    const result = { worker, pending }; lanes.set(name, result);
    const fail = (e) => { if (lanes.get(name) === result) lanes.delete(name); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(e); } pending.clear(); worker.terminate(); };
    worker.on('message', ({ id, model, error }) => {
      const request = pending.get(id); if (!request) return;
      clearTimeout(request.timer); pending.delete(id);
      if (!pending.size) worker.unref();
      if (error) request.reject(new Error(error)); else request.resolve(model);
    });
    worker.on('error', fail);
    worker.on('exit', () => { if (pending.size) fail(new Error('Preview worker stopped. Try again.')); });
    result.fail = fail; worker.unref(); return result;
  }
  return {
    build(type, options, thumbnail = false) {
      const target = lane(thumbnail ? 'thumbnail' : 'preview'), id = ++serial;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => target.fail(new Error('This preview took too long. Try another item.')), 60000);
        target.pending.set(id, { resolve, reject, timer }); target.worker.ref();
        target.worker.postMessage({ id, type, options });
      });
    },
    dispose() { for (const target of [...lanes.values()]) target.fail(new Error('Preview closed')); lanes.clear(); },
  };
}
module.exports = { create };
