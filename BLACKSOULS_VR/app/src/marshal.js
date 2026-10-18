// Ruby Marshal 4.8 reader (RPG Maker VX Ace .rvdata2 files).
// Works in the browser and in Node. Produces plain JS values:
//   Ruby object  -> { __class: 'RPG::Map', display_name: ..., ... }  (ivar '@' stripped)
//   Hash         -> JS Map (keys kept as-is; use hashGet/hashToObject helpers)
//   String       -> JS string when it carries an encoding ivar, otherwise Uint8Array
//   Symbol       -> JS string
//   Table/Color/Tone -> decoded structs

const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export class MarshalReader {
  constructor(buffer) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = 0;
    this.symbols = [];
    this.objects = [];
  }

  byte() { return this.bytes[this.pos++]; }

  int() {
    let c = this.view.getInt8(this.pos++);
    if (c === 0) return 0;
    if (c > 4) return c - 5;
    if (c < -4) return c + 5;
    if (c > 0) {
      let x = 0;
      for (let i = 0; i < c; i++) x += this.bytes[this.pos++] * 2 ** (8 * i);
      return x;
    }
    const n = -c;
    let x = 0;
    for (let i = 0; i < n; i++) x += this.bytes[this.pos++] * 2 ** (8 * i);
    return x - 2 ** (8 * n);
  }

  rawBytes() {
    const len = this.int();
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  symbol() {
    const t = String.fromCharCode(this.byte());
    if (t === ':') return this.symbolBody();
    if (t === ';') return this.symbols[this.int()];
    if (t === 'I') {
      // symbol with encoding ivars
      const s = this.symbol();
      const n = this.int();
      for (let i = 0; i < n; i++) { this.symbol(); this.read(); }
      return s;
    }
    throw new Error(`Expected symbol, got '${t}' at ${this.pos - 1}`);
  }

  symbolBody() {
    const s = utf8.decode(this.rawBytes());
    this.symbols.push(s);
    return s;
  }

  register(obj) {
    this.objects.push(obj);
    return this.objects.length - 1;
  }

  load() {
    const major = this.byte(), minor = this.byte();
    if (major !== 4 || minor !== 8) throw new Error(`Bad marshal version ${major}.${minor}`);
    return this.read();
  }

  read() {
    const t = String.fromCharCode(this.byte());
    switch (t) {
      case '0': return null;
      case 'T': return true;
      case 'F': return false;
      case 'i': return this.int();
      case ':': return this.symbolBody();
      case ';': return this.symbols[this.int()];
      case '@': return this.objects[this.int()];
      case 'I': return this.readIvarWrapped();
      case '"': {
        // Strings without an encoding ivar: keep as text when valid UTF-8, else raw bytes.
        // (An enclosing 'I' wrapper re-decodes / replaces this entry.)
        const b = this.rawBytes().slice();
        let v;
        try { v = strictUtf8.decode(b); } catch { v = b; }
        this.register(v);
        return v;
      }
      case '[': {
        const n = this.int();
        const arr = new Array(n);
        this.register(arr);
        for (let i = 0; i < n; i++) arr[i] = this.read();
        return arr;
      }
      case '{':
      case '}': {
        const n = this.int();
        const map = new Map();
        this.register(map);
        for (let i = 0; i < n; i++) {
          const k = this.read();
          map.set(k, this.read());
        }
        if (t === '}') map.default = this.read();
        return map;
      }
      case 'o': {
        const cls = this.symbol();
        const obj = { __class: cls };
        this.register(obj);
        const n = this.int();
        for (let i = 0; i < n; i++) {
          const k = this.symbol();
          obj[k.startsWith('@') ? k.slice(1) : k] = this.read();
        }
        return obj;
      }
      case 'S': {
        const cls = this.symbol();
        const obj = { __class: cls };
        this.register(obj);
        const n = this.int();
        for (let i = 0; i < n; i++) obj[this.symbol()] = this.read();
        return obj;
      }
      case 'u': {
        const cls = this.symbol();
        const data = this.rawBytes();
        const obj = decodeUserType(cls, data);
        this.register(obj);
        return obj;
      }
      case 'U': {
        const cls = this.symbol();
        const obj = { __class: cls };
        this.register(obj);
        obj.__data = this.read();
        return obj;
      }
      case 'f': {
        const s = latin1.decode(this.rawBytes());
        let v;
        if (s === 'inf') v = Infinity;
        else if (s === '-inf') v = -Infinity;
        else if (s === 'nan') v = NaN;
        else v = parseFloat(s);
        this.register(v);
        return v;
      }
      case 'l': {
        const sign = String.fromCharCode(this.byte());
        const len = this.int() * 2;
        let v = 0n;
        for (let i = len - 1; i >= 0; i--) v = (v << 8n) | BigInt(this.bytes[this.pos + i]);
        this.pos += len;
        if (sign === '-') v = -v;
        const num = (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) ? Number(v) : v;
        this.register(num);
        return num;
      }
      case 'e': {
        this.symbol(); // extending module, ignored
        return this.read();
      }
      case 'C': {
        const cls = this.symbol();
        const v = this.read();
        if (v && typeof v === 'object') v.__userClass = cls;
        return v;
      }
      case '/': {
        const src = this.rawBytes();
        const opts = this.byte();
        const obj = { __class: 'Regexp', source: utf8.decode(src), options: opts };
        this.register(obj);
        return obj;
      }
      case 'c':
      case 'm':
      case 'M': {
        const obj = { __class: t === 'c' ? 'Class' : 'Module', name: utf8.decode(this.rawBytes()) };
        this.register(obj);
        return obj;
      }
      default:
        throw new Error(`Unsupported marshal type '${t}' (0x${t.charCodeAt(0).toString(16)}) at ${this.pos - 1}`);
    }
  }

  readIvarWrapped() {
    const startIndex = this.objects.length;
    const v = this.read();
    const n = this.int();
    let encoding = null;
    const extra = {};
    for (let i = 0; i < n; i++) {
      const k = this.symbol();
      const val = this.read();
      if (k === 'E') encoding = val ? 'utf-8' : 'ascii';
      else if (k === 'encoding') encoding = val instanceof Uint8Array ? latin1.decode(val) : String(val);
      else extra[k] = val;
    }
    if (v instanceof Uint8Array && encoding) {
      let s;
      try { s = new TextDecoder(encoding.toLowerCase() === 'ascii' ? 'utf-8' : encoding, { fatal: true }).decode(v); }
      catch { return v; } // not valid text (e.g. zlib data tagged as UTF-8) -> keep raw bytes
      // replace the registered byte buffer so later '@' links resolve to the string
      const idx = this.objects.indexOf(v, startIndex);
      if (idx >= 0) this.objects[idx] = s;
      return s;
    }
    if (v && typeof v === 'object') Object.assign(v, extra);
    return v;
  }
}

