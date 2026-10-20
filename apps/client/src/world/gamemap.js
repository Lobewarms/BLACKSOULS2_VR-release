// Map runtime: events, interpreters, passability (with BLACKSOULS II region rules), transfers.
import { G } from '../core/globals.js';
import { $data, loadMap } from '../data/data.js';
import { MapGrid, T } from './mapmesh.js';
import { GameEvent, GameCharacter, commonEventList } from '../entities/character.js';
import { Interpreter } from '../game/interpreter.js';
import { isFallRoute, SWITCH_PASS, PLAYER_BLOCK_REGIONS, EVENT_PASS_REGIONS } from './mapanalysis.js';

// The first-person player seen through the RPG Maker character interface
export class PlayerChar extends GameCharacter {
  constructor() {
    super();
    this.id = -1;
    this.isPlayer = true;
    this.fx = 0; this.fy = 0;     // continuous position in tile units (tile center = integer)
    this.forcedTarget = null;
    this.moveSpeedRevision = 0;
    this.sceneMoveSpeed = null;
  }
  // continuous -> grid. realX/realY stay on the tile so free movement never counts as
  // RPG Maker "moving" (only forced move routes interpolate realX/realY).
  syncFromContinuous() {
    // (on a looping map the player walks on past the edge: fx keeps going, the cell is the one it wraps to)
    this.x = G.map.wrapX(Math.round(this.fx)); this.y = G.map.wrapY(Math.round(this.fy));
    this.realX = this.x; this.realY = this.y;
  }
  moveto(x, y) {
    super.moveto(x, y);
    this.fx = x; this.fy = y;
    G.player?.teleportTo(x, y);
  }
  collideWithCharacters(x, y) {
    return G.map.eventsXyNt(x, y).some(ev => ev.normalPriority());
  }
  // forced move routes on the player animate the camera along the grid
  updateMove() {
    super.updateMove();
    this.fx = this.realX; this.fy = this.realY;
  }
  update() {
    if (this.moveRouteForcing || this.moving() || this.jumping()) {
      super.update();
      this.fx = this.realX; this.fy = this.realY;
    } else {
      this.updateAnimation();
      if (!this.locked) this.stopCount++;
    }
  }
  increaseSteps() { G.state.party.steps++; }
  checkEventTriggerTouchFront() {}
  forceMoveRoute(route, sceneMoveSpeed = null) {
    if (isFallRoute(route, this.through)) G.player?.startScriptedFall();
    this.sceneMoveSpeed = sceneMoveSpeed;
    super.forceMoveRoute(route);
  }
  processMoveCommand(command) {
    super.processMoveCommand(command);
    if (command.code === 29) {
      this.moveSpeedRevision++;
      if (this.sceneMoveSpeed) {
        this.sceneMoveSpeed.revision = this.moveSpeedRevision;
        this.sceneMoveSpeed.scriptedSpeed = this.moveSpeed;
      }
    }
    if (!this.moveRouteForcing) this.sceneMoveSpeed = null;
  }
  setDirection(d) {
    // forced turns would rotate the user's view: only track the logical direction
    if (d) this.direction = d;
    this.stopCount = 0;
  }
}

export class GameMap {
  constructor() {
    this.mapId = 0;
    this.map = null;
    this.battlebacks = ['', ''];
    this.grid = null;
    this.events = {};
    this.eventList = [];
    this.interpreter = new Interpreter(0, true);
    this.playerChar = new PlayerChar();
    this.needRefresh = false;
    this.exitRevision = 0;
    this.exitPages = new WeakMap();
    this.transfer = null;          // pending {mapId, x, y, dir, fade}
    this.transferring = false;
    this.commonParallel = [];
    this.reservedCommon = [];
    this.regionCalls = {};
    this.oldRegion = -1;
    this.listeners = { pageChanged: [] };
  }
  get width() { return this.grid?.w || 0; }
  get height() { return this.grid?.h || 0; }
  // ---- looping maps: a cell (integer) wrapped onto the map; a continuous tile position (cell centre = integer)
  // wrapped onto [-0.5, size - 0.5); a position as seen from ref (the copy of it nearest to ref)
  wrapX(x) { const w = this.width; return this.loopX && w ? ((x % w) + w) % w : x; }
  wrapY(y) { const h = this.height; return this.loopY && h ? ((y % h) + h) % h : y; }
  wrapFX(fx) { const w = this.width; return this.loopX && w ? ((((fx + 0.5) % w) + w) % w) - 0.5 : fx; }
  wrapFY(fy) { const h = this.height; return this.loopY && h ? ((((fy + 0.5) % h) + h) % h) - 0.5 : fy; }
  nearX(x, ref) { const w = this.width; return this.loopX && w ? x + w * Math.round((ref - x) / w) : x; }
  nearY(y, ref) { const h = this.height; return this.loopY && h ? y + h * Math.round((ref - y) / h) : y; }
  validW(x, y) { return !!this.grid && this.grid.valid(this.wrapX(x), this.wrapY(y)); }
  newInterpreter() { return new Interpreter(1, false, 'parallel'); }
  requestRefresh() { this.needRefresh = true; }

