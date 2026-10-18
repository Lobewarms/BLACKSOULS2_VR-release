import test from 'node:test';
import assert from 'node:assert/strict';
import { paintClassicMenu } from '../src/ui/classic-menu.js';
import { fitLabel } from '../src/ui/battler-status.js';

function panel(width, height = 960) {
  const record = { texts: [], outlines: [], images: [], icons: [], fills: [], frames: [], cursors: [], clears: 0, commits: 0 };
  const measure = text => Array.from(String(text)).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0) * (Number.parseFloat(ctx.font) || 30);
  const ctx = new Proxy({
    globalAlpha: 1,
    measureText: text => ({ width: measure(text) }),
    fillText(text, x, y) { record.texts.push({ text, x, y, width: measure(text), align: ctx.textAlign, font: ctx.font, alpha: ctx.globalAlpha }); },
    strokeText(text, x, y) { record.outlines.push({ text, x, y, color: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha }); },
    drawImage(...args) { record.images.push(args); },
    fillRect(x, y, w, h) { record.fills.push({ x, y, w, h, color: ctx.fillStyle }); },
    createLinearGradient() { return { stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } }; },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  return { canvas: { width, height }, ctx, record,
    clear() { record.texts = []; record.outlines = []; record.images = []; record.icons = []; record.fills = []; record.frames = []; record.cursors = []; record.clears++; },
    commit() { record.commits++; } };
}
function options() {
  const overview = panel(960), commandPanel = panel(320), leader = { name: 'Grimm', level: 20, classId: 2,
    hp: 75, mhp: 100, mp: 20, mmp: 50, faceName: 'ActorFace', faceIndex: 5, equips: [{ kind: 'weapon', id: 1 }] };
  const record = ctx => ctx === overview.ctx ? overview.record : commandPanel.record;
  return { overview, commandPanel, leader, gold: 4500, sen: 80, menuVar: { label: 'SEN', suffix: '%' }, currencyUnit: 'Souls',
    effects: [{ name: 'Poison', icon: 702 }, { name: 'Curse', icon: 703 }], faceCanvas: { width: 384, height: 192 },
    helpers: { FONT: 'GameFont', fitLabel, stripEscapes: text => String(text), textColor: n => `game-${n}`,
      tr: key => ({ '플레이어': 'Player', '상태 보기': 'Status', '장비': 'Equipment', '모드 도구': 'Mod tools' })[key] || key,
      classes: [null, null, { name: 'Hunter' }], windowBg: (ctx, ...args) => record(ctx).frames.push(args),
      drawIcon: (ctx, ...args) => record(ctx).icons.push(args), drawGameCursor: (ctx, ...args) => record(ctx).cursors.push(args) } };
}

test('classic overview uses the selected original face cell and keeps actor information beside it', () => {
  const o = options(), before = JSON.stringify(o.leader), result = paintClassicMenu(o);
  assert.equal(result.membersDrawn, 1);
  assert.deepEqual(o.overview.record.images, [[o.faceCanvas, 96, 96, 96, 96, 32, 32, 176, 176]]);
  const texts = o.overview.record.texts;
  assert.ok(texts.some(r => r.text === 'Grimm' && r.x === 240 && r.y === 48));
  assert.ok(texts.some(r => r.text === 'Hunter' && r.align === 'right' && r.x === 928));
  assert.ok(texts.some(r => r.text === 'Lv 20' && r.y === 94));
  assert.ok(texts.some(r => r.text === '75 / 100' && r.y === 102));
  assert.ok(texts.some(r => r.text === '20 / 50' && r.y === 154));
  assert.deepEqual(o.overview.record.fills.filter(r => typeof r.color === 'object').map(r => r.color.stops),
    [[[0, 'game-18'], [1, 'game-10']], [[0, 'game-9'], [1, 'game-1']]], 'HP and MP retain the verified original battle palette');
  assert.deepEqual(o.overview.record.icons, [[702, 240, 124, 28], [703, 414, 124, 28]]);
  assert.ok(!texts.some(r => r.text === 'Equipment'), 'the exact party layout adds no unsolicited equipment block');
  assert.equal(JSON.stringify(o.leader), before);
});

test('left SEN and currency summaries append below the original commands without clearing selection', () => {
  const o = options(), c = o.commandPanel.ctx;
  for (const [i, command] of ['Items', 'Skills', 'Equip', 'Status', 'Covenants', 'Save', 'Game end'].entries()) c.fillText(command, 40, 130 + i * 64);
  const original = [...o.commandPanel.record.texts];
  const result = paintClassicMenu(o);
  assert.equal(o.commandPanel.record.clears, 0);
  assert.deepEqual(o.commandPanel.record.texts.slice(0, 7), original);
  assert.equal(result.summaryTop, 730);
  assert.deepEqual(o.commandPanel.record.frames.map(([x, y, w, h]) => ({ x, y, w, h })),
    [{ x: 4, y: 730, w: 312, h: 94 }, { x: 4, y: 850, w: 312, h: 86 }]);
  assert.ok(o.commandPanel.record.texts.some(r => r.text === '80%' && r.y === 792));
  assert.ok(o.commandPanel.record.texts.some(r => r.text === '4,500' && r.y === 907));
  o.commandPanel.clear(); o.sen = null;
  paintClassicMenu(o); assert.ok(!o.commandPanel.record.texts.some(r => r.text === 'SEN'));
  assert.equal(o.commandPanel.record.frames.length, 1);
});

