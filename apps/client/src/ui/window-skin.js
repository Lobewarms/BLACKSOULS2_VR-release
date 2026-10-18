// VX Ace Window.png: background, frame and selection cursor from the player's game.
let skin = null;
export function setWindowSkin(image) { skin = image?.width >= 128 && image?.height >= 128 ? image : null; }
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
  ctx.drawImage(skin, 1, 1, 62, 62, x + 2, y + 2, w - 4, h - 4);
  for (let py = 2; py < h - 2; py += 64) for (let px = 2; px < w - 2; px += 64) {
    const cw = Math.min(64, w - 2 - px), ch = Math.min(64, h - 2 - py);
    ctx.drawImage(skin, 0, 64, cw, ch, x + px, y + py, cw, ch);
  }
  ctx.globalAlpha = frameAlpha; slices(ctx, 64, 0, 64, 16, x, y, w, h, false); ctx.restore(); return true;
}
export function drawGameCursor(ctx, x, y, w, h) {
  if (!skin) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false; slices(ctx, 64, 64, 32, 4, x, y, w, h); ctx.restore(); return true;
}
