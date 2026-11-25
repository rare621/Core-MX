// 3D rider preview (three.js). Exposes window.RiderViewer: create(el) -> { load(model), resetView(), dispose() }.
// model comes from the main process (src/lib/rider3d.js): parts with meshes in the game's
// left-handed, Y-up space; gear parts carry the bone matrix they hang from.
import * as THREE from '../../node_modules/three/build/three.module.min.js';
import { createRiderPose } from './rider-pose.js';

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
function addModel(model, root, owned, animate = false) {
  const texCache = {};
  const groups = [], bodyMeshes = [];
  const texFor = (k) => {
    if (!k || !model.textures[k]) return null;
    if (!texCache[k]) { texCache[k] = makeTexture(model.textures[k]); owned.push(texCache[k]); }
    return texCache[k];
  };
  for (const part of model.parts) {
    const grp = new THREE.Group();
    grp.userData.slot = part.slot;
    groups.push(grp);
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
      const mesh = new THREE.Mesh(geo, mats);
      grp.add(mesh);
      if (part.slot === 'body') bodyMeshes.push(mesh);
    }
    root.add(grp);
  }
  return animate ? createRiderPose(model, root, groups, bodyMeshes) : null;
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
  // Keep the original showroom lighting while the camera travels around the rider.
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
  let frontYaw = 0;
  let auto = true;
  let goal = null;
  const ease = (value) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  function travel(next) {
    goal = { ...next, from: { yaw: view.yaw, pitch: view.pitch, dist: view.dist, target: view.target.clone() }, started: performance.now() };
  }
  let focusBoxes = {};
  let helmetMotion = null;
  let poseMotion = null;
  let focusedSlot = null;
  function place() {
    const cp = Math.cos(view.pitch);
    camera.position.set(view.target.x + view.dist * Math.sin(view.yaw) * cp, view.target.y + view.dist * Math.sin(view.pitch), view.target.z + view.dist * Math.cos(view.yaw) * cp);
    camera.lookAt(view.target);
  }

  // Drag to turn, wheel to zoom, double-click to reset.
  let drag = null;
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; auto = false; goal = null; dom.setPointerCapture(e.pointerId); el.classList.add('grabbing'); });
  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.01;
    view.pitch = Math.max(-0.4, Math.min(1.2, view.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  const up = () => { drag = null; el.classList.remove('grabbing'); };
  dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.max(0.8, Math.min(9, view.dist * (e.deltaY > 0 ? 1.1 : 0.9))); auto = false; goal = null; }, { passive: false });
  dom.addEventListener('dblclick', () => resetView());
  function frameDistance(box) {
    const size = box.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const width = Math.max(size.x, size.z);
    return Math.max(size.y / 2 / Math.tan(halfFov), width / 2 / (Math.tan(halfFov) * aspect)) * 1.18 + width / 2;
  }
  // Frame the whole rider: centre on the model, back off far enough for its height and width.
  function fit() {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const need = frameDistance(box);
    floor.position.y = box.min.y + 0.002;
    const moved = !auto;
    home.target = c; home.dist = need;
    if (!moved) { view.target = c.clone(); view.dist = need; }
  }
  function resetView() { travel({ ...home, target: home.target.clone() }); focusedSlot = null; auto = true; }

  // Focus the selected part without altering the rider draft. All targets are
  // derived from the loaded model's actual bounds, including its bike offset.
  function focus(slot) {
    const isBike = slot === 'bikePaint' || slot === 'bikeAppearance' || slot === 'bikeFont' || slot === 'tyres';
    const box = (isBike && focusBoxes.bike) || focusBoxes.rider;
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const target = box.getCenter(new THREE.Vector3());
    let fraction = 0.52, distance = 0.68, yaw = home.yaw, pitch = 0.08;
    if (/helmet|goggles/i.test(slot)) { fraction = 0.89; distance = 0.39; yaw = frontYaw + 0.34; pitch = 0.05; }
    else if (/gloves/i.test(slot)) { fraction = 0.72; distance = 0.33; yaw += 0.15; }
    else if (/boots/i.test(slot)) { fraction = 0.37; distance = 0.48; yaw -= 0.18; pitch = 0.18; }
    else if (/protection/i.test(slot)) { fraction = 0.70; distance = 0.40; yaw = frontYaw + 0.43; pitch = 0.03; }
    else if (slot === 'rider') { fraction = 0.51; distance = 0.88; }
    else if (isBike) { fraction = 0.48; distance = 0.8; yaw = home.yaw + 0.25; }
    const posedTarget = poseMotion?.focusPoint(slot);
    if (posedTarget) target.copy(posedTarget);
    else target.y = box.min.y + size.y * fraction;
    travel({ target, dist: Math.max(0.85, frameDistance(box) * distance), yaw, pitch });
    focusedSlot = slot;
    auto = false;
  }

  // A chooser freezes the preview while it is open. Finish any remaining
  // camera travel before that happens so its selected part is fully framed.
  function finishFocus() {
    if (!goal) return;
    view.target.copy(goal.target);
    view.dist = goal.dist;
    view.yaw = goal.yaw;
    view.pitch = goal.pitch;
    goal = null;
    poseMotion?.step(performance.now(), focusedSlot, true);
    place();
    renderer.render(scene, camera);
  }

  // Custom rider models without a usable rig still get a small helmet turn.
  function bindHelmetMotion() {
    helmetMotion = null;
    root.updateMatrixWorld(true);
    root.traverse((group) => {
      if (helmetMotion || group.userData.slot !== 'helmet') return;
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;
      const pivot = group.parent.worldToLocal(box.getCenter(new THREE.Vector3()));
      if (group.matrixAutoUpdate) group.updateMatrix();
      helmetMotion = { group, pivot, base: group.matrix.clone() };
      group.matrixAutoUpdate = false;
    });
  }

  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  let raf = 0, alive = true;
  const headTurn = new THREE.Matrix4(), headFrom = new THREE.Matrix4(), headTo = new THREE.Matrix4();
  function frame(now = 0) {
    if (!alive) return;
    const modal = document.querySelector('.modal-wrap:last-child');
    if (!el.isConnected || document.hidden || modal && !modal.contains(el)) { raf = requestAnimationFrame(frame); return; }
    if (goal) {
      const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (now - goal.started) / 700);
      // Swing sideways first, then pan to the selected part, then move closer.
      // This reads as a camera move rather than a uniform zoom.
      view.yaw = THREE.MathUtils.lerp(goal.from.yaw, goal.yaw, ease(t / 0.72));
      view.pitch = THREE.MathUtils.lerp(goal.from.pitch, goal.pitch, ease((t - 0.08) / 0.75));
      view.target.copy(goal.from.target).lerp(goal.target, ease((t - 0.12) / 0.76));
      view.dist = THREE.MathUtils.lerp(goal.from.dist, goal.dist, ease((t - 0.32) / 0.68));
      if (t >= 1) goal = null;
    }
    if (poseMotion) poseMotion.step(now, focusedSlot, matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (helmetMotion) {
      const { group, pivot, base } = helmetMotion;
      const looking = /helmet|goggles/i.test(focusedSlot || '');
      const angle = Math.sin(now / (looking ? 1050 : 2200)) * (looking ? 0.055 : 0.018);
      group.matrix.copy(headFrom.makeTranslation(pivot.x, pivot.y, pivot.z))
        .multiply(headTurn.makeRotationY(angle))
        .multiply(headTo.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
        .multiply(base);
      group.matrixWorldNeedsUpdate = true;
    }
    // Start at a stable front three-quarter angle; drag to inspect other sides.
    place();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  let owned = [];
  function clear() {
    helmetMotion = null;
    poseMotion = null;
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
    frontYaw = nextFacing;
    home.yaw = 0.55 + facingYaw;
    poseMotion = addModel(model, root, owned, true);
    root.updateMatrixWorld(true);
    focusBoxes = { rider: new THREE.Box3().setFromObject(root) };
    if (!poseMotion) bindHelmetMotion();
    fit();
    resize(); place(); renderer.render(scene, camera); // draw now, don't wait for the next frame
  }

  function loadScene({ rider, bike }) {
    clear();
    const actors = [];
    for (const [kind, model] of [['rider', rider], ['bike', bike]]) {
      if (!model) continue;
      const actor = new THREE.Group();
      const actorPose = addModel(model, actor, owned, kind === 'rider');
      if (kind === 'rider') poseMotion = actorPose;
      // Normalize each model's facing direction, then turn the bike slightly
      // to expose its side panels alongside the standing rider.
      actor.rotation.y = (model.previewYaw || 0) + (kind === 'bike' ? 0.65 : 0);
      actor.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(actor);
      if (!bounds.isEmpty()) actors.push({ kind, actor, bounds, size: bounds.getSize(new THREE.Vector3()), center: bounds.getCenter(new THREE.Vector3()) });
    }
    const gap = 0.3, width = actors.reduce((sum, item) => sum + item.size.x, 0) + Math.max(0, actors.length - 1) * gap;
    let x = -width / 2;
    for (const { actor, bounds, size, center } of actors) {
      actor.position.set(x + size.x / 2 - center.x, -bounds.min.y, -center.z);
      root.add(actor); x += size.x + gap;
    }
    root.updateMatrixWorld(true);
    const riderActor = actors.find((item) => item.kind === 'rider')?.actor;
    const bikeActor = actors.find((item) => item.kind === 'bike')?.actor;
    if (poseMotion && rider?.rig?.joints && riderActor && bikeActor) {
      const bikeBox = new THREE.Box3().setFromObject(bikeActor);
      const bikeSize = bikeBox.getSize(new THREE.Vector3());
      const frontWheel = bikeActor.children.find((child) => child.userData.slot === 'front_wheel');
      const rearWheel = bikeActor.children.find((child) => child.userData.slot === 'rear_wheel');
      const frontCenter = frontWheel ? new THREE.Box3().setFromObject(frontWheel).getCenter(new THREE.Vector3()) : new THREE.Vector3(bikeBox.min.x, 0, bikeBox.getCenter(new THREE.Vector3()).z);
      const rearCenter = rearWheel ? new THREE.Box3().setFromObject(rearWheel).getCenter(new THREE.Vector3()) : new THREE.Vector3(bikeBox.max.x, 0, bikeBox.getCenter(new THREE.Vector3()).z);
      const wheelSpan = frontCenter.clone().sub(rearCenter).setY(0);
      const length = Math.max(0.1, wheelSpan.length());
      const forwardAxis = wheelSpan.lengthSq() > 0.01 ? wheelSpan.normalize() : new THREE.Vector3(-1, 0, 0);
      const acrossAxis = new THREE.Vector3(-forwardAxis.z, 0, forwardAxis.x);
      const onCenterline = (fraction, height) => rearCenter.clone().addScaledVector(forwardAxis, length * fraction).setY(height);
      const seat = onCenterline(0.34, bikeBox.min.y + bikeSize.y * 0.68);
      const pelvis = riderActor.localToWorld(new THREE.Vector3(...rider.rig.joints.Pelvis));
      riderActor.position.add(root.worldToLocal(seat.clone()).sub(root.worldToLocal(pelvis.clone())));
      root.updateMatrixWorld(true);
      const steer = bikeActor.children.find((child) => child.userData.slot === 'steer');
      const steerBox = steer ? new THREE.Box3().setFromObject(steer) : bikeBox;
      const steerCenter = steerBox.getCenter(new THREE.Vector3());
      const forward = riderActor.worldToLocal(seat.clone().add(forwardAxis)).sub(new THREE.Vector3(...rider.rig.joints.Pelvis));
      riderActor.rotation.y += Math.atan2(forward.x, forward.z);
      root.updateMatrixWorld(true);
      const barWidth = Math.min(0.25, Math.max(0.16, steerBox.getSize(new THREE.Vector3()).z * 0.28));
      const toRider = (point) => riderActor.worldToLocal(point.clone()).toArray();
      const barFraction = THREE.MathUtils.clamp(steerCenter.clone().sub(rearCenter).dot(forwardAxis) / length, 0.55, 0.78);
      const barBase = onCenterline(barFraction, steerBox.max.y - 0.21);
      const hands = [-1, 1].map((side) => toRider(barBase.clone().addScaledVector(acrossAxis, side * barWidth))).sort((a, b) => a[0] - b[0]);
      hands.forEach((hand) => { hand[2] -= 0.15; });
      const pegBase = onCenterline(0.49, bikeBox.min.y + bikeSize.y * 0.30);
      const feet = [-1, 1].map((side) => toRider(pegBase.clone().addScaledVector(acrossAxis, side * 0.16))).sort((a, b) => a[0] - b[0]);
      // One boot rests on the near peg; the far leg hangs beside the bike as
      // though the rider is steadying it on the ground.
      const planted = [-1, 1].map((side) => toRider(onCenterline(0.43, bikeBox.min.y + 0.04)
        .addScaledVector(acrossAxis, side * 0.25))).sort((a, b) => a[0] - b[0]);
      const barMid = riderActor.worldToLocal(barBase.clone());
      poseMotion.setSeated({ leftHand: hands[0], rightHand: hands[1], leftFoot: feet[0], rightFoot: planted[1],
        lean: barMid.z >= rider.rig.joints.Pelvis[2] ? 0.34 : -0.34 });
      frontYaw = Math.atan2(forwardAxis.x, forwardAxis.z);
      root.updateMatrixWorld(true);
    }
    focusBoxes = {};
    for (const { kind, actor } of actors) focusBoxes[kind] = new THREE.Box3().setFromObject(actor);
    if (!poseMotion) bindHelmetMotion();
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
    return { canvas: [dom.width, dom.height], parts: root.children.length, animated: !!poseMotion, box: [box.min.toArray(), box.max.toArray()], cam: camera.position.toArray() };
  }

  return { load, loadScene, focus, finishFocus, resetView, dispose, info, view, el };
}

if (typeof window !== 'undefined') {
  window.RiderViewer = { create, thumb };
  window.dispatchEvent(new Event('riderviewer-ready'));
}
