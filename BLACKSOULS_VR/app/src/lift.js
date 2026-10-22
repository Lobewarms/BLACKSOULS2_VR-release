// Lifts (BLACKSOULS II's リフト - 옥스・워드 대학교 5, 토끼 굴 4, 그을린 숲 4, 썩은 굴의 바다 8, 크리미아 간호 묘지 7-1): the
// original carries the player on the lift's platform (a 3 x 3 tile sprite) 68 or 69 rows straight up - or down - the screen,
// through the rock between its two landings: up the screen is up the shaft there. The map is built so (mapanalysis.js lifts,
// mapmesh.js): the top landing as many tiles above the bottom one as the ride has rows, the way between a slope cut through
// the rock, which stands whole round it - so the ride is seen from anywhere as it goes, at the original's own speed, the
// player's height following the slope. Here only the ride itself: the platform carried under the player (sprites.js), no
// footsteps and no falling behind on the way down (player.js). It is over once the player stands on a landing again (passable
// ground, not moving) or the map changes; stopped inside the rock (7-1's lift giving way), it goes on until the map changes.
// (A ride: gamemap.js PlayerChar.forceMoveRoute - mapanalysis.js liftRoute, throughRock: with or without a platform event -
// one with no page yet rides too -, up or down.)
import { G } from './globals.js';

export class LiftRide {
  constructor() {
    this.trip = null;
  }
  get riding() { return !!this.trip; }
  // whether this event is the platform being ridden (sprites.js: drawn under the player)
  carries(ch) { return !!this.trip && this.trip.platform === ch; }
  // a ride begins - or turns (7-1's lift going back down): pc the player, platform the lift's event (or null: none found), run
  // {dir 1 / 4, n}
  ride(pc, platform, run) {
    const r = this.trip;
    if (r && r.mapId === G.map.mapId) { r.dir = run.dir; r.platform = platform; return; }
    this.trip = { mapId: G.map.mapId, platform, dir: run.dir };
  }
  // every frame (main.js)
  update() {
    const r = this.trip, pc = G.map?.playerChar;
    if (r && (!pc || G.map.mapId !== r.mapId || (!pc.moveRouteForcing && !pc.moving() && G.map.grid.anyPassable(pc.x, pc.y)))) this.trip = null;
  }
  end() { this.trip = null; }
}
