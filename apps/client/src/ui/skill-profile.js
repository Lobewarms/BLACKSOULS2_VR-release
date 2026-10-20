import { G } from '../core/globals.js';
import { $data } from '../data/data.js';
import { loadCanvas } from '../data/assets.js';
import { desktopViewport } from './desktop-layout.js';
import { tr } from './i18n.js';
import { fitLabel } from './battler-status.js';

const PARAMS = ['MHP', 'MMP', 'ATK', 'DEF', 'MAT', 'MDF', 'AGI', 'LUK'];
const percent = value => `${Math.round(value * 1000) / 10}%`;
const healRules = object => ['HP回復無効', 'MP回復無効', 'HP回復反転', 'MP回復反転'].map(word =>
  Number.parseInt(new RegExp(`<${word}[：:](\\S+?)>`).exec(object?.note || '')?.[1]) || 0);
function details(object) {
  const out = [];
  for (const feature of object?.features || []) {
    const { code, data_id: id, value } = feature;
    if (!Number.isFinite(value)) continue;
    if (code === 21 && id >= 0 && id < 8) out.push(`${$data.system?.terms?.params?.[id] || PARAMS[id]} ${percent(value)}`);
    if (code === 23 && id === 2) out.push(tr('받는 회복 {p}', { p: percent(value) }));
    if (code === 23 && id === 6) out.push(tr('물리 피해 {p}', { p: percent(value) }));
    if (code === 23 && id === 7) out.push(tr('마법 피해 {p}', { p: percent(value) }));
    if (code === 23 && id === 4) out.push(tr('MP 소모 {p}', { p: percent(value) }));
    if (code === 61) out.push(tr('추가 행동 확률 {p}', { p: percent(value) }));
    if (code === 22 && id === 7) out.push(tr('HP 재생 {p}', { p: percent(value) }));
    if (code === 22 && id === 8) out.push(tr('MP 재생 {p}', { p: percent(value) }));
    if (code === 22 && id === 9) out.push(tr('TP 재생 {p}', { p: percent(value) }));
    if (code === 14) out.push(tr('면역: {name}', { name: $data.states?.[id]?.name || tr('효과 #{n}', { n: id }) }));
    if (code === 42) out.push(tr('봉인: {name}', { name: $data.system?.skill_types?.[id] || tr('스킬') }));
    if (code === 44) out.push(tr('봉인: {name}', { name: $data.skills?.[id]?.name || `#${id}` }));
  }
  const labels = ['HP 회복 무효 {p}', 'MP 회복 무효 {p}', 'HP 회복 반전 {p}', 'MP 회복 반전 {p}'];
  healRules(object).forEach((value, index) => { if (value > 0) out.push(tr(labels[index], { p: percent(Math.min(100, value) / 100) })); });
  const restrictions = ['', '적 무작위 공격', '대상 무작위 공격', '아군 무작위 공격', '행동 불가'];
  if (restrictions[object?.restriction]) out.push(tr(restrictions[object.restriction]));
  return out;
}

// Read effective battler values and native traits without rolling healing or
// applying gameplay effects. Every state/buff remains available as a row.
export function skillProfileModel(actor, combat, skill, availability) {
  const params = PARAMS.map((fallback, id) => ({ label: $data.system?.terms?.params?.[id] || fallback,
    value: actor.param?.(id) ?? [actor.mhp, actor.mmp, actor.atk, actor.def, actor.mat, actor.mdf, actor.agi, actor.luk][id] ?? 0 }));
  const resources = [{ label: 'HP', value: `${actor.hp} / ${actor.mhp}` }, { label: 'MP', value: `${actor.mp} / ${actor.mmp}` },
    { label: 'TP', value: `${actor.tp ?? 0} / 100` },
    { label: tr('스태미나'), value: Number.isFinite(combat?.stamina) ? percent(combat.stamina) : '—' }];
  const effects = [...new Set(actor.states || [])].map(id => $data.states?.[id]).filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id - b.id)
    .map(state => ({ key: `state:${state.id}`, name: state.name || tr('효과 #{n}', { n: state.id }),
      icon: state.icon_index || 0, details: [...details(state), ...(state.description ? [state.description] : [])] }));
  (actor.buffs || []).forEach((level, id) => {
    if (!level) return;
    effects.push({ key: `buff:${id}`, name: `${params[id]?.label || PARAMS[id]} ${level > 0 ? '↑' : '↓'}${Math.abs(level) > 1 ? ' ×2' : ''}`,
      icon: (level > 0 ? 64 : 80) + (Math.abs(level) - 1) * 8 + id,
      details: [percent(1 + level * 0.25)] });
  });
  const rules = (actor.featureObjects?.() || []).map(healRules).reduce((sum, row) => sum.map((n, i) => n + row[i]), [0, 0, 0, 0]);
  const warnings = [];
  for (const [kind, label] of [[0, 'HP'], [1, 'MP']]) {
    const disabled = Math.max(0, Math.min(100, rules[kind])), inverted = Math.max(0, Math.min(100, rules[kind + 2]));
    if (disabled) warnings.push({ name: tr(`${label} 회복 무효 {p}`, { p: percent(disabled / 100) }), icon: 0 });
    if (inverted && disabled < 100) warnings.push({ name: tr(`${label} 회복 반전 {p}`, { p: percent((1 - disabled / 100) * inverted / 100) }), icon: 0 });
  }
  if (Number.isFinite(actor.rec) && actor.rec !== 1) warnings.push({ name: tr('받는 회복 {p}', { p: percent(actor.rec) }), icon: 0 });
  const status = skill && (availability || combat?.skillUseStatus?.(skill)), effective = status?.skill || skill;
  const costs = effective ? [['HP', actor.skillHpCost?.(effective) || 0], ['MP', actor.skillMpCost?.(effective) || 0], ['TP', effective.tp_cost || 0]]
    .filter(([, value]) => value > 0).map(([label, value]) => `${label} ${value}`).join(' · ') || tr('소모 없음') : '';
  const cooldown = effective && combat?.skillCooling?.(effective);
  return { name: actor.name || tr('플레이어'), level: actor.level ?? 0, className: $data.classes?.[actor.classId]?.name || '',
    faceName: actor.faceName || '', faceIndex: actor.faceIndex || 0, params, resources, effects, warnings,
    skillName: skill?.name || '', skillDescription: skill?.description || '', costs,
    reason: status?.reason || (cooldown > 0 ? tr('재사용 대기 {s}초', { s: cooldown.toFixed(1) }) : skill ? tr('사용 가능') : '') };
}

