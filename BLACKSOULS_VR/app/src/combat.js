// Real-time 3D action combat replacing RPG Maker's turn-based battles.
//  - Battle Processing (301) spawns the troop as 3D enemies (battler art as billboards)
//  - symbol-encounter events become roaming enemies that engage on sight
//  - player: swing the weapon (VR) / click (desktop); shield block (left grip / RMB); dodge
//  - original mechanics: Break (hit during wind-up -> defenceless), Guard (halves damage), Evade (dodge i-frames)
import * as THREE from 'three';
import { AllySystem } from './allies.js';
import { G } from './globals.js';
import { $data } from './data.js';
import { T } from './mapmesh.js';
import { battleStartEffects } from './state.js';
import { Interpreter } from './interpreter.js';
import { resolveCircle, clearEdgeCache } from './collision.js';
import { QuickRing } from './quickslots.js';
import { DeskSwing } from './deskswing.js';
import { WeaponLag } from './weaponlag.js';
import { WeaponFx } from './weaponfx.js';
import { openFights } from './maphints.js';
import { bossMoves } from './bossmoves.js';
import { ActionEnemy, Battle, ENEMY_TURN, RUN_AGAIN, RUN_STAMINA, TURN_SECONDS } from './combat/common.js';
import { SymbolPart } from './combat/symbols.js';
import { MusicPart } from './combat/music.js';
import { GearPart } from './combat/gear.js';
import { ItemPart } from './combat/items.js';
import { BottlePart } from './combat/bottle.js';
import { SpellPart } from './combat/spells.js';
import { EffectPart } from './combat/effects.js';
import { DamagePart } from './combat/damage.js';
import { EnemyPart } from './combat/enemies.js';
import { BossActPart } from './combat/bossacts.js';
import { AreaPart } from './combat/areas.js';
import { CoopPart } from './combat/coop.js';
import { AttackPart } from './combat/attacks.js';
import { PvpPart } from './combat/pvp.js';
import { MacroPart } from './combat/macros.js';

