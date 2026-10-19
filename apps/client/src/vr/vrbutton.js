// The ENTER VR button (in place of three.js's VRButton) and getting the page ready for the headset.
//
// Laptops with two GPUs (Intel + NVIDIA): the browser draws on the Intel GPU, the headset runtime needs the
// NVIDIA one. WebXR's makeXRCompatible() moves the browser's GPU work over, which LOSES the page's 3D context
// once (three.js restores it by itself). three.js asks for that only after the session has started, so the
// session died with the context: the first ENTER VR always failed, and three's VRButton could then stay on
// "EXIT VR" for a session that was gone (later clicks did nothing).
// Warm compatibility when the page loads (and when a headset appears). The click requests permission immediately;
// after its grant, graphics and tracking preparation finish before Three attaches. Failed starts close their grant.
// Every step is logged to the console as "[xr] ..." - what the headset shows cannot be seen from the PC.
//
// Leaving VR and coming back: Chrome on Windows starts only the first session after the browser started
// reliably on an OpenXR runtime (crbug.com/40859047: later ones end at once, flicker, or stop being shown -
// "hidden" for good). Chrome runs WebXR in a process of its own and starts a new one at once when it ends, so
// a failed granted start asks the local server (opts.resetXr) to end that process, then waits for the new
// process to find the headset. Healthy exits keep the runtime ready for immediate, user-clicked reentry;
// a brief session or hidden dashboard alone is not evidence of a broken runtime.
const SESSION_INIT = { optionalFeatures: ['local-floor', 'bounded-floor', 'layers', 'hand-tracking'] };

const log = (...a) => console.info('[xr]', ...a);
const warn = (...a) => console.warn('[xr]', ...a);
const errText = e => (e && (e.name || e.message) ? `${e.name || 'Error'}: ${e.message || ''}` : String(e));

function timeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} took over ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(t));
}

// Three r170 repeats these asynchronous native requests inside setSession.
// Serve the completed preparation while it attaches, then restore the exact
// original property. The real XRSession remains the native layer's argument.
function preparedMethod(target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => { if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key]; };
}

// the context events, for the log (a GPU switch shows up as lost + restored)
const watched = new WeakSet();
function watchContext(canvas) {
  if (watched.has(canvas)) return;
  watched.add(canvas);
  canvas.addEventListener('webglcontextlost', () => log('3D context lost'));
  canvas.addEventListener('webglcontextrestored', () => log('3D context restored'));
}

function whenRestored(canvas, gl, ms) {
  return new Promise((res, reject) => {
    if (!gl.isContextLost()) { res(); return; }
    let t = 0;
    const cleanup = () => { clearTimeout(t); canvas.removeEventListener('webglcontextrestored', done); };
    const finish = () => { if (gl.isContextLost()) reject(new Error('The VR graphics context did not recover')); else res(); };
    const done = () => { cleanup(); setTimeout(finish, 0); };
    t = setTimeout(() => { cleanup(); finish(); }, ms);
    canvas.addEventListener('webglcontextrestored', done);   // three.js's own handler (added first) restores its state
  });
}

let compatJob = null;
// make the renderer's context XR compatible (true when it is); callers share one pending request
function makeCompatible(renderer, why) {
  const gl = renderer.getContext?.();
  if (!gl || typeof gl.makeXRCompatible !== 'function') return Promise.resolve(false);
  if (gl.getContextAttributes?.()?.xrCompatible && !gl.isContextLost?.()) return Promise.resolve(true);
  if (compatJob) return compatJob;
  const canvas = renderer.domElement;
  watchContext(canvas);
  const t0 = performance.now();
  log(`making the 3D context XR compatible (${why})`);
  compatJob = (async () => {
    try {
      let failed = false;
      try { await gl.makeXRCompatible(); }
      catch (e) { failed = true; warn('makeXRCompatible failed:', errText(e)); }
      await whenRestored(canvas, gl, 10000);
      if (failed) return !!gl.getContextAttributes?.()?.xrCompatible;
      log(`XR compatible after ${Math.round(performance.now() - t0)} ms`);
      return true;
    } finally {
      compatJob = null;
    }
  })();
  return compatJob;
}

