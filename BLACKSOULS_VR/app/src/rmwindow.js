// The original's windows, drawn as RGSS3's Window draws them from the game's window skin (Graphics/System/Window.png,
// 128 x 128): the background - its top left 64 x 64 stretched, the pattern under it (0,64) tiled over - in the window
// tone (the database's, or what Change Window Color (138) made it: BLACKSOULS II's is red -51, green and blue -255, a
// dark red) at the back opacity (192), the frame round it (its top right 64 x 64: 16-pixel corners, the edges between
// stretched), the cursor (64,64, 32 x 32: 4-pixel corners), the pause sign (96,64: four 16 x 16 frames) and the scroll
// arrows (88,16 and 88,40). And the text as Window_Base writes it: the game's font (fonts.js: the one its scripts name)
// in its size (Font.default_size - BLACKSOULS II: 19) on 24-pixel lines, with the font's thin dark outline (or as the
// scripts set Font.default_outline / shadow), in the skin's colours; the gauges, faces and the actor's simple status.
// Everything here is in the original's pixels times s (canvas pixels per original pixel).
import { G } from './globals.js';
import { $data } from './data.js';
import { loadCanvas } from './assets.js';
import { FONT, fontLook, gameFont } from './fonts.js';

let skin = null;
const backs = new Map();
export function setWindowSkin(canvas) { skin = canvas; backs.clear(); }

export const LINE = 24;          // Window_Base#line_height
export const PAD = 12;           // Window_Base#standard_padding
export const fittingHeight = n => n * LINE + PAD * 2;
export const fontSize = () => G.scripts?.fontSize || 24;      // Font.default_size (RGSS3's own: 24)

// the window tone now: what Change Window Color set, else the database's
export function windowTone() {
  const t = G.state?.system?.windowTone || $data.system?.window_tone;
  return t ? { red: t.red | 0, green: t.green | 0, blue: t.blue | 0, gray: t.gray | 0 } : { red: 0, green: 0, blue: 0, gray: 0 };
}

// the background of a window of w x h (canvas pixels), tone applied (Bitmap tone: each channel moved, then greyed)
function background(w, h, s, tone) {
  const key = `${w}x${h}@${s}:${tone.red},${tone.green},${tone.blue},${tone.gray}`;
  let c = backs.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(skin, 0, 0, 64, 64, 0, 0, c.width, c.height);
  const p = 64 * s;
  g.imageSmoothingEnabled = false;
  for (let y = 0; y < c.height; y += p) for (let x = 0; x < c.width; x += p) g.drawImage(skin, 0, 64, 64, 64, x, y, p, p);
  if (tone.red || tone.green || tone.blue || tone.gray) {
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data, k = tone.gray / 255;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + tone.red, gr = d[i + 1] + tone.green, b = d[i + 2] + tone.blue;
      if (k) { const l = (r * 0.299 + gr * 0.587 + b * 0.114); r += (l - r) * k; gr += (l - gr) * k; b += (l - b) * k; }
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = gr < 0 ? 0 : gr > 255 ? 255 : gr; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    g.putImageData(img, 0, 0);
  }
  if (backs.size > 64) backs.clear();
  backs.set(key, c);
  return c;
}

// a window at (x, y) of w x h, in original pixels; opacity / backOpacity as RGSS3's (0-255)
export function drawWindow(ctx, s, x, y, w, h, { opacity = 255, backOpacity = 192 } = {}) {
  const X = Math.round(x * s), Y = Math.round(y * s), W = Math.round(w * s), H = Math.round(h * s);
  ctx.save();
  if (!skin) {
    ctx.globalAlpha = opacity / 255 * 0.85;
    ctx.fillStyle = '#140c0c'; ctx.fillRect(X, Y, W, H);
    ctx.restore();
    return;
  }
  const m = Math.round(2 * s);
  ctx.globalAlpha = (opacity / 255) * (backOpacity / 255);
  ctx.drawImage(background(W - m * 2, H - m * 2, s, windowTone()), X + m, Y + m);
  ctx.globalAlpha = opacity / 255;
  ctx.imageSmoothingEnabled = false;
  const c = Math.round(16 * s);
  const part = (sx, sy, sw, sh, dx, dy, dw, dh) => { if (dw > 0 && dh > 0) ctx.drawImage(skin, sx, sy, sw, sh, dx, dy, dw, dh); };
  part(80, 0, 32, 16, X + c, Y, W - c * 2, c);                 // top
  part(80, 48, 32, 16, X + c, Y + H - c, W - c * 2, c);        // bottom
  part(64, 16, 16, 32, X, Y + c, c, H - c * 2);                // left
  part(112, 16, 16, 32, X + W - c, Y + c, c, H - c * 2);       // right
  part(64, 0, 16, 16, X, Y, c, c);
  part(112, 0, 16, 16, X + W - c, Y, c, c);
  part(64, 48, 16, 16, X, Y + H - c, c, c);
  part(112, 48, 16, 16, X + W - c, Y + H - c, c, c);
  ctx.restore();
}

