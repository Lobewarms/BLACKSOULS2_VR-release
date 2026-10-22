// The game's fonts, as its scripts name them (scriptdata.js: Font.default_name - one name, or an array tried in turn -,
// and a window's own: the name window's NAME_FONT), looked for as RGSS3 looks for them: in the game's Fonts folder (each
// file by the names it holds, a translated one too - NanumGothic.ttf is also "나눔고딕") or installed on this PC. One that
// is neither is passed over - "VL Gothcic", misspelt in the Korean copy; "UmePlus Gothic", seldom installed -, and with
// none of them there the default font is used: RGSS3's own (VL Gothic) for a game whose scripts name none, the game's
// for the name window's. After them, for letters the game's font has none of (Hangul in a Japanese copy's font, under
// this version's Korean menus), a font of each language: this version's language first, then the game's, then the rest.
// Chinese or Japanese menus over a copy whose own text has no Han letters (Korean, English) take their Han letters (and
// kana) from a font of their own language - a line of them not half in another language's shapes.
// FONT / NAME_FONT: CSS font-family lists (canvas and page), set by loadGameFonts once the scripts are read.
import { listFiles, gameUrl } from './assets.js';
import { lang } from './i18n.js';
import { $data } from './data.js';

// fonts of each language, most wanted first (a family name in English and as the system may name it - the Korean ones
// written as escapes: 맑은 고딕, 굴림)
const LANG_FONTS = {
  ko: ['NanumGothic', 'Nanum Gothic', 'Malgun Gothic', '\uB9D1\uC740 \uACE0\uB515', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Noto Sans CJK KR', 'Gulim', '\uAD74\uB9BC'],
  ja: ['VL Gothic', 'Meiryo', 'メイリオ', 'Yu Gothic', '游ゴシック', 'MS PGothic', 'ＭＳ Ｐゴシック', 'Hiragino Sans', 'Noto Sans JP', 'Noto Sans CJK JP'],
  zh: ['Microsoft YaHei', '微软雅黑', 'SimHei', '黑体', 'PingFang SC', 'Noto Sans SC', 'Noto Sans CJK SC'],
};
// (the same installed, by the full names a page can ask the system for one by - for the Han letters' own font)
const LOCAL_FONTS = {
  ja: ['Meiryo', 'Yu Gothic Regular', 'Yu Gothic', 'MS PGothic', 'Hiragino Sans W3', 'Noto Sans JP Regular', 'Noto Sans CJK JP Regular'],
  zh: ['Microsoft YaHei', 'Microsoft YaHei Regular', 'SimHei', 'PingFang SC Regular', 'Noto Sans SC Regular', 'Noto Sans CJK SC Regular'],
};
const HAN_RANGE = { ja: 'U+3040-30FF, U+31F0-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+20000-2FFFF', zh: 'U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+20000-2FFFF' };
const HAN_FAMILY = 'BSVR Han';
const RGSS3_DEFAULT = ['VL Gothic'];         // Font.default_name when the scripts set none

const css = names => [...new Set(names.filter(Boolean))].map(n => `"${n.replace(/["\\]/g, '')}"`).join(', ') + ', sans-serif';
export let FONT = css([...LANG_FONTS[lang()] || [], ...LANG_FONTS.ko]);
export let NAME_FONT = FONT;
// the scripts' Font.default_* (RGSS3's own where they set none): outline (its colour), shadow, bold, italic
export const fontLook = { outline: true, outColor: 'rgba(0,0,0,0.5)', shadow: false, bold: false, italic: false };

// ---- the font files: the names each holds ('name' table: family 1 and typographic family 16, every platform and
// language), its weight and slant (OS/2)
function sfntInfo(v, o) {
  const tables = {};
  const n = v.getUint16(o + 4);
  for (let i = 0; i < n; i++) {
    const r = o + 12 + i * 16;
    tables[String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3))] = v.getUint32(r + 8);
  }
  if (tables.name === undefined) return null;
  const families = new Set(), no = tables.name, count = v.getUint16(no + 2), strs = no + v.getUint16(no + 4);
  for (let i = 0; i < count; i++) {
    const r = no + 6 + i * 12, pid = v.getUint16(r), eid = v.getUint16(r + 2), nid = v.getUint16(r + 6);
    const len = v.getUint16(r + 8), at = strs + v.getUint16(r + 10);
    if (nid !== 1 && nid !== 16) continue;
    let s = '';
    if (pid === 0 || (pid === 3 && (eid === 0 || eid === 1 || eid === 10))) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(at + k));
    else if (pid === 1 && eid === 0) for (let k = 0; k < len; k++) s += String.fromCharCode(v.getUint8(at + k));
    else continue;
    if ((s = s.trim())) families.add(s);
  }
  const os2 = tables['OS/2'];
  return { families: [...families], weight: (os2 !== undefined && v.getUint16(os2 + 4)) || 400, italic: os2 !== undefined && !!(v.getUint16(os2 + 62) & 1) };
}
function fontFileInfo(buf) {
  const v = new DataView(buf);
  // (a collection: its first font - a page's font takes one)
  const o = v.getUint32(0) === 0x74746366 ? v.getUint32(12) : 0;
  return sfntInfo(v, o);
}
async function readFontFiles() {
  const files = listFiles('Fonts/').filter(f => /\.(ttf|otf|ttc)$/i.test(f));
  const out = [];
  await Promise.all(files.map(async f => {
    try {
      const res = await fetch(gameUrl(f));
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const info = fontFileInfo(buf);
      if (info?.families.length) out.push({ file: f, buf, ...info, alias: '' });
    } catch (e) { console.warn('[fonts] not read:', f, e); }
  }));
  return out;
}

