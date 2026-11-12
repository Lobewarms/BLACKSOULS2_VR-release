// What a shot looks like in flight (effects.js spawnProjectile - its style: shotStyleOf). A gun's round is a brass slug
// with a tracer streaking behind it, a thrown knife a turning blade - and a spell is what it is: its element, else the words
// of its animation and name. Fire: a flickering fireball shedding embers. Ice: a spinning crystal shard trailing frost.
// Thunder: a white-hot ball crackling with arcs. Dark: a void ringed with purple, wisps circling it, trailing smoke. Light:
// a radiant star. A soul arrow (ソウルの太矢): a bright dart with a comet's tail. Poison / acid: a wobbling green glob,
// dripping. Water: a droplet. Wind: spinning crescents. Blood, drain: a crimson orb, dripping. Earth: a tumbling rock.
// Anything else: an orb inside a turning rune circle. (Before, every one was the same small round ball.)
// A look is a group; its userData: animate(dt, p) each frame of the flight (flicker, spin, its trail - emit: the fights'
// own fading motes, effects.js spawnGlow), align (pointed along its way: -Z forward) and dispose(). tint: a colour with a
// meaning (an enemy's sure-hit shot: purple) over the look's own; scale: an enemy's shots are bigger, to be seen coming;
// busy(): many shots in the air - half the trail
import * as THREE from 'three';
import { $data } from '../data.js';

export const SHOT_STYLES = ['bullet', 'knife', 'fire', 'ice', 'thunder', 'dark', 'holy', 'soul', 'poison', 'water', 'wind', 'blood',
  'earth', 'arcane'];
// held ready in the hand (spells.js readyUsable - and another player's, coopavatar.js): the look it will fly in, this big, its
// streaks short (nothing streaking back up the arm), its trail shed from where the hand is (heldPoint) as the hand moves
export const HELD_SCALE = 0.8;
export function heldPoint(obj, into) {
  const p = into || { mesh: { position: new THREE.Vector3() }, vel: new THREE.Vector3() };
  obj.getWorldPosition(p.mesh.position);
  return p;
}

// ---- which look a skill's shot has (look: enemies.js skillLook - 'gun', 'knife'...) ----------------------------------------
const EL_STYLE = { 2: 'blood', 3: 'fire', 4: 'ice', 5: 'thunder', 10: 'dark', 11: 'blood', 12: 'fire', 15: 'thunder', 18: 'poison' };
const WORDS = [
  ['soul', /ソウル|太矢|소울|\bsoul/i],
  ['fire', /火|炎|焔|フレア|爆|燃|불꽃|화염|파이어|플레어|폭발|헬 ?브레스|\b(?:fire|flame|blaze|burn|flare|inferno)/i],
  ['ice', /氷|冷気|吹雪|凍|얼음|빙결|빙주|냉기|아이스|프로스트|블리자드|\b(?:ice|frost|freez|blizzard|glacia)/i],
  ['thunder', /雷|電|稲妻|번개|뇌격|뇌전|썬더|라이트닝|\b(?:thunder|lightning|spark)/i],
  ['poison', /毒|酸|독|황산|산성|\b(?:poison|venom|acid|toxic)/i],
  ['blood', /血|ブラッド|吸収|ドレイン|흡혈|피의|블러드|드레인|\b(?:blood|drain|vampir|leech)/i],
  ['dark', /闇|暗黒|黒|怨|呪|ゾンビ|死|어둠|암흑|검은|저주|원망|원한|다크|\b(?:dark|shadow|curse|doom|death)/i],
  ['holy', /光|聖|閃|天術|神聖|빛|신성|성스러|홀리|섬광|\b(?:light|holy|sacred|radian|divine)/i],
  ['water', /水|泡|流|물|거품|아쿠아|\b(?:water|bubble|aqua|wave)/i],
  ['wind', /風|嵐|ストーム|竜巻|바람|폭풍|선풍|\b(?:wind|storm|gale|tornado|cyclone)/i],
  ['earth', /岩|石|土|大地|砂|바위|돌|대지|\b(?:rock|stone|earth|boulder)/i],
];
export function shotStyleOf(skill, look = null) {
  if (look === 'gun') return 'bullet';
  if (look === 'knife') return 'knife';
  if (!skill) return 'arcane';
  if (skill._shotStyle) return skill._shotStyle;
  const anim = $data.animations?.[skill.animation_id]?.name || '';
  const text = `${anim} ${skill.name || ''}`;
  const el = skill.damage?.element_id | 0;
  let st = null;
  if (el === 9) st = WORDS[0][1].test(text) ? 'soul' : 'holy';             // (light: a soul arrow, else a star)
  else if (EL_STYLE[el]) st = EL_STYLE[el];
  else if (look === 'drain') st = 'blood';
  else if (look === 'death') st = 'dark';
  else for (const [s, re] of WORDS) if (re.test(text)) { st = s; break; }
  return (skill._shotStyle = st || 'arcane');
}

