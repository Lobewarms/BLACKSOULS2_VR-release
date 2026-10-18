import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { desktopRest, desktopSwing, desktopModel, desktopShieldGuardPoint } from '../src/combat/desktop-weapon.js';
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
  assert.ok(Math.abs(muzzle.z + combat.weapon.userData.visualLength) < 1e-7);
  assert.ok(combat.weapon.userData.visualLength > 0 && combat.weapon.userData.visualLength <= combat.weapon.userData.length * 0.6);
});

async function equipmentScene(t) {
  const previous = Object.fromEntries(['state', 'input', 'three', 'vr', 'ui', 'map'].map(key => [key, G[key]]));
  t.after(() => Object.assign(G, previous));
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 300);
  G.vr = false; G.ui = {}; G.map = { transferring: false };
  G.input = { controllers: {
    right: { grip: new THREE.Group(), ray: new THREE.Group() },
    left: { grip: new THREE.Group(), ray: new THREE.Group() },
  } };
  G.three = { camera };
  let weapon = null, armor = null;
  G.state = { party: { leader: () => ({ weapons: () => weapon ? [weapon] : [], armors: () => armor ? [armor] : [] }) } };
  const { CombatSystem } = await import('../src/combat/combat.js');
  const combat = Object.create(CombatSystem.prototype);
  const dispose = object => object?.traverse(child => { child.geometry?.dispose(); for (const material of [child.material].flat()) material?.dispose(); });
  t.after(() => { dispose(combat.weapon); dispose(combat.shield); });
  return { camera, combat, equip(wtype, offhand = null) {
    dispose(combat.weapon); dispose(combat.shield);
    weapon = wtype ? { id: wtype, icon_index: -1, wtype_id: wtype } : null;
    armor = offhand ? { id: 1, etype_id: 1, icon_index: -1, atype_id: offhand === 'large' ? 6 : 1,
      features: offhand === 'gun' ? [{ code: 43 }] : [{ code: 23, data_id: 1, value: offhand === 'large' ? 3 : 1.5 }] } : null;
    combat.equipKey = null; combat.refreshEquipment();
    return combat;
  } };
}

function projectedBounds(object, camera) {
  camera.updateMatrixWorld(true);
  const box = new THREE.Box2();
  object.traverse(child => {
    if (!child.isMesh) return;
    child.geometry.computeBoundingBox();
    const bounds = child.geometry.boundingBox;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = child.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
      box.expandByPoint(new THREE.Vector2(point.x, point.y));
    }
  });
  return box;
}

