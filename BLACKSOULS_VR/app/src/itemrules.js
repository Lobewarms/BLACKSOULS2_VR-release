// The player's own rules for the game's weapons, armors and skills (the rule editor's 장비·스킬 tab - userrules.js weapons /
// armors / skills, saves/user_rules.json): what such a rule changes is put over the game's own data ($data) as the rules are
// read (main.js - as the game starts, on going into another map, and when the editor saves in this browser), the game's own
// put back first, so a rule taken out gives it back:
//   an equipment's features (특징 - 마법 반사율, 속성·상태 유효도, 공격 시 상태 ...), its parameters, its note (the scripts'
//   tags - <自動蘇生:500,42,80> ...) and its description;
//   a skill's effects (사용 효과), its damage (종류, 속성, 계산식, 분산도, 치명타), hit type, success rate, repeats, MP / TP
//   cost, note and description.
// What the game worked out from an item before (its tags read, its kind judged - kept on it as _autoRev, _hpCost ...) goes
// with it, to be worked out again from what it now says.
import { $data } from './data.js';

export const ITEM_KINDS = ['weapons', 'armors', 'skills'];
// what a rule may change, by kind
export const ITEM_FIELDS = {
  weapons: ['features', 'params', 'note', 'description'],
  armors: ['features', 'params', 'note', 'description'],
  skills: ['effects', 'damage', 'hit_type', 'success_rate', 'repeats', 'mp_cost', 'tp_cost', 'note', 'description'],
};
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const originals = Object.fromEntries(ITEM_KINDS.map(k => [k, new Map()]));    // id -> the game's own fields a rule changed

// what was worked out from it (single _ names: the tags read, the kind judged) - gone, to be worked out again
function dropWorkedOut(o) { for (const k of Object.keys(o)) if (/^_[^_]/.test(k)) delete o[k]; }

// the rules' items over the game's own (rules: as userrules.js cleanRules leaves them)
export function applyItemRules(rules) {
  for (const kind of ITEM_KINDS) {
    const list = $data[kind];
    if (!list) continue;
    for (const [id, own] of originals[kind]) {
      const o = list[id];
      if (!o) continue;
      for (const [f, v] of Object.entries(own)) o[f] = clone(v);
      dropWorkedOut(o);
    }
    originals[kind].clear();
    for (const [id, e] of Object.entries(rules?.[kind] || {})) {
      const o = list[+id];
      if (!o) continue;
      const own = {};
      for (const f of ITEM_FIELDS[kind]) {
        if (e[f] === undefined) continue;
        own[f] = clone(o[f]);
        o[f] = f === 'damage' ? { ...o.damage, ...clone(e.damage) } : clone(e[f]);
      }
      originals[kind].set(+id, own);
      dropWorkedOut(o);
    }
  }
}
// an item as the game's own data has it (whatever the rules put over it): its field f
export function ownField(kind, id, f) {
  const own = originals[kind]?.get(+id);
  return clone(own && f in own ? own[f] : $data[kind]?.[id]?.[f]);
}
