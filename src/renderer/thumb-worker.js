import { renderThumbnail } from './viewer3d.js';
let queue = Promise.resolve();
self.onmessage = ({ data: { id, model, framing, size } }) => {
  queue = queue.catch(() => {}).then(async () => {
    try { self.postMessage({ id, url: await renderThumbnail(model, framing, size) }); }
    catch (e) { self.postMessage({ id, error: e.message }); }
  });
};
