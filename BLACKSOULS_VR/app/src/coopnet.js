// How co-op messages travel (coop.js speaks the same messages over any of these): a link sends a message (a JSON
// string) to one player or to all, and hands on what comes in, with who sent it.
//  HubLink   - through the co-op server (coop_server.py), by its address: what players use.
//  WorldLink - the developer's world server (world_server.py): one world shared by everyone on it, no host.
//  LocalLink - game windows of one browser on one PC (a BroadcastChannel): for trying co-op out alone.
//  RtcLink   - (dev / on hold) a WebRTC data link between two; ServerLink - (on hold) the same through the
//              Cloudflare room server in coop-server/.

const HUB_PROTO = 1;
// the co-op server this game goes with (coop_server.py SERVER_VERSION): an older one lacks the newer rules and defaults -
// the co-op menu says so (Coop.serverOld)
export const SERVER_VERSION = 4;
// HubLink: the co-op server lets in only those who know its PIN - proved, not sent: the server gives a one-time
// challenge and gets back its HMAC with the PIN - tells who is there (and who is the host), and passes each message
// on to one player or to all. A host on the server's own PC needs no PIN.
// Each player says its name and the random key its game keeps; the server tells everyone the others' names and the
// tags it makes of their keys (the key itself goes no further) - what the host sends one away or bans one by.
export class HubLink {
  constructor(url, { role, pin = '', key = '', name = '', bans = null }) {
    this.onmessage = null; this.onclose = null; this.onpeer = null; this.onrules = null;
    this.role = role; this.open = false; this.ended = false; this.id = null; this.hostId = null; this.rules = null; this.pin = null;
    this.key = key; this.name = name; this.bans = bans; this.tag = '';
    this.info = new Map();       // the others: id -> { name, tag } as the server tells them
    try { this.ws = new WebSocket(url); } catch { setTimeout(() => this.close('no server'), 0); return; }
    this.ws.onmessage = e => this.take(e.data, pin);
    this.ws.onclose = () => this.close(this.open ? 'server closed' : 'no server');
    this.ws.onerror = () => {};
  }
  async take(text, pin) {
    if (this.ended || typeof text !== 'string' || text.length > MAX_TEXT + 4096) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'challenge' && !this.open && typeof m.nonce === 'string' && m.nonce.length <= 64) {
      const proof = pin ? await hmacHex(String(pin), m.nonce) : '';
      if (!this.ended) this.ws.send(JSON.stringify({ t: 'auth', role: this.role, proof, v: HUB_PROTO, key: this.key, name: this.name }));
    } else if (m.t === 'ready' && !this.open && typeof m.id === 'string' && Array.isArray(m.peers)) {
      this.id = m.id;
      this.open = true;
      this.rules = takeRules(m.rules);
      this.ruled = !!(m.rules && typeof m.rules === 'object');   // (an older server knows no rules: none are sent to it)
      this.serverVersion = Number.isInteger(m.sv) ? m.sv : 0;      // (an older server says none)
      this.pin = typeof m.pin === 'string' && /^\d{4,12}$/.test(m.pin) ? m.pin : null;   // (told to the host only)
      this.tag = isTag(m.tag) ? m.tag : '';
      for (const p of m.peers.slice(0, 16)) this.peer(p, true);
      if (this.role === 'host' && this.bans) this.setBans(this.bans);     // (this host's list of the banned)
    } else if (m.t === 'rules' && this.open) {
      // (the host changed them in its co-op menu)
      this.rules = takeRules(m.rules);
      this.onrules?.(this.rules);
    } else if (m.t === 'pin' && this.open && this.role === 'host' && typeof m.pin === 'string' && /^\d{4,12}$/.test(m.pin)) {
      this.pin = m.pin;                          // (this host changed it: the server took it)
      this.onrules?.(this.rules);
    } else if (m.t === 'peer' && this.open) this.peer(m, m.on === true);
    else if (m.t === 'msg' && this.open && typeof m.from === 'string' && typeof m.data === 'string') this.onmessage?.(m.data, m.from);
    else if (m.t === 'deny') this.close(`denied ${typeof m.why === 'string' ? m.why.slice(0, 20) : ''}`.trim());
  }
  peer(p, on) {
    if (!p || typeof p.id !== 'string' || p.id.length > 16 || (p.role !== 'host' && p.role !== 'guest') || p.id === this.id) return;
    if (p.role === 'host') this.hostId = on ? p.id : this.hostId === p.id ? null : this.hostId;
    if (on) this.info.set(p.id, { name: cleanName(p.name), tag: isTag(p.tag) ? p.tag : '' });
    else this.info.delete(p.id);
    this.onpeer?.(p.id, p.role, on);
  }
  send(text, to = null) {
    if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'msg', to, data: text }));
  }
  // (host) new rules for this server's worlds: the server takes them and tells everyone (here at once as well)
  setRules(rules) {
    if (this.role !== 'host' || !this.open || !this.ruled || this.ws.readyState !== 1) return false;
    this.rules = takeRules(rules);
    this.ws.send(JSON.stringify({ t: 'rules', rules: this.rules }));
    return true;
  }
  // (host) a new join PIN for the server (4-12 digits): it says so back when it took it
  setPin(pin) {
    if (this.role !== 'host' || !this.open || !this.ruled || this.ws.readyState !== 1 || !/^\d{4,12}$/.test(pin)) return false;
    this.ws.send(JSON.stringify({ t: 'pin', pin }));
    return true;
  }
  // (host) a guest sent away - and, banned, it may not come back (the server knows it by its tag)
  kick(id, ban = false) {
    if (this.role !== 'host' || !this.open || this.ws.readyState !== 1 || typeof id !== 'string') return false;
    this.ws.send(JSON.stringify({ t: ban ? 'ban' : 'kick', id }));
    return true;
  }
  // (host) this host's list of the banned (tags): the server keeps them out of this world
  setBans(tags) {
    this.bans = tags.filter(isTag);
    if (this.role !== 'host' || !this.open || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t: 'bans', tags: this.bans }));
    return true;
  }
  close(why = 'closed') {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* */ } }
    this.onclose?.(why);
  }
}
// WorldLink: the developer's world server (world_server.py) - one world everyone on it walks, with no host. In as
// through a co-op server (the PIN proved, not sent; a name and a key, the tag made of it); besides the messages it
// passes on (to one, to all - or, m: 1, to those on the sender's map), what the world server keeps and decides itself
// comes to onworld: the world's switches as they change ('wf'; 'world' all of it), who is on which map ('roster'), who
// runs each map's monsters ('lead'), one event at a time ('lockok' / 'lockno'), a world brought ('seeded') and votes
// ('vote', 'voteno', 'voted', 'cycle'), its rules ('rules') and whether this player proved its admin PIN ('admin').
// tell() sends what it takes itself ('at', 'wf', 'seed', 'lock', 'unlock', 'vote', 'ballot', 'admin', 'rules')
export const WORLD_VERSION = 2;          // (world_server.py WORLD_VERSION - 2: the rules, the admin)
const WORLD_MSGS = new Set(['wf', 'world', 'lead', 'roster', 'lockok', 'lockno', 'seeded', 'vote', 'voteno', 'voted', 'cycle', 'rules', 'admin']);
export class WorldLink {
  constructor(url, { pin = '', key = '', name = '', fp = '' }) {
    this.onmessage = null; this.onclose = null; this.onpeer = null; this.onworld = null; this.onrules = null;
    this.role = 'world'; this.open = false; this.ended = false; this.id = null; this.hostId = null; this.tag = '';
    this.key = key; this.name = name; this.fp = fp; this.max = 16;
    this.info = new Map();       // the others: id -> { name, tag } as the server tells them
    try { this.ws = new WebSocket(url); } catch { setTimeout(() => this.close('no server'), 0); return; }
    this.ws.onmessage = e => this.take(e.data, pin);
    this.ws.onclose = () => this.close(this.open ? 'server closed' : 'no server');
    this.ws.onerror = () => {};
  }
  async take(text, pin) {
    if (this.ended || typeof text !== 'string' || text.length > MAX_TEXT + 4096) return;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'challenge' && !this.open && typeof m.nonce === 'string' && m.nonce.length <= 64) {
      if (m.world !== 1) { this.close('not world'); return; }          // (a co-op server's, not the developer's)
      this.nonce = m.nonce;
      const proof = pin ? await hmacHex(String(pin), m.nonce) : '';
      if (!this.ended) this.ws.send(JSON.stringify({ t: 'auth', role: 'world', proof, wv: WORLD_VERSION, key: this.key, name: this.name, fp: this.fp }));
    } else if (m.t === 'ready' && !this.open && typeof m.id === 'string') {
      this.id = m.id;
      this.open = true;
      this.tag = isTag(m.tag) ? m.tag : '';
      this.serverVersion = Number.isInteger(m.sv) ? m.sv : 0;
      this.max = Number.isInteger(m.max) && m.max >= 2 && m.max <= 16 ? m.max : 16;
      // (how the admin key is made from the admin PIN: the server's salt, its rounds)
      this.adminSalt = typeof m.as === 'string' && /^[0-9a-f]{32}$/.test(m.as) ? m.as : '';
      this.adminRounds = Number.isInteger(m.ar) && m.ar >= 10000 && m.ar <= 2000000 ? m.ar : 0;
      for (const p of (Array.isArray(m.peers) ? m.peers : []).slice(0, 32)) this.peer(p, true);
      this.onworld?.({ t: 'ready', world: m.world ?? null, roster: m.roster, leads: m.leads, rules: m.rules });
    } else if (m.t === 'peer' && this.open) this.peer(m, m.on === true);
    else if (m.t === 'msg' && this.open && typeof m.from === 'string' && typeof m.data === 'string') this.onmessage?.(m.data, m.from);
    else if (m.t === 'deny') this.close(`denied ${typeof m.why === 'string' ? m.why.slice(0, 20) : ''}`.trim());
    else if (this.open && WORLD_MSGS.has(m.t)) this.onworld?.(m);
  }
  peer(p, on) {
    if (!p || typeof p.id !== 'string' || p.id.length > 16 || p.id === this.id) return;
    if (on) this.info.set(p.id, { name: cleanName(p.name), tag: isTag(p.tag) ? p.tag : '' });
    else this.info.delete(p.id);
    this.onpeer?.(p.id, 'world', on);
  }
  // scoped: to those on this player's map only (what only they could see - its pose, its look, its shots)
  send(text, to = null, fast = false, scoped = false) {
    if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(scoped && to === null ? { t: 'msg', to, data: text, m: 1 } : { t: 'msg', to, data: text }));
  }
  tell(obj) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  // the admin PIN (the server's adminPin, 12 digits): a key made slowly from it (PBKDF2 with the server's salt - so a
  // proof overheard on the way is no help in guessing the PIN), and that key proves it (an HMAC of this connection's
  // challenge); neither the PIN nor the key is sent. The key (hex) is what this PC keeps
  async adminKey(pin) {
    if (!this.adminSalt || !this.adminRounds) return '';
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const salt = new Uint8Array(this.adminSalt.match(/../g).map(h => parseInt(h, 16)));
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: this.adminRounds }, base, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async adminProve(keyHex) {
    if (!this.open || !this.nonce || !/^[0-9a-f]{64}$/.test(keyHex)) return false;
    const enc = new TextEncoder(), raw = new Uint8Array(keyHex.match(/../g).map(h => parseInt(h, 16)));
    const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, enc.encode(this.nonce + '|admin'));
    this.tell({ t: 'admin', proof: [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('') });
    return true;
  }
  close(why = 'closed') {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* */ } }
    this.onclose?.(why);
  }
}
// a player's tag (12 hex digits), and its name as it is shown: English letters, digits, space, - and _ (the
// keyboard types no others), 16 at most
export const isTag = s => typeof s === 'string' && /^[0-9a-f]{12}$/.test(s);
export const NAME_LEN = 16;
export const NAME_CHAR = /^[A-Za-z0-9 _-]$/;
export function cleanName(s) {
  if (typeof s !== 'string') return '';
  return [...s].filter(c => NAME_CHAR.test(c)).join('').replace(/ {2,}/g, ' ').trim().slice(0, NAME_LEN).trim();
}
// the rules of a server's worlds (coop_server.json, or as its host set them), taken as far as they make sense
export function takeRules(r) {
  r = r && typeof r === 'object' ? r : {};
  return {
    maxPlayers: Number.isInteger(r.maxPlayers) && r.maxPlayers >= 2 && r.maxPlayers <= 8 ? r.maxPlayers : 4,
    guestStartsBoss: r.guestStartsBoss === true,
    pvp: r.pvp === true,
    guestRespawn: r.guestRespawn !== false,     // (on unless set off)
    bossSpectate: r.bossSpectate !== false,
    statSync: r.statSync !== false,             // (on unless set off)
    guestsFollow: r.guestsFollow !== false,
    bossScale: r.bossScale !== false,
  };
}
async function hmacHex(key, text) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const MAX_TEXT = 4 << 20;

