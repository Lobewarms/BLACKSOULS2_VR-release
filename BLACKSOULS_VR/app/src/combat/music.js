// The fights' music (the original's BattleManager): the map's BGM/BGS kept, the battle BGM played, a won fight's ME and the
// map's music back.
import * as THREE from 'three';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { difficultyRate, holdsPlace } from './common.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class MusicPart {
  // ---- battle music (BattleManager): the map's BGM/BGS are kept, the battle BGM plays, a won fight
  // plays the battle end ME, then the map music comes back where it was. Setting 전투 BGM: 'boss' plays
  // it only when an event chose a battle BGM other than the usual one (the boss themes); 'all' every
  // fight like the original. Music the troop's own events start mid-fight (boss phases) plays either way.
  battleMusicStart() {
    const usual = $data.system.battle_bgm;
    const bgm = G.state.system.battleBgm || usual;
    const special = !!bgm?.name && bgm.name !== usual?.name;
    const play = (G.settings.battleBgm || 'boss') === 'all' ? !!bgm?.name : special;
    if (this.music) {
      // fights overlap: the first one saved the map music - but a boss's own theme still comes in over a plain
      // fight going on (monsters still after the player as the boss's scene starts)
      if (play && bgm.name !== this.music.bgm) { this.music.played = true; this.music.bgm = bgm.name; G.audio?.playBgm(bgm); G.audio?.stopBgs(); }
      return;
    }
    this.music = { saved: G.audio?.snapshot(), played: play, bgm: play ? bgm.name : '' };
    if (play) { G.audio?.playBgm(bgm); G.audio?.stopBgs(); }
  }
  deferMapMusic(kind, audio) {
    const s = this.music?.saved;
    if (!s) return;
    if (!audio?.name) { s[kind] = null; return; }
    if (s[kind]?.name === audio.name) { s[kind].volume = audio.volume; s[kind].pitch = audio.pitch; return; }
    s[kind] = { name: audio.name, volume: audio.volume, pitch: audio.pitch, pos: 0 };
  }
  battleMusicEnd(result) {
    if (!this.music || this.battles.some(b => !b.done)) return;
    const m = this.music;
    this.music = null;
    G.audio?.restore(m.saved);
    if (result === 0 && m.played) G.audio?.playMe(G.state.system.battleEndMe || $data.system.battle_end_me);
  }
  onBattleEnd(battle) {
    G.player.floatDown?.();                         // (blown up by the wind when it ended: let down gently)
    if (battle.result === 0 && battle.private) G.coop?.hallucinationBeaten?.(battle.hallKey);
    if (battle.result === 0) {
      let gold = 0, exp = 0;
      // (rings and oaths: twice the souls, twice the drop chance; the experience rate)
      // (the difficulty: more souls the harder - but for <お金変動無効> - and so on, script 218)
      const party = G.state.party, dropRate = (party.partyAbility(5) ? 2 : 1) * difficultyRate(10);
      // (the developer's world, its rule shareLoot: the drops and the souls go to everyone on the server as well -
      // coop.js noteGain; a hallucination's fight is its seer's own)
      const coop = !battle.private ? G.coop : null;
      if (coop) coop.lootDepth++;
      try {
        for (const e of battle.enemies) {
          if (e.escaped || e.hidden) continue;       // (VX Ace's rewards are the fallen's: not one that left - enemyEscape -, nor one that never came out)
          const note = e.data.note || '';
          gold += /<お金変動無効>/.test(note) ? e.data.gold || 0 : Math.round((e.data.gold || 0) * difficultyRate(9));
          exp += /<経験値変動無効>/.test(note) ? e.data.exp || 0 : Math.round((e.data.exp || 0) * difficultyRate(8));
          for (const di of e.data.drop_items || []) {
            if (di.kind > 0 && di.denominator > 0 && Math.random() * di.denominator < dropRate) {
              const kind = ['', 'item', 'weapon', 'armor'][di.kind];
              G.state.party.gainItem(kind, di.data_id, 1);
              G.ui.notifyGain(kind, di.data_id, 1);
            }
          }
        }
        if (gold && party.partyAbility(4)) gold *= 2;
        if (gold) { party.gainGold(gold); G.ui.toast(`+${gold.toLocaleString()} ${$data.system.currency_unit}`, 0, '#e8d8a8'); }
      } finally { if (coop) coop.lootDepth--; }
      if (exp) for (const a of party.members()) a.changeExp(a.currentExp + Math.floor(exp * a.exr));
      G.state.system.winCount++;
      if (battle.event) this.defeated.set(battle.event, G.time);
    } else if (battle.result === 2 && !battle.canLose) {
      this.onPartyDead();
    } else if (battle.result === 1) {
      G.state.system.escapeCount++;
      for (const e of battle.enemies) if (e.alive) { e.state = 'dying'; e.timer = 0; e.fadeOnly = true; }
    }
    if (battle.symbol) {
      const s = battle.symbol;
      if (s.enemy && !s.enemy.battle) s.enemy.remove();      // (a body that stood by - there should be none)
      s.enemy = null;
      s.fx = s.homeX; s.fy = s.homeY;
    }
    // the states its events gave the party for this fight (and the rest of the chain they went round to) go with it
    for (const [a, id] of battle.eventStates || []) {
      const chain = new Set([id]);
      for (const s of chain) for (const n of this.stateExpired(a, s)) chain.add(n);
      for (const s of chain) if ($data.states[s]?.remove_at_battle_end && a.isState(s)) {
        a.removeState(s);
        if (G.state.system.stateTimers) delete G.state.system.stateTimers[s];
      }
    }
    // (the last fight over: what my own skills gave me for the fighting goes - fightState)
    if (this.fightStates && !this.inCombat) {
      const a = G.state.party.leader();
      for (const s of this.fightStates) if (a?.isState(s)) a.removeState(s);
      this.fightStates = null;
    }
    this.battleMusicEnd(battle.result);
    G.arena?.battleEnded(battle);
    G.theater?.battleEnded(battle);
    G.coop?.onBossFightEnd?.(battle);           // (co-op: those watching it fallen are up again)
  }
  // enemy conditions for conditional branch type 5
  // the battle a troop event belongs to (several fights can run at once)
  battleOf(interp) {
    const root = interp ? (interp.root || interp) : null;
    return (root && this.battles.find(x => x.troopInterp === root)) || this.battles.find(x => !x.done);
  }
  enemyCondition(index, sub, stateId, interp) {
    const b = this.battleOf(interp);
    const e = b?.enemies.find(x => x.memberIndex === index);
    if (!e) return false;
    return sub === 0 ? !e.hidden && e.alive : e.b.isState(stateId);
  }
  troopCommand(code, p, interp) {
    const b = this.battleOf(interp);
    if (!b) return;
    // (Force Action names its battler as a kind and an index - 0 an enemy, 1 a party member, not here; the rest
    // name the enemy first, -1 for all of them)
    if (code === 339 && p[0] !== 0) return;
    const at = code === 339 ? p[1] : p[0];
    const targets = at < 0 ? b.enemies : b.enemies.filter(e => e.memberIndex === at);
    for (const e of targets) {
      if (code === 331) {
        if (!e.alive) continue;                    // VX Ace skips the dead
        // (a boss made stronger for a co-op fight: as many times more - the same share of it as alone, as the
        // original's phases mean it: 트위들 쌍둥이 come back with what 90000 leaves of them)
        const v = Math.round((p[1] === 0 ? 1 : -1) * (p[2] === 0 ? p[3] : G.state.v(p[3])) * (e.b.coopK || 1));
        e.b.hp = Math.max(p[4] ? 0 : 1, Math.min(e.b.mhp, e.b.hp + v)); e.drawBar(); this.checkEnemyDeath(e);
      }
      if (code === 333) {
        if (p[1] === 0 && e.hidden) continue;      // (as VX Ace's add_state: one still hidden takes none - not even death)
        if (p[1] === 0) {
          const st = $data.states[p[2]];
          // as VX Ace's add_state: death fells it there and then (unless it resists it - 불사신), and a state that
          // wears off by itself does so here too (a boss's "do nothing" turn as a phase begins, a stance that goes
          // round); one that never wears off stays until an event takes it away
          if (p[2] === 1) { if (e.alive && !e.b.stateResist(1)) { e.b.hp = 0; this.killEnemy(e); } }
          else if (st?.auto_removal_timing) this.addEnemyState(e, p[2], true);
          else { e.b.addState(p[2]); this.markBreakOpen(e, p[2]); }
        } else {
          e.b.removeState(p[2]); if (e.stateTimers) delete e.stateTimers[p[2]]; if (e.actionStates) delete e.actionStates[p[2]];
          // (its Break taken away - the lion's roar as it is broken: it is up again at once)
          if ((p[2] === 7 || p[2] === 8) && e.state === 'stagger') this.endStagger(e);
        }
        this.checkEnemyDeath(e);
      }
      if (code === 334) {
        // Recover All also brings back an enemy that has just fallen: a boss phase is often "lose the
        // immortality, fall, transform, recover" in one event, all in the same moment
        const down = e.state === 'dying' || e.state === 'dead';
        e.b.recoverAll(); this.pruneStateTimers(e);
        if (down) this.reviveEnemy(e);
        e.drawBar();
      }
      if (code === 339) { const s = $data.skills[p[2]]; if (s && e.alive) { e.forcedSkill = s; e.cooldown = 0; e.alertTime = 0; } }
      if (code === 337 && p[1] > 0 && e.alive && !e.hidden) {
        const wp = e.worldPos(new THREE.Vector3());
        // (a timing that hides its target - グラン形態変化 - hides the enemy that long: Sprite_Base's flash(nil))
        G.screen.playAnimationOn(new THREE.Vector3(wp.x, wp.y + (e.hover || 0) + (e.h || 1.6) * 0.5, wp.z), p[1], { height: e.h || 1.6,
          onHide: frames => { e.hideUntil = G.time + frames / 60; } });
        G.theater?.animated(e);
      }
      if (code === 335 && e.hidden) { e.hidden = false; G.theater?.onAppear(e); }
      if (code === 336) { this.transformEnemy(e, p[1]); if (interp?.troop) this.dropPendingForms(b, e.memberIndex, interp); }
    }
    if (code === 340) b.finish(1);
    if (code === 335 || code === 336) this.refreshBosses(b);
  }
  // A troop page changing an enemy's form: the 擬態 pages that would change it again a moment later stand down - pages waiting
  // on a switch alone, at any moment (span 2), that change the same enemy, their switch turned on by a skill of the form it was
  // (흑기사 린다메아's 뛰어넘기 into the sky, 노아의 묵시록 back down): their switches go off. In the original such a page runs
  // right after the skill; here the troop's pages take turns, and her duel (page 7, her last form) could come in between - then
  // the 擬態 page turned her back into the form before it, and she leapt and dived all through the duel
  dropPendingForms(b, member, interp) {
    for (const p of b.troop?.pages || []) {
      const c = p.condition;
      if (p.list === interp.list || p.span !== 2 || !c.switch_valid || c.turn_valid || c.enemy_valid || c.actor_valid || c.turn_ending) continue;
      if (!p.list.some(x => x.code === 336 && x.parameters[0] === member)) continue;
      if (G.state.sw(c.switch_id)) G.state.setSw(c.switch_id, false);
    }
  }
  // Enemy Transform: the new form's picture, and its own moves - none of the old form's left half done
  transformEnemy(e, enemyId) {
    this.dropMarker(e); this.hideBlade(e);
    if (e.state === 'windup' || e.state === 'act') { e.state = 'recover'; e.timer = 0.5; }
    // (a form with no picture of its own taken on from one with a picture: gone from the original's screen - up into the sky
    // here, as the form it was (bossmoves.js skyHold). How high it is stays: up from a leap, down from the sky)
    const was = e.lookAs || e.b.enemyId, wasSky = !!e.sky;
    e.sky = !$data.enemies[enemyId]?.battler_name && !!$data.enemies[was]?.battler_name;
    e.lookAs = e.sky ? was : 0;
    // (back from the sky while still high up: it comes down on the player with its next blow - bossmoves.js skyDive)
    e.diving = wasSky && !e.sky && (e.lift || 0) > 3;
    if (e.diving) e.divingAt = G.time;
    if (e.pair) this.unpairMount(e.pair);
    e.move = null; e.act = null; e.plan = null; e.pending = null; e.comboStep = 0;
    e.boss = false; e.lungeSkill = e.volleySkill = undefined; e.cool = {};
    e.b.enemyId = enemyId;
    e.stationary = holdsPlace(enemyId);             // (a form that holds its place, or one that no longer does - common.js HOLDS_PLACE)
    e.remove(); e.group = new THREE.Group(); this.root.add(e.group); e.ready = e.build();
    G.theater?.onTransform(e);
  }
  // A boss fight's big ones - those standing (not still hidden, not out of reach) whose HP is near the biggest's, at
  // most three - use some of their skills as moves of their own (bossFamily). Counted as the fight starts and again
  // as hidden members come out or one changes into something else (a boss's next phase)
  refreshBosses(b) {
    if (!b?.bossFight) return;
    const on = b.enemies.filter(e => e.alive && !e.hidden && !e.untargetable);
    if (!on.length) return;
    const top = Math.max(...on.map(e => e.b.solo().mhp));               // (a co-op boss: as it would be alone)
    const strong = on.filter(e => e.b.solo().mhp >= top * 0.75);
    const list = G.theater?.bossesOf?.(b, on) ?? (strong.length <= 3 ? strong : []);
    for (const e of list) {
      if (e.boss) continue;
      e.boss = true; e.nextMove = G.time + 2 + Math.random() * 2;
      this.bossFallback(e);
    }
    if (!b.private) G.coop?.scaleBosses?.(b);      // (one that came out in a co-op fight: as strong as the rest at once)
  }
}
