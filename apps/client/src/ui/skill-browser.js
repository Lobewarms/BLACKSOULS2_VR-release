import * as THREE from 'three';
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { tr } from './i18n.js';
import { withMenuSkillPreview } from '../combat/menu-weapon-skills.js';

export const SKILL_TABS = ['favorites', 'all', 'weapon', 'attack', 'healing', 'buffs', 'debuffs'];
const LABELS = ['즐겨찾기', '전체', '무기 기술', '공격', '회복', '강화', '약화'];
const positiveId = id => Number.isSafeInteger(id) && id > 0 && id <= 1_000_000;
export function skillBrowserPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const favorites = [...new Set((Array.isArray(source.favorites) ? source.favorites : []).filter(id => positiveId(id) && $data.skills?.[id]))].slice(0, 256).sort((a, b) => a - b);
  return { favorites, tab: SKILL_TABS.includes(source.tab) ? source.tab : favorites.length ? 'favorites' : 'all',
    query: typeof source.query === 'string' ? [...source.query].slice(0, 120).join('') : '', selectedId: positiveId(source.selectedId) ? source.selectedId : 0 };
}
export function skillCategories(skill, combat, actor) {
  const enemy = skill.scope >= 1 && skill.scope <= 6, effects = skill.effects || [], damage = skill.damage?.type || 0;
  const categories = ['all'];
  const granted = actor?.weapons?.().some(weapon => (weapon?.features || []).some(feature => feature.code === 43 && feature.data_id === skill.id));
  if (combat?.isWeaponArt?.(skill) || granted || skill.required_wtype_id1 > 0 || skill.required_wtype_id2 > 0) categories.push('weapon');
  if (enemy && [1, 2, 5, 6].includes(damage)) categories.push('attack');
  const healing = effects.some(e => e.code === 22 || [11, 12].includes(e.code) && (e.value1 > 0 || e.value2 > 0)
    || e.code === 21 && ($data.states?.[e.data_id]?.features || []).some(f => f.code === 22 && [7, 8].includes(f.data_id) && f.value > 0));
  if (!enemy && ([3, 4].includes(damage) || healing)) categories.push('healing');
  if (!enemy && effects.some(e => [21, 22, 31, 33, 34].includes(e.code))) categories.push('buffs');
  if (enemy && effects.some(e => [21, 32, 33].includes(e.code))) categories.push('debuffs');
  return categories;
}
const normalized = text => String(text).normalize('NFKC').toLowerCase();
// Provenance is only presentation metadata. Combat independently rechecks bag
// ownership and equipment rules immediately before using a menu skill.
function sourceEquipment(actor) {
  const equipment = [];
  for (const kind of ['weapon', 'armor']) {
    const records = kind === 'weapon' ? $data.weapons : $data.armors;
    const eligible = item => !!item && (kind === 'weapon' || item.etype_id === 1);
    for (const item of kind === 'weapon' ? actor.weapons?.() || [] : actor.armors?.() || []) if (eligible(item)) equipment.push([kind, item]);
    for (const [id, count] of G.state?.party?.[kind === 'weapon' ? 'weapons' : 'armors'] || []) {
      if (Number.isFinite(count) && count > 0 && eligible(records?.[id])) equipment.push([kind, records[id]]);
    }
  }
  const sources = new Map();
  for (const item of new Map(equipment.map(([kind, item]) => [`${kind}:${item.id}`, item])).values()) {
    for (const feature of item.features || []) if (feature.code === 43) {
      const list = sources.get(feature.data_id) || [];
      if (!list.includes(item)) list.push(item);
      sources.set(feature.data_id, list);
    }
  }
  return sources;
}

