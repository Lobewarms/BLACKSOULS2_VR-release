import { TILE, autotileKind } from './tiles.js';

// The selected game's food-garden A4 sheet uses this wall-autotile slot for a
// flat red/black checkerboard. Its slot alone must not invent cliff heights.
// Other sheets, neighboring wall artwork and original passage retain their rules.
export function isAuthoredFloorAutotile(tileId, names) {
  return Number.isInteger(tileId) && tileId >= TILE.A4 && tileId < TILE.MAX
    && names?.[3] === '食肉園 (3)' && autotileKind(tileId) === 123;
}
