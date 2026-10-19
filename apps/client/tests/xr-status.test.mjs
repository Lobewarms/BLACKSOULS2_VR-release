import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createXrStatus } from '../src/ui/xr-status.js';

const STAGES = ['checking', 'check-failed', 'permission', 'permission-slow', 'permission-stalled', 'graphics', 'reference-space', 'attaching', 'viewer-pose', 'viewer-pose-slow',
  'ending', 'ending-slow', 'recovering', 'recovery-stalled', 'failed', 'cancelled', 'cancelling', 'attachment-stalled'];
class Element extends EventTarget {
  constructor(ownerDocument, tagName) {
    super(); this.ownerDocument = ownerDocument; this.tagName = tagName; this.children = [];
    this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
function environment(onCancel, onRecover) {
  const document = { createElement: tagName => new Element(document, tagName) }, container = document.createElement('div');
  const presenter = createXrStatus(container, { onCancel, onRecover }), root = container.children[0];
  const [text, help, actions] = root.children, [cancel, recover] = actions.children;
  return { presenter, container, root, text, help, actions, cancel, recover };
}

test('startup transitions announce known copy and clear stale content after ready, idle or an unsupported stage', () => {
  const e = environment(() => {});
  assert.equal(e.root.hidden, true); assert.equal(e.container.children.length, 1);
  assert.deepEqual(e.root.attributes, { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const copies = new Set();
  for (const stage of STAGES) {
    e.presenter.update({ stage, canCancel: false });
    assert.equal(e.root.hidden, false, stage); assert.ok(e.text.textContent.length > 5, stage);
    copies.add(e.text.textContent); assert.equal(e.cancel.hidden, true); assert.equal(e.recover.hidden, true);
  }
  assert.equal(copies.size, STAGES.length, 'each lifecycle stage supplies useful distinct progress');
  for (const stage of ['ready', 'idle', 'runtime-error-not-a-stage', '__proto__']) {
    e.presenter.update({ stage, canCancel: true, canRecover: true });
    assert.equal(e.root.hidden, true, stage); assert.equal(e.text.textContent, '');
    assert.equal(e.help.textContent, ''); assert.equal(e.cancel.hidden, true); assert.equal(e.cancel.disabled, true);
    assert.equal(e.recover.hidden, true); assert.equal(e.recover.disabled, true); assert.equal(e.actions.hidden, true);
  }
  e.presenter.update(); assert.equal(e.root.hidden, true);
});

test('cancel is a real button, invokes only the current user action, and blocks immediate duplicate clicks', () => {
  let requests = 0;
  const e = environment(() => { requests++; });
  e.presenter.update({ stage: 'permission', canCancel: true });
  assert.equal(e.cancel.tagName, 'button'); assert.equal(e.cancel.type, 'button');
  assert.equal(e.cancel.hidden, false); assert.equal(e.cancel.disabled, false); assert.ok(e.cancel.textContent);
  assert.equal(requests, 0, 'showing status must not cancel or reset a session');
  e.cancel.click(); e.cancel.click();
  assert.equal(requests, 1); assert.equal(e.cancel.disabled, true);
  e.presenter.update({ stage: 'cancelling', canCancel: false });
  e.cancel.dispatchEvent(new Event('click')); assert.equal(requests, 1);
  e.presenter.update({ stage: 'idle', canCancel: true });
  e.cancel.dispatchEvent(new Event('click')); assert.equal(requests, 1);
  e.presenter.update({ stage: 'graphics', canCancel: true });
  e.cancel.click(); assert.equal(requests, 2, 'a later entry has its own cancel action');
  const noAction = environment();
  noAction.presenter.update({ stage: 'permission', canCancel: true });
  assert.equal(noAction.cancel.hidden, true, 'no dead-end cancel button without a callback');
});

test('headset detection can fail and recheck without losing later entry, cancellation or failure feedback', () => {
  let requests = 0;
  const e = environment(() => { requests++; });
  for (const previous of ['failed', 'cancelled']) {
    e.presenter.update({ stage: previous });
    const previousText = e.text.textContent;
    e.presenter.update({ stage: 'checking' });
    assert.equal(e.root.hidden, false); assert.equal(e.cancel.hidden, true);
    assert.notEqual(e.text.textContent, previousText);
    e.presenter.update({ stage: 'check-failed', message: 'raw platform error' });
    assert.match(e.text.textContent, /CHECK VR AGAIN/); assert.equal(e.help.hidden, true);
    assert.equal(e.cancel.hidden, true, 'detection retry belongs to the existing VR button');
    e.presenter.update({ stage: 'checking' });
    e.presenter.update({ stage: 'idle' }); assert.equal(e.root.hidden, true);
    e.presenter.update({ stage: 'permission', canCancel: true });
    assert.equal(e.root.hidden, false); assert.equal(e.cancel.hidden, false);
    e.cancel.click();
    e.presenter.update({ stage: previous });
    assert.equal(e.text.textContent, previousText); assert.equal(e.cancel.hidden, true);
  }
  assert.equal(requests, 2);
});

test('diagnostic strings never enter status, help, attributes or button copy', () => {
  const e = environment(() => {});
  const secret = '<img src=x onerror=attack()> DOMException: private/runtime/detail';
  for (const stage of [...STAGES, secret]) {
    e.presenter.update({ stage, message: secret, canCancel: true, canRecover: true, needsReload: true });
    assert.ok(!JSON.stringify([e.root.attributes, e.text.textContent, e.help.textContent, e.cancel.textContent, e.recover.textContent]).includes(secret));
    assert.equal(e.root.attributes.title, undefined);
  }
});

test('manual reset appears only with the lifecycle flag and never runs automatically or duplicates the same pending action', () => {
  let resets = 0, cancels = 0;
  const e = environment(() => { cancels++; }, () => { resets++; });
  e.presenter.update({ stage: 'permission-slow', canCancel: true });
  assert.equal(e.cancel.hidden, false); assert.equal(e.recover.hidden, true); assert.equal(resets, 0);
  e.presenter.update({ stage: 'permission-stalled', canRecover: 'true' });
  assert.equal(e.recover.hidden, true, 'an absent or malformed flag is not permission to recover');
  e.presenter.update({ stage: 'permission-stalled', canRecover: true });
  assert.equal(e.recover.hidden, false); assert.equal(e.recover.disabled, false);
  assert.equal(e.recover.type, 'button'); assert.equal(e.help.hidden, true, 'wait for explicit recovery failure before suggesting reopen');
  assert.equal(resets, 0, 'a 90-second stall is feedback, not an automatic reset');
  e.recover.click(); e.recover.click(); assert.equal(resets, 1);
  e.presenter.update({ stage: 'permission-stalled', canRecover: true });
  e.recover.click(); assert.equal(resets, 1, 'repeated identical status cannot re-enable an in-flight reset');
  e.presenter.update({ stage: 'recovering' });
  assert.equal(e.cancel.hidden, true); assert.equal(e.recover.hidden, true);
  e.presenter.update({ stage: 'idle' });
  e.presenter.update({ stage: 'ending-slow', canRecover: true });
  assert.equal(e.recover.hidden, false); e.recover.click(); assert.equal(resets, 2);
  e.presenter.update({ stage: 'permission', canCancel: true, canRecover: true });
  e.cancel.click(); e.recover.click(); assert.equal(cancels, 1); assert.equal(resets, 2, 'cancel and reset cannot race');
  e.presenter.update({ stage: 'cancelled' });
  e.presenter.update({ stage: 'permission-stalled', canRecover: true, canCancel: true });
  e.recover.click(); e.cancel.click(); assert.equal(resets, 3); assert.equal(cancels, 1);
  const noAction = environment();
  noAction.presenter.update({ stage: 'permission-stalled', canRecover: true }); assert.equal(noAction.recover.hidden, true);
});

test('unresolved attachment, unconfirmed recovery and reload-only states cannot offer or invoke reset', () => {
  let resets = 0;
  const e = environment(() => {}, () => { resets++; });
  for (const stage of ['attachment-stalled', 'recovery-stalled']) {
    e.presenter.update({ stage, canRecover: true, canCancel: true });
    assert.equal(e.help.hidden, false); assert.equal(e.recover.hidden, true); assert.equal(e.cancel.hidden, true);
    e.recover.dispatchEvent(new Event('click'));
  }
  e.presenter.update({ stage: 'ending-slow', canRecover: true, needsReload: true });
  assert.equal(e.recover.hidden, true); assert.equal(e.help.hidden, false);
  for (const stage of ['ready', 'idle', 'unrecognized', '__proto__']) {
    e.presenter.update({ stage, canRecover: true });
    assert.equal(e.root.hidden, true); assert.equal(e.recover.hidden, true); assert.equal(e.recover.disabled, true);
    e.recover.dispatchEvent(new Event('click'));
  }
  assert.equal(resets, 0);
});

test('stalled attachment gives manual save/reopen guidance without reload, reset or an unusable cancel action', () => {
  let requests = 0;
  const e = environment(() => { requests++; });
  e.presenter.update({ stage: 'attachment-stalled', message: 'technical timeout', canCancel: true });
  assert.equal(e.help.hidden, false); assert.ok(e.help.textContent); assert.equal(e.cancel.hidden, true);
  e.cancel.dispatchEvent(new Event('click')); assert.equal(requests, 0);
  e.presenter.update({ stage: 'failed', needsReload: true });
  assert.equal(e.help.hidden, false); assert.equal(e.cancel.hidden, true);
  e.presenter.update({ stage: 'permission', canCancel: true });
  assert.equal(e.help.hidden, true); assert.equal(e.help.textContent, ''); assert.equal(e.cancel.hidden, false);
});

test('all supported locales render every stage, cancel and save-before-reopen guidance through the actual presenter', () => {
  const localized = {};
  for (const language of ['ko', 'en', 'ja', 'zh']) {
    const code = `
      globalThis.location = { search: '?lang=${language}' };
      const { createXrStatus } = await import(${JSON.stringify(new URL('../src/ui/xr-status.js', import.meta.url).href)});
      ${Element.toString()}
      ${environment.toString()}
      const e = environment(() => {}, () => {}), stages = ${JSON.stringify(STAGES)}, messages = [];
      for (const stage of stages) {
        e.presenter.update({stage, canCancel:true, canRecover:true});
        messages.push(e.text.textContent);
      }
      process.stdout.write(JSON.stringify({messages, help:e.help.textContent, cancel:e.cancel.textContent, recover:e.recover.textContent}));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    localized[language] = JSON.parse(result.stdout);
    assert.equal(localized[language].messages.length, STAGES.length);
    assert.ok(localized[language].messages.every(message => message.length > 5));
  }
  for (const language of ['en', 'ja', 'zh']) {
    localized[language].messages.forEach((message, index) => assert.notEqual(message, localized.ko.messages[index], `${language}/${STAGES[index]} must be translated`));
    assert.notEqual(localized[language].help, localized.ko.help); assert.notEqual(localized[language].cancel, localized.ko.cancel);
    assert.notEqual(localized[language].recover, localized.ko.recover);
  }
  assert.equal(localized.en.cancel, 'Cancel VR entry');
  assert.equal(localized.en.recover, 'Reset VR connection');
  assert.match(localized.en.messages[0], /Checking for a VR headset/);
  for (const language of ['ko', 'en', 'ja', 'zh']) assert.match(localized[language].messages[1], /CHECK VR AGAIN/);
  assert.match(localized.en.help, /Save your progress.*close and reopen/);
  assert.match(localized.ja.help, /セーブ/); assert.match(localized.zh.help, /保存/); assert.match(localized.ko.help, /저장/);
});

test('footer styles isolate the original VR button opacity and preserve hidden/live/cancel affordances', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /#vrbtn\s+button\b/, 'a generic button rule would fade or shrink the cancel action');
  assert.match(html, /#vrbtn #VRButton\s*\{[^}]*opacity:\s*\.5/s);
  assert.match(html, /#vrbtn \.xr-status__cancel,\s*#vrbtn \.xr-status__recover\s*\{[^}]*opacity:\s*1/s);
  assert.match(html, /#vrbtn \.xr-status\[hidden\][^}]*display:\s*none/s);
  assert.match(html, /#vrbtn \.xr-status__cancel:focus-visible/);
  assert.match(html, /#vrbtn \.xr-status__recover:focus-visible/);
  assert.match(html, /#vrbtn \.xr-status__actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(html, /#vrbtn \.xr-status\s*\{[^}]*order:\s*-1/s,
    'progress is placed above the button so its existing bottom anchor stays stable');
});
