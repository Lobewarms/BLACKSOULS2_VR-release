// Static configuration for the installed W_REGULAR variable window. Never
// evaluate Ruby: a translated label or changed variable ID is ordinary data.
function uncomment(source) {
  let quote = null, block = false;
  return String(source).split(/\r?\n/).map(line => {
    if (!quote && /^=begin(?:\s|$)/.test(line)) { block = true; return ''; }
    if (block) { if (/^=end(?:\s|$)/.test(line)) block = false; return ''; }
    let live = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quote) {
        live += char;
        if (char === '\\' && i + 1 < line.length) live += line[++i];
        else if (char === quote) quote = null;
      } else if (char === '#') break;
      else { live += char; if (char === '"' || char === "'") quote = char; }
    }
    return live;
  }).join('\n');
}

// The settings use only numbers, booleans, strings, arrays and symbol-keyed
// hashes. Restrict the grammar so calls, interpolation and conditional settings
// cannot masquerade as installed constants.
function literal(source) {
  let offset = 0;
  const space = () => { while (/\s/.test(source[offset] || '') && offset < source.length) offset++; };
  const read = (depth = 0) => {
    if (depth > 8) throw Error('nested setting');
    space(); const char = source[offset];
    if (char === '"' || char === "'") {
      const quote = char; offset++; let text = '';
      while (offset < source.length) {
        const next = source[offset++];
        if (next === quote) return text;
        if (quote === '"' && next === '#' && source[offset] === '{') throw Error('interpolation');
        if (next !== '\\') { text += next; continue; }
        const escape = source[offset++];
        if (escape === undefined) break;
        if (quote === "'") text += /['\\]/.test(escape) ? escape : '\\' + escape;
        else {
          const escapes = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '#': '#' };
          if (!(escape in escapes)) throw Error('unsupported escape');
          text += escapes[escape];
        }
      }
      throw Error('unterminated string');
    }
    if (char === '[' || char === '{') {
      const array = char === '[', end = array ? ']' : '}', result = array ? [] : Object.create(null);
      offset++; space();
      while (source[offset] !== end) {
        if (offset >= source.length) throw Error('unterminated collection');
        if (array) result.push(read(depth + 1));
        else {
          const key = /^:([a-z]\w*)\s*=>/.exec(source.slice(offset));
          if (!key) throw Error('nonliteral key');
          offset += key[0].length; result[key[1]] = read(depth + 1);
        }
        space();
        if (source[offset] !== ',') break;
        offset++; space();
      }
      if (source[offset++] !== end) throw Error('collection delimiter');
      return result;
    }
    const token = /^(true|false|-?\d+(?:\.\d+)?)(?![\w.])/.exec(source.slice(offset));
    if (!token) throw Error('nonliteral value');
    offset += token[0].length;
    return token[1] === 'true' ? true : token[1] === 'false' ? false : Number(token[1]);
  };
  const result = read(); space();
  if (offset !== source.length) throw Error('trailing expression');
  return result;
}
const integer = (value, min = 0, max = 1000000) => Number.isSafeInteger(value) && value >= min && value <= max;
const tableNames = ['M_W_X', 'M_W_Y', 'B_W_X', 'B_W_Y', 'WIDTH', 'HEIGHT', 'FSIZE', 'ITEM'];
function settings(body) {
  const values = {}, tables = Object.fromEntries(tableNames.map(key => [key, {}]));
  const assignments = [...body.matchAll(/^[ \t]*([A-Z]\w*)(?:\s*\[\s*(\d+)\s*\])?\s*=/gm)];
  if (!assignments.length || body.slice(0, assignments[0].index).trim()) throw Error('runtime configuration');
  for (let i = 0; i < assignments.length; i++) {
    const match = assignments[i], [, key, index] = match;
    const expression = body.slice(match.index + match[0].length, assignments[i + 1]?.index ?? body.length);
    const value = literal(expression.trim().replace(/;$/, '').trim());
    if (index !== undefined) {
      if (!tableNames.includes(key) || !integer(+index, 0, 1024)) throw Error('unknown indexed setting');
      tables[key][index] = value;
    } else if (tableNames.includes(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw Error('nonempty table initializer');
      tables[key] = {};
    } else if (['M_USE', 'M_SID', 'B_USE', 'B_SID', 'VID'].includes(key)) values[key] = value;
    else throw Error('unknown setting');
  }
  if (typeof values.M_USE !== 'boolean' || typeof values.B_USE !== 'boolean'
    || !['M_SID', 'B_SID', 'VID'].every(key => integer(values[key]))) throw Error('incomplete settings');
  const items = {};
  for (const [type, rows] of Object.entries(tables.ITEM)) {
    if (!Array.isArray(rows) || rows.length > 32) throw Error('invalid rows');
    items[type] = rows.map(row => {
      if (!row || Array.isArray(row) || !integer(row.variable_id) || !integer(row.y, -8192, 8192)
        || (row.switch_id !== undefined && !integer(row.switch_id))
        || ['name', 'afterword'].some(key => row[key] !== undefined && typeof row[key] !== 'string')
        || ['icon_id', 'name_c'].some(key => row[key] !== undefined && !integer(row[key]))
        || (row.no_value !== undefined && typeof row.no_value !== 'boolean')
        || (row.font_size !== undefined && !integer(row.font_size, 8, 128))
        || (row.x !== undefined && !integer(row.x, -8192, 8192))
        || (row.width !== undefined && !integer(row.width, 1, 8192))
        || Object.keys(row).some(key => key.startsWith('gauge_'))) throw Error('unsupported row');
      return { variable: row.variable_id, switchId: row.switch_id ?? null, label: row.name ?? '', suffix: row.afterword ?? '',
        icon: row.icon_id ?? 0, color: row.name_c ?? 0, noValue: row.no_value ?? false,
        x: row.x ?? 0, y: row.y, width: row.width ?? null, fontSize: row.font_size ?? null };
    });
  }
  if (!Object.keys(items).length) throw Error('missing rows');
  for (const key of tableNames.filter(key => key !== 'ITEM')) for (const value of Object.values(tables[key])) {
    if (!integer(value, key === 'WIDTH' || key === 'HEIGHT' || key === 'FSIZE' ? 1 : -65536, 65536)) throw Error('invalid layout');
  }
  return { map: { enabled: values.M_USE, switchId: values.M_SID }, battle: { enabled: values.B_USE, switchId: values.B_SID },
    typeVariable: values.VID, items, layout: { mapX: tables.M_W_X, mapY: tables.M_W_Y, battleX: tables.B_W_X,
      battleY: tables.B_W_Y, width: tables.WIDTH, height: tables.HEIGHT, fontSize: tables.FSIZE } };
}

// undefined means this script does not configure the window; null explicitly
// disables an unsupported replacement, rather than reusing an older definition.
export function readRegularWindow(source) {
  const clean = uncomment(source);
  let result;
  for (const match of clean.matchAll(/^[ \t]*module[ \t]+W_REGULAR[ \t]*\n([^]*?)^[ \t]*end\b/gm)) {
    try { result = settings(match[1]); } catch { result = null; }
  }
  return result;
}
