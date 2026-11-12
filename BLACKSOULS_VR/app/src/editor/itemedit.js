// The rule editor's 장비·스킬 tab (mapedit.html - mapedit.js keeps the rules and saves them): the player's own rules for the
// game's weapons, armors and skills (userrules.js; itemrules.js puts them over the game's data) - an equipment's 특징 (VX Ace's
// features: 마법 반사율, 속성·상태 유효도, 공격 시 상태 ...), its 능력치, its 메모 (the scripts' tags: <自動蘇生:500,42,80> ...)
// and 설명; a skill's 사용 효과, 피해, 명중, 비용, 메모 and 설명. Each is shown as the game's database has it, or as the player's
// rule changed it; a rule keeps only what differs from the game's own (all of it the same: no rule). Its icon and what it now
// does, in words, drawn beside.
import { $data } from '../data.js';
import { loadCanvas } from '../assets.js';

const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const KIND_NAME = { weapons: '무기', armors: '방어구', skills: '스킬' };
const XPARAMS = ['명중률', '회피율', '치명타율', '치명타 회피율', '마법 회피율', '마법 반사율', '반격률', 'HP 재생률', 'MP 재생률', 'TP 재생률'];
const SPARAMS = ['노려짐률', '방어 효과율', '회복 효과율', '약의 지식', 'MP 소비율', 'TP 차지율', '물리 피해율', '마법 피해율', '바닥 피해율', '경험치 획득률'];
const listed = names => names.map((n, i) => [i, n]);
// VX Ace's features: their name, what they are about (a list, or a list of the database's) and how their value reads -
// rate: x n% (1 = 100%), plus: +n% (0.5 = +50%), num: a number, int: a whole number, none: no value
const FEATURES = {
  11: { name: '속성 유효도', data: 'element', value: 'rate' },
  12: { name: '약체 유효도', data: 'param', value: 'rate' },
  13: { name: '상태 유효도', data: 'state', value: 'rate' },
  14: { name: '상태 무효', data: 'state' },
  21: { name: '통상 능력치', data: 'param', value: 'rate' },
  22: { name: '추가 능력치', data: listed(XPARAMS), value: 'plus' },
  23: { name: '특수 능력치', data: listed(SPARAMS), value: 'rate' },
  31: { name: '공격 시 속성', data: 'element' },
  32: { name: '공격 시 상태', data: 'state', value: 'plus' },
  33: { name: '공격 속도 보정', value: 'num' },
  34: { name: '공격 추가 횟수', value: 'int' },
  41: { name: '스킬 타입 추가', data: 'stype' },
  42: { name: '스킬 타입 봉인', data: 'stype' },
  43: { name: '스킬 추가', data: 'skill' },
  44: { name: '스킬 봉인', data: 'skill' },
  51: { name: '무기 타입 장비', data: 'wtype' },
  52: { name: '방어구 타입 장비', data: 'atype' },
  53: { name: '장비 고정', data: 'etype' },
  54: { name: '장비 봉인', data: 'etype' },
  55: { name: '슬롯 타입', data: listed(['보통', '이도류']) },
  61: { name: '행동 횟수 추가', value: 'plus' },
  62: { name: '특수 플래그', data: listed(['자동 전투', '방어', '감싸기', 'TP 유지']) },
  63: { name: '소멸 효과', data: listed(['보통', '보스', '즉시', '사라지지 않음']) },
  64: { name: '파티 능력', data: listed(['인카운트 절반', '인카운트 없음', '기습 없음', '선제 공격 확률 업', '골드 2배', '아이템 드롭 2배']) },
};
// VX Ace's skill effects: name, what they are about, their values ([label, '%' - read as a share of 1 - or ''])
const EFFECTS = {
  11: { name: 'HP 회복', v: [['비율', '%'], ['고정', '']] },
  12: { name: 'MP 회복', v: [['비율', '%'], ['고정', '']] },
  13: { name: 'TP 증가', v: [['양', '']] },
  21: { name: '상태 부여', data: 'state0', v: [['확률', '%']] },
  22: { name: '상태 해제', data: 'state', v: [['확률', '%']] },
  31: { name: '강화 부여', data: 'param', v: [['턴', '']] },
  32: { name: '약화 부여', data: 'param', v: [['턴', '']] },
  33: { name: '강화 해제', data: 'param' },
  34: { name: '약화 해제', data: 'param' },
  41: { name: '특수 효과', data: listed(['도주']) },
  42: { name: '능력치 성장', data: 'param', v: [['양', '']] },
  43: { name: '스킬 습득', data: 'skill' },
  44: { name: '공통 이벤트', data: 'ce' },
};
const DAMAGE = ['없음', 'HP 피해', 'MP 피해', 'HP 회복', 'MP 회복', 'HP 흡수', 'MP 흡수'];
const HIT = ['확정 명중', '물리 공격', '마법 공격'];
// the database's lists, as [id, name]
const sys = () => $data.system || {};
const fromList = (arr, first = 1) => (arr || []).map((n, i) => [i, n]).filter(([i, n]) => i >= first && n);
const byId = (arr, label = o => o?.name) => (arr || []).map((o, i) => [i, label(o)]).filter(([i, n]) => i > 0 && n).map(([i, n]) => [i, `${i} ${n}`]);
const OPTIONS = {
  element: () => fromList(sys().elements),
  param: () => fromList(sys().terms?.params, 0),
  state: () => byId($data.states),
  state0: () => [[0, '통상 공격의 상태'], ...byId($data.states)],
  skill: () => byId($data.skills),
  stype: () => fromList(sys().skill_types),
  wtype: () => fromList(sys().weapon_types),
  atype: () => fromList(sys().armor_types),
  etype: () => fromList(sys().terms?.etypes, 0),
  ce: () => byId($data.commonEvents),
};
const optionsOf = d => (Array.isArray(d) ? d : d ? OPTIONS[d]() : []);
const nameIn = (d, id) => optionsOf(d).find(([i]) => i === id)?.[1] ?? `#${id}`;
const pct = v => +(v * 100).toFixed(4);
const round6 = v => Math.round(v * 1e6) / 1e6;

