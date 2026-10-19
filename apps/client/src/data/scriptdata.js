// Reads configuration tables out of the game's own RGSS scripts (Scripts.rvdata2) at runtime:
// name-window speaker names, bonfire warp list, symbol-encounter settings, the SEN reminder and the menu's SEN
// window, and the message font size and screen size (BLACKSOULS II: Font.default_size = 19 in Scene_Base,
// Graphics.resize_screen(640, 480)).
import { G } from '../core/globals.js';
import { loadRvdata } from './data.js';
import { bytesToString } from './marshal.js';

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}

// BLACKSOULS II's SEN reminder ("sen変動リマインダー"): Control Variables on the SEN variable keeps some switches
// up to date (SEN at or below 0 / 30 / 70) and - but for its reset to full - shows the change on a strip: a
// small tab ("SEN 상승" / "SEN 저하!") over the value now, coloured by how high it is, with a sound
function senReminder(src) {
  const m = /variable_id\s*==\s*(\d+)\s*&&\s*!\(\s*operation_type\s*==\s*0\s*&&\s*value\s*==\s*(-?\d+)\s*\)/.exec(src);
  if (!m) return null;
  const sen = { variable: +m[1], reset: +m[2], switches: [], se: [], colors: [], color: 0, labels: ['', ''], note: '', icon: 0 };
  for (const s of src.matchAll(/\$game_switches\[(\d+)\]\s*=\s*\$game_variables\[(\d+)\]\s*<=\s*(-?\d+)/g)) if (+s[2] === sen.variable) sen.switches.push([+s[1], +s[3]]);
  // (the rising one first, then the falling one)
  for (const s of src.matchAll(/se_play\(\s*['"](?:Audio\/SE\/)?([^'"]+)['"]\s*(?:,\s*(\d+))?\s*(?:,\s*(\d+))?\s*\)/g)) sen.se.push({ name: s[1], volume: +(s[2] ?? 100), pitch: +(s[3] ?? 100) });
  const block = /\bcolor\s*=\s*([\s\S]*?)\n\s*text\s*=/.exec(src)?.[1] || '';
  for (const c of block.matchAll(/>\s*(-?\d+)\s*\?\s*(\d+)/g)) sen.colors.push([+c[1], +c[2]]);
  sen.color = +(/:\s*(\d+)\s*$/.exec(block.trim())?.[1] ?? 0);
  const t = /text\s*=\s*value\s*>\s*0\s*\?\s*"([^"]*)"\s*:\s*"([^"]*)"/.exec(src);
  if (t) sen.labels = [t[1], t[2]];
  sen.note = /note\s*=\s*"([^"#]*)#\{/.exec(src)?.[1] ?? '';
  sen.icon = +(/draw_icon\(\s*(\d+)/.exec(src)?.[1] ?? 0);
  return sen;
}
// the synthesis shop (RGSS3 アイテム合成, 白の魔 - BLACKSOULS II's 무기 강화 at the library's bear): what each thing is
// made from - its cost and materials (an item, a weapon or an armour, how many) - and which kinds it lists
function synthesis(src) {
  if (!/WD_itemsynthesis_ini/.test(src)) return null;
  const KIND = { I: 'item', W: 'weapon', A: 'armor' };
  const clean = src.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  const out = { recipes: [], categories: [], materialLabel: /draw_text\(rect,\s*"([^"]+)",\s*0\)/.exec(src)?.[1] || '' };
  for (const m of clean.matchAll(/\b([IWA])_recipe\[(\d+)\]\s*=\s*\[\s*(\d+)\s*,([^\n]*)\]/g)) {
    const mats = [...m[4].matchAll(/\[\s*"([IWA])"\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/g)].map(x => ({ kind: KIND[x[1]], id: +x[2], n: +x[3] })).filter(x => x.id > 0);
    if (+m[2] > 0 && mats.length) out.recipes.push({ kind: KIND[m[1]], id: +m[2], cost: +m[3], mats });
  }
  // (listed as the original lists them: items, then weapons, then armours, each by id)
  const order = { item: 0, weapon: 1, armor: 2 };
  out.recipes.sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id);
  for (const [k, c] of [['i', 'item'], ['w', 'weapon'], ['a', 'armor'], ['k', 'key']]) if (new RegExp(`Category_${k}\\s*=\\s*true`).test(clean)) out.categories.push(c);
  return out;
}
// the storage (RGSS3 アイテム預かり所, 星潟 - the library bear's 창고): how much of a thing it takes, the words that
// limit or forbid it, the bag's overflow going there by itself (and the switch that holds that back), the shop's
// storage mode (its switch, its messages and sound), and the labels the list shows
function keeper(src) {
  if (!/module\s+ITEM_KEEPER/.test(src)) return null;
  const clean = src.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  const val = k => new RegExp(`\\b${k}\\s*=\\s*([^\\n]+)`).exec(clean)?.[1]?.trim() || '';
  const str = k => /^"([^"]*)"/.exec(val(k))?.[1] ?? '';
  const num = k => parseInt(val(k), 10) || 0;
  const bool = k => /^true\b/.test(val(k));
  const se = /\bSE\s*=\s*\[\s*"([^"]*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(clean);
  const labels = [...src.matchAll(/change_color\(text_color\(5\)\)\s*\r?\n\s*draw_text\([^"\n]*"([^"]+)"/g)].map(m => m[1]);
  return {
    limit: num('LIMIT') || 999, sealWord: str('WORD1') || '保存禁止', limitWord: str('WORD2') || '保存制限', hideSealed: bool('UNVISIBLE'),
    autoKeep: bool('AUTOKEEP'), autoSwitch: num('SWITCH2'),
    shop: bool('SHOP'), shopSwitch: num('SWITCH1'), toBag: str('TEXT1'), toKeep: str('TEXT2'),
    se: se ? { name: se[1], volume: +se[2], pitch: +se[3] } : null, shopCount: str('SHOP_POS'),
    bagLabel: labels[0] || '', keepLabel: labels[1] || '',
  };
}
// the difficulty (RGSS3 簡易難易度変更, ヒール): a variable picks a column of rates - the enemies' max HP, max MP,
// attack ... luck, then experience, souls, drops and critical damage (BLACKSOULS II: variable 60 - 0-9 chosen at
// 도서관의 꿈, 1.5 to 7 times as strong; the 混沌 dungeon adds one per floor, up to 19 = 100 times)
function difficulty(src) {
  if (!/module\s+Hi_ru_Difficulty/.test(src)) return null;
  const clean = src.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  const variable = +(/\bVARIABLES\s*=\s*(\d+)/.exec(clean)?.[1] || 0);
  const at = clean.indexOf('DIFFICULTY_SETTING');
  const end = clean.indexOf('\nend', at);
  if (!variable || at < 0) return null;
  const rows = [...clean.slice(at, end < 0 ? undefined : end).matchAll(/\[([\d.,\s]+)\]/g)]
    .map(m => m[1].split(',').map(x => x.trim()).filter(Boolean).map(Number));
  return rows.length >= 8 ? { variable, rows } : null;
}
// EasyCompose adds item/weapon/armor requirements to ordinary shop purchases.
// Its switch and note keyword belong to the selected game, not the port.
function exchangeShop(src) {
  const clean = speakerSource(src);
  let result;
  for (const block of clean.matchAll(/^[ \t]*module[ \t]+EasyCompose[ \t]*\n([\s\S]*?)^[ \t]*end\b/gm)) {
    result = null;
    const settings = new Map(), lines = block[1].split('\n').map(line => line.trim()).filter(Boolean);
    // Conditional/runtime configuration cannot be inferred as constant data.
    if (lines.some(line => !/^[A-Z]\w*\s*=/.test(line))) continue;
    for (const line of lines) {
      const assignment = /^([A-Z]\w*)\s*=\s*(.*?)\s*;?$/.exec(line);
      if (assignment) settings.set(assignment[1], assignment[2]);
    }
    const string = key => {
      const token = settings.get(key);
      return token && new RegExp(`^${STR}$`).test(token) ? speakerString(token) : null;
    };
    const sid = settings.get('SID'), switchId = /^\d+$/.test(sid || '') ? Number(sid) : 0, word = string('Word');
    if (!Number.isSafeInteger(switchId) || switchId <= 0 || !word) continue;
    result = { switchId, word, commandName: string('Name') ?? '', materialTitle: string('Title') ?? '',
      hideZeroPrice: settings.get('NoDraw') === 'true' };
  }
  return result;
}
// Script 160 keeps a lethal HP hit at the configured floor while its state is
// active. Read its static settings; the state ID is not an engine constant.
function gutsSettings(src) {
  const clean = speakerSource(src);
  let result;
  for (const block of clean.matchAll(/^[ \t]*module[ \t]+Nana[ \t]*\n([\s\S]*?)^[ \t]*end\b/gm)) {
    if (!/\bSTATE_KONJO\b/.test(block[1])) continue;
    result = null;
    const lines = block[1].split('\n').map(line => line.trim()).filter(Boolean), settings = new Map();
    if (lines.some(line => !/^[A-Z]\w*\s*=/.test(line))) continue;
    for (const line of lines) {
      const assignment = /^([A-Z]\w*)\s*=\s*(.*?)\s*;?$/.exec(line);
      if (assignment) settings.set(assignment[1], assignment[2]);
    }
    const number = key => /^\d+(?:\.\d+)?$/.test(settings.get(key) || '') ? Number(settings.get(key)) : NaN;
    const stateId = number('STATE_KONJO'), limit = number('KONJO_DAMAGE'), hp = number('KONJO_HP');
    const mode = settings.get('KONJO_MODE'), limitPercent = settings.get('KONJO_DAMAGE_PER'), hpPercent = settings.get('KONJO_HP_PER');
    if (!Number.isSafeInteger(stateId) || stateId <= 0 || !Number.isFinite(limit) || !Number.isFinite(hp)
      || !['true', 'false'].includes(mode) || !['true', 'false', '0', '1'].includes(limitPercent)
      || !['true', 'false'].includes(hpPercent)) continue;
    // The original compares DAMAGE_PER to numeric 1, and HP_PER to true.
    result = { stateId, limit, limitPercent: limitPercent === '1', hp, hpPercent: hpPercent === 'true', canDieAtOne: mode === 'true' };
  }
  return result;
}
// the menu's variable window ("メニュー変数": the SEN under its title, shown unless a switch is off)
function menuVariable(src) {
  const v = /Var_Num\s*=\s*(\d+)/.exec(src);
  if (!v || !/Window_Var/.test(src)) return null;
  const str = k => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(src)?.[1] ?? '';
  return { variable: +v[1], label: str('Var_Prefix'), suffix: str('Var_Suffix'), switchId: +(/Disp_SW\s*=\s*(\d+)/.exec(src)?.[1] ?? 0) };
}

// the bonfire travel list (KURE ShortMove - Scene_ShortMove, the scene the bonfires call): MOVE_LIST[i] = [[name, the switch
// that shows it, the switch that lets it be picked, the switch that takes it away], [map, x, y, direction]]; EXPLAN[i] its two
// lines, CALL_COMMON[i] the common events run on arriving. Read whatever the spacing and the quotes, and however many of the
// switches and the place it gives - in the original's order, one left out 0 (the direction: 2, as reserve_transfer has it).
// Written another way, a copy of the game gave no bonfire to travel to, ever
const SQ = String.raw`(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')`;
const STR = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
const MOVE_RE = new RegExp(String.raw`MOVE_LIST\s*\[\s*(\d+)\s*\]\s*=\s*\[\s*\[\s*${SQ}((?:\s*,\s*\d+)*)\s*\]\s*,\s*\[([\d\s,]*)\]\s*\]`, 'g');
const EXPLAN_RE = new RegExp(String.raw`EXPLAN\s*\[\s*(\d+)\s*\]\s*=\s*\[\s*(${STR}(?:\s*,\s*${STR})*)\s*\]`, 'g');
const CALL_RE = /CALL_COMMON\s*\[\s*(\d+)\s*\]\s*=\s*\[([\d,\s]*)\]/g;

// Read static speaker configuration without evaluating any installed Ruby.
// Comments may contain old translations; # inside a quoted name is real text.
function speakerSource(source) {
  let quote = null, block = false;
  return source.split(/\r?\n/).map(line => {
    if (!quote && /^=begin(?:\s|$)/.test(line)) { block = true; return ''; }
    if (block) { if (/^=end(?:\s|$)/.test(line)) block = false; return ''; }
    let live = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        live += c;
        if (c === '\\' && i + 1 < line.length) live += line[++i];
        else if (c === quote) quote = null;
      } else if (c === '#') break;
      else { live += c; if (c === '"' || c === "'") quote = c; }
    }
    return live;
  }).join('\n');
}
function speakerString(token) {
  if (!token) return null;
  const value = token.slice(1, -1);
  if (token[0] === "'") return value.replace(/\\([\\'])/g, '$1');
  // An interpolated expression is not a static translation table entry.
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') i++;
    else if (value[i] === '#' && value[i + 1] === '{') return null;
  }
  const escapes = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '#': '#' };
  return value.replace(/\\([nrt"\\#])/g, (_match, char) => escapes[char]);
}
function readSpeakerTables(source, out) {
  const assignment = new RegExp(String.raw`^[ \t]*(?:\w+::)*NAME_LIST\s*(?:\[\s*(${STR})\s*\])?\s*=\s*`, 'gm');
  const pairs = new RegExp(String.raw`(${STR})\s*=>\s*(${STR})`, 'g');
  for (const match of source.matchAll(assignment)) {
    const start = match.index + match[0].length;
    if (match[1]) {
      const key = speakerString(match[1]), value = speakerString(new RegExp(`^${STR}`).exec(source.slice(start))?.[0]);
      if (key !== null && value !== null) out.names[key] = value;
      continue;
    }
    if (source[start] !== '{') continue;
    let depth = 1, quote = null, end = start + 1;
    for (; end < source.length && depth; end++) {
      const c = source[end];
      if (quote) { if (c === '\\') end++; else if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth) continue;
    const names = {};
    for (const pair of source.slice(start + 1, end - 1).matchAll(pairs)) {
      const key = speakerString(pair[1]), value = speakerString(pair[2]);
      if (key !== null && value !== null) names[key] = value;
    }
    out.names = names; // a later Ruby constant assignment replaces the earlier hash
  }
}
function aliasSources(condition) {
  const part = new RegExp(String.raw`^name\s*==\s*(${STR})`), names = [];
  let rest = condition.replace(/\s+then\s*$/, '').trim();
  while (rest) {
    const match = part.exec(rest), value = speakerString(match?.[1]);
    if (!match || value === null) return null;
    names.push(value); rest = rest.slice(match[0].length).trim();
    if (!rest) return names;
    const join = /^(?:\|\||or\b)\s*/.exec(rest);
    if (!join) return null;
    rest = rest.slice(join[0].length);
  }
  return null;
}
function readSpeakerAliases(source, out) {
  let depth = 0, aliases, chain = null;
  const finishBranch = () => {
    if (!chain?.safe) return;
    const assignment = chain.body.length === 1 ? new RegExp(String.raw`^name\s*=\s*(${STR})\s*;?$`).exec(chain.body[0]) : null;
    const target = speakerString(assignment?.[1]);
    for (const name of chain.names) {
      if (!chain.seen.has(name) && target !== null) chain.pairs.set(name, target);
      chain.seen.add(name); // the first matching if/elsif branch wins
    }
  };
  const finishChain = () => {
    finishBranch();
    if (chain) {
      // Separate consecutive if chains execute in sequence in the original.
      const keys = new Set([...Object.keys(aliases), ...chain.pairs.keys()]);
      for (const key of keys) { const value = aliases[key] ?? key; aliases[key] = chain.pairs.get(value) ?? value; }
    }
    chain = null;
  };
  for (const raw of source.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (!depth) {
      if (/^def\s+show_name_window(?:\s|\(|$)/.test(line)) { depth = 1; aliases = {}; }
      continue;
    }
    if (/^end\b/.test(line)) {
      if (depth === 2) finishChain();
      if (--depth === 0) out.nameAliases = aliases; // last method definition wins
      continue;
    }
    if (depth === 2 && chain && /^(?:elsif|else)\b/.test(line)) {
      finishBranch();
      const names = /^elsif\s+(.+)$/.exec(line);
      chain.names = names ? aliasSources(names[1]) : null;
      chain.safe &&= !!chain.names; chain.body = [];
      continue;
    }
    if (depth === 1 && /^if\s+/.test(line)) {
      const names = aliasSources(line.slice(3));
      chain = { names, safe: !!names, seen: new Set(), pairs: new Map(), body: [] };
    } else if (depth === 2 && chain) chain.body.push(line);
    if (/^(?:if|unless|case|while|until|for|begin|def|class|module)\b/.test(line) || /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line)) depth++;
  }
}
export function bonfireList(src) {
  const live = src.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
  const unq = (a, b) => (a ?? b ?? '').replace(/\\(.)/g, '$1');
  const ints = s => s.split(',').map(t => t.trim()).filter(Boolean).map(Number);
  const explan = {}, calls = {}, out = [];
  for (const m of live.matchAll(EXPLAN_RE)) explan[+m[1]] = [...[...m[2].matchAll(new RegExp(SQ, 'g'))].map(s => unq(s[1], s[2])), '', ''].slice(0, 2);
  for (const m of live.matchAll(CALL_RE)) calls[+m[1]] = ints(m[2]).filter(Boolean);
  for (const m of live.matchAll(MOVE_RE)) {
    const i = +m[1], [switchId = 0, selectSw = 0, eraseSw = 0] = ints(m[4]), [mapId, x, y, dir = 2] = ints(m[5]);
    if (!mapId || y === undefined) continue;
    out.push({ index: i, name: unq(m[2], m[3]), switchId, selectSw, eraseSw, mapId, x, y, dir, desc: explan[i] || ['', ''], commons: calls[i] || [] });
  }
  return out.sort((a, b) => a.index - b.index);
}
// which bonfires the travel list shows, and which of those can be picked - as the original's window has it
// (Window_k_ShortMove_Command visible? / selectable?): one taken away (its switch on) is gone; one that can be taken away but is
// not yet is there whatever else; else a switch of 0 shows it always, any other only when on. Picking it needs its switch (0: always)
export function bonfireShown(b, sw) {
  if (b.eraseSw) return !sw(b.eraseSw);
  return !b.switchId || sw(b.switchId);
}
export function bonfirePickable(b, sw) { return !b.selectSw || sw(b.selectSw); }

export async function loadScriptData() {
  let scripts;
  try { scripts = await loadRvdata('Scripts'); } catch (e) { console.warn('Scripts.rvdata2 not readable', e); return (G.scripts = readScripts([])); }
  const entries = [];
  for (const [, nameRaw, code] of scripts) {
    if (!(code instanceof Uint8Array)) continue;
    try { entries.push([bytesToString(nameRaw), await inflate(code)]); } catch { /* not a script */ }
  }
  const out = readScripts(entries);
  G.scripts = out;
  console.log(`[scripts] names ${Object.keys(out.names).length}, bonfires ${out.bonfires.length}, symbols ${Object.keys(out.symbols).length}, synthesis recipes ${out.synthesis?.recipes.length || 0}, storage ${out.keep ? 'up to ' + out.keep.limit : 'none'}, difficulty ${out.difficulty ? 'v' + out.difficulty.variable : 'none'}, font ${out.fontSize || 'default'}, screen ${out.screen ? out.screen.join('x') : 'default'}, SEN ${out.sen ? 'v' + out.sen.variable : 'none'}, menu variable ${out.menuVar ? 'v' + out.menuVar.variable : 'none'}`);
  return out;
}
// what the game's scripts set up, from their sections ([name, source] in the game's order)
export function readScripts(entries) {
  const out = { names: {}, nameAliases: {}, bonfires: [], symbols: {}, fontSize: 0, screen: null, sen: null, menuVar: null, synthesis: null, keep: null, difficulty: null, exchangeShop: null, guts: null };
  const want = { name: 'ネームウィンドウ', bonfire: '篝火移動', symbol: 'シンボル' };
  // (each by its section's name as the game names it - else by what it holds: a translation may name the section otherwise,
  // and none of it was read - no bonfire to travel to, no speakers' names, the roaming monsters' own settings gone)
  const holds = {
    name: s => /NAME_LIST\s*=\s*\{/.test(s),
    bonfire: s => /Scene_ShortMove/.test(s) && /MOVE_LIST\s*\[\s*\d+\s*\]\s*=/.test(s),
    symbol: s => /SYMBOL_SETTING_LIST\s*=\s*\{/.test(s),
  };
  const byName = {}, byContent = {};
  for (const [name, src] of entries) {
    const speakers = speakerSource(src);
    readSpeakerTables(speakers, out); readSpeakerAliases(speakers, out);
    // font size / screen size: the last assignment in script order wins (comment lines skipped)
    const live = src.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
    for (const m of live.matchAll(/Font\.default_size\s*=\s*(\d+)/g)) out.fontSize = +m[1];
    for (const m of live.matchAll(/Graphics\.resize_screen\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)) out.screen = [+m[1], +m[2]];
    out.sen = senReminder(live) || out.sen;
    out.menuVar = menuVariable(live) || out.menuVar;
    out.synthesis = synthesis(src) || out.synthesis;
    out.keep = keeper(src) || out.keep;
    out.difficulty = difficulty(src) || out.difficulty;
    const exchange = exchangeShop(src);
    if (exchange !== undefined) out.exchangeShop = exchange;
    const guts = gutsSettings(src);
    if (guts !== undefined) out.guts = guts;
    for (const k of Object.keys(want)) {
      if (name === want[k]) (byName[k] ||= []).push(src);
      else if (!byContent[k] && holds[k](src)) byContent[k] = src;
    }
  }
  for (const key of Object.keys(want)) for (const src of byName[key] || (byContent[key] ? [byContent[key]] : [])) {
    if (key === 'bonfire') {
      out.bonfires.push(...bonfireList(src));
      out.bonfires.sort((a, b) => a.index - b.index);
    } else if (key === 'symbol') {
      const clean = src.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
      const block = /SYMBOL_SETTING_LIST\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(clean)?.[1] || '';
      for (const m of block.matchAll(/(\d+)\s*=>\s*\[\s*([-\d\s,]+?),\s*\[([\d\s,]*)\]\s*\]/g)) {
        const v = m[2].split(',').map(s => +s.trim());
        out.symbols[+m[1]] = {
          fleeLevel: v[0], levelType: v[1], range: v[2], dashRange: v[3], idleMode: v[4], fadeRange: v[5],
          speedBefore: v[6], speedAfter: v[7], freqBefore: v[8], freqAfter: v[9], balloon: v[10],
          blockedRegions: m[3].split(',').map(s => +s).filter(Boolean),
        };
      }
    }
  }
  for (const key of Object.keys(want)) if (entries.length && !byName[key] && !byContent[key]) console.warn(`[scripts] no ${want[key]} script found`);
  return out;
}
