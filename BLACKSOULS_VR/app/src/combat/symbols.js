// The fights' roaming monsters (symbol encounters): their events taken up as fights, engaging and leaving, coming back,
// and the dormant ones standing on the map until a fight wakes them.
import * as THREE from 'three';
import { BALLOON_TIME } from '../balloons.js';
import { commonEventList } from '../character.js';
import { lineOfSight, resolveCircle } from '../collision.js';
import { personalPage } from '../coopworld.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { Interpreter } from '../interpreter.js';
import { openFights } from '../maphints.js';
import { T } from '../mapmesh.js';
import { ActionEnemy, symbolPage } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class SymbolPart {
  // ---- symbol enemies -----------------------------------------------------------
  isSymbolPage(ev) {
    return ev.symbolId != null && ev.page && ev.list && ev.list.some(c => c.code === 301) && [1, 2].includes(ev.trigger);
  }
  // (the developer's world) a roaming monster only this player's own state brings out - low SEN's (SEN 0: the
  // hallucinations of 안개 공원, the patients, the chess pieces, 리펀 대성당's snake spirits ...), the snake god's
  // curse's - one no page of its event shows without it (not one that is there anyway and only looks otherwise at SEN 0:
  // 피눈물 웅덩이's, the map runner's as ever). This player's own to see and fight wherever it is, whoever runs the map,
  // and nobody else's: the others see it fight thin air (coopworld personalPage)
  privateSymbol(ev) {
    if (!G.coop?.world || !this.isSymbolPage(ev) || !personalPage(ev.page)) return false;
    return !(ev.event?.pages || []).some(p => p !== ev.page && !personalPage(p) && symbolPage(p));
  }
  // a hallucination by its event and page ('id:page'): the same seen by another is the same one (coop.js - seen together)
  hallKey(ev) { return `${ev.id}:${(ev.event?.pages || []).indexOf(ev.page)}`; }
  hallKeysSeen() { return (G.map?.eventList || []).filter(ev => this.privateSymbol(ev)).slice(0, 64).map(ev => this.hallKey(ev)); }
  seesHallucination(key) { return (G.map?.eventList || []).some(ev => this.privateSymbol(ev) && this.hallKey(ev) === key); }
  // the hallucinations this player runs, by key: the body roaming, or the enemies of its fight - and how long it has run it
  hallGroups() {
    const out = new Map();
    for (const s of this.symbols.values()) {
      if (!s.private || !s.hallKey) continue;
      const age = G.time - (s.claimT ?? G.time);
      const b = s.engaged ? this.battles.find(x => x.private && x.hallKey === s.hallKey && !x.done) : null;
      if (b) out.set(s.hallKey, { age, sym: null, enemies: b.enemies.filter(e => e.mesh && e.state !== 'dead') });
      else if (s.enemy?.mesh && s.enemy.state !== 'dead') out.set(s.hallKey, { age, sym: s, enemies: [s.enemy] });
    }
    return out;
  }
  hallAge(key) { const s = [...this.symbols.values()].find(x => x.private && x.hallKey === key); return s ? G.time - (s.claimT ?? G.time) : null; }
  // (another player runs it for this one too - coop.js followHall) its own put away: the body, its fight with it
  yieldHallucination(key) {
    for (const [ev, s] of [...this.symbols]) {
      if (!s.private || s.hallKey !== key) continue;
      s.interp?.terminate?.();
      ev.unlock?.();
      s.enemy?.marker?.dispose(); s.enemy?.remove();
      this.symbols.delete(ev);
    }
    for (const b of this.battles) {
      if (!b.private || b.hallKey !== key || b.done) continue;
      for (const e of b.enemies) { e.marker?.dispose(); this.hideBlade(e); e.remove(); }
      this.enemies = this.enemies.filter(e => !b.enemies.includes(e));
      this.projectiles = this.projectiles.filter(p => { if (!b.enemies.includes(p.enemy)) return true; this.root.remove(p.mesh); return false; });
      b.done = true; b.result = 1;
      if (b.interpreter?.battle === b) b.interpreter.battle = null;      // (its event's run is over with it)
    }
    this.battles = this.battles.filter(b => !b.done || b.interpreter?.battle === b);
    this.detached = this.detached.filter(d => { if (!(d.battle?.private && d.battle.hallKey === key)) return true; d.interp.terminate(); d.ev?.unlock?.(); return false; });
    if (!this.battles.some(b => !b.done) && this.music) { G.audio?.restore(this.music.saved); this.music = null; }
  }
  // (following it ended) its own again - a fresh one, where it begins
  resumeHallucination(key) {
    const ev = (G.map?.eventList || []).find(e => this.privateSymbol(e) && this.hallKey(e) === key);
    if (ev) this.onEventPageChanged(ev);
  }
  // (fought with the one running it, and beaten there) beaten here too, as if this player had: its own fight with it
  // begins and is won at once - what it gives, its event's win as ever
  winHallucination(key) {
    const ev = (G.map?.eventList || []).find(e => this.privateSymbol(e) && this.hallKey(e) === key);
    if (!ev) return;
    this.onEventPageChanged(ev);
    const s = this.symbols.get(ev);
    if (!s || s.engaged) return;
    s.autoWin = true;
    this.engage(ev, true);
  }
  // the copies of hallucinations another runs (all, that one's, or that one's of one key)
  dropHallPuppets(src = null, key = null) {
    for (const [k, e] of [...this.puppets]) {
      if (!e.src || (src && e.src !== src) || (key && e.hallKey !== key)) continue;
      e.remove(); this.puppets.delete(k);
    }
  }
  controlsEvent(ev) { return this.symbols.has(ev) && this.isSymbolPage(ev); }
  // an area's ordinary monster, roaming or not: it comes back once beaten (a page of its event turns its self switch
  // back off - the 원작 comeback of field enemies) - never a boss, whatever music it fights to (윈터벨's orcs, snow
  // tigers, invisible horses, winter knights... to 裏ボス; 리델 묘지's grave robbers to their own)
  comesBack(ev) {
    const pages = ev?.event?.pages;
    return !!pages && (ev._comesBack ??= pages.some(p => p.list?.some(c => c.code === 123 && c.parameters[1] === 1)));
  }
  // a roaming boss, not one of an area's ordinary monsters: it never comes back once beaten (comesBack) and at most
  // two events on the map fight its troop (윈터벨's slimes: thirty)
  oneOffSymbol(sym, troopId) {
    if (this.comesBack(sym.ev)) return false;
    const fights = ev => (ev.event?.pages || []).some(p => p.list?.some(c => c.code === 301 && c.parameters[0] === 0 && c.parameters[1] === troopId));
    return G.map.eventList.filter(fights).length <= 2;
  }
  // a boss fight on a map that stays open (maphints openFights - 소녀의 악몽): the arena would have hidden the map's
  // other events; here only this fight's own step out of sight - the events whose troops share its enemies (the
  // second of 트위들 쌍둥이's two, the tea party's three, each starting the one fight) - and the map's other bosses
  // do not take one up while it lasts (one at a time, as in the original) unless struck
  // (the troops of the boss fights on - or about to start: a symbol that has taken one up runs its event first)
  openFightTroops(except) {
    const out = [];
    if (!openFights(G.map?.mapId)) return out;
    for (const s of this.symbols.values()) if (s.engaged && s.ev !== except && (s.oneOff ??= this.oneOffSymbol(s, s.troopId))) out.push(s.troopId);
    for (const b of this.battles) if (!b.done && b.openBoss && b.event !== except) out.push(b.troop?.id);
    return out;
  }
  sharesOpenFight(ev) {
    const s = this.symbols.get(ev);
    if (!s || s.engaged) return false;
    const fights = this.openFightTroops(ev);
    if (!fights.length) return false;
    const mine = new Set(($data.troops[s.troopId]?.members || []).map(m => m.enemy_id));
    return fights.some(id => ($data.troops[id]?.members || []).some(m => mine.has(m.enemy_id)));
  }
  waitsForOpenFight(ev) {
    const s = this.symbols.get(ev);
    if (!s || s.engaged || !this.openFightTroops(ev).length) return false;
    return (s.oneOff ??= this.oneOffSymbol(s, s.troopId));
  }
  // the event that started a fight is replaced by the 3D enemies while it lasts; a beaten enemy's event
  // stays out of sight while its comeback is held
  hidesEvent(ev) { return this.controlsEvent(ev) || this.eventInBattle(ev) || this.holdsPage(ev) || !!G.arena?.hides(ev) || this.sharesOpenFight(ev) || this.phantomHides(ev); }
  // a co-op phantom does not meet the host world's roaming monsters of its own where another runs the map (they are that
  // one's there - its puppets); on a map it leads it meets them as in its own game (ownMapMonsters) - in the developer's
  // world the same: the one running the map runs its monsters
  phantomHides(ev) {
    if (!G.coop?.shared || !this.isSymbolPage(ev)) return false;
    if (this.privateSymbol(ev)) return !!G.coop.hallFollowing?.(this.hallKey(ev));     // (seen with another, who runs it)
    return !G.coop.leadsNow;
  }
  // (a guest leading a map) one of its roaming bosses: its fight begins only by way of the host - asked to come to it, or
  // letting the guests fight it (coop.js askBossStart, leadStart: bossGo)
  leadBoss(s) { return !!G.coop?.phantom && G.coop.leadsNow && G.coop.bossGo !== s.ev && this.symbolIsBoss(s); }
  // such a boss struck before its fight began: the host is asked (engage) - nothing lands meanwhile
  heldBoss(e) {
    if (e.battle || !G.coop?.leadsNow) return false;
    const sym = [...this.symbols.values()].find(s => s.enemy === e);
    if (!sym || !this.leadBoss(sym)) return false;
    this.engage(sym.ev, true);
    return true;
  }
  eventInBattle(ev) { return this.battles.some(b => !b.done && b.event === ev) || this.detached.some(d => d.ev === ev); }
  // 원작: beaten field enemies come back 10 s later (their self switch D page waits 600 frames, then
  // switches back). That suits battles that freeze the map; fought in real time they seem to never go
  // away, so by default the comeback waits until the player has left the map (setting 쓰러뜨린 적 부활)
  holdsPage(ev) {
    const mode = G.settings.respawn || 'map';
    if (mode === 'original' || !this.defeated.has(ev)) return false;
    const page = ev.page;
    if (!page || ev.trigger !== 4) return false;
    if (page._respawn === undefined) page._respawn = (page.list || []).some(c => c.code === 123 && c.parameters[1] === 1);
    if (!page._respawn) return false;
    if (mode === 'map') return true;
    const pc = G.map.playerChar;
    return G.time - this.defeated.get(ev) < 60 || Math.hypot(G.map.nearX(ev.x, pc.fx) - pc.fx, G.map.nearY(ev.y, pc.fy) - pc.fy) < 8;
  }
  // a fight started by touching / talking to an event: the event's commands wait for the result on
  // their own, so the menu, exits and other events stay usable meanwhile
  // what the events of the fights still on changed before them ([key, value before]: 'S:id', 'V:id', 'SS:selfKey') - a
  // save made now keeps those as they were, so the scene plays again once loaded (main.js saveVr)
  pendingUndo() {
    const out = [];
    for (const d of this.detached) if (d.battle && !d.battle.done && d.interp.undo) out.push(...d.interp.undo);
    return out;
  }
  undoFightEvent(interp) {
    for (const [key, old] of interp?.undo || []) {
      const at = key.indexOf(':'), kind = key.slice(0, at), id = key.slice(at + 1);
      if (kind === 'S') G.state.setSw(+id, old);
      else if (kind === 'V') G.state.setV(+id, old);
      else if (kind === 'SS') { const [m, e, ch] = id.split(','); G.state.setSelfSw(+m, +e, ch, old); }
    }
    if (interp) interp.undo = null;
  }
  detachInterpreter(interp, battle) {
    const ev = interp.event();
    interp.main = false;             // its death common event (全滅処理) is handed back to the map
    this.detached.push({ interp, battle, ev });
    G.map.interpreter = new Interpreter(0, true);
  }
  onEventPageChanged(ev) {
    const s = this.symbols.get(ev), mine = this.privateSymbol(ev);
    if (G.coop?.shared && !G.coop.leadsNow && !mine && !s?.private) return;      // (phantomHides: but its own hallucinations)
    if (this.isSymbolPage(ev)) {
      const key = mine ? this.hallKey(ev) : null, followed = !!key && !!G.coop?.hallFollowing?.(key);
      // (one that turned from a hallucination into a monster of the map's, or back, or into another: made anew as what it
      // is now - and not at all while another player runs it for this one too)
      if (s && !s.engaged && (!!s.private !== mine || (s.hallKey || null) !== key || followed)) {
        s.enemy?.remove(); this.symbols.delete(ev);
        if (!followed) this.onEventPageChanged(ev);
        return;
      }
      if (!s && followed) return;
      if (!s) {
        const troopId = ev.battleTroopId();
        const member = $data.troops[troopId]?.members?.find(m => !m.hidden) || $data.troops[troopId]?.members?.[0];
        const sym = { ev, fx: ev.x, fy: ev.y, homeX: ev.x, homeY: ev.y, engaged: false, interp: null, troopId, wander: null, private: mine, hallKey: key, claimT: G.time };
        if (member) {
          sym.enemy = new ActionEnemy(this, null, member.enemy_id, ev.x, ev.y, { dormant: true });
          sym.enemy.balloonOf = ev;              // (it shows the event's balloon icons)
          if (mine) this.makePrivate(sym.enemy, key);
        }
        this.symbols.set(ev, sym);
      }
    } else if (s && !s.engaged) {
      s.enemy?.remove();
      this.symbols.delete(ev);
    }
  }
  // (co-op guest - coop.js mapNow) the one who runs the map it stands on changed: the puppets the one before sent go (and
  // their shots - the one now sends its own); leading it now, its roaming monsters are this game's to run (own: its
  // symbols come - onEventPageChanged; its bosses too, begun by way of the host: leadBoss); else its own go - their
  // fights end
  ownMapMonsters(own) {
    for (const e of this.puppets.values()) e.remove();
    this.puppets.clear();
    this.projectiles = this.projectiles.filter(p => { if (!p.ghost) return true; this.root.remove(p.mesh); return false; });
    if (own) {
      for (const ev of G.map.eventList) this.onEventPageChanged(ev);
      return;
    }
    if (!this.symbols.size && !this.enemies.length && !this.battles.length) return;
    // (its own hallucinations stay - privateSymbol: their fights go on whoever runs the map)
    for (const [ev, s] of [...this.symbols]) {
      if (s.private) continue;
      if (s.engaged) s.ev.unlock?.();
      s.enemy?.marker?.dispose(); s.enemy?.remove();
      this.symbols.delete(ev);
    }
    for (const e of this.enemies) { if (e.private) continue; e.marker?.dispose(); this.hideBlade(e); e.remove(); }
    this.enemies = this.enemies.filter(e => e.private);
    for (const b of this.battles) if (!b.private) { b.done = true; b.result = 1; }
    this.battles = this.battles.filter(b => b.private);
    for (const d of this.detached) {
      if (d.battle?.private) continue;
      d.interp.terminate(); d.ev?.unlock?.(); if (d.ev) G.coop?.eventDone?.(d.interp.mapId, d.ev.id);
    }
    this.detached = this.detached.filter(d => d.battle?.private);
    // (an enemy's shot - or one turned back at it, reflectOntoEnemy - goes with the fight)
    this.projectiles = this.projectiles.filter(p => { if ((p.owner !== 'enemy' && p.owner !== 'mirror') || p.ghost || p.enemy?.private) return true; this.root.remove(p.mesh); return false; });
    if (this.battles.some(b => !b.done)) return;
    if (this.fightStates) { const a = G.state?.party?.leader(); for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s); this.fightStates = null; }
    if (this.music) { G.audio?.restore(this.music.saved); this.music = null; }
  }
  // (a hallucination - privateSymbol - and the enemies of its fight) never among the map's monsters sent to everyone: only to
  // those who see it too (coop.js audience, sendHallucinations)
  makePrivate(e, key) { e.private = true; e.hallKey = key; }
  symbolSetting(ev) {
    return G.scripts.symbols?.[ev.symbolId] || { range: 3, dashRange: 4, idleMode: 1, speedAfter: 4 };
  }
  // called when a symbol event would start (touch/bump/action) -> fight in real time instead
  engage(ev, hit = false) {
    const s = this.symbols.get(ev);
    if (!s || !this.isSymbolPage(ev)) return false;
    if (s.engaged || this.playerDead) return true;
    if (this.leadBoss(s)) { G.coop.askBossStart([ev], hit ? 'bump' : 'touch'); return true; }
    if (this.sharesOpenFight(ev) || (!hit && this.waitsForOpenFight(ev))) return true;
    s.engaged = true;
    s.interp = new Interpreter(1, false, 'symbol');
    s.interp.setup(ev.list, ev.id);
    ev.lock?.();
    return true;
  }

  // ---- symbol (dormant) enemies -----------------------------------------------------------------
  updateSymbols(dt) {
    const pc = G.map.playerChar;
    for (const [ev, s] of this.symbols) {
      const e = s.enemy;
      if (e) e.offStage = !e.battle && this.sharesOpenFight(ev);
      if (!e || e.battle || !e.mesh || G.arena?.hides(ev) || e.offStage) continue;
      const set = this.symbolSetting(ev);
      const dist = Math.hypot(e.fx - pc.fx, e.fy - pc.fy);
      const range = (G.input.running() && this.canRun() ? set.dashRange : set.range) * 1.3 + 0.5;
      // (stealthed - 안 보이는 후추, 보이지 않는 몸 - the map's monsters do not notice the player; a boss still does)
      const hidden = G.state.system.stealthSteps > 0 && !this.symbolIsBoss(s);
      const down = this.spectating || !!G.coop?.respawning;      // (co-op: watching a fight fallen, or on its way back)
      if (!s.engaged && !hidden && !down && dist < range && lineOfSight(e.fx, e.fy, pc.fx, pc.fy) && !G.map.interpreter.running() && !this.waitsForOpenFight(ev)) {
        if (this.leadBoss(s)) { G.coop.askBossStart([ev], 'touch'); continue; }
        this.engage(ev);
        e.alertTime = 0.5;
        // as the original's symbol script: its balloon over it (! for most) with a little chime
        if (set.balloon > 0) {
          ev.balloonId = set.balloon; ev.balloonTime = BALLOON_TIME;
          G.audio?.playSe({ name: 'Decision1', volume: 50, pitch: 150 }, e.worldPos(new THREE.Vector3()));
        }
        continue;
      }
      // idle wander around home
      if (set.idleMode === 0) {
        if (!s.wander || s.wander.t <= 0) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
          s.wander = { x: s.homeX + Math.cos(a) * r, y: s.homeY + Math.sin(a) * r, t: 2 + Math.random() * 3 };
        }
        s.wander.t -= dt;
        this.moveEnemyToward(e, G.map.nearX(s.wander.x, e.fx), G.map.nearY(s.wander.y, e.fy), 0.7 * dt / T * 1.5, true);
      }
    }
  }

  // an event whose page begins a boss fight: a battle in its list (or in a common event it calls) that is one
  // (isBossFight). A co-op guest may begin one only by the server's rules (coop.js askBossStart)
  eventStartsBoss(ev) { return this.eventBossTroop(ev) > 0; }
  // (that fight's troop - 0: none)
  eventBossTroop(ev) {
    const list = ev?.page && !ev.erased && !this.comesBack(ev) ? ev.list : null;
    if (!list?.length) return 0;
    const fight = l => {
      const at = l.findIndex(c => c.code === 301);
      if (at < 0) return 0;
      const p = l[at].parameters, troopId = p[0] === 0 ? p[1] : p[0] === 1 ? G.state.v(p[1]) : 0;
      return $data.troops[troopId] && this.isBossFight({ list: l, index: at }, $data.troops[troopId]) ? troopId : 0;
    };
    let id = fight(list);
    for (const c of list) if (!id && c.code === 117) id = fight(commonEventList(c.parameters[0]) || []);
    return id;
  }
  // a boss on the map (no stealth hides the player from it): the same as a fight that closes the arena (startBattle) -
  // a boss fight by its music (isBossFight: the troop plays some of its own, or the event picks a battle BGM of its
  // own right before) started by a roaming one-off (도도, 그리피, the nightmares...); not an area's ordinary monsters
  // that fight to boss music (윈터벨's orcs and 리델 묘지's grave robbers come back once beaten; 윈터벨's thirty slimes)
  symbolIsBoss(s) {
    const list = s.ev.list || [];
    if (s.isBossOf === list) return s.isBoss;
    s.isBossOf = list;
    const at = list.findIndex(c => c.code === 301);
    return (s.isBoss = at >= 0 && this.isBossFight({ list, index: at }, $data.troops[s.troopId]) && this.oneOffSymbol(s, s.troopId));
  }
  // chasing enemies go straight through walls and props unless the setting says otherwise
  // (wandering ones keep to the floor)
  throughWalls() { return G.settings.enemyThroughWalls !== false; }
  moveEnemyToward(e, tx, ty, stepTiles, collide = !this.throughWalls()) {
    const dx = tx - e.fx, dy = ty - e.fy;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return;
    const s = Math.min(stepTiles, d);
    let nx = e.fx + dx / d * s, ny = e.fy + dy / d * s;
    if (collide) [nx, ny] = resolveCircle(nx, ny, Math.min(e.r || 0.3, 0.45));
    else [nx, ny] = this.clampToMap(nx, ny);
    e.fx = nx; e.fy = ny;
  }
  clampToMap(fx, fy) {
    const m = G.map, g = m.grid;
    return [m.loopX ? fx : THREE.MathUtils.clamp(fx, 0, g.w - 1), m.loopY ? fy : THREE.MathUtils.clamp(fy, 0, g.h - 1)];
  }
}
