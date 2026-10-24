import * as THREE from 'three';
import { G } from '../core/globals.js';
import { $data } from '../data/data.js';

const TOUCH_REACH = 0.32, ARM_REACH = 1.8;

// Discover loot interactions, then run their original event. Never award an
// item here: messages, choices, switches and co-op authority still belong to it.
export function hasPickupReward(list, commonEvents = $data.commonEvents, seen = new Set(), depth = 0) {
  if (depth > 8) return false;
  for (const command of list || []) {
    const p = command.parameters || [];
    if (command.code >= 125 && command.code <= 128) {
      const offset = command.code === 125 ? 0 : 1;
      if (p[offset] === 0 && (p[offset + 1] === 1 || p[offset + 2] > 0)) return true;
    }
    if (command.code === 117 && !seen.has(p[0])) {
      seen.add(p[0]);
      if (hasPickupReward(commonEvents?.[p[0]]?.list, commonEvents, seen, depth + 1)) return true;
    }
    if ([355, 655].includes(command.code) && /\$game_party\.(?:gain_gold\(\s*(?:[1-9]\d*|\$game_variables\[)|gain_item\(\s*\$data_(?:items|weapons|armors)\[[^\]]+\]\s*,\s*(?:[1-9]\d*|\$game_variables\[))/i.test(String(p[0]))) return true;
  }
  return false;
}

export class WorldPickup {
  constructor() {
    this.rewardPages = new WeakMap();
    this.ray = new THREE.Raycaster();
    this.bounds = new THREE.Box3();
    this.alphaImages = new WeakMap();
  }
  textureChannel(texture, uv, channel) {
    const image = texture?.image;
    if (!image || !uv) return 1;
    const source = texture.source;
    let cached = this.alphaImages.get(source);
    if (!cached || cached.version !== source.version || cached.image !== image) {
      let pixels = null;
      try {
        if (image.data && texture.format === THREE.RGBAFormat) pixels = image.data;
        else {
          const canvas = image.getContext ? image : document.createElement('canvas');
          if (canvas !== image) { canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0); }
          pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
        }
      } catch { /* unavailable image data: retain solid-world occlusion */ }
      cached = { version: source.version, image, pixels, width: image.width, height: image.height };
      this.alphaImages.set(source, cached);
    }
    if (!cached.pixels || !cached.width || !cached.height) return 1;
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    const point = texture.transformUv(uv.clone());
    const x = Math.max(0, Math.min(cached.width - 1, Math.floor(point.x * cached.width)));
    const y = Math.max(0, Math.min(cached.height - 1, Math.floor(point.y * cached.height)));
    return cached.pixels[(y * cached.width + x) * 4 + channel] / 255;
  }
  hasReward(page) {
    let cached = this.rewardPages.get(page);
    if (!cached || cached.common !== $data.commonEvents) {
      cached = { common: $data.commonEvents, value: hasPickupReward(page.list) };
      this.rewardPages.set(page, cached);
    }
    return cached.value;
  }
  eligible(sprite) {
    const event = sprite.ch;
    if (!event?.isEvent || !event.page || event.erased || event.starting || event.locked || ![0, 1, 2].includes(event.trigger)
      || sprite.hiddenNow !== false || !sprite.group?.visible || !sprite.info
      || !(sprite.info.object || sprite.info.tile || sprite.mode === 'lie' || sprite.isCorpseGraphic?.())
      || G.combat?.hidesEvent?.(event) || G.arena?.blocksTrigger?.(event)
      || G.coop?.phantom && (event.net?.hidden || event.net?.gone)) return false;
    return this.hasReward(event.page);
  }
  clearPath(from, to, sprites = [], target = null) {
    const direction = to.clone().sub(from), distance = direction.length();
    if (distance < 0.04) return true;
    const blockers = [G.view?.mesh?.group, ...(G.view?.loop?.copies || []).map(copy => copy.obj)];
    for (const sprite of sprites) {
      const event = sprite.ch;
      if (sprite !== target && sprite.hiddenNow === false && event?.page && !event.erased
        && !event.through && event.normalPriority?.()) blockers.push(sprite.group);
    }
    const roots = blockers.filter(root => root?.visible);
    for (const root of roots) root.updateWorldMatrix(true, true);
    this.ray.set(from, direction.divideScalar(distance)); this.ray.near = 0.01; this.ray.far = distance - 0.025;
    return !this.ray.intersectObjects(roots, true).some(hit => {
      for (let object = hit.object; object; object = object.parent) if (!object.visible) return false;
      // Cylindrical scenery is positioned by a vertex shader, not these CPU
      // triangles. Decorative billboards must not become invisible walls.
      if (hit.object.geometry?.getAttribute('center')) return false;
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex || 0] : hit.object.material;
      if (!material || material.visible === false || material.opacity <= 0) return false;
      let alpha = material.opacity ?? 1;
      if (material.map) alpha *= this.textureChannel(material.map, hit.uv, 3);
      if (material.alphaMap) alpha *= this.textureChannel(material.alphaMap, hit.uv, 1);
      return alpha > 0 && alpha >= material.alphaTest;
    });
  }
  update(sprites, head) {
    const input = G.input, combat = G.combat;
    if (!G.vr || G.xrAway || !G.player?.canMove() || G.ui?.pointerBusy?.() || G.ui?.sceneOpen || G.ui?.prompt?.shown
      || combat?.playerDead || combat?.spectating || combat?.gripAdjust || combat?.quick?.isOpen || G.emotes?.ring?.isOpen) return false;
    let best = null;
    for (const hand of ['right', 'left']) {
      if (!(input.grabPressed?.(hand) ?? input.xrPressed(hand, 1))) continue;
      const controller = input.controllers[hand];
      if (!controller?.grip || controller.grip.visible === false || controller.ray?.visible === false
        || combat?.held?.hand === hand || hand === 'right' && (combat?.ready || combat?.skillArm)
        || hand === 'left' && combat?.shield?.visible && !combat.disarmed) continue;
      controller.grip.updateWorldMatrix(true, false);
      const position = controller.grip.getWorldPosition(new THREE.Vector3());
      if (![position.x, position.y, position.z, head?.x, head?.y, head?.z].every(Number.isFinite)
        || position.distanceTo(head) > ARM_REACH) continue;
      for (const sprite of sprites || []) {
        if (!this.eligible(sprite)) continue;
        const visual = sprite.slab?.visible ? sprite.slab : sprite.mesh;
        if (!visual?.visible || visual.material?.visible === false || visual.material?.opacity <= 0) continue;
        visual.updateWorldMatrix(true, true); this.bounds.setFromObject(visual);
        if (sprite.mode === 'stand' && visual === sprite.mesh) {
          const scale = visual.getWorldScale(new THREE.Vector3()).y;
          this.bounds.min.y += (sprite.footDrop || 0) * scale;
          this.bounds.max.y -= (sprite.headDrop || 0) * scale;
        }
        if (this.bounds.isEmpty()) continue;
        const target = this.bounds.clampPoint(position, new THREE.Vector3()), distance = target.distanceTo(position);
        if (distance > TOUCH_REACH || best && best.distance <= distance || !this.clearPath(head, position, sprites, sprite)
          || !this.clearPath(head, target, sprites, sprite) || !this.clearPath(position, target, sprites, sprite)) continue;
        best = { event: sprite.ch, hand, distance };
      }
    }
    if (!best || !G.player.startActionEvent(best.event)) return false;
    input.haptic?.(best.hand, 0.25, 45);
    return true;
  }
}
