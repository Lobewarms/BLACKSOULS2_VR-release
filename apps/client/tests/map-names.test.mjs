import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initAssets } from '../src/data/assets.js';

globalThis.location = { search: '?lang=en' };
const { $data, loadMapNames, destinationName } = await import('../src/data/data.js');
const { prepareOriginalSaveLocations } = await import('../src/game/savepresentation.js');
const { analyzeMap } = await import('../src/world/mapanalysis.js');
const { UI } = await import('../src/ui/ui.js');
const { G } = await import('../src/core/globals.js');

function mapBytes(name) {
  const string = (tag, text) => { const b = Buffer.from(text); return [tag, b.length ? b.length + 5 : 0, ...b]; };
  return Uint8Array.from([4, 8, 111, ...string(58, 'RPG::Map'), 6,
    ...string(58, '@display_name'), ...string(34, name)]);
}

test('exit names use translated destination titles and parent titles instead of editor names', async t => {
  const old = $data.mapInfos;
  t.after(() => { $data.mapInfos = old; });
  $data.mapInfos = new Map([[801, { name: '内部編集名', parent_id: 0 }],
    [802, { name: '２－１', parent_id: 801 }]]);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/manifest') return Response.json({ files: ['Data/Map801.rvdata2', 'Data/Map802.rvdata2'] });
    calls.push(url);
    return new Response(mapBytes(url.includes('801') ? 'Library Dream' : ''));
  });
  await initAssets();
  await loadMapNames([802, 802]);
  assert.equal(destinationName(801), 'Library Dream');
  assert.equal(destinationName(802), 'Library Dream', 'unnamed rooms inherit the translated area');
  assert.equal(calls.length, 2, 'duplicate exit cells must not duplicate map downloads');
  await loadMapNames([802]);
  assert.equal(calls.length, 2, 'remember names even when resolving exits again');
});

test('an unreadable destination uses a localized fallback without blocking map loading', async t => {
  const old = $data.mapInfos;
  t.after(() => { $data.mapInfos = old; });
  $data.mapInfos = new Map([[803, { name: '编辑名', parent_id: 803 }]]);
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ?
    Response.json({ files: ['Data/Map803.rvdata2'] }) : new Response('Unavailable', { status: 503 }));
  await initAssets();
  await loadMapNames([803]);
  assert.equal(destinationName(803), 'Area 803');
});

test('original-save listings resolve translated map and parent names without changing imported contents', async t => {
  const old = $data.mapInfos;
  t.after(() => { $data.mapInfos = old; });
  $data.mapInfos = new Map([[804, { name: '内部編集名', parent_id: 0 }],
    [805, { name: '１－４', parent_id: 804 }], [806, { name: '编辑名', parent_id: 0 }]]);
  const contents = id => new Map([['map', { map_id: id }], ['party', { gold: 10 }]]);
  const rows = [{ label: 'Save01', contents: contents(804) }, { label: 'Save02', contents: contents(805) },
    { label: 'Save03', contents: contents(805) }, { label: 'Save04', contents: contents(806) },
    { text: 'Unreadable save', enabled: false }];
  const original = rows.map(row => row.contents && structuredClone(row.contents)), calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/manifest') return Response.json({ files: [804, 805, 806].map(id => `Data/Map${id}.rvdata2`) });
    calls.push(url);
    return url.includes('806') ? new Response('Unavailable', { status: 503 }) : new Response(mapBytes(url.includes('804') ? 'Translated kingdom' : ''));
  });
  await initAssets();
  const located = await prepareOriginalSaveLocations(rows);
  assert.deepEqual(located.map(row => row.map), ['Translated kingdom', 'Translated kingdom', 'Translated kingdom', 'Area 806', undefined]);
  assert.equal(calls.length, 3, 'multiple save slots reuse the same bounded map-name cache');
  for (let i = 0; i < rows.length; i++) {
    assert.deepEqual(rows[i].contents, original[i]);
    assert.equal(located[i].contents, rows[i].contents, 'only presentation rows are copied, never the save object');
    assert.equal(rows[i].map, undefined, 'the source listing remains unchanged');
  }
  assert.equal(located[4], rows[4], 'unreadable-slot presentation stays disabled');
});

