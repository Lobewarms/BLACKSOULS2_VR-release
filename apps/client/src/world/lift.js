import { G } from '../core/globals.js';

// Transient presentation of an original forced route. It never moves the RPG
// Maker character, changes passage flags, or persists a ride in save data.
export class LiftRide {
  constructor() { this.trip = null; }
  valid() {
    const trip = this.trip;
    return !!trip && trip.map === G.map && trip.mapId === G.map?.mapId && trip.state === G.state && trip.player === G.map?.playerChar;
  }
  get riding() { return this.valid(); }
  carries(character) { return this.valid() && this.trip.platform === character; }
  ride(player, platform, run) {
    if (player !== G.map?.playerChar || ![1, 4].includes(run?.dir) || !Number.isInteger(run.n) || run.n < 8) return;
    this.trip = { map: G.map, mapId: G.map.mapId, state: G.state, player, platform: platform || null, dir: run.dir };
  }
  update() {
    if (!this.trip) return;
    if (!this.valid()) { this.end(); return; }
    const player = this.trip.player;
    if (!player.moveRouteForcing && !player.moving() && G.map.grid?.anyPassable(player.x, player.y)) this.end();
  }
  end() { this.trip = null; }
}
