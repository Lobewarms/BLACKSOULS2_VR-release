// Held model adjustment (the menu's 손에 든 모델): the hold pose set by hand (grip adjust mode), size, mirror, reset.
import { $data } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { bonfirePickable, bonfireShown } from '../scriptdata.js';
import { BAG_MAX, itemData } from '../state.js';
import { stripEscapes } from '../uitext.js';
import { composeMats } from './common.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class HeldPart {
  // ---- held model adjustment: the hold pose is set by hand (grip adjust mode), size / mirror here ----
  showAdjust(index = 0) {
    const specs = G.combat?.heldSpecs?.() || {};
    const target = this.adjTarget === 'offhand' && specs.offhand ? 'offhand' : 'weapon';
    const spec = specs[target];
    const adj = spec ? G.weaponAdjust.get(spec.key, spec.kind, spec.wtype, spec.hand, spec.item.icon_index) : null;
    const handName = target === 'offhand' ? (spec?.gun ? tr('왼손 (총)') : tr('왼손 (방패)')) : tr('오른손 (무기)');
    const items = [
      { text: tr('손으로 위치 잡기 (VR)'), id: 'grab', enabled: G.vr && !!(specs.weapon || specs.offhand),
        desc: tr('그립을 눌렀다 떼면 그 자리에 놓이고, 다시 쥐면 그 자세로 고정됩니다') },
      { text: tr('대상: {hand}', { hand: handName }), id: 'target', icon: spec?.item.icon_index, right: spec ? spec.item.name.trim() : tr('(장비 없음)'), enabled: !!specs.offhand || target === 'offhand',
        desc: tr('아래 크기·반전·기본값이 적용될 손') },
      { text: tr('크기 −10%'), id: 'sc-', enabled: !!adj, right: adj ? `${Math.round(adj.scale * 100)}%` : '' },
      { text: tr('크기 +10%'), id: 'sc+', enabled: !!adj },
      { text: tr('좌우 반전'), id: 'flip', enabled: !!adj, right: adj ? (adj.flip ? tr('켬') : tr('끔')) : '' },
      { text: tr('기본값으로 (잡은 자세도 초기화)'), id: 'reset', enabled: !!adj },
    ];
    this.list.open(tr('무기·방패 모양 조정'), items, {
      index,
      footer: tr('손에 든 모습은 아이템마다 따로 저장됩니다'),
      onSelect: (i, it) => {
        if (it.id === 'grab') { this.closeMenu(); G.combat.startGripAdjust(); return; }
        if (it.id === 'target') { this.adjTarget = target === 'offhand' ? 'weapon' : 'offhand'; this.showAdjust(1); return; }
        if (!adj) return;
        if (it.id === 'sc-') adj.scale = Math.max(0.3, +(adj.scale - 0.1).toFixed(2));
        if (it.id === 'sc+') adj.scale = Math.min(3, +(adj.scale + 0.1).toFixed(2));
        if (it.id === 'flip') { adj.flip = !adj.flip; delete adj.grip; }
        if (it.id === 'reset') G.weaponAdjust.reset(spec.key);
        else G.weaponAdjust.set(spec.key, adj);
        G.combat.equipKey = null;
        this.showAdjust(i);
      },
      onCancel: () => this.reopenMain('adjust'),
    });
  }
  showStatus() {
    const a = G.state.party.leader();
    const P = $data.system.terms.params;
    const items = [
      { text: `${a.name || '???'}  Lv ${a.level}`, right: $data.classes[a.classId]?.name || '' },
      { text: `HP ${a.hp}/${a.mhp}`, right: `MP ${a.mp}/${a.mmp}` },
      ...[2, 3, 4, 5, 6, 7].map(i => ({ text: P[i], right: String(a.param(i)) })),
      ...a.equips.map(e => { const d = itemData(e.kind, e.id); return { text: d ? d.name : '—', icon: d?.icon_index, enabled: !!d }; }),
      ...a.partners.map(sid => { const it = this.oathInfo(sid); return { text: it.name, right: it.lv, desc: it.effect }; }),
    ];
    this.list.open(tr('상태'), items, { onSelect: () => {}, onCancel: () => this.reopenMain('status') });
  }
  returnToTitle() { G.returnToTitle?.(); }

  // scenes requested by script calls
  openScene(name) {
    if (name === 'Scene_ShortMove') { this.openBonfireWarp(); return; }
    if (name === 'Scene_ItemSynthesis') { this.openSynthesis(); return; }
    if (name === 'Scene_Keep' || name === 'Scene_Item_Keep') { this.openKeep(); return; }
    const label = { Scene_ItemSynthesis: tr('무기 합성'), Scene_Keep: tr('아이템 보관') }[name] || name;
    this.toast(tr('{label}: VR판에서는 아직 지원하지 않습니다', { label }));
  }
  openBonfireWarp() {
    // (shown and picked as the original's window has it - scriptdata.js bonfireShown / bonfirePickable)
    const sw = id => G.state.sw(id);
    const list = (G.scripts.bonfires || []).filter(b => bonfireShown(b, sw));
    if (!list.length) {
      console.warn('[bonfire] none to travel to:', (G.scripts.bonfires || []).length, 'in the game\'s list');
      this.toast(tr('이동할 수 있는 화톳불이 없습니다'));
      return;
    }
    this.sceneOpen = 'bonfire';
    this.placeRoot(true);
    this.list.open(tr('화톳불 전송'), list.map(b => ({ text: b.name, desc: b.desc[0], enabled: bonfirePickable(b, sw) })), {
      onSelect: i => {
        const b = list[i];
        this.list.close(); this.sceneOpen = null;
        G.map.reserveTransfer(b.mapId, b.x, b.y, b.dir, 0);
        if (!G.coop?.phantom) for (const ce of b.commons) G.map.reserveCommonEvent(ce);      // (a co-op guest's: the host's world's to run)
      },
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  // Select Key Item (104): which key item; the variable gets its id (0: cancelled)
  openKeyItemChoice(varId) {
    const P = G.state.party;
    const items = $data.items.filter(d => d && d.name && d.itype_id === 2 && P.itemCount('item', d.id) > 0);
    this.sceneOpen = 'keyitem';
    this.placeRoot(true);
    const done = id => { G.state.setV(varId, id); this.list.close(); this.sceneOpen = null; };
    this.list.open(tr('중요한 아이템'), items.map(d => ({ text: d.name, icon: d.icon_index, right: String(P.itemCount('item', d.id)), desc: d.description })), {
      onSelect: i => done(items[i].id),
      onCancel: () => done(0),
    });
  }

  // 무기 강화 - the original's synthesis scene (Scene_ItemSynthesis): what the recipes switched on can make (the
  // bear's common event 7 switches on the next step of every weapon the player has, worn ones too), each greyed
  // until its materials are there; the footer shows what it takes and what is in the bag, as the original's
  // material window. A weapon worn is not in the bag (as in the original): take it off first. Picking one makes
  // it - how many, when more than one can be made - and the materials (and the cost) go
  openSynthesis(index = 0) {
    const syn = G.scripts?.synthesis;
    if (!syn?.recipes?.length) { this.toast(tr('{label}: VR판에서는 아직 지원하지 않습니다', { label: tr('무기 강화') })); return; }
    this.sceneOpen = 'synthesis';
    this.placeRoot(true);
    const P = G.state.party, sys = G.state.system;
    const on = r => !!sys.recipesAll || (r.kind === 'weapon' && (sys.recipes || []).includes(r.id));
    const list = syn.recipes.filter(r => (syn.categories.length ? syn.categories.includes(r.kind) : true) && on(r) && itemData(r.kind, r.id));
    const rows = list.map(r => {
      const d = itemData(r.kind, r.id);
      return { text: d.name, icon: d.icon_index, right: `[${P.itemCount(r.kind, r.id)}]`, enabled: this.synthMax(r) > 0, desc: this.synthNeeds(r, 1) };
    });
    this.list.open(tr('무기 강화'), rows, {
      index: Math.min(index, Math.max(0, rows.length - 1)),
      onSelect: i => {
        const r = list[i], max = this.synthMax(r);
        if (max <= 0) { G.audio?.playSystemSe(3); return; }
        const back = () => this.openSynthesis(i);
        if (max === 1) { this.synthMake(r, 1); back(); } else this.showSynthQuantity(r, back);
      },
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  // what a recipe takes, and how many of each the bag holds (a weapon worn says so: it does not count)
  // (as the original's material window: a material there is not enough of is greyed - one plain line hid why a +2 could
  // not be made: three 강화석 조각 needed, one held)
  synthNeeds(r, n) {
    const P = G.state.party, label = G.scripts?.synthesis?.materialLabel || tr('필요 소재');
    const OK = 'rgba(230,220,200,0.85)', SHORT = 'rgba(255,255,255,0.35)';
    const out = [[`${label}: `, OK]];
    r.mats.forEach((m, k) => {
      const d = itemData(m.kind, m.id), have = P.itemCount(m.kind, m.id);
      const worn = m.kind !== 'item' && !have && P.members().some(a => a.isEquipped(m.kind, m.id));
      out.push([`${k ? ', ' : ''}${stripEscapes(d?.name || '?')} ${m.n * n}/${have}${worn ? tr('(장착 중)') : ''}`, have < Math.max(1, m.n * n) ? SHORT : OK]);
    });
    if (r.cost > 0) out.push([`, ${(r.cost * n).toLocaleString()} ${$data.system.currency_unit}`, P.gold < r.cost * n ? SHORT : OK]);
    return out;
  }
  // how many can be made at once: what the materials (and money) cover, up to 99 at a time and the bag's limit
  synthMax(r) {
    const P = G.state.party;
    let max = Math.min(99, BAG_MAX - P.itemCount(r.kind, r.id));
    for (const m of r.mats) max = Math.min(max, m.n > 0 ? Math.floor(P.itemCount(m.kind, m.id) / m.n) : (P.itemCount(m.kind, m.id) > 0 ? 999 : 0));
    if (r.cost > 0) max = Math.min(max, Math.floor(P.gold / r.cost));
    return Math.max(0, max);
  }
  synthMake(r, n) {
    const P = G.state.party;
    P.gainGold(-r.cost * n);
    P.gainItem(r.kind, r.id, n);
    for (const m of r.mats) P.gainItem(m.kind, m.id, -m.n * n);
    G.audio?.playSystemSe(21);
  }
  // how many to make: stick left / right (PC ←→), or the rows; the first row makes them
  showSynthQuantity(r, back, n = 1, index = 0) {
    const max = this.synthMax(r);
    n = Math.max(1, Math.min(max, n));
    const d = itemData(r.kind, r.id);
    const items = [
      { text: tr('◀  {n}개  ▶  만들기', { n }), step: 0, desc: this.synthNeeds(r, n) },
      { text: '+1', step: 1, desc: this.synthNeeds(r, n) }, { text: '+10', step: 10, desc: this.synthNeeds(r, n) },
      { text: '−1', step: -1, desc: this.synthNeeds(r, n) }, { text: '−10', step: -10, desc: this.synthNeeds(r, n) },
      { text: tr('최대 ({n}개)', { n: max }), step: 'max', desc: this.synthNeeds(r, max) },
    ];
    this.list.open(stripEscapes(d.name), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n <= this.synthMax(r)) this.synthMake(r, n); back(); return; }
        this.showSynthQuantity(r, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showSynthQuantity(r, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }
  // 창고 - the original's storage scene (Scene_Item_Keep, script アイテム預かり所): a kind (as the item menu's), then
  // every thing of it in the bag or in the storage with how many are where; picking one opens how many to move -
  // into the storage or back out, 1 / 10 / 100 at a time or all that can go - done with the first row (B: nothing
  // moves). Things that may not be kept (<保存禁止>) are greyed. A weapon worn is not in the bag, as in the original
  keepTabs() {
    return [
      { label: tr('아이템'), kind: 'item', test: d => d.itype_id !== 2 },
      { label: tr('무기'), kind: 'weapon', test: () => true },
      { label: tr('방어구'), kind: 'armor', test: () => true },
      { label: tr('중요한 아이템'), kind: 'item', test: d => d.itype_id === 2 },
    ];
  }
  keepThings(t) {
    const P = G.state.party, K = G.scripts?.keep;
    const src = t.kind === 'weapon' ? $data.weapons : t.kind === 'armor' ? $data.armors : $data.items;
    return src.filter(d => d && d.name && t.test(d) && (P.itemCount(t.kind, d.id) > 0 || P.keptCount(t.kind, d.id) > 0) &&
      !(K?.hideSealed && P.keepSealed(t.kind, d.id)));
  }
  openKeep(tab = 0) {
    this.sceneOpen = 'keep';
    this.placeRoot(true);
    const tabs = this.keepTabs(), P = G.state.party;
    this.list.open(tr('창고'), tabs.map(t => {
      const things = this.keepThings(t);
      return { text: t.label, right: `${G.scripts?.keep?.keepLabel || tr('창고')} ${things.filter(d => P.keptCount(t.kind, d.id) > 0).length} / ${things.length}` };
    }), {
      index: tab,
      onSelect: i => this.showKeepList(i, 0),
      onCancel: () => { this.list.close(); this.sceneOpen = null; },
    });
  }
  showKeepList(tab, index) {
    const t = this.keepTabs()[tab], P = G.state.party, K = G.scripts?.keep;
    const things = this.keepThings(t);
    const bagL = K?.bagLabel || tr('소지'), keepL = K?.keepLabel || tr('창고');
    this.list.open(`${tr('창고')} · ${t.label}`, things.map(d => ({
      text: d.name, icon: d.icon_index, right: `${bagL} ${P.itemCount(t.kind, d.id)}   ${keepL} ${P.keptCount(t.kind, d.id)}`,
      enabled: !P.keepSealed(t.kind, d.id), desc: d.description,
    })), {
      index: Math.min(index, Math.max(0, things.length - 1)),
      onSelect: i => this.showKeepQuantity(tab, things[i], i),
      onCancel: () => this.openKeep(tab),
    });
  }
  // how many to move (+: into the storage, -: back out): stick right / left (PC →/←) one at a time, or the rows;
  // as the original, no more in than the bag has and the storage takes, no more out than it holds and the bag takes
  showKeepQuantity(tab, d, at, n = 0, index = 0) {
    const t = this.keepTabs()[tab], P = G.state.party, K = G.scripts?.keep, kind = t.kind;
    const bag = P.itemCount(kind, d.id), kept = P.keptCount(kind, d.id), limit = P.keepLimit(kind, d.id);
    const most = Math.max(0, Math.min(bag, limit - kept)), least = -Math.max(0, Math.min(kept, BAG_MAX - bag));
    n = Math.max(least, Math.min(most, n));
    const bagL = K?.bagLabel || tr('소지'), keepL = K?.keepLabel || tr('창고');
    const go = k => this.showKeepQuantity(tab, d, at, k, this.list.index);
    const items = [
      { text: `${bagL} ${bag - n}/${BAG_MAX}   ⇄   ${keepL} ${kept + n}/${limit}`, step: 0,
        right: n > 0 ? tr('{n}개 맡기기', { n }) : n < 0 ? tr('{n}개 꺼내기', { n: -n }) : '',
        desc: tr('스틱 →/←: 1개씩 · 이 줄 A/트리거: 확정 · B: 취소') },
      { text: tr('맡기기 +1'), step: 1 }, { text: tr('맡기기 +10'), step: 10 }, { text: tr('맡기기 +100'), step: 100 }, { text: tr('전부 맡기기'), step: 'in' },
      { text: tr('꺼내기 −1'), step: -1 }, { text: tr('꺼내기 −10'), step: -10 }, { text: tr('꺼내기 −100'), step: -100 }, { text: tr('전부 꺼내기'), step: 'out' },
    ];
    this.list.open(stripEscapes(d.name), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n) P.keep(kind, d.id, n); this.showKeepList(tab, at); return; }
        go(it.step === 'in' ? most : it.step === 'out' ? least : n + it.step);
      },
      onAdjust: dx => { go(n + dx); return true; },
      onCancel: () => this.showKeepList(tab, at),
    });
  }
  // as the original's shop (Scene_Shop): buy, sell - unless the event made it a shop to buy from only - or leave. With the
  // compose shop's switch on (지하감옥's candy merchant - scriptdata.js composeShop) each good also takes the things its note
  // names (candies): none bought without them, and they go with what is bought
  openShop(goods, purchaseOnly) {
    this.sceneOpen = 'shop';
    this.placeRoot(true);
    const C = G.scripts?.compose;
    this.compose = C?.switchId && G.state.sw(C.switchId) ? C : null;
    const entries = goods.map(g => {
      const kind = ['item', 'weapon', 'armor'][g[0]];
      const d = itemData(kind, g[1]);
      if (!d) return null;
      const price = g[2] === 0 ? d.price : g[3];
      return { kind, d, price, mats: this.compose ? composeMats(d, this.compose.word) : [] };
    }).filter(Boolean);
    this.shopKeep = false;
    if (purchaseOnly) this.showShopBuy(entries, null);
    else this.showShopCommand(entries);
  }
  closeShop() { this.list.close(); this.sceneOpen = null; this.shopKeep = false; this.compose = null; }
  // (the compose shop) what n of a good take, and how many of each there are: '캔디 소지 수량: 캔디 5/12'
  composeLine(e, n = 1) {
    const P = G.state.party;
    return `${this.compose.title || ''}${this.compose.title ? ': ' : ''}${e.mats.map(m => `${stripEscapes(itemData(m.kind, m.id).name)} ${m.n * n}/${P.itemCount(m.kind, m.id)}`).join(', ')}`;
  }
  // the price column: as the original's, a price of 0 left out in the compose shop (NoDraw); the list's written as the
  // original writes it (1000), the quantity window's grouped (1,000)
  shopPrice(e, n = 1, group = true) {
    return this.compose?.noDraw && e.price <= 0 ? '' : `${group ? (e.price * n).toLocaleString() : e.price * n} ${$data.system.currency_unit}`;
  }
  showShopCommand(entries, index = 0) {
    const P = G.state.party;
    this.list.open(tr('상점  (소지: {gold} {unit})', { gold: P.gold, unit: $data.system.currency_unit }), [
      { text: this.compose?.name || tr('구입한다'), id: 'buy' }, { text: tr('판다'), id: 'sell' }, { text: tr('그만둔다'), id: 'leave' },
    ], {
      index,
      onSelect: (i, it) => {
        if (it.id === 'buy') this.showShopBuy(entries, () => this.showShopCommand(entries, 0));
        else if (it.id === 'sell') this.showShopSell(() => this.showShopCommand(entries, 1));
        else this.closeShop();
      },
      onCancel: () => this.closeShop(),
    });
  }
  // (the storage script gives every shop a storage mode: what is bought goes into the storage, what is sold comes out
  // of it - its first row switches it, unless the script's switch holds that back; as the original it is off each time a
  // shop opens)
  shopCanKeep() { const K = G.scripts?.keep; return !!K?.shop && !(K.shopSwitch > 0 && G.state.sw(K.shopSwitch)); }
  shopToggleKeep() {
    const K = G.scripts?.keep;
    this.shopKeep = !this.shopKeep;
    if (K.se) G.audio?.playSe(K.se);
    const msg = this.shopKeep ? K.toKeep : K.toBag;
    if (msg) this.toast(msg);
  }
  showShopBuy(entries, back) {
    let at = 0;
    const K = G.scripts?.keep, P = G.state.party;
    const canKeep = this.shopCanKeep();
    const draw = () => {
      const rows = entries.map(e => ({
        text: e.d.name, icon: e.d.icon_index, enabled: this.shopMaxBuy(e) > 0,
        desc: e.mats?.length ? `${this.composeLine(e)}\n${e.d.description}` : e.d.description,
        right: `${this.shopPrice(e, 1, false)}${this.shopPrice(e) ? '  ' : ''}[${this.shopKeep ? `${K.keepLabel || tr('창고')} ${P.keptCount(e.kind, e.d.id)}` : P.itemCount(e.kind, e.d.id)}]`,
      }));
      if (canKeep) rows.unshift({ text: this.shopKeep ? tr('산 물건 → 창고') : tr('산 물건 → 소지품'), toggle: true, desc: tr('A/트리거: 산 물건을 넣을 곳 바꾸기') });
      this.list.open(tr('상점  (소지: {gold} {unit})', { gold: P.gold, unit: $data.system.currency_unit }), rows, {
      index: at,
      onSelect: (i, it) => {
        at = i;
        if (it.toggle) { this.shopToggleKeep(); draw(); return; }
        const e = entries[canKeep ? i - 1 : i];
        // none can be had (money, a full bag): no; only one: bought at once; more: how many (as the original's
        // number window)
        const max = this.shopMaxBuy(e);
        if (max <= 0) { G.audio?.playSystemSe(3); return; }
        if (max === 1) { this.shopBuy(e, 1); draw(); }
        else this.showShopQuantity(e, draw);
      },
      onCancel: () => (back ? back() : this.closeShop()),
      });
    };
    draw();
  }
  // selling (the original's Window_ShopSell): what the bag holds - the storage's, in its mode - each for half its price
  // (selling_price); one with no price is not taken; a key item, never. How many: as buying asks
  showShopSell(back, at = 0) {
    const P = G.state.party, unit = $data.system.currency_unit, canKeep = this.shopCanKeep();
    const rows = [];
    if (canKeep) rows.push({ text: this.shopKeep ? tr('창고에서 판다') : tr('소지품에서 판다'), toggle: true, desc: tr('A/트리거: 팔 물건을 꺼낼 곳 바꾸기') });
    for (const kind of ['item', 'weapon', 'armor']) {
      const from = this.shopKeep ? P.kept[kind] : P.container(kind);
      for (const [id, n] of [...(from || [])].sort((a, b) => a[0] - b[0])) {
        const d = itemData(kind, id);
        if (!d || n <= 0 || (kind === 'item' && d.itype_id === 2)) continue;
        const price = Math.floor((d.price || 0) / 2);
        rows.push({ text: d.name, icon: d.icon_index, desc: d.description, enabled: price > 0, right: `${price} ${unit}  [${n}]`, kind, d, price });
      }
    }
    if (!rows.length) { this.toast(tr('팔 수 있는 것이 없습니다')); back(); return; }
    this.list.open(tr('판다  (소지: {gold} {unit})', { gold: P.gold, unit }), rows, {
      index: Math.min(at, rows.length - 1),
      onSelect: (i, it) => {
        if (it.toggle) { this.shopToggleKeep(); this.showShopSell(back, i); return; }
        const max = this.shopSellMax(it);
        if (it.price <= 0 || max <= 0) { G.audio?.playSystemSe(3); return; }
        if (max === 1) { this.shopSell(it, 1); this.showShopSell(back, i); }
        else this.showShopSellQuantity(it, () => this.showShopSell(back, i));
      },
      onCancel: back,
    });
  }
  shopSellMax(e) { const P = G.state.party; return this.shopKeep ? P.keptCount(e.kind, e.d.id) : P.itemCount(e.kind, e.d.id); }
  shopSell(e, n) {
    const P = G.state.party;
    n = Math.min(n, this.shopSellMax(e));
    if (n <= 0) return;
    P.gainGold(e.price * n);
    if (this.shopKeep) { const left = P.keptCount(e.kind, e.d.id) - n; if (left > 0) P.kept[e.kind].set(e.d.id, left); else P.kept[e.kind].delete(e.d.id); }
    else P.gainItem(e.kind, e.d.id, -n);
    G.audio?.playSystemSe(21);
  }
  showShopSellQuantity(e, back, n = 1, index = 0) {
    const max = this.shopSellMax(e), unit = $data.system.currency_unit;
    n = Math.max(1, Math.min(max, n));
    const items = [
      { text: tr('◀  {n}개  ▶  판다', { n }), right: `${(e.price * n).toLocaleString()} ${unit}`, step: 0,
        desc: tr('스틱 좌우(PC ←→)로 1개씩 · A/트리거로 판매 · B 취소') },
      { text: '+1', step: 1 }, { text: '+10', step: 10 }, { text: '−1', step: -1 }, { text: '−10', step: -10 },
      { text: tr('전부 ({n}개)', { n: max }), right: `${(e.price * max).toLocaleString()} ${unit}`, step: 'max' },
    ];
    this.list.open(tr('{name} 판매', { name: stripEscapes(e.d.name) }), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { this.shopSell(e, n); back(); return; }
        this.showShopSellQuantity(e, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showShopSellQuantity(e, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }
  // how many of a shop's goods can be bought at once: what the money pays for, up to 99 at a time (the
  // original's number window) and the bag's limit
  shopMaxBuy(e) {
    const P = G.state.party;
    // (the storage mode: what the storage still takes; nothing it may not keep)
    const left = this.shopKeep ? (P.keepSealed(e.kind, e.d.id) ? 0 : P.keepLimit(e.kind, e.d.id) - P.keptCount(e.kind, e.d.id)) : BAG_MAX - P.itemCount(e.kind, e.d.id);
    let most = Math.min(99, left, e.price > 0 ? Math.floor(P.gold / e.price) : 99);
    // (the compose shop: as many as the things it takes are there for)
    for (const m of e.mats || []) if (m.n > 0) most = Math.min(most, Math.floor(P.itemCount(m.kind, m.id) / m.n));
    return Math.max(0, most);
  }
  shopBuy(e, n) {
    const P = G.state.party;
    for (const m of e.mats || []) if (m.n > 0) P.gainItem(m.kind, m.id, -m.n * n);
    P.gainGold(-e.price * n);
    if (this.shopKeep) P.kept[e.kind].set(e.d.id, P.keptCount(e.kind, e.d.id) + n);
    else P.gainItem(e.kind, e.d.id, n);
    G.audio?.playSystemSe(21);
  }
  // how many to buy: stick left / right (PC ←→) one at a time, or the rows (+1, +10, -1, -10, all); the first
  // row buys them
  showShopQuantity(e, back, n = 1, index = 0) {
    const max = this.shopMaxBuy(e);
    n = Math.max(1, Math.min(max, n));
    // (the compose shop: what n of it take, under the price)
    const cost = k => [this.shopPrice(e, k), e.mats?.length ? this.composeLine(e, k) : ''].filter(Boolean).join('  ');
    const verb = this.compose?.name;
    const items = [
      { text: verb ? tr('◀  {n}개  ▶  {verb}', { n, verb }) : tr('◀  {n}개  ▶  구입', { n }), right: cost(n), step: 0,
        desc: tr('스틱 좌우(PC ←→)로 1개씩 · A/트리거로 구입 · B 취소') },
      { text: '+1', step: 1 }, { text: '+10', step: 10 }, { text: '−1', step: -1 }, { text: '−10', step: -10 },
      { text: tr('최대 ({n}개)', { n: max }), right: cost(max), step: 'max' },
    ];
    this.list.open(verb ? `${stripEscapes(e.d.name)}  ${verb}` : tr('{name} 구입', { name: stripEscapes(e.d.name) }), items, {
      index,
      onSelect: (i, it) => {
        if (it.step === 0) { if (n <= this.shopMaxBuy(e)) this.shopBuy(e, n); back(); return; }
        this.showShopQuantity(e, back, it.step === 'max' ? max : n + it.step, i);
      },
      onAdjust: dx => { this.showShopQuantity(e, back, n + dx, this.list.index); return true; },
      onCancel: back,
    });
  }
}
