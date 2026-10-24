// The voice chat marks (co-op - coopvoice.js): a microphone, green while talking is on (the voice setting 'talk') and grey
// otherwise, and headphones, green while listening is on ('listen' or 'talk') and grey with voice off - both see-through,
// the microphone solid while that player is speaking (its microphone hearing a voice). Shown next to the status window
// (ui.js drawVoiceBadge) and next to the others' names over their heads (coopavatar.js). The pictures: src/icons/ (square,
// their drawing in the middle - where it is drawn is measured, so the two sit evenly apart whatever the pictures).
const FILES = { micOn: 'mic_on.png', micOff: 'mic_off.png', earOn: 'listen_on.png', earOff: 'listen_off.png' };
const DIM = 0.4;                     // how much of them shows (of the microphone: while that player is not speaking)
const GAP = 0.12;                    // between the two drawings, of the size
const pics = {}, drawn = {};         // the pictures; the part of each drawn, as fractions of its square [x0, y0, x1, y1]
let ready = false, loading = false;

function measure(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (a[(y * c.width + x) * 4 + 3] <= 40) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? [0, 0, 1, 1] : [x0 / c.width, y0 / c.height, (x1 + 1) / c.width, (y1 + 1) / c.height];
}
// the pictures loaded (asked for the first time it is asked: until then, and while they load, no marks)
export function voiceMarksReady() {
  if (!ready && !loading && typeof Image === 'function') {
    loading = true;
    let left = Object.keys(FILES).length;
    for (const [k, f] of Object.entries(FILES)) {
      const img = new Image();
      img.onload = () => { pics[k] = img; drawn[k] = measure(img); if (--left === 0) ready = true; };
      img.onerror = () => console.warn('[voice] mark picture missing', f);
      img.src = new URL(`./icons/${f}`, import.meta.url).href;
    }
  }
  return ready;
}
// the voice setting as the others are told it (coop.js look vc): 0 off, 1 listen only, 2 talk too
export const voiceCode = mode => (mode === 'talk' ? 2 : mode === 'listen' ? 1 : 0);

// where the two drawings go, the pictures size x size: the microphone, then the headphones beside it (or under it - column),
// each centred across the other way; [the room both take (w, h), [picture, its square's x, y] x2] from the room's top left
function layout(size, code, column) {
  const mic = code === 2 ? 'micOn' : 'micOff', ear = code >= 1 ? 'earOn' : 'earOff';
  const [a, b] = [drawn[mic], drawn[ear]];
  const wa = (a[2] - a[0]) * size, ha = (a[3] - a[1]) * size, wb = (b[2] - b[0]) * size, hb = (b[3] - b[1]) * size, gap = GAP * size;
  if (column) {
    const w = Math.max(wa, wb);
    return [[w, ha + gap + hb], [[mic, (w - wa) / 2 - a[0] * size, -a[1] * size], [ear, (w - wb) / 2 - b[0] * size, ha + gap - b[1] * size]]];
  }
  const h = Math.max(ha, hb);
  return [[wa + gap + wb, h], [[mic, -a[0] * size, (h - ha) / 2 - a[1] * size], [ear, wa + gap - b[0] * size, (h - hb) / 2 - b[1] * size]]];
}
// how much room the two take, drawn with the pictures size x size: [w, h] ([0, 0] while the pictures load)
export function voiceMarksSize(size, column = false) { return voiceMarksReady() ? layout(size, 2, column)[0] : [0, 0]; }
// the two drawn into that room, its top left at (x, y)
export function drawVoiceMarks(ctx, x, y, size, code, speaking, column = false) {
  if (!voiceMarksReady()) return;
  ctx.save();
  for (const [k, px, py] of layout(size, code, column)[1]) {
    ctx.globalAlpha = speaking && k.startsWith('mic') ? 1 : DIM;
    ctx.drawImage(pics[k], x + px, y + py, size, size);
  }
  ctx.restore();
}
