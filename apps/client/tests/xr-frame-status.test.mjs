import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWithXrStatus } from '../src/vr/frame-status.js';

function fixture() {
  const session = {}, reference = {}, scene = {}, camera = {}, calls = [];
  const renderer = { render(s, c) { assert.equal(s, scene); assert.equal(c, camera); calls.push('draw'); },
    xr: { isPresenting: true, getSession: () => session, getReferenceSpace: () => reference } };
  const frame = { session, getViewerPose(space) { assert.equal(space, reference); calls.push('pose'); return { views: [{ eye: 'left' }, { eye: 'right' }] }; } };
  return { session, reference, scene, camera, calls, renderer, frame,
    draw(value = frame) { renderWithXrStatus(renderer, scene, camera, value, current => { assert.equal(current, session); calls.push('ready'); }); } };
}

test('startup readiness follows a successful main draw and tracked frame from the owned XR session', () => {
  const e = fixture(); e.draw(); assert.deepEqual(e.calls, ['draw', 'pose', 'ready']);
});

test('completed startup stops polling tracking and a new native session must earn its own readiness', () => {
  const e = fixture(); e.draw(); e.draw();
  assert.deepEqual(e.calls, ['draw', 'pose', 'ready', 'draw']);
  const next = {}; e.renderer.xr.getSession = () => next;
  e.draw(); assert.equal(e.calls.at(-1), 'draw', 'the old frame cannot complete a new session');
  let ready;
  renderWithXrStatus(e.renderer, e.scene, e.camera, { ...e.frame, session: next }, session => { ready = session; });
  assert.equal(ready, next);
});

test('desktop frames and stale XR frames cannot declare the current headset ready', () => {
  const e = fixture(); e.draw(null);
  e.draw({ ...e.frame, session: {} });
  e.renderer.xr.isPresenting = false; e.draw();
  assert.deepEqual(e.calls, ['draw', 'draw', 'draw']);
});

test('a missing or empty pose keeps startup waiting, then a later tracked draw completes it', () => {
  const e = fixture();
  for (const pose of [null, { views: [] }]) e.draw({ ...e.frame, getViewerPose: () => pose });
  assert.deepEqual(e.calls, ['draw', 'draw']);
  e.draw(); assert.deepEqual(e.calls, ['draw', 'draw', 'draw', 'pose', 'ready']);
});

test('a failed main render cannot report ready even with a tracked pose', () => {
  const e = fixture(); e.renderer.render = () => { throw new Error('GPU draw failed'); };
  assert.throws(() => e.draw(), /GPU draw failed/); assert.deepEqual(e.calls, []);
});

test('expired frame access and absent reference space remain recoverable without disturbing the draw', () => {
  const e = fixture(); e.draw({ ...e.frame, getViewerPose: () => { throw new Error('frame is no longer active'); } });
  e.renderer.xr.getReferenceSpace = () => null; e.draw();
  assert.deepEqual(e.calls, ['draw', 'draw']);
});
