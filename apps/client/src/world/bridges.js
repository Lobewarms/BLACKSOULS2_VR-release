// Original VXTileE cells 102 and 107 are complete wooden bridge decks.
// Their boards are painted in opposite directions; neighboring cells contain
// railings, broken ends and stairs, which must keep their existing placement.
export function isBridgeDeckTile(id, tilesetNames) {
  if (!Number.isInteger(id) || id <= 0 || id >= 1024) return false;
  const slot = 5 + Math.floor(id / 256), cell = id % 256;
  return tilesetNames?.[slot] === 'VXTileE' && (cell === 102 || cell === 107);
}
