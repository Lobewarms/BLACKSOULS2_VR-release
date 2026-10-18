import { analyzeMap } from './mapanalysis.js';
import { destinationName } from '../data/data.js';

// Read the current event instances, whose active pages and positions can change
// after the world mesh was built. This never rebuilds geometry or changes tiles.
export function exitEventPosition(gameMap, event) {
  if (!event || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return null;
  const x = gameMap.wrapX?.(event.x) ?? event.x, y = gameMap.wrapY?.(event.y) ?? event.y;
  return gameMap.grid?.valid(x, y) ? { x, y } : null;
}

export function collectCurrentExits(gameMap) {
  if (!gameMap?.map || !gameMap.grid) return [];
  const raw = { ...gameMap.map, __id: gameMap.mapId };
  const exits = analyzeMap(raw, gameMap.grid, event => {
    const current = gameMap.events[event.id];
    return current && !current.erased && exitEventPosition(gameMap, current) ? current.page : null;
  }).exits;
  return exits.map(exit => {
    const position = exit.kind === 'event' ? exitEventPosition(gameMap, gameMap.events[exit.eventId]) : exit;
    return { ...exit, x: position.x, y: position.y,
      label: exit.mapId > 0 && exit.mapId !== gameMap.mapId ? destinationName(exit.mapId) : '' };
  });
}
