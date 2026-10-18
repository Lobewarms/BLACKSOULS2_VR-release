import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initAssets } from '../src/data/assets.js';

globalThis.location = { search: '?lang=en' };
const { $data, loadMapNames, destinationName } = await import('../src/data/data.js');

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

test('area-name fallbacks are translated in every supported UI language', () => {
  const module = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const [language, expected] of [['en', 'Area 7'], ['ko', '지역 7'], ['ja', 'エリア 7'], ['zh', '区域 7']]) {
    const code = `globalThis.location={search:'?lang=${language}'};const {tr}=await import(${JSON.stringify(module)});process.stdout.write(tr('지역 {id}',{id:7}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, expected);
  }
});
