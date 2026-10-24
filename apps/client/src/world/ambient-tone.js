// Map notes describe a flat 2D screen grade. Strong grayscale plus channel
// offsets can hide the palette of the same artwork across an entire 3D view.
// Keep subdued environmental lighting while letting foliage, wood, snow and
// other original textures supply their own colours. Scripted effects use the
// original screen command; only automatic environmental grades pass here.
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));

export function mapNoteTone(note = '') {
  const match = /<色調\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(-?\d+))?\s*>/i.exec(note);
  return { red: clamp(Number(match?.[1]) || 0, -255, 255), green: clamp(Number(match?.[2]) || 0, -255, 255),
    blue: clamp(Number(match?.[3]) || 0, -255, 255), gray: clamp(Number(match?.[4]) || 0, 0, 255) };
}

// Original cutscenes can explicitly restore the map's automatic grade. Those
// restores use the same presentation policy as entry, including timed fades.
export function isMapAmbientTone(tone, note) {
  if (!tone) return false;
  const ambient = mapNoteTone(note);
  return [['red', 'r'], ['green', 'g'], ['blue', 'b'], ['gray', 'gray']]
    .every(([key, alias]) => (tone[key] ?? tone[alias] ?? 0) === ambient[key]);
}

export function ambientMapTone(tone = {}) {
  const channels = [tone.red ?? tone.r, tone.green ?? tone.g, tone.blue ?? tone.b].map(value => clamp(value, -255, 255));
  const mean = channels.reduce((sum, value) => sum + value, 0) / 3;
  const spread = Math.max(...channels) - Math.min(...channels);
  const strength = spread > 12 ? 12 / spread : 1;
  const dark = clamp(mean, -24, 0);
  const [red, green, blue] = channels.map(value => dark + (value - mean) * strength);
  return { red, green, blue, gray: clamp(tone.gray, 0, 12) };
}
