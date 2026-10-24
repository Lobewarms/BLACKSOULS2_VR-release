import * as THREE from 'three';

// Camera-space hand motion: wind up, sweep across the view, then recover.
// The active part remains inside the combat system's existing hit window.
const REST = { p: [0.38, -0.4, -0.55], r: [0.32, -0.3, -0.12] };
const SWING = [
  { t: 0, ...REST },
  { t: 0.18, p: [0.4, -0.2, -0.38], r: [1.12, -0.65, -0.3] },
  { t: 0.48, p: [0.04, -0.22, -0.58], r: [0.75, 0.05, -0.8] },
  { t: 0.7, p: [-0.25, -0.42, -0.5], r: [0.25, 0.85, -1.25] },
  { t: 1, ...REST },
];

function restHeight(camera, depth, fraction = 0.95) {
  const fov = Number.isFinite(camera?.fov) ? camera.fov : 75;
  return -fraction * depth * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
}

function restX(camera, depth, base) {
  const aspect = Number.isFinite(camera?.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
  return Math.min(base, -restHeight(camera, depth, 0.82) * aspect);
}

function fitNarrowView(holder, camera) {
  const aspect = Number.isFinite(camera?.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
  holder.scale.setScalar(Math.min(1, aspect / (4 / 3)));
}

// Icon art and missing-art fallbacks share the same desktop size limits. These
// are visual sizes only: original item length/reach and VR geometry are retained.
export function desktopModel(model, { roll = 0, shield = false } = {}) {
  if (!model) return null;
  const group = new THREE.Group();
  group.add(model);
  if (model.userData.source === 'icon') group.rotation.z = roll;
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const limits = shield ? [0.4, 0.4, 0.4] : [0.28, 0.32, 0.62];
  const scale = Math.min(0.6, ...limits.map((limit, i) => size.getComponent(i) > 0 ? limit / size.getComponent(i) : 1));
  group.scale.setScalar(scale);
  group.userData.desktopScale = scale;
  group.userData.length = model.userData.length;
  return group;
}

export function desktopEquipmentHidden(ui, transferring = false) {
  return !!(transferring || ui?.menuOpen || ui?.sceneOpen || ui?.msg || ui?.dialogueActive?.() || ui?.banner);
}

export function desktopRest(holder, hand = 'right', ranged = false, camera = null) {
  if (!holder) return;
  const sign = hand === 'left' ? -1 : 1;
  const depth = ranged ? 0.5 : -REST.p[2];
  fitNarrowView(holder, camera);
  holder.position.set(sign * restX(camera, depth, ranged ? 0.3 : REST.p[0]), restHeight(camera, depth), -depth);
  if (ranged) holder.rotation.set(0.04, sign * 0.06, 0);
  else holder.rotation.set(...REST.r);
}

export function desktopShield(holder, progress, camera = null) {
  const t = THREE.MathUtils.clamp(progress, 0, 1), k = t * t * (3 - 2 * t);
  fitNarrowView(holder, camera);
  holder.position.set(-restX(camera, 0.55, 0.38), restHeight(camera, 0.55) - (1 - k) * 0.4, -0.55);
  holder.rotation.set(0, Math.PI + 0.3, 0);
}

// The PC shield's gameplay interception point stays where it was before the
// viewmodel moved aside. VR continues using the physical controller-held shield.
export function desktopShieldGuardPoint(target, camera, progress) {
  const t = THREE.MathUtils.clamp(progress, 0, 1), k = t * t * (3 - 2 * t);
  camera.updateWorldMatrix(true, false);
  return target.set(-0.32, -0.32 - (1 - k) * 0.4, -0.5).applyMatrix4(camera.matrixWorld);
}

export function desktopSwing(holder, progress, camera = null) {
  fitNarrowView(holder, camera);
  const k = Math.max(0, Math.min(1, progress));
  let segment = 1;
  while (segment < SWING.length - 1 && k > SWING[segment].t) segment++;
  const a = SWING[segment - 1], b = SWING[segment];
  const t = (k - a.t) / (b.t - a.t), eased = t * t * (3 - 2 * t);
  const mix = (x, y) => x + (y - x) * eased;
  holder.position.set(...a.p.map((value, i) => mix(value, b.p[i])));
  // Keep the wind-up/sweep intact; only its rest endpoints follow the current FOV.
  const restY = restHeight(camera, -REST.p[2]);
  const restPositionX = restX(camera, -REST.p[2], REST.p[0]);
  if (a.t === 0) { holder.position.y += (restY - REST.p[1]) * (1 - eased); holder.position.x += (restPositionX - REST.p[0]) * (1 - eased); }
  if (b.t === 1) { holder.position.y += (restY - REST.p[1]) * eased; holder.position.x += (restPositionX - REST.p[0]) * eased; }
  holder.rotation.set(...a.r.map((value, i) => mix(value, b.r[i])));
}
