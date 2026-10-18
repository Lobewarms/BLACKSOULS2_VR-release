import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initAssets } from '../src/data/assets.js';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
const { $data } = await import('../src/data/data.js');
const { prepareSaveLocations, saveLocation } = await import('../src/game/savepresentation.js');
const { UI } = await import('../src/ui/ui.js');

function mapBytes(name) {
  const string = (tag, text) => { const b = Buffer.from(text); return [tag, b.length ? b.length + 5 : 0, ...b]; };
  return Uint8Array.from([4, 8, 111, ...string(58, 'RPG::Map'), 6,
    ...string(58, '@display_name'), ...string(34, name)]);
}

test('old VR saves display translated locations without changing their stored metadata', async t => {
  const old = $data.mapInfos;
  t.after(() => { $data.mapInfos = old; });
  $data.mapInfos = new Map([[910, { name: '内部編集名', parent_id: 0 }],
    [911, { name: '下水道２', parent_id: 910 }]]);
  const slots = [{ slot: 0, meta: { mapId: 910, map: '内部編集名' } },
    { slot: 1, meta: { mapId: 911, map: '下水道２' } },
    { slot: 2, meta: { mapId: 911, map: '下水道２' } }];
  const original = JSON.stringify(slots);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/manifest') return Response.json({ files: ['Data/Map910.rvdata2', 'Data/Map911.rvdata2'] });
    requests.push(url);
    return new Response(mapBytes(url.includes('910') ? 'Translated town' : ''));
  });
  await initAssets();
  await prepareSaveLocations(slots);
  assert.deepEqual(slots.map(s => saveLocation(s.meta)), ['Translated town', 'Translated town', 'Translated town']);
  assert.equal(JSON.stringify(slots), original, 'listing saves must not rewrite player data');
  assert.equal(requests.length, 2, 'load each map once and resolve unnamed rooms through their parent');

  const before = { coop: G.coop, listSaves: G.listSaves, saveMeta: G.saveMeta };
  t.after(() => Object.assign(G, before));
  G.coop = { role: 'world', wphase: 'choosing' };
  G.listSaves = async () => slots;
  G.saveMeta = meta => ({ map: saveLocation(meta), date: '', desc: '' });
  let rows;
  await UI.prototype.showWorldLoad.call({ list: { open(_title, entries) { rows = entries; } } }, 'world');
  assert.ok(rows.every(row => row.text.includes('Translated town')));
  assert.ok(rows.every(row => !row.text.includes('下水道') && !row.text.includes('内部')));
});

test('unreadable saved locations use localized area names and very old saves retain their label', async t => {
  t.mock.method(globalThis, 'fetch', async url => url === '/api/manifest' ?
    Response.json({ files: ['Data/Map912.rvdata2'] }) : new Response('Unavailable', { status: 503 }));
  await initAssets();
  await prepareSaveLocations([{ meta: { mapId: 912, map: '编辑名' } }, { meta: {} }]);
  assert.equal(saveLocation({ mapId: 912, map: '编辑名' }), 'Area 912');
  assert.equal(saveLocation({ map: 'Legacy location without an ID' }), 'Legacy location without an ID');
  assert.equal(saveLocation(null), '');
});

test('save menus, confirmations and notices follow launcher language even on a Chinese browser', () => {
  const module = new URL('../src/ui/i18n.js', import.meta.url).href;
  for (const [language, title, saved] of [
    ['en', 'VR save — choose a slot', 'Saved to VR slot 2'],
    ['ja', 'VRセーブ — 保存するスロット', 'VRセーブ 2 に保存しました'],
    ['ko', 'VR 세이브 — 저장할 슬롯', 'VR 세이브 2번에 저장했습니다'],
    ['zh', 'VR 存档 — 选择存档位', '已保存到 VR 存档 2'],
  ]) {
    const code = `globalThis.location={search:'?lang=${language}'};
      Object.defineProperty(globalThis,'navigator',{value:{language:'zh-CN'}});
      const {tr,fmtDate}=await import(${JSON.stringify(module)});
      process.stdout.write(JSON.stringify([tr('VR 세이브 — 저장할 슬롯'),tr('VR 세이브 {n}번에 저장했습니다',{n:2}),fmtDate(1700000000000)]));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const [actualTitle, actualSaved, date] = JSON.parse(result.stdout);
    assert.equal(actualTitle, title); assert.equal(actualSaved, saved);
    if (language === 'en') assert.doesNotMatch(date, /[年月日上下午]/u);
  }
});
