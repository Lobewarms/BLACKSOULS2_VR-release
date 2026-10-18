// The ENTER VR button (in place of three.js's VRButton) and getting the page ready for the headset.
//
// Laptops with two GPUs (Intel + NVIDIA): the browser draws on the Intel GPU, the headset runtime needs the
// NVIDIA one. WebXR's makeXRCompatible() moves the browser's GPU work over, which LOSES the page's 3D context
// once (three.js restores it by itself). three.js asks for that only after the session has started, so the
// session died with the context: the first ENTER VR always failed, and three's VRButton could then stay on
// "EXIT VR" for a session that was gone (later clicks did nothing).
// Here the context is made XR compatible when the page loads (and when a headset shows up later) and again
// before a session is requested; a failed start ends what is left of the session and puts the button back.
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

// the context events, for the log (a GPU switch shows up as lost + restored)
const watched = new WeakSet();
function watchContext(canvas) {
  if (watched.has(canvas)) return;
  watched.add(canvas);
  canvas.addEventListener('webglcontextlost', () => log('3D context lost'));
  canvas.addEventListener('webglcontextrestored', () => log('3D context restored'));
}

function whenRestored(canvas, gl, ms) {
  return new Promise(res => {
    if (!gl.isContextLost()) { res(); return; }
    let t = 0;
    const done = () => { clearTimeout(t); canvas.removeEventListener('webglcontextrestored', done); setTimeout(res, 0); };
    t = setTimeout(done, ms);
    canvas.addEventListener('webglcontextrestored', done);   // three.js's own handler (added first) restores its state
  });
}

