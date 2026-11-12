// The rule editor's 동료 and 적 tabs (mapedit.html - mapedit.js keeps the rules and saves them): the player's own rules for how
// a companion looks (allies.js: lookOf - the player's rule, else BLACK SOULS II's LOOK, else autoLook, the general rule) and for
// whether an enemy holds its place in a fight (combat/common.js holdsPlace) - each shown as the game would take it, its picture
// drawn beside.
import { $data } from '../data.js';
import { listFiles, loadCanvas } from '../assets.js';
import { lookOf, bs2Look, autoLook } from '../allies.js';
import { holdsPlace, HOLDS_PLACE } from '../combat/common.js';
import { builtinRules } from '../maphints.js';
import { sheetInfo } from '../sprites.js';

const clone = o => JSON.parse(JSON.stringify(o));
const FOLDER = { chip: 'Graphics/Characters', face: 'Graphics/Faces', book: 'Graphics/Pictures', battler: 'Graphics/Battlers' };
const KIND = { chip: '캐릭터 칩', face: '얼굴', book: '그림', battler: '전투 그림' };
const kindOf = L => (L?.book ? 'book' : L?.battler ? 'battler' : L?.face ? 'face' : L?.chip ? 'chip' : '');
const ids = s => [...new Set(String(s).split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0))];
// the files of a folder, by the names the game's data uses (no extension; the RTP's too)
const filesCache = new Map();
function filesOf(folder) {
  if (!filesCache.has(folder)) {
    const names = listFiles(folder + '/').map(p => p.replace(/^rtp:/, '').slice(folder.length + 1).replace(/\.[^.]+$/, ''));
    filesCache.set(folder, [...new Set(names)].filter(n => n && !n.includes('/')).sort());
  }
  return filesCache.get(folder);
}

