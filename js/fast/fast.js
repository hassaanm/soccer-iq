// Fast mode: a real-time match in which he is one player the whole time and acts by tapping the field (the owner's
// spec, v84). The Slow game stays as it is; this runs instead of it while FAST.on (js/main.js hands it the frames,
// js/ui/input.js leaves it the touches). What he meets:
//  - The game's own view from behind and above his player (rules.js camSpec), looking at the ball when he does not
//    have it and at the goal he attacks when he does, never off the pitch (rules.js clampYaw).
//  - (v93, D2) Spots on the grass at fixed places (rules.js spotSet; drawn by marks.js fixed): a tap goes to one (a tap
//    near one counts as it; far from all of them it does nothing). They stay where they are while he runs (the chosen
//    one lit, the rest faint: one tap changes his mind); a new set comes when he gets there, gets the ball, stops a
//    while or the ball changes hands. With the ball he keeps it at his feet (match.js meTo).
//  - A tap on a friend he can see passes (with the ball). The pass is a real ball (match.js). A tap on their carrier
//    presses him; on a loose ball, goes to it.
//  - The ball comes to him: his head goes down (the narrow view, the dark edge); LOOK UP, or a drag, lifts it.
//  - A finger held down slows the world (HOLD) for as long as it stays down; moving it turns his head (over the pitch
//    only). Let go and the view eases back.
//  - The avatar (top right) pauses and lets him change his player.
// Play runs at BASE of real speed. First to GOALS wins; play() resolves with the counts.
import * as THREE from 'three';
import { world, game, canvas } from '../ui/stage.js';
import { hud, hudEl } from '../ui/hud.js';
import { say } from '../ui/speech.js';
import { sfx } from '../sound.js';
import { Sim } from '../sim.js';
import { PITCH, TEAM, sizeOf } from '../geom.js';
import { held, setPause, onPause, later } from '../pause.js';
import { FAST, FAST_GOALS } from './state.js';
import { Match } from './match.js';
import { makeMarks, shirt } from './marks.js';
import * as R from './rules.js';
import { shotResult, spaces, zoneGrade, rightFoot, EDGE as SHOT_EDGE } from '../shot.js';
import { MOVE_NAME } from '../flair.js';
import { matchShot, SAID } from '../saves.js';

export const CAM_TURN = 2.6; // rad/s (v89 integration: fast.js camNow)
const turnTgt = (c, a) => { const dx = c.tgt[0] - c.eye[0], dy = c.tgt[1] - c.eye[1], co = Math.cos(a), si = Math.sin(a); c.tgt[0] = c.eye[0] + dx * co - dy * si; c.tgt[1] = c.eye[1] + dx * si + dy * co; };
export const TURN_MAX = R.TURN_MAX, SCAN_T = 12, CUE_EVERY = 60, CUES = 4, NEXT_WINS = 210, END_S = 420; // (s of play: after NEXT_WINS the next goal wins; at END_S it ends as it stands)
export const AIM_SLOW = .2, AIM_S = 7, SPOT_STALE = 2.5; // (v93: while he aims the world goes on at AIM_SLOW (not stopped: one of theirs near him can still take it); the aim ends after AIM_S real s; standing still, a new set of spots after SPOT_STALE real s)
export const BASE = .75, HOLD = .18, GOALS = FAST_GOALS, HOLD_MS = R.HOLD_S * 1000, RUN_TURN = .25, BACK_S = .6, VIEW_BACK = 1;
const SLIDE = 12; // px a finger may wobble and still be a tap

const $ = s => document.querySelector(s);
function el(tag, attrs = {}, html = '') { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; }
const press = (b, f) => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.isPrimary === false) return; f(e); }); // (a second finger or a palm does nothing)

