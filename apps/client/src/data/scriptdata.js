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
// the menu's variable window ("メニュー変数": the SEN under its title, shown unless a switch is off)
function menuVariable(src) {
  const v = /Var_Num\s*=\s*(\d+)/.exec(src);
  if (!v || !/Window_Var/.test(src)) return null;
  const str = k => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(src)?.[1] ?? '';
  return { variable: +v[1], label: str('Var_Prefix'), suffix: str('Var_Suffix'), switchId: +(/Disp_SW\s*=\s*(\d+)/.exec(src)?.[1] ?? 0) };
}

export async function loadScriptData() {
  const out = { names: {}, bonfires: [], symbols: {}, fontSize: 0, screen: null, sen: null, menuVar: null, synthesis: null, keep: null, difficulty: null };
  let scripts;
  try { scripts = await loadRvdata('Scripts'); } catch (e) { console.warn('Scripts.rvdata2 not readable', e); return out; }
  const want = { name: 'ネームウィンドウ', bonfire: '篝火移動', symbol: 'シンボル' };
  for (const [, nameRaw, code] of scripts) {
    const name = bytesToString(nameRaw);
    if (!(code instanceof Uint8Array)) continue;
    let src;
    try { src = await inflate(code); } catch { continue; }
    // font size / screen size: the last assignment in script order wins (comment lines skipped)
    const live = src.split(/\r?\n/).filter(l => !/^\s*#/.test(l)).join('\n');
    for (const m of live.matchAll(/Font\.default_size\s*=\s*(\d+)/g)) out.fontSize = +m[1];
    for (const m of live.matchAll(/Graphics\.resize_screen\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)) out.screen = [+m[1], +m[2]];
    out.sen = senReminder(live) || out.sen;
    out.menuVar = menuVariable(live) || out.menuVar;
    out.synthesis = synthesis(src) || out.synthesis;
    out.keep = keeper(src) || out.keep;
    out.difficulty = difficulty(src) || out.difficulty;
    const key = Object.keys(want).find(k => name === want[k]);
    if (!key) continue;
    if (key === 'name') {
      const block = /NAME_LIST\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] || '';
      for (const m of block.matchAll(/"([^"]*)"\s*=>\s*"([^"]*)"/g)) out.names[m[1]] = m[2];
    } else if (key === 'bonfire') {
      const explan = {}, calls = {};
      for (const m of src.matchAll(/EXPLAN\[(\d+)\]\s*=\s*\["([^"]*)"\s*,\s*"([^"]*)"\]/g)) explan[+m[1]] = [m[2], m[3]];
      for (const m of src.matchAll(/CALL_COMMON\[(\d+)\]\s*=\s*\[([\d,\s]*)\]/g)) calls[+m[1]] = m[2].split(',').map(s => +s).filter(Boolean);
      for (const m of src.matchAll(/MOVE_LIST\[(\d+)\]\s*=\s*\[\["([^"]*)",\s*(\d+),\s*\d+,\s*\d+\],\s*\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\]/g)) {
        const i = +m[1];
        out.bonfires.push({
          index: i, name: m[2], switchId: +m[3], mapId: +m[4], x: +m[5], y: +m[6], dir: +m[7],
          desc: explan[i] || ['', ''], commons: calls[i] || [],
        });
      }
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
  G.scripts = out;
  console.log(`[scripts] names ${Object.keys(out.names).length}, bonfires ${out.bonfires.length}, symbols ${Object.keys(out.symbols).length}, synthesis recipes ${out.synthesis?.recipes.length || 0}, storage ${out.keep ? 'up to ' + out.keep.limit : 'none'}, difficulty ${out.difficulty ? 'v' + out.difficulty.variable : 'none'}, font ${out.fontSize || 'default'}, screen ${out.screen ? out.screen.join('x') : 'default'}, SEN ${out.sen ? 'v' + out.sen.variable : 'none'}, menu variable ${out.menuVar ? 'v' + out.menuVar.variable : 'none'}`);
  return out;
}