// ------------------------------------------------------------------ system
export class CombatSystem {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'combat';
    scene.add(this.root);
    this.battles = [];
    this.enemies = [];
    this.symbols = new Map();      // event -> {fx, fy, home, enemy(visual), engaged, interp}
    this.passing = new Set();      // enemies the player is slipping through (a dodge)
    this.allies = new AllySystem(this);   // the party's other members, in the world
    // (a co-op guest: the host's enemies as it sees them - puppets, moved and judged by the host; netId -> body)
    this.puppets = new Map();
    this.puppetBattle = { done: false, puppet: true, enemies: [] };
    // (what a puppet's mark that follows the host follows: where this guest sees the host - coop.js hostChest; away:
    // another player's body as seen here, whose blows are its own to judge)
    this.hostTarget = { stands: true, alive: true, away: true, chest: out => G.coop?.hostChest?.(out) || G.player.headWorld(out) };
    this.projectiles = [];
    this.popups = [];
    this.playerDead = false;
    this.deathHandled = false;
    this.stamina = 1; this.staminaDelay = 0;
    this.healing = null;
    this.swing = null;            // desktop swing animation
    this.deskSwing = new DeskSwing();     // (PC) how a held weapon's blows move: cuts in a chain, a charged thrust - deskswing.js
    this.weaponLag = new WeaponLag();     // (VR) the blade swung after the hand as its weight has it - weaponlag.js
    this.weaponPace = 1;                  // the weapon's weight (weaponPace): its blows' pace, their stamina, super armor
    this.weapon = null; this.shield = null; this.wtype = 0;
    this.prevTip = new THREE.Vector3(); this.prevBase = new THREE.Vector3(); this.hasPrev = false;
    this.prevRel = new THREE.Vector3();   // the tip relative to the body last frame (swing speed)
    this.attackTokens = 0;
    this.rangedCooldown = 0;
    this.quick = new QuickRing();
    this.skillCD = {};             // skill id -> G.time when it can be used again
    this.fx = [];                  // short-lived flashes / tracers
    this.ready = null;             // a spell / throwable held in the right hand, waiting for the attack button
    this.held = null;              // VR: a herb bottle / syringe in the right hand, used at the mouth / on the body;
                                   // a resin in the left hand, rubbed onto the weapon
    this.skillArm = null;          // a weapon art waiting on the weapon (red): the next blow that lands is that skill
    this.disarmed = false;         // 무장해제: weapon and shield put away, the bare hands show and nothing they do hits
    this.weaponFx = new WeaponFx(this.root, () => this.glowTexture());
    this.fadingMarkers = [];
    this.waves = [];               // shockwaves running across the floor (a boss's quake / roar / wave)
    this.hazards = [];             // eruptions and pools a boss's move leaves on the floor for a while
    this.music = null;             // map BGM/BGS saved while battle music plays
    this.sideInterps = [];         // common events run by enemy skills (as a battle would run them)
    this.detached = [];            // event fights moved off the map's interpreter: {interp, battle, ev}
    this.defeated = new Map();     // event -> time its enemy was beaten on this visit (respawn hold)
  }
  get inCombat() { return this.battles.some(b => !b.done); }
  // a fight an event started (a boss, a '살해한다' fight...) - not a roaming monster's own, unless it is a boss of a map
  // that stays open (one boss at a time there: 소녀의 악몽's 시부치 waits while a girl's fight is on)
  eventFightOn() { return this.battles.some(b => !b.done && (!b.symbol || b.openBoss)) || this.openFightTroops(null).length > 0; }
  // a moment later - unless the fights are gone by then (the map changed, a rest at a bonfire)
  later(ms, fn) { const gen = this.gen; setTimeout(() => { if (gen === this.gen) fn(); }, ms); }

  // ---- lifecycle -------------------------------------------------------------
  // (keepState: a save is being loaded - the fights going away belong to the game left behind, not to it)
  reset({ keepState = false, carry = false } = {}) {
    // (carry - a map change: an event's run that is past its fight, in its win or lose branch, goes on on the new map as
    // the original's map interpreter would - 혼돈 던전 / 시공 던전's defeat, CE269, takes the party out and then lets the
    // menu and saving back; dropped with the old map, saving stayed shut until 고왕의 뼛가루. One still in its fight
    // ends with it)
    const carried = carry ? [...[...this.symbols.values()].map(s => s.interp), ...this.detached.map(d => d.interp), ...(this.carried || [])]
      .filter(it => it?.running() && it.foughtOut && !it.battle) : [];
    // a fight an event started and that ends unfinished (the map left, a rest at a bonfire) never happened: what that
    // event changed on its way to it goes back too, so its scene plays again from its start
    if (!keepState) for (const d of this.detached) if (d.battle && !d.battle.done) this.undoFightEvent(d.interp);
    G.arena?.release();                        // a closed boss arena opens with the fights gone
    G.theater?.reset();                        // (and a stage play's stage is taken down)
    G.player?.endAir?.();                      // (blown up into the sky by a wind: back on the ground)
    this.gen = (this.gen || 0) + 1;            // blows and shots still on their way belong to the old fights
    for (const e of this.enemies) e.remove();
    for (const s of this.symbols.values()) s.enemy?.remove();
    for (const e of this.puppets.values()) e.remove();
    this.puppets.clear();
    for (const p of this.projectiles) this.root.remove(p.mesh);
    for (const p of this.popups) this.root.remove(p.sprite);
    for (const f of this.fx) this.root.remove(f.obj);
    for (const e of this.enemies) e.marker?.dispose();
    for (const s of this.symbols.values()) s.enemy?.marker?.dispose();
    for (const m of this.fadingMarkers) m.dispose();
    for (const m of this.areaMarks || []) m.mk.dispose();
    this.areaMarks = [];
    for (const w of this.waves) this.root.remove(w.mesh);
    for (const h of this.hazards) { if (h.mesh) this.root.remove(h.mesh); h.mk?.dispose(); }
    this.hazards = [];
    for (const e of this.enemies) this.hideBlade(e);
    // any enemy body (or shockwave) no list holds any more goes too
    for (const ch of [...this.root.children]) if (ch.userData.enemy || ch.userData.transient) this.root.remove(ch);
    // a fight left unfinished (walked away from through an exit - 소녀의 악몽's open fights): the battle music its event
    // chose goes back to what it was, as its win or lose branch would have put it
    const unfinished = [...[...this.symbols.values()].filter(s => s.engaged && s.interp).map(s => s.interp), ...this.detached.map(d => d.interp)];
    for (const it of unfinished) if (it && it.running() && it.battle && !it.battle.done && it.battleBgmBefore !== undefined) G.state.system.battleBgm = it.battleBgmBefore;
    this.enemies = []; this.battles = []; this.symbols.clear(); this.projectiles = []; this.popups = []; this.fx = []; this.fadingMarkers = []; this.waves = [];
    // (the fights gone: what my own skills gave me for them goes too - fightState; a save being loaded keeps its own)
    if (this.fightStates && !keepState) { const a = G.state?.party?.leader(); for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s); }
    this.fightStates = null;
    this.quick.close();
    this.cancelReady();
    this.cancelHeld();
    for (const d of this.detached) { if (!carried.includes(d.interp)) d.interp.terminate(); d.ev?.unlock?.(); }
    this.detached = [];
    this.sideInterps = [];
    this.carried = carried;
    this.defeated.clear();
    if (this.music) { G.audio?.restore(this.music.saved); this.music = null; }
    G.screen?.clearAnims?.();
    this.playerDead = false; this.deathHandled = false;
    this.allies?.reset();
    clearEdgeCache();
  }
  // what a fight's enemies left going - shots in the air, shockwaves, pools and eruptions - gone at once (a stage
  // play's curtain closing on an act)
  clearEnemyFx(battle) {
    const mine = x => x?.battle === battle;
    this.projectiles = this.projectiles.filter(p => {
      if ((p.owner !== 'enemy' && p.owner !== 'mirror') || !mine(p.enemy)) return true;     // (a spell turned back too)
      this.root.remove(p.mesh);
      return false;
    });
    this.waves = this.waves.filter(w => {
      if (!mine(w.e)) return true;
      this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
      return false;
    });
    this.hazards = this.hazards.filter(h => {
      if (!mine(h.e)) return true;
      if (h.mesh) { this.root.remove(h.mesh); h.mesh.material.dispose(); }
      if (h.mk) this.fadingMarkers.push(h.mk);
      return false;
    });
  }
  onMapLoaded() {
    this.reset({ carry: true });                // (a run carried over from the map left goes on - reset)
    G.theater?.prepare();                      // (a map a play is put on: its lights hung now, dark)
    this.reviveEnemies(false);
    for (const ev of G.map.eventList) this.onEventPageChanged(ev);
  }

  // ---- bonfire -------------------------------------------------------------------
  // Resting at a bonfire (CE 篝火) brings every enemy back, as a Souls bonfire does: the fights here end,
  // beaten field enemies stand again at once and the living ones go home healed; on other maps beaten
  // enemies are back as soon as the player arrives there.
  restAtBonfire() {
    const sys = G.state.system;
    sys.bonfireRest = (sys.bonfireRest || 0) + 1;
    for (const s of this.symbols.values()) if (s.engaged) s.ev.unlock?.();
    this.reset();
    this.reviveEnemies(true);
    for (const ev of G.map.eventList) this.onEventPageChanged(ev);
  }
  // a beaten (or escaped) enemy's page that brings it back after a while: parallel, of an enemy's event, only its own
  // moves and waits and a self switch turned back off - a co-op guest leading a map runs it too (character.js)
  comebackPage(ev) {
    const page = ev.page;
    if (!page || ev.trigger !== 4) return false;
    if (page._comeback === undefined) {
      const list = page.list || [], quiet = new Set([0, 108, 408, 230, 505]);
      page._comeback = list.some(c => c.code === 123 && c.parameters[1] === 1)
        && list.every(c => quiet.has(c.code) || (c.code === 123 && c.parameters[1] === 1) || (c.code === 205 && c.parameters[0] === 0))
        && (ev.event?.pages || []).some(p => p.list?.some(c => c.code === 301));
    }
    return page._comeback;
  }
  // beaten enemies wait on a page that turns their self switch back after a while (원작 10 s): turn it
  // back now, once per map after each rest (home: the living ones also walk back to their places)
  reviveEnemies(home) {
    const sys = G.state.system, mapId = G.map.mapId;
    sys.restSeen = sys.restSeen || {};
    if (!home && (sys.restSeen[mapId] ?? -1) >= (sys.bonfireRest || 0)) return;
    sys.restSeen[mapId] = sys.bonfireRest || 0;
    let changed = false;
    for (const ev of G.map.eventList) {
      const pages = ev.event?.pages || [];
      if (!pages.some(p => p.list?.some(c => c.code === 301))) continue;      // not an enemy
      const page = ev.page;
      if (page && page.trigger === 4) {
        for (const c of page.list || []) {
          if (c.code === 123 && c.parameters[1] === 1) { G.state.setSelfSw(mapId, ev.id, c.parameters[0], false); changed = true; }
        }
      }
      if (home && (ev.x !== ev.event.x || ev.y !== ev.event.y)) ev.moveto(ev.event.x, ev.event.y);
    }
    if (changed) G.map.refresh();
  }

  // ---- battle processing -----------------------------------------------------------
  startBattle({ troopId, canEscape, canLose, event, interpreter }) {
    // a fight begun while the last one's defeat is still being played out is fought standing: 그랑・기뇰's 재도전
    // starts it again from the same event (never idle in between), after its lose branch brought the party back
    if (this.playerDead && (G.state.party.leader()?.hp || 0) > 0) { this.playerDead = false; this.deathHandled = false; }
    const sym = event ? this.symbols.get(event) : null;
    const battle = new Battle(this, { troopId, canEscape, canLose, event, interpreter, symbol: sym, private: !!sym?.private, hallKey: sym?.hallKey || null });
    this.battles.push(battle);
    G.state.system.battleCount++;
    const members = battle.troop?.members || [];
    // anchor: symbol body, visible event, or in front of the player - or, a boss fight a co-op guest began, of that guest
    let ax, ay;
    const by = G.coop?.bossStarterAt?.(), pc = G.map.playerChar, who = by || pc;
    if (sym?.enemy) { ax = sym.enemy.fx; ay = sym.enemy.fy; }
    else if (event && event.characterName && Math.hypot(event.x - who.fx, event.y - who.fy) < 9) { ax = event.x; ay = event.y; }
    else {
      const f = by ? { x: by.d === 4 ? -1 : by.d === 6 ? 1 : 0, z: by.d === 8 ? -1 : by.d === 2 ? 1 : 0 } : G.player.forward2D();
      ax = who.fx + f.x * 3.2; ay = who.fy + f.z * 3.2;
      [ax, ay] = resolveCircle(ax, ay, 0.45);
    }
    const sorted = members.map((m, i) => ({ m, i })).sort((a, b) => a.m.x - b.m.x);
    const toP = Math.atan2(who.fy - ay, who.fx - ax);
    // the body standing on the field becomes the first visible member of its kind (a troop's leftmost member
    // can be a hidden one that comes out later); with none of its kind it leaves - never a second body
    // standing by, to be left behind when the fight ends
    const own = sym?.enemy ? sorted.find(({ m }) => !m.hidden && m.enemy_id === sym.enemy.b.enemyId) : null;
    if (sym?.enemy && !own) { sym.enemy.remove(); sym.enemy = null; }
    sorted.forEach(({ m }, k) => {
      let e;
      if (own?.m === m && sym?.enemy) {
        e = sym.enemy; sym.enemy = null;
        e.battle = battle; e.state = 'chase'; e.alertTime = 0.4;
      } else {
        const lateral = (k - (sorted.length - 1) / 2) * 1.1;
        let fx = ax + Math.cos(toP + Math.PI / 2) * lateral - Math.cos(toP) * 0.4;
        let fy = ay + Math.sin(toP + Math.PI / 2) * lateral - Math.sin(toP) * 0.4;
        [fx, fy] = resolveCircle(fx, fy, 0.35);
        e = new ActionEnemy(this, battle, m.enemy_id, fx, fy, { hidden: m.hidden });
        e.alertTime = 0.8 + k * 0.3;
      }
      e.memberIndex = members.indexOf(m);
      if (battle.private) this.makePrivate(e, battle.hallKey);
      battle.enemies.push(e);
      this.enemies.push(e);
    });
    // (a hallucination beaten with another, who ran it - winHallucination: this player's own falls at once)
    if (sym?.autoWin) { sym.autoWin = false; for (const e of battle.enemies) if (!e.hidden) { e.b.hp = 0; this.killEnemy(e); } }
    // what their notes do as a fight starts (script 190: 섬뜩한 힌들리, 펜릴... all stats up; the player's 거룩한 총검,
    // 독사의 옷, 꿀벌의 반지, 광란왕의 반지, 나의 투쟁의 반지, 극작가의 두건, 방왕의 반지)
    for (const e of battle.enemies) this.battleStart(e.b, e, battle);
    const leader = G.state.party.leader();
    if (leader && !this.playerDead) this.battleStart(leader, null, battle);
    // a stage play (그랑・기뇰): the troop takes its places on the stage (src/theater.js)
    G.theater?.begin(battle);
    // a boss fight: its big ones (at most three) use some of their skills as moves of their own (bossFamily) - not
    // one with an area's ordinary monsters (comesBack: no arena closing the way out, nothing of co-op's boss fights)
    if (battle.enemies.length && this.isBossFight(interpreter, battle.troop) && !this.comesBack(sym?.ev || event)) {
      battle.bossFight = true;
      this.refreshBosses(battle);
      // the arena closes (src/arena.js) - also for a boss that comes in several equal parts (그랑・기뇰, 반상의
      // 고왕, 흰 유니콘 유니스); started by a roaming enemy only when that is a one-off boss (도도, 그리피, the
      // nightmares of 소녀의 악몽...)
      if (!sym || this.oneOffSymbol(sym, troopId)) {
        if (openFights(G.map.mapId)) battle.openBoss = true;
        else G.arena?.begin(battle, by);            // (where the fight began: the guest's, if a guest began it)
      }
      // (the roaming monsters still after the player do not follow into the fog: as if escaped - they go back,
      // to come again as the original's escape lets them)
      if (G.arena?.active && G.arena.battle === battle) for (const b of this.battles) if (b !== battle && !b.done && b.symbol) b.finish(1);
      // (co-op: the players not in it are asked whether to join it - coop.js; not to a hallucination's)
      if (!battle.private) G.coop?.onBossFightBegin?.(battle);
    }
    if (battle.enemies.length) this.battleMusicStart();
    if (!battle.enemies.length) battle.finish(0);
    else if (!sym) G.audio?.playSystemSe(7);
    return battle;
  }
  battleStart(b, e, battle) {
    const turn = e ? ENEMY_TURN : TURN_SECONDS;
    for (const o of b.featureObjects()) {
      if (!o) continue;
      for (const { tag, a } of battleStartEffects(o)) {
        if (!(b.evalNote(a[a.length - 1]) > Math.random() * 100)) continue;
        const v = b.evalNote(a[0]);
        switch (tag) {
          case 0: b.hp = Math.max(0, Math.min(b.mhp, b.hp + Math.trunc(v))); break;
          case 1: b.hp = Math.max(0, Math.min(b.mhp, b.hp + Math.trunc(v * b.mhp / 100))); break;
          case 2: b.mp = Math.max(0, Math.min(b.mmp, b.mp + Math.trunc(v))); break;
          case 3: b.mp = Math.max(0, Math.min(b.mmp, b.mp + Math.trunc(v * b.mmp / 100))); break;
          case 6:
            if (e) this.addEnemyState(e, v, true);
            else if (!b.stateResist(v)) {
              b.addState(v); this.timeActorState(v);
              // (one the original takes away as a fight ends goes with this one - 거룩한 총검's bullets start at 1 again)
              if ($data.states[v]?.remove_at_battle_end) (battle.eventStates ||= []).push([b, v]);
            }
            break;
          case 7:
            b.removeState(v);
            if (e?.stateTimers) delete e.stateTimers[v];
            if (!e && G.state.system.stateTimers) delete G.state.system.stateTimers[v];
            break;
          case 8: b.addBuff(v, b.evalNote(a[1]) * turn); break;
          case 9: if (b.buffs[v] > 0) b.removeBuff(v); break;
          case 10: b.addDebuff(v, b.evalNote(a[1]) * turn); break;
          case 11: if (b.buffs[v] < 0) b.removeBuff(v); break;
          default: break;
        }
      }
    }
    if (e) e.drawBar?.();
  }
  // ---- per-frame update -----------------------------------------------------------------------
  // 60 Hz: interpreters for engaged symbol events (a co-op guest leading a map: what their commands change of the world
  // is the host's to keep - coop.js noteFlag, recording)
  updateLogic() {
    const c = G.coop;
    if (c) c.recording++;
    try { this.updateLogicNow(); } finally { if (c) c.recording--; }
  }
  updateLogicNow() {
    if (this.carried?.length) {
      for (const it of this.carried) it.update();
      this.carried = this.carried.filter(it => it.running());
    }
    if (this.sideInterps.length) {
      for (const it of this.sideInterps) it.update();
      this.sideInterps = this.sideInterps.filter(it => it.running());
    }
    for (const d of this.detached) d.interp.update();
    if (this.detached.length) {
      this.detached = this.detached.filter(d => {
        if (d.interp.running()) return true;
        d.ev?.unlock?.();
        if (d.ev) G.coop?.eventDone?.(d.interp.mapId, d.ev.id, d.interp);     // (the developer's world: its lock goes)
        return false;
      });
    }
    for (const [ev, s] of this.symbols) {
      if (s.engaged && s.interp) {
        s.interp.update();
        if (!s.interp.running()) {
          s.engaged = false; s.interp = null;
          ev.unlock?.();
          // what its last commands switched takes hold now, as the original refreshes the map before any event can
          // start: else a beaten girl of 소녀의 악몽 (a switch puts her away) stood again where she had roamed, for one
          // frame still on her fighting page - near enough, she came straight on for a second fight
          if (G.map.needRefresh) G.map.refresh();
          if (this.symbols.get(ev) !== s) continue;
          if (!this.isSymbolPage(ev)) { s.enemy?.remove(); this.symbols.delete(ev); }
          else if (!s.enemy) {
            const member = $data.troops[s.troopId]?.members?.[0];
            if (member) { s.enemy = new ActionEnemy(this, null, member.enemy_id, s.homeX, s.homeY, { dormant: true }); s.enemy.balloonOf = ev; }
          }
        }
      }
    }
    // troop battle events (turn ~ every 6 s)
    for (const b of this.battles) if (!b.done) this.updateTroopEvents(b);
  }
  // troop (battle) events like Game_Troop: the first page whose conditions hold runs, and the next
  // check waits until it has finished (several pages can come true at once: a turn-0 setup and a
  // turn-end page). A "turn" is 6 seconds; turn-end pages run once as each turn ends.
  updateTroopEvents(b) {
    const pages = b.troop?.pages;
    if (!pages?.length) return;
    const turn = Math.floor(b.time / 6);
    if (turn > (b.turnSeen ?? 0)) { b.turnSeen = turn; b.turnEndPending = true; }
    this.updateDelayed(b, turn);
    if (b.troopInterp?.running()) { b.troopInterp.update(); return; }
    // every enemy down: the fight is won before any other page comes on (VX Ace judges the battle first) - else a
    // fake 흰 유니콘 유니스 falling with the real one was brought back by its own page as the rest fell
    if (b.enemies.length && b.enemies.every(e => !e.alive || e.hidden)) return;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page.list.length <= 1) continue;
      const c = page.condition;
      if (!c.turn_ending && !c.turn_valid && !c.enemy_valid && !c.actor_valid && !c.switch_valid) continue;
      // span: 0 once per battle, 1 once per turn, 2 "moment" (whenever true; at most once a second here)
      const key = page.span === 1 ? `${i}:${turn}` : page.span === 2 ? `${i}:m${Math.floor(b.time)}` : `${i}`;
      if (b.pageDone.has(key)) continue;
      if (c.turn_ending && !b.turnEndPending) continue;
      if (c.turn_valid) { const n = turn; const ok = c.turn_b === 0 ? n === c.turn_a : n >= c.turn_a && (n - c.turn_a) % c.turn_b === 0; if (!ok) continue; }
      if (c.enemy_valid) { const e = b.enemies.find(x => x.memberIndex === c.enemy_index); if (!e || e.b.hp / e.b.mhp * 100 > c.enemy_hp) continue; }
      if (c.actor_valid) { const a = G.state.actor(c.actor_id); if (!a || a.hp / a.mhp * 100 > c.actor_hp) continue; }
      if (c.switch_valid && !G.state.sw(c.switch_id)) continue;
      b.pageDone.add(key);
      b.troopInterp = new Interpreter(1);
      b.troopInterp.troop = true;                  // its music changes play even during battle music
      b.troopInterp.setup(page.list, 0);
      b.troopInterp.update();                      // at once, like the original processing it right away
      return;
    }
    b.turnEndPending = false;
  }

  paused() {
    const m = G.map;
    return !m || m.transferring || G.ui.msg || G.ui.menuOpen || G.ui.sceneOpen ||
      (m.interpreter.running() && m.interpreter.waitMode !== 'battle') ||
      !!G.coop?.heldByScene?.();             // (co-op guest: the host's scene holds it as it holds the host)
  }

  update(dt) {
    if (!G.map?.grid) return;
    if (this.gripAdjust) this.updateGripAdjust();
    this.refreshEquipment();
    this.alignHeldToRay();
    if (G.input.disarmPressed() && !G.ui.menuOpen && !G.ui.sceneOpen && !this.gripAdjust && !this.playerDead) this.toggleDisarm();
    if (this.playerDead && !G.map.interpreter.running() && !G.map.transferring && !G.map.reservedCommon.length &&
        (G.state.party.leader()?.hp || 0) > 0) { this.playerDead = false; this.deathHandled = false; }
    const paused = this.paused();
    // stamina - running in a fight wears it down (player.js runningNow), nothing coming back meanwhile; run out, one
    // walks till RUN_AGAIN is back (canRun). Each spend holds it back a moment, running it out a little longer
    // (staminaDelay - useStamina)
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    const fight = this.fighting();
    if (fight && G.player?.runningNow) {
      this.useStamina(RUN_STAMINA * dt, 0.3);
      if (this.stamina <= 0) this.winded = true;
    }
    if (this.staminaDelay <= 0 && !this.guardUp) this.stamina = Math.min(1, this.stamina + 0.45 * dt);      // (not while guarding)
    if (this.winded && (this.stamina >= RUN_AGAIN || !fight)) this.winded = false;
    if (this.duelStamina()) { this.stamina = 1; this.winded = false; }          // (흑기사 린다메아's duel: unlimited)
    this.rangedCooldown = Math.max(0, this.rangedCooldown - dt);
    this.updateGuard();
    this.updateDeskShield(dt);
    // drinking takes a moment (quick slot potions)
    if (this.healing) {
      this.healing.t -= dt;
      if (this.healing.t <= 0) { this.useItem($data.items[this.healing.id], 'quick'); this.healing = null; }
    }
    this.updateQuick(paused);
    this.updateMacro(paused);
    G.emotes?.update(paused);
    this.updateReady(dt, paused);
    this.updateHeld(dt, paused);
    this.updateFx(dt);
    this.updateAreaMarks();
    if (this.fadingMarkers.length) this.fadingMarkers = this.fadingMarkers.filter(m => !m.fadeOut(dt));
    if (!paused && !this.playerDead) {
      this.updatePlayerAttack(dt);
      this.updateSymbols(dt);
    } else this.weaponLag.settle();       // (held still meanwhile: straight in the hand, swung from there again)
    // (PC: whatever took the hands this frame - a blow, a cast, a drink - has the guard down before any blow lands)
    if (this.guardUp && this.handsBusy()) this.updateGuard();
    this.updateWeaponGlow();
    this.updateActorStates(dt, paused);
    this.updateGhost();
    this.updateWeaponFx(dt);
    if (this.spectating) this.setGhostly(true);       // (co-op: watching a fight fallen - what it holds stays a shade)
    // (a co-op guest: the host's world it stands in does not wait while this player is in its menu)
    const held = paused && !(G.coop?.phantom && !G.map.transferring);
    this.updateEnemies(dt, held);
    this.allies.update(dt, paused);
    this.updateProjectiles(dt, held);
    this.updateWaves(dt, held);
    this.updateHazards(dt, held);
    this.updatePopups(dt);
    // battle end checks
    for (const b of this.battles) {
      if (b.done) continue;
      b.time += paused ? 0 : dt;
      if (b.enemies.length && b.enemies.every(e => !e.alive || e.hidden) && b.enemies.every(e => e.state === 'dead' || e.hidden)) {
        b.finish(0);
        continue;
      }
      if (b.canEscape && !paused) {
        const pc = G.map.playerChar;
        // (co-op: the guests in it too - one going its own way may fight far from this player)
        const near = [pc, ...(G.coop?.remoteBodies?.() || []).filter(r => r.inFight(b.alive[0]) && (!b.private || !!G.coop.peerSees?.(r.peer.id, b.hallKey)))];
        const far = b.alive.every(e => near.every(q => Math.hypot(e.fx - q.fx, e.fy - q.fy) * T > 15));
        b.escapeTimer = far ? b.escapeTimer + dt : 0;
        if (b.escapeTimer > 1.5) b.finish(1);
      }
    }
    this.battles = this.battles.filter(b => !b.done || b.interpreter?.battle === b);
  }

}
// CombatSystem's methods, kept by what they are about in combat/*.js: each its own
for (const part of [SymbolPart, MusicPart, GearPart, ItemPart, BottlePart, SpellPart, EffectPart, DamagePart,
  EnemyPart, BossActPart, AreaPart, CoopPart, AttackPart, PvpPart, MacroPart]) {
  for (const k of Object.getOwnPropertyNames(part.prototype)) {
    if (k !== 'constructor') Object.defineProperty(CombatSystem.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k));
  }
}

// the boss moves of src/bossmoves.js (a far orb, a blink chain, a turning star, a lattice, bands, a cloak's leap; the wind's lift)
Object.assign(CombatSystem.prototype, bossMoves);
