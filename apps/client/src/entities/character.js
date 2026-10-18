// Grid-based characters (Game_CharacterBase / Game_Character / Game_Event port).
// Events keep RPG Maker's tile logic so puzzles and cutscenes behave like the original;
// only the player moves freely (see player.js).
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { runRuby } from '../game/rubyexpr.js';

export const reverseDir = d => 10 - d;
const DX = { 1: -1, 2: 0, 3: 1, 4: -1, 6: 1, 7: -1, 8: 0, 9: 1 };
const DY = { 1: 1, 2: 1, 3: 1, 4: 0, 6: 0, 7: -1, 8: -1, 9: -1 };
export const dirX = d => DX[d] || 0;
export const dirY = d => DY[d] || 0;

export class GameCharacter {
  constructor() {
    this.id = 0;
    this.x = 0; this.y = 0; this.realX = 0; this.realY = 0;
    this.tileId = 0; this.characterName = ''; this.characterIndex = 0;
    this.moveSpeed = 4; this.moveFrequency = 6;
    this.walkAnime = true; this.stepAnime = false; this.directionFix = false;
    this.opacity = 255; this.blendType = 0; this.direction = 2; this.pattern = 1;
    this.priorityType = 1; this.through = false; this.bushDepth = 0;
    this.animationId = 0; this.balloonId = 0; this.transparent = false;
    this.originalDirection = 2; this.originalPattern = 1;
    this.animeCount = 0; this.stopCount = 0; this.jumpCount = 0; this.jumpPeak = 0;
    this.locked = false; this.prelockDirection = 0; this.moveSucceed = true;
    this.moveRoute = null; this.moveRouteIndex = 0; this.moveRouteForcing = false;
    this.originalMoveRoute = null; this.originalMoveRouteIndex = 0; this.waitCount = 0;
    this.symbolId = null;        // enable_symbol_encount(id) from the move route
    this.pendingAnimation = null;
  }
  pos(x, y) { return this.x === x && this.y === y; }
  posNt(x, y) { return this.pos(x, y) && !this.through; }
  normalPriority() { return this.priorityType === 1; }
  moving() { return this.realX !== this.x || this.realY !== this.y; }
  jumping() { return this.jumpCount > 0; }
  jumpHeight() { return (this.jumpPeak * this.jumpPeak - (this.jumpCount - this.jumpPeak) ** 2) / 2; }
  stopping() { return !this.moving() && !this.jumping(); }
  realMoveSpeed() { return this.moveSpeed; }
  distancePerFrame() { return 2 ** this.realMoveSpeed() / 256; }
  straighten() { if (this.walkAnime || this.stepAnime) this.pattern = 1; this.animeCount = 0; }

  passable(x, y, d) {
    const m = G.map;
    const x2 = m.wrapX(x + dirX(d)), y2 = m.wrapY(y + dirY(d));
    if (!m.grid.valid(x2, y2)) return false;
    if (this.through) return true;
    if (!m.passableFor(this, x, y, d)) return false;
    if (!m.passableFor(this, x2, y2, reverseDir(d))) return false;
    if (this.collideWithCharacters(x2, y2)) return false;
    return true;
  }
  diagonalPassable(x, y, horz, vert) {
    const x2 = G.map.wrapX(x + dirX(horz)), y2 = G.map.wrapY(y + dirY(vert));
    return (this.passable(x, y, vert) && this.passable(x, y2, horz)) &&
      (this.passable(x, y, horz) && this.passable(x2, y, vert));
  }
  collideWithCharacters(x, y) {
    return G.map.eventsXyNt(x, y).some(ev => ev !== this && (ev.normalPriority() || this.isEvent));
  }
  moveto(x, y) {
    this.x = x; this.y = y; this.realX = x; this.realY = y;
    this.prelockDirection = 0;
    this.straighten();
  }
  setDirection(d) {
    if (!this.directionFix && d) this.direction = d;
    this.stopCount = 0;
  }
  setGraphic(name, index) {
    this.tileId = 0; this.characterName = name; this.characterIndex = index;
    this.originalPattern = 1;
    // (given by an event's Set Move Route - a scene: it acts in it, as a person - sprites.js layMode)
    if (this.moveRouteForcing) this.acting = true;
  }

