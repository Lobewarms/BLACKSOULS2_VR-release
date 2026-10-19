// A short desktop introduction to the event that is speaking. It never tracks
// the speaker after the turn or competes with the player's own mouse movement.
import * as THREE from 'three';
import { G } from '../core/globals.js';
import { T } from '../world/mapmesh.js';
import { eventActionPosition } from './event-position.js';

const TURN_SECONDS = 0.38;
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));

function speakerPosition(event, player) {
  if (!event || event.erased || event.transparent || event.opacity === 0 || event.tileId > 0 || !event.characterName) return null;
  const position = eventActionPosition(event);
  if (!position) return null;
  const sprite = G.view?.sprites?.find(s => s.ch === event);
  const mode = sprite?.mode ?? sprite?.layMode?.();
  if (sprite && (sprite.hiddenNow || sprite.group?.visible === false || mode !== 'stand')) return null;
  // Use the visible sprite's upper body, including its floor/wall placement and
  // transparent margins. A not-yet-built sheet uses an ordinary speaking height.
  let y;
  if (sprite?.mesh && Number.isFinite(sprite.bodySize?.[1])) {
    const base = sprite.mesh.getWorldPosition(new THREE.Vector3());
    y = base.y + (sprite.bodySize[1] - (sprite.headDrop || 0)) * sprite.mesh.scale.y * 0.82;
  } else {
    const floor = Number.isFinite(event.viewPos?.y) ? event.viewPos.y : G.floorAt?.(position.x, position.y) || 0;
    y = floor + 1.3;
  }
  const target = new THREE.Vector3((position.x + 0.5) * T, y, (position.y + 0.5) * T);
  if (!target.toArray().every(Number.isFinite)) return null;
  // Remote narration and map-wide autoruns should not swivel the view across an
  // area. This still covers a conversation across a counter or elevated desk.
  if (target.distanceTo(player.headWorld(new THREE.Vector3())) > 6 * T) return null;
  return target;
}

export class DialogueCamera {
  constructor(player) { this.player = player; this.focus = null; }
  cancel() { this.focus = null; }
  begin(source) {
    this.cancel();
    const map = G.map, owner = source?.root || source;
    if (G.vr || !map || map.transferring || !owner?.main || !owner.running() || owner.mapId !== map.mapId) return false;
    const event = source.event?.() || owner.event?.();
    if (!event || map.events?.[event.id] !== event || !speakerPosition(event, this.player)) return false;
    this.focus = { map, owner, event, executionId: owner.executionId,
      yaw: this.player.yaw, pitch: this.player.pitch, time: 0 };
    return true;
  }
  update(dt) {
    const f = this.focus;
    if (!f) return;
    const input = G.input, ui = G.ui, player = this.player;
    if (G.vr || G.map !== f.map || f.map.transferring || !f.owner.running() || f.owner.executionId !== f.executionId
      || f.map.events?.[f.event.id] !== f.event || G.combat?.playerDead || input?.pageFocused === false
      || input?.mouse?.dx || input?.mouse?.dy || input?.dialogueLooking?.() || input?.textInputFocused?.()
      || ui?.sceneBusy?.() || ui?.keyboard?.visible || ui?.prompt?.shown || !ui?.dialogueContinuing?.()) {
      this.cancel(); return;
    }
    const target = speakerPosition(f.event, player);
    if (!target) { this.cancel(); return; }
    // Desktop rotation is local to the rig. Converting the target also handles
    // a rig that was turned in VR before returning to desktop play.
    player.rig.worldToLocal(target);
    const dx = target.x - player.camera.position.x, dz = target.z - player.camera.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05 || !Number.isFinite(dt) || dt < 0) { this.cancel(); return; }
    const yaw = Math.atan2(-dx, -dz), pitch = THREE.MathUtils.clamp(Math.atan2(target.y - G.settings.eyeHeight, distance), -1.1, 1.1);
    f.time = Math.min(TURN_SECONDS, f.time + Math.min(dt, 0.1));
    const t = f.time / TURN_SECONDS, ease = t * t * (3 - 2 * t);
    player.yaw = f.yaw + angle(yaw - f.yaw) * ease;
    player.pitch = f.pitch + (pitch - f.pitch) * ease;
    if (f.time >= TURN_SECONDS) this.cancel();
  }
}