// ---- textures (drawn once) ------------------------------------------------------------------------------------------------
const TEX = {};
function canvasTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return (TEX[key] = new THREE.CanvasTexture(c));
}
// a soft round glow
const glowTex = () => canvasTex('glow', 64, 64, (g, n) => {
  const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, n, n);
});
// a four-rayed star (a glint, a sparkle)
const starTex = () => canvasTex('star', 64, 64, (g, n) => {
  const c = n / 2;
  const blob = (sx, sy, a) => {
    g.save(); g.translate(c, c); g.scale(sx, sy);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, c);
    r.addColorStop(0, `rgba(255,255,255,${a})`); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.beginPath(); g.arc(0, 0, c, 0, Math.PI * 2); g.fill(); g.restore();
  };
  g.globalCompositeOperation = 'lighter';
  blob(1, 0.07, 1); blob(0.07, 1, 1); blob(0.32, 0.32, 0.9);
});
// a ragged puff (a flame's tongue, smoke, dust): a glow broken up by soft noise
const puffTex = () => canvasTex('puff', 64, 64, (g, n) => {
  const R = 9, grid = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < R * R; i++) grid.push(rand());
  const at = (x, y) => grid[((y % R) + R) % R * R + ((x % R) + R) % R];
  const noise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const im = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x - n / 2) / (n / 2), dy = (y - n / 2) / (n / 2), d = Math.hypot(dx, dy);
    const nz = 0.55 * noise(x / 8, y / 8) + 0.45 * noise(x / 4 + 3, y / 4 + 5);
    const a = Math.max(0, 1 - d * (1.15 - 0.45 * nz)) ** 1.4;
    const k = (y * n + x) * 4;
    im.data[k] = im.data[k + 1] = im.data[k + 2] = 255; im.data[k + 3] = Math.round(255 * Math.min(1, a * (0.6 + 0.6 * nz)));
  }
  g.putImageData(im, 0, 0);
});
// a streak, bright at its head (the top) fading down to nothing (a tracer, a dart's light)
const streakTex = () => canvasTex('streak', 16, 128, (g, w, h) => {
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.04, 'rgba(255,255,255,1)'); lg.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const side = g.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(255,255,255,0)'); side.addColorStop(0.5, 'rgba(255,255,255,1)'); side.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = side; g.fillRect(0, 0, w, h);
});
// a rune circle: two rings, a six-pointed star, marks round its band
const runeTex = () => canvasTex('rune', 128, 128, (g, n) => {
  const c = n / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 3;
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
  ring(60, 3); ring(48, 1.6); ring(22, 1.6);
  g.lineWidth = 1.6;
  for (const turn of [0, Math.PI / 3]) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) { const a = turn + i * (Math.PI * 2 / 3) - Math.PI / 2; const x = c + Math.cos(a) * 46, y = c + Math.sin(a) * 46; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // marks in the band between the rings (the same each time: a fixed little alphabet of strokes)
  const marks = [[[0, -3], [0, 3]], [[-2, -3], [2, 3]], [[-2, 3], [0, -3], [2, 3]], [[-2, -3], [2, -3], [0, 3]], [[-2, 0], [2, 0], [0, -3]], [[0, -3], [2, 0], [0, 3], [-2, 0], [0, -3]]];
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI * 2 / 16, m = marks[(i * 5) % marks.length];
    g.save(); g.translate(c + Math.cos(a) * 54, c + Math.sin(a) * 54); g.rotate(a + Math.PI / 2);
    g.lineWidth = 1.3; g.beginPath(); m.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
  }
});

