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
import { Match, LEVELS } from './match.js';
import { makeMarks, shirt } from './marks.js';
import * as R from './rules.js';
import { shotResult, spaces, zoneGrade, rightFoot, EDGE as SHOT_EDGE } from '../shot.js';
import { MOVE_NAME, MOVE_SYM } from '../flair.js';
import { matchShot, SAID } from '../saves.js';
import { warmMini } from '../ui/voicewarm.js';
import { P } from '../ui/store.js';
import { stealState, setStealLook } from '../ui/steal-look.js';
import { VARIANTS, variantOf, Decision, bigChoices, bigAt, CRAWL, CRAWL_IN, CRAWL_OUT, Ramp, crawlLen, offChoices, offDue, ON_AGAIN, PRESSED_R, ON_PRESSED } from './variant.js';
export const CRAWL_TURN = 1.4, E_RING = 1.25; // (v96 E: the view turns no faster than this in the crawl (rad/s): a drift, never a swing; the countdown ring's radius, m)

export const CAM_TURN = 2.6; // rad/s (v89 integration: fast.js camNow)
const turnTgt = (c, a) => { const dx = c.tgt[0] - c.eye[0], dy = c.tgt[1] - c.eye[1], co = Math.cos(a), si = Math.sin(a); c.tgt[0] = c.eye[0] + dx * co - dy * si; c.tgt[1] = c.eye[1] + dx * si + dy * co; };
export const TURN_MAX = R.TURN_MAX, SCAN_T = 12, CUE_EVERY = 60, CUES = 4, NEXT_WINS = 210, END_S = 420; // (s of play: after NEXT_WINS the next goal wins; at END_S it ends as it stands)
export const AIM_SLOW = .2, AIM_S = 7, SPOT_STALE = 2.5; // (v93: while he aims the world goes on at AIM_SLOW (not stopped: one of theirs near him can still take it); the aim ends after AIM_S real s; standing still, a new set of spots after SPOT_STALE real s)
export const BASE = .75, HOLD = .18, GOALS = FAST_GOALS, HOLD_MS = R.HOLD_S * 1000, RUN_TURN = .25, BACK_S = .6, VIEW_BACK = 1;
const SLIDE = 12; // px a finger may wobble and still be a tap