class Fast {
  constructor() {
    this.on = false; this.sim = new Sim(); this.cam = { eye: [16, -10, 10], tgt: [16, 11, 0], Ff: .9, Fw: .5 }; this.ui = { glow: {}, clock: 0, lines: null, aims: null };
    this.m = null; this.calm = true; this.dom = null; this.marks = null;
  }
  // ---------- the page ----------
  build() {
    if (this.dom) return;
    const box = el('div', { id: 'fastHud' }, `
      <button id="fAvatar" class="btn btn-glass btn-icon" type="button" aria-label="Change your player"></button>
      <button id="fLook" class="btn btn-gold btn-round" type="button" aria-label="Look up"><i>👀</i><span>LOOK UP</span></button>
      <button id="fAct" class="btn btn-gold btn-round fActB" type="button"><svg class="pic" viewBox="0 0 100 100" aria-hidden="true"></svg><i></i><span></span></button>
      <button id="fAct2" class="btn btn-gold btn-round fActB" type="button"><svg class="pic" viewBox="0 0 100 100" aria-hidden="true"></svg><i></i><span></span></button>
      <div id="fHold" aria-hidden="true"><i>✋</i><b>⏳</b></div>
      <div id="fSlow" aria-hidden="true"></div><div id="fChevL" class="fChev" aria-hidden="true">‹‹</div><div id="fChevR" class="fChev" aria-hidden="true">››</div>
      <div id="fNext" aria-hidden="true"><i>⚽</i><b>➜</b><i>🏆</i></div>
      <div id="fCue" aria-hidden="true"><i>👀</i><b>↔</b></div>
      <div id="fPic" aria-hidden="true"></div>
      <div id="fChips">${'<button class="fChip" type="button" aria-label="A friend you saw"><span class="ptr"></span><span class="pic"></span></button>'.repeat(4)}</div>`);
    hudEl.appendChild(box); hudEl.appendChild(el('div', { id: 'fSheet', class: 'hidden' }, '<div class="fCard"><div class="fRow"></div></div>')); // (the sheet: also before play, while the rest is hidden)
    this.dom = { box, cue: $('#fCue'), avatar: $('#fAvatar'), look: $('#fLook'), act: $('#fAct'), act2: $('#fAct2'), hold: $('#fHold'), sheet: $('#fSheet'), row: $('#fSheet .fRow'), tunnel: $('#tunnel') };
    // LOOK UP and the action button act as the finger goes down, at once (a press that starts on them never slows the
    // world); a chip acts as a tap and, held, slows the world like a press anywhere (rules.js pressKind).
    press(this.dom.look, () => { if (!this.on || held.on) return; this.lookUp(true); this.acted('look'); });
    this.dom.chips = [...box.querySelectorAll('.fChip')].map(b => { const c = { b, id: null, key: '', tf: '', o: -1 }; press(b, e => this.down(e, () => { if (c.id && c.tap) { this.passTo(c.id); this.stats.chipPasses++; } })); return c; });
    press(this.dom.avatar, () => { if (!this.on || this.m?.over) return; if (!held.on) setPause(true, 'button'); this.openSheet(id => { this.setMe(id); setPause(false); }); });
    press(this.dom.act, () => { if (!this.on || held.on) return; this.action(0); });
    press(this.dom.act2, () => { if (!this.on || held.on) return; this.action(1); });
    this.marks = makeMarks(world);
    canvas.addEventListener('pointerdown', e => this.down(e));
    // a touch the page lost (the app hidden, the window left): drop it, so the next one works
    const lost = () => this.dropFinger(); addEventListener('blur', lost); addEventListener('pagehide', lost); document.addEventListener('visibilitychange', lost);
    onPause(on => { if (on && this.on) this.resetTransient(); }); // (the big play button is placed by js/ui/pause.js place, clear of his player: v89 integration)
    this.dom.pic = $('#fPic');
    addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => this.up(e, true));
  }
  ids() { return this.m ? this.m.usIds : ['hero', 'm1', 'm2', 'm3'].slice(0, sizeOf().out); }
  player(id) { return this.us.players[id === 'hero' ? 0 : +id.slice(1)]; }
  // The team as shirts: a tap picks one (before the match, and from the avatar button).
  openSheet(done) {
    const d = this.dom; d.row.innerHTML = this.ids().map(id => `<button class="btn btn-glass fPick${id === this.me ? ' me' : ''}" type="button" data-id="${id}">${shirt(this.us, this.player(id).num, 66)}<b>${this.player(id).name.split(' ').pop()}</b></button>`).join('');
    for (const b of d.row.querySelectorAll('.fPick')) press(b, () => { d.sheet.classList.add('hidden'); hudEl.classList.remove('fpicking'); done(b.dataset.id); });
    d.sheet.classList.remove('hidden'); hudEl.classList.add('fpicking');
  }
  pick(us) { this.build(); this.us = us; this.me = this.me && this.ids().includes(this.me) ? this.me : 'hero'; return new Promise(res => this.openSheet(id => { this.me = id; res(id); })); }
  setMe(id) {
    const m = this.m; if (!m || id === this.me) { this.drawAvatar(); return; }
    this.resetTransient();
    m.cmd.delete(this.me); this.me = m.me = m.favor = id; m.meMove = null; m.roles = null;
    this.yaw = this.natural(); this.vw = null; this.drawAvatar(); this.lookUp(true); this.stats.swaps++;
    game.plog?.('fast', { is: 'swap', me: id });
  }
  drawAvatar() { this.dom.avatar.innerHTML = shirt(this.us, this.player(this.me).num, 40); }

  // ---------- a match ----------
  // opts: { us, them, level (the other team's strength, his own: js/fast/level.js; none: match.js LEVELS) }. Resolves
  // with the counts when one side has GOALS.
  play({ us, them, level }) {
    this.build(); this.us = us; this.them = them;
    const size = sizeOf(), sim = this.sim = new Sim();
    sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx(v >= 14 ? 'shot' : 'kick'); } else if (ev === 'touch') world.fx('touch'); };
    const m = this.m = new Match({ size: TEAM.size, sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: size.out, keepers: !!size.keeper, level, fx: ev => world.fx(ev), sfx: n => sfx(n) });
    m.me = m.favor = this.me || 'hero'; this.me = m.me;
    m.setup('us'); m.kickoff('us');
    this.real = 0; this.slow = this.slowTo = BASE; this.look = 1; this.up1 = true; this.yaw = 0; this.holdYaw = null; this.holdT = 0; this.finger = null; this.holding = false;
    this.ui.clock = 0; this.ui.glow = {}; this.ui.aims = null; this.ui.lines = null; this.warnAt = null; this.warnT = 0; this.over = false;
    this.seen = {}; this.chipsKey = null; this.lastAct = 0; this.hinted = null; this.hintAt = 0; this.hintCounted = false; this.goAt = null; this.edgeO = -1; this.edgeT = '';
    this.dom.look.classList.remove('show'); this.dom.cue.classList.remove('show'); this.dom.pic.classList.remove('show');
    this.aiming = false; this.ui.ballGlow = false; this.actKind = null; this.actKey = ''; this.skillOpts = null; this.skT = -9; m.meAuto = false; // (he wins a tackle with STEAL, not by standing there)
    this.set = null; this.chosen = null; this.shotAt = null; this.dom.act2.classList.remove('show');
    this.stats = { keeperTurns: 0, saves: 0, cues: 0, shots: 0, shotGoals: 0, steals: 0, stealMiss: 0, spentTaps: 0, skills: 0, deadTaps: 0, spotTaps: 0, presses: 0, sets: 0, shotEnds: [], chipPasses: 0, played: 0, slowT: 0, holdT: 0, holds: 0, actions: 0, looks: 0, taps: 0, swaps: 0, camN: 0, camBall: 0, camGoal: 0, frames: [], work: [], downs: 0, headDownT: 0 };
    this.yaw = this.natural(); this.vw = null; this.camNow(1);
    hud.state({ phase: 'idle', mode: 'fast' }); hud.caption(''); hud.score(m.score, us, them);
    game.mode = 'fast'; this.drawAvatar(); this.dom.box.classList.add('on'); this.dom.hold.classList.add('show');
    FAST.on = this.on = true; this.calm = true;
    m.on.gain = (id, how) => this.gained(id, how);
    m.on.goal = team => this.goal(team);
    m.on.warn = k => { this.warnAt = k; this.warnT = this.real + 1.6; sfx('ping'); };
    m.on.theirShot = (id, res) => this.keeperTurn(id, res);
    m.on.cutOut = f => { if (f.me) this.showPic('<i class="cut">⚽</i><i>✋</i>'); }; // (his pass cut out: a ball and a stopping hand, not the skill's picture)
    m.on.shotEnd = (f, how, by) => this.shotEnd(f, how, by);
    this.lastScan = 0; this.cueT = -99; this.kBusy = false; this.kClear = 0; this.sudden = false; this.dom.box.querySelector('#fNext').classList.remove('show');
    m.on.lost = was => { if (was === this.me) { this.lookUp(true); say('Where is the ball?'); } };
    game.plog?.('fast', { is: 'start', size: TEAM.size, me: this.me, us: us.id, them: them.id, level: m.level });
    return new Promise(res => { this.done = res; });
  }
  stop() {
    if (this.dom) this.resetTransient();
    for (const k of ['look', 'cue', 'pic']) this.dom?.[k]?.classList.remove('show'); this.dom?.box.querySelector('#fNext')?.classList.remove('show');
    FAST.on = this.on = false; this.marks?.hide(); this.dom?.box.classList.remove('on'); this.dom?.sheet.classList.add('hidden'); hudEl.classList.remove('fpicking');
    const t = this.dom?.tunnel; if (t) { t.style.opacity = 0; t.classList.remove('on'); t.style.transform = ''; }
    this.ui.glow = {}; this.ui.aims = null; this.ui.ballGlow = false; this.aiming = false; this.dom?.act.classList.remove('show'); this.dom?.act2.classList.remove('show'); this.actKind = null; this.actKey = ''; this.finger = null; this.holding = false; this.dom?.box.classList.remove('slowing'); this.set = null; this.chosen = null;
    for (const d of this.dom?.chips || []) { d.o = 0; d.b.style.opacity = 0; d.b.style.pointerEvents = 'none'; }
  }
  counts() {
    const m = this.m, c = m.count, all = Object.values(c.touches).reduce((a, b) => a + b, 0);
    return { score: { ...m.score }, touches: c.touches[this.me] || 0, teamTouches: all, share: all ? +((c.touches[this.me] || 0) / all).toFixed(2) : 0, passes: c.passes, good: c.arrived, cut: c.cut, goals: c.goals, steals: c.steals, lost: c.lost,
      time: Math.round(this.stats.played), actions: this.stats.actions, deadTaps: this.stats.deadTaps, spotTaps: this.stats.spotTaps, shots: this.stats.shots, skills: this.stats.skills, stealMiss: this.stats.stealMiss, spentTaps: this.stats.spentTaps, keeperTurns: this.stats.keeperTurns, saves: this.stats.saves, cues: this.stats.cues, chipPasses: this.stats.chipPasses, holds: this.stats.holds, slowS: +this.stats.slowT.toFixed(1), looks: this.stats.looks,
      pitch: this.stats.shares?.length ? this.stats.shares.slice().sort((a, b) => a - b)[this.stats.shares.length >> 1] : null, shareLowMaxS: +(this.stats.lowMax || 0).toFixed(1), share65MaxS: +(this.stats.low65Max || 0).toFixed(1), shareUnder60: this.stats.shares?.length ? +(this.stats.shares.filter(v => v < .6).length / this.stats.shares.length).toFixed(3) : null,
      camBall: this.stats.camN ? +(this.stats.camBall / this.stats.camN).toFixed(3) : null, camGoal: this.stats.camN ? +(this.stats.camGoal / this.stats.camN).toFixed(3) : null };
  }
  // ---------- events ----------
  gained(id, how) {
    const m = this.m;
    const s = this.sim, me = s.a(this.me), pressed = me && m.foes('us').some(o => Math.hypot(o.x - me.x, o.y - me.y) < 1.2);
    if (R.headDownOn(id, this.me, how)) { this.lookUp(false); this.stats.downs++; } // the ball comes to him: head down (only then)
    void pressed;
    if (id !== this.me && this.up1 === false) this.lookUp(true); // (he lost it or passed it: head up)
    if (id === this.me && (how === 'tackle' || how === 'cut' || how === 'steal')) { hud.toast('🦶 Great steal!'); say('Great steal!'); }
    game.plog?.('fast', { is: 'gain', id, how });
  }
  goal(team) {
    const m = this.m, won = m.score[team] >= GOALS || this.sudden;
    this.resetTransient();
    hud.score(m.score, this.us, this.them); hud.banner(team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? 'goal' : 'bad');
    if (team === 'us') say(m.lastOwner === this.me ? 'Great choice!' : 'Great pass!');
    game.plog?.('fast', { is: 'goal', team, us: m.score.us, them: m.score.them, by: m.lastOwner });
    this.lookUp(true); this.calm = true;
    if (won) { this.over = true; m.after(2.2, () => this.finish()); return; }
    m.after(1.8, () => m.kickoff(team === 'us' ? 'them' : 'us', () => { this.calm = false; }));
  }
  finish() {
    const c = this.last = this.counts(); game.plog?.('fast', { is: 'end', ...c, score: `${c.score.us}-${c.score.them}` });
    this.stop(); const d = this.done; this.done = null; d?.(c);
  }
  end() { if (this.on) this.finish(); } // (the grown-up's way out, and the checks)

  // ---------- his head and the camera ----------
  // Where he looks by himself (rules.js naturalYaw), turned a little (RUN_TURN) the way he runs.
  natural() {
    const s = this.sim, h = s.a(this.me), b = s.ball; if (!h) return 0;
    let y = R.naturalYaw(h, b, this.m.owner() === this.me, PITCH.L, PITCH.W); const v = h.lv;
    if (v && Math.hypot(v[0], v[1]) > 1.5) y = R.wrap(y + RUN_TURN * R.wrap(Math.atan2(v[1], v[0]) - y));
    return y;
  }
  lookUp(up) {
    if (this.up1 === up) return; this.up1 = up;
    if (up) { this.stats.looks++; sfx('up'); this.lastScan = this.real; } else sfx('down');
    const d = this.dom.look; d.classList.toggle('show', !up); this.downAt = this.real; if (up && this.nudged) { this.nudged = false; d.classList.remove('nudge'); }
  }
  // The camera: the shot view while he aims, else the view he does not steer (rules.js viewStep: where he looks, near a
  // line turned along the pitch, the eye in from the line or out over it looking in, close in a corner; the pitch fills
  // the picture: fitPitch), or the yaw his finger holds.
  camNow(snap = 0, dt = 0) {
    const s = this.sim, h = s.a(this.me); if (!h) return;
    const b = s.ball, ww = world.width || 932, hh = world.height || 430, has = b.state === 'carried' && b.carrier === this.me, vs = this.vw ||= { yaw: this.yaw };
    let w;
    if (this.aiming) { w = R.aimCam(h, PITCH.L, PITCH.gy0, PITCH.gy1, PITCH.gh, ww, hh, spaces()); vs.yaw = this.yaw; }
    else { const drag = this.finger?.moved && this.holdYaw != null ? this.holdYaw : null; if (snap) { vs.yaw = this.yaw; vs.at = null; vs.gen = null; }
      w = R.viewStep(vs, { me: h, ball: { x: b.x, y: b.y, z: b.z || 0 }, has, look: this.look, w: ww, h: hh, L: PITCH.L, W: PITCH.W, nat: this.natural(), drag, still: drag == null && this.real <= this.holdT }, dt, snap ? 50 : 1); this.yaw = vs.yaw; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 10), c = this.cam, a0 = Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]);
    for (let i = 0; i < 3; i++) { c.eye[i] += (w.eye[i] - c.eye[i]) * k; c.tgt[i] += (w.tgt[i] - c.tgt[i]) * k; }
    c.Ff += (w.Ff - c.Ff) * k; c.Fw += ((w.Fw || 0) - c.Fw) * k;
    // (v89 integration) Whatever changed the view (the shot view coming or going, a hold let go, the view search, a
    // line), the picture never turns faster than CAM_TURN rad/s, except his own drag and a snap (a new match, a swap).
    if (!snap && !this.finger?.moved && dt > 0) { const d = R.wrap(Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]) - a0), lim = CAM_TURN * dt; if (Math.abs(d) > lim) turnTgt(c, Math.sign(d) * lim - d); }
  }
  // ---------- touches ----------
  // A finger goes down: on the grass (onTap: none, a tap picks what is under it) or on a button (onTap: its action).
  down(e, onTap = null) {
    if (this.finger && performance.now() - this.finger.t0 > 5000) this.dropFinger(); // (an old touch whose lift never came)
    if (!this.on || held.on || e.isPrimary === false || this.over || this.finger) return;
    e.preventDefault();
    if (this.aiming) { if (!onTap) { const r = canvas.getBoundingClientRect(); this.aimAt(e.clientX - r.left, e.clientY - r.top); } else onTap(); return; } // (while he aims, a press of any length on a target shoots there; nothing slows or speeds the world)
    const r = canvas.getBoundingClientRect(), f = this.finger = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, t0: performance.now(), yaw0: this.yaw, moved: false, held: false, w: r.width || world.width, onTap };
    f.timer = setTimeout(() => { if (this.finger === f && !held.on) this.hold(f); }, HOLD_MS);
  }
  // Drops a touch in progress (and its hold), as if the finger had lifted with no tap.
  dropFinger() { const f = this.finger; if (!f) return; clearTimeout(f.timer); this.finger = null; if (f.held) { this.holding = false; if (!this.aiming) this.slowTo = BASE; this.dom.box.classList.remove('slowing'); } }
  // Everything that lasts only a moment, put back: a touch and its hold, the slow tint, the aim, a warning, where he was
  // going, the hints, the reminder. At a goal, a keeper turn, a pause, a swap and the end.
  resetTransient() {
    this.set = null; this.chosen = null;
    this.dropFinger(); this.holding = false; this.holdYaw = null; this.holdT = 0; this.dom.box.classList.remove('slowing');
    if (this.aiming) this.endAim(); this.slowTo = BASE; this.warnAt = null; this.goAt = null; this.hinted = null; this.hintCounted = false; this.lastAct = this.real || 0;
    this.dom.cue.classList.remove('show'); hudEl.classList.remove('faiming');
  }
  // A small picture over the play for a moment (a skill move's picture, a pass cut out): no words to read.
  showPic(html) { const p = this.dom.pic; p.innerHTML = html; p.classList.remove('show'); void p.offsetWidth; p.classList.add('show'); clearTimeout(this.picT); this.picT = later(() => p.classList.remove('show'), 1500); }
  hold(f) { if (f.held) return; f.held = true; this.lastScan = this.real; this.holding = true; this.slowTo = HOLD; this.stats.holds++; sfx('down'); this.dom.hold.classList.remove('show'); this.dom.box.classList.add('slowing'); }
  move(e) {
    const f = this.finger; if (!f || e.pointerId !== f.id || held.on) return;
    const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
    if (!f.moved && Math.hypot(dx, dy) > SLIDE) { f.moved = true; clearTimeout(f.timer); this.hold(f); this.lookUp(true); }
    if (f.moved) { const h = this.sim.a(this.me); this.holdYaw = h ? R.clampYaw(h, f.yaw0 - dx / f.w * 3.2, PITCH.L, PITCH.W) : null; }
  }
  up(e, cancel = false) {
    const f = this.finger; if (!f || e.pointerId !== f.id) return; this.finger = null; clearTimeout(f.timer);
    const acts = R.pressActs((performance.now() - f.t0) / 1000, f.moved); // (a slow tap, the finger still: it acts too)
    if (f.held) { this.holding = false; if (!this.aiming) this.slowTo = BASE; this.holdT = this.real + (acts ? 0 : VIEW_BACK); sfx('up'); this.dom.box.classList.remove('slowing'); if (!acts || cancel || held.on || !this.on) return; } // (play eases back over BACK_S; after a look round the view stays where he left it a moment, then eases back)
    if (cancel || f.moved || held.on || !this.on) return;
    if (f.onTap) f.onTap(); else { const r = canvas.getBoundingClientRect(); this.tap(e.clientX - r.left, e.clientY - r.top); }
  }
  // What a tap can pick now, besides the spots: his friends he can see (with the ball: a pass), their carrier (a press),
  // a loose ball (go to it).
  options() {
    const s = this.sim, m = this.m, me = s.a(this.me), out = []; if (!me || m.dead) return out;
    const c = m.owner(), b = s.ball;
    if (c === this.me) for (const id of m.usIds) if (id !== this.me && s.a(id)) out.push({ kind: 'pass', id, p: s.a(id) });
    if (c && m.team(c) === 'them' && !s.a(c).gk) out.push({ kind: 'press', id: c, p: s.a(c) });
    if (!c && b.state === 'loose' && !m.flight) out.push({ kind: 'ball', p: b });
    return out;
  }
  seen(p, z = 0) { const q = world.project(p.x, p.y, z); return !!q && R.onScreen(q, world.width, world.height); }
  tap(x, y) {
    if (this.aiming) return this.aimAt(x, y);
    if (!this.on || this.m.dead) return null;
    const reach = Math.max(60, Math.min(world.width, world.height) * .16);
    let best = null, bd = 1e9;
    for (const o of this.options()) {
      for (const z of [.9, 0]) {
        const q = world.project(o.p.x, o.p.y, z); if (!q || !R.onScreen(q, world.width, world.height)) continue;
        const d = Math.hypot(q[0] - x, q[1] - y) * (o.kind === 'pass' ? .8 : 1); if (d < bd) { bd = d; best = o; } // (a friend wins a close call: his body is what he aims at)
      }
    }
    this.stats.taps++;
    if (best && best.kind === 'pass' && bd <= reach) { this.passTo(best.id); return best; }
    // a spot (rules.js spotAt: near one counts as it); their carrier or a loose ball tapped, the press or the chase
    if (this.set) for (const p of this.set.spots) p.q = world.project(p.x, p.y, 0);
    const sp = this.set ? R.spotAt(this.set.spots, x, y, this.ground(x, y), world.height) : null;
    if (best && best.kind !== 'pass' && bd <= reach * .8) { const f = this.set?.spots.find(q => q.follow); this.stats.presses++; this.goSpot(f || { x: best.p.x, y: best.p.y, kind: best.kind }); return best; }
    if (sp) { this.stats.spotTaps++; this.goSpot(sp); return sp; }
    this.stats.deadTaps++; sfx('tap'); game.plog?.('fast', { is: 'tap', did: 'none' }); return null; // (far from every spot: nothing)
  }
  passTo(id) {
    const m = this.m, c = m.passCheck(this.me, id); this.acted('pass');
    m.pass(this.me, id); sfx(c.open ? 'star' : 'tap', c.open ? 1 : undefined);
    game.plog?.('fast', { is: 'pass', to: id, open: c.open ? 1 : 0, why: c.why });
  }
  goSpot(sp) { this.m.meTo(sp.x, sp.y, sp.kind); this.chosen = sp; this.goAt = { x: sp.x, y: sp.y }; sfx('click'); this.acted('spot'); game.plog?.('fast', { is: 'spot', kind: sp.kind, x: +sp.x.toFixed(1), y: +sp.y.toFixed(1) }); }
  // ---------- the spots (rules.js spotSet) ----------
  // Who has the ball, as the spots see it: 'mine', 'ours', 'theirs', 'loose', or none (a pass to him, a shot, a save,
  // the ball dead).
  spotState() {
    const m = this.m, s = this.sim, b = s.ball, c = m.owner(), f = m.flight;
    if (m.dead || b.state === 'held' || f?.kind === 'shot' || f?.kind === 'held') return { key: 'none' };
    if (c === this.me) return { key: 'mine', state: 'mine' };
    if (c) return m.team(c) === 'us' ? { key: 'ours:' + c, state: 'ours', carrier: s.a(c) } : { key: 'theirs:' + c, state: 'theirs', carrier: s.a(c) };
    if (f?.kind === 'pass') { if (f.to === this.me) return { key: 'none' }; const r = s.a(f.to); return f.team === 'us' ? { key: 'ours:' + f.to, state: 'ours', carrier: r } : { key: 'theirs:' + f.to, state: 'theirs', carrier: r }; }
    return { key: 'loose', state: 'loose' };
  }
  // A new set when the ball changes hands, when he gets to his spot (or his run ends), or when he has stood a while.
  spotsNow(h) {
    const m = this.m, s = this.sim, st = this.spotState(), set = this.set, mv = m.meMove, moving = !!mv && s.time < mv.until;
    const key = st.key + (this.up1 ? '' : ':down'); // (his head coming up shows more of the pitch: a new set for what he now sees)
    let due = !set || set.key !== key;
    if (!due && this.chosen) { const ch = this.chosen; if (ch.follow ? !mv || (mv.kind !== 'press' && mv.kind !== 'chase') : Math.hypot(h.x - ch.x, h.y - ch.y) < .8 || !moving) due = true; }
    if (!due && !this.chosen && !moving && this.real - set.at > SPOT_STALE) due = true;
    if (!due) return;
    this.chosen = null; this.goAt = null;
    const W0 = world.width, H0 = world.height, cam = this.cam, safe = p => { const q = R.project(cam, { x: p.x, y: p.y, z: 0 }, W0, H0); return !!q && q[0] > W0 * .05 && q[0] < W0 * .95 && q[1] > H0 * .2 && q[1] < H0 * .93 && !(q[1] > H0 - 150 && (q[0] < 140 || q[0] > W0 - 150)); }; // (clear of the bar at the top and the two round buttons at the bottom)
    const k = m.keeper('them');
    const spots = st.key === 'none' ? [] : R.spotSet({ me: h, state: st.state, carrier: st.carrier, ball: s.ball, mates: m.usIds.filter(id => id !== this.me).map(id => s.a(id)).filter(Boolean), foes: m.foes('us'), keeper: k, L: PITCH.L, W: PITCH.W, seen: safe });
    this.set = { key, at: this.real, spots }; this.stats.sets++;
  }
  // The point on the grass under a place on the screen (or null: the sky).
  ground(x, y) { const r = this.ray ||= { c: new THREE.Raycaster(), n: new THREE.Vector2(), p: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), h: new THREE.Vector3() }; r.n.set(x / world.width * 2 - 1, -(y / world.height) * 2 + 1); r.c.setFromCamera(r.n, world.camera); return r.c.ray.intersectPlane(r.p, r.h) ? { x: r.h.x, y: r.h.y } : null; }
  acted(kind) { this.stats.actions++; this.lastAct = this.real; this.dom.hold.classList.remove('show'); void kind; }
  // ---------- the scan reminder ----------
  // He has not looked round (a hold, a drag, LOOK UP) for SCAN_T s, and someone who matters is out of his view: a friend
  // within 14 m of him or one of theirs within 4 m (behind him, say). A small picture (eyes, a turn) and a spoken word;
  // at most every CUE_EVERY s and CUES times a match (first runs: about 30 a match at 14 s, 3 to 11 at 25 s). It goes as soon as he looks.
  scanCue(h) {
    const s = this.sim, m = this.m, c = this.dom.cue; if (!h || m.dead || this.real - this.cueT > 4) { if (c.classList.contains('show')) c.classList.remove('show'); if (!h || m.dead) return; }
    if (this.real - this.lastScan < 1) { if (c.classList.contains('show')) c.classList.remove('show'); return; }
    if (this.real - this.lastScan < SCAN_T || this.real - this.cueT < CUE_EVERY || this.aiming || this.stats.cues >= CUES) return; // (at most CUES a match: at a 25 s gap it came 3 to 11 times)
    const near = (team, r) => (team === 'us' ? m.usIds.filter(id => id !== this.me) : m.themIds).map(id => s.a(id)).filter(a => a && Math.hypot(a.x - h.x, a.y - h.y) < r);
    const unseen = [...near('us', 14), ...near('them', 4)].some(a => !this.seen1(a, .9) && !this.seen1(a, 0));
    if (!unseen) return;
    this.cueT = this.real; this.stats.cues++; this.placeHint(c); c.classList.add('show'); say('Check your shoulder!'); sfx('ping');
    game.plog?.('fast', { is: 'cue' });
  }
  // The scan reminder and the hold hint sit where they cover no goal and no player he needs (rules.js hintSpot): placed
  // as they show and again every half second while they do (a transform only).
  placeHint(el) {
    const s = this.sim, m = this.m, h = s.a(this.me); if (!h || !el) return; const P = (x, y, z) => world.project(x, y, z), b = s.ball, pts = [P(h.x, h.y, 0), P(h.x, h.y, .9), P(h.x, h.y, 1.8), P(b.x, b.y, b.z || 0)];
    for (const gx of [0, PITCH.L]) for (const gy of [PITCH.gy0, (PITCH.gy0 + PITCH.gy1) / 2, PITCH.gy1]) for (const z of [0, PITCH.gh]) pts.push(P(gx, gy, z));
    for (const id of m.usIds) if (id !== this.me && s.a(id)) { const a = s.a(id); pts.push(P(a.x, a.y, 0), P(a.x, a.y, 1.6)); }
    for (const o of m.foes('us')) if (Math.hypot(o.x - h.x, o.y - h.y) < 9) pts.push(P(o.x, o.y, 0), P(o.x, o.y, 1.6));
    const q = R.hintSpot(pts.filter(p => p && R.onScreen(p, world.width, world.height, -40)), world.width, world.height); if (!q) return;
    const k = `${Math.round(q[0])} ${Math.round(q[1])}`; if (el.dataset.at === k) return; el.dataset.at = k; el.style.setProperty('--hx', Math.round(q[0]) + 'px'); el.style.setProperty('--hy', Math.round(q[1]) + 'px');
  }
  // ---------- the keeper turn (5 v 5) ----------
  // Their clear shot at our goal: he plays our keeper for it, with the keeper game's own moment (js/game/goalie.js
  // inMatch: the camera to the keeper's view, where to stand, where to dive), set up as the Slow match sets it
  // (js/game/handover.js keeperShot, copied). Easier when the score is level or he is behind (a longer look at the
  // shooter), harder when his team leads (a shorter look).
  keeperTurn(id) {
    const m = this.m; if (!this.goalie || !m.keeper('us') || this.over || this.kBusy || !this.on) return false;
    if (!m.shotCheck(id).good) return false;
    if (++this.kClear % 2) return false; // (every other clear shot of theirs: a treat, not a chore)
    this.kBusy = true; this.keeperMoment(id).catch(e => { console.error(e); this.kBusy = false; this.on = true; });
    return true;
  }
  async keeperMoment(shooter) {
    const s = this.sim, m = this.m, o = s.a(shooter), cy = PITCH.W / 2, TOUCH = .9, KEEP_OUT = 4.2;
    const start = { x: o.x, u: o.y - cy }, d = Math.hypot(start.x, start.u) || 1;
    let dir = { x: -start.x / d, u: -start.u / d }; if (start.x + dir.x * TOUCH < KEEP_OUT) dir = { x: 0, u: -Math.sign(start.u) || 1 };
    const from = { x: Math.max(KEEP_OUT, start.x + dir.x * TOUCH), u: start.u + dir.u * TOUCH };
    const spec = matchShot(from, start, Math.random()), lead = m.score.us - m.score.them, k = lead > 0 ? .7 : 1.2;
    spec.dive *= k; spec.stand *= k;
    this.stats.keeperTurns++; game.plog?.('fast', { is: 'keeper', shooter, lead, zone: spec.zone });
    s.stopAll(); m.flight = null; this.resetTransient(); this.slow = BASE;
    this.on = false; this.marks.hide(); this.dom.box.classList.remove('on'); const t = this.dom.tunnel; t.style.opacity = 0; t.classList.remove('on'); this.edgeO = 0;
    hud.caption('🧤 ' + SAID.youre); say(SAID.youre);
    const g = { sim: s, cam: this.cam, ui: this.ui };
    let r; try { r = await this.goalie.inMatch(g, spec, shooter); } catch (e) { console.error(e); r = { res: 'goal' }; }
    hud.caption(''); this.cam = g.cam; this.on = true; this.dom.box.classList.add('on'); this.kBusy = false; this.resetTransient();
    game.plog?.('fast', { is: 'keeperEnd', res: r?.res });
    if (r?.res === 'save') { this.stats.saves++; m.giveTo('k1', 'save'); hud.toast('🧤 Saved!'); }
    else m.goal('them');
  }

  // ---------- the one action button ----------
  // SHOOT: he has the ball within SHOT_EDGE m of the goal. SKILL: he has it, on the move, and one of theirs comes at him:
  // the button says the move's name with its picture, two buttons when two moves fit (skillOptions). STEAL: whenever the
  // ball is not his team's (D3: always bright, always pressable; the ball glows only while a press would win it now).
  actionNow() {
    const s = this.sim, m = this.m, me = s.a(this.me); if (!me || m.dead || this.over) return null;
    const c = m.owner(), b = s.ball, f = m.flight;
    if (c === this.me) {
      const d = Math.hypot(PITCH.L - me.x, PITCH.W / 2 - me.y), h = b.h ?? 0;
      const at = m.foes('us').find(o => { const dx = o.x - me.x, dy = o.y - me.y, l = Math.hypot(dx, dy); return l < 3.2 && l > .3 && (dx * Math.cos(h) + dy * Math.sin(h)) / l > .35; });
      const moving = (me.sp || 0) > .8 || (m.meMove && s.time < m.meMove.until);
      if (at && moving && d > 4 && s.time - this.skT > 2.5) return 'skill';
      if (d <= SHOT_EDGE) return 'shoot';
      return null;
    }
    if (c && m.team(c) === 'us') return null;
    if (b.state === 'held' || f?.kind === 'held' || (f && f.team === 'us')) return null; // (his team's pass or shot on its way, a keeper's ball)
    return 'steal';
  }
  // The two skill moves that fit now (sim.js turn skills): one past him across (the double touch, or the sole roll when
  // he is slow) and one away from him (a cut; the Cruyff turn when he is right in front).
  skillOptions() {
    const s = this.sim, m = this.m, me = s.a(this.me), h = s.ball.h ?? 0, foe = m.foes('us').filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    const front = foe && Math.abs(R.wrap(Math.atan2(foe.y - me.y, foe.x - me.x) - h)) < .35 && Math.hypot(foe.x - me.x, foe.y - me.y) < 2.2;
    return [(me.sp || 0) < 2.2 ? 'roll' : 'double', front ? 'cruyff' : 'chop'];
  }
  // The button's look (written only when it changes): an icon and a word, or (SKILL) the move's picture and its name.
  drawAction(k) {
    const opts = k === 'skill' ? (this.skillOpts ||= this.skillOptions()) : null; if (k !== 'skill') this.skillOpts = null;
    const key = k + (opts ? opts.join() : ''); if (key === this.actKey) return; this.actKey = key; this.actKind = k;
    const set = (b, kind, mv) => {
      b.classList.toggle('show', !!kind); if (!kind) return;
      b.dataset.kind = kind; b.classList.toggle('skill', !!mv);
      const [i, t] = mv ? ['', MOVE_NAME[mv] || 'Skill'] : kind === 'shoot' ? ['🥅', 'SHOOT'] : ['🦶', 'STEAL'];
      b.querySelector('i').textContent = i; b.querySelector('span').textContent = t; b.setAttribute('aria-label', t);
      b.querySelector('.pic').innerHTML = mv ? `<use href="#mvDef"/><g class="mv"${this.skillSide() > 0 ? ' transform="translate(100 0) scale(-1 1)"' : ''}><use href="#mvArrow"/><use href="#mv-${mv}"/></g><circle cx="50" cy="78" r="9" fill="#fff" stroke="#24193a" stroke-width="3"/>` : '';
    };
    set(this.dom.act, k, opts?.[0]); set(this.dom.act2, opts ? k : null, opts?.[1]);
  }
  action(i = 0) {
    const k = this.actionNow(); if (!k || !this.on || held.on) return;
    this.acted(k);
    if (k === 'shoot') this.aim(); else if (k === 'steal') this.steal(); else this.skill((this.skillOpts || this.skillOptions())[i] || 'double');
  }
  // SHOOT: the world slows a lot (AIM_SLOW, not stopped: one of theirs near him can still take it), the view refocuses
  // on the goal from behind him (rules.js aimCam), the six targets show: gold where it can go in, grey where the keeper
  // (or one of theirs) covers it. One tap on a target shoots there, with the foot the rule says (inside close, laces far:
  // shot.js rightFoot; v93: no second tap for the foot, so a child under pressure decides once).
  aim() {
    this.dropFinger(); this.aiming = true; this.m.meAim = true; this.slowTo = AIM_SLOW; this.lookUp(true); this.holdT = 0; this.aimT = this.real;
    const me = this.sim.a(this.me), k = this.m.keeper('them'), defs = this.m.foes('us').map(o => ({ x: o.x, y: o.y, id: o.id }));
    this.aimAll = spaces().map(z => ({ x: PITCH.L + .02, y: z.y, z: z.z, id: z.id, shut: zoneGrade({ x: me.x, y: me.y }, z.id, k && { x: k.x, y: k.y }, { defs }) === 'bad' }));
    this.ui.aims = this.aimAll.filter(a => !a.shut);
    hudEl.classList.add('faiming'); // (the score bar, chips and marks step aside: the goal and its targets fill the clear band)
    sfx('ping'); game.plog?.('fast', { is: 'aim', open: this.ui.aims.map(a => a.id).join(' ') });
  }
  aimAt(x, y) {
    let best = null, bd = 1e9;
    for (const a of this.aimAll || []) { const q = world.project(a.x, a.y, a.z); if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = a; } }
    if (!best || bd > Math.max(80, world.height * .22)) { sfx('tap'); this.stats.deadTaps++; return null; }
    this.shootAt(best.id); return best;
  }
  shootAt(zone) {
    if (!this.on || held.on) return;
    const s = this.sim, m = this.m, me = s.a(this.me), k = m.keeper('them');
    this.endAim();
    if (m.owner() !== this.me || !me) return;
    const foot = rightFoot(me);
    const res = shotResult({ from: { x: me.x, y: me.y }, zone, foot, k: k && { x: k.x, y: k.y }, gx: PITCH.L, rand: Math.random, defs: m.foes('us').map(o => ({ x: o.x, y: o.y, id: o.id })) });
    if (res.res === 'cleared' && res.by) res.by = { id: m.foes('us').reduce((p, o) => (Math.hypot(o.x - res.by.x, o.y - res.by.y) < Math.hypot(p.x - res.by.x, p.y - res.by.y) ? o : p)).id };
    this.stats.shots++; m.shoot(this.me, res); this.shotAt = { real: this.real, game: s.time, res: res.res };
    this.slowTo = .4; // (it plays a little slow, so he sees it go: back to speed when it ends, shotEnd)
    game.plog?.('fast', { is: 'shot', zone, foot, res: res.res, eta: +((res.t || 0) + .15).toFixed(2) });
  }
  // The shot has ended, as he sees it (match.js on.shotEnd): in the keeper's hands, in the net, out, blocked. Only now the
  // word (never before the ball gets there). how: 'save' | 'goal' | 'out' | 'cleared' | 'loose'.
  shotEnd(f, how, by) {
    if (f.from !== this.me) return;
    const a = this.shotAt, dt = a ? +(this.sim.time - a.game).toFixed(2) : null; this.shotAt = null;
    if (!this.holding) this.slowTo = BASE;
    if (how === 'goal') this.stats.shotGoals++;
    else if (how === 'save') { say('Saved!'); hud.toast('🧤 Saved!'); }
    else if (how === 'out') say('So close!');
    this.stats.shotEnds.push({ how, dt });
    game.plog?.('fast', { is: 'shotEnd', how, by, dt });
  }
  endAim() { this.aiming = false; this.m.meAim = false; this.ui.aims = null; this.aimAll = null; hudEl.classList.remove('faiming'); if (!this.holding) this.slowTo = BASE; }
  // STEAL (D3): his foot goes out at the ball. In reach it is his (a moment slow, so he sees it); out of reach he stumbles
  // a moment (match.js), shown at his feet (marks.js).
  steal() {
    const r = this.m.steal(); if (!r) return;
    if (r === 'won') { this.stats.steals++; this.slowTo = .3; this.m.after(.5, () => { if (!this.holding) this.slowTo = BASE; }); }
    else if (r === 'missed') { this.stats.stealMiss++; sfx('down'); }
    else this.stats.spentTaps++;
    game.plog?.('fast', { is: 'steal', res: r });
  }
  // The side the open way is (+1: to his left), away from the defender who comes at him.
  skillSide() {
    const s = this.sim, m = this.m, me = s.a(this.me), h = s.ball.h ?? 0, foe = m.foes('us').filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    let side = foe ? -Math.sign((foe.y - me.y) * Math.cos(h) - (foe.x - me.x) * Math.sin(h)) || 1 : 1;
    const a = h + side * 1.05, tx = me.x + Math.cos(a) * 4, ty = me.y + Math.sin(a) * 4; if (tx < 1.5 || tx > PITCH.L - 1.5 || ty < 1.5 || ty > PITCH.W - 1.5) side = -side; // (no room that side: the other way)
    return side;
  }
  // SKILL: the move he picked, in slow motion, toward the open side: a skill turn from the game's own moves (js/sim.js
  // startTurn with a tapped move, drawn by js/pro/motion.js; names from js/flair.js). The defender is fooled a moment.
  // The move goes ANG of a turn off his way: across him (double, roll), sharper away (chop), back (Cruyff).
  skill(k) {
    const s = this.sim, m = this.m, me = s.a(this.me), b = s.ball; if (!me || m.owner() !== this.me) return;
    const ANG = { double: 1.05, roll: 1.2, chop: 1.6, cruyff: 2.6 }, h = b.h ?? 0, side = this.skillSide(), foe = m.foes('us').filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    const a = h + side * (ANG[k] || 1.05), tx = R.clamp(me.x + Math.cos(a) * 4, 1.5, PITCH.L - 1.5), ty = R.clamp(me.y + Math.sin(a) * 4, 1.5, PITCH.W - 1.5);
    s.flair = { ctx: 'fast', by: { [this.me]: { p: 1, can: ['double', 'chop', 'roll', 'croqueta', 'cruyff'], fav: [], tier: 'star' } } }; s.taps = new Set([this.me]); me.turnTap = k; me.skT = -9;
    m.dribble(this.me, tx, ty, 3.4, 1.6); m.meMove = { kind: 'near', until: s.time + 1.6, x: tx, y: ty };
    s.step(0); // (the turn starts now)
    const mv = b.move?.k || k;
    this.skT = s.time; this.stats.skills++; m.safeT = s.time + 1.3; this.skillOpts = null; this.set = null;
    if (foe) { s.go(foe.id, foe.x, foe.y, 0); m.cmd.set(foe.id, s.time + .9); } // fooled: he stops a moment
    this.slowTo = .3; m.after(.9, () => { if (!this.holding) this.slowTo = BASE; s.flair = null; s.taps = null; });
    say((MOVE_NAME[mv] || MOVE_NAME[k] || 'Skill') + '!'); world.fx('skill'); // (v93: no picture over the play: the button said its name)
    game.plog?.('fast', { is: 'skill', move: mv, pick: k });
  }

  // ---------- one frame ----------
  // dt: real seconds (none while paused: js/pause.js).
  tick(dt) {
    if (!this.on || !dt) return;
    const t0 = performance.now(), s = this.sim, m = this.m, st = this.stats;
    this.real += dt; st.played += dt;
    this.slow += (this.slowTo - this.slow) * (1 - Math.exp(-dt * (this.slowTo > this.slow ? 3 / BACK_S : 8))); // (back up to speed over about BACK_S s)
    const gdt = dt * this.slow; if (this.slow < BASE * .9) st.slowT += dt; if (this.holding) st.holdT += dt; if (!this.up1) st.headDownT += dt;
    m.step(gdt);
    const n = Math.max(1, Math.ceil(gdt / (1 / 60))); for (let i = 0; i < n; i++) s.step(gdt / n);
    for (const a of s.agents.values()) { a.x = R.clamp(a.x, .3, PITCH.L - .3); a.y = R.clamp(a.y, .3, PITCH.W - .3); } // (nobody drifts over a line)
    this.ui.clock += gdt;
    this.calm = m.dead;
    const h = s.a(this.me), has = m.owner() === this.me;
    // his head: down only after the ball came to him; the camera looks where he would, or where he holds it
    this.look += ((this.up1 ? 1 : 0) - this.look) * (1 - Math.exp(-dt * 6));
    if (!(this.finger?.moved && this.holdYaw != null) && this.real > this.holdT) this.holdYaw = null;
    this.camNow(0, dt); // (the yaw: eased to the view's, never faster than TURN_MAX rad/s, never off the pitch: rules.js viewStep)
    // the spots (fixed: a new set only when one is due), the glow on friends he can pass to, the warning on a defender about to tackle
    if (h && !this.aiming) this.spotsNow(h);
    for (const id of m.usIds) this.ui.glow[id] = has && id !== this.me && m.passCheck(this.me, id).open ? .55 : 0; // (gold: a pass that will get there)
    // the action button, the ball's glow for a steal in time, and a shot he did not finish
    this.drawAction(this.aiming ? null : this.actionNow());
    // (v93) Head down with no spot in sight for a moment: LOOK UP nudges (his way to see the places he can go)
    const nudge = !this.up1 && !m.dead && (this.set?.spots.length || 0) < 2 && this.real - (this.downAt || 0) > 1.2;
    if (nudge !== !!this.nudged) { this.nudged = nudge; this.dom.look.classList.toggle('nudge', nudge); }
    this.scanCue(h);
    if ((this.hintPT = (this.hintPT || 0) + dt) > .5) { this.hintPT = 0; if (this.dom.cue.classList.contains('show')) this.placeHint(this.dom.cue); if (this.dom.hold.classList.contains('show')) this.placeHint(this.dom.hold); }
    // a long match: after NEXT_WINS s the next goal wins (a picture and a word); at END_S it ends as it stands
    if (!this.sudden && this.real > NEXT_WINS && !this.over) { this.sudden = m.sudden = true; // (and both teams go for it: match.js; the next goal ends it, the score as it stands then)
      if (m.score.us === m.score.them) { this.dom.box.querySelector('#fNext').classList.add('show'); say('Next goal wins!'); sfx('ping'); } game.plog?.('fast', { is: 'nextGoalEnds', level: m.score.us === m.score.them ? 1 : 0 }); }
    if (this.real > END_S && !this.over && !m.dead) { this.over = true; m.dead = true; s.stopAll(); this.finish(); return; }
    this.ui.ballGlow = this.actKind === 'steal' && m.canSteal(); this.stealGlow = this.ui.ballGlow; // (only while a press would win it now)
    if (this.aiming && (m.owner() !== this.me || this.real - this.aimT > AIM_S)) this.endAim();
    if (this.aiming && h) this.yaw = R.wrap(this.yaw + R.wrap(Math.atan2(PITCH.W / 2 - h.y, PITCH.L - h.x) - this.yaw) * (1 - Math.exp(-dt * 6)));
    if (this.warnAt && (this.real > this.warnT || !has)) this.warnAt = null;
    // where he chose to go, until he is there (or does something else); the hints after HINT_S s of nothing
    const moving = !!(m.meMove && s.time < m.meMove.until);
    // the hint after HINT_S s of nothing: the best spot of the set pulses
    const due = h && !m.dead && !this.aiming && !this.chosen && R.hintsDue(this.real, this.lastAct ?? 0, moving), best = due ? this.set?.spots.find(p => p.best) || null : null;
    if (best && !this.hintCounted) { this.hintCounted = true; this.stats.hints = (this.stats.hints || 0) + 1; } else if (!best) this.hintCounted = false;
    const show = !m.dead && !this.aiming;
    this.marks.draw([], [], h, has, this.ui.clock, this.warnAt && s.a(this.warnAt), show, null, null);
    this.marks.fixed(show && this.set ? this.set.spots : [], this.chosen, best, has, this.ui.clock, m.stumbling() ? h : null, this.aiming ? (this.aimAll || []).filter(a => a.shut) : null);
    this.edge(h); this.chips(h, has);
    // the counts: where the camera he did not move looks (the ball on screen, the goal he attacks on screen)
    if (!this.finger?.moved && this.real > this.holdT && h && !m.dead) {
      st.camN++; const b = s.ball; if (R.onScreen(R.project(this.cam, { x: b.x, y: b.y, z: b.z || 0 }, world.width, world.height), world.width, world.height)) st.camBall++;
      if (R.onScreen(R.project(this.cam, { x: PITCH.L, y: PITCH.W / 2, z: .8 }, world.width, world.height), world.width, world.height)) st.camGoal++;
    }
    if (h && !m.dead && !this.aiming && (st.shareF = (st.shareF || 0) + 1) % 6 === 0) { // (the share of the picture that is pitch, for the counts: its median and the longest time under 0.6)
      const v = R.pitchShare(this.cam, world.width, world.height, PITCH.L, PITCH.W, 10, 7); (st.shares ||= []).push(+v.toFixed(2)); if (st.shares.length > 6000) st.shares.splice(0, 3000);
      st.lowRun = v < .6 ? (st.lowRun || 0) + 6 * dt : 0; st.lowMax = Math.max(st.lowMax || 0, st.lowRun); st.low65 = v < .65 ? (st.low65 || 0) + 6 * dt : 0; st.low65Max = Math.max(st.low65Max || 0, st.low65); }
    const w = performance.now() - t0; st.work.push(w); if (st.work.length > 20000) st.work.splice(0, 10000); (this.workAll ||= []).push(w); if (this.workAll.length > 60000) this.workAll.splice(0, 30000);
  }
  // Friends he saw who are off screen now: a chip at the edge toward where he last saw them (rules.js chipList, edgeAt),
  // their shirt and a pointer; gold and a pass when tapped while he has the ball. Never over each other or the buttons.
  chips(h, has) {
    const s = this.sim, w = world.width, hh = world.height, now = this.real, list = [];
    for (const id of this.m.usIds) {
      if (id === this.me) continue; const a = s.a(id); if (!a) continue;
      const on = !this.m.dead && (this.seen1(a, .9) || this.seen1(a, 0)), sn = this.seen[id] ||= { seenAt: null, x: 0, y: 0 };
      if (on) { sn.seenAt = now; sn.x = a.x; sn.y = a.y; }
      list.push({ id, seenAt: this.m.dead ? null : sn.seenAt, on });
    }
    const chips = h && !this.aiming ? R.chipList(list, now, has) : [];
    for (const c of chips) { // (on the side edges only: rules.js chipSpot, layoutChips)
      const sn = this.seen[c.id], q = world.project(sn.x, sn.y, .9), rel = R.wrap(Math.atan2(sn.y - h.y, sn.x - h.x) - this.yaw);
      c.p = R.chipSpot(q, rel, w, hh); c.q = q;
    }
    R.layoutChips(chips.map(c => c.p), hh);
    for (const c of chips) if (c.gold) c.gold = this.m.passCheck(this.me, c.id).open; // (gold only for a pass that will get there; any chip passes)
    for (const c of chips) c.ang = c.q ? Math.atan2(c.q[1] - c.p[1], c.q[0] - c.p[0]) : (c.p[0] < w / 2 ? Math.PI * .75 : Math.PI * .25);
    this.dom.chips.forEach((d, i) => {
      const c = chips[i]; d.id = c?.id || null; d.tap = !!c?.tap;
      const o = c ? Math.round(c.alpha * 20) / 20 : 0; if (o !== d.o) { d.o = o; d.b.style.opacity = o; d.b.style.pointerEvents = o > .05 ? 'auto' : 'none'; }
      if (!c) return;
      const key = c.id + (c.gold ? 'g' : ''); if (key !== d.key) { d.key = key; d.b.querySelector('.pic').innerHTML = shirt(this.us, this.player(c.id).num, 30); d.b.classList.toggle('gold', c.gold); }
      const tf = `translate(${Math.round(c.p[0] - 24)}px,${Math.round(c.p[1] - 24)}px)`; if (tf !== d.tf) { d.tf = tf; d.b.style.transform = tf; }
      const a = Math.round(c.ang * 57.3 / 5) * 5 + 'deg'; if (a !== d.a) { d.a = a; d.b.style.setProperty('--a', a); }
    });
  }
  seen1(p, z) { const q = world.project(p.x, p.y, z); return !!q && R.onScreen(q, world.width, world.height, 10); }
  // The head-down edge (#tunnel, as js/ui/hud.js draws it): its clear middle on his player, opacity by how far down.
  edge(h) {
    const t = this.dom.tunnel; if (!t) return;
    const o = Math.round((1 - this.look) * 95) / 100;
    if (o !== this.edgeO) { this.edgeO = o; t.style.opacity = o; t.classList.toggle('on', o > .02); }
    if (o <= .02 || !h) return;
    const q = world.project(h.x, h.y, .9); if (!q) return;
    const ax = q[0] / world.width * 100, ay = q[1] / world.height * 100, body = document.body.classList;
    if (body.contains('smooth') && !body.contains('blur')) { const tx = `translate(${Math.round(ax) - 50}vw, ${Math.round(ay) - 64}vh)`; if (tx !== this.edgeT) { this.edgeT = tx; t.style.transform = tx; } }
    else { const k = `${Math.round(ax)} ${Math.round(ay)}`; if (k !== this.edgeT) { this.edgeT = k; t.style.setProperty('--tx', Math.round(ax) + '%'); t.style.setProperty('--ty', Math.round(ay) + '%'); } }
  }
}

export const fast = new Fast();
if (typeof window !== 'undefined') Object.assign(window, { __fast: fast, __fastWorld: world, __held: held, get __fastL() { return PITCH.L; }, get __fastW() { return PITCH.W; } }); // (for the checks and the console, as window.__game)
