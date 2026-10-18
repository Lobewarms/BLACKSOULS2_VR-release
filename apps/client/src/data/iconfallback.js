// Optional local cache made from the player's own archive by the Windows launcher.
// The running backend must identify the same game before any cached art is used.
export async function archivedIconCanvas() {
  try {
    const [metadata, ping] = await Promise.all([
      fetch('/local-assets/icons.json', { cache: 'no-store' }), fetch('/api/ping', { cache: 'no-store' }),
    ]);
    if (!metadata.ok || !ping.ok) return null;
    const [cache, running] = await Promise.all([metadata.json(), ping.json()]);
    const path = value => typeof value === 'string' ? value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() : '';
    if (!path(cache?.game) || path(cache.game) !== path(running?.game) ||
        !/^\/local-assets\/IconSet\.png\?revision=[a-f0-9]{64}$/.test(cache.iconSet || '')) return null;
    const image = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img); img.onerror = () => resolve(null);
      img.src = cache.iconSet;
    });
    if (!image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
    return canvas;
  } catch { return null; }
}

// A loose sheet can have transparent holes inside its valid bounds. Sample each
// immutable loaded canvas/cell once; existing artwork always keeps priority.
const iconAlpha = new WeakMap();
function cellHasPixels(sheet, index) {
  let cells = iconAlpha.get(sheet);
  if (!cells) { cells = new Map(); iconAlpha.set(sheet, cells); }
  if (cells.has(index)) return cells.get(index);
  let occupied = null;
  try {
    const pixels = sheet.getContext?.('2d', { willReadFrequently: true })
      ?.getImageData?.((index % 16) * 24, Math.floor(index / 16) * 24, 24, 24)?.data;
    if (pixels?.length === 24 * 24 * 4) {
      occupied = false;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) { occupied = true; break; }
    }
  } catch { /* Keep the primary when pixels cannot be inspected. */ }
  cells.set(index, occupied);
  return occupied;
}

export function sheetForIcon(primary, fallback, index = 0) {
  const fits = sheet => sheet && Number.isInteger(index) && index >= 0 &&
    (index % 16 + 1) * 24 <= sheet.width && (Math.floor(index / 16) + 1) * 24 <= sheet.height;
  if (!fits(primary)) return fits(fallback) ? fallback : null;
  if (!fits(fallback)) return primary;
  return cellHasPixels(primary, index) === false && cellHasPixels(fallback, index) === true ? fallback : primary;
}
