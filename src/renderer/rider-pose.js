// Procedural preview rig for the game's bind-pose rider. The EDF reader supplies
// joint positions, but not usable skin weights. Assign smooth, local influences
// to the loaded preview mesh; the actual game files are never modified.
import * as THREE from '../../node_modules/three/build/three.module.min.js';

const BODY = 0, HEAD = 1, LEFT_ARM = 2, LEFT_FOREARM = 3, LEFT_GLOVE = 4;
const RIGHT_ARM = 5, RIGHT_FOREARM = 6, RIGHT_GLOVE = 7;
const LEFT_THIGH = 8, LEFT_SHIN = 9, RIGHT_THIGH = 10, RIGHT_SHIN = 11, REST = 12;
const smooth = (value) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

function segmentDistance(x, y, z, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy, z - a[2] - t * dz);
}

function influences(positions, joints) {
  const count = positions.length / 3;
  const first = new Uint8Array(count), second = new Uint8Array(count), weight = new Float32Array(count);
  const handEnd = (wrist) => [wrist[0], wrist[1] - 0.18, wrist[2]];
  const footEnd = (knee) => [knee[0] * 1.12, Math.min(0.04, knee[1] - 0.35), knee[2] + 0.04];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const body = Math.min(segmentDistance(x, y, z, joints.Pelvis, joints.Spine4), segmentDistance(x, y, z, joints.Spine4, joints.Neck1)) / 0.19;
    const head = segmentDistance(x, y, z, joints.Neck1, joints.Head) / 0.13;
    const arm = (side) => Math.min(
      segmentDistance(x, y, z, joints[side + 'Shoulder'], joints[side + 'Elbow']),
      segmentDistance(x, y, z, joints[side + 'Elbow'], joints[side + 'Wrist']),
      segmentDistance(x, y, z, joints[side + 'Wrist'], handEnd(joints[side + 'Wrist'])),
    ) / 0.085;
    const leg = (side) => Math.min(
      segmentDistance(x, y, z, joints[side + 'Hip'], joints[side + 'Knee']),
      segmentDistance(x, y, z, joints[side + 'Knee'], footEnd(joints[side + 'Knee'])),
    ) / 0.11;
    const scores = [body, head, arm('Left'), arm('Right'), leg('Left'), leg('Right')];
    let region = 0;
    for (let n = 1; n < scores.length; n++) if (scores[n] < scores[region]) region = n;
    if (region === 1 && y > joints.Neck1[1] - 0.04) {
      first[i] = BODY; second[i] = HEAD;
      weight[i] = smooth((y - joints.Neck1[1] + 0.04) / 0.16);
    } else if (region === 2 || region === 3) {
      const left = region === 2, side = left ? 'Left' : 'Right';
      const shoulder = joints[side + 'Shoulder'][1], elbow = joints[side + 'Elbow'][1], wrist = joints[side + 'Wrist'][1];
      const upper = left ? LEFT_ARM : RIGHT_ARM, lower = left ? LEFT_FOREARM : RIGHT_FOREARM, glove = left ? LEFT_GLOVE : RIGHT_GLOVE;
      if (y > elbow + 0.08) {
        first[i] = BODY; second[i] = upper;
        weight[i] = smooth((shoulder + 0.03 - y) / 0.15);
      } else if (y > wrist + 0.04) {
        first[i] = upper; second[i] = lower;
        weight[i] = smooth((elbow + 0.08 - y) / 0.16);
      } else {
        first[i] = lower; second[i] = glove;
        weight[i] = smooth((wrist + 0.04 - y) / 0.13);
      }
    } else if (region === 4 || region === 5) {
      const left = region === 4, side = left ? 'Left' : 'Right';
      const hip = joints[side + 'Hip'][1], knee = joints[side + 'Knee'][1];
      const upper = left ? LEFT_THIGH : RIGHT_THIGH, lower = left ? LEFT_SHIN : RIGHT_SHIN;
      if (y > knee + 0.09) {
        first[i] = REST; second[i] = upper;
        weight[i] = smooth((hip + 0.04 - y) / 0.18);
      } else {
        first[i] = upper; second[i] = lower;
        weight[i] = smooth((knee + 0.09 - y) / 0.18);
      }
    } else { first[i] = second[i] = BODY; weight[i] = 0; }
  }
  return { first, second, weight };
}

function around(point, x = 0, y = 0, z = 0) {
  return new THREE.Matrix4().makeTranslation(...point)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z)))
    .multiply(new THREE.Matrix4().makeTranslation(-point[0], -point[1], -point[2]));
}

function aroundSegment(start, end, angle) {
  const a = joint(start), axis = joint(end).sub(a).normalize();
  return new THREE.Matrix4().makeTranslation(...a.toArray())
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(...a.multiplyScalar(-1).toArray()));
}

