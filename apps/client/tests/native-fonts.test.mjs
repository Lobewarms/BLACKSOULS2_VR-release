import test from 'node:test';
import assert from 'node:assert/strict';
import { fontSettings, liveRuby } from '../src/data/font-settings.js';
import { Hangul } from '../src/ui/hangul.js';
globalThis.location = { search: '?lang=ru' };
const { $data } = await import('../src/data/data.js');
const { initAssets } = await import('../src/data/assets.js');
const fonts = await import('../src/ui/fonts.js');
const tr = await import('../src/ui/i18n.js');

test('native font parser preserves order, literal aliases and quoted hashes without executing Ruby or reading comments', () => {
  const out = fontSettings([
    `=begin\nFont.default_name = 'Not live'\n=end\nCustom_Font = ['가나다', 'Synthetic # Family']\nFont.default_name = Omega::Custom_Font\nNAME_FONT = 'Small family' # Font.default_name = 'Comment'\nFont.default_outline = false`,
    `# Font.default_name = 'Hidden'\nFont.default_name = %w(Synthetic Second)\nFont.default_bold = true\nFont.default_italic = false\nFont.default_shadow = true\nFont.default_out_color = Color.new(20, 30, 40, 128)`,
  ]);
  assert.deepEqual(out, { names: ['Synthetic', 'Second'], nameWindow: ['Small family'], outline: false,
    outColor: [20, 30, 40, 128], shadow: true, bold: true, italic: false });
  assert.deepEqual(fontSettings([`A = B\nB = A\nFont.default_name = A\nFont.default_name = ['Only'] + malicious()`]).names, null);
  assert.equal(liveRuby(`NAME_FONT = 'Hash # stays' # gone`).trim(), `NAME_FONT = 'Hash # stays'`);
  assert.equal(fontSettings([`NAME_FONT = 'Small'\nNAME_FONT = Font.default_name`]).nameWindow, null);
  assert.equal(fontSettings([`text = 'Font.default_bold = true'`]).bold, null);
});

function fontBuffer(family) {
  const buf = new ArrayBuffer(400), view = new DataView(buf);
  view.setUint16(4, 2);
  for (const [at, tag, offset] of [[12, 'name', 44], [28, 'OS/2', 300]]) {
    [...tag].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0))); view.setUint32(at + 8, offset);
  }
  view.setUint16(46, 1); view.setUint16(48, 18);
  view.setUint16(50, 3); view.setUint16(52, 1); view.setUint16(54, 0x0412); view.setUint16(56, 1);
  view.setUint16(58, family.length * 2); view.setUint16(60, 0);
  [...family].forEach((c, i) => view.setUint16(62 + i * 2, c.charCodeAt(0)));
  view.setUint16(304, 700); view.setUint16(362, 1); return buf;
}
test('font files use their actual internal family and style, while malformed local files fail safely', () => {
  assert.deepEqual(fonts.fontFileInfo(fontBuffer('가나다')), { families: ['가나다'], weight: 700, italic: true });
  for (const buffer of [new ArrayBuffer(0), new ArrayBuffer(8), new Uint8Array(28).fill(255).buffer]) assert.equal(fonts.fontFileInfo(buffer), null);
});

test('font loading resolves native family aliases with Cyrillic fallbacks and resets appearance between games', async t => {
  const oldFetch = globalThis.fetch, oldFace = globalThis.FontFace, oldDocument = globalThis.document;
  const added = [], family = '가나다', buffer = fontBuffer(family);
  t.after(() => { globalThis.fetch = oldFetch; globalThis.FontFace = oldFace; globalThis.document = oldDocument; });
  globalThis.fetch = async path => path === '/api/manifest'
    ? { json: async () => ({ files: ['Fonts/unrelated-file.ttf'] }) } : { ok: true, arrayBuffer: async () => buffer };
  globalThis.FontFace = class { constructor(name, data, options) { Object.assign(this, { family: name, data, options }); } async load() { return this; } };
  globalThis.document = { fonts: { add: face => added.push(face) } };
  await initAssets();
  await fonts.loadGameFonts({ fonts: { names: [family], nameWindow: ['Small'], outline: false, bold: true } });
  assert.equal(added.length, 1); assert.equal(added[0].family, family); assert.equal(added[0].options.weight, '700');
  assert.ok(fonts.FONT.startsWith(`"${family}"`)); assert.match(fonts.FONT, /Segoe UI/); assert.ok(fonts.NAME_FONT.startsWith('"Small"'));
  assert.match(fonts.gameFont(19), /^bold 19px /); assert.equal(fonts.fontLook.outline, false);
  await fonts.loadGameFonts({}); assert.equal(fonts.fontLook.outline, true); assert.equal(fonts.fontLook.bold, false);
});

test('game text detects Cyrillic independently of the selected UI language', t => {
  const system = $data.system, items = $data.items, skills = $data.skills;
  t.after(() => Object.assign($data, { system, items, skills }));
  Object.assign($data, { system: { game_title: 'Синтетическая игра' }, items: [], skills: [] });
  assert.equal(fonts.gameLanguage(), 'ru');
});

test('Korean composition handles joined vowels/finals, vowel migration and jamo-by-jamo backspace', () => {
  const hangul = new Hangul(); let text = '';
  for (const jamo of 'ㅎㅏㄴㄱㅡㄹ') text += hangul.put(jamo);
  assert.equal(text + hangul.text, '한글'); assert.equal(hangul.back(), true); assert.equal(hangul.text, '그');
  hangul.clear(); text = ''; for (const jamo of 'ㄱㅏㄱㅏ') text += hangul.put(jamo);
  assert.equal(text + hangul.text, '가가');
  hangul.clear(); for (const jamo of 'ㄱㅗㅏ') hangul.put(jamo); assert.equal(hangul.text, '과');
  hangul.back(); assert.equal(hangul.text, '고'); hangul.back(); assert.equal(hangul.text, 'ㄱ');
});

test('Russian covers every custom and upstream UI key without losing placeholders', () => {
  assert.equal(tr.lang(), 'ru'); assert.ok(tr.LANGS.includes('ru'));
  assert.equal(tr.tr('즐겨찾기'), 'Избранное'); assert.equal(tr.tr('보너스 행동 ×{n}', { n: 3 }), 'Бонусное действие ×3');
  for (const key of tr.KEYS) {
    const translated = tr.tr(key); assert.ok(translated.trim()); if (/[가-힣]/.test(key)) assert.notEqual(translated, key.split('|')[0]);
    assert.deepEqual([...translated.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...key.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), key);
  }
});
