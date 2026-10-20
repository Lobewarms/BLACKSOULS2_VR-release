import { G } from '../core/globals.js';
import { tr } from '../ui/i18n.js';
import { saveLocation } from './savepresentation.js';

// The ordinary menu returns to its Save command. Event command 352 instead
// owns the whole dialog, including asynchronous reads/writes, until it closes.
export function showManualSaveMenu({ event = false, listSaves, saveSlot, selectedSlot, rememberSlot, metaDate, slotDesc, slots = 16 }) {
  const ui = G.ui, state = G.state, map = G.map, mapId = map?.mapId;
  const kind = G.coop.role === 'world' ? 'world' : 'vr';
  let finish, finished = false;
  const completion = event ? new Promise(resolve => { finish = resolve; }) : null;
  const current = () => !finished && (!event || G.ui === ui && G.state === state && G.map === map && G.map?.mapId === mapId);
  const complete = result => { if (!finished) { finished = true; finish?.(result); } };
  const back = () => {
    if (event) { if (current()) ui.closeMenu(); complete(false); }
    else ui.reopenMain('save');
  };
  const title = () => kind === 'world' ? tr('개발자 서버 세이브 — 저장할 슬롯') : tr('세이브 — 저장할 슬롯');
  const showSlots = async () => {
    if (!current()) { complete(false); return; }
    // VX Ace command352 opens the authored save scene independently of the
    // ordinary menu's save_disabled flag (e.g. Chaos Dungeon skull checkpoints).
    if ((!event && state?.system.saveDisabled) || G.coop.phantom || (kind === 'world' && !G.coop.world)) {
      ui.toast(tr('지금은 저장할 수 없습니다')); back(); return;
    }
    if (event) { ui.menuOpen = true; ui.list.close(); }
    let saves;
    try { saves = await listSaves(kind, true); }
    catch {
      if (!current()) { complete(false); return; }
      const error = tr('저장 목록을 읽지 못했습니다. 다시 시도해 주세요');
      ui.toast(error);
      if (!event) { back(); return; }
      ui.list.open(title(), [{ text: tr('다시 시도'), id: 'retry', desc: error }, { text: tr('뒤로'), id: 'back' }], {
        onSelect: (_i, item) => item.id === 'retry' ? showSlots() : back(), onCancel: back,
      });
      return;
    }
    if (!current()) { complete(false); return; }
    const have = new Map(saves.map(s => [s.slot, s.meta]));
    const items = [];
    for (let n = 1; n <= slots; n++) {
      const meta = have.get(n);
      items.push(meta ? { text: `${tr('슬롯 {n}', { n })}  ${saveLocation(meta)}`, right: metaDate(meta), desc: slotDesc(meta), slot: n, used: true, map: saveLocation(meta) }
        : { text: `${tr('슬롯 {n}', { n })}  ${tr('(비어 있음)')}`, slot: n, used: false });
    }
    const save = async n => {
      rememberSlot(n);
      if (event) ui.list.close(); else ui.closeMenu();
      let ok;
      try { ok = await saveSlot(n, false, kind); }
      catch { ui.toast(tr('저장 실패')); ok = false; }
      if (!event) return;
      if (!current()) { complete(false); return; }
      if (ok) { ui.closeMenu(); complete(true); }
      else await showSlots();
    };
    ui.menuOpen = true;
    ui.list.open(title(), items, {
      onSelect: (_i, item) => {
        if (!item.used) return save(item.slot);
        ui.list.open(tr('슬롯 {n}에 덮어쓸까요?', { n: item.slot }), [
          { text: tr('덮어쓰기'), id: 'yes', desc: `${item.map}  ${item.right}` }, { text: tr('취소'), id: 'no' },
        ], {
          onSelect: (_j, choice) => choice.id === 'yes' ? save(item.slot) : showSlots(),
          onCancel: showSlots,
        });
      },
      onCancel: back, index: selectedSlot() - 1,
    });
  };
  const opened = showSlots();
  return event ? completion : opened;
}