function joint(v) { return new THREE.Vector3(v[0], v[1], v[2]); }
function mapSegment(fromA, fromB, toA, toB) {
  const source = fromB.clone().sub(fromA).normalize();
  const target = toB.clone().sub(toA).normalize();
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(source, target));
  return new THREE.Matrix4().makeTranslation(...toA.toArray()).multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(...fromA.clone().multiplyScalar(-1).toArray()));
}

// Keep both bone lengths while moving an arm or leg to a visible pose.
// The bend hint selects the side of the limb that the elbow/knee should face.
function twoBone(a, bend, end, wantedEnd, bendHint, amount, wantedStart = a) {
  if (amount < 0.0001) return [new THREE.Matrix4(), new THREE.Matrix4()];
  const start = a.clone().lerp(wantedStart, amount);
  const target = end.clone().lerp(wantedEnd, amount);
  const l1 = bend.distanceTo(a), l2 = end.distanceTo(bend);
  const ray = target.clone().sub(start);
  const distance = Math.min(l1 + l2 - 0.00001, Math.max(Math.abs(l1 - l2) + 0.00001, ray.length()));
  const direction = ray.normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const hint = bend.clone().lerp(bendHint, amount).sub(start);
  hint.addScaledVector(direction, -hint.dot(direction)).normalize();
  const posedBend = start.clone().addScaledVector(direction, along).addScaledVector(hint, height);
  const posedEnd = start.clone().addScaledVector(direction, distance);
  return [mapSegment(a, bend, start, posedBend), mapSegment(bend, end, posedBend, posedEnd)];
}