// a feature / an effect in words (the preview)
function featureText(f) {
  const D = FEATURES[f.code];
  if (!D) return `특징 ${f.code} (${f.data_id}, ${f.value})`;
  const what = D.data ? ` ${nameIn(D.data, f.data_id)}` : '';
  const v = D.value === 'rate' ? ` × ${pct(f.value)}%` : D.value === 'plus' ? ` ${f.value < 0 ? '' : '+'}${pct(f.value)}%` : D.value ? ` ${f.value}` : '';
  return `${D.name}${what}${v}`;
}
function effectText(e) {
  const D = EFFECTS[e.code];
  if (!D) return `효과 ${e.code} (${e.data_id}, ${e.value1}, ${e.value2})`;
  const what = D.data ? ` ${nameIn(D.data, e.data_id)}` : '';
  const vals = (D.v || []).map(([label, unit], i) => `${label} ${unit === '%' ? pct(i ? e.value2 : e.value1) + '%' : i ? e.value2 : e.value1}`).join(' · ');
  return `${D.name}${what}${vals ? ' — ' + vals : ''}`;
}

// S: the editor's state (S.items: { weapons, armors, skills } - the player's rules as edited; S.saved as saved); changed(): one of
// them changed (the head drawn again); picked(): another one picked (the head again)
export function initItems({ S, changed, picked }) {
  const $ = id => document.getElementById(id);
  const I = { kind: 'armors', id: 0, drawn: 0 };
  const data = () => $data[I.kind]?.[I.id] || null;
  const own = f => clone(data()?.[f]);
  const rule = () => S.items[I.kind]?.[I.id];
  // what it is now: the rule's, else the game's own
  const now = f => {
    const r = rule();
    if (f === 'damage') return { ...own('damage'), ...(r?.damage || {}) };
    return r && r[f] !== undefined ? clone(r[f]) : own(f);
  };

  // ------------------------------------------------------------ the list
  const items = () => ($data[I.kind] || []).map((o, id) => (o && id && o.name ? { id, label: `${id}  ${o.name}` } : null)).filter(Boolean);
  function renderList() {
    const f = $('itemFilter').value.trim().toLowerCase(), box = $('itemList'), mine = S.items[I.kind] || {};
    box.innerHTML = '';
    for (const it of items()) {
      if (f && !it.label.toLowerCase().includes(f) && String(it.id) !== f) continue;
      const d = document.createElement('div');
      d.textContent = it.label; d.title = it.label;
      if (it.id === I.id) d.className = 'on';
      if (mine[it.id]) d.classList.add('user');
      d.onclick = () => pick(it.id);
      box.appendChild(d);
      if (it.id === I.id && !f) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest' }));
    }
  }
  $('itemFilter').addEventListener('input', renderList);
  $('itemKind').addEventListener('change', () => {
    I.kind = $('itemKind').value;
    document.body.dataset.itemkind = I.kind;
    I.id = items()[0]?.id || 0;
    showItem();
  });
  function pick(id) { I.id = id; showItem(); }

  // ------------------------------------------------------------ the form
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
  const select = (opts, value) => {
    const s = el('select');
    for (const [v, label] of opts) s.append(el('option', { value: String(v), textContent: label }));
    s.value = String(value);
    if (s.value !== String(value)) { s.append(el('option', { value: String(value), textContent: `#${value}` })); s.value = String(value); }
    return s;
  };
  const numIn = (value, step = 'any', width = 0) => { const i = el('input', { type: 'number', step, value: String(value) }); if (width) i.style.width = width + 'px'; return i; };
  const del = onclick => el('button', { textContent: '✕', title: '이 줄을 지움', onclick });

  // a feature row: its kind, what it is about, its value
  function featureRow(f) {
    const D = FEATURES[f.code] || {};
    const row = el('div', { className: 'frow' });
    const code = select(Object.entries(FEATURES).map(([c, d]) => [c, d.name]), f.code);
    code.className = 'f-code';
    row.append(code);
    if (D.data) { const s = select(optionsOf(D.data), f.data_id); s.className = 'f-data'; row.append(s); }
    if (D.value) {
      const shown = D.value === 'rate' || D.value === 'plus' ? pct(f.value) : f.value;
      const v = numIn(shown, D.value === 'int' ? 1 : 'any');
      v.className = 'f-value';
      row.append(el('span', { className: 'unit', textContent: D.value === 'rate' ? '×' : D.value === 'plus' ? '+' : '' }), v,
        el('span', { className: 'unit', textContent: D.value === 'rate' || D.value === 'plus' ? '%' : '' }));
    }
    row.append(del(() => { row.remove(); edited(true); }));
    code.addEventListener('change', () => edited(true));
    for (const i of row.querySelectorAll('select.f-data, input')) i.addEventListener('change', () => edited());
    row.querySelector('input')?.addEventListener('input', () => edited());
    return row;
  }
  const readFeature = row => {
    const code = +row.querySelector('.f-code').value, D = FEATURES[code] || {};
    const ds = row.querySelector('.f-data'), vi = row.querySelector('.f-value');
    let value = vi ? Number(vi.value) || 0 : 0;
    if (D.value === 'rate' || D.value === 'plus') value = round6(value / 100);
    if (D.value === 'int') value = Math.round(value);
    // (a kind just changed: what it is about and its value start as the database starts them)
    const data_id = ds && optionsOf(D.data).some(([i]) => String(i) === ds.value) ? +ds.value : (optionsOf(D.data)[0]?.[0] ?? 0);
    if (!vi && D.value) value = D.value === 'rate' ? 1 : D.value === 'int' ? 1 : 0;
    return { code, data_id, value: D.value ? value : 0 };
  };
  // an effect row
  function effectRow(e) {
    const D = EFFECTS[e.code] || {};
    const row = el('div', { className: 'frow' });
    const code = select(Object.entries(EFFECTS).map(([c, d]) => [c, d.name]), e.code);
    code.className = 'e-code';
    row.append(code);
    if (D.data) { const s = select(optionsOf(D.data), e.data_id); s.className = 'e-data'; row.append(s); }
    (D.v || []).forEach(([label, unit], k) => {
      const v = numIn(unit === '%' ? pct(k ? e.value2 : e.value1) : (k ? e.value2 : e.value1));
      v.className = `e-v${k + 1}`;
      row.append(el('span', { className: 'unit', textContent: label }), v, el('span', { className: 'unit', textContent: unit }));
    });
    row.append(del(() => { row.remove(); edited(true); }));
    code.addEventListener('change', () => edited(true));
    for (const i of row.querySelectorAll('select.e-data, input')) { i.addEventListener('change', () => edited()); if (i.tagName === 'INPUT') i.addEventListener('input', () => edited()); }
    return row;
  }
  const readEffect = row => {
    const code = +row.querySelector('.e-code').value, D = EFFECTS[code] || {};
    const ds = row.querySelector('.e-data');
    const data_id = ds && optionsOf(D.data).some(([i]) => String(i) === ds.value) ? +ds.value : (optionsOf(D.data)[0]?.[0] ?? 0);
    const vals = (D.v || []).map(([, unit], k) => {
      const i = row.querySelector(`.e-v${k + 1}`);
      if (!i) return unit === '%' ? 1 : 0;                       // (a kind just changed: 100% / nothing)
      const n = Number(i.value) || 0;
      return unit === '%' ? round6(n / 100) : n;
    });
    return { code, data_id, value1: vals[0] ?? 0, value2: vals[1] ?? 0 };
  };

  // the form drawn from what it is now
  function drawForm() {
    const equip = I.kind !== 'skills';
    if (equip) {
      const box = $('featRows');
      box.innerHTML = '';
      for (const f of now('features') || []) box.append(featureRow(f));
      const pr = $('paramRows'), params = now('params') || [0, 0, 0, 0, 0, 0, 0, 0], names = sys().terms?.params || [];
      pr.innerHTML = '';
      params.forEach((v, k) => {
        const i = numIn(v, 1, 70); i.dataset.k = k;
        i.addEventListener('change', () => edited()); i.addEventListener('input', () => edited());
        pr.append(el('label', {}, [names[k] || `#${k}`, i]));
      });
    } else {
      const box = $('effRows');
      box.innerHTML = '';
      for (const e of now('effects') || []) box.append(effectRow(e));
      const d = now('damage');
      $('dmgType').innerHTML = ''; for (const [v, n] of DAMAGE.map((n, i) => [i, n])) $('dmgType').append(el('option', { value: String(v), textContent: n }));
      $('dmgType').value = String(d.type ?? 0);
      const els = [[-1, '통상 공격의 속성'], [0, '없음'], ...fromList(sys().elements)];
      $('dmgElement').innerHTML = ''; for (const [v, n] of els) $('dmgElement').append(el('option', { value: String(v), textContent: n }));
      $('dmgElement').value = String(d.element_id ?? 0);
      $('dmgFormula').value = d.formula || '';
      $('dmgVariance').value = d.variance ?? 0;
      $('dmgCritical').checked = !!d.critical;
      $('hitType').innerHTML = ''; for (const [v, n] of HIT.map((n, i) => [i, n])) $('hitType').append(el('option', { value: String(v), textContent: n }));
      $('hitType').value = String(now('hit_type') ?? 0);
      $('hitRate').value = now('success_rate') ?? 100;
      $('hitRepeats').value = now('repeats') ?? 1;
      $('costMp').value = now('mp_cost') ?? 0;
      $('costTp').value = now('tp_cost') ?? 0;
    }
    $('itemNote').value = now('note') || '';
    $('itemDesc').value = now('description') || '';
  }
  // the form read -> what it now is, field by field
  function readForm() {
    const out = { note: $('itemNote').value, description: $('itemDesc').value };
    if (I.kind !== 'skills') {
      out.features = [...$('featRows').children].map(readFeature);
      out.params = [...$('paramRows').querySelectorAll('input')].map(i => Math.round(Number(i.value) || 0));
    } else {
      out.effects = [...$('effRows').children].map(readEffect);
      out.damage = { type: +$('dmgType').value, element_id: +$('dmgElement').value, formula: $('dmgFormula').value, variance: Math.max(0, Math.min(100, Math.round(Number($('dmgVariance').value) || 0))), critical: $('dmgCritical').checked };
      out.hit_type = +$('hitType').value;
      out.success_rate = Math.max(0, Math.min(100, Math.round(Number($('hitRate').value) || 0)));
      out.repeats = Math.max(1, Math.min(9, Math.round(Number($('hitRepeats').value) || 1)));
      out.mp_cost = Math.max(0, Math.round(Number($('costMp').value) || 0));
      out.tp_cost = Math.max(0, Math.min(100, Math.round(Number($('costTp').value) || 0)));
    }
    return out;
  }
  // (what it is about, in a shape to compare: features / effects without their class, values rounded; a text's line ends as
  // the form has them - the database's notes end their lines in CR LF, a text box gives them back as LF)
  const plain = (f, v) => {
    if (f === 'features') return (v || []).map(x => [x.code, x.data_id, round6(x.value)]);
    if (f === 'effects') return (v || []).map(x => [x.code, x.data_id, round6(x.value1), round6(x.value2)]);
    if (f === 'damage') return v ? [v.type, v.element_id, v.formula, v.variance, !!v.critical] : null;
    if (f === 'note' || f === 'description') return String(v ?? '').replace(/\r\n?/g, '\n');
    return v ?? null;
  };
  const same = (f, a, b) => JSON.stringify(plain(f, a)) === JSON.stringify(plain(f, b));
  // the form changed: the rule is what differs from the game's own (redraw: a row's kind changed, a row added or taken away)
  function edited(redraw = false) {
    if (!I.id || !data()) return;
    const next = readForm(), e = {};
    for (const [f, v] of Object.entries(next)) {
      if (f === 'damage') {
        const o = own('damage') || {}, dd = {};
        for (const k of ['type', 'element_id', 'formula', 'variance', 'critical']) if (JSON.stringify(v[k]) !== JSON.stringify(k === 'critical' ? !!o[k] : o[k])) dd[k] = v[k];
        if (Object.keys(dd).length) e.damage = dd;
      } else if (!same(f, v, own(f) ?? (f === 'note' || f === 'description' ? '' : undefined))) e[f] = v;
    }
    S.items[I.kind] ||= {};
    if (Object.keys(e).length) S.items[I.kind][I.id] = e; else delete S.items[I.kind][I.id];
    changed();
    if (redraw) drawForm();
    renderList();
    render();
  }
  $('featAdd').onclick = () => { $('featRows').append(featureRow({ code: 22, data_id: 0, value: 0 })); edited(); };
  $('effAdd').onclick = () => { $('effRows').append(effectRow({ code: 21, data_id: 1, value1: 1, value2: 0 })); edited(); };
  for (const id of ['dmgType', 'dmgElement', 'dmgCritical', 'hitType']) $(id).addEventListener('change', () => edited());
  for (const id of ['dmgFormula', 'dmgVariance', 'hitRate', 'hitRepeats', 'costMp', 'costTp', 'itemNote', 'itemDesc']) $(id).addEventListener('input', () => edited());

  function showItem() {
    $('itemKind').value = I.kind;
    document.body.dataset.itemkind = I.kind;
    drawForm();
    renderList();
    render();
    picked();
  }

  // ------------------------------------------------------------ beside: its icon, what it now does
  // (the changed fields, by their names)
  const FIELD_NAME = { features: '특징', params: '능력치', note: '메모', description: '설명', effects: '사용 효과', damage: '피해', hit_type: '명중 타입', success_rate: '성공률', repeats: '연속 횟수', mp_cost: 'MP 소비', tp_cost: 'TP 소비' };
  function source() {
    const r = rule();
    return r ? { user: true, text: '내 규칙: 바꾼 것 — ' + Object.keys(r).map(f => FIELD_NAME[f] || f).join(' · ') } : { user: false, text: '원작 데이터 그대로' };
  }
  async function render() {
    if (document.body.dataset.tab !== 'item') return;
    const token = ++I.drawn, cv = $('previewCv'), note = $('previewNote'), o = data();
    const icons = o ? await loadCanvas('Graphics/System', 'Iconset') : null;
    if (token !== I.drawn) return;
    const k = 6;
    cv.width = 24 * k; cv.height = 24 * k;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (icons && o?.icon_index > 0) g.drawImage(icons, (o.icon_index % 16) * 24, Math.floor(o.icon_index / 16) * 24, 24, 24, 0, 0, cv.width, cv.height);
    if (!o) { note.textContent = ''; return; }
    const lines = [`${KIND_NAME[I.kind]} ${I.id}  ${o.name}`, source().text, ''];
    if (now('description')) lines.push(now('description').replace(/\r?\n/g, ' '), '');
    if (I.kind !== 'skills') {
      const fs = now('features') || [];
      lines.push(fs.length ? fs.map(featureText).join('\n') : '특징 없음');
      const ps = now('params') || [], names = sys().terms?.params || [];
      const plus = ps.map((v, i) => (v ? `${names[i] || '#' + i} ${v > 0 ? '+' : ''}${v}` : '')).filter(Boolean);
      if (plus.length) lines.push('', plus.join(' · '));
    } else {
      const d = now('damage');
      lines.push(`${HIT[now('hit_type') ?? 0]} · 성공률 ${now('success_rate') ?? 100}% · ${now('repeats') ?? 1}회 · MP ${now('mp_cost') ?? 0} · TP ${now('tp_cost') ?? 0}`);
      if (d.type) lines.push(`${DAMAGE[d.type]} · ${d.element_id === -1 ? '통상 공격의 속성' : d.element_id ? nameIn('element', d.element_id) : '속성 없음'} · ${d.formula} · 분산 ${d.variance}%${d.critical ? ' · 치명타' : ''}`);
      const es = now('effects') || [];
      lines.push('', es.length ? es.map(effectText).join('\n') : '사용 효과 없음');
    }
    const tags = (now('note') || '').match(/<[^<>\r\n]+>/g) || [];
    if (tags.length) lines.push('', '메모의 태그: ' + tags.join(' '));
    note.textContent = lines.join('\n');
  }

  return {
    I, render,
    // the tab opened: its list, and the first one picked
    show() { if (!I.id) I.id = items()[0]?.id || 0; showItem(); },
    pick(kind, id) { I.kind = kind; I.id = id; showItem(); },
    // the head: what is picked, and where what it now is comes from
    head() {
      const o = data();
      return { title: o ? `${KIND_NAME[I.kind]} ${I.id}  ${o.name}` : '장비나 스킬을 고르세요', ...(o ? source() : { text: '', user: false }) };
    },
    // 되돌리기: as saved
    revert() {
      if (!I.id) return;
      const saved = S.saved[I.kind]?.[I.id];
      S.items[I.kind] ||= {};
      if (saved) S.items[I.kind][I.id] = clone(saved); else delete S.items[I.kind][I.id];
      changed();
      showItem();
    },
    // 내 규칙 지우기: the game's own again
    clear() {
      if (!I.id) return;
      delete S.items[I.kind]?.[I.id];
      changed();
      showItem();
    },
  };
}
