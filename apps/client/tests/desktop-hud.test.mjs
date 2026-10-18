import test from 'node:test';
import assert from 'node:assert/strict';
import { paintDesktopHud } from '../src/ui/desktop-hud.js';
import { fitLabel, battlerEffects } from '../src/ui/battler-status.js';
import { $data } from '../src/data/data.js';

function panel(width = 512, height = 512) {
  const record = { texts: [], outlines: [], fills: [], strokes: [], icons: [], images: [], frames: [], commits: 0 };
  const textWidth = text => Array.from(String(text)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0) * (Number.parseFloat(ctx.font) || 24);
  const ctx = new Proxy({
    globalAlpha: 1,
    measureText: text => ({ width: textWidth(text) }),
    fillText(text, x, y) { record.texts.push({ text, x, y, width: textWidth(text), font: ctx.font, align: ctx.textAlign, color: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    strokeText(text, x, y) { record.outlines.push({ text, x, y, color: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha }); },
    drawImage(...args) { record.images.push(args); },
    fillRect(x, y, w, h) { record.fills.push({ x, y, w, h, color: ctx.fillStyle }); },
    strokeRect(x, y, w, h) { record.strokes.push({ x, y, w, h, color: ctx.strokeStyle }); },
    createLinearGradient() { return { stops: [], addColorStop(position, color) { this.stops.push([position, color]); } }; },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { canvas: { width, height }, ctx, record,
    clear() { record.texts = []; record.outlines = []; record.fills = []; record.strokes = []; record.icons = []; record.images = []; record.frames = []; },
    commit() { record.commits++; } };
}
function environment() {
  const hud = panel(), status = panel(512, 128);
  const recordOf = ctx => ctx === hud.ctx ? hud.record : status.record;
  const helpers = {
    FONT: 'GameFont', fitLabel, stripEscapes: text => String(text), textColor: index => `game-color-${index}`,
    tr: key => ({ '플레이어': 'Player', '스태미나': 'Stamina', '전체 효과: 메뉴 → 상태': 'All effects: Menu → Status' })[key] || key,
    windowBg: (ctx, ...args) => recordOf(ctx).frames.push(args),
    drawIcon: (ctx, ...args) => recordOf(ctx).icons.push(args),
  };
  return { hud, status, helpers, leader: { name: 'Grimm', level: 25, hp: 75, mhp: 100, mp: 20, mmp: 50 },
    stamina: 0.4, sen: 80, menuVar: { label: 'SEN', suffix: '%' }, currency: { amount: 4200, unit: 'Souls' }, effects: [] };
}
const gauges = panel => panel.record.fills.filter(rect => typeof rect.color === 'object');
const position = panel => panel.record.texts.map(({ text, x, y }) => ({ text, x, y }));

test('PC resources keep a fixed compact footprint and positions when effects change or overflow', () => {
  const options = environment();
  let result = paintDesktopHud(options), initial = position(options.hud), bars = gauges(options.hud);
  assert.equal(result.height, 256); assert.equal(result.statusVisible, false); assert.equal(result.statusHeight, 0);
  assert.deepEqual(bars.map(({ y, h }) => ({ y, h })), [{ y: 104, h: 16 }, { y: 154, h: 8 }, { y: 198, h: 8 }]);
  assert.equal(options.hud.record.texts.find(r => r.text === '75 / 100').y, 86);
  assert.equal(options.hud.record.texts.find(r => r.text === '20 / 50').y, 136);
  assert.equal(options.hud.record.texts.find(r => r.text === '40%').y, 180);
  assert.equal(options.hud.record.texts.find(r => r.text === '4,200 Souls').y, 230);
  options.effects = Array.from({ length: 8 }, (_, id) => ({ name: `Effect ${id}`, icon: 100 + id }));
  result = paintDesktopHud(options);
  assert.equal(result.height, 256); assert.equal(result.statusHeight, 128); assert.equal(result.statusVisible, true);
  assert.deepEqual(position(options.hud), initial, 'adding states cannot move or repack any resource text');
  assert.deepEqual(options.status.record.icons.map(([icon]) => icon), [100, 101, 102, 103], 'status strip uses the supplied game icon indices');
  assert.ok(options.status.record.texts.some(r => r.text.startsWith('+4 · All effects:')));
  options.effects = []; paintDesktopHud(options);
  assert.deepEqual(position(options.hud), initial); assert.equal(options.status.record.texts.length, 0);
});

test('highest-priority effects remain visible on repeated paints instead of cycling away', t => {
  const previous = $data.states; t.after(() => { $data.states = previous; });
  $data.states = Array.from({ length: 10 }, (_, id) => ({ id, name: id === 9 ? 'Poison' : `Effect ${id}`,
    icon_index: id + 700, priority: id === 9 ? 999 : 100 - id }));
  const options = environment(); options.effects = battlerEffects({ states: [2, 3, 4, 5, 6, 7, 8, 9], buffs: [] });
  const before = JSON.stringify(options.effects), seen = [];
  for (let i = 0; i < 4; i++) {
    paintDesktopHud(options); seen.push(options.status.record.texts.map(r => r.text));
    assert.ok(options.status.record.texts.some(r => r.text === 'Poison'));
    assert.equal(options.status.record.icons[0][0], 709);
  }
  assert.ok(seen.every(text => JSON.stringify(text) === JSON.stringify(seen[0])));
  assert.equal(JSON.stringify(options.effects), before, 'presentation cannot reorder or mutate authoritative effects');
});

test('critical HP uses a static game-palette cue and gauges handle zero, maximum and unavailable resources', () => {
  const options = environment();
  for (const [hp, maximum, stamina, critical, ratios] of [[0, 100, 0, true, [0, 0.4, 0]], [25, 100, 1, true, [0.25, 0.4, 1]],
    [26, 100, 2, false, [0.26, 0.4, 1]], [999, 0, -1, false, [0, 0.4, 0]]]) {
    Object.assign(options.leader, { hp, mhp: maximum }); options.stamina = stamina;
    const result = paintDesktopHud(options);
    assert.equal(result.critical, critical);
    assert.deepEqual(gauges(options.hud).map(bar => bar.w), ratios.map(r => 464 * r));
    const hpValue = options.hud.record.texts.find(r => r.y === 86 && r.align === 'right');
    assert.equal(hpValue.color, `game-color-${critical ? 18 : 0}`);
    assert.equal(options.hud.record.strokes.length, critical ? 1 : 0);
  }
  options.leader.mp = options.leader.mmp = 0; delete options.stamina;
  const result = paintDesktopHud(options);
  assert.equal(result.height, 256, 'missing stamina must not change resource anchoring');
  assert.equal(gauges(options.hud).length, 2); assert.equal(gauges(options.hud)[1].w, 0);
  assert.ok(!options.hud.record.texts.some(r => r.text === 'Stamina'));
});

test('long names, seven-digit values, currency and SEN retain legible non-overlapping space', () => {
  const options = environment();
  Object.assign(options.leader, { name: 'A very long character name that should remain secondary to combat', hp: 9999999, mhp: 9999999 });
  options.effects = [{ name: 'A long status effect name with its original game icon', icon: 77 }];
  paintDesktopHud(options);
  const texts = options.hud.record.texts, name = texts.find(r => r.y === 28 && r.align === 'left'), level = texts.find(r => r.text === 'Lv 25');
  assert.ok(name.text.endsWith('…')); assert.ok(name.x + name.width < level.x - level.width);
  const hp = texts.find(r => r.text === 'HP'), value = texts.find(r => r.text === '9,999,999 / 9,999,999');
  assert.ok(Number.parseFloat(value.font) >= 26); assert.ok(value.x - value.width > hp.x + hp.width);
  const gold = texts.find(r => r.text === '4,200 Souls'), sen = texts.find(r => r.text === 'SEN 80%');
  assert.ok(gold.x + gold.width < sen.x - sen.width);
  const effect = options.status.record.texts.find(r => r.y === 29);
  assert.ok(effect.text.endsWith('…')); assert.equal(Number.parseFloat(effect.font), 24, 'long effects are shortened instead of becoming tiny');
});

test('PC cards keep original artwork translucent while resource and effect labels remain fully opaque and outlined', () => {
  const options = environment(); options.effects = [{ name: 'Curse', icon: 87 }]; paintDesktopHud(options);
  assert.deepEqual(options.hud.record.frames.map(args => args.slice(0, 4)), [[2, 2, 508, 252]]);
  assert.deepEqual(options.status.record.frames.map(args => args.slice(0, 4)), [[2, 2, 508, 124]]);
  assert.deepEqual(gauges(options.hud).map(bar => bar.color.stops), [
    [[0, 'game-color-18'], [1, 'game-color-10']], [[0, 'game-color-9'], [1, 'game-color-1']], [[0, 'game-color-28'], [1, 'game-color-29']],
  ]);
  for (const card of [options.hud, options.status]) {
    const background = card.record.frames[0][4], frame = card.record.frames[0][5];
    const layers = card.record.fills.filter(rect => typeof rect.color === 'string' && rect.color.startsWith('rgba('));
    const alphas = layers.map(rect => Number(rect.color.match(/,([\d.]+)\)$/)[1]));
    // Window.png supplies both a stretched base and a tiled pattern. Counting
    // both conservatively prevents individually translucent layers going opaque.
    const combined = 1 - [background, background, ...alphas].reduce((remaining, alpha) => remaining * (1 - alpha), 1);
    assert.ok(combined < 0.4, `HUD background cumulative alpha ${combined} must leave most of the game visible`);
    assert.ok(frame > 0 && frame <= 0.4, 'the original frame must also be translucent');
    for (const label of card.record.texts) {
      assert.equal(label.alpha, 1, 'resource and state text must not inherit translucent background alpha');
      assert.ok(card.record.outlines.some(outline => outline.text === label.text && outline.x === label.x && outline.y === label.y
        && outline.alpha === 1 && outline.width >= 2 && outline.color === 'rgba(0,0,0,0.92)'), 'outlined labels stay readable over bright scenery');
    }
  }
  assert.deepEqual(options.status.record.icons, [[87, 20, 14, 30]]);
});

test('PC renderer uses translated labels and keeps all supported scripts within their cards', () => {
  for (const [player, stamina, footer] of [['플레이어', '스태미나', '전체 효과: 메뉴 → 상태'],
    ['Player', 'Stamina', 'All effects: Menu → Status'], ['プレイヤー', 'スタミナ', '全効果: メニュー → ステータス'],
    ['玩家', '耐力', '全部效果：菜单 → 状态']]) {
    const options = environment(); options.leader.name = '';
    options.helpers.tr = key => ({ '플레이어': player, '스태미나': stamina, '전체 효과: 메뉴 → 상태': footer })[key] || key;
    options.effects = [{ name: 'Poison', icon: 7 }]; paintDesktopHud(options);
    assert.ok(options.hud.record.texts.some(r => r.text === player)); assert.ok(options.hud.record.texts.some(r => r.text === stamina));
    for (const card of [options.hud, options.status]) for (const text of card.record.texts) {
      const left = text.align === 'right' ? text.x - text.width : text.x;
      assert.ok(left >= 18 && left + text.width <= card.canvas.width - 18, JSON.stringify(text));
      assert.ok(text.y > 0 && text.y < (card === options.hud ? 256 : 128));
    }
  }
});

test('PC battle header uses the actual selected eye strip while late or invalid portraits leave resources fixed', () => {
  const options = environment();
  Object.assign(options.leader, { faceName: 'ActorFace', faceIndex: 5 });
  paintDesktopHud(options);
  const resources = gauges(options.hud).map(({ x, y, w, h }) => ({ x, y, w, h }));
  assert.equal(options.hud.record.images.length, 0);
  assert.equal(options.hud.record.texts.find(r => r.text === 'Grimm').x, 24);
  options.faceCanvas = { width: 384, height: 192 };
  let result = paintDesktopHud(options);
  assert.equal(result.height, 256);
  assert.deepEqual(options.hud.record.images, [[options.faceCanvas, 96, 134, 96, 24, 24, 14, 144, 36]]);
  assert.equal(options.hud.record.texts.find(r => r.text === 'Grimm').x, 184);
  assert.deepEqual(gauges(options.hud).map(({ x, y, w, h }) => ({ x, y, w, h })), resources);
  options.leader.faceIndex = 7; paintDesktopHud(options);
  assert.equal(options.hud.record.images[0][1], 288); assert.equal(options.hud.record.images[0][2], 134);
  options.leader.faceIndex = 8; result = paintDesktopHud(options);
  assert.equal(options.hud.record.images.length, 0, 'a sheet without that face must not sample unrelated pixels');
  assert.equal(result.height, 256);
  options.leader.faceIndex = 0; options.leader.faceName = ''; paintDesktopHud(options);
  assert.equal(options.hud.record.images.length, 0, 'a blank live face name must not borrow a cached portrait');
});