function applyPoint(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function applyDirection(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}

export function createRiderPose(model, root, groups, bodyMeshes) {
  const j = model.rig?.joints;
  if (!j || !bodyMeshes.length) return null;
  const meshes = bodyMeshes.map((mesh) => {
    const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal');
    mesh.frustumCulled = false;
    return { position, normal, basePosition: new Float32Array(position.array), baseNormal: new Float32Array(normal.array), ...influences(position.array, j) };
  });
  const attachments = groups.filter((group) => group.userData.slot !== 'body').map((group) => {
    if (group.matrixAutoUpdate) group.updateMatrix();
    group.matrixAutoUpdate = false;
    return { group, base: group.matrix.clone() };
  });
  const amounts = { gloves: 0, boots: 0, head: 0, chest: 0 };
  let previous = 0;
  let seated = null;
  let lastPose = null;

  function step(now, slot, snap = false) {
    const target = { gloves: !seated && /gloves/i.test(slot || '') ? 1 : 0, boots: !seated && /boots/i.test(slot || '') ? 1 : 0,
      head: !seated && /helmet|goggles/i.test(slot || '') ? 1 : 0, chest: !seated && /protection/i.test(slot || '') ? 1 : 0 };
    const delta = previous ? Math.min(64, Math.max(0, now - previous)) : 16;
    previous = now;
    const alpha = snap ? 1 : 1 - Math.exp(-delta / 180);
    let changed = false;
    for (const name of Object.keys(amounts)) {
      const before = amounts[name];
      amounts[name] += (target[name] - amounts[name]) * alpha;
      if (Math.abs(target[name] - amounts[name]) < 0.002) amounts[name] = target[name];
      if (amounts[name] !== before) changed = true;
    }
    const poseKey = seated ? 'seated' : Object.keys(target).find((name) => target[name]) || 'neutral';
    const movingDetail = !snap && (amounts.gloves > 0 || amounts.head > 0);
    if (!changed && !movingDetail && lastPose === poseKey) return;
    lastPose = poseKey;
    const hand = snap ? 0 : Math.sin(now / 1000);
    const body = seated ? around(j.Pelvis, seated.lean, 0, 0) : new THREE.Matrix4();
    const head = seated ? body.clone().multiply(around(j.Neck1, -seated.lean * 0.7, 0, 0))
      : around(j.Neck1, 0, 0.17 * amounts.head * (snap ? 1 : Math.sin(now / 1250)), 0);
    const leftPose = seated ? 1 : amounts.gloves;
    const leftWrist = joint(j.LeftWrist);
    const leftTarget = new THREE.Vector3(-0.08, 1.12, 0.24);
    const leftShoulder = joint(j.LeftShoulder);
    const leftStart = seated ? leftShoulder.clone().applyMatrix4(body) : leftShoulder;
    const [leftUpper, leftLower] = twoBone(leftShoulder, joint(j.LeftElbow), leftWrist,
      seated ? joint(seated.leftHand) : leftTarget,
      seated ? leftStart.clone().lerp(joint(seated.leftHand), 0.45).add(new THREE.Vector3(-0.13, -0.15, 0.04)) : new THREE.Vector3(-0.27, 1.15, 0.27), leftPose, leftStart);
    const leftArm = seated ? leftUpper : body.clone().multiply(leftUpper);
    const leftForearm = seated ? leftLower : body.clone().multiply(leftLower)
      // Keep the glove's patterned back toward the camera. The old near-half
      // turn exposed its palm after raising the forearm.
      .multiply(aroundSegment(j.LeftElbow, j.LeftWrist, -0.15 * amounts.gloves));
    const leftGlove = leftForearm.clone().multiply(around(j.LeftWrist,
      seated ? 0.38 : 0.12 * amounts.gloves * hand, seated ? 0 : 0.06 * amounts.gloves * hand, 0));
    const rightShoulder = joint(j.RightShoulder);
    const rightStart = seated ? rightShoulder.clone().applyMatrix4(body) : rightShoulder;
    const [rightArm, rightForearm] = seated ? twoBone(rightShoulder, joint(j.RightElbow), joint(j.RightWrist), joint(seated.rightHand),
      rightStart.clone().lerp(joint(seated.rightHand), 0.45).add(new THREE.Vector3(0.13, -0.15, 0.04)), 1, rightStart)
      : [new THREE.Matrix4(), new THREE.Matrix4()];
    const rightGlove = rightForearm.clone().multiply(seated ? around(j.RightWrist, 0.38) : new THREE.Matrix4());
    const leftKnee = joint(j.LeftKnee);
    const [leftThigh, leftShin] = seated ? twoBone(joint(j.LeftHip), leftKnee,
      leftKnee.clone().add(new THREE.Vector3(0, -0.42, 0)), joint(seated.leftFoot),
      joint(j.LeftHip).clone().lerp(joint(seated.leftFoot), 0.48).add(new THREE.Vector3(-0.10, -0.10, 0.20)), 1)
      : [new THREE.Matrix4(), new THREE.Matrix4()];
    const rightKnee = joint(j.RightKnee);
    const [rightThigh, rightShin] = seated ? twoBone(joint(j.RightHip), rightKnee,
      rightKnee.clone().add(new THREE.Vector3(0, -0.42, 0)), joint(seated.rightFoot),
      joint(j.RightHip).clone().lerp(joint(seated.rightFoot), 0.48).add(new THREE.Vector3(0.05, -0.04, 0.08)), 1)
      : twoBone(joint(j.RightHip), rightKnee, rightKnee.clone().add(new THREE.Vector3(0, -0.42, 0)),
        new THREE.Vector3(-0.18, 0.68, 0.27), new THREE.Vector3(0.33, 0.69, 0.42), amounts.boots);
    const transforms = [body, head, leftArm, leftForearm, leftGlove, rightArm, rightForearm, rightGlove,
      leftThigh, leftShin, rightThigh, rightShin, new THREE.Matrix4()];
    const elements = transforms.map((matrix) => matrix.elements);
    for (const mesh of meshes) {
      const { position, normal, basePosition, baseNormal, first, second, weight } = mesh;
      for (let i = 0; i < first.length; i++) {
        const at = i * 3, w = weight[i], a = elements[first[i]], b = elements[second[i]];
        const x = basePosition[at], y = basePosition[at + 1], z = basePosition[at + 2];
        const pa = applyPoint(a, x, y, z), pb = w ? applyPoint(b, x, y, z) : pa;
        position.array[at] = pa[0] * (1 - w) + pb[0] * w;
        position.array[at + 1] = pa[1] * (1 - w) + pb[1] * w;
        position.array[at + 2] = pa[2] * (1 - w) + pb[2] * w;
        const nx = baseNormal[at], ny = baseNormal[at + 1], nz = baseNormal[at + 2];
        const na = applyDirection(a, nx, ny, nz), nb = w ? applyDirection(b, nx, ny, nz) : na;
        const dx = na[0] * (1 - w) + nb[0] * w, dy = na[1] * (1 - w) + nb[1] * w, dz = na[2] * (1 - w) + nb[2] * w;
        const length = Math.hypot(dx, dy, dz) || 1;
        normal.array[at] = dx / length; normal.array[at + 1] = dy / length; normal.array[at + 2] = dz / length;
      }
      position.needsUpdate = true; normal.needsUpdate = true;
    }
    for (const { group, base } of attachments) {
      const slotName = group.userData.slot;
      const transform = slotName === 'helmet' ? head : slotName === 'boot_left' ? leftShin : slotName === 'boot_right' ? rightShin : body;
      group.matrix.copy(transform).multiply(base);
      group.matrixWorldNeedsUpdate = true;
    }
  }
  function focusPoint(slot) {
    const point = seated && /gloves/i.test(slot || '') ? joint(seated.leftHand)
      : seated && /boots/i.test(slot || '') ? joint(seated.leftFoot)
        : /gloves/i.test(slot || '') ? new THREE.Vector3(0, 1.12, 0.26)
          : /boots/i.test(slot || '') ? new THREE.Vector3(-0.18, 0.59, 0.27)
            : /protection/i.test(slot || '') ? joint(j.Spine4).lerp(joint(j.Neck1), 0.35)
              .applyMatrix4(seated ? around(j.Pelvis, seated.lean) : new THREE.Matrix4()) : null;
    if (!point) return null;
    root.updateWorldMatrix(true, false);
    return root.localToWorld(point);
  }
  return { step, focusPoint, setSeated: (config) => { seated = config; step(performance.now(), null, true); } };
}
