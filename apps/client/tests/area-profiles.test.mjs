import test from 'node:test';
import assert from 'node:assert/strict';
import { areaProfile } from '../src/world/area-profiles.js';

const map = (tileset_id, extra = {}) => ({ tileset_id, parallax_name: '', parallax_show: false, note: '', ...extra });
const profile = (id, tileset, extra = {}) => areaProfile(map(tileset, extra), { mapId: id });

test('verified town, forest and snow tilesets stay outdoor when the original has no sky picture', () => {
  for (const [id, tileset, kind] of [[5, 25, 'town'], [126, 66, 'fuming-forest'], [38, 38, 'spore-forest'], [331, 122, 'snow']]) {
    const p = profile(id, tileset);
    assert.equal(p.kind, kind); assert.equal(p.outdoor, true); assert.equal(p.openSky, false);
    assert.ok(p.fogFar >= 100); assert.ok(p.headlightIntensity < 1);
  }
});

test('hospitals, libraries and true dungeons have distinct readable lighting and reach', () => {
  const hospital = profile(12, 35), library = profile(154, 87), dungeon = profile(215, 5), dream = profile(101, 19);
  assert.equal(hospital.kind, 'hospital'); assert.equal(library.kind, 'library'); assert.equal(dungeon.kind, 'dungeon'); assert.equal(dream.kind, 'dream');
  for (const p of [hospital, library, dungeon, dream]) assert.equal(p.outdoor, false);
  assert.ok(hospital.ambient > dungeon.ambient); assert.ok(library.fogFar > dungeon.fogFar);
  assert.ok(dream.fogFar > library.fogFar); assert.ok(dungeon.headlightIntensity > hospital.headlightIntensity);
});

test('real interiors and cosmic locations using the generic field tileset retain their own area identity', () => {
  for (const [id, kind] of [[173, 'interior'], [174, 'interior'], [195, 'dream'], [274, 'theater'], [291, 'cosmic']]) {
    assert.equal(profile(id, 1).kind, kind);
    assert.equal(profile(id, 35).kind, 'hospital', 'a changed tileset supersedes a narrow map exception');
  }
});

test('shared exterior tilesets preserve verified storeroom and snow-house enclosure exceptions', () => {
  assert.equal(profile(25, 47).outdoor, true); assert.equal(profile(94, 47).outdoor, false);
  assert.equal(profile(353, 133).kind, 'snow'); assert.equal(profile(354, 133).kind, 'interior');
  assert.equal(profile(356, 133).outdoor, true); assert.equal(profile(377, 133).outdoor, false);
  assert.equal(profile(351, 124).outdoor, true); assert.equal(profile(345, 124).outdoor, false);
  assert.equal(profile(326, 123).outdoor, true); assert.equal(profile(312, 123).kind, 'hospital');
});

test('neither authored snow nor a cave, gears or floor background turns interiors into open skies', () => {
  for (const [id, tileset, parallax_name] of [[361, 97, ''], [362, 97, 'publicdomainq-0021126ule'], [125, 62, 'Cave3'], [101, 19, 'book02'], [341, 1, 'yukaかまくら内装土台'], [163, 92, 'StarlitSky']]) {
    const p = profile(id, tileset, { parallax_name, parallax_show: true, note: '<天候 snow,3>' });
    assert.equal(p.outdoor, false, String(id)); assert.equal(p.openSky, false, String(id));
  }
});

test('openSky requires an outdoor family, a shown parallax and an actual distant sky view', () => {
  assert.equal(profile(353, 133, { parallax_name: 'Ocean1', parallax_show: true }).openSky, true);
  assert.equal(profile(353, 133, { parallax_name: 'Ocean1', parallax_show: false }).openSky, false);
  assert.equal(profile(207, 1, { parallax_name: 'BlueSky', parallax_show: true }).openSky, true);
  assert.equal(profile(5, 25, { parallax_name: 'rad2', parallax_show: true }).openSky, false);
  assert.equal(profile(130, 25, { parallax_name: 'water3', parallax_show: true }).openSky, false);
  assert.equal(profile(397, 2, { parallax_name: 'Mountains4', parallax_show: true }).openSky, true);
  assert.equal(profile(171, 2, { parallax_name: '64380033_p2_master1200', parallax_show: true }).openSky, true);
});

test('a tileset change supersedes map exceptions and follows the actual active tileset', () => {
  assert.equal(areaProfile(map(133), { mapId: 354, tileset: { id: 25 } }).kind, 'town');
  assert.equal(profile(101, 35).kind, 'hospital');
  assert.equal(profile(17, 1).kind, 'cosmic'); assert.equal(profile(17, 87).kind, 'library');
});

test('localized or misleading names, weather and unknown backgrounds cannot change fallback enclosure', () => {
  const a = areaProfile(map(999, { display_name: 'Bright Snow Town', note: '<天候 snow,9>', parallax_name: 'BlueSky', parallax_show: true }));
  const b = areaProfile(map(999, { display_name: '暗い地下牢', note: '<色調 -255,-255,-255,0>' }));
  assert.deepEqual(a, b); assert.equal(a.kind, 'neutral'); assert.equal(a.outdoor, false); assert.equal(a.openSky, false);
  assert.ok(a.ambient >= 0.3); assert.ok(a.fogFar >= 60);
});

test('all families return bounded plain fields and no synthetic default vignette or source tone', () => {
  for (let tileset = 0; tileset <= 180; tileset++) {
    const p = areaProfile(map(tileset));
    assert.equal(typeof p.kind, 'string'); assert.equal(typeof p.outdoor, 'boolean');
    assert.ok(p.fogNear > 0 && p.fogFar > p.fogNear && p.fogFar < 250);
    for (const key of ['background', 'fogColor', 'groundColor']) assert.ok(Number.isInteger(p[key]) && p[key] >= 0 && p[key] <= 0xffffff, key);
    for (const key of ['ambient', 'hemi', 'headlightIntensity', 'headlightRange']) assert.ok(Number.isFinite(p[key]) && p[key] >= 0, key);
    assert.equal('vignette' in p, false); assert.equal('tone' in p, false);
  }
  assert.equal(areaProfile(null).kind, 'neutral');
});

test('returned profiles do not share mutable objects or depend on transfer order', () => {
  const first = profile(5, 25); first.fogFar = 1; first.outdoor = false;
  profile(125, 62); assert.equal(profile(5, 25).fogFar, 150); assert.equal(profile(5, 25).outdoor, true);
});