  update() {
    this.updateAnimation();
    if (this.jumping()) return this.updateJump();
    if (this.moving()) return this.updateMove();
    return this.updateStop();
  }
  updateJump() {
    this.jumpCount--;
    this.realX = (this.realX * this.jumpCount + this.x) / (this.jumpCount + 1);
    this.realY = (this.realY * this.jumpCount + this.y) / (this.jumpCount + 1);
    if (this.jumpCount === 0) { this.realX = this.x; this.realY = this.y; }
  }
  updateMove() {
    const d = this.distancePerFrame();
    if (this.x < this.realX) this.realX = Math.max(this.realX - d, this.x);
    if (this.x > this.realX) this.realX = Math.min(this.realX + d, this.x);
    if (this.y < this.realY) this.realY = Math.max(this.realY - d, this.y);
    if (this.y > this.realY) this.realY = Math.min(this.realY + d, this.y);
  }
  updateStop() {
    if (!this.locked) this.stopCount++;
    if (this.moveRouteForcing) this.updateRoutineMove();
  }
  updateAnimation() {
    if (this.moving() && this.walkAnime) this.animeCount += 1.5;
    else if (this.stepAnime || this.pattern !== this.originalPattern) this.animeCount += 1;
    if (this.animeCount > 18 - this.realMoveSpeed() * 2) {
      if (!this.stepAnime && this.stopCount > 0) this.pattern = this.originalPattern;
      else this.pattern = (this.pattern + 1) % 4;
      this.animeCount = 0;
    }
  }

  moveStraight(d, turnOk = true) {
    this.moveSucceed = this.passable(this.x, this.y, d);
    if (this.moveSucceed) {
      this.setDirection(d);
      // (a looping map: across an edge the cell wraps, and the step is drawn from just outside it)
      this.x = G.map.wrapX(this.x + dirX(d)); this.y = G.map.wrapY(this.y + dirY(d));
      this.realX = this.x - dirX(d); this.realY = this.y - dirY(d);
      this.increaseSteps?.();
    } else if (turnOk) {
      this.setDirection(d);
      this.checkEventTriggerTouchFront?.();
    }
  }
  moveDiagonal(horz, vert) {
    this.moveSucceed = this.diagonalPassable(this.x, this.y, horz, vert);
    if (this.moveSucceed) {
      this.x = G.map.wrapX(this.x + dirX(horz)); this.y = G.map.wrapY(this.y + dirY(vert));
      this.realX = this.x - dirX(horz); this.realY = this.y - dirY(vert);
      this.increaseSteps?.();
    }
    if (this.direction === reverseDir(horz)) this.setDirection(horz);
    if (this.direction === reverseDir(vert)) this.setDirection(vert);
  }
  jump(xp, yp) {
    if (Math.abs(xp) > Math.abs(yp)) { if (xp) this.setDirection(xp < 0 ? 4 : 6); }
    else if (yp) this.setDirection(yp < 0 ? 8 : 2);
    this.x += xp; this.y += yp;
    const dist = Math.round(Math.sqrt(xp * xp + yp * yp));
    this.jumpPeak = 10 + dist - this.moveSpeed;
    this.jumpCount = this.jumpPeak * 2;
    this.stopCount = 0;
    this.straighten();
  }