test('only real members get party rows and missing artwork never creates a fake portrait', () => {
  const o = options(); o.faceCanvas = null;
  paintClassicMenu(o);
  assert.equal(o.overview.record.images.length, 0); assert.equal(o.overview.record.texts.filter(r => r.text === 'HP').length, 1);
  const other = { ...o.leader, name: 'Alice', faceName: 'OtherFace', faceIndex: 2 };
  o.members = [o.leader, other]; o.faceCanvas = new Map([['ActorFace', { width: 384, height: 192 }], ['OtherFace', { width: 384, height: 192 }]]);
  const result = paintClassicMenu(o);
  assert.equal(result.membersDrawn, 2);
  assert.deepEqual(o.overview.record.images.map(args => args.slice(1)),
    [[96, 96, 96, 96, 32, 32, 176, 176], [192, 0, 96, 96, 32, 272, 176, 176]]);
  assert.ok(o.overview.record.texts.some(r => r.text === 'Alice' && r.y === 288));
});

test('long original names and large resources fit their assigned columns', () => {
  const o = options(); o.leader.name = 'A very long translated character name that must not cover the class';
  o.helpers.classes[2].name = 'A very long translated character class title';
  o.leader.hp = o.leader.mhp = 9999999; o.gold = 9999999; o.effects = [{ name: 'A long original status effect name', icon: 702 }];
  paintClassicMenu(o);
  assert.ok(o.overview.record.texts.find(r => r.y === 48 && r.align === 'left').text.endsWith('…'));
  const hp = o.overview.record.texts.find(r => r.text === '9,999,999 / 9,999,999');
  assert.ok(Number.parseFloat(hp.font) >= 16);
  for (const p of [o.overview, o.commandPanel]) for (const t of p.record.texts) {
    const left = t.align === 'right' ? t.x - t.width : t.align === 'center' ? t.x - t.width / 2 : t.x;
    assert.ok(left >= 18 && left + t.width <= p.canvas.width - 18, JSON.stringify(t));
    assert.ok(t.y >= 0 && t.y < p.canvas.height);
  }
});

test('optional equipment and the separate Mod tools button use original game art helpers', () => {
  const o = options(), weapon = { name: 'Hunter pistol', icon_index: 1902 };
  o.helpers.itemData = (kind, id) => kind === 'weapon' && id === 1 ? weapon : null;
  let result = paintClassicMenu(o);
  assert.ok(o.overview.record.icons.some(([icon, x, y, size]) => icon === 1902 && x === 32 && y === 348 && size === 36));
  assert.ok(o.overview.record.texts.some(r => r.text === 'Hunter pistol'));
  assert.deepEqual(result.toolBounds, { x: 640, y: 860, width: 280, height: 60 });
  assert.ok(o.overview.record.cursors.some(args => JSON.stringify(args) === JSON.stringify([644, 864, 272, 52])));
  assert.ok(o.overview.record.texts.some(r => r.text === 'F1 · Mod tools' && r.y === 890));
  o.helpers.vr = true; result = paintClassicMenu(o);
  assert.ok(o.overview.record.texts.some(r => r.text === 'Mod tools' && r.y === 890));
});

test('classic menu background layers retain scene visibility while actor and economy labels stay opaque and outlined', () => {
  const o = options(); paintClassicMenu(o);
  for (const p of [o.overview, o.commandPanel]) {
    const first = p.record.frames[0], largeFills = p.record.fills.filter(rect => typeof rect.color === 'string' && rect.color.startsWith('rgba(')).slice(0, 2);
    const alphas = largeFills.map(rect => Number(rect.color.match(/,([\d.]+)\)$/)[1]));
    const combined = 1 - [first[4], first[4], ...alphas].reduce((remaining, alpha) => remaining * (1 - alpha), 1);
    assert.ok(combined < 0.8, 'two original window layers and contrast fills must retain a visible game behind the menu');
    assert.ok(first[5] > 0 && first[5] <= 0.7);
    for (const label of p.record.texts) {
      assert.equal(label.alpha, 1);
      assert.ok(p.record.outlines.some(outline => outline.text === label.text && outline.x === label.x && outline.y === label.y
        && outline.alpha === 1 && outline.width >= 2 && outline.color === 'rgba(0,0,0,0.92)'));
    }
  }
});
