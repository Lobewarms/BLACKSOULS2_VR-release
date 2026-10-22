// Hands in VR: a hand on each controller instead of the controller model. A hand that holds something
// (the weapon / shield, a herb bottle or syringe, a resin, an item to throw) is hidden behind it; an empty hand
// (or one whose weapon / shield is put away - 무장해제) shows, its fingers following the trigger (index finger) and the grip (the other three), the thumb down while
// it rests on the stick or presses a face button.
// The hand is the standard WebXR "generic hand" (a skinned mesh, vendor/webxr-hands - MIT), posed here joint by
// joint; if it cannot be loaded a simple hand made of capsules stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G } from './globals.js';

const HAND_URL = './vendor/webxr-hands/generic-hand/';     // (from @webxr-input-profiles/assets 1.0)
const SKIN = 0xd2a68c;
// in the controller's pointing (target-ray) space: the index fingertip sits just in front of and below
// the ray's origin, so the pointer comes out of the pointing finger
const TIP_AT = new THREE.Vector3(0, -0.012, -0.045);

// bend per joint in radians (knuckle, middle joint, end joint)
const CURL_POINT = [0.1, 0.08, 0.05];      // index with the trigger free: pointing
const CURL_REST = [0.4, 0.45, 0.3];        // the other fingers with the grip free
const CURL_FIST = [1.45, 1.6, 1.05];       // squeezed
const THUMB_REST = [0.12, 0.1, 0.05];
const THUMB_DOWN = [0.4, 0.35, 0.35];
const lerp3 = (a, b, t) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);

// ---- the generic hand ----------------------------------------------------------------------
const CHAINS = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};
const _axis = new THREE.Vector3(), _rot = new THREE.Quaternion();

class GltfHand {
  constructor(hand, scene) {
    this.root = new THREE.Group();
    this.root.name = `hand-${hand}`;
    // the model points its fingers down (-Y) with the thumb toward -Z: turn the fingers forward and the
    // thumb up
    scene.rotation.x = Math.PI / 2;
    this.root.add(scene);
    this.materials = [];
    scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.material = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.66, metalness: 0 });
      this.materials.push(o.material);
      o.frustumCulled = false;
    });
    const bones = {};
    scene.traverse(o => { if (o.isBone) bones[o.name] = o; });
    this.chains = {};
    for (const [name, list] of Object.entries(CHAINS)) {
      const bs = list.map(n => bones[n]);
      if (bs.some(b => !b)) throw new Error(`hand bone missing in ${name}`);
      // the bones hang side by side under the armature (each joint is posed on its own)
      this.chains[name] = { bones: bs, pos: bs.map(b => b.position.clone()), quat: bs.map(b => b.quaternion.clone()), first: name === 'thumb' ? 0 : 1, curl: [0.2, 0.2, 0.1] };
    }
    for (const ch of Object.values(this.chains)) this.applyChain(ch);
    scene.updateMatrixWorld(true);
    const tip = bones['index-finger-tip'].getWorldPosition(new THREE.Vector3());
    scene.position.copy(TIP_AT).sub(tip);
  }
  dispose() {
    this.root.traverse(o => o.geometry?.dispose());
    this.materials.forEach(m => m.dispose());
  }
  // bend the chain's three joints in turn (about each joint's own sideways axis, toward the palm); the
  // joints past one follow it
  applyChain(ch) {
    const P = ch.pos.map(p => p.clone()), Q = ch.quat.map(q => q.clone());
    for (let j = 0; j < 3; j++) {
      const jj = ch.first + j, a = ch.curl[j];
      if (Math.abs(a) < 1e-4) continue;
      _axis.set(1, 0, 0).applyQuaternion(Q[jj]);
      _rot.setFromAxisAngle(_axis, -a);
      for (let m = jj; m < P.length; m++) {
        if (m > jj) P[m].sub(P[jj]).applyQuaternion(_rot).add(P[jj]);
        Q[m].premultiply(_rot);
      }
    }
    ch.bones.forEach((b, m) => { b.position.copy(P[m]); b.quaternion.copy(Q[m]); });
  }
  pose(dt, trigger, grip, thumbDown) {
    const k = 1 - Math.exp(-dt * 18);
    for (const [name, ch] of Object.entries(this.chains)) {
      const want = name === 'thumb' ? (thumbDown ? THUMB_DOWN : THUMB_REST)
        : name === 'index' ? lerp3(CURL_POINT, CURL_FIST, trigger) : lerp3(CURL_REST, CURL_FIST, grip);
      for (let i = 0; i < 3; i++) ch.curl[i] += (want[i] - ch.curl[i]) * k;
      this.applyChain(ch);
    }
  }
}