// the selection cursor over a rect (original pixels)
export function drawCursor(ctx, s, x, y, w, h, alpha = 1) {
  if (!skin) {
    ctx.save(); ctx.globalAlpha = 0.3 * alpha; ctx.fillStyle = '#fff'; ctx.fillRect(x * s, y * s, w * s, h * s); ctx.restore();
    return;
  }
  const X = Math.round(x * s), Y = Math.round(y * s), W = Math.round(w * s), H = Math.round(h * s), m = Math.round(4 * s);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  const part = (sx, sy, sw, sh, dx, dy, dw, dh) => { if (dw > 0 && dh > 0) ctx.drawImage(skin, sx, sy, sw, sh, dx, dy, dw, dh); };
  part(68, 68, 24, 24, X + m, Y + m, W - m * 2, H - m * 2);
  part(68, 64, 24, 4, X + m, Y, W - m * 2, m);
  part(68, 92, 24, 4, X + m, Y + H - m, W - m * 2, m);
  part(64, 68, 4, 24, X, Y + m, m, H - m * 2);
  part(92, 68, 4, 24, X + W - m, Y + m, m, H - m * 2);
  part(64, 64, 4, 4, X, Y, m, m);
  part(92, 64, 4, 4, X + W - m, Y, m, m);
  part(64, 92, 4, 4, X, Y + H - m, m, m);
  part(92, 92, 4, 4, X + W - m, Y + H - m, m, m);
  ctx.restore();
}

// text as Window_Base#draw_text: in a rect (original pixels), aligned 0 left / 1 centre / 2 right, outlined; too wide
// for its rect, it is squeezed (as RGSS's draw_text)
export function drawText(ctx, s, text, x, y, w, h = LINE, align = 0, color = '#fff', { size, font, alpha = 1 } = {}) {
  text = String(text ?? '');
  if (!text) return;
  const px = (size || fontSize()) * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = gameFont(px, font || FONT);
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width, room = w * s;
  let X = x * s;
  const Y = (y + h / 2) * s;
  if (tw > room && room > 0) {
    ctx.translate(X, 0); ctx.scale(room / tw, 1); X = 0;
  } else if (align === 1) X += (room - tw) / 2;
  else if (align === 2) X += room - tw;
  if (fontLook.shadow) { ctx.fillStyle = '#000'; ctx.fillText(text, X + s, Y + s); }
  if (fontLook.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.strokeStyle = fontLook.outColor;
    ctx.strokeText(text, X, Y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, X, Y);
  ctx.restore();
}

// the pause sign (a key awaited): one of the skin's four frames (8 frames each) at the foot of a window of w x h, in its middle
export function drawPause(ctx, s, w, h, frame, alpha = 1) {
  if (!skin) return;
  const f = frame & 3;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skin, 96 + (f % 2) * 16, 64 + (f >> 1) * 16, 16, 16, Math.round((w - 16) / 2 * s), Math.round((h - 16) * s), 16 * s, 16 * s);
  ctx.restore();
}
// the scroll arrows (more above / below) at the top and the foot of a window of w x h, in its middle
export function drawArrows(ctx, s, w, h, up, down) {
  if (!skin || !(up || down)) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const x = Math.round((w / 2 - 8) * s);
  if (up) ctx.drawImage(skin, 88, 16, 16, 8, x, Math.round(4 * s), 16 * s, 8 * s);
  if (down) ctx.drawImage(skin, 88, 40, 16, 8, x, Math.round((h - 12) * s), 16 * s, 8 * s);
  ctx.restore();
}
// a window's cursor while it is being answered blinks as RGSS3's does: 40 frames, from full down to 95 / 255 and back
export function cursorBlink(time) {
  const i = Math.floor(time * 60) % 40;
  return (i <= 20 ? 255 - 8 * i : 95 + 8 * (i - 20)) / 255;
}

// Window_Base#draw_gauge: a 6-pixel bar at the foot of the line, its back and its fill (a gradient)
export function drawGauge(ctx, s, x, y, w, rate, c1, c2, back) {
  const gy = (y + LINE - 8) * s, fw = Math.floor(w * Math.max(0, Math.min(1, rate)));
  ctx.fillStyle = back; ctx.fillRect(x * s, gy, w * s, 6 * s);
  if (fw <= 0) return;
  const g = ctx.createLinearGradient(x * s, 0, (x + fw) * s, 0);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(x * s, gy, fw * s, 6 * s);
}

// faces (Graphics/Faces: 4 x 2 of 96 x 96)
const faces = new Map();
export function face(name) {
  if (!name) return null;
  if (!faces.has(name)) { faces.set(name, null); loadCanvas('Graphics/Faces', name).then(c => faces.set(name, c)).catch(() => {}); }
  return faces.get(name);
}
export function drawFace(ctx, s, name, index, x, y, enabled = true) {
  const img = face(name);
  if (!img) return false;
  ctx.save();
  ctx.globalAlpha = enabled ? 1 : 0.5;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (index % 4) * 96, Math.floor(index / 4) * 96, 96, 96, x * s, y * s, 96 * s, 96 * s);
  ctx.restore();
  return true;
}
