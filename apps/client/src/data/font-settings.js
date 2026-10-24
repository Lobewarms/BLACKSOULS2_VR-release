// Static RGSS font/menu settings only. No game Ruby is executed.
export function liveRuby(source) {
  const lines = String(source ?? '').replace(/^=begin\b[\s\S]*?^=end\b.*$/gm, '').split(/\r?\n/);
  return lines.map(line => {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
const literals = value => [...value.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)]
  .map(m => (m[1] ?? m[2]).replace(/\\([\\"'])/g, '$1'));
export function fontSettings(sources) {
  const out = { names: null, nameWindow: null, outline: null, outColor: null, shadow: null, bold: null, italic: null };
  const constants = new Map();
  const names = (expression, depth = 0) => {
    const e = expression.trim();
    if (depth > 8) return null;
    if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(e)) return literals(e);
    if (/^\[\s*(?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,?\s*)*\]$/.test(e)) return literals(e);
    const words = /^%w([([{])([^\n]*)([)\]}])$/.exec(e);
    if (words && '([{'.indexOf(words[1]) === ')]}'.indexOf(words[3])) return words[2].trim().split(/\s+/).filter(Boolean);
    const constant = /^(?:[A-Z]\w*::)*([A-Z]\w*)$/.exec(e);
    return constant && constants.has(e) ? names(constants.get(e), depth + 1)
      : constant && constants.has(constant[1]) ? names(constants.get(constant[1]), depth + 1) : null;
  };
  for (const source of sources) for (const line of liveRuby(source).split('\n')) {
    const constant = /^\s*((?:[A-Z]\w*::)*[A-Z]\w*)\s*=(?!=)\s*(.+)$/.exec(line);
    if (constant) constants.set(constant[1], constant[2]);
    const family = /^\s*(Font\.default_name|NAME_FONT)\s*=(?!=)\s*(.+)$/.exec(line);
    if (family) {
      const parsed = names(family[2]);
      if (parsed || family[1] === 'NAME_FONT' && family[2].trim() === 'Font.default_name') out[family[1] === 'NAME_FONT' ? 'nameWindow' : 'names'] = parsed;
    }
    for (const m of line.matchAll(/^\s*Font\.default_(outline|shadow|bold|italic)\s*=(?!=)\s*(true|false)\b/g)) out[m[1]] = m[2] === 'true';
    const color = /^\s*Font\.default_out_color\s*=(?!=)\s*Color\.new\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(line);
    if (color) out.outColor = color.slice(1).map((x, i) => Math.max(0, Math.min(255, x === undefined && i === 3 ? 255 : +x)));
  }
  return out;
}
export function menuParts(source, out) {
  const live = liveRuby(source), partner = /add_command\(\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))\s*,\s*:partner\b/.exec(live);
  if (partner) out.partnerCommand = literals(partner[1])[0];
  if (!/class\s+Window_Mapname\b/.test(live)) return;
  const n = (re, fallback) => { const v = re.exec(live); return v ? +v[1] : fallback; };
  out.placeWindow = { label: literals(/draw_text\([^\n]*?((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))\s*\)/.exec(live)?.[1] || '')[0] || '',
    x: n(/@map_window\.x\s*=\s*(\d+)/, 440), y: n(/@map_window\.y\s*=\s*(\d+)/, 400),
    w: n(/def\s+window_width\s*;?\s*return\s+(\d+)/, 200), h: n(/def\s+window_height\s*;?\s*return\s+(\d+)/, 78) };
}
