// Short effects of the fights: flashes, tracers, glows - and projectiles in flight (enemies' shots and the player's).
import * as THREE from 'three';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { FloorMarker, MARK } from '../telegraph.js';
import { buildIconModel } from '../weapons.js';
import { FORWARD, fxk, textSprite } from './common.js';
import { HELD_SCALE, makeShotLook } from './shotlooks.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class EffectPart {
  // ---- short effects: flashes, tracers ----------------------------------------------------------
  glowTexture() {
    if (!this._glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      this._glowTex = new THREE.CanvasTexture(c);
    }
    return this._glowTex;
  }
  // (grav: how fast it falls - a mote rising from a marked area floats; arc: thrown along a curve from one point to
  // another, at full strength until it lands; map: another picture than the round glow, normal: drawn over what is behind
  // it - smoke, dust - not added to it; spin: rad/s it turns; opacity: to start with - shotlooks.js trails)
  spawnGlow(pos, { color = 0xffe0a0, size = 0.3, life = 0.12, grow = 1.5, vel = null, grav = 7, arc = null, map = null, normal = false, spin = 0, opacity = 1 } = {}) {
    color = new THREE.Color(color).multiplyScalar(fxk());
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: map || this.glowTexture(), color, opacity, transparent: true,
      blending: normal ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.renderOrder = 1400;
    this.root.add(s);
    this.fx.push({ obj: s, t: 0, life, size, grow, vel, grav, arc, spin, op: opacity });
    return s;
  }
  // a spray of sparks glancing off where a blow met a shield: out to the sides and up, not on along the
  // blow (blow: its way, x / z)
  spawnSparks(pos, blow, n = 8, color = 0xfff0c0) {
    // (small, and a gameplay cue: full brightness whatever the effect brightness setting)
    const c = new THREE.Color(color).multiplyScalar(1 / fxk());
    const l = Math.hypot(blow.x, blow.z) || 1, bx = blow.x / l, bz = blow.z / l;
    for (let i = 0; i < n; i++) {
      const side = (Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.8);
      const back = -0.4 - Math.random() * 0.8;              // a little back toward where the blow came from
      const v = new THREE.Vector3(-bz * side + bx * back, 1 + Math.random() * 1.8, bx * side + bz * back);
      this.spawnGlow(pos, { color: c, size: 0.05 + Math.random() * 0.05, life: 0.2 + Math.random() * 0.2, grow: 0.6, vel: v });
    }
    this.spawnGlow(pos, { color: c, size: 0.32, life: 0.12, grow: 1.6 });
  }
  spawnTracer(from, to, color = 0xfff0b0) {
    const len = from.distanceTo(to);
    if (len < 0.05) return;
    const geo = new THREE.CylinderGeometry(0.014, 0.014, len, 6, 1, true);
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.4 + 0.6 * fxk()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    this.root.add(m);
    this.fx.push({ obj: m, t: 0, life: 0.16, tracer: true });
  }
  updateFx(dt) {
    if (!this.fx.length) return;
    // (a trail's motes are made after the sweep: made in it, they went into the list being replaced and so were
    // never taken away again - a grab's dark red trail stayed in the air for good)
    const trails = [];
    this.fx = this.fx.filter(f => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        this.root.remove(f.obj);
        if (f.tracer) f.obj.geometry.dispose();
        f.obj.material.dispose();
        return false;
      }
      if (f.arc) {
        f.obj.position.lerpVectors(f.arc.from, f.arc.to, k);
        f.obj.position.y += f.arc.h * 4 * k * (1 - k);
        if (f.arc.trail && Math.random() < 0.6) trails.push({ at: f.obj.position.clone(), color: f.arc.trail, size: f.size * 0.45 });
        return true;
      }
      f.obj.material.opacity = (f.op ?? 1) * (1 - k);
      if (f.spin) f.obj.material.rotation += f.spin * dt;
      if (!f.tracer) f.obj.scale.setScalar(f.size * (1 + (f.grow - 1) * k));
      if (f.vel) { f.obj.position.addScaledVector(f.vel, dt); f.vel.y -= (f.grav ?? 7) * dt; }
      return true;
    });
    for (const t of trails) this.spawnGlow(t.at, { color: t.color, size: t.size, life: 0.18, grow: 0.5 });
  }
  // animation "target flash": a short glow at the target (not right in the player's face)
  flashAt(pos, color) {
    const head = G.player?.headWorld(new THREE.Vector3());
    if (!pos || (head && pos.distanceTo(head) < 0.8)) return;
    const c = color ? new THREE.Color(color.red / 255, color.green / 255, color.blue / 255) : new THREE.Color(1, 1, 1);
    this.spawnGlow(pos, { color: c, size: 0.9, life: 0.25, grow: 1.4 });
  }

  // ---- popups --------------------------------------------------------------------------------
  popup(pos, text, color) {
    if (!G.settings.showDamage) return;
    const s = textSprite(text, color);
    s.position.copy(pos);
    this.root.add(s);
    this.popups.push({ sprite: s, t: 0 });
  }
  popupAtPlayer(text, color) {
    const head = G.player.headWorld(new THREE.Vector3());
    this.popup(head.addScaledVector(G.player.forwardVec(), 0.9).add(new THREE.Vector3(0, -0.35, 0)), text, color);
  }

  // ---- projectiles -------------------------------------------------------------------------
  // (thrown items: gravity, track = the enemy a pot keeps on until landAt, align = the model points where it flies,
  // tumble = it turns over as it flies, fine = tested in short steps - a fast knife must not pass through anyone)
  // (owner 'peer': another co-op player's shot as this world shows it - peerShot; anim: what plays where it ends)
  // (style: how it looks in flight - shotlooks.js: a gun's round, a knife, a spell of its kind; tint: a colour with a meaning
  // over that look - an enemy's sure-hit shot purple. An enemy's are bigger, to be seen coming. Neither: a ball of its colour)
  spawnProjectile(from, dir, { speed = 7, color = 0x8844ff, owner = 'enemy', enemy = null, skill = null, power = 1, homing = 0.6, target = null, usable = null, mesh = null, certain = false, aoe = 0, dest = null, life = 4, breakSkill = null, cap = null,
    gravity = 0, track = null, landAt = 0, align = false, tumble = false, fine = false, aimAt = null, steer = 0, accel = 0, maxSpeed = speed, pierce = false, ghost = false, one = false, volley = null, anim = 0,
    staff = 0, style = null, tint = null }) {
    // (an enemy's spell turned back - owner 'mirror' - is as big as it came)
    const big = owner === 'enemy' || owner === 'mirror';
    if (!mesh && style) {
      mesh = makeShotLook(style, { tint, scale: big ? 1.6 : 1, bright: 0.45 + 0.55 * fxk(), emit: (at, o) => this.spawnGlow(at, o),
        busy: () => this.projectiles.length > 12 });
      if (mesh.userData.align) { align = true; mesh.quaternion.setFromUnitVectors(FORWARD, dir.clone().normalize()); }
    }
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.13 : 0.08, 12, 8),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.26 : 0.16, 12, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
      mesh.add(glow);
    }
    mesh.position.copy(from);
    this.root.add(mesh);
    const p = { mesh, vel: dir.clone().normalize().multiplyScalar(speed), owner, enemy, skill, power, life, homing, speed, target, usable, certain, aoe, dest, breakSkill, cap,
      gravity, track, landAt, align, tumble, fine, aimAt, steer, accel, maxSpeed, pierce, ghost, one, volley, anim, color, staff, style: mesh.userData?.style || null, tint };
    this.projectiles.push(p);
    if (owner === 'player') this.shareShot(p, from);
    if (aoe > 0 && dest && (owner === 'player' || owner === 'peer')) this.areaMark(dest, aoe, G.time + life, p);
  }
  // (co-op) where a player's area spell or thrown pot will burst - its own, another's (peerShot): a blue mark on the
  // floor, as an enemy's move is marked, there till it bursts; a burst round the caster (physicalArea) shows a moment
  areaMark(at, r, until, p = null, always = false) {
    if (!always && !G.coop?.active) return;
    const mk = new FloorMarker(this.root, { shape: 'circle', r, color: MARK.player });
    mk.setPose(at.x, G.floorAt(at.x / T - 0.5, at.z / T - 0.5), at.z);
    mk.setProgress(1);
    (this.areaMarks ||= []).push({ mk, until, p });
  }
  updateAreaMarks() {
    if (!this.areaMarks?.length) return;
    this.areaMarks = this.areaMarks.filter(m => {
      if (G.time < m.until && (!m.p || this.projectiles.includes(m.p))) return true;
      this.fadingMarkers.push(m.mk);
      return false;
    });
  }
  // (co-op) a shot of mine as the other players are to see it (coop.js shareShot -> their peerShot): where it leaves and
  // how it flies, what it looks like, what it goes for, the animation that plays where it meets an enemy and how it
  // ends (an area's burst, a pot breaking where it falls) - only what is seen: what it does is judged here
  shareShot(p, from) {
    if (!G.coop?.active) return;
    const ud = p.mesh.userData || {};
    const look = ud.look === 'arrow' ? 'a' : ud.thrown ? (ud.knife ? 'k' : 't') : ud.icon ? 'i' : 'o';
    let anim = 0;
    if (p.usable) {                                   // (a volley's animation: once; -1: the weapon's, as its blow plays)
      const id = p.volley?.told ? 0 : p.usable.animation_id | 0;
      anim = id < 0 ? G.state.party.leader()?.weapons()[0]?.animation_id | 0 : id;
    }
    else if (!p.breakSkill) {
      const a = G.state.party.leader(), s = a && this.skillByState(a, this.playerAttackSkill(a));
      anim = !s ? 0 : s.animation_id < 0 ? a.weapons()[0]?.animation_id | 0 : s.animation_id | 0;
    }
    if (p.volley) p.volley.told = true;
    G.coop.shareShot({ from, vel: p.vel, look, icon: ud.icon | 0, color: p.color, quat: look === 't' ? p.mesh.quaternion : null, life: p.life,
      gravity: p.gravity, land: p.landAt ? p.landAt - G.time : 0, align: p.align, tumble: p.tumble, fine: p.fine, aoe: p.aoe, dest: p.dest,
      track: p.track?.netId || 0, target: p.target?.netId || 0, anim, style: p.style, tint: p.tint });
  }
  // (co-op) what another player holds ready or in hand instead of its weapon (coop.js lookMsg U), made as this player's
  // own is (readyUsable, holdConsumable) - placed where theirs is (coopavatar.js)
  peerUseModel(u) {
    if (u.k === 's' && u.st) {
      return makeShotLook(u.st, { scale: HELD_SCALE, held: true, bright: 0.45 + 0.55 * fxk(), emit: (at, o) => this.spawnGlow(at, o),
        busy: () => this.projectiles.length > 12 });
    }
    if (u.k === 's') {
      const g = new THREE.Group();
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: new THREE.Color(u.c).multiplyScalar(fxk()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      glow.scale.setScalar(0.32);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(0.45 + 0.55 * fxk()), toneMapped: false }));
      g.add(glow, core);
      return g;
    }
    if (u.k === 't' || u.k === 'k') return this.thrownModel({ icon_index: u.i }, u.k === 'k') || this.iconSprite(u.i);
    const adjust = u.k === 'n' ? { rot: 225, flip: false, offset: 6, scale: 0.13 } : u.k === 'r' ? { rot: 0, flip: false, offset: 7, scale: 0.1 } : { rot: 0, flip: false, offset: 9, scale: 0.11 };
    return buildIconModel(u.i, { kind: 'weapon', wtype: 0, hand: u.h, adjust }) || this.iconSprite(u.i);
  }
  // (co-op) another player's shot (coop.js onShotMsg): flying as theirs does - on to the same enemy, here - and ending where
  // it meets one of this world's enemies, a wall or the floor, with what plays there; it does nothing here
  peerShot(s) {
    let mesh = null;
    if (s.look === 'a') mesh = this.arrowMesh();
    else if (s.look === 'i') mesh = this.iconSprite(s.icon);
    else if (s.look === 't' || s.look === 'k') {
      mesh = this.thrownModel({ icon_index: s.icon }, s.look === 'k') || this.iconSprite(s.icon);
      if (s.quat && mesh.isGroup) mesh.quaternion.copy(s.quat);
    }
    const net = id => (id ? this.puppets.get(id) || this.netEnemies().find(e => e.netId === id) || null : null);
    this.spawnProjectile(s.from, s.vel, { speed: s.vel.length(), owner: 'peer', color: s.color, mesh, homing: 0, life: s.life, gravity: s.gravity,
      landAt: s.land > 0 ? G.time + s.land : 0, align: s.align, tumble: s.tumble, fine: s.fine, aoe: s.aoe, dest: s.dest, track: net(s.track),
      target: net(s.target), anim: s.anim, style: !mesh && s.look === 'o' ? s.style || null : null, tint: s.tint ?? null });
    // (who shot it: it stops at this player only when the two of them may strike each other - coop.js pvpWith)
    const shot = this.projectiles[this.projectiles.length - 1];
    if (shot?.owner === 'peer') { shot.by = s.by || ''; shot.look = s.look; }
  }
  skillColor(skill) {
    const el = skill?.damage?.element_id;
    return { 3: 0xff6a20, 4: 0x80d0ff, 5: 0xffff60, 9: 0x60a0ff, 10: 0xa040ff, 2: 0x60ff60 }[el] || 0xc070ff;
  }
}
