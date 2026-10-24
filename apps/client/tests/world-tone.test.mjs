import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldTone, worldTonePixel } from '../src/world/world-tone.js';
import { ScreenFx } from '../src/ui/screen.js';
import { G } from '../src/core/globals.js';

const MARKER = '// world-tone-output-v1';
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const geometry = () => new THREE.PlaneGeometry();
const renderer = { outputColorSpace: THREE.SRGBColorSpace, getRenderTarget: () => null };
function compile(material, library = 'lambert', output = renderer) {
  const shader = { vertexShader: THREE.ShaderLib[library].vertexShader,
    fragmentShader: THREE.ShaderLib[library].fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, output); return shader;
}

test('tone desaturates each displayed pixel before signed RGB offsets, clamps channels and preserves alpha', () => {
  const grayRed = worldTonePixel([1, 0, 0, 0.37], { gray: 255 });
  grayRed.slice(0, 3).forEach(value => close(value, 0.299)); assert.equal(grayRed[3], 0.37);
  const grayBlue = worldTonePixel([0, 0, 1, 0], { gray: 255 });
  grayBlue.slice(0, 3).forEach(value => close(value, 0.114)); assert.equal(grayBlue[3], 0);
  const combined = worldTonePixel([1, 0, 0, 1], { gray: 255, red: 51, green: -51, blue: 255 });
  close(combined[0], 0.499); close(combined[1], 0.099); assert.equal(combined[2], 1);
  const partial = worldTonePixel([0.8, 0.3, 0.1, 0.6], { gray: 127.5, r: -25.5 });
  close(partial[0], (0.8 + 0.4267) / 2 - 0.1); close(partial[1], (0.3 + 0.4267) / 2);
  assert.deepEqual(worldTonePixel([0.2, 0.4, 0.8, 0.5]), [0.2, 0.4, 0.8, 0.5]);
  assert.deepEqual(worldTonePixel([0.2, 0.4, 0.8], { r: -999, g: Infinity, b: 999, gray: NaN }), [0, 0.4, 1]);
});

test('actual Lambert, Basic, Lines and Points shaders tone after output/fog and before alpha premultiplication', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene);
  const entries = [
    [new THREE.MeshLambertMaterial(), 'lambert', THREE.Mesh],
    [new THREE.MeshBasicMaterial(), 'basic', THREE.Mesh],
    [new THREE.LineBasicMaterial(), 'basic', THREE.LineSegments],
    [new THREE.PointsMaterial(), 'points', THREE.Points],
  ];
  for (const [material, , ObjectType] of entries) scene.add(new ObjectType(geometry(), material));
  system.apply({ gray: 255, b: -51 });
  for (const [material, library] of entries) {
    const shader = compile(material, library), code = shader.fragmentShader;
    assert.equal(shader.uniforms.worldTone, system.uniform);
    assert.ok(code.indexOf('#include <colorspace_fragment>') < code.indexOf(MARKER));
    assert.ok(code.indexOf('#include <fog_fragment>') < code.indexOf(MARKER));
    assert.ok(code.indexOf(MARKER) < code.indexOf('#include <premultiplied_alpha_fragment>'));
    assert.ok(!code.includes('sRGBTransferOETF'), 'standard PC/XR output is already sRGB at this hook');
    assert.match(code, /mix\( worldToneRgb, vec3\( worldToneLuma \), worldTone.w \) \+ worldTone.rgb/);
    assert.ok(!code.slice(code.indexOf(MARKER)).includes('gl_FragColor.a'), 'tone never replaces coverage alpha');
    assert.equal(material.opacity, 1);
  }
  close(system.uniform.value.w, 1); close(system.uniform.value.z, -0.2);
});

