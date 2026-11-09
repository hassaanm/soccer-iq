// Game flow: lesson demo → rounds with feedback → mini match. Owns input, camera, team AI and outcome scripts.
// This file holds the class itself: its state, scenario setup, the timing helpers and the per-frame tick. The
// methods for each concern live in js/game/ and are added to the class at the bottom of this file.
import { Sim } from './sim.js';
import { demoScenario } from './skills.js';
import { clamp, closestOnLane } from './geom.js';
import { displayName } from './teams.js';
import { MATES, DIRS, NONE, facesBall, wrap } from './game/shared.js';
import { rounds } from './game/rounds.js';
import { outcomes } from './game/outcomes.js';
import { team } from './game/team.js';
import { live } from './game/live.js';
import { demo } from './game/demo.js';
import { input } from './game/input.js';
import { view } from './game/view.js';

const SPEECH_CAP = 15; // seconds: the longest talk() waits for the voice beyond the time the line takes to read

export class Game {
  // sfx(name) plays a sound; fx(event, value) shows an effect in the 3D scene (see World.fx).
  constructor({ world, hud, say, sfx = () => {}, fx = () => {} }) {
    Object.assign(this, { world, hud, say, sfx, fx });
    this.sim = new Sim();
    this.sim.on = (ev, v) => { sfx(ev === 'kick' ? (v >= 15 ? 'shot' : 'kick') : ev === 'touch' ? 'tap' : 'step'); if (ev !== 'step') fx(ev, v); };
    this.tweens = []; this.speechWaits = [];
    // What tick() hands on each frame is kept and updated in place, so a frame makes no new objects for it:
    // `ui` (what the 3D scene highlights; 0 in glow/arrows means off), the canvas size, and where the hand last was.
    this.ui = { glow: { m1: 0, m2: 0 }, arrows: Object.fromEntries(DIRS.map(d => [d, 0])), spots: NONE, lines: NONE, heroRing: false, ballGlow: false, turnArrows: NONE };
    this.view = { w: 0, h: 0, at: NaN }; this.clock = 0;
    this.handLast = { on: null, id: null, x: null, y: null, tap: null };
    this.skills = new Set(); // lessons he has passed: each adds its part to matches (see has())
    this.reset();
    this.mode = 'home';
    this.sim.setup(demoScenario('look-up'));
  }

  reset() {
    Object.assign(this, { phase: 'idle', step: null, seen: new Set(), look: 0, lookUp: false, yaw: 0, drag: null,
      scanned: false, hint: false, cam: null, camMode: 'orbit', lines: [], aimAt: null, decideAt: 0,
      ai: false, scripted: new Set(), ballTeam: 'us', follow: null, frozen: [], tk: null, yaw0: null, peeked: false, showing: false, handAt: null });
  }

  home() { this.mode = 'home'; this.reset(); this.sim.setup(demoScenario('look-up')); this.camMode = 'orbit'; this.cam = null; this.hud.caption(''); }

  setTeams(us, them) { this.us = us; this.them = them; this.world.setTeams(us, them); }
  name(id) {
    if (id[0] === 'o') return displayName(this.them.players[+id[1] - 1].name);
    return displayName(this.us.players[(this.roster || { hero: 0, m1: 1, m2: 2 })[id]].name);
  }
  // Big pushes are offered in the dribble lesson, in free play, and in mini matches once he has played the dribble lesson.
  get pushAllowed() { return this.sc?.skill === 'dribble-to-space' || this.sc?.skill === 'won-it-go' || this.has('dribble-to-space'); }
  // In matches and free play, what he can do grows with the lessons he has passed:
  //   Run into space → big pushes; Win it back! → he picks where to run after losing the ball (otherwise his team
  //   defends for him); Steal it! → 1v1 STEAL moments; Won it? Go! → play goes straight on after he wins it;
  //   Peek, then turn! → a pass to him waits in the air for a peek and a turn; Get open! → after a pass he
  //   sometimes stays himself and picks where to run; Pass and go! → that run goes past his defender;
  //   Only one bee / Guard the open player → "Guard" spots when defending. Every passed lesson also adds its
  //   own situations to free play.
  has(id) { return (this.mode === 'match' || this.mode === 'free') && this.skills.has(id); }