  // ---- move routes ----
  memorizeMoveRoute() { this.originalMoveRoute = this.moveRoute; this.originalMoveRouteIndex = this.moveRouteIndex; }
  restoreMoveRoute() {
    this.moveRoute = this.originalMoveRoute; this.moveRouteIndex = this.originalMoveRouteIndex;
    this.originalMoveRoute = null;
  }
  forceMoveRoute(route) {
    if (!this.originalMoveRoute) this.memorizeMoveRoute();
    this.moveRoute = route; this.moveRouteIndex = 0; this.moveRouteForcing = true;
    this.prelockDirection = 0; this.waitCount = 0; this.routeStuck = 0;
  }
  updateRoutineMove() {
    if (this.waitCount > 0) { this.waitCount--; return; }
    this.moveSucceed = true;
    const cmd = this.moveRoute?.list[this.moveRouteIndex];
    if (cmd) {
      this.processMoveCommand(cmd);
      // a scripted move blocked for 3 s is skipped: in first person the player (or a fight) can stand
      // where the original never let anything be, and a waiting event would hold the game forever
      if (!this.moveSucceed && this.moveRouteForcing && !this.moveRoute.skippable) {
        if (++this.routeStuck > 180) { this.routeStuck = 0; this.moveSucceed = true; }
      } else this.routeStuck = 0;
      if (this.moveSucceed || this.moveRoute.skippable) this.moveRouteIndex++;
    }
  }
  processMoveCommand(cmd) {
    const p = cmd.parameters;
    switch (cmd.code) {
      case 0:
        if (this.moveRoute.repeat) this.moveRouteIndex = -1;
        else if (this.moveRouteForcing) { this.moveRouteForcing = false; this.restoreMoveRoute(); }
        break;
      case 1: this.moveStraight(2); break;
      case 2: this.moveStraight(4); break;
      case 3: this.moveStraight(6); break;
      case 4: this.moveStraight(8); break;
      case 5: this.moveDiagonal(4, 2); break;
      case 6: this.moveDiagonal(6, 2); break;
      case 7: this.moveDiagonal(4, 8); break;
      case 8: this.moveDiagonal(6, 8); break;
      case 9: this.moveRandom(); break;
      case 10: this.moveTowardCharacter(G.map.playerChar); break;
      case 11: this.moveAwayFromCharacter(G.map.playerChar); break;
      case 12: this.moveStraight(this.direction); break;
      case 13: { const f = this.directionFix; this.directionFix = true; this.moveStraight(reverseDir(this.direction), false); this.directionFix = f; break; }
      case 14: this.jump(p[0], p[1]); break;
      case 15: this.waitCount = p[0] - 1; break;
      case 16: this.setDirection(2); break;
      case 17: this.setDirection(4); break;
      case 18: this.setDirection(6); break;
      case 19: this.setDirection(8); break;
      case 20: this.setDirection({ 2: 4, 4: 8, 6: 2, 8: 6 }[this.direction]); break;
      case 21: this.setDirection({ 2: 6, 4: 2, 6: 8, 8: 4 }[this.direction]); break;
      case 22: this.setDirection(reverseDir(this.direction)); break;
      case 23: this.setDirection(Math.random() < 0.5 ? { 2: 4, 4: 8, 6: 2, 8: 6 }[this.direction] : { 2: 6, 4: 2, 6: 8, 8: 4 }[this.direction]); break;
      case 24: this.setDirection(2 + Math.floor(Math.random() * 4) * 2); break;
      case 25: this.turnTowardCharacter(G.map.playerChar); break;
      case 26: this.turnAwayFromCharacter(G.map.playerChar); break;
      case 27: G.state.setSw(p[0], true); break;
      case 28: G.state.setSw(p[0], false); break;
      case 29: this.moveSpeed = p[0]; break;
      case 30: this.moveFrequency = p[0]; break;
      case 31: this.walkAnime = true; break;
      case 32: this.walkAnime = false; break;
      case 33: this.stepAnime = true; break;
      case 34: this.stepAnime = false; break;
      case 35: this.directionFix = true; break;
      case 36: this.directionFix = false; break;
      case 37: this.through = true; break;
      case 38: this.through = false; break;
      case 39: this.transparent = true; break;
      case 40: this.transparent = false; break;
      case 41: this.setGraphic(p[0], p[1]); break;
      case 42: this.opacity = p[0]; break;
      case 43: this.blendType = p[0]; break;
      case 44: G.audio?.playSe(p[0], this); break;
      case 45: this.runRouteScript(p[0]); break;
      default: break;
    }
  }
  runRouteScript(src) {
    const m = /enable_symbol_encount\((\d+)\)/.exec(src);
    if (m) { this.symbolId = +m[1]; return; }
    runRuby(src, { self: this });
  }
  // (the shorter way round on a looping map, as RPG Maker's distance_x_from)
  distX(x) { const m = G.map, w = m.width; let r = this.x - x; if (m.loopX && Math.abs(r) > w / 2) r += r < 0 ? w : -w; return r; }
  distY(y) { const m = G.map, h = m.height; let r = this.y - y; if (m.loopY && Math.abs(r) > h / 2) r += r < 0 ? h : -h; return r; }
  moveRandom() { this.moveStraight(2 + Math.floor(Math.random() * 4) * 2, false); }
  moveTowardCharacter(c) {
    if (!c) return;
    const sx = this.distX(c.x), sy = this.distY(c.y);
    if (Math.abs(sx) > Math.abs(sy)) {
      this.moveStraight(sx > 0 ? 4 : 6);
      if (!this.moveSucceed && sy !== 0) this.moveStraight(sy > 0 ? 8 : 2);
    } else if (sy !== 0) {
      this.moveStraight(sy > 0 ? 8 : 2);
      if (!this.moveSucceed && sx !== 0) this.moveStraight(sx > 0 ? 4 : 6);
    }
  }
  moveAwayFromCharacter(c) {
    if (!c) return;
    const sx = this.distX(c.x), sy = this.distY(c.y);
    if (Math.abs(sx) > Math.abs(sy)) {
      this.moveStraight(sx > 0 ? 6 : 4);
      if (!this.moveSucceed && sy !== 0) this.moveStraight(sy > 0 ? 2 : 8);
    } else if (sy !== 0) {
      this.moveStraight(sy > 0 ? 2 : 8);
      if (!this.moveSucceed && sx !== 0) this.moveStraight(sx > 0 ? 6 : 4);
    }
  }
  turnTowardCharacter(c) {
    if (!c) return;
    const sx = this.distX(c.x), sy = this.distY(c.y);
    if (Math.abs(sx) > Math.abs(sy)) this.setDirection(sx > 0 ? 4 : 6);
    else if (sy !== 0) this.setDirection(sy > 0 ? 8 : 2);
  }
  turnAwayFromCharacter(c) {
    if (!c) return;
    const sx = this.distX(c.x), sy = this.distY(c.y);
    if (Math.abs(sx) > Math.abs(sy)) this.setDirection(sx > 0 ? 6 : 4);
    else if (sy !== 0) this.setDirection(sy > 0 ? 2 : 8);
  }
}

