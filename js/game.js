// Game flow: lesson demo → rounds with feedback → mini match. Owns input, camera, team AI and outcome scripts.
import { Sim } from './sim.js';
import { PITCH, demoScenario, pickRounds } from './skills.js';
import { lerp, clamp, smooth, rot, dist, interceptor, dribbleEnd } from './geom.js';
import { displayName } from './teams.js';

const { L, W, gy0, gy1 } = PITCH;
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };
const TURN_SPEED = 1.9; // radians per second while a turn button is held
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
};

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
    Object.assign(this, { phase: 'idle', step: null, seen: new Set(), look: 0, lookUp: false, yaw: 0, turn: 0, drag: null,
      scanned: false, hint: false, cam: null, camMode: 'orbit', lines: [], aimAt: null, decideAt: 0,
      ai: false, scripted: new Set(), ballTeam: 'us', follow: null });
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
  load(sc) { this.reset(); this.sc = sc; this.sim.setup(sc); this.camMode = 'player'; this.cam = null; }
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

  // ---------- outcome scripts (team AI moves everyone not in `scripted`) ----------
  *finish(id) {
    const s = this.sim, a = s.a(id), tx = L - 5.5, ty = lerp(a.y, W / 2, .75);
    this.scripted.add(id); s.go(id, tx, ty, 5.4);
    const t0 = s.time; yield () => Math.hypot(a.x - tx, a.y - ty) < .3 || s.time - t0 > 3;
    s.stop(id); yield* this.strike(id, L + .7, clamp(a.y, gy0 + .8, gy1 - .8), { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.ai = false; s.stopAll(); this.emit('goal'); yield 1.4;
  }
  // Turn to face the target, wind up, then the ball leaves the foot at contact.
  *strike(id, x, y, opts) {
    const a = this.sim.a(id), dx = x - a.x, dy = y - a.y, l = Math.hypot(dx, dy) || 1;
    a.face = [dx / l, dy / l]; this.sim.windup(id); yield .2; this.sim.kick(x, y, opts);
  }
  *passGood(id) {
    const s = this.sim, t = s.a(id);
    this.scripted.add(id); s.stop(id);
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    this.scripted.delete('hero'); // after passing he runs to support
    yield () => s.ball.state === 'loose';
    s.give(id); this.scripted.delete(id); yield .15;
  }
  *steal(opp) {
    const s = this.sim; s.give(opp.id); s.stop('hero'); this.emit('stolen');
    this.scripted.add(opp.id); s.go(opp.id, opp.x - 4, lerp(opp.y, W / 2, .4), 4.8); yield .8;
  }
  *passBad(id) {
    const s = this.sim, ic = interceptor(s.ball, s.a(id), s.team('them'));
    this.scripted.add(ic.opp.id); s.go(ic.opp.id, ic.x, ic.y, 6);
    yield* this.strike('hero', ic.x, ic.y, { speed: 13, arc: .15 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(ic.opp);
  }
  *dribbleGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W);
    this.scripted.add('hero'); s.go('hero', end.x, end.y, 4.4);
    const t0 = s.time;
    if (good) {
      yield () => dist(h, end) < .3 || s.time - t0 > 2.5;
      yield* this.finish('hero');
    } else {
      const opps = s.team('them').sort((a, b) => dist(a, end) - dist(b, end)).slice(0, 2);
      for (const o of opps) { this.scripted.add(o.id); s.go(o.id, end.x, end.y, 5); }
      yield () => opps.some(o => dist(o, h) < .9) || s.time - t0 > 2.5;
      yield* this.steal(opps.find(o => dist(o, h) < 1.2) || opps[0]);
    }
  }
  *counter() {
    const s = this.sim, c = s.a(s.ball.carrier);
    this.scripted.add(c.id); this.scripted.add('hero');
    s.go(c.id, 5, W / 2, 5.4); s.go('hero', 7, W / 2, 4.6);
    const t0 = s.time; yield () => dist(c, { x: 5, y: W / 2 }) < .3 || s.time - t0 > 3.5;
    s.stop(c.id); yield* this.strike(c.id, -.7, W / 2, { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.ai = false; s.stopAll(); this.emit('goalAgainst'); yield 1.3;
  }
  *outcomeGen(opt, good, counter) {
    if (MATE[opt]) {
      if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
      else yield* this.passBad(MATE[opt]);
    } else yield* this.dribbleGen(opt.slice(5), good);
    if (!good && counter) yield* this.counter();
    this.ai = false;
  }
  async outcome(opt, good, counter = false) {
    const h = this.sim.a('hero');
    Object.assign(this, { phase: 'outcome', step: null, drag: null, turn: 0, camMode: 'follow', ai: true, scripted: new Set(['hero']), ballTeam: 'us' });
    this.follow = { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    await this.play(this.outcomeGen(opt, good, counter));
  }
  emit(ev) {
    if (ev === 'goal') { this.hud.banner('GOAL!', 'goal'); this.say('Goal!'); }
    if (ev === 'goalAgainst') { this.hud.banner('They scored', 'bad'); }
    if (ev === 'stolen') { this.hud.banner('Stolen!', 'bad'); }
  }

  // Simple team shape while the ball is live: the nearest defender presses, the next covers
  // between the ball and goal, the last marks the most dangerous attacker. Attackers without
  // the ball run ahead into wide lanes to support. Scripted players (passer, shooter, tacklers) are left alone.
  teamAI() {
    const s = this.sim, b = s.ball, carrier = s.a(b.carrier);
    if (carrier) this.ballTeam = carrier.team;
    const atk = this.ballTeam, def = atk === 'us' ? 'them' : 'us';
    const goalX = def === 'them' ? L : 0, dir = atk === 'us' ? 1 : -1;
    const ball = b.state === 'flying' ? { x: b.tx, y: b.ty } : { x: b.x, y: b.y };
    const free = a => !this.scripted.has(a.id) && a.id !== b.carrier;
    const attackers = s.team(atk);
    const defenders = s.team(def).filter(free).sort((p, q) => dist(p, ball) - dist(q, ball));
    defenders.forEach((d, i) => {
      if (i === 0) return s.go(d.id, ball.x - dir * .6, ball.y, 3.4);
      if (i === 1) return s.go(d.id, lerp(ball.x, goalX, .4), lerp(ball.y, W / 2, .5), 3.6);
      const danger = attackers.filter(a => a.id !== b.carrier).sort((p, q) => Math.abs(p.x - goalX) - Math.abs(q.x - goalX))[0] || ball;
      s.go(d.id, lerp(danger.x, goalX, .2), lerp(danger.y, W / 2, .2), 3.6);
    });
    attackers.filter(free).forEach(a => {
      const lane = a.y < W / 2 ? W * .22 : W * .78;
      s.go(a.id, clamp(ball.x + dir * 4, 2, L - 3), lerp(a.y, lane, .5), 3.8);
    });
  }

  // ---------- flows ----------
  async demo(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); this.load(sc);
    const hero = this.name('hero'), mateId = MATE[sc.best] || 'm1', mate = this.name(mateId);
    this.hud.caption(`Watch ${hero}!`); this.say(`Watch ${hero}.`);
    await this.pre();
    this.phase = 'decide';
    this.hud.caption(`${hero} looks up 👀`); this.say(`${hero} looks up.`);
    await this.delay(.5); this.lookUp = true; await this.delay(.8);
    this.hud.caption('…and turns to find a friend'); this.say('And turns to find a friend.');
    const h = this.sim.a('hero'), m = this.sim.a(mateId), aim = Math.atan2(m.y - h.y, m.x - h.x) * .85;
    await this.tween(1.6, t => { this.yaw = lerp(0, aim, smooth(t)); });
    this.hud.caption(`${mate} is open!`); this.say(`${mate} is open!`);
    await this.delay(.6); this.step = 'pass'; this.hint = true; await this.delay(1.2);
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
  // LOOK is a toggle: head up to see the field, head down to watch the ball.
  toggleLook() { if (!this.canLook) return; this.lookUp = !this.lookUp; if (this.lookUp) this.scanned = true; else this.turn = 0; }
  // Turning stays where he leaves it, so he can turn all the way around to find someone behind him.
  turnStart(dir) { if (!this.canLook || this.step === 'dribble') return; this.lookUp = true; this.scanned = true; this.turn = dir; }
  turnEnd() { this.turn = 0; }
  lookStart(x, width) { if (this.canLook && this.step !== 'dribble') this.drag = { x0: x, yaw0: this.yaw, w: width }; }
  lookMove(x) {
    if (!this.drag) return;
    const dx = x - this.drag.x0;
    if (Math.abs(dx) > 8) { this.lookUp = true; this.scanned = true; this.yaw = wrap(this.drag.yaw0 - dx / this.drag.w * 3.2); }
  }
  lookEnd() { this.drag = null; }
  pass() {
    if (!this.canAct) return;
    this.step = 'pass'; this.lookUp = true;
    if (!this.seen.size) { this.hud.toast('Find a friend first! 👀', true); this.say('Find a friend first!'); }
  }
  dribble() { if (this.canAct) { this.step = 'dribble'; this.turn = 0; } }
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
    if (this.ai) this.teamAI();
    if (this.phase !== 'feedback') this.sim.step(dt);
    const s = this.sim, h = s.a('hero');

    if (this.lookUp && this.turn) this.yaw = wrap(this.yaw + this.turn * TURN_SPEED * dt);
    this.look = clamp(this.look + (this.lookUp ? 1 : -1) * dt / .3, 0, 1);
    // While deciding with his head up, his body turns with his head (the ball stays at his feet).
    if (h && this.phase === 'decide' && this.lookUp && this.step !== 'dribble') {
      const f = Math.atan2(h.face[1], h.face[0]) + wrap(this.yaw - Math.atan2(h.face[1], h.face[0])) * Math.min(1, dt * 10);
      h.face = [Math.cos(f), Math.sin(f)];
    }

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
    // Player view, behind him in the direction he's turned. Head down: close and aimed at the ball.
    // Head up: just above head height, looking out across the field.
    const k = smooth(this.look);
    const [bx, by] = rot(-lerp(3.1, 5.2, k), lerp(1.3, .3, k), this.yaw), [fx, fy] = rot(9, 0, this.yaw);
    return { eye: [h.x + bx, h.y + by, lerp(2.9, 2.8, k)], tgt: [lerp(b.x, h.x + fx, k), lerp(b.y, h.y + fy, k), lerp(0, .5, k)], Ff: lerp(1.05, .9, k), Fw: lerp(.64, .52, k) };
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
  updateHud() {
    const hud = this.hud, best = this.sc?.best, bestMate = MATE[best], s = this.sim, h = s.a('hero');
    let prompt = '';
    if (this.mode === 'lesson' || this.mode === 'match') {
      if (this.phase === 'pre') prompt = this.lookUp ? '' : 'Tap 👀 to look up';
      else if (this.phase === 'decide') prompt =
        this.step === 'pass' ? (this.seen.size ? 'Tap a friend you found' : 'Turn to find a friend') :
        this.step === 'dribble' ? 'Which way?' :
        this.seen.size ? 'Pass or dribble?' : this.lookUp ? 'Turn ⟲ ⟳ to find a friend' : 'Tap 👀 to look up';
    }
    let nudge = null;
    if (this.canAct) {
      const stuck = s.time - this.decideAt > 4;
      if (!this.lookUp && !this.seen.size && (this.hint || stuck)) nudge = 'look';
      else if (this.hint && bestMate && !this.seen.has(bestMate) && h) {
        const m = s.a(bestMate), d = wrap(Math.atan2(m.y - h.y, m.x - h.x) - this.yaw);
        nudge = !this.lookUp ? 'look' : d > 0 ? 'turnL' : 'turnR';
      } else if (this.hint && !this.step) nudge = bestMate ? 'pass' : 'dribble';
    }
    hud.state({ phase: this.phase, step: this.step, mode: this.mode, prompt, nudge, lookUp: this.lookUp, look: this.look, turn: this.turn,
      hintDir: this.hint && best?.startsWith('drib:') ? best.slice(5) : null });
    const glow = {}, arrows = {};
    if (this.phase === 'decide' && this.step === 'pass') for (const id of this.seen) glow[id] = this.hint && id === bestMate ? 1 : .6;
    if (this.phase === 'decide' && this.step === 'dribble') for (const d of ['fwd', 'left', 'right', 'back']) arrows[d] = this.hint && best === 'drib:' + d ? 1 : .55;
    this.ui = { glow, arrows, lines: this.lines, heroRing: this.camMode === 'player' };
  }
}