test('raw map analysis uses player-facing event and region exit names, including localized unloaded fallbacks', async t => {
  const old = { mapInfos: $data.mapInfos, commonEvents: $data.commonEvents };
  t.after(() => Object.assign($data, old));
  $data.mapInfos = new Map([[807, { name: '内部編集名', parent_id: 0 }], [808, { name: '２', parent_id: 807 }],
    [809, { name: '未読編集名', parent_id: 0 }]]);
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ?
    Response.json({ files: ['Data/Map807.rvdata2', 'Data/Map808.rvdata2'] }) : new Response(mapBytes(url.includes('807') ? 'Translated forest' : '')));
  await initAssets(); await loadMapNames([808]);
  const transfer = id => ({ code: 201, parameters: [0, id, 1, 1] });
  const event = id => ({ id, x: 0, y: 0, pages: [{ trigger: 0, graphic: {}, list: [transfer(id)] }] });
  $data.commonEvents = []; $data.commonEvents[21] = { list: [transfer(808)] };
  const map = { __id: 800, note: 'RCE:3,21,0', events: new Map([[808, event(808)], [809, event(809)]]) };
  const analysis = analyzeMap(map, { w: 1, h: 1, region: () => 3 });
  assert.deepEqual(analysis.exits.map(exit => [exit.kind, exit.label]),
    [['event', 'Translated forest'], ['event', 'Area 809'], ['region', 'Translated forest']]);
});

function memberMenu(t, id) {
  const old = { mapInfos: $data.mapInfos, coop: G.coop };
  t.after(() => { $data.mapInfos = old.mapInfos; G.coop = old.coop; });
  $data.mapInfos = new Map([[id, { name: '編集用エリア', parent_id: 0 }]]);
  G.coop = { role: 'guest', world: false, members: () => [{ id: 'one', name: 'Player', map: id, me: true },
    { id: 'two', name: 'Companion', map: 0 }] };
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ?
    Response.json({ files: [`Data/Map${id}.rvdata2`] }) : response);
  const list = { visible: true, draws: 0, open(_title, items, options) { this.items = items; this.index = options.index; }, draw() { this.draws++; } };
  return { ui: { list }, list, finish: title => finish(new Response(mapBytes(title))) };
}

test('co-op members show localized fallbacks immediately and translated locations after loading without changing selection', async t => {
  const e = memberMenu(t, 810); await initAssets();
  UI.prototype.showCoopMembers.call(e.ui, 1);
  const items = e.list.items;
  assert.deepEqual(items.map(item => item.right), ['Area 810', 'Moving']);
  e.finish('Translated valley'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.list.items, items); assert.equal(e.list.index, 1);
  assert.deepEqual(items.map(item => item.right), ['Translated valley', 'Moving']);
  assert.equal(e.list.draws, 1, 'refresh the active list rather than reopening its selection');
});

for (const change of ['replaced', 'closed', 'session']) test(`late co-op map names do not modify a ${change} menu`, async t => {
  const e = memberMenu(t, { replaced: 811, closed: 812, session: 813 }[change]); await initAssets();
  UI.prototype.showCoopMembers.call(e.ui);
  const items = e.list.items;
  if (change === 'replaced') e.list.items = [{ text: 'Other menu' }];
  if (change === 'closed') e.list.visible = false;
  if (change === 'session') G.coop = { role: 'guest' };
  e.finish('Translated coast'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.list.draws, 0);
  assert.match(items[0].right, /^Area /, 'stale presentation rows are not mutated by a completed download');
  if (change === 'replaced') assert.deepEqual(e.list.items, [{ text: 'Other menu' }]);
});

test('area-name fallbacks are translated in every supported UI language', () => {
  const module = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const [language, expected] of [['en', 'Area 7'], ['ko', '지역 7'], ['ja', 'エリア 7'], ['zh', '区域 7']]) {
    const code = `globalThis.location={search:'?lang=${language}'};const {tr}=await import(${JSON.stringify(module)});process.stdout.write(tr('지역 {id}',{id:7}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, expected);
  }
});