// At page load (and whenever a headset appears): get the GPU switch over with before the click. The boot waits
// for it at most maxWait - a runtime that is still starting up must not hold the game.
export async function prepareXR(renderer, maxWait = 6000) {
  if (!navigator.xr || !renderer.getContext?.()) return;
  const check = async why => {
    let ok = false;
    try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* blocked */ }
    if (ok) try { await makeCompatible(renderer, why); }
    catch (e) { warn('VR graphics preparation failed:', errText(e)); }
  };
  navigator.xr.addEventListener?.('devicechange', () => { log('VR device change'); check('headset connected'); });
  let t = 0;
  await Promise.race([check('page load'), new Promise(r => { t = setTimeout(r, maxWait); })]);
  clearTimeout(t);
}

// opts.restoreView(): restores a failed start after the session's end listeners
// finish. Normal exits restore the desktop in renderer.xr's sessionend listener.
export function createVRButton(renderer, opts = {}) {
  const sessionInit = opts.sessionInit || SESSION_INIT;
  const button = document.createElement('button');
  button.id = 'VRButton';
  button.type = 'button';
  const show = (text, clickable) => {
    button.textContent = text;
    button.disabled = !clickable;
    button.classList.toggle('wide', text.length > 9);
  };
  const status = (stage, message) => {
    button.title = message;
    opts.onStatus?.({ stage, message, canCancel: ['permission', 'graphics', 'reference-space', 'attaching', 'viewer-pose', 'viewer-pose-slow'].includes(stage),
      needsReload: stage === 'attachment-stalled' });
  };
  if (!('xr' in navigator)) {
    show(window.isSecureContext === false ? 'WEBXR NEEDS HTTPS' : 'WEBXR NOT AVAILABLE', false);
    return button;
  }
  let state = 'off';       // off (no headset) | idle | starting | running | ending | resetting
  let current = null;
  let refreshId = 0;

  async function refresh({ quiet = false } = {}) {
    if (state !== 'off' && state !== 'idle') return;
    const id = ++refreshId;
    let ok = false, err = null;
    if (!quiet) { show('CHECKING VR...', false); status('checking', 'Checking whether a VR headset is available.'); }
    try { ok = await timeout(navigator.xr.isSessionSupported('immersive-vr'), 8000, 'checking for a headset'); } catch (e) { err = e; }
    if (id !== refreshId || state !== 'off' && state !== 'idle') return;
    if (err) {
      state = 'off'; show('CHECK VR AGAIN', true);
      status('check-failed', 'The browser did not finish checking the headset. Check the VR connection, then click CHECK VR AGAIN.');
      warn('isSessionSupported failed:', errText(err));
    }
    else if (ok) { state = 'idle'; show('ENTER VR', true); if (!quiet) status('idle', 'VR headset available.'); }
    else { state = 'off'; show('VR NOT SUPPORTED', false); if (!quiet) status('idle', 'No VR headset is available.'); }
  }

  // Recover a failed granted start; a healthy session keeps its ready runtime.
  async function afterSession(attempt) {
    if (current !== attempt) return;
    state = 'resetting';
    show('VR ...', false);
    if (attempt.failed) status('recovering', 'Recovering the VR connection.');
    let done = false;
    if (attempt.failed && opts.resetXr) {
      try { done = !!(await timeout(Promise.resolve(opts.resetXr()), 10000, 'XR reset')); } catch (e) { warn('XR reset failed:', errText(e)); }
    }
    if (current !== attempt) return;
    if (done) {
      // the browser starts the new process at once; wait until it has found the headset (at most 15 s)
      const t0 = performance.now(), endAt = t0 + 15000;
      let ok = false, expired = false, deadlineTimer, pauseTimer, queryTimer;
      const deadline = new Promise(resolve => { deadlineTimer = setTimeout(() => { expired = true; resolve(false); }, 15000); });
      try {
        while (!ok && !expired) {
          await Promise.race([new Promise(r => { pauseTimer = setTimeout(r, 400); }), deadline]);
          clearTimeout(pauseTimer);
          if (current !== attempt) return;
          const remaining = endAt - performance.now();
          if (expired || remaining <= 0) break;
          try {
            ok = await Promise.race([navigator.xr.isSessionSupported('immersive-vr'), deadline,
              new Promise(resolve => { queryTimer = setTimeout(() => resolve(false), remaining); })]);
          } catch { /* a runtime still restarting may reject detection */ }
          finally { clearTimeout(queryTimer); }
        }
      } finally { clearTimeout(deadlineTimer); clearTimeout(pauseTimer); clearTimeout(queryTimer); }
      log(`fresh XR process ${ok ? 'ready' : 'has no headset yet'} after ${Math.round(performance.now() - t0)} ms`);
    } else if (attempt.failed) log('XR process not reset (the next session may not show)');
    if (current !== attempt) return;
    current = null;
    state = 'idle';
    show('ENTER VR', true);
    status(attempt.cancelled ? 'cancelled' : attempt.failed ? 'failed' : 'idle',
      attempt.cancelled ? 'VR startup cancelled.' : attempt.failed ? 'VR could not start. Check the headset connection, then try again.' : 'VR ended.');
    refresh({ quiet: true });
  }

  function finishEnded(attempt) {
    if (current !== attempt || !attempt.ended || !attempt.attachSettled || attempt.finished || renderer.xr.isPresenting) return;
    attempt.finished = true;
    clearTimeout(attempt.poseTimer);
    attempt.session.removeEventListener('end', attempt.onEnd);
    attempt.session.removeEventListener('visibilitychange', attempt.onVisibility);
    if (attempt.failed) opts.restoreView?.();
    void afterSession(attempt);
  }
  renderer.xr.addEventListener?.('sessionend', () => {
    // Raw XRSession.end runs our listener before Three's listener. A microtask
    // lets Three restore its saved renderer size before any failed-start fit.
    const attempt = current;
    if (attempt?.ended) queueMicrotask(() => finishEnded(attempt));
  });

  async function endAttempt(attempt) {
    if (current !== attempt || attempt.ended || attempt.endPending) return;
    attempt.exitRequested = true;
    clearTimeout(attempt.poseTimer);
    attempt.endPending = true;
    state = 'ending';
    show('EXITING...', false);
    status('ending', 'Ending the VR session.');
    try {
      await timeout(Promise.race([Promise.resolve(attempt.session.end()), attempt.endObserved]), 8000, 'ending the VR session');
      if (current === attempt && !attempt.ended) {
        state = 'running'; show('EXIT VR', true);
        status('ending-slow', 'The headset has not closed VR yet. Exit from the headset, or click EXIT VR to try again.');
      }
    }
    catch (e) {
      if (current !== attempt || attempt.ended) return;
      warn('could not end the session:', errText(e));
      // A rejected end does not mean the headset session ended. Retain it so
      // EXIT VR can retry instead of offering a competing requestSession.
      state = 'running';
      show('EXIT VR', true);
      status('ending-slow', 'VR is still open in the headset. Click EXIT VR to try again.');
    } finally { attempt.endPending = false; }
  }

  function endDetached(session) {
    // requestSession may resolve after its timeout. Never attach that session
    // or let its eventual events change the currently owned attempt.
    try { Promise.resolve(session.end()).catch(e => warn('could not end a late session:', errText(e))); }
    catch (e) { warn('could not end a late session:', errText(e)); }
  }

  async function start() {
    if (state !== 'idle' || renderer.xr.isPresenting) return;
    const attempt = { session: null, ended: false, failed: false, cancelled: false, attachSettled: true, finished: false, endPending: false };
    attempt.cancelledPromise = new Promise((_, reject) => { attempt.abortPreparation = () => reject(new Error('VR startup cancelled')); });
    attempt.endObserved = new Promise(resolve => { attempt.observeEnd = resolve; });
    const prepare = (promise, ms, label) => timeout(Promise.race([promise, attempt.cancelledPromise]), ms, label);
    current = attempt;
    state = 'starting';
    show('CANCEL VR START', true);
    status('permission', 'Waiting for the headset permission. Confirm VR in the headset, or cancel here.');
    log('ENTER VR');
    const t0 = performance.now();
    try {
      // Keep the native permission request in the actual click activation.
      // GPU switching may take seconds and must never precede this request.
      const request = Promise.resolve(navigator.xr.requestSession('immersive-vr', sessionInit));
      request.then(s => {
        attempt.granted = s;
        if (current !== attempt || attempt.failed) endDetached(s);
      }, () => {});
      const s = await prepare(request, 20000, 'headset permission');
      if (current !== attempt || attempt.failed) return;
      attempt.session = s;
      log(`session granted (${(s.enabledFeatures || []).join(', ') || 'no feature list'}), visibility ${s.visibilityState}`);
      attempt.onEnd = () => {
        if (current !== attempt || attempt.ended) return;
        attempt.ended = true;
        attempt.observeEnd();
        if (!attempt.ready && !attempt.cancelled) attempt.failed = true;
        state = 'ending';
        show('EXITING...', false);
        log(`session ended after ${((performance.now() - t0) / 1000).toFixed(1)} s, ${renderer.info?.render?.frame ?? '?'} frames drawn`);
        opts.onVisibility?.('ended');
        queueMicrotask(() => finishEnded(attempt));
      };
      attempt.onVisibility = () => {
        if (current !== attempt || attempt.ended) return;
        log(`visibility ${s.visibilityState} (${((performance.now() - t0) / 1000).toFixed(1)} s in, ${renderer.info?.render?.frame ?? '?'} frames drawn)`);
        opts.onVisibility?.(s.visibilityState);
      };
      s.addEventListener('end', attempt.onEnd);
      s.addEventListener('visibilitychange', attempt.onVisibility);
      status('graphics', 'Preparing graphics for the headset. You can cancel VR startup here.');
      const compatible = await prepare(makeCompatible(renderer, 'ENTER VR'), 20000, 'preparing VR graphics');
      if (current !== attempt || attempt.ended || attempt.cancelled) return;
      // A stalled reference-space request must be ended before Three installs
      // its manager. Its r170 cleanup assumes its animation context exists.
      const restores = [];
      attempt.restorePrepared = () => {
        for (const restore of restores.reverse()) restore();
        restores.length = 0;
      };
      if (typeof s.requestReferenceSpace === 'function') {
        status('reference-space', 'Waiting for headset tracking. Check the headset connection or cancel here.');
        const type = opts.referenceSpaceType || 'local-floor';
        const reference = await prepare(s.requestReferenceSpace(type), 12000, 'headset tracking');
        if (current !== attempt || attempt.ended || attempt.cancelled) return;
        const original = s.requestReferenceSpace.bind(s);
        restores.push(preparedMethod(s, 'requestReferenceSpace', requested => requested === type ? Promise.resolve(reference) : original(requested)));
      }
      const gl = renderer.getContext?.();
      if (compatible && typeof gl?.makeXRCompatible === 'function') {
        try { restores.push(preparedMethod(gl, 'makeXRCompatible', () => Promise.resolve())); }
        catch (error) { attempt.restorePrepared(); throw error; }
      }
      attempt.attachSettled = false;
      status('attaching', 'Opening the headset display. You can cancel VR startup here.');
      const attaching = Promise.resolve().then(() => renderer.xr.setSession(s));
      const settled = () => {
        attempt.restorePrepared();
        attempt.attachSettled = true;
        if (current !== attempt) return;
        if (attempt.ended) queueMicrotask(() => finishEnded(attempt));
        else if (attempt.endAfterAttach) { attempt.endAfterAttach = false; void endAttempt(attempt); }
      };
      attaching.then(settled, () => { attempt.failed = true; settled(); });
      await timeout(attaching, 20000, 'setSession');
      if (current !== attempt || attempt.ended || attempt.failed) return;
      if (attempt.cancelled) { void endAttempt(attempt); return; }
      attempt.ready = true;
      state = 'running';
      show('EXIT VR', true);
      if (opts.waitForPose && !attempt.firstPose) {
        status('viewer-pose', 'VR display connected. Waiting for headset position. Put on the headset and return to the game.');
        attempt.poseTimer = setTimeout(() => {
          if (current === attempt && !attempt.ended && !attempt.exitRequested && !attempt.firstPose) status('viewer-pose-slow',
            'The headset is not reporting its position yet. Return to the game in the headset, or use EXIT VR and reconnect.');
        }, 12000);
      } else status('ready', 'VR is ready.');
      const layer = renderer.xr.getBaseLayer?.();
      log(!layer ? 'in VR' : 'textureWidth' in layer ? `in VR, drawing into a projection layer ${layer.textureWidth}x${layer.textureHeight}`
        : `in VR, drawing into an XRWebGLLayer ${layer.framebufferWidth}x${layer.framebufferHeight}`);
    } catch (e) {
      if (current !== attempt || attempt.finished) return;
      if (attempt.attachSettled) attempt.restorePrepared?.();
      if (!attempt.cancelled) attempt.failed = true;
      if (!attempt.cancelled) warn('could not enter VR:', errText(e));
      if (attempt.session) {
        state = 'ending'; show('EXITING...', false);
        // Three's pending setSession cannot be cancelled. Wait for it to
        // settle before ending/resetting, so it cannot attach after cleanup.
        if (attempt.attachSettled) {
          if (attempt.ended) queueMicrotask(() => finishEnded(attempt));
          else void endAttempt(attempt);
        } else {
          attempt.endAfterAttach = true;
          status('attachment-stalled', 'The headset display did not finish opening. Waiting for safe cleanup; if it stays here, close this game tab and reopen it from the launcher.');
        }
        return;
      }
      if (attempt.granted) endDetached(attempt.granted);
      if (!renderer.xr.isPresenting) opts.restoreView?.();
      current = null;
      state = 'idle';
      show('ENTER VR', true);
      status('failed', 'VR could not start. Check the headset permission and connection, then try again.');
      refresh({ quiet: true });
    }
  }

  function stop() {
    if (current?.session) void endAttempt(current);
  }

  button.cancelStartup = () => {
    const attempt = current;
    if (!attempt || state !== 'starting' && !(state === 'running' && opts.waitForPose && !attempt.firstPose)) return;
    attempt.cancelled = true;
    attempt.abortPreparation();
    status('cancelling', 'Cancelling VR startup.');
    if (attempt.session) {
      if (attempt.attachSettled) void endAttempt(attempt);
      else { attempt.endAfterAttach = true; state = 'ending'; show('EXITING...', false); }
    } else {
      // The browser permission request itself cannot be aborted. Its late
      // grant handler closes it without ever attaching it to the renderer.
      current = null; state = 'idle'; show('ENTER VR', true);
      status('cancelled', 'VR startup cancelled.');
    }
  };
  button.notifyPose = (session = renderer.xr.getSession?.()) => {
    const attempt = current;
    if (!attempt || attempt.session !== session || attempt.ended || attempt.cancelled || attempt.exitRequested || attempt.firstPose) return;
    attempt.firstPose = true; clearTimeout(attempt.poseTimer);
    if (attempt.ready) status('ready', 'VR is ready.');
  };

  button.addEventListener('click', () => {
    if (state === 'off') refresh();
    else if (state === 'idle') start();
    else if (state === 'starting') button.cancelStartup();
    else if (state === 'running') stop();
  });
  show('VR ...', false);
  navigator.xr.addEventListener?.('devicechange', refresh);
  refresh();
  return button;
}