  onEventPageChanged(ev) {
    const previousPage = this.exitPages.get(ev);
    this.exitPages.set(ev, ev.page);
    if (this.loading) return;
    if (previousPage !== ev.page) this.exitRevision++;
    G.combat?.onEventPageChanged(ev);
    // (a tile it lays that opens the way where the map's own tiles shut it - a bridge a lever lays: the 3D view is built again
    // with it, or without it - mapbuild.js openingTiles)
    const t = this.openingTile(ev);
    if (t !== (ev.opensWith || 0)) { ev.opensWith = t; G.onMapTilesChanged?.(); }
  }
  // the tile an event lays on its page that lets one by its cell where the map's own tiles do not (Game_Map#all_tiles), or 0
  openingTile(ev) {
    const g = this.grid;
    if (!ev.page || ev.erased || !(ev.tileId > 0) || ev.priorityType !== 0 || ev.through || !g?.valid(ev.x, ev.y) || g.anyPassable(ev.x, ev.y)) return 0;
    return [2, 4, 6, 8].some(d => g.passable(ev.x, ev.y, d, [ev.tileId])) ? ev.tileId : 0;
  }

  async load(mapId) {
    const map = await loadMap(mapId);
    this.loading = true;
    this.mapId = mapId;
    this.map = map;
    this.battlebacks = map.specify_battleback ? [map.battleback1_name || '', map.battleback2_name || ''] : ['', ''];
    this.grid = new MapGrid(map, $data.tilesets[map.tileset_id]);
    // RPG Maker's looping maps (scroll type 1 vertical, 2 horizontal, 3 both): walking off one edge comes in at
    // the other, so a position past an edge is the cell on the other side (wrapX / wrapY)
    const scroll = map.scroll_type || 0;
    this.loopX = scroll === 2 || scroll === 3;
    this.loopY = scroll === 1 || scroll === 3;
    this.blockedCells = null;     // wall faces only passable through a decoration (set by the 3D view)
    this.events = {};
    this.eventList = [];
    for (const [id, ev] of map.events) {
      const ge = new GameEvent(mapId, ev);
      this.events[id] = ge;
      this.eventList.push(ge);
    }
    // the events a scene moves about (another event's Set Move Route with steps or jumps for them): they act in
    // it - people, not things lying on the floor (sprites.js layMode)
    this.sceneActors = new Set();
    for (const ev of this.eventList) for (const p of ev.event.pages) for (const c of p.list || []) {
      if (c.code !== 205) continue;
      const id = c.parameters[0] === 0 ? ev.id : c.parameters[0];
      if (id > 0 && (c.parameters[1]?.list || []).some(m => m.code >= 1 && m.code <= 14)) this.sceneActors.add(id);
    }
    this.commonParallel = [];
    $data.commonEvents.forEach((ce, id) => {
      if (ce && ce.trigger === 2) this.commonParallel.push({ id, ce, interp: new Interpreter(1, false, 'parallel') });
    });
    this.regionCalls = {};
    for (const line of String(map.note || '').split(/\r?\n/)) {
      const m = /RCE:(\d+),(\d+),(\d+)/i.exec(line);
      if (m) this.regionCalls[+m[1]] = [+m[2], +m[3]];
    }
    this.oldRegion = -1;
    this.needRefresh = false;
    for (const ev of this.eventList) ev.opensWith = this.openingTile(ev);
    this.loading = false;
    return map;
  }

  // ソウル回収: re-place the soul event after a transfer
  afterTransfer() {
    const st = G.state;
    if (st.sw(69)) {
      const ev = this.events[1];
      if (ev && ev.isSoulEvent()) {
        if (this.mapId === st.v(21)) { ev.soulActive = true; ev.moveto(st.v(22), st.v(23)); }
        else ev.soulActive = false;
        ev.refresh();
      }
    }
  }

