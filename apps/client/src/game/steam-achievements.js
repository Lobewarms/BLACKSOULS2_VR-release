import { G } from '../core/globals.js';

const MAX_PENDING = 256;
const validName = name => typeof name === 'string' && name.length > 0 && !/[\x00-\x1f\x7f]/.test(name)
  && new TextEncoder().encode(name).length <= 256;

// All original award blocks use this exact three-line call. Keep it out of the
// general Ruby scope: formulas, previews and arbitrary Ruby helpers cannot award.
export function steamAchievementName(source) {
  if (typeof source !== 'string') return null;
  const match = /^steam = SteamUserStatsLite\.instance\r?\nsteam\.set_achievement '([^'\r\n]+)'\r?\nsteam\.update$/.exec(source.trim());
  return match && validName(match[1]) ? match[1] : null;
}

function ownerSession() {
  const coop = G.coop;
  return G.devLaunch === false && !coop?.phantom && !coop?.applying && !coop?.cycling && !coop?.spectating
    && (!coop?.role || coop.role === 'host');
}

function earnedContext(name, context) {
  const interpreter = context?.interpreter, index = context?.commandIndex;
  if (context?.replay || interpreter?.replay || !interpreter?.running?.() || !Number.isInteger(index) || index < 0) return false;
  const list = interpreter.list;
  if (!Array.isArray(list) || list[index]?.code !== 355 || typeof list[index].parameters?.[0] !== 'string') return false;
  let source = list[index].parameters[0], last = index;
  while (list[last + 1]?.code === 655) source += '\n' + list[++last].parameters?.[0];
  return interpreter.index === last && source === context.source && steamAchievementName(source) === name;
}

function pendingFor(state) {
  const pending = [], seen = new Set();
  for (const name of Array.isArray(state.system.steamAchievements) ? state.system.steamAchievements : []) {
    if (validName(name) && !seen.has(name)) { seen.add(name); pending.push(name); }
    if (pending.length >= MAX_PENDING) break;
  }
  state.system.steamAchievements = pending;
  return pending;
}

function sessionConfig(value) {
  if (value?.schema !== 1 || !/^[a-f0-9]{64}$/i.test(value.token || '') || typeof value.endpoint !== 'string') return null;
  try {
    const url = new URL(value.endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1 || Number(url.port) > 65535
      || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return { endpoint: url.href, token: value.token };
  } catch { return null; }
}

export class SteamAchievements {
  constructor({ fetch: fetcher = (...args) => globalThis.fetch(...args), timeoutMs = 12000, statusTimeoutMs = 6000 } = {}) {
    this.fetcher = fetcher;
    this.timeoutMs = Math.max(10, Math.min(15000, Number(timeoutMs) || 12000));
    this.statusTimeoutMs = Math.max(10, Math.min(this.timeoutMs, Number(statusTimeoutMs) || 6000));
    this.config = null;
    this.state = 'unavailable';
    this.allowed = new Set();
    this.beginning = null;
    this.flushing = null;
    this.flushRequested = false;
  }

  async request(url, options = {}, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.fetcher(url, { cache: 'no-store', credentials: 'omit', ...options, signal: controller.signal }))
          .then(response => response?.ok ? response.json() : null).catch(() => null),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  begin() {
    if (!ownerSession()) return Promise.resolve(false);
    if (this.beginning) return this.beginning;
    this.beginning = this.discover().finally(() => { this.beginning = null; });
    return this.beginning;
  }

  async discover() {
    if (!this.config) this.config = sessionConfig(await this.request('/steam-session.json', {}, this.statusTimeoutMs));
    if (!this.config || !ownerSession()) return false;
    let status;
    // Steam's first stats callback can arrive after the native status wait.
    // Retry only its explicit pending state, with a bounded startup budget.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!ownerSession()) return false;
      status = await this.request(this.config.endpoint + 'status', { headers: { 'X-BS-Steam-Token': this.config.token } }, this.statusTimeoutMs);
      if (status?.state !== 'pending' || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ownerSession()) return false;
    if (status?.state !== 'ready' || !Array.isArray(status.achievements) || status.achievements.length > 4096
      || status.achievements.some(name => !validName(name))) {
      this.state = 'unavailable'; this.allowed.clear(); return false;
    }
    this.allowed = new Set(status.achievements);
    this.state = 'ready';
    return true;
  }

  record(name, context) {
    const state = G.state;
    if (!ownerSession() || !state?.system || !validName(name) || !earnedContext(name, context)) return false;
    const pending = pendingFor(state);
    if (!pending.includes(name)) {
      if (pending.length >= MAX_PENDING) return false;
      pending.push(name);
    }
    void this.flush();
    return true;
  }

  flush() {
    if (!ownerSession() || !G.state?.system) return Promise.resolve(false);
    this.flushRequested = true;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let acknowledged = false;
      do {
        this.flushRequested = false;
        acknowledged = await this.flushState(G.state) || acknowledged;
      } while (this.flushRequested && ownerSession() && G.state?.system);
      return acknowledged;
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async flushState(state) {
    const pending = pendingFor(state);
    if (!pending.length) return false;
    if (!this.config || this.state !== 'ready') await this.begin();
    if (!ownerSession() || G.state !== state || this.state !== 'ready' || !this.config) return false;
    const names = pendingFor(state).filter(name => this.allowed.has(name));
    if (!names.length) return false;
    const result = await this.request(this.config.endpoint + 'unlock', { method: 'POST',
      headers: { 'X-BS-Steam-Token': this.config.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) });
    if (result?.state !== 'ready' || !Array.isArray(result.unlocked)) { this.state = 'unavailable'; return false; }
    const sent = new Set(names), acknowledged = new Set(result.unlocked.filter(name => sent.has(name) && this.allowed.has(name)));
    // Only a native-confirmed acknowledgement removes earned pending work. An
    // in-flight response belongs to its captured save, never a newly loaded one.
    if (acknowledged.size) state.system.steamAchievements = pendingFor(state).filter(name => !acknowledged.has(name));
    return acknowledged.size > 0;
  }
}