// ---- pieces -----------------------------------------------------------------------------------------------------------------
const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
const GEO = {};
const geo = (key, make) => GEO[key] || (GEO[key] = make());
const sprite = (map, color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, opacity, ...ADD }));
  s.scale.setScalar(size);
  return s;
};
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
// two crossed planes along its way, the streak's head at the shot and its tail back behind it (len m)
function crossStreak(len, width, color, opacity) {
  const g = new THREE.Group();
  const shape = geo(`streak${len.toFixed(3)}x${width.toFixed(3)}`, () => {
    const x = new THREE.PlaneGeometry(width, len);
    x.rotateX(-Math.PI / 2);                  // (its top - the texture's head - forward, -Z)
    x.translate(0, 0, len / 2);               // (the head at the shot, the tail behind)
    return x;
  });
  for (const r of [0, Math.PI / 2]) {
    const m = new THREE.Mesh(shape, basic(color, { map: streakTex(), opacity, side: THREE.DoubleSide, ...ADD }));
    m.rotation.z = r;
    g.add(m);
  }
  return g;
}

// ---- a look ---------------------------------------------------------------------------------------------------------------
export function makeShotLook(style, { tint = null, scale = 1, bright = 1, held = false, emit = () => {}, busy = () => false } = {}) {
  const g = new THREE.Group();
  const ud = g.userData;
  ud.style = style; ud.t = 0; ud.ph = Math.random() * Math.PI * 2;
  const acc = {};
  const own = [];                                          // (geometries of this one alone)
  ud.dispose = () => { const ms = new Set(); g.traverse(o => o.material && ms.add(o.material)); for (const m of ms) m.dispose(); for (const x of own) x.dispose(); };
  const k = scale;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const every = (key, rate, dt, fn) => {
    acc[key] = (acc[key] || 0) + dt * (busy() ? rate * 0.5 : rate);
    while (acc[key] >= 1) { acc[key] -= 1; fn(); }
  };
  const tmp = new THREE.Vector3();
  // a point on its way: back m behind it, scattered within jit
  const at = (p, back = 0, jit = 0) => {
    tmp.copy(p.vel);
    if (tmp.lengthSq() > 1e-8) tmp.normalize();
    return p.mesh.position.clone().addScaledVector(tmp, -back).add(new THREE.Vector3(rnd(-jit, jit), rnd(-jit, jit), rnd(-jit, jit)));
  };
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const tintC = tint != null ? new THREE.Color(tint) : null;
  const col = c => (tintC ? tintC.clone() : new THREE.Color(c));
  const white = () => new THREE.Color(0xffffff);
  ud.animate = () => {};
  switch (style) {
    case 'bullet': {
      ud.align = true;
      const slug = new THREE.Mesh(geo('slug', () => { const x = new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8); x.rotateX(Math.PI / 2); return x; }), basic(0xc8a040));
      slug.scale.setScalar(k);
      const hot = sprite(glowTex(), new THREE.Color(0xfff2d0), 0.07 * k);
      const tracer = crossStreak((held ? 0.15 : 0.9) * k, 0.05 * k, col(0xffd890), 0.9);
      g.add(tracer, slug, hot);
      ud.animate = dt => { ud.t += dt; tracer.scale.z = Math.min(1, ud.t / 0.08); hot.material.opacity = rnd(0.75, 1); };
      break;
    }
    case 'knife': {
      ud.align = true;
      const roll = new THREE.Group();
      const blade = new THREE.Mesh(geo('blade', () => { const x = new THREE.OctahedronGeometry(1, 0); x.scale(0.018, 0.005, 0.11); x.translate(0, 0, -0.04); return x; }), basic(0xdfe4ea));
      const hilt = new THREE.Mesh(geo('hilt', () => { const x = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6); x.rotateX(Math.PI / 2); x.translate(0, 0, 0.07); return x; }), basic(0x3a2a1c));
      roll.add(blade, hilt); roll.scale.setScalar(k);
      const glint = sprite(starTex(), white(), 0.1 * k, 0.7);
      const trail = crossStreak((held ? 0.1 : 0.5) * k, 0.03 * k, col(0xfff0c0), 0.5);
      g.add(trail, roll, glint);
      ud.animate = dt => {
        ud.t += dt; roll.rotation.z += dt * 10; trail.scale.z = Math.min(1, ud.t / 0.08);
        glint.material.rotation += dt * 6; glint.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(ud.t * 18));
      };
      break;
    }
    case 'fire': {
      const c = col(0xff7a28), hot = c.clone().lerp(new THREE.Color(0xffd060), 0.45);
      const halo = sprite(glowTex(), c.clone().multiplyScalar(0.7), 0.62 * k, 0.6);
      const outer = sprite(puffTex(), c, 0.36 * k, 0.8);
      const inner = sprite(puffTex(), hot, 0.28 * k, 0.95);
      const core = sprite(glowTex(), new THREE.Color(0xfff6d8), 0.13 * k);
      g.add(halo, outer, inner, core);
      ud.animate = (dt, p) => {
        ud.t += dt;
        inner.material.rotation += dt * 5; outer.material.rotation -= dt * 3.5;
        const fl = 0.85 + 0.2 * Math.sin(ud.t * 31 + ud.ph) * Math.sin(ud.t * 17 + 1);
        inner.scale.setScalar(0.28 * k * fl); outer.scale.setScalar(0.36 * k * (1.85 - fl));
        every('ember', 26, dt, () => emit(at(p, 0.05 * k, 0.1 * k), { color: Math.random() < 0.5 ? 0xffc050 : c, size: rnd(0.03, 0.07) * k, life: rnd(0.3, 0.6), grow: 0.4,
          vel: v(rnd(-0.4, 0.4), rnd(0.2, 0.9), rnd(-0.4, 0.4)), grav: -1.2 }));
        every('flame', 14, dt, () => emit(at(p, 0.1 * k, 0.05 * k), { map: puffTex(), color: c, size: rnd(0.16, 0.24) * k, life: 0.22, grow: 0.5, spin: rnd(-4, 4) }));
      };
      break;
    }
    case 'ice': {
      ud.align = true;
      const c = col(0x9fe8ff);
      const spin = new THREE.Group();
      const shardGeo = geo('shard', () => { const x = new THREE.OctahedronGeometry(1, 0); x.scale(0.05, 0.05, 0.22); return x; });
      const ice = basic(0xd8f6ff, { transparent: true, opacity: 0.88 });
      const shard = new THREE.Mesh(shardGeo, ice);
      const edges = new THREE.LineSegments(geo('shardEdges', () => new THREE.EdgesGeometry(shardGeo)), new THREE.LineBasicMaterial({ color: 0xffffff, ...ADD }));
      spin.add(shard, edges);
      for (const sd of [-1, 1]) {
        const s = new THREE.Mesh(shardGeo, ice);
        s.scale.set(0.45, 0.45, 0.5); s.position.set(0.035 * sd, 0.01, 0.07); s.rotation.y = 0.45 * sd;
        spin.add(s);
      }
      spin.scale.setScalar(k);
      const glow = sprite(glowTex(), c, 0.32 * k, 0.75);
      g.add(glow, spin);
      ud.animate = (dt, p) => {
        ud.t += dt; spin.rotation.z += dt * 5;
        every('frost', 22, dt, () => emit(at(p, 0.12 * k, 0.07 * k), { map: starTex(), color: 0xe8fbff, size: rnd(0.04, 0.07) * k, life: 0.55, grow: 0.3,
          vel: v(rnd(-0.25, 0.25), rnd(-0.1, 0.2), rnd(-0.25, 0.25)), grav: 0.8, spin: rnd(-3, 3) }));
        every('mist', 8, dt, () => emit(at(p, 0.1 * k, 0.04 * k), { color: c, size: 0.18 * k, life: 0.35, grow: 1.8 }));
      };
      break;
    }
    case 'thunder': {
      const c = col(0xfff27a);
      const halo = sprite(glowTex(), c, 0.46 * k, 0.8);
      const core = sprite(glowTex(), white(), 0.16 * k);
      g.add(halo, core);
      const arcs = [];
      for (let i = 0; i < 3; i++) {
        const gm = new THREE.BufferGeometry();
        gm.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
        own.push(gm);
        const ln = new THREE.Line(gm, new THREE.LineBasicMaterial({ color: i ? c : 0xffffff, ...ADD }));
        ln.frustumCulled = false;
        g.add(ln); arcs.push(ln);
      }
      // (new arcs every few hundredths of a second: out from the core in a zigzag)
      const zap = () => {
        for (const ln of arcs) {
          const a = ln.geometry.attributes.position, d = v(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), len = rnd(0.16, 0.34) * k;
          for (let j = 0; j < 7; j++) {
            const f = j / 6, jit = j && j < 6 ? 0.05 * k : 0;
            a.setXYZ(j, d.x * len * f + rnd(-jit, jit), d.y * len * f + rnd(-jit, jit), d.z * len * f + rnd(-jit, jit));
          }
          a.needsUpdate = true;
        }
      };
      zap();
      let z = 0;
      ud.animate = (dt, p) => {
        ud.t += dt;
        if ((z += dt) > 0.045) { z = 0; zap(); }
        halo.material.opacity = rnd(0.55, 1); core.scale.setScalar(rnd(0.14, 0.19) * k);
        every('spark', 22, dt, () => emit(at(p, 0.05 * k, 0.12 * k), { map: starTex(), color: Math.random() < 0.5 ? 0xffffff : c, size: rnd(0.04, 0.08) * k,
          life: rnd(0.12, 0.25), grow: 0.3, vel: v(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)), grav: 0 }));
      };
      break;
    }
    case 'dark': {
      const c = col(0x9a4cff);
      const rim = sprite(glowTex(), c, 0.42 * k, 0.9);
      const hole = new THREE.Mesh(geo('ball', () => new THREE.SphereGeometry(1, 14, 10)), basic(0x07020c));
      hole.scale.setScalar(0.075 * k);
      const wisps = [0, 1, 2].map(() => sprite(glowTex(), c.clone().lerp(white(), 0.25), 0.09 * k));
      g.add(rim, hole, ...wisps);
      ud.animate = (dt, p) => {
        ud.t += dt;
        rim.material.opacity = 0.7 + 0.3 * Math.sin(ud.t * 9 + ud.ph);
        wisps.forEach((w, i) => { const a = ud.t * 6 + i * 2.09; w.position.set(Math.cos(a) * 0.13 * k, Math.sin(a) * 0.08 * k, Math.sin(a) * 0.1 * k); });
        every('smoke', 14, dt, () => emit(at(p, 0.08 * k, 0.05 * k), { map: puffTex(), normal: true, color: 0x14081e, opacity: 0.8, size: rnd(0.14, 0.22) * k, life: 0.55, grow: 2.2, spin: rnd(-2, 2) }));
        every('mote', 12, dt, () => emit(at(p, 0.05 * k, 0.12 * k), { color: c, size: rnd(0.04, 0.07) * k, life: 0.45, grow: 0.4, vel: v(rnd(-0.3, 0.3), rnd(-0.1, 0.4), rnd(-0.3, 0.3)), grav: -0.4 }));
      };
      break;
    }
    case 'holy': {
      const c = col(0xffe9a8);
      const halo = sprite(glowTex(), c, 0.42 * k, 0.7);
      const flare = sprite(starTex(), c.clone().lerp(white(), 0.3), 0.6 * k, 0.95);
      const core = sprite(glowTex(), white(), 0.15 * k);
      g.add(halo, flare, core);
      ud.animate = (dt, p) => {
        ud.t += dt; flare.material.rotation += dt * 1.5;
        flare.scale.setScalar((0.55 + 0.08 * Math.sin(ud.t * 14 + ud.ph)) * k);
        every('sparkle', 18, dt, () => emit(at(p, 0.06 * k, 0.14 * k), { map: starTex(), color: Math.random() < 0.5 ? 0xffffff : c, size: rnd(0.05, 0.09) * k, life: 0.45, grow: 0.3,
          vel: v(rnd(-0.2, 0.2), rnd(-0.2, 0.2), rnd(-0.2, 0.2)), grav: 0, spin: rnd(-2, 2) }));
      };
      break;
    }
    case 'soul': {
      ud.align = true;
      const c = col(0x9fd0ff);
      const halo = sprite(glowTex(), c, 0.36 * k, 0.75);
      const dart = crossStreak((held ? 0.16 : 0.55) * k, 0.09 * k, new THREE.Color(0xeaf6ff), 1);
      const head = sprite(glowTex(), white(), 0.16 * k);
      g.add(halo, dart, head);
      ud.animate = (dt, p) => {
        ud.t += dt; dart.scale.z = Math.min(1, ud.t / 0.1);
        every('tail', 45, dt, () => emit(at(p, 0.05 * k, 0.02 * k), { color: c, size: rnd(0.1, 0.14) * k, life: 0.35, grow: 0.25 }));
        every('glint', 10, dt, () => emit(at(p, 0.1 * k, 0.08 * k), { map: starTex(), color: 0xffffff, size: 0.06 * k, life: 0.3, grow: 0.3, spin: rnd(-3, 3) }));
      };
      break;
    }
    case 'poison': case 'water': {
      const water = style === 'water';
      const c = col(water ? 0x6ab8ff : 0x7bdc4a);
      const ball = geo('ball', () => new THREE.SphereGeometry(1, 14, 10));
      const blob = new THREE.Mesh(ball, basic(water ? 0xb8e2ff : 0x5fbf38, { transparent: true, opacity: 0.88 }));
      const glow = sprite(glowTex(), c, 0.34 * k, 0.75);
      const bubbles = [0, 1, 2].map(() => { const b = new THREE.Mesh(ball, basic(water ? 0xe8f6ff : 0xb8ff90, { transparent: true, opacity: 0.75 })); b.scale.setScalar(0.022 * k); return b; });
      g.add(glow, blob, ...bubbles);
      ud.animate = (dt, p) => {
        ud.t += dt;
        const w = water ? 0.07 : 0.12, t = ud.t + ud.ph;
        blob.scale.set(0.072 * k * (1 + w * Math.sin(t * 13)), 0.072 * k * (1 + w * Math.sin(t * 11 + 1)), 0.072 * k * (1 + w * Math.sin(t * 9 + 2)));
        bubbles.forEach((b, i) => { const a = t * (3 + i) + i * 2.1; b.position.set(Math.cos(a) * 0.09 * k, Math.sin(t * 5 + i) * 0.05 * k, Math.sin(a) * 0.09 * k); });
        every('drip', 16, dt, () => emit(at(p, 0.05 * k, 0.06 * k), { color: c, size: rnd(0.03, 0.06) * k, life: 0.6, grow: 0.6, vel: v(rnd(-0.3, 0.3), rnd(-0.2, 0.2), rnd(-0.3, 0.3)), grav: 6 }));
        every('mist', 8, dt, () => emit(at(p, 0.08 * k, 0.04 * k), { map: puffTex(), color: water ? 0x4a88c8 : 0x3a8a2a, size: 0.16 * k, life: 0.4, grow: 1.8, spin: rnd(-2, 2) }));
      };
      break;
    }
    case 'wind': {
      ud.align = true;
      const c = col(0xd8ffe8);
      const spin = new THREE.Group();
      const arc = geo('crescent', () => new THREE.RingGeometry(0.13, 0.2, 20, 1, 0, Math.PI * 1.25));
      for (const r of [0, Math.PI]) {
        const m = new THREE.Mesh(arc, basic(c, { opacity: 0.75, side: THREE.DoubleSide, ...ADD }));
        m.rotation.z = r;
        spin.add(m);
      }
      spin.scale.setScalar(k);
      const glow = sprite(glowTex(), c, 0.3 * k, 0.4);
      g.add(glow, spin);
      ud.animate = (dt, p) => {
        ud.t += dt; spin.rotation.z += dt * 18;
        every('gust', 14, dt, () => emit(at(p, 0.08 * k, 0.16 * k), { color: c, size: rnd(0.04, 0.07) * k, life: 0.3, grow: 0.5, vel: v(rnd(-0.6, 0.6), rnd(-0.3, 0.3), rnd(-0.6, 0.6)), grav: 0 }));
      };
      break;
    }
    case 'blood': {
      const c = col(0xd01830);
      const glow = sprite(glowTex(), c, 0.4 * k, 0.85);
      const orb = new THREE.Mesh(geo('ball', () => new THREE.SphereGeometry(1, 14, 10)), basic(0x5a0010));
      orb.scale.setScalar(0.068 * k);
      const shine = sprite(glowTex(), new THREE.Color(0xff6070), 0.1 * k);
      g.add(glow, orb, shine);
      ud.animate = (dt, p) => {
        ud.t += dt; glow.material.opacity = 0.7 + 0.25 * Math.sin(ud.t * 12 + ud.ph);
        every('drop', 18, dt, () => emit(at(p, 0.05 * k, 0.06 * k), { color: c, size: rnd(0.03, 0.06) * k, life: 0.5, grow: 0.6, vel: v(rnd(-0.2, 0.2), rnd(-0.1, 0.1), rnd(-0.2, 0.2)), grav: 7 }));
        every('mist', 6, dt, () => emit(at(p, 0.08 * k, 0.04 * k), { map: puffTex(), normal: true, color: 0x2a0008, opacity: 0.7, size: 0.15 * k, life: 0.4, grow: 1.8, spin: rnd(-2, 2) }));
      };
      break;
    }
    case 'earth': {
      const rock = new THREE.Mesh(geo('rock', () => new THREE.DodecahedronGeometry(1, 0)), new THREE.MeshLambertMaterial({ color: 0x8a6a48 }));
      rock.scale.set(0.08 * k, 0.068 * k, 0.09 * k);
      g.add(rock);
      if (tintC) g.add(sprite(glowTex(), tintC, 0.34 * k, 0.6));
      ud.animate = (dt, p) => {
        ud.t += dt; rock.rotation.x += dt * 7; rock.rotation.y += dt * 5;
        every('dust', 12, dt, () => emit(at(p, 0.08 * k, 0.05 * k), { map: puffTex(), normal: true, color: 0x6a5238, opacity: 0.7, size: 0.14 * k, life: 0.45, grow: 2, spin: rnd(-2, 2) }));
      };
      break;
    }
    default: {                                             // 'arcane': an orb inside a turning rune circle
      ud.align = true;                                     // (the circle faces along its way)
      const c = col(0xc070ff);
      const halo = sprite(glowTex(), c, 0.34 * k, 0.8);
      const core = sprite(glowTex(), white(), 0.12 * k);
      const plane = geo('runePlane', () => new THREE.PlaneGeometry(1, 1));
      const big = new THREE.Mesh(plane, basic(c, { map: runeTex(), opacity: 0.95, side: THREE.DoubleSide, ...ADD }));
      const small = new THREE.Mesh(plane, basic(c.clone().lerp(white(), 0.3), { map: runeTex(), opacity: 0.8, side: THREE.DoubleSide, ...ADD }));
      big.scale.setScalar(0.44 * k); small.scale.setScalar(0.27 * k); small.position.z = 0.05 * k;
      g.add(halo, big, small, core);
      ud.animate = (dt, p) => {
        ud.t += dt; big.rotation.z += dt * 3; small.rotation.z -= dt * 5;
        halo.material.opacity = 0.65 + 0.25 * Math.sin(ud.t * 10 + ud.ph);
        every('sparkle', 16, dt, () => emit(at(p, 0.06 * k, 0.16 * k), { map: starTex(), color: c, size: rnd(0.05, 0.08) * k, life: 0.5, grow: 0.3,
          vel: v(rnd(-0.2, 0.2), rnd(-0.2, 0.2), rnd(-0.2, 0.2)), grav: 0, spin: rnd(-3, 3) }));
        every('mote', 10, dt, () => emit(at(p, 0.05 * k, 0.05 * k), { color: c, size: 0.1 * k, life: 0.3, grow: 0.4 }));
      };
    }
  }
  // (its glows as bright as the effects are set to be - 이펙트 밝기)
  if (bright !== 1) g.traverse(o => { if (o.material?.blending === THREE.AdditiveBlending) o.material.color.multiplyScalar(bright); });
  return g;
}
