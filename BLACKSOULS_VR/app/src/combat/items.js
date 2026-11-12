// Using things in a fight: items (their scope, their effects), the quick slots (hold X / Q) and skills from the menu.
import * as THREE from 'three';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { entryData, quickSlots } from '../quickslots.js';
import { evalFormula } from '../rubyexpr.js';
import { stripEscapes } from '../ui.js';
import { COOL_TURN, FULL_TURN_COOL, STAGE_TURNS, TURN_SECONDS } from './common.js';
import { builtinRules } from '../maphints.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class ItemPart {
  // ---- items ---------------------------------------------------------------------------
  useItem(item, from) {
    if (!item || this.spectating) return false;
    if (this.restrained && from !== 'quick') { this.restrainedBuzz(); return false; }
    if (this.staggered() && from === 'menu') { G.audio?.playSystemSe(3); return false; }      // (staggered - PvP)
    if (from === 'menu' && this.inCombat && G.state.party.leader()?.itemSealed()) {
      G.ui.toast(`${stripEscapes(item.name)}: ${tr('봉인되어 있습니다')}`, item.icon_index); G.audio?.playSystemSe(3);
      return false;
    }
    // VR: a herb bottle / syringe picked in the menu goes into the hand, like from a quick slot
    const how = from === 'menu' && this.handUse(item);
    if (how) { G.ui.closeMenu(); return this.holdConsumable(item, how); }
    const used = this.applyUsableToActor(item, from);
    if (used && item.consumable) G.state.party.gainItem('item', item.id, -1);
    if (used) G.audio?.playSystemSe(22);
    return used;
  }
  // effects of an item / skill on the player (the whole "party" here)
  applyUsableToActor(obj, from) {
    const actor = G.state.party.leader();
    if (!actor) return false;
    // <スキル無効:n> (script 196): a skill of the player's own that a state on them erases (그랑・기뇰's 사자와 유니콘:
    // no buffs) - used, and nothing comes of it
    if (obj.__class === 'RPG::Skill' && actor.skillCanceled(obj.id)) return false;
    let used = false;
    const type = obj.damage?.type || 0;
    const pha = obj.__class === 'RPG::Item' ? actor.pha : 1;     // 약의 지식: items heal more (rings, oaths)
    if (type === 3 || type === 4) {
      const v = Math.max(0, Math.floor(evalFormula(obj.damage.formula, actor, actor) * actor.rec));
      if (type === 3) this.healPlayerHp(actor, v);
      else this.healPlayerMp(actor, v);
      used = true;
    }
    // (script 169's stealth: <ステルス:n> on what is used - the map's monsters do not notice the player for n steps)
    const stealth = /ステルス:(\d+)/i.exec(obj.note || '');
    if (stealth && +stealth[1] > 0) { G.state.system.stealthSteps = +stealth[1]; used = true; }
    if (this.applyBuffEffects(actor, obj, TURN_SECONDS)) used = true;
    for (const ef of obj.effects || []) {
      switch (ef.code) {
        case 11: { const v = Math.floor((actor.mhp * ef.value1 + ef.value2) * actor.rec * pha); if (v > 0) this.healPlayerHp(actor, v); else if (v < 0) { actor.hp = Math.max(0, actor.hp + v); this.popupAtPlayer(String(v), '#ffb0b0'); } used = true; break; }
        case 12: { const v = Math.floor((actor.mmp * ef.value1 + ef.value2) * actor.rec * pha); if (v > 0) this.healPlayerMp(actor, v); else if (v < 0) actor.mp = Math.max(0, actor.mp + v); used = true; break; }
        case 13: actor.tp = Math.min(100, actor.tp + ef.value1); used = true; break;
        case 21: if (ef.data_id > 0 && Math.random() < ef.value1) { actor.addState(ef.data_id); this.timeActorState(ef.data_id); this.fightState(ef.data_id); } used = true; break;
        case 22: actor.removeState(ef.data_id); used = true; break;
        case 42: actor.addParam(ef.data_id, ef.value1); used = true; break;
        case 43: {
          const sk = $data.skills[ef.data_id];
          if (sk && !actor.skills.includes(sk.id)) { actor.learnSkill(sk.id); G.ui.toast(tr('{name} 습득', { name: stripEscapes(sk.name) }), sk.icon_index); }
          used = true; break;
        }
        case 44: G.map.reserveCommonEvent(ef.data_id); used = true; if (from === 'menu') G.ui.closeMenu(); break;
        default: break;
      }
    }
    if (actor.hp <= 0) this.playerFalls(null);
    return used;
  }
  // a heal on the player, after the recovery rules on them (script 172 - 허약, 천수 영역: nothing, or as much damage)
  healPlayerHp(actor, v) {
    const r = actor.healAmount(v, 0);
    if (r > 0) { actor.hp = Math.min(actor.mhp, actor.hp + r); this.popupAtPlayer(`+${r}`, '#60ff80'); }
    else if (r < 0) { actor.hp = Math.max(0, actor.hp + r); this.slipHurt(-r); }
    else { this.popupAtPlayer('0', '#9a9a9a'); G.audio?.playSystemSe(3); }
    return r;
  }
  healPlayerMp(actor, v) {
    const r = actor.healAmount(v, 1);
    if (r > 0) { actor.mp = Math.min(actor.mmp, actor.mp + r); this.popupAtPlayer(`MP +${r}`, '#80b0ff'); }
    else if (r < 0) actor.mp = Math.max(0, actor.mp + r);
    else this.popupAtPlayer('MP 0', '#9a9a9a');
    return r;
  }
  // VX Ace's buff effects of an item / skill on a battler: 31 a buff, 32 a debuff (by its debuff rate - times chance,
  // as the player's states are), 33 / 34 a buff / a debuff taken away; turn: the seconds a turn lasts for it. Whether
  // the item / skill had any
  applyBuffEffects(b, obj, turn, chance = 1) {
    let any = false;
    for (const ef of obj?.effects || []) {
      if (ef.code === 31) { b.addBuff(ef.data_id, ef.value1 * turn); any = true; }
      else if (ef.code === 32) { if (Math.random() < b.debuffRate(ef.data_id) * chance) b.addDebuff(ef.data_id, ef.value1 * turn); any = true; }
      else if (ef.code === 33) { if (b.buffs[ef.data_id] > 0) b.removeBuff(ef.data_id); any = true; }
      else if (ef.code === 34) { if (b.buffs[ef.data_id] < 0) b.removeBuff(ef.data_id); any = true; }
    }
    return any;
  }
  // the player at 0 HP falls (the fight lost) - unless a state keeps them up (진혼가, 불사신: the death state resisted -
  // they stay at 0 HP until it ends), or something brings them back at once in a fight (自動蘇生, script 171)
  playerFalls(killer) {
    const actor = G.state.party.leader();
    if (!actor || this.playerDead || actor.hp > 0 || this.spectating) return;
    if (actor.stateResist(1)) {
      if (!this.deathlessAt || G.time - this.deathlessAt > 2) {
        this.deathlessAt = G.time;
        G.audio?.playSe(G.seAt('Saint3', 60, 130));
        G.input.haptic('left', 0.6, 90); G.input.haptic('right', 0.6, 90);
      }
      return;
    }
    if (this.inCombat && this.autoRevivePlayer(actor)) return;
    if (G.coop?.phantom) { G.coop.phantomFell(); return; }      // (a guest falling in another's world: by the rules - coop.js)
    if (G.coop?.worldFalls?.()) return;                           // (the developer's world: in another's boss fight, by the rules)
    if (G.coop?.hostFalls?.()) return;                            // (a co-op host fallen in a boss fight: watching it)
    this.onPlayerDeath(killer);
  }
  autoRevivePlayer(actor) {
    const r = actor.autoRevive();
    if (!r) return false;
    // (as VX Ace: fallen - the states and buffs go with it - and up again with that HP)
    actor.die(); actor.removeState(1);
    actor.hp = Math.min(actor.mhp, r.hp);
    const timers = G.state.system.stateTimers;
    if (timers) for (const k of Object.keys(timers)) if (!actor.isState(+k)) delete timers[k];
    if (r.anim) G.screen.playAnimationOn(G.map.playerChar, r.anim);
    G.audio?.playSystemSe(16);
    this.popupAtPlayer(`+${actor.hp}`, '#60ff80');
    if (r.breakRate > Math.random() * 100) this.breakSaver(actor, r.source);
    return true;
  }
  // what brought a battler back may break: equipment is lost (with the original's crash), a state goes
  breakSaver(b, o) {
    if (o.__class === 'RPG::Weapon' || o.__class === 'RPG::Armor') {
      const kind = o.__class === 'RPG::Weapon' ? 'weapon' : 'armor';
      const slot = (b.equips || []).find(s => s.kind === kind && s.id === o.id);
      if (!slot) return;
      slot.id = 0;
      b.clampHpMp();
      G.audio?.playSe(G.seAt('Crash', 80, 100));
      if (b === G.state.party.leader()) G.ui.toast(tr('{name} 파손', { name: stripEscapes(o.name) }), o.icon_index, '#ff9a9a');
    } else if (o.__class === 'RPG::State' && b.isState(o.id)) b.removeState(o.id);
  }

  // ---- quick slots (hold X / Q) and skills ---------------------------------------------------
  updateQuick(paused) {
    const input = G.input, ring = this.quick;
    const blocked = paused || this.playerDead || this.spectating || !!this.gripAdjust || G.ui.menuOpen || !!G.ui.msg || !!G.ui.sceneOpen
      || !!G.emotes?.ring.isOpen;                     // (the emote ring up: one ring at a time - src/emotes.js)
    if (ring.isOpen) {
      if (blocked) { ring.close(); return; }
      ring.update();
      if (!input.quickHeld()) {                       // released: use whatever is under the hand
        const sel = ring.sel;
        ring.close();
        const entry = sel >= 0 ? quickSlots()[sel] : null;
        if (entry) { this.stopMacro(); this.useQuickEntry(entry); }
      }
      return;
    }
    if (blocked) return;
    if (input.quickPressed()) {
      // (a macro running: stopped - and what it put in the hand put away)
      const running = !!this.macroRun;
      this.stopMacro();
      if (this.ready) { this.cancelReady(true); return; }
      if (this.held) { this.cancelHeld(true); return; }
      if (this.skillArm) { this.skillArm = null; G.audio?.playSystemSe(2); return; }
      if (running) { G.audio?.playSystemSe(2); return; }
      quickSlots(); ring.open(); return;
    }
    const n = input.digitPressed();                    // PC: 1-8 use a slot directly
    if (n) { const entry = quickSlots()[n - 1]; if (entry) { this.stopMacro(); this.useQuickEntry(entry); } }
  }
  coolSeconds(obj) {
    const m = /<クールタイム:(\d+)>/.exec(obj?.note || '');
    // (FULL_TURN_COOL, STAGE_TURNS: BLACK SOULS II's skills, by number - not with the launcher's switch for its rules off)
    return m ? +m[1] * (FULL_TURN_COOL.has(obj.id) && builtinRules() ? TURN_SECONDS : COOL_TURN) : 0;
  }
  // a stage of a skill that grows a stage a turn (STAGE_TURNS): the next stage no sooner than a turn on - its cool-down
  // on the first stage's id (the quick slot's, which the stages are used through)
  stageCool(s) {
    if (!this._stageRoot) {
      this._stageRoot = new Map();
      for (const id of builtinRules() ? STAGE_TURNS : []) {
        if (!$data.skills[id]) continue;
        this._stageRoot.set(id, id);
        for (const m of ($data.skills[id].note || '').matchAll(/<ステート変化:(\d+),(\d+)>/g)) this._stageRoot.set(+m[1], id);
      }
    }
    const root = this._stageRoot.get(s?.id);
    if (root) this.skillCD[root] = Math.max(this.skillCD[root] || 0, G.time + TURN_SECONDS);
  }
  skillCooling(skill) { return Math.max(0, (this.skillCD[skill.id] || 0) - G.time); }
  isBreakSkill(obj) {
    return /브레이크|ブレイク|破防|\bbreak/i.test(obj.name || '') && (obj.effects || []).some(e => e.code === 21 && (e.data_id === 7 || e.data_id === 8));
  }
  useQuickEntry(entry) {
    if (entry?.kind === 'macro') return this.runMacro(entry.id);         // (its steps one after another - combat/macros.js)
    let obj = entryData(entry);
    const actor = G.state.party.leader();
    if (!obj || !actor || this.playerDead) return false;
    const name = stripEscapes(obj.name);
    const fail = msg => { G.ui.toast(`${name}: ${msg}`, obj.icon_index); G.audio?.playSystemSe(3); return false; };
    if (this.restrained) { this.restrainedBuzz(); return false; }
    if (this.staggered()) { G.audio?.playSystemSe(3); return false; }            // (staggered - PvP: nothing for a moment)
    if (this.healing) return fail(tr('다른 아이템을 쓰는 중'));
    if (obj.occasion === 3) return fail(tr('사용할 수 없습니다'));
    if (obj.occasion === 2 && this.inCombat) return fail(tr('전투 중에는 쓸 수 없습니다'));
    if (entry.kind === 'item') {
      if (this.inCombat && actor.itemSealed()) return fail(tr('봉인되어 있습니다'));
      if (G.state.party.itemCount('item', obj.id) <= 0) return fail(tr('남은 것이 없습니다'));
    } else {
      if (!actor.allSkills().some(s => s.id === obj.id)) return fail(tr('지금은 쓸 수 없는 스킬입니다'));
      if (actor.skillSealed(obj.id) || !actor.skillTypeUsable(obj)) return fail(tr('봉인되어 있습니다'));
      if (!actor.skillCostPayable(obj)) return fail(this.costShort(actor, obj));
      const cd = this.skillCooling(obj);
      if (cd > 0) return fail(tr('재사용 대기 {s}초', { s: cd.toFixed(1) }));
      // (one a state of mine turns into another - script 195: that one is what is used, and it has to be ready)
      obj = this.skillByState(actor, obj);
      const cd2 = this.skillCooling(obj);
      if (cd2 > 0) return fail(tr('재사용 대기 {s}초', { s: cd2.toFixed(1) }));
      if (!actor.skillCostPayable(obj)) return fail(this.costShort(actor, obj));
      // the original battle commands that already have their own button here (BLACK SOULS II's 회피, skill 12 - with the
      // launcher's switch for its rules off, skill 12 is used as any skill)
      if (obj.id === 12 && builtinRules()) {
        if (G.player.dodge.cooldown > 0 || this.stamina <= 0.05) return fail(tr('잠시 후에 다시'));
        G.player.wantDodge = true; return true;
      }
      // a weapon's own move takes the weapons up again (무장해제 ends)
      if (this.disarmed && (this.isBreakSkill(obj) || this.isWeaponArt(obj))) this.toggleDisarm(false);
      if (this.isBreakSkill(obj)) {
        if (/건 ?브레이크|ガン ?ブレイク|枪械?破防|\bgun ?break/i.test(obj.name || '')) { if ((this.breakCooldown || 0) <= G.time) this.fireGunBreak(obj); return true; }
        this.breakArm = { skill: obj, until: G.time + 3 };          // the next swing that lands within 3 s
        G.input.haptic('right', 0.3, 40);
        return true;
      }
      // a physical blow on one enemy (일섬, 참수, 삼단 베기...): it goes onto the weapon, which glows red, and
      // comes out with the next blow that lands - MP and cool-down are paid then. X puts it away
      if (this.isWeaponArt(obj)) { this.armSkill(obj); return true; }
    }
    return this.performUsable(obj, entry.kind);
  }
  // HP damage on one enemy that is not a spell: RPG Maker's 물리 공격 (일섬, 참수...), or 필중 (sure hit) when it
  // hits by attack power / defence (혈도 찌르기, 거합베기, 월광도, 다리 쏘기, 피의 시련...) or comes with a weapon
  // (혼 베기). Sure-hit spells by magic power (관통빙주, 독사의 포옹) and fixed-damage books stay in the hand
  isWeaponArt(s) {
    if (!s || !(s.scope === 1 || s.scope === 3) || !(s.damage?.type === 1 || s.damage?.type === 5)) return false;
    if (s.hit_type === 1) return true;
    if (s.hit_type !== 0) return false;
    if (/\ba\.atk\b|\bb\.def\b/.test(s.damage.formula || '')) return true;
    if (!this._weaponSkillIds) {
      this._weaponSkillIds = new Set();
      for (const w of $data.weapons || []) for (const f of w?.features || []) if (f.code === 43) this._weaponSkillIds.add(f.data_id);
    }
    return this._weaponSkillIds.has(s.id);
  }
  armSkill(s) {
    this.cancelReady();
    this.cancelHeld();
    this.skillArm = { skill: s };
    this.weaponFx.burst(this.weaponSeg(), 'armed');
    G.audio?.playSe(G.seAt('Powerup', 70, 125));
    G.input.haptic('right', 0.5, 80);
  }
  // the blow that lands with a weapon art on: that skill, paid for now (with too little MP left by then: a
  // plain blow, and the art is gone)
  takeArmedSkill(actor) {
    const s = this.skillArm?.skill;
    if (!s || !actor) return null;
    this.skillArm = null;
    if (!actor.skillCostPayable(s) || actor.skillSealed(s.id)) {
      G.ui.toast(`${stripEscapes(s.name)}: ${this.costShort(actor, s)}`, s.icon_index);
      G.audio?.playSystemSe(3);
      return null;
    }
    this.actorPays(actor, s);
    this.skillCD[s.id] = G.time + this.coolSeconds(s);
    this.actorUserEffect(s);
    return s;
  }
  // skills used from the menu (heals, buffs, common events)
  useSkillFromMenu(skill) {
    const actor = G.state.party.leader();
    if (!actor || !skill || this.spectating) return false;
    if (this.restrained) { this.restrainedBuzz(); return false; }
    skill = this.skillByState(actor, skill);
    const ok = actor.skillCostPayable(skill) && !actor.skillSealed(skill.id) && actor.skillTypeUsable(skill) && this.skillCooling(skill) <= 0;
    if (!ok || (skill.scope >= 1 && skill.scope <= 6) || skill.occasion === 1 || skill.occasion === 3) { G.audio?.playSystemSe(3); return false; }
    this.actorPays(actor, skill);
    this.skillCD[skill.id] = G.time + this.coolSeconds(skill);
    this.stageCool(skill);
    const used = this.applyUsableToActor(skill, 'menu');
    G.screen.playAnimationOn(G.map.playerChar, skill.animation_id);
    this.actorUserEffect(skill);
    return used;
  }
  isDrink(obj) {
    const t = obj.damage?.type || 0;
    return t === 3 || t === 4 || (obj.effects || []).some(e => e.code === 11 || e.code === 12);
  }
  payUsable(obj, kind) {
    if (kind === 'item') { if (obj.consumable) G.state.party.gainItem('item', obj.id, -1); }
    else {
      this.actorPays(G.state.party.leader(), obj);
      this.skillCD[obj.id] = G.time + this.coolSeconds(obj);
      this.stageCool(obj);
      this.actorUserEffect(obj);
    }
  }
  // a skill of mine paid for: MP, TP and the HP it costs (script 128 - shown as it goes, like a blow taken)
  actorPays(actor, s) {
    if (!actor || !s) return;
    const hp = actor.skillHpCost(s);
    actor.paySkillCost(s);
    if (hp > 0) this.popupAtPlayer(`-${hp}`, '#ff9a9a');
  }
  // which of a skill's costs I cannot pay
  costShort(actor, s) {
    return actor.mp >= actor.skillMpCost(s) && actor.tp >= (s.tp_cost || 0) ? tr('HP가 부족합니다') : tr('MP가 부족합니다');
  }
  // a skill of mine with <使用者効果 n> (script 113): skill n's effects on me as well, once the skill has done its
  // work (the next cut's mark of 삼단 베기, a bullet loaded, a guard)
  actorUserEffect(s) {
    const self = this.userEffectSkill(s);
    if (self) this.later(60, () => { if (!this.playerDead) this.applyUsableToActor(self, 'self'); });
  }
  performUsable(obj, kind) {
    const scope = obj.scope || 0;
    const name = stripEscapes(obj.name);
    // things aimed at enemies go into the right hand first; the attack button lets them go
    if (scope >= 1 && scope <= 6 && !this.directUse) return this.readyUsable(obj, kind);
    if (scope >= 1 && scope <= 6) {
      const targets = this.pickTargets(obj, kind);
      if (!targets.length) { G.ui.toast(tr('{name}: 대상이 없습니다', { name }), obj.icon_index); G.audio?.playSystemSe(3); return false; }
      this.payUsable(obj, kind);
      const from = this.castOrigin();
      // thrown items and magic fly to the target; physical / sure-hit skills land at once
      const flies = kind === 'item' || obj.hit_type === 2;
      targets.forEach((e, i) => {
        if (flies) this.later(i * 140, () => { if (e.alive) this.launchUsable(obj, kind, from, e); });
        else {
          this.applyUsableToEnemy(e, obj, from);
          const wp = e.worldPos(new THREE.Vector3()); wp.y += e.h * 0.5;
          if (obj.animation_id > 0) G.screen.playAnimationOn(wp, obj.animation_id, { rate: 3, height: e.h });
          else G.audio?.playSe(G.seAt('Slash1', 90, 100), wp);
        }
      });
      if (kind === 'item') G.audio?.playSe(G.seAt('Wind7', 70, 120));
      else this.playerFollowUp(obj, targets[0], from);
      G.input.haptic('left', 0.5, 60);
      return true;
    }
    // the player (and the party, which is just the player here)
    const how = kind === 'item' && this.handUse(obj);
    if (how) return this.holdConsumable(obj, how);
    if (kind === 'item' && this.isDrink(obj)) {
      this.healing = { id: obj.id, t: 0.9 };        // drinking takes a moment
      G.audio?.playSystemSe(22);
      return true;
    }
    if (kind === 'skill') { this.payUsable(obj, kind); this.playerFollowUp(obj, null, null); }
    const used = this.applyUsableToActor(obj, 'quick');
    if (kind === 'item' && used && obj.consumable) G.state.party.gainItem('item', obj.id, -1);
    if (obj.animation_id > 0) G.screen.playAnimationOn(G.map.playerChar, obj.animation_id, { rate: 3 });
    else if (used) G.audio?.playSystemSe(22);
    if (!used) G.ui.toast(tr('{name}: 효과가 없었다', { name }), obj.icon_index);
    return used;
  }
}