// ---- stand-in: a hand of capsules (canonical left hand: palm faces +X, fingers -Z, thumb +Y) -----
const PALM_POS = new THREE.Vector3(-0.02, -0.035, 0.075);
const FINGERS = [
  // name, knuckle y, splay, phalanx lengths, radius
  ['index', 0.027, 0.07, [0.042, 0.025, 0.02], 0.0095],
  ['middle', 0.009, 0.02, [0.046, 0.029, 0.022], 0.0098],
  ['ring', -0.009, -0.03, [0.043, 0.027, 0.021], 0.0092],
  ['pinky', -0.026, -0.08, [0.034, 0.02, 0.018], 0.0082],
];
function phalanxGeometry(len, r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 3, 10);
  g.rotateX(-Math.PI / 2);                 // along -Z
  g.translate(0, 0, -len / 2);
  return g;
}
class CapsuleHand {
  constructor(hand) {
    const side = hand === 'left' ? 1 : -1;
    this.root = new THREE.Group();
    this.root.name = `hand-${hand}`;
    this.root.position.set(PALM_POS.x * side, PALM_POS.y, PALM_POS.z);
    const inner = new THREE.Group();       // the canonical left hand, mirrored for the right
    if (side < 0) inner.scale.x = -1;
    this.root.add(inner);
    const mat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.78, metalness: 0 });
    this.material = mat;
    inner.add(new THREE.Mesh(new RoundedBoxGeometry(0.028, 0.08, 0.09, 3, 0.012), mat));
    this.fingers = [];
    for (const [name, y, splay, lens, r] of FINGERS) {
      const base = new THREE.Group();
      base.position.set(0.002, y, -0.042);
      base.rotation.x = splay;
      inner.add(base);
      const joints = [];
      let parent = base;
      lens.forEach((len, k) => {
        const j = new THREE.Group();
        if (k > 0) j.position.z = -lens[k - 1];
        parent.add(j);
        j.add(new THREE.Mesh(phalanxGeometry(len, r * (1 - k * 0.08)), mat));
        joints.push(j);
        parent = j;
      });
      this.fingers.push({ name, joints, curl: [0.3, 0.3, 0.2] });
    }
    const tBase = new THREE.Group();
    tBase.position.set(0.006, 0.036, 0.012);
    tBase.rotation.order = 'YXZ';
    tBase.rotation.set(0.55, -0.5, 0);
    inner.add(tBase);
    const tLens = [0.036, 0.03, 0.024];
    const tJoints = [];
    let tp = tBase;
    tLens.forEach((len, k) => {
      const j = new THREE.Group();
      if (k > 0) j.position.z = -tLens[k - 1];
      tp.add(j);
      j.add(new THREE.Mesh(phalanxGeometry(len, 0.012 - k * 0.001), mat));
      tJoints.push(j);
      tp = j;
    });
    this.thumb = { base: tBase, joints: tJoints, curl: [...THUMB_REST], lift: 0.55 };
  }
  dispose() {
    this.root.traverse(o => o.geometry?.dispose());
    this.material.dispose();
  }
  pose(dt, trigger, grip, thumbDown) {
    const k = 1 - Math.exp(-dt * 18);
    for (const f of this.fingers) {
      const want = f.name === 'index' ? lerp3(CURL_POINT, CURL_FIST, trigger) : lerp3(CURL_REST, CURL_FIST, grip);
      f.joints.forEach((j, i) => { f.curl[i] += (want[i] - f.curl[i]) * k; j.rotation.y = -f.curl[i]; });
    }
    const t = this.thumb;
    t.joints.forEach((j, i) => {
      const want = (thumbDown ? THUMB_DOWN : THUMB_REST)[i];
      t.curl[i] += (want - t.curl[i]) * k;
      j.rotation.y = -t.curl[i];
    });
    t.lift += ((thumbDown ? 0.2 : 0.55) - t.lift) * k;
    t.base.rotation.x = t.lift;
  }
}

// a hand of the other co-op player's (coopavatar.js): its own model, posed with what that player's hands do
export async function makeHand(hand) {
  try {
    const gltf = await new GLTFLoader().loadAsync(`${HAND_URL}${hand}.glb`);
    return new GltfHand(hand, gltf.scene);
  } catch { return new CapsuleHand(hand); }
}

// ---- both hands ----------------------------------------------------------------------------
export class Hands {
  constructor() {
    this.models = { left: null, right: null };
    this.spaces = { left: null, right: null };
    const loader = new GLTFLoader();
    for (const hand of ['left', 'right']) {
      loader.loadAsync(`${HAND_URL}${hand}.glb`).then(gltf => {
        const m = new GltfHand(hand, gltf.scene);
        const old = this.models[hand];
        if (old) { old.root.parent?.remove(old.root); old.dispose(); }
        this.models[hand] = m;
        this.spaces[hand]?.add(m.root);
      }).catch(e => console.warn(`hand model (${hand}) not loaded, using the simple hand:`, e?.message || e));
    }
  }
  roots() { return [this.models.left?.root, this.models.right?.root].filter(Boolean); }
  // a controller connected: its hand goes onto the pointing space
  attach(hand, raySpace) {
    this.spaces[hand] = raySpace;
    if (!this.models[hand]) this.models[hand] = new CapsuleHand(hand);
    if (this.models[hand].root.parent !== raySpace) raySpace.add(this.models[hand].root);
  }
  update(dt) {
    const input = G.input, combat = G.combat;
    const ctrl = input.controllers;
    for (const hand of ['left', 'right']) {
      const m = this.models[hand];
      if (!m) continue;
      const grip = ctrl[hand]?.grip;
      // the weapon / shield in this hand covers it, and so does an item held in it (a resin: the left)
      const held = hand === 'right' ? combat?.weapon : combat?.shield;
      let busy = !!held && held.visible && !!grip && held.parent === grip && !held.userData.unarmed;
      if (combat?.held?.hand === hand || (hand === 'right' && combat?.ready?.kind === 'item')) busy = true;
      m.root.visible = G.vr && !busy;
      if (!m.root.visible) continue;
      // the thumb goes down while it rests on the stick (touch sensor; a click counts too, for runtimes
      // without touch) or presses a face button
      const thumbDown = input.xrTouched(hand, 3) || input.xrHeld(hand, 3) || input.xrHeld(hand, 4) || input.xrHeld(hand, 5);
      const trigger = input.xrValue(hand, 0), squeeze = input.xrValue(hand, 1);
      m.pose(dt, trigger, squeeze, thumbDown);
      m.last = [trigger, squeeze, thumbDown ? 1 : 0];          // (what the other co-op player's copy of it is told)
    }
  }
}
