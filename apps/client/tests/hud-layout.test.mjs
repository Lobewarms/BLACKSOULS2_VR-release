import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { spawnSync } from 'node:child_process';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { UI, textColor } = await import('../src/ui/ui.js');
const { $data } = await import('../src/data/data.js');

function canvas() {
  const record = { texts: [], fills: [], gradients: [], clears: 0 };
  const width = text => Array.from(String(text)).length * (Number.parseFloat(ctx.font) || 28) * 0.55;
  const ctx = new Proxy({
    clearRect() { record.texts = []; record.fills = []; record.gradients = []; record.clears++; },
    fillText(text, x, y) { record.texts.push({ text, x, y, font: ctx.font, align: ctx.textAlign, width: width(text) }); },
    measureText: text => ({ width: width(text) }),
    fillRect(x, y, w, h) { record.fills.push({ x, y, w, h, color: ctx.fillStyle }); },
    createLinearGradient(...coords) {
      const gradient = { coords, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } };
      record.gradients.push(gradient); return gradient;
    },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { width: 0, height: 0, record, getContext: () => ctx };
}
function environment(t) {
  const saved = { ...G }, data = { states: $data.states, system: $data.system };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    Object.assign(G, saved); Object.assign($data, data);
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
  const actor = { name: 'Grimm', level: 12, hp: 75, mhp: 100, mp: 30, mmp: 50, states: [], buffs: Array(8).fill(0) };
  $data.system = { currency_unit: 'Souls', terms: { basic: ['Level', 'Lv', 'Health', 'HP', 'Magic', 'MP'] } };
  $data.states = Array.from({ length: 10 }, (_, id) => ({ id, name: `Effect ${id}`, priority: 100 - id, icon_index: 0 }));
  G.state = { party: { leader: () => actor, gold: 4200 }, sw: () => true, v: () => 80 };
  G.scripts = { menuVar: { label: 'SEN', suffix: '%', variable: 1 } }; G.vr = false; G.combat = { stamina: 0.4 };
  G.input = { controllers: {}, dom: { getBoundingClientRect: () => ({ width: 1280, height: 720 }) } };
  G.arena = null; G.time = 0;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
  scene.add(camera); camera.position.y = 1.6;
  const ui = new UI(scene, camera, new THREE.Group()); G.ui = ui; ui.attachHud(null);
  return { ui, actor };
}
const labels = ui => ui.hud.canvas.record.texts;
const gauges = ui => ui.hud.canvas.record.fills.filter(r => typeof r.color === 'object');

test('HUD resources have directly associated values and original game-palette gauges, with separate currency and SEN', t => {
  const { ui } = environment(t); ui.drawHud();
  const texts = labels(ui), bars = gauges(ui);
  assert.ok(texts.some(r => r.text === 'Grimm')); assert.ok(texts.some(r => r.text === 'Lv 12'));
  for (const [i, name, value, ratio, colors] of [[0, 'HP', '75 / 100', 0.75, [20, 21]],
    [1, 'MP', '30 / 50', 0.6, [22, 23]], [2, 'Stamina', '40%', 0.4, [28, 29]]]) {
    const label = texts.find(r => r.text === name), amount = texts.find(r => r.text === value), bar = bars[i];
    assert.equal(label.y, amount.y); assert.equal(amount.align, 'right');
    assert.equal(bar.y, label.y + 20); assert.equal(bar.w, 464 * ratio);
    assert.deepEqual(bar.color.stops, [[0, textColor(colors[0])], [1, textColor(colors[1])]]);
  }
  const currency = texts.find(r => r.text === '4,200 Souls'), sen = texts.find(r => r.text === 'SEN 80%');
  assert.equal(currency.y, sen.y); assert.ok(currency.y > bars.at(-1).y + bars.at(-1).h + 10);
  assert.ok(currency.x + currency.width < sen.x - sen.width, 'currency and SEN must have separate horizontal space');
  assert.equal(ui.hudPaintHeight, 262); assert.ok(ui.hudPaintHeight < ui.hud.canvas.height);
  assert.ok(!texts.some(r => r.text === 'Status effects'), 'no empty effects panel is drawn');
});

test('zero, unavailable and over-cap resources never draw invalid or overflowing gauges', t => {
  const { ui, actor } = environment(t);
  for (const [hp, mhp, mp, mmp, stamina, expected] of [[0, 100, 0, 50, 0, [0, 0, 0]],
    [100, 100, 50, 50, 1, [1, 1, 1]], [999, 0, 99, 0, 2, [0, 0, 1]], [-5, 100, -1, 50, -0.5, [0, 0, 0]]]) {
    Object.assign(actor, { hp, mhp, mp, mmp }); G.combat.stamina = stamina; ui.drawHud();
    assert.deepEqual(gauges(ui).map(bar => bar.w), expected.map(ratio => ratio * 464));
    assert.ok(gauges(ui).every(bar => Number.isFinite(bar.w) && bar.w >= 0 && bar.w <= 464));
  }
  delete G.combat.stamina; ui.drawHud();
  assert.equal(gauges(ui).length, 2); assert.ok(!labels(ui).some(r => r.text === 'Stamina'));
  assert.equal(ui.hudPaintHeight, 210, 'missing stamina does not leave a blank resource row');
});

test('long player names and seven-digit HP values fit independently, and renaming or levelling invalidates the HUD cache', t => {
  const { ui, actor } = environment(t);
  actor.name = 'A very long player name that should never cover the current level'; actor.hp = actor.mhp = 9999999;
  ui.drawHud();
  const texts = labels(ui), header = texts.find(r => r.y === 30 && r.align === 'left'), level = texts.find(r => r.text === 'Lv 12');
  assert.ok(header.text.endsWith('…')); assert.ok(header.x + header.width < level.x - level.width);
  const hp = texts.find(r => r.text === 'HP'), amount = texts.find(r => r.text === '9,999,999 / 9,999,999');
  assert.ok(amount.x - amount.width > hp.x + hp.width + 10, 'large values must not overlap the resource label');
  assert.ok(Number.parseFloat(amount.font) >= 22, 'seven-digit values remain readable');
  let clears = ui.hud.canvas.record.clears; ui.drawHud(); assert.equal(ui.hud.canvas.record.clears, clears);
  actor.name = 'Alice'; ui.drawHud(); assert.equal(ui.hud.canvas.record.clears, ++clears); assert.ok(labels(ui).some(r => r.text === 'Alice'));
  actor.level = 13; ui.drawHud(); assert.equal(ui.hud.canvas.record.clears, ++clears); assert.ok(labels(ui).some(r => r.text === 'Lv 13'));
});

test('all effect pages remain named, counted and accessible while empty effects use a compact HUD', t => {
  const { ui, actor } = environment(t); ui.drawHud(); const compactHeight = ui.hudPaintHeight;
  actor.states = [2, 3, 4, 5, 6, 7, 8, 9]; const seen = new Set();
  for (const time of [0, 4]) {
    G.time = time; ui.drawHud(); labels(ui).forEach(r => seen.add(r.text));
    assert.ok(labels(ui).some(r => r.text === `${time / 4 + 1}/2`));
    assert.ok(labels(ui).some(r => r.text === 'All effects: Menu → Character → Status'));
    assert.ok(ui.hudPaintHeight <= ui.hud.canvas.height);
    assert.ok(labels(ui).every(r => r.y >= 0 && r.y < ui.hudPaintHeight));
  }
  assert.ok(actor.states.every(id => seen.has(`Effect ${id}`)));
  assert.ok(ui.hudPaintHeight > compactHeight);
  actor.states = []; ui.drawHud(); assert.equal(ui.hudPaintHeight, compactHeight);
  assert.ok(!labels(ui).some(r => r.text.startsWith('Effect ')), 'cleared states cannot leave stale rows behind');
});

test('larger VR HUD leaves a physical gap below the wrist minimap and PC anchors its painted bottom', t => {
  const { ui } = environment(t); ui.drawHud(); ui.placeRoot();
  ui.hud.mesh.updateWorldMatrix(true, false);
  const y = ui.hud.heightM / 2 - ui.hud.heightM * ui.hudPaintHeight / ui.hud.canvas.height;
  const p = ui.hud.mesh.localToWorld(new THREE.Vector3(0, y, 0)).project(ui.camera);
  assert.ok(Math.abs((1 - p.y) * 360 - 700) < 0.1);
  G.vr = true; ui.attachHud(new THREE.Group()); ui.drawHud();
  const miniBottom = ui.navigation.mini.mesh.position.y - ui.navigation.mini.heightM / 2;
  assert.ok(Math.abs(miniBottom - ui.hud.heightM / 2 - 0.02) < 1e-8);
  assert.equal(ui.hud.widthM, 0.24); assert.deepEqual(ui.hud.mesh.scale.toArray(), [1, 1, 1]);
});

test('new HUD text is translated in every supported language', () => {
  const url = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const [lang, stamina] of [['ko', '스태미나'], ['en', 'Stamina'], ['ja', 'スタミナ'], ['zh', '耐力']]) {
    const code = `globalThis.location={search:'?lang=${lang}'};const {tr}=await import(${JSON.stringify(url)});console.log(JSON.stringify([tr('스태미나'),tr('플레이어'),tr('전체 효과: 메뉴 → 캐릭터 → 상태')]));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const strings = JSON.parse(result.stdout); assert.equal(strings[0], stamina); assert.ok(strings.every(text => text.length));
    if (lang !== 'ko') assert.ok(!strings.some(text => /[가-힣]/.test(text)));
  }
});
