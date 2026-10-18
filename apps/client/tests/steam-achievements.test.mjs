import test from 'node:test';
import assert from 'node:assert/strict';
import { SteamAchievements, steamAchievementName } from '../src/game/steam-achievements.js';
import { Interpreter } from '../src/game/interpreter.js';
import { G } from '../src/core/globals.js';

const TOKEN = 'a'.repeat(64), ENDPOINT = 'http://127.0.0.1:49187/';
const command = (code, parameters = [], indent = 0) => ({ code, parameters, indent });
const source = name => `steam = SteamUserStatsLite.instance\nsteam.set_achievement '${name}'\nsteam.update`;
const award = (name, indent = 0) => [command(355, ['steam = SteamUserStatsLite.instance'], indent),
  command(655, [`steam.set_achievement '${name}'`], indent), command(655, ['steam.update'], indent)];

function environment(t, { names = ['Moon-viewing', 'fire', 'Fresh Meat', '【　　】'], unavailable = false, status, unlock, timeoutMs } = {}) {
  const saved = { ...G }; t.after(() => { for (const key of Object.keys(G)) if (!(key in saved)) delete G[key]; Object.assign(G, saved); });
  const variables = new Map(), switches = new Map();
  Object.assign(G, { devLaunch: false, coop: null, map: { mapId: 9, events: {}, transferring: false },
    state: { system: {}, v: id => variables.get(id) || 0, setV: (id, value) => variables.set(id, value), sw: id => switches.get(id) || false },
    ui: { messageBusy: () => false },
  });
  const requests = [], control = { unavailable, config: { schema: 1, endpoint: ENDPOINT, token: TOKEN } };
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url === '/steam-session.json') return control.config ? Response.json(control.config) : new Response('', { status: 404 });
    assert.equal(options.headers['X-BS-Steam-Token'], TOKEN);
    if (url === ENDPOINT + 'status') return status ? status(control) : Response.json(control.unavailable ? { state: 'unavailable', achievements: [] } : { state: 'ready', achievements: names });
    assert.equal(url, ENDPOINT + 'unlock'); assert.equal(options.method, 'POST');
    const sent = JSON.parse(options.body).names;
    return unlock ? unlock(sent, control) : Response.json({ state: 'ready', unlocked: sent });
  };
  const service = G.steamAchievements = new SteamAchievements({ fetch: fetcher, timeoutMs });
  const run = (name, { before = [], mapAfterSetup } = {}) => {
    const interpreter = new Interpreter(); interpreter.setup([...before, ...award(name), command(0)]);
    if (mapAfterSetup != null) G.map.mapId = mapAfterSetup;
    interpreter.update(); return interpreter;
  };
  return { service, requests, control, run, variables, switches, posts: () => requests.filter(r => r.url === ENDPOINT + 'unlock') };
}

test('only the exact original three-line award is recognized, preserving spaces, case and Unicode API names', () => {
  for (const name of ['Moon-viewing', 'Fresh Meat', 'S T A R', '【　　】', '  exact spacing  ']) {
    assert.equal(steamAchievementName(source(name)), name);
    assert.equal(steamAchievementName(source(name).replaceAll('\n', '\r\n')), name);
  }
  for (const ruby of ['steam.update', "steam.set_achievement 'fire'", source('fire') + '\n$game_variables[1] = 7',
    source('fire').replace('steam.update', 'steam.reset_all_stats'), source('fire').replace("'fire'", 'some_variable'),
    source('fire').replace('SteamUserStatsLite.instance', 'Other.instance'), source('x\0y'), source('')]) {
    assert.equal(steamAchievementName(ruby), null);
  }
});

test('real command355/655 follows earned branches, dispatches once and leaves unrelated Ruby behavior intact', async t => {
  const e = environment(t);
  const interpreter = new Interpreter();
  interpreter.setup([command(111, [0, 7, 0]), ...award('fire', 1), command(412),
    command(355, ['$game_variables[8] = 31']), ...award('Fresh Meat'), command(0)]);
  interpreter.update();
  assert.equal(G.state.v(8), 31); assert.deepEqual(G.state.system.steamAchievements, ['Fresh Meat']);
  await e.service.flush();
  assert.deepEqual(e.posts().map(r => JSON.parse(r.options.body).names), [['Fresh Meat']]);
  assert.deepEqual(G.state.system.steamAchievements, []);
  assert.equal(e.requests[0].url, '/steam-session.json');
  assert.ok(e.requests.every(r => r.options.cache === 'no-store' && r.options.credentials === 'omit' && r.options.signal instanceof AbortSignal));
});

test('an original source can earn after a map transfer, and exact Unicode IDs survive the native JSON request', async t => {
  const e = environment(t); e.run('【　　】', { mapAfterSetup: 17 });
  await e.service.flush(); assert.deepEqual(JSON.parse(e.posts()[0].options.body), { names: ['【　　】'] });
});