test('PC weapon and guard models leave the central view clear across weapon types, FOV and window shapes', async t => {
  const { camera, combat, equip } = await equipmentScene(t);
  const focus = new THREE.Box2(new THREE.Vector2(-0.25, -0.24), new THREE.Vector2(0.25, 0.45));
  const screen = new THREE.Box2(new THREE.Vector2(-1, -1), new THREE.Vector2(1, 1));
  for (const fov of [60, 75, 90]) for (const aspect of [4 / 3, 16 / 9, 21 / 9, 9 / 16]) {
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix();
    for (const type of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      equip(type);
      const bounds = projectedBounds(combat.weapon, camera);
      assert.ok(!bounds.intersectsBox(focus), `type ${type}, FOV ${fov}, aspect ${aspect}: ${JSON.stringify(bounds)}`);
      const visible = bounds.clone().intersect(screen).getSize(new THREE.Vector2());
      assert.ok(visible.x > 0 && visible.y > 0, `weapon ${type} should remain partly visible`);
      assert.ok(visible.x * visible.y < 0.6, `weapon ${type} should occupy less than 15% of the screen`);
      assert.equal(combat.weaponLength(), combat.weapon.userData.length, 'visual size never shortens combat reach');
    }
    for (const shield of ['small', 'large']) {
      equip(4, shield); combat.guardUp = true; combat.updateDeskShield(0.2);
      const bounds = projectedBounds(combat.shield, camera);
      assert.ok(!bounds.intersectsBox(focus), `${shield} shield, FOV ${fov}, aspect ${aspect}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.intersectsBox(screen), 'guarding must still show the shield');
    }
  }
});

test('PC equipment disappears during dialogue, choices, menus and transfers, then returns without rebuilding', async t => {
  const { combat, equip } = await equipmentScene(t);
  equip(4, 'gun');
  const weapon = combat.weapon, offhand = combat.shield;
  assert.ok(weapon.visible && offhand.visible);
  for (const flag of ['msg', 'menuOpen', 'sceneOpen', 'banner']) {
    G.ui[flag] = true; combat.updateDesktopEquipment();
    assert.equal(weapon.visible, false, flag); assert.equal(offhand.visible, false, flag);
    G.ui[flag] = null; combat.updateDesktopEquipment();
    assert.ok(weapon.visible && offhand.visible);
    assert.equal(combat.weapon, weapon);
  }
  G.map.transferring = true; combat.updateDesktopEquipment(); assert.equal(weapon.visible, false);
  G.map.transferring = false; combat.updateDesktopEquipment(); assert.equal(weapon.visible, true);
  equip(4, 'large'); combat.guardUp = true; combat.updateDeskShield(0.2);
  G.ui.msg = {}; combat.updateDeskShield(0.1); combat.updateDesktopEquipment();
  assert.equal(combat.shield.visible, false, 'guard animation must not bring a shield back over dialogue');
});

test('gameplay frames hide cached PC equipment for a shop dialogue and restore it when the dialogue closes', async t => {
  const { combat, equip } = await equipmentScene(t);
  equip(4, 'gun');
  const weapon = combat.weapon, shield = combat.shield;
  G.map.grid = {}; G.map.interpreter = { running: () => false }; G.map.reservedCommon = [];
  G.input.disarmPressed = () => false;
  combat.stamina = 1; combat.staminaDelay = 0; combat.rangedCooldown = 0;
  combat.fadingMarkers = []; combat.battles = []; combat.allies = { update() {} };
  for (const method of ['alignHeldToRay', 'updateGuard', 'updateQuick', 'updateReady', 'updateHeld', 'updateFx', 'updateAreaMarks', 'updatePlayerAttack',
    'updateSymbols', 'updateWeaponGlow', 'updateActorStates', 'updateGhost', 'updateWeaponFx', 'updateEnemies', 'updateProjectiles', 'updateWaves', 'updateHazards', 'updatePopups']) combat[method] = () => {};
  G.ui.msg = { choices: ['Buy', 'Sell', 'Leave'] };
  combat.update(1 / 60);
  assert.equal(weapon.visible, false, 'the real frame must hide the cached weapon over shop choices');
  assert.equal(shield.visible, false);
  G.ui.msg = null; combat.update(1 / 60);
  assert.ok(weapon.visible && shield.visible);
  assert.equal(combat.weapon, weapon, 'the frame restores the same equipped model');
});

test('PC swing endpoints follow resized views and the strike still crosses the view during its hit window', async t => {
  const { camera, combat, equip } = await equipmentScene(t);
  equip(4);
  for (const fov of [60, 75, 90]) for (const aspect of [4 / 3, 16 / 9, 21 / 9, 9 / 16]) {
    camera.fov = fov; camera.aspect = aspect; camera.updateProjectionMatrix();
    desktopRest(combat.weapon, 'right', false, camera);
    const position = combat.weapon.position.clone(), rotation = combat.weapon.quaternion.clone(), scale = combat.weapon.scale.clone();
    for (const progress of [0, 1]) {
      desktopSwing(combat.weapon, progress, camera);
      assert.ok(combat.weapon.position.distanceTo(position) < 1e-9);
      assert.ok(combat.weapon.quaternion.angleTo(rotation) < 1e-7);
      assert.ok(combat.weapon.scale.equals(scale));
    }
    const tips = [0.18, 0.48, 0.7].map(progress => {
      desktopSwing(combat.weapon, progress, camera); camera.updateMatrixWorld(true);
      return new THREE.Vector3(0, 0, -combat.weapon.userData.visualLength).applyMatrix4(combat.weapon.matrixWorld).project(camera);
    });
    assert.ok(tips[0].x > 0 && tips[2].x < 0, 'the sweep must still move across the screen');
    assert.ok(Math.abs(tips[1].x) < 1 && Math.abs(tips[1].y) < 1, 'the middle of the existing hit window must stay visible');
  }
});

test('desktop size fitting retains the original icon model and scales oversized art without altering its proportions', () => {
  const icon = new THREE.Group(); icon.userData.source = 'icon'; icon.userData.length = 2.4;
  icon.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 2.4), new THREE.MeshBasicMaterial()));
  const model = desktopModel(icon, { roll: -Math.PI / 2 });
  assert.equal(model.children[0], icon);
  assert.equal(model.scale.x, model.scale.y); assert.equal(model.scale.y, model.scale.z);
  assert.ok(model.scale.x < 0.6);
  assert.equal(icon.userData.length, 2.4);
  assert.equal(icon.scale.x, 1, 'the original model and its tuning remain untouched');
  icon.children[0].geometry.dispose(); icon.children[0].material.dispose();
});

test('PC shield visual changes retain the original interception point and VR hand transforms remain unchanged', async t => {
  const { camera, combat, equip } = await equipmentScene(t);
  camera.position.set(3, 2, -4); camera.rotation.set(0.1, 0.5, 0); camera.updateMatrixWorld(true);
  const before = new THREE.Vector3(-0.32, -0.32, -0.5).applyMatrix4(camera.matrixWorld);
  assert.ok(desktopShieldGuardPoint(new THREE.Vector3(), camera, 1).distanceTo(before) < 1e-9);
  G.vr = true;
  equip(3, 'large');
  assert.equal(combat.weapon.parent, G.input.controllers.right.grip);
  assert.deepEqual(combat.weapon.position.toArray(), [0, 0, 0.03]);
  assert.deepEqual(combat.weapon.scale.toArray(), [1, 1, 1]);
  assert.equal(combat.weapon.userData.visualLength, combat.weapon.userData.length);
  assert.deepEqual(combat.shield.position.toArray(), [-0.07, 0, 0.02]);
  assert.equal(combat.shield.rotation.y, -Math.PI / 2);
  assert.deepEqual(combat.shield.children[0].scale.toArray(), [1, 1, 1]);
  const position = combat.weapon.position.clone(), scale = combat.weapon.scale.clone();
  G.ui.msg = {}; combat.updateDesktopEquipment(); combat.updateDeskShield(1);
  assert.ok(combat.weapon.visible && combat.shield.visible, 'desktop presentation must not hide VR hands');
  assert.ok(combat.weapon.position.equals(position) && combat.weapon.scale.equals(scale));
  equip(0, 'gun');
  assert.equal(combat.offGun.parent, G.input.controllers.left.grip);
  assert.deepEqual(combat.offGun.position.toArray(), [0, 0, 0.03]);
  assert.deepEqual(combat.offGun.scale.toArray(), [1, 1, 1]);
  assert.equal(combat.offGun.userData.visualLength, combat.offGun.userData.length);
});