let compatJob = null;
// make the renderer's context XR compatible (true when it is); callers share one pending request
function makeCompatible(renderer, why) {
  const gl = renderer.getContext?.();
  if (!gl || typeof gl.makeXRCompatible !== 'function') return Promise.resolve(false);
  if (gl.getContextAttributes?.()?.xrCompatible) return Promise.resolve(true);
  if (compatJob) return compatJob;
  const canvas = renderer.domElement;
  watchContext(canvas);
  const t0 = performance.now();
  log(`making the 3D context XR compatible (${why})`);
  compatJob = (async () => {
    try {
      await gl.makeXRCompatible();
      await whenRestored(canvas, gl, 10000);
      log(`XR compatible after ${Math.round(performance.now() - t0)} ms`);
      return true;
    } catch (e) {
      warn('makeXRCompatible failed:', errText(e));
      await whenRestored(canvas, gl, 10000);
      return !!gl.getContextAttributes?.()?.xrCompatible;
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
    if (ok) await makeCompatible(renderer, why);
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
  if (!('xr' in navigator)) {
    show(window.isSecureContext === false ? 'WEBXR NEEDS HTTPS' : 'WEBXR NOT AVAILABLE', false);
    return button;
  }
  let state = 'off';       // off (no headset) | idle | starting | running | ending | resetting
  let current = null;

  async function refresh() {
    let ok = false, err = null;
    try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { err = e; }
    if (state !== 'off' && state !== 'idle') return;
    if (err) { state = 'off'; show('VR NOT ALLOWED', false); warn('isSessionSupported failed:', errText(err)); }
    else if (ok) { state = 'idle'; show('ENTER VR', true); }
    else { state = 'off'; show('VR NOT SUPPORTED', false); }
  }

  // Recover a failed granted start; a healthy session keeps its ready runtime.
  async function afterSession(attempt) {
    if (current !== attempt) return;
    state = 'resetting';
    show('VR ...', false);
    let done = false;
    if (attempt.failed && opts.resetXr) {
      try { done = !!(await timeout(Promise.resolve(opts.resetXr()), 10000, 'XR reset')); } catch (e) { warn('XR reset failed:', errText(e)); }
    }
    if (current !== attempt) return;
    if (done) {
      // the browser starts the new process at once; wait until it has found the headset (at most 15 s)
      const t0 = performance.now();
      let ok = false;
      while (!ok && performance.now() - t0 < 15000) {
        await new Promise(r => setTimeout(r, 400));
        if (current !== attempt) return;
        try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* */ }
      }
      log(`fresh XR process ${ok ? 'ready' : 'has no headset yet'} after ${Math.round(performance.now() - t0)} ms`);
    } else if (attempt.failed) log('XR process not reset (the next session may not show)');
    if (current !== attempt) return;
    current = null;
    state = 'idle';
    show('ENTER VR', true);
    refresh();
  }

  function finishEnded(attempt) {
    if (current !== attempt || !attempt.ended || !attempt.attachSettled || attempt.finished || renderer.xr.isPresenting) return;
    attempt.finished = true;
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
    attempt.endPending = true;
    state = 'ending';
    show('EXITING...', false);
    try { await attempt.session.end(); }
    catch (e) {
      if (current !== attempt || attempt.ended) return;
      warn('could not end the session:', errText(e));
      // A rejected end does not mean the headset session ended. Retain it so
      // EXIT VR can retry instead of offering a competing requestSession.
      state = 'running';
      show('EXIT VR', true);
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
    const attempt = { session: null, ended: false, failed: false, attachSettled: true, finished: false, endPending: false };
    current = attempt;
    state = 'starting';
    show('STARTING...', false);
    log('ENTER VR');
    const t0 = performance.now();
    try {
      await timeout(makeCompatible(renderer, 'ENTER VR'), 20000, 'makeXRCompatible');
      if (current !== attempt) return;
      const request = Promise.resolve().then(() => navigator.xr.requestSession('immersive-vr', sessionInit));
      request.then(s => {
        attempt.granted = s;
        if (current !== attempt || attempt.failed) endDetached(s);
      }, () => {});
      const s = await timeout(request, 20000, 'requestSession');
      if (current !== attempt || attempt.failed) return;
      attempt.session = s;
      log(`session granted (${(s.enabledFeatures || []).join(', ') || 'no feature list'}), visibility ${s.visibilityState}`);
      attempt.onEnd = () => {
        if (current !== attempt || attempt.ended) return;
        attempt.ended = true;
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
      attempt.attachSettled = false;
      const attaching = Promise.resolve().then(() => renderer.xr.setSession(s));
      const settled = () => {
        attempt.attachSettled = true;
        if (current !== attempt) return;
        if (attempt.ended) queueMicrotask(() => finishEnded(attempt));
        else if (attempt.endAfterAttach) { attempt.endAfterAttach = false; void endAttempt(attempt); }
      };
      attaching.then(settled, () => { attempt.failed = true; settled(); });
      await timeout(attaching, 20000, 'setSession');
      if (current !== attempt || attempt.ended || attempt.failed) return;
      state = 'running';
      show('EXIT VR', true);
      const layer = renderer.xr.getBaseLayer?.();
      log(!layer ? 'in VR' : 'textureWidth' in layer ? `in VR, drawing into a projection layer ${layer.textureWidth}x${layer.textureHeight}`
        : `in VR, drawing into an XRWebGLLayer ${layer.framebufferWidth}x${layer.framebufferHeight}`);
    } catch (e) {
      if (current !== attempt || attempt.finished) return;
      attempt.failed = true;
      warn('could not enter VR:', errText(e));
      if (attempt.session) {
        state = 'ending'; show('EXITING...', false);
        // Three's pending setSession cannot be cancelled. Wait for it to
        // settle before ending/resetting, so it cannot attach after cleanup.
        if (attempt.attachSettled) {
          if (attempt.ended) queueMicrotask(() => finishEnded(attempt));
          else void endAttempt(attempt);
        } else attempt.endAfterAttach = true;
        return;
      }
      if (attempt.granted) endDetached(attempt.granted);
      if (!renderer.xr.isPresenting) opts.restoreView?.();
      current = null;
      state = 'idle';
      show('ENTER VR', true);
      refresh();
    }
  }

  function stop() {
    if (current?.session) void endAttempt(current);
  }

  button.addEventListener('click', () => {
    if (state === 'idle') start();
    else if (state === 'running') stop();
  });
  show('VR ...', false);
  navigator.xr.addEventListener?.('devicechange', refresh);
  refresh();
  return button;
}
