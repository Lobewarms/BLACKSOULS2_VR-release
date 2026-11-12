// The UI's co-op menus (coop.js): joining a boss fight, the session and its rules, the players, names, the banned, chat and
// voice, the servers met before and the community servers, the game's keyboards and number input for them.
import { NAME_LEN, cleanName } from '../coopnet.js';
import { mapName } from '../data.js';
import { G } from '../globals.js';
import { tr } from '../i18n.js';
import { itemData } from '../state.js';
import { BOSS_ASK, VOICE_LABEL, WORLD_PORT, clipText } from './common.js';

// (never made: its methods are UI's own - mixed into it in ui.js)
export class CoopMenuPart {
  // ---- a boss fight began in the co-op host's world without this player (coop.js onJoinAsk): join it? Asked over the
  // play, which goes on meanwhile (nothing pauses for it) - this player stands still while answering, and it steps aside
  // for this player's own menu or message. No answer in BOSS_ASK s is no (the co-op menu can still join it) - counted
  // only while it is up to be answered
  // (title / yes / no: another question of the kind - the host asked to come to a guest's boss fight on another map)
  askBossJoin(answer, { title = null, yes = null, no = null, wait = BOSS_ASK } = {}) {
    const old = this.prompt;
    this.closeBossPrompt();
    this.prompt = { answer, left: wait, shown: false, title, yes, no };
    old?.answer(false);                     // (one asked before and not answered yet: as if declined)
  }
  closeBossPrompt() {
    const p = this.prompt;
    this.prompt = null;
    if (p?.shown && this.msg?.state !== 'choice') this.choice.close();
  }
  updateBossPrompt(dt) {
    const p = this.prompt;
    if (!p) return;
    if (this.msg || this.menuOpen || this.sceneOpen) { if (p.shown) { p.shown = false; if (this.msg?.state !== 'choice') this.choice.close(); } return; }
    if ((p.left -= dt) <= 0) { this.closeBossPrompt(); p.answer(false); return; }
    if (!p.shown) {
      p.shown = true;
      this.placeRoot(true);
      this.choice.open(p.title || tr('보스전이 시작되었습니다. 참여하시겠습니까?'), [{ text: p.yes || tr('참여한다') }, { text: p.no || tr('참여하지 않는다') }], {
        index: 0,
        onSelect: i => { this.closeBossPrompt(); p.answer(i === 0); },
        onCancel: () => { this.closeBossPrompt(); p.answer(false); },
      });
      this.choice.panel.mesh.visible = true;
      this.choice.panel.mesh.position.set(0, -0.05, 0);
    }
    this.choice.update(this.pointerRay());
    this.consumedConfirm = true;
  }
  // ---------------------------------------------------------------- co-op (coop.js)
  // open this world (on this PC's co-op server, or one elsewhere), go into a friend's world (a server from the list, or
  // a new one: its IP, port and PIN), or end it
  showCoopMenu(index = 0) {
    const c = G.coop, items = [];
    const note = this.coopNote(c.lastError, c.lastServer);
    c.lastError = '';
    if (!c.active) {
      // (the community servers: those this game came with - devserver.json, always here -, then those this player added:
      // its IP, port and PIN - anyone may run one, community_server.cmd)
      c.devServers.forEach((s, i) => { if (s) items.push({ text: tr('커뮤니티 서버 {n}', { n: i + 1 }), id: 'dev', dev: i, desc: tr('모두가 함께하는 하나의 세계') }); });
      const added = this.communityServers();
      for (const s of added) items.push({ text: tr('커뮤니티 서버 {n}', { n: `${s.ip}:${s.port}` }), id: 'dev', dev: s, desc: tr('모두가 함께하는 하나의 세계') });
      items.push({ text: tr('커뮤니티 서버 추가 (IP·포트·PIN 입력)'), id: 'dev-add', desc: tr('다른 사람이 켠 커뮤니티 서버로 들어갑니다') });
      if (added.length) items.push({ text: tr('추가한 커뮤니티 서버 목록 비우기'), id: 'dev-clear' });
      items.push({ text: tr('내 세계 열기 (이 PC의 협력 서버)'), id: 'host-here', desc: tr('이 PC에서 협력 서버(coop_server)를 켜 두면 친구가 이 세계에 올 수 있습니다') });
      items.push({ text: tr('친구의 세계로 가기'), id: 'visit', desc: tr('친구가 켠 협력 서버로 들어갑니다') });
      items.push({ text: tr('내 세계 열기 (다른 곳의 협력 서버)'), id: 'host-there', desc: tr('외부 서버에서 열면 다른 사람들이 내 IP를 모릅니다') });
      items.push(...this.coopSelfRows(), this.coopBanRow());
    } else if (c.role === 'world') {
      const n = c.members().length;
      const d = c.worldName();
      const state = { connecting: tr('커뮤니티 서버 {d}에 연결하는 중...', { d }), choosing: tr('커뮤니티 서버 {d}: 시작 방법을 골라 주세요', { d }), prologue: tr('커뮤니티 서버 {d}: 오프닝 (도서관의 꿈에 오면 세계에 들어갑니다)', { d }),
        joining: tr('커뮤니티 서버 {d}: 세계에 들어가는 중...', { d }), in: tr('커뮤니티 서버 {d} ({n}명)', { d, n }) }[c.wphase] || tr('커뮤니티 서버 {d}', { d });
      items.push({ text: state, id: c.wphase === 'choosing' ? 'world-start' : 'status' });
      if (c.wphase !== 'connecting') items.push(this.coopMembersRow(), ...this.worldRuleRows());
      // (each player's own PvP: those who both turned it on may strike each other)
      if (c.world) items.push({ text: c.myPvp ? tr('내 PvP: 켜짐 (켠 사람끼리 공격할 수 있음)') : tr('내 PvP: 꺼짐'), id: 'my-pvp', desc: tr('고르면 바뀝니다 (켜면 이름 위에 붉은 PVP가 보입니다)') });
      if (!c.spectating && c.outOfBossFight()) items.push({ text: tr('보스전에 참여하기'), id: 'join-boss', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      items.push({ text: tr('커뮤니티 서버에서 나가기'), id: 'end', desc: tr('내 세계로 돌아갑니다') });
      items.push(...this.coopSelfRows());
    } else if (c.role === 'host') {
      const n = c.guests().length;
      items.push({ text: n ? tr('내 세계에 {n}명이 와 있습니다', { n }) : tr('내 세계를 열어 두었습니다'), id: 'players',
        desc: c.link?.open === false ? tr('연결하는 중...') : n ? tr('고르면 와 있는 사람 (내보내기·차단)') : tr('친구를 기다리는 중...') });
      // (a boss fight a guest began, which this player did not join: it may still)
      const b = c.bossFightOn();
      if (b && !b.coopIn.has('host')) items.push({ text: tr('보스전에 참여하기'), id: 'host-join', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      items.push(this.coopMembersRow(), ...this.coopRuleRows(true));
      items.push(this.coopBanRow(), ...this.coopSelfRows());
      items.push({ text: tr('방 닫기'), id: 'end', desc: tr('와 있는 사람은 자기 세계로 돌아갑니다') });
    } else {
      items.push({ text: tr('내 세계로 돌아가기'), id: 'end', desc: c.phantom ? '' : tr('연결하는 중...') });
      // (a boss fight of the host's this guest did not join: it may still; to the host's side, from wherever it is)
      if (!c.spectating && c.outOfBossFight()) items.push({ text: tr('보스전에 참여하기'), id: 'join-boss', desc: tr('참여하지 않은 보스전이 진행 중입니다') });
      if (c.phantom && !c.spectating) items.push({ text: tr('호스트 곁으로 가기'), id: 'go-host', desc: tr('호스트가 있는 곳으로 갑니다') });
      if (c.phantom) items.push(this.coopMembersRow(), ...this.coopRuleRows(false));
      items.push(...this.coopSelfRows());
    }
    if (note) items[0].desc = note;           // (shown where the first row's line is - the row the menu opens on)
    // (the co-op server is older than this game: its rules and defaults are not this game's)
    if (c.active && c.serverOld) {
      items.splice(1, 0, c.role === 'world' ? { text: tr('커뮤니티 서버가 예전 버전입니다'), id: 'server-old', desc: tr('서버의 world_server.py와 coop_server.py를 이 게임의 것으로 바꾸고 다시 켜 주세요') }
        : { text: tr('협력 서버가 예전 버전입니다'), id: 'server-old', desc: tr('서버의 coop_server.py를 이 게임의 것으로 바꾸고 다시 켜 주세요') });
    }
    this.list.open(tr('협력'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'dev') this.coopNameFirst().then(ok => { if (ok && c.joinWorld(it.dev)) this.closeMenu(); });
        else if (it.id === 'dev-add') this.coopNameFirst().then(ok => { if (ok) this.addCommunityServer(); });
        else if (it.id === 'dev-clear') { G.settings.communityServers = []; G.saveSettings?.(); this.showCoopMenu(); }
        else if (it.id === 'world-start') this.showWorldStart();
        else if (it.id === 'members') this.showCoopMembers();
        else if (it.id === 'host-here') this.coopNameFirst().then(ok => { if (ok) { c.openWorld({ local: true, port: G.settings.coopPort || G.coop.defaultPort }); this.closeMenu(); } });
        else if (it.id === 'visit') this.coopNameFirst().then(ok => { if (ok) this.showCoopServers('visit'); });
        else if (it.id === 'host-there') this.coopNameFirst().then(ok => { if (ok) this.showCoopServers('host'); });
        else if (it.id === 'players') this.showCoopPlayers();
        else if (it.id === 'bans') this.showCoopBans();
        else if (it.id === 'name') this.changeCoopName(i);
        else if (it.id === 'names') { G.settings.coopNames = G.settings.coopNames === false; G.saveSettings?.(); this.showCoopMenu(i); }
        else if (it.id === 'chat') this.showChatMenu();
        else if (it.id === 'end') { c.end('menu'); this.closeMenu(); }
        else if (it.id === 'join-boss') { c.joinBossFight(); this.closeMenu(); }
        else if (it.id === 'host-join') { c.hostJoin(); this.closeMenu(); }
        else if (it.id === 'go-host') { c.goToHost(); this.closeMenu(); }
        // (the server's rules: the host changes them here - a guest only sees them)
        // (an older co-op server knows no rules: the buzzer)
        else if (it.id === 'rule-max') { if (!c.setRule('maxPlayers', c.rules.maxPlayers >= 8 ? 2 : c.rules.maxPlayers + 1)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-boss') { if (!c.setRule('guestStartsBoss', !c.rules.guestStartsBoss)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-pvp') { if (!c.setRule('pvp', !c.rules.pvp)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-respawn') { if (!c.setRule('guestRespawn', !c.rules.guestRespawn)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-spectate') { if (!c.setRule('bossSpectate', !c.rules.bossSpectate)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-sync') { if (!c.setRule('statSync', !c.rules.statSync)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-follow') { if (!c.setRule('guestsFollow', !c.rules.guestsFollow)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'rule-bossscale') { if (!c.setRule('bossScale', !c.rules.bossScale)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'pin') this.changeCoopPin(i);
        // (the developer's world: its rules - the admin changes them, for everyone at once; the menu shows them as the
        // server says them back)
        else if (it.id === 'wrule-max') { if (!c.setWorldRule('maxPlayers', c.rules.maxPlayers >= 16 ? 2 : c.rules.maxPlayers + 1)) G.audio?.playSystemSe(3); }
        else if (it.id === 'my-pvp') { if (!c.setMyPvp(!c.myPvp)) G.audio?.playSystemSe(3); this.showCoopMenu(i); }
        else if (it.id === 'wrule-spectate') { if (!c.setWorldRule('bossSpectate', !c.rules.bossSpectate)) G.audio?.playSystemSe(3); }
        else if (it.id === 'wrule-scale') { if (!c.setWorldRule('bossScale', !c.rules.bossScale)) G.audio?.playSystemSe(3); }
        else if (it.id === 'wrule-loot') { if (!c.setWorldRule('shareLoot', !c.rules.shareLoot)) G.audio?.playSystemSe(3); }
        else if (it.id === 'admin') this.enterAdminPin(i);
        else this.showCoopMenu(i);             // (the status row: looks again)
      },
      onAdjust: dx => {
        const it = this.list.items[this.list.index];
        if (it?.id === 'wrule-max') {
          if (!c.setWorldRule('maxPlayers', Math.max(2, Math.min(16, c.rules.maxPlayers + dx)))) G.audio?.playSystemSe(3);
          return true;
        }
        if (it?.id !== 'rule-max') return false;
        if (!c.setRule('maxPlayers', Math.max(2, Math.min(8, c.rules.maxPlayers + dx)))) G.audio?.playSystemSe(3);
        this.showCoopMenu(this.list.index);
        return true;
      },
      onCancel: () => this.reopenMain('coop'),
    });
  }
  // the rules of this co-op session (the server's, coop.js rules): rows the host changes, or a guest only reads - and,
  // for the host, the server's join PIN
  coopRuleRows(host) {
    const r = G.coop.rules, desc = host ? tr('고르면 바뀝니다 (서버 규칙, 바로 적용)') : tr('서버 규칙 (호스트가 정함)');
    const rows = [
      { text: tr('최대 인원: {n}명', { n: r.maxPlayers }), id: 'rule-max', desc, enabled: host },
      { text: r.guestStartsBoss ? tr('게스트도 보스전을 먼저 시작할 수 있음') : tr('보스전은 호스트가 먼저 시작'), id: 'rule-boss', desc, enabled: host },
      { text: r.pvp ? tr('PvP: 플레이어끼리 공격할 수 있음') : tr('PvP: 플레이어끼리 공격할 수 없음'), id: 'rule-pvp', desc, enabled: host },
      { text: r.guestRespawn ? tr('게스트가 쓰러지면 화톳불에서 부활') : tr('게스트가 쓰러지면 자기 세계로'), id: 'rule-respawn', desc, enabled: host },
      { text: r.bossSpectate ? tr('보스전에서 쓰러지면 관전') : tr('보스전에서 쓰러져도 관전 없음'), id: 'rule-spectate', desc, enabled: host },
      { text: r.statSync ? tr('스펙 보정: 게스트를 호스트에 맞춤') : tr('스펙 보정 없음'), id: 'rule-sync', desc: this.syncDesc(desc), enabled: host },
      { text: r.guestsFollow ? tr('게스트가 호스트를 따라 맵 이동') : tr('게스트는 맵을 따로 이동'), id: 'rule-follow', desc, enabled: host },
      { text: r.bossScale ? tr('보스 강화: 참가 인원만큼 HP·MP·그로기 증가') : tr('보스 강화 없음'), id: 'rule-bossscale', desc, enabled: host },
    ];
    const pin = host && G.coop.serverPin;
    if (pin) rows.push({ text: tr('접속 PIN: {pin}', { pin }), id: 'pin', desc: tr('고르면 바꿉니다 (지금 와 있는 사람은 그대로)') });
    return rows;
  }
  // (a guest whose numbers are brought to the host's: by how much)
  syncDesc(desc) {
    const f = G.coop.syncFactors?.(), x = v => (v >= 0.01 ? v.toFixed(2) : v.toPrecision(2));
    return f ? tr('내 능력치 ×{p} · HP ×{hp} · MP ×{mp} (장비·서약 제외)', { p: x(f.p), hp: x(f.hp), mp: x(f.mp) }) : desc;
  }
  // (the developer's world) its rules as the server says them: the admin changes them here; the others only read them -
  // and may prove the admin PIN
  worldRuleRows() {
    const c = G.coop, r = c.rules, admin = c.isAdmin;
    const desc = admin ? tr('고르면 바뀝니다 (모두에게 바로 적용)') : tr('서버 규칙 (관리자가 정함)');
    const rows = [
      { text: tr('최대 인원: {n}명', { n: r.maxPlayers }), id: 'wrule-max', desc, enabled: admin },
      { text: r.bossSpectate ? tr('보스전에서 쓰러지면 관전') : tr('보스전에서 쓰러져도 관전 없음'), id: 'wrule-spectate', desc, enabled: admin },
      { text: r.bossScale ? tr('보스 강화: 참가 인원만큼 HP·MP·그로기 증가') : tr('보스 강화 없음'), id: 'wrule-scale', desc, enabled: admin },
      { text: r.shareLoot ? tr('아이템 공유: 누가 얻든 모두가 같이 받음') : tr('아이템 공유 없음 (얻은 사람만)'), id: 'wrule-loot', desc, enabled: admin },
    ];
    if (!admin) rows.push({ text: tr('관리자 PIN 입력'), id: 'admin', desc: tr('규칙을 바꾸려면 서버의 관리자 PIN을 넣으세요') });
    return rows;
  }
  async enterAdminPin(index) {
    const v = await this.askNumber(tr('관리자 PIN'), tr('서버 창(world.log)에 나오는 관리자 PIN (12자리)'), 12, 0, 3);
    if (v !== null) G.coop.adminLogin({ pin: String(v).padStart(12, '0') });
    this.showCoopMenu(index);
  }
  // everyone on this session and where each one is (the map's name)
  coopMembersRow() { return { text: tr('멤버 ({n}명)', { n: G.coop.members().length }), id: 'members', desc: tr('고르면 모두의 위치를 봅니다') }; }
  showCoopMembers(index = 0) {
    const c = G.coop;
    const where = m => (m.map > 0 ? mapName(m.map) || `#${m.map}` : c.role === 'world' ? tr('오프닝·이동 중') : tr('이동 중'));
    const items = c.members().map(m => ({ text: m.me ? tr('{name} (나)', { name: m.name }) : c.muted(m.id) ? tr('{name} (음소거)', { name: m.name }) : m.name,
      right: where(m), desc: m.host ? tr('호스트') : !m.me ? tr('고르면 음소거하거나 아이템·소울을 줄 수 있습니다') : '', id: m.id, me: m.me, name: m.name }));
    this.list.open(tr('멤버'), items, {
      index: Math.min(index, items.length - 1),
      // (the developer's world: another one - give it something; else looks again: where they are now)
      onSelect: (i, it) => { if (!it.me) this.showMemberActions(it.id, it.name, i); else this.showCoopMembers(i); },
      onCancel: () => this.showCoopMenu(0),
    });
  }
  // one of the others picked: mute it (its chat lines and voice - kept by its tag), or (the community server) give it
  // something
  showMemberActions(id, name, back = 0) {
    const c = G.coop, tag = c.chatTag(id), muted = c.muted(id);
    const rows = [{ text: muted ? tr('음소거 풀기') : tr('음소거'), id: 'mute', enabled: !!tag, desc: tr('이 사람의 채팅과 목소리') }];
    if (c.world) rows.push({ text: tr('아이템·소울 주기'), id: 'give' });
    this.list.open(name, rows, {
      onSelect: (i, it) => {
        if (it.id === 'give') { this.showGiveItems(id, name, back); return; }
        const list = (Array.isArray(G.settings.chatMuted) ? G.settings.chatMuted : []).filter(t => t !== tag);
        G.settings.chatMuted = muted ? list : [...list, tag].slice(-100);
        G.saveSettings?.();
        if (!muted) G.voice?.drop(id);
        this.showCoopMembers(back);
      },
      onCancel: () => this.showCoopMembers(back),
    });
  }
  // (the developer's world) what of this bag may be given to that one: its things (not the key items), weapons and
  // armor not worn - one picked, how many, and it is asked
  showGiveItems(to, name, back = 0) {
    const c = G.coop, P = G.state.party, rows = [];
    if (P.gold > 0) rows.push({ text: tr('소울'), right: P.gold.toLocaleString(), kind: 'gold', id: 0, n: P.gold });
    for (const kind of ['item', 'weapon', 'armor']) {
      for (const [id, n] of [...P.container(kind)].sort((x, y) => x[0] - y[0])) {          // (by number, as the item lists)
        if (n > 0 && c.giveable(kind, id)) { const d = itemData(kind, id); rows.push({ text: d.name, icon: d.icon_index, right: String(n), desc: d.description, kind, id, n }); }
      }
    }
    if (!rows.length) { this.toast(tr('줄 수 있는 것이 없습니다')); this.showCoopMembers(back); return; }
    this.list.open(tr('{name} 님에게 줄 것', { name }), rows, {
      onSelect: async (i, it) => {
        let n = 1;
        if (it.n > 1) {
          const max = Math.min(c.giveMax(it.kind), it.n);
          const v = await this.askNumber(it.kind === 'gold' ? tr('얼마를 줄까요?') : tr('몇 개를 줄까요?'), `${it.text} (${it.n})`, String(max).length, 1);
          if (v === null || v < 1) { this.showGiveItems(to, name, back); return; }
          n = Math.min(v, max);
        }
        if (c.giveItem(to, it.kind, it.id, n)) this.toast(tr('{name} 님에게 보냈습니다 (받으면 옮겨집니다)', { name }));
        else G.audio?.playSystemSe(3);
        this.showCoopMembers(back);
      },
      onCancel: () => this.showCoopMembers(back),
    });
  }
  // (the developer's world - coop.js) how this player comes in: from the beginning (the opening alone, into the world at
  // its first bonfire), a save of this game's own (its character), or one of its community-server saves (kept on this PC
  // apart from the game's own) - always at 도서관의 꿈
  async showWorldStart() {
    const c = G.coop;
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    const kept = (await G.listSaves?.('world')) || [];
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    this.menuOpen = true;
    this.placeRoot(true);
    this.list.open(tr('커뮤니티 서버 {d}', { d: c.worldName() }), [
      { text: tr('처음부터'), id: 'new', desc: tr('오프닝을 혼자 진행하고, 도서관의 꿈에 오면 세계에 들어갑니다') },
      { text: tr('세이브 불러오기'), id: 'own', desc: tr('내 세이브의 캐릭터로 들어갑니다') },
      { text: tr('서버 세이브 불러오기'), id: 'world', desc: tr('커뮤니티 서버 세이브로 이어서 합니다'), enabled: kept.length > 0 },
    ], {
      onSelect: (i, it) => {
        if (it.id === 'new') { this.closeMenu(); c.worldNew(); } else this.showWorldLoad(it.id);
      },
      onCancel: () => { c.end('menu'); this.closeMenu(); },
    });
  }
  async showWorldLoad(kind) {
    const c = G.coop, items = [];
    if (kind === 'world') {
      for (const s of ((await G.listSaves?.('world')) || []).sort((a, b) => a.slot - b.slot)) {
        const m = G.saveMeta(s.meta);
        items.push({ text: `${s.slot === 0 ? tr('오토') : tr('슬롯 {n}', { n: s.slot })}  ${s.meta?.map || ''}`, right: m.date, desc: m.desc, slot: s.slot, kind: 'world' });
      }
    } else {
      for (const s of ((await G.listSaves?.('vr')) || []).sort((a, b) => a.slot - b.slot)) {
        const m = G.saveMeta(s.meta);
        items.push({ text: `VR ${s.slot === 0 ? tr('오토') : tr('슬롯 {n}', { n: s.slot })}  ${s.meta?.map || ''}`, right: m.date, desc: m.desc, slot: s.slot, kind: 'vr' });
      }
      for (const s of (await G.listRmSaves?.()) || []) items.push({ text: `${tr('원작')} ${s.label}  ${s.map}`, right: String(s.time), rm: s });
    }
    if (c.role !== 'world' || c.wphase !== 'choosing') return;
    if (!items.length) { G.audio?.playSystemSe(3); this.showWorldStart(); return; }
    this.list.open(kind === 'world' ? tr('서버 세이브 불러오기') : tr('세이브 불러오기'), items, {
      onSelect: async (i, it) => {
        const st = it.rm ? G.stateOfRm(it.rm.contents, it.rm.label) : await G.loadSave(it.slot, it.kind);
        if (c.role !== 'world' || c.wphase !== 'choosing') return;
        this.closeMenu();
        c.worldLoad(st);
      },
      onCancel: () => this.showWorldStart(),
    });
  }
  // this player's name (as the others see it) and whether the others' are shown over their heads
  coopSelfRows() {
    const c = G.coop;
    return [
      { text: c.hasName() ? tr('내 이름: {name}', { name: c.myName() }) : tr('내 이름: (정해 주세요)'), id: 'name', desc: tr('다른 플레이어에게 보이는 이름 (영어) - 고르면 바꿉니다') },
      { text: G.settings.coopNames === false ? tr('다른 플레이어 이름: 숨김') : tr('다른 플레이어 이름: 머리 위에 표시'), id: 'names', desc: tr('고르면 바뀝니다') },
      { text: tr('채팅·음성'), id: 'chat', right: VOICE_LABEL()[G.voice?.mode || 'off'], desc: tr('채팅 보내기·기록, 음성 채팅과 마이크') },
    ];
  }
  coopBanRow() {
    const n = G.coop.bans().length;
    return { text: tr('차단 목록 ({n}명)', { n }), id: 'bans', desc: tr('내 세계에 들어올 수 없는 사람 (고르면 차단 풀기)'), enabled: n > 0 };
  }
  // (an old game's hero may have no English name yet: the name the others will see, first)
  async coopNameFirst() {
    const c = G.coop;
    if (c.hasName()) return true;
    const v = await this.askText(tr('내 이름 (다른 플레이어에게 보임)'), '', NAME_LEN);
    if (!this.menuOpen) return false;
    if (v === null || !c.setMyName(v)) { this.showCoopMenu(0); return false; }
    return true;
  }
  async changeCoopName(index) {
    const c = G.coop;
    const v = await this.askText(tr('내 이름'), c.hasName() ? c.myName() : '', NAME_LEN);
    if (!this.menuOpen) return;
    if (v !== null && !c.setMyName(v)) G.audio?.playSystemSe(3);
    this.showCoopMenu(index);
  }
  // (host) the guests in this world - each one sent away, or banned
  showCoopPlayers(index = 0) {
    const c = G.coop;
    const items = c.guests().map(p => ({ text: c.nameOf(p.id), right: c.tagOf(p.id) ? `#${c.tagOf(p.id).slice(0, 4)}` : '', id: p.id, desc: tr('고르면 내보내거나 차단합니다') }));
    if (!items.length) { this.showCoopMenu(0); return; }
    this.list.open(tr('와 있는 사람'), items, {
      index,
      onSelect: (i, it) => this.coopPlayerAct(it.id, it.text, i),
      onCancel: () => this.showCoopMenu(0),
    });
  }
  coopPlayerAct(id, name, index) {
    const c = G.coop;
    this.list.open(name, [
      { text: tr('내보내기'), id: 'kick', desc: tr('지금 자기 세계로 돌려보냅니다 (다시 들어올 수 있음)') },
      { text: tr('차단하기'), id: 'ban', desc: tr('자기 세계로 돌려보내고, 다시는 들어오지 못하게 합니다 (차단 목록)') },
      { text: tr('취소'), id: 'back' },
    ], {
      onSelect: (i, it) => {
        if (it.id === 'back') { this.showCoopPlayers(index); return; }
        if (!c.kick(id, it.id === 'ban')) G.audio?.playSystemSe(3);
        this.showCoopMenu(0);
      },
      onCancel: () => this.showCoopPlayers(index),
    });
  }
  // this player's list of the banned (kept in its settings): each one may be let in again
  showCoopBans(index = 0) {
    const c = G.coop, list = c.bans();
    if (!list.length) { this.showCoopMenu(0); return; }
    const items = list.map(b => ({ text: cleanName(b.name) || '?', right: `#${b.tag.slice(0, 4)}`, id: b.tag,
      desc: tr('{date} 차단 · 고르면 차단을 풉니다', { date: new Date(b.at || 0).toLocaleDateString() }) }));
    this.list.open(tr('차단 목록'), items, {
      index,
      onSelect: (i, it) => {
        this.list.open(it.text, [{ text: tr('차단 풀기'), id: 'unban', desc: tr('다시 내 세계에 들어올 수 있습니다') }, { text: tr('취소'), id: 'back' }], {
          onSelect: (_, a) => { if (a.id === 'unban') c.unban(it.id); this.showCoopBans(Math.max(0, a.id === 'unban' ? i - 1 : i)); },
          onCancel: () => this.showCoopBans(i),
        });
      },
      onCancel: () => this.showCoopMenu(0),
    });
  }
  // (host) a new join PIN for the server, in the game's own number input
  async changeCoopPin(index) {
    const v = await this.askNumber(tr('새 접속 PIN'), tr('친구들이 넣을 새 접속 PIN (6자리)'), 6, +(G.coop.serverPin || 0));
    if (v !== null && !G.coop.setPin(String(v).padStart(6, '0'))) G.audio?.playSystemSe(3);
    this.showCoopMenu(index);
  }
  // the rules changed (coop.js): the co-op menu, if it is up, shows them as they are now
  refreshCoopMenu() {
    if (this.menuOpen && this.list.visible && this.list.title === tr('협력') && !this.msg) this.showCoopMenu(this.list.index);
  }
  // why the last try did not work, in the co-op menu's line
  coopNote(why, server) {
    if (!why) return '';
    if (why === 'no server') return server?.local ? tr('이 PC의 협력 서버가 꺼져 있습니다 (coop_server를 먼저 켜 주세요)') : tr('서버에 닿지 않습니다 (주소·포트, 서버가 켜져 있는지 확인)');
    if (why === 'denied pin') return tr('PIN이 맞지 않습니다');
    if (why === 'denied full' || why === 'full') return tr('그 세계에는 더 들어갈 수 없습니다 (인원이 다 찼습니다)');
    if (why === 'denied host') return tr('그 서버에는 이미 세계를 연 사람이 있습니다');
    if (why === 'no host') return tr('그 서버에 아직 세계를 연 사람이 없습니다');
    if (why === 'version') return tr('VR 모드 버전이 서로 다릅니다 (모두 같은 버전으로 업데이트하세요)');
    if (why === 'game') return tr('게임 판본(버전·번역)이 서로 다릅니다');
    if (why === 'denied blocked') return tr('PIN을 여러 번 틀려 이 주소가 잠시(10분) 막혔습니다');
    if (why === 'server closed') return tr('서버와의 연결이 끊겼습니다');
    if (why === 'denied kicked' || why === 'kicked') return tr('호스트가 내보냈습니다');
    if (why === 'denied banned' || why === 'banned') return tr('그 세계의 호스트가 차단했습니다');
    if (why === 'denied game') return tr('커뮤니티 서버의 세계와 게임 판본이 다릅니다');
    if (why === 'denied version' || why === 'not world' || why === 'world') return tr('커뮤니티 서버와 이 게임의 버전이 다릅니다');
    return tr('연결하지 못했습니다');
  }
  // 채팅·음성: a line to everyone (the chat keyboard - PC: the / key too), the log (lines, who came and went), voice -
  // off, listen only, or talk too (only then is the microphone open, and only in a session) -, which microphone, how
  // loud the others are
  async showChatMenu(index = 0) {
    const s = G.settings, mics = await G.voice.devices();
    if (!this.menuOpen) return;
    // (the one picked by its name - kept with the setting too: the browser may not be naming them yet)
    const micLabel = s.voiceDevice ? mics.find(d => d.id === s.voiceDevice && d.named)?.label || s.voiceDeviceLabel || tr('기본 장치') : tr('기본 장치');
    const vol = Math.max(0, Math.min(2, s.voiceVolume ?? 1));
    const MODES = ['off', 'listen', 'talk'];
    const step = (id, dx) => {
      if (id === 'voice') { s.voice = MODES[(MODES.indexOf(G.voice.mode) + dx + 3) % 3]; G.voice.retry(); }
      else if (id === 'vol') s.voiceVolume = Math.round(Math.max(0, Math.min(2, vol + dx * 0.1)) * 10) / 10;
      else if (id === 'toasts') s.chatToasts = s.chatToasts === false;
      G.saveSettings?.();
    };
    const items = [
      { text: tr('채팅 보내기'), id: 'send', enabled: G.chat.on, desc: tr('한 줄을 모두에게 보냅니다 (PC: / 키)') },
      { text: tr('채팅 기록 ({n})', { n: G.chat.log.length }), id: 'log', enabled: G.chat.log.length > 0, desc: tr('채팅, 들어오고 나간 사람, 보스 처치') },
      { text: tr('채팅 알림'), id: 'toasts', right: s.chatToasts === false ? tr('끔') : tr('켬'), desc: tr('받은 채팅을 말풍선과 함께 알림으로도 띄웁니다') },
      { text: tr('음성 채팅'), id: 'voice', right: VOICE_LABEL()[G.voice.mode], desc: tr('말하기를 고른 동안, 함께하는 중에만 마이크가 열립니다') },
      { text: tr('마이크'), id: 'mic', right: clipText(micLabel, 22), desc: tr('눌러서 장치 목록에서 고릅니다') },
      { text: tr('음성 크기'), id: 'vol', right: `${Math.round(vol * 100)}%`, desc: tr('다른 사람 목소리 크기 (좌우로 조절)') },
    ];
    this.list.open(tr('채팅·음성'), items, {
      index,
      onSelect: (i, it) => {
        if (it.id === 'send') G.chat.openKeyboard(() => { if (this.menuOpen) this.showChatMenu(0); });
        else if (it.id === 'log') this.showChatLog();
        else if (it.id === 'mic') this.showMicList();
        else { step(it.id, 1); this.showChatMenu(i); }
      },
      onAdjust: dx => {
        const i = this.list.index, it = items[i];
        if (!it || it.id === 'send' || it.id === 'log' || it.id === 'mic') return false;
        step(it.id, dx);
        this.showChatMenu(i);
        return true;
      },
      onCancel: () => this.showCoopMenu(),
    });
  }
  // 채팅·음성 → 마이크: the devices by name, the one in use marked - shown at once; with none named yet (the browser names them
  // only once the page may use a microphone) it is asked, and the list comes again named when it answers (coopvoice.js)
  async showMicList() {
    const title = tr('마이크');
    const show = mics => {
      const s = G.settings, cur = s.voiceDevice || '', inUse = id => (id === cur ? tr('사용 중') : '');
      const rows = [{ text: tr('기본 장치'), id: '', right: inUse(''), desc: tr('시스템에서 기본으로 정한 마이크') },
        ...mics.map(d => ({ text: clipText(d.label, 30), id: d.id, label: d.label, right: inUse(d.id), desc: tr('이 마이크로 말합니다') }))];
      const index = Math.max(0, rows.findIndex(r => r.id === cur));
      this.list.open(title, rows, {
        index: this.list.visible && this.list.title === title ? this.list.index : index,
        onSelect: (i, it) => {
          s.voiceDevice = it.id;
          if (it.id) s.voiceDeviceLabel = it.label; else delete s.voiceDeviceLabel;
          G.voice.retry(); G.saveSettings?.();
          this.showChatMenu(4);
        },
        onCancel: () => this.showChatMenu(4),
      });
    };
    const mics = await G.voice.devices();
    if (!this.menuOpen) return;
    show(mics);
    if (mics.some(d => d.named)) return;
    const named = await G.voice.devices(true);
    if (this.menuOpen && this.list.visible && this.list.title === title) show(named);
  }
  showChatLog() {
    const rows = G.chat.log.map(e => ({ text: G.chat.lineOf(e), desc: new Date(e.t).toLocaleTimeString() }));
    this.list.open(tr('채팅 기록'), rows, { index: rows.length - 1, onSelect: () => {}, onCancel: () => this.showChatMenu(1) });
  }
  // the servers met before (settings), and a new one
  showCoopServers(mode) {
    const list = Array.isArray(G.settings.coopServers) ? G.settings.coopServers : [];
    const usable = list.filter(s => mode !== 'host' || s.hostPin);
    const items = usable.map(s => ({ text: `${s.ip}:${s.port}`, id: 'go', server: s, desc: mode === 'host' ? tr('호스트 PIN으로 이 서버에 내 세계를 엽니다') : tr('이 서버로 들어갑니다') }));
    items.push({ text: tr('새 서버 추가 (IP·포트·PIN 입력)'), id: 'add' });
    if (list.length) items.push({ text: tr('목록 비우기'), id: 'clear' });
    this.list.open(mode === 'host' ? tr('내 세계를 열 서버') : tr('들어갈 서버'), items, {
      onSelect: (i, it) => {
        if (it.id === 'go') this.coopConnect(mode, it.server);
        else if (it.id === 'add') this.addCoopServer(mode);
        else if (it.id === 'clear') { G.settings.coopServers = []; G.saveSettings?.(); this.showCoopServers(mode); }
      },
      onCancel: () => this.showCoopMenu(),
    });
  }
  coopConnect(mode, server) {
    if (mode === 'host') G.coop.openWorld(server); else G.coop.visit(server);
    this.closeMenu();
  }
  // a new server, in the game's own number input: its IP (four groups of three digits), port and PIN (and, to host
  // on it, its host PIN); it goes to the top of the list
  async addCoopServer(mode) {
    const ip = await this.askNumber(tr('서버 주소 (IP)'), tr('서버의 IP 주소를 세 자리씩 넣어 주세요'), 12, 0, 3);
    if (ip === null) { this.showCoopServers(mode); return; }
    const oct = String(ip).padStart(12, '0').match(/.../g).map(Number);
    if (oct.some(o => o > 255) || !oct[0]) { G.audio?.playSystemSe(3); this.addCoopServer(mode); return; }
    const port = await this.askNumber(tr('포트'), tr('서버의 포트 번호'), 5, G.coop.defaultPort);
    if (port === null) { this.showCoopServers(mode); return; }
    if (port < 1024) { G.audio?.playSystemSe(3); this.showCoopServers(mode); return; }
    const pin = await this.askNumber('PIN', tr('서버의 접속 PIN (6자리)'), 6, 0);
    if (pin === null) { this.showCoopServers(mode); return; }
    let hostPin = '';
    if (mode === 'host') {
      const hp = await this.askNumber(tr('호스트 PIN'), tr('서버의 호스트 PIN (6자리)'), 6, 0);
      if (hp === null) { this.showCoopServers(mode); return; }
      hostPin = String(hp).padStart(6, '0');
    }
    const server = { ip: oct.join('.'), port, pin: String(pin).padStart(6, '0'), hostPin };
    const list = Array.isArray(G.settings.coopServers) ? G.settings.coopServers : [];
    const same = s => `${s.ip}:${s.port}` === `${server.ip}:${server.port}`;
    const kept = list.find(same), old = list.filter(s => !same(s));
    if (!hostPin && kept?.hostPin) server.hostPin = kept.hostPin;    // (a host PIN given before is kept)
    G.settings.coopServers = [server, ...old].slice(0, 8);
    G.saveSettings?.();
    this.coopConnect(mode, server);
  }
  // the community servers this player added (settings: { ip, port, pin } each, the newest first)
  communityServers() {
    const ok = s => s && /^\d{1,3}(\.\d{1,3}){3}$/.test(s.ip) && s.port >= 1024 && s.port <= 65535 && /^\d{6}$/.test(s.pin);
    return (Array.isArray(G.settings.communityServers) ? G.settings.communityServers : []).filter(ok);
  }
  // a community server someone runs (community_server.cmd - world_server.py), in the game's own number input as a co-op
  // server's: its IP, port (28472 unless its owner changed it) and PIN; it goes to the top of the list and is joined
  async addCommunityServer() {
    const ip = await this.askNumber(tr('서버 주소 (IP)'), tr('서버의 IP 주소를 세 자리씩 넣어 주세요'), 12, 0, 3);
    if (ip === null) { this.showCoopMenu(); return; }
    const oct = String(ip).padStart(12, '0').match(/.../g).map(Number);
    if (oct.some(o => o > 255) || !oct[0]) { G.audio?.playSystemSe(3); this.addCommunityServer(); return; }
    const port = await this.askNumber(tr('포트'), tr('서버의 포트 번호'), 5, WORLD_PORT);
    if (port === null) { this.showCoopMenu(); return; }
    if (port < 1024) { G.audio?.playSystemSe(3); this.showCoopMenu(); return; }
    const pin = await this.askNumber('PIN', tr('서버의 접속 PIN (6자리)'), 6, 0);
    if (pin === null) { this.showCoopMenu(); return; }
    const server = { ip: oct.join('.'), port, pin: String(pin).padStart(6, '0') };
    const same = s => `${s.ip}:${s.port}` === `${server.ip}:${server.port}`;
    G.settings.communityServers = [server, ...this.communityServers().filter(s => !same(s))].slice(0, 8);
    G.saveSettings?.();
    if (G.coop.joinWorld(server)) this.closeMenu(); else this.showCoopMenu();
  }
  // a name in the game's keyboard (English): resolves to it, or null when cancelled
  askText(title, value = '', max = NAME_LEN) {
    this.list.close();
    this.placeRoot(true);
    return new Promise(resolve => {
      this.keyboard.open(title, value, max, {
        onDone: v => { this.keyboard.close(); resolve(v); },
        onCancel: () => { this.keyboard.close(); resolve(null); },
      });
    });
  }
  // a chat line in the chat keyboard: resolves to it, or null - from a menu, or (the emote ring) over the game, holding it
  // as a scene while it is up
  askChat(title, max) {
    this.list.close();
    this.placeRoot(true);
    const own = !this.menuOpen && !this.sceneOpen;
    if (own) this.sceneOpen = 'chat';
    return new Promise(resolve => {
      const done = v => { this.chatKeyboard.close(); if (own && this.sceneOpen === 'chat') this.sceneOpen = null; this.consumedConfirm = true; resolve(v); };
      this.chatKeyboard.open(title, '', max, { onDone: v => done(v), onCancel: () => done(null) });
    });
  }
  // Name Input (303) for the hero: typed in the keyboard (English) - the hero's name, and this player's in co-op (the
  // co-op menu changes that one later); it must be given one (the original's has no cancel). The event's length counts
  // the original's full-width letters (the prologue's: 4): English ones take half the room - twice as many
  openNameInput(actor, max) {
    this.sceneOpen = 'name';
    this.placeRoot(true);
    this.keyboard.open(tr('이름'), cleanName(actor.name), Math.max(1, Math.min(NAME_LEN, (max || 8) * 2)), {
      onDone: v => { actor.name = v; G.coop?.setMyName(v); this.keyboard.close(); this.sceneOpen = null; },
    });
  }
  // the game's number input (as Input Number shows it), for a number of this layer: resolves to the number, or null
  askNumber(title, prompt, digits, value = 0, group = 0) {
    this.list.close();
    return new Promise(resolve => {
      this.showMessage({ face: '', lines: [prompt], position: 2, number: {
        digits, value, code: true, group, title, cursor: digits - 1,
        onDone: v => resolve(v), onCancel: () => resolve(null),
      } });
    });
  }
}
