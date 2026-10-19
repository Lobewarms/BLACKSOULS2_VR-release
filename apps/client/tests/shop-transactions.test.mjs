import test from 'node:test';
import assert from 'node:assert/strict';
import { G } from '../src/core/globals.js';

globalThis.location = { search: '?lang=en' };
globalThis.addEventListener ||= () => {};
const { $data } = await import('../src/data/data.js');
const { GameState, BAG_MAX } = await import('../src/game/state.js');
const { Interpreter } = await import('../src/game/interpreter.js');
const { UI } = await import('../src/ui/ui.js');
const command = (code, parameters = []) => ({ code, indent: 0, parameters });

function environment(t) {
  const saved = { ...G }, before = { ...$data };
  t.after(() => { Object.assign(G, saved); Object.assign($data, before); });
  const material = { id: 7, name: 'Trade token', icon_index: 34, note: '', price: 0 };
  const product = { id: 19, name: 'Test key', icon_index: 22, note: '<Trade:0,7,5>', description: 'A synthetic key.', price: 100 };
  const weapon = { id: 8, name: 'Test blade', icon_index: 35, note: '', price: 40 };
  const armor = { id: 9, name: 'Test coat', icon_index: 36, note: '', price: 30 };
  $data.items = []; $data.items[7] = material; $data.items[19] = product;
  $data.weapons = []; $data.weapons[8] = weapon; $data.armors = []; $data.armors[9] = armor;
  $data.system = { currency_unit: 'Souls' };
  const sounds = [];
  Object.assign(G, { scripts: { exchangeShop: { switchId: 72, word: 'Trade', commandName: 'Trade', materialTitle: 'Tokens required:', hideZeroPrice: true } },
    map: { transferring: false, requestRefresh() {} }, audio: { playSystemSe: n => sounds.push(n) }, coop: null });
  G.state = new GameState(); G.state.setSw(72, true);
  const party = G.state.party; party.gold = 5000000;
  const ui = Object.assign(Object.create(UI.prototype), { sceneOpen: null, shopKeep: false, placeRoot() {}, toast() {},
    list: { open(title, items, options) { Object.assign(this, { title, items, ...options }); }, close() { this.items = []; } } });
  G.ui = ui;
  const entry = { kind: 'item', d: product, price: 0 };
  return { ui, party, product, material, entry, sounds };
}
const pick = (ui, i) => ui.list.onSelect(i, ui.list.items[i]);

test('the original event switch enables exchange costs, waits for the shop and resets on cancel', t => {
  const { ui, party } = environment(t); party.items.set(7, 12); G.state.setSw(72, false);
  const interpreter = new Interpreter();
  interpreter.setup([command(121, [72, 72, 0]), command(302, [0, 19, 1, 0, true]), command(121, [72, 72, 1]), command(0)]);
  interpreter.update();
  assert.equal(ui.sceneOpen, 'shop'); assert.equal(G.state.sw(72), true);
  assert.equal(ui.list.title, 'Trade  (you have: 12 Trade token)');
  assert.equal(ui.list.items[0].right, '5 Trade token  [0]');
  assert.equal(ui.list.items[0].rightIcon, 34, 'cost uses the installed material icon');
  assert.match(ui.list.items[0].desc, /Tokens required: 5\/12 Trade token/);
  interpreter.update(); assert.equal(G.state.sw(72), true, 'scene wait must retain the exchange rules');
  ui.list.onCancel(); interpreter.update();
  assert.equal(G.state.sw(72), false); assert.equal(interpreter.running(), false);
  assert.equal(party.itemCount('item', 7), 12); assert.equal(party.itemCount('item', 19), 0);
});

test('millions of Souls cannot pay for a material exchange without its required tokens', t => {
  const { ui, party, entry } = environment(t);
  ui.openShop([[0, 19, 1, 0, true]], true);
  assert.equal(ui.list.items[0].enabled, false); assert.equal(ui.shopMaxBuy(entry), 0);
  pick(ui, 0); assert.equal(ui.shopBuy(entry, 1), false);
  assert.equal(party.gold, 5000000); assert.equal(party.itemCount('item', 19), 0);
});

