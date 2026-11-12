// What the UI (ui.js and its parts in ui/) shares: its constants (setting ids, the sky colours' list, sizes), the panels it
// draws on - a panel in the world (a canvas on a plane), lists, the menu screen, item grids, the keyboard - and their helpers.
import * as THREE from 'three';
import { clipChatText } from '../coopchat.js';
import { NAME_LEN, cleanName } from '../coopnet.js';
import { $data } from '../data.js';
import { FONT, fontLook, gameFont } from '../fonts.js';
import { G } from '../globals.js';
import { Hangul, KO_KEYS, KO_SHIFT } from '../hangul.js';
import { tr, lang as uiLang } from '../i18n.js';
import { minimapPlace } from '../minimap.js';
import { DEFAULT_SKY } from '../sky.js';
import { LINE, PAD, cursorBlink, drawArrows, drawCursor, drawFace, drawGauge, drawText, drawWindow, fittingHeight,
  fontSize } from '../rmwindow.js';
import { itemData } from '../state.js';
import { convertEscapes, drawIcon, stripEscapes, textColor } from '../uitext.js';

export const BOSS_ASK = 20;          // s a co-op player has to answer whether it joins a boss fight (askBossJoin)
export const WORLD_PORT = 28472;     // a community server's port unless its owner changed it (world_server.py)
export const VOICE_LABEL = () => ({ off: tr('끔'), listen: tr('듣기만'), talk: tr('말하기와 듣기') });
// (co-op) the voice chat marks beside the status window: their canvas (px, at the window's scale), each picture's size
export const VOICE_BADGE = [64, 112], VOICE_PIC = 72;
// the status panel: its window's width (original pixels), the states' icons on its row; how big it is - in metres (VR,
// over the left hand) and, on PC (in the bottom left corner), as a share of the screen's height - for each of those pixels
export const HUD_W = 320, HUD_ICONS = 12, HUD_M = 0.136 / 256, DESK_HUD = 0.28 / 256;
// (the compose shop - scriptdata.js composeShop) what a good takes besides its price, from its note's <合成設定:kind,id,n>
// lines, as the script reads them (a count left out: 1; a kind other than 0-2 or a thing that is not there: left out)
export function composeMats(d, word) {
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
export const clipText = (t, max) => { const a = [...String(t || '')]; return a.length > max ? a.slice(0, max - 1).join('') + '…' : a.join(''); };
// where the map shows (설정 → 지도): in VR over the right hand (as it starts), else a corner of the view
export const minimapWhere = () => (G.vr && minimapPlace().hand ? tr('지금 있는 곳 둘레의 지도를 오른손 위에 띄웁니다') : tr('지금 있는 곳 둘레의 지도를 화면 구석에 띄웁니다'));
// the rows of the settings menu (showSettingsMenu): coming back from one of them goes back there, not to the menu
export const SETTING_IDS = ['minimap', 'turn', 'diff', 'options', 'adjust', 'spectator'];
// 하늘 색's list (the first: the original's black; none chosen - dawn, sky.js DEFAULT_SKY)
export const SKY_COLORS = ['#030305', '#0b1430', DEFAULT_SKY, '#2a2140', '#5a6470', '#7fa8d8', '#b0705a', '#9aa0a6'];
export const skyColorName = hex => {
  const i = SKY_COLORS.indexOf((hex || DEFAULT_SKY).toLowerCase());
  return i < 0 ? tr('직접 설정') : [tr('검정 (원작)'), tr('밤하늘'), tr('새벽'), tr('어스름'), tr('흐린 하늘'), tr('맑은 하늘'), tr('노을'), tr('안개')][i];
};

// ------------------------------------------------------------------ panels
export class Panel {
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

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// a menu's text as the original's windows write it: over a thin dark outline (fillStyle and font as set); a row that
// cannot be picked at the original's translucent alpha (160)
export const DIM = 'rgba(255,255,255,0.63)';
export function outlined(ctx, text, x, y) {
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
export function dimBack(ctx, s, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h * s), a = 160 / 255, f = 12 / h;
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f, `rgba(0,0,0,${a})`);
  g.addColorStop(1 - f, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w * s, h * s);
}
export function windowBg(ctx, x, y, w, h, alpha = 0.82) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(18,16,22,${alpha})`); g.addColorStop(1, `rgba(6,5,8,${alpha})`);
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(190,170,130,0.55)'; ctx.stroke();
}

// ------------------------------------------------------------------ text

// Layout converted text into drawable ops; s = canvas pixels per RM pixel, base = the game's font size
// (lines are 24 RM px apart, taller only for bigger \{ text, like Window_Base). A line that would still run past
// maxX is shrunk to fit (the original clips it at the window edge). \$ is where the gold window opens.
export function layoutText(lines, x0, y0, s, ctx, base = 24, maxX = Infinity) {
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
export function drawOps(ctx, ops, count, alpha = 1) {
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
export const MW = 2;                      // canvas pixels per original pixel of the message windows
export const PPM = 1024;                  // their canvas pixels a metre (640 original pixels: 1.25 m)
export const CHOICE_ROWS = 6;             // the choice window's lines at most (選択肢拡張 RowMax): more scroll
export const SCROLL_PIECE = 512;          // original pixels of a scrolling text one texture holds (UI startScroll)
export const SKIP_DWELL = 0.08;           // s a message stays up while メッセージスキップ is held (input.js skipHeld)
// a message's letters a second, and the original's frames (its \. and \| waits) in seconds: by the time that went by, not
// by the frames drawn - a 90 Hz headset or a 165 Hz monitor types and waits as a 60 Hz one does
export const TEXT_CPS = 60, FRAME_S = 1 / 60;           // (the original's: a letter a frame at 60 a second)
export const screenW = () => G.scripts?.screen?.[0] || 544;
export const screenH = () => G.scripts?.screen?.[1] || 416;
// a row's description under a list (or the grid's): this many lines at most, broken between words, the last ending in '…'
// when there is more
export const DESC_LINES = 2;
export class ListPanel {
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
export const MS = 2;                      // canvas pixels per original pixel
export class MenuScreen {
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
export function wrapLines(ctx, text, maxW, maxLines) {
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
export class GridPanel {
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
export const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'back'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '_'],
  ['cancel', 'space', 'done'],
];
// (a chat line: the keyboard's signs too - coopchat.js cleanChat -, and 한/영: its letters Korean, put together as typed -
// hangul.js)
export const CHAT_ROWS = [...KEY_ROWS.slice(0, 4), ['.', ',', '?', '!', "'", ':', ';', '(', ')', '/', '@'], ['lang', ...KEY_ROWS[4]]];
export const KEY_UNITS = { back: 1.6, shift: 1.6, space: 5, done: 2.6, cancel: 2.2, lang: 1.8 };
export const NAME_KEY = /^[A-Za-z0-9 _-]$/;
export const clipName = (s, max) => [...String(s || '')].filter(c => NAME_KEY.test(c)).join('').replace(/ {2,}/g, ' ').replace(/^ /, '').slice(0, max);
export const clipChat = (s, max) => clipChatText(s, max);
// the game's keyboard (English): a name's (letters, digits, _ and -) - or, given its rows and rules, a chat line's (with 한/영:
// the letters' keys Korean jamo, put together into syllables as they are typed - the one being typed shown at the end)
export class KeyboardPanel {
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
