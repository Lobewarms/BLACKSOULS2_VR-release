import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { G } from '../src/core/globals.js';
import { $data } from '../src/data/data.js';
import { GameState } from '../src/game/state.js';
import { normalizeEnvironmentState } from '../src/game/environment-state.js';
import { EnvironmentEffects, parseMapFog } from '../src/world/environment-effects.js';

function environment(t, load) {
  const previous = { ...G }, data = { ...$data };
  t.after(() => { Object.assign(G, previous); Object.assign($data, data); });
  const calls = [], image = { width: 540, height: 540 };
  Object.assign(G, { state: new GameState(), settings: { ...G.settings, fxBrightness: 0.5 }, player: { floorY: 0 } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  const fx = new EnvironmentEffects(scene, { random: () => 0.37,
    loadImage: async (...args) => { calls.push(args); return load ? load(...args) : image; } });
  t.after(() => fx.dispose());
  const wait = () => Promise.all([...fx.pending.values()]);
  return { scene, camera, fx, calls, image, wait };
}

test('original map fog syntax preserves signed scroll, blend and opacity without treating radial darkness as density', () => {
  assert.deepEqual(parseMapFog('==マップフォグfog[-5,2,10,20,0]=='),
    { file: 'fog', xspeed: -5, yspeed: 2, z: 10, opacity: 20, blend: 0, darkness: false });
  assert.equal(parseMapFog('==マップフォグkurayami01[0,0,10,100,2]==').darkness, true);
  assert.equal(parseMapFog('==マップフォグpipo-fog020[0,0,10,20,2]==').darkness, false);
  assert.equal(parseMapFog('==マップフォグ../outside[0,0,10,100,0]=='), null);
  assert.equal(parseMapFog('==マップフォグfog[bad,0,10,100,0]=='), null);
  assert.equal(parseMapFog(''), null);
  assert.deepEqual(parseMapFog('==マップフォグfog[99999,-99999,99999,9999,9]=='),
    { file: 'fog', xspeed: 1000, yspeed: -1000, z: 1000, opacity: 255, blend: 2, darkness: false });
});

test('fog uses original image and signed scrolling in world coordinates with a clear near-head region', async t => {
  const { fx, scene, camera, calls } = environment(t);
  scene.fog = new THREE.Fog(0x123456, 10, 40); const fog = scene.fog;
  await fx.setMap({ note: '==マップフォグfog[-5,2,10,20,0]==' });
  assert.deepEqual(calls, [['Graphics/Parallaxes', 'fog']]);
  const entry = fx.entries.get('mapFog');
  fx.update(0, new THREE.Vector3(0, 1.6, 0));
  const before = entry.materials[0].uniforms.uvOffset.value.clone();
  fx.update(0.1, new THREE.Vector3(0, 1.6, 0));
  const after = entry.materials[0].uniforms.uvOffset.value;
  assert.ok(after.x > 0.99, 'negative X scroll wraps backwards'); assert.ok(after.y > before.y, 'positive Y scroll advances');
  assert.equal(scene.fog, fog); assert.equal(fog.near, 10); assert.equal(fog.far, 40);
  assert.equal(entry.group.parent, fx.root); assert.equal(fx.root.parent, scene); assert.equal(camera.children.length, 0);
  for (const mat of entry.materials) {
    assert.equal(mat.depthTest, true); assert.equal(mat.depthWrite, false);
    assert.match(mat.fragmentShader, /smoothstep\(0\.9, 2\.0/);
  }
  const originalPosition = entry.group.position.clone(); camera.rotation.y = 1.2;
  fx.update(0, new THREE.Vector3(0.02, 1.5, 0.02));
  assert.deepEqual(entry.group.position.toArray(), originalPosition.toArray(), 'head rotation and small movement cannot drag a fog sheet');
});

test('radial kurayami is left to edge-darkness presentation and never makes a world fog layer', async t => {
  const { fx, calls } = environment(t);
  await fx.setMap({ note: '==マップフォグkurayami01[0,0,10,100,2]==' });
  assert.equal(fx.entries.size, 0); assert.deepEqual(calls, []); assert.equal(fx.mapFog.darkness, true);
});

test('rich-fog hooks are idempotent, persist settings and stop without leaving a stale asynchronous sheet', async t => {
  let resolve;
  const { fx, calls, wait } = environment(t, () => new Promise(done => { resolve = done; }));
  await fx.setMap({ note: '' });
  assert.equal(fx.effectHook('rich_fog_start'), true); const first = wait();
  fx.effectHook('rich_fog_start'); await Promise.resolve();
  assert.equal(calls.length, 1);
  fx.effectHook('rich_fog_stop'); resolve({ width: 816, height: 624 }); await first;
  assert.equal(fx.entries.size, 0); assert.equal(fx.root.children.length, 0);
  assert.equal(G.state.system.environmentEffects.richFog, false);
  assert.equal(fx.effectHook('unrelated_hook'), false);
});

test('sunshine preserves original white/blue texture selection and source direction while staying world-owned and dim', async t => {
  const { fx, calls, wait } = environment(t);
  await fx.setMap({ note: '' }); fx.effectHook('rich_sunshine_start', [2, 3]); await wait();
  assert.deepEqual(calls, [['Graphics/System', 'Sunshine_2']]);
  const sun = fx.entries.get('sunshine'); fx.update(0.1, new THREE.Vector3(0, 1.6, 0));
  assert.equal(sun.meshes.length, 3); assert.ok(sun.meshes[1].position.x > 0);
  assert.ok(sun.materials.every(mat => mat.blending === THREE.AdditiveBlending && mat.uniforms.alpha.value <= 0.05));
  const before = sun.meshes.map(mesh => mesh.rotation.toArray());
  fx.update(0.1, new THREE.Vector3(0.1, 1.6, 0.1)); assert.deepEqual(sun.meshes.map(mesh => mesh.rotation.toArray()), before);
  fx.effectHook('rich_sunshine_stop'); assert.equal(fx.entries.has('sunshine'), false);
});

test('leaves use the original 18 by 18 atlas and all twelve source types select the right art and wind', async t => {
  const { fx, calls, wait } = environment(t);
  await fx.setMap({ note: '' });
  for (let type = 1; type <= 12; type++) {
    fx.effectHook('start_fallen_leaves', [type]); await wait();
    assert.deepEqual(calls.at(-1), ['Graphics/System', `fallen_leaves${String(Math.ceil(type / 3)).padStart(2, '0')}`]);
    const entry = fx.entries.get('leaves'); assert.equal(entry.mesh.count, 48);
    fx.update(0, new THREE.Vector3(0, 1.6, 0));
    const p = entry.particles[0], x = p.position.x, y = p.position.y;
    fx.update(0.1, new THREE.Vector3(0, 1.6, 0));
    assert.ok(p.position.y < y); assert.ok(p.position.distanceTo(new THREE.Vector3(x, y, p.position.z)) < 0.2);
    const drift = p.position.x - x;
    if ((type - 1) % 3 === 1) assert.ok(drift > 0);
    if ((type - 1) % 3 === 2) assert.ok(drift < 0);
    for (const value of entry.frames.array) assert.ok(value >= 0 && value < 18);
    assert.match(entry.materials[0].vertexShader, /instanceMatrix/);
    assert.match(entry.materials[0].vertexShader, /17\.0 - leafFrame\.y/);
  }
  fx.effectHook('end_fallen_leaves'); assert.equal(fx.entries.has('leaves'), false);
});

test('cue settings survive a map transfer and native save while generated instances and all GPU resources are replaced', async t => {
  const { fx, wait } = environment(t);
  await fx.setMap({ note: '' }); fx.effectHook('rich_fog_start'); fx.effectHook('start_fallen_leaves', [6]);
  fx.effectHook('rich_sunshine_start', [1, 2]); await wait();
  const resources = [...fx.entries.values()].flatMap(e => [e.geometry, ...e.textures, ...e.materials]);
  const counts = resources.map(resource => { const count = { value: 0 }; resource.addEventListener('dispose', () => count.value++); return count; });
  const oldLeaves = fx.entries.get('leaves').mesh;
  let instanceDisposals = 0; oldLeaves.addEventListener('dispose', () => instanceDisposals++);
  G.state = GameState.fromJSON(JSON.parse(JSON.stringify(G.state.toJSON())));
  await fx.setMap({ note: '==マップフォグfog[-5,2,10,20,0]==' });
  assert.deepEqual(G.state.system.environmentEffects, { richFog: true, leavesType: 6, sunshineType: 1, sunshinePosition: 2 });
  assert.ok(counts.every(count => count.value === 1)); assert.notEqual(fx.entries.get('leaves').mesh, oldLeaves);
  assert.equal(instanceDisposals, 1, 'instance-matrix GPU buffers must be explicitly released too');
  let meshCount = 0, lightCount = 0; fx.root.traverse(node => { meshCount += +!!node.isMesh; lightCount += +!!node.isLight; });
  assert.equal(meshCount, 9); assert.equal(lightCount, 0);
  fx.clear(); assert.equal(fx.root.children.length, 0); assert.equal(fx.map, null);
  fx.dispose(); assert.equal(fx.root.parent, null); fx.dispose();
});

test('failed assets can retry on a later explicit cue without per-frame retries or unbounded allocations', async t => {
  let attempts = 0;
  const { fx, wait } = environment(t, () => ++attempts === 1 ? null : { width: 816, height: 624 });
  await fx.setMap({ note: '' }); fx.effectHook('rich_fog_start'); await wait();
  assert.equal(fx.entries.size, 0);
  for (let i = 0; i < 20; i++) fx.update(0.1, new THREE.Vector3(0, 1.6, 0));
  assert.equal(attempts, 1);
  fx.effectHook('rich_fog_start'); await wait(); assert.equal(attempts, 2); assert.equal(fx.entries.get('richFog').meshes.length, 3);
});

test('teleports keep leaves bounded around the new area and invalid head/delta values never contaminate transforms', async t => {
  const { fx, wait } = environment(t);
  await fx.setMap({ note: '' }); fx.effectHook('start_fallen_leaves', [1]); await wait();
  const head = new THREE.Vector3(1000, 1.6, -1000); fx.update(10000, head);
  const entry = fx.entries.get('leaves');
  assert.ok(entry.particles.every(p => Math.hypot(p.position.x - head.x, p.position.z - head.z) <= 12.001));
  const matrices = [...entry.mesh.instanceMatrix.array];
  fx.update(0.1, new THREE.Vector3(NaN, 0, 0)); assert.deepEqual([...entry.mesh.instanceMatrix.array], matrices);
  fx.update(NaN, head); assert.ok([...entry.mesh.instanceMatrix.array].every(Number.isFinite));
});

test('original-save import retains only valid persistent Game_System cue fields without importing generated leaf sprites', t => {
  environment(t);
  const system = { rich_fog: true, sunshine_type: 2, sunshine_position: 3, fallen_leaves_type: 6,
    fallen_leaves_sprites: [{ imaginary: 'runtime-only sprite' }] };
  const contents = new Map([['system', system], ['map', { map_id: 1 }], ['player', { x: 1, y: 2 }]]);
  G.state.importRmSave(contents, 'Synthetic original save');
  assert.deepEqual(G.state.system.environmentEffects, { richFog: true, sunshineType: 2, sunshinePosition: 3, leavesType: 6 });
  assert.equal(JSON.stringify(G.state.toJSON()).includes('imaginary'), false);
  assert.deepEqual(normalizeEnvironmentState({ richFog: 'true', sunshineType: 9, sunshinePosition: -1, leavesType: Infinity }),
    { richFog: false, sunshineType: 0, sunshinePosition: 2, leavesType: 0 });
});