  // ---------- scenario setup ----------
  load(sc) {
    this.reset(); this.sc = sc; this.grades = null; this.sim.setup(sc); this.camMode = 'player'; this.cam = null;
    this.roster = { hero: 0, m1: 1, m2: 2 }; this.world.resetRigs?.();
    if (facesBall(sc)) { const h = this.sim.a('hero'), c = this.sim.a(sc.carrier); this.yaw = this.frameYaw(sc, h, c); this.faceYaw(h); }
  }
  // Which way he faces at the start of a spot round: toward the ball, turned so the ball and every spot are on
  // screen when they fit. Otherwise the right spot would often be the one he has to turn to find, and he could
  // learn "the answer is always behind me".
  frameYaw(sc, h, c) {
    const toC = Math.atan2(c.y - h.y, c.x - h.x);
    if (!sc.spots?.length) return toC;
    const angs = [0, ...sc.spots.map(p => wrap(Math.atan2(p.y - h.y, p.x - h.x) - toC))], lo = Math.min(...angs), hi = Math.max(...angs);
    return hi - lo < 1.25 ? wrap(toC + (lo + hi) / 2) : toC;
  }
  // The start of every new decision inside a play that is already running: back to the head-down phase, with
  // nobody scripted, no lines drawn and the player camera. `more` holds what else that decision resets.
  beginStep(more) { Object.assign(this, { phase: 'pre', step: null, scripted: new Set(), lines: [], aimAt: null, ai: false, camMode: 'player', follow: null, grades: null }, more); }
  // Turns his body to where the view looks.
  faceYaw(h) { h.face = [Math.cos(this.yaw), Math.sin(this.yaw)]; }

  // ---------- timing helpers ----------
  // While skipping the demo, every wait finishes at once so the demo script runs straight to its end.
  // One timed job, run by tick(): f(0..1) is called every frame for `dur` seconds of game time (or until `until()`
  // is true), then `done` resolves. cancel() ends a job early, without its last f(1).
  job(dur, f = null, until = null) { const t = { t: 0, dur, f, until, res: null, done: null, dead: false }; t.done = new Promise(res => { t.res = res; }); this.tweens.push(t); return t; }
  cancel(t) { if (t && !t.dead) { t.dead = true; t.res(); } }
  delay(sec) { return this.skipping ? Promise.resolve() : this.job(sec).done; }
  tween(sec, f) { if (this.skipping) { f(1); return Promise.resolve(); } return this.job(sec, f).done; }
  // Waits (in game time) until `f` is true.
  until(f) { return this.skipping ? Promise.resolve() : this.job(1e9, null, f).done; }
  // Runs an outcome script in the sim. It resolves when the script ends, also when the script throws: the error
  // still reaches the frame loop's log, but the round goes on instead of waiting forever.
  play(gen) { return this.skipping ? Promise.resolve() : new Promise(res => { this._playRes = res; this.sim.run((function* () { try { yield* gen; } finally { res(); } })()); }); }
  skipDemo() {
    if (this.mode !== 'demo') return;
    this.skipping = true; this.sim.co = null; this._playRes?.();
    for (const t of this.tweens.splice(0)) if (!t.dead) { t.f?.(1); t.res(); }
    for (const f of this.speechWaits.splice(0)) f();
  }
  // Says a line with its caption, waits until it has been said, then gives him a moment to take it in. The wait
  // is never shorter than a slow reading of the line (about 12 letters a second), so it works with the voice off.
  // If the voice never reports that a line has ended (a stalled audio player), the wait ends anyway after
  // SPEECH_CAP seconds plus a very slow reading of the line, so a demo cannot hang on it.
  async talk(text, pause = 1.2, caption = text) {
    if (this.skipping) return;
    this.hud.caption(caption);
    const spoken = this.say(text), waits = this.speechWaits;
    const heard = typeof spoken?.then === 'function' ? new Promise(res => {
      const cap = this.job(SPEECH_CAP + text.length / 6); let done = false;
      const fin = () => { if (done) return; done = true; const i = waits.indexOf(fin); if (i >= 0) waits.splice(i, 1); this.cancel(cap); res(); };
      waits.push(fin); spoken.then(fin, fin); cap.done.then(fin); // Skip (see skipDemo) calls fin too
    }) : null;
    await Promise.all([this.delay(.6 + text.length / 12), heard]);
    await this.delay(pause);
  }

