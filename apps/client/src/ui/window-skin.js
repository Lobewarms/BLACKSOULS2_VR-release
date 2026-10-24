// VX Ace Window.png: background, frame and selection cursor from the player's game.
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
let skin = null;
const toned = new Map();
export function setWindowSkin(image) { skin = image?.width >= 128 && image?.height >= 128 ? image : null; toned.clear(); }
export function windowTone() {
  const value = G.state?.system?.windowTone || $data.system?.window_tone || {};
  const channel = (key, min, max) => Math.max(min, Math.min(max, Number.isFinite(value[key]) ? value[key] : 0));
  return { red: channel('red', -255, 255), green: channel('green', -255, 255), blue: channel('blue', -255, 255), gray: channel('gray', 0, 255) };
}
export function windowToneKey() { const t = windowTone(); return `${t.red},${t.green},${t.blue},${t.gray}`; }
export function tintWindowPixels(pixels, tone) {
  const k = tone.gray / 255;
  for (let i = 0; i < pixels.length; i += 4) {
    let r = pixels[i] + tone.red, g = pixels[i + 1] + tone.green, b = pixels[i + 2] + tone.blue;
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    if (k) { r += (gray - r) * k; g += (gray - g) * k; b += (gray - b) * k; }
    pixels[i] = Math.max(0, Math.min(255, r)); pixels[i + 1] = Math.max(0, Math.min(255, g)); pixels[i + 2] = Math.max(0, Math.min(255, b));
  }
  return pixels;
}
function backgroundSkin() {
  const t = windowTone(), key = windowToneKey();
  if (!(t.red || t.green || t.blue || t.gray)) return skin;
  if (toned.has(key)) return toned.get(key);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(skin, 0, 0);
    const image = context.getImageData(0, 0, 64, 128); tintWindowPixels(image.data, t); context.putImageData(image, 0, 0);
    if (toned.size >= 8) toned.clear(); toned.set(key, canvas); return canvas;
  } catch { return skin; }
}
function slices(ctx, sx, sy, size, border, x, y, w, h, centre = true) {
  const b = Math.min(border, w / 2, h / 2);
  const source = [0, border, size - border], lengths = [border, size - border * 2, border];
  const targetX = [x, x + b, x + w - b], targetY = [y, y + b, y + h - b], widths = [b, w - b * 2, b], heights = [b, h - b * 2, b];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (!centre && row === 1 && col === 1) continue;
    if (widths[col] > 0 && heights[row] > 0) ctx.drawImage(skin, sx + source[col], sy + source[row], lengths[col], lengths[row], targetX[col], targetY[row], widths[col], heights[row]);
  }
}
export function drawGameWindow(ctx, x, y, w, h, alpha = 0.9, frameAlpha = 1) {
  if (!skin) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha;
  const back = backgroundSkin();
  ctx.drawImage(back, 1, 1, 62, 62, x + 2, y + 2, w - 4, h - 4);
  for (let py = 2; py < h - 2; py += 64) for (let px = 2; px < w - 2; px += 64) {
    const cw = Math.min(64, w - 2 - px), ch = Math.min(64, h - 2 - py);
    ctx.drawImage(back, 0, 64, cw, ch, x + px, y + py, cw, ch);
  }
  ctx.globalAlpha = frameAlpha; slices(ctx, 64, 0, 64, 16, x, y, w, h, false); ctx.restore(); return true;
}
export function drawGameCursor(ctx, x, y, w, h) {
  if (!skin) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false; slices(ctx, 64, 64, 32, 4, x, y, w, h); ctx.restore(); return true;
}
export function drawGamePause(ctx, x, y, frame = 0, scale = 1) {
  if (!skin) return false;
  const f = Math.floor(frame / 8) & 3;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(skin, 96 + (f % 2) * 16, 64 + (f >> 1) * 16, 16, 16, x, y, 16 * scale, 16 * scale);
  ctx.restore(); return true;
}
