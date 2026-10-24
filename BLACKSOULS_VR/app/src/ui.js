// VR-friendly UI: message window (RPG Maker escape codes), choices, number input, HUD,
// notifications, pause menu, shop, bonfire warp.
import * as THREE from 'three';
import { G } from './globals.js';
import { tr, lang as uiLang } from './i18n.js';
import { $data, mapName } from './data.js';
import { loadCanvas } from './assets.js';
import { itemData, spiritActorId, BAG_MAX } from './state.js';
import { quickSlots, quickSlotOf, assignQuickSlot, entryStatus } from './quickslots.js';
import { cleanName, NAME_LEN } from './coopnet.js';
import { bonfireShown, bonfirePickable } from './scriptdata.js';
import { setWindowSkin, drawWindow, drawCursor, drawText, drawGauge, drawFace, drawPause, drawArrows, cursorBlink, fittingHeight, fontSize, LINE, PAD } from './rmwindow.js';
import { minimapPlace, MINIMAP_ZOOMS } from './minimap.js';
import { cleanChat, clipChatText } from './coopchat.js';
import { Hangul, KO_KEYS, KO_SHIFT } from './hangul.js';
import { FONT, NAME_FONT, fontLook, gameFont } from './fonts.js';
import { voiceCode, voiceMarksReady, voiceMarksSize, drawVoiceMarks } from './voicemarks.js';

export { FONT };              // (the game's font list - fonts.js; the others take it from here)
const BOSS_ASK = 20;          // s a co-op player has to answer whether it joins a boss fight (askBossJoin)
const WORLD_PORT = 28472;     // a community server's port unless its owner changed it (world_server.py)
const VOICE_LABEL = () => ({ off: tr('끔'), listen: tr('듣기만'), talk: tr('말하기와 듣기') });
// (co-op) the voice chat marks beside the status window: their canvas (px, at the window's scale), each picture's size
const VOICE_BADGE = [64, 112], VOICE_PIC = 72;
// the status panel: its window's width (original pixels), the states' icons on its row; how big it is - in metres (VR,
// over the left hand) and, on PC (in the bottom left corner), as a share of the screen's height - for each of those pixels
const HUD_W = 320, HUD_ICONS = 12, HUD_M = 0.17 / 256, DESK_HUD = 0.35 / 256;
// (the compose shop - scriptdata.js composeShop) what a good takes besides its price, from its note's <合成設定:kind,id,n>
// lines, as the script reads them (a count left out: 1; a kind other than 0-2 or a thing that is not there: left out)
function composeMats(d, word) {
  const out = [], re = new RegExp(`${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[:：](\\d+),(\\S+)`);
  for (const line of String(d?.note || '').split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const a = [+m[1], ...m[2].split(/\s*,\s*/).map(s => parseInt(s, 10) || 0)];
    const kind = ['item', 'weapon', 'armor'][a[0]];
    if (!kind || !itemData(kind, a[1])) continue;
    const n = a.length > 2 ? a[2] : 1, had = out.find(x => x.kind === kind && x.id === a[1]);
    if (had) had.n = n; else out.push({ kind, id: a[1], n });
  }
  return out;
}
// a long name cut to fit its row (… at its end)
const clipText = (t, max) => { const a = [...String(t || '')]; return a.length > max ? a.slice(0, max - 1).join('') + '…' : a.join(''); };
// where the map shows (설정 → 지도): in VR over the right hand (as it starts), else a corner of the view
const minimapWhere = () => (G.vr && minimapPlace().hand ? tr('지금 있는 곳 둘레의 지도를 오른손 위에 띄웁니다') : tr('지금 있는 곳 둘레의 지도를 화면 구석에 띄웁니다'));
// the rows of the settings menu (showSettingsMenu): coming back from one of them goes back there, not to the menu
const SETTING_IDS = ['minimap', 'turn', 'diff', 'options', 'adjust', 'spectator'];
// 하늘 색's list (the first: the original's black - sky.js FOG)
const SKY_COLORS = ['#030305', '#0b1430', '#2a2140', '#5a6470', '#7fa8d8', '#b0705a', '#9aa0a6'];
const skyColorName = hex => {
  const i = SKY_COLORS.indexOf((hex || SKY_COLORS[0]).toLowerCase());
  return i < 0 ? tr('직접 설정') : [tr('검정 (원작)'), tr('밤하늘'), tr('어스름'), tr('흐린 하늘'), tr('맑은 하늘'), tr('노을'), tr('안개')][i];
};
const DEFAULT_COLORS = ['#ffffff', '#20a0d6', '#ff784c', '#66cc40', '#99ccff', '#ccc0ff', '#ffffa0', '#808080',
  '#c0c0c0', '#2080cc', '#ff3810', '#00a010', '#3e9ade', '#a098ff', '#ffcc20', '#000000',
  '#84aaff', '#ffff40', '#ff2020', '#202040', '#e08040', '#f0c040', '#4080c0', '#40c0f0',
  '#80ff80', '#c08080', '#8080ff', '#ff80ff', '#00a040', '#00e060', '#a060e0', '#c080ff'];

