import test from 'node:test';
import assert from 'node:assert/strict';
import { readSaveSlots, readSaveState, writeSaveFile } from '../src/game/savefiles.js';
import { GameState } from '../src/game/state.js';

test('save listing reports server failures instead of claiming the slots are empty', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ slots: [] }, { status: 503 }));
  await assert.rejects(readSaveSlots(), /503/);
});

test('malformed or duplicate save-slot entries cannot become empty-slot menus', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const data of [{}, { slots: null }, { slots: [null] }, { slots: [{ slot: -1 }] },
    { slots: [{ slot: 1 }, { slot: 1 }] }]) {
    fetch.mock.mockImplementation(async () => Response.json(data));
    await assert.rejects(readSaveSlots(), /Invalid save list/);
  }
});

test('valid occupied saves keep their slot even when older saves lack metadata', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/worldsaves');
    return Response.json({ slots: [{ slot: 0 }, { slot: 2, meta: { map: 'Forest' } }] });
  });
  assert.deepEqual(await readSaveSlots('world'), [{ slot: 0, meta: {} }, { slot: 2, meta: { map: 'Forest' } }]);
});

test('failed or invalid loads never return a new game state', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'missing' }, { status: 404 }));
  await assert.rejects(readSaveState(1), /404/);
  for (const data of [{}, { state: null }, { state: [] }, { state: {} },
    { state: { actors: [], party: { actors: [] }, mapId: 1, start: { x: 0, y: 0 } } }]) {
    fetch.mock.mockImplementation(async () => Response.json(data));
    await assert.rejects(readSaveState(1), /Invalid save file/);
  }
});

test('loads preserve the saved state and writes target the correct slot', async t => {
  const game = new GameState();
  game.mapId = 12; game.start = { x: 2, y: 3, dir: 2 };
  const state = game.toJSON();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/worldsave/3');
    if (options) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { state });
    }
    return Response.json({ state });
  });
  assert.deepEqual(await readSaveState(3, 'world'), state);
  assert.deepEqual(GameState.fromJSON(await readSaveState(3, 'world')).toJSON(), state);
  await writeSaveFile(3, { state }, 'world');
});

test('write failures and connection loss are reported to the caller', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }));
  await assert.rejects(writeSaveFile(1, {}), /500/);
  fetch.mock.mockImplementation(async () => { throw new Error('connection closed'); });
  await assert.rejects(writeSaveFile(1, {}), /connection closed/);
});
