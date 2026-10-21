import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MoviePresentation } from '../src/ui/movie-presentation.js';
import { Input } from '../src/core/input.js';

test('movie hides PC and wrist HUD, equipped objects and hands without losing prior visibility', () => {
  const objects = Array.from({ length: 17 }, () => new THREE.Group());
  objects[4].visible = false;
  const [root, backdrop, hud, status, toast, rewards, mini, dungeon, pointer, combat, weapon, shield, held, ready, left, right] = objects;
  const presentation = new MoviePresentation(); let busy = true;
  const context = { movies: { busy: () => busy }, ui: { root, backdrop, hud: { mesh: hud }, statusPanel: { mesh: status },
    toastPanel: { mesh: toast }, rewards: { mesh: rewards }, navigation: { mini: { mesh: mini } }, dungeonStatus: { mesh: dungeon }, pointerLine: pointer },
  combat: { root: combat, weapon, shield, held: { fx: held }, ready: { fx: ready } }, hands: { roots: () => [left, right] } };
  presentation.apply(context);
  for (const object of objects.slice(0, 16)) assert.equal(object.visible, false);
  presentation.apply(context); presentation.restore();
  objects.slice(0, 16).forEach((object, i) => assert.equal(object.visible, i !== 4));
  busy = false; presentation.apply(context); assert.equal(root.visible, true);
  root.visible = false; presentation.restore(); assert.equal(root.visible, false, 'finished presentation cannot overwrite later UI changes');
});

test('movie transition retires real keyboard, mouse, controller and grab edges without dropping held controls', () => {
  const input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(['Enter']), keysPrev: new Set(), mouse: { buttons: 1, prevButtons: 0 }, mousePresses: 1,
    btn: { left: [], right: [true, false, false, false, true, true] }, btnPrev: { left: [], right: [] }, rFlick: 1,
    grabs: { left: { pending: true, pressed: true }, right: { pending: true, pressed: true } },
  });
  assert.equal(input.xrPressed('right', 5), true); input.consumeActionEdges();
  assert.equal(input.keyPressed('Enter'), false); assert.equal(input.mousePressed(0), false);
  assert.equal(input.xrPressed('right', 5), false); assert.equal(input.xrPressed('right', 0), false);
  assert.equal(input.xrHeld('right', 0), true); assert.equal(input.rFlick, 0);
  assert.equal(input.grabs.right.pending, false); assert.equal(input.grabs.left.pressed, false);
});
