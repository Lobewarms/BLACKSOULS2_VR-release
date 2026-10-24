import test from 'node:test';
import assert from 'node:assert/strict';
import { readScripts } from '../src/data/scriptdata.js';

const parse = (t, entries) => {
  t.mock.method(console, 'warn', () => {});
  return readScripts(entries);
};
const method = body => `class Window_Base
  def show_name_window(face_name, face_index, x, size = 96)
    return unless use_name_window?
    name = show_name(face_name, face_index)
    return if name == nil or name.empty?
${body}
    @name_windows[name].open
  end
end`;

test('speaker extraction retains the source face table and separately reads installed static display translations', t => {
  const out = parse(t, [['Name window', `NAME_LIST = { 'DeskFace_2' => '窓口の係', 'HeroFace' => 'Actor[3]' }
${method(`    if name == '窓口の係'
      name = 'Desk Attendant'
    elsif name == '旅人'
      name = 'Traveler'
    end`)}`]]);
  assert.deepEqual(out.names, { DeskFace_2: '窓口の係', HeroFace: 'Actor[3]' });
  assert.deepEqual(out.nameAliases, { 窓口の係: 'Desk Attendant', 旅人: 'Traveler' });
  assert.equal(out.nameAliases['Actor[3]'], undefined, 'actor lookup remains a distinct runtime operation');
});

test('commented translations are ignored without treating quoted hashes, braces or escaped quotes as comments', t => {
  const out = parse(t, [['ネームウィンドウ', String.raw`
# NAME_LIST = { 'Face' => 'Commented table' }
=begin
NAME_LIST = { 'Face' => 'Block comment' }
def show_name_window
  if name == 'Static'
    name = 'Commented alias'
  end
end
=end
NAME_LIST = {
  'Face' => 'Keeper #1 }', # old inline text: "Face" => "Wrong"
  'Quote' => 'Keeper\'s desk',
  "Double" => "The \"Desk\"",
  # 'CommentOnly' => 'Unused'
}
${method(String.raw`    if name == 'Keeper #1 }'
      name = 'Desk #1' # name = 'Unused'
    elsif name == 'Keeper\'s desk'
      name = "Keeper's Desk"
    end`)}`]]);
  assert.deepEqual(out.names, { Face: 'Keeper #1 }', Quote: "Keeper's desk", Double: 'The "Desk"' });
  assert.deepEqual(out.nameAliases, { 'Keeper #1 }': 'Desk #1', "Keeper's desk": "Keeper's Desk" });
});

test('all live name table assignments follow original script order, including renamed sections and indexed updates', t => {
  const out = parse(t, [
    ['ネームウィンドウ', `NAME_LIST = { 'Face' => 'Earlier', 'Removed' => 'Stale' }`],
    ['Translated speaker table', `NAME_LIST = { 'Face' => 'Later', 'Fresh' => 'Current' }
NAME_LIST['Face_1'] = 'Specific'
NAME_LIST["Face"] = "Newest" # final installed assignment`],
  ]);
  assert.deepEqual(out.names, { Face: 'Newest', Fresh: 'Current', Face_1: 'Specific' });
  assert.equal(out.names.Removed, undefined, 'Ruby replaces the earlier constant hash instead of merging stale entries');
});

test('only static name branches in the actual display method become aliases; unrelated or dynamic Ruby is not executed', t => {
  const out = parse(t, [['Speaker configuration', `
def unrelated
  if name == 'Outside'
    name = 'Not a speaker alias'
  end
end
${method(`    if name == 'First' || name == "Second" then
      name = 'Shared Display'
    elsif name == 'DynamicValue'
      name = translate(name)
    elsif name == 'Nested'
      if enabled?
        name = 'Conditional Display'
      end
    elsif name == 'Interpolated'
      name = "#{actor.name}"
    elsif name == 'Static'
      name = 'Known Display'
    end
    if player_ready?
      if name == 'Hidden'
        name = 'Not unconditional'
      end
    end`)}
if name == 'AfterMethod'
  name = 'Not a speaker alias'
end`]]);
  assert.deepEqual(out.nameAliases, { First: 'Shared Display', Second: 'Shared Display', Static: 'Known Display' });
});

test('the last installed display method overrides earlier aliases even when its script section is renamed', t => {
  const out = parse(t, [
    ['ネームウィンドウ', method(`    if name == 'Source'
      name = 'Earlier'
    elsif name == 'Removed'
      name = 'Stale'
    end`)],
    ['Translated display override', method(`    if name == 'Source'
      name = 'Current'
    end`)],
  ]);
  assert.deepEqual(out.nameAliases, { Source: 'Current' });
});

test('first matching branches are applied once, while separate static if chains run in order', t => {
  const out = parse(t, [['Speaker configuration', method(`    if name == 'A'
      name = 'B'
    elsif name == 'A' or name == 'B'
      name = 'C'
    end
    if name == 'B'
      name = 'Final'
    end`)]]);
  assert.deepEqual(out.nameAliases, { A: 'Final', B: 'C' });
});

test('dynamic conditions cannot supply later aliases whose reachability is unknown', t => {
  const out = parse(t, [['Speaker configuration', method(`    if name == 'Known'
      name = 'Known Display'
    elsif custom_condition(name)
      name = 'Dynamic'
    elsif name == 'UnknownReachability'
      name = 'Do not guess'
    end`)]]);
  assert.deepEqual(out.nameAliases, { Known: 'Known Display' });
});