// (v95) What the page shows in play is all made before it (build, pick): the pass-cut picture, and the glyphs the action
// button can show (painted once while he picks his player: #fGlyph, css "lag").
const PIC_CUT = '<i class="cut">⚽</i><i>✋</i>', GLYPHS = ['🥅', '🦶', '⭐', ...Object.values(MOVE_SYM)].join('');
// (v95) Work that need not be in the game step, each in a task of its own right after this frame (a spoken line, a toast):
// on the phone a slow call there made the frame's game step 31 to 117 ms.
// (v95) The next frame (or 100 ms when no frame comes: a hidden page), once.
const nextFrame = f => { let done = false; const go = () => { if (!done) { done = true; try { f(); } catch (e) { console.error(e); } } }; requestAnimationFrame(go); setTimeout(go, 100); };
const soon = f => setTimeout(() => { try { f(); } catch (e) { console.error(e); } }, 0);
// (v95) A class written only when it changes (the speed recorder showed "html show/hide" for classes set to what they were).
// (v95) A text changed in place, in its own text node (textContent makes a new node each time).
const text = (el, t) => { const n = el.firstChild; if (n && n.nodeType === 3 && !n.nextSibling) { if (n.nodeValue !== t) n.nodeValue = t; } else el.textContent = t; };
const cls = (el, k, on) => { if (el && el.classList.contains(k) !== !!on) el.classList.toggle(k, !!on); };
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
      <div id="fCrawl" aria-hidden="true"></div>
      <button id="fAvatar" class="btn btn-glass btn-icon" type="button" aria-label="Change your player"></button>
      <button id="fLook" class="btn btn-gold btn-round" type="button" aria-label="Look up"><i>👀</i><span>LOOK UP</span></button>
      <button id="fAct" class="btn btn-gold btn-round fActB" type="button"><i></i><span></span></button>
      <button id="fAct2" class="btn btn-gold btn-round fActB" type="button"><i></i><span></span></button>
      <button id="fStay" class="btn btn-blue btn-round" type="button" aria-label="Stay"><i class="fill"></i><b>🧍</b><span>STAY</span></button>
      <div id="fSlow" aria-hidden="true"></div><div id="fChevL" class="fChev" aria-hidden="true">‹‹</div><div id="fChevR" class="fChev" aria-hidden="true">››</div>
      <div id="fNext" aria-hidden="true"><i>⚽</i><b>➜</b><i>🏆</i></div>
      <div id="fCue" aria-hidden="true"><i>👀</i><b>↔</b></div>
      <div id="fPic" aria-hidden="true">${PIC_CUT}</div>
      <div id="fGlyph" aria-hidden="true"><i>${GLYPHS}</i></div>
      <div id="fChips">${'<button class="fChip" type="button" aria-label="A friend you saw"><span class="ptr"></span><span class="pic"></span></button>'.repeat(4)}</div>`);
    hudEl.appendChild(box); hudEl.appendChild(el('div', { id: 'fSheet', class: 'hidden' }, '<div class="fCard"><div class="fRow"></div></div>')); // (the sheet: also before play, while the rest is hidden)
    for (const e of box.querySelectorAll('.fActB i, .fActB span')) e.appendChild(document.createTextNode('')); // (v95: changed in place in play: drawAction)
    this.dom = { box, cue: $('#fCue'), avatar: $('#fAvatar'), look: $('#fLook'), act: $('#fAct'), act2: $('#fAct2'), stay: $('#fStay'), sheet: $('#fSheet'), row: $('#fSheet .fRow'), tunnel: $('#tunnel') };
    press(this.dom.stay, () => { if (!this.on || held.on || !this.V?.crawl || !this.dec.on) return; this.m.acted(); sfx('click'); this.stats.stays++; this.acted('stay'); }); // (v96 E: STAY, at a decision point only)
    // LOOK UP and the action button act as the finger goes down, at once (a press that starts on them never slows the
    // world); a chip acts as a tap and, held, slows the world like a press anywhere (rules.js pressKind).
    press(this.dom.look, () => { if (!this.on || held.on) return; this.lookUp(true); this.acted('look'); });
    this.dom.chips = [...box.querySelectorAll('.fChip')].map(b => { const c = { b, id: null, key: '', tf: '', o: -1 }; press(b, e => this.down(e, () => { if (c.id && c.tap) { if (this.V.big && !this.m.passCheck(this.me, c.id).open) { this.blocked(c.id); return; } this.passTo(c.id); this.stats.chipPasses++; } })); return c; });
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
  pick(us) { this.build(); this.us = us; this.me = this.me && this.ids().includes(this.me) ? this.me : 'hero'; const p = new Promise(res => this.openSheet(id => { this.me = id; res(id); })); this.warm(); this.picked = us; return p; }
  // (v95) Before play, behind the player sheet: the chips' shirts made, Live's 3D marks and the shot targets drawn once
  // (marks.js warm: no shader, mesh or texture made in play), and its HUD painted once at almost no opacity (css "lag":
  // #fastHud.fwarm), so nothing Live shows is built or painted for the first time in play.
  warm(hud = true) {
    this.chipPics();
    try { this.marks.warm([...(world.aimPool || []), world.ballGlow, world.particles?.mesh, world.particles?.marker, ...(world.glows?.values() || [])].filter(Boolean)); } catch (e) { console.error(e); } // (and the world's own that Live shows: the shot targets, the ball's glow for STEAL, the puffs and sparks, the glow under a friend he can pass to)
    this.warmCode();
    if (!hud) return; // (Score attack: its HUD shows as play starts, as before)
    const box = this.dom.box; clearTimeout(this.warmT); box.classList.add('fwarm'); this.warmT = setTimeout(() => box.classList.remove('fwarm'), 300);
  }
  // (v95) The game step's own work run once before play on a match of its own (thrown away), so the first decision moment
  // and kick-off do not also pay for the browser compiling it (a 10 to 12 ms step at kick-off in the 4x-slowed checks).
  warmCode() {
    try {
      const size = sizeOf(), sim = new Sim(), m = new Match({ size: TEAM.size, sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: size.out, keepers: !!size.keeper, rnd: () => .5 });
      m.setup('us'); const me = sim.a('hero'), b = sim.ball, L = PITCH.L, W = PITCH.W, mates = m.usIds.slice(1).map(id => sim.a(id)), w = world.width || 932, h = world.height || 430;
      bigChoices({ me, yaw: 0, foes: m.allFoes('us'), L, W });
      for (const [state, c] of [['mine', null], ['ours', mates[0]], ['theirs', sim.a('o1')], ['loose', null]]) R.spotSet({ me, state, carrier: c, ball: b, mates, foes: m.foes('us'), keeper: m.keeper('them'), L, W });
      R.viewPick(me, b, true, 1, w, h, L, W); for (const id of m.usIds.slice(1)) m.passCheck('hero', id);
      for (let i = 0; i < 20; i++) { m.step(1 / 60); m.autoStep(); sim.step(1 / 60); }
    } catch (e) { console.error(e); }
  }
  // Each chip holds every friend's shirt, made once (here, before play); the one it stands for shows (css "lag").
  chipPics() {
    const ids = this.ids(), key = this.us.id + ids.join(); if (this.chipKey === key) return; this.chipKey = key;
    for (const d of this.dom.chips) { const pic = d.b.querySelector('.pic'); pic.innerHTML = ids.map(id => `<span data-id="${id}">${shirt(this.us, this.player(id).num, 30)}</span>`).join(''); d.pics = Object.fromEntries([...pic.children].map(s => [s.dataset.id, s])); d.key = ''; }
  }
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
  // warm: whose lines to load now (ui/voicewarm.js gameLines; Score attack passes its own). Each clip loads once.
  play({ us, them, level, warm = 'fast', noE = false }) { // (noE: a caller that is not a Live match, Score attack, plays E as A)
    if (warm) warmMini(warm); // (v93 integration: a Live match warmed no clips except through the home screen's one button)
    this.build(); this.us = us; this.them = them; if (this.picked !== us) this.warm(false); else this.chipPics(); this.picked = null; clearTimeout(this.warmT); this.dom.box.classList.remove('fwarm'); // (Score attack starts with no pick: warmed here, before its kick-off)
    this.vid = variantOf(P.settings); if (noE && this.vid === 'E') this.vid = 'A'; this.V = VARIANTS[this.vid]; this.dec = new Decision(this.vid); this.big = null; this.bigChosen = null; this.lane = null; this.take = null; this.bigAt = 0; // (v93 variants: the home screen's A B C D, variant.js)
    const size = sizeOf(), sim = this.sim = new Sim();
    sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx(v >= 14 ? 'shot' : 'kick'); } else if (ev === 'touch') world.fx('touch'); };
    const m = this.m = new Match({ size: TEAM.size, sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: size.out, keepers: !!size.keeper, level, fx: ev => world.fx(ev), sfx: n => sfx(n) });
    m.me = m.favor = this.me || 'hero'; this.me = m.me;
    m.setup('us'); m.kickoff('us');
    // (v96 E) its decision points' state: the countdown by his level (how far he has risen from where this size starts)
    this.E = { side: null, seen: null, key: null, lastOff: -9, endAt: -9, ballAt: null, places: null, goAt: null, friends: [], offered: [], onAgain: 0, kept: false, resume: null, why: null, waveK: 0, len: crawlLen((level ?? m.level) - (LEVELS[TEAM.size] ?? m.level)) };
    this.ramp = new Ramp(BASE); cls(this.dom.box, 'vE', !!this.V.crawl); cls(this.dom.box, 'crawl', false); cls(this.dom.stay, 'show', false); cls(this.dom.stay, 'run', false); cls(this.dom.stay, 'run2', false); cls(this.dom.stay, 'taken', false); cls(this.dom.stay, 'taken2', false); this.dom.stay.style.setProperty('--crawl', this.E.len + 's');
    this.real = 0; this.slow = this.slowTo = BASE; this.look = 1; this.up1 = true; this.yaw = 0; this.holdYaw = null; this.holdT = 0; this.finger = null; this.holding = false;
    this.ui.clock = 0; this.ui.glow = {}; this.ui.aims = null; this.ui.lines = null; this.warnAt = null; this.warnT = 0; this.over = false;
    this.seen = {}; this.chipsKey = null; this.lastAct = 0; this.hinted = null; this.hintAt = 0; this.hintCounted = false; this.goAt = null; this.edgeO = -1; this.edgeT = '';
    this.dom.look.classList.remove('show'); this.dom.cue.classList.remove('show'); this.dom.pic.classList.remove('show');
    this.aiming = false; this.ui.ballGlow = false; this.actKind = null; this.actKey = ''; this.stealSt = ''; setStealLook(this.dom.act, ''); this.skillOpts = null; this.skUsed = {}; this.skT = -9; m.meAuto = false; // (he wins a tackle with STEAL, not by standing there)
    this.set = null; this.chosen = null; this.shotAt = null; this.dom.act2.classList.remove('show');
    this.stats = { keeperTurns: 0, saves: 0, cues: 0, shots: 0, shotGoals: 0, steals: 0, stealMiss: 0, spentTaps: 0, skills: 0, deadTaps: 0, spotTaps: 0, presses: 0, sets: 0, shotEnds: [], chipPasses: 0, played: 0, slowT: 0, decT: 0, stopT: 0, decs: 0, decOut: 0, ringTakes: 0, blocked: 0, bigTaps: 0, holdT: 0, holds: 0, actions: 0, looks: 0, taps: 0, swaps: 0, camN: 0, camBall: 0, camGoal: 0, frames: [], work: [], downs: 0, headDownT: 0, eOn: 0, eOff: 0, eEnds: [], crawlT: 0, deepT: 0, placeTaps: 0, stays: 0 };
    this.yaw = this.natural(); this.vw = null; this.camNow(1);
    hud.state({ phase: 'idle', mode: 'fast' }); hud.caption(''); hud.score(m.score, us, them);
    game.mode = 'fast'; this.drawAvatar(); this.dom.box.classList.add('on'); // (v93: no hold-to-slow hint; the owner shows him the gesture)
    FAST.on = this.on = true; this.calm = true;
    m.on.gain = (id, how) => this.gained(id, how);
    m.on.goal = team => this.goal(team);
    m.on.warn = k => { this.warnAt = k; this.warnT = this.real + 1.6; sfx('ping'); };
    m.on.theirShot = (id, res) => this.keeperTurn(id, res);
    m.on.cutOut = f => { if (f.me) this.showPic(); }; // (his pass cut out: a ball and a stopping hand, not the skill's picture)
    m.on.shotEnd = (f, how, by) => this.shotEnd(f, how, by);
    this.lastScan = 0; this.cueT = -99; this.kBusy = false; this.kClear = 0; this.sudden = false; this.dom.box.querySelector('#fNext').classList.remove('show');
    m.on.lost = was => { if (was === this.me) { this.lookUp(true); soon(() => say('Where is the ball?')); } };
    game.plog?.('fast', { is: 'start', size: TEAM.size, me: this.me, us: us.id, them: them.id, level: m.level, variant: this.vid });
    return new Promise(res => { this.done = res; });
  }
  stop() {
    if (this.dom) this.resetTransient();
    for (const k of ['look', 'cue', 'pic']) this.dom?.[k]?.classList.remove('show'); this.dom?.box.querySelector('#fNext')?.classList.remove('show');
    FAST.on = this.on = false; this.marks?.hide(); this.dom?.box.classList.remove('on'); this.dom?.sheet.classList.add('hidden'); hudEl.classList.remove('fpicking');
    const t = this.dom?.tunnel; if (t) { t.style.opacity = 0; t.classList.remove('on'); t.style.transform = ''; }
    this.ui.glow = {}; this.ui.aims = null; this.ui.ballGlow = false; this.aiming = false; this.dom?.act.classList.remove('show'); this.dom?.act2.classList.remove('show'); this.actKind = null; this.actKey = ''; this.stealSt = ''; if (this.dom) setStealLook(this.dom.act, ''); this.finger = null; this.holding = false; this.dom?.box.classList.remove('slowing'); this.set = null; this.chosen = null;
    for (const d of this.dom?.chips || []) { d.o = 0; d.b.style.opacity = 0; d.b.style.pointerEvents = 'none'; }
  }
  counts() {
    const m = this.m, c = m.count, all = Object.values(c.touches).reduce((a, b) => a + b, 0);
    return { score: { ...m.score }, touches: c.touches[this.me] || 0, teamTouches: all, share: all ? +((c.touches[this.me] || 0) / all).toFixed(2) : 0, passes: c.passes, good: c.arrived, cut: c.cut, goals: c.goals, steals: c.steals, lost: c.lost,
      time: Math.round(this.stats.played), actions: this.stats.actions, deadTaps: this.stats.deadTaps, spotTaps: this.stats.spotTaps, shots: this.stats.shots, skills: this.stats.skills, stealMiss: this.stats.stealMiss, spentTaps: this.stats.spentTaps, keeperTurns: this.stats.keeperTurns, saves: this.stats.saves, cues: this.stats.cues, chipPasses: this.stats.chipPasses, holds: this.stats.holds, slowS: +this.stats.slowT.toFixed(1), looks: this.stats.looks,
      pitch: this.stats.shares?.length ? this.stats.shares.slice().sort((a, b) => a - b)[this.stats.shares.length >> 1] : null, shareLowMaxS: +(this.stats.lowMax || 0).toFixed(1), share65MaxS: +(this.stats.low65Max || 0).toFixed(1), shareUnder60: this.stats.shares?.length ? +(this.stats.shares.filter(v => v < .6).length / this.stats.shares.length).toFixed(3) : null,
      camBall: this.stats.camN ? +(this.stats.camBall / this.stats.camN).toFixed(3) : null, camGoal: this.stats.camN ? +(this.stats.camGoal / this.stats.camN).toFixed(3) : null,
      ...(this.V?.crawl ? { eOn: this.stats.eOn, eOff: this.stats.eOff, eDefault: this.stats.eEnds.filter(e => e.how === 'default').length, crawlS: +this.stats.crawlT.toFixed(1), stays: this.stats.stays, placeTaps: this.stats.placeTaps } : {}) }; // (v96 E: its decision points, for the end line)
  }
  // ---------- events ----------
  gained(id, how) {
    const m = this.m;
    const s = this.sim, me = s.a(this.me), pressed = me && m.foes('us').some(o => Math.hypot(o.x - me.x, o.y - me.y) < 1.2);
    if (R.headDownOn(id, this.me, how) && (!this.V.crawl || (me && m.foes('us').some(o => Math.hypot(o.x - me.x, o.y - me.y) < PRESSED_R)))) { this.lookUp(false); this.stats.downs++; } // the ball comes to him: head down (only then; v96 E: only with one of theirs near enough to matter)
    void pressed;
    if (id !== this.me && this.up1 === false) this.lookUp(true); // (he lost it or passed it: head up)
    if (id === this.me && (how === 'tackle' || how === 'cut' || how === 'steal')) soon(() => { hud.toast('🦶 Great steal!'); say('Great steal!'); }); // (v95: after the frame, not in its game step)
    game.plog?.('fast', { is: 'gain', id, how });
  }
  goal(team) {
    const m = this.m, won = m.score[team] >= GOALS || this.sudden;
    this.resetTransient();
    // (v95, the owner's phone: 251 ms of page work in the goal's frame, with the score, the big words, the flash and the
    // line all in it) The big words and their sound now (hud.banner brings its sunburst and flash in the frames after);
    // the score's jump in the next frame; the line and his head coming up in the one after.
    const line = team === 'us' ? (m.lastOwner === this.me ? 'Great choice!' : 'Great pass!') : null, score = { ...m.score };
    hud.banner(team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? 'goal' : 'bad');
    nextFrame(() => { hud.score(score, this.us, this.them); nextFrame(() => { if (this.on) this.lookUp(true); if (line) soon(() => say(line)); }); });
    game.plog?.('fast', { is: 'goal', team, us: m.score.us, them: m.score.them, by: m.lastOwner });
    this.calm = true;
    if (won) { this.over = true; m.after(2.2, () => this.finish()); return; }
    m.after(1.8, () => { if (world.mood) world.mood.t = Math.max(world.mood.t, 5.5); m.kickoff(team === 'us' ? 'them' : 'us', () => { this.calm = false; }); }); // (v93 integration: the celebration ends (a 0.5 s fade) as they walk back, not 6 s after the goal)
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
    const d = this.dom.look; cls(d, 'show', !up); this.downAt = this.real; if (up && this.nudged) { this.nudged = false; d.classList.remove('nudge'); }
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
      w = R.viewStep(vs, { me: h, ball: { x: b.x, y: b.y, z: b.z || 0 }, has, look: this.look, w: ww, h: hh, L: PITCH.L, W: PITCH.W, nat: this.natural(), drag, still: drag == null && this.real <= this.holdT, keep: this.keepPts(h, has) }, dt, snap ? 50 : 1); this.yaw = vs.yaw; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 10), c = this.cam, a0 = Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]);
    for (let i = 0; i < 3; i++) { c.eye[i] += (w.eye[i] - c.eye[i]) * k; c.tgt[i] += (w.tgt[i] - c.tgt[i]) * k; }
    c.Ff += (w.Ff - c.Ff) * k; c.Fw += ((w.Fw || 0) - c.Fw) * k;
    // (v89 integration) Whatever changed the view (the shot view coming or going, a hold let go, the view search, a
    // line), the picture never turns faster than CAM_TURN rad/s, except his own drag and a snap (a new match, a swap).
    if (!snap && !this.finger?.moved && dt > 0) { const d = R.wrap(Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]) - a0), lim = (this.V?.crawl && this.dec.on ? CRAWL_TURN : CAM_TURN) * dt; if (Math.abs(d) > lim) turnTgt(c, Math.sign(d) * lim - d); }
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
    if (this.V?.crawl && this.E) { this.endE('reset'); this.E.goAt = null; this.E.resume = null; cls(this.dom.box, 'crawl', false); cls(this.dom.stay, 'show', false); cls(this.dom.stay, 'run', false); cls(this.dom.stay, 'run2', false); cls(this.dom.stay, 'taken', false); cls(this.dom.stay, 'taken2', false); } // (v96 E: a decision point ends with a goal, a pause, a swap)
    this.set = null; this.chosen = null; this.dec?.reset(); this.big = null; this.bigChosen = null; this.lane = null; this.dropTake();
    this.dropFinger(); this.holding = false; this.holdYaw = null; this.holdT = 0; this.dom.box.classList.remove('slowing');
    if (this.aiming) this.endAim(); this.slowTo = BASE; this.warnAt = null; this.goAt = null; this.hinted = null; this.hintCounted = false; this.lastAct = this.real || 0;
    this.dom.cue.classList.remove('show'); hudEl.classList.remove('faiming');
  }
  // A small picture over the play for a moment (a skill move's picture, a pass cut out): no words to read.
  // (v95) Its one picture (a pass cut out) is made with the HUD (build): showing it makes no node and forces no layout in the
  // game step (on the phone that frame's game step was 31 ms); shown again while up, it stays up 1.5 s more.
  showPic() { const p = this.dom.pic; cls(p, 'show', true); clearTimeout(this.picT); this.picT = later(() => p.classList.remove('show'), 1500); }
  hold(f) { if (f.held) return; f.held = true; this.lastScan = this.real; this.holding = true; this.slowTo = HOLD; this.stats.holds++; sfx('down'); this.dom.box.classList.add('slowing'); }
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
    if (this.V.crawl) return this.tapE(x, y); // (v96 E: only its choices)
    if (this.V.big && this.m.owner() === this.me) return this.tapBig(x, y);
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
    const m = this.m, c = m.passCheck(this.me, id); this.acted('pass', 'pass:' + id);
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
    const k = m.keeper('them'), wasted = (this.V.big && st.state === 'mine') || (this.V.auto && st.state !== 'ours') || !!this.V.crawl; // (v96 E: its own places, at its decision points only: decideE) // (v95: a set the variant throws away below is not worked out: the same, cheaper)
    const spots = st.key === 'none' || wasted ? [] : R.spotSet({ me: h, state: st.state, carrier: st.carrier, ball: s.ball, mates: m.usIds.filter(id => id !== this.me).map(id => s.a(id)).filter(Boolean), foes: m.foes('us'), keeper: k, L: PITCH.L, W: PITCH.W, seen: safe });
    if (this.V.big && st.state === 'mine') spots.length = 0; // (v93 variants: with the ball, the big choices instead: bigNow)
    else if (this.V.auto) { const one = st.state === 'ours' ? spots.filter(p => p.kind === 'behind').sort((p, q) => q.s - p.s)[0] : null; spots.length = 0; if (one) spots.push(one); } // (off the ball he moves by himself: one marked spot only when it matters, a run in behind)
    this.set = { key, at: this.real, spots }; this.stats.sets++;
  }
  // The point on the grass under a place on the screen (or null: the sky).
  ground(x, y) { const r = this.ray ||= { c: new THREE.Raycaster(), n: new THREE.Vector2(), p: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), h: new THREE.Vector3() }; r.n.set(x / world.width * 2 - 1, -(y / world.height) * 2 + 1); r.c.setFromCamera(r.n, world.camera); return r.c.ray.intersectPlane(r.p, r.h) ? { x: r.h.x, y: r.h.y } : null; }
  acted(kind, label = kind) {
    this.stats.actions++; this.lastAct = this.real;
    if (this.V?.crawl) { if (kind !== 'look') this.endE(label); return; } // (v96 E: anything he does ends its decision point: what he did is its choice)
    if (kind === 'pass' || kind === 'spot' || kind === 'shoot' || kind === 'skill' || kind === 'big') { this.dec.close(true); this.dropTake(); }
  }
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
    this.cueT = this.real; this.stats.cues++; this.placeHint(c); c.classList.add('show'); soon(() => say('Check your shoulder!')); sfx('ping'); // (v95: the line after the frame: on the phone this frame's game step was 117 ms)
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
  // the button says the move's name with its picture: one move, the best for now (skillOptions). STEAL: whenever the
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
  // (v93, the owner: "it comes too quick... it should probably just be one option") ONE skill move, the best one for
  // now (sim.js turn skills), on the one big button where SHOOT and STEAL sit. One of theirs square in front of him with
  // space beyond: a move that goes past him across (the double touch, the croqueta; the sole roll when he is slow). One
  // closing from the side, or no space beyond: a move that turns away (the cut; the Cruyff turn when he is right in
  // front). Among the moves that fit, the one he has been offered least this match, so he sees them all.
  skillOptions() {
    const s = this.sim, m = this.m, me = s.a(this.me), h = s.ball.h ?? 0, foes = m.foes('us'), foe = foes.filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    const front = !!foe && Math.abs(R.wrap(Math.atan2(foe.y - me.y, foe.x - me.x) - h)) < .5 && Math.hypot(foe.x - me.x, foe.y - me.y) < 3.2;
    const bx = me.x + Math.cos(h) * 5.5, by = me.y + Math.sin(h) * 5.5, space = bx > 2 && bx < PITCH.L - 1 && by > 2 && by < PITCH.W - 2 && foes.every(o => o === foe || Math.hypot(o.x - bx, o.y - by) > 2.5);
    const fits = front && space ? ((me.sp || 0) < 2.2 ? ['roll', 'double', 'croqueta'] : ['double', 'croqueta']) : front ? ['cruyff', 'chop'] : ['chop', 'cruyff'];
    const used = this.skUsed ||= {}, k = fits.reduce((p, q) => ((used[q] || 0) < (used[p] || 0) ? q : p));
    used[k] = (used[k] || 0) + 1; this.stats.offers = { ...(this.stats.offers || {}), [k]: (this.stats.offers?.[k] || 0) + 1 };
    return [k];
  }
  // The button's look (written only when it changes): an icon and a word, or (SKILL) the move's picture and its name.
  drawAction(k) {
    const opts = k === 'skill' ? (this.skillOpts ||= this.skillOptions()) : null; if (k !== 'skill') this.skillOpts = null;
    const key = k + (opts ? opts.join() : ''); if (key === this.actKey) return; this.actKey = key; this.actKind = k;
    const set = (b, kind, mv) => {
      cls(b, 'show', !!kind); if (!kind) return;
      b.dataset.kind = kind; cls(b, 'skill', !!mv);
      const [i, t] = mv ? [MOVE_SYM[mv] || '⭐', MOVE_NAME[mv] || 'Skill'] : kind === 'shoot' ? ['🥅', 'SHOOT'] : ['🦶', 'STEAL'];
      text(b.querySelector('i'), i); text(b.querySelector('span'), t); b.setAttribute('aria-label', t); // (v95: the text changed in place: no node made in play)
    };
    set(this.dom.act, k, opts?.[0]); set(this.dom.act2, null); // (v93: one button; the second stays hidden)
  }
  // (v96) STEAL's look from the ball's distance (ui/steal-look.js): a class only when it changes, never a node or a layout read.
  stealLook(h) {
    const st = this.actKind === 'steal' && h ? stealState(Math.hypot(this.sim.ball.x - h.x, this.sim.ball.y - h.y), this.ui.ballGlow, this.stealSt === 'far') : '';
    if (st !== this.stealSt) { this.stealSt = st; setStealLook(this.dom.act, st); }
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
    else if (how === 'save') soon(() => { say('Saved!'); hud.toast('🧤 Saved!'); });
    else if (how === 'out') soon(() => say('So close!'));
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
  // The move goes ANG of a turn off his way: across him (double, croqueta, roll), sharper away (chop), back (Cruyff).
  skill(k) {
    const s = this.sim, m = this.m, me = s.a(this.me), b = s.ball; if (!me || m.owner() !== this.me) return;
    if (this.V.crawl && this.bigChosen) this.E.resume = this.bigChosen; // (v96 E: after the move he goes on to where he chose: decideE)
    const ANG = { double: 1.05, croqueta: .95, roll: 1.2, chop: 1.6, cruyff: 2.6 }, h = b.h ?? 0, side = this.skillSide(), foe = m.foes('us').filter(o => Math.hypot(o.x - me.x, o.y - me.y) < 4).sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y))[0];
    const a = h + side * (ANG[k] || 1.05), tx = R.clamp(me.x + Math.cos(a) * 4, 1.5, PITCH.L - 1.5), ty = R.clamp(me.y + Math.sin(a) * 4, 1.5, PITCH.W - 1.5);
    s.flair = { ctx: 'fast', by: { [this.me]: { p: 1, can: ['double', 'chop', 'roll', 'croqueta', 'cruyff'], fav: [], tier: 'star' } } }; s.taps = new Set([this.me]); me.turnTap = k; me.skT = -9;
    m.dribble(this.me, tx, ty, 3.4, 1.6); m.meMove = { kind: 'near', until: s.time + 1.6, x: tx, y: ty };
    s.step(0); // (the turn starts now)
    const mv = b.move?.k || k;
    this.skT = s.time; this.stats.skills++; m.safeT = s.time + 1.3; this.skillOpts = null; this.set = null;
    if (foe) { s.go(foe.id, foe.x, foe.y, 0); m.cmd.set(foe.id, s.time + .9); } // fooled: he stops a moment
    this.slowTo = .3; m.after(.9, () => { if (!this.holding) this.slowTo = BASE; s.flair = null; s.taps = null; });
    soon(() => say((MOVE_NAME[mv] || MOVE_NAME[k] || 'Skill') + '!')); world.fx('skill'); // (v93: no picture over the play: the button said its name)
    game.plog?.('fast', { is: 'skill', move: mv, pick: k });
  }

  // ---------- the variants (v93 round 3: variant.js) ----------
  // The big choices with the ball, from where he stands now (bigChoices), looking where the view looks with the ball.
  // A choice still there (within .35 rad) keeps its place, so nothing slides under his finger.
  bigNow(h) {
    const m = this.m, old = this.big || [];
    const next = bigChoices({ me: h, yaw: R.naturalYaw(h, this.sim.ball, true, PITCH.L, PITCH.W), foes: m.allFoes('us'), L: PITCH.L, W: PITCH.W });
    this.big = next.map(c => old.find(o => Math.abs(R.wrap(o.a - c.a)) < .35 && o.kind === c.kind) || c); this.bigAt = this.real;
  }
  // His friends he can pass to now (with the ball): a big ring at their feet.
  litFriends() { const s = this.sim, m = this.m; if (m.owner() !== this.me) return []; return m.usIds.filter(id => id !== this.me && s.a(id) && this.ui.glow[id] > 0).map(id => s.a(id)); }
  // What the view keeps in the picture with the ball (A, C, D, head up): the big choices, and the friends he can pass to
  // that are in front of him.
  keepPts(h, has) {
    if (this.V?.crawl && !has && h && this.dec.on && this.E.side === 'off') return this.E.places.map(p => ({ x: p.x, y: p.y, z: 0 })); // (v96 E: its places off the ball)
    if (!this.V?.big || !has || !this.up1 || !h) return null;
    const out = (this.bigChosen ? [] : this.big || []).map(c => ({ x: c.x, y: c.y, z: 0 }));
    for (const f of this.litFriends()) if (Math.hypot(f.x - h.x, f.y - h.y) < 15 && Math.abs(R.wrap(Math.atan2(f.y - h.y, f.x - h.x) - this.yaw)) < 1.1) out.push({ x: f.x, y: f.y, z: .2 });
    return out.length ? out : null;
  }
  // A tap with the ball (A, C, D): a friend he can pass to passes; a friend whose lane is shut flashes the lane red and
  // does nothing else; a big choice (its arrow, its tip, or the grass along it) takes him there with the ball.
  tapBig(x, y) {
    const s = this.sim, m = this.m, me = s.a(this.me); this.stats.taps++; if (!me) return null;
    const reach = Math.max(70, world.height * .2), g = this.ground(x, y);
    let fb = null, fd = 1e9; for (const id of m.usIds) { if (id === this.me) continue; const a = s.a(id); if (!a) continue; for (const z of [.9, 0]) { const q = world.project(a.x, a.y, z); if (!q || !R.onScreen(q, world.width, world.height)) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < fd) { fd = d; fb = id; } } }
    const moving = !!(m.meMove && s.time < m.meMove.until), list = moving ? [] : this.big || [];
    for (const c of list) { c.q = world.project(c.x, c.y, 0); c.qm = world.project((me.x + c.x) / 2, (me.y + c.y) / 2, 0); }
    const ch = bigAt(list, me, x, y, g, world.height), cd = ch ? Math.min(...[ch.q, ch.qm].filter(Boolean).map(q => Math.hypot(q[0] - x, q[1] - y)), 1e9) : 1e9;
    if (fb && fd <= reach && fd * .8 < cd) { if (m.passCheck(this.me, fb).open) { this.passTo(fb); return { kind: 'pass', id: fb }; } this.blocked(fb); return null; }
    if (ch) { this.goBig(ch); return ch; }
    this.stats.deadTaps++; sfx('tap'); game.plog?.('fast', { is: 'tap', did: 'none' }); return null;
  }
  blocked(id) { const s = this.sim, a = s.a(this.me), b = s.a(id); if (!a || !b) return; this.lane = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, until: this.real + .7 }; this.stats.blocked++; this.stats.deadTaps++; sfx('tap'); game.plog?.('fast', { is: 'tap', did: 'blocked', to: id }); }
  goBig(c) { this.m.meTo(c.x, c.y); this.bigChosen = c; this.stats.bigTaps++; sfx('click'); this.acted('big', c.kind); game.plog?.('fast', { is: 'big', kind: c.kind, x: +c.x.toFixed(1), y: +c.y.toFixed(1) }); }
  dropTake() { const k = this.take; if (!k) return; this.take = null; this.m?.cmd.delete(k.id); }
  // The decision moment, each frame: it opens when he has the ball, stands with it and has not chosen; its clock starts
  // as he looks up (or DEC_UP s on); it ends when he chooses, loses the ball, or runs out (A, B: back to speed; D: the
  // nearest of theirs comes for the ball and takes it when he gets there, unless he chooses first).
  decide(h, has) {
    const s = this.sim, m = this.m, d = this.dec, moving = !!(m.meMove && s.time < m.meMove.until);
    if (!has || m.dead) { if (d.on || d.spent) d.reset(); if (!has) { this.big = null; this.bigChosen = null; this.dropTake(); } return; }
    if (moving || this.aiming || m.flight) { if (d.on) d.close(true); if (!moving) this.bigChosen = null; return; }
    this.bigChosen = null;
    if (this.V.big && (!this.big || this.real - this.bigAt > .6)) this.bigNow(h);
    if (!d.on && !d.spent) { d.open(this.real, this.up1); this.stats.decs++; game.plog?.('fast', { is: 'decide', variant: this.vid, n: (this.big || []).length }); }
    d.tick(this.real, this.up1);
    if (d.expired(this.real)) {
      d.close(false); this.stats.decOut++; game.plog?.('fast', { is: 'decideOut', variant: this.vid });
      if (this.V.stop) { const o = m.foes('us').filter(a => !a.gk).sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y))[0]; if (o) this.take = { id: o.id }; }
    }
    const k = this.take;
    if (k) { const o = s.a(k.id); if (!o) this.take = null; else if (Math.hypot(o.x - h.x, o.y - h.y) < 1) { this.take = null; m.fx('stolen'); sfx('down'); this.stats.ringTakes++; m.giveTo(k.id, 'tackle'); m.on.lost(this.me, k.id); } else { s.go(k.id, h.x, h.y, 5.2); m.cmd.set(k.id, s.time + 2); } }
  }

  // ---------- variant E: the crawl (v96, variant.js) ----------
  // Who has the ball, as E's off-ball points see it: 'ours:m1', 'theirs:o2', 'loose', or null (his own, on its way,
  // out of play, a restart, in a keeper's hands or at his feet, a shot).
  keyE() {
    const m = this.m, s = this.sim, b = s.ball, c = m.owner(), f = m.flight;
    if (m.dead || m.restart || b.state === 'held' || b.state === 'flying' || f?.kind === 'held' || f?.kind === 'shot' || c === this.me) return null;
    if (c) return s.a(c)?.gk ? null : (m.team(c) === 'us' ? 'ours:' : 'theirs:') + c;
    return f ? null : 'loose';
  }
  // Each frame: a decision point that is open ends when he chooses (acted), when the countdown ends (STAY: endE
  // 'default'), or when what it was about is gone (he lost the ball; off the ball: the ball came to him or changed hands).
  // None open: with the ball, one opens when he stands with it (he just got it, or got where he chose; after he kept it,
  // ON_AGAIN s later and not with one of theirs on him); off it, when offDue says the situation asks something of him.
  decideE(h, has) {
    const s = this.sim, m = this.m, d = this.dec, E = this.E, moving = !!(m.meMove && s.time < m.meMove.until);
    if (E.goAt && (!h || has || Math.hypot(h.x - E.goAt.x, h.y - E.goAt.y) < .8 || !moving)) E.goAt = null; // (the place he chose: shown until he is there)
    if (d.on) {
      const key = this.keyE();
      if (E.side === 'on' && (!has || m.dead || !h)) return this.endE('lost');
      if (E.side === 'off' && (has || m.dead || !h || m.flight?.to === this.me || (key && key !== E.key))) return this.endE('gone');
      d.tick(this.real, this.up1);
      if (d.expired(this.real)) this.endE('default');
      return;
    }
    if (!h || m.dead || this.aiming) return;
    if (has) {
      E.seen = 'mine';
      if (E.resume && !moving && !m.flight) { const r = E.resume; E.resume = null; m.meTo(r.x, r.y); this.bigChosen = r; return; } // (after a skill move: on to where he chose)
      if (moving || m.flight) return; // (carrying out what he chose)
      this.bigChosen = null;
      if (this.real < E.onAgain || (E.kept && m.foes('us').some(o => Math.hypot(o.x - h.x, o.y - h.y) < ON_PRESSED))) return; // (he kept it: real time a while; with one of theirs on him, the tackle plays out)
      this.openOn(h); return;
    }
    E.resume = null; E.kept = false; this.bigChosen = null; this.big = null;
    const key = this.keyE(), why = offDue({ key, seen: E.seen, now: this.real, lastOff: E.lastOff, lastEnd: E.endAt, ball: s.ball, ballAt: E.ballAt, toMe: m.flight?.to === this.me });
    if (why) this.openOff(h, key, why);
  }
  // On the ball: up to three big choices from his feet, the friends he can pass to now, SHOOT when it is on (the action
  // button), STAY; worked out once, here.
  openOn(h) {
    const s = this.sim, m = this.m, E = this.E;
    const yaw = R.naturalYaw(h, s.ball, true, PITCH.L, PITCH.W); this.big = bigChoices({ me: h, yaw, foes: m.allFoes('us'), L: PITCH.L, W: PITCH.W }); this.bigAt = this.real;
    { const W0 = world.width, H0 = world.height, cam = R.camSpec(h, s.ball, true, yaw, 1), under = c => { const q = R.project(cam, { x: c.x, y: c.y, z: 0 }, W0, H0); return !!q && q[1] > H0 - 130 && (q[0] > W0 - 250 || q[0] < 140); }, clear = this.big.filter(c => !under(c)); if (clear.length) this.big = clear; } // (none whose tip would sit under STAY, the action button or LOOK UP in the view head up, while another is left)
    E.friends = m.usIds.filter(id => id !== this.me && s.a(id) && m.passCheck(this.me, id).open);
    E.side = 'on'; E.kept = false; E.places = null; E.goAt = null; E.why = 'ball';
    E.offered = [...this.big.map(c => c.kind), ...E.friends.map(id => 'pass:' + id), ...[this.actionNow()].filter(k => k === 'shoot' || k === 'skill'), 'stay']; // (SHOOT, or a skill move: on the action button)
    this.dec.open(this.real, this.up1, E.len); this.stats.decs++; this.stats.eOn++; E.flip = !E.flip; // (flip: STAY's fill runs on the other of its two classes, so it starts again from empty every time)
  }
  // Off the ball: two or three places (variant.js offChoices) in sight (clear of the bar at the top and the buttons at the
  // bottom), and STAY. This situation has had its turn whether or not there is anything to ask.
  openOff(h, key, why) {
    const s = this.sim, m = this.m, E = this.E, st = this.spotState();
    E.seen = key; E.lastOff = this.real; E.ballAt = { x: s.ball.x, y: s.ball.y };
    if (!st.state || st.state === 'mine') return;
    const W0 = world.width, H0 = world.height, cam = this.cam, seen = p => { const q = R.project(cam, { x: p.x, y: p.y, z: 0 }, W0, H0); return !!q && q[0] > W0 * .1 && q[0] < W0 * .9 && q[1] > H0 * .24 && q[1] < H0 * .9 && !(q[1] > H0 - 150 && (q[0] < 140 || q[0] > W0 - 280)); };
    const args = { me: h, state: st.state, carrier: st.carrier, ball: s.ball, mates: m.usIds.filter(id => id !== this.me).map(id => s.a(id)).filter(Boolean), foes: m.foes('us'), keeper: m.keeper('them'), L: PITCH.L, W: PITCH.W };
    let places = offChoices(R.spotSet({ ...args, seen }), st.state, h);
    if (places.length < 2) places = offChoices(R.spotSet(args), st.state, h); // (too few in sight: the view keeps them in the picture, keepPts)
    if (!places.length) return;
    E.side = 'off'; E.key = key; E.places = places; E.goAt = null; E.why = why;
    E.offered = [...places.map(p => p.kind), 'stay'];
    this.dec.open(this.real, true, E.len); this.stats.eOff++; E.flip = !E.flip;
  }
  // The decision point ends: how ('fwd', 'wide', 'back', 'pass:m1', 'shoot', 'skill', 'steal', 'open', 'cover', 'press',
  // 'ball', 'stay', 'default' (the countdown ran out: STAY), 'lost', 'gone', 'reset'). STAY with the ball: he keeps it
  // where he is; off it: he stops where he is.
  endE(how) {
    const d = this.dec, E = this.E; if (!d.on || !E) return;
    const secs = +(this.real - d.t0).toFixed(2), side = E.side;
    d.close(true); E.side = null; E.endAt = this.real;
    if (side === 'on') { this.big = null; if (how === 'default' || how === 'stay') { E.kept = true; E.onAgain = this.real + ON_AGAIN; } }
    else if (how === 'default' || how === 'stay') { this.m.meMove = null; this.sim.stop(this.me); E.goAt = null; }
    if (how === 'default' || how === 'stay') { E.tk = !E.tk; cls(this.dom.stay, 'taken', E.tk); cls(this.dom.stay, 'taken2', !E.tk); E.takenAt = this.real; } // (v96 INT: STAY's "taken" moment, a pop of about 0.3 s: css #fStay.taken)
    this.stats.eEnds.push({ side, how, secs });
    game.plog?.('fast', { is: 'decide', variant: 'E', side, why: E.why, offered: E.offered.join(' '), chose: how, secs });
  }
  // A tap in E: with the ball, its big choices and friends (tapBig: the choices are none between decision points); off
  // it, at a decision point, the place nearest the tap (its ring or its card) within reach, or under the finger.
  tapE(x, y) {
    const m = this.m, E = this.E;
    if (m.owner() === this.me) return this.tapBig(x, y);
    this.stats.taps++;
    if (this.dec.on && E.side === 'off') {
      let best = null, bd = 1e9;
      for (const p of E.places) for (const z of [0, 1.05]) { const q = world.project(p.x, p.y, z); if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = p; } }
      if (best && bd > Math.max(70, world.height * .19)) { const g = this.ground(x, y); best = g ? E.places.find(p => Math.hypot(p.x - g.x, p.y - g.y) <= R.TAP_M) || null : null; }
      if (best) { this.goPlace(best); return best; }
    }
    this.stats.deadTaps++; sfx('tap'); game.plog?.('fast', { is: 'tap', did: 'none' }); return null;
  }
  // He goes there by himself, in real time: a run to a place (shown until he is there), or after their carrier or the
  // loose ball (match.js meTo press, chase).
  goPlace(p) {
    this.m.meTo(p.x, p.y, p.kind === 'press' ? 'press' : p.kind === 'ball' ? 'ball' : 'go');
    this.E.goAt = p.kind === 'open' || p.kind === 'cover' ? { x: p.x, y: p.y, kind: p.kind } : null;
    this.stats.placeTaps++; sfx('click'); this.acted('place', p.kind);
    game.plog?.('fast', { is: 'place', kind: p.kind, x: +p.x.toFixed(1), y: +p.y.toFixed(1) });
  }

  // ---------- one frame ----------
  // dt: real seconds (none while paused: js/pause.js).
  tick(dt) {
    if (!this.on || !dt) return;
    const t0 = performance.now(), s = this.sim, m = this.m, st = this.stats;
    this.real += dt; st.played += dt;
    { const hh = s.a(this.me); if (this.V.crawl) this.decideE(hh, !!hh && m.owner() === this.me); else this.decide(hh, !!hh && m.owner() === this.me); } // (v93 variants: the decision moment; v96 E: its decision points)
    const want = this.dec.on && !this.aiming ? this.dec.scale() : null, tgt = want != null ? Math.min(this.slowTo, want) : this.slowTo;
    if (this.V.crawl) this.slow = this.ramp.step(tgt, dt, tgt < this.slow ? CRAWL_IN : CRAWL_OUT); // (v96 E: a smooth step into the crawl and back)
    else {
    this.slow += (tgt - this.slow) * (1 - Math.exp(-dt * (tgt > this.slow ? 3 / BACK_S : want === 0 ? 14 : 8))); // (back up to speed over about BACK_S s)
    if (want === 0 && this.slow < .015) this.slow = 0;
    }
    const fx = this.holding || (!this.V.crawl && want != null && want < BASE * .9);
    if (this.V.crawl) { const on = this.dec.on; cls(this.dom.box, 'crawl', on); cls(this.dom.stay, 'show', on); const run = on && this.dec.clock != null; cls(this.dom.stay, 'run', run && !this.E.flip); cls(this.dom.stay, 'run2', run && this.E.flip); if (on) st.crawlT += dt; if (this.slow < .1) st.deepT += dt; this.E.waveK += ((on ? 1 : 0) - this.E.waveK) * (1 - Math.exp(-dt * 8)); } // (v96 E: its look, STAY and its fill, shown by class)
    if (this.V.crawl && this.E.takenAt != null && (this.dec.on || this.real - this.E.takenAt > .35)) { this.E.takenAt = null; cls(this.dom.stay, 'taken', false); cls(this.dom.stay, 'taken2', false); } // (v96 INT: STAY's pop over)
    if (fx !== this.dom.box.classList.contains('slowing')) this.dom.box.classList.toggle('slowing', fx); // (the hold's own slow look, here brought by the game)
    if (this.dec.on) st.decT += dt; if (this.slow === 0) st.stopT += dt;
    const gdt = dt * this.slow; if (this.slow < BASE * .9) st.slowT += dt; if (this.holding) st.holdT += dt; if (!this.up1) st.headDownT += dt;
    m.step(gdt); if (this.V.auto) m.autoStep();
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
    const eF = this.V.crawl ? (this.dec.on && this.E.side === 'on' ? this.E.friends : []) : null; // (v96 E: lit only at a decision point, those worked out as it opened)
    for (const id of m.usIds) this.ui.glow[id] = has && id !== this.me && (eF ? eF.includes(id) : m.passCheck(this.me, id).open) ? .55 : 0; // (gold: a pass that will get there)
    // the action button, the ball's glow for a steal in time, and a shot he did not finish
    this.drawAction(this.aiming ? null : this.actionNow());
    // (v93) Head down with no spot in sight for a moment: LOOK UP nudges (his way to see the places he can go)
    const nudge = !this.up1 && !m.dead && (this.set?.spots.length || 0) < 2 && this.real - (this.downAt || 0) > 1.2;
    if (nudge !== !!this.nudged) { this.nudged = nudge; this.dom.look.classList.toggle('nudge', nudge); }
    this.scanCue(h);
    if ((this.hintPT = (this.hintPT || 0) + dt) > .5) { this.hintPT = 0; if (this.dom.cue.classList.contains('show')) this.placeHint(this.dom.cue); }
    // a long match: after NEXT_WINS s the next goal wins (a picture and a word); at END_S it ends as it stands
    if (!this.sudden && this.real > NEXT_WINS && !this.over) { this.sudden = m.sudden = true; // (and both teams go for it: match.js; the next goal ends it, the score as it stands then)
      if (m.score.us === m.score.them) { this.dom.box.querySelector('#fNext').classList.add('show'); soon(() => say('Next goal wins!')); sfx('ping'); } game.plog?.('fast', { is: 'nextGoalEnds', level: m.score.us === m.score.them ? 1 : 0 }); }
    if (this.real > END_S && !this.over && !m.dead) { this.over = true; m.dead = true; s.stopAll(); this.finish(); return; }
    this.ui.ballGlow = this.actKind === 'steal' && m.canSteal(); this.stealGlow = this.ui.ballGlow; // (only while a press would win it now)
    this.stealLook(h); // (v96: STEAL shows by how far the ball is: not at all, small and dim, or full and bright)
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
    if (this.lane && this.real > this.lane.until) this.lane = null;
    if (this.V.crawl) { // (v96 E: its choices (on a clock of real s: they breathe while the world crawls), its countdown ring, its places, the crawl's waves)
      const E = this.E, on = this.dec.on ? E.side : null;
      this.marks.big(show && (has || on) ? h : null, show && has && on === 'on' ? this.big : null, show && has ? this.bigChosen : null, show && on === 'on' ? this.litFriends() : null, show ? this.lane : null, show && on ? this.dec.left(this.real) : null, this.real, E_RING);
      this.marks.places(show && on === 'off' ? E.places : null, show && !has && !on ? E.goAt : null, this.real); this.marks.crawl(show ? h : null, E.waveK, this.real);
    } else this.marks.big(show && has ? h : null, show && has && !this.bigChosen ? this.big : null, show && has ? this.bigChosen : null, show && this.V.big ? this.litFriends() : null, show ? this.lane : null, show && this.V.stop && this.dec.on ? this.dec.left(this.real) : null, this.ui.clock);
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
      const key = c.id + (c.gold ? 'g' : ''); if (key !== d.key) { d.key = key; for (const id in d.pics) cls(d.pics[id], 'on', id === c.id); cls(d.b, 'gold', c.gold); } // (v95: the shirts made before play: chipPics)
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