test('debug, previews, nonowners, phantom guests and replay contexts neither enqueue nor send awards', async t => {
  const e = environment(t);
  for (const mode of [{ dev: true, coop: null }, { dev: undefined, coop: null }, { dev: false, coop: { phantom: true } },
    { dev: false, coop: { role: 'guest' } }, { dev: false, coop: { role: 'world' } },
    { dev: false, coop: { role: 'host', applying: true } }, { dev: false, coop: { role: 'host', cycling: true } },
    { dev: false, coop: { role: 'host', spectating: true } }]) {
    G.devLaunch = mode.dev; G.coop = mode.coop; e.run('fire'); await e.service.flush();
    assert.equal(G.state.system.steamAchievements, undefined);
  }
  G.devLaunch = false; G.coop = null;
  const it = new Interpreter(); it.setup(award('fire')); it.index = 2;
  const context = { interpreter: it, commandIndex: 0, source: source('fire') };
  assert.equal(e.service.record('fire', { ...context, replay: true }), false);
  assert.equal(e.service.record('fire', { ...context, source: source('Fresh Meat') }), false);
  assert.equal(e.service.record('fire', { ...context, commandIndex: 1 }), false);
  it.terminate(); assert.equal(e.service.record('fire', context), false);
  assert.equal(e.requests.length, 0);
});

test('unavailable Steam keeps deduplicated earned pending data without background retries, then retries on a later earned trigger', async t => {
  const e = environment(t, { unavailable: true });
  e.run('Moon-viewing'); await e.service.flush();
  assert.deepEqual(G.state.system.steamAchievements, ['Moon-viewing']); assert.equal(e.posts().length, 0);
  const reads = e.requests.length; await Promise.resolve(); await Promise.resolve(); assert.equal(e.requests.length, reads);
  e.control.unavailable = false; e.run('Moon-viewing'); await e.service.flush();
  assert.deepEqual(e.posts().map(r => JSON.parse(r.options.body).names), [['Moon-viewing']]);
  assert.deepEqual(G.state.system.steamAchievements, []);
});

test('native pending readiness retries within one begin and only unlocks after the ready schema arrives', async t => {
  let reads = 0;
  const e = environment(t, { status: () => Response.json(++reads < 3
    ? { state: 'pending' } : { state: 'ready', achievements: ['fire'] }) });
  G.state.system.steamAchievements = ['fire'];
  assert.equal(await e.service.flush(), true);
  assert.equal(reads, 3); assert.equal(e.posts().length, 1);
  assert.deepEqual(G.state.system.steamAchievements, []);
});

test('pending readiness stops after three status reads, retains earned work and can retry on a later trigger', async t => {
  let reads = 0, pending = true;
  const e = environment(t, { status: () => { reads++; return Response.json(pending
    ? { state: 'pending' } : { state: 'ready', achievements: ['fire'] }); } });
  G.state.system.steamAchievements = ['fire'];
  assert.equal(await e.service.flush(), false); assert.equal(reads, 3);
  assert.equal(e.posts().length, 0); assert.deepEqual(G.state.system.steamAchievements, ['fire']);
  await new Promise(resolve => setTimeout(resolve, 230)); assert.equal(reads, 3, 'no background readiness loop');
  pending = false; e.run('fire'); await e.service.flushing;
  assert.equal(reads, 4); assert.equal(e.posts().length, 1); assert.deepEqual(G.state.system.steamAchievements, []);
});

test('failed and partial native acknowledgements never mark unconfirmed earned achievements successful', async t => {
  let attempt = 0;
  const e = environment(t, { unlock: async names => {
    attempt++;
    if (attempt === 1) return new Response('', { status: 503 });
    if (attempt === 2) return Response.json({ state: 'ready', unlocked: [names[0], 'not-requested'] });
    return Response.json({ state: 'ready', unlocked: names });
  } });
  G.state.system.steamAchievements = ['fire', 'Moon-viewing'];
  await e.service.flush(); assert.deepEqual(G.state.system.steamAchievements, ['fire', 'Moon-viewing']);
  await e.service.flush(); assert.deepEqual(G.state.system.steamAchievements, ['Moon-viewing']);
  await e.service.flush(); assert.deepEqual(G.state.system.steamAchievements, []);
});

test('pending earned work can resume from a saved system field without inferring achievements from progress flags', async t => {
  const e = environment(t); G.state.system = { steamAchievements: ['fire', 'fire', 'Moon-viewing'], bossDefeated: true };
  await e.service.begin(); assert.equal(e.posts().length, 0, 'discovery alone is read-only');
  await e.service.flush(); assert.deepEqual(JSON.parse(e.posts()[0].options.body).names, ['fire', 'Moon-viewing']);
  assert.equal(G.state.system.bossDefeated, true);
});