// ---------------------------------------------------------------------------
// Game_Event
// ---------------------------------------------------------------------------
export class GameEvent extends GameCharacter {
  constructor(mapId, event) {
    super();
    this.isEvent = true;
    this.mapId = mapId;
    this.event = event;
    this.id = event.id;
    this.name = event.name || '';
    this.trigger = 0;
    this.list = null;
    this.starting = false;
    this.moveType = 0;
    this.erased = false;
    this.page = null;
    this.interpreter = null;
    this.moveto(event.x, event.y);
    this.refresh();
  }
  collideWithCharacters(x, y) {
    if (super.collideWithCharacters(x, y)) return true;
    return this.normalPriority() && G.map.playerChar.pos(x, y);
  }
  lock() {
    if (this.locked) return;
    this.prelockDirection = this.direction;
    this.turnTowardCharacter(G.map.playerChar);
    this.locked = true;
  }
  unlock() {
    if (!this.locked) return;
    this.locked = false;
    this.setDirection(this.prelockDirection);
  }
  updateStop() {
    super.updateStop();
    if (!this.moveRouteForcing) this.updateSelfMovement();
  }
  updateSelfMovement() {
    // symbol enemies are driven by the action-combat AI instead; an event whose fight is on stays put
    if (this.symbolId != null && G.combat?.controlsEvent(this)) return;
    if (G.combat?.eventInBattle?.(this)) return;
    if (this.stopCount <= 30 * (5 - this.moveFrequency)) return;
    switch (this.moveType) {
      case 1: {
        const r = Math.floor(Math.random() * 6);
        if (r <= 1) this.moveRandom(); else if (r <= 4) this.moveStraight(this.direction, false); else this.stopCount = 0;
        break;
      }
      case 2: {
        const p = G.map.playerChar;
        if (Math.abs(this.distX(p.x)) + Math.abs(this.distY(p.y)) < 20) {
          const r = Math.floor(Math.random() * 6);
          if (r <= 3) this.moveTowardCharacter(p); else if (r === 4) this.moveRandom(); else this.moveStraight(this.direction);
        } else this.moveRandom();
        break;
      }
      case 3: this.updateRoutineMove(); break;
      default: break;
    }
  }
  empty() { return !this.list || this.list.length <= 1; }
  triggerIn(triggers) { return triggers.includes(this.trigger); }
  // true when it really starts (an empty page does not, as in RPG Maker: the action button then goes on to the
  // cell in front - the rabbit hole's Cheshire talks through an invisible event there)
  start() {
    if (this.empty()) return false;
    if (G.combat?.eventInBattle?.(this)) return false;       // its fight is still going
    // no other event fight starts while one is on (a corridor of twin boss triggers would restart the scene) - the
    // roaming monsters' own fights do not count: a boss's trigger works with monsters still after the player
    if (G.combat?.eventFightOn?.() && this.list.some(c => c.code === 301) && !G.combat.controlsEvent?.(this)) return false;
    if (G.combat?.engage(this)) return true;
    // (the developer's world: an event that changes the world is run by one player at a time; a boss fight, by the one
    // running the map - coop.js mayStart)
    if (G.coop?.role === 'world' && !G.coop.mayStart(this)) return false;
    this.starting = true;
    if (this.triggerIn([0, 1, 2])) this.lock();
    return true;
  }
  erase() { this.erased = true; this.refresh(); }
  refresh() {
    const page = this.erased ? null : this.findProperPage();
    if (!page || page !== this.page) this.setupPage(page);
  }
  findProperPage() {
    const pages = this.event.pages;
    for (let i = pages.length - 1; i >= 0; i--) if (this.conditionsMet(pages[i])) return pages[i];
    return null;
  }
  conditionsMet(page) {
    const c = page.condition;
    const st = G.state;
    // ソウル回収 script: the soul-retrieval event shows only while active
    if (this.isSoulEvent()) return page === this.event.pages[0] && !!this.soulActive && st.sw(69);
    if (c.switch1_valid && !st.sw(c.switch1_id)) return false;
    if (c.switch2_valid && !st.sw(c.switch2_id)) return false;
    if (c.variable_valid && st.v(c.variable_id) < c.variable_value) return false;
    if (c.self_switch_valid && !st.selfSw(this.mapId, this.id, c.self_switch_ch)) return false;
    if (c.item_valid && !st.party.hasItem('item', c.item_id)) return false;
    if (c.actor_valid && !st.party.actors.includes(c.actor_id)) return false;
    return true;
  }
  isSoulEvent() {
    if (this._soul === undefined) {
      const cmd = this.event.pages[0]?.list?.[0];
      this._soul = !!cmd && cmd.code === 117 && cmd.parameters[0] === 32 && this.id === 1;
    }
    return this._soul;
  }
  setupPage(page) {
    this.page = page;
    this.acting = false;
    if (page) {
      const g = page.graphic;
      this.tileId = g.tile_id; this.characterName = g.character_name; this.characterIndex = g.character_index;
      if (this.originalDirection !== g.direction) {
        this.direction = g.direction; this.originalDirection = g.direction; this.prelockDirection = 0;
      }
      if (this.originalPattern !== g.pattern) { this.pattern = g.pattern; this.originalPattern = g.pattern; }
      this.moveType = page.move_type; this.moveSpeed = page.move_speed; this.moveFrequency = page.move_frequency;
      this.moveRoute = page.move_route; this.moveRouteIndex = 0; this.moveRouteForcing = false;
      this.walkAnime = page.walk_anime; this.stepAnime = page.step_anime; this.directionFix = page.direction_fix;
      this.through = page.through; this.priorityType = page.priority_type; this.trigger = page.trigger;
      this.list = page.list;
      this.symbolId = null;
      for (const mc of page.move_route?.list || []) {
        const m = mc.code === 45 && /enable_symbol_encount\((\d+)\)/.exec(mc.parameters[0]);
        if (m) this.symbolId = +m[1];
      }
      this.interpreter = this.trigger === 4 ? G.map.newInterpreter() : null;
    } else {
      this.tileId = 0; this.characterName = ''; this.characterIndex = 0; this.moveType = 0;
      this.through = true; this.trigger = null; this.list = null; this.interpreter = null; this.symbolId = null;
    }
    this.starting = false;
    if (this.trigger === 3) this.start();
    G.map?.onEventPageChanged?.(this);
  }
  checkEventTriggerTouch(x, y) {
    if (G.map.interpreter.running()) return;
    if (this.trigger === 2 && G.map.playerChar.pos(x, y) && !this.jumping() && this.normalPriority()) this.start();
  }
  checkEventTriggerTouchFront() {
    this.checkEventTriggerTouch(this.x + dirX(this.direction), this.y + dirY(this.direction));
  }
  update() {
    // (a co-op phantom's copy of another player's world: its events stand and move where the host's do - coop.js; on a
    // map the host is not on that it leads, they move as in its own game - none starts by itself, but a beaten or
    // escaped monster comes back as in its own game: what that switches is the host's world's too, coop.js recording)
    if (G.coop?.phantom) {
      if (!G.coop.leadsNow) { this.followNet(); return; }
      if (G.combat?.holdsPage?.(this)) return;
      super.update();
      if (this.interpreter && G.combat?.comebackPage?.(this)) {
        if (!this.interpreter.running()) this.interpreter.setup(this.list, this.id);
        G.coop.recording++;
        try { this.interpreter.update(); } finally { G.coop.recording--; }
      }
      return;
    }
    if (G.combat?.holdsPage?.(this)) return;          // a beaten enemy waiting to come back (hidden, frozen)
    super.update();
    if (this.trigger === 3 && !this.starting && !this.empty() && !G.map.interpreter.running()) this.start();
    if (!this.interpreter) return;
    if (!this.interpreter.running()) this.interpreter.setup(this.list, this.id);
    this.interpreter.update();
  }
  // where the host's copy of this event is (coop.js onEvents): eased there a logic frame at a time (put there at
  // once from far away), facing, stepping and drawn as it is - never moving of its own
  followNet() {
    const n = this.net;
    if (!n) return;
    const dx = n.x - this.realX, dy = n.y - this.realY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { this.realX = n.x; this.realY = n.y; }
    else { this.realX += dx * 0.35; this.realY += dy * 0.35; }
    this.x = G.map.wrapX(Math.round(n.x)); this.y = G.map.wrapY(Math.round(n.y));
    this.direction = n.dir; this.pattern = n.pattern; this.opacity = n.opacity;
    this.characterName = n.name; this.characterIndex = n.index; this.tileId = n.tileId;
    if (n.balloon && n.balloon !== this.netBalloon) { this.balloonId = n.balloon; this.balloonTime = 64; }
    this.netBalloon = n.balloon;
  }
  // first battle troop referenced by the active page (for symbol enemies)
  battleTroopId() {
    for (const c of this.list || []) if (c.code === 301) return c.parameters[0] === 0 ? c.parameters[1] : G.state.v(c.parameters[1]);
    return 0;
  }
  note() { return this.name; }
}

export function commonEventList(id) {
  return $data.commonEvents[id]?.list || null;
}
