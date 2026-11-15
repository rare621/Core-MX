// 3D rider preview (three.js). Exposes window.RiderViewer: create(el) -> { load(model), resetView(), dispose() }.
// model comes from the main process (src/lib/rider3d.js): parts with meshes in the game's
// left-handed, Y-up space; gear parts carry the bone matrix they hang from.
import * as THREE from '../../node_modules/three/build/three.module.min.js';

const HIDDEN_TEX = /^w_(name|number)$/i; // the game prints your name/number here; the templates look wrong

function makeTexture(t) {
  const tex = new THREE.DataTexture(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength), t.width, t.height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function rowMajor(m) { return new THREE.Matrix4().set(...m); }

// Builds a model's meshes under `root`; everything created is pushed to `owned` for disposal.
function addModel(model, root, owned) {
  const texCache = {};
  const texFor = (k) => {
    if (!k || !model.textures[k]) return null;
    if (!texCache[k]) { texCache[k] = makeTexture(model.textures[k]); owned.push(texCache[k]); }
    return texCache[k];
  };
  for (const part of model.parts) {
    const grp = new THREE.Group();
    if (part.bind) { grp.matrixAutoUpdate = false; grp.matrix.copy(rowMajor(part.bind)); }
    for (const m of part.meshes) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.normals), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(m.uvs), 2));
      // Mirroring X (the root's scale) also reverses which side of each triangle counts as the front;
      // swap two corners so the outside of every surface faces out again.
      const idx = new Uint32Array(m.indices);
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mats = [];
      m.groups.forEach((gr, i) => {
        const hidden = gr.name && HIDDEN_TEX.test(gr.name);
        const map = hidden ? null : texFor(gr.tex);
        const mat = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x3a3a3e, roughness: 0.72, metalness: 0.02, alphaTest: map ? 0.35 : 0, side: THREE.DoubleSide, visible: !hidden });
        if (gr.name && /visor|lens/i.test(gr.name)) { mat.transparent = true; mat.opacity = 0.5; }
        owned.push(mat); mats.push(mat);
        geo.addGroup(gr.start, gr.count, i);
      });
      owned.push(geo);
      grp.add(new THREE.Mesh(geo, mats));
    }
    root.add(grp);
  }
}

// ---- thumbnails: one hidden renderer, reused for every gear option ----
// framing: 'full' (whole model), 'hands' (close on the hands), 'head', 'feet'.
function glovePreview(model) {
  // Isolate one glove so the rider's sleeve/leg cannot obscure the close-up.
  // Compact the attributes too: unused body vertices would otherwise keep the
  // bounding box as large as the entire rider.
  const parts = model.parts.map((part) => ({ ...part, meshes: part.meshes.map((mesh) => {
    const groups = mesh.groups.filter((g) => /glove/i.test(g.name || ''));
    if (!groups.length) return null;
    const vertices = new Map(), positions = [], normals = [], uvs = [], indices = [], kept = [];
    for (const group of groups) {
      const start = indices.length;
      for (let t = group.start; t < group.start + group.count; t += 3) {
        const tri = Array.from(mesh.indices.slice(t, t + 3));
        if (tri.reduce((sum, i) => sum + mesh.positions[i * 3], 0) >= 0) continue;
        for (const old of tri) {
          if (!vertices.has(old)) {
            vertices.set(old, vertices.size);
            positions.push(...mesh.positions.slice(old * 3, old * 3 + 3));
            normals.push(...mesh.normals.slice(old * 3, old * 3 + 3));
            uvs.push(...mesh.uvs.slice(old * 2, old * 2 + 2));
          }
          indices.push(vertices.get(old));
        }
      }
      if (indices.length > start) kept.push({ ...group, start, count: indices.length - start });
    }
    return indices.length ? { ...mesh, positions, normals, uvs, indices, groups: kept } : null;
  }).filter(Boolean) })).filter((p) => p.meshes.length);
  return parts.length ? { ...model, parts, handCloseup: true } : model;
}