test('pending names and native batches are bounded, deduplicated and limited to native known API IDs', async t => {
  const names = Array.from({ length: 300 }, (_, i) => `Synthetic achievement ${i}`), e = environment(t, { names });
  G.state.system.steamAchievements = [null, '', '\0', ...names, names[0]];
  await e.service.flush(); const sent = JSON.parse(e.posts()[0].options.body).names;
  assert.equal(sent.length, 256); assert.equal(new Set(sent).size, 256); assert.deepEqual(G.state.system.steamAchievements, []);
  G.state.system.steamAchievements = ['not-a-native-id']; await e.service.flush();
  assert.equal(e.posts().length, 1); assert.deepEqual(G.state.system.steamAchievements, ['not-a-native-id']);
});

test('native schema-unknown IDs remain pending without a fabricated success or an unlock request', async t => {
  const e = environment(t, { names: ['fire'] });
  G.state.system.steamAchievements = ['original-but-unlisted'];
  assert.equal(await e.service.flush(), false);
  assert.equal(e.service.state, 'ready'); assert.equal(e.posts().length, 0);
  assert.deepEqual(G.state.system.steamAchievements, ['original-but-unlisted']);
});

test('unavailable old backends and invalid session endpoints fail quietly without unlock requests', async t => {
  const e = environment(t);
  for (const config of [null, { schema: 2, endpoint: ENDPOINT, token: TOKEN }, { schema: 1, endpoint: ENDPOINT, token: 'bad' },
    { schema: 1, endpoint: 'http://example.com:49187/', token: TOKEN }, { schema: 1, endpoint: 'https://127.0.0.1:49187/', token: TOKEN },
    { schema: 1, endpoint: 'http://127.0.0.1:49187/private?token=x', token: TOKEN }]) {
    e.control.config = config; const service = new SteamAchievements({ fetch: async url => { assert.equal(url, '/steam-session.json'); return config ? Response.json(config) : new Response('', { status: 404 }); } });
    G.state.system.steamAchievements = ['fire']; assert.equal(await service.flush(), false);
    assert.deepEqual(G.state.system.steamAchievements, ['fire']); assert.equal(service.config, null);
  }
  assert.equal(e.posts().length, 0);
});

test('fetch timeouts finish discovery, abort its request and retain earned pending work', async t => {
  environment(t); let signal;
  const service = new SteamAchievements({ timeoutMs: 10, fetch: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  G.state.system.steamAchievements = ['fire']; assert.equal(await service.flush(), false);
  assert.equal(signal.aborted, true); assert.deepEqual(G.state.system.steamAchievements, ['fire']);
});

test('native store requests allow twelve seconds while discovery uses the shorter status timeout', () => {
  const service = new SteamAchievements();
  assert.equal(service.timeoutMs, 12000); assert.equal(service.statusTimeoutMs, 6000);
  assert.equal(new SteamAchievements({ timeoutMs: 999999 }).timeoutMs, 15000);
  assert.equal(new SteamAchievements({ timeoutMs: 10 }).statusTimeoutMs, 10);
});

test('an acknowledgement belongs to its captured save and cannot remove pending work from a newly loaded save', async t => {
  let resolve, started;
  const startedPromise = new Promise(r => { started = r; });
  const e = environment(t, { unlock: async names => { started(); return new Promise(r => { resolve = () => r(Response.json({ state: 'ready', unlocked: names })); }); } });
  const original = G.state; original.system.steamAchievements = ['fire']; const flushing = e.service.flush(); await startedPromise;
  const next = G.state = { system: { steamAchievements: ['Moon-viewing'] } };
  resolve(); await flushing;
  assert.deepEqual(original.system.steamAchievements, []); assert.deepEqual(next.system.steamAchievements, ['Moon-viewing']);
});

test('an award earned during an in-flight native request is flushed after its predecessor without losing either acknowledgement', async t => {
  let firstResolve, firstStarted;
  const ready = new Promise(r => { firstStarted = r; }); let posts = 0;
  const e = environment(t, { unlock: async names => {
    if (++posts === 1) { firstStarted(); return new Promise(resolve => { firstResolve = () => resolve(Response.json({ state: 'ready', unlocked: names })); }); }
    return Response.json({ state: 'ready', unlocked: names });
  } });
  e.run('fire'); await ready; e.run('Fresh Meat'); firstResolve(); await e.service.flush();
  assert.deepEqual(e.posts().map(r => JSON.parse(r.options.body).names), [['fire'], ['Fresh Meat']]);
  assert.deepEqual(G.state.system.steamAchievements, []);
});
