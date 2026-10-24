import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegularWindow } from '../src/data/regular-window.js';
import { readScripts } from '../src/data/scriptdata.js';
import { dungeonStatus, DungeonStatus } from '../src/ui/dungeon-status.js';
import { GameState } from '../src/game/state.js';
import { Interpreter } from '../src/game/interpreter.js';
import { G } from '../src/core/globals.js';
import { fitLabel } from '../src/ui/battler-status.js';

// Neutral settings exercise the original configuration grammar without copying
// installed script bodies, map IDs, dungeon counters or translated labels.
const source = (extra = '') => `module W_REGULAR
  M_W_X = {}
  M_W_Y = {}
  B_W_X = {}
  B_W_Y = {}
  WIDTH = {}
  HEIGHT = {}
  FSIZE = {}
  ITEM = {}
  M_USE = true
  M_SID = 41
  B_USE = false
  B_SID = 42
  VID = 7
  M_W_X[0] = 450
  M_W_Y[0] = 6
  B_W_X[0] = 300
  B_W_Y[0] = 10
  WIDTH[0] = 180
  HEIGHT[0] = 56
  FSIZE[0] = 24
  ITEM[0] = [
    {:icon_id => 0, :name => 'Stage:', :afterword => '', :variable_id => 88,
     :switch_id => 53, :x => 0, :y => 0, :width => 150, :name_c => 16},
  ]
  ${extra}
end`;
function state() {
  const result = new GameState();
  result.switches[41] = true; result.switches[53] = true;
  result.variables[7] = 0; result.variables[88] = 12;
  return result;
}
function parse(t, entries) {
  t.mock.method(console, 'warn', () => {});
  return readScripts([entries].flat().map(text => ['Localized settings', text])).regularWindow;
}

test('the installed module supplies the exact label, counters, item switch and original presentation metadata', t => {
  const config = parse(t, source());
  assert.deepEqual(config.map, { enabled: true, switchId: 41 });
  assert.deepEqual(config.battle, { enabled: false, switchId: 42 });
  assert.equal(config.typeVariable, 7);
  assert.deepEqual(config.items[0][0], { variable: 88, switchId: 53, label: 'Stage:', suffix: '',
    icon: 0, color: 16, noValue: false, x: 0, y: 0, width: 150, fontSize: null });
  assert.deepEqual(config.layout, { mapX: { 0: 450 }, mapY: { 0: 6 }, battleX: { 0: 300 }, battleY: { 0: 10 },
    width: { 0: 180 }, height: { 0: 56 }, fontSize: { 0: 24 } });
  const current = state(), before = JSON.stringify(current.toJSON());
  assert.equal(dungeonStatus(config, current).text, 'Stage: 12');
  assert.equal(JSON.stringify(current.toJSON()), before, 'a read-only display cannot advance or infer progress');
});

test('native map and per-item switches, scene use flags and selector changes control visibility', () => {
  const config = readRegularWindow(source()), current = state();
  assert.equal(dungeonStatus(config, current, { scene: 'battle' }), null);
  current.switches[41] = false;
  assert.equal(dungeonStatus(config, current), null);
  current.switches[41] = true; current.switches[53] = false;
  assert.equal(dungeonStatus(config, current), null);
  current.switches[53] = true; current.variables[7] = 1;
  assert.equal(dungeonStatus(config, current), null, 'an unconfigured type must not reuse the previous floor');
  current.variables[7] = 0;
  assert.equal(dungeonStatus(config, current).text, 'Stage: 12');
  assert.equal(dungeonStatus(config, current, { scene: 'menu' }), null);
  assert.equal(dungeonStatus(null, current), null);
  config.battle.enabled = true; current.switches[42] = true;
  assert.equal(dungeonStatus(config, current, { scene: 'battle' }).text, 'Stage: 12');
});

test('localized Unicode labels, literal hash signs, suffixes, icons and hidden values remain source data', () => {
  const config = readRegularWindow(source(`ITEM[1] = [
    {:name => "階層 #:", :afterword => ' 層', :variable_id => 89, :icon_id => 25, :name_c => 6, :y => 0},
    {:name => "L'étape", :variable_id => 90, :no_value => true, :font_size => 20, :y => 24},
  ]`)), current = state();
  current.variables[7] = 1; current.variables[89] = 0; current.variables[90] = 999;
  assert.equal(dungeonStatus(config, current).text, "階層 #: 0 層 · L'étape");
  assert.equal(dungeonStatus(config, current).rows[0].icon, 25);
  current.variables[89] = 10001;
  assert.equal(dungeonStatus(config, current).rows[0].value, '10001 層', 'do not offset, clamp or reset a saved floor');
});

test('comments, unrelated modules and runtime expressions cannot supply or override the counter', t => {
  assert.equal(parse(t, `# ${source().replaceAll('\n', '\n# ')}\n=begin\n${source()}\n=end`), null);
  assert.equal(parse(t, source().replace('W_REGULAR', 'W_REGULAR_OTHER')), null);
  assert.equal(parse(t, [source(), source('M_SID = runtime_switch()')]), null);
  assert.equal(parse(t, [source(), source('if enabled?\nM_SID = 999\nend')]), null);
  assert.equal(parse(t, [source(), source('ITEM[0] = build_rows()')]), null);
  assert.equal(parse(t, source('ITEM[0] = [{:name => "#{runtime_label}", :variable_id => 1, :y => 0}]')), null);
  assert.equal(parse(t, source('M_SID = 54 # M_SID = 999')).map.switchId, 54);
  assert.equal(parse(t, [source(), source('M_SID = 55')]).map.switchId, 55);
});

