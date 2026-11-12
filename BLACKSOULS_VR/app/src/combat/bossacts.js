// A boss's own moves: its signature skills as moves of their own (charges, leaps, waves, rains, blink chains...), planned,
// telegraphed and played out.
import * as THREE from 'three';
import { lineOfSight } from '../collision.js';
import { $data } from '../data.js';
import { G } from '../globals.js';
import { T } from '../mapmesh.js';
import { FloorMarker, MARK } from '../telegraph.js';
import { BODY_R, BOSS_AREA, CHARGE_KNOCK, CHARGE_SPEED, LEAP_LAUNCH, PARRY_SLIDE, POOL, PURSUIT, SPIN_COIL, SPIN_TIME,
  firstContact, fxk, segDist, spinAngle, tmpColor, turnWidth } from './common.js';
import { shotStyleOf } from './shotlooks.js';
import { builtinRules } from '../maphints.js';

// (never made: its methods are CombatSystem's own - mixed into it in combat.js)
export class BossActPart {
  // ---- a boss's own moves ---------------------------------------------------------------------------
  // In a boss fight (isBossFight) the big ones use some of their skills as moves of their own, by what the
  // skill is - its name, its battle message, its animation, what it hits - with the skill's own damage,
  // effects and animation:
  //  charge  돌진, 태클, 몸통박치기, 달려들기, 일섬, a huge bite: a band from the boss toward the player, up to a
  //          wall; when it is full the boss runs its length and hits whoever is in the way
  //  leap    점프 베기, 프레스, 짓밟기, 낙하, 내리찍기: the boss crouches, springs up high and comes down on the
  //          circle marked where the player stood
  //  quake   땅울림, 충격파 / roar 포효, 울부짖기, 비명: a shockwave runs out across the floor from the boss -
  //          be beyond its edge, or roll through it as it passes
  //  fissure 땅을 가르다: the ground splits along a band toward the player
  //  breath  숨결, 브레스, 뿜다: a wide, long cone in front that keeps hitting while you stay in it
  //  spin    회전, 선풍: the boss whirls toward the player, hitting all around it
  //  rain    난사, 소나기, 유성, 벼락, spells on random targets: circles scattered around the player come down
  //          one after another
  //  volley  연사, 연발, 대포, shots with several hits: a fan of shots, a line each
  //  flurry  a melee skill with several hits: a string of quick blows, each laid down and aimed anew
  //  lunge   a boss with none of these: its heaviest blow comes with a short charge (a caster with no blow
  //          casts its strongest shot as a fan)
  // The pink ones (charge, leap, quake, roar, fissure, rain) no guard holds; no move hits more often than
  // its skill would. Between two moves a boss rests a few seconds (its other skills come as usual meanwhile).
  isBossFight(interp, troop) {
    // the troop's own battle events play music of their own (a boss's theme coming in with a phase: 목을
    // 사냥하는 비스트 starts as a small thing and turns into the beast to its own theme, 기사 펌프킨・오, 애벌레
    // 시샤, 재버워크, 란제리나... - 40 troops, every one a boss)
    if (troop?.pages?.some(p => p.list?.some(c => c.code === 241 || c.code === 132))) return true;
    // or the event chose a battle BGM of its own for this very fight, just before starting it - as most bosses
    // in the game do (music left over from an earlier fight does not count)
    const usual = $data.system.battle_bgm?.name;
    for (const it of [interp, interp?.root]) {
      const list = it?.list;
      if (!list) continue;
      for (let i = (it.index ?? 0) - 1; i >= 0; i--) {
        if (list[i]?.code !== 132) continue;
        const name = list[i].parameters[0]?.name || '';
        return !!name && name !== usual;
      }
    }
    return false;
  }
  skillHits(skill) { return THREE.MathUtils.clamp((skill.repeats || 1) * ({ 3: 1, 4: 2, 5: 3, 6: 4 }[skill.scope] || 1), 1, 6); }
  bossFamily(s) {
    if (s._bossFam !== undefined) return s._bossFam;
    // (흑기사 린다메아's own moves; a leap over the player in a cloak - bossmoves.js)
    const special = this.specialFamily(s);
    if (special !== undefined) return (s._bossFam = special);
    let f = null;
    if (s.scope >= 1 && s.scope <= 6 && (s.damage?.type === 1 || s.damage?.type === 5)) {
      const text = `${s.name} ${s.message1 || ''}`;
      const anim = $data.animations?.[s.animation_id]?.name || '';
      const style = this.skillStyle(s), hits = this.skillHits(s);
      const atk = +(/a\.atk\s*\*\s*([\d.]+)/.exec(s.damage.formula || '')?.[1] || 0);
      const magic = s.hit_type === 2;
      if (/돌진|달려\s?들|돌격|몸통박치기|태클|저돌|습보|전력투구|덤벼들|일섬|突進|突撃|突进|冲锋|冲撞|撞击|体当たり|タックル|飛びかか|襲いかか|一閃|一闪|\b(?:charg|rush|tackl|body ?slam|lung|pounc)/i.test(text) || /突進|体当たり|ぶちかまし/.test(anim)) f = 'charge';
      else if (/점프|뛰어\s?올라|도약|떠올라|날아올라|문설트|프레스|짓눌|짓밟|낙하|공중에서|내리찍|내려찍|ジャンプ|跳躍|跳跃|跳び|飛び上が|舞い上が|ムーンサルト|プレス|押し潰|踏みつけ|踏み潰|踩踏|践踏|落下|空中|叩きつけ|砸|\b(?:jump|leap|lept|press|stomp|trampl|plung|slam)/i.test(text) || /ムーンサルト|プレス|踏み/.test(anim)) f = 'leap';
      else if (/땅을 갈|대지를 가|지면을 가|균열|大地を割|地割れ|地裂|裂地|split the (?:ground|earth)|\bfissur/i.test(text)) f = 'fissure';
      else if (/땅울림|땅을 울|대지|충격파|지진|地響き|地鳴り|大地|衝撃波|冲击波|地震|地鸣|\b(?:quake|earthquake|shock ?wave|tremor)/i.test(text)) f = 'quake';
      else if (/포효|울부짖|외침|외쳤|절규|우렁찬|굉음|비명|소리를 질|咆哮|雄叫び|叫び|絶叫|吼え|悲鳴|怒吼|嚎叫|尖叫|\b(?:roar|howl|scream|shriek|bellow)/i.test(text) || /咆哮/.test(anim)) f = 'roar';
      else if (/숨결|브레스|숨을 내|내뿜|뿜어|뿜었|토해|내뱉|화염을 발사|ブレス|吐息|吐き|吐いた|噴き|吹き付け|喷吐|喷出|吐出|\b(?:breath|spit|spew|exhal|vomit)/i.test(text) || /^息/.test(anim)) f = 'breath';
      else if (/회전|선풍|회오리|소용돌이|휘몰아|回転|旋風|竜巻|渦|旋转|旋风|龙卷|\bspin(?:s|ning)?\b|\b(?:whirl|cyclon|tornado|vortex)/i.test(text)) f = 'spin';
      else if (/파도|해일|물결|웨이브|격류|급류|波|津波|激流|\b(?:wave|tide|tsunami|surge|torrent)/i.test(text)) f = 'wave';
      else if (/십자|크로스|오망성|육망성|クロス|十字|五芒|六芒|\b(?:cross|pentagram|hexagram)/i.test(text)) f = 'cross';
      else if (/덥석|움켜|붙잡|부여잡|구속|촉수|후크|갈고리|해초|껴안|휘감|掴|捕ま|触手|フック|拘束|抱き|絡め|\b(?:grab|seiz|grasp|clutch|tentacle|hook|embrac|entangl)/i.test(text) || /掴み|触手|捕食/.test(anim)) f = 'grab';
      else if (/물어|씹어|잡아먹|취식|포식|噛み|喰らい|食らい|捕食|撕咬|啃咬|吞食|\bbit(?:e|es|ing)\b|\b(?:devour|chomp)/i.test(text) && atk >= 10) f = 'charge';
      else if (/참수|처형|단두|길로틴|필살|목을 베|斬首|処刑|断頭|ギロチン|必殺|\b(?:behead|execut|decapitat|guillotin)/i.test(text)) f = 'execute';
      else if (/난사|소나기|화살 비|사우전드|サウザンド|\bthousand|유성|쏟아|흩뿌|사방으로|빗발|천둥|벼락|乱射|の雨|流星|降り注|撒き散|四方|雷|之雨|倾泻|\brain(?:s|fall)?\b|\b(?:barrage|meteor|shower|scatter|thunder|lightning)/i.test(text) && style !== 'melee') f = 'rain';
      else if (/연사|연발|연속투척|대령|대포|일제|連射|連発|連続投擲|大砲|一斉|连射|连发|大炮|齐射|\b(?:volley|rapid|salvo|cannon)/i.test(text)) f = 'volley';
      else if (s.scope !== 1 && (/안개|맹독|독가스|독 ?늪|늪을|역병|흑사|미아즈마|瘴|霧|猛毒|毒ガス|毒沼|疫|黒死|\b(?:fog|mist|poison|venom|miasma|swamp|plague|toxic)/i.test(text) ||
        (builtinRules() && (s.effects || []).some(ef => ef.code === 21 && (ef.data_id === 2 || ef.data_id === 3))))) f = 'field';
      else if (/찌르|찔러|찔렀|관통|꿰뚫|뚫기|창으로|레이피어|판트|부리|뿔|刺突|突き|貫|槍|レイピア|嘴|\b(?:thrust|pierc|stab|lance|impal|skewer|rapier|fente)/i.test(text) && style === 'melee' && s.scope === 1) f = 'thrust';
      else if (/후려|휩쓸|쓸어|베어 ?내|베어 ?넘|횡일|꼬리|사복검|채찍|薙|払|尻尾|鞭|蛇腹|横一|\b(?:sweep|swipe|tail|whip|mow|cleave|lash)/i.test(text) && !magic) f = 'sweep';
      // (a beam or a cage, a storm over all, rows of blades, a moon from afar, a cut from behind - bossmoves.js)
      else if ((f = this.newFamily(s, text, anim, style, hits, atk, magic))) { /* f */ }
      else if (style === 'projectile' && hits >= 2) f = s.scope === 1 ? 'volley' : 'rain';
      else if (style === 'area' && !atk && hits >= 2) f = 'rain';
      else if (style === 'melee' && atk && hits >= 2) f = 'flurry';
      // spells on one: shots that come round after the player (an arrow, an orb, a bubble), else eruptions under
      // them one after another; spells on all: a blast round the boss (or round it but not close in); a wide
      // physical blow on all: a sweep
      else if (magic && s.scope === 1) f = /화살|구슬|탄환|볼|구체|거품|矢|弾|玉|球|泡|\b(?:arrow|orb|ball|bolt|bullet|sphere|missile|bubble)/i.test(text) ? 'orbs' : 'pursuit';
      else if (magic && s.scope === 2) f = 'nova';
      else if (style === 'area' && s.hit_type === 1) f = !atk && /\ba\.mat\b/.test(s.damage.formula || '') ? 'nova' : 'sweep';
    }
    return (s._bossFam = f);
  }
  // a boss none of whose skills has a move of its own: its heaviest blow becomes a lunge; a caster with no blow
  // casts its strongest shot as a fan
  bossFallback(e) {
    const acts = (e.data.actions || []).map(a => $data.skills[a.skill_id]).filter(Boolean);
    if (acts.some(s => this.bossFamilyFor(e, s))) return;
    const k = (s, p) => +(new RegExp(`a\\.${p}\\s*\\*\\s*([\\d.]+)`).exec(s.damage?.formula || '')?.[1] || 0);
    const blow = acts.filter(s => this.skillStyle(s) === 'melee' && k(s, 'atk') > 0).sort((a, b) => k(b, 'atk') - k(a, 'atk'))[0];
    if (blow) { e.lungeSkill = blow.id; return; }
    const shot = acts.filter(s => this.skillStyle(s) === 'projectile' && s.scope === 1).sort((a, b) => k(b, 'mat') - k(a, 'mat'))[0];
    if (shot) e.volleySkill = shot.id;
  }
  bossFamilyFor(e, s) {
    if (!e.boss || !s) return null;
    // (up in the sky - bossmoves.js skyHold: a blow at one comes down on them from up there)
    if (e.sky && s.scope === 1 && this.skillStyle(s) === 'melee') return 'leap';
    // (a stage play's leads have their signature moves - src/theater.js)
    const play = G.theater?.familyOf?.(e, s);
    if (play !== undefined) return play;
    return this.bossFamily(s) || this.delayedFamily(s) || (s.id === e.lungeSkill ? 'lunge' : s.id === e.volleySkill ? 'volley' : null);
  }
  // A boss's body as its own moves wind up and go off. The body is a picture facing the player, so it shows by
  // leaning in its plane, squashing, stretching, rising, trembling and glowing:
  //  charge / lunge  stands its ground braced low, trembling harder and harder, scraping up dust
  //  leap            crouches deep, stretches as it springs up and as it drops, squashes as it lands
  //  quake / fissure rises tall, shaking, and comes down with a squash as the ground gives
  //  roar            swells up breathing in, shudders all over as it lets go
  //  breath          rears back swelling as it draws breath, glowing the colour of what it breathes; leans in
  //                  and quivers while it pours
  //  spin            rocks from side to side, faster and faster, then whirls
  //  rain / volley   lifts off the ground a little, swaying, glowing the colour of the spell
  //  flurry          bobs on its feet between the blows
  bossBody(e, k, fl, head) {
    const m = e.mesh, s = m.scale, t = G.time;
    const size = THREE.MathUtils.clamp((e.h || 1.8) / 1.8, 0.7, 2);
    const shake = amp => {
      const a = amp * size;
      m.position.x += Math.sin(t * 71 + e.fx * 13) * a;
      m.position.z += Math.cos(t * 63 + e.fy * 17) * a;
      m.position.y += Math.abs(Math.sin(t * 53)) * a * 0.5;
    };
    // (only a move of an element - fire, ice, thunder, light, dark, drain - glows its colour; the rest keep the
    // red of a wind-up)
    const glow = g => {
      if (![2, 3, 4, 5, 9, 10].includes(e.skill?.damage?.element_id)) return;
      const c = tmpColor.set(this.skillColor(e.skill));
      e.mat.emissive.setRGB(fl + c.r * g, fl + c.g * g, fl + c.b * g);
    };
    const away = (dist, sign = 1) => {
      const wp = e.group.position, dx = wp.x - head.x, dz = wp.z - head.z, l = Math.hypot(dx, dz) || 1;
      m.position.x += dx / l * dist * size * sign; m.position.z += dz / l * dist * size * sign;
    };
    const fam = e.move;
    if (fam && e.state === 'windup') {
      switch (fam) {
        case 'charge': case 'lunge':
          shake(0.008 + 0.05 * k * k);
          s.y *= 1 - 0.13 * k; s.x *= 1 + 0.06 * k;
          if (k > 0.3) this.bossDust(e);
          break;
        case 'leap':
          if (!e.plan?.jumped) {
            const c = Math.min(1, (e.timer0 - e.timer) / 0.35);
            s.y *= 1 - 0.2 * c; s.x *= 1 + 0.12 * c;
            shake(0.012 * c);
          } else {
            const el = e.timer0 - e.timer, crouch = Math.min(0.35, e.timer0 * 0.22);
            const q = THREE.MathUtils.clamp((el - crouch) / Math.max(0.1, e.timer0 - crouch), 0, 1);
            const str = q < 0.45 ? 1 - q / 0.45 : q > 0.78 ? (q - 0.78) / 0.22 : 0;
            s.y *= 1 + 0.16 * str; s.x *= 1 - 0.09 * str;
          }
          break;
        case 'quake': case 'fissure':
          s.y *= 1 + 0.12 * k; s.x *= 1 - 0.04 * k;
          m.position.y += 0.22 * size * k * k;
          shake(0.004 + 0.022 * k);
          break;
        case 'roar':
          s.multiplyScalar(1 + 0.1 * k + 0.025 * k * Math.sin(t * 7));
          if (k > 0.7) shake(0.03 * (k - 0.7) / 0.3);
          break;
        case 'breath':
          s.multiplyScalar(1 + 0.08 * k); s.y *= 1 + 0.04 * k;
          away(0.3 * k);
          glow(0.7 * k);
          break;
        case 'spin': {
          // coiling: it turns away (narrower and narrower, as a card turning), leans into the turn, sinks and draws
          // back a little; then holds it, trembling, and a blade glints as it is about to let go
          const c = THREE.MathUtils.smootherstep(Math.min(1, k / 0.7), 0, 1);
          s.x *= turnWidth(-SPIN_COIL * c);
          s.y *= 1 - 0.08 * c;
          m.rotation.z = 0.1 * c;
          away(0.12 * c);
          if (k > 0.7) shake(0.006 + 0.03 * (k - 0.7) / 0.3);
          if (k > 0.82 && !e.glinted) { e.glinted = true; this.spinGlint(e); }
          break;
        }
        case 'rain': case 'volley': case 'dice':
          m.position.y += 0.3 * size * k + Math.sin(t * 3) * 0.03 * k;
          m.rotation.z = Math.sin(t * 2.3) * 0.05 * k;
          glow((0.45 + 0.25 * Math.sin(t * 9)) * k);
          break;
        case 'thrust':
          // drawing back for the lance
          away(0.35 * k); s.x *= 1 - 0.08 * k; s.y *= 1 + 0.04 * k;
          if (k > 0.75) shake(0.012 + 0.03 * (k - 0.75) / 0.25);
          break;
        case 'grab':
          away(0.22 * k); s.x *= 1 + 0.1 * k;
          if (k > 0.7) shake(0.02 * (k - 0.7) / 0.3);
          break;
        case 'sweep':
          // wound back to one side
          m.rotation.z = -0.22 * k * (e.plan?.way || 1); away(0.12 * k); s.x *= 1 + 0.05 * k;
          if (k > 0.8) shake(0.02);
          break;
        case 'execute': case 'chess':
          // rising up high, trembling harder and harder
          m.position.y += 0.35 * size * k * k; s.y *= 1 + 0.14 * k; s.x *= 1 - 0.05 * k;
          shake(0.006 + 0.045 * k * k);
          break;
        case 'wave':
          away(0.25 * k); s.y *= 1 + 0.1 * k; s.x *= 1 + 0.04 * k;
          if (k > 0.7) shake(0.025 * (k - 0.7) / 0.3);
          break;
        case 'nova': case 'cross': case 'pursuit': case 'orbs': case 'field':
          m.position.y += 0.25 * size * k + Math.sin(t * 3) * 0.03 * k;
          s.multiplyScalar(1 + 0.06 * k);
          glow((0.45 + 0.25 * Math.sin(t * 9)) * k);
          break;
        case 'flurry':
          m.position.y += Math.abs(Math.sin(t * 9)) * 0.05 * size;
          m.rotation.z = Math.sin(t * 7) * 0.05;
          break;
        default: this.newBody(e, fam, k, m, s, shake, glow, away);       // (bossmoves.js)
      }
    } else if (fam && e.state === 'act') {
      const kind = e.act?.kind;
      if (kind === 'dash') { s.y *= 0.93; s.x *= 1.06; }
      else if (kind === 'breath') { away(0.15, -1); shake(0.01); glow(0.7); }
      else if (kind === 'spin') this.spinBody(e);
      else if (kind === 'rain' || kind === 'volley' || kind === 'pursuit' || kind === 'orbs' || kind === 'dice') { m.position.y += 0.3 * size; glow(0.5); }
      else if (kind === 'sweep') { m.rotation.z = 0.25 * (e.plan?.way || 1) * Math.sin(Math.min(1, e.act.t / 0.42) * Math.PI); away(0.1, -1); }
      else if (kind === 'grab') { away(0.25, -1); s.x *= 1.06; }
    }
    // just after a move: squashed by a landing or a stomp, shuddering after a roar
    const b = e.bodyT;
    if (b) {
      const a = (t - b.t0) / (b.kind === 'roar' ? 0.6 : 0.35);
      if (a >= 1 || !e.alive) e.bodyT = null;
      else if (b.kind === 'roar') { s.multiplyScalar(1 + 0.08 * (1 - a)); shake(0.03 * (1 - a)); }
      else { const q = Math.sin(a * Math.PI); s.y *= 1 - 0.2 * q; s.x *= 1 + 0.13 * q; }
    }
  }
  // the whirl: the picture turns round and round like a card (mirrored while its back is round), two fading
  // after-images a moment behind it
  spinBody(e) {
    const m = e.mesh, s = m.scale, t = e.act.t, sx = s.x;
    s.x = sx * turnWidth(spinAngle(t));
    if (!e.ghosts) {
      e.ghosts = [[0.035, 0.34], [0.07, 0.17]].map(([lag, opacity]) => {
        const mat = e.mat.clone();
        Object.assign(mat, { transparent: true, opacity, depthWrite: false, alphaTest: 0.01 });
        mat.emissive = new THREE.Color(0.3, 0.03, 0.03);
        const g = new THREE.Mesh(m.geometry, mat);
        e.group.add(g);
        return { g, lag };
      });
    }
    for (const gh of e.ghosts) {
      gh.g.visible = t > gh.lag && t < SPIN_TIME - 0.05;
      gh.g.position.copy(m.position);
      gh.g.rotation.copy(m.rotation);
      gh.g.scale.set(sx * turnWidth(spinAngle(t - gh.lag)), s.y, s.z);
    }
  }
  // the moment before a whirl: a blade glints at its chest, with the ring of steel
  spinGlint(e) {
    const p = e.worldPos(new THREE.Vector3()), head = G.player.headWorld(new THREE.Vector3());
    const d = new THREE.Vector3(head.x - p.x, 0, head.z - p.z);
    if (d.lengthSq() > 1e-6) d.normalize();
    const at = new THREE.Vector3(p.x + d.x * 0.3, p.y + (e.h || 1.8) * 0.6, p.z + d.z * 0.3);
    this.spawnGlow(at, { color: 0xffffff, size: 0.3, life: 0.3, grow: 3 });
    this.spawnGlow(at, { color: 0xfff2d0, size: 1.1, life: 0.14, grow: 1.4 });
    G.audio?.playSe(G.seAt('刀', 75, 125), at);
  }
  // a white slash trailing round a whirling boss at its waist, fading as it widens
  spawnSlashArc(e) {
    const geo = this._arcGeo || (this._arcGeo = new THREE.RingGeometry(0.86, 1, 32, 1, 0, 2.4));
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0f0).multiplyScalar(fxk()), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const arc = new THREE.Mesh(geo, mat);
    const p = e.worldPos(new THREE.Vector3()), r = THREE.MathUtils.clamp((e.r || 0.4) * T + 0.9, 1, 2.6);
    arc.position.set(p.x, p.y + (e.h || 1.8) * (0.32 + Math.random() * 0.26), p.z);
    arc.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2);
    arc.scale.setScalar(r);
    arc.renderOrder = 1400;
    this.root.add(arc);
    this.fx.push({ obj: arc, t: 0, life: 0.24, size: r, grow: 1.15 });
  }
  // dust kicked up at a boss's feet as it paws the ground before a charge, now and then with a scrape
  bossDust(e) {
    if (G.time < (e.dustAt || 0)) return;
    e.dustAt = G.time + 0.28 + Math.random() * 0.12;
    const p = e.worldPos(new THREE.Vector3());
    const a = Math.random() * Math.PI * 2, r = (e.w || 1) * 0.3;
    p.x += Math.cos(a) * r; p.z += Math.sin(a) * r; p.y += 0.1;
    this.spawnGlow(p, { color: 0xb8a890, size: 0.5 + 0.3 * Math.random(), life: 0.45, grow: 1.8, vel: new THREE.Vector3(0, 1.2, 0) });
    if (Math.random() < 0.5) G.audio?.playSe(G.seAt('足音・土', 45, 60 + Math.random() * 20), p);
  }
  // can that move start from here (d: metres to the player)
  bossMoveFits(e, fam, d, dx, dy, reach) {
    const ep = e.worldPos(new THREE.Vector3());
    const clear = max => d <= max && this.clearRun(ep.x, ep.z, Math.atan2(dy, dx), ep.y + 0.8, d) >= d - 0.3;
    // (no wall between it and the target - over a pillar it sees out of that block)
    const sees = () => lineOfSight(e.fx, e.fy, e.fx + dx, e.fy + dy, true);
    const nf = this.newMoveFits(e, fam, d, dx, dy);
    if (nf !== undefined) return nf;
    // (one that holds its place - floating, hanging - casts from wherever it is)
    if (e.stationary && !['charge', 'lunge', 'leap', 'flurry', 'thrust', 'grab', 'sweep', 'spin', 'execute', 'fissure'].includes(fam)) return d <= 22;
    switch (fam) {
      case 'dice': return d <= 15 && sees();
      case 'chess': return d <= 24;
      case 'charge': case 'fissure': return clear(16);
      case 'lunge': return clear(8);
      case 'leap': return d <= 14;
      case 'quake': return d <= 9 + e.r * T;
      case 'roar': return d <= 10;
      case 'breath': case 'spin': return d <= e.r * T + 7.5;
      case 'rain': case 'volley': return d <= 15 && sees();
      case 'flurry': return d < reach + 0.3;
      case 'thrust': return clear(e.r * T + 11);
      case 'grab': return clear(e.r * T + 8);
      case 'sweep': return d <= e.r * T + 6;
      case 'execute': return d <= e.r * T + 5.2;
      case 'nova': return d <= 13;
      case 'wave': case 'cross': case 'field': return d <= 15;
      case 'pursuit': case 'orbs': return d <= 16 && sees();
    }
    return false;
  }
  startBossMove(e, fam, dx, dy) {
    const s = e.skill;
    this.commitSkill(e, s);
    // a spell whose real blow comes later (script 192 遅延発動 - a swamp that swirls up, orbs that burst, a meteor
    // called down): the move lands that blow
    const later = this.delayedSkill(s);
    if (later) e.skill = later;
    e.move = fam; e.act = null; e.comboStep = 0;
    e.style = this.skillStyle(s);
    e.aim = Math.atan2(dy, dx);
    if (fam === 'flurry') e.comboLen = THREE.MathUtils.clamp(this.skillHits(s), 2, 5);
    e.state = 'windup';
    e.glinted = false;
    e.timer0 = e.timer = this.windupTime(e, s, e.style);
    this.beginTelegraph(e);
  }
  // A skill whose blow comes later (script 遅延スキル): <遅延発動:a,ID,n,r,p> at the end of the n-th turn from now,
  // <行動後遅延発動:a,ID,n,r,p> after the target's n-th action from now - r more at random, p % of the time.
  // A boss lands it as a move of its own, at once (as the stage play's No-Face does - 개구리 노왕's orbs, swamp,
  // flames and meteor, 탐식 미믹's rot, 너스 콜's operation); any other use leaves it to go off then (a turn for
  // an action here): scheduleDelayed
  delayedData(s) {
    if (s._delayData === undefined) {
      const m = /<(行動後)?遅延発動[：:]\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?/.exec(s.note || '');
      s._delayData = m && $data.skills[+m[2]] ? { id: +m[2], n: +m[3], r: +(m[4] || 0), p: m[5] === undefined ? 100 : +m[5], turnEnd: !m[1] } : null;
    }
    return s._delayData;
  }
  // (a later blow that does nothing here - 노・페이스's 사인: an instant death the port leaves out of enemy skills - is
  // no move and nothing to wait for)
  delayedDoes(later) {
    return !!later && (!!String(later.damage?.formula || '').trim() || (later.effects || []).some(ef => (ef.code === 21 && ef.data_id > 1) || ef.code === 44));
  }
  delayedFamily(s) {
    const d = this.delayedData(s);
    if (!d || d.turnEnd || !this.delayedDoes($data.skills[d.id])) return null;
    const later = $data.skills[d.id];
    if (/隕石/.test($data.animations?.[later.animation_id]?.name || '')) return 'rain';
    return this.bossFamily(later) || (later.damage?.type === 1 || later.damage?.type === 5 ? 'pursuit' : null);
  }
  scheduleDelayed(e, skill) {
    const d = this.delayedData(skill), b = e?.battle;
    if (!d || !b || b.done || !this.delayedDoes($data.skills[d.id]) || Math.random() * 100 >= d.p) return;
    if (e.delayedAt !== undefined && G.time - e.delayedAt < 0.5) return;       // (one use, however many hits)
    e.delayedAt = G.time;
    const turns = d.n + Math.floor(Math.random() * (d.r + 1)) + (d.turnEnd ? 0 : 1);
    (b.delayed ||= []).push({ e, skill: $data.skills[d.id], turn: Math.floor(b.time / 6) + turns, warned: false });
  }
  // as a turn ends, those due go off on the player - unless the one who cast it has fallen meanwhile; a moment
  // before, a dark glow gathers at the player's feet and the ground groans (no way out of it, as in the original:
  // 윈터벨의 바람 blows the player up, and two turns later they fall)
  updateDelayed(b, turn) {
    if (!b.delayed?.length) return;
    for (const d of b.delayed) {
      if (d.warned || b.time < (d.turn + 1) * 6 - 1.2 || !d.e.alive) continue;
      d.warned = true;
      const head = G.player.headWorld(new THREE.Vector3());
      const feet = new THREE.Vector3(head.x, G.floorAt(head.x / T - 0.5, head.z / T - 0.5) + 0.2, head.z);
      this.spawnGlow(feet, { color: this.skillFlavor(d.skill) || 0x8a40ff, size: 1.6, life: 1.2, grow: 1.6 });
      G.audio?.playSe(G.seAt('Darkness1', 70, 70), feet);
    }
    const due = b.delayed.filter(d => d.turn < turn);
    if (!due.length) return;
    b.delayed = b.delayed.filter(d => d.turn >= turn);
    for (const d of due) {
      // (the wind's fall: down out of the sky, the blow as the player lands - bossmoves.js liftFall; the wind fallen
      // before it: let down gently)
      if (d.skill && this.liftInfo().falls.has(d.skill.id)) {
        if (this.playerDead || !d.e.alive) { G.player.floatDown?.(); continue; }
        this.runSkillCommonEvents(d.skill);
        this.liftFall(d);
        continue;
      }
      if (this.playerDead || !d.skill || !d.e.alive) continue;
      const head = G.player.headWorld(new THREE.Vector3());
      if (d.skill.animation_id > 0) G.screen.playAnimationOn(head.clone().add(new THREE.Vector3(0, -0.5, 0)), d.skill.animation_id, { world: true, size: 2.2 });
      this.runSkillCommonEvents(d.skill);
      this.enemyStrikePlayer(d.e, d.skill, { blockable: false, certain: true, delayed: true });
    }
  }
  // <遅延発動:a,ID,...> / <行動後遅延発動:a,ID,...>: the skill that goes off later
  delayedSkill(s) {
    if (s._delayed === undefined) {
      const m = /<(?:行動後)?遅延発動[：:]\s*\d+\s*,\s*(\d+)/.exec(s.note || '');
      s._delayed = m && $data.skills[+m[1]] ? +m[1] : 0;
    }
    return s._delayed ? $data.skills[s._delayed] : null;
  }
  // a boss's quick step: gone in a moment, and there again a few metres from the player - beside or behind them
  blink(e) {
    const pc = G.map.playerChar, f = G.player.forward2D(), look = Math.atan2(f.z, f.x);
    for (let tries = 0; tries < 14; tries++) {
      const a = look + Math.PI * (0.5 + Math.random()) * (Math.random() < 0.5 ? 1 : -1);
      const d = (e.r || 0.4) + (2.2 + Math.random() * 1.2) / T;
      const x = pc.fx + Math.cos(a) * d, y = pc.fy + Math.sin(a) * d;
      const tx = Math.round(x), ty = Math.round(y);
      if (!G.map.grid.valid(tx, ty) || !G.map.walkable(tx, ty) || !lineOfSight(pc.fx, pc.fy, x, y)) continue;
      const from = e.worldPos(new THREE.Vector3());
      this.spawnGlow(from.setY(from.y + e.h * 0.5), { color: 0xc8c8ff, size: e.h, life: 0.25, grow: 1.4 });
      e.fx = x; e.fy = y; e.lastFx = undefined;
      e.blinkAt = G.time; e.quick = true;
      const to = e.worldPos(new THREE.Vector3());
      this.spawnGlow(to.setY(to.y + e.h * 0.5), { color: 0xc8c8ff, size: e.h, life: 0.3, grow: 0.8 });
      G.audio?.playSe(G.seAt('Evasion1', 90, 90), to);
      return;
    }
  }
  // the area of a boss's move (as planAttack does for the plain ones)
  planBossMove(e) {
    const s = e.skill, fam = e.move;
    const ep = e.worldPos(new THREE.Vector3());
    const head = this.targetHead(e);             // (whom it goes for: the player, a companion, a co-op guest)
    const d = Math.hypot(head.x - ep.x, head.z - ep.z);
    const hits = this.skillHits(s), R = (e.r || 0.4) * T, heavy = this.isHeavySkill(s), H = e.h || 1.8;   // (sizes guessed while its body is still loading)
    const base = { hits, heavy: true, blockable: false, move: fam };
    switch (fam) {
      case 'charge': case 'lunge': {
        // it runs on a little past where the player stands - or up to a wall, and slams into it
        const max = fam === 'lunge' ? 8 : 16, want = fam === 'lunge' ? d + 1.5 : Math.max(6, d + 4);
        const clear = Math.min(this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, max), this.walkRun(e, e.aim, max)), run = Math.min(clear, want);
        return { ...base, shape: 'line', len: run, full: run, width: THREE.MathUtils.clamp(R * 2 + 1.0, 1.8, 3.8), wall: clear < Math.min(want, max) };
      }
      case 'fissure': return { ...base, shape: 'line', len: this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, 16), full: 16, width: 2.2 };
      // (from up in the sky - bossmoves.js skyHold / skyDive: a dive, its spot marked at once)
      case 'leap': {
        const dive = (!!e.sky || !!e.diving) && (e.lift || 0) > 3;
        // (a dive from the sky lands wider than a leap from the ground)
        const r = dive ? THREE.MathUtils.clamp(R + 3.4, 4.4, 6.2) : THREE.MathUtils.clamp(R + (s.scope === 2 ? 2.8 : 2.0), 2.8, 5);
        return { ...base, shape: 'circle', r, cx: head.x, cz: head.z, ground: true, dive };
      }
      case 'quake': return { ...base, shape: 'circle', r: 9 + R, around: true, wave: 8 };
      case 'roar': return { ...base, shape: 'circle', r: 10, around: true, wave: 13 };
      case 'breath': return { ...base, shape: 'sector', r: R + 9, half: 0.7, heavy, blockable: !heavy };
      case 'spin': return { ...base, shape: 'circle', r: R + 2.2, around: true, heavy: false, blockable: true, hits: Math.max(2, hits) };
      case 'flurry': return heavy ? { shape: 'sector', r: R + 3.6, half: 1.3, hits: 1, heavy: true, blockable: false, move: fam }
        : { shape: 'sector', r: R + BOSS_AREA.reach, half: 0.55, hits: 1, blockable: true, move: fam };
      // a lance: a long narrow band, quickly (crimson when it is a sure hit: step out of it)
      case 'thrust': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, R + 11), certain = s.hit_type === 0;
        return { ...base, shape: 'line', len, full: len, width: 1.3, heavy: heavy && !certain, blockable: !heavy && !certain, certain, tempo: 0.75, tmin: 0.55, tmax: 1.2 };
      }
      // a reach for the player: a band up to it; caught in it, the player is pulled in and the blows land
      case 'grab': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, R + 8);
        return { ...base, shape: 'line', len, full: len, width: 1.5, tempo: 0.9, tmin: 0.7, tmax: 1.4 };
      }
      // a wide sweep from one side to the other: the blade passes over the arc - be behind it, beyond it, or roll
      // through it as it comes
      case 'sweep': return { ...base, shape: 'sector', r: R + 6.5, half: 1.75, way: Math.random() < 0.5 ? 1 : -1, heavy, blockable: !heavy, tmin: 0.9, tmax: 1.8 };
      // a slow, huge killing blow
      case 'execute': return { ...base, shape: 'sector', r: R + 5.5, half: 1.45, tempo: 1.8, tmin: 1.8, tmax: 3.0 };
      // a blast all round it - or all round it but close in (a ring: get in close)
      case 'nova': return Math.random() < 0.5
        ? { ...base, shape: 'ring', r0: R + 3.2, r: R + 15, around: true, heavy: false, tempo: 1.25, tmin: 1.4, tmax: 2.6 }
        : { ...base, shape: 'circle', r: R + 7.5, around: true, heavy: false, tempo: 1.25, tmin: 1.4, tmax: 2.6 };
      // a wall of water (wind) rolling out from it across the floor: roll through it, or be out of its way
      case 'wave': {
        const len = this.clearRun(ep.x, ep.z, e.aim, ep.y + 0.8, 16);
        return { ...base, shape: 'line', len, full: len, width: 14, heavy: false, wave: 8, tmin: 1.0, tmax: 2.0 };
      }
      // lines through where the player stands: a cross (4 arms), a pentagram (5), a hexagram (6)
      case 'cross': {
        const text = `${s.name} ${s.message1 || ''}`;
        const n = /오망|五芒|pentagram/i.test(text) ? 5 : /육망|六芒|hexagram/i.test(text) ? 6 : 4;
        const rot = Math.random() * Math.PI * 2, y = G.floorAt(head.x / T - 0.5, head.z / T - 0.5), parts = [];
        for (let i = 0; i < n; i++) parts.push({ shape: 'line', len: 11, width: 1.8, x: head.x, y, z: head.z, aim: rot + i * Math.PI * 2 / n });
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.2, tmax: 2.2 };
      }
      // pools (poison fog, a swamp, plague) round where the player stands, one right there; they stay a while
      case 'field': {
        const n = THREE.MathUtils.clamp(hits + 1, 2, 3), g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 60; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 2.6 + Math.random() * 2.6;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 3.4))) continue;
          parts.push({ shape: 'circle', r: POOL.r, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0, heavy: false, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.0, tmax: 2.0 };
      }
      // eruptions under the player one after another, each where they are at that moment; orbs that come round
      // after them (no mark on the floor: what they do shows)
      case 'pursuit': return { ...base, shape: 'none', heavy: false, n: THREE.MathUtils.clamp(hits + 2, 3, 5), tempo: 0.8, tmin: 0.6, tmax: 1.4 };
      case 'orbs': return { ...base, shape: 'none', heavy: false, blockable: true, n: THREE.MathUtils.clamp(hits + 1, 2, 5), cap: { left: hits }, tempo: 0.8, tmin: 0.6, tmax: 1.4 };
      case 'rain': {
        // around where the player stands, one right there
        const n = THREE.MathUtils.clamp(hits + 1, 3, 6), r = 2.0, g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 60; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 1.8 + Math.random() * 2.8;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 2.2))) continue;
          parts.push({ shape: 'circle', r, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0.3, cap: { left: hits } };
      }
      case 'volley': {
        const n = THREE.MathUtils.clamp(hits, 3, 5), parts = [];
        for (let i = 0; i < n; i++) {
          const a = e.aim + (i - (n - 1) / 2) * 0.7 / (n - 1);
          parts.push({ shape: 'line', len: this.clearRun(ep.x, ep.z, a, ep.y + H * 0.6, 18), width: 1.2, x: ep.x, y: ep.y, z: ep.z, aim: a });
        }
        return { ...base, heavy: false, blockable: true, shape: 'multi', parts, gap: 0.14, cap: { left: hits } };
      }
      // a die thrown (１D６): as many blasts as the face it shows, round where the player stands, one right there
      case 'dice': {
        const n = this.diceFace(s), g = G.map.grid, parts = [];
        for (let tries = 0; parts.length < n && tries < 80; tries++) {
          const first = !parts.length, a = Math.random() * Math.PI * 2, dd = first ? 0 : 2.2 + Math.random() * 3.2;
          const x = head.x + Math.cos(a) * dd, z = head.z + Math.sin(a) * dd;
          const tx = Math.round(x / T - 0.5), ty = Math.round(z / T - 0.5);
          if (!first && (!g.valid(tx, ty) || !G.map.walkable(tx, ty) || parts.some(q => Math.hypot(q.x - x, q.z - z) < 2.4))) continue;
          parts.push({ shape: 'circle', r: 2.1, x, z, y: G.floorAt(x / T - 0.5, z / T - 0.5) });
        }
        return { ...base, shape: 'multi', parts, gap: 0.24, hits: 1, cap: { left: n }, certain: s.hit_type === 0, tempo: 1.1, tmin: 1.3, tmax: 2.2 };
      }
      // checkmate: the floor round the player turns into a chessboard and every other square comes down - the one the
      // player stands on among them; the squares beside it are safe
      case 'chess': {
        const SQ = 3, N = 3, g = G.map.grid, parts = [];
        const ox = head.x - SQ / 2, oz = head.z - SQ / 2;
        for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
          if ((i + j) % 2) continue;
          const x0 = ox + i * SQ, cz = oz + j * SQ + SQ / 2, cx = x0 + SQ / 2;
          const tx = Math.round(cx / T - 0.5), ty = Math.round(cz / T - 0.5);
          if (!(i === 0 && j === 0) && (!g.valid(tx, ty) || !G.map.walkable(tx, ty))) continue;
          parts.push({ shape: 'line', len: SQ, width: SQ, x: x0, y: G.floorAt(cx / T - 0.5, cz / T - 0.5), z: cz, aim: 0 });
        }
        return { ...base, shape: 'multi', parts, gap: 0, hits: 1, heavy: false, certain: s.hit_type === 0, tempo: 1.6, tmin: 2.4, tmax: 3.2 };
      }
    }
    return this.planNewMove(e, fam, s, head, ep, base) ?? null;
  }
  // the face a die skill shows: the digit its name ends with (１D６주사위4), else its fixed damage in ten thousands
  diceFace(s) {
    const name = (s.name || '').trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const m = /(\d)$/.exec(name);
    const k = m ? +m[1] : Math.round((+s.damage?.formula || 10000) / 10000);
    return THREE.MathUtils.clamp(k || 1, 1, 6);
  }
  // the move goes off as its wind-up ends
  releaseBossMove(e) {
    const plan = e.plan, s = e.skill, fam = e.move;
    if (!plan) { this.endMove(e, 0.5); return; }
    G.coop?.onBossMove?.(e);                       // (its co-op guests see it go off as well - coop.js)
    if (!e.puppet) this.runSkillCommonEvents(s);
    const ep = e.worldPos(new THREE.Vector3());
    if (this.releaseNewMove(e, fam, plan, s, ep)) return;          // (bossmoves.js)
    const anim = s.animation_id > 0 ? s.animation_id : 0;
    const along = (k, y) => new THREE.Vector3(plan.ox + Math.cos(plan.aim) * k, y, plan.oz + Math.sin(plan.aim) * k);
    switch (fam) {
      case 'charge': case 'lunge': {
        this.dropMarker(e);
        const run = Math.max(0.5, plan.len - e.r * T * 0.5);           // its front stops at the wall
        e.state = 'act';
        e.act = { kind: 'dash', t: 0, x0: e.fx, y0: e.fy, ca: Math.cos(plan.aim), sa: Math.sin(plan.aim), L: run / T, dur: Math.max(0.15, run / CHARGE_SPEED), hit: false, puff: 0, wall: !!plan.wall };
        G.audio?.playSe(G.seAt('Wind7', 90, 70), ep);
        G.audio?.playSe(G.seAt('Run', 100, 80), ep);
        return;
      }
      case 'leap': this.dropMarker(e); this.landLeap(e); return;
      case 'fissure': {
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        const spots = [1, 2, 3].map(k => { const p = along(plan.len * k / 3.5, 0); p.y = G.floorAt(p.x / T - 0.5, p.z / T - 0.5) + 0.6; return p; });
        for (const p of spots) this.spawnGlow(p, { color: 0xff6a3a, size: 2.2, life: 0.35, grow: 1.3 });
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        G.audio?.playSe(G.seAt('Earth4', 100, 80), ep);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.8);
        return;
      }
      case 'quake': case 'roar': {
        this.dropMarker(e);
        e.bodyT = { kind: fam === 'roar' ? 'roar' : 'stomp', t0: G.time };
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        if (fam === 'quake') {
          G.audio?.playSe(G.seAt('Earth4', 100, 70), ep);
          const head = G.player.headWorld(new THREE.Vector3());
          if (Math.hypot(head.x - ep.x, head.z - ep.z) < plan.r + 2) G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.35);
        }
        this.spawnWave(e, plan);
        this.endMove(e, 0.9);
        return;
      }
      case 'thrust': case 'execute': {
        this.dropMarker(e);
        // (a lance: it darts in a little as it strikes)
        if (fam === 'thrust' && !e.puppet) this.moveEnemyToward(e, e.fx + Math.cos(plan.aim) * 3, e.fy + Math.sin(plan.aim) * 3, 1.2 / T);
        e.bodyT = { kind: fam === 'execute' ? 'stomp' : 'lunge', t0: G.time };
        const y = ep.y + Math.min(1.2, e.h * 0.5);
        const mid = fam === 'thrust' ? along(plan.len * 0.5, y) : along(Math.min(plan.r * 0.45, 3), y);
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        G.audio?.playSe(G.seAt(fam === 'thrust' ? 'Wind7' : 'Slash11', 100, fam === 'thrust' ? 135 : 70), ep);
        if (fam === 'execute') {
          this.spawnGlow(mid, { color: 0xff3020, size: 3.2, life: 0.3, grow: 1.4 });
          const head = G.player.headWorld(new THREE.Vector3());
          if (Math.hypot(head.x - ep.x, head.z - ep.z) < plan.r + 3) G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.45);
        }
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, plan.blockable, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, fam === 'execute' ? 1.2 : 0.7);
        return;
      }
      case 'nova': {
        this.dropMarker(e);
        e.bodyT = { kind: 'roar', t0: G.time };
        // its animation over all of where it lands
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        this.spawnRing(new THREE.Vector3(plan.ox, plan.oy, plan.oz), plan.r, this.skillColor(s));
        G.audio?.playSe(G.seAt('Explosion3', 90, 80), ep);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.9);
        return;
      }
      case 'cross': {
        this.dropMarker(e);
        const p0 = plan.parts[0];
        if (p0) {
          const c = new THREE.Vector3(p0.x, p0.y + 1, p0.z);
          const arm = (p, k, y) => new THREE.Vector3(p.x + Math.cos(p.aim) * p.len * k, y, p.z + Math.sin(p.aim) * p.len * k);
          this.playAreaAnim(anim, this.areaSpan(plan, ep));
          for (const p of plan.parts) this.spawnGlow(arm(p, 0.5, p0.y + 0.3), { color: this.skillColor(s), size: 2.2, life: 0.3, grow: 1.3 });
          G.audio?.playSe(G.seAt('Saint5', 90, 90), c);
        }
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, plan.hits, false, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, plan.hits);
        this.endMove(e, 0.8);
        return;
      }
      case 'wave':
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        this.spawnBand(e, plan);
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        G.audio?.playSe(G.seAt('Water1', 100, 70), ep);
        this.endMove(e, 0.8);
        return;
      case 'field':
        // the pools come up and stay (hazards), hurting whoever stands in them
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        for (const p of plan.parts) this.addPool(e, s, p, plan);
        G.audio?.playSe(G.seAt('Poison', 90, 80), ep);
        this.endMove(e, 0.8);
        return;
      case 'chess': {
        // every marked square at once: a pillar of darkness on each, the board shaking
        this.dropMarker(e);
        e.bodyT = { kind: 'stomp', t0: G.time };
        const head = G.player.headWorld(new THREE.Vector3());
        const near = plan.parts.map(p => ({ p, d: Math.hypot(p.x + p.len / 2 - head.x, p.z - head.z) })).sort((a, b) => a.d - b.d);
        for (const { p } of near) this.spawnGlow(new THREE.Vector3(p.x + p.len / 2, p.y + 0.4, p.z), { color: 0xb050ff, size: p.len * 1.15, life: 0.45, grow: 1.15 });
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        G.audio?.playSe(G.seAt('Darkness5', 100, 70), ep);
        G.audio?.playSe(G.seAt('Earth4', 90, 60), ep);
        G.screen.hitShake(new THREE.Vector3(head.x - ep.x, 0, head.z - ep.z), 0.4);
        if (this.playerInPlan(e, plan)) this.strikeHits(e, s, 1, false, plan.certain, this.parryable(plan));
        this.strikeAlliesInPlan(e, s, plan, 1);
        this.endMove(e, 1.2);
        return;
      }
      case 'pursuit': e.state = 'act'; e.act = { kind: 'pursuit', t: 0, next: 0, left: plan.n, cap: { left: plan.hits } }; return;
      case 'orbs': e.state = 'act'; e.act = { kind: 'orbs', t: 0, next: 0, left: plan.n }; return;
      case 'grab': e.state = 'act'; e.act = { kind: 'grab', t: 0 }; return;
      case 'sweep':
        G.audio?.playSe(G.seAt('Wind7', 100, 85), ep);
        e.state = 'act'; e.act = { kind: 'sweep', t: 0, dur: 0.42, a0: plan.aim - plan.half * plan.way, allyHit: new Set() };
        return;
      case 'breath':
        this.playAreaAnim(anim, this.areaSpan(plan, ep));
        break;
      case 'spin':
        // (a whirl round it, wherever it goes)
        this.playAreaAnim(anim, { x: ep.x, z: ep.z, w: 2 * plan.r });
        break;
    }
    // a breath, a whirl, a rain of blows, a fan of shots: they go on a moment
    e.state = 'act';
    e.act = { kind: fam, t: 0, next: 0, left: plan.hits };
  }
  // a move going on
  updateBossAct(e, dt) {
    const a = e.act, plan = e.plan, s = e.skill;
    if (!a || !plan) { this.endMove(e, 0.5); return; }
    a.t += dt;
    if (this.updateNewAct(e, a, plan, s, dt)) return;             // (bossmoves.js)
    switch (a.kind) {
      case 'dash': {
        const k = Math.min(1, a.t / a.dur);
        const px = e.fx, py = e.fy;
        e.fx = a.x0 + a.ca * a.L * k; e.fy = a.y0 + a.sa * a.L * k;
        // whoever is in the way: the body swept from where it was to where it is (a dodge's invincibility works)
        for (const al of this.allies.struckable()) {
          if ((a.allyHit ||= new Set()).has(al)) continue;
          if (segDist(al.fx, al.fy, px, py, e.fx, e.fy) <= e.r + al.r / T) {
            a.allyHit.add(al);
            this.hitAlly(al, e, s, plan.hits, { dir: [a.ca, a.sa], push: CHARGE_KNOCK });
          }
        }
        const head = G.player.headWorld(new THREE.Vector3());
        // (a co-op guest's copy strikes this player and throws it, but runs on through, as the host's does through a
        // guest; where the host's stops on the host, the host says so - onChargeImpact)
        if (!a.hit && !this.outOfFight(e) && segDist(head.x / T - 0.5, head.z / T - 0.5, px, py, e.fx, e.fy) <= e.r + BODY_R) {
          a.hit = true;
          const parried = this.parryable(plan) && this.parryNow(e.worldPos(new THREE.Vector3()));
          this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
          if (s.animation_id > 0) {
            const wp = e.worldPos(new THREE.Vector3());
            G.screen.playAnimationOn(new THREE.Vector3((wp.x + head.x) / 2, head.y - 0.3, (wp.z + head.z) / 2), s.animation_id, { world: true, size: this.enemySize(e) });
          }
          // it ran into the player (not slipped past in a dodge): it stops up against them and bounces back
          if (!(G.player.invuln > 0) && e.puppet) G.player.knockback(a.ca, a.sa, parried ? PARRY_SLIDE : CHARGE_KNOCK, parried ? 0 : 1.6);
          else if (!(G.player.invuln > 0)) {
            const pc = G.map.playerChar, u = firstContact(px, py, e.fx, e.fy, pc.fx, pc.fy, e.r + BODY_R);
            e.fx = px + (e.fx - px) * u; e.fy = py + (e.fy - py) * u;
            this.chargeImpact(e, a, false);
            G.coop?.onChargeImpact?.(e);
            // and the player is thrown on along its way (a little off the ground) - off a perfect guard only a
            // short slide back, feet on the ground: its weight, not a throw
            G.player.knockback(a.ca, a.sa, parried ? PARRY_SLIDE : CHARGE_KNOCK, parried ? 0 : 1.6);
            break;
          }
        }
        if ((a.puff -= dt) <= 0) {
          a.puff = 0.07;
          const p = e.worldPos(new THREE.Vector3()); p.y += 0.15;
          this.spawnGlow(p, { color: 0xb8a890, size: 0.6, life: 0.35, grow: 1.7 });
        }
        if (k >= 1) {
          if (a.wall) { this.chargeImpact(e, a, true); break; }           // up against a wall
          G.audio?.playSe(G.seAt('Earth4', 80, 120), e.worldPos(new THREE.Vector3()));
          this.endMove(e, 1.1);
        }
        break;
      }
      // bouncing back off what it ran into: a short hop back the way it came, then it gathers itself
      case 'recoil': {
        const k = Math.min(1, a.t / a.dur), q = 1 - (1 - k) * (1 - k);
        e.fx = a.x0 + a.ca * a.L * q; e.fy = a.y0 + a.sa * a.L * q;
        e.lift = a.hop * 4 * k * (1 - k);
        if (k >= 1) { e.lift = 0; this.endMove(e, 0.9); }
        break;
      }
      case 'breath': {
        // it keeps pouring: stepping out of the cone cuts it short
        this.updateTelegraph(e);
        const ticks = THREE.MathUtils.clamp(plan.hits + 1, 2, 4), dur = 0.75;
        while (a.next < ticks && a.t >= a.next * dur / (ticks - 1)) {
          a.next++;
          if (a.left > 0 && this.playerInPlan(e, plan)) { a.left--; this.enemyStrikePlayer(e, s, { blockable: plan.blockable, parry: this.parryable(plan) }); }
          this.strikeAlliesInPlan(e, s, plan, 1, a.allyCap ||= new Map());
        }
        if (a.t >= dur) this.endMove(e, 0.6);
        break;
      }
      case 'spin': {
        // (after whom it goes for; a guest's copy goes where the host's is)
        const to = e.tgt?.stands && e.tgt.alive ? e.tgt : G.map.playerChar;
        if (!e.puppet) this.moveEnemyToward(e, to.fx, to.fy, 2.6 * dt / T);
        this.updateTelegraph(e);
        if (a.t >= a.next) {
          a.next += 0.45;
          G.audio?.playSe(G.seAt('Wind4', 70, 110 + Math.random() * 20), e.worldPos(new THREE.Vector3()));
          if (a.left > 0 && this.playerInPlan(e, plan)) { a.left--; this.enemyStrikePlayer(e, s, { blockable: plan.blockable, parry: this.parryable(plan) }); }
          this.strikeAlliesInPlan(e, s, plan, 1, a.allyCap ||= new Map());
        }
        // a slash trails round it at every half turn
        const turns = Math.floor(spinAngle(a.t) / Math.PI);
        if (a.halfTurns === undefined) a.halfTurns = turns;
        if (turns > a.halfTurns) { a.halfTurns = turns; this.spawnSlashArc(e); }
        if (a.t >= SPIN_TIME) this.endMove(e, 0.8);
        break;
      }
      case 'sweep': {
        // the blade goes over the arc from one side to the other; whoever it passes over is struck, once
        const k = THREE.MathUtils.smootherstep(Math.min(1, a.t / a.dur), 0, 1);
        const prev = a.ang ?? a.a0, ang = a.a0 + plan.way * 2 * plan.half * k;
        a.ang = ang;
        this.showBlade(e, plan, ang);
        const crossed = (x, z, body) => {
          const dx = x - plan.ox, dz = z - plan.oz, d = Math.hypot(dx, dz);
          if (d > plan.r + body) return false;
          if (d < 0.7) return true;
          const m = body / d, sw = ang - prev, b = Math.atan2(dz, dx);
          const rel = Math.atan2(Math.sin(b - prev), Math.cos(b - prev));
          return sw >= 0 ? rel >= -m && rel <= sw + m : rel <= m && rel >= sw - m;
        };
        const head = G.player.headWorld(new THREE.Vector3());
        if (!a.hitP && crossed(head.x, head.z, 0.38)) { a.hitP = true; this.strikeHits(e, s, plan.hits, plan.blockable, false, this.parryable(plan)); }
        for (const al of this.allies.struckable()) {
          if (a.allyHit.has(al)) continue;
          const ap = al.worldPos(new THREE.Vector3());
          if (crossed(ap.x, ap.z, al.r)) { a.allyHit.add(al); this.hitAlly(al, e, s, plan.hits); }
        }
        if (a.t >= a.dur) {
          this.hideBlade(e);
          this.playAreaAnim(s.animation_id, this.areaSpan(plan, e.worldPos(new THREE.Vector3())));
          this.endMove(e, 0.7);
        }
        break;
      }
      case 'grab': {
        const head = G.player.headWorld(new THREE.Vector3());
        if (!a.reached && a.t >= 0.14) {
          a.reached = true;
          // the reach: a streak out along the band
          const from = new THREE.Vector3(plan.ox, plan.oy + Math.min(1.3, e.h * 0.55), plan.oz);
          const to = new THREE.Vector3(plan.ox + Math.cos(plan.aim) * plan.len, from.y - 0.2, plan.oz + Math.sin(plan.aim) * plan.len);
          this.spawnTracer(from, to, 0xff9070);
          this.spawnGlow(to, { color: 0xff7050, size: 0.6, life: 0.2, grow: 1.6 });
          G.audio?.playSe(G.seAt('Wind1', 90, 120), from);
          if (this.playerInPlan(e, plan) && !this.playerDead) {
            if (G.player.invuln > 0) this.enemyStrikePlayer(e, s, { blockable: false });      // (slipped it in a dodge)
            else if (this.parryable(plan) && this.parryNow(new THREE.Vector3(plan.ox, plan.oy, plan.oz))) this.enemyStrikePlayer(e, s, { blockable: false, parry: true });   // (a perfect guard: not caught)
            else {
              // caught: pulled in, up to it
              a.caught = true;
              const d = Math.hypot(head.x - plan.ox, head.z - plan.oz), pull = Math.max(0, d - ((e.r || 0.4) * T + 0.75));
              G.player.knockback(-Math.cos(plan.aim), -Math.sin(plan.aim), pull, 0.4);
              G.audio?.playSe(G.seAt('Twine', 100, 90), head);
              G.input.haptic('left', 0.8, 200); G.input.haptic('right', 0.8, 200);
            }
          }
          this.strikeAlliesInPlan(e, s, plan, plan.hits);
          this.dropMarker(e);
        }
        if (a.caught && !a.hit && a.t >= 0.55) {
          a.hit = true;
          if (s.animation_id > 0) G.screen.playAnimationOn(head.clone().add(new THREE.Vector3(0, -0.4, 0)), s.animation_id, { world: true, visual: false });
          this.strikeHits(e, s, plan.hits, false);
        }
        if (a.t >= (a.caught ? 0.9 : 0.5)) this.endMove(e, 0.9);
        break;
      }
      case 'pursuit': {
        // a spot under the player every PURSUIT.gap s; each bursts PURSUIT.fuse s after it was laid (hazards)
        while (a.left > 0 && a.t >= a.next) {
          a.next += PURSUIT.gap; a.left--;
          const head = this.targetHead(e);
          this.addEruption(e, s, head.x, head.z, a.cap);
        }
        if (a.left <= 0 && a.t >= a.next) this.endMove(e, 0.6);
        break;
      }
      case 'orbs': {
        while (a.left > 0 && a.t >= a.next) {
          a.next += 0.16; a.left--;
          const i = plan.n - 1 - a.left, spread = plan.n > 1 ? (i / (plan.n - 1) - 0.5) * 1.2 : 0;
          const from = e.worldPos(new THREE.Vector3()); from.y += e.h * 0.6;
          this.spawnProjectile(from, new THREE.Vector3(Math.cos(e.aim + spread), 0.1, Math.sin(e.aim + spread)),
            { speed: 2.5, accel: 7, maxSpeed: 8, color: this.skillColor(s), enemy: e, skill: s, homing: 0, steer: 3, cap: plan.cap, life: 3.4, aimAt: e.tgt || null, pierce: !!plan.pierce, ghost: !!e.puppet,
              style: shotStyleOf(s, this.skillLook(s)) });
          G.audio?.playSe(G.seAt('Magic3', 70, 130), from);
        }
        if (a.left <= 0) this.endMove(e, 0.6);
        break;
      }
      default:                                      // a rain of blows, a fan of shots
        e.moveT = (e.moveT || 0) + dt;
        this.updateMulti(e);
    }
  }
  // a charge that runs into the player or a wall: a heavy thud, dust bursting where it struck (and grit off a
  // wall), a squash, and the boss bounces back a little the way it came
  chargeImpact(e, a, wall) {
    const ep = e.worldPos(new THREE.Vector3());
    const R = (e.r || 0.4) * T, H = e.h || 1.8;
    const at = new THREE.Vector3(ep.x + a.ca * R * 0.8, ep.y + Math.min(1, H * 0.4), ep.z + a.sa * R * 0.8);
    G.audio?.playSe(G.seAt('Earth2', 100, 80), at);
    G.audio?.playSe(G.seAt('Earth3', 90, 70), at);
    for (let i = 0; i < 6; i++) {
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.4) * 0.5, (Math.random() - 0.5) * 0.6));
      this.spawnGlow(p, { color: 0xb8a890, size: 0.45 + Math.random() * 0.4, life: 0.5, grow: 1.8,
        vel: new THREE.Vector3(-a.ca * 1.2 + (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), -a.sa * 1.2 + (Math.random() - 0.5) * 1.5) });
    }
    if (wall) {
      this.spawnSparks(at, new THREE.Vector3(a.ca, 0, a.sa), 8, 0xc8b090);
      // the floor carries the blow a little way
      const head = G.player.headWorld(new THREE.Vector3());
      if (Math.hypot(head.x - ep.x, head.z - ep.z) < 6) { G.input.haptic('left', 0.35, 70); G.input.haptic('right', 0.35, 70); }
    }
    e.bodyT = { kind: 'land', t0: G.time };
    // back the way it came (clear: it has just run through there)
    const back = Math.atan2(-a.sa, -a.ca);
    const dist = Math.min(THREE.MathUtils.clamp(0.6 + R * 0.5, 0.8, 1.6), this.clearRun(ep.x, ep.z, back, ep.y + 0.8, 1.6));
    e.act = { kind: 'recoil', t: 0, x0: e.fx, y0: e.fy, ca: -a.ca, sa: -a.sa, L: dist / T, dur: 0.38, hop: 0.25 * THREE.MathUtils.clamp(H / 1.8, 0.7, 1.6) };
  }
  // a rain of blows / a fan of shots: each part fills toward its own moment, then comes down (or flies)
  updateMulti(e) {
    const plan = e.plan, set = e.marker, t = e.moveT || 0;
    this.turnParts(e, plan, set, t);
    plan.parts.forEach((p, i) => {
      if (p.done) return;
      const at = plan.t0 + (p.at ?? i * plan.gap);          // (a part of its own moment: the second way of a lattice, the next bands)
      const mk = set?.list?.[i];
      if (mk && !mk.released) {
        mk.setProgress(Math.min(1, t / at));
        if (this.unguardable(plan)) mk.edgeMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(G.time * 9));
      }
      if (e.state !== 'act' || t < at) return;
      p.done = true;
      set?.release?.(i, this.fadingMarkers);
      this.landPart(e, p);
    });
    if (e.state === 'act' && plan.parts.every(p => p.done)) this.endMove(e, 0.6);
  }
  landPart(e, p) {
    if (this.landNewPart(e, p)) return;                    // (a star's arm, a lattice's beam, a band - bossmoves.js)
    const plan = e.plan, s = e.skill;
    if (plan.move === 'rain' || plan.move === 'dice') {
      const at = new THREE.Vector3(p.x, p.y, p.z);
      if (s.animation_id > 0) this.playAreaAnim(s.animation_id, { x: p.x, z: p.z, w: 2 * p.r });
      else G.audio?.playSe(G.seAt('Explosion1', 55, 120), at);
      this.spawnGlow(at.clone().setY(p.y + 0.2), { color: this.skillColor(s), size: p.r * 2.2, life: 0.3, grow: 1.2 });
      const head = G.player.headWorld(new THREE.Vector3());
      if (plan.cap.left > 0 && Math.hypot(head.x - p.x, head.z - p.z) <= p.r + 0.38) { plan.cap.left--; this.enemyStrikePlayer(e, s, { blockable: false, certain: !!plan.certain, parry: this.parryable(plan) }); }
      this.strikeAlliesNear(e, s, p.x, p.z, p.r, 1);
      return;
    }
    // a shot along its line
    const from = new THREE.Vector3(plan.ox, plan.oy + e.h * 0.6, plan.oz);
    this.spawnProjectile(from, new THREE.Vector3(Math.cos(p.aim), 0, Math.sin(p.aim)), { speed: 14, color: this.skillColor(s), enemy: e, skill: s, homing: 0, cap: plan.cap, life: 2.5, pierce: !!plan.pierce, ghost: !!e.puppet,
      style: shotStyleOf(s, this.skillLook(s)) });
    G.audio?.playSe(G.seAt('Magic1', 60, 120 + Math.random() * 20), from);
  }
  // the leap: a short crouch, then up high and across to the marked spot, a moment hanging there, and down hard
  updateLeap(e) {
    const plan = e.plan;
    if (!plan) return;
    const el = e.timer0 - e.timer, crouch = plan.dive ? 0 : Math.min(0.35, e.timer0 * 0.22);
    if (el < crouch) return;
    if (!plan.jumped) {
      if (e.puppet) return;            // (a co-op guest's copy: the host says where it comes down - coop.js onLeap)
      plan.jumped = true; plan.sx = e.fx; plan.sy = e.fy; plan.jumpAt = el;
      plan.height = THREE.MathUtils.clamp(2.5 + e.h, 3.5, 7);
      // (from up in the sky: a dive, from as high as it is)
      if ((e.sky || e.diving || plan.dive) && (e.lift || 0) > plan.height) { plan.height = e.lift; plan.dive = true; }
      // up in the air: now the spot it comes down on is marked, where the player (or whoever it goes for) stands at
      // this moment, and the mark stays there - the boss lands on it, not on wherever the player has gone
      const head = this.targetHead(e);
      plan.cx = head.x; plan.cz = head.z;
      e.marker = new FloorMarker(this.root, { ...plan, color: MARK.heavy, label: plan.hits > 1 ? `×${plan.hits}` : '' });
      // (no sound of its own as it goes up: its skill's - the original's - plays where it lands, landLeap)
      G.coop?.onLeap?.(e);
    }
    const k = THREE.MathUtils.clamp((el - crouch) / Math.max(0.1, e.timer0 - crouch), 0, 1);
    const tx = plan.cx / T - 0.5, ty = plan.cz / T - 0.5;
    const h = THREE.MathUtils.smootherstep(Math.min(1, k / 0.75), 0, 1);          // across while going up
    e.fx = plan.sx + (tx - plan.sx) * h; e.fy = plan.sy + (ty - plan.sy) * h;
    const H = plan.height;
    if (plan.dive) {
      // (hangs up there, then down all at once: 뛰어넘기's straight down at its speed - it lands as the mark runs out)
      const drop = this.skyDrop(e), left = (1 - k) * Math.max(0.1, e.timer0 - crouch);
      e.lift = drop > 0 ? H * Math.min(1, left * drop / H) : H * (1 - k * k * k);
      return;
    }
    e.lift = k < 0.45 ? H * (1 - (1 - k / 0.45) ** 2) : k < 0.78 ? H : H * (1 - ((k - 0.78) / 0.22) ** 2);
  }
  landLeap(e) {
    const plan = e.plan, s = e.skill;
    const tx = plan.cx / T - 0.5, ty = plan.cz / T - 0.5;
    e.fx = tx; e.fy = ty; e.lift = 0;
    e.diving = false; e.landing = false;                 // (down from the sky with it - bossmoves.js skyDive)
    e.bodyT = { kind: 'land', t0: G.time };
    const at = new THREE.Vector3(plan.cx, G.floorAt(tx, ty), plan.cz);
    G.audio?.playSe(G.seAt('Earth4', 100, 75), at);
    G.audio?.playSe(G.seAt('Explosion1', 60, 70), at);
    this.playAreaAnim(s.animation_id, { x: plan.cx, z: plan.cz, w: 2 * plan.r });
    this.spawnGlow(at.clone().setY(at.y + 0.15), { color: 0xff6a3a, size: plan.r * 2.3, life: 0.4, grow: 1.25 });
    this.spawnSparks(at.clone().setY(at.y + 0.1), new THREE.Vector3(1, 0, 0), 14, 0xc8b090);
    const head = G.player.headWorld(new THREE.Vector3());
    this.strikeAlliesInPlan(e, s, plan, plan.hits);
    // (down from the sky - a dive: the ground shakes hard and both hands feel it, more the nearer it lands)
    if (plan.dive) {
      const d = Math.hypot(head.x - at.x, head.z - at.z);
      if (d < 18) {
        const k = 1 - d / 18;
        G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 1 + 0.8 * k, 0.5);
        G.input.haptic('left', 0.45 + 0.4 * k, 170); G.input.haptic('right', 0.45 + 0.4 * k, 170);
      }
    }
    if (this.playerInPlan(e, plan)) {
      const parried = this.parryable(plan) && this.parryNow(e.worldPos(new THREE.Vector3()));
      this.strikeHits(e, s, plan.hits, false, false, this.parryable(plan));
      // under it: thrown up into the air (not when it was slipped in a dodge); off a perfect guard it only jolts -
      // the ground and both hands shake hard
      if (parried) {
        G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 1.3, 0.45);
        G.input.haptic('left', 1, 220); G.input.haptic('right', 1, 220);
      } else if (!(G.player.invuln > 0) && !this.playerDead) G.player.knockback(0, 0, 0, LEAP_LAUNCH);
    } else if (!plan.dive && Math.hypot(head.x - at.x, head.z - at.z) < plan.r + 3) {
      // the ground shakes around it, hard
      G.screen.hitShake(new THREE.Vector3(head.x - at.x, 0, head.z - at.z), 1, 0.4);
      G.input.haptic('left', 0.45, 90); G.input.haptic('right', 0.45, 90);
    }
    this.endMove(e, 1.2);
  }
  // a shockwave running out across the floor from the boss (quake, roar): it hits where its front passes
  spawnWave(e, plan) {
    const ep = e.worldPos(new THREE.Vector3());
    const color = new THREE.Color(plan.move === 'roar' ? 0xffa060 : 0xff5a2a).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(ep.x, ep.y + 0.08, ep.z);
    mesh.scale.setScalar(0.3);
    mesh.renderOrder = 5;
    mesh.userData.transient = true;
    this.root.add(mesh);
    this.waves.push({ e, skill: e.skill, hits: plan.hits, x: ep.x, z: ep.z, fx: e.fx, fy: e.fy, r: 0.3, R: plan.r, speed: plan.wave, mesh, hit: false, parry: this.parryable(plan) });
    G.input.haptic('left', 0.35, 80); G.input.haptic('right', 0.35, 80);
  }
  updateWaves(dt, paused) {
    if (!this.waves.length || paused) return;
    const head = G.player.headWorld(new THREE.Vector3());
    const pc = G.map.playerChar;
    this.waves = this.waves.filter(w => {
      if (w.band) return this.updateBand(w, dt, head);
      w.r = Math.min(w.R, w.r + w.speed * dt);
      w.mesh.scale.setScalar(w.r);
      w.mesh.material.opacity = 0.75 * Math.min(1, (w.R - w.r) / (w.R * 0.3) + 0.15);
      const d = Math.hypot(head.x - w.x, head.z - w.z);
      // (struck past no wall; from a boss over a pillar - a flier, one chasing through a wall - it runs out of that
      // block over the floor round it)
      if (!w.hit && Math.abs(d - w.r) <= 0.55 + 0.38 && lineOfSight(w.fx, w.fy, pc.fx, pc.fy, true)) this.passOver(w, w.r >= d);
      // (the companions it passes)
      for (const al of this.allies.struckable()) {
        if ((w.allyHit ||= new Set()).has(al)) continue;
        const ap = al.worldPos(new THREE.Vector3());
        if (Math.abs(Math.hypot(ap.x - w.x, ap.z - w.z) - w.r) <= 0.55 + al.r && lineOfSight(w.fx, w.fy, al.fx, al.fy, true)) {
          w.allyHit.add(al);
          this.hitAlly(al, w.e, w.skill, w.hits, { from: { x: w.x, z: w.z }, push: 0.8 });
        }
      }
      if (w.r < w.R) return true;
      this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
      return false;
    });
  }
  // a wave (a ring going out, a wall rolling on) on the player: it strikes as it gets to where they stand (over: it has),
  // and a dodge any time while it is on them lets it by. (It struck a body's width before it got there, at the first
  // touch, so a dodge as it came over came too late - 그랑・기뇰's waves could be neither dodged nor guarded)
  passOver(w, over) {
    if (G.player.invuln > 0) w.dodged = true;
    if (!over) return;
    w.hit = true;
    const dodged = !!w.dodged;
    for (let i = 0; i < w.hits; i++) this.later(i * 140, () => this.enemyStrikePlayer(w.e, w.skill, { blockable: false, parry: !!w.parry, dodged }));
  }
  // a move's blow lands: as many hits as the skill has, a moment apart
  strikeHits(e, s, n, blockable, certain = false, parry = false) {
    for (let i = 0; i < (n || 1); i++) this.later(i * 140, () => this.enemyStrikePlayer(e, s, { blockable, certain, parry }));
  }
  // the blade of a sweep, at waist height, where it is now
  showBlade(e, plan, ang) {
    if (!e.blade) {
      const geo = new THREE.CircleGeometry(plan.r, 10, -0.09, 0.18);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0e0).multiplyScalar(fxk()), transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const inner = new THREE.Mesh(geo, mat);
      inner.rotation.x = -Math.PI / 2;
      e.blade = new THREE.Group();
      e.blade.add(inner);
      e.blade.renderOrder = 1400;
      e.blade.userData.transient = true;
      this.root.add(e.blade);
    }
    e.blade.position.set(plan.ox, plan.oy + Math.min(1.0, (e.h || 1.8) * 0.45), plan.oz);
    e.blade.rotation.y = -ang;
  }
  hideBlade(e) {
    if (!e.blade) return;
    this.root.remove(e.blade);
    e.blade.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    e.blade = null;
  }
  // a ring of light running out over the floor (a blast going off)
  spawnRing(at, r, color) {
    const geo = this._novaRing || (this._novaRing = new THREE.RingGeometry(0.9, 1, 64));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(fxk()), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, at.y + 0.1, at.z);
    mesh.renderOrder = 6;
    this.root.add(mesh);
    this.fx.push({ obj: mesh, t: 0, life: 0.45, size: r * 0.3, grow: 1 / 0.3 });
  }
  // a wall of water (wind) rolling out from a boss over the floor: struck where it passes (roll through it)
  spawnBand(e, plan) {
    const ux = Math.cos(plan.aim), uz = Math.sin(plan.aim);
    const color = new THREE.Color(this.skillColor(e.skill)).multiplyScalar(fxk());
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(plan.width, 1.7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.rotation.y = Math.atan2(ux, uz);
    mesh.position.set(plan.ox, plan.oy + 0.85, plan.oz);
    mesh.renderOrder = 5;
    mesh.userData.transient = true;
    this.root.add(mesh);
    this.waves.push({ band: true, e, skill: e.skill, hits: plan.hits, x: plan.ox, z: plan.oz, ux, uz, W: plan.width, L: plan.len, d: 0.3, speed: plan.wave || 8, mesh, hit: false, parry: this.parryable(plan) });
    G.input.haptic('left', 0.3, 80); G.input.haptic('right', 0.3, 80);
  }
  updateBand(w, dt, head) {
    w.d = Math.min(w.L, w.d + w.speed * dt);
    w.mesh.position.x = w.x + w.ux * w.d; w.mesh.position.z = w.z + w.uz * w.d;
    w.mesh.material.opacity = 0.55 * Math.min(1, (w.L - w.d) / 2 + 0.1);
    const inBand = (x, z, body) => {
      const rx = x - w.x, rz = z - w.z, along = rx * w.ux + rz * w.uz, side = Math.abs(rx * w.uz - rz * w.ux);
      return Math.abs(along - w.d) <= 0.6 + body && side <= w.W / 2 + body;
    };
    if (!w.hit && inBand(head.x, head.z, 0.38)) {
      const along = (head.x - w.x) * w.ux + (head.z - w.z) * w.uz;
      this.passOver(w, w.d >= along);
    }
    for (const al of this.allies.struckable()) {
      if ((w.allyHit ||= new Set()).has(al)) continue;
      const ap = al.worldPos(new THREE.Vector3());
      if (inBand(ap.x, ap.z, al.r)) { w.allyHit.add(al); this.hitAlly(al, w.e, w.skill, w.hits, { dir: [w.ux, w.uz], push: 0.8 }); }
    }
    if (w.d < w.L) return true;
    this.root.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose();
    return false;
  }
}
