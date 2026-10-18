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
// after every session the local server (opts.resetXr) ends that process: the next ENTER VR is a first session
// again. The button waits for the new process to find the headset.
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

// opts.restoreView(): puts the desktop canvas back after a start that failed half way
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
  let session = null;

  async function refresh() {
    let ok = false, err = null;
    try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { err = e; }
    if (state !== 'off' && state !== 'idle') return;
    if (err) { state = 'off'; show('VR NOT ALLOWED', false); warn('isSessionSupported failed:', errText(err)); }
    else if (ok) { state = 'idle'; show('ENTER VR', true); }
    else { state = 'off'; show('VR NOT SUPPORTED', false); }
  }

  // after a session: a fresh XR process for the next one (see the top of this file)
  let resetting = null;
  function afterSession() {
    if (resetting) return resetting;
    state = 'resetting';
    show('VR ...', false);
    resetting = (async () => {
      let done = false;
      if (opts.resetXr) {
        try { done = !!(await timeout(Promise.resolve(opts.resetXr()), 10000, 'XR reset')); } catch (e) { warn('XR reset failed:', errText(e)); }
      }
      if (done) {
        // the browser starts the new process at once; wait until it has found the headset (at most 15 s)
        const t0 = performance.now();
        let ok = false;
        while (!ok && performance.now() - t0 < 15000) {
          await new Promise(r => setTimeout(r, 400));
          try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* */ }
        }
        log(`fresh XR process ${ok ? 'ready' : 'has no headset yet'} after ${Math.round(performance.now() - t0)} ms`);
      } else log('XR process not reset (the next session may not show)');
      resetting = null;
      state = 'idle';
      show('ENTER VR', true);
      refresh();
    })();
    return resetting;
  }

  async function start() {
    state = 'starting';
    show('STARTING...', false);
    log('ENTER VR');
    const t0 = performance.now();
    let s = null, ended = false;
    try {
      await timeout(makeCompatible(renderer, 'ENTER VR'), 20000, 'makeXRCompatible');
      s = await navigator.xr.requestSession('immersive-vr', sessionInit);
      log(`session granted (${(s.enabledFeatures || []).join(', ') || 'no feature list'}), visibility ${s.visibilityState}`);
      s.addEventListener('end', () => {
        ended = true;
        log(`session ended after ${((performance.now() - t0) / 1000).toFixed(1)} s, ${renderer.info?.render?.frame ?? '?'} frames drawn`);
        if (session === s) session = null;
        opts.onVisibility?.('ended');
        afterSession();
      });
      s.addEventListener('visibilitychange', () => {
        log(`visibility ${s.visibilityState} (${((performance.now() - t0) / 1000).toFixed(1)} s in, ${renderer.info?.render?.frame ?? '?'} frames drawn)`);
        opts.onVisibility?.(s.visibilityState);
      });
      await timeout(renderer.xr.setSession(s), 20000, 'setSession');
      if (ended) throw new Error('the session ended while it was starting');
      session = s;
      state = 'running';
      show('EXIT VR', true);
      const layer = renderer.xr.getBaseLayer?.();
      log(!layer ? 'in VR' : 'textureWidth' in layer ? `in VR, drawing into a projection layer ${layer.textureWidth}x${layer.textureHeight}`
        : `in VR, drawing into an XRWebGLLayer ${layer.framebufferWidth}x${layer.framebufferHeight}`);
    } catch (e) {
      warn('could not enter VR:', errText(e));
      if (!renderer.xr.isPresenting) opts.restoreView?.();
      session = null;
      if (s) {
        // a session was granted: its end brings the button back, after a fresh XR process
        if (!ended) s.end().catch(() => afterSession());
        setTimeout(() => { if (state === 'starting') afterSession(); }, 5000);
        return;
      }
      state = 'idle';
      show('ENTER VR', true);
      refresh();
    }
  }

  function stop() {
    if (!session) return;
    state = 'ending';
    show('EXITING...', false);
    session.end().catch(e => { warn('could not end the session:', errText(e)); session = null; state = 'idle'; show('ENTER VR', true); });
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