function decodeUserType(cls, data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (cls === 'Table') {
    const dim = dv.getInt32(0, true);
    const xsize = dv.getInt32(4, true);
    const ysize = dv.getInt32(8, true);
    const zsize = dv.getInt32(12, true);
    const size = dv.getInt32(16, true);
    const arr = new Int16Array(size);
    for (let i = 0; i < size; i++) arr[i] = dv.getInt16(20 + i * 2, true);
    return { __class: 'Table', dim, xsize, ysize, zsize, data: arr };
  }
  if (cls === 'Color' || cls === 'Tone') {
    const v = [0, 8, 16, 24].map(o => dv.getFloat64(o, true));
    return cls === 'Color'
      ? { __class: cls, red: v[0], green: v[1], blue: v[2], alpha: v[3] }
      : { __class: cls, red: v[0], green: v[1], blue: v[2], gray: v[3] };
  }
  if (cls === 'Rect' && data.length >= 16) {
    return { __class: cls, x: dv.getInt32(0, true), y: dv.getInt32(4, true), width: dv.getInt32(8, true), height: dv.getInt32(12, true) };
  }
  return { __class: cls, __bytes: data.slice() };
}

export function loadMarshal(buffer) {
  return new MarshalReader(buffer).load();
}

// Table accessor: t.get(x, y, z)
export function tableGet(t, x, y = 0, z = 0) {
  if (x < 0 || y < 0 || z < 0 || x >= t.xsize || y >= t.ysize || z >= t.zsize) return 0;
  return t.data[x + y * t.xsize + z * t.xsize * t.ysize];
}

// Look up a Ruby hash entry whose key may be a string / int / symbol
export function hashGet(map, key) {
  if (!(map instanceof Map)) return undefined;
  if (map.has(key)) return map.get(key);
  for (const [k, v] of map) if (String(k) === String(key)) return v;
  return undefined;
}

export function bytesToString(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return utf8.decode(v);
  return v == null ? '' : String(v);
}
