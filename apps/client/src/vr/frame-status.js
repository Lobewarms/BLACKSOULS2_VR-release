// Mark startup ready only after a successful draw for this session's tracked
// XR frame. A granted session or a desktop render does not prove VR is drawing.
const readySession = new WeakMap();

export function renderWithXrStatus(renderer, scene, camera, frame, onTracked) {
  renderer.render(scene, camera);
  const xr = renderer.xr, session = xr.getSession?.();
  if (!frame || !xr.isPresenting || !session || frame.session !== session) return;
  if (readySession.get(renderer) === session) return;
  const reference = xr.getReferenceSpace?.();
  if (!reference) return;
  let pose;
  try { pose = frame.getViewerPose(reference); } catch { return; }
  if (pose?.views?.length) { onTracked(session); readySession.set(renderer, session); }
}