// the game's text's language, by its letters (its title, terms, items, skills): ko, ja, zh or en
export function gameLanguage() {
  const sample = [$data.system?.game_title, ...($data.system?.terms?.basic || []), ...($data.system?.terms?.commands || []),
    ...($data.items || []).slice(1, 80).flatMap(i => [i?.name, i?.description]),
    ...($data.skills || []).slice(1, 80).flatMap(s => [s?.name, s?.description])].filter(Boolean).join('');
  const count = re => (sample.match(re) || []).length;
  const hangul = count(/[\uac00-\ud7a3\u3130-\u318f]/g), kana = count(/[\u3040-\u30ff]/g), han = count(/[\u4e00-\u9fff]/g);
  if (hangul && hangul >= kana) return 'ko';
  if (kana) return 'ja';
  if (han) return 'zh';
  return 'en';
}

// Looks the scripts' fonts up and sets FONT / NAME_FONT (scripts: scriptdata.js's out.fonts)
export async function loadGameFonts(scripts) {
  const set = scripts?.fonts || {};
  if (set.outline != null) fontLook.outline = set.outline;
  if (set.outColor) fontLook.outColor = `rgba(${set.outColor[0]},${set.outColor[1]},${set.outColor[2]},${(set.outColor[3] ?? 255) / 255})`;
  if (set.shadow != null) fontLook.shadow = set.shadow;
  if (set.bold != null) fontLook.bold = set.bold;
  if (set.italic != null) fontLook.italic = set.italic;
  const files = await readFontFiles();
  const byName = new Map();
  for (const f of files) for (const n of f.families) { const k = n.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(f); }
  const faces = [];
  // a name in the game's Fonts folder: its files under one family (each with its weight and slant); else the name as it
  // is (installed on this PC, or passed over)
  const alias = name => {
    const hold = byName.get(String(name).toLowerCase());
    if (!hold) return name;
    const known = hold.find(f => f.alias)?.alias;
    if (known) return known;
    for (const f of hold) {
      f.alias = name;
      faces.push(new FontFace(name, f.buf, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' }));
    }
    return name;
  };
  const ui = lang(), game = gameLanguage();
  const order = [ui, game, 'ko', 'ja', 'zh'].filter((l, i, a) => LANG_FONTS[l] && a.indexOf(l) === i);
  // (the scripts' names first: a file found by one of them goes by that name)
  const base = (set.names?.length ? set.names : RGSS3_DEFAULT).map(alias);
  const own = (set.nameWindow || []).map(alias);
  const fallbacks = order.flatMap(l => LANG_FONTS[l]).map(alias);
  // (Chinese / Japanese menus over a copy whose text has no Han letters: those letters from their own language's font)
  let han = false;
  if (HAN_RANGE[ui] && game !== 'ja' && game !== 'zh') {
    const file = LANG_FONTS[ui].map(n => byName.get(n.toLowerCase())?.[0]).find(Boolean);
    const src = file ? file.buf : LOCAL_FONTS[ui].map(n => `local("${n}")`).join(', ');
    try {
      const f = new FontFace(HAN_FAMILY, src, { unicodeRange: HAN_RANGE[ui] });
      await f.load();
      document.fonts.add(f);
      han = true;
    } catch { /* none of them here: the plain list's own fallbacks */ }
  }
  await Promise.all(faces.map(f => f.load().then(() => document.fonts.add(f)).catch(e => console.warn('[fonts] not loaded:', f.family, e))));
  const lead = han ? [HAN_FAMILY] : [];
  FONT = css([...lead, ...base, ...fallbacks]);
  NAME_FONT = css([...lead, ...own, ...base, ...fallbacks]);
  console.log(`[fonts] scripts ${JSON.stringify(set.names || null)} name window ${JSON.stringify(set.nameWindow || null)}; files ${files.map(f => f.families[0]).join(', ') || 'none'}; game ${game}, menus ${ui}${han ? ' (Han letters from its own font)' : ''} -> ${FONT}`);
  return FONT;
}
// a canvas font of the game's text: size in pixels, its font list (FONT unless given), the scripts' bold / italic
export function gameFont(px, family = FONT) {
  return `${fontLook.italic ? 'italic ' : ''}${fontLook.bold ? 'bold ' : ''}${px}px ${family}`;
}
