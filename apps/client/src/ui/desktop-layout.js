import * as THREE from 'three';

// CSS pixels keep the desktop interface readable independently of FOV and resolution.
export function desktopViewport(input, renderer) {
  const rect = (input?.dom || renderer?.domElement)?.getBoundingClientRect?.();
  return { width: Math.max(1, rect?.width || globalThis.innerWidth || 1280),
    height: Math.max(1, rect?.height || globalThis.innerHeight || 720) };
}

function pixelScale(camera, viewport, distance = 1) {
  const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2);
  return { x: height * camera.aspect / viewport.width, y: height / viewport.height };
}

export function visiblePanelBounds(root) {
  const bounds = new THREE.Box3();
  for (const mesh of root.children) {
    if (!mesh.visible || !mesh.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    mesh.updateMatrix();
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
  }
  return bounds;
}

export function placeDesktopRoot(root, camera, viewport) {
  const bounds = visiblePanelBounds(root), pixels = pixelScale(camera, viewport);
  const size = bounds.isEmpty() ? new THREE.Vector3(1, 1, 0) : bounds.getSize(new THREE.Vector3());
  const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const marginX = Math.min(32, viewport.width / 8), marginY = Math.min(40, viewport.height / 8);
  const availableWidth = Math.min(1000, viewport.width - 2 * marginX), availableHeight = viewport.height - 2 * marginY;
  const desired = Math.min(900 * pixels.y, availableWidth * pixels.x / Math.max(0.01, size.x),
    availableHeight * pixels.y / Math.max(0.01, size.y));
  // Panels at positive local Z (choices/toasts) are closer than the root plane.
  // Reserve their perspective enlargement when fitting the whole visible group.
  const scale = desired / (1 + desired * Math.max(0, bounds.isEmpty() ? 0 : bounds.max.z));
  const q = camera.getWorldQuaternion(new THREE.Quaternion()), head = camera.getWorldPosition(new THREE.Vector3());
  root.scale.setScalar(scale);
  root.quaternion.copy(q);
  root.position.set(-centre.x * scale, -centre.y * scale, -1).applyQuaternion(q).add(head);
  root.updateMatrixWorld(true);
}

export function anchorDesktopPanel(panel, camera, viewport, { width, x, y, paintedHeight = panel.canvas.height }) {
  const pixels = pixelScale(camera, viewport), scale = width * pixels.y / panel.widthM;
  const fullHeight = width * panel.canvas.height / panel.canvas.width;
  const paintedPixels = width * paintedHeight / panel.canvas.width;
  const left = x === 'right' ? viewport.width - 24 - width : 20;
  const top = y === 'bottom' ? viewport.height - 20 - paintedPixels : 24;
  panel.mesh.rotation.set(0, 0, 0);
  // Geometry is parented to the camera, whose complete pose supplies desktop alignment.
  panel.mesh.scale.set(scale * pixels.x / pixels.y, scale, scale);
  panel.mesh.position.set((left + width / 2 - viewport.width / 2) * pixels.x,
    (viewport.height / 2 - top - fullHeight / 2) * pixels.y, -1);
}