test('composition preserves map backside and vertex hooks and custom dynamic shader cache keys', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene), material = new THREE.MeshLambertMaterial();
  let key = 'map-backshaded', hookCalls = 0;
  material.onBeforeCompile = function (shader) {
    assert.equal(this, material); hookCalls++;
    shader.vertexShader += '\n// existing billboard positioning';
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb *= 0.55;');
  };
  material.customProgramCacheKey = function () { assert.equal(this, material); return key; };
  scene.add(new THREE.Mesh(geometry(), material)); system.apply({ gray: 80 });
  const shader = compile(material);
  assert.match(shader.fragmentShader, /if \(!gl_FrontFacing\) diffuseColor.rgb \*= 0.55/);
  assert.match(shader.vertexShader, /existing billboard positioning/); assert.equal(hookCalls, 1);
  assert.equal(material.customProgramCacheKey(), 'map-backshaded|world-tone-output-v1');
  key = 'map-backshaded-next'; assert.equal(material.customProgramCacheKey(), 'map-backshaded-next|world-tone-output-v1');
});

test('repeated applies, shared materials and new dynamic meshes reuse uniform/hook without recompile or duplicate patches', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene), material = new THREE.MeshLambertMaterial();
  const originalKey = material.customProgramCacheKey(); scene.add(new THREE.Mesh(geometry(), material), new THREE.Mesh(geometry(), material));
  system.apply({ r: 51 }); const hook = material.onBeforeCompile, version = material.version;
  assert.equal(material.customProgramCacheKey(), `${originalKey}|world-tone-output-v1`);
  const shader = compile(material);
  system.apply({ gray: 255 }); system.apply({});
  assert.equal(material.onBeforeCompile, hook); assert.equal(material.version, version); assert.equal(material.customProgramCacheKey().split('|world-tone-output-v1').length, 2);
  assert.deepEqual(shader.uniforms.worldTone.value.toArray(), [0, 0, 0, 0], 'an already-compiled world shader resets through its uniform');
  material.onBeforeCompile(shader, renderer); assert.equal(shader.fragmentShader.split(MARKER).length, 2);
  const added = new THREE.PointsMaterial(); scene.add(new THREE.Points(geometry(), added)); system.apply({ g: 51 });
  assert.equal(compile(added, 'points').uniforms.worldTone, shader.uniforms.worldTone);
  close(shader.uniforms.worldTone.value.y, 0.2);
});

test('HUD, menus, pictures, overlays, explicit exclusions and custom shaders stay untouched', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene), objects = [];
  const add = (material, renderOrder = 0) => { const mesh = new THREE.Mesh(geometry(), material); mesh.renderOrder = renderOrder; scene.add(mesh); objects.push(mesh); return mesh; };
  add(new THREE.MeshBasicMaterial({ depthTest: false }), 900); // real wrist HUD order
  add(new THREE.MeshBasicMaterial(), 3100); add(new THREE.MeshBasicMaterial(), 2991.5);
  add(new THREE.MeshBasicMaterial({ depthTest: false }), 2990);
  add(new THREE.MeshBasicMaterial()).userData.worldTone = false;
  const explicit = new THREE.MeshBasicMaterial(); explicit.userData.worldTone = false; add(explicit);
  add(new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }));
  const group = new THREE.Group(); group.userData.worldTone = false; scene.add(group);
  const child = add(new THREE.MeshBasicMaterial()); group.add(child);
  const originals = objects.map(object => [object.material.onBeforeCompile, object.material.customProgramCacheKey(), object.material.version]);
  system.apply({ r: -100, gray: 255 });
  objects.forEach((object, i) => {
    assert.equal(object.material.onBeforeCompile, originals[i][0]); assert.equal(object.material.customProgramCacheKey(), originals[i][1]);
    assert.equal(object.material.version, originals[i][2]);
  });
});

