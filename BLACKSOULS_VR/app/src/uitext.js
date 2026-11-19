// The game's text and icons, as every panel draws them: the original's escape codes (\V[n], \N[n], \P[n], \G, the Korean
// patch's particles) turned into text, a message that is a big banner (VICTORY ACHIEVED), the windowskin's text colours
// and the icon set (loadUiAssets reads both). Kept apart from ui.js: weapons.js and quickslots.js need only these, and
// importing ui.js for them closed an import cycle (ui.js -> minimap.js -> mapmesh.js -> mapgen -> weapons.js -> ui.js).
import * as J from './skilljudge.js';
import { G } from './globals.js';
import { $data } from './data.js';
import { loadCanvas } from './assets.js';
import { setWindowSkin } from './rmwindow.js';

const DEFAULT_COLORS = ['#ffffff', '#20a0d6', '#ff784c', '#66cc40', '#99ccff', '#ccc0ff', '#ffffa0', '#808080',
  '#c0c0c0', '#2080cc', '#ff3810', '#00a010', '#3e9ade', '#a098ff', '#ffcc20', '#000000',
  '#84aaff', '#ffff40', '#ff2020', '#202040', '#e08040', '#f0c040', '#4080c0', '#40c0f0',
  '#80ff80', '#c08080', '#8080ff', '#ff80ff', '#00a040', '#00e060', '#a060e0', '#c080ff'];

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
// a message (its lines as the event has them) that is a big banner - VICTORY ACHIEVED: no face, no choices, and its place
// in the game's events (ref - coopguard.js refOf) one of BLACK SOULS II's banners (skilljudge.js - by place, never by its
// words): { text, color }, or null
export function bannerOf(msg, ref = msg.ref) {
  if (msg.face || msg.choices || !J.bannerAt(ref)) return null;
  const plain = msg.lines.map(stripEscapes).join(' ').trim();
  const raw = msg.lines.join('');
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