// ------------------------------------------------------------------ panels
class Panel {
  constructor(wPx, hPx, widthM, { depthTest = false } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = wPx; this.canvas.height = hPx;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.widthM = widthM;
    this.heightM = widthM * hPx / wPx;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.widthM, this.heightM),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest, depthWrite: false, toneMapped: false }));
    // over the screen's tone, flash and fade (src/screen.js), as the original's windows are: what is said on a
    // black screen - 그랑・기뇰's 포기 않는다 - is read on it
    this.mesh.renderOrder = 3100;
    this.mesh.visible = false;
    this.shown = [wPx, hPx];
  }
  // only the canvas's top left w x h shown (a window drawn to its own size): the plane cut down to it
  fit(w = this.canvas.width, h = this.canvas.height) {
    const fx = w / this.canvas.width, fy = h / this.canvas.height;
    this.shown = [w, h];
    this.mesh.scale.set(fx, fy, 1);
    this.tex.repeat.set(fx, fy);
    this.tex.offset.set(0, 1 - fy);
  }
  commit() { this.tex.needsUpdate = true; }
  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  // uv hit from a ray (VR pointer)
  hit(raycaster) {
    if (!this.mesh.visible) return null;
    const h = raycaster.intersectObject(this.mesh, false)[0];
    return h ? h.uv : null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// a menu's text as the original's windows write it: over a thin dark outline (fillStyle and font as set); a row that
// cannot be picked at the original's translucent alpha (160)
const DIM = 'rgba(255,255,255,0.63)';
function outlined(ctx, text, x, y) {
  if (fontLook.outline) {
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = fontLook.outColor;
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}
// the message window's dim background (Window_Message's back sprite): black at 160, fading out over 12 pixels at its
// top and its foot
function dimBack(ctx, s, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h * s), a = 160 / 255, f = 12 / h;
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f, `rgba(0,0,0,${a})`);
  g.addColorStop(1 - f, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w * s, h * s);
}
function windowBg(ctx, x, y, w, h, alpha = 0.82) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(18,16,22,${alpha})`); g.addColorStop(1, `rgba(6,5,8,${alpha})`);
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(190,170,130,0.55)'; ctx.stroke();
}

// ------------------------------------------------------------------ text
export function convertEscapes(text) {
  let t = String(text ?? '').replace(/\\/g, '\x1b').replace(/\x1b\x1b/g, '\\');
  for (let i = 0; i < 2; i++) t = t.replace(/\x1bV\[(\d+)\]/gi, (_, n) => String(G.state.v(+n)));
  t = t.replace(/\x1bN\[(\d+)\]/gi, (_, n) => G.state.actor(+n)?.name || '');
  t = t.replace(/\x1bP\[(\d+)\]/gi, (_, n) => { const id = G.state.party.actors[+n - 1]; return id ? G.state.actor(id).name : ''; });
  t = t.replace(/\x1bG/gi, $data.system.currency_unit || 'G');
  return koreanParticles(t);
}
// Korean translation patch syntax: "[은;는]", "[이;가]", "[으;]로" picks a particle by the
// final consonant of the preceding syllable.
function koreanParticles(t) {
  return t.replace(/\[([^;[\]\x1b]*);([^[\]\x1b]*)\]/g, (m, a, b, off, str) => {
    let i = off - 1;
    while (i >= 0 && /[\s"'」』)\]]/.test(str[i])) i--;
    const c = str.charCodeAt(i);
    if (!(c >= 0xac00 && c <= 0xd7a3)) return b || a;
    const jong = (c - 0xac00) % 28;
    if (jong === 0) return b;
    if (a === '으' && jong === 8) return b; // ㄹ + 로
    return a;
  });
}
export function stripEscapes(text) {
  return convertEscapes(text).replace(/\x1b[A-Z]+(\[\d+\])?/gi, '').replace(/\x1b./g, '');
}
// a message (its lines as the event has them) that is a big banner - VICTORY ACHIEVED: no face, no choices, big
// letters, one short line of capitals: { text, color }, or null
export function bannerOf(msg) {
  const plain = msg.lines.map(stripEscapes).join(' ').trim();
  const raw = msg.lines.join('');
  if (msg.face || msg.choices || !/\\\{\\\{/.test(raw) || !/^[A-Z][A-Z !?.]{2,30}$/.test(plain)) return null;
  const cm = /\\C\[(\d+)\]/i.exec(raw);
  return { text: plain, color: cm ? textColor(+cm[1]) : '#ddd' };
}

let iconSet = null, windowSkin = null, palette = DEFAULT_COLORS.slice();
export async function loadUiAssets() {
  iconSet = await loadCanvas('Graphics/System', 'IconSet');
  windowSkin = await loadCanvas('Graphics/System', 'Window');
  setWindowSkin(windowSkin);
  if (windowSkin) {
    const ctx = windowSkin.getContext('2d', { willReadFrequently: true });
    palette = [];
    for (let n = 0; n < 32; n++) {
      const d = ctx.getImageData(64 + (n % 8) * 8 + 4, 96 + Math.floor(n / 8) * 8 + 4, 1, 1).data;
      palette.push(`rgb(${d[0]},${d[1]},${d[2]})`);
    }
  }
}
export function textColor(n) { return palette[n] || '#fff'; }
export function getIconSet() { return iconSet; }
export function drawIcon(ctx, index, x, y, size = 24) {
  if (!iconSet || index <= 0) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(iconSet, (index % 16) * 24, Math.floor(index / 16) * 24, 24, 24, x, y, size, size);
}

// Layout converted text into drawable ops; s = canvas pixels per RM pixel, base = the game's font size
// (lines are 24 RM px apart, taller only for bigger \{ text, like Window_Base). A line that would still run past
// maxX is shrunk to fit (the original clips it at the window edge). \$ is where the gold window opens.
function layoutText(lines, x0, y0, s, ctx, base = 24, maxX = Infinity) {
  const ops = [];
  let y = y0;
  let size = base, color = 0;
  for (const raw of lines) {
    const t = convertEscapes(raw);
    const first = ops.length;
    let x = x0, lineMax = size;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '\x1b') {
        const m = /^([$.|^!><{}])|^([A-Z]+)(?:\[(\d+)\])?/i.exec(t.slice(i + 1));
        if (!m) continue;
        i += m[0].length;
        const code = (m[1] || m[2]).toUpperCase();
        const p = m[3] !== undefined ? +m[3] : 0;
        if (code === 'C') color = p;
        else if (code === 'I') { ops.push({ k: 'icon', x, y, icon: p, s }); x += 24 * s; }
        else if (code === '{') { if (size <= 64) size += 8; lineMax = Math.max(lineMax, size); }
        else if (code === '}') { if (size >= 16) size -= 8; }
        else if (code === '.') ops.push({ k: 'wait', f: 15 });
        else if (code === '|') ops.push({ k: 'wait', f: 60 });
        else if (code === '!') ops.push({ k: 'input' });
        else if (code === '>') ops.push({ k: 'fast', on: true });
        else if (code === '<') ops.push({ k: 'fast', on: false });
        else if (code === '^') ops.push({ k: 'noinput' });
        else if (code === '$') ops.push({ k: 'gold' });
        continue;
      }
      ctx.font = gameFont(size * s);
      const w = ctx.measureText(c).width;
      ops.push({ k: 'ch', ch: c, x, y, size, color, s });
      x += w;
    }
    // the line's height (each letter drawn in its middle, as draw_text puts it)
    for (const op of ops) if (op.y === y && op.k === 'ch') op.lineH = Math.max(24, lineMax);
    if (x > maxX) {
      const f = (maxX - x0) / (x - x0);
      for (let i = first; i < ops.length; i++) { const op = ops[i]; if (op.x !== undefined) { op.x = x0 + (op.x - x0) * f; op.fit = f; } }
    }
    y += Math.max(24, lineMax) * s;
  }
  ops.height = y - y0;          // (all the lines' height: the scrolling text's)
  return ops;
}
// the first count letters / icons of the ops, as Window_Base draws them: in the skin's colours over the font's outline
// (or as the scripts set it - fonts.js fontLook); alpha: a choice that cannot be picked (160 / 255)
function drawOps(ctx, ops, count, alpha = 1) {
  let n = 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const op of ops) {
    if (op.k === 'ch') {
      if (n >= count) break;
      n++;
      const s = op.s, y = op.y + (op.lineH || 24) * s / 2;
      ctx.font = gameFont(op.size * s * (op.fit || 1));
      if (fontLook.shadow) { ctx.fillStyle = '#000'; ctx.fillText(op.ch, op.x + s, y + s); }
      if (fontLook.outline) { ctx.lineWidth = 2 * s; ctx.strokeStyle = fontLook.outColor; ctx.strokeText(op.ch, op.x, y); }
      ctx.fillStyle = textColor(op.color);
      ctx.fillText(op.ch, op.x, y);
    } else if (op.k === 'icon') {
      if (n >= count) break;
      n++;
      const sz = 24 * op.s * (op.fit || 1);
      drawIcon(ctx, op.icon, op.x, op.y + 24 * op.s - sz, sz);
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ list panel
// A list in a window: a title over its rows, a line under them (the row's description, or a footer). Three looks:
// 'window' - the original's windows (rmwindow.js: the game's window skin, its cursor and colours); 'plain' - this version's
// own dark box, which the title screen keeps (main.js plainLists: the very first screen as it was); 'choice' - the
// original's choice window (drawChoice). A list made with fit is cut to what it holds (drawW: the width it is drawn in).
const MW = 2;                      // canvas pixels per original pixel of the message windows
const PPM = 1024;                  // their canvas pixels a metre (640 original pixels: 1.25 m)
const CHOICE_ROWS = 6;             // the choice window's lines at most (選択肢拡張 RowMax): more scroll
const SCROLL_PIECE = 512;          // original pixels of a scrolling text one texture holds (UI startScroll)
const SKIP_DWELL = 0.08;           // s a message stays up while メッセージスキップ is held (input.js skipHeld)
const screenW = () => G.scripts?.screen?.[0] || 544;
const screenH = () => G.scripts?.screen?.[1] || 416;
// a row's description under a list (or the grid's): this many lines at most, broken between words, the last ending in '…'
// when there is more
const DESC_LINES = 2;
class ListPanel {
  constructor(widthPx = 900, rows = 8, widthM = 0.9, { fit = false, drawW = 0 } = {}) {
    this.rows = rows;
    this.rowH = 64;
    this.fitRows = fit; this.drawW = drawW;
    this.panel = new Panel(widthPx, 110 + rows * this.rowH + 24 + 32 * DESC_LINES, widthM);
    this.items = []; this.index = 0; this.top = 0; this.title = ''; this.look = 'window';
  }
  open(title, items, { onSelect, onCancel, onAdjust = null, index = 0, footer = '', look = '' } = {}) {
    this.title = title; this.items = items; this.onSelect = onSelect; this.onCancel = onCancel; this.onAdjust = onAdjust;
    this.look = look || (G.ui?.plainLists ? 'plain' : 'window');
    // (index -1: no row picked yet - the event choices, as the original's 誤選択防止 script: the first up / down, or the
    // laser moved onto a row, picks one; the confirm button does nothing until then)
    this.index = index < 0 ? -1 : Math.min(index, Math.max(0, items.length - 1)); this.top = 0; this.footer = footer;
    this.hover = -2;          // the row under the laser right now does not count as a move
    this.blink = -1;
    this.panel.mesh.visible = true;
    this.draw();
  }
  close() { this.panel.mesh.visible = false; }
  get visible() { return this.panel.mesh.visible; }
  // the window's size and its first row's top (canvas pixels): a fitted list as tall as its title, rows and foot lines;
  // either one a line taller when a row's description needs a second one
  layout() {
    const { canvas } = this.panel, W = this.drawW || canvas.width;
    const lines = this.descLines();
    if (!this.fitRows) return { W, H: canvas.height - 32 * (DESC_LINES - Math.max(1, lines)), top: 100 };
    const top = this.title ? 100 : 24, shown = Math.max(1, Math.min(this.rows, this.items.length));
    const foot = lines ? 24 + 32 * lines : 24;
    return { W, H: top + shown * this.rowH + foot, top };
  }
  // how many lines the rows' descriptions (or the foot line) take at the most: 0 (none) to DESC_LINES
  descLines() {
    const W = this.drawW || this.panel.canvas.width;
    if (this.descFor === this.items && this.descFoot === this.footer && this.descW === W && this.descN0 === this.items.length) return this.descN;
    const ctx = this.panel.ctx;
    ctx.save();
    ctx.font = `28px ${FONT}`;
    let n = 0;
    for (const d of [this.footer, ...this.items.map(it => it.desc)]) {
      if (!d) continue;
      n = Math.max(n, Array.isArray(d) ? 1 : wrapLines(ctx, stripEscapes(d), W - 72, DESC_LINES).length);
      if (n >= DESC_LINES) break;
    }
    ctx.restore();
    Object.assign(this, { descFor: this.items, descFoot: this.footer, descW: W, descN0: this.items.length, descN: n });
    return n;
  }
  // the row under a point of the panel (a ray's uv), or -1
  rowAt(uv) {
    const [W, H] = this.panel.shown, py = (1 - uv.y) * H;
    if (this.look === 'choice') {
      const r = Math.floor((py / MW - PAD) / LINE), i = this.top + r;
      return r >= 0 && r < this.shownRows && uv.x * W >= PAD * MW && uv.x * W < W - PAD * MW && this.items[i] ? i : -1;
    }
    const r = Math.floor((py - this.layout().top) / this.rowH), i = this.top + r;
    return r >= 0 && r < this.rows && this.items[i] ? i : -1;
  }
  // the title on one line - a long one (a co-op question with names in it) smaller, or on two lines at a sentence's end
  drawTitle(ctx, room, put = outlined) {
    const t = this.title || '';
    ctx.font = `bold 40px ${FONT}`;
    const w = ctx.measureText(t).width;
    if (w <= room) { put(ctx, t, 36, 52); return; }
    const one = Math.floor(40 * room / w);
    if (one >= 32) { ctx.font = `bold ${one}px ${FONT}`; put(ctx, t, 36, 52); return; }
    const mid = t.length / 2, near = (a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a);
    const ends = [...t.matchAll(/[.?!。？！]\s*/g)].map(m => m.index + m[0].length).filter(i => i < t.length);
    const spaces = [...t.matchAll(/\s/g)].map(m => m.index);
    const cut = ends.length ? ends.reduce(near) : spaces.length ? spaces.reduce(near) : Math.ceil(mid);
    const a = t.slice(0, cut).trim(), b = t.slice(cut).trim();
    ctx.font = `bold 30px ${FONT}`;
    const wide = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (wide > room) ctx.font = `bold ${Math.max(18, Math.floor(30 * room / wide))}px ${FONT}`;
    put(ctx, a, 36, 32); put(ctx, b, 36, 72);
  }
  scroll() {
    if (this.index >= 0 && this.index < this.top) this.top = this.index;
    if (this.index >= this.top + this.rows) this.top = this.index - this.rows + 1;
  }
  draw() {
    if (this.look === 'choice') { this.drawChoice(); return; }
    if (this.look === 'plain') { this.drawPlain(); return; }
    const { ctx } = this.panel, { W, H, top } = this.layout();
    this.panel.clear();
    drawWindow(ctx, 2, 0, 0, W / 2, H / 2);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor(16);
    this.drawTitle(ctx, W - 72);
    this.scroll();
    for (let r = 0; r < this.rows; r++) {
      const i = this.top + r;
      const it = this.items[i];
      if (!it) break;
      const y = top + r * this.rowH;
      if (i === this.index) drawCursor(ctx, 2, 10, y / 2, W / 2 - 20, (this.rowH - 6) / 2);
      let x = 40;
      if (it.icon) { drawIcon(ctx, it.icon, x, y + 6, 48); x += 60; }
      ctx.font = `36px ${FONT}`;
      ctx.fillStyle = it.enabled === false ? DIM : textColor(0);
      let rightW = 0;
      if (it.right) {
        ctx.font = `${it.right.length > 10 ? 28 : 36}px ${FONT}`;
        rightW = ctx.measureText(it.right).width + 24;
        ctx.textAlign = 'right';
        ctx.fillStyle = it.enabled === false ? DIM : textColor(0);
        outlined(ctx, it.right, W - 44, y + this.rowH / 2 - 2);
        ctx.textAlign = 'left';
        ctx.font = `36px ${FONT}`;
        ctx.fillStyle = it.enabled === false ? DIM : textColor(0);
      }
      let name = stripEscapes(it.text);
      const maxW = W - 44 - rightW - x;
      if (ctx.measureText(name).width > maxW) {
        while (name.length > 1 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
        name += '…';
      }
      outlined(ctx, name, x, y + this.rowH / 2 - 2);
    }
    if (this.items.length > this.rows && this.index >= 0) {
      ctx.fillStyle = DIM;
      ctx.font = `28px ${FONT}`;
      outlined(ctx, `${this.index + 1}/${this.items.length}`, W - 140, 52);
    }
    const desc = this.items[this.index]?.desc || this.footer;
    if (Array.isArray(desc)) {
      // (in coloured parts: the menu's SEN)
      ctx.font = `30px ${FONT}`;
      let x = 36;
      for (const [text, color] of desc) { ctx.fillStyle = color; outlined(ctx, text, x, H - 30); x += ctx.measureText(text).width; }
    } else if (desc) {
      ctx.font = `28px ${FONT}`;
      ctx.fillStyle = textColor(0);
      const lines = wrapLines(ctx, stripEscapes(desc), W - 72, DESC_LINES);
      lines.forEach((l, k) => outlined(ctx, l, 36, H - 30 - 32 * (lines.length - 1 - k)));
    }
    this.panel.fit(W, H);
    this.panel.commit();
  }
  // this version's own dark box (the title screen's, kept as it was)
  drawPlain() {
    const { ctx } = this.panel, { W, H, top } = this.layout();
    this.panel.clear();
    windowBg(ctx, 4, 4, W - 8, H - 8, 0.9);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8d8a8';
    this.drawTitle(ctx, W - 72, (c, t, x, y) => c.fillText(t, x, y));
    this.scroll();
    for (let r = 0; r < this.rows; r++) {
      const i = this.top + r;
      const it = this.items[i];
      if (!it) break;
      const y = top + r * this.rowH;
      if (i === this.index) {
        roundRect(ctx, 20, y, W - 40, this.rowH - 6, 8);
        ctx.fillStyle = 'rgba(200,170,110,0.28)'; ctx.fill();
      }
      let x = 40;
      if (it.icon) { drawIcon(ctx, it.icon, x, y + 6, 48); x += 60; }
      ctx.font = `36px ${FONT}`;
      ctx.fillStyle = it.enabled === false ? 'rgba(255,255,255,0.35)' : '#f0f0f0';
      let rightW = 0;
      if (it.right) {
        ctx.font = `${it.right.length > 10 ? 28 : 36}px ${FONT}`;
        rightW = ctx.measureText(it.right).width + 24;
        ctx.textAlign = 'right';
        ctx.fillStyle = it.enabled === false ? 'rgba(255,255,255,0.35)' : 'rgba(235,225,195,0.95)';
        ctx.fillText(it.right, W - 44, y + this.rowH / 2 - 2);
        ctx.textAlign = 'left';
        ctx.font = `36px ${FONT}`;
        ctx.fillStyle = it.enabled === false ? 'rgba(255,255,255,0.35)' : '#f0f0f0';
      }
      let name = stripEscapes(it.text);
      const maxW = W - 44 - rightW - x;
      if (ctx.measureText(name).width > maxW) {
        while (name.length > 1 && ctx.measureText(name + '…').width > maxW) name = name.slice(0, -1);
        name += '…';
      }
      ctx.fillText(name, x, y + this.rowH / 2 - 2);
    }
    if (this.items.length > this.rows && this.index >= 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `28px ${FONT}`;
      ctx.fillText(`${this.index + 1}/${this.items.length}`, W - 140, 52);
    }
    const desc = this.items[this.index]?.desc || this.footer;
    if (Array.isArray(desc)) {
      ctx.font = `30px ${FONT}`;
      let x = 36;
      for (const [text, color] of desc) { ctx.fillStyle = color; ctx.fillText(text, x, H - 30); x += ctx.measureText(text).width; }
    } else if (desc) {
      ctx.font = `28px ${FONT}`;
      ctx.fillStyle = 'rgba(230,220,200,0.85)';
      const lines = wrapLines(ctx, stripEscapes(desc), W - 72, DESC_LINES);
      lines.forEach((l, k) => ctx.fillText(l, 36, H - 30 - 32 * (lines.length - 1 - k)));
    }
    this.panel.fit(W, H);
    this.panel.commit();
  }
  // The original's choice window (Window_ChoiceList, as 選択肢拡張 and 修正パッチ have it): as wide as its longest choice
  // (an icon counted 24) + 12, 96 at least, with its padding round; a line a choice, 6 at most (more scroll, the skin's
  // arrows showing it); each written as the message is (its colours, icons), one that cannot be picked translucent; the
  // cursor on the one picked - none at first (誤選択防止) -, blinking while it is answered
  drawChoice() {
    const { ctx } = this.panel, s = MW, n = this.items.length;
    ctx.font = gameFont(fontSize() * s);
    let longest = 0;
    for (const it of this.items) {
      const icons = (convertEscapes(it.text).match(/\x1bI\[\d+\]/gi) || []).length;
      longest = Math.max(longest, icons * 24 + ctx.measureText(stripEscapes(it.text)).width / s);
    }
    const w = Math.min(screenW(), Math.ceil(Math.max(longest + 12, 96)) + PAD * 2);
    const shown = this.shownRows = Math.max(1, Math.min(n, CHOICE_ROWS)), h = fittingHeight(shown);
    if (this.index >= 0 && this.index < this.top) this.top = this.index;
    if (this.index >= this.top + shown) this.top = this.index - shown + 1;
    this.panel.clear();
    drawWindow(ctx, s, 0, 0, w, h);
    if (this.index >= 0) drawCursor(ctx, s, PAD, PAD + (this.index - this.top) * LINE, w - PAD * 2, LINE, cursorBlink(G.time));
    for (let r = 0; r < shown; r++) {
      const it = this.items[this.top + r];
      if (!it) break;
      const ops = layoutText([it.text], (PAD + 4) * s, (PAD + r * LINE) * s, s, ctx, fontSize(), (w - PAD - 4) * s);
      drawOps(ctx, ops, Infinity, it.enabled === false ? 160 / 255 : 1);
    }
    drawArrows(ctx, s, w, h, this.top > 0, this.top + shown < n);
    this.panel.fit(w * s, h * s);
    this.panel.commit();
  }
  update(raycaster) {
    const input = G.input;
    let changed = false;
    const ny = input.navY();
    // (from no row: down picks the first, up the last - 誤選択防止 1.01)
    if (ny) { this.index = this.index < 0 ? (ny > 0 ? 0 : this.items.length - 1) : (this.index + ny + this.items.length) % this.items.length; changed = true; }
    // left / right: some lists change a value with it (a shop's quantity)
    if (this.onAdjust) { const nx = input.navX(); if (nx && this.onAdjust(nx)) { G.audio?.playSystemSe(0); return true; } }
    if (raycaster) {
      const uv = this.panel.hit(raycaster);
      let hover = -1;
      if (uv) { hover = this.rowAt(uv); G.ui.pointerTarget = true; }
      if (this.hover === -2) this.hover = hover;      // just opened: remember, don't jump
      else if (hover !== this.hover) {
        this.hover = hover;
        if (hover >= 0 && hover !== this.index) { this.index = hover; changed = true; }
      }
      if (this.index >= 0 && hover >= 0 && hover !== this.index && G.input.xrPressed('right', 0)) { this.index = hover; changed = true; }
    }
    if (changed) { this.draw(); G.audio?.playSystemSe(0); }
    // (the choices' cursor blinking: drawn again as it fades)
    else if (this.look === 'choice' && this.index >= 0) {
      const b = Math.round(cursorBlink(G.time) * 8);
      if (b !== this.blink) { this.blink = b; this.draw(); }
    }
    if (input.confirm()) {
      if (this.index < 0) return true;             // (nothing picked yet: the press is just swallowed)
      const it = this.items[this.index];
      if (it && it.enabled !== false) { G.audio?.playSystemSe(1); this.onSelect?.(this.index, it); }
      else G.audio?.playSystemSe(3);
      return true;
    }
    if (input.cancel()) { G.audio?.playSystemSe(2); this.onCancel?.(); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ the menu screen (Scene_Menu, as the original lays it)
// 640 x 480 of the original's pixels, in its windows (rmwindow.js): the commands at the top left (160 wide - the
// database's words, the oath's from its script; then this VR version's own under a gap), the SEN (メニュー変数: at y 370)
// and the souls (Window_Gold) at the foot of that side, the party on the right (Window_MenuStatus: face and simple status,
// four to its height) and the place now (マップ名ウィンドウ: its own size and place)
const MS = 2;                      // canvas pixels per original pixel
class MenuScreen {
  constructor(widthM) {
    this.panel = new Panel(640 * MS, 480 * MS, widthM);
    this.items = []; this.index = 0;
  }
  open(items, { onSelect, onCancel, index = 0 } = {}) {
    this.items = items; this.onSelect = onSelect; this.onCancel = onCancel;
    this.index = Math.max(0, Math.min(index, items.length - 1));
    if (items[this.index]?.gap) this.index++;
    this.hover = -2;
    this.panel.mesh.visible = true;
    this.draw();
  }
  close() { this.panel.mesh.visible = false; }
  get visible() { return this.panel.mesh.visible; }
  // the command rows: the original's under one another, this version's after a line's gap (original pixels)
  rowY(i) { let y = PAD; for (let k = 0; k < i; k++) y += this.items[k].gap ? LINE / 2 : LINE; return y; }
  commandHeight() { return this.rowY(this.items.length) + PAD; }
  rowAt(py) {
    for (let i = 0; i < this.items.length; i++) { const y = this.rowY(i); if (!this.items[i].gap && py >= y && py < y + LINE) return i; }
    return -1;
  }
  draw() {
    const { ctx } = this.panel, s = MS;
    this.panel.clear();
    const normal = textColor(0), system = textColor(16);
    // the commands
    drawWindow(ctx, s, 0, 0, 160, this.commandHeight());
    this.items.forEach((it, i) => {
      if (it.gap) return;
      const y = this.rowY(i);
      if (i === this.index) drawCursor(ctx, s, PAD, y, 160 - PAD * 2, LINE);
      drawText(ctx, s, it.text, PAD + 4, y, 160 - PAD * 2 - 8, LINE, 0, normal, { alpha: it.enabled === false ? 160 / 255 : 1 });
    });
    // the SEN (its script's title and variable), as Window_Var draws them
    const mv = G.scripts?.menuVar;
    if (mv && (!mv.switchId || G.state.sw(mv.switchId))) {
      const wy = 370, h = fittingHeight(2) - 8;
      drawWindow(ctx, s, 0, wy, 160, h);
      drawText(ctx, s, mv.label, PAD, wy + PAD - 2, 160 + 28, LINE, 0, system);
      if (mv.suffix) drawText(ctx, s, mv.suffix, PAD, wy + PAD + LINE - 4, 138, LINE, 2, system);
      drawText(ctx, s, G.state.v(mv.variable), PAD, wy + PAD + LINE - 4, 128 - 9, LINE, 2, normal);
    }
    // the souls (Window_Gold#draw_currency_value)
    {
      const gh = fittingHeight(1), gy = 480 - gh, unit = $data.system.currency_unit || '';
      drawWindow(ctx, s, 0, gy, 160, gh);
      ctx.font = gameFont(fontSize() * s);
      const cx = ctx.measureText(unit).width / s;
      drawText(ctx, s, G.state.party.gold, PAD + 4, gy + PAD, 128 - cx - 2, LINE, 2, normal);
      drawText(ctx, s, unit, PAD + 4, gy + PAD, 128, LINE, 2, system);
    }
    // the party (Window_MenuStatus)
    drawWindow(ctx, s, 160, 0, 480, 480);
    const ih = Math.floor((480 - PAD * 2) / 4);
    let waiting = false;
    G.state.party.actors.slice(0, 4).forEach((id, i) => {
      const a = G.state.actor(id);
      if (!a) return;
      const x = 160 + PAD, y = PAD + i * ih;
      if (a.faceName && !drawFace(ctx, s, a.faceName, a.faceIndex, x + 1, y + 1)) waiting = true;
      this.simpleStatus(ctx, s, a, x + 108, y + LINE / 2);
    });
    // the place now (マップ名ウィンドウ)
    const pw = G.scripts?.placeWindow;
    if (pw) {
      drawWindow(ctx, s, pw.x, pw.y, pw.w, pw.h);
      drawText(ctx, s, pw.label, pw.x + PAD, pw.y + PAD, pw.w - PAD * 2, LINE, 0, system);
      drawText(ctx, s, stripEscapes(G.map?.map?.display_name || ''), pw.x + PAD, pw.y + PAD + 24, pw.w - PAD * 2, LINE, 0, normal);
    }
    this.panel.commit();
    // (a face still loading: drawn again once it is there)
    if (waiting) setTimeout(() => { if (this.visible) this.draw(); }, 150);
  }
  // Window_Base#draw_actor_simple_status: name, level, state icons; class, HP, MP
  simpleStatus(ctx, s, a, x, y) {
    const B = $data.system.terms?.basic || [], normal = textColor(0), system = textColor(16);
    const hpColor = a.hp <= 0 ? textColor(18) : a.hp < a.mhp / 4 ? textColor(17) : normal;
    const mpColor = a.mp < a.mmp / 4 ? textColor(17) : normal;
    drawText(ctx, s, a.name, x, y, 112, LINE, 0, hpColor);
    drawText(ctx, s, B[1] || 'Lv', x, y + LINE, 32, LINE, 0, system);
    drawText(ctx, s, a.level, x + 32, y + LINE, 24, LINE, 2, normal);
    const icons = [...a.states.map(id => $data.states[id]).filter(st => st?.icon_index > 0)
      .sort((p, q) => (q.priority || 0) - (p.priority || 0)).map(st => st.icon_index), ...a.buffIcons()].slice(0, 4);
    icons.forEach((ic, k) => drawIcon(ctx, ic, (x + 24 * k) * s, (y + LINE * 2) * s, 24 * s));
    drawText(ctx, s, $data.classes[a.classId]?.name || '', x + 120, y, 112, LINE, 0, normal);
    const gauge = (label, cur, max, c1, c2, color, gy) => {
      drawGauge(ctx, s, x + 120, gy, 124, max ? cur / max : 0, textColor(c1), textColor(c2), textColor(19));
      drawText(ctx, s, label, x + 120, gy, 30, LINE, 0, system);
      const xr = x + 120 + 124;
      drawText(ctx, s, cur, xr - 92, gy, 42, LINE, 2, color);
      drawText(ctx, s, '/', xr - 52, gy, 12, LINE, 2, normal);
      drawText(ctx, s, max, xr - 42, gy, 42, LINE, 2, normal);
    };
    gauge(B[3] || 'HP', a.hp, a.mhp, 20, 21, hpColor, y + LINE);
    gauge(B[5] || 'MP', a.mp, a.mmp, 22, 23, mpColor, y + LINE * 2);
  }
  update(raycaster) {
    const input = G.input;
    let changed = false;
    const step = d => { let i = this.index; do { i = (i + d + this.items.length) % this.items.length; } while (this.items[i].gap); return i; };
    const ny = input.navY();
    if (ny) { this.index = step(ny); changed = true; }
    if (raycaster) {
      const uv = this.panel.hit(raycaster);
      let hover = -1;
      if (uv) {
        const px = uv.x * 640, py = (1 - uv.y) * 480;
        if (px < 160) hover = this.rowAt(py);
        G.ui.pointerTarget = true;
      }
      if (this.hover === -2) this.hover = hover;
      else if (hover !== this.hover) {
        this.hover = hover;
        if (hover >= 0 && hover !== this.index) { this.index = hover; changed = true; }
      }
    }
    if (changed) { this.draw(); G.audio?.playSystemSe(0); }
    if (input.confirm()) {
      const it = this.items[this.index];
      if (it && it.enabled !== false) { G.audio?.playSystemSe(1); this.onSelect?.(this.index, it); }
      else G.audio?.playSystemSe(3);
      return true;
    }
    if (input.cancel()) { G.audio?.playSystemSe(2); this.onCancel?.(); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ grid panel (3 per row, tabs)
// a text in lines no wider than maxW: broken between words where it has spaces - a word longer than a line, and a text
// with none (Japanese, Chinese), between letters -, at most maxLines, the last ending in '…' when there is more
function wrapLines(ctx, text, maxW, maxLines) {
  const fits = t => ctx.measureText(t).width <= maxW;
  const lines = [];
  let line = '';
  const flush = () => { lines.push(line.trimEnd()); line = ''; };
  for (const tok of String(text || '').replace(/\r?\n/g, ' ').trim().match(/\s+|\S+/g) || []) {
    if (/^\s/.test(tok)) { if (line) line += ' '; continue; }
    if (fits(line + tok)) { line += tok; continue; }
    if (line.trim() && fits(tok)) { flush(); line = tok; continue; }
    for (const ch of tok) { if (line && !fits(line + ch)) flush(); line += ch; }
  }
  if (line.trim()) flush();
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  let last = out[maxLines - 1];
  while (last && !fits(last + '…')) last = last.slice(0, -1);
  out[maxLines - 1] = last.trimEnd() + '…';
  return out;
}
class GridPanel {
  constructor(widthPx = 1260, cols = 3, rows = 6, widthM = 1.2) {
    this.cols = cols; this.rows = rows; this.cellH = 76;
    this.gridTop = 150;
    this.panel = new Panel(widthPx, this.gridTop + rows * this.cellH + 120, widthM);
    this.tabs = []; this.tab = 0; this.index = 0; this.top = 0; this.focusTabs = false;
  }
  get visible() { return this.panel.mesh.visible; }
  get items() { return this.tabs[this.tab]?.items || []; }
  open(title, tabs, { onSelect, onCancel, tab = this.tab, index = 0 } = {}) {
    this.title = title; this.tabs = tabs; this.onSelect = onSelect; this.onCancel = onCancel;
    this.tab = Math.min(tab, tabs.length - 1); this.index = Math.min(index, Math.max(0, this.items.length - 1));
    this.focusTabs = false;
    this.hover = undefined;
    this.panel.mesh.visible = true;
    this.draw();
  }
  close() { this.panel.mesh.visible = false; }
  setItems(tabIndex, items) { this.tabs[tabIndex].items = items; this.index = Math.min(this.index, Math.max(0, items.length - 1)); this.draw(); }
  draw() {
    const { ctx, canvas } = this.panel;
    this.panel.clear();
    drawWindow(ctx, 2, 0, 0, canvas.width / 2, canvas.height / 2);
    ctx.textBaseline = 'middle';
    ctx.font = `bold 40px ${FONT}`; ctx.fillStyle = textColor(16);
    outlined(ctx, this.title, 36, 50);
    // tabs
    const tw = (canvas.width - 60) / Math.max(1, this.tabs.length);
    this.tabs.forEach((t, i) => {
      const x = 30 + i * tw;
      if (i === this.tab) drawCursor(ctx, 2, (x + 4) / 2, 41, (tw - 8) / 2, 25, this.focusTabs ? 1 : 0.55);
      ctx.font = `32px ${FONT}`; ctx.fillStyle = i === this.tab ? textColor(0) : DIM;
      ctx.textAlign = 'center'; outlined(ctx, `${t.label} (${t.items.length})`, x + tw / 2, 107); ctx.textAlign = 'left';
    });
    // cells
    const items = this.items;
    const row = Math.floor(this.index / this.cols);
    if (row < this.top) this.top = row;
    if (row >= this.top + this.rows) this.top = row - this.rows + 1;
    const cw = (canvas.width - 60) / this.cols;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const i = (this.top + r) * this.cols + c;
      const it = items[i];
      if (!it) continue;
      const x = 30 + c * cw, y = this.gridTop + r * this.cellH;
      if (i === this.index && !this.focusTabs) drawCursor(ctx, 2, (x + 3) / 2, (y + 3) / 2, (cw - 6) / 2, (this.cellH - 6) / 2);
      drawIcon(ctx, it.icon, x + 10, y + 14, 48);
      ctx.font = `29px ${FONT}`;
      ctx.fillStyle = it.enabled === false ? DIM : textColor(0);
      let name = stripEscapes(it.text);
      const maxW = cw - 140;
      while (name.length > 1 && ctx.measureText(name).width > maxW) name = name.slice(0, -1);
      if (name !== stripEscapes(it.text)) name = name.slice(0, -1) + '…';
      outlined(ctx, name, x + 68, y + this.cellH / 2);
      if (it.right) {
        ctx.textAlign = 'right'; ctx.fillStyle = textColor(0);
        outlined(ctx, it.right, x + cw - 14, y + this.cellH / 2);
        ctx.textAlign = 'left';
      }
    }
    const totalRows = Math.ceil(items.length / this.cols);
    if (totalRows > this.rows) {
      ctx.font = `26px ${FONT}`; ctx.fillStyle = DIM;
      ctx.textAlign = 'right'; outlined(ctx, `${row + 1}/${totalRows}`, canvas.width - 36, 50); ctx.textAlign = 'left';
    }
    if (!items.length) {
      ctx.font = `30px ${FONT}`; ctx.fillStyle = DIM;
      outlined(ctx, tr('(없음)'), 40, this.gridTop + 40);
    }
    // description
    const it = items[this.index];
    const desc = this.focusTabs ? tr('좌우로 탭 변경, 아래로 목록') : it?.desc;
    if (desc) {
      ctx.font = `27px ${FONT}`; ctx.fillStyle = textColor(0);
      const lines = wrapLines(ctx, stripEscapes(desc), canvas.width - 80, 2);
      lines.forEach((l, k) => outlined(ctx, l, 36, canvas.height - 84 + k * 36));
    }
    this.panel.commit();
  }
  update(raycaster) {
    const input = G.input;
    let changed = false;
    const items = this.items;
    const dx = input.navX(), dy = input.navY();
    if (this.focusTabs) {
      if (dx) { this.tab = (this.tab + dx + this.tabs.length) % this.tabs.length; this.index = 0; this.top = 0; changed = true; }
      if (dy > 0) { this.focusTabs = false; changed = true; }
    } else {
      if (dy < 0 && this.index < this.cols) { this.focusTabs = true; changed = true; }
      else if (dy && items.length) { this.index = Math.max(0, Math.min(items.length - 1, this.index + dy * this.cols)); changed = true; }
      if (dx && items.length) { this.index = Math.max(0, Math.min(items.length - 1, this.index + dx)); changed = true; }
    }
    if (raycaster) {
      const uv = this.panel.hit(raycaster);
      let hover = null;                          // 't3' = tab 3, 'c12' = cell 12
      if (uv) {
        G.ui.pointerTarget = true;
        const px = uv.x * this.panel.canvas.width, py = (1 - uv.y) * this.panel.canvas.height;
        const cw = (this.panel.canvas.width - 60) / this.cols;
        if (py >= 82 && py <= 132) {
          const tw = (this.panel.canvas.width - 60) / Math.max(1, this.tabs.length);
          const t = Math.floor((px - 30) / tw);
          if (t >= 0 && t < this.tabs.length) hover = 't' + t;
        } else if (py >= this.gridTop) {
          const r = Math.floor((py - this.gridTop) / this.cellH), c = Math.floor((px - 30) / cw);
          const i = (this.top + r) * this.cols + c;
          if (r >= 0 && r < this.rows && c >= 0 && c < this.cols && items[i]) hover = 'c' + i;
        }
      }
      const apply = h => {
        if (h[0] === 't') { const t = +h.slice(1); if (t !== this.tab || !this.focusTabs) { this.tab = t; this.focusTabs = true; this.index = 0; this.top = 0; changed = true; } }
        else { const i = +h.slice(1); if (i !== this.index || this.focusTabs) { this.index = i; this.focusTabs = false; changed = true; } }
      };
      // the laser moves the cursor only when it moves onto another tab / cell; the trigger picks it
      if (this.hover === undefined) this.hover = hover;   // just opened: remember, don't jump
      else if (hover !== this.hover) { this.hover = hover; if (hover) apply(hover); }
      else if (hover && G.input.xrPressed('right', 0)) apply(hover);
    }
    if (changed) { this.draw(); G.audio?.playSystemSe(0); }
    if (input.confirm()) {
      if (this.focusTabs) { this.focusTabs = false; this.draw(); return true; }
      const it = items[this.index];
      if (it && it.enabled !== false) { G.audio?.playSystemSe(1); this.onSelect?.(it, this.index); }
      else G.audio?.playSystemSe(3);
      return true;
    }
    if (input.cancel()) { G.audio?.playSystemSe(2); this.onCancel?.(); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ keyboard (a name)
// English letters, digits, space, - and _: the laser and the trigger, or the stick and A, press a key; B takes the last
// letter back. Aa makes the next letter a capital (on at the start). On a PC the keyboard itself types too - into a
// hidden text field, which takes only the letters a name may have
const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'back'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '_'],
  ['cancel', 'space', 'done'],
];
// (a chat line: the keyboard's signs too - coopchat.js cleanChat -, and 한/영: its letters Korean, put together as typed -
// hangul.js)
const CHAT_ROWS = [...KEY_ROWS.slice(0, 4), ['.', ',', '?', '!', "'", ':', ';', '(', ')', '/', '@'], ['lang', ...KEY_ROWS[4]]];
const KEY_UNITS = { back: 1.6, shift: 1.6, space: 5, done: 2.6, cancel: 2.2, lang: 1.8 };
const NAME_KEY = /^[A-Za-z0-9 _-]$/;
const clipName = (s, max) => [...String(s || '')].filter(c => NAME_KEY.test(c)).join('').replace(/ {2,}/g, ' ').replace(/^ /, '').slice(0, max);
const clipChat = (s, max) => clipChatText(s, max);
// the game's keyboard (English): a name's (letters, digits, _ and -) - or, given its rows and rules, a chat line's (with 한/영:
// the letters' keys Korean jamo, put together into syllables as they are typed - the one being typed shown at the end)
class KeyboardPanel {
  constructor(rows = KEY_ROWS, clip = clipName, clean = cleanName) {
    this.rows = rows; this.clip = clip; this.clean = clean;
    this.lang = 'en'; this.ko = new Hangul();
    this.unit = 86; this.keyH = 62; this.rowH = 74; this.top = 196;
    this.panel = new Panel(1100, this.top + rows.length * this.rowH + 24, 1.05);
    this.text = ''; this.max = NAME_LEN; this.shift = false; this.row = 1; this.col = 0; this.rects = [];
    this.input = null;
  }
  get visible() { return this.panel.mesh.visible; }
  // onCancel: none - it must be given a name (the prologue's name input)
  open(title, text, max, { onDone, onCancel = null }) {
    this.title = title; this.max = max; this.onDone = onDone; this.onCancel = onCancel;
    this.text = this.clip(text, max); this.shift = !this.text; this.row = 1; this.col = 0; this.hover = undefined;
    // (한/영: as last picked - at first Korean when the game's own words are)
    this.ko.clear();
    this.lang = !this.rows.some(r => r.includes('lang')) ? 'en' : G.settings?.chatKeys === 'ko' || G.settings?.chatKeys === 'en' ? G.settings.chatKeys : uiLang() === 'ko' ? 'ko' : 'en';
    if (this.lang === 'ko') this.shift = false;
    this.panel.mesh.visible = true;
    this.draw();
    if (!G.vr) this.field(true);
  }
  close() { this.panel.mesh.visible = false; this.field(false); }
  // (PC) the hidden text field the keyboard types into
  field(on) {
    if (!on) { if (this.input) { this.input.oninput = this.input.onkeydown = null; this.input.blur(); } return; }
    const el = this.input ||= Object.assign(document.createElement('input'), { type: 'text', autocomplete: 'off', spellcheck: false });
    el.style.cssText = 'position:fixed;left:-2000px;top:0;width:300px;opacity:0;pointer-events:none';
    if (!el.parentNode) document.body.appendChild(el);
    el.value = this.shown;
    // (the field left as it is while the system's input is still putting a letter together - a Korean syllable: touching it
    // then breaks it; what it may hold once the letter is done)
    el.oninput = e => {
      this.ko.clear();
      const v = this.clip(el.value, this.max);
      if (v !== el.value && !e.isComposing) el.value = v;
      if (v !== this.text) { this.text = v; this.shift = false; this.draw(); }
    };
    el.oncompositionend = () => el.oninput?.({ isComposing: false });
    el.onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.press('done'); }
      else if (e.key === 'Escape' && this.onCancel) { e.preventDefault(); this.press('cancel'); }
    };
    el.focus();
  }
  keysOf(r) { return this.rows[r].filter(k => k !== 'cancel' || this.onCancel); }
  // what is typed so far (the Korean syllable being put together at its end)
  get shown() { return this.text + this.ko.text; }
  label(k) {
    if (k === 'back') return '\u2190';
    if (k === 'shift') return this.lang === 'ko' ? 'ㄲ' : 'Aa';
    if (k === 'lang') return tr('한/영');
    if (this.lang === 'ko' && KO_KEYS[k]) return (this.shift && KO_SHIFT[k]) || KO_KEYS[k];
    if (k === 'space') return tr('띄어쓰기');
    if (k === 'done') return tr('완료');
    if (k === 'cancel') return tr('취소');
    return this.shift ? k.toUpperCase() : k;
  }
  press(k) {
    if (!k) return;
    if (k === 'done') {
      this.text += this.ko.flush();
      const v = this.clean(this.text);
      if (!v) { G.audio?.playSystemSe(3); return; }
      G.audio?.playSystemSe(1);
      this.onDone?.(v);
      return;
    }
    if (k === 'cancel') { G.audio?.playSystemSe(2); this.onCancel?.(); return; }
    if (k === 'back') { if (!(this.lang === 'ko' && this.ko.back())) this.text = [...this.text].slice(0, -1).join(''); }
    else if (k === 'shift') this.shift = !this.shift;
    else if (k === 'lang') {
      this.text += this.ko.flush();
      this.lang = this.lang === 'ko' ? 'en' : 'ko'; this.shift = false;
      if (G.settings) { G.settings.chatKeys = this.lang; G.saveSettings?.(); }
    } else if (this.lang === 'ko' && KO_KEYS[k]) {
      if ([...this.shown].length >= this.max && this.ko.empty) { G.audio?.playSystemSe(3); return; }
      this.text += this.ko.put((this.shift && KO_SHIFT[k]) || KO_KEYS[k]);
      this.shift = false;
    } else {
      this.text += this.ko.flush();
      const c = k === 'space' ? ' ' : this.shift ? k.toUpperCase() : k;
      if ([...this.text].length >= this.max || (c === ' ' && (!this.text || this.text.endsWith(' ')))) { G.audio?.playSystemSe(3); return; }
      this.text += c;
      if (c !== ' ') this.shift = false;
    }
    G.audio?.playSystemSe(0);
    if (this.input) this.input.value = this.shown;
    this.draw();
  }
  // the key in row r nearest across to the one picked now
  nearestCol(r) {
    const cur = this.rects.find(k => k.row === this.row && k.col === this.col);
    if (!cur) return 0;
    const mid = cur.x + cur.w / 2;
    let best = 0, bd = Infinity;
    for (const k of this.rects) if (k.row === r && Math.abs(k.x + k.w / 2 - mid) < bd) { bd = Math.abs(k.x + k.w / 2 - mid); best = k.col; }
    return best;
  }
  draw() {
    const { ctx, canvas } = this.panel;
    this.panel.clear();
    windowBg(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 0.92);
    ctx.textBaseline = 'middle';
    ctx.font = `bold 40px ${FONT}`; ctx.fillStyle = '#e8d8a8';
    ctx.fillText(this.title, 36, 52);
    // the name so far
    roundRect(ctx, 36, 92, canvas.width - 72, 76, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(200,170,110,0.6)'; ctx.stroke();
    ctx.font = `44px ${FONT}`; ctx.fillStyle = '#f4f0e6';
    ctx.fillText(this.shown + '_', 56, 132);
    ctx.textAlign = 'right'; ctx.font = `26px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(`${[...this.shown].length}/${this.max}`, canvas.width - 56, 132);
    ctx.textAlign = 'left';
    // the keys
    this.rects = [];
    this.rows.forEach((_, r) => {
      const keys = this.keysOf(r), w = keys.reduce((s, k) => s + (KEY_UNITS[k] || 1), 0) * this.unit;
      let x = (canvas.width - w) / 2;
      const y = this.top + r * this.rowH;
      keys.forEach((k, c) => {
        const kw = (KEY_UNITS[k] || 1) * this.unit;
        roundRect(ctx, x + 4, y, kw - 8, this.keyH, 10);
        ctx.fillStyle = r === this.row && c === this.col ? 'rgba(220,190,120,0.55)' : (k === 'shift' && this.shift) || (k === 'lang' && this.lang === 'ko') ? 'rgba(200,170,110,0.32)' : 'rgba(255,255,255,0.1)';
        ctx.fill();
        ctx.font = `${k.length > 1 ? 30 : 36}px ${FONT}`; ctx.fillStyle = '#f0f0f0';
        ctx.textAlign = 'center'; ctx.fillText(this.label(k), x + kw / 2, y + this.keyH / 2 + 1); ctx.textAlign = 'left';
        this.rects.push({ x, y, w: kw, h: this.keyH, row: r, col: c, key: k });
        x += kw;
      });
    });
    this.panel.commit();
  }
  update(raycaster) {
    const input = G.input;
    if (!G.vr && this.input && document.activeElement !== this.input) this.input.focus();
    let changed = false;
    const dy = input.navY(), dx = input.navX();
    if (dy) { const r = Math.max(0, Math.min(this.rows.length - 1, this.row + dy)); if (r !== this.row) { this.col = this.nearestCol(r); this.row = r; changed = true; } }
    if (dx) { const n = this.keysOf(this.row).length; this.col = (this.col + dx + n) % n; changed = true; }
    if (raycaster) {
      const uv = this.panel.hit(raycaster);
      let hover = null;
      if (uv) {
        G.ui.pointerTarget = true;
        const px = uv.x * this.panel.canvas.width, py = (1 - uv.y) * this.panel.canvas.height;
        hover = this.rects.find(k => px >= k.x && px < k.x + k.w && py >= k.y && py < k.y + k.h) || null;
      }
      const key = hover ? `${hover.row}:${hover.col}` : null;
      // the laser picks the key it moves onto; the trigger presses the one under it
      if (this.hover === undefined) this.hover = key;
      else if (key !== this.hover) { this.hover = key; if (hover) { this.row = hover.row; this.col = hover.col; changed = true; } }
      if (hover && input.xrPressed('right', 0)) { this.row = hover.row; this.col = hover.col; this.press(hover.key); return true; }
    }
    if (changed) { this.draw(); G.audio?.playSystemSe(0); }
    if (G.vr && input.xrPressed('right', 4)) { this.press(this.keysOf(this.row)[this.col]); return true; }   // A: the key picked
    if (G.vr && input.xrPressed('right', 5)) { this.press('back'); return true; }                              // B: a letter back
    return false;
  }
}

