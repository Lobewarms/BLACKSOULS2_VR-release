// Boss moves beyond combat.js's first set (bossFamily / planBossMove / releaseBossMove / updateBossAct), installed on
// CombatSystem.prototype (combat.js, at its end). A boss's skill falls into one by its name, its battle message and its
// animation, and is played out as a move of its own:
//  farOrb      it flies back off the player and up, a huge orb swelling before it, and hurls the orb onto the circle laid at
//              the player's feet (the circle follows them until a moment before)
//  blinkChain  gone, and there behind the player: a line laid through them, a dash along it - three times over
//              (흑기사 린다메아's: east, west, south or north of them, at random each time)
//  starSpin    a star of beams out from the boss, turning round it while it fills: it strikes where the arms are when full
//  lattice     a lattice of beams laid round the player: one way first, then across
//  stripes     bands across the floor, through the boss: every other one, then the ones between, then the first ones again
//  cloakLeap   up in a swirl of its cloak, straight up out of sight at once (흑기사 린다메아's 뛰어넘기): the form the original
//              changes it into then stays up there (skyHold); with none it drops down behind the player
// 흑기사 린다메아 has her own: her lance from a side of the player (관통창, blinkChain), void lances in a lattice (허공창), the
// punishment in bands (형벌), the black light as a turning star (흑사광), the black sanctions - three heavy cuts from a side (검은
// 제재 / 검은 극형) -, her leap in the cloak (뛰어넘기) and Noah's apocalypse hurled from afar (노아의 묵시록).
// And 윈터벨의 바람's wind blows the player up into the sky, to drop them when its 낙하 comes (liftInfo, player.js liftUp).
// A boss that changes into a form with no picture of its own goes up into the sky, out of sight, and comes down as it changes back
// (skyHold: 린다메아 and 이디스 after their 뛰어넘기, 윈터벨의 바람 as it blows the player up); a mount drawn in its rider's picture
// is one body with the rider - 린다메아's 준마 (pairMounts).
import * as THREE from 'three';
import { G } from './globals.js';
import { $data } from './data.js';
import { T } from './mapmesh.js';
import { FloorMarker, MARK } from './telegraph.js';
import { lineOfSight } from './collision.js';

export const NEW_MOVES = ['farOrb', 'blinkChain', 'starSpin', 'lattice', 'stripes', 'cloakLeap'];
// the moves laid down in parts (combat.js updateMulti / landPart)
export const PART_MOVES = ['starSpin', 'lattice', 'stripes'];
const DASH_SPEED = 30;           // m/s: a blink chain's dash
const BLINK_D = [3.2, 4.2];      // m behind the player it comes out
const LANCE_ON = 18;             // m a lance thrust runs on past the player
const LIFT_TOP = 5.5;            // m: how high the wind blows the player
const SKY_LIFT = 15;             // m: how high a boss gone up into the sky is
const SKY_SEEN = 8;              // m: higher than this it is out of sight
const SKY_RISE = 40;             // m/s: how fast it springs up there (out of sight in a fifth of a second)
const CLOAK_RISE = 150;          // m/s: 뛰어넘기's spring (흑기사 린다메아, 잿빛 독수리 이디스) - out of sight in a few frames
const SKY_DROP = 90;             // m/s: how fast one of them comes down out of the sky - a dive, or just down