// S: the editor's state (S.comp, S.foes: the player's companion and enemy rules as edited; S.saved: as saved); changed(): one of
// them changed (the game's view of the rules put in step, the head drawn again); picked(): another one picked (the head again)
export function initRoster({ S, changed, picked }) {
  const $ = id => document.getElementById(id);
  const R = { ally: 0, foe: 0, drawn: 0 };

  // ------------------------------------------------------------ the lists
  const actorList = () => $data.actors.map((a, id) => (a && id && (a.name || a.character_name || a.face_name) ? { id, label: `${id}  ${a.name || ''}` } : null)).filter(Boolean);
  const enemyList = () => $data.enemies.map((e, id) => (e && id && (e.name || e.battler_name) ? { id, label: `${id}  ${e.name || ''}` } : null)).filter(Boolean);
  function renderList(box, items, filter, on, mine, pick) {
    const f = filter.trim().toLowerCase();
    box.innerHTML = '';
    for (const it of items) {
      if (f && !it.label.toLowerCase().includes(f) && String(it.id) !== f) continue;
      const d = document.createElement('div');
      d.textContent = it.label; d.title = it.label;
      if (it.id === on) d.className = 'on';
      if (mine[it.id]) d.classList.add('user');
      d.onclick = () => pick(it.id);
      box.appendChild(d);
      if (it.id === on && !f) requestAnimationFrame(() => d.scrollIntoView({ block: 'nearest' }));
    }
  }
  const allyItems = () => renderList($('allyList'), actorList(), $('allyFilter').value, R.ally, S.comp, pickAlly);
  const foeItems = () => renderList($('foeList'), enemyList(), $('foeFilter').value, R.foe, S.foes, pickFoe);
  $('allyFilter').addEventListener('input', allyItems);
  $('foeFilter').addEventListener('input', foeItems);

  // ------------------------------------------------------------ companions
  // what the game draws it as: the player's rule, else BLACK SOULS II's, else the general rule's
  const lookNow = id => {
    const L = lookOf(id), auto = autoLook(id);
    return kindOf(L) ? L : { ...auto, ...(L || {}) };
  };
  function allyFrom(id) {
    const L = lookNow(id), k = kindOf(L), v = L[k];
    const what = k === 'book' ? `${KIND.book} ${L.book.map(p => p[0]).join(', ')}` : k === 'battler' ? `${KIND.battler} ${v}` : k ? `${KIND[k]} ${v[0]} · ${v[1]}번` : '';
    const more = [L.wall ? `벽 ${L.wall}m` : '', L.with?.length ? `한 몸: ${L.with.join(', ')}` : ''].filter(Boolean).join(' · ');
    const src = S.comp[id] ? '내 규칙' + (kindOf(S.comp[id]) ? '' : ' (모습은 일반 규칙)') : bs2Look(id) ? '블랙소울 전용 규칙' : '일반 규칙';
    return { user: !!S.comp[id], text: `${src}: ${what}${more ? ' · ' + more : ''}` };
  }
  function pickAlly(id) { R.ally = id; showAlly(); }
  // the form from the look in force (the player's rule, BLACK SOULS II's, or - kind 자동 - the general rule's picture shown)
  function showAlly() {
    const id = R.ally, own = S.comp[id], L = own ? lookOf(id) || {} : bs2Look(id) || {}, k = kindOf(L);
    $('allyKind').value = k;
    const shown = k ? L : autoLook(id), sk = kindOf(shown);
    $('allyFile').value = sk === 'book' ? shown.book[0][0] : sk === 'battler' ? shown.battler : sk ? shown[sk][0] : '';
    $('allyIndex').value = sk === 'chip' || sk === 'face' ? shown[sk][1] : 0;
    $('allyWall').value = L.wall || '';
    $('allyWith').value = (L.with || []).join(', ');
    formState();
    allyItems();
    render();
    picked();
  }
  function formState() {
    const k = $('allyKind').value;
    $('allyFile').disabled = $('allyIndex').disabled = !k;
    $('allyIndexL').style.display = k === 'chip' || k === 'face' ? '' : 'none';
    const list = $('allyFiles');
    list.innerHTML = '';
    for (const n of k ? filesOf(FOLDER[k]) : []) { const o = document.createElement('option'); o.value = n; list.appendChild(o); }
  }
  // the form as the player's rule for it
  function formEntry() {
    const id = R.ally, k = $('allyKind').value, file = $('allyFile').value.trim(), index = Math.max(0, Math.round(Number($('allyIndex').value) || 0));
    const e = {};
    if (k && file) {
      if (k === 'book') { const prev = (S.comp[id] || bs2Look(id) || {}).book; e.book = prev?.[0]?.[0] === file ? clone(prev) : [[file, 0, 0]]; }
      else if (k === 'battler') e.battler = file;
      else e[k] = [file, index];
    }
    const wall = Number($('allyWall').value);
    if (wall > 0) e.wall = Math.min(10, wall);
    const w = ids($('allyWith').value).filter(n => n !== id);
    if (w.length) e.with = w;
    return e;
  }
  function allyEdited() {
    if (!R.ally) return;
    S.comp[R.ally] = formEntry();
    changed();
    allyItems();
    render();
  }
  $('allyKind').addEventListener('change', () => {
    // (a kind picked: the actor's own file of that kind to start from)
    const d = $data.actors[R.ally] || {}, k = $('allyKind').value;
    $('allyFile').value = k === 'chip' ? d.character_name || '' : k === 'face' ? d.face_name || '' : '';
    $('allyIndex').value = k === 'chip' ? d.character_index || 0 : k === 'face' ? d.face_index || 0 : 0;
    formState();
    allyEdited();
  });
  for (const el of ['allyFile', 'allyIndex', 'allyWall', 'allyWith']) $(el).addEventListener('change', allyEdited);
  $('allyIndex').addEventListener('input', allyEdited);

  // ------------------------------------------------------------ enemies
  function foeFrom(id) {
    const d = $data.enemies[id] || {}, own = S.foes[id];
    const held = holdsPlace(id), bs2 = builtinRules() && HOLDS_PLACE.includes(d.battler_name);
    const src = own ? '내 규칙' : bs2 ? '블랙소울 전용 규칙' : '일반 규칙';
    return { user: !!own, text: `${src}: ${held ? '제자리에 서 있음 (걷지 않고 밀려나지 않음)' : '움직임 (다가오고 밀려남)'}` };
  }
  function pickFoe(id) { R.foe = id; showFoe(); }
  function showFoe() {
    const own = S.foes[R.foe], v = own ? (own.holdPlace ? 'hold' : 'move') : '';
    for (const r of document.querySelectorAll('input[name="foeHold"]')) r.checked = r.value === v;
    foeItems();
    render();
    picked();
  }
  for (const r of document.querySelectorAll('input[name="foeHold"]')) r.addEventListener('change', () => {
    if (!R.foe || !r.checked) return;
    if (r.value) S.foes[R.foe] = { holdPlace: r.value === 'hold' }; else delete S.foes[R.foe];
    changed();
    foeItems();
    render();
  });

  // ------------------------------------------------------------ the picture
  const tab = () => document.body.dataset.tab;
  async function render() {
    const t = tab(), token = ++R.drawn, cv = $('previewCv'), note = $('previewNote');
    let c = null, rect = null, scale = 1, text = '';
    if (t === 'ally' && R.ally) {
      const L = lookNow(R.ally), k = kindOf(L), v = L[k];
      if (k === 'book') c = await loadCanvas(FOLDER.book, v[0][0]);
      else if (k === 'battler') c = await loadCanvas(FOLDER.battler, v);
      else if (k === 'face') {
        c = await loadCanvas(FOLDER.face, v[0]);
        if (c) { const cols = Math.max(1, Math.floor(c.width / 96)); rect = [(v[1] % cols) * 96, Math.floor(v[1] / cols) * 96, 96, 96]; scale = 2; }
      } else if (k === 'chip') {
        c = await loadCanvas(FOLDER.chip, v[0]);
        if (c) {
          const info = sheetInfo(v[0], c), i = info.single ? 0 : v[1] % 8;
          rect = [((i % 4) * 3 + 1) * info.fw, Math.floor(i / 4) * 4 * info.fh, info.fw, info.fh];
          scale = Math.max(2, Math.floor(240 / Math.max(info.fw, info.fh)));
        }
      }
      text = allyFrom(R.ally).text + (k && !c ? '\n파일을 찾지 못했습니다 — 게임에서는 일반 규칙의 모습으로 나옵니다' : '');
    } else if (t === 'foe' && R.foe) {
      const d = $data.enemies[R.foe] || {};
      c = d.battler_name ? await loadCanvas(FOLDER.battler, d.battler_name, d.battler_hue || 0) : null;
      text = foeFrom(R.foe).text;
    }
    if (token !== R.drawn) return;
    const [sx, sy, sw, sh] = rect || [0, 0, c?.width || 1, c?.height || 1];
    cv.width = Math.max(1, Math.round(sw * scale)); cv.height = Math.max(1, Math.round(sh * scale));
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = scale < 2;
    if (c) g.drawImage(c, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    note.textContent = text;
  }

  return {
    R, render,
    // the tab opened: its list, and the first one picked
    show(t) {
      if (t === 'ally') { if (!R.ally) R.ally = actorList()[0]?.id || 0; showAlly(); }
      if (t === 'foe') { if (!R.foe) R.foe = enemyList()[0]?.id || 0; showFoe(); }
    },
    pickAlly, pickFoe,
    // the head: what is picked, and where its rule comes from
    head() {
      const ally = tab() === 'ally', id = ally ? R.ally : R.foe;
      const name = ally ? $data.actors[id]?.name : $data.enemies[id]?.name;
      return { title: id ? `${ally ? '동료' : '적'} ${id}  ${name || ''}` : (ally ? '동료를 고르세요' : '적을 고르세요'), ...(id ? (ally ? allyFrom(id) : foeFrom(id)) : { text: '', user: false }) };
    },
    // 되돌리기: as saved
    revert() {
      const ally = tab() === 'ally', id = ally ? R.ally : R.foe, mine = ally ? S.comp : S.foes, saved = ally ? S.saved.companions : S.saved.enemies;
      if (!id) return;
      if (saved[id]) mine[id] = clone(saved[id]); else delete mine[id];
      changed();
      if (ally) showAlly(); else showFoe();
    },
    // 내 규칙 지우기
    clear() {
      const ally = tab() === 'ally', id = ally ? R.ally : R.foe;
      if (!id) return;
      delete (ally ? S.comp : S.foes)[id];
      changed();
      if (ally) showAlly(); else showFoe();
    },
  };
}