export class SkillBrowser {
  constructor({ grid, ui, font, windowBg, drawIcon, drawGameCursor, fitLabel, clean = String, assetRevision = () => 0 }) {
    Object.assign(this, { grid, ui, font, windowBg, drawIcon, drawGameCursor, fitLabel, clean, assetRevision });
    grid.skillBrowser = this; this.session = null; this.searchInput = null; this.composing = false; this.blockedFrame = -1;
  }
  get active() { return !!this.session && this.session.mode === 'browser' && this.owns(); }
  get selectedId() { return this.grid.items?.[this.grid.index]?.id || 0; }
  owns() {
    const s = this.session, actor = G.state?.party?.leader();
    return !!s && s.state === G.state && s.map === G.map && s.mapId === G.map?.mapId && s.actor === actor
      && this.ui.menuOpen && this.ui.menuSection === 'skills' && !G.map?.transferring && !G.combat?.playerDead
      && !(actor.hp <= 0 && !actor.stateResist?.(1));
  }
  open({ selectedId } = {}) {
    const actor = G.state?.party?.leader(); if (!actor) return;
    if (!this.owns()) {
      this.close();
      const stored = G.settings?.skillBrowser?.[String(actor.id)];
      this.session = { actor, state: G.state, map: G.map, mapId: G.map?.mapId, prefs: skillBrowserPreferences(stored),
        original: { gridTop: this.grid.gridTop, cellH: this.grid.cellH, cols: this.grid.cols, rows: this.grid.rows,
          width: this.grid.panel.canvas.width, height: this.grid.panel.canvas.height, widthM: this.grid.panel.widthM,
          position: this.grid.panel.mesh.position.clone() }, mode: 'browser' };
    }
    this.session.mode = 'browser'; this.session.tabs = [{ label: tr('스킬'), items: [] }];
    this.grid.open(tr('스킬'), this.session.tabs, { tab: 0, index: 0,
      onSelect: () => this.useSelected(), onCancel: () => { this.close(); this.grid.close(); this.ui.reopenMain('skills'); } });
    if (positiveId(selectedId)) this.session.prefs.selectedId = selectedId;
    this.rebuild(true); this.drawKey = null;
  }
  close() {
    const session = this.session; this.session = null; this.hover = undefined; this.blurSearch();
    if (session && this.grid.tabs === session.tabs) {
      this.grid.gridTop = session.original.gridTop; this.grid.cellH = session.original.cellH;
      this.grid.cols = session.original.cols; this.grid.rows = session.original.rows;
      this.grid.panel.resize(session.original.width, session.original.height, session.original.widthM);
      this.grid.panel.mesh.position.copy(session.original.position);
      this.grid.hover = undefined; this.grid.scrollbar?.reset();
    }
  }
  suspend() { if (this.session) this.session.mode = 'assignment'; this.blurSearch(); }
  save() {
    if (!this.owns() || !positiveId(this.session.actor.id)) return;
    const saved = {}, old = G.settings?.skillBrowser;
    if (old && typeof old === 'object' && !Array.isArray(old)) for (const key of Object.keys(old).slice(0, 128)) {
      if (/^[1-9]\d{0,5}$/.test(key)) saved[key] = skillBrowserPreferences(old[key]);
    }
    saved[String(this.session.actor.id)] = skillBrowserPreferences(this.session.prefs);
    G.settings ||= {}; G.settings.skillBrowser = saved; G.saveSettings?.();
  }
  rows() {
    return withMenuSkillPreview(this.session.actor, G.state?.party, () => this.previewRows());
  }
  previewRows() {
    const s = this.session, query = normalized(s.prefs.query.trim());
    const favorites = new Set(s.prefs.favorites);
    const known = new Set(s.actor.allSkills().map(skill => skill.id));
    const provenance = sourceEquipment(s.actor);
    const skills = G.combat?.menuSkills?.(s.actor) || s.actor.allSkills();
    return [...new Map(skills.filter(Boolean).map(skill => [skill.id, skill])).values()]
      .map(skill => {
        const status = this.status(skill), sources = [...(provenance.get(skill.id) || [])];
        if (status?.weapon && !sources.includes(status.weapon)) sources.push(status.weapon);
        return { skill, status, sources };
      })
      .filter(({ skill, status, sources }) => (s.prefs.tab === 'favorites' ? favorites.has(skill.id)
        : s.prefs.tab === 'weapon' && (status?.weapon || sources.length) || skillCategories(skill, G.combat, s.actor).includes(s.prefs.tab))
        && (!query || normalized(this.clean(`${skill.name}\n${skill.description || ''}\n${sources.map(weapon => weapon.name).join('\n')}`)).includes(query)))
      .sort((a, b) => Number(favorites.has(b.skill.id)) - Number(favorites.has(a.skill.id)) || a.skill.id - b.skill.id)
      .map(({ skill, status }) => {
        const effective = status?.skill || skill;
        const cost = [['HP', status?.costs?.hp ?? s.actor.skillHpCost?.(effective) ?? 0],
          ['MP', status?.costs?.mp ?? s.actor.skillMpCost?.(effective) ?? 0], ['TP', status?.costs?.tp ?? effective.tp_cost ?? 0]]
          .filter(([, value]) => value > 0).map(([label, value]) => `${label} ${value}`).join(' · ') || tr('소모 없음');
        const cooldown = G.combat?.skillCooling?.(effective) || 0;
        const reason = status?.reason || (cooldown > 0 ? tr('재사용 대기 {s}초', { s: cooldown.toFixed(1) }) : tr('사용 가능'));
        return { id: skill.id, text: skill.name, desc: skill.description, icon: skill.icon_index, enabled: true,
          available: !!status?.ok, favorite: favorites.has(skill.id), cost, reason,
          weapon: status?.weapon ? { id: status.weapon.id, name: status.weapon.name, icon: status.weapon.icon_index || 0 } : null,
          requiresSwap: !!status?.requiresSwap, borrowed: !known.has(skill.id) };
      });
  }
  status(skill) {
    const combat = G.combat, status = combat?.menuSkillUseStatus ? combat.menuSkillUseStatus(skill) : combat?.skillUseStatus?.(skill);
    if (!status?.ok) return status;
    const effective = status.skill || skill, eligible = !!combat.bonusSkillEligible?.(effective, 'skill');
    const special = effective.id === 12 || combat.isBreakSkill?.(effective);
    const gated = !special && (eligible || combat.bonusFighting?.() || effective.scope >= 1 && effective.scope <= 6);
    if (gated && combat.playerActionReady && !combat.playerActionReady(eligible)) {
      const seconds = Math.max(0, (combat.playerActiveUntil || 0) - G.time, (combat.playerRecoveryUntil || 0) - G.time);
      return { ...status, ok: false, reason: tr('재사용 대기 {s}초', { s: seconds.toFixed(1) }) };
    }
    return status;
  }
  rebuild(force = false) {
    if (!this.active) return;
    const rows = this.rows(), signature = JSON.stringify(rows);
    if (!force && signature === this.rowsKey) return;
    this.rowsKey = signature;
    const id = this.selectedId || this.session.prefs.selectedId;
    this.session.tabs[0].items = rows;
    this.grid.index = Math.max(0, rows.findIndex(row => row.id === id));
    this.grid.hover = this.hover = undefined; this.drawKey = null;
  }
  update({ positionSearch = true } = {}) {
    if (!this.session) return false;
    if (!this.owns()) { this.close(); return false; }
    if (this.session.mode !== 'browser') return true;
    if (this.grid.tabs !== this.session.tabs || !this.grid.visible) { this.close(); return false; }
    this.rebuild();
    const key = JSON.stringify([this.rowsKey, this.grid.index, this.grid.top, this.session.prefs, G.vr,
      this.grid.panel.canvas.width, this.grid.panel.canvas.height, this.assetRevision()]);
    if (key !== this.drawKey) { this.drawKey = key; this.draw(); }
    if (positionSearch) this.positionSearch();
    return true;
  }
  setTab(tab) {
    if (!this.active || !SKILL_TABS.includes(tab) || tab === this.session.prefs.tab) return;
    this.session.prefs.selectedId = this.selectedId; this.session.prefs.tab = tab;
    this.grid.top = 0; this.rebuild(true); this.session.prefs.selectedId = this.selectedId; this.save(); this.draw();
  }
  setQuery(query) {
    if (!this.active) return;
    const value = [...String(query)].slice(0, 120).join('');
    if (value === this.session.prefs.query) return;
    this.session.prefs.query = value; this.grid.top = 0; this.rebuild(true); this.session.prefs.selectedId = this.selectedId;
    if (this.searchInput && !this.composing) this.searchInput.value = value;
    this.save(); this.draw();
  }
  rememberSelection() {
    if (this.selectedId === this.session.prefs.selectedId) return;
    this.session.prefs.selectedId = this.selectedId; this.save();
  }
  toggleFavorite() {
    if (!this.active || !this.selectedId) return;
    const prefs = this.session.prefs, id = this.selectedId;
    prefs.favorites = prefs.favorites.includes(id) ? prefs.favorites.filter(value => value !== id) : [...prefs.favorites, id].slice(0, 256);
    prefs.selectedId = id; this.rebuild(true); this.save(); this.draw();
  }
  assignSelected() {
    const id = this.selectedId; if (!this.active || !id) return;
    const status = this.status($data.skills?.[id]);
    if (!this.session.actor.allSkills().some(skill => skill.id === id)) {
      this.ui.toast(tr('자동 교체는 스킬 메뉴에서만 됩니다. 퀵슬롯에 등록하려면 먼저 이 장비를 장착하세요'), status?.weapon?.icon_index);
      G.audio?.playSystemSe(3); return;
    }
    this.rememberSelection(); this.suspend(); this.grid.close();
    this.ui.showQuickPicker({ kind: 'skill', id }, () => { if (this.ui.menuOpen) this.ui.showSkills(); });
  }
  useSelected() {
    if (!this.active || this.searchFocused()) return false;
    const skill = $data.skills?.[this.selectedId], combat = G.combat;
    if (!skill) return false;
    this.rememberSelection();
    const status = this.status(skill);
    if (!status?.ok) {
      G.audio?.playSystemSe(3); this.ui.toast(status?.reason || tr('지금은 쓸 수 없는 스킬입니다')); this.update(); return false;
    }
    const used = !!combat.useSkillFromMenu(skill);
    if (this.active) { this.rebuild(true); this.draw(); }
    return used;
  }
  searchFocused() { return !!this.searchInput && document.activeElement === this.searchInput; }
  flushSearchInput() {
    G.input?.keys?.clear(); G.input?.keysPrev?.clear(); G.input?.releaseMouse?.(); this.blockedFrame = G.frame;
  }
  focusSearch() {
    if (!this.active || G.vr) return;
    if (!this.searchInput) {
      const field = this.searchInput = document.createElement('input'); field.type = 'text'; field.maxLength = 240;
      field.setAttribute?.('aria-label', tr('스킬 검색')); field.autocomplete = 'off'; field.spellcheck = false;
      Object.assign(field.style, { position: 'fixed', zIndex: '10002', boxSizing: 'border-box', background: '#111016', color: '#fff',
        border: '1px solid #b9aa84', outline: 'none', padding: '2px 8px', fontFamily: this.font, display: 'none' });
      field.oncompositionstart = () => { this.composing = true; };
      field.oncompositionend = () => { this.composing = false; this.imeCommit = true; this.setQuery(field.value); };
      field.oninput = () => { if (!this.composing) this.setQuery(field.value); };
      field.onkeydown = event => {
        event.stopPropagation();
        if (event.isComposing || this.composing || event.keyCode === 229) return;
        if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); this.blurSearch(); }
      };
      field.onkeyup = event => { event.stopPropagation(); this.imeCommit = false; this.flushSearchInput(); };
      field.onblur = () => { field.style.display = 'none'; this.flushSearchInput(); };
      document.body.appendChild(field);
    }
    this.searchInput.value = this.session.prefs.query; this.searchInput.style.display = 'block';
    this.searchInput.placeholder = tr('스킬 검색 (/)'); this.positionSearch(); this.flushSearchInput(); this.searchInput.focus();
  }
  blurSearch() { if (this.searchInput) { this.searchInput.style.display = 'none'; this.searchInput.blur(); } this.composing = false; }
  positionSearch() {
    if (!this.searchInput || this.searchInput.style.display === 'none') return;
    if (!this.active || G.vr) { this.blurSearch(); return; }
    const camera = this.ui.camera, panel = this.grid.panel, rect = G.input.dom?.getBoundingClientRect?.();
    if (!camera || !rect) return;
    panel.mesh.updateWorldMatrix(true, false); camera.updateWorldMatrix(true, false);
    const project = (x, y) => panel.mesh.localToWorld(new THREE.Vector3((x / 640 - 0.5) * panel.widthM,
      (0.5 - y / panel.canvas.height) * panel.heightM, 0.001)).project(camera);
    const a = project(24, this.searchY), b = project(556, this.searchY + 36);
    Object.assign(this.searchInput.style, { left: `${(rect.left || 0) + (a.x + 1) * rect.width / 2}px`,
      top: `${(rect.top || 0) + (1 - a.y) * rect.height / 2}px`, width: `${Math.max(1, (b.x - a.x) * rect.width / 2)}px`,
      height: `${Math.max(24, (a.y - b.y) * rect.height / 2)}px`, fontSize: '18px' });
  }
  handleInput(ray) {
    if (!this.active) return false;
    if (this.searchFocused() || this.blockedFrame === G.frame) return true;
    const input = G.input;
    if (input.cancel() || input.menu()) { this.grid.onCancel?.(); return true; }
    if (!G.vr && input.keyPressed?.('Slash')) { this.focusSearch(); return true; }
    if (!G.vr && input.keyPressed?.('KeyF')) { this.toggleFavorite(); return true; }
    if (!G.vr && input.keyPressed?.('KeyQ')) { this.assignSelected(); return true; }
    const uv = ray && this.grid.panel.hit(ray), x = uv && uv.x * 640, y = uv && (1 - uv.y) * this.grid.panel.canvas.height;
    let hover = -1;
    if (uv) this.ui.pointerTarget = true;
    const click = !!(uv && (G.vr ? input.confirm() : input.mousePressed?.(0)));
    if (uv) {
      this.ui.pointerTarget = true;
      const compact = !!this.ui.skillProfile?.compact;
      if (compact && y >= 8 && y <= 40 && click) {
        if (x >= 160 && x <= 196) this.setTab(SKILL_TABS[(SKILL_TABS.indexOf(this.session.prefs.tab) + 6) % 7]);
        else if (x >= 584) this.setTab(SKILL_TABS[(SKILL_TABS.indexOf(this.session.prefs.tab) + 1) % 7]);
        return true;
      }
      if (!compact && y >= 44 && y < 116) {
        const col = Math.floor((x - 20) / 150), row = y >= 80 ? 1 : 0, tab = row * 4 + col;
        if (col >= 0 && col < 4 && tab < SKILL_TABS.length && click) this.setTab(SKILL_TABS[tab]);
        if (click) return true;
      }
      if (y >= this.searchY && y <= this.searchY + 36) {
        if (click) { if (x >= 560) this.setQuery(''); else this.focusSearch(); return true; }
      }
      if (y >= this.grid.panel.canvas.height - 52) {
        if (click) { if (x < 320) this.toggleFavorite(); else this.assignSelected(); return true; }
      }
    }
    const scroll = this.grid.scrollbar?.update(ray, top => this.grid.scrollTo(top));
    if (scroll?.changed) { this.rememberSelection(); this.draw(); }
    if (scroll?.handled) return true;
    const dy = input.navY(), dx = input.navX();
    if (dx) { this.setTab(SKILL_TABS[(SKILL_TABS.indexOf(this.session.prefs.tab) + dx + SKILL_TABS.length) % SKILL_TABS.length]); return true; }
    if (dy && this.grid.items.length) { this.grid.index = Math.max(0, Math.min(this.grid.items.length - 1, this.grid.index + dy)); this.rememberSelection(); this.draw(); }
    if (uv && !scroll?.over && y >= this.grid.gridTop) {
      const row = Math.floor((y - this.grid.gridTop) / this.grid.cellH);
      if (row >= 0 && row < this.grid.rows && this.grid.items[this.grid.top + row]) hover = this.grid.top + row;
    }
    const moved = this.hover !== undefined && this.hover !== hover;
    if (hover >= 0 && (moved || click)) { this.grid.index = hover; this.rememberSelection(); this.draw(); }
    this.hover = hover;
    if (input.confirm()) { if (uv && hover < 0 && (G.vr || input.mousePressed?.(0))) return true; this.useSelected(); return true; }
    return false;
  }
  draw() {
    if (!this.active) return;
    const p = this.grid.panel, { ctx, canvas } = p, compact = !!this.ui.skillProfile?.compact;
    this.searchY = compact ? 48 : 144;
    this.grid.gridTop = compact ? 96 : 200; this.grid.cellH = 108;
    this.grid.rows = Math.max(1, Math.floor((canvas.height - this.grid.gridTop - 140) / 108));
    const layout = `${canvas.width}/${canvas.height}/${this.grid.gridTop}/${G.vr}`;
    if (layout !== this.hoverLayout) { this.hoverLayout = layout; this.hover = undefined; }
    this.grid.cols = 1;
    this.grid.top = Math.max(0, Math.min(this.grid.top, Math.max(0, this.grid.items.length - this.grid.rows)));
    if (this.grid.index < this.grid.top) this.grid.top = this.grid.index;
    if (this.grid.index >= this.grid.top + this.grid.rows) this.grid.top = this.grid.index - this.grid.rows + 1;
    p.clear(); this.windowBg(ctx, 4, 4, canvas.width - 8, canvas.height - 8, G.vr ? 0.92 : 0.45);
    ctx.save(); ctx.textBaseline = 'middle';
    const text = (label, x, y, size = 26, color = '#f0f0f0', room = 592) => {
      ctx.font = `${size}px ${this.font}`; ctx.fillStyle = color; ctx.textAlign = 'left';
      ctx.fillText(this.fitLabel(ctx, this.clean(label), room), x, y);
    };
    text(tr('스킬'), 24, 26, 32, '#e8d8a8');
    const tabLabel = (label, x, y, room = 130) => {
      ctx.font = `22px ${this.font}`; const measured = ctx.measureText(label).width;
      ctx.font = `${Math.max(20, Math.min(22, Math.floor(22 * room / Math.max(1, measured))))}px ${this.font}`;
      ctx.fillStyle = '#f0f0f0'; ctx.textAlign = 'left'; ctx.fillText(label, x, y, room);
    };
    if (compact) {
      this.drawGameCursor(ctx, 160, 8, 36, 32); this.drawGameCursor(ctx, 584, 8, 36, 32);
      text('‹', 170, 24, 26); text('›', 594, 24, 26);
      tabLabel(tr(LABELS[SKILL_TABS.indexOf(this.session.prefs.tab)]), 208, 24, 360);
    } else SKILL_TABS.forEach((tab, index) => {
      const x = 20 + index % 4 * 150, y = 44 + Math.floor(index / 4) * 36;
      if (tab === this.session.prefs.tab) this.drawGameCursor(ctx, x, y, 146, 32);
      tabLabel(tr(LABELS[index]), x + 8, y + 16);
    });
    if (!G.vr) { this.drawGameCursor(ctx, 20, this.searchY, 536, 36); text(this.session.prefs.query || tr('스킬 검색 (/)'), 28, this.searchY + 18, 24, '#e8d8a8', 520);
      this.drawGameCursor(ctx, 560, this.searchY, 56, 36); text('×', 578, this.searchY + 18, 26); }
    if (G.vr) text(tr('스틱: 선택 · A / 트리거: 결정 · B: 뒤로'), 24, 162, 20);
    else if (!compact) text(tr('Enter: 사용 · F: 즐겨찾기 · Q: 퀵슬롯'), 24, 190, 18);
    this.grid.items.slice(this.grid.top, this.grid.top + this.grid.rows).forEach((row, index) => {
      const y = this.grid.gridTop + index * 108;
      if (this.grid.top + index === this.grid.index) this.drawGameCursor(ctx, 20, y, 574, 102);
      this.drawIcon(ctx, row.icon || 0, 28, y + 10, 36);
      text(`${row.favorite ? '★ ' : ''}${row.text}`, 74, y + 24, compact ? 30 : 28, row.available ? '#fff' : '#bbb', 502);
      text(row.cost, 74, y + 55, 24, '#e8d8a8', 502);
      if (row.weapon) {
        if (row.weapon.icon) this.drawIcon(ctx, row.weapon.icon, 28, y + 73, 22);
        text(`${row.weapon.name} · ${row.reason}`, row.weapon.icon ? 56 : 28, y + 84, 22, row.available ? '#ccc' : '#e7a3a3', row.weapon.icon ? 520 : 548);
      } else text(row.reason, 28, y + 84, 23, row.available ? '#ccc' : '#e7a3a3', 548);
    });
    this.grid.scrollbar?.draw(this.grid.gridTop, this.grid.rows * 108 - 6, this.grid.top, this.grid.rows, this.grid.items.length);
    if (!this.grid.items.length) this.wrap(tr(this.session.prefs.tab === 'favorites' ? '즐겨찾기가 없습니다. F로 추가하거나 전체를 선택하세요' : '검색 결과 없음'), 592, 25)
      .forEach((line, index) => text(line, 24, this.grid.gridTop + 28 + index * 30, 25));
    const description = this.grid.items[this.grid.index]?.desc || '';
    const descriptionLines = this.wrap(this.clean(description), 592, 24);
    descriptionLines.slice(0, 2).forEach((line, index) => text(line + (index === 1 && descriptionLines.length > 2 ? '…' : ''), 24,
      canvas.height - 122 + index * 32, 24, '#e1dcd0'));
    const favorite = this.session.prefs.favorites.includes(this.selectedId);
    this.drawGameCursor(ctx, 20, canvas.height - 48, 280, 40); this.drawGameCursor(ctx, 340, canvas.height - 48, 280, 40);
    text(G.vr ? `${favorite ? '✓ ' : ''}${tr('즐겨찾기')}` : tr(favorite ? '즐겨찾기 제거 (F)' : '즐겨찾기 추가 (F)'), 32, canvas.height - 28, 23, '#e8d8a8', 256);
    const borrowed = this.grid.items[this.grid.index]?.borrowed;
    text(tr(borrowed ? '스킬 메뉴에서만 사용' : G.vr ? '퀵슬롯에 등록' : '퀵슬롯 지정 (Q)'), 352, canvas.height - 28, 23, borrowed ? '#bbb' : '#e8d8a8', 256);
    ctx.restore(); p.commit();
  }
  wrap(text, room, size) {
    const ctx = this.grid.panel.ctx; ctx.font = `${size}px ${this.font}`;
    const out = []; let line = '';
    for (const char of String(text)) {
      if (char === '\n' || line && ctx.measureText(line + char).width > room) { out.push(line); line = char === '\n' ? '' : char; }
      else line += char;
    }
    if (line) out.push(line); return out;
  }
}