// ------------------------------------------------------------------ UI
export class UI {
  constructor(scene, camera, rig) {
    this.scene = scene; this.camera = camera; this.rig = rig;
    this.root = new THREE.Group();          // world-space anchor in front of the user
    scene.add(this.root);
    // the message windows, in the original's pixels (MW canvas pixels each, PPM a metre): the message window (Window_Message,
    // the screen's width x 4 lines), the speaker's name (ネームウィンドウ), the choices (Window_ChoiceList - its other
    // questions, this version's, in the list's own windows 760 wide) and the gold (Window_Gold, opened by \$)
    this.msgPanel = new Panel(640 * MW, fittingHeight(4) * MW, 640 * MW / PPM);
    this.root.add(this.msgPanel.mesh);
    this.namePanel = new Panel(320 * MW, 28 * MW, 320 * MW / PPM);
    this.namePanel.mesh.renderOrder = 3101;
    this.root.add(this.namePanel.mesh);
    this.choice = new ListPanel(640 * MW, 6, 640 * MW / PPM, { fit: true, drawW: 760 });
    this.root.add(this.choice.panel.mesh);
    this.goldPanel = new Panel(160 * MW, fittingHeight(1) * MW, 160 * MW / PPM);
    this.root.add(this.goldPanel.mesh);
    // the scrolling text (startScroll): its pieces rise inside the mover, cut to the window's inside by two planes
    this.scrollGroup = new THREE.Group();
    this.scrollGroup.visible = false;
    this.scrollMover = new THREE.Group();
    this.scrollGroup.add(this.scrollMover);
    this.root.add(this.scrollGroup);
    this.scrollClip = [new THREE.Plane(), new THREE.Plane()];
    this.scroll = null;
    this.list = new ListPanel(980, 8, 0.98);
    this.root.add(this.list.panel.mesh);
    this.grid = new GridPanel(1260, 3, 6, 1.2);
    this.root.add(this.grid.panel.mesh);
    this.menuScreen = new MenuScreen(1.2);
    this.root.add(this.menuScreen.panel.mesh);
    this.keyboard = new KeyboardPanel();
    this.root.add(this.keyboard.panel.mesh);
    this.chatKeyboard = new KeyboardPanel(CHAT_ROWS, clipChat, cleanChat);      // (a chat line: coopchat.js)
    this.root.add(this.chatKeyboard.panel.mesh);
    this.bannerPanel = new Panel(1600, 260, 2.2);
    this.root.add(this.bannerPanel.mesh);
    this.toastPanel = new Panel(900, 300, 0.75);
    this.root.add(this.toastPanel.mesh);
    // the status panel: over all the world (PC and VR) - a raised shield, a wall, the marks over heads, skill animations -,
    // under the screen's tone, flash and fade as before (screen.js: 2990-3000) and the windows
    this.hud = new Panel(HUD_W * MS, (PAD * 2 + LINE * 4.5) * MS, HUD_M * HUD_W);       // (as tall as it gets: with the icons' row)
    this.hud.mesh.renderOrder = 2989;
    // (co-op) the voice chat marks just right of it, at its top (voicemarks.js - drawVoiceBadge): with it wherever it goes
    this.voiceBadge = new Panel(VOICE_BADGE[0], VOICE_BADGE[1], 0.17 * VOICE_BADGE[0] / 512);
    this.voiceBadge.mesh.renderOrder = this.hud.mesh.renderOrder;
    this.voiceBadge.mesh.position.set((this.hud.widthM + this.voiceBadge.widthM) / 2 + 0.17 * 10 / 512, (this.hud.heightM - this.voiceBadge.heightM) / 2 - 0.17 * 6 / 512, 0);
    this.hud.mesh.add(this.voiceBadge.mesh);
    this.voiceBadgeKey = '';
    this.raycaster = new THREE.Raycaster();
    this.pointerLine = null;
    this.msg = null;
    this.menuOpen = false;
    this.sceneOpen = null;
    this.prompt = null;                     // (co-op) join the boss fight? - askBossJoin
    this.remote = null;                     // (co-op) the host's message, to read - showRemoteMessage
    this.toasts = [];
    this.banner = null;
    this.nameWindowEnabled = true;
    this.nextName = null;
    this.numberRange = null;
    this.consumedConfirm = false;
    this.anchorYaw = null;
    this.hudDirty = true;
    this.lastHud = '';
  }