let thumbKit = null;
export function renderThumbnail(model, framing = 'full', size = 320) {
  if (framing === 'hands') model = glovePreview(model);
  if (!thumbKit) {
    const renderer = new THREE.WebGLRenderer({ ...(typeof document === 'undefined' ? { canvas: new OffscreenCanvas(size, size) } : {}), antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 50);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.7));
    scene.add(camera);
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.2, 1.6, 0.6); camera.add(key); camera.add(key.target); key.target.position.set(0, 0, -3);
    const rim = new THREE.DirectionalLight(0xffb070, 0.9); rim.position.set(-2.5, 2, -2.5); scene.add(rim);
    thumbKit = { renderer, scene, camera };
  }
  const { renderer, scene, camera } = thumbKit;
  renderer.setSize(size, size, false);
  const root = new THREE.Group(); root.scale.x = -1; scene.add(root);
  const owned = [];
  addModel(model, root, owned);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  let url = null;
  if (!box.isEmpty()) {
    const size3 = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    let target = c, radius = Math.max(size3.x, size3.y, size3.z) / 2, yaw = 0.55, pitch = 0.12;
    // Close on the right hand (hands hang at the sides, about half-way up a standing rider).
    if (framing === 'hands') {
      const focus = model.focus && model.focus.hands;
      target = model.handCloseup ? c : focus && focus.every(Number.isFinite) ? new THREE.Vector3(-focus[0], focus[1], focus[2])
        : new THREE.Vector3(box.max.x - size3.x * 0.1, box.min.y + size3.y * 0.44, c.z);
      radius = model.handCloseup ? size3.length() / 2 : Math.max(0.105, size3.y * 0.065); yaw = 1.0; pitch = 0.1;
    }
    if (framing === 'feet') { yaw = 0.75; pitch = 0.25; }
    yaw += model.previewYaw || 0;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.12;
    camera.position.set(target.x + dist * Math.sin(yaw) * Math.cos(pitch), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(target);
    renderer.render(scene, camera);
    url = typeof renderer.domElement.toDataURL === 'function' ? renderer.domElement.toDataURL('image/webp', 0.85) : renderer.domElement.convertToBlob({ type: 'image/webp', quality: 0.85 }).then(async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
      for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
      return 'data:' + blob.type + ';base64,' + btoa(binary);
    });
  }
  scene.remove(root);
  for (const o of owned) o.dispose();
  return url;
}

let thumbnailWorker = null, thumbnailSerial = 0;
const thumbnailRequests = new Map();
function thumb(model, framing = 'full', size = 320) {
  if (!thumbnailWorker) {
    thumbnailWorker = new Worker(new URL('./thumb-worker.js', import.meta.url), { type: 'module' });
    thumbnailWorker.onmessage = ({ data }) => { const request = thumbnailRequests.get(data.id); if (!request) return; thumbnailRequests.delete(data.id); clearTimeout(request.timer); if (data.error) request.reject(new Error(data.error)); else request.resolve(data.url); };
    thumbnailWorker.onerror = () => { for (const request of thumbnailRequests.values()) { clearTimeout(request.timer); request.reject(new Error('Thumbnail preview unavailable')); } thumbnailRequests.clear(); thumbnailWorker.terminate(); thumbnailWorker = null; };
  }
  return new Promise((resolve, reject) => {
    const id = ++thumbnailSerial;
    const timer = setTimeout(() => { thumbnailRequests.delete(id); reject(new Error('Thumbnail took too long')); }, 30000);
    thumbnailRequests.set(id, { resolve, reject, timer }); thumbnailWorker.postMessage({ id, model, framing, size });
  });
}