test('linear output converts around output-space tone while XR sRGB uses the direct transform', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene), material = new THREE.MeshBasicMaterial();
  scene.add(new THREE.Mesh(geometry(), material)); system.apply({ gray: 255 });
  const linearRenderer = { outputColorSpace: THREE.LinearSRGBColorSpace, getRenderTarget: () => null };
  assert.match(compile(material, 'basic', linearRenderer).fragmentShader, /sRGBTransferOETF/);
  assert.match(compile(material, 'basic', linearRenderer).fragmentShader, /sRGBTransferEOTF/);
  const xrRenderer = { outputColorSpace: THREE.SRGBColorSpace,
    getRenderTarget: () => ({ isXRRenderTarget: true, texture: { colorSpace: THREE.SRGBColorSpace } }) };
  assert.ok(!compile(material, 'basic', xrRenderer).fragmentShader.includes('sRGBTransferOETF'));
  assert.equal(scene.children.length, 1, 'no eye copies, render target or additional world geometry');
});

test('Color background tone starts from raw linear source on every frame, resets and handles sky replacements/in-place updates', () => {
  const scene = new THREE.Scene(), system = new WorldTone(scene);
  scene.background = new THREE.Color().setRGB(1, 0, 0, THREE.SRGBColorSpace); const raw = scene.background.clone();
  const tone = { gray: 255, r: -25.5 };
  system.apply(tone); const first = scene.background.clone();
  const displayed = first.clone().convertLinearToSRGB(); close(displayed.r, 0.199, 2e-5); close(displayed.g, 0.299, 2e-5); close(displayed.b, 0.299, 2e-5);
  for (let i = 0; i < 10; i++) system.apply(tone);
  assert.ok(scene.background.equals(first), 'tone cannot accumulate every frame');
  system.apply({}); assert.ok(scene.background.equals(raw), 'zero tone restores exact original Color');
  system.apply(tone); scene.background = new THREE.Color(0x0000ff); const blue = scene.background.clone(); system.apply({});
  assert.ok(scene.background.equals(blue));
  scene.background.set(0x00ff00); const green = scene.background.clone(); system.apply(tone); system.apply({});
  assert.ok(scene.background.equals(green), 'Sky may mutate an existing Color');
  const picture = new THREE.Texture(); scene.background = picture; system.apply(tone); assert.equal(scene.background, picture);
  scene.background = null; system.apply({}); assert.equal(system.rawBackground, null);
});

function screenEnvironment(t) {
  const saved = { ...G }, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'), previousWorldTone = G.worldTone;
  t.after(() => { Object.assign(G, saved); G.worldTone = previousWorldTone;
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) } });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  Object.assign(G, { three: { scene, camera }, player: null, state: null, pictures: null, settings: {}, time: 0, worldTone: null });
  return { scene, screen: new ScreenFx(camera) };
}

test('real ScreenFx applies interpolated tone to the world once per render and disables legacy double-darkening in PC and VR', t => {
  const { scene, screen } = screenEnvironment(t), material = new THREE.MeshLambertMaterial(); scene.add(new THREE.Mesh(geometry(), material));
  const worldTone = G.worldTone = new WorldTone(scene);
  screen.startTone({ red: -102, green: 51, blue: 0, gray: 255 }, 3);
  for (const [expected, vr] of [[1 / 3, false], [2 / 3, true], [1, true]]) {
    G.vr = vr; screen.updateLogic(); screen.apply();
    close(worldTone.uniform.value.w, expected); close(worldTone.uniform.value.x, -0.4 * expected);
    assert.equal(screen.toneMul.visible, false); assert.equal(screen.toneAdd.visible, false);
    assert.equal(screen.fadeSphere.visible, false); assert.equal(screen.flashSphere.visible, false);
  }
  const value = worldTone.uniform.value.clone(); screen.apply(); screen.apply(); assert.ok(worldTone.uniform.value.equals(value));
  screen.startTone({ red: 0, green: 0, blue: 0, gray: 0 }, 0); screen.apply(); assert.deepEqual(worldTone.uniform.value.toArray(), [0, 0, 0, 0]);
  G.worldTone = null; screen.startTone({ red: -102, green: 51, blue: 0, gray: 0 }, 0); screen.apply();
  assert.equal(screen.toneMul.visible, true); assert.equal(screen.toneAdd.visible, true, 'legacy standalone fixtures retain the old fallback');
});
