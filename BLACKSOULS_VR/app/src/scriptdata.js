// Reads configuration tables out of the game's own RGSS scripts (Scripts.rvdata2) at runtime:
// name-window speaker names, bonfire warp list, symbol-encounter settings, the SEN reminder and the menu's SEN
// window, the message font size and screen size (BLACKSOULS II: Font.default_size = 19 in Scene_Base,
// Graphics.resize_screen(640, 480)) and the fonts the scripts name (fontSettings).
import { G } from './globals.js';
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
// the compose shop (RGSS3 簡易アイテム合成ショップ, 星潟 - 지하감옥's candy merchant): with its switch on, a shop asks for each
// good the things its note names (<合成設定:kind,id,n> - candies) on top of its price; its buy command named for it, the
// title of what it takes, and a price of 0 not shown
function composeShop(src) {
  if (!/module\s+EasyCompose/.test(src)) return null;
  const clean = src.split(/\r?\n/).map(l => l.replace(/#.*$/, '')).join('\n');
  const val = k => new RegExp(`\\b${k}\\s*=\\s*([^\\n]+)`).exec(clean)?.[1]?.trim() || '';
  const str = k => /^"([^"]*)"/.exec(val(k))?.[1] ?? '';
  return { switchId: parseInt(val('SID'), 10) || 0, word: str('Word') || '合成設定', name: str('Name'), title: str('Title'), noDraw: /^true\b/.test(val('NoDraw')) };
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
// the menu's own words and windows that scripts add: the oath command (VXAce-RGSS3-38 精霊システム: add_command("서약",
// :partner)) and the place window (マップ名ウィンドウ: Window_Mapname - its title, size and place on the menu screen)
function menuParts(src, out) {
  const partner = /add_command\(\s*"([^"]+)"\s*,\s*:partner\b/.exec(src);
  if (partner) out.partnerCommand = partner[1];
  if (/class\s+Window_Mapname\b/.test(src)) {
    const num = re => +(re.exec(src)?.[1] ?? NaN);
    const w = num(/def\s+window_width\s+return\s+(\d+)/), h = num(/def\s+window_height\s+return\s+(\d+)/);
    const x = num(/@map_window\.x\s*=\s*(\d+)/), y = num(/@map_window\.y\s*=\s*(\d+)/);
    out.placeWindow = {
      label: /draw_text\([^)\n]*"([^"]+)"\s*\)/.exec(src)?.[1] || '',
      x: Number.isFinite(x) ? x : 440, y: Number.isFinite(y) ? y : 400, w: Number.isFinite(w) ? w : 200, h: Number.isFinite(h) ? h : 78,
    };
  }
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
// the fonts the scripts name (fonts.js): Font.default_name - a name, an array of them (tried in turn) or a constant
// holding one (the Korean copy: Omega_Font::Custom_Font = ["나눔고딕","VL Gothcic"]) -, the name window's (its NAME_FONT)
// and Font.default_outline / out_color / shadow / bold / italic; the last in the scripts' order wins (lives: the sections'
// sources - their comments, # lines and =begin..=end blocks, left out). names / nameWindow null: none named (RGSS3's own
// default; the game's default)
function uncomment(line) {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '#') return line.slice(0, i);
  }
  return line;
}
function rubyStrings(s) {
  const out = [];
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) out.push((m[1] ?? m[2]).replace(/\\(.)/g, '$1'));
  return out;
}
export function fontSettings(sources) {
  const lives = sources.map(src => src.replace(/^=begin\b[\s\S]*?^=end\b.*$/gm, '').split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n'));
  const consts = new Map();
  for (const live of lives) for (const m of live.matchAll(/^[ \t]*([A-Z]\w*)\s*=(?!=)\s*(.+)$/gm)) consts.set(m[1], m[2]);
  const names = (expr, depth = 0) => {
    const e = uncomment(expr).trim();
    if (!e || depth > 4 || /^Font\.default_name\b/.test(e)) return null;          // (another's: the game's default)
    if (e[0] === '"' || e[0] === "'") return rubyStrings(e).slice(0, 1);
    if (e[0] === '[') { const list = rubyStrings(e); return list.length ? list : null; }
    const w = /^%w[([{](.*?)[)\]}]/.exec(e);
    if (w) return w[1].trim().split(/\s+/).filter(Boolean);
    const c = /^(?:[A-Z]\w*::)*([A-Z]\w*)$/.exec(e);
    return c && consts.has(c[1]) ? names(consts.get(c[1]), depth + 1) : null;
  };
  const out = { names: null, nameWindow: null, outline: null, outColor: null, shadow: null, bold: null, italic: null };
  for (const live of lives) {
    for (const m of live.matchAll(/Font\.default_name\s*=(?!=)\s*(.+)$/gm)) out.names = names(m[1]) || out.names;
    for (const m of live.matchAll(/\bNAME_FONT\s*=(?!=)\s*(.+)$/gm)) out.nameWindow = names(m[1]);
    for (const m of live.matchAll(/Font\.default_(outline|shadow|bold|italic)\s*=(?!=)\s*(true|false)\b/g)) out[m[1]] = m[2] === 'true';
    for (const m of live.matchAll(/Font\.default_out_color\s*=(?!=)\s*Color\.new\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/g))
      out.outColor = [+m[1], +m[2], +m[3], m[4] === undefined ? 255 : +m[4]];
  }
  return out;
}
// what the game's scripts set up, from their sections ([name, source] in the game's order)
export function readScripts(entries) {
  const out = { names: {}, bonfires: [], symbols: {}, fontSize: 0, screen: null, sen: null, menuVar: null, synthesis: null, keep: null, difficulty: null,
    partnerCommand: '', placeWindow: null, fonts: null, compose: null };
  const want = { name: 'ネームウィンドウ', bonfire: '篝火移動', symbol: 'シンボル' };
  // (each by its section's name as the game names it - else by what it holds: a translation may name the section otherwise,
  // and none of it was read - no bonfire to travel to, no speakers' names, the roaming monsters' own settings gone)
  const holds = {
    name: s => /NAME_LIST\s*=\s*\{/.test(s),
    bonfire: s => /Scene_ShortMove/.test(s) && /MOVE_LIST\s*\[\s*\d+\s*\]\s*=/.test(s),
    symbol: s => /SYMBOL_SETTING_LIST\s*=\s*\{/.test(s),
  };
  const byName = {}, byContent = {}, lives = [];
  for (const [name, src] of entries) {
    // font size / screen size: the last assignment in script order wins (comment lines skipped); the screen no larger
    // than RGSS3 makes it, whatever a script asks for (640 x 480)
    const live = src.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
    lives.push(live);
    for (const m of live.matchAll(/Font\.default_size\s*=\s*(\d+)/g)) out.fontSize = +m[1];
    for (const m of live.matchAll(/Graphics\.resize_screen\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)) out.screen = [Math.min(640, +m[1]), Math.min(480, +m[2])];
    out.sen = senReminder(live) || out.sen;
    out.menuVar = menuVariable(live) || out.menuVar;
    out.synthesis = synthesis(src) || out.synthesis;
    out.keep = keeper(src) || out.keep;
    out.compose = composeShop(src) || out.compose;
    out.difficulty = difficulty(src) || out.difficulty;
    menuParts(live, out);
    for (const k of Object.keys(want)) {
      if (name === want[k]) (byName[k] ||= []).push(src);
      else if (!byContent[k] && holds[k](src)) byContent[k] = src;
    }
  }
  out.fonts = fontSettings(lives);
  for (const key of Object.keys(want)) for (const src of byName[key] || (byContent[key] ? [byContent[key]] : [])) {
    if (key === 'name') {
      const block = /NAME_LIST\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] || '';
      for (const m of block.matchAll(/"([^"]*)"\s*=>\s*"([^"]*)"/g)) out.names[m[1]] = m[2];
    } else if (key === 'bonfire') {
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
