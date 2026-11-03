// Game flow: lesson demo → rounds with feedback → mini match. Owns input, camera and outcome scripts.
import { Sim } from './sim.js';
import { PITCH, demoScenario, pickRounds } from './skills.js';
import { lerp, clamp, smooth, rot, dist, interceptor, dribbleEnd } from './geom.js';
import { displayName } from './teams.js';

const { L, W, gy0, gy1 } = PITCH;
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };
const SCAN_TIME = 3; // seconds for one look-around
const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
};
// Yaw over one scan: left shoulder, right shoulder, back to center.
const scanYaw = t => t < .9 ? lerp(0, 1.05, smooth(t / .9)) : t < 2.1 ? lerp(1.05, -1.05, smooth((t - .9) / 1.2)) : lerp(-1.05, 0, smooth((t - 2.1) / .6));

export class Game {
  constructor({ world, hud, say }) {
    Object.assign(this, { world, hud, say });
    this.sim = new Sim();
    this.tweens = [];
    this.reset();
    this.mode = 'home';
    this.sim.setup(demoScenario('look-up'));
  }

  reset() {
    Object.assign(this, { phase: 'idle', step: null, seen: new Set(), look: 0, yaw: 0, yawT: 0, holding: false, drag: null,
      scanned: false, scanT: null, hint: false, cam: null, camMode: 'orbit', lines: [], aimAt: null, decideAt: 0, ballDir: 1 });
  }

  setTeams(us, them) { this.us = us; this.them = them; this.world.setTeams(us, them); }
  name(id) {
    if (id === 'hero') return displayName(this.us.players[0].name);
    if (id[0] === 'm') return displayName(this.us.players[+id[1]].name);
    return displayName(this.them.players[+id[1] - 1].name);
  }

  // ---------- timing helpers ----------
  delay(sec) { return new Promise(res => this.tweens.push({ t: 0, dur: sec, f: null, res })); }
  tween(sec, f) { return new Promise(res => this.tweens.push({ t: 0, dur: sec, f, res })); }
  play(gen) { return new Promise(res => this.sim.run((function* () { yield* gen; res(); })())); }

  // ---------- scenario setup ----------
  load(sc) {
    this.reset(); this.sc = sc; this.sim.setup(sc); this.camMode = 'player'; this.cam = null;
  }
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    s.go('hero', ...sc.heroTo, 3.6);
    (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(1.3);
    s.stopAll();
  }
  decide() {
    this.phase = 'decide'; this.step = null; this.decideAt = this.sim.time;
    this.delay(1.2).then(() => { if (this.phase === 'decide') this.hud.caption(''); });
    return new Promise(res => { this._choose = res; });
  }
  isGood(opt) { return opt === this.sc.best || (this.sc.ok || []).includes(opt); }
  target(opt) {
    const h = this.sim.a('hero');
    return MATE[opt] ? { ...this.sim.a(MATE[opt]) } : dribbleEnd(h, opt.slice(5), L, W);
  }
  cue() { return this.sc.cue.replace('{m0}', this.name('m1')).replace('{m1}', this.name('m2')); }

