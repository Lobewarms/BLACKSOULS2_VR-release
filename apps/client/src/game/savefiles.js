// Save-file transport. A failed listing must not be treated as empty slots when saving.
function base(kind) { return kind === 'world' ? 'world' : 'vr'; }
function slotPath(slot, kind) {
  if (!Number.isInteger(slot) || slot < 0) throw new Error('Invalid save slot');
  return `/api/${base(kind)}save/${slot}`;
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Save request failed (${response.status})`);
  return response.json();
}

export async function readSaveSlots(kind = 'vr') {
  const data = await readJson(`/api/${base(kind)}saves`);
  if (!data || !Array.isArray(data.slots)) throw new Error('Invalid save list');
  const seen = new Set();
  return data.slots.map(entry => {
    if (!entry || !Number.isInteger(entry.slot) || entry.slot < 0 || seen.has(entry.slot))
      throw new Error('Invalid save list entry');
    seen.add(entry.slot);
    return { ...entry, meta: entry.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? entry.meta : {} };
  });
}

export async function readSaveState(slot, kind = 'vr') {
  const data = await readJson(slotPath(slot, kind));
  const state = data?.state;
  if (!state || !Array.isArray(state.switches) || !Array.isArray(state.variables) ||
      !Array.isArray(state.actors) || !state.party || !Array.isArray(state.party.actors) ||
      !Number.isInteger(state.mapId) || state.mapId < 1 ||
      !Number.isFinite(state.start?.x) || !Number.isFinite(state.start?.y))
    throw new Error('Invalid save file');
  return state;
}

export async function writeSaveFile(slot, data, kind = 'vr') {
  const response = await fetch(slotPath(slot, kind), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Save write failed (${response.status})`);
}
