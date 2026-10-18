import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { desktopRest, desktopSwing } from '../src/combat/desktop-weapon.js';
import { archivedIconCanvas, sheetForIcon } from '../src/data/iconfallback.js';
import { initAssets } from '../src/data/assets.js';
import { loadUiAssets, getIconSet, drawIcon } from '../src/ui/ui.js';
import { G } from '../src/core/globals.js';

test('desktop sword has wind-up, a cross-screen sweep and an exact return to rest', () => {
  const weapon = new THREE.Group();
  desktopRest(weapon);
  const restPosition = weapon.position.clone(), restRotation = weapon.quaternion.clone();
  desktopSwing(weapon, 0);
  assert.ok(weapon.position.distanceTo(restPosition) < 1e-9);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  const projected = [];
  for (const progress of [0.18, 0.48, 0.7]) {
    desktopSwing(weapon, progress); weapon.updateMatrixWorld(true);
    projected.push(new THREE.Vector3(0, 0, -0.6).applyMatrix4(weapon.matrixWorld).project(camera));
  }
  assert.ok(projected[0].x > 0.2 && projected[2].x < -0.2, 'the blade must sweep from right to left');
  assert.ok(projected.every(point => Math.abs(point.y) < 1), 'the blade must remain in the view');
  desktopSwing(weapon, 1);
  assert.ok(weapon.position.distanceTo(restPosition) < 1e-9);
  assert.ok(weapon.quaternion.angleTo(restRotation) < 1e-7);
});

test('short loose icon sheets use archived high-numbered icons without replacing existing art', () => {
  const loose = { width: 384, height: 936 }, archive = { width: 384, height: 1300 };
  assert.equal(sheetForIcon(loose, archive, 100), loose);
  assert.equal(sheetForIcon(loose, archive, 706), archive);
  assert.equal(sheetForIcon(loose, archive, 707), archive);
  assert.equal(sheetForIcon(loose, archive, 2000), null);
});

test('a cache from a different game folder is never used', async t => {
  t.mock.method(globalThis, 'fetch', async url => Response.json(url.includes('icons.json')
    ? { game: 'C:\\Other Game', iconSet: '/local-assets/IconSet.png?revision=' + 'a'.repeat(64) }
    : { game: 'D:\\Current Game' }));
  assert.equal(await archivedIconCanvas(), null);
});

test('the Hunter pistol uses archived icon pixels in its held model and inventory', async t => {
  const previous = { state: G.state, input: G.input, three: G.three, vr: G.vr };
  t.after(() => Object.assign(G, previous));
  const globals = { Image: Object.getOwnPropertyDescriptor(globalThis, 'Image'), document: Object.getOwnPropertyDescriptor(globalThis, 'document'), addEventListener: Object.getOwnPropertyDescriptor(globalThis, 'addEventListener') };
  t.after(() => { for (const [name, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  } });
  const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ({
    drawImage() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
  }) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: makeCanvas } });
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(url) { this.width = 384; this.height = url.includes('local-assets') ? 1300 : 936; queueMicrotask(() => this.onload()); }
  } });
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/manifest') return Response.json({ files: ['Graphics/System/IconSet.png'] });
    if (url.includes('icons.json')) return Response.json({ game: 'C:\\Game', iconSet: '/local-assets/IconSet.png?revision=' + 'a'.repeat(64) });
    return Response.json({ game: 'c:/game/' });
  });
  G.vr = false; G.input = { controllers: {} }; G.three = { camera: new THREE.PerspectiveCamera() };
  const pistol = { id: 65, etype_id: 1, icon_index: 706, features: [{ code: 43 }] };
  G.state = { party: { leader: () => ({ weapons: () => [], armors: () => [pistol] }) } };
  const { CombatSystem } = await import('../src/combat/combat.js');
  const combat = Object.create(CombatSystem.prototype);
  combat.refreshEquipment();
  const fallback = combat.offGun, key = combat.equipKey;
  await initAssets(); await loadUiAssets();
  combat.refreshEquipment();
  assert.notEqual(combat.equipKey, key, 'newly loaded artwork must invalidate the fallback equipment');
  assert.notEqual(combat.offGun, fallback);
  let icon = null;
  combat.offGun.traverse(object => { if (object.userData.source === 'icon') icon = object; });
  assert.equal(icon?.userData.iconIndex, 706);
  assert.equal(getIconSet(706).height, 1300);
  let drawnSheet;
  drawIcon({ drawImage: sheet => { drawnSheet = sheet; } }, 706, 0, 0);
  assert.equal(drawnSheet, getIconSet(706));
  assert.equal(getIconSet(100).height, 936);
  // The desktop icon is scaled down; the projectile must start at that visible barrel.
  G.state.party.leader = () => ({ weapons: () => [{ id: 10, icon_index: 706, wtype_id: 10 }], armors: () => [] });
  combat.refreshEquipment();
  const muzzle = combat.weapon.worldToLocal(combat.muzzle());
  assert.ok(Math.abs(muzzle.z + combat.weapon.userData.length * 0.6) < 1e-7);
});