export class LocalLink {
  constructor(room) {
    this.id = Math.random().toString(36).slice(2, 10);
    this.onmessage = null;                       // (text, from)
    this.onclose = null;
    this.ch = new BroadcastChannel(`bsvr-coop:${room}`);
    this.ch.onmessage = e => {
      const d = e.data;
      if (!d || typeof d !== 'object' || d.from === this.id || (d.to && d.to !== this.id)) return;
      if (typeof d.text === 'string' && typeof d.from === 'string') this.onmessage?.(d.text, d.from);
    };
  }
  // to: one player (its id), or everyone listening (null)
  send(text, to = null) { this.ch?.postMessage({ from: this.id, to, text }); }
  close() { this.ch?.close(); this.ch = null; }
}

// RtcLink: two data channels - 'rel' delivers everything, in order (the world, looks, goodbyes); 'fast' is for
// poses (one that comes late is worth nothing: it is never sent again). How the two first reach each other (the
// offer, the answer, the routes) goes over a signal channel: the co-op server's room, or LocalSignal on one PC.
// relay: only routes through the relay server (TURN) are used - between two PCs always, so neither side ever gets
// the other's address; without it (one PC, a test) the PC's own routes do.
const CHUNK = 60000;             // characters per message piece (a data channel message tops out near 256 KB)
export class RtcLink {
  constructor(signal, { initiator = false, iceServers = [], relay = true } = {}) {
    this.onmessage = null; this.onopen = null; this.onclose = null;
    this.signal = signal;
    this.open = false; this.ended = false;
    this.parts = new Map();      // long messages coming in pieces: id -> { n, got, pieces }
    this.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relay ? 'relay' : 'all' });
    this.pc.onicecandidate = e => { if (e.candidate) signal.send({ ice: e.candidate.toJSON() }); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close(`connection ${s}`);
    };
    signal.onmessage = m => this.onSignal(m);
    if (initiator) {
      this.rel = this.wire(this.pc.createDataChannel('rel', { ordered: true }));
      this.fast = this.wire(this.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      this.offer();
    } else {
      this.pc.ondatachannel = e => {
        const ch = this.wire(e.channel);
        if (ch.label === 'rel') this.rel = ch; else if (ch.label === 'fast') this.fast = ch;
      };
    }
  }
  description() { const d = this.pc.localDescription; return { sdp: { type: d.type, sdp: d.sdp } }; }
  async offer() {
    try { await this.pc.setLocalDescription(); this.signal.send(this.description()); } catch (e) { this.close(`offer: ${e?.message || e}`); }
  }
  // (what comes over the signal channel is checked as everything else is)
  async onSignal(m) {
    if (this.ended || !m || typeof m !== 'object') return;
    try {
      const d = m.sdp;
      if (d && (d.type === 'offer' || d.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length < 20000) {
        await this.pc.setRemoteDescription({ type: d.type, sdp: d.sdp });
        if (d.type === 'offer') { await this.pc.setLocalDescription(); this.signal.send(this.description()); }
      } else if (m.ice && typeof m.ice.candidate === 'string' && m.ice.candidate.length < 1000) {
        await this.pc.addIceCandidate({
          candidate: m.ice.candidate,
          sdpMid: typeof m.ice.sdpMid === 'string' ? m.ice.sdpMid.slice(0, 16) : null,
          sdpMLineIndex: Number.isInteger(m.ice.sdpMLineIndex) ? m.ice.sdpMLineIndex : null,
        });
      }
    } catch (e) { console.warn('[coop] signal:', e?.message || e); }
  }
  wire(ch) {
    ch.onopen = () => {
      if (this.open || this.rel?.readyState !== 'open' || this.fast?.readyState !== 'open') return;
      this.open = true;
      this.signal?.close?.();            // (found each other: the signal channel is not needed any more)
      this.onopen?.();
    };
    ch.onclose = () => this.close('channel closed');
    ch.onmessage = e => this.take(e.data);
    return ch;
  }
  take(data) {
    if (typeof data !== 'string' || data.length > CHUNK + 64) return;
    if (data.charCodeAt(0) !== 1) { this.onmessage?.(data, 'peer'); return; }
    // a piece of a long message: \x01 id | i | n | text
    const m = /^\x01([a-z0-9]{1,8})\|(\d{1,4})\|(\d{1,4})\|/.exec(data);
    if (!m) return;
    const id = m[1], i = +m[2], n = +m[3];
    if (!(n > 0) || n * CHUNK > MAX_TEXT || i >= n) return;
    let p = this.parts.get(id);
    if (!p) {
      if (this.parts.size >= 4) return;
      p = { n, got: 0, pieces: [] };
      this.parts.set(id, p);
    }
    if (p.n !== n || p.pieces[i] !== undefined) return;
    p.pieces[i] = data.slice(m[0].length);
    if (++p.got < n) return;
    this.parts.delete(id);
    this.onmessage?.(p.pieces.join(''), 'peer');
  }
  // fast: a pose (the channel that never sends again)
  send(text, to = null, fast = false) {
    if (!this.open) return;
    try {
      if (fast) { this.fast.send(text); return; }
      if (text.length <= CHUNK) { this.rel.send(text); return; }
      const id = Math.random().toString(36).slice(2, 8), n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) this.rel.send(`\x01${id}|${i}|${n}|${text.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    } catch (e) { console.warn('[coop] send:', e?.message || e); }
  }
  close(why = 'closed') {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    try { this.pc.close(); } catch { /* */ }
    this.signal?.close?.();
    this.onclose?.(why);
  }
}

// a signal channel between two windows of one browser (RtcLink tried on one PC)
export class LocalSignal {
  constructor(room, me) {
    this.me = me;
    this.onmessage = null;
    this.ch = new BroadcastChannel(`bsvr-coop-signal:${room}`);
    this.ch.onmessage = e => { const d = e.data; if (d && typeof d === 'object' && d.from !== this.me) this.onmessage?.(d.m); };
  }
  send(m) { this.ch?.postMessage({ from: this.me, m }); }
  close() { this.ch?.close(); this.ch = null; }
}

// ServerLink: two PCs through the co-op server (coop-server/worker.js). Both come into a room by its code; once the
// other is there, each gets a relay pass from the server and the WebRTC link is made with it, relay only - the
// server only ever passes the handshake on, and the game goes over the relay. It looks to coop.js like any link.
export class ServerLink {
  constructor(base, code, role) {
    this.onmessage = null; this.onclose = null;
    this.open = false; this.ended = false; this.rtc = null;
    let ws;
    try { ws = new WebSocket(`${base.replace(/^http/, 'ws')}/room/${code}/ws?role=${role}`); } catch { setTimeout(() => this.close('server'), 0); return; }
    this.ws = ws;
    const signal = { onmessage: null, send: m => this.wsSend({ t: 'signal', m }), close: () => {} };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m !== 'object' || this.ended) return;
      if (m.t === 'signal') signal.onmessage?.(m.m);
      else if (m.t === 'peer' && !this.rtc) this.wsSend({ t: 'turn' });         // (the other is in: a relay pass, then the link)
      else if (m.t === 'turn' && !this.rtc) {
        if (!Array.isArray(m.iceServers) || !m.iceServers.length) { this.close(`relay ${typeof m.error === 'string' ? m.error.slice(0, 20) : ''}`); return; }
        this.rtc = new RtcLink(signal, { initiator: role === 'guest', iceServers: m.iceServers, relay: true });
        this.rtc.onopen = () => { this.open = true; };
        this.rtc.onmessage = (text, from) => this.onmessage?.(text, from);
        this.rtc.onclose = why => this.close(why);
      } else if (m.t === 'left' && !this.open) this.close('left');
    };
    ws.onclose = () => { if (!this.open) this.close('server'); };
  }
  wsSend(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  send(text, to = null, fast = false) { this.rtc?.send(text, to, fast); }
  close(why = 'closed') {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* */ } }
    this.rtc?.close(why);
    this.onclose?.(why);
  }
}