  // ---------- per frame ----------
  tick(dt, time) {
    this.clock = time;
    // Timed jobs. Finished and cancelled ones drop out as the list is packed down in place (no copy each frame);
    // a job added while this runs waits at the end for the next frame.
    const jobs = this.tweens, n = jobs.length; let keep = 0;
    for (let i = 0; i < n; i++) {
      const t = jobs[i]; if (t.dead) continue;
      t.t += dt; const u = Math.min(1, t.t / t.dur); t.f?.(u);
      if (t.dead) continue;
      if (u >= 1 || t.until?.()) t.res(); else jobs[keep++] = t;
    }
    for (let i = n; i < jobs.length; i++) jobs[keep++] = jobs[i];
    jobs.length = keep;
    if (this.sc?.kind === 'tackle' && this.camMode === 'player' && this.sim.a('hero')) { // keep the attacker in view
      const h = this.sim.a('hero'), b = this.sim.ball, want = Math.atan2(b.y - h.y, b.x - h.x);
      this.yaw = wrap(this.yaw + wrap(want - this.yaw) * Math.min(1, dt * 4));
    }
    // Players held still for a kick go back to the team AI once the ball has landed.
    // While a low ball is in the air, anyone the scripts aren't moving stops before stepping into its path.
    const fb = this.sim.ball;
    if (fb.state === 'flying') {
      const to = { x: fb.tx, y: fb.ty };
      for (const p of this.sim.agents.values()) {
        if (this.scripted.has(p.id) || closestOnLane(p, fb, to, 0).d >= 1) continue; // the receiver and the interceptor are scripted; everyone else gets out of the way
        this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, fb, to, fb.z < .9);
      }
    }
    if (this.kicked && this.sim.ball.state !== 'flying') { for (const id of this.frozen) this.scripted.delete(id); this.frozen = []; this.kicked = false; }
    if (this.ai) this.teamAI();
    const held = this.phase === 'feedback' || (this.sc?.kind === 'receive' && this.phase === 'decide'); // a pass on its way waits while he peeks
    if (!held) this.sim.step(dt);
    if (this.sc?.kind === 'receive' && this.phase === 'decide' && this.yaw0 != null && Math.abs(wrap(this.yaw - this.yaw0)) > 1.4) this.peeked = true;

    const s = this.sim, h = s.a('hero');

    this.look = clamp(this.look + (this.lookUp ? 1 : -1) * dt / .3, 0, 1);
    // While deciding with his head up, his body turns with his head (the ball stays at his feet).
    if (h && this.phase === 'decide' && this.lookUp && this.step !== 'dribble' && this.sc?.kind !== 'receive') {
      const f0 = Math.atan2(h.face[1], h.face[0]), f = f0 + wrap(this.yaw - f0) * Math.min(1, dt * 10);
      h.face[0] = Math.cos(f); h.face[1] = Math.sin(f);
    }

    // Teammates count as found when he can see them with his head up. Everyone spotted together shows in one message.
    if (this.look > .8 && (this.phase === 'pre' || this.phase === 'decide')) {
      let found = null;
      for (const id of MATES) {
        if (this.seen.has(id)) continue;
        const a = s.a(id), q = this.world.project(a.x, a.y, .9), v = this.viewSize();
        if (q && q[0] > v.w * .05 && q[0] < v.w * .95 && q[1] > v.h * .05 && q[1] < v.h * .95) { this.seen.add(id); (found ||= []).push(this.name(id)); }
      }
      if (found && this.mode !== 'demo' && !facesBall(this.sc) && this.sc?.skill !== 'dribble-to-space' && (this.step === 'pass' || (!this.step && this.lookUp))) this.hud.seen(`👀 You see ${found.join(' and ')}`);
    }
    this.updateCamera(dt, time);
    this.updateHud();
  }
}

// The rest of Game lives in js/game/: each file holds the methods for one concern. They are copied onto the class
// here, getters included. A name defined twice would silently replace the first one, so that is an error.
for (const part of [rounds, outcomes, team, live, demo, input, view]) {
  for (const name of Object.keys(part)) if (name in Game.prototype) throw new Error(`Game.${name} is defined twice`);
  Object.defineProperties(Game.prototype, Object.getOwnPropertyDescriptors(part));
}