for (const extra of ['M_USE = 1', 'VID = -1', 'M_SID = 1.5', 'ITEM[0] = {}',
  'ITEM[0] = [{:variable_id => 4, :y => 0, :switch_id => -1}]',
  'ITEM[0] = [{:variable_id => 4, :y => 0, :gauge_max => 100}]',
  'ITEM[0] = [{:variable_id => 4, :name => command(), :y => 0}]']) {
  test(`unsupported regular-window setting fails closed: ${extra}`, () => {
    assert.equal(readRegularWindow(source(extra)), null);
  });
}

test('real interpreter variable/switch operations refresh the displayed floor and hide it on exit', t => {
  const previous = { state: G.state, map: G.map, coop: G.coop };
  t.after(() => Object.assign(G, previous));
  G.state = state(); G.map = { requestRefresh() {} }; G.coop = null;
  const config = readRegularWindow(source()), interpreter = new Interpreter();
  const original = dungeonStatus(config, G.state);
  interpreter.params = [88, 88, 1, 0, 1]; interpreter.c122();
  const advanced = dungeonStatus(config, G.state);
  assert.equal(advanced.text, 'Stage: 13'); assert.notEqual(advanced.key, original.key);
  interpreter.params = [41, 41, 1]; interpreter.c121();
  assert.equal(dungeonStatus(config, G.state), null);
  interpreter.params = [41, 41, 0]; interpreter.c121();
  assert.equal(dungeonStatus(config, G.state).text, 'Stage: 13', 'resuming uses the saved native progress');
});

class RecordingPanel {
  constructor(width, height, widthM) {
    this.canvas = { width, height }; this.widthM = widthM; this.mesh = { visible: false }; this.commits = 0;
    this.texts = []; this.icons = []; this.frames = [];
    this.ctx = { save() {}, restore() {}, measureText: text => ({ width: Array.from(String(text)).length * 17 }),
      strokeText() {}, fillText: (text, x, y) => this.texts.push({ text, x, y, color: this.ctx.fillStyle, align: this.ctx.textAlign }) };
  }
  resize(width, height) { this.canvas.width = width; this.canvas.height = height; }
  clear() { this.texts = []; this.icons = []; this.frames = []; }
  commit() { this.commits++; }
}
function display() {
  const frames = [], icons = [];
  const result = new DungeonStatus(RecordingPanel, { font: 'GameFont', fitLabel, textColor: n => `game-${n}`,
    windowBg: (...args) => frames.push(args), drawIcon: (...args) => icons.push(args) });
  return { result, frames, icons };
}

test('standalone display reuses native colors/frame and caches until counter, visibility or assets change', () => {
  const config = readRegularWindow(source()), current = state(), { result, frames } = display();
  result.update(config, current);
  assert.equal(result.mesh.visible, true); assert.equal(result.panel.canvas.height, 80);
  assert.deepEqual(result.panel.texts, [
    { text: 'Stage:', x: 24, y: 40, color: 'game-16', align: 'left' },
    { text: '12', x: 488, y: 40, color: 'game-0', align: 'right' },
  ]);
  assert.deepEqual(frames[0].slice(1), [0, 0, 512, 80, 0.15, 0.4]);
  result.update(config, current); assert.equal(result.panel.commits, 1);
  result.update(config, current, { visible: false }); assert.equal(result.mesh.visible, false);
  result.update(config, current); assert.equal(result.mesh.visible, true); assert.equal(result.panel.commits, 1);
  current.variables[88] = 13; result.update(config, current); assert.equal(result.panel.commits, 2);
  result.update(config, current, { assetRevision: 1 }); assert.equal(result.panel.commits, 3);
  current.switches[41] = false; result.update(config, current); assert.equal(result.mesh.visible, false);
  result.hide(); assert.equal(result.mesh.visible, false);
});

test('several configured rows keep icons and values inside the adaptive panel without altering progress', () => {
  const config = readRegularWindow(source(`ITEM[0] = [
    {:name => 'A long localized stage label', :variable_id => 88, :icon_id => 31, :y => 0},
    {:name => 'Marker:', :variable_id => 89, :no_value => true, :y => 24},
  ]`)), current = state(), { result, icons } = display();
  current.variables[88] = 1234567;
  result.update(config, current);
  assert.equal(result.panel.canvas.height, 136); assert.equal(result.panel.widthM, 0.22);
  assert.deepEqual(icons[0].slice(1), [31, 22, 24, 32]);
  assert.ok(result.panel.texts.every(({ x, y }) => x > 0 && x < 512 && y > 0 && y < 136));
  assert.ok(result.panel.texts.some(({ text }) => text === '1234567'));
  assert.equal(current.v(88), 1234567);
});