  // ---------------------------------------------------------------- placement
  // keep UI in front of the user; re-centre when they look away
  placeRoot(force = false) {
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const yaw = Math.atan2(-f.x, -f.z);
    if (this.anchorYaw === null || force) this.anchorYaw = yaw;
    let d = yaw - this.anchorYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.75) this.anchorYaw += d * 0.08;
    const dist = G.vr ? 1.35 : 1.15;
    const a = this.anchorYaw;
    this.root.position.set(head.x - Math.sin(a) * dist, head.y, head.z - Math.cos(a) * dist);
    this.root.rotation.set(0, a, 0);
  }

  attachHud(target) {
    if (this.hud.mesh.parent) this.hud.mesh.parent.remove(this.hud.mesh);
    this.hudFollow = target || null;
    if (target) {
      // VR: small panel floating just above the left controller, turned toward the eyes
      this.scene.add(this.hud.mesh);
      this.hud.mesh.scale.setScalar(1);
    } else {
      // PC: in the screen's bottom left corner (placeDeskHud: kept there as the window's shape changes)
      this.camera.add(this.hud.mesh);
      this.hud.mesh.rotation.set(0, 0, 0);
      this.placeDeskHud();
    }
    this.hud.mesh.visible = true;
  }
  // PC: the status panel in the bottom left corner of the screen, the window it draws a little in from both edges
  placeDeskHud() {
    const cam = this.camera, d = 0.6, p = this.hud;
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d, w = h * cam.aspect, gap = 0.025 * h;
    const k = DESK_HUD * HUD_W * h / p.widthM, drawn = p.heightM * (this.hudDrawn || p.canvas.height) / p.canvas.height;
    p.mesh.scale.setScalar(k);
    p.mesh.position.set(-w / 2 + gap + p.widthM * k / 2, -h / 2 + gap + (drawn - p.heightM / 2) * k, -d);
  }

  // ---------------------------------------------------------------- messages
  messageBusy() { return !!this.msg || !!this.banner?.blocking || !!G.arena?.busy; }
  sceneBusy() { return !!this.sceneOpen || this.menuOpen; }

  showMessage(msg) {
    if (msg.scroll) { this.msg = msg; msg.state = 'scroll'; this.startScroll(msg); return; }
    const banner = bannerOf(msg);
    if (banner) { this.showBanner(banner.text, banner.color, true); return; }
    this.msg = msg;
    msg.reveal = 0; msg.wait = 0; msg.fast = false; msg.state = 'typing';
    msg.ops = null;
    this.placeRoot(true);
    this.layoutMessage();
    this.drawMessage();
    this.msgPanel.mesh.visible = msg.lines.length > 0 || !msg.choices;
    if (msg.lines.length === 0) msg.state = 'done-typing';
  }
  speakerName(msg) {
    if (this.nextName) { const n = this.nextName; this.nextName = null; return n; }
    if (!this.nameWindowEnabled || !msg.face) return '';
    const names = G.scripts.names || {};
    let n = names[`${msg.face}_${msg.faceIndex}`] ?? names[msg.face] ?? '';
    const am = /^Actor\[(\d+)\]/.exec(n);
    if (am) n = G.state.actor(+am[1])?.name || '';
    return n.trim();
  }
  // The message window as the original's (Window_Message): the screen's width (BLACKSOULS II: 640) by 4 lines with its
  // padding (120), in the window skin - or its dim background (black at 160, fading at the top and foot), or nothing -;
  // the face (96 x 96) at its top left and the text 112 in from it (at the left with none), the game's font in its size
  // on 24-pixel lines; the pause sign at its foot while a key is awaited
  messageLayout(msg) {
    const W = screenW(), H = fittingHeight(4);
    return { W, H, x0: PAD + (msg?.face ? 112 : 0), y0: PAD, right: W - PAD };
  }
  // (msg: this player's own message, or the host's shown to a co-op guest - showRemoteMessage)
  layoutMessage(msg = this.msg) {
    const ctx = this.msgPanel.ctx;
    const L = this.messageLayout(msg);
    msg.ops = layoutText(msg.lines, L.x0 * MW, L.y0 * MW, MW, ctx, fontSize(), L.right * MW);
    msg.total = msg.ops.filter(o => o.k === 'ch' || o.k === 'icon').length;
    msg.name = msg.remote ? msg.name || '' : this.speakerName(msg);
    if (msg.face) loadCanvas('Graphics/Faces', msg.face).then(c => { msg.faceCanvas = c; if (this.msg === msg || (this.remote === msg && msg.shown)) this.drawMessage(msg); });
  }
  drawMessage(msg = this.msg) {
    if (!msg) return;
    const p = this.msgPanel, { ctx } = p, s = MW, { W, H } = this.messageLayout(msg);
    p.clear();
    if (msg.background === 1) dimBack(ctx, s, W, H);
    else if (msg.background !== 2) drawWindow(ctx, s, 0, 0, W, H);
    if (msg.faceCanvas) {
      const fi = msg.faceIndex || 0;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(msg.faceCanvas, (fi % 4) * 96, Math.floor(fi / 4) * 96, 96, 96, PAD * s, PAD * s, 96 * s, 96 * s);
    }
    drawOps(ctx, msg.ops, Math.floor(msg.reveal));
    if (msg.state === 'waitInput' || msg.state === 'pause') {
      msg.pauseAt ??= G.time;
      const f = (G.time - msg.pauseAt) * 60;
      drawPause(ctx, s, W, H, Math.floor(f / 8), Math.min(1, f / 8));
    } else msg.pauseAt = null;
    p.fit(W * s, H * s);
    p.commit();
    this.drawNameWindow(msg);
    this.layoutPanels(msg);
  }
  // the pause sign's frame (8 frames each, fading in over the first 8): the window drawn again when it changes
  pauseTick(msg) {
    const f = (G.time - (msg.pauseAt ?? G.time)) * 60;
    const key = f < 8 ? Math.floor(f / 2) : 4 + Math.floor(f / 8);
    if (key !== msg.pauseKey) { msg.pauseKey = key; this.drawMessage(msg); }
  }
  // The speaker's name (ネームウィンドウ, A1's): a window just round it - its letters (the script's NAME_FONT, 16 pixels)
  // and 8 more each way, 28 high -, the name white in its middle
  drawNameWindow(msg) {
    const np = this.namePanel, s = MW;
    np.clear();
    if (!msg.name) { np.mesh.visible = false; this.nameW = 0; return; }
    const ctx = np.ctx;
    ctx.font = gameFont(16 * s, NAME_FONT);
    const w = Math.min(320, Math.ceil(ctx.measureText(msg.name).width / s) + 16), h = 28;
    drawWindow(ctx, s, 0, 0, w, h);
    drawText(ctx, s, msg.name, 0, 0, w, h, 1, '#ffffff', { size: 16, font: NAME_FONT });
    np.fit(w * s, h * s);
    np.commit();
    np.mesh.visible = this.msgPanel.mesh.visible;
    this.nameW = w;
  }
  // the gold window (Window_Gold, opened by \$ in a message): the souls, the currency after them
  showGold() {
    const gp = this.goldPanel, s = MW, ctx = gp.ctx, unit = $data.system.currency_unit || '';
    gp.clear();
    drawWindow(ctx, s, 0, 0, 160, fittingHeight(1));
    ctx.font = gameFont(fontSize() * s);
    const cx = ctx.measureText(unit).width / s;
    drawText(ctx, s, G.state.party.gold, PAD + 4, PAD, 128 - cx - 2, LINE, 2, textColor(0));
    drawText(ctx, s, unit, PAD + 4, PAD, 128, LINE, 2, textColor(16));
    gp.commit();
    gp.mesh.visible = true;
    this.layoutPanels();
  }
  // Where the windows stand, as the original lays them: the message window at the screen's top, middle or foot (here
  // 0.22, -0.05 or -0.32 m from the eyes - the screen's 480 pixels so spread, 1.5 mm each); the name window beside the
  // face, 116 in, its top 16 over the window's (16 over the window's foot when that is at the top); the choices (and
  // this version's number input) at the right, over the window - under it when that is in the screen's top half -,
  // where it would be when only they are shown; the gold at the screen's top right (its foot right, the message
  // window at the top)
  layoutPanels(msg = this.msg) {
    const pos = msg?.position ?? 2, W = screenW(), H = fittingHeight(4), K = MW / PPM;
    const cy = pos === 0 ? 0.22 : pos === 1 ? -0.05 : -0.32;
    const left = -W * K / 2, top = cy + H * K / 2;
    const at = (mesh, x, y, w, h, z) => mesh.position.set(left + (x + w / 2) * K, top - (y + h / 2) * K, z);
    at(this.msgPanel.mesh, 0, 0, W, H, 0);
    if (this.nameW) at(this.namePanel.mesh, 116, pos === 0 ? H - 16 : -16, this.nameW, 28, 0.004);
    const [cw, ch] = this.choice.panel.shown.map(v => v / MW);
    at(this.choice.panel.mesh, W - cw, pos === 2 ? -ch : H, cw, ch, 0.01);
    const screenY = sy => 0.22 + (60 - sy) * 0.0015;
    this.goldPanel.mesh.position.set((W / 2 - 80) * K, screenY(pos === 0 ? screenH() - 24 : 24), 0.004);
  }
  closeMessage() {
    if (this.scroll?.msg === this.msg) this.endScroll();
    this.msg = null;
    this.msgPanel.mesh.visible = false;
    this.namePanel.mesh.visible = false;
    this.goldPanel.mesh.visible = false;
    this.choice.close();
    this.consumedConfirm = true;
    this.actionLockUntil = G.time + 0.25;
    if (this.remote) this.remote.shown = false;     // (the host's, if one is up, comes back on the window)
  }
  // ---- Show Scrolling Text (Window_ScrollText - the ending's staff roll, and three more): the whole screen's window,
  // unseen (no frame, no back), its lines in the game's font and codes 4 in from its padding, coming up from the
  // screen's foot and going off its top at speed / 2 pixels a frame - twice that while A (dash) or C (confirm) is held,
  // 25 while メッセージスキップ is held (PC Ctrl, VR A held - input.js skipHeld), unless the event says it may not be
  // hurried; the event goes on once the last line is gone. The screen here: 640 x 480 of the message windows' pixels,
  // its middle where the middle message window's is. The lines are drawn in pieces (SCROLL_PIECE high, only those in
  // sight) that rise together, cut to the window's inside by two clipping planes. (msg: this player's, or the host's
  // read by a co-op guest - its place kept: scrollOy)
  startScroll(msg) {
    this.endScroll();
    const s = MW, W = screenW();
    const ops = layoutText(msg.lines, (PAD + 4) * s, 0, s, this.msgPanel.ctx, fontSize(), (W - PAD - 4) * s);
    this.scroll = { msg, ops, height: ops.height / s + 1, oy: msg.scrollOy ?? -screenH(), pieces: new Map() };
    if (G.three?.renderer) G.three.renderer.localClippingEnabled = true;
    this.placeRoot(true);
    this.scrollGroup.visible = true;
    this.layoutScroll();
  }
  // one frame of it (fast: this player's own - it may hurry it); true once its last line has gone
  updateScroll(dt, fast = true) {
    const sc = this.scroll, msg = sc.msg, input = G.input;
    const hurry = fast && !msg.noFast;
    const skip = hurry && input.skipHeld();
    const rate = skip ? 25 : (msg.speed || 2) * (hurry && (input.rmButton(11) || input.rmButton(13)) ? 1 : 0.5);
    sc.oy += rate * 60 * Math.min(dt, 0.1);
    msg.scrollOy = sc.oy;
    this.layoutScroll();
    return sc.oy >= sc.height;
  }
  layoutScroll() {
    const sc = this.scroll, W = screenW(), H = screenH(), K = MW / PPM;
    // the screen's top left (its middle where the middle message window's is - layoutPanels), the lines' top 12 - oy under it
    this.scrollGroup.position.set(-W * K / 2, -0.05 + H * K / 2, 0.02);
    this.scrollMover.position.y = -(PAD - sc.oy) * K;
    const first = Math.max(0, Math.floor(sc.oy / SCROLL_PIECE)), last = Math.min(Math.ceil(sc.height / SCROLL_PIECE) - 1, Math.floor((sc.oy + H) / SCROLL_PIECE));
    for (const [k, mesh] of sc.pieces) if (k < first || k > last) { this.dropPiece(mesh); sc.pieces.delete(k); }
    for (let k = first; k <= last; k++) if (!sc.pieces.has(k)) sc.pieces.set(k, this.scrollPiece(k));
    // the window's inside: from its padding under the top to its padding over the foot (world planes, as it stands now)
    const g = this.scrollGroup;
    g.updateWorldMatrix(true, false);
    this.scrollClip[0].set(new THREE.Vector3(0, -1, 0), -PAD * K).applyMatrix4(g.matrixWorld);
    this.scrollClip[1].set(new THREE.Vector3(0, 1, 0), (H - PAD) * K).applyMatrix4(g.matrixWorld);
  }
  // the lines' piece k (SCROLL_PIECE original pixels from k times that)
  scrollPiece(k) {
    const sc = this.scroll, s = MW, W = screenW(), K = MW / PPM;
    const canvas = document.createElement('canvas');
    canvas.width = W * s; canvas.height = SCROLL_PIECE * s;
    const ctx = canvas.getContext('2d'), top = k * SCROLL_PIECE * s, bottom = top + SCROLL_PIECE * s;
    ctx.translate(0, -top);
    drawOps(ctx, sc.ops.filter(o => o.y !== undefined && o.y < bottom && o.y + 96 * s > top), Infinity);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * K, SCROLL_PIECE * K),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, clippingPlanes: this.scrollClip }));
    mesh.renderOrder = 3100;
    mesh.position.set(W * K / 2, -(k + 0.5) * SCROLL_PIECE * K, 0);
    this.scrollMover.add(mesh);
    return mesh;
  }
  dropPiece(mesh) {
    this.scrollMover.remove(mesh);
    mesh.material.map.dispose(); mesh.material.dispose(); mesh.geometry.dispose();
  }
  endScroll() {
    const sc = this.scroll;
    this.scroll = null;
    this.scrollGroup.visible = false;
    if (sc) for (const mesh of sc.pieces.values()) this.dropPiece(mesh);
  }
  // ---- a boss fight began in the co-op host's world without this player (coop.js onJoinAsk): join it? Asked over the
  // play, which goes on meanwhile (nothing pauses for it) - this player stands still while answering, and it steps aside
  // for this player's own menu or message. No answer in BOSS_ASK s is no (the co-op menu can still join it) - counted
  // only while it is up to be answered
  // (title / yes / no: another question of the kind - the host asked to come to a guest's boss fight on another map)
  askBossJoin(answer, { title = null, yes = null, no = null, wait = BOSS_ASK } = {}) {
    const old = this.prompt;
    this.closeBossPrompt();
    this.prompt = { answer, left: wait, shown: false, title, yes, no };
    old?.answer(false);                     // (one asked before and not answered yet: as if declined)
  }
  closeBossPrompt() {
    const p = this.prompt;
    this.prompt = null;
    if (p?.shown && this.msg?.state !== 'choice') this.choice.close();
  }
  updateBossPrompt(dt) {
    const p = this.prompt;
    if (!p) return;
    if (this.msg || this.menuOpen || this.sceneOpen) { if (p.shown) { p.shown = false; if (this.msg?.state !== 'choice') this.choice.close(); } return; }
    if ((p.left -= dt) <= 0) { this.closeBossPrompt(); p.answer(false); return; }
    if (!p.shown) {
      p.shown = true;
      this.placeRoot(true);
      this.choice.open(p.title || tr('보스전이 시작되었습니다. 참여하시겠습니까?'), [{ text: p.yes || tr('참여한다') }, { text: p.no || tr('참여하지 않는다') }], {
        index: 0,
        onSelect: i => { this.closeBossPrompt(); p.answer(i === 0); },
        onCancel: () => { this.closeBossPrompt(); p.answer(false); },
      });
      this.choice.panel.mesh.visible = true;
      this.choice.panel.mesh.position.set(0, -0.05, 0);
    }
    this.choice.update(this.pointerRay());
    this.consumedConfirm = true;
  }
  // ---- the host's message (a co-op guest - coop.js): what the host is reading shows here too, only to be read. It
  // types out and goes away as the host's does (its choices: the host picks), never holds this player up (walking, the
  // menu) and gives the window over to anything of this player's own meanwhile
  showRemoteMessage(m) {
    this.closeRemoteMessage();
    this.remote = { ...m, remote: true, reveal: 0, ops: null, total: 0, shown: false, choiceUp: false };
  }
  closeRemoteMessage() {
    const r = this.remote;
    this.remote = null;
    if (r && this.scroll?.msg === r) this.endScroll();
    if (!r?.shown) return;
    if (!this.msg) { this.msgPanel.mesh.visible = false; this.namePanel.mesh.visible = false; }
    if (r.choiceUp && this.msg?.state !== 'choice') this.choice.close();
  }
  updateRemote(dt = 0) {
    const r = this.remote;
    if (!r) return;
    if (this.msg || this.menuOpen || this.sceneOpen || this.prompt?.shown) {
      if (this.scroll?.msg === r) this.endScroll();
      if (r.shown && !r.scroll) {
        if (!this.msg) { this.msgPanel.mesh.visible = false; this.namePanel.mesh.visible = false; }
        if (r.choiceUp && this.msg?.state !== 'choice' && !this.prompt?.shown) this.choice.close();
      }
      r.shown = false; r.choiceUp = false;
      return;
    }
    // (the host's scrolling text: rising as there, from where it had got to - not hurried here; gone when it is gone)
    if (r.scroll) {
      if (!r.shown) { r.shown = true; this.startScroll(r); }
      else if (this.scroll?.msg === r && this.updateScroll(dt, false)) this.endScroll();
      return;
    }
    if (!r.shown) {
      r.shown = true;
      this.placeRoot(true);
      if (!r.ops) this.layoutMessage(r);
      this.msgPanel.mesh.visible = r.lines.length > 0 || !r.choices;
      this.drawMessage(r);
    }
    if (r.reveal < r.total) { r.reveal = Math.min(r.total, r.reveal + 2); this.drawMessage(r); }
    else if (r.choices && !r.choiceUp) {
      r.choiceUp = true;
      this.choice.open('', r.choices.map(c => ({ text: c.text, enabled: true })), { index: -1, look: 'choice', onSelect: () => {}, onCancel: () => {} });
      this.choice.panel.mesh.visible = true;
      this.layoutPanels(r);
    }
  }
  updateMessage(dt = 0) {
    const msg = this.msg;
    const input = G.input;
    if (msg.state === 'scroll') {
      if (this.scroll?.msg !== msg || this.updateScroll(dt)) this.closeMessage();
      this.consumedConfirm = true;
      return;
    }
    // (the laser on the message window: the right trigger moves it on as A does - as on every other window)
    const ray = this.pointerRay();
    if (ray && (this.msgPanel.hit(ray) || this.namePanel.hit(ray))) this.pointerTarget = true;
    // (メッセージスキップ held: each message at once and on to the next - a choice or a number still waits)
    const skip = input.skipHeld();
    if (msg.state === 'typing') {
      if (input.advance() || skip) { this.consumedConfirm = true; msg.skip = true; msg.wait = 0; }
      if (msg.wait > 0) { msg.wait--; return; }
      msg.cursor ??= 0;
      let budget = (msg.skip || msg.instant) ? Infinity : 2;
      while (msg.cursor < msg.ops.length) {
        const o = msg.ops[msg.cursor];
        if (o.k === 'ch' || o.k === 'icon') {
          if (budget <= 0) break;
          msg.reveal++; budget--; msg.cursor++;
          continue;
        }
        msg.cursor++;
        if (o.k === 'wait') { if (!msg.skip) { msg.wait = o.f; break; } }
        else if (o.k === 'input') { msg.state = 'pause'; break; }
        else if (o.k === 'fast') msg.instant = o.on;
        else if (o.k === 'noinput') msg.noInput = true;
        else if (o.k === 'gold') this.showGold();
      }
      if (msg.cursor >= msg.ops.length && msg.state === 'typing') msg.state = 'done-typing';
      this.drawMessage();
      return;
    }
    if (msg.state === 'pause') {
      if (input.advance() || skip) { this.consumedConfirm = true; msg.state = 'typing'; msg.skip = skip; }
      else this.pauseTick(msg);
      return;
    }
    if (msg.state === 'done-typing') {
      if (msg.choices) {
        msg.state = 'choice';
        this.choice.open('', msg.choices.map(c => ({ text: c.text, enabled: c.enabled })), {
          index: -1, look: 'choice',
          onSelect: i => { msg.onChoice?.(i); this.closeMessage(); },
          onCancel: () => { if (msg.cancelable) { msg.onChoice?.(-1); this.closeMessage(); } },
        });
        this.choice.panel.mesh.visible = true;
        this.layoutPanels();
        return;
      }
      if (msg.number) { msg.state = 'number'; this.drawNumber(); return; }
      msg.state = 'waitInput';
      msg.waitAt = G.time;
      if (msg.noInput) { this.closeMessage(); return; }
    }
    if (msg.state === 'waitInput') {
      if (input.advance() || input.cancel() || (skip && G.time - (msg.waitAt ?? 0) >= SKIP_DWELL)) { this.closeMessage(); return; }
      this.pauseTick(msg);
      return;
    }
    if (msg.state === 'choice') {
      this.choice.update(this.pointerRay());
      this.consumedConfirm = true;
      return;
    }
    if (msg.state === 'number') { this.updateNumber(); this.consumedConfirm = true; }
  }
  // Number input (Input Number, e.g. how many souls to give at a level-up): like the original, the stick
  // picks a digit (left / right) and turns it (up / down, repeating while held); the laser can pick
  // "all" (the range's maximum), 0 or OK.
  drawNumber() {
    const n = this.msg.number;
    const [min, max] = n.range || [0, 10 ** n.digits - 1];
    n.min = min; n.max = Math.min(max, 10 ** n.digits - 1);
    n.value = Math.max(n.min, Math.min(n.max, n.value));
    if (n.cursor === undefined) n.cursor = Math.max(0, Math.min(n.digits - 1, Math.floor(Math.log10(Math.max(1, n.max)))));
    const digits = String(n.value).padStart(n.digits, '0').split('');
    const at = n.digits - 1 - n.cursor;
    // (in groups: an IP address's four numbers with dots between)
    const shown = digits.map((d, i) => (i === at ? `[${d}]` : ` ${d} `) + (n.group && i % n.group === n.group - 1 && i < n.digits - 1 ? '.' : '')).join('');
    // (a room code: only its digits and OK)
    const items = n.code ? [{ text: shown }, { text: tr('결정') }] : [
      { text: shown, right: `×${(10 ** n.cursor).toLocaleString()}` },
      { text: tr('최대 (전부)'), right: n.max.toLocaleString() },
      { text: '0', right: '' },
      { text: tr('결정'), right: n.value.toLocaleString() },
    ];
    const index = this.choice.visible && this.choice.items.length === items.length ? Math.max(0, this.choice.index) : 0;
    this.choice.open(n.code ? n.title || '' : tr('수량 / 숫자 입력'), items, {
      index,
      footer: G.vr ? tr('스틱 좌우: 자릿수 · 상하: 값 · A/트리거: 결정') : n.code ? tr('←→ 자릿수 · ↑↓ 값 · Enter 결정') : tr('←→ 자릿수 · ↑↓ 값 · Home 최대 · End 0 · Enter 결정'),
    });
    this.layoutPanels();
  }
  numberDone() {
    const n = this.msg.number;
    if (n.onDone) { this.closeMessage(); n.onDone(n.value); return; }
    G.state.setV(n.varId, n.value);
    this.closeMessage();
  }
  updateNumber() {
    const n = this.msg.number;
    const input = G.input;
    let move = 0, turn = 0;
    if (G.vr) {
      const [x, y] = input.axes.right;
      if (Math.abs(x) > 0.6 && Math.abs(x) > Math.abs(y)) { if (this.numReady) { move = Math.sign(x); this.numReady = false; } }
      else if (Math.abs(x) < 0.35) this.numReady = true;
      if (Math.abs(y) > 0.6 && Math.abs(y) >= Math.abs(x)) {
        const dir = -Math.sign(y);
        if (n.holdDir !== dir) { n.holdDir = dir; n.nextTurn = G.time + 0.35; turn = dir; }
        else if (G.time >= n.nextTurn) { n.nextTurn = G.time + 0.07; turn = dir; }
      } else if (Math.abs(y) < 0.35) n.holdDir = 0;
    } else {
      if (input.keyPressed('ArrowRight') || input.keyPressed('KeyD')) move = 1;
      if (input.keyPressed('ArrowLeft') || input.keyPressed('KeyA')) move = -1;
      if (input.keyPressed('ArrowUp') || input.keyPressed('KeyW')) turn = 1;
      if (input.keyPressed('ArrowDown') || input.keyPressed('KeyS')) turn = -1;
      if (input.keyPressed('Home')) { n.value = n.max; this.drawNumber(); }
      if (input.keyPressed('End')) { n.value = n.min; this.drawNumber(); }
    }
    let changed = false;
    if (move) { n.cursor = Math.max(0, Math.min(n.digits - 1, n.cursor - move)); changed = true; }
    if (turn) {
      // (a digit turns round by itself - 9 to 0, 0 to 9 - as the original's: the others stay as they are)
      const place = 10 ** n.cursor, d = Math.floor(n.value / place) % 10;
      n.value = Math.max(n.min, Math.min(n.max, n.value + ((((d + turn) % 10) + 10) % 10 - d) * place));
      changed = true;
    }
    // the laser: hover picks a row, the trigger uses it
    let pick = -1;
    const ray = this.pointerRay();
    if (ray) {
      const uv = this.choice.panel.hit(ray);
      if (uv) {
        this.pointerTarget = true;
        const r = this.choice.rowAt(uv);
        if (r >= 0 && r < this.choice.items.length) {
          if (r !== this.choice.index) { this.choice.index = r; changed = true; }
          if (input.xrPressed('right', 0)) pick = r;
        }
      }
    }
    if (changed) { this.drawNumber(); G.audio?.playSystemSe(0); }
    if (n.code) {
      if (pick >= 0 || input.xrPressed('right', 4) || (!G.vr && input.confirm())) { G.audio?.playSystemSe(1); this.numberDone(); return; }
      if (input.cancel()) { G.audio?.playSystemSe(2); this.closeMessage(); n.onCancel?.(); }
      return;
    }
    if (pick === 1) { n.value = n.max; this.drawNumber(); G.audio?.playSystemSe(1); return; }
    if (pick === 2) { n.value = n.min; this.drawNumber(); G.audio?.playSystemSe(1); return; }
    if (pick === 0 || pick === 3 || input.xrPressed('right', 4) || (!G.vr && input.confirm())) { G.audio?.playSystemSe(1); this.numberDone(); return; }
    if (input.cancel()) { G.audio?.playSystemSe(2); this.numberDone(); }
  }

  // ---------------------------------------------------------------- co-op (coop.js)
  // open this world (on this PC's co-op server, or one elsewhere), go into a friend's world (a server from the list, or
  // a new one: its IP, port and PIN), or end it
  showCoopMenu(index = 0) {
    const c = G.coop, items = [];
    const note = this.coopNote(c.lastError, c.lastServer);
    c.lastError = '';
    if (!c.active) {
      // (the community servers: those this game came with - devserver.json, always here -, then those this player added:
      // its IP, port and PIN - anyone may run one, community_server.cmd)
      c.devServers.forEach((s, i) => { if (s) items.push({ text: tr('커뮤니티 서버 {n}', { n: i + 1 }), id: 'dev', dev: i, desc: tr('모두가 함께하는 하나의 세계') }); });
      const added = this.communityServers();
      for (const s of added) items.push({ text: tr('커뮤니티 서버 {n}', { n: `${s.ip}:${s.port}` }), id: 'dev', dev: s, desc: tr('모두가 함께하는 하나의 세계') });
      items.push({ text: tr('커뮤니티 서버 추가 (IP·포트·PIN 입력)'), id: 'dev-add', desc: tr('다른 사람이 켠 커뮤니티 서버로 들어갑니다') });
      if (added.length) items.push({ text: tr('추가한 커뮤니티 서버 목록 비우기'), id: 'dev-clear' });
      items.push({ text: tr('내 세계 열기 (이 PC의 협력 서버)'), id: 'host-here', desc: tr('이 PC에서 협력 서버(coop_server)를 켜 두면 친구가 이 세계에 올 수 있습니다') });
      items.push({ text: tr('친구의 세계로 가기'), id: 'visit', desc: tr('친구가 켠 협력 서버로 들어갑니다') });
      items.push({ text: tr('내 세계 열기 (다른 곳의 협력 서버)'), id: 'host-there', desc: tr('외부 서버에서 열면 다른 사람들이 내 IP를 모릅니다') });
      items.push(...this.coopSelfRows(), this.coopBanRow());
    } else if (c.role === 'world') {
      const n = c.members().length;
      const d = c.worldName();
      const state = { connecting: tr('커뮤니티 서버 {d}에 연결하는 중...', { d }), choosing: tr('커뮤니티 서버 {d}: 시작 방법을 골라 주세요', { d }), prologue: tr('커뮤니티 서버 {d}: 오프닝 (도서관의 꿈에 오면 세계에 들어갑니다)', { d }),
        joining: tr('커뮤니티 서버 {d}: 세계에 들어가는 중...', { d }), in: tr('커뮤니티 서버 {d} ({n}명)', { d, n }) }[c.wphase] || tr('커뮤니티 서버 {d}', { d });
      items.push({ text: state, id: c.wphase === 'choosing' ? 'world-start' : 'status' });
      if (c.wphase !== 'connecting') items.push(this.coopMembersRow(), ...this.worldRuleRows());
      // (each player's own PvP: those who both turned it on may strike each other)
      if (c.world) items.push({ text: c.myPvp ? tr('내 PvP: 켜짐 (켠 사람끼리 공격할 수 있음)') : tr('내 PvP: 꺼짐'), id: 'my-pvp', desc: tr('고르면 바뀝니다 (켜면 이름 위에 붉은 PVP가 보입니다)') });
      if (!c.spectating && c.outOfBossFight()) items.push({ text: tr('보스전에 참여하기'), id: 'join-boss', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      items.push({ text: tr('커뮤니티 서버에서 나가기'), id: 'end', desc: tr('내 세계로 돌아갑니다') });
      items.push(...this.coopSelfRows());
    } else if (c.role === 'host') {
      const n = c.guests().length;
      items.push({ text: n ? tr('내 세계에 {n}명이 와 있습니다', { n }) : tr('내 세계를 열어 두었습니다'), id: 'players',
        desc: c.link?.open === false ? tr('연결하는 중...') : n ? tr('고르면 와 있는 사람 (내보내기·차단)') : tr('친구를 기다리는 중...') });
      // (a boss fight a guest began, which this player did not join: it may still)
      const b = c.bossFightOn();
      if (b && !b.coopIn.has('host')) items.push({ text: tr('보스전에 참여하기'), id: 'host-join', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      items.push(this.coopMembersRow(), ...this.coopRuleRows(true));
      items.push(this.coopBanRow(), ...this.coopSelfRows());
      items.push({ text: tr('방 닫기'), id: 'end', desc: tr('와 있는 사람은 자기 세계로 돌아갑니다') });
    } else {
      items.push({ text: tr('내 세계로 돌아가기'), id: 'end', desc: c.phantom ? '' : tr('연결하는 중...') });
      // (a boss fight of the host's this guest did not join: it may still; to the host's side, from wherever it is)
      if (!c.spectating && c.outOfBossFight()) items.push({ text: tr('보스전에 참여하기'), id: 'join-boss', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      if (c.phantom && !c.spectating) items.push({ text: tr('호스트 곁으로 가기'), id: 'go-host', desc: tr('호스트가 있는 곳으로 갑니다') });
      if (c.phantom) items.push(this.coopMembersRow(), ...this.coopRuleRows(false));
      items.push(...this.coopSelfRows());
    }
    if (note) items[0].desc = note;           // (shown where the first row's line is - the row the menu opens on)
    // (the co-op server is older than this game: its rules and defaults are not this game's)
    if (c.active && c.serverOld) {
      items.splice(1, 0, c.role === 'world' ? { text: tr('커뮤니티 서버가 예전 버전입니다'), id: 'server-old', desc: tr('서버의 world_server.py와 coop_server.py를 이 게임의 것으로 바꾸고 다시 켜 주세요') }
        : { text: tr('협력 서버가 예전 버전입니다'), id: 'server-old', desc: tr('서버의 coop_server.py를 이 게임의 것으로 바꾸고 다시 켜 주세요') });
    }
    this.list.open(tr('협력'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'dev') this.coopNameFirst().then(ok => { if (ok && c.joinWorld(it.dev)) this.closeMenu(); });
        else if (it.id === 'dev-add') this.coopNameFirst().then(ok => { if (ok) this.addCommunityServer(); });
        else if (it.id === 'dev-clear') { G.settings.communityServers = []; G.saveSettings?.(); this.showCoopMenu(); }
        else if (it.id === 'world-start') this.showWorldStart();
        else if (it.id === 'members') this.showCoopMembers();
        else if (it.id === 'host-here') this.coopNameFirst().then(ok => { if (ok) { c.openWorld({ local: true, port: G.settings.coopPort || G.coop.defaultPort }); this.closeMenu(); } });
        else if (it.id === 'visit') this.coopNameFirst().then(ok => { if (ok) this.showCoopServers('visit'); });
        else if (it.id === 'host-there') this.coopNameFirst().then(ok => { if (ok) this.showCoopServers('host'); });
        else if (it.id === 'players') this.showCoopPlayers();
        else if (it.id === 'bans') this.showCoopBans();
        else if (it.id === 'name') this.changeCoopName(i);
        else if (it.id === 'names') { G.settings.coopNames = G.settings.coopNames === false; G.saveSettings?.(); this.showCoopMenu(i); }
        else if (it.id === 'chat') this.showChatMenu();
        else if (it.id === 'end') { c.end('menu'); this.closeMenu(); }
        else if (it.id === 'join-boss') { c.joinBossFight(); this.closeMenu(); }
        else if (it.id === 'host-join') { c.hostJoin(); this.closeMenu(); }
        else if (it.id === 'go-host') { c.goToHost(); this.closeMenu(); }
        // (the server's rules: the host changes them here - a guest only sees them)
        // (an older co-op server knows no rules: the buzzer)
        else if (it.id === 'rule-max') { if (!c.setRule('maxPlayers', c.rules.maxPlayers >= 8 ? 2 : c.rules.maxPlayers + 1)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-boss') { if (!c.setRule('guestStartsBoss', !c.rules.guestStartsBoss)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-pvp') { if (!c.setRule('pvp', !c.rules.pvp)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-respawn') { if (!c.setRule('guestRespawn', !c.rules.guestRespawn)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-spectate') { if (!c.setRule('bossSpectate', !c.rules.bossSpectate)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-sync') { if (!c.setRule('statSync', !c.rules.statSync)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-follow') { if (!c.setRule('guestsFollow', !c.rules.guestsFollow)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-bossscale') { if (!c.setRule('bossScale', !c.rules.bossScale)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'pin') this.changeCoopPin(i);
        // (the developer's world: its rules - the admin changes them, for everyone at once; the menu shows them as the
        // server says them back)
        else if (it.id === 'wrule-max') { if (!c.setWorldRule('maxPlayers', c.rules.maxPlayers >= 16 ? 2 : c.rules.maxPlayers + 1)) G.audio?.playSystemSe(3); }
        else if (it.id === 'my-pvp') { if (!c.setMyPvp(!c.myPvp)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'wrule-spectate') { if (!c.setWorldRule('bossSpectate', !c.rules.bossSpectate)) G.audio?.playSystemSe(3); }
        else if (it.id === 'wrule-scale') { if (!c.setWorldRule('bossScale', !c.rules.bossScale)) G.audio?.playSystemSe(3); }
        else if (it.id === 'wrule-loot') { if (!c.setWorldRule('shareLoot', !c.rules.shareLoot)) G.audio?.playSystemSe(3); }
        else if (it.id === 'admin') this.enterAdminPin(i);
        else this.showCoopMenu(i);             // (the status row: looks again)
      },
      onAdjust: dx => {
        const it = this.list.items[this.list.index];
        if (it?.id === 'wrule-max') {
          if (!c.setWorldRule('maxPlayers', Math.max(2, Math.min(16, c.rules.maxPlayers + dx)))) G.audio?.playSystemSe(3);
          return true;
        }
        if (it?.id !== 'rule-max') return false;
        if (!c.setRule('maxPlayers', Math.max(2, Math.min(8, c.rules.maxPlayers + dx)))) G.audio?.playSystemSe(3);
        this.showCoopMenu(this.list.index);
        return true;
      },
      onCancel: () => this.reopenMain('coop'),
    });
  }
  // the rules of this co-op session (the server's, coop.js rules): rows the host changes, or a guest only reads - and,
  // for the host, the server's join PIN
  coopRuleRows(host) {
    const r = G.coop.rules, desc = host ? tr('고르면 바뀝니다 (서버 규칙, 바로 적용)') : tr('서버 규칙 (호스트가 정함)');
    const rows = [
      { text: tr('최대 인원: {n}명', { n: r.maxPlayers }), id: 'rule-max', desc, enabled: host },
      { text: r.guestStartsBoss ? tr('게스트도 보스전을 먼저 시작할 수 있음') : tr('보스전은 호스트가 먼저 시작'), id: 'rule-boss', desc, enabled: host },
      { text: r.pvp ? tr('PvP: 플레이어끼리 공격할 수 있음') : tr('PvP: 플레이어끼리 공격할 수 없음'), id: 'rule-pvp', desc, enabled: host },
      { text: r.guestRespawn ? tr('게스트가 쓰러지면 화톳불에서 부활') : tr('게스트가 쓰러지면 자기 세계로'), id: 'rule-respawn', desc, enabled: host },
      { text: r.bossSpectate ? tr('보스전에서 쓰러지면 관전') : tr('보스전에서 쓰러져도 관전 없음'), id: 'rule-spectate', desc, enabled: host },
      { text: r.statSync ? tr('스펙 보정: 게스트를 호스트에 맞춤') : tr('스펙 보정 없음'), id: 'rule-sync', desc: this.syncDesc(desc), enabled: host },
      { text: r.guestsFollow ? tr('게스트가 호스트를 따라 맵 이동') : tr('게스트는 맵을 따로 이동'), id: 'rule-follow', desc, enabled: host },
      { text: r.bossScale ? tr('보스 강화: 참가 인원만큼 HP·MP·그로기 증가') : tr('보스 강화 없음'), id: 'rule-bossscale', desc, enabled: host },
    ];
    const pin = host && G.coop.serverPin;
    if (pin) rows.push({ text: tr('접속 PIN: {pin}', { pin }), id: 'pin', desc: tr('고르면 바꿉니다 (지금 와 있는 사람은 그대로)') });
    return rows;
  }
  // (a guest whose numbers are brought to the host's: by how much)
  syncDesc(desc) {
    const f = G.coop.syncFactors?.(), x = v => (v >= 0.01 ? v.toFixed(2) : v.toPrecision(2));
    return f ? tr('내 능력치 ×{p} · HP ×{hp} · MP ×{mp} (장비·서약 제외)', { p: x(f.p), hp: x(f.hp), mp: x(f.mp) }) : desc;
  }
  // (the developer's world) its rules as the server says them: the admin changes them here; the others only read them -
  // and may prove the admin PIN
  worldRuleRows() {
    const c = G.coop, r = c.rules, admin = c.isAdmin;
    const desc = admin ? tr('고르면 바뀝니다 (모두에게 바로 적용)') : tr('서버 규칙 (관리자가 정함)');
    const rows = [
      { text: tr('최대 인원: {n}명', { n: r.maxPlayers }), id: 'wrule-max', desc, enabled: admin },
      { text: r.bossSpectate ? tr('보스전에서 쓰러지면 관전') : tr('보스전에서 쓰러져도 관전 없음'), id: 'wrule-spectate', desc, enabled: admin },
      { text: r.bossScale ? tr('보스 강화: 참가 인원만큼 HP·MP·그로기 증가') : tr('보스 강화 없음'), id: 'wrule-scale', desc, enabled: admin },
      { text: r.shareLoot ? tr('아이템 공유: 누가 얻든 모두가 같이 받음') : tr('아이템 공유 없음 (얻은 사람만)'), id: 'wrule-loot', desc, enabled: admin },
    ];
    if (!admin) rows.push({ text: tr('관리자 PIN 입력'), id: 'admin', desc: tr('규칙을 바꾸려면 서버의 관리자 PIN을 넣으세요') });
    return rows;
  }
  async enterAdminPin(index) {
    const v = await this.askNumber(tr('관리자 PIN'), tr('서버 창(world.log)에 나오는 관리자 PIN (12자리)'), 12, 0, 3);
    if (v !== null) G.coop.adminLogin({ pin: String(v).padStart(12, '0') });
    this.showCoopMenu(index);
  }
  // everyone on this session and where each one is (the map's name)
  coopMembersRow() { return { text: tr('멤버 ({n}명)', { n: G.coop.members().length }), id: 'members', desc: tr('고르면 모두의 위치를 봅니다') }; }
  showCoopMembers(index = 0) {
    const c = G.coop;
    const where = m => (m.map > 0 ? mapName(m.map) || `#${m.map}` : c.role === 'world' ? tr('오프닝·이동 중') : tr('이동 중'));
    const items = c.members().map(m => ({ text: m.me ? tr('{name} (나)', { name: m.name }) : c.muted(m.id) ? tr('{name} (음소거)', { name: m.name }) : m.name,
      right: where(m), desc: m.host ? tr('호스트') : !m.me ? tr('고르면 음소거하거나 아이템·소울을 줄 수 있습니다') : '', id: m.id, me: m.me, name: m.name }));
    this.list.open(tr('멤버'), items, {
      index: Math.min(index, items.length - 1),
      // (the developer's world: another one - give it something; else looks again: where they are now)
      onSelect: (i, it) => { if (!it.me) this.showMemberActions(it.id, it.name, i); else this.showCoopMembers(i); },
      onCancel: () => this.showCoopMenu(0),
    });
  }
  // one of the others picked: mute it (its chat lines and voice - kept by its tag), or (the community server) give it
  // something
  showMemberActions(id, name, back = 0) {
    const c = G.coop, tag = c.chatTag(id), muted = c.muted(id);
    const rows = [{ text: muted ? tr('음소거 풀기') : tr('음소거'), id: 'mute', enabled: !!tag, desc: tr('이 사람의 채팅과 목소리') }];
    if (c.world) rows.push({ text: tr('아이템·소울 주기'), id: 'give' });
    this.list.open(name, rows, {
      onSelect: (i, it) => {
        if (it.id === 'give') { this.showGiveItems(id, name, back); return; }
        const list = (Array.isArray(G.settings.chatMuted) ? G.settings.chatMuted : []).filter(t => t !== tag);
        G.settings.chatMuted = muted ? list : [...list, tag].slice(-100);
        G.saveSettings?.();
        if (!muted) G.voice?.drop(id);
        this.showCoopMembers(back);
      },
      onCancel: () => this.showCoopMembers(back),
    });
  }
  // (the developer's world) what of this bag may be given to that one: its things (not the key items), weapons and
  // armor not worn - one picked, how many, and it is asked
  showGiveItems(to, name, back = 0) {
    const c = G.coop, P = G.state.party, rows = [];
    if (P.gold > 0) rows.push({ text: tr('소울'), right: P.gold.toLocaleString(), kind: 'gold', id: 0, n: P.gold });
    for (const kind of ['item', 'weapon', 'armor']) {
      for (const [id, n] of [...P.container(kind)].sort((x, y) => x[0] - y[0])) {          // (by number, as the item lists)
        if (n > 0 && c.giveable(kind, id)) { const d = itemData(kind, id); rows.push({ text: d.name, icon: d.icon_index, right: String(n), desc: d.description, kind, id, n }); }
      }
    }
    if (!rows.length) { this.toast(tr('줄 수 있는 것이 없습니다')); this.showCoopMembers(back); return; }
    this.list.open(tr('{name} 님에게 줄 것', { name }), rows, {
      onSelect: async (i, it) => {
        let n = 1;
        if (it.n > 1) {
          const max = Math.min(c.giveMax(it.kind), it.n);
          const v = await this.askNumber(it.kind === 'gold' ? tr('얼마를 줄까요?') : tr('몇 개를 줄까요?'), `${it.text} (${it.n})`, String(max).length, 1);
          if (v === null || v < 1) { this.showGiveItems(to, name, back); return; }
          n = Math.min(v, max);
        }
        if (c.giveItem(to, it.kind, it.id, n)) this.toast(tr('{name} 님에게 보냈습니다 (받으면 옮겨집니다)', { name }));
        else G.audio?.playSystemSe(3);
        this.showCoopMembers(back);
      },
      onCancel: () => this.showCoopMembers(back),
    });
  }
  // (the developer's world - coop.js) how this player comes in: from the beginning (the opening alone, into the world at
  // its first bonfire), a save of this game's own (its character), or one of its community-server saves (kept on this PC
  // apart from the game's own) - always at 도서관의 꿈
  async showWorldStart() {
    const c = G.coop;
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    const kept = (await G.listSaves?.('world')) || [];
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    this.menuOpen = true;
    this.placeRoot(true);
    this.list.open(tr('커뮤니티 서버 {d}', { d: c.worldName() }), [
      { text: tr('처음부터'), id: 'new', desc: tr('오프닝을 혼자 진행하고, 도서관의 꿈에 오면 세계에 들어갑니다') },
      { text: tr('세이브 불러오기'), id: 'own', desc: tr('내 세이브의 캐릭터로 들어갑니다') },
      { text: tr('서버 세이브 불러오기'), id: 'world', desc: tr('커뮤니티 서버 세이브로 이어서 합니다'), enabled: kept.length > 0 },
    ], {
      onSelect: (i, it) => {
        if (it.id === 'new') { this.closeMenu(); c.worldNew(); } else this.showWorldLoad(it.id);
      },
      onCancel: () => { c.end('menu'); this.closeMenu(); },
    });
  }
  async showWorldLoad(kind) {
    const c = G.coop, items = [];
    if (kind === 'world') {
      for (const s of ((await G.listSaves?.('world')) || []).sort((a, b) => a.slot - b.slot)) {
        const m = G.saveMeta(s.meta);
        items.push({ text: `${s.slot === 0 ? tr('오토') : tr('슬롯 {n}', { n: s.slot })}  ${s.meta?.map || ''}`, right: m.date, desc: m.desc, slot: s.slot, kind: 'world' });
      }
    } else {
      for (const s of ((await G.listSaves?.('vr')) || []).sort((a, b) => a.slot - b.slot)) {
        const m = G.saveMeta(s.meta);
        items.push({ text: `VR ${s.slot === 0 ? tr('오토') : tr('슬롯 {n}', { n: s.slot })}  ${s.meta?.map || ''}`, right: m.date, desc: m.desc, slot: s.slot, kind: 'vr' });
      }
      for (const s of (await G.listRmSaves?.()) || []) items.push({ text: `${tr('원작')} ${s.label}  ${s.map}`, right: String(s.time), rm: s });
    }
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    if (!items.length) { G.audio?.playSystemSe(3); this.showWorldStart(); return; }
    this.list.open(kind === 'world' ? tr('서버 세이브 불러오기') : tr('세이브 불러오기'), items, {
      onSelect: async (i, it) => {
        const st = it.rm ? G.stateOfRm(it.rm.contents, it.rm.label) : await G.loadSave(it.slot, it.kind);
        if (c.role !== 'world' || c.wphase !== 'choosing') return;
        this.closeMenu();
        c.worldLoad(st);
      },
      onCancel: () => this.showWorldStart(),
    });
  }
  // this player's name (as the others see it) and whether the others' are shown over their heads
  coopSelfRows() {
    const c = G.coop;
    return [
      { text: c.hasName() ? tr('내 이름: {name}', { name: c.myName() }) : tr('내 이름: (정해 주세요)'), id: 'name', desc: tr('다른 플레이어에게 보이는 이름 (영어) - 고르면 바꿉니다') },
      { text: G.settings.coopNames === false ? tr('다른 플레이어 이름: 숨김') : tr('다른 플레이어 이름: 머리 위에 표시'), id: 'names', desc: tr('고르면 바뀝니다') },
      { text: tr('채팅·음성'), id: 'chat', right: VOICE_LABEL()[G.voice?.mode || 'off'], desc: tr('채팅 보내기·기록, 음성 채팅과 마이크') },
    ];
  }
  coopBanRow() {
    const n = G.coop.bans().length;
    return { text: tr('차단 목록 ({n}명)', { n }), id: 'bans', desc: tr('내 세계에 들어올 수 없는 사람 (고르면 차단 풀기)'), enabled: n > 0 };
  }
  // (an old game's hero may have no English name yet: the name the others will see, first)
  async coopNameFirst() {
    const c = G.coop;
    if (c.hasName()) return true;
    const v = await this.askText(tr('내 이름 (다른 플레이어에게 보임)'), '', NAME_LEN);
    if (!this.menuOpen) return false;
    if (v === null || !c.setMyName(v)) { this.showCoopMenu(0); return false; }
    return true;
  }
  async changeCoopName(index) {
    const c = G.coop;
    const v = await this.askText(tr('내 이름'), c.hasName() ? c.myName() : '', NAME_LEN);
    if (!this.menuOpen) return;
    if (v !== null && !c.setMyName(v)) G.audio?.playSystemSe(3);
    this.showCoopMenu(index);
  }
  // (host) the guests in this world - each one sent away, or banned
  showCoopPlayers(index = 0) {
    const c = G.coop;
    const items = c.guests().map(p => ({ text: c.nameOf(p.id), right: c.tagOf(p.id) ? `#${c.tagOf(p.id).slice(0, 4)}` : '', id: p.id, desc: tr('고르면 내보내거나 차단합니다') }));
    if (!items.length) { this.showCoopMenu(0); return; }
    this.list.open(tr('와 있는 사람'), items, {
      index,
      onSelect: (i, it) => this.coopPlayerAct(it.id, it.text, i),
      onCancel: () => this.showCoopMenu(0),
    });
  }
  coopPlayerAct(id, name, index) {
    const c = G.coop;
    this.list.open(name, [
      { text: tr('내보내기'), id: 'kick', desc: tr('지금 자기 세계로 돌려보냅니다 (다시 들어올 수 있음)') },
      { text: tr('차단하기'), id: 'ban', desc: tr('자기 세계로 돌려보내고, 다시는 들어오지 못하게 합니다 (차단 목록)') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, it) => {
        if (it.id === 'back') { this.showCoopPlayers(index); return; }
        if (!c.kick(id, it.id === 'ban')) G.audio?.playSystemSe(3);
        this.showCoopMenu(0);
      },
      onCancel: () => this.showCoopPlayers(index),
    });
  }
  // this player's list of the banned (kept in its settings): each one may be let in again
  showCoopBans(index = 0) {
    const c = G.coop, list = c.bans();
    if (!list.length) { this.showCoopMenu(0); return; }
    const items = list.map(b => ({ text: cleanName(b.name) || '?', right: `#${b.tag.slice(0, 4)}`, id: b.tag,
      desc: tr('{date} 차단 · 고르면 차단을 풉니다', { date: new Date(b.at || 0).toLocaleDateString() }) }));
    this.list.open(tr('차단 목록'), items, {
      index,
      onSelect: (i, it) => {
        this.list.open(it.text, [{ text: tr('차단 풀기'), id: 'unban', desc: tr('다시 내 세계에 들어올 수 있습니다') }, { text: tr('취소'), id: 'back' }], {
          onSelect: (_, a) => { if (a.id === 'unban') c.unban(it.id); this.showCoopBans(Math.max(0, a.id === 'unban' ? i - 1 : i)); },
          onCancel: () => this.showCoopBans(i),
        });
      },
      onCancel: () => this.showCoopMenu(0),
    });
  }
  // (host) a new join PIN for the server, in the game's own number input
  async changeCoopPin(index) {
    const v = await this.askNumber(tr('새 접속 PIN'), tr('친구들이 넣을 새 접속 PIN (6자리)'), 6, +(G.coop.serverPin || 0));
    if (v !== null && !G.coop.setPin(String(v).padStart(6, '0'))) G.audio?.playSystemSe(3);
    this.showCoopMenu(index);
  }
  // the rules changed (coop.js): the co-op menu, if it is up, shows them as they are now
  refreshCoopMenu() {
    if (this.menuOpen && this.list.visible && this.list.title === tr('협력') && !this.msg) this.showCoopMenu(this.list.index);
  }
  // why the last try did not work, in the co-op menu's line
  coopNote(why, server) {
    if (!why) return '';
    if (why === 'no server') return server?.local ? tr('이 PC의 협력 서버가 꺼져 있습니다 (coop_server를 먼저 켜 주세요)') : tr('서버에 닿지 않습니다 (주소·포트, 서버가 켜져 있는지 확인)');
    if (why === 'denied pin') return tr('PIN이 맞지 않습니다');
    if (why === 'denied full' || why === 'full') return tr('그 세계에는 더 들어갈 수 없습니다 (인원이 다 찼습니다)');
    if (why === 'denied host') return tr('그 서버에는 이미 세계를 연 사람이 있습니다');
    if (why === 'no host') return tr('그 서버에 아직 세계를 연 사람이 없습니다');
    if (why === 'version') return tr('VR 모드 버전이 서로 다릅니다 (모두 같은 버전으로 업데이트하세요)');
    if (why === 'game') return tr('게임 판본(버전·번역)이 서로 다릅니다');
    if (why === 'denied blocked') return tr('PIN을 여러 번 틀려 이 주소가 잠시(10분) 막혔습니다');
    if (why === 'server closed') return tr('서버와의 연결이 끊겼습니다');
    if (why === 'denied kicked' || why === 'kicked') return tr('호스트가 내보냈습니다');
    if (why === 'denied banned' || why === 'banned') return tr('그 세계의 호스트가 차단했습니다');
    if (why === 'denied game') return tr('커뮤니티 서버의 세계와 게임 판본이 다릅니다');
    if (why === 'denied version' || why === 'not world' || why === 'world') return tr('커뮤니티 서버와 이 게임의 버전이 다릅니다');
    return tr('연결하지 못했습니다');
  }
  // 채팅·음성: a line to everyone (the chat keyboard - PC: the / key too), the log (lines, who came and went), voice -
  // off, listen only, or talk too (only then is the microphone open, and only in a session) -, which microphone, how
  // loud the others are
  async showChatMenu(index = 0) {
    const s = G.settings, mics = await G.voice.devices();
    if (!this.menuOpen) return;
    // (the one picked by its name - kept with the setting too: the browser may not be naming them yet)
    const micLabel = s.voiceDevice ? mics.find(d => d.id === s.voiceDevice && d.named)?.label || s.voiceDeviceLabel || tr('기본 장치') : tr('기본 장치');
    const vol = Math.max(0, Math.min(2, s.voiceVolume ?? 1));
    const MODES = ['off', 'listen', 'talk'];
    const step = (id, dx) => {
      if (id === 'voice') { s.voice = MODES[(MODES.indexOf(G.voice.mode) + dx + 3) % 3]; G.voice.retry(); }
      else if (id === 'vol') s.voiceVolume = Math.round(Math.max(0, Math.min(2, vol + dx * 0.1)) * 10) / 10;
      else if (id === 'toasts') s.chatToasts = s.chatToasts === false;
      G.saveSettings?.();
    };
    const items = [
      { text: tr('채팅 보내기'), id: 'send', enabled: G.chat.on, desc: tr('한 줄을 모두에게 보냅니다 (PC: / 키)') },
      { text: tr('채팅 기록 ({n})', { n: G.chat.log.length }), id: 'log', enabled: G.chat.log.length > 0, desc: tr('채팅, 들어오고 나간 사람, 보스 처치') },
      { text: tr('채팅 알림'), id: 'toasts', right: s.chatToasts === false ? tr('끔') : tr('켬'), desc: tr('받은 채팅을 말풍선과 함께 알림으로도 띄웁니다') },
      { text: tr('음성 채팅'), id: 'voice', right: VOICE_LABEL()[G.voice.mode], desc: tr('말하기를 고른 동안, 함께하는 중에만 마이크가 열립니다') },
      { text: tr('마이크'), id: 'mic', right: clipText(micLabel, 22), desc: tr('눌러서 장치 목록에서 고릅니다') },
      { text: tr('음성 크기'), id: 'vol', right: `${Math.round(vol * 100)}%`, desc: tr('다른 사람 목소리 크기 (좌우로 조절)') },
    ];
    this.list.open(tr('채팅·음성'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'send') G.chat.openKeyboard(() => { if (this.menuOpen) this.showChatMenu(0); });
        else if (it.id === 'log') this.showChatLog();
        else if (it.id === 'mic') this.showMicList();
        else { step(it.id, 1); this.showChatMenu(i); }
      },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'send' || it.id === 'log' || it.id === 'mic') return false;
        step(it.id, dx);
        this.showChatMenu(i);
        return true;
      },
      onCancel: () => this.showCoopMenu(),
    });
  }
  // 채팅·음성 → 마이크: the devices by name, the one in use marked - shown at once; with none named yet (the browser names them
  // only once the page may use a microphone) it is asked, and the list comes again named when it answers (coopvoice.js)
  async showMicList() {
    const title = tr('마이크');
    const show = mics => {
      const s = G.settings, cur = s.voiceDevice || '', inUse = id => (id === cur ? tr('사용 중') : '');
      const rows = [{ text: tr('기본 장치'), id: '', right: inUse(''), desc: tr('시스템에서 기본으로 정한 마이크') },
        ...mics.map(d => ({ text: clipText(d.label, 30), id: d.id, label: d.label, right: inUse(d.id), desc: tr('이 마이크로 말합니다') }))];
      const index = Math.max(0, rows.findIndex(r => r.id === cur));
      this.list.open(title, rows, {
        index: this.list.visible && this.list.title === title ? this.list.index : index,
        onSelect: (i, it) => {
          s.voiceDevice = it.id;
          if (it.id) s.voiceDeviceLabel = it.label; else delete s.voiceDeviceLabel;
          G.voice.retry(); G.saveSettings?.();
          this.showChatMenu(4);
        },
        onCancel: () => this.showChatMenu(4),
      });
    };
    const mics = await G.voice.devices();
    if (!this.menuOpen) return;
    show(mics);
    if (mics.some(d => d.named)) return;
    const named = await G.voice.devices(true);
    if (this.menuOpen && this.list.visible && this.list.title === title) show(named);
  }
  showChatLog() {
    const rows = G.chat.log.map(e => ({ text: G.chat.lineOf(e), desc: new Date(e.t).toLocaleTimeString() }));
    this.list.open(tr('채팅 기록'), rows, { index: rows.length - 1, onSelect: () => {}, onCancel: () => this.showChatMenu(1) });
  }
  // the servers met before (settings), and a new one
  showCoopServers(mode) {
    const list = Array.isArray(G.settings.coopServers) ? G.settings.coopServers : [];
    const usable = list.filter(s => mode !== 'host' || s.hostPin);
    const items = usable.map(s => ({ text: `${s.ip}:${s.port}`, id: 'go', server: s, desc: mode === 'host' ? tr('호스트 PIN으로 이 서버에 내 세계를 엽니다') : tr('이 서버로 들어갑니다') }));
    items.push({ text: tr('새 서버 추가 (IP·포트·PIN 입력)'), id: 'add' });
    if (list.length) items.push({ text: tr('목록 비우기'), id: 'clear' });
    this.list.open(mode === 'host' ? tr('내 세계를 열 서버') : tr('들어갈 서버'), items, {
      onSelect: (i, it) => {
        if (it.id === 'go') this.coopConnect(mode, it.server);
        else if (it.id === 'add') this.addCoopServer(mode);
        else if (it.id === 'clear') { G.settings.coopServers = []; G.saveSettings?.(); this.showCoopServers(mode); }
      },
      onCancel: () => this.showCoopMenu(),
    });
  }
  coopConnect(mode, server) {
    if (mode === 'host') G.coop.openWorld(server); else G.coop.visit(server);
    this.closeMenu();
  }
  // a new server, in the game's own number input: its IP (four groups of three digits), port and PIN (and, to host
  // on it, its host PIN); it goes to the top of the list
  async addCoopServer(mode) {
    const ip = await this.askNumber(tr('서버 주소 (IP)'), tr('서버의 IP 주소를 세 자리씩 넣어 주세요'), 12, 0, 3);
    if (ip === null) { this.showCoopServers(mode); return; }
    const oct = String(ip).padStart(12, '0').match(/.../g).map(Number);
    if (oct.some(o => o > 255) || !oct[0]) { G.audio?.playSystemSe(3); this.addCoopServer(mode); return; }
    const port = await this.askNumber(tr('포트'), tr('서버의 포트 번호'), 5, G.coop.defaultPort);
    if (port === null) { this.showCoopServers(mode); return; }
    if (port < 1024) { G.audio?.playSystemSe(3); this.showCoopServers(mode); return; }
    const pin = await this.askNumber('PIN', tr('서버의 접속 PIN (6자리)'), 6, 0);
    if (pin === null) { this.showCoopServers(mode); return; }
    let hostPin = '';
    if (mode === 'host') {
      const hp = await this.askNumber(tr('호스트 PIN'), tr('서버의 호스트 PIN (6자리)'), 6, 0);
      if (hp === null) { this.showCoopServers(mode); return; }
      hostPin = String(hp).padStart(6, '0');
    }
    const server = { ip: oct.join('.'), port, pin: String(pin).padStart(6, '0'), hostPin };
    const list = Array.isArray(G.settings.coopServers) ? G.settings.coopServers : [];
    const same = s => `${s.ip}:${s.port}` === `${server.ip}:${server.port}`;
    const kept = list.find(same), old = list.filter(s => !same(s));
    if (!hostPin && kept?.hostPin) server.hostPin = kept.hostPin;    // (a host PIN given before is kept)
    G.settings.coopServers = [server, ...old].slice(0, 8);
    G.saveSettings?.();
    this.coopConnect(mode, server);
  }
  // the community servers this player added (settings: { ip, port, pin } each, the newest first)
  communityServers() {
    const ok = s => s && /^\d{1,3}(\.\d{1,3}){3}$/.test(s.ip) && s.port >= 1024 && s.port <= 65535 && /^\d{6}$/.test(s.pin);
    return (Array.isArray(G.settings.communityServers) ? G.settings.communityServers : []).filter(ok);
  }
  // a community server someone runs (community_server.cmd - world_server.py), in the game's own number input as a co-op
  // server's: its IP, port (28472 unless its owner changed it) and PIN; it goes to the top of the list and is joined
  async addCommunityServer() {
    const ip = await this.askNumber(tr('서버 주소 (IP)'), tr('서버의 IP 주소를 세 자리씩 넣어 주세요'), 12, 0, 3);
    if (ip === null) { this.showCoopMenu(); return; }
    const oct = String(ip).padStart(12, '0').match(/.../g).map(Number);
    if (oct.some(o => o > 255) || !oct[0]) { G.audio?.playSystemSe(3); this.addCommunityServer(); return; }
    const port = await this.askNumber(tr('포트'), tr('서버의 포트 번호'), 5, WORLD_PORT);
    if (port === null) { this.showCoopMenu(); return; }
    if (port < 1024) { G.audio?.playSystemSe(3); this.showCoopMenu(); return; }
    const pin = await this.askNumber('PIN', tr('서버의 접속 PIN (6자리)'), 6, 0);
    if (pin === null) { this.showCoopMenu(); return; }
    const server = { ip: oct.join('.'), port, pin: String(pin).padStart(6, '0') };
    const same = s => `${s.ip}:${s.port}` === `${server.ip}:${server.port}`;
    G.settings.communityServers = [server, ...this.communityServers().filter(s => !same(s))].slice(0, 8);
    G.saveSettings?.();
    if (G.coop.joinWorld(server)) this.closeMenu(); else this.showCoopMenu();
  }
  // a name in the game's keyboard (English): resolves to it, or null when cancelled
  askText(title, value = '', max = NAME_LEN) {
    this.list.close();
    this.placeRoot(true);
    return new Promise(resolve => {
      this.keyboard.open(title, value, max, {
        onDone: v => { this.keyboard.close(); resolve(v); },
        onCancel: () => { this.keyboard.close(); resolve(null); },
      });
    });
  }
  // a chat line in the chat keyboard: resolves to it, or null - from a menu, or (the emote ring) over the game, holding it
  // as a scene while it is up
  askChat(title, max) {
    this.list.close();
    this.placeRoot(true);
    const own = !this.menuOpen && !this.sceneOpen;
    if (own) this.sceneOpen = 'chat';
    return new Promise(resolve => {
      const done = v => { this.chatKeyboard.close(); if (own && this.sceneOpen === 'chat') this.sceneOpen = null; this.consumedConfirm = true; resolve(v); };
      this.chatKeyboard.open(title, '', max, { onDone: v => done(v), onCancel: () => done(null) });
    });
  }
  // Name Input (303) for the hero: typed in the keyboard (English) - the hero's name, and this player's in co-op (the
  // co-op menu changes that one later); it must be given one (the original's has no cancel). The event's length counts
  // the original's full-width letters (the prologue's: 4): English ones take half the room - twice as many
  openNameInput(actor, max) {
    this.sceneOpen = 'name';
    this.placeRoot(true);
    this.keyboard.open(tr('이름'), cleanName(actor.name), Math.max(1, Math.min(NAME_LEN, (max || 8) * 2)), {
      onDone: v => { actor.name = v; G.coop?.setMyName(v); this.keyboard.close(); this.sceneOpen = null; },
    });
  }
  // the game's number input (as Input Number shows it), for a number of this layer: resolves to the number, or null
  askNumber(title, prompt, digits, value = 0, group = 0) {
    this.list.close();
    return new Promise(resolve => {
      this.showMessage({ face: '', lines: [prompt], position: 2, number: {
        digits, value, code: true, group, title, cursor: digits - 1,
        onDone: v => resolve(v), onCancel: () => resolve(null),
      } });
    });
  }

  // ---------------------------------------------------------------- banner / toasts
  showBanner(text, color = '#ddd', blocking = false, seconds = 2.6) {
    this.banner = { text, color, t: 0, dur: seconds, blocking };
    this.placeRoot(true);
    this.drawBanner();
  }
  drawBanner() {
    const p = this.bannerPanel;
    const b = this.banner;
    p.clear();
    if (b) {
      const { ctx, canvas } = p;
      const a = Math.min(1, b.t / 0.4, (b.dur - b.t) / 0.5);
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, `rgba(0,0,0,${0.75 * a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `120px "Times New Roman", ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, canvas.width / 2, canvas.height / 2);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    p.commit();
    p.mesh.visible = !!b;
    p.mesh.position.set(0, 0.02, -0.1);
  }
  toast(text, icon = 0, color = '#f0e6c8', life = 3.5) {
    this.toasts.push({ text, icon, color, t: 0, life });
    if (this.toasts.length > 4) this.toasts.splice(this.toasts.findIndex(t => !t.sticky), 1);
    this.drawToasts();
  }
  // a toast that stays until cleared (one at a time)
  setHint(text) {
    this.toasts = this.toasts.filter(t => !t.sticky);
    if (text) this.toasts.unshift({ text, icon: 0, color: '#bfe3ff', t: 0, sticky: true });
    this.drawToasts();
  }
  notifyGain(kind, id, n) {
    const d = itemData(kind, id);
    if (!d) return;
    this.toast(tr('{name} 획득', { name: d.name + (n > 1 ? ' ×' + n : '') }), d.icon_index);
    G.audio?.playSystemSe(22);
  }
  // SEN went up or down (BLACKSOULS II's SEN reminder, from its own script): its strip and its sound
  notifySen(delta) {
    const sen = G.scripts?.sen;
    if (!sen) return;
    const now = G.state.v(sen.variable);
    const color = textColor((sen.colors.find(([above]) => now > above) || [0, sen.color])[1]);
    this.toasts.push({ sen: { label: sen.labels[delta > 0 ? 0 : 1], note: `${sen.note}${now} (${delta > 0 ? '+' : ''}${delta})`, icon: sen.icon }, color, t: 0 });
    if (this.toasts.length > 4) this.toasts.splice(this.toasts.findIndex(t => !t.sticky), 1);
    this.drawToasts();
    const se = sen.se[delta > 0 ? 0 : 1];
    if (se) G.audio?.playSe(se);
  }
  // as the original draws it: a small tab with "SEN 상승" / "SEN 저하!" on top of a dark bar holding the icon and
  // the value now (with the change), coloured by how high it is
  drawSenStrip(ctx, w, y, t) {
    const { label, note, icon } = t.sen;
    ctx.textBaseline = 'middle';
    ctx.font = `22px ${FONT}`;
    ctx.fillStyle = 'rgba(0,0,0,0.63)';
    ctx.fillRect(4, y, ctx.measureText(label).width + 14, 24);
    ctx.fillRect(4, y + 24, w - 8, 42);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, 11, y + 13);
    if (icon) drawIcon(ctx, icon, 12, y + 26, 38);
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = t.color;
    ctx.fillText(note, icon ? 60 : 16, y + 46);
  }
  drawToasts() {
    const p = this.toastPanel;
    const { ctx } = p;
    p.clear();
    this.toasts.forEach((t, i) => {
      const a = t.sticky ? 1 : Math.min(1, ((t.life || 3.5) - t.t) / 0.5);
      if (a <= 0) return;
      ctx.globalAlpha = a;
      const y = 10 + i * 72;
      if (t.sen) { this.drawSenStrip(ctx, p.canvas.width, y, t); ctx.globalAlpha = 1; return; }
      windowBg(ctx, 4, y, p.canvas.width - 8, 64, 0.7);
      let x = 24;
      if (t.icon) { drawIcon(ctx, t.icon, x, y + 8, 48); x += 60; }
      ctx.font = `34px ${FONT}`; ctx.fillStyle = t.color; ctx.textBaseline = 'middle';
      const room = p.canvas.width - x - 16, w = ctx.measureText(t.text).width;          // (a long one: smaller)
      if (w > room) ctx.font = `${Math.max(18, Math.floor(34 * room / w))}px ${FONT}`;
      ctx.fillText(t.text, x, y + 34);
      ctx.globalAlpha = 1;
    });
    p.commit();
    p.mesh.visible = this.toasts.length > 0;
    p.mesh.position.set(0, -0.62, 0.02);
  }

  // ---------------------------------------------------------------- HUD
  // the status panel as the original's windows are drawn (rmwindow.js): the window skin in its tone, the game's font on
  // 24-pixel lines; HP and MP as Window_Base#draw_actor_hp / mp draw them (the label in the system colour over the gauge's
  // two skin colours, the numbers at the right - in the crisis / knocked-out colour when low), the stamina a gauge of its
  // own under them (TP's colours, half a line), the SEN (Window_Var: its title in the system colour) and the souls
  // (Window_Gold#draw_currency_value) on one line, and the states' icons under it while there are any
  drawHud() {
    const leader = G.state?.party.leader();
    this.hud.mesh.visible = !!leader;
    if (!leader) return;
    const mv = G.scripts?.menuVar, sen = mv && (!mv.switchId || G.state.sw(mv.switchId)) ? G.state.v(mv.variable) : null;
    // the player's states, by their icons as the original's battle status shows them (poison, a resin, a boss's rule
    // going round - 그랑・기뇰's 악랄영역): a row under the rest, only while there are any
    // (and its buffs / debuffs, by the original's arrows - 목수의 못, a curse), each with the seconds it has left on it (as
    // the original's ステート残りターン puts a state's turns left on its icon in a fight - here they run all the time)
    const timers = G.state.system.stateTimers || {}, buffT = leader.buffTimes();
    const marks = [...leader.states.map(id => [$data.states[id]?.icon_index || 0, timers[id]]), ...leader.buffIcons().map((ic, k) => [ic, buffT[k]])]
      .filter(([ic]) => ic > 0).slice(0, HUD_ICONS);
    const icons = marks.map(m => m[0]), lefts = marks.map(m => (m[1] > 0 ? Math.ceil(m[1]) : null));
    const s = MS, W = HUD_W, H = PAD * 2 + LINE * 3 + LINE / 2 + (icons.length ? LINE : 0);
    this.hudDrawn = H * s;                                     // (how much of its canvas the window takes: placeDeskHud)
    this.drawVoiceBadge();
    const stamina = G.combat?.stamina;
    const key = `${leader.hp}/${leader.mhp}/${leader.mp}/${leader.mmp}/${G.state.party.gold}/${stamina?.toFixed?.(2)}/${sen}/${icons.join(',')}/${lefts.join(',')}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const p = this.hud, { ctx } = p;
    p.clear();
    drawWindow(ctx, s, 0, 0, W, H);
    const B = $data.system.terms?.basic || [], normal = textColor(0), system = textColor(16), x = PAD, w = W - PAD * 2;
    const gauge = (label, cur, max, c1, c2, color, y) => {
      drawGauge(ctx, s, x, y, w, max ? cur / max : 0, textColor(c1), textColor(c2), textColor(19));
      drawText(ctx, s, label, x, y, 30, LINE, 0, system);
      // (Window_Base#draw_current_and_max_values, its number fields as wide as seven figures)
      drawText(ctx, s, cur, x + w - 152, y, 70, LINE, 2, color);
      drawText(ctx, s, '/', x + w - 82, y, 12, LINE, 2, normal);
      drawText(ctx, s, max, x + w - 70, y, 70, LINE, 2, normal);
    };
    let y = PAD;
    gauge(B[3] || 'HP', leader.hp, leader.mhp, 20, 21, leader.hp <= 0 ? textColor(18) : leader.hp < leader.mhp / 4 ? textColor(17) : normal, y);
    y += LINE;
    gauge(B[5] || 'MP', leader.mp, leader.mmp, 22, 23, leader.mp < leader.mmp / 4 ? textColor(17) : normal, y);
    y += LINE;
    // (the stamina: its gauge alone, at the foot of half a line)
    if (stamina !== undefined) drawGauge(ctx, s, x, y - LINE / 2, w, stamina, textColor(28), textColor(29), textColor(19));
    y += LINE / 2;
    // (the SEN's and the souls' line all a little smaller than HP's and MP's)
    const small = Math.round(fontSize() * 0.84);
    ctx.font = gameFont(small * s);
    const width = t => ctx.measureText(String(t)).width / s;
    if (sen !== null) {
      const lw = width(`${mv.label} `), vw = width(sen);
      drawText(ctx, s, mv.label, x, y, lw, LINE, 0, system, { size: small });
      drawText(ctx, s, sen, x + lw, y, vw + 1, LINE, 0, normal, { size: small });
      if (mv.suffix) drawText(ctx, s, mv.suffix, x + lw + vw, y, width(mv.suffix) + 1, LINE, 0, system, { size: small });
    }
    const unit = $data.system.currency_unit || '';
    drawText(ctx, s, G.state.party.gold, x, y, w - width(unit) - 2, LINE, 2, normal, { size: small });
    drawText(ctx, s, unit, x, y, w, LINE, 2, system, { size: small });
    if (icons.length) {
      y += LINE;
      icons.forEach((ic, i) => drawIcon(ctx, ic, (x + i * 24) * s, y * s, 24 * s));
      // (the time left: over the icon's right side, bold, in the crisis colour - as the original draws a state's turns)
      ctx.font = `bold ${Math.round(fontSize() * s)}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5 * s; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = textColor(17);
      lefts.forEach((n, i) => { if (n === null) return; const tx = (x + i * 24 + 24) * s, ty = (y + LINE / 2) * s; ctx.strokeText(String(n), tx, ty); ctx.fillText(String(n), tx, ty); });
      ctx.textAlign = 'left';
    }
    p.commit();
  }
  // (co-op) beside the status window: the microphone (talking on / off) over the headphones (listening on / off), by the
  // voice setting, see-through - the microphone solid while this player speaks (voicemarks.js) - only in a session with
  // others, when voice goes anywhere
  drawVoiceBadge() {
    const v = G.voice, b = this.voiceBadge;
    const code = G.chat?.on && v && voiceMarksReady() ? voiceCode(v.mode) : -1;
    const speaking = code === 2 && v.micLive && v.speaking;
    const key = `${code}/${speaking}`;
    if (key === this.voiceBadgeKey) return;
    this.voiceBadgeKey = key;
    b.mesh.visible = code >= 0;
    if (code < 0) return;
    b.clear();
    const [w] = voiceMarksSize(VOICE_PIC, true);
    drawVoiceMarks(b.ctx, (b.canvas.width - w) / 2, 4, VOICE_PIC, code, speaking, true);
    b.commit();
  }

  // ---------------------------------------------------------------- pointer
  pointerRay() {
    const c = G.input.controllers.right;
    if (!G.vr || !c) return null;
    const m = c.ray.matrixWorld;
    this.raycaster.ray.origin.setFromMatrixPosition(m);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
    return this.raycaster;
  }

  // ---------------------------------------------------------------- menus
  openMenu() {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.menuIndex = 0;
    this.placeRoot(true);
    this.showMainMenu();
  }
  closeMenu() {
    this.menuOpen = false;
    if (G.minimap) G.minimap.preview = false;
    this.menuScreen.close();
    this.list.close();
    this.grid.close();
    this.consumedConfirm = true;
  }
  // the menu, as the original's (MenuScreen): its commands - 아이템 스킬 장비 스테이터스 (the database's words), 서약 (its
  // script's), 저장 and GAME END - then this version's own: VR saves loaded, co-op and its settings
  showMainMenu() {
    const C = $data.system.terms?.commands || [];
    const items = [
      { text: C[4] || tr('아이템'), id: 'items' },
      { text: C[5] || tr('스킬'), id: 'skills' },
      { text: C[6] || tr('장비'), id: 'equip' },
      { text: C[7] || tr('상태 보기'), id: 'status' },
      { text: G.scripts?.partnerCommand || tr('서약'), id: 'oath', enabled: G.state.party.spirits.length > 0 },
      // (not while an event holds the map for its fight: a save then would come back without the event's own progress)
      { text: C[9] || tr('VR 세이브'), id: 'save', enabled: !G.state.system.saveDisabled && !G.map?.interpreter?.running() },
      { text: C[10] || tr('타이틀로'), id: 'end' },
      { gap: true },
      { text: tr('VR 로드'), id: 'load' },
      { text: tr('협력'), id: 'coop' },
      { text: tr('설정'), id: 'settings' },
    ];
    this.list.close();
    this.grid.close();
    const at = Math.max(0, items.findIndex(it => it.id === this.menuId));
    this.menuScreen.open(items, {
      onSelect: (i, it) => { this.menuId = it.id; this.onMenu(it.id); },
      onCancel: () => this.closeMenu(),
      index: at,
    });
    this.menuScreen.panel.mesh.position.set(0, 0, 0);
  }
  reopenMain(id) {
    if (SETTING_IDS.includes(id)) { this.showSettingsMenu(id); return; }
    this.menuId = id;
    this.showMainMenu();
  }
  // this version's own settings (the original's menu has none): the map in the corner, turning, the enemies' strength,
  // combat and display, the hold of weapons and shields, the PC monitor's view
  showSettingsMenu(id) {
    const s = G.settings;
    const items = [
      { text: tr('지도'), id: 'minimap', right: s.minimap !== false ? tr('켬') : tr('끔'), desc: minimapWhere() },
      { text: tr('회전 방식: {v}', { v: s.snapTurn ? tr('스냅 {a}°', { a: s.snapAngle }) : tr('부드럽게') }), id: 'turn' },
      { text: tr('난이도(적 공격력): ×{v}', { v: s.difficulty.toFixed(2) }), id: 'diff' },
      { text: tr('전투·화면 설정'), id: 'options' },
      { text: tr('무기·방패 모양 조정'), id: 'adjust' },
      { text: tr('PC 모니터 관전 화면 설정'), id: 'spectator' },
    ];
    this.list.open(tr('설정'), items, {
      index: Math.max(0, items.findIndex(it => it.id === id)),
      onSelect: (i, it) => this.onMenu(it.id),
      onCancel: () => this.reopenMain('settings'),
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  onMenu(id) {
    const s = G.settings;
    this.menuScreen.close();            // (one of its commands opens over it - or is asked for straight)
    switch (id) {
      case 'items': this.showItems(); break;
      case 'skills': this.showSkills(); break;
      case 'equip': this.showEquipSlots(); break;
      case 'oath': this.showOath(); break;
      case 'status': this.showStatus(); break;
      case 'save': G.openSaveMenu?.(); break;
      case 'end': this.showGameEnd(); break;
      case 'load': G.openLoadMenu?.(); break;
      case 'coop': this.showCoopMenu(); break;
      case 'settings': this.showSettingsMenu(); break;
      case 'minimap': this.showMinimapMenu(); break;
      case 'adjust': this.adjTarget = 'weapon'; this.showAdjust(); break;
      case 'turn':
        if (s.snapTurn && s.snapAngle === 30) s.snapAngle = 45;
        else if (s.snapTurn) s.snapTurn = false;
        else { s.snapTurn = true; s.snapAngle = 30; }
        G.saveSettings?.(); this.reopenMain('turn'); break;
      case 'spectator': this.showSpectatorMenu(); break;
      case 'options': this.showOptionsMenu(); break;
      case 'diff':
        s.difficulty = s.difficulty >= 1.5 ? 0.5 : +(s.difficulty + 0.25).toFixed(2);
        G.saveSettings?.(); this.reopenMain('diff'); break;
      default: break;
    }
  }
  // 지도: the map in the corner (minimap.js) - on or off, how big, how much of the map, where; shown over this menu while
  // it is set
  showMinimapMenu(index = 0) {
    const s = G.settings, p = minimapPlace();
    const SIZES = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const set = (k, v) => { s.minimapPlace = { ...p, [k]: v }; G.saveSettings?.(); };
    const step = (id, dx) => {
      if (id === 'on') { s.minimap = s.minimap === false; G.saveSettings?.(); }
      else if (id === 'size') {
        const i = SIZES.reduce((best, v, k) => (Math.abs(v - p.size) < Math.abs(SIZES[best] - p.size) ? k : best), 0);
        set('size', SIZES[clamp(i + dx, 0, SIZES.length - 1)]);
      } else if (id === 'zoom') set('zoom', clamp(p.zoom + dx, 0, MINIMAP_ZOOMS.length - 1));
      else if (id === 'x' || id === 'y') set(id, Math.round(clamp(p[id] + dx * 0.1, -1, 1) * 10) / 10);
      else if (id === 'opacity') set('opacity', Math.round(clamp(p.opacity + dx * 0.1, 0.2, 1) * 10) / 10);
      else if (id === 'shape') set('shape', p.shape === 'round' ? 'square' : 'round');
      else if (id === 'rotate') set('rotate', !p.rotate);
      else if (id === 'hand') set('hand', !p.hand);
      else if (id === 'reset') { s.minimapPlace = undefined; G.saveSettings?.(); }
    };
    if (G.minimap) G.minimap.preview = true;
    const pct = v => `${Math.round((v + 1) * 50)}%`;
    const items = [
      { text: tr('지도 표시'), id: 'on', right: s.minimap !== false ? tr('켬') : tr('끔'), desc: minimapWhere() },
      // (VR: over the right hand, or a corner of the view - its place there only then)
      G.vr && { text: tr('위치'), id: 'hand', right: p.hand ? tr('오른손') : tr('시야 구석'), desc: tr('오른손: 오른손 위에 떠 있습니다 · 시야 구석: 늘 시야에 보입니다') },
      { text: tr('모양'), id: 'shape', right: p.shape === 'round' ? tr('원형') : tr('사각'), desc: tr('고르거나 좌우로 바꿉니다') },
      { text: tr('방향'), id: 'rotate', right: p.rotate ? tr('보는 방향이 위') : tr('북쪽이 위'),
        desc: p.rotate ? tr('지도가 보는 방향에 맞춰 돌고, 나는 늘 가운데에 있습니다') : tr('원작 화면처럼: 맵 끝에서는 지도가 멈추고 나만 움직입니다') },
      { text: tr('크기'), id: 'size', right: `${Math.round(p.size * 100)}%`, desc: tr('좌우로 조절합니다') },
      { text: tr('불투명도'), id: 'opacity', right: `${Math.round(p.opacity * 100)}%`, desc: tr('좌우로 조절합니다') },
      { text: tr('보이는 범위'), id: 'zoom', right: tr('{n}칸', { n: MINIMAP_ZOOMS[p.zoom] }), desc: tr('좌우로 조절합니다') },
      ...(G.vr && p.hand ? [] : [
        { text: tr('가로 위치'), id: 'x', right: pct(p.x), desc: tr('0%: 왼쪽 끝, 100%: 오른쪽 끝 (좌우로 조절)') },
        { text: tr('세로 위치'), id: 'y', right: pct(p.y), desc: tr('0%: 아래 끝, 100%: 위 끝 (좌우로 조절)') },
      ]),
      { text: tr('기본값으로'), id: 'reset' },
    ].filter(Boolean);
    this.list.open(tr('지도'), items, {
      index,
      onSelect: (i, it) => { step(it.id, 1); this.showMinimapMenu(i); },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'on' || it.id === 'reset') return false;
        step(it.id, dx);
        this.showMinimapMenu(i);
        return true;
      },
      onCancel: () => { if (G.minimap) G.minimap.preview = false; this.reopenMain('minimap'); },
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  // GAME END (Scene_End): to the title, or back (the database's words - its shutdown has no window here to close)
  showGameEnd() {
    const C = $data.system.terms?.commands || [];
    this.list.open(C[10] || tr('타이틀로'), [
      { text: C[21] || tr('타이틀로'), id: 'title' },
      { text: C[22] || tr('취소'), id: 'back' },
    ], {
      onSelect: (i, it) => { if (it.id === 'title') { this.closeMenu(); this.returnToTitle(); } else this.reopenMain('end'); },
      onCancel: () => this.reopenMain('end'),
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  // an item / skill does something (effects or a damage formula)
  hasEffect(d) { return !!(d.effects?.length || d.damage?.type); }
  // usable from the menu: not battle-only, and aimed at the player (enemies need the field)
  menuUsable(d) { return (d.occasion === 0 || d.occasion === 2) && this.hasEffect(d) && !(d.scope >= 1 && d.scope <= 6); }
  quickable(d) { return d.occasion !== 3 && this.hasEffect(d); }
  itemTabs() {
    const party = G.state.party;
    const usable = d => this.menuUsable(d) || this.quickable(d);
    const list = (kind, filter) => {
      const out = [];
      for (const [id, n] of party.container(kind)) {
        const d = itemData(kind, id);
        if (!d || !d.name || !filter(d)) continue;
        const slot = kind === 'item' ? quickSlotOf({ kind: 'item', id }) : -1;
        out.push({ text: d.name, icon: d.icon_index, right: slot >= 0 ? `[${slot + 1}] ${n}` : `${n}`, kind, id, desc: d.description,
          enabled: kind === 'item' ? !!usable(d) : true });
      }
      return out.sort((a, b) => a.id - b.id);
    };
    return [
      { label: tr('아이템'), items: list('item', d => d.itype_id !== 2) },
      { label: tr('무기'), items: list('weapon', () => true) },
      { label: tr('방어구'), items: list('armor', () => true) },
      { label: tr('중요한 아이템'), items: list('item', d => d.itype_id === 2) },
    ];
  }
  showItems(keepIndex) {
    this.list.close();
    const tabs = this.itemTabs();
    this.grid.open(tr('아이템'), tabs, {
      tab: this.grid.tab || 0,
      index: keepIndex ?? 0,
      onSelect: (it) => {
        if (it.kind !== 'item') { this.toast(tr("{name}: 장비는 '장비' 메뉴에서", { name: it.text })); return; }
        this.showItemActions(it);
      },
      onCancel: () => { this.grid.close(); this.reopenMain('items'); },
    });
  }
  showItemActions(it) {
    const d = $data.items[it.id];
    const back = () => { if (this.menuOpen) this.showItems(this.grid.index); };
    const entry = { kind: 'item', id: d.id };
    const slot = quickSlotOf(entry);
    this.grid.close();
    this.list.open(stripEscapes(d.name), [
      { text: tr('사용'), id: 'use', enabled: this.menuUsable(d), desc: this.menuUsable(d) ? d.description : tr('필드에서 퀵슬롯으로 사용합니다') },
      { text: slot >= 0 ? tr('퀵슬롯 ({n}번에 등록됨)', { n: slot + 1 }) : tr('퀵슬롯에 등록'), id: 'quick', enabled: this.quickable(d), desc: tr('퀵슬롯 버튼(VR: X, PC: Q)을 누른 채 손을 옮기고 떼면 사용') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, a) => {
        if (a.id === 'use') { G.combat?.useItem(d, 'menu'); back(); }
        else if (a.id === 'quick') this.showQuickPicker(entry, back);
        else back();
      },
      onCancel: back,
    });
  }
  // choose (or clear) the quick slot for an item / skill
  showQuickPicker(entry, back) {
    const slots = quickSlots();
    const cur = quickSlotOf(entry);
    const items = slots.map((s, i) => {
      const st = s ? entryStatus(s) : null;
      return { text: `${i + 1}.  ${st ? st.name : tr('(비어 있음)')}`, icon: st?.icon, right: st?.sub || '', slot: i };
    });
    if (cur >= 0) items.push({ text: tr('퀵슬롯에서 빼기'), id: 'remove' });
    this.list.open(tr('퀵슬롯 선택'), items, {
      index: cur >= 0 ? cur : Math.max(0, slots.findIndex(s => !s)),
      footer: tr('고른 칸에 등록합니다 (원래 있던 것은 빠집니다)'),
      onSelect: (i, it) => {
        if (it.id === 'remove') { assignQuickSlot(cur, null); this.toast(tr('퀵슬롯에서 뺐습니다')); }
        else { assignQuickSlot(it.slot, entry); this.toast(tr('퀵슬롯 {n}번에 등록했습니다', { n: it.slot + 1 })); }
        G.audio?.playSystemSe(1);
        back();
      },
      onCancel: back,
    });
  }

  // ---- skills ----
  showSkills(keepIndex) {
    const a = G.state.party.leader();
    if (!a) return;
    this.list.close();
    const items = a.allSkills().map(s => {
      const cost = a.skillMpCost(s), hpCost = a.skillHpCost(s);
      const slot = quickSlotOf({ kind: 'skill', id: s.id });
      const ok = a.skillTypeUsable(s) && !a.skillSealed(s.id);
      return { text: s.name, icon: s.icon_index, id: s.id, desc: s.description, enabled: ok,
        right: `${slot >= 0 ? `[${slot + 1}] ` : ''}${cost ? 'MP' + cost : hpCost ? 'HP' + hpCost : ''}` };
    });
    this.grid.open(tr('스킬'), [{ label: $data.system.skill_types?.[1] || tr('스킬'), items }], {
      tab: 0,
      index: keepIndex ?? 0,
      onSelect: (it) => this.showSkillActions(it),
      onCancel: () => { this.grid.close(); this.reopenMain('skills'); },
    });
  }
  showSkillActions(it) {
    const a = G.state.party.leader();
    const s = $data.skills[it.id];
    const keep = this.grid.index;
    const back = () => { if (this.menuOpen) this.showSkills(keep); };
    const entry = { kind: 'skill', id: s.id };
    const slot = quickSlotOf(entry);
    const canUse = this.menuUsable(s) && a.skillCostPayable(s) && !(G.combat?.skillCooling(s) > 0);
    this.grid.close();
    const cost = a.skillMpCost(s), hpCost = a.skillHpCost(s);
    this.list.open(`${stripEscapes(s.name)}${cost ? `  (MP ${cost})` : hpCost ? `  (HP ${hpCost})` : ''}`, [
      { text: tr('사용'), id: 'use', enabled: canUse, desc: this.menuUsable(s) ? s.description : tr('필드에서 퀵슬롯으로 사용합니다') },
      { text: slot >= 0 ? tr('퀵슬롯 ({n}번에 등록됨)', { n: slot + 1 }) : tr('퀵슬롯에 등록'), id: 'quick', enabled: s.occasion !== 3,
        desc: tr('퀵슬롯 버튼(VR: X, PC: Q)을 누른 채 손을 옮기고 떼면 사용') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, act) => {
        if (act.id === 'use') { G.combat?.useSkillFromMenu(s); back(); }
        else if (act.id === 'quick') this.showQuickPicker(entry, back);
        else back();
      },
      onCancel: back,
    });
  }

  // ---- equipment ----
  slotEtype(slot) { return slot === 0 ? 0 : Math.min(slot, 4); }
  slotName(slot) {
    const terms = $data.system.terms.etypes || [tr('무기|equip'), tr('방패|equip'), tr('머리|equip'), tr('몸|equip'), tr('장신구|equip')];
    return terms[this.slotEtype(slot)] || tr('슬롯 {n}', { n: slot + 1 });
  }
  canEquip(actor, kind, d, slot) {
    if (!d) return false;
    const et = this.slotEtype(slot);
    if (kind === 'weapon') return et === 0 && actor.featuresSet(51).includes(d.wtype_id);
    return et !== 0 && d.etype_id === et && actor.featuresSet(52).includes(d.atype_id);
  }
  paramDelta(actor, slot, kind, id, max = 8) {
    const before = [0, 1, 2, 3, 4, 5, 6, 7].map(i => actor.param(i));
    const saved = actor.equips[slot];
    actor.equips[slot] = { kind, id };
    const after = [0, 1, 2, 3, 4, 5, 6, 7].map(i => actor.param(i));
    actor.equips[slot] = saved;
    const P = $data.system.terms.params;
    const parts = [0, 2, 3, 4, 5, 6, 7].filter(i => after[i] !== before[i])
      .map(i => `${P[i]} ${after[i] > before[i] ? '+' : '−'}${Math.abs(after[i] - before[i])}`);
    return parts.length > max ? parts.slice(0, max).join('  ') + ' …' : parts.join('  ');
  }
  showEquipSlots(index = 0) {
    const a = G.state.party.leader();
    if (!a) return;
    this.grid.close();
    const slots = a.equips.map((e, slot) => {
      const d = itemData(e.kind, e.id);
      return { text: `${this.slotName(slot)}: ${d ? d.name : '—'}`, icon: d?.icon_index, slot, desc: d?.description || '' };
    });
    this.list.open(tr('장비  ({name})', { name: a.name || '' }), slots, {
      index,
      onSelect: (i, it) => this.showEquipChoices(it.slot),
      onCancel: () => this.reopenMain('equip'),
    });
  }
  // what can go into a slot: three a row like the items and skills (how many on the right), and below, the one
  // pointed at - what it changes, then what it is. In the original's order (Window_EquipItem): by number, the empty one -
  // taking it off - last
  showEquipChoices(slot) {
    const a = G.state.party.leader();
    const kind = slot === 0 ? 'weapon' : 'armor';
    const party = G.state.party;
    const cands = [];
    for (const [id, n] of [...party.container(kind)].sort((x, y) => x[0] - y[0])) {
      const d = itemData(kind, id);
      if (!d || !d.name || !this.canEquip(a, kind, d, slot)) continue;
      cands.push({ text: d.name, icon: d.icon_index, id, right: `${n}`,
        desc: [this.paramDelta(a, slot, kind, id), stripEscapes(d.description || '')].filter(Boolean).join('  ·  ') });
    }
    cands.push({ text: tr('(장비 해제)'), id: 0, desc: this.paramDelta(a, slot, kind, 0) });
    this.list.close();
    this.grid.open(tr('{slot} 변경', { slot: this.slotName(slot) }), [{ label: this.slotName(slot), items: cands }], {
      tab: 0,
      onSelect: (it) => {
        a.changeEquipById(slot, it.id);
        G.combat.equipKey = null;
        G.audio?.playSystemSe(4);
        this.showEquipSlots(slot);
      },
      onCancel: () => this.showEquipSlots(slot),
    });
  }

  // ---- 서약 (the oath system): which of the party's oaths is sworn - its spirit's features add to the actor's
  // (the original's screen shows each oath's description: its level and what it gives) ----
  oathInfo(sid) {
    const d = $data.actors[spiritActorId(sid)];
    const lines = String(d?.description || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lv = /Lv\s*(\d+)/i.exec(lines[0] || '')?.[1];
    return { name: stripEscapes(d?.name || `#${sid}`), lv: lv !== undefined ? `Lv${lv}` : '', effect: lines.slice(lv !== undefined ? 1 : 0).join(' ') };
  }
  // what swearing sid instead (0: none) does to the params
  oathDelta(a, sid) {
    const ids = [0, 1, 2, 3, 4, 5, 6, 7];
    const before = ids.map(i => a.param(i));
    const saved = a.partners;
    a.partners = sid ? [sid] : [];
    const after = ids.map(i => a.param(i));
    a.partners = saved;
    const P = $data.system.terms.params;
    return ids.filter(i => after[i] !== before[i]).map(i => `${P[i]} ${after[i] > before[i] ? '+' : '−'}${Math.abs(after[i] - before[i])}`).join('  ');
  }
  showOath(index) {
    const st = G.state, a = st.party.leader();
    if (!a) return;
    this.grid.close();
    const cur = a.partners[0] || 0;
    const locked = !!cur && !!st.actor(spiritActorId(cur))?.partnerLocked;
    const items = [{ text: tr('(서약 해제)'), id: 0, enabled: !!cur && !locked, desc: cur ? this.oathDelta(a, 0) : '' }];
    for (const sid of st.oathChoices(a)) {
      const it = this.oathInfo(sid), mine = sid === cur;
      items.push({ text: it.name, id: sid, enabled: !locked, right: mine ? `${it.lv} ${tr('서약 중')}`.trim() : it.lv,
        desc: [it.effect, mine ? '' : this.oathDelta(a, sid)].filter(Boolean).join('  ') });
    }
    this.list.open(a.name ? tr('서약  ({name})', { name: a.name }) : tr('서약'), items, {
      index: index ?? Math.max(0, items.findIndex(it => cur && it.id === cur)),
      onSelect: (i, it) => {
        if (!st.setOath(a, 0, it.id)) { G.audio?.playSystemSe(3); return; }
        G.audio?.playSystemSe(4);
        this.showOath(i);
      },
      onCancel: () => this.reopenMain('oath'),
    });
  }

  // ---- combat / display options ----
  showOptionsMenu(index = 0) {
    const s = G.settings;
    const SWING = [tr('약하게'), tr('보통'), tr('강하게'), tr('아주 강하게')];
    const WEIGHT = [tr('끔'), tr('약하게'), tr('보통'), tr('강하게')];
    const ANIMS = { all: tr('모두'), skills: tr('스킬만 (일반 공격 제외)'), off: tr('끔') };
    const RESPAWN = { map: tr('맵을 나갔다 오면'), slow: tr('1분 뒤 (멀리 있을 때)'), original: tr('원작대로 10초 뒤') };
    const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
    const items = [
      { text: tr('휘두르기 판정'), id: 'swing', right: SWING[s.swingLevel ?? 2], desc: tr('이 정도 세기로 휘둘러야 공격이 들어갑니다 (VR)') },
      { text: tr('무기 무게감'), id: 'weight', right: WEIGHT[s.weaponWeight ?? 2], desc: tr('무거운 무기일수록 세게 휘두르면 늦게 따라오고 멈춰도 더 나가며, 수평으로 들면 처집니다 · 가벼운 무기는 손에 딱 붙어 있습니다 (VR)') },
      { text: tr('이펙트 밝기'), id: 'fx', right: `${Math.round((s.fxBrightness ?? 0.5) * 100)}%`, desc: tr('번쩍임·빛·스킬 애니메이션의 밝기') },
      { text: tr('스킬 애니메이션'), id: 'anims', right: ANIMS[s.skillAnims || 'all'], desc: tr('원작 스킬·공격 애니메이션을 대상 위치에 재생합니다') },
      { text: tr('적이 벽 통과'), id: 'walls', right: s.enemyThroughWalls === false ? tr('끔') : tr('켬'), desc: tr('쫓아오는 적이 벽이나 소품에 끼지 않고 통과합니다') },
      { text: tr('쓰러뜨린 적 부활'), id: 'respawn', right: RESPAWN[s.respawn || 'map'], desc: tr('원작은 10초 뒤에 같은 자리에서 다시 나타납니다') },
      { text: tr('브레이크 판정'), id: 'break', right: (s.breakRule || 'original') === 'easy' ? tr('쉽게 (공격 준비 중이면)') : tr('원작대로'), desc: tr('원작대로: 대부분의 적은 기를 모을 때(금색 빛)나 방어할 때만 브레이크가 통합니다') },
      { text: tr('전투 BGM'), id: 'bgm', right: (s.battleBgm || 'boss') === 'all' ? tr('모든 전투 (원작)') : tr('보스전만'), desc: tr('보스전만: 전용 곡이 있는 전투만 음악이 바뀝니다 · 모든 전투: 일반 전투도 전투곡') },
      { text: tr('피격 붉은 테두리'), id: 'hitFlash', right: s.hitFlash === false ? tr('끔') : tr('켬'), desc: tr('공격에 맞으면 시야 가장자리가 잠깐 붉게 물듭니다') },
      { text: tr('피격 흔들림'), id: 'hitShake', right: s.hitShake === false ? tr('끔') : tr('켬'), desc: tr('공격에 맞으면 시야가 맞은 방향으로 살짝 흔들립니다 (멀미가 나면 끄세요)') },
      { text: tr('강한 공격에 밀려남'), id: 'knock', right: s.hitKnockback === false ? tr('끔') : tr('켬'), desc: tr('보스의 돌진에 맞으면 밀려나고, 뛰어올라 내려찍는 공격에 맞으면 위로 튀어오릅니다 (멀미가 나면 끄세요)') },
      { text: tr('하늘 배경'), id: 'sky', right: s.sky === false ? tr('끔') : tr('켬'), desc: tr('야외 맵의 원작 배경 그림(하늘·바다·우주 등)을 하늘에 두릅니다 (끄면 하늘 색의 하늘)') },
      { text: tr('하늘 색'), id: 'skyColor', right: skyColorName(s.skyColor), desc: tr('원작 배경 그림이 없는 곳의 하늘 색 (원작: 검정)') },
      { text: tr('행동 불가 상태이상'), id: 'restrain', right: s.restrainStates === true ? tr('켬') : tr('끔'), desc: tr('수면·스턴 등에 걸리면 원작처럼 그동안 움직이거나 공격할 수 없습니다 (끄면 움직일 수 있음)') },
    ];
    this.list.open(tr('전투·화면 설정'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'swing') s.swingLevel = ((s.swingLevel ?? 2) + 1) % 4;
        if (it.id === 'weight') { s.weaponWeight = ((s.weaponWeight ?? 2) + 1) % 4; G.combat?.weaponLag.setSway(G.combat.weaponSway()); }
        if (it.id === 'fx') s.fxBrightness = cycle([0.25, 0.5, 0.75, 1], s.fxBrightness ?? 0.5);
        if (it.id === 'anims') s.skillAnims = cycle(['all', 'skills', 'off'], s.skillAnims || 'all');
        if (it.id === 'walls') s.enemyThroughWalls = s.enemyThroughWalls === false;
        if (it.id === 'respawn') s.respawn = cycle(['map', 'slow', 'original'], s.respawn || 'map');
        if (it.id === 'bgm') s.battleBgm = (s.battleBgm || 'boss') === 'all' ? 'boss' : 'all';
        if (it.id === 'break') s.breakRule = (s.breakRule || 'original') === 'easy' ? 'original' : 'easy';
        if (it.id === 'hitFlash') s.hitFlash = s.hitFlash === false;
        if (it.id === 'hitShake') s.hitShake = s.hitShake === false;
        if (it.id === 'knock') s.hitKnockback = s.hitKnockback === false;
        if (it.id === 'sky') { s.sky = s.sky === false; G.sky?.refresh(); }
        if (it.id === 'skyColor') { this.showSkyColorMenu(0, i); return; }
        if (it.id === 'restrain') s.restrainStates = s.restrainStates !== true;
        G.saveSettings?.();
        this.showOptionsMenu(i);
      },
      onCancel: () => this.reopenMain('options'),
    });
  }

  // 하늘 색: the sky where the map shows no picture (sky.js baseSky) - a colour of the list, or red, green and blue as the
  // player likes; it shows at once round the menu
  showSkyColorMenu(index = 0, back = 0) {
    const s = G.settings;
    const hex = /^#[0-9a-f]{6}$/i.test(s.skyColor || '') ? s.skyColor.toLowerCase() : SKY_COLORS[0];
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const set = v => {
      s.skyColor = v === SKY_COLORS[0] ? undefined : v;
      G.saveSettings?.();
      G.sky?.refresh();
    };
    const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    const preset = SKY_COLORS.indexOf(hex);
    const step = (id, dx) => {
      if (id === 'preset') set(SKY_COLORS[((preset < 0 ? 0 : preset) + dx + SKY_COLORS.length) % SKY_COLORS.length]);
      else { const c = [...rgb], k = 'rgb'.indexOf(id); c[k] = Math.max(0, Math.min(255, c[k] + 17 * dx)); set(toHex(c)); }
    };
    const items = [
      { text: tr('색'), id: 'preset', right: skyColorName(hex), desc: tr('고르면 다음 색, 좌우로도 바꿉니다') },
      { text: tr('빨강'), id: 'r', right: String(rgb[0]), desc: tr('좌우로 조절합니다') },
      { text: tr('초록'), id: 'g', right: String(rgb[1]), desc: tr('좌우로 조절합니다') },
      { text: tr('파랑'), id: 'b', right: String(rgb[2]), desc: tr('좌우로 조절합니다') },
      { text: tr('원작대로 (검정)'), id: 'reset' },
    ];
    this.list.open(tr('하늘 색'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'reset') set(SKY_COLORS[0]);
        else step(it.id, 1);
        this.showSkyColorMenu(i, back);
      },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'reset') return false;
        step(it.id, dx);
        this.showSkyColorMenu(i, back);
        return true;
      },
      onCancel: () => this.showOptionsMenu(back),
    });
  }

  // ---- PC monitor spectator view: all of it is the player's choice ----
  showSpectatorMenu(index = 0) {
    const s = G.settings;
    const SMOOTH = [tr('끔'), tr('약하게'), tr('보통'), tr('강하게')];
    const items = [
      { text: tr('관전 화면'), id: 'on', right: s.spectator === false ? tr('끔') : tr('켬'), desc: tr('VR 중에 PC 모니터에 플레이어 시점을 보여 줍니다') },
      { text: tr('수평 고정 (머리 기울기 무시)'), id: 'level', right: s.spectatorLevel ? tr('켬') : tr('끔'), desc: tr('켜면 고개를 기울여도 관전 화면은 수평을 유지합니다') },
      { text: tr('흔들림 보정'), id: 'smooth', right: SMOOTH[s.spectatorSmooth | 0], desc: tr('머리의 작은 흔들림을 부드럽게 따라갑니다 (강할수록 느리게)') },
      { text: tr('시야각'), id: 'fov', right: `${s.spectatorFov || 80}°` },
    ];
    this.list.open(tr('PC 모니터 관전 화면'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'on') {
          s.spectator = s.spectator === false;
          if (G.vr) { if (s.spectator) G.spectator?.start(); else G.spectator?.stop(); }
        }
        if (it.id === 'level') s.spectatorLevel = !s.spectatorLevel;
        if (it.id === 'smooth') s.spectatorSmooth = ((s.spectatorSmooth | 0) + 1) % 4;
        if (it.id === 'fov') { const f = [70, 80, 90, 100]; s.spectatorFov = f[(f.indexOf(s.spectatorFov || 80) + 1) % f.length]; }
        G.saveSettings?.();
        this.showSpectatorMenu(i);
      },
      onCancel: () => this.reopenMain('spectator'),
    });
  }

  // ---- held model adjustment: the hold pose is set by hand (grip adjust mode), size / mirror here ----
  showAdjust(index = 0) {
    const specs = G.combat?.heldSpecs?.() || {};
    const target = this.adjTarget === 'offhand' && specs.offhand ? 'offhand' : 'weapon';
    const spec = specs[target];
    const adj = spec ? G.weaponAdjust.get(spec.key, spec.kind, spec.wtype, spec.hand, spec.item.icon_index) : null;
    const handName = target === 'offhand' ? (spec?.gun ? tr('왼손 (총)') : tr('왼손 (방패)')) : tr('오른손 (무기)');
    const items = [
      { text: tr('손으로 위치 잡기 (VR)'), id: 'grab', enabled: G.vr && !!(specs.weapon || specs.offhand),
        desc: tr('그립을 눌렀다 떼면 그 자리에 놓이고, 다시 쥐면 그 자세로 고정됩니다') },
      { text: tr('대상: {hand}', { hand: handName }), id: 'target', icon: spec?.item.icon_index, right: spec ? spec.item.name.trim() : tr('(장비 없음)'), enabled: !!specs.offhand || target === 'offhand',
        desc: tr('아래 크기·반전·기본값이 적용될 손') },
      { text: tr('크기 −10%'), id: 'sc-', enabled: !!adj, right: adj ? `${Math.round(adj.scale * 100)}%` : '' },
      { text: tr('크기 +10%'), id: 'sc+', enabled: !!adj },
      { text: tr('좌우 반전'), id: 'flip', enabled: !!adj, right: adj ? (adj.flip ? tr('켬') : tr('끔')) : '' },
      { text: tr('기본값으로 (잡은 자세도 초기화)'), id: 'reset', enabled: !!adj },
    ];
    this.list.open(tr('무기·방패 모양 조정'), items, {
      index,
      footer: tr('손에 든 모습은 아이템마다 따로 저장됩니다'),
      onSelect: (i, it) => {
        if (it.id === 'grab') { this.closeMenu(); G.combat.startGripAdjust(); return; }
        if (it.id === 'target') { this.adjTarget = target === 'offhand' ? 'weapon' : 'offhand'; this.showAdjust(1); return; }
        if (!adj) return;
        if (it.id === 'sc-') adj.scale = Math.max(0.3, +(adj.scale - 0.1).toFixed(2));
        if (it.id === 'sc+') adj.scale = Math.min(3, +(adj.scale + 0.1).toFixed(2));
        if (it.id === 'flip') { adj.flip = !adj.flip; delete adj.grip; }
        if (it.id === 'reset') G.weaponAdjust.reset(spec.key);
        else G.weaponAdjust.set(spec.key, adj);
        G.combat.equipKey = null;
        this.showAdjust(i);
      },
      onCancel: () => this.reopenMain('adjust'),
    });
  }
  showStatus() {
    const a = G.state.party.leader();
    const P = $data.system.terms.params;
    const items = [
      { text: `${a.name || '???'}  Lv ${a.level}`, right: $data.classes[a.classId]?.name || '' },
      { text: `HP ${a.hp}/${a.mhp}`, right: `MP ${a.mp}/${a.mmp}` },
      ...[2, 3, 4, 5, 6, 7].map(i => ({ text: P[i], right: String(a.param(i)) })),
      ...a.equips.map(e => { const d = itemData(e.kind, e.id); return { text: d ? d.name : '—', icon: d?.icon_index, enabled: !!d }; }),
      ...a.partners.map(sid => { const it = this.oathInfo(sid); return { text: it.name, right: it.lv, desc: it.effect }; }),
    ];
    this.list.open(tr('상태'), items, { onSelect: () => {}, onCancel: () => this.reopenMain('status') });
  }
  returnToTitle() { G.returnToTitle?.(); }

  // scenes requested by script calls
  openScene(name) {
    if (name === 'Scene_ShortMove') { this.openBonfireWarp(); return; }
    if (name === 'Scene_ItemSynthesis') { this.openSynthesis(); return; }
    if (name === 'Scene_Keep' || name === 'Scene_Item_Keep') { this.openKeep(); return; }
    const label = { Scene_ItemSynthesis: tr('무기 합성'), Scene_Keep: tr('아이템 보관') }[name] || name;
    this.toast(tr('{label}: VR판에서는 아직 지원하지 않습니다', { label }));
  }
  openBonfireWarp() {
    // (shown and picked as the original's window has it - scriptdata.js bonfireShown / bonfirePickable)
    const sw = id => G.state.sw(id);
    const list = (G.scripts.bonfires || []).filter(b => bonfireShown(b, sw));
    if (!list.length) {
      console.warn('[bonfire] none to travel to:', (G.scripts.bonfires || []).length, 'in the game\'s list');
      this.toast(tr('이동할 수 있는 화톳불이 없습니다'));
      return;
    }
    this.sceneOpen = 'bonfire';
    this.placeRoot(true);
    this.list.open(tr('화톳불 전송'), list.map(b => ({ text: b.name, desc: b.desc[0], enabled: bonfirePickable(b, sw) })), {
      onSelect: i => {
        const b = list[i];
        this.list.close(); this.sceneOpen = null;
        G.map.reserveTransfer(b.mapId, b.x, b.y, b.dir, 0);
        if (!G.coop?.phantom) for (const ce of b.commons) G.map.reserveCommonEvent(ce);      // (a co-op guest's: the host's world's to run)
      },
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  // Select Key Item (104): which key item; the variable gets its id (0: cancelled)
  openKeyItemChoice(varId) {
    const P = G.state.party;
    const items = $data.items.filter(d => d && d.name && d.itype_id === 2 && P.itemCount('item', d.id) > 0);
    this.sceneOpen = 'keyitem';
    this.placeRoot(true);
    const done = id => { G.state.setV(varId, id); this.list.close(); this.sceneOpen = null; };
    this.list.open(tr('중요한 아이템'), items.map(d => ({ text: d.name, icon: d.icon_index, right: String(P.itemCount('item', d.id)), desc: d.description })), {
      onSelect: i => done(items[i].id),
      onCancel: () => done(0),
    });
  }

  // 무기 강화 - the original's synthesis scene (Scene_ItemSynthesis): what the recipes switched on can make (the
  // bear's common event 7 switches on the next step of every weapon the player has, worn ones too), each greyed
  // until its materials are there; the footer shows what it takes and what is in the bag, as the original's
  // material window. A weapon worn is not in the bag (as in the original): take it off first. Picking one makes
  // it - how many, when more than one can be made - and the materials (and the cost) go
  openSynthesis(index = 0) {
    const syn = G.scripts?.synthesis;
    if (!syn?.recipes?.length) { this.toast(tr('{label}: VR판에서는 아직 지원하지 않습니다', { label: tr('무기 강화') })); return; }
    this.sceneOpen = 'synthesis';
    this.placeRoot(true);
    const P = G.state.party, sys = G.state.system;
    const on = r => !!sys.recipesAll || (r.kind === 'weapon' && (sys.recipes || []).includes(r.id));
    const list = syn.recipes.filter(r => (syn.categories.length ? syn.categories.includes(r.kind) : true) && on(r) && itemData(r.kind, r.id));
    const rows = list.map(r => {
      const d = itemData(r.kind, r.id);
      return { text: d.name, icon: d.icon_index, right: `[${P.itemCount(r.kind, r.id)}]`, enabled: this.synthMax(r) > 0, desc: this.synthNeeds(r, 1) };
    });
    this.list.open(tr('무기 강화'), rows, {
      index: Math.min(index, Math.max(0, rows.length - 1)),
      onSelect: i => {
        const r = list[i], max = this.synthMax(r);
        if (max <= 0) { G.audio?.playSystemSe(3); return; }
        const back = () => this.openSynthesis(i);
        if (max === 1) { this.synthMake(r, 1); back(); } else this.showSynthQuantity(r, back);
      },
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  // what a recipe takes, and how many of each the bag holds (a weapon worn says so: it does not count)
  // (as the original's material window: a material there is not enough of is greyed - one plain line hid why a +2 could
  // not be made: three 강화석 조각 needed, one held)
  synthNeeds(r, n) {
    const P = G.state.party, label = G.scripts?.synthesis?.materialLabel || tr('필요 소재');
    const OK = 'rgba(230,220,200,0.85)', SHORT = 'rgba(255,255,255,0.35)';
    const out = [[`${label}: `, OK]];
    r.mats.forEach((m, k) => {
      const d = itemData(m.kind, m.id), have = P.itemCount(m.kind, m.id);
      const worn = m.kind !== 'item' && !have && P.members().some(a => a.isEquipped(m.kind, m.id));
      out.push([`${k ? ', ' : ''}${stripEscapes(d?.name || '?')} ${m.n * n}/${have}${worn ? tr('(장착 중)') : ''}`, have < Math.max(1, m.n * n) ? SHORT : OK]);
    });
    if (r.cost > 0) out.push([`, ${(r.cost * n).toLocaleString()} ${$data.system.currency_unit}`, P.gold < r.cost * n ? SHORT : OK]);
    return out;
  }
  // how many can be made at once: what the materials (and money) cover, up to 99 at a time and the bag's limit
  synthMax(r) {
    const P = G.state.party;
    let max = Math.min(99, BAG_MAX - P.itemCount(r.kind, r.id));
    for (const m of r.mats) max = Math.min(max, m.n > 0 ? Math.floor(P.itemCount(m.kind, m.id) / m.n) : (P.itemCount(m.kind, m.id) > 0 ? 999 : 0));
    if (r.cost > 0) max = Math.min(max, Math.floor(P.gold / r.cost));
    return Math.max(0, max);
  }
  synthMake(r, n) {
    const P = G.state.party;
    P.gainGold(-r.cost * n);
    P.gainItem(r.kind, r.id, n);
    for (const m of r.mats) P.gainItem(m.kind, m.id, -m.n * n);
    G.audio?.playSystemSe(21);
  }
  // how many to make: stick left / right (PC ←→), or the rows; the first row makes them
  showSynthQuantity(r, back, n = 1, index = 0) {
    const max = this.synthMax(r);
    n = Math.max(1, Math.min(max, n));
    const d = itemData(r.kind, r.id);
    const items = [
      { text: tr('◀  {n}개  ▶  만들기', { n }), step: 0, desc: this.synthNeeds(r, n) },
      { text: '+1', step: 1, desc: this.synthNeeds(r, n) }, { text: '+10', step: 10, desc: this.synthNeeds(r, n) },
      { text: '−1', step: -1, desc: this.synthNeeds(r, n) }, { text: '−10', step: -10, desc: this.synthNeeds(r, n) },
      { text: tr('최대 ({n}개)', { n: max }), step: 'max', desc: this.synthNeeds(r, max) },
    ];
    this.list.open(stripEscapes(d.name), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n <= this.synthMax(r)) this.synthMake(r, n); back(); return; }
        this.showSynthQuantity(r, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showSynthQuantity(r, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }
  // 창고 - the original's storage scene (Scene_Item_Keep, script アイテム預かり所): a kind (as the item menu's), then
  // every thing of it in the bag or in the storage with how many are where; picking one opens how many to move -
  // into the storage or back out, 1 / 10 / 100 at a time or all that can go - done with the first row (B: nothing
  // moves). Things that may not be kept (<保存禁止>) are greyed. A weapon worn is not in the bag, as in the original
  keepTabs() {
    return [
      { label: tr('아이템'), kind: 'item', test: d => d.itype_id !== 2 },
      { label: tr('무기'), kind: 'weapon', test: () => true },
      { label: tr('방어구'), kind: 'armor', test: () => true },
      { label: tr('중요한 아이템'), kind: 'item', test: d => d.itype_id === 2 },
    ];
  }
  keepThings(t) {
    const P = G.state.party, K = G.scripts?.keep;
    const src = t.kind === 'weapon' ? $data.weapons : t.kind === 'armor' ? $data.armors : $data.items;
    return src.filter(d => d && d.name && t.test(d) && (P.itemCount(t.kind, d.id) > 0 || P.keptCount(t.kind, d.id) > 0) &&
      !(K?.hideSealed && P.keepSealed(t.kind, d.id)));
  }
  openKeep(tab = 0) {
    this.sceneOpen = 'keep';
    this.placeRoot(true);
    const tabs = this.keepTabs(), P = G.state.party;
    this.list.open(tr('창고'), tabs.map(t => {
      const things = this.keepThings(t);
      return { text: t.label, right: `${G.scripts?.keep?.keepLabel || tr('창고')} ${things.filter(d => P.keptCount(t.kind, d.id) > 0).length} / ${things.length}` };
    }), {
      index: tab,
      onSelect: i => this.showKeepList(i, 0),
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  showKeepList(tab, index) {
    const t = this.keepTabs()[tab], P = G.state.party, K = G.scripts?.keep;
    const things = this.keepThings(t);
    const bagL = K?.bagLabel || tr('소지'), keepL = K?.keepLabel || tr('창고');
    this.list.open(`${tr('창고')} · ${t.label}`, things.map(d => ({
      text: d.name, icon: d.icon_index, right: `${bagL} ${P.itemCount(t.kind, d.id)}   ${keepL} ${P.keptCount(t.kind, d.id)}`,
      enabled: !P.keepSealed(t.kind, d.id), desc: d.description,
    })), {
      index: Math.min(index, Math.max(0, things.length - 1)),
      onSelect: i => this.showKeepQuantity(tab, things[i], i),
      onCancel: () => this.openKeep(tab),
    });
  }
  // how many to move (+: into the storage, -: back out): stick right / left (PC →/←) one at a time, or the rows;
  // as the original, no more in than the bag has and the storage takes, no more out than it holds and the bag takes
  showKeepQuantity(tab, d, at, n = 0, index = 0) {
    const t = this.keepTabs()[tab], P = G.state.party, K = G.scripts?.keep, kind = t.kind;
    const bag = P.itemCount(kind, d.id), kept = P.keptCount(kind, d.id), limit = P.keepLimit(kind, d.id);
    const most = Math.max(0, Math.min(bag, limit - kept)), least = -Math.max(0, Math.min(kept, BAG_MAX - bag));
    n = Math.max(least, Math.min(most, n));
    const bagL = K?.bagLabel || tr('소지'), keepL = K?.keepLabel || tr('창고');
    const go = k => this.showKeepQuantity(tab, d, at, k, this.list.index);
    const items = [
      { text: `${bagL} ${bag - n}/${BAG_MAX}   ⇄   ${keepL} ${kept + n}/${limit}`, step: 0,
        right: n > 0 ? tr('{n}개 맡기기', { n }) : n < 0 ? tr('{n}개 꺼내기', { n: -n }) : '',
        desc: tr('스틱 →/←: 1개씩 · 이 줄 A/트리거: 확정 · B: 취소') },
      { text: tr('맡기기 +1'), step: 1 }, { text: tr('맡기기 +10'), step: 10 }, { text: tr('맡기기 +100'), step: 100 }, { text: tr('전부 맡기기'), step: 'in' },
      { text: tr('꺼내기 −1'), step: -1 }, { text: tr('꺼내기 −10'), step: -10 }, { text: tr('꺼내기 −100'), step: -100 }, { text: tr('전부 꺼내기'), step: 'out' },
    ];
    this.list.open(stripEscapes(d.name), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n) P.keep(kind, d.id, n); this.showKeepList(tab, at); return; }
        go(it.step === 'in' ? most : it.step === 'out' ? least : n + it.step);
      },
      onAdjust: dx => { go(n + dx); return true; },
      onCancel: () => this.showKeepList(tab, at),
    });
  }
  // as the original's shop (Scene_Shop): buy, sell - unless the event made it a shop to buy from only - or leave. With the
  // compose shop's switch on (지하감옥's candy merchant - scriptdata.js composeShop) each good also takes the things its note
  // names (candies): none bought without them, and they go with what is bought
  openShop(goods, purchaseOnly) {
    this.sceneOpen = 'shop';
    this.placeRoot(true);
    const C = G.scripts?.compose;
    this.compose = C?.switchId && G.state.sw(C.switchId) ? C : null;
    const entries = goods.map(g => {
      const kind = ['item', 'weapon', 'armor'][g[0]];
      const d = itemData(kind, g[1]);
      if (!d) return null;
      const price = g[2] === 0 ? d.price : g[3];
      return { kind, d, price, mats: this.compose ? composeMats(d, this.compose.word) : [] };
    }).filter(Boolean);
    this.shopKeep = false;
    if (purchaseOnly) this.showShopBuy(entries, null);
    else this.showShopCommand(entries);
  }
  closeShop() { this.list.close(); this.sceneOpen = null; this.shopKeep = false; this.compose = null; }
  // (the compose shop) what n of a good take, and how many of each there are: '캔디 소지 수량: 캔디 5/12'
  composeLine(e, n = 1) {
    const P = G.state.party;
    return `${this.compose.title || ''}${this.compose.title ? ': ' : ''}${e.mats.map(m => `${stripEscapes(itemData(m.kind, m.id).name)} ${m.n * n}/${P.itemCount(m.kind, m.id)}`).join(', ')}`;
  }
  // the price column: as the original's, a price of 0 left out in the compose shop (NoDraw); the list's written as the
  // original writes it (1000), the quantity window's grouped (1,000)
  shopPrice(e, n = 1, group = true) {
    return this.compose?.noDraw && e.price <= 0 ? '' : `${group ? (e.price * n).toLocaleString() : e.price * n} ${$data.system.currency_unit}`;
  }
  showShopCommand(entries, index = 0) {
    const P = G.state.party;
    this.list.open(tr('상점  (소지: {gold} {unit})', { gold: P.gold, unit: $data.system.currency_unit }), [
      { text: this.compose?.name || tr('구입한다'), id: 'buy' }, { text: tr('판다'), id: 'sell' }, { text: tr('그만둔다'), id: 'leave' },
    ], {
      index,
      onSelect: (i, it) => {
        if (it.id === 'buy') this.showShopBuy(entries, () => this.showShopCommand(entries, 0));
        else if (it.id === 'sell') this.showShopSell(() => this.showShopCommand(entries, 1));
        else this.closeShop();
      },
      onCancel: () => this.closeShop(),
    });
  }
  // (the storage script gives every shop a storage mode: what is bought goes into the storage, what is sold comes out
  // of it - its first row switches it, unless the script's switch holds that back; as the original it is off each time a
  // shop opens)
  shopCanKeep() { const K = G.scripts?.keep; return !!K?.shop && !(K.shopSwitch > 0 && G.state.sw(K.shopSwitch)); }
  shopToggleKeep() {
    const K = G.scripts?.keep;
    this.shopKeep = !this.shopKeep;
    if (K.se) G.audio?.playSe(K.se);
    const msg = this.shopKeep ? K.toKeep : K.toBag;
    if (msg) this.toast(msg);
  }
  showShopBuy(entries, back) {
    let at = 0;
    const K = G.scripts?.keep, P = G.state.party;
    const canKeep = this.shopCanKeep();
    const draw = () => {
      const rows = entries.map(e => ({
        text: e.d.name, icon: e.d.icon_index, enabled: this.shopMaxBuy(e) > 0,
        desc: e.mats?.length ? `${this.composeLine(e)}\n${e.d.description}` : e.d.description,
        right: `${this.shopPrice(e, 1, false)}${this.shopPrice(e) ? '  ' : ''}[${this.shopKeep ? `${K.keepLabel || tr('창고')} ${P.keptCount(e.kind, e.d.id)}` : P.itemCount(e.kind, e.d.id)}]`,
      }));
      if (canKeep) rows.unshift({ text: this.shopKeep ? tr('산 물건 → 창고') : tr('산 물건 → 소지품'), toggle: true, desc: tr('A/트리거: 산 물건을 넣을 곳 바꾸기') });
      this.list.open(tr('상점  (소지: {gold} {unit})', { gold: P.gold, unit: $data.system.currency_unit }), rows, {
      index: at,
      onSelect: (i, it) => {
        at = i;
        if (it.toggle) { this.shopToggleKeep(); draw(); return; }
        const e = entries[canKeep ? i - 1 : i];
        // none can be had (money, a full bag): no; only one: bought at once; more: how many (as the original's
        // number window)
        const max = this.shopMaxBuy(e);
        if (max <= 0) { G.audio?.playSystemSe(3); return; }
        if (max === 1) { this.shopBuy(e, 1); draw(); }
        else this.showShopQuantity(e, draw);
      },
      onCancel: () => (back ? back() : this.closeShop()),
      });
    };
    draw();
  }
  // selling (the original's Window_ShopSell): what the bag holds - the storage's, in its mode - each for half its price
  // (selling_price); one with no price is not taken; a key item, never. How many: as buying asks
  showShopSell(back, at = 0) {
    const P = G.state.party, unit = $data.system.currency_unit, canKeep = this.shopCanKeep();
    const rows = [];
    if (canKeep) rows.push({ text: this.shopKeep ? tr('창고에서 판다') : tr('소지품에서 판다'), toggle: true, desc: tr('A/트리거: 팔 물건을 꺼낼 곳 바꾸기') });
    for (const kind of ['item', 'weapon', 'armor']) {
      const from = this.shopKeep ? P.kept[kind] : P.container(kind);
      for (const [id, n] of [...(from || [])].sort((a, b) => a[0] - b[0])) {
        const d = itemData(kind, id);
        if (!d || n <= 0 || (kind === 'item' && d.itype_id === 2)) continue;
        const price = Math.floor((d.price || 0) / 2);
        rows.push({ text: d.name, icon: d.icon_index, desc: d.description, enabled: price > 0, right: `${price} ${unit}  [${n}]`, kind, d, price });
      }
    }
    if (!rows.length) { this.toast(tr('팔 수 있는 것이 없습니다')); back(); return; }
    this.list.open(tr('판다  (소지: {gold} {unit})', { gold: P.gold, unit }), rows, {
      index: Math.min(at, rows.length - 1),
      onSelect: (i, it) => {
        if (it.toggle) { this.shopToggleKeep(); this.showShopSell(back, i); return; }
        const max = this.shopSellMax(it);
        if (it.price <= 0 || max <= 0) { G.audio?.playSystemSe(3); return; }
        if (max === 1) { this.shopSell(it, 1); this.showShopSell(back, i); }
        else this.showShopSellQuantity(it, () => this.showShopSell(back, i));
      },
      onCancel: back,
    });
  }
  shopSellMax(e) { const P = G.state.party; return this.shopKeep ? P.keptCount(e.kind, e.d.id) : P.itemCount(e.kind, e.d.id); }
  shopSell(e, n) {
    const P = G.state.party;
    n = Math.min(n, this.shopSellMax(e));
    if (n <= 0) return;
    P.gainGold(e.price * n);
    if (this.shopKeep) { const left = P.keptCount(e.kind, e.d.id) - n; if (left > 0) P.kept[e.kind].set(e.d.id, left); else P.kept[e.kind].delete(e.d.id); }
    else P.gainItem(e.kind, e.d.id, -n);
    G.audio?.playSystemSe(21);
  }
  showShopSellQuantity(e, back, n = 1, index = 0) {
    const max = this.shopSellMax(e), unit = $data.system.currency_unit;
    n = Math.max(1, Math.min(max, n));
    const items = [
      { text: tr('◀  {n}개  ▶  판다', { n }), right: `${(e.price * n).toLocaleString()} ${unit}`, step: 0,
        desc: tr('스틱 좌우(PC ←→)로 1개씩 · A/트리거로 판매 · B 취소') },
      { text: '+1', step: 1 }, { text: '+10', step: 10 }, { text: '−1', step: -1 }, { text: '−10', step: -10 },
      { text: tr('전부 ({n}개)', { n: max }), right: `${(e.price * max).toLocaleString()} ${unit}`, step: 'max' },
    ];
    this.list.open(tr('{name} 판매', { name: stripEscapes(e.d.name) }), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { this.shopSell(e, n); back(); return; }
        this.showShopSellQuantity(e, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showShopSellQuantity(e, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }
  // how many of a shop's goods can be bought at once: what the money pays for, up to 99 at a time (the
  // original's number window) and the bag's limit
  shopMaxBuy(e) {
    const P = G.state.party;
    // (the storage mode: what the storage still takes; nothing it may not keep)
    const left = this.shopKeep ? (P.keepSealed(e.kind, e.d.id) ? 0 : P.keepLimit(e.kind, e.d.id) - P.keptCount(e.kind, e.d.id)) : BAG_MAX - P.itemCount(e.kind, e.d.id);
    let most = Math.min(99, left, e.price > 0 ? Math.floor(P.gold / e.price) : 99);
    // (the compose shop: as many as the things it takes are there for)
    for (const m of e.mats || []) if (m.n > 0) most = Math.min(most, Math.floor(P.itemCount(m.kind, m.id) / m.n));
    return Math.max(0, most);
  }
  shopBuy(e, n) {
    const P = G.state.party;
    for (const m of e.mats || []) if (m.n > 0) P.gainItem(m.kind, m.id, -m.n * n);
    P.gainGold(-e.price * n);
    if (this.shopKeep) P.kept[e.kind].set(e.d.id, P.keptCount(e.kind, e.d.id) + n);
    else P.gainItem(e.kind, e.d.id, n);
    G.audio?.playSystemSe(21);
  }
  // how many to buy: stick left / right (PC ←→) one at a time, or the rows (+1, +10, -1, -10, all); the first
  // row buys them
  showShopQuantity(e, back, n = 1, index = 0) {
    const max = this.shopMaxBuy(e);
    n = Math.max(1, Math.min(max, n));
    // (the compose shop: what n of it take, under the price)
    const cost = k => [this.shopPrice(e, k), e.mats?.length ? this.composeLine(e, k) : ''].filter(Boolean).join('  ');
    const verb = this.compose?.name;
    const items = [
      { text: verb ? tr('◀  {n}개  ▶  {verb}', { n, verb }) : tr('◀  {n}개  ▶  구입', { n }), right: cost(n), step: 0,
        desc: tr('스틱 좌우(PC ←→)로 1개씩 · A/트리거로 구입 · B 취소') },
      { text: '+1', step: 1 }, { text: '+10', step: 10 }, { text: '−1', step: -1 }, { text: '−10', step: -10 },
      { text: tr('최대 ({n}개)', { n: max }), right: cost(max), step: 'max' },
    ];
    this.list.open(verb ? `${stripEscapes(e.d.name)}  ${verb}` : tr('{name} 구입', { name: stripEscapes(e.d.name) }), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n <= this.shopMaxBuy(e)) this.shopBuy(e, n); back(); return; }
        this.showShopQuantity(e, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showShopQuantity(e, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.consumedConfirm = false;
    this.pointerTarget = false;
    if (this.actionLockUntil && G.time < this.actionLockUntil) this.consumedConfirm = true;
    const anyPanel = this.msg || this.menuOpen || this.sceneOpen || this.banner || this.toasts.length || this.remote?.shown || this.prompt?.shown;
    if (anyPanel) this.placeRoot();
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.dur) {
        const b = this.banner;
        this.banner = null;
        if (b.blocking) G.arena?.onBannerEnd();          // VICTORY ACHIEVED after a boss: back to where it began
      }
      this.drawBanner();
    }
    if (this.msg) this.updateMessage(dt);
    else if (this.menuOpen || this.sceneOpen) {
      if (this.keyboard.visible) this.keyboard.update(this.pointerRay());
      else if (this.chatKeyboard.visible) this.chatKeyboard.update(this.pointerRay());
      else if (this.grid.visible) this.grid.update(this.pointerRay());
      else if (this.menuScreen.visible) this.menuScreen.update(this.pointerRay());
      else if (this.list.visible) this.list.update(this.pointerRay());
      this.consumedConfirm = true;
    } else if (G.input.menu() && G.map && (!G.map.interpreter.running() || G.map.interpreter.waitMode === 'battle') && !G.combat?.playerDead) {
      // (an event holding the map for its fight - 그랑・기뇰's play: the menu opens as in any fight, as walking goes on)
      this.openMenu();
    }
    this.updateBossPrompt(dt);
    this.updateRemote(dt);
    if (this.toasts.length) {
      for (const t of this.toasts) t.t += dt;
      const before = this.toasts.length;
      this.toasts = this.toasts.filter(t => t.sticky || t.t < (t.life || 3.5));
      if (before !== this.toasts.length || G.frame % 6 === 0) this.drawToasts();
    }
    this.drawHud();
    this.updateHudFollow();
    this.updatePointerLine();
  }
  updateHudFollow() {
    if (!this.hudFollow) { if (this.hud.mesh.parent === this.camera) this.placeDeskHud(); return; }
    const p = new THREE.Vector3();
    this.hudFollow.getWorldPosition(p);
    p.y += 0.11;
    this.hud.mesh.position.copy(p);
    const head = new THREE.Vector3();
    this.camera.getWorldPosition(head);
    this.hud.mesh.lookAt(head);
  }
  // snap turning stays off while a menu / choice uses the right stick
  blocksTurning() { return this.menuOpen || !!this.sceneOpen || this.msg?.state === 'choice' || this.msg?.state === 'number' || !!this.prompt?.shown; }
  updatePointerLine() {
    const c = G.input.controllers.right;
    const need = G.vr && c && ((this.msg && this.msgPanel.mesh.visible) || this.msg?.state === 'choice' || this.menuOpen || this.sceneOpen || this.prompt?.shown);
    if (!this.pointerLine && c) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]);
      this.pointerLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe8d8a8, transparent: true, opacity: 0.6 }));
      this.pointerLine.renderOrder = 3050;      // seen on a dark screen too, under the panels it points at
      c.ray.add(this.pointerLine);
    }
    if (this.pointerLine) this.pointerLine.visible = !!need;
  }
}