  // ---------- outcome scripts ----------
  *finish(id) {
    const s = this.sim, a = s.a(id), tx = L - 5.5, ty = lerp(a.y, W / 2, .75);
    s.go(id, tx, ty, 5.4);
    // Defenders chase from behind and are too slow to catch up.
    for (const o of s.team('them')) s.go(o.id, lerp(o.x, a.x, .6), lerp(o.y, a.y, .6), 3.2);
    for (const m of s.team('us')) if (m.id !== id) s.go(m.id, Math.min(L - 7, m.x + 5), m.y, 4);
    const t0 = s.time; yield () => Math.hypot(a.x - tx, a.y - ty) < .3 || s.time - t0 > 3;
    s.stop(id); yield* this.strike(id, L + .7, clamp(a.y, gy0 + .8, gy1 - .8), { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.emit('goal'); s.stopAll(); yield 1.4;
  }
  // Wind up, then the ball leaves the foot at contact.
  *strike(id, x, y, opts) { this.sim.windup(id); yield .2; this.sim.kick(x, y, opts); }
  *passGood(id) {
    const s = this.sim, t = s.a(id);
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    yield () => s.ball.state === 'loose';
    s.give(id); yield .15;
  }
  *steal(opp) {
    const s = this.sim; s.give(opp.id); s.stop('hero'); this.emit('stolen');
    s.go(opp.id, opp.x - 4, lerp(opp.y, W / 2, .4), 4.8); yield .8;
  }
  *passBad(id) {
    const s = this.sim, ic = interceptor(s.ball, s.a(id), s.team('them'));
    s.go(ic.opp.id, ic.x, ic.y, 6); yield* this.strike('hero', ic.x, ic.y, { speed: 13, arc: .15 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(ic.opp);
  }
  *dribbleGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W);
    s.go('hero', end.x, end.y, 4.4);
    const opps = s.team('them').sort((a, b) => dist(a, end) - dist(b, end));
    const t0 = s.time;
    if (good) {
      for (const o of opps) s.go(o.id, lerp(o.x, end.x, .3), lerp(o.y, end.y, .3), 2.6);
      yield () => dist(h, end) < .3 || s.time - t0 > 2.5;
      yield* this.finish('hero');
    } else {
      for (const o of opps.slice(0, 2)) s.go(o.id, end.x, end.y, 5);
      yield () => opps.some(o => dist(o, h) < .9) || s.time - t0 > 2.5;
      yield* this.steal(opps.find(o => dist(o, h) < 1.2) || opps[0]);
    }
  }
  *counter() {
    const s = this.sim, c = s.a(s.ball.carrier);
    s.go(c.id, 5, W / 2, 5.4); s.go('hero', 7, W / 2, 4.6);
    const t0 = s.time; yield () => dist(c, { x: 5, y: W / 2 }) < .3 || s.time - t0 > 3.5;
    s.stop(c.id); yield* this.strike(c.id, -.7, W / 2, { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.emit('goalAgainst'); s.stopAll(); yield 1.3;
  }
  *outcomeGen(opt, good, counter) {
    if (MATE[opt]) {
      if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
      else yield* this.passBad(MATE[opt]);
    } else yield* this.dribbleGen(opt.slice(5), good);
    if (!good && counter) yield* this.counter();
  }
  async outcome(opt, good, counter = false) {
    const h = this.sim.a('hero');
    this.phase = 'outcome'; this.step = null; this.holding = false; this.scanT = null; this.camMode = 'follow';
    this.follow = { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    await this.play(this.outcomeGen(opt, good, counter));
  }
  emit(ev) {
    if (ev === 'goal') { this.hud.banner('GOAL!', 'goal'); this.say('Goal!'); }
    if (ev === 'goalAgainst') { this.hud.banner('They scored', 'bad'); }
    if (ev === 'stolen') { this.hud.banner('Stolen!', 'bad'); }
  }

  // ---------- flows ----------
  async demo(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); this.load(sc);
    const hero = this.name('hero'), mate = this.name(MATE[sc.best] || 'm1');
    this.hud.caption(`Watch ${hero}!`); this.say(`Watch ${hero}.`);
    await this.pre();
    this.phase = 'decide';
    this.hud.caption(`${hero} looks up… 👀`); this.say(`${hero} looks up, and looks around.`);
    this.startScan(); await this.delay(SCAN_TIME);
    this.hud.caption(`${mate} is open!`); this.say(`${mate} is open!`);
    await this.delay(.6); this.step = 'pass'; this.hint = true; await this.delay(1.4);
    this.hud.caption('Pass!'); this.say('Pass!');
    await this.outcome(sc.best, true);
    this.hud.caption('');
  }

  // Plays one scenario until he gets it. Wrong choices show why, replay the better way, then retry.
  async round(sc, { hint }) {
    this.mode = 'lesson';
    this.load(sc); await this.pre();
    const save = this.sim.save();
    for (let attempt = 1; ; attempt++) {
      this.hint = hint || attempt > 1;
      const opt = await this.decide();
      const good = this.isGood(opt), scanned = this.scanned;
      await this.outcome(opt, good);
      if (good) {
        this.hud.toast(scanned ? 'You looked up! ⭐' : 'Nice! ⭐');
        this.say(scanned ? 'You looked up! Great job!' : 'Nice!');
        await this.delay(.9);
        return { firstTry: attempt === 1 };
      }
      await this.feedback(save, opt);
      this.sim.restore(save); this.reset(); this.camMode = 'player';
      this.seen = new Set(MATE[sc.best] ? [MATE[sc.best]] : []);
      this.hud.caption('Watch this way!'); this.say('Watch this way.');
      await this.outcome(sc.best, true);
      this.sim.restore(save); this.reset(); this.camMode = 'player';
      this.hud.caption('Your turn!'); this.say('Your turn!');
    }
  }
  // Freeze at the decision moment: red line for his choice, green for the better one.
  async feedback(save, opt) {
    this.sim.restore(save); this.reset(); this.camMode = 'overview'; this.phase = 'feedback';
    const ball = { x: this.sim.ball.x, y: this.sim.ball.y }, bad = this.target(opt), best = this.target(this.sc.best);
    this.lines = [{ a: ball, b: { x: bad.x, y: bad.y }, color: '#e5484d' }, { a: ball, b: { x: best.x, y: best.y }, color: '#30a46c' }];
    this.aimAt = { x: (bad.x + best.x) / 2, y: (bad.y + best.y) / 2 };
    const cue = this.cue();
    this.hud.caption(cue); this.say(cue);
    await this.delay(3.2);
    this.lines = []; this.aimAt = null;
  }

  async match(skillIds) {
    this.mode = 'match';
    const score = { us: 0, them: 0 }; this.hud.score(score, this.us, this.them);
    const rounds = pickRounds(skillIds, 12);
    for (let i = 0; score.us < 2 && score.them < 2; i++) {
      this.load(rounds[i % rounds.length]); await this.pre();
      const opt = await this.decide(), good = this.isGood(opt);
      await this.outcome(opt, good, true);
      good ? score.us++ : score.them++;
      this.hud.score(score, this.us, this.them);
    }
    return score;
  }

  home() { this.mode = 'home'; this.reset(); this.sim.setup(demoScenario('look-up')); this.camMode = 'orbit'; this.cam = null; this.hud.caption(''); }

  // ---------- input ----------
  get canAct() { return this.phase === 'decide' && this.mode !== 'demo'; }
  get canLook() { return (this.phase === 'pre' || this.phase === 'decide') && this.mode !== 'demo'; }
  lookStart(x, width) { if (!this.canLook) return; this.scanT = null; this.holding = true; this.drag = { x0: x, yaw0: this.yaw, w: width }; }
  // One tap on LOOK: lift the head and turn over the left shoulder, the right shoulder, then forward.
  scan() { if (this.canLook) this.startScan(); }
  startScan() { this.scanT = 0; this.scanned = true; }
  lookMove(x) { if (this.drag && this.holding) this.yawT = clamp(this.drag.yaw0 - (x - this.drag.x0) / this.drag.w * 2.4, -1.3, 1.3); }
  lookEnd() { this.drag = null; this.holding = false; }
  pass() {
    if (!this.canAct) return; this.step = 'pass';
    if (!this.seen.size) { this.hud.toast('Look first! 👀', true); this.say('Look first!'); }
  }
  dribble() { if (this.canAct) this.step = 'dribble'; }
  dribbleDir(d) { if (this.step === 'dribble') this.choose('drib:' + d); }
  back() { if (this.canAct) this.step = null; }
  choose(opt) { if (this.canAct && this._choose) { const f = this._choose; this._choose = null; f(opt); } }
  // Returns true when the tap picked a pass target or dribble arrow.
  tap(x, y) {
    if (!this.canAct || !this.step) return false;
    // Players: near their body. Arrows: anywhere along the arrow.
    let best = null, bd = 64;
    const h = this.sim.a('hero');
    for (const t of this.targets()) {
      const q = this.world.project(t.x, t.y, t.z); if (!q) continue;
      let d = Math.hypot(q[0] - x, q[1] - y);
      if (this.step === 'dribble') {
        const p0 = this.world.project(lerp(h.x, t.x, .3), lerp(h.y, t.y, .3), 0);
        if (p0) d = Math.min(d, segDist(x, y, p0, q));
      }
      if (d < bd) { bd = d; best = t; }
    }
    if (best) { this.choose(best.opt); return true; }
    return false;
  }
  targets() {
    const h = this.sim.a('hero');
    if (this.step === 'pass') return Object.entries(MATE).filter(([, id]) => this.seen.has(id)).map(([opt, id]) => ({ opt, ...this.sim.a(id), z: .8 }));
    if (this.step === 'dribble') return ['fwd', 'left', 'right', 'back'].map(d => { const e = dribbleEnd(h, d, L, W); return { opt: 'drib:' + d, x: lerp(h.x, e.x, .8), y: lerp(h.y, e.y, .8), z: 0 }; });
    return [];
  }

  // ---------- per frame ----------
  tick(dt, time) {
    for (const t of this.tweens.slice()) {
      t.t += dt; const u = Math.min(1, t.t / t.dur); t.f?.(u);
      if (u >= 1) { this.tweens.splice(this.tweens.indexOf(t), 1); t.res(); }
    }
    if (this.phase !== 'feedback') this.sim.step(dt);
    const s = this.sim, h = s.a('hero');

    // Head: hold to look up; drag to turn. Picking a pass or showing feedback lifts the head toward the targets.
    let scanning = false;
    if (this.scanT != null) { this.scanT += dt; scanning = this.scanT < SCAN_TIME; if (scanning) this.yawT = scanYaw(this.scanT); else this.scanT = null; }
    const aimPts = this.aimAt ? [this.aimAt] : this.step === 'pass' && !this.holding ? [...this.seen].map(id => s.a(id)) : [];
    if (scanning) { /* yaw set by the scan */ }
    else if (aimPts.length && h) this.yawT = clamp(aimPts.reduce((a, p) => a + Math.atan2(p.y - h.y, p.x - h.x), 0) / aimPts.length * .8, -1.3, 1.3);
    else if (!this.holding) this.yawT = 0;
    this.yaw += (this.yawT - this.yaw) * Math.min(1, dt * 7);
    const up = this.holding || scanning || aimPts.length > 0;
    this.look = clamp(this.look + (up ? 1 : -1) * dt / .35, 0, 1);
    if (this.holding) this.scanned = true;

    // Spot teammates that are on screen while looking up.
    if (this.look > .8 && (this.phase === 'pre' || this.phase === 'decide')) {
      const cw = this.world.canvas.clientWidth, ch = this.world.canvas.clientHeight;
      for (const id of ['m1', 'm2']) {
        if (this.seen.has(id)) continue;
        const a = s.a(id), q = this.world.project(a.x, a.y, .9);
        if (q && q[0] > cw * .1 && q[0] < cw * .9 && q[1] > ch * .05 && q[1] < ch * .95) {
          this.seen.add(id);
          if (this.mode !== 'demo') { this.hud.toast(`👀 You see ${this.name(id)}!`); this.say(this.name(id)); }
        }
      }
    }
    this.updateCamera(dt, time);
    this.updateHud(time);
  }

  camSpec(time) {
    const s = this.sim, h = s.a('hero'), b = s.ball;
    if (this.camMode === 'orbit') { const a = time * .08; return { eye: [L / 2 + Math.cos(a) * 24, W / 2 + Math.sin(a) * 24, 10], tgt: [L / 2, W / 2, 0], Ff: .9, Fw: .4 }; }
    if (this.camMode === 'overview') {
      const p = this.aimAt || h, mx = (h.x + p.x) / 2, my = (h.y + p.y) / 2;
      return { eye: [mx - 8, my, 9], tgt: [mx + 1.5, my, 0], Ff: .85, Fw: .42 };
    }
    if (this.camMode === 'follow') {
      // A calm chase camera: it trails a smoothed point near the ball and only turns around
      // (slowly) when the other team has the ball, so kicks and passes never make it jump.
      const f = this.follow;
      const c = s.a(b.carrier); if (c) f.yawT = c.team === 'them' ? Math.PI : 0;
      return { eye: [f.x - Math.cos(f.yaw) * 7, f.y - Math.sin(f.yaw) * 7, 4.2], tgt: [f.x + Math.cos(f.yaw) * 4, f.y + Math.sin(f.yaw) * 4, .3], Ff: .9, Fw: .46 };
    }
    // Choosing a dribble: raise the camera so all four arrows are on screen.
    if (this.step === 'dribble' && this.phase === 'decide') return { eye: [h.x - 8, h.y, 9], tgt: [h.x, h.y, 0], Ff: .95, Fw: .5 };
    // Player view. Head down: tight on the ball. Head up: just above head height behind him, turned by yaw.
    const k = smooth(this.look), yw = this.yaw * k;
    const [bx, by] = rot(-lerp(3.1, 5.2, k), lerp(1.3, .3, k), yw), [fx, fy] = rot(9, 0, yw);
    return { eye: [h.x + bx, h.y + by, lerp(2.9, 2.8, k)], tgt: [lerp(b.x + .8, h.x + fx, k), lerp(b.y - .2, h.y + fy, k), lerp(0, .5, k)], Ff: lerp(1.05, .9, k), Fw: lerp(.64, .52, k) };
  }
  updateCamera(dt, time) {
    const f = this.follow, b = this.sim.ball;
    if (this.camMode === 'follow' && f) {
      const k = 1 - Math.exp(-dt * 2.2), ahead = f.yaw > 1.5 ? -2 : 2;
      f.x = lerp(f.x, b.x + ahead, k); f.y = lerp(f.y, lerp(b.y, W / 2, .4), k);
      f.yaw += (f.yawT - f.yaw) * (1 - Math.exp(-dt * 1.4));
    }
    const want = this.camSpec(time);
    if (!this.cam) { this.cam = { eye: [...want.eye], tgt: [...want.tgt], Ff: want.Ff, Fw: want.Fw }; return; }
    const k = 1 - Math.exp(-dt * (this.camMode === 'player' ? 12 : 4));
    for (let i = 0; i < 3; i++) { this.cam.eye[i] = lerp(this.cam.eye[i], want.eye[i], k); this.cam.tgt[i] = lerp(this.cam.tgt[i], want.tgt[i], k); }
    this.cam.Ff = lerp(this.cam.Ff, want.Ff, k); this.cam.Fw = lerp(this.cam.Fw ?? want.Fw, want.Fw, k);
  }
  updateHud(time) {
    const hud = this.hud, best = this.sc?.best, bestMate = MATE[best];
    let prompt = '';
    if (this.mode === 'lesson' || this.mode === 'match') {
      if (this.phase === 'pre') prompt = this.holding || this.scanT != null ? '' : 'Tap 👀 to look around';
      else if (this.phase === 'decide') prompt = this.step === 'pass' ? (this.seen.size ? 'Tap a friend' : 'Look first! Tap 👀') : this.step === 'dribble' ? 'Which way?' : this.seen.size ? 'Pass or dribble?' : 'Tap 👀 to look around';
    }
    let nudge = null;
    if (this.canAct) {
      const stuck = this.sim.time - this.decideAt > 4;
      if ((this.hint || stuck) && !this.seen.size && !this.holding) nudge = 'look';
      else if (this.hint && bestMate && !this.seen.has(bestMate) && !this.holding) nudge = 'look';
      else if (this.hint && !this.step) nudge = bestMate ? 'pass' : 'dribble';
    }
    hud.state({ phase: this.phase, step: this.step, mode: this.mode, prompt, nudge, holding: this.holding || this.scanT != null, hintDir: this.hint && best?.startsWith('drib:') ? best.slice(5) : null });
    const glow = {}, arrows = {};
    if (this.phase === 'decide' && this.step === 'pass') for (const id of this.seen) glow[id] = this.hint && id === bestMate ? 1 : .6;
    if (this.phase === 'decide' && this.step === 'dribble') for (const d of ['fwd', 'left', 'right', 'back']) arrows[d] = this.hint && best === 'drib:' + d ? 1 : .55;
    this.ui = { glow, arrows, lines: this.lines, heroRing: this.camMode === 'player' };
  }
}
