import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';

const lensKeys = ['fov', 'zoom', 'near', 'far', 'filmGauge', 'filmOffset', 'focus'];
const heading = quaternion => new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
const directionYaw = direction => ({ 2: Math.PI, 4: Math.PI / 2, 6: -Math.PI / 2, 8: 0 })[direction];

// Three updates the application camera with the headset's projection and pose.
// Its sessionend restores framebuffer allocation, but not the desktop lens.
export class ViewMode {
  constructor(renderer, camera, rig, { viewport = () => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }),
    spectator = null, releaseTarget = () => {}, isGameplay = () => !!G.map } = {}) {
    Object.assign(this, { renderer, camera, rig, viewport, spectator, releaseTarget, isGameplay });
    this.active = false;
    this.awaitingPose = false;
    this.saveLens();
  }

  saveLens() {
    this.desktopLens = Object.fromEntries(lensKeys.map(key => [key, this.camera[key]]));
    this.desktopView = this.camera.view ? { ...this.camera.view } : null;
  }

  fitDesktop() {
    if (this.renderer.xr.isPresenting) return false;
    const size = this.viewport(), width = Math.max(1, Number(size.width) || 1), height = Math.max(1, Number(size.height) || 1);
    const ratio = Math.max(0.5, Math.min(Number(size.pixelRatio) || 1, 2));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height);
    this.renderer.setViewport?.(0, 0, width, height);
    this.renderer.setScissor?.(0, 0, width, height);
    this.renderer.setScissorTest?.(false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    return true;
  }

  enter() {
    if (this.active) return;
    this.saveLens();
    this.rig.updateWorldMatrix(true, true);
    const look = new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
    this.enterYaw = look.y;
    this.enterPitch = look.x;
    this.enterHead = this.camera.getWorldPosition(new THREE.Vector3());
    this.enterMap = G.map;
    this.enterMapId = G.map?.mapId;
    this.active = true;
    this.awaitingPose = true;
    G.vr = true;
    G.xrAway = false;
    G.input?.transitionViewMode?.(true);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.scale.setScalar(1);
    this.spectator?.start();
    G.combat && (G.combat.equipKey = null);
    G.audio?.resumeAll();
    G.ui?.transitionViewMode?.(true);
  }

  // The first actual viewer pose is the recenter point. No delayed teleport can
  // run after an exit/reentry or use a character captured from an old map.
  beforeFrame(frame) {
    if (!this.active || !this.awaitingPose || !this.renderer.xr.isPresenting || !frame) return false;
    const reference = this.renderer.xr.getReferenceSpace?.();
    if (!reference || !frame.getViewerPose(reference)) return false;
    this.rig.updateWorldMatrix(true, true);
    this.renderer.xr.updateCamera(this.camera);
    this.rig.updateWorldMatrix(true, true);
    const quaternion = this.camera.getWorldQuaternion(new THREE.Quaternion());
    let desired = this.enterYaw;
    if (this.isGameplay() && (G.map !== this.enterMap || G.map?.mapId !== this.enterMapId)) desired = directionYaw(G.map?.playerChar?.direction) ?? desired;
    const delta = desired - heading(quaternion);
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    this.rig.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), delta).add(head);
    this.rig.rotateY(delta);
    this.rig.updateWorldMatrix(true, true);
    const placed = this.camera.getWorldPosition(new THREE.Vector3()), pc = this.isGameplay() ? G.map?.playerChar : null;
    const x = Number.isFinite(pc?.fx) ? (pc.fx + 0.5) * T : this.enterHead.x;
    const z = Number.isFinite(pc?.fy) ? (pc.fy + 0.5) * T : this.enterHead.z;
    this.rig.position.x += x - placed.x;
    this.rig.position.z += z - placed.z;
    this.rig.updateWorldMatrix(true, true);
    this.awaitingPose = false;
    G.ui?.placeRoot?.(true);
    return true;
  }

  restoreDesktop() {
    // A raw XRSession end event fires before Three restores its framebuffer.
    // Only the manager's sessionend (or a fully failed start) can restore here.
    if (this.renderer.xr.isPresenting) return false;
    const wasActive = this.active;
    if (wasActive) {
      this.rig.updateWorldMatrix(true, true);
      const head = this.camera.getWorldPosition(new THREE.Vector3());
      const quaternion = this.camera.getWorldQuaternion(new THREE.Quaternion());
      const angles = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
      const changedMap = this.isGameplay() && (G.map !== this.enterMap || G.map?.mapId !== this.enterMapId);
      const yaw = this.awaitingPose ? changedMap ? directionYaw(G.map?.playerChar?.direction) ?? this.enterYaw : this.enterYaw : angles.y;
      const pitch = THREE.MathUtils.clamp(this.awaitingPose ? this.enterPitch : angles.x, -1.45, 1.45);
      const pc = this.isGameplay() ? G.map?.playerChar : null;
      const x = this.awaitingPose ? Number.isFinite(pc?.fx) ? (pc.fx + 0.5) * T : this.enterHead.x : head.x;
      const z = this.awaitingPose ? Number.isFinite(pc?.fy) ? (pc.fy + 0.5) * T : this.enterHead.z : head.z;
      this.rig.position.x = x; this.rig.position.z = z;
      this.rig.rotation.set(0, 0, 0);
      this.camera.position.set(0, G.settings.eyeHeight, 0);
      this.camera.scale.setScalar(1);
      this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
      if (G.player) { G.player.yaw = yaw; G.player.pitch = pitch; G.player.snapReady = true; }
    }
    this.active = false;
    this.awaitingPose = false;
    G.vr = false;
    G.xrAway = false;
    this.releaseTarget();
    this.spectator?.stop();
    if (wasActive || this.spectator?.deferred) void this.spectator?.resumePreparation?.();
    this.renderer.setRenderTarget?.(null);
    Object.assign(this.camera, this.desktopLens);
    this.camera.view = this.desktopView ? { ...this.desktopView } : null;
    this.fitDesktop();
    this.rig.updateWorldMatrix(true, true);
    if (wasActive) G.input?.transitionViewMode?.(false);
    G.combat && (G.combat.equipKey = null);
    G.ui?.transitionViewMode?.(false);
    return true;
  }
}
