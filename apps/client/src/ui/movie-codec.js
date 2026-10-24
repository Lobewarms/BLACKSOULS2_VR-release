// Chromium no longer decodes the original Ogg/Theora movies. Load the pinned,
// bundled decoder only for those files; native WebM/MP4 keep the browser path.
export async function createMovieMedia({ path }, {
  document: doc = globalThis.document, loadOgv = () => import('ogv'),
  base = new URL('codecs/ogv/', new URL('./', globalThis.location?.href || 'http://localhost/')).href,
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  const video = doc.createElement('video');
  if (!/\.og[gv]$/i.test(path) || video.canPlayType('video/ogg; codecs="theora"')) return video;
  const module = await loadOgv(), ogv = module.default || module;
  // OGVLoader appends its own slash when constructing decoder/worker URLs.
  ogv.OGVLoader.base = base.replace(/\/+$/, '');
  const context = AudioContext ? new AudioContext() : null;
  let media, source, disposed = false;
  try { media = new ogv.OGVPlayer(context ? { audioContext: context } : {}); source = media.getCanvas(); }
  catch (error) {
    try { media?.stop?.(); } catch { /* Partially constructed decoders may already be closed. */ }
    closeContext(context); throw error;
  }
  return {
    media, source, element: media, needsGesture: true,
    play() {
      return Promise.resolve(context?.resume?.()).then(() => { if (!disposed) media.play(); });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { media.stop(); } catch { /* Finish independent audio/GPU cleanup after decoder failure. */ }
      media.removeAttribute?.('src'); closeContext(context);
      const gl = source.getContext('webgl');
      gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
    },
  };
}

function closeContext(context) {
  try { context?.close?.()?.catch?.(() => {}); } catch { /* Already failed/closed audio contexts need no retry. */ }
}