export class SkillProfile {
  constructor({ Panel, root, grid, list, ui, font, windowBg, drawIcon, drawGameCursor, textColor, clean = String, assetRevision = () => 0, load = loadCanvas }) {
    Object.assign(this, { root, grid, list, ui, font, windowBg, drawIcon, drawGameCursor, textColor, clean, assetRevision, load });
    this.panel = new Panel(640, 960, 0.64); root.add(this.panel.mesh);
    this.generation = 0; this.session = null; this.page = 0; this.pageCount = 1;
  }
  snapshot(view) {
    if (view === this.grid && view.skillBrowser?.active) return { ...view.skillBrowser.session.original,
      position: view.skillBrowser.session.original.position.clone() };
    return { width: view.panel.canvas.width, height: view.panel.canvas.height, widthM: view.panel.widthM,
      position: view.panel.mesh.position.clone(), cols: view.cols, rows: view.rows, gridTop: view.gridTop, cellH: view.cellH };
  }
  open(kind = 'grid', skillId = null) {
    if (!this.validOwner()) {
      this.close();
      this.session = { generation: ++this.generation, state: G.state, map: G.map, mapId: G.map?.mapId,
        actor: G.state?.party?.leader(), grid: this.snapshot(this.grid), list: this.snapshot(this.list) };
      this.page = 0; this.face = null; this.faceKey = null;
    }
    const session = this.session;
    session.kind = kind; session.skillId = skillId;
    if (kind === 'grid') session.gridTabs = this.grid.tabs;
    else session.listItems = this.list.items;
    this.layoutKey = this.paintKey = null;
    this.panel.mesh.visible = true;
    this.update();
  }
  validOwner() {
    const s = this.session, actor = G.state?.party?.leader();
    return !!s && s.state === G.state && s.map === G.map && s.mapId === G.map?.mapId && s.actor === actor
      && !G.map?.transferring && !G.combat?.playerDead && !(actor?.hp <= 0 && !actor.stateResist?.(1))
      && this.ui.menuOpen && this.ui.menuSection === 'skills';
  }
  update() {
    const s = this.session;
    if (!s) return false;
    const view = s.kind === 'grid' ? this.grid : this.list;
    if (!this.validOwner() || !view.visible || (s.kind === 'grid' ? s.gridTabs !== this.grid.tabs : s.listItems !== this.list.items)) { this.close(); return false; }
    this.layout();
    const id = s.kind === 'grid' ? this.grid.items?.[this.grid.index]?.id : s.skillId;
    const skill = $data.skills?.[id];
    const availability = skill && s.kind === 'grid' && this.grid.skillBrowser?.active ? this.grid.skillBrowser.status(skill) : undefined;
    const model = skillProfileModel(s.actor, G.combat, skill, availability);
    if (model.faceName !== this.faceKey) {
      this.faceKey = model.faceName; this.face = null;
      if (model.faceName) Promise.resolve().then(() => this.load('Graphics/Faces', model.faceName)).then(face => {
        if (s !== this.session || !this.validOwner() || model.faceName !== this.faceKey) return;
        this.face = face; this.paintKey = null; this.update();
      }, () => {});
    }
    const key = JSON.stringify([this.layoutKey, this.page, model, !!this.face, this.assetRevision()]);
    if (key !== this.paintKey) { this.paintKey = key; this.paint(model); }
    return true;
  }
  layout() {
    const v = desktopViewport(G.input, G.three?.renderer), compact = !G.vr && (v.width < 900 || v.height < 640), short = v.height < 640;
    const key = `${G.vr}/${compact}/${short}/${this.session.kind}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key; this.compact = compact;
    const view = this.session.kind === 'grid' ? this.grid : this.list;
    const rows = compact ? short ? 1 : 2 : 8;
    if (this.session.kind === 'grid') { this.grid.cols = 1; this.grid.rows = rows; }
    else this.list.rows = compact ? 3 : 8;
    const browser = this.session.kind === 'grid' && this.grid.skillBrowser?.active;
    const height = this.session.kind === 'grid' ? compact ? browser ? 96 + rows * 108 + 140 : 150 + rows * 76 + 120 : 960 : compact ? 358 : 960;
    view.panel.resize(640, height, 0.64);
    this.panel.resize(640, compact ? short ? 300 : 420 : 960, 0.64);
    if (compact) {
      this.panel.mesh.position.set(0, (height / 1000 + 0.016) / 2, 0);
      view.panel.mesh.position.set(0, -(this.panel.heightM + 0.016) / 2, 0);
    } else { view.panel.mesh.position.set(-0.328, 0, 0); this.panel.mesh.position.set(0.328, 0, 0); }
    view.hover = undefined; view.draw(); this.paintKey = null;
  }
  close() {
    const s = this.session;
    this.session = null; this.generation++; this.panel.mesh.visible = false; this.paintKey = this.layoutKey = null;
    if (!s) return;
    for (const [view, owned, original] of [[this.grid, this.grid.tabs === s.gridTabs, s.grid], [this.list, this.list.items === s.listItems, s.list]]) {
      if (!owned) continue;
      if (original.cols !== undefined) view.cols = original.cols;
      if (original.gridTop !== undefined) view.gridTop = original.gridTop;
      if (original.cellH !== undefined) view.cellH = original.cellH;
      view.rows = original.rows; view.panel.resize(original.width, original.height, original.widthM); view.panel.mesh.position.copy(original.position);
      view.hover = undefined; view.scrollbar?.reset();
      if (view.visible) view.draw();
    }
  }
  changePage(delta) {
    const next = (this.page + delta + this.pageCount) % this.pageCount;
    if (next !== this.page) { this.page = next; this.paintKey = null; this.update(); }
  }
  handleInput(ray) {
    if (!this.session || !this.panel.mesh.visible) return false;
    const input = G.input;
    if (input.cancel?.()) return false;
    if (!G.vr && (input.keyPressed?.('PageDown') || input.keyPressed?.('PageUp'))) {
      this.changePage(input.keyPressed('PageDown') ? 1 : -1); return true;
    }
    const uv = ray && this.panel.hit(ray);
    if (!uv) return false;
    this.ui.pointerTarget = true;
    if (!G.vr && input.mouse?.wheel) {
      const direction = Math.sign(input.mouse.wheel); input.mouse.wheel = 0; this.changePage(direction); return true;
    }
    const confirmation = !G.vr && this.ui.skillsBrowser?.active ? input.mousePressed?.(0) : input.confirm?.() || input.mousePressed?.(0);
    if (confirmation) {
      const x = uv.x * 640, y = (1 - uv.y) * this.panel.canvas.height;
      if (y >= this.panel.canvas.height - 42) { if (x < 160) this.changePage(-1); else if (x > 480) this.changePage(1); }
      return true;
    }
    return false;
  }
  lines(text, room, size = 28) {
    const ctx = this.panel.ctx; ctx.font = `${size}px ${this.font}`;
    const lines = []; let line = '';
    for (const char of this.clean(text)) {
      if (char === '\n' || line && ctx.measureText(line + char).width > room) { lines.push(line); line = char === '\n' ? '' : char; }
      else line += char;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  paint(model) {
    const p = this.panel, { ctx, canvas } = p, W = canvas.width, H = canvas.height;
    p.clear(); this.windowBg(ctx, 4, 4, W - 8, H - 8, G.vr ? 0.9 : 0.25, G.vr ? 1 : 0.65);
    ctx.save(); ctx.textBaseline = 'middle'; ctx.imageSmoothingEnabled = false;
    const write = (text, x, y, size = 28, color = 0, align = 'left') => {
      ctx.font = `${size}px ${this.font}`; ctx.fillStyle = this.textColor(color); ctx.textAlign = align;
      ctx.lineWidth = 3; ctx.strokeStyle = '#08080b'; ctx.strokeText(this.clean(text), x, y); ctx.fillText(this.clean(text), x, y);
    };
    const fit = (text, room, size) => {
      ctx.font = `${size}px ${this.font}`; const width = ctx.measureText(this.clean(text)).width;
      return Math.min(size, Math.max(18, Math.floor(size * room / Math.max(1, width))));
    };
    const bounded = (text, x, y, size, color = 0) => {
      const fitted = fit(text, 592, size); ctx.font = `${fitted}px ${this.font}`;
      write(fitLabel(ctx, this.clean(text), 592), x, y, fitted, color);
    };
    const faceSize = this.compact ? 64 : 128, fx = model.faceIndex % 4 * 96, fy = Math.floor(model.faceIndex / 4) * 96;
    if (model.faceName && this.face?.width >= fx + 96 && this.face?.height >= fy + 96) ctx.drawImage(this.face, fx, fy, 96, 96, 24, 20, faceSize, faceSize);
    const x = this.compact ? 104 : 176;
    write(model.name, x, this.compact ? 36 : 48, fit(model.name, W - x - 24, 34));
    const identity = `${model.className} · Lv ${model.level}`;
    write(identity, x, this.compact ? 72 : 94, fit(identity, W - x - 24, 28), 16);
    const rows = [];
    if (this.compact) {
      for (const resource of model.resources) rows.push({ text: resource.label, value: resource.value, icon: 0 });
      for (const param of model.params) rows.push({ text: param.label, value: String(param.value), icon: 0 });
    } else {
      model.resources.forEach((r, i) => {
        write(r.label, 24, 174 + i * 42, 30, 16);
        write(r.value, 616, 174 + i * 42, fit(r.value, 440, 30), 0, 'right');
      });
      model.params.forEach((r, i) => {
        const x = 24 + i % 2 * 304, y = 366 + Math.floor(i / 2) * 36;
        write(r.label, x, y, fit(r.label, 178, 26), 16);
        write(String(r.value), x + 280, y, fit(String(r.value), 96, 28), 0, 'right');
      });
      write(tr('전체 활성 효과 {n}', { n: model.effects.length }), 24, 524, 30, 16);
    }
    for (const effect of [...model.warnings, ...model.effects]) {
      this.lines(effect.name, 544).forEach((text, i) => rows.push({ text, icon: i === 0 ? effect.icon : 0, color: model.warnings.includes(effect) ? 18 : 0 }));
      for (const detail of effect.details || []) this.lines(detail, 544, 26).forEach(text => rows.push({ text, icon: 0, color: 16 }));
    }
    if (model.skillDescription) {
      this.lines(`${tr('스킬')} · ${model.skillName}`, 544).forEach(text => rows.push({ text, icon: 0, color: 16 }));
      this.lines(model.skillDescription, 544, 26).forEach(text => rows.push({ text, icon: 0, color: 16 }));
    }
    if (!rows.length) rows.push({ text: tr('(없음)'), icon: 0 });
    const firstRow = this.compact ? 112 : 566;
    const visible = Math.max(1, Math.floor((H - 112 - 36 - firstRow) / 34) + 1);
    this.pageCount = Math.max(1, Math.ceil(rows.length / visible)); this.page = Math.min(this.page, this.pageCount - 1);
    rows.slice(this.page * visible, (this.page + 1) * visible).forEach((row, i) => {
      const y = firstRow + i * 34;
      if (row.icon) this.drawIcon(ctx, row.icon, 24, y - 14, 28);
      write(row.text, 64, y, row.color === 16 ? 26 : 28, row.color || 0);
      if (row.value !== undefined) write(row.value, 616, y, fit(row.value, 300, 28), 0, 'right');
    });
    if (model.skillName) {
      bounded(model.skillName, 24, H - 112, 26, 16);
      const info = [model.costs, model.reason].filter(Boolean).join(' · ');
      bounded(info, 24, H - 78, 26);
    }
    const hint = tr(G.vr ? '이전·다음을 가리켜 결정' : 'PageUp/PageDown · 효과 위에서 스크롤');
    write(hint, 320, H - 54, fit(hint, 592, 18), 8, 'center');
    this.drawGameCursor(ctx, 20, H - 44, 128, 36); this.drawGameCursor(ctx, W - 148, H - 44, 128, 36);
    write('‹ ' + tr('이전'), 34, H - 26, 26); write(tr('다음') + ' ›', W - 134, H - 26, 26);
    const pageLabel = `${this.compact ? tr('캐릭터') + ' ' : ''}${this.page + 1}/${this.pageCount}`;
    write(pageLabel, W / 2, H - 26, fit(pageLabel, 312, 24), 16, 'center');
    ctx.restore(); p.commit();
  }
}