  refresh() {
    for (const ev of this.eventList) ev.refresh();
    this.needRefresh = false;
  }

  // ---- queries ----
  eventsXy(x, y) { x = this.wrapX(x); y = this.wrapY(y); return this.eventList.filter(ev => ev.pos(x, y)); }
  eventsXyNt(x, y) { x = this.wrapX(x); y = this.wrapY(y); return this.eventList.filter(ev => ev.posNt(x, y)); }
  eventIdXy(x, y) { x = this.wrapX(x); y = this.wrapY(y); const e = this.eventList.find(ev => ev.pos(x, y)); return e ? e.id : 0; }
  anyForcedRoute() { return this.eventList.some(e => e.moveRouteForcing) || this.playerChar.moveRouteForcing; }
  playerRegion() { return this.grid ? this.grid.region(this.playerChar.x, this.playerChar.y) : 0; }

  // RPG Maker counts an event drawn with a tile "below characters" (and not passing through) as part of
  // the map there (Game_Map#all_tiles): a church window or a statue put together from such events blocks
  // the way like the tiles it shows
  tilesAt(x, y) {
    let ids = null;
    for (const ev of this.eventList) {
      if (ev.x === x && ev.y === y && ev.tileId > 0 && ev.priorityType === 0 && !ev.through && ev.page && !ev.erased) (ids = ids || []).push(ev.tileId);
    }
    return ids;
  }
  // tile passability for a character, including region rules
  passableFor(ch, x, y, d) {
    const g = this.grid;
    const r = g.region(x, y);
    if (ch.isPlayer) {
      if (PLAYER_BLOCK_REGIONS.includes(r)) return false;
      if (SWITCH_PASS[r] && G.state.sw(SWITCH_PASS[r])) return true;
    } else if (EVENT_PASS_REGIONS.includes(r)) return true;
    return g.passable(x, y, d, this.tilesAt(x, y));
  }
  // can one stand on this cell (the dark a boss arena opened counts - arena.js)
  walkable(x, y) { return this.grid.anyPassable(x, y) || !!G.arena?.opens?.(x, y); }
  // used by the free-moving player collision: can the player cross from (x,y) in direction d?
  playerEdgePassable(x, y, d) {
    const dx = d === 4 ? -1 : d === 6 ? 1 : 0, dy = d === 8 ? -1 : d === 2 ? 1 : 0;
    x = this.wrapX(x); y = this.wrapY(y);
    const x2 = this.wrapX(x + dx), y2 = this.wrapY(y + dy);
    const g = this.grid;
    if (!g.valid(x2, y2)) return false;
    if (this.blockedCells?.has(x2 + y2 * g.w)) return false;
    if (G.arena?.blocksCell(x2, y2)) return false;      // a way out walled with fog during a boss fight
    // (the dark opened round a boss fight: open both ways between it and the floor)
    if ((G.arena?.opens(x2, y2) || G.arena?.opens(x, y)) && this.walkable(x, y) && this.walkable(x2, y2)) return true;
    const r1 = g.region(x, y), r2 = g.region(x2, y2);
    if (PLAYER_BLOCK_REGIONS.includes(r2)) return false;
    if (SWITCH_PASS[r2] && G.state.sw(SWITCH_PASS[r2])) return true;
    if (SWITCH_PASS[r1] && G.state.sw(SWITCH_PASS[r1]) && g.passable(x2, y2, 10 - d, this.tilesAt(x2, y2))) return true;
    return g.passable(x, y, d, this.tilesAt(x, y)) && g.passable(x2, y2, 10 - d, this.tilesAt(x2, y2));
  }

