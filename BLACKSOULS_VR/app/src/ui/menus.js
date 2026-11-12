// The UI's menus: the menu as the original's (items, skills, equipment, status, the oath), this version's own settings
// (combat and display, the map in the corner, the spectator view), quick slots.
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { MINIMAP_ZOOMS, minimapPlace } from '../minimap.js';
import { assignQuickSlot, entryStatus, quickSlotOf, quickSlots } from '../quickslots.js';
import { itemData, spiritActorId } from '../state.js';
import { DEFAULT_SKY } from '../sky.js';
import { stripEscapes } from '../uitext.js';
import { SETTING_IDS, SKY_COLORS, minimapWhere, skyColorName } from './common.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class MenuPart {
  // ---------------------------------------------------------------- menus
  openMenu() {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.menuIndex = 0;
    this.placeRoot(true);
    this.showMainMenu();
  }
  closeMenu() {
    this.menuOpen = false;
    if (G.minimap) G.minimap.preview = false;
    this.menuScreen.close();
    this.list.close();
    this.grid.close();
    this.consumedConfirm = true;
  }
  // the menu, as the original's (MenuScreen): its commands - 아이템 스킬 장비 스테이터스 (the database's words), 서약 (its
  // script's), 저장 and GAME END - then this version's own: VR saves loaded, co-op and its settings
  showMainMenu() {
    const C = $data.system.terms?.commands || [];
    const items = [
      { text: C[4] || tr('아이템'), id: 'items' },
      { text: C[5] || tr('스킬'), id: 'skills' },
      { text: C[6] || tr('장비'), id: 'equip' },
      { text: C[7] || tr('상태 보기'), id: 'status' },
      { text: G.scripts?.partnerCommand || tr('서약'), id: 'oath', enabled: G.state.party.spirits.length > 0 },
      // (not while an event holds the map for its fight: a save then would come back without the event's own progress)
      { text: C[9] || tr('VR 세이브'), id: 'save', enabled: !G.state.system.saveDisabled && !G.map?.interpreter?.running() },
      { text: C[10] || tr('타이틀로'), id: 'end' },
      { gap: true },
      { text: tr('VR 로드'), id: 'load' },
      { text: tr('협력'), id: 'coop' },
      { text: tr('매크로'), id: 'macros' },
      { text: tr('설정'), id: 'settings' },
    ];
    this.list.close();
    this.grid.close();
    const at = Math.max(0, items.findIndex(it => it.id === this.menuId));
    this.menuScreen.open(items, {
      onSelect: (i, it) => { this.menuId = it.id; this.onMenu(it.id); },
      onCancel: () => this.closeMenu(),
      index: at,
    });
    this.menuScreen.panel.mesh.position.set(0, 0, 0);
  }
  reopenMain(id) {
    if (SETTING_IDS.includes(id)) { this.showSettingsMenu(id); return; }
    this.menuId = id;
    this.showMainMenu();
  }
  // this version's own settings (the original's menu has none): the map in the corner, turning, the enemies' strength,
  // combat and display, the hold of weapons and shields, the PC monitor's view
  showSettingsMenu(id) {
    const s = G.settings;
    const items = [
      { text: tr('지도'), id: 'minimap', right: s.minimap !== false ? tr('켬') : tr('끔'), desc: minimapWhere() },
      { text: tr('회전 방식: {v}', { v: s.snapTurn ? tr('스냅 {a}°', { a: s.snapAngle }) : tr('부드럽게') }), id: 'turn' },
      { text: tr('난이도(적 공격력): ×{v}', { v: s.difficulty.toFixed(2) }), id: 'diff' },
      { text: tr('전투·화면 설정'), id: 'options' },
      { text: tr('무기·방패 모양 조정'), id: 'adjust' },
      { text: tr('PC 모니터 관전 화면 설정'), id: 'spectator' },
    ];
    this.list.open(tr('설정'), items, {
      index: Math.max(0, items.findIndex(it => it.id === id)),
      onSelect: (i, it) => this.onMenu(it.id),
      onCancel: () => this.reopenMain('settings'),
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  onMenu(id) {
    const s = G.settings;
    this.menuScreen.close();            // (one of its commands opens over it - or is asked for straight)
    switch (id) {
      case 'items': this.showItems(); break;
      case 'skills': this.showSkills(); break;
      case 'equip': this.showEquipSlots(); break;
      case 'oath': this.showOath(); break;
      case 'status': this.showStatus(); break;
      case 'save': G.openSaveMenu?.(); break;
      case 'end': this.showGameEnd(); break;
      case 'load': G.openLoadMenu?.(); break;
      case 'coop': this.showCoopMenu(); break;
      case 'macros': this.showMacros(); break;
      case 'settings': this.showSettingsMenu(); break;
      case 'minimap': this.showMinimapMenu(); break;
      case 'adjust': this.adjTarget = 'weapon'; this.showAdjust(); break;
      case 'turn':
        if (s.snapTurn && s.snapAngle === 30) s.snapAngle = 45;
        else if (s.snapTurn) s.snapTurn = false;
        else { s.snapTurn = true; s.snapAngle = 30; }
        G.saveSettings?.(); this.reopenMain('turn'); break;
      case 'spectator': this.showSpectatorMenu(); break;
      case 'options': this.showOptionsMenu(); break;
      case 'diff':
        s.difficulty = s.difficulty >= 1.5 ? 0.5 : +(s.difficulty + 0.25).toFixed(2);
        G.saveSettings?.(); this.reopenMain('diff'); break;
      default: break;
    }
  }
  // 지도: the map in the corner (minimap.js) - on or off, how big, how much of the map, where; shown over this menu while
  // it is set
  showMinimapMenu(index = 0) {
    const s = G.settings, p = minimapPlace();
    const SIZES = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const set = (k, v) => { s.minimapPlace = { ...p, [k]: v }; G.saveSettings?.(); };
    const step = (id, dx) => {
      if (id === 'on') { s.minimap = s.minimap === false; G.saveSettings?.(); }
      else if (id === 'size') {
        const i = SIZES.reduce((best, v, k) => (Math.abs(v - p.size) < Math.abs(SIZES[best] - p.size) ? k : best), 0);
        set('size', SIZES[clamp(i + dx, 0, SIZES.length - 1)]);
      } else if (id === 'zoom') set('zoom', clamp(p.zoom + dx, 0, MINIMAP_ZOOMS.length - 1));
      else if (id === 'x' || id === 'y') set(id, Math.round(clamp(p[id] + dx * 0.1, -1, 1) * 10) / 10);
      else if (id === 'opacity') set('opacity', Math.round(clamp(p.opacity + dx * 0.1, 0.2, 1) * 10) / 10);
      else if (id === 'shape') set('shape', p.shape === 'round' ? 'square' : 'round');
      else if (id === 'rotate') set('rotate', !p.rotate);
      else if (id === 'hand') set('hand', !p.hand);
      else if (id === 'reset') { s.minimapPlace = undefined; G.saveSettings?.(); }
    };
    if (G.minimap) G.minimap.preview = true;
    const pct = v => `${Math.round((v + 1) * 50)}%`;
    const items = [
      { text: tr('지도 표시'), id: 'on', right: s.minimap !== false ? tr('켬') : tr('끔'), desc: minimapWhere() },
      // (VR: over the right hand, or a corner of the view - its place there only then)
      G.vr && { text: tr('위치'), id: 'hand', right: p.hand ? tr('오른손') : tr('시야 구석'), desc: tr('오른손: 오른손 위에 떠 있습니다 · 시야 구석: 늘 시야에 보입니다') },
      { text: tr('모양'), id: 'shape', right: p.shape === 'round' ? tr('원형') : tr('사각'), desc: tr('고르거나 좌우로 바꿉니다') },
      { text: tr('방향'), id: 'rotate', right: p.rotate ? tr('보는 방향이 위') : tr('북쪽이 위'),
        desc: p.rotate ? tr('지도가 보는 방향에 맞춰 돌고, 나는 늘 가운데에 있습니다') : tr('원작 화면처럼: 맵 끝에서는 지도가 멈추고 나만 움직입니다') },
      { text: tr('크기'), id: 'size', right: `${Math.round(p.size * 100)}%`, desc: tr('좌우로 조절합니다') },
      { text: tr('불투명도'), id: 'opacity', right: `${Math.round(p.opacity * 100)}%`, desc: tr('좌우로 조절합니다') },
      { text: tr('보이는 범위'), id: 'zoom', right: tr('{n}칸', { n: MINIMAP_ZOOMS[p.zoom] }), desc: tr('좌우로 조절합니다') },
      ...(G.vr && p.hand ? [] : [
        { text: tr('가로 위치'), id: 'x', right: pct(p.x), desc: tr('0%: 왼쪽 끝, 100%: 오른쪽 끝 (좌우로 조절)') },
        { text: tr('세로 위치'), id: 'y', right: pct(p.y), desc: tr('0%: 아래 끝, 100%: 위 끝 (좌우로 조절)') },
      ]),
      { text: tr('기본값으로'), id: 'reset' },
    ].filter(Boolean);
    this.list.open(tr('지도'), items, {
      index,
      onSelect: (i, it) => { step(it.id, 1); this.showMinimapMenu(i); },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'on' || it.id === 'reset') return false;
        step(it.id, dx);
        this.showMinimapMenu(i);
        return true;
      },
      onCancel: () => { if (G.minimap) G.minimap.preview = false; this.reopenMain('minimap'); },
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  // GAME END (Scene_End): to the title, or back (the database's words - its shutdown has no window here to close)
  showGameEnd() {
    const C = $data.system.terms?.commands || [];
    this.list.open(C[10] || tr('타이틀로'), [
      { text: C[21] || tr('타이틀로'), id: 'title' },
      { text: C[22] || tr('취소'), id: 'back' },
    ], {
      onSelect: (i, it) => { if (it.id === 'title') { this.closeMenu(); this.returnToTitle(); } else this.reopenMain('end'); },
      onCancel: () => this.reopenMain('end'),
    });
    this.list.panel.mesh.position.set(0, 0, 0);
  }
  // an item / skill does something (effects or a damage formula)
  hasEffect(d) { return !!(d.effects?.length || d.damage?.type); }
  // usable from the menu: not battle-only, and aimed at the player (enemies need the field)
  menuUsable(d) { return (d.occasion === 0 || d.occasion === 2) && this.hasEffect(d) && !(d.scope >= 1 && d.scope <= 6); }
  quickable(d) { return d.occasion !== 3 && this.hasEffect(d); }
  itemTabs() {
    const party = G.state.party;
    const usable = d => this.menuUsable(d) || this.quickable(d);
    const list = (kind, filter) => {
      const out = [];
      for (const [id, n] of party.container(kind)) {
        const d = itemData(kind, id);
        if (!d || !d.name || !filter(d)) continue;
        const slot = kind === 'item' ? quickSlotOf({ kind: 'item', id }) : -1;
        out.push({ text: d.name, icon: d.icon_index, right: slot >= 0 ? `[${slot + 1}] ${n}` : `${n}`, kind, id, desc: d.description,
          enabled: kind === 'item' ? !!usable(d) : true });
      }
      return out.sort((a, b) => a.id - b.id);
    };
    return [
      { label: tr('아이템'), items: list('item', d => d.itype_id !== 2) },
      { label: tr('무기'), items: list('weapon', () => true) },
      { label: tr('방어구'), items: list('armor', () => true) },
      { label: tr('중요한 아이템'), items: list('item', d => d.itype_id === 2) },
    ];
  }
  showItems(keepIndex) {
    this.list.close();
    const tabs = this.itemTabs();
    this.grid.open(tr('아이템'), tabs, {
      tab: this.grid.tab || 0,
      index: keepIndex ?? 0,
      onSelect: (it) => {
        if (it.kind !== 'item') { this.toast(tr("{name}: 장비는 '장비' 메뉴에서", { name: it.text })); return; }
        this.showItemActions(it);
      },
      onCancel: () => { this.grid.close(); this.reopenMain('items'); },
    });
  }
  showItemActions(it) {
    const d = $data.items[it.id];
    const back = () => { if (this.menuOpen) this.showItems(this.grid.index); };
    const entry = { kind: 'item', id: d.id };
    const slot = quickSlotOf(entry);
    this.grid.close();
    this.list.open(stripEscapes(d.name), [
      { text: tr('사용'), id: 'use', enabled: this.menuUsable(d), desc: this.menuUsable(d) ? d.description : tr('필드에서 퀵슬롯으로 사용합니다') },
      { text: slot >= 0 ? tr('퀵슬롯 ({n}번에 등록됨)', { n: slot + 1 }) : tr('퀵슬롯에 등록'), id: 'quick', enabled: this.quickable(d), desc: tr('퀵슬롯 버튼(VR: X, PC: Q)을 누른 채 손을 옮기고 떼면 사용') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, a) => {
        if (a.id === 'use') { G.combat?.useItem(d, 'menu'); back(); }
        else if (a.id === 'quick') this.showQuickPicker(entry, back);
        else back();
      },
      onCancel: back,
    });
  }
  // choose (or clear) the quick slot for an item / skill
  showQuickPicker(entry, back) {
    const slots = quickSlots();
    const cur = quickSlotOf(entry);
    const items = slots.map((s, i) => {
      const st = s ? entryStatus(s) : null;
      return { text: `${i + 1}.  ${st ? st.name : tr('(비어 있음)')}`, icon: st?.icon, right: st?.sub || '', slot: i };
    });
    if (cur >= 0) items.push({ text: tr('퀵슬롯에서 빼기'), id: 'remove' });
    this.list.open(tr('퀵슬롯 선택'), items, {
      index: cur >= 0 ? cur : Math.max(0, slots.findIndex(s => !s)),
      footer: tr('고른 칸에 등록합니다 (원래 있던 것은 빠집니다)'),
      onSelect: (i, it) => {
        if (it.id === 'remove') { assignQuickSlot(cur, null); this.toast(tr('퀵슬롯에서 뺐습니다')); }
        else { assignQuickSlot(it.slot, entry); this.toast(tr('퀵슬롯 {n}번에 등록했습니다', { n: it.slot + 1 })); }
        G.audio?.playSystemSe(1);
        back();
      },
      onCancel: back,
    });
  }

  // ---- skills ----
  showSkills(keepIndex) {
    const a = G.state.party.leader();
    if (!a) return;
    this.list.close();
    const items = a.allSkills().map(s => {
      const cost = a.skillMpCost(s), hpCost = a.skillHpCost(s);
      const slot = quickSlotOf({ kind: 'skill', id: s.id });
      const ok = a.skillTypeUsable(s) && !a.skillSealed(s.id);
      return { text: s.name, icon: s.icon_index, id: s.id, desc: s.description, enabled: ok,
        right: `${slot >= 0 ? `[${slot + 1}] ` : ''}${cost ? 'MP' + cost : hpCost ? 'HP' + hpCost : ''}` };
    });
    this.grid.open(tr('스킬'), [{ label: $data.system.skill_types?.[1] || tr('스킬'), items }], {
      tab: 0,
      index: keepIndex ?? 0,
      onSelect: (it) => this.showSkillActions(it),
      onCancel: () => { this.grid.close(); this.reopenMain('skills'); },
    });
  }
  showSkillActions(it) {
    const a = G.state.party.leader();
    const s = $data.skills[it.id];
    const keep = this.grid.index;
    const back = () => { if (this.menuOpen) this.showSkills(keep); };
    const entry = { kind: 'skill', id: s.id };
    const slot = quickSlotOf(entry);
    const canUse = this.menuUsable(s) && a.skillCostPayable(s) && !(G.combat?.skillCooling(s) > 0);
    this.grid.close();
    const cost = a.skillMpCost(s), hpCost = a.skillHpCost(s);
    this.list.open(`${stripEscapes(s.name)}${cost ? `  (MP ${cost})` : hpCost ? `  (HP ${hpCost})` : ''}`, [
      { text: tr('사용'), id: 'use', enabled: canUse, desc: this.menuUsable(s) ? s.description : tr('필드에서 퀵슬롯으로 사용합니다') },
      { text: slot >= 0 ? tr('퀵슬롯 ({n}번에 등록됨)', { n: slot + 1 }) : tr('퀵슬롯에 등록'), id: 'quick', enabled: s.occasion !== 3,
        desc: tr('퀵슬롯 버튼(VR: X, PC: Q)을 누른 채 손을 옮기고 떼면 사용') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, act) => {
        if (act.id === 'use') { G.combat?.useSkillFromMenu(s); back(); }
        else if (act.id === 'quick') this.showQuickPicker(entry, back);
        else back();
      },
      onCancel: back,
    });
  }

  // ---- equipment ----
  slotEtype(slot) { return slot === 0 ? 0 : Math.min(slot, 4); }
  slotName(slot) {
    const terms = $data.system.terms.etypes || [tr('무기|equip'), tr('방패|equip'), tr('머리|equip'), tr('몸|equip'), tr('장신구|equip')];
    return terms[this.slotEtype(slot)] || tr('슬롯 {n}', { n: slot + 1 });
  }
  canEquip(actor, kind, d, slot) {
    if (!d) return false;
    const et = this.slotEtype(slot);
    if (kind === 'weapon') return et === 0 && actor.featuresSet(51).includes(d.wtype_id);
    return et !== 0 && d.etype_id === et && actor.featuresSet(52).includes(d.atype_id);
  }
  paramDelta(actor, slot, kind, id, max = 8) {
    const before = [0, 1, 2, 3, 4, 5, 6, 7].map(i => actor.param(i));
    const saved = actor.equips[slot];
    actor.equips[slot] = { kind, id };
    const after = [0, 1, 2, 3, 4, 5, 6, 7].map(i => actor.param(i));
    actor.equips[slot] = saved;
    const P = $data.system.terms.params;
    const parts = [0, 2, 3, 4, 5, 6, 7].filter(i => after[i] !== before[i])
      .map(i => `${P[i]} ${after[i] > before[i] ? '+' : '−'}${Math.abs(after[i] - before[i])}`);
    return parts.length > max ? parts.slice(0, max).join('  ') + ' …' : parts.join('  ');
  }
  showEquipSlots(index = 0) {
    const a = G.state.party.leader();
    if (!a) return;
    this.grid.close();
    const slots = a.equips.map((e, slot) => {
      const d = itemData(e.kind, e.id);
      return { text: `${this.slotName(slot)}: ${d ? d.name : '—'}`, icon: d?.icon_index, slot, desc: d?.description || '' };
    });
    this.list.open(tr('장비  ({name})', { name: a.name || '' }), slots, {
      index,
      onSelect: (i, it) => this.showEquipChoices(it.slot),
      onCancel: () => this.reopenMain('equip'),
    });
  }
  // what can go into a slot: three a row like the items and skills (how many on the right), and below, the one
  // pointed at - what it changes, then what it is. In the original's order (Window_EquipItem): by number, the empty one -
  // taking it off - last
  showEquipChoices(slot) {
    const a = G.state.party.leader();
    const kind = slot === 0 ? 'weapon' : 'armor';
    const party = G.state.party;
    const cands = [];
    for (const [id, n] of [...party.container(kind)].sort((x, y) => x[0] - y[0])) {
      const d = itemData(kind, id);
      if (!d || !d.name || !this.canEquip(a, kind, d, slot)) continue;
      cands.push({ text: d.name, icon: d.icon_index, id, right: `${n}`,
        desc: [this.paramDelta(a, slot, kind, id), stripEscapes(d.description || '')].filter(Boolean).join('  ·  ') });
    }
    cands.push({ text: tr('(장비 해제)'), id: 0, desc: this.paramDelta(a, slot, kind, 0) });
    this.list.close();
    this.grid.open(tr('{slot} 변경', { slot: this.slotName(slot) }), [{ label: this.slotName(slot), items: cands }], {
      tab: 0,
      onSelect: (it) => {
        a.changeEquipById(slot, it.id);
        G.combat.equipKey = null;
        G.audio?.playSystemSe(4);
        this.showEquipSlots(slot);
      },
      onCancel: () => this.showEquipSlots(slot),
    });
  }

  // ---- 서약 (the oath system): which of the party's oaths is sworn - its spirit's features add to the actor's
  // (the original's screen shows each oath's description: its level and what it gives) ----
  oathInfo(sid) {
    const d = $data.actors[spiritActorId(sid)];
    const lines = String(d?.description || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const lv = /Lv\s*(\d+)/i.exec(lines[0] || '')?.[1];
    return { name: stripEscapes(d?.name || `#${sid}`), lv: lv !== undefined ? `Lv${lv}` : '', effect: lines.slice(lv !== undefined ? 1 : 0).join(' ') };
  }
  // what swearing sid instead (0: none) does to the params
  oathDelta(a, sid) {
    const ids = [0, 1, 2, 3, 4, 5, 6, 7];
    const before = ids.map(i => a.param(i));
    const saved = a.partners;
    a.partners = sid ? [sid] : [];
    const after = ids.map(i => a.param(i));
    a.partners = saved;
    const P = $data.system.terms.params;
    return ids.filter(i => after[i] !== before[i]).map(i => `${P[i]} ${after[i] > before[i] ? '+' : '−'}${Math.abs(after[i] - before[i])}`).join('  ');
  }
  showOath(index) {
    const st = G.state, a = st.party.leader();
    if (!a) return;
    this.grid.close();
    const cur = a.partners[0] || 0;
    const locked = !!cur && !!st.actor(spiritActorId(cur))?.partnerLocked;
    const items = [{ text: tr('(서약 해제)'), id: 0, enabled: !!cur && !locked, desc: cur ? this.oathDelta(a, 0) : '' }];
    for (const sid of st.oathChoices(a)) {
      const it = this.oathInfo(sid), mine = sid === cur;
      items.push({ text: it.name, id: sid, enabled: !locked, right: mine ? `${it.lv} ${tr('서약 중')}`.trim() : it.lv,
        desc: [it.effect, mine ? '' : this.oathDelta(a, sid)].filter(Boolean).join('  ') });
    }
    this.list.open(a.name ? tr('서약  ({name})', { name: a.name }) : tr('서약'), items, {
      index: index ?? Math.max(0, items.findIndex(it => cur && it.id === cur)),
      onSelect: (i, it) => {
        if (!st.setOath(a, 0, it.id)) { G.audio?.playSystemSe(3); return; }
        G.audio?.playSystemSe(4);
        this.showOath(i);
      },
      onCancel: () => this.reopenMain('oath'),
    });
  }

  // ---- combat / display options ----
  showOptionsMenu(index = 0) {
    const s = G.settings;
    const SWING = [tr('약하게'), tr('보통'), tr('강하게'), tr('아주 강하게')];
    const WEIGHT = [tr('끔'), tr('약하게'), tr('보통'), tr('강하게')];
    const ANIMS = { all: tr('모두'), skills: tr('스킬만 (일반 공격 제외)'), off: tr('끔') };
    const RESPAWN = { map: tr('맵을 나갔다 오면'), slow: tr('1분 뒤 (멀리 있을 때)'), original: tr('원작대로 10초 뒤') };
    const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
    const items = [
      { text: tr('휘두르기 판정'), id: 'swing', right: SWING[s.swingLevel ?? 2], desc: tr('이 정도 세기로 휘둘러야 공격이 들어갑니다 (VR)') },
      { text: tr('무기 무게감'), id: 'weight', right: WEIGHT[s.weaponWeight ?? 2], desc: tr('무거운 무기일수록 세게 휘두르면 늦게 따라오고 멈춰도 더 나가며, 수평으로 들면 처집니다 · 가벼운 무기는 손에 딱 붙어 있습니다 (VR)') },
      { text: tr('이펙트 밝기'), id: 'fx', right: `${Math.round((s.fxBrightness ?? 0.5) * 100)}%`, desc: tr('번쩍임·빛·스킬 애니메이션의 밝기') },
      { text: tr('스킬 애니메이션'), id: 'anims', right: ANIMS[s.skillAnims || 'all'], desc: tr('원작 스킬·공격 애니메이션을 대상 위치에 재생합니다') },
      { text: tr('적이 벽 통과'), id: 'walls', right: s.enemyThroughWalls === false ? tr('끔') : tr('켬'), desc: tr('쫓아오는 적이 벽이나 소품에 끼지 않고 통과합니다') },
      { text: tr('쓰러뜨린 적 부활'), id: 'respawn', right: RESPAWN[s.respawn || 'map'], desc: tr('원작은 10초 뒤에 같은 자리에서 다시 나타납니다') },
      { text: tr('브레이크 판정'), id: 'break', right: (s.breakRule || 'original') === 'easy' ? tr('쉽게 (공격 준비 중이면)') : tr('원작대로'), desc: tr('원작대로: 대부분의 적은 기를 모을 때(금색 빛)나 방어할 때만 브레이크가 통합니다') },
      { text: tr('전투 BGM'), id: 'bgm', right: (s.battleBgm || 'boss') === 'all' ? tr('모든 전투 (원작)') : tr('보스전만'), desc: tr('보스전만: 전용 곡이 있는 전투만 음악이 바뀝니다 · 모든 전투: 일반 전투도 전투곡') },
      { text: tr('피격 붉은 테두리'), id: 'hitFlash', right: s.hitFlash === false ? tr('끔') : tr('켬'), desc: tr('공격에 맞으면 시야 가장자리가 잠깐 붉게 물듭니다') },
      { text: tr('피격 흔들림'), id: 'hitShake', right: s.hitShake === false ? tr('끔') : tr('켬'), desc: tr('공격에 맞으면 시야가 맞은 방향으로 살짝 흔들립니다 (멀미가 나면 끄세요)') },
      { text: tr('강한 공격에 밀려남'), id: 'knock', right: s.hitKnockback === false ? tr('끔') : tr('켬'), desc: tr('보스의 돌진에 맞으면 밀려나고, 뛰어올라 내려찍는 공격에 맞으면 위로 튀어오릅니다 (멀미가 나면 끄세요)') },
      { text: tr('하늘 배경'), id: 'sky', right: s.sky === false ? tr('끔') : tr('켬'), desc: tr('야외 맵의 원작 배경 그림(하늘·바다·우주 등)을 하늘에 두릅니다 (끄면 하늘 색의 하늘)') },
      { text: tr('하늘 색'), id: 'skyColor', right: skyColorName(s.skyColor), desc: tr('원작 배경 그림이 없는 곳의 하늘 색 (원작: 검정)') },
      { text: tr('행동 불가 상태이상'), id: 'restrain', right: s.restrainStates === true ? tr('켬') : tr('끔'), desc: tr('수면·스턴 등에 걸리면 원작처럼 그동안 움직이거나 공격할 수 없습니다 (끄면 움직일 수 있음)') },
    ];
    this.list.open(tr('전투·화면 설정'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'swing') s.swingLevel = ((s.swingLevel ?? 2) + 1) % 4;
        if (it.id === 'weight') { s.weaponWeight = ((s.weaponWeight ?? 2) + 1) % 4; G.combat?.weaponLag.setSway(G.combat.weaponSway()); }
        if (it.id === 'fx') s.fxBrightness = cycle([0.25, 0.5, 0.75, 1], s.fxBrightness ?? 0.5);
        if (it.id === 'anims') s.skillAnims = cycle(['all', 'skills', 'off'], s.skillAnims || 'all');
        if (it.id === 'walls') s.enemyThroughWalls = s.enemyThroughWalls === false;
        if (it.id === 'respawn') s.respawn = cycle(['map', 'slow', 'original'], s.respawn || 'map');
        if (it.id === 'bgm') s.battleBgm = (s.battleBgm || 'boss') === 'all' ? 'boss' : 'all';
        if (it.id === 'break') s.breakRule = (s.breakRule || 'original') === 'easy' ? 'original' : 'easy';
        if (it.id === 'hitFlash') s.hitFlash = s.hitFlash === false;
        if (it.id === 'hitShake') s.hitShake = s.hitShake === false;
        if (it.id === 'knock') s.hitKnockback = s.hitKnockback === false;
        if (it.id === 'sky') { s.sky = s.sky === false; G.sky?.refresh(); }
        if (it.id === 'skyColor') { this.showSkyColorMenu(0, i); return; }
        if (it.id === 'restrain') s.restrainStates = s.restrainStates !== true;
        G.saveSettings?.();
        this.showOptionsMenu(i);
      },
      onCancel: () => this.reopenMain('options'),
    });
  }

  // 하늘 색: the sky where the map shows no picture (sky.js baseSky) - a colour of the list, or red, green and blue as the
  // player likes; it shows at once round the menu
  showSkyColorMenu(index = 0, back = 0) {
    const s = G.settings;
    const hex = /^#[0-9a-f]{6}$/i.test(s.skyColor || '') ? s.skyColor.toLowerCase() : DEFAULT_SKY;
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    // (none kept: the default - the original's black; any other colour kept as chosen)
    const set = v => {
      s.skyColor = v === DEFAULT_SKY ? undefined : v;
      G.saveSettings?.();
      G.sky?.refresh();
    };
    const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    const preset = SKY_COLORS.indexOf(hex);
    const step = (id, dx) => {
      if (id === 'preset') set(SKY_COLORS[((preset < 0 ? 0 : preset) + dx + SKY_COLORS.length) % SKY_COLORS.length]);
      else { const c = [...rgb], k = 'rgb'.indexOf(id); c[k] = Math.max(0, Math.min(255, c[k] + 17 * dx)); set(toHex(c)); }
    };
    const items = [
      { text: tr('색'), id: 'preset', right: skyColorName(hex), desc: tr('고르면 다음 색, 좌우로도 바꿉니다') },
      { text: tr('빨강'), id: 'r', right: String(rgb[0]), desc: tr('좌우로 조절합니다') },
      { text: tr('초록'), id: 'g', right: String(rgb[1]), desc: tr('좌우로 조절합니다') },
      { text: tr('파랑'), id: 'b', right: String(rgb[2]), desc: tr('좌우로 조절합니다') },
      { text: tr('원작대로 (검정)'), id: 'reset' },
    ];
    this.list.open(tr('하늘 색'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'reset') set(SKY_COLORS[0]);
        else step(it.id, 1);
        this.showSkyColorMenu(i, back);
      },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'reset') return false;
        step(it.id, dx);
        this.showSkyColorMenu(i, back);
        return true;
      },
      onCancel: () => this.showOptionsMenu(back),
    });
  }

  // ---- PC monitor spectator view: all of it is the player's choice ----
  showSpectatorMenu(index = 0) {
    const s = G.settings;
    const SMOOTH = [tr('끔'), tr('약하게'), tr('보통'), tr('강하게')];
    const items = [
      { text: tr('관전 화면'), id: 'on', right: s.spectator === false ? tr('끔') : tr('켬'), desc: tr('VR 중에 PC 모니터에 플레이어 시점을 보여 줍니다') },
      { text: tr('수평 고정 (머리 기울기 무시)'), id: 'level', right: s.spectatorLevel ? tr('켬') : tr('끔'), desc: tr('켜면 고개를 기울여도 관전 화면은 수평을 유지합니다') },
      { text: tr('흔들림 보정'), id: 'smooth', right: SMOOTH[s.spectatorSmooth | 0], desc: tr('머리의 작은 흔들림을 부드럽게 따라갑니다 (강할수록 느리게)') },
      { text: tr('시야각'), id: 'fov', right: `${s.spectatorFov || 80}°` },
    ];
    this.list.open(tr('PC 모니터 관전 화면'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'on') {
          s.spectator = s.spectator === false;
          if (G.vr) { if (s.spectator) G.spectator?.start(); else G.spectator?.stop(); }
        }
        if (it.id === 'level') s.spectatorLevel = !s.spectatorLevel;
        if (it.id === 'smooth') s.spectatorSmooth = ((s.spectatorSmooth | 0) + 1) % 4;
        if (it.id === 'fov') { const f = [70, 80, 90, 100]; s.spectatorFov = f[(f.indexOf(s.spectatorFov || 80) + 1) % f.length]; }
        G.saveSettings?.();
        this.showSpectatorMenu(i);
      },
      onCancel: () => this.reopenMain('spectator'),
    });
  }
}