// (흑기사 린다메아's skills, by name - Korean, Japanese, Chinese, English)
const LINDA = [
  [/관통창|貫通槍|贯通枪|piercing lance/i, 'lance'],
  [/허공창|虚空槍|虚空枪|void lance/i, 'void'],
  [/^형벌|^刑罰|^刑罚|^punishment/i, 'punish'],
  [/흑사광|黒死光|黑死光|black death light/i, 'blackLight'],
  [/검은 제재|검은 극형|黒の制裁|黒の極刑|黑之制裁|黑之极刑|black sanction|black execution/i, 'sanction'],
  [/노아의 묵시록|ノアの黙示録|诺亚的启示录|apocalypse of noah|noah'?s apocalypse/i, 'noah'],
];
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();

export const bossMoves = {
  // ---- which move a skill is ----------------------------------------------------------------------------------------
  // (before combat.js's own rules: 린다메아's, and a leap over the player - a skill on itself, no harm)
  specialFamily(s) {
    const name = (s.name || '').trim(), text = `${name} ${s.message1 || ''}`;
    if (s.scope === 11 && /흑의를 펼치고|날아올랐|飛び上が|舞い上が|飛翔|腾空|\b(?:soar|flew up|took to the air)/i.test(text)) return 'cloakLeap';
    const linda = LINDA.find(([re]) => re.test(name))?.[1];
    if (!linda || !(s.scope >= 1 && s.scope <= 6)) return undefined;
    return { lance: 'blinkChain', void: 'lattice', punish: 'stripes', blackLight: 'starSpin', sanction: 'blinkChain', noah: 'farOrb' }[linda];
  },
  lindaKind(s) {
    if (s._linda === undefined) s._linda = LINDA.find(([re]) => re.test((s.name || '').trim()))?.[1] || null;
    return s._linda;
  },
  // (after combat.js's moves by name - a charge, a leap, a breath... - and before its catch-alls by kind)
  newFamily(s, text, anim, style, hits, atk, magic) {
    const many = s.scope >= 2 && s.scope <= 6;
    // a beam at one: a beam through the boss sweeping round (a star of two arms)
    if (s.scope === 1 && (/레이저|レーザー|激光|\blaser|광선|光線|光线|\bbeam\b/i.test(text) || /レーザー|ビーム/.test(anim))) return 'starSpin';
    // a beam, a net, a cage, gravity: a lattice round the player
    if (/격자|그물|網|ネット|\bnet\b|감옥|牢獄|監獄|\bprison|\bcage\b|철창|檻|그래비티|グラビティ|重力|\bgravity|레이저|レーザー|激光|\blaser|광선|光線|光线|\bbeam\b|거미줄|蜘蛛の巣|\bweb\b/i.test(text) || /グラビティ|レーザー|ビーム/.test(anim)) return 'lattice';
    // a storm, rays out from it, a constellation, a maelstrom - over all: a turning star
    if (many && (magic || s.hit_type === 0) && (/폭풍|스톰|ストーム|嵐|风暴|\bstorm|방사|放射|辐射|\bradia|별자리|星座|\bconstellation|대소용돌이|大渦|漩涡|\bmaelstrom|vortex/i.test(text) || /ストーム|大渦/.test(anim))) return 'starSpin';
    // rows of blades, of gusts, a punishment - over all, more than one blow: bands across the floor, by turns
    if (many && hits >= 2 && !magic && (/칼리버|カリバー|calibur|caliber|엣지|エッジ|\bedge\b|강풍|돌풍|질풍|突風|強風|疾風|狂风|\bgale|\bgust|앵화|桜花|樱花|혼 ?베기|魂刈|\breap/i.test(text) || /ゼクスカリバー|ブラッドエッジ/.test(anim))) return 'stripes';
    // a moon, a sun, something huge flung from afar
    if ((magic || (s.hit_type === 0 && !atk)) && (/다크 ?사이드 ?문|ダークサイドムーン|\bmoon\b|태양|太陽|太阳|\bsun\b|혜성|彗星|\bcomet|거대|대형|巨大|大型|\b(?:giant|huge|colossal)\b/i.test(text))) return 'farOrb';
    // a blade drawn from nowhere, a shadow that cuts from behind, a hunt: gone and there behind the player, three times
    if (style === 'melee' && !magic && (/거합|居合|居合斩|\biai|절영|絶影|绝影|순보|瞬歩|縮地|瞬步|잔상|残像|残影|암살|暗殺|暗杀|\bassassin|참극|惨劇|惨剧|헌트|ハント|\bhunt\b|난무|乱舞|\bmirage/i.test(text))) return 'blinkChain';
    return null;
  },

  // ---- does it fit now (combat.js bossMoveFits) ----------------------------------------------------------------------
  newMoveFits(e, fam, d, dx, dy) {
    const sees = () => lineOfSight(e.fx, e.fy, e.fx + dx, e.fy + dy, true);
    // (one that holds its place - floating, hanging on the stage - does none that takes it elsewhere)
    if (e.stationary && ['farOrb', 'blinkChain', 'cloakLeap'].includes(fam)) return false;
    switch (fam) {
      case 'farOrb': return d <= 22 && sees();
      case 'blinkChain': return d <= 18 && sees();
      case 'starSpin': return d <= 12 + (e.r || 0.4) * T;
      case 'lattice': return d <= 18 && sees();
      case 'stripes': return d <= 11;
      case 'cloakLeap': return d <= 16;
    }
    return undefined;
  },

  // ---- its area as it winds up (combat.js planBossMove) --------------------------------------------------------------
  planNewMove(e, fam, s, head, ep, base) {
    const hits = base.hits, certain = s.hit_type === 0, R = (e.r || 0.4) * T;
    const linda = this.lindaKind(s);
    switch (fam) {
      // the circle it will come down on, at the player's feet, following them until it locks a moment before
      case 'farOrb': {
        const grand = linda === 'noah';
        return { ...base, shape: 'circle', r: grand ? 6.2 : 3.6, cx: head.x, cz: head.z, ground: true, lockAt: 0.75, heavy: false, certain,
          tempo: 1.4, tmin: grand ? 3.0 : 2.4, tmax: grand ? 3.6 : 3.2 };
      }
      // nothing on the floor yet: it gathers itself, then goes (each cut's line is laid as it comes out - blinkStep)
      case 'blinkChain': {
        const heavy = linda === 'sanction' || this.isHeavySkill(s);
        return { ...base, shape: 'none', heavy, certain, blockable: !heavy && !certain, steps: 3, variant: linda === 'lance' ? 'lance' : heavy ? 'heavy' : 'line',
          tempo: 0.7, tmin: 0.55, tmax: 0.9 };
      }
      case 'starSpin': {
        // (a beam at one: two arms, one line through the boss, sweeping round faster)
        const beam = s.scope === 1;
        const n = beam ? 2 : linda === 'blackLight' ? 6 : THREE.MathUtils.clamp(4 + hits, 5, 8), L = R + (beam ? 15 : 13), fy = ep.y - (e.lift || 0);
        const spin = (Math.random() < 0.5 ? 1 : -1) * (beam ? 0.9 + Math.random() * 0.3 : 0.55 + Math.random() * 0.25), parts = [];
        // (the beam comes round from beside the player and sweeps on past them)
        const rot = beam ? Math.atan2(head.z - ep.z, head.x - ep.x) - Math.sign(spin) * 1.4 : Math.random() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
          const a = rot + i * Math.PI * 2 / n;
          parts.push({ shape: 'line', len: L, width: 1.8, x: ep.x, y: fy, z: ep.z, aim: a, aim0: a });
        }
        return { ...base, shape: 'multi', parts, gap: 0, spin, heavy: false, blockable: false, certain, cap: { left: hits }, tempo: 1.3, tmin: 2.2, tmax: 3.0 };
      }
      case 'lattice': {
        // centred near where the player stands (not always on a gap), turned to the boss
        const n = 4, sp = 4.2, W = 1.5, L = n * sp + 3, a = Math.atan2(head.z - ep.z, head.x - ep.x);
        const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
        const off = (Math.random() - 0.5) * sp, off2 = (Math.random() - 0.5) * sp;
        const cx = head.x + ux * off2 + vx * off, cz = head.z + uz * off2 + vz * off, parts = [];
        const floorY = (x, z) => G.floorAt(x / T - 0.5, z / T - 0.5);
        for (let k = 0; k < n; k++) {
          const o = (k - (n - 1) / 2) * sp;
          // along the boss's way first, across it a moment later
          const x1 = cx + vx * o - ux * L / 2, z1 = cz + vz * o - uz * L / 2;
          parts.push({ shape: 'line', len: L, width: W, x: x1, y: floorY(cx + vx * o, cz + vz * o), z: z1, aim: a, at: 0 });
          const x2 = cx + ux * o - vx * L / 2, z2 = cz + uz * o - vz * L / 2;
          parts.push({ shape: 'line', len: L, width: W, x: x2, y: floorY(cx + ux * o, cz + uz * o), z: z2, aim: a + Math.PI / 2, at: 0.6 });
        }
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, blockable: false, certain, cap: { left: Math.max(1, hits) }, tempo: 1.3, tmin: 2.0, tmax: 2.8 };
      }
      case 'stripes': {
        // bands across the boss's way to the player, the middle one through the boss: the even ones, the odd ones, the even ones
        const K = 4, W = 2.5, L = 26, gap = 0.75, a = Math.atan2(head.z - ep.z, head.x - ep.x);
        const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux, parts = [];
        const band = (k, at) => {
          const mx = ep.x + ux * k * W, mz = ep.z + uz * k * W;
          parts.push({ shape: 'line', len: L, width: W, x: mx - vx * L / 2, y: G.floorAt(mx / T - 0.5, mz / T - 0.5), z: mz - vz * L / 2, aim: a + Math.PI / 2, at });
        };
        for (let k = -K; k <= K; k += 2) band(k, 0);
        for (let k = -K + 1; k <= K; k += 2) band(k, gap);
        for (let k = -K; k <= K; k += 2) band(k, gap * 2);
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, blockable: false, certain, cap: { left: Math.max(1, hits) }, tempo: 1.1, tmin: 1.5, tmax: 2.2 };
      }
      case 'cloakLeap': return { ...base, shape: 'none', heavy: false, blockable: true, hits: 0, tempo: 0.6, tmin: 0.45, tmax: 0.7 };
    }
    return undefined;
  },

  // ---- as the wind-up goes (combat.js enemyAI 'windup', host only) ----------------------------------------------------
  // the far orb: it backs off the player, up into the air, while the orb swells before it
  newWindup(e, dt) {
    if (e.move !== 'farOrb' || e.puppet || !e.plan || e.sky) return;      // (up in the sky: it hurls it from there)
    const plan = e.plan;
    if (!plan.away) {
      const head = this.targetHead(e), ep = e.worldPos(new THREE.Vector3());
      const a = Math.atan2(ep.z - head.z, ep.x - head.x);
      const run = Math.max(0, this.clearRun(ep.x, ep.z, a, ep.y + 0.8, 8) - (e.r || 0.4) * T);
      plan.away = { x0: e.fx, y0: e.fy, x1: e.fx + Math.cos(a) * run / T, y1: e.fy + Math.sin(a) * run / T, t: 0 };
      G.audio?.playSe(G.seAt('Wind4', 80, 70), ep);
    }
    const w = plan.away;
    w.t += dt;
    const k = THREE.MathUtils.smootherstep(Math.min(1, w.t / 0.9), 0, 1);
    e.fx = w.x0 + (w.x1 - w.x0) * k; e.fy = w.y0 + (w.y1 - w.y0) * k;
    e.lift = (1.4 + (e.h || 1.8) * 0.35) * k;
  },

  // ---- it goes off (combat.js releaseBossMove) ------------------------------------------------------------------------
  releaseNewMove(e, fam, plan, s, ep) {
    const anim = s.animation_id > 0 ? s.animation_id : 0;
    switch (fam) {
      case 'farOrb': {
        // (its circle stays where it locked, full, under the orb's fall)
        e.marker?.setProgress(1);
        const from = (e.orb ? e.orb.position.clone() : ep.clone().setY(ep.y + (e.h || 1.8) * 0.75));
        const to = new THREE.Vector3(plan.cx, G.floorAt(plan.cx / T - 0.5, plan.cz / T - 0.5), plan.cz);
        const dur = THREE.MathUtils.clamp(from.distanceTo(to) / 16, 0.45, 0.95);
        e.state = 'act';
        e.act = { kind: 'farOrb', t: 0, dur, from, to, orb: e.orb || this.makeOrb(e, s, plan), lift: e.lift || 0 };
        e.orb = null;
        G.audio?.playSe(G.seAt('Magic4', 100, 70), from);
        G.audio?.playSe(G.seAt('Wind7', 80, 60), from);
        return true;
      }
      case 'blinkChain':
        // (a co-op guest's copy: the host says where it comes out and when it cuts - each cut's line comes as a mark of its
        // own (onTelegraph), each cut as a move going off (here): the cut along the line laid; the first, as it gathered
        // itself, has none)
        if (e.puppet) { if (plan.shape === 'line' || plan.shape === 'sector') this.blinkCut(e, plan, s); this.endMove(e, 0); return true; }
        e.state = 'act';
        e.act = { kind: 'blinkChain', t: 0, step: 0, phase: 'out', pt: 0, steps: plan.steps || 3, base: plan, allyHit: new Set() };
        return true;
      case 'cloakLeap': {
        this.applySkillToSelf(e, s);
        // (its skill's own animation and sound - 린다메아's cloak, 이디스's wings: 翼羽ばたき)
        if (s.animation_id > 0) G.screen.playAnimationOn(ep.clone().setY(ep.y + (e.h || 1.8) * 0.5), s.animation_id, { world: true, size: this.enemySize(e) });
        this.spawnGlow(ep.clone().setY(ep.y + (e.h || 1.8) * 0.4), { color: 0x2a1030, size: (e.h || 1.8) * 1.4, life: 0.4, grow: 1.6 });
        if (e.puppet) { this.endMove(e, 0); return true; }
        // straight up, out of sight at once (the form the original turns it into then takes over up there - skyHold)
        e.state = 'act';
        e.act = { kind: 'cloakLeap', t: 0, phase: 'up' };
        return true;
      }
      case 'starSpin': case 'lattice': case 'stripes':
        // (the parts land in their own time: combat.js updateMulti / landNewPart)
        G.audio?.playSe(G.seAt(fam === 'lattice' ? 'Thunder3' : fam === 'starSpin' ? 'Wind7' : 'Sword4', 90, fam === 'starSpin' ? 80 : 100), ep);
        if (anim && fam === 'starSpin') G.screen.playAnimationOn(ep.clone().setY(ep.y + (e.h || 1.8) * 0.5), anim, { world: true, size: this.enemySize(e) * 1.3 });
        return false;
    }
    return false;
  },

  // ---- going on (combat.js updateBossAct) -----------------------------------------------------------------------------
  updateNewAct(e, a, plan, s, dt) {
    switch (a.kind) {
      case 'farOrb': {
        const k = Math.min(1, a.t / a.dur);
        // a low arc down onto the circle
        if (!a.burst && a.orb) {
          const p = tmpV.copy(a.from).lerp(a.to, k);
          p.y += Math.sin(k * Math.PI) * 1.2 + (1 - k) * 0.4;
          a.orb.position.copy(p);
          a.orb.rotation.y += dt * 3;
        }
        // (it sinks back down as the orb goes, and lands as it bursts - one up in the sky stays up there)
        if (!e.puppet && !e.sky) e.lift = a.lift * (1 - k * 0.5) * (a.burst ? Math.max(0, 1 - (a.t - a.dur) / 0.5) : 1);
        if (k >= 1 && !a.burst) { a.burst = true; this.orbBurst(e, plan, s, a); }
        if (a.burst && a.t >= a.dur + 0.5) { if (!e.puppet && !e.sky) e.lift = 0; this.endMove(e, 1.0); }
        return true;
      }
      case 'blinkChain': this.updateBlinkChain(e, a, s, dt); return true;
      case 'cloakLeap': {
        // up: as fast as it springs into the sky (skyHold); then it waits up there a moment for the form it changes into
        if (a.phase === 'up') {
          e.lift = Math.min(SKY_LIFT, (e.lift || 0) + CLOAK_RISE * dt);
          if (e.lift < SKY_SEEN && ((a.trail -= dt) <= 0 || a.trail === undefined)) {
            a.trail = 0.04;
            const p = e.worldPos(new THREE.Vector3()); p.y += (e.h || 1.8) * 0.5;
            this.spawnGlow(p, { color: 0x301040, size: (e.h || 1.8) * 0.9, life: 0.35, grow: 1.3 });
          }
          if (a.t < 1.4) return true;
          // (none came: down behind the player - as they look - or past them, the other side)
          const pc = G.map.playerChar, head = this.targetHead(e);
          const tx = head.x / T - 0.5, ty = head.z / T - 0.5, away = Math.atan2(ty - e.fy, tx - e.fx);
          let to = [e.fx, e.fy];
          for (const da of [0, 0.5, -0.5, 1, -1]) {
            const d = (3 + Math.random()) / T, x = tx + Math.cos(away + da) * d, y = ty + Math.sin(away + da) * d;
            if (G.map.grid.valid(Math.round(x), Math.round(y)) && G.map.walkable(Math.round(x), Math.round(y)) && lineOfSight(pc.fx, pc.fy, x, y)) { to = [x, y]; break; }
          }
          Object.assign(a, { phase: 'down', t: 0, dur: Math.max(0.1, (e.lift || 0) / SKY_DROP), x0: e.fx, y0: e.fy, x1: to[0], y1: to[1], H: e.lift });
          return true;
        }
        const k = Math.min(1, a.t / a.dur), h = THREE.MathUtils.smootherstep(k, 0, 1);
        e.fx = a.x0 + (a.x1 - a.x0) * h; e.fy = a.y0 + (a.y1 - a.y0) * h;
        e.lift = a.H * (1 - k * k);
        if (k >= 1) {
          e.lift = 0; e.bodyT = { kind: 'land', t0: G.time };
          const at = e.worldPos(new THREE.Vector3());
          G.audio?.playSe(G.seAt('Earth2', 80, 110), at);
          this.spawnGlow(at.clone().setY(at.y + 0.15), { color: 0x403048, size: 2.2, life: 0.35, grow: 1.3 });
          e.quick = true;                                   // (it goes on at once)
          this.endMove(e, 0.2);
        }
        return true;
      }
    }
    return false;
  },

  // ---- the far orb ----------------------------------------------------------------------------------------------------
  makeOrb(e, s, plan) {
    const color = new THREE.Color(this.lindaKind(s) === 'noah' ? 0x40104a : this.skillColor(s));
    const R = this.lindaKind(s) === 'noah' ? 1.5 : 0.9;
    const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.62, 24, 16), new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), toneMapped: false }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    core.add(halo);
    core.userData.transient = true;
    core.scale.setScalar(0.05);
    this.root.add(core);
    return core;
  },
  // (as it winds up: the orb swells before it - combat.js bossBody)
  growOrb(e, k) {
    if (!e.orb) { if (k > 0.02 && e.alive && e.state === 'windup') e.orb = this.makeOrb(e, e.skill, e.plan); else return; }
    const wp = e.worldPos(new THREE.Vector3()), head = G.player.headWorld(new THREE.Vector3());
    const dx = head.x - wp.x, dz = head.z - wp.z, l = Math.hypot(dx, dz) || 1;
    e.orb.position.set(wp.x + dx / l * ((e.r || 0.4) * T + 0.9), wp.y + (e.h || 1.8) * 0.75 + Math.sin(G.time * 3) * 0.08, wp.z + dz / l * ((e.r || 0.4) * T + 0.9));
    e.orb.scale.setScalar(Math.max(0.05, k * (1 + 0.06 * Math.sin(G.time * 11))));
    e.orb.rotation.y += 0.05;
    if (Math.random() < 0.35) {
      const p = e.orb.position, a = Math.random() * Math.PI * 2, r = 1.6 + Math.random();
      this.spawnGlow(new THREE.Vector3(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.5) * 1.2, p.z + Math.sin(a) * r),
        { color: this.skillColor(e.skill), size: 0.2, life: 0.4, grow: 0.3, vel: new THREE.Vector3(-Math.cos(a) * 3.5, 0, -Math.sin(a) * 3.5), grav: 0 });
    }
  },
  dropOrb(e) {
    if (!e.orb) return;
    this.root.remove(e.orb);
    e.orb.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    e.orb = null;
  },
  orbBurst(e, plan, s, a) {
    const at = a.to;
    this.root.remove(a.orb);
    a.orb.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    if (s.animation_id > 0) G.screen.playAnimationOn(at.clone().setY(at.y + 1), s.animation_id, { world: true, size: Math.min(7, plan.r * 1.6) });
    this.spawnGlow(at.clone().setY(at.y + 0.6), { color: this.skillColor(s), size: plan.r * 2.4, life: 0.45, grow: 1.25 });
    this.spawnRing(at, plan.r, this.skillColor(s));
    G.audio?.playSe(G.seAt('Explosion3', 100, 70), at);
    G.audio?.playSe(G.seAt('Earth4', 90, 70), at);
    const head = G.player.headWorld(new THREE.Vector3());
    if (Math.hypot(head.x - at.x, head.z - at.z) < plan.r + 4) G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 0.6);
    if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, plan.certain, this.parryable(plan));
    this.strikeAlliesInPlan(e, s, plan, plan.hits);
    this.dropMarker(e);
  },

  // ---- the blink chain ------------------------------------------------------------------------------------------------
  // where it comes out: behind the player as they look (or behind one it goes for, seen from the boss), else beside them.
  // 흑기사 린다메아 (compass): east, west, south or north of the one she goes for - which, at random each time (one that
  // has no floor or is cut off by a wall left out)
  blinkSpot(e, compass = false) {
    const tg = e.tgt?.stands && e.tgt.alive ? e.tgt : null;
    const pc = G.map.playerChar, at = tg ? [tg.fx, tg.fy] : [pc.fx, pc.fy];
    let ways;
    if (compass) {
      ways = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      for (let i = ways.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ways[i], ways[j]] = [ways[j], ways[i]]; }
    } else {
      let back;
      if (tg) back = Math.atan2(at[1] - e.fy, at[0] - e.fx);
      else { const f = G.player.forward2D(); back = Math.atan2(-f.z, -f.x); }
      ways = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4].map(da => back + da);
    }
    for (const a of ways) {
      const d = (BLINK_D[0] + Math.random() * (BLINK_D[1] - BLINK_D[0])) / T;
      const x = at[0] + Math.cos(a) * d, y = at[1] + Math.sin(a) * d;
      const tx = Math.round(x), ty = Math.round(y);
      if (!G.map.grid.valid(tx, ty) || !G.map.walkable(tx, ty) || !lineOfSight(at[0], at[1], x, y)) continue;
      return [x, y];
    }
    return null;
  },
  // a cut's mark, laid from where it came out through the player: a line (a sanction: a wide cut in front of it)
  blinkStepPlan(e, base) {
    const ep = e.worldPos(new THREE.Vector3()), head = this.targetHead(e);
    const aim = Math.atan2(head.z - ep.z, head.x - ep.x), d = Math.hypot(head.x - ep.x, head.z - ep.z);
    const p = { hits: 1, heavy: base.heavy, blockable: base.blockable, certain: base.certain, move: 'blinkChain', mult: (base.hits || 1) / (base.steps || 3) };
    if (base.variant === 'heavy') Object.assign(p, { shape: 'sector', r: (e.r || 0.4) * T + 4.6, half: 1.25 });
    else {
      // (the lance runs on far past the player - up to a wall - and it charges all of it)
      const far = d + (base.variant === 'lance' ? LANCE_ON : 3.5);
      const len = Math.min(this.clearRun(ep.x, ep.z, aim, ep.y - (e.lift || 0) + 0.8, far), this.walkRun(e, aim, far));
      Object.assign(p, { shape: 'line', len, full: len, width: base.variant === 'lance' ? 1.1 : 1.4 });
    }
    p.ox = ep.x; p.oy = ep.y - (e.lift || 0); p.oz = ep.z; p.aim = aim;
    return p;
  },
  updateBlinkChain(e, a, s, dt) {
    a.pt += dt;
    switch (a.phase) {
      case 'out': {
        // gone (a dark flicker), and there
        const from = e.worldPos(new THREE.Vector3());
        const to = this.blinkSpot(e, !!this.lindaKind(s));
        if (!to) { this.endMove(e, 0.6); return; }
        this.spawnGlow(from.setY(from.y + (e.h || 1.8) * 0.5), { color: this.lindaKind(s) ? 0x200818 : 0xc8c8ff, size: e.h || 1.8, life: 0.25, grow: 1.4 });
        e.fx = to[0]; e.fy = to[1]; e.lastFx = undefined;
        e.blinkAt = G.time;
        const at = e.worldPos(new THREE.Vector3());
        this.spawnGlow(at.setY(at.y + (e.h || 1.8) * 0.5), { color: this.lindaKind(s) ? 0x200818 : 0xc8c8ff, size: e.h || 1.8, life: 0.3, grow: 0.8 });
        G.audio?.playSe(G.seAt('Evasion1', 90, 80 + a.step * 10), at);
        // its mark, and how long it fills (the first one a little longer)
        e.plan = this.blinkStepPlan(e, a.base);
        e.plan.t0 = (a.step ? 0.55 : 0.8) / this.duelPace(e);
        this.dropMarker(e);
        e.marker = new FloorMarker(this.root, { ...e.plan, ...this.markLook(e.plan) });
        e.marker.setPose(e.plan.ox, e.plan.oy, e.plan.oz, e.plan.aim);
        e.marker.setProgress(0);
        e.timer0 = e.plan.t0; e.aim = e.plan.aim;
        G.coop?.onTelegraph?.(e);
        if (this.unguardable(e.plan)) G.audio?.playSe(G.seAt('Darkness3', 60, 150), at);
        a.phase = 'aim'; a.pt = 0;
        return;
      }
      case 'aim':
        e.marker?.setProgress(a.pt / e.plan.t0);
        if (e.marker && this.unguardable(e.plan)) e.marker.edgeMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(G.time * 9));
        if (a.pt < e.plan.t0) return;
        G.coop?.onBossMove?.(e);
        this.blinkCut(e, e.plan, s);
        a.phase = 'cut'; a.pt = 0;
        return;
      case 'cut': {
        // the dash along its line (a sanction stays where it cut)
        const plan = e.plan;
        if (plan.shape === 'line' && !a.dashed) {
          a.dashed = true;
          a.dash = { x0: e.fx, y0: e.fy, L: Math.max(0.3, plan.len - (e.r || 0.4) * T * 0.5) / T, dur: Math.max(0.1, plan.len / DASH_SPEED / this.duelPace(e)), ca: Math.cos(plan.aim), sa: Math.sin(plan.aim) };
        }
        if (a.dash) {
          const k = Math.min(1, a.pt / a.dash.dur);
          e.fx = a.dash.x0 + a.dash.ca * a.dash.L * k; e.fy = a.dash.y0 + a.dash.sa * a.dash.L * k;
          if (k < 1) return;
          a.dash = null;
        }
        if (a.pt < 0.18 / this.duelPace(e)) return;
        a.step++; a.dashed = false;
        this.dropMarker(e);
        if (a.step >= a.steps) { this.endMove(e, 0.9); return; }
        a.phase = 'out'; a.pt = 0;
        return;
      }
    }
  },
  // a cut: whoever is in its mark is struck once (a share of the skill's blows: the three cuts together are the skill)
  blinkCut(e, plan, s) {
    const ep = e.worldPos(new THREE.Vector3()), y = ep.y + Math.min(1.2, (e.h || 1.8) * 0.5);
    const lance = plan.shape === 'line';
    const far = lance ? new THREE.Vector3(plan.ox + Math.cos(plan.aim) * plan.len, y, plan.oz + Math.sin(plan.aim) * plan.len) : null;
    if (lance) this.spawnTracer(new THREE.Vector3(plan.ox, y, plan.oz), far, this.lindaKind(s) ? 0xff2040 : 0xfff0c0);
    const mid = lance ? new THREE.Vector3(plan.ox + Math.cos(plan.aim) * plan.len * 0.5, y, plan.oz + Math.sin(plan.aim) * plan.len * 0.5)
      : new THREE.Vector3(ep.x + Math.cos(plan.aim) * 2, y, ep.z + Math.sin(plan.aim) * 2);
    if (s.animation_id > 0) G.screen.playAnimationOn(mid, s.animation_id, { world: true, size: lance ? 2 : 3.2 });
    G.audio?.playSe(G.seAt(lance ? 'Wind7' : 'Slash11', 100, lance ? 140 : 80), ep);
    e.bodyT = { kind: 'lunge', t0: G.time };
    if (this.playerInPlan(e, plan)) {
      for (let i = 0; i < (plan.hits || 1); i++) this.later(i * 140, () => this.enemyStrikePlayer(e, s, { blockable: plan.blockable, certain: plan.certain, parry: this.parryable(plan), mult: plan.mult || 1 }));
    }
    this.strikeAlliesInPlan(e, s, plan, 1);
  },

  // ---- the parts of a star, a lattice, bands (combat.js updateMulti / landPart) -----------------------------------------
  // a star's arms turn while it fills (and stop as it strikes)
  turnParts(e, plan, set, t) {
    if (!plan.spin) return;
    const tt = Math.min(t, plan.t0 || t);
    plan.parts.forEach((p, i) => {
      p.aim = (p.aim0 ?? p.aim) + plan.spin * tt;
      if (p.aim0 === undefined) p.aim0 = p.aim - plan.spin * tt;
      set?.list?.[i]?.setPose(p.x, p.y, p.z, p.aim);
    });
  },
  landNewPart(e, p) {
    const plan = e.plan, s = e.skill;
    if (!PART_MOVES.includes(plan?.move)) return false;
    const color = this.skillColor(s);
    // light along the beam / band where it comes down
    const n = Math.max(2, Math.round(p.len / 3.2));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, x = p.x + Math.cos(p.aim) * p.len * f, z = p.z + Math.sin(p.aim) * p.len * f;
      this.spawnGlow(new THREE.Vector3(x, p.y + 0.35, z), { color, size: Math.max(1.4, p.width * 1.2), life: 0.3, grow: 1.2 });
    }
    // (an animation where it lands - on the first of the parts that land together)
    if (s.animation_id > 0 && !plan.animAt?.[p.at ?? 0]) {
      (plan.animAt ||= {})[p.at ?? 0] = true;
      const x = p.x + Math.cos(p.aim) * p.len * 0.5, z = p.z + Math.sin(p.aim) * p.len * 0.5;
      G.screen.playAnimationOn(new THREE.Vector3(x, p.y + 0.8, z), s.animation_id, { world: true, size: 3 });
      G.audio?.playSe(G.seAt(plan.move === 'lattice' ? 'Thunder1' : 'Slash12', 80, 100), new THREE.Vector3(x, p.y + 1, z));
    }
    const head = G.player.headWorld(new THREE.Vector3());
    // (once for each wave the player is in - never more than the skill's blows)
    const wave = p.at ?? 0;
    if (plan.cap.left > 0 && !(plan.struckAt ||= new Set()).has(wave) && this.pointInPart(p, head, 0.38) && !this.outOfFight(e)) {
      plan.struckAt.add(wave); plan.cap.left--;
      this.enemyStrikePlayer(e, s, { blockable: false, certain: !!plan.certain, parry: this.parryable(plan) });
    }
    for (const al of this.allies.struckable()) {
      if (al.remote || (p.allyHit ||= new Set()).has(al)) continue;
      const ap = al.worldPos(new THREE.Vector3());
      if (this.pointInPart(p, ap, al.r)) { p.allyHit.add(al); this.hitAlly(al, e, s, 1); }
    }
    return true;
  },

  // ---- bodies as they wind up (combat.js bossBody) ---------------------------------------------------------------------
  newBody(e, fam, k, m, s, shake, glow, away) {
    const t = G.time, size = THREE.MathUtils.clamp((e.h || 1.8) / 1.8, 0.7, 2);
    switch (fam) {
      case 'farOrb':
        // floating up, the orb swelling before it
        m.position.y += Math.sin(t * 2.4) * 0.05 * size;
        glow(0.4 + 0.3 * k);
        this.growOrb(e, k);
        return true;
      case 'blinkChain':
        // gathering itself low, flickering dark
        s.y *= 1 - 0.1 * k; s.x *= 1 + 0.05 * k;
        e.mat.emissive.multiplyScalar(1 - 0.8 * k * Math.abs(Math.sin(t * 17)));
        if (k > 0.5) shake(0.01 + 0.02 * k);
        return true;
      case 'starSpin':
        m.position.y += 0.2 * size * k;
        m.rotation.z = Math.sin(t * 5) * 0.08 * k;
        s.multiplyScalar(1 + 0.05 * k);
        glow((0.45 + 0.25 * Math.sin(t * 9)) * k);
        return true;
      case 'lattice':
        s.y *= 1 + 0.08 * k;
        m.position.y += 0.15 * size * k;
        glow((0.5 + 0.3 * Math.sin(t * 12)) * k);
        if (k > 0.75) shake(0.015);
        return true;
      case 'stripes':
        s.y *= 1 + 0.1 * k; s.x *= 1 - 0.04 * k;
        m.position.y += 0.2 * size * k;
        shake(0.004 + 0.02 * k);
        glow(0.35 * k);
        return true;
      case 'cloakLeap':
        // the cloak spreading: wide and low
        s.x *= 1 + 0.25 * k; s.y *= 1 - 0.12 * k;
        away(0.1 * k);
        return true;
    }
    return false;
  },

  // ---- up in the sky ------------------------------------------------------------------------------------------------
  // A boss that changes into a form with no picture of its own (combat.js transformEnemy) is gone from the original's screen:
  // 흑기사 린다메아 and 잿빛 독수리 이디스 after their 뛰어넘기 (흑의를 펼치고 / 날개를 펴고 날아올랐다), 윈터벨의 바람 as it blows the
  // player up. Here it rises into the sky as the form it was, out of sight, and stays up there while it is that form - what it
  // does, it does from there (노아의 묵시록 falls from the sky, 이디스's 급강하 dives on the player: combat.js bossFamilyFor);
  // changed back, it comes down (the lift falls away as any lift does)
  skyHold(e, dt) {
    if (e.puppet || !e.alive || e.state === 'windup' || e.state === 'act') return;
    e.lift = Math.min(SKY_LIFT, (e.lift || 0) + (this.cloakLeaper(e) ? CLOAK_RISE : SKY_RISE) * dt);
    // (a dark trail as it rises out of sight)
    if (e.lift < SKY_SEEN && (e.skyTrail = (e.skyTrail || 0) - dt) <= 0) {
      e.skyTrail = 0.07;
      const p = e.worldPos(new THREE.Vector3()); p.y += (e.h || 1.8) * 0.5;
      this.spawnGlow(p, { color: 0x302038, size: (e.h || 1.8) * 0.8, life: 0.4, grow: 1.3 });
    }
    e.landing = true;
  },
  skyHidden(e) { return !!e.sky && (e.lift || 0) > SKY_SEEN; },
  // one that goes up with 뛰어넘기 - 흑기사 린다메아, 잿빛 독수리 이디스: its skills have one, or the form it looks as up in the
  // sky (lookAs) does
  cloakLeaper(e) {
    const id = e?.lookAs || e?.b?.enemyId;
    if (!id) return false;
    const memo = (this._cloakIds ||= new Map());
    if (!memo.has(id)) memo.set(id, !!$data.enemies[id]?.actions?.some(a => $data.skills[a.skill_id] && this.specialFamily($data.skills[a.skill_id]) === 'cloakLeap'));
    return memo.get(id);
  },
  // (combat.js) how fast one up in the sky comes down - a dive, or just down: 뛰어넘기's (CLOAK_RISE) as fast as it went up
  // (0: as any other)
  skyDrop(e) { return this.cloakLeaper(e) ? SKY_DROP : 0; },
  // back from the sky while still high up (combat.js transformEnemy: diving): its next blow - the one the original forces on it
  // then, 린다메아's 허공창 - comes down on the player as a dive from up there (combat.js updateLeap), its spot marked on the
  // floor at once; it hangs a moment and then is down all at once
  skyDive(e, dx, dy) {
    if (e.puppet || !e.alive) return false;
    // (only with the blow the original forces on it as it comes back - 린다메아's 허공창; changed back by anything else - her duel
    // beginning while she was up there, 윈터벨의 바람 coming back - it just comes down)
    if ((e.lift || 0) < 3 || !e.forcedSkill) { e.diving = false; return false; }
    e.skill = this.chooseAction(e);                        // (the forced one)
    e.pending = null;
    if (!e.skill) { e.diving = false; return false; }
    e.landing = false;
    this.startBossMove(e, 'leap', dx, dy);
    return true;
  },
  // down from the sky (changed back into a form with a picture): it lands hard. (One that came back up there and found nothing to
  // come down with - out of the fight, held - drops after a while)
  skyLand(e) {
    if (e.diving && e.state !== 'windup' && e.state !== 'act' && G.time - (e.divingAt || 0) > 3) e.diving = false;
    if (e.sky || e.diving || (e.lift || 0) > 0.05) return;
    e.landing = false;
    if (!e.alive || !e.mesh) return;
    const at = e.worldPos(new THREE.Vector3());
    e.bodyT = { kind: 'land', t0: G.time };
    G.audio?.playSe(G.seAt('Earth2', 90, 90), at);
    this.spawnGlow(at.clone().setY(at.y + 0.15), { color: 0x403048, size: 2.6, life: 0.4, grow: 1.4 });
  },

  // ---- a mount drawn in its rider's picture -------------------------------------------------------------------------
  // In the original a troop member with no picture of its own, standing in line with a pictured one inside its picture, is part
  // of that picture - 흑기사 린다메아's 준마, picked out of her picture as a target where its head is. Here it is no body of its
  // own: it is where she is and goes along with her - she with it while it is in the middle of a move (a charge, the cuts from
  // behind) -, they take turns (never both at once), and a blow is the horse's on its side of the picture, hers on the other
  // (partAt). It is let go as either falls or she changes into another form (she gets off the horse as it falls)
  // (where the mount stands across the rider's picture - -0.5 its left edge, 0.5 its right - by some troop that has both in
  // line, or null)
  mountAt(hid, rid, w) {
    const cache = this._mounts ||= new Map(), key = `${hid},${rid},${w}`;
    if (!cache.has(key)) {
      let at = null;
      for (const t of $data.troops || []) {
        const h = t?.members?.find(m => m.enemy_id === hid && !m.hidden), r = h && t.members.find(m => m.enemy_id === rid && !m.hidden);
        if (h && r && Math.abs(h.y - r.y) <= 8 && Math.abs(h.x - r.x) <= 0.3 * w) { at = (h.x - r.x) / w; break; }
      }
      cache.set(key, at);
    }
    return cache.get(key);
  },
  pairMounts(list) {
    const free = e => !e.pair && e.mesh && e.alive && !e.hidden && !e.sky && !e.lookAs && !e.inPlay;
    for (const h of list) {
      if (!free(h) || h.data?.battler_name) continue;
      const r = list.find(x => x !== h && free(x) && x.picW && x.data?.battler_name && !!x.puppet === !!h.puppet && (x.battle || null) === (h.battle || null) &&
        this.mountAt(h.b.enemyId, x.b.enemyId, x.picW) !== null);
      if (!r) continue;
      const at = this.mountAt(h.b.enemyId, r.b.enemyId, r.picW);
      const pr = { horse: h, rider: r, hid: h.b.enemyId, rid: r.b.enemyId, at };
      h.pair = r.pair = pr;
      // (one picture: as wide a reach for blows as it is drawn, the horse's body hers)
      r.hr = Math.max(r.hr, r.w * 0.46 / T);
      h.hr = r.hr; h.r = r.r; h.h = r.h; h.w = r.w;
      h.fx = r.fx; h.fy = r.fy;
      h.mesh.visible = false;
    }
  },
  unpairMount(pr) {
    const { horse: h, rider: r } = pr;
    if (h.pair === pr) h.pair = null;
    if (r.pair === pr) r.pair = null;
    if (h.mesh && h.alive) h.mesh.visible = true;
  },
  // the part of a shared picture a point is on: the mount's side of it (left of halfway between where the original puts the two),
  // or the rider's; anything else, itself
  partAt(e, p) {
    const pr = e.pair;
    if (!pr) return e;
    const r = pr.rider, wp = r.worldPos(tmpV), head = G.player.headWorld(tmpW);
    const dx = head.x - wp.x, dz = head.z - wp.z, l = Math.hypot(dx, dz) || 1;
    const u = ((p.x - wp.x) * dz - (p.z - wp.z) * dx) / l / (r.w || 1);     // (across the picture as it faces this player)
    return (pr.at < 0 ? u < pr.at / 2 : u > pr.at / 2) ? pr.horse : r;
  },
  // (enemyAI) the other part is in the middle of a move: this one waits
  mountWaits(e) {
    const pr = e.pair, o = pr.horse === e ? pr.rider : pr.horse;
    return o.alive && (o.state === 'windup' || o.state === 'act');
  },
  // every frame (combat.js updateEnemies): mounts found, let go, kept with their riders; the picture moves as whichever of the two
  // is winding up or striking does
  updateMounts(all, head) {
    if (all.some(e => !e.pair && e.mesh && e.alive && !e.hidden && !e.sky && !e.data?.battler_name)) this.pairMounts(all.filter(e => e.battle || e.puppet));
    const seen = new Set();
    for (const e of all) {
      const pr = e.pair;
      if (!pr || seen.has(pr)) continue;
      seen.add(pr);
      const { horse: h, rider: r } = pr;
      if (h.b.enemyId !== pr.hid || r.b.enemyId !== pr.rid || !h.alive || !r.alive || r.sky) { this.unpairMount(pr); continue; }
      const busy = x => x.state === 'windup' || x.state === 'act';
      const lead = busy(h) && !busy(r) ? h : r, other = lead === h ? r : h;
      other.fx = lead.fx; other.fy = lead.fy; other.lift = lead.lift;
      if (!r.mesh || !r.mat) continue;
      // the horse's moves show in her picture; a blow on the horse flashes it
      if (lead === h && h.boss && (h.move || h.bodyT)) {
        const wind = h.state === 'windup' ? Math.min(1, h.timer0 ? 1 - h.timer / h.timer0 : 0) : 0, fl = h.flash > 0 ? 0.9 : 0;
        r.mesh.scale.setScalar(1 + wind * 0.06);
        r.mat.emissive.setRGB(fl + wind * 0.6, fl, fl);
        const own = [h.mesh, h.mat];
        h.mesh = r.mesh; h.mat = r.mat;
        try { this.bossBody(h, wind, fl, head); } finally { [h.mesh, h.mat] = own; }
      } else if (h.flash > 0) { r.mat.emissive.r += 0.9; r.mat.emissive.g += 0.9; r.mat.emissive.b += 0.9; }
      // (its HP over its own part of the picture, a little under hers)
      if (h.bar && r.group.visible) {
        const wp = r.group.position, dx = head.x - wp.x, dz = head.z - wp.z, l = Math.hypot(dx, dz) || 1, off = pr.at * r.w;
        h.bar.position.set(dz / l * off, r.h + 0.02, -dx / l * off);
      }
    }
  },

  // ---- 윈터벨의 바람: blown up into the sky, and the fall ---------------------------------------------------------------
  // A skill that blows the target up (a state it gives) and drops it later (<遅延発動> the skill that takes that state away
  // and does a killing blow - 바람에 날리기 / 낙하): the state lifts the player up into the air (player.js liftUp), out of
  // reach there; the fall drops them hard, and its blow lands as they hit the ground - nothing to the Cheshire Cat's ring
  // (no damage from that element), death without it, as in the original.
  liftInfo() {
    if (this._lift) return this._lift;
    const states = new Set(), falls = new Set();
    for (const s of $data.skills || []) {
      if (!s) continue;
      const d = this.delayedData(s), later = d && $data.skills[d.id];
      if (!later) continue;
      const adds = (s.effects || []).filter(ef => ef.code === 21 && ef.data_id > 1).map(ef => ef.data_id);
      const takes = (later.effects || []).filter(ef => ef.code === 22).map(ef => ef.data_id);
      const big = +String(later.damage?.formula || '').trim() >= 1e6 || /落下/.test($data.animations?.[later.animation_id]?.name || '');
      const st = adds.find(id => takes.includes(id));
      if (st && big) { states.add(st); falls.add(later.id); }
    }
    return (this._lift = { states, falls });
  },
  // blown up: a gust round the player as they go up
  liftPlayer(e) {
    if (!G.player.liftUp?.(LIFT_TOP)) return;
    const head = G.player.headWorld(new THREE.Vector3());
    G.audio?.playSe(G.seAt('Wind4', 100, 70), head);
    G.audio?.playSe(G.seAt('Wind7', 80, 90), head);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      this.spawnGlow(new THREE.Vector3(head.x + Math.cos(a) * 1.1, head.y - 1.2, head.z + Math.sin(a) * 1.1),
        { color: 0xd8f0ff, size: 0.35, life: 0.9, grow: 1.4, vel: new THREE.Vector3(-Math.sin(a) * 2, 5, Math.cos(a) * 2), grav: 0 });
    }
    G.input.haptic('left', 0.6, 300); G.input.haptic('right', 0.6, 300);
  },
  // the fall due: down hard, the blow as they land (the state goes with it); not up there - with 강한 공격에 밀려남 off -
  // it lands where they stand
  liftFall(d) {
    const actor = G.state.party.leader(), info = this.liftInfo();
    const land = () => {
      for (const st of info.states) actor.removeState?.(st);
      const head = G.player.headWorld(new THREE.Vector3()), feet = new THREE.Vector3(head.x, G.floorAt(head.x / T - 0.5, head.z / T - 0.5), head.z);
      if (d.skill.animation_id > 0) G.screen.playAnimationOn(feet.clone().setY(feet.y + 0.6), d.skill.animation_id, { world: true, size: 2.2 });
      G.audio?.playSe(G.seAt('Earth4', 100, 70), feet);
      this.spawnGlow(feet.clone().setY(feet.y + 0.15), { color: 0xc8c0b0, size: 2.6, life: 0.4, grow: 1.4 });
      G.screen.hitShake(new THREE.Vector3(0, 0, 1), 0.8);
      G.input.haptic('left', 1, 260); G.input.haptic('right', 1, 260);
      if (!this.playerDead && d.e.alive) this.enemyStrikePlayer(d.e, d.skill, { blockable: false, certain: true, delayed: true });
    };
    if (G.player.aloft?.()) {
      G.audio?.playSe(G.seAt('Wind7', 100, 50));
      G.player.dropDown(land);
    } else land();
  },
};