test('a one-unit exchange consumes tokens once and never charges Souls for a zero-money price', t => {
  const { ui, party, entry } = environment(t); party.items.set(7, 5);
  ui.openShop([[0, 19, 1, 0, true]], true); pick(ui, 0);
  assert.equal(party.itemCount('item', 7), 0); assert.equal(party.itemCount('item', 19), 1);
  assert.equal(party.gold, 5000000); assert.equal(ui.list.items[0].enabled, false);
  assert.equal(ui.shopBuy(entry, 1), false); assert.equal(party.itemCount('item', 19), 1);
});

test('quantity totals and maximum use materials, and a confirmed batch deducts the exact amount', t => {
  const { ui, party, entry } = environment(t); party.items.set(7, 17);
  ui.showShopBuy([entry], null); pick(ui, 0);
  assert.match(ui.list.items[5].text, /3/); assert.equal(ui.list.items[5].right, '15 Trade token');
  pick(ui, 5); assert.equal(ui.list.items[0].right, '15 Trade token');
  assert.match(ui.list.items[0].desc, /15\/17/); pick(ui, 0);
  assert.equal(party.itemCount('item', 19), 3); assert.equal(party.itemCount('item', 7), 2); assert.equal(party.gold, 5000000);
});

test('canceling quantity selection changes neither currency nor goods', t => {
  const { ui, party, entry } = environment(t); party.items.set(7, 20);
  ui.showShopBuy([entry], null); pick(ui, 0); ui.list.onCancel();
  assert.equal(party.itemCount('item', 7), 20); assert.equal(party.itemCount('item', 19), 0); assert.equal(party.gold, 5000000);
});

test('confirmation rechecks material and money balances after a quantity dialog opens', t => {
  const { ui, party, entry } = environment(t); entry.price = 10; party.items.set(7, 10);
  let returned = 0;
  ui.showShopQuantity(entry, () => returned++, 2); party.items.set(7, 5); pick(ui, 0);
  assert.equal(returned, 1); assert.equal(party.gold, 5000000); assert.equal(party.itemCount('item', 19), 0); assert.equal(party.itemCount('item', 7), 5);
  party.items.set(7, 10); ui.showShopQuantity(entry, () => returned++, 2); party.gold = 15; pick(ui, 0);
  assert.equal(party.gold, 15); assert.equal(party.itemCount('item', 7), 10); assert.equal(party.itemCount('item', 19), 0);
});

test('storage mode pays from storage and receives there without using tokens in the bag', t => {
  const { ui, party, entry } = environment(t);
  G.scripts.keep = { shop: true, shopSwitch: 201, limit: 999, keepLabel: 'Storage' };
  party.items.set(7, 11); party.kept.item.set(7, 7);
  ui.showShopBuy([entry], null); pick(ui, 0);
  assert.equal(ui.shopKeep, true); assert.match(ui.list.title, /7 Trade token/);
  pick(ui, 1);
  assert.equal(party.keptCount('item', 7), 2); assert.equal(party.keptCount('item', 19), 1);
  assert.equal(party.itemCount('item', 7), 11); assert.equal(party.itemCount('item', 19), 0);
  assert.equal(ui.shopMaxBuy(entry), 0, 'bag tokens cannot subsidize storage purchases');
  ui.closeShop(); ui.openShop([[0, 19, 1, 0, true]], true); assert.equal(ui.shopKeep, false);
  G.state.setSw(201, true); assert.equal(ui.shopCanKeep(), false);
});

test('multiple item, weapon and armor materials and a money cost are all charged together', t => {
  const { ui, party, entry, product } = environment(t);
  product.note = '<Trade:0,7,5>\n<Trade:1,8,2>\n<Trade:2,9,1>'; entry.price = 13;
  party.items.set(7, 20); party.weapons.set(8, 3); party.armors.set(9, 4); party.gold = 26;
  assert.equal(ui.shopMaxBuy(entry), 1); assert.match(ui.shopPrice(entry).right, /13 Souls/);
  assert.equal(ui.shopBuy(entry, 2), false); assert.equal(ui.shopBuy(entry, 1), true);
  assert.equal(party.itemCount('item', 7), 15); assert.equal(party.itemCount('weapon', 8), 1);
  assert.equal(party.itemCount('armor', 9), 3); assert.equal(party.gold, 13); assert.equal(party.itemCount('item', 19), 1);
});

