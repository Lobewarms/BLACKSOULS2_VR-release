import test from 'node:test';
import assert from 'node:assert/strict';
import { readScripts } from '../src/data/scriptdata.js';

function parse(t, source, others = []) {
  t.mock.method(console, 'warn', () => {});
  return readScripts([['Translated shop configuration', source], ...others]).exchangeShop;
}

test('installed exchange switch, note keyword and labels are read from its actual module instead of guessed currency IDs', t => {
  const value = parse(t, `module EasyCompose
  SID = 72
  Word = 'TradeRequirements'
  Name = 'Trade'
  Title = "Tokens required:"
  NoDraw = true
  Key = :X
  FS1 = 16
end`);
  assert.deepEqual(value, { switchId: 72, word: 'TradeRequirements', commandName: 'Trade',
    materialTitle: 'Tokens required:', hideZeroPrice: true });
});

test('comments, unrelated modules and similarly named shop constants cannot enable an item exchange', t => {
  const value = parse(t, `# module EasyCompose
# SID = 99
# Word = 'Wrong'
# end
=begin
module EasyCompose
  SID = 88
  Word = 'Commented'
end
=end
module OtherShop
  SID = 33
  Word = 'Unrelated'
  Name = 'Wrong label'
end
module EasyComposeExtra
  SID = 44
  Word = 'Wrong module'
end`);
  assert.equal(value, null);
});

test('quoted hashes, escaped quotes and non-ASCII note keywords retain their exact installed values', t => {
  const value = parse(t, String.raw`module EasyCompose
  SID = 28 # SID = 99
  Word = '素材#要求'
  Name = 'Keeper\'s Trade'
  Title = "Required \"Tokens\" #1" # Title = "Old"
  NoDraw = false
end`);
  assert.deepEqual(value, { switchId: 28, word: '素材#要求', commandName: "Keeper's Trade",
    materialTitle: 'Required "Tokens" #1', hideZeroPrice: false });
});

for (const [description, settings] of [
  ['missing switch', `Word = 'Needs'`], ['missing note keyword', 'SID = 12'],
  ['zero switch', `SID = 0\nWord = 'Needs'`], ['dynamic switch', `SID = runtime_switch()\nWord = 'Needs'`],
  ['dynamic keyword', `SID = 12\nWord = keyword()`], ['interpolated keyword', `SID = 12\nWord = "#{runtime_word}"`],
  ['conditional settings', `if runtime_condition\nSID = 12\nWord = 'Needs'\nend`],
]) test(`${description} cannot fabricate a valid exchange configuration`, t => {
  assert.equal(parse(t, `module EasyCompose\n${settings}\nend`), null);
});

test('optional labels default safely, and the last complete installed configuration and constant assignment win', t => {
  const first = `module EasyCompose\nSID = 12\nWord = 'First'\nName = 'First label'\nend`;
  const minimal = `module EasyCompose\nSID = 20\nSID = 21\nWord = 'Current'\nend`;
  assert.deepEqual(parse(t, first, [['Later translated override', minimal]]), {
    switchId: 21, word: 'Current', commandName: '', materialTitle: '', hideZeroPrice: false,
  });
});

test('a later invalid exchange configuration cannot silently reuse a previously valid switch or keyword', t => {
  assert.equal(parse(t, `module EasyCompose\nSID = 12\nWord = 'Earlier'\nend`, [
    ['Later dynamic settings', `module EasyCompose\nSID = runtime_switch()\nWord = 'Current'\nend`],
  ]), null);
});