  // ---- event starting / interpreter ----
  reserveCommonEvent(id) { this.reservedCommon.push(id); }
  setupStartingEvent() {
    if (this.needRefresh) this.refresh();
    while (this.reservedCommon.length) {
      const id = this.reservedCommon.shift();
      const list = commonEventList(id);
      if (list) { this.interpreter.setup(list, 0); return true; }
    }
    const ev = this.eventList.find(e => e.starting);
    if (ev) {
      ev.starting = false;
      this.interpreter.setup(ev.list, ev.id);
      return true;
    }
    for (let id = 1; id < $data.commonEvents.length; id++) {
      const ce = $data.commonEvents[id];
      if (ce && ce.trigger === 1 && G.state.sw(ce.switch_id)) {
        this.interpreter.setup(ce.list, 0);
        return true;
      }
    }
    return false;
  }
  updateInterpreter() {
    for (let guard = 0; guard < 20; guard++) {
      this.interpreter.update();
      if (this.interpreter.running()) return;
      if (this.interpreter.eventId > 0) {
        this.events[this.interpreter.eventId]?.unlock();
        G.coop?.eventDone?.(this.interpreter.mapId, this.interpreter.eventId);     // (the developer's world: its lock goes)
        this.interpreter.clear();
      }
      if (this.transferring) return;
      if (!this.setupStartingEvent()) return;
    }
  }
  // (a co-op guest leading a map - coop.js) the event it began itself (ev.start: a boss fight's), and nothing that would
  // start of itself (autoruns, common events reserved or switched on: the host's world's to run); what it changes of the
  // world goes to the host (recording)
  updateLeadInterpreter() {
    this.reservedCommon = [];
    if (!this.interpreter.running()) {
      if (this.interpreter.eventId > 0) { this.events[this.interpreter.eventId]?.unlock(); this.interpreter.clear(); }
      const ev = this.eventList.find(e => e.starting);
      if (!ev) return;
      ev.starting = false;
      this.interpreter.setup(ev.list, ev.id);
    }
    G.coop.recording++;
    try { this.interpreter.update(); } finally { G.coop.recording--; }
  }
  isEventRunning() { return this.interpreter.running(); }

  // one logic frame (60 Hz)
  update() {
    if (this.needRefresh) this.refresh();
    // (a co-op phantom in another player's world: that world's events are its host's to run - coop.js; one leading a map
    // the host is not on runs only what it began itself - a boss fight the host let the guests have)
    const own = !G.coop?.phantom;
    if (own) {
      this.updateRegionEvents();
      this.updateInterpreter();
    } else if (G.coop.leadsNow) this.updateLeadInterpreter();
    this.playerChar.update();
    for (const ev of this.eventList) ev.update();
    if (own) for (const c of this.commonParallel) {
      if (!G.state.sw(c.ce.switch_id)) continue;
      if (G.combat?.inCombat && !c.interp.running()) continue;       // (as the original's battle scene: not during a fight)
      if (!c.interp.running()) c.interp.setup(c.ce.list, 0);
      c.interp.update();
    }
    for (const ev of this.eventList) if (ev.balloonTime > 0 && --ev.balloonTime === 0) ev.balloonId = 0;
    const pc = this.playerChar;
    if (pc.balloonTime > 0 && --pc.balloonTime === 0) pc.balloonId = 0;
    const t = G.state.system.timer;
    if (t.working && t.count > 0) t.count--;
  }
  updateRegionEvents() {
    const r = this.playerRegion();
    const call = this.regionCalls[r];
    if (call && (call[1] === 1 || this.oldRegion !== r)) this.reserveCommonEvent(call[0]);
    this.oldRegion = r;
  }

  // ---- player-triggered events ----
  startEventsAt(x, y, triggers, normal) {
    if (this.interpreter.running()) return false;
    let started = false;
    for (const ev of this.eventsXy(x, y)) {
      if (G.arena?.blocksTrigger(ev)) continue;          // a boss arena: only the fight's own event
      if (ev.triggerIn(triggers) && ev.normalPriority() === normal && ev.start()) started = true;
    }
    return started;
  }
  // player arrived on a new tile
  onPlayerTile(x, y) {
    this.startEventsAt(x, y, [1, 2], false);
  }
  // action button: (x,y) player tile, (fx,fy) tile in front
  actionAt(x, y, fx, fy) {
    if (this.startEventsAt(x, y, [0], false)) return true;
    if (this.startEventsAt(fx, fy, [0, 1, 2], true)) return true;
    if (this.grid.isCounter(fx, fy)) {
      const dx = fx - x, dy = fy - y;
      return this.startEventsAt(fx + dx, fy + dy, [0, 1, 2], true);
    }
    return false;
  }
  // bumped into a same-priority event
  touchAt(x, y) { return this.startEventsAt(x, y, [1, 2], true); }

  // ---- transfer ----
  reserveTransfer(mapId, x, y, dir, fade) {
    this.transfer = { mapId, x, y, dir, fade };
    this.transferring = true;
  }

  worldPos(tx, ty) { return { x: (tx + 0.5) * T, z: (ty + 0.5) * T }; }
}