function create(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.6));
  // Key light rides with the camera so whichever side you look at is lit.
  scene.add(camera);
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.2, 1.6, 0.6); camera.add(key); camera.add(key.target); key.target.position.set(0, 0, -3);
  const rim = new THREE.DirectionalLight(0xffb070, 1.0); rim.position.set(-2.5, 2, -2.5); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-2, 0.5, 2); scene.add(fill);

  // Soft floor shadow.
  const sh = document.createElement('canvas'); sh.width = sh.height = 128;
  const g = sh.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  // The game is left-handed: mirror X once at the root (three flips the winding for us).
  const root = new THREE.Group(); root.scale.x = -1; scene.add(root);

  const view = { yaw: 0.55, pitch: 0.12, dist: 3.1, target: new THREE.Vector3(0, 0.95, 0) };
  const home = { ...view, target: view.target.clone() };
  let facingYaw = 0;
  let auto = true;
  function place() {
    const cp = Math.cos(view.pitch);
    camera.position.set(view.target.x + view.dist * Math.sin(view.yaw) * cp, view.target.y + view.dist * Math.sin(view.pitch), view.target.z + view.dist * Math.cos(view.yaw) * cp);
    camera.lookAt(view.target);
  }

  // Drag to turn, wheel to zoom, double-click to reset.
  let drag = null;
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; auto = false; dom.setPointerCapture(e.pointerId); el.classList.add('grabbing'); });
  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.01;
    view.pitch = Math.max(-0.4, Math.min(1.2, view.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  const up = () => { drag = null; el.classList.remove('grabbing'); };
  dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.max(0.8, Math.min(9, view.dist * (e.deltaY > 0 ? 1.1 : 0.9))); auto = false; }, { passive: false });
  dom.addEventListener('dblclick', () => resetView());
  // Frame the whole rider: centre on the model, back off far enough for its height and width.
  function fit() {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const vfov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const need = Math.max(size.y / 2 / Math.tan(vfov), Math.max(size.x, size.z) / 2 / (Math.tan(vfov) * aspect)) * 1.18 + Math.max(size.x, size.z) / 2;
    floor.position.y = box.min.y + 0.002;
    const moved = !auto;
    home.target = c; home.dist = need;
    if (!moved) { view.target = c.clone(); view.dist = need; }
  }
  function resetView() { Object.assign(view, { ...home, target: home.target.clone() }); auto = true; }

  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  let raf = 0, alive = true;
  function frame() {
    if (!alive) return;
    const modal = document.querySelector('.modal-wrap:last-child');
    if (!el.isConnected || document.hidden || modal && !modal.contains(el)) { raf = requestAnimationFrame(frame); return; }
    // Start at a stable front three-quarter angle; drag to inspect other sides.
    place();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  let owned = [];
  function clear() {
    for (const o of owned) o.dispose();
    owned = [];
    while (root.children.length) root.remove(root.children[0]);
  }

  function load(model) {
    clear();
    floor.scale.set(1, 1, 1); floor.position.x = floor.position.z = 0;
    const nextFacing = model.previewYaw || 0;
    view.yaw += nextFacing - facingYaw;
    facingYaw = nextFacing;
    home.yaw = 0.55 + facingYaw;
    addModel(model, root, owned);
    fit();
    resize(); place(); renderer.render(scene, camera); // draw now, don't wait for the next frame
  }

  function loadScene({ rider, bike }) {
    clear();
    const actors = [];
    for (const [kind, model] of [['rider', rider], ['bike', bike]]) {
      if (!model) continue;
      const actor = new THREE.Group();
      addModel(model, actor, owned);
      // Normalize each model's facing direction, then turn the bike slightly
      // to expose its side panels alongside the standing rider.
      actor.rotation.y = (model.previewYaw || 0) + (kind === 'bike' ? 0.65 : 0);
      actor.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(actor);
      if (!bounds.isEmpty()) actors.push({ actor, bounds, size: bounds.getSize(new THREE.Vector3()), center: bounds.getCenter(new THREE.Vector3()) });
    }
    const gap = 0.3, width = actors.reduce((sum, item) => sum + item.size.x, 0) + Math.max(0, actors.length - 1) * gap;
    let x = -width / 2;
    for (const { actor, bounds, size, center } of actors) {
      actor.position.set(x + size.x / 2 - center.x, -bounds.min.y, -center.z);
      root.add(actor); x += size.x + gap;
    }
    facingYaw = 0; home.yaw = 0.55; home.pitch = 0.12; view.yaw = home.yaw; view.pitch = home.pitch; auto = true;
    fit();
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    floor.scale.set(Math.max(1, size.x * 1.2), Math.max(1, size.z * 1.2), 1);
    resize(); place(); renderer.render(scene, camera);
  }

  function dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); clear(); floor.geometry.dispose(); floor.material.map.dispose(); floor.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); dom.remove(); }

  function info() {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    return { canvas: [dom.width, dom.height], parts: root.children.length, box: [box.min.toArray(), box.max.toArray()], cam: camera.position.toArray() };
  }

  return { load, loadScene, resetView, dispose, info, view, el };
}

if (typeof window !== 'undefined') {
  window.RiderViewer = { create, thumb };
  window.dispatchEvent(new Event('riderviewer-ready'));
}