test('stored purchases consume all material kinds from their matching stored containers', t => {
  const { ui, party, entry, product } = environment(t); ui.shopKeep = true;
  product.note = '<Trade:0,7,5>\n<Trade:1,8,2>\n<Trade:2,9>'; entry.price = 3;
  party.kept.item.set(7, 10); party.kept.weapon.set(8, 4); party.kept.armor.set(9, 2);
  assert.equal(ui.shopBuy(entry, 2), true);
  assert.equal(party.keptCount('item', 7), 0); assert.equal(party.keptCount('weapon', 8), 0); assert.equal(party.keptCount('armor', 9), 0);
  assert.equal(party.keptCount('item', 19), 2); assert.equal(party.gold, 4999994);
});

test('ordinary shops and disabled exchange switches retain their normal money and free-item behavior', t => {
  const { ui, party, entry } = environment(t); G.state.setSw(72, false); entry.price = 17;
  assert.equal(ui.shopMaxBuy(entry), 99); assert.equal(ui.shopBuy(entry, 2), true);
  assert.equal(party.gold, 4999966); assert.equal(party.itemCount('item', 7), 0); assert.equal(party.itemCount('item', 19), 2);
  entry.price = 0; assert.equal(ui.shopBuy(entry, 1), true); assert.equal(party.gold, 4999966);
  G.scripts.exchangeShop = null; assert.equal(ui.shopPrice(entry).right, '0 Souls');
});

test('the original NoDraw setting hides zero-money labels even on untagged free goods', t => {
  const { ui, entry, product } = environment(t); product.note = '';
  assert.equal(ui.shopPrice(entry).right, '');
  G.scripts.exchangeShop.hideZeroPrice = false; assert.equal(ui.shopPrice(entry).right, '0 Souls');
  product.note = '<Trade:0,7,5>'; assert.equal(ui.shopPrice(entry).right, '5 Trade token + 0 Souls');
});

test('bag and storage capacity, malformed costs and invalid quantities cannot consume currency or mint goods', t => {
  const { ui, party, entry, product } = environment(t); party.items.set(7, 100);
  party.items.set(19, BAG_MAX); assert.equal(ui.shopBuy(entry, 1), false);
  party.items.set(19, BAG_MAX - 1); assert.equal(ui.shopMaxBuy(entry), 1);
  for (const n of [0, -1, 1.5, NaN, Infinity, '1']) assert.equal(ui.shopBuy(entry, n), false);
  ui.shopKeep = true; party.kept.item.set(7, 100); party.kept.item.set(19, 999);
  assert.equal(ui.shopBuy(entry, 1), false); party.kept.item.delete(19);
  for (const price of [-1, NaN, Infinity, 0.5]) { entry.price = price; assert.equal(ui.shopBuy(entry, 1), false); }
  entry.price = 0; product.note = '<Trade:0,7,0>'; assert.equal(ui.shopBuy(entry, 1), false);
  assert.equal(party.gold, 5000000); assert.equal(party.keptCount('item', 7), 100); assert.equal(party.itemCount('item', 7), 100);
  product.note = '<Trade:0,7,5>\n<保存禁止>'; assert.equal(ui.shopMaxBuy(entry), 0, 'storage sealing still applies');
});

test('selling exchange-tagged goods keeps normal half-price Souls behavior and does not refund materials', t => {
  const { ui, party, product } = environment(t); party.items.set(19, 2);
  ui.showShopSell(() => {}); assert.equal(ui.list.items[0].right, '50 Souls  [2]');
  const sale = ui.list.items[0]; ui.shopSell(sale, 1);
  assert.equal(party.itemCount('item', 19), 1); assert.equal(party.itemCount('item', 7), 0); assert.equal(party.gold, 5000050);
  assert.equal(product.price, 100);
});
