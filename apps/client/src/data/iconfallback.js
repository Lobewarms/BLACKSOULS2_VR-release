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

export function sheetForIcon(primary, fallback, index = 0) {
  const fits = sheet => sheet && Number.isInteger(index) && index >= 0 &&
    (index % 16 + 1) * 24 <= sheet.width && (Math.floor(index / 16) + 1) * 24 <= sheet.height;
  return fits(primary) ? primary : fits(fallback) ? fallback : null;
}
