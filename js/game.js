// Game flow: lesson demo → rounds with feedback → mini match. Owns input, camera, team AI and outcome scripts.
import { Sim } from './sim.js';
import { PITCH, demoScenario, pickRounds, skillById } from './skills.js';
import { lerp, clamp, smooth, rot, dist, interceptor, dribbleEnd, closestOnLane, shuffle, DRIBBLE_DIRS, BACKWARD } from './geom.js';
import { grade, pushEnd, goalSide, exploit, DEF_RUN } from './generate.js';
import { displayName } from './teams.js';

const { L, W, gy0, gy1 } = PITCH;
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };

// A decision built from wherever play is right now (continuous matches). The best choice is the good option that
// moves the ball farthest toward goal; other good options also earn 3 stars; backing away into space is "safe".
function liveScenario(s, skill, pushAllowed) {
  const P = a => [a.x, a.y], h = s.a('hero');
  const sc = { id: 'live', skill, kind: 'attack', live: true, hero: P(h), heroTo: P(h), mates: [P(s.a('m1')), P(s.a('m2'))],
    opps: ['o1', 'o2', 'o3'].map(id => P(s.a(id))) };
  sc.oppsTo = sc.opps;
  // Score each good option by how far it moves the ball toward goal; passes get a bonus (the ball moves faster than he does).
  const g = grade(sc);
  // Passes in live play: open unless a defender is in the lane or really on the receiver. A defender behind the
  // receiver (on his far side from the ball) only counts if he's right on him; the receiver is between him and the ball.
  const opps = s.team('them');
  sc.mates.forEach((m, i) => {
    const mate = s.a('m' + (i + 1)), d = interceptor(s.ball, mate, opps).d;
    const marked = opps.some(o => { const r = dist(o, mate); if (r < 1.2) return true; const behind = (o.x - mate.x) * (s.ball.x - mate.x) + (o.y - mate.y) * (s.ball.y - mate.y) < 0; return r < 1.8 && !behind; });
    g['pass:' + i] = d > 1.1 && !marked ? 'good' : 'bad';
  });
  const gain = o => o === 'shoot' ? 99 : (o.startsWith('pass:') ? sc.mates[+o[5]][0] + 2 : (o.startsWith('push:') ? pushEnd(h, o.slice(5)) : dribbleEnd(h, o.slice(5), L, W)).x) - h.x;
  const goods = Object.keys(g).filter(o => g[o] === 'good' && (pushAllowed || !o.startsWith('push:'))).sort((a, b) => gain(b) - gain(a));
  sc.grades = g; sc.best = goods[0] || null; sc.ok = goods.slice(1); sc.safe = Object.keys(g).filter(o => g[o] === 'safe');
  sc.cue = !sc.best ? 'That was a tough spot!' : sc.best.startsWith('pass:') ? `{m${sc.best[5]}} was open!` : sc.best.startsWith('push:') ? 'Lots of space! Push it and go!' : 'There was space to run into!';
  return sc;
}
// A defending decision built from wherever play is right now (after we lose the ball in a match). Spots: get in
// front of the ball, guard each attacker, or chase from behind. A spot is right when it leaves the attackers no
// open run or pass (the same check the defense lessons use). null when no spot can stop them.
function liveDefense(s) {
  const c = s.a(s.ball.carrier); if (!c || c.team !== 'them') return null;
  const P = a => [a.x, a.y], h = s.a('hero'), others = s.team('them').filter(o => o.id !== c.id);
  const mates = [P(s.a('m1')), P(s.a('m2'))], near = (p, k) => mates.some(m => Math.hypot(m[0] - p[0], m[1] - p[1]) < k);
  const ok = ([x, y]) => x > 1 && x < L - 1 && y > 1 && y < W - 1;
  const cand = [{ id: 'home', p: goalSide(P(c), 2.6), label: 'In front' },
    ...others.map(o => ({ id: o.id, p: goalSide(P(o), 1.2), label: near(P(o), 2) ? 'Help guard' : 'Guard' })),
    { id: 'chase', p: [c.x + 1.3, c.y], label: 'Behind him' }];
  const spots = [];
  for (const sp of cand) if (ok(sp.p) && dist({ x: sp.p[0], y: sp.p[1] }, h) > 1 && spots.every(t => Math.hypot(t.x - sp.p[0], t.y - sp.p[1]) > 2.2)) spots.push({ id: sp.id, x: sp.p[0], y: sp.p[1], label: sp.label });
  const sc = { id: `live-def-${Math.round(c.x * 10)}-${Math.round(c.y * 10)}`, kind: 'defense', live: true, carrier: c.id, oppIds: [c.id, ...others.map(o => o.id)],
    hero: P(h), heroTo: P(h), mates, opps: [P(c), ...others.map(P)], spots, ok: [] };
  sc.oppsTo = sc.opps;
  sc.exploits = Object.fromEntries(spots.map(sp => [sp.id, exploit(sc, sp.id)]));
  const goods = spots.filter(sp => !sc.exploits[sp.id]).map(sp => sp.id);
  if (spots.length < 2 || !goods.length || goods.length === spots.length) return null;
  const onBall = near(goalSide(P(c), 1.2), 2.2), best = goods.includes('home') && !onBall ? 'home' : goods.find(g => g !== 'home' && g !== 'chase') || goods[0];
  sc.best = 'spot:' + best; sc.ok = goods.filter(g => g !== best).map(g => 'spot:' + g);
  sc.cue = best === 'home' ? 'Nobody was in front of the ball. Get in front!' : best === 'chase' ? 'Your friends had it covered. Stay close!' : 'A friend was on the ball. Guard the open player!';
  return sc;
}
// Whether a well-defended play ends with the attackers stopped (true, about 2 in 3) or losing the ball.
// Fixed per scenario, so the replay of the right answer looks the same.
const holds = sc => ([...String(sc.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) >>> 4) % 3 !== 0;
// A shot is on only if no defender is within a body-width of the line from the shooter to the goal.
const shotClear = (a, aim, opps) => opps.every(o => closestOnLane(o, a, aim, 0).d > .9);
const TURN_SPEED = 1.9; // radians per second while a turn button is held
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const segDist = (x, y, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
};

export class Game {
  constructor({ world, hud, say, sfx = () => {} }) {
    Object.assign(this, { world, hud, say, sfx });
    this.sim = new Sim();
    this.sim.on = (ev, v) => sfx(ev === 'kick' ? (v >= 15 ? 'shot' : 'kick') : ev === 'touch' ? 'tap' : 'step');
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
    if (id[0] === 'o') return displayName(this.them.players[+id[1] - 1].name);
    return displayName(this.us.players[(this.roster || { hero: 0, m1: 1, m2: 2 })[id]].name);
  }
  // Hand control to teammate `id`: the sim's "hero" slot takes over his body, position and the ball.
  takeOver(id) {
    if (id === 'hero') return;
    const s = this.sim, h = s.a('hero'), m = s.a(id);
    for (const k of ['x', 'y', 'tx', 'ty', 'speed', 'sp', 'dist', 'kickAt', 'face']) [h[k], m[k]] = [m[k], h[k]];
    if (s.ball.carrier === id) s.ball.carrier = 'hero';
    this.world.swapRigs('hero', id);
    const r = this.roster; [r.hero, r[id]] = [r[id], r.hero];
  }
  // Continue a match from wherever the last play ended: a defender steps up, then he makes the next choice.
  async continueLive() {
    const s = this.sim, c = s.a(s.ball.carrier);
    if (c && c.team === 'us') this.takeOver(c.id);
    const h = s.a('hero');
    Object.assign(this, { phase: 'pre', step: null, seen: new Set(), lookUp: false, turn: 0, drag: null, scanned: false, lines: [], aimAt: null, ai: false, scripted: new Set(), camMode: 'player', yaw: 0, follow: null, grades: null });
    h.face = [1, 0];
    // The nearest defender steps up to about 3 m, off to one side, so there's pressure but still room to play.
    const press = s.team('them').sort((a, b) => dist(a, h) - dist(b, h))[0], side = press.y > h.y ? 1 : -1;
    s.go(press.id, Math.min(L - 1, h.x + 2.2), clamp(h.y + side * 1.8, 1, W - 1), 3.5);
    await this.delay(.8); s.stopAll();
    this.sc = liveScenario(s, this.sc?.skill, this.pushAllowed);
  }

  // After we lose the ball in a match: our team gets back into shape for a moment, then he decides where to run.
  // If no spot could stop them, the play just runs on and the geometry decides what happens.
  async continueDefense() {
    const s = this.sim, c = s.a(s.ball.carrier);
    Object.assign(this, { phase: 'pre', step: null, seen: new Set(), lookUp: false, turn: 0, drag: null, scanned: false, lines: [], aimAt: null,
      roles: null, ai: true, scripted: new Set(['hero', c.id]), camMode: 'player', follow: null, grades: null, ballTeam: 'them' });
    const h = s.a('hero');
    this.sc = { kind: 'defense', carrier: c.id, spots: [] };
    this.yaw = Math.atan2(c.y - h.y, c.x - h.x); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)];
    s.go(c.id, Math.max(7, c.x - 2.5), lerp(c.y, W / 2, .3), 2.4); s.go('hero', h.x - 1.2, h.y, 2.4);
    await this.delay(1.1); this.ai = false; s.stopAll();
    const sc = liveDefense(s);
    if (sc) { this.sc = sc; this.yaw = Math.atan2(c.y - h.y, c.x - h.x); return true; }
    // No fair choice: play it out from where everyone stands.
    const stay = { kind: 'defense', live: true, id: 'live-stay', carrier: c.id, oppIds: [c.id, ...s.team('them').filter(o => o.id !== c.id).map(o => o.id)],
      mates: [[s.a('m1').x, s.a('m1').y], [s.a('m2').x, s.a('m2').y]], spots: [{ id: 'stay', x: h.x, y: h.y }] };
    stay.oppsTo = [[c.x, c.y], ...stay.oppIds.slice(1).map(id => [s.a(id).x, s.a(id).y])];
    stay.exploits = { stay: exploit(stay, 'stay') };
    this.sc = stay; await this.outcome('spot:stay', !stay.exploits.stay);
    return false;
  }

  // ---------- timing helpers ----------
  // While skipping the demo, every wait finishes at once so the demo script runs straight to its end.
  delay(sec) { return this.skipping ? Promise.resolve() : new Promise(res => this.tweens.push({ t: 0, dur: sec, f: null, res })); }
  tween(sec, f) { if (this.skipping) { f(1); return Promise.resolve(); } return new Promise(res => this.tweens.push({ t: 0, dur: sec, f, res })); }
  play(gen) { return this.skipping ? Promise.resolve() : new Promise(res => { this._playRes = res; this.sim.run((function* () { yield* gen; res(); })()); }); }
  skipDemo() {
    if (this.mode !== 'demo') return;
    this.skipping = true; this.sim.co = null; this._playRes?.();
    for (const t of this.tweens.splice(0)) { t.f?.(1); t.res(); }
  }

  // ---------- scenario setup ----------
  load(sc) {
    this.reset(); this.sc = sc; this.grades = null; this.sim.setup(sc); this.camMode = 'player'; this.cam = null;
    this.roster = { hero: 0, m1: 1, m2: 2 }; this.world.resetRigs?.();
    if (sc.kind === 'defense') { const h = this.sim.a('hero'), c = this.sim.a(sc.carrier); this.yaw = Math.atan2(c.y - h.y, c.x - h.x); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)]; }
  }
  // Big pushes are offered in the dribble lesson, in free play, and in mini matches once he has played the dribble lesson.
  get pushAllowed() { return this.mode === 'free' || this.sc?.skill === 'dribble-to-space' || (this.mode === 'match' && !!this.pushUnlocked); }
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    s.go('hero', ...sc.heroTo, 3.6);
    if (sc.kind === 'defense') s.go(sc.carrier, ...sc.oppsTo[0], 3);
    (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(1.3);
    s.stopAll();
  }
  decide() {
    this.phase = 'decide'; this.step = this.sc.kind === 'defense' ? 'spot' : null; this.decideAt = this.sim.time; this.pendingDir = null;
    this.delay(1.2).then(() => { if (this.phase === 'decide') this.hud.caption(''); });
    return new Promise(res => { this._choose = res; });
  }
  // How good a choice is: 'best' (the star answer), 'ok' (just as good), 'safe' (keeps the ball but there was
  // a better choice) or 'bad' (loses it). Dribbles are graded by the real space on the field, so any of the
  // eight directions into open grass works, and only directions a defender blocks lose the ball.
  rating(opt) {
    if (this.sc.best && opt === this.sc.best) return 'best';
    if ((this.sc.ok || []).includes(opt)) return 'ok';
    if ((this.sc.safe || []).includes(opt)) return 'safe';
    if (this.sc.kind === 'defense') return 'bad';
    const g = (this.grades ||= this.sc.grades || grade(this.sc))[opt];
    if ((opt.startsWith('drib:') || opt.startsWith('push:') || opt === 'shoot') && g === 'good') return 'ok';
    if (opt.startsWith('drib:') && g === 'safe') return 'safe';
    return 'bad';
  }
  isGood(opt) { return this.rating(opt) !== 'bad'; }
  target(opt) {
    const h = this.sim.a('hero');
    if (opt.startsWith('spot:')) { const sp = this.sc.spots.find(x => x.id === opt.slice(5)); return { x: sp.x, y: sp.y }; }
    if (opt.startsWith('push:')) return pushEnd(h, opt.slice(5));
    return MATE[opt] ? { ...this.sim.a(MATE[opt]) } : dribbleEnd(h, opt.slice(5), L, W);
  }
  cue() { return this.sc.cue.replaceAll('{m0}', this.name('m1')).replaceAll('{m1}', this.name('m2')); }

  // ---------- outcome scripts (team AI moves everyone not in `scripted`) ----------
  // After a good choice the player runs at goal, but only shoots when nobody blocks the path or the shot.
  // If a defender steps in front, he stops and keeps the ball: that is the real reward for a safe choice.
  *finish(id) {
    const s = this.sim, a = s.a(id), tx = L - 3.5, opps = s.team('them');
    const room = y => Math.min(...opps.map(o => closestOnLane(o, a, { x: tx, y }, 0).d));
    const ty = [W / 2 - 2.5, W / 2, W / 2 + 2.5].map(y => ({ y, r: room(y) - Math.abs(y - a.y) * .08 })).sort((p, q) => q.r - p.r)[0].y;
    this.scripted.add(id); s.go(id, tx, ty, 5.2);
    const t0 = s.time;
    let blocked = false;
    for (;;) {
      yield 1 / 30;
      const aim = { x: L, y: clamp(a.y, gy0 + .8, gy1 - .8) };
      if (dist(a, aim) < 8 && shotClear(s.ball, aim, opps)) break;            // close (5–10 yards) with a clear look: shoot
      const fx = tx - a.x, fy = ty - a.y, fl = Math.hypot(fx, fy) || 1;
      if (opps.some(o => dist(o, a) < 1.7 && ((o.x - a.x) * fx + (o.y - a.y) * fy) / fl > .2)) { blocked = true; break; } // defender in front
      if (Math.hypot(fx, fy) < .3 || s.time - t0 > 4) { blocked = !shotClear(s.ball, aim, opps); break; }
    }
    s.stop(id);
    if (blocked) { this.result = 'kept'; this.ai = false; s.stopAll(); this.emit('kept'); yield 1.1; return; }
    // Wind up facing the goal, then check the shot line once more at the moment of the kick.
    this.ai = false; s.stopAll();
    const shot = { x: L + .7, y: clamp(a.y, gy0 + .8, gy1 - .8) }, l = Math.hypot(shot.x - a.x, shot.y - a.y) || 1;
    a.face = [(shot.x - a.x) / l, (shot.y - a.y) / l]; s.windup(id); yield .2;
    if (!shotClear(s.ball, shot, opps)) { this.result = 'kept'; s.stopAll(); this.emit('kept'); yield 1.1; return; }
    s.kick(shot.x, shot.y, { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.result = 'goal'; this.ai = false; s.stopAll(); this.emit('goal'); yield 1.4;
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
    const s = this.sim; s.give(opp.id); s.stop('hero'); this.result = 'stolen'; this.emit('stolen');
    this.scripted.add(opp.id); s.go(opp.id, opp.x - 4, lerp(opp.y, W / 2, .4), 4.8); yield .8;
  }
  *passBad(id) {
    const s = this.sim, m = s.a(id), ic = interceptor(s.ball, m, s.team('them'));
    let marker = s.team('them').sort((a, b) => dist(a, m) - dist(b, m))[0];
    // If the cut-off point is past where he'll meet the ball, the ball reaches him first: then it's a tackle, not an interception.
    const meetD = dist(s.ball, { x: lerp(m.x, s.ball.x, .3), y: lerp(m.y, s.ball.y, .3) }), late = dist(s.ball, ic) > meetD - .5;
    if (late) marker = ic.opp;
    if ((ic.d > .9 && dist(marker, m) < 1.8) || late) { // lane was open but a defender was right on him: he gets the ball and loses it straight away
      this.scripted.add(id); this.scripted.add(marker.id);
      const meet = { x: lerp(m.x, s.ball.x, .2), y: lerp(m.y, s.ball.y, .2) }; s.go(id, meet.x, meet.y, 3.5); // he comes to meet it
      yield* this.strike('hero', meet.x, meet.y, { speed: 13, arc: .2 });
      s.go(marker.id, meet.x, meet.y, 4.5);
      yield () => s.ball.state === 'loose';
      // He controls it, but the defender is right there: the steal only happens once the defender reaches him.
      s.give(id); s.stop(id);
      const t0 = s.time; yield () => { s.go(marker.id, m.x, m.y, 4.5); return dist(marker, m) < .8 || s.time - t0 > 1.5; };
      yield* this.steal(marker); return;
    }
    // The receiver steps toward the ball to meet it; the defender in the lane gets there first.
    this.scripted.add(id); s.go(id, lerp(m.x, s.ball.x, .3), lerp(m.y, s.ball.y, .3), 4.2);
    this.scripted.add(ic.opp.id); s.go(ic.opp.id, ic.x, ic.y, 6);
    yield* this.strike('hero', ic.x, ic.y, { speed: 13, arc: .15 });
    yield () => s.ball.state === 'loose';
    const t0 = s.time; yield () => { s.go(ic.opp.id, s.ball.x, s.ball.y, 6); return dist(ic.opp, s.ball) < .7 || s.time - t0 > 1; };
    yield* this.steal(ic.opp);
  }
  *dribbleGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W);
    this.scripted.add('hero'); s.go('hero', end.x, end.y, 4.4);
    const t0 = s.time;
    if (good) {
      yield () => dist(h, end) < .3 || s.time - t0 > 2.5;
      if (BACKWARD.has(dir)) { s.stop('hero'); this.result = 'kept'; this.ai = false; s.stopAll(); this.emit('kept'); yield 1.1; return; }
      yield* this.finish('hero');
    } else {
      const opps = s.team('them').sort((a, b) => dist(a, end) - dist(b, end)).slice(0, 2);
      for (const o of opps) { this.scripted.add(o.id); s.go(o.id, end.x, end.y, 5); }
      yield () => opps.some(o => dist(o, h) < .9) || s.time - t0 > 2.5;
      yield* this.steal(opps.find(o => dist(o, h) < 1.2) || opps[0]);
    }
  }
  // Big push: knock the ball 7 m ahead and race for it. Whoever gets there first wins it.
  *pushGen(dir, good) {
    const s = this.sim, h = s.a('hero'), end = pushEnd(h, dir), opps = s.team('them');
    this.scripted.add('hero');
    yield* this.strike('hero', end.x, end.y, { speed: 8.5, arc: .15 });
    s.go('hero', end.x, end.y, 5.4);
    // The nearest defender always races for it too. A push is only "good" when he clearly gets there first,
    // so the defender arrives a step late (and pulls up instead of running into him).
    const racer = opps.sort((a, b) => dist(a, end) - dist(b, end))[0];
    this.scripted.add(racer.id); s.go(racer.id, end.x, end.y, good ? DEF_RUN : 5);
    const t0 = s.time; yield () => s.ball.state === 'loose' && (dist(h, end) < .6 || (!good && dist(racer, end) < .6)) || s.time - t0 > 3;
    if (good) {
      s.give('hero');
      const back = Math.max(1.4, dist(racer, h)); s.go(racer.id, h.x + (racer.x - h.x) / (dist(racer, h) || 1) * back, h.y + (racer.y - h.y) / (dist(racer, h) || 1) * back, 2);
      yield .1; this.scripted.delete(racer.id); yield* this.finish('hero');
    } else yield* this.steal(racer);
  }
  // Defense: he runs to the spot he picked. The right spot closes every way through: usually the attackers
  // just get stopped and have to pass back (no steal needed), sometimes they try anyway and lose the ball.
  // A wrong spot leaves a gap.
  *defendGen(spotId, good) {
    const s = this.sim, sc = this.sc, sp = sc.spots.find(x => x.id === spotId), c = s.a(sc.carrier || 'o1'), h = s.a('hero');
    this.scripted.add('hero'); s.go('hero', sp.x, sp.y, 5.2);
    const defenders = () => s.team('us');
    yield .55;
    const toGoal = (a) => { const dx = 0 - a.x, dy = W / 2 - a.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    if (good && holds(sc)) {
      // He's in the way: the carrier slows down when a defender is in front of him, finds no way through and passes away.
      const [gx, gy] = toGoal(c);
      this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.4);
      const t0 = s.time;
      yield () => defenders().some(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3 && dist(d, c) < 2) || s.time - t0 > 2.5;
      s.stop(c.id); yield .4;
      const mates = s.team('them').filter(o => o.id !== c.id), us = s.team('us');
      const to = mates.sort((a, b) => interceptor(c, b, us).d - interceptor(c, a, us).d)[0];
      this.scripted.add(to.id); s.stop(to.id);
      yield* this.strike(c.id, to.x, to.y, { speed: 10, arc: .15 });
      yield () => s.ball.state === 'loose';
      s.give(to.id);
      this.result = 'held'; this.ai = false; s.stopAll(); this.emit('held'); yield 1.3; return;
    }
    if (good) {
      const guarded = spotId.startsWith('o') ? s.a(spotId) : null;
      if (guarded) { // the carrier tries the pass he was guarding; he steps in and takes it
        this.scripted.add(c.id); this.scripted.add(guarded.id);
        const cut = { x: lerp(c.x, guarded.x, .75), y: lerp(c.y, guarded.y, .75) };
        yield .35; s.go('hero', cut.x, cut.y, 5.4);
        yield* this.strike(c.id, cut.x, cut.y, { speed: 10, arc: .1 });
        yield () => s.ball.state === 'loose';
        s.give('hero');
      } else { // pressure or recovery: he is now in front of the ball, so the carrier runs into him and loses it
        const [gx, gy] = toGoal(c);
        this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.8);          // keeps going at goal, facing it
        // The tackle comes from a defender who is goal-side of the ball (in front of him), never from behind.
        const front = [...defenders()].filter(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3).sort((a, b) => dist(a, c) - dist(b, c));
        const tackler = front[0] || h;
        this.scripted.add(tackler.id);
        const t0 = s.time;
        yield () => { s.go(tackler.id, c.x + gx * .7, c.y + gy * .7, 4.6); return dist(tackler, c) < 1 || s.time - t0 > 3; };
        s.stop(c.id); c.face = [gx, gy];
        tackler.face = [-gx, -gy]; s.give(tackler.id);                                     // he pokes it away, facing upfield
        s.go(tackler.id, tackler.x - gx * 2.5, tackler.y - gy * 2.5, 3.6);
        yield .4;
      }
      this.result = 'won'; this.ai = false; s.stopAll(); this.emit('won'); yield 1.3; return;
    }
    // Wrong spot: the attackers use the gap he left — an open run at goal, or a pass to the unmarked attacker.
    const plan = sc.exploits?.[spotId] || { kind: 'dribble', who: c.id, to: [4.5, W / 2] };
    let shooter = c;
    if (plan.kind === 'pass') {
      const free = s.a(plan.who);
      this.scripted.add(c.id); this.scripted.add(free.id); s.stop(free.id);
      yield* this.strike(c.id, free.x, free.y, { speed: 11, arc: .2 });
      yield () => s.ball.state === 'loose';
      s.give(free.id); shooter = free;
    }
    this.scripted.add(shooter.id);
    const spot = { x: plan.to[0], y: plan.to[1] };
    s.go(shooter.id, spot.x, spot.y, 5.2);
    // He got past them: the beaten defenders chase from behind (slower), so nobody magically appears in the shot.
    this.ai = false;
    // Only the beaten player (him) chases from behind; teammates stay with their own players.
    for (const d of s.team('us')) if (d.id !== 'hero') s.stop(d.id);
    const t0 = s.time; yield () => { s.go('hero', shooter.x + 1.4, shooter.y + (h.y > shooter.y ? 1 : -1), 3.4); return dist(shooter, spot) < .4 || s.time - t0 > 3.5; };
    this.ai = false; s.stopAll();
    s.stop(shooter.id); yield* this.strike(shooter.id, -.7, clamp(shooter.y, gy0 + .8, gy1 - .8), { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.result = 'goalAgainst'; this.ai = false; s.stopAll(); this.emit('goalAgainst'); yield 1.3;
  }
  // He shoots: a clear shot goes in; a blocked one is stopped by the defender in the way.
  *shootGen(good) {
    const s = this.sim, h = s.a('hero'), aim = { x: L + .7, y: clamp(h.y, gy0 + .8, gy1 - .8) };
    this.scripted.add('hero'); this.ai = false; s.stopAll();
    if (good) { yield* this.strike('hero', aim.x, aim.y, { speed: 17, arc: .5 }); yield () => s.ball.state === 'loose'; this.result = 'goal'; this.emit('goal'); yield 1.4; return; }
    const block = interceptor(s.ball, aim, s.team('them'));
    this.scripted.add(block.opp.id); s.go(block.opp.id, block.x, block.y, 5);
    yield* this.strike('hero', block.x, block.y, { speed: 15, arc: .2 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(block.opp);
  }
  *outcomeGen(opt, good) {
    if (opt === 'shoot') { this.ai = true; yield* this.shootGen(good); this.ai = false; return; }
    if (opt.startsWith('spot:')) { yield* this.defendGen(opt.slice(5), good); this.ai = false; return; }
    if (opt.startsWith('push:')) { yield* this.pushGen(opt.slice(5), good); this.ai = false; return; }
    if (MATE[opt]) {
      if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
      else yield* this.passBad(MATE[opt]);
    } else yield* this.dribbleGen(opt.slice(5), good);
    this.ai = false;
  }
  async outcome(opt, good) {
    const h = this.sim.a('hero');
    Object.assign(this, { roles: null, result: null, phase: 'outcome', step: null, drag: null, turn: 0, camMode: 'follow', ai: true, scripted: new Set(['hero']), ballTeam: 'us' });
    this.follow = { x: h.x + 2, y: lerp(h.y, W / 2, .4), yaw: 0, yawT: 0 };
    await this.play(this.outcomeGen(opt, good));
  }
  // Shows how the play ended. In a lesson round the stars and tip (set in `this.rated` before the play) come in
  // the same card, at the same moment.
  emit(ev) {
    const [title, kind] = { goal: ['GOAL!', 'goal'], goalAgainst: ['They scored', 'bad'], stolen: ['Stolen!', 'bad'], won: ['Stole it!', 'goal'], held: ['Stopped him!', 'goal'], kept: ['Kept the ball!', 'goal'] }[ev];
    if (ev === 'goal') this.sfx('net');
    const rated = this.rated; this.rated = null;
    this.card = this.hud.banner(title, kind, rated);
    if (rated?.say) this.say(rated.text);
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
    if (def === 'us') { this.ourDefense(ball, attackers, free); }
    else {
    const defenders = s.team(def).filter(free).sort((p, q) => dist(p, ball) - dist(q, ball));
    defenders.forEach((d, i) => {
      if (i === 0) return s.go(d.id, ball.x + dir * 1.1, ball.y, 3.4); // stand goal-side, a step off the ball
      if (i === 1) return s.go(d.id, lerp(ball.x, goalX, .4), lerp(ball.y, W / 2, .5), 3.6);
      const danger = attackers.filter(a => a.id !== b.carrier).sort((p, q) => Math.abs(p.x - goalX) - Math.abs(q.x - goalX))[0] || ball;
      s.go(d.id, lerp(danger.x, goalX, .2), lerp(danger.y, W / 2, .2), 3.6);
    });
    }
    // Support shape: the attacker nearer the goal runs ahead into a wide lane; the other stays a bit behind
    // the ball on the other side, as an outlet. Nobody runs to the same spot.
    const goalAhead = (p, q) => (q.x - p.x) * dir;
    attackers.filter(free).sort(goalAhead).forEach((a, i) => {
      const lane = a.y < W / 2 ? W * .22 : W * .78;
      if (i === 0) s.go(a.id, clamp(ball.x + dir * 4.5, 2, L - 3), lerp(a.y, lane, .5), 3.8);
      else s.go(a.id, clamp(ball.x - dir * 2, 2, L - 3), lerp(a.y, ball.y > W / 2 ? W * .25 : W * .75, .4), 3.4);
    });
  }

  // Our team on defense does what the lessons teach: only one player (the closest) pressures the ball,
  // and everyone else guards an attacker, standing goal-side of him. Nobody leaves his player to chase.
  ourDefense(ball, attackers, free) {
    const s = this.sim, ours = s.team('us'), goal = { x: 0, y: W / 2 };
    const gs = (p, k) => { const dx = goal.x - p.x, dy = goal.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: p.x + dx / l * k, y: p.y + dy / l * k }; };
    // Roles are picked once per possession and kept, so nobody swaps jobs (or leaves his player) mid-play.
    const key = s.ball.carrier || 'loose';
    if (this.roles?.key === key) { for (const [id, job] of Object.entries(this.roles.jobs)) { const d = s.a(id); if (!free(d)) continue; const t = job === 'press' ? ball : s.a(job); const p = gs(t, job === 'press' ? 1 : 1.1); s.go(id, p.x, p.y, job === 'press' ? 3.6 : 3.8); } return; }
    const jobs = {};
    const others = attackers.filter(a => a.id !== s.ball.carrier), taken = new Set();
    // A scripted player (the child, or one making a tackle) already counts: near the ball = pressing; near an attacker = guarding him.
    let pressing = ours.some(d => !free(d) && dist(d, ball) < 2.5);
    for (const d of ours) if (!free(d)) { const near = others.find(a => dist(a, d) < 2.5); if (near) taken.add(near.id); }
    const freeOurs = ours.filter(free).sort((p, q) => dist(p, ball) - dist(q, ball));
    for (const d of freeOurs) {
      if (!pressing) { pressing = true; jobs[d.id] = 'press'; const p = gs(ball, 1); s.go(d.id, p.x, p.y, 3.6); continue; }
      const mark = others.filter(a => !taken.has(a.id)).sort((p, q) => dist(p, d) - dist(q, d))[0];
      if (mark) { taken.add(mark.id); jobs[d.id] = mark.id; const p = gs(mark, 1.1); s.go(d.id, p.x, p.y, 3.8); }
      else { const p = gs(ball, 4); s.go(d.id, p.x, p.y, 3.4); } // nobody left to guard: drop back and cover
    }
    this.roles = { key, jobs };
  }

  // ---------- flows ----------
  async demo(skillId) {
    if (skillId !== 'look-up') return this.demoGeneric(skillId);
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
    this.hud.caption(''); this.skipping = false;
  }

  // Demo for any lesson: run up, look up, show the idea in words, then play the 3-star choice.
  async demoGeneric(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); this.load(sc);
    const hero = this.name('hero'), tip = skillById(skillId)?.tip || '';
    this.hud.caption(`Watch ${hero}!`); this.say(`Watch ${hero}.`);
    await this.pre();
    this.phase = 'decide'; this.step = sc.kind === 'defense' ? 'spot' : null;
    await this.delay(.4); this.lookUp = true; await this.delay(.9);
    this.hud.caption(tip); this.say(tip); await this.delay(3.4);
    // For a pass, he turns his head to find the open friend first, so the pass doesn't come out of nowhere.
    const mateId = MATE[sc.best];
    if (mateId) {
      const h = this.sim.a('hero'), m = this.sim.a(mateId), aim = wrap(Math.atan2(m.y - h.y, m.x - h.x));
      this.hud.caption(`${hero} finds a friend 👀`); this.say(`${hero} finds a friend.`);
      const y0 = this.yaw; await this.tween(1.6, t => { this.yaw = y0 + wrap(aim - y0) * smooth(t); });
      this.step = 'pass'; this.seen.add(mateId); this.hint = true;
      const open = `${this.name(mateId)} is open!`; this.hud.caption(open); this.say(open); await this.delay(1.4);
    }
    this.hud.caption('');
    await this.outcome(sc.best, true);
    // Then say why it worked, with a moment to take it in.
    if (!this.skipping) { const why = this.cue(); this.hud.caption(why); this.say(why); } await this.delay(3.2);
    this.hud.caption(''); this.skipping = false;
  }

  // Plays one scenario until he gets it. Wrong choices show why, replay the better way, then retry.
  async round(sc, { hint }) {
    this.mode = 'lesson';
    this.load(sc); await this.pre();
    const save = this.sim.save();
    for (let attempt = 1; ; attempt++) {
      this.hint = hint || attempt > 1;
      const opt = await this.decide();
      const rating = this.rating(opt), good = rating !== 'bad', scanned = this.scanned;
      // Every decision gets 1–3 stars. 3 = the best choice, 2 = safe but there was a better one, 1 = lost it.
      // The stars and tip are decided now and shown together with the result, the moment the play ends.
      const praise = sc.skill === 'look-up' && scanned ? 'You looked up!' : sc.kind === 'defense' ? 'Great defending!' : 'Great choice!';
      const tip = 'You kept it! Even better: ' + this.cue().replace(/^./, ch => ch.toLowerCase());
      this.rated = rating === 'safe' ? { stars: 2, text: tip, watch: true, say: true }
        : good ? { stars: 3, text: `${praise} ${this.cue()}` } // say why it was right, so the idea sticks
        : { stars: 1, text: sc.kind === 'defense' ? 'They got through!' : 'Oops, lost it!' };
      this.card = null;
      await this.outcome(opt, good);
      const answer = await (this.card || this.hud.banner('', 'goal', this.rated));
      this.rated = null;
      if (good && rating !== 'safe') return { firstTry: attempt === 1, stars: 3 };
      if (rating === 'safe') {
        if (answer === 'watch') {
          this.sim.restore(save); this.reset(); this.camMode = 'player';
          this.hud.caption('Here is the 3-star play!'); await this.outcome(sc.best, true); this.hud.caption('');
        }
        return { firstTry: false, stars: 2 };
      }
      await this.feedback(save, opt);
      this.sim.restore(save); this.reset(); this.camMode = 'player';
      this.hud.caption('Watch this way!');
      await this.outcome(sc.best, true);
      this.sim.restore(save); this.reset(); this.camMode = 'player';
      this.hud.caption('Your turn!');
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
    await this.delay(4);
    this.lines = []; this.aimAt = null;
  }

  async match(skillIds, extra = [], toWin = 2, mode = 'match') {
    this.mode = mode;
    const score = { us: 0, them: 0 }; this.hud.score(score, this.us, this.them);
    const rounds = shuffle([...pickRounds(skillIds, 6), ...extra]);
    // Play flows on: after "Kept the ball!" or "Stole it!" the next choice starts from right there.
    // Only a goal resets to a fresh situation, like a kickoff.
    // After a lost ball he defends from right there; after "Stopped him!" he defends again; after a win he attacks.
    let live = false, next = 0, streak = 0;
    const tally = () => { if (this.result === 'goal') score.us++; else if (this.result === 'goalAgainst') score.them++; this.hud.score(score, this.us, this.them); };
    for (let i = 0; score.us < toWin && score.them < toWin; i++) {
      if (live && this.sim.a(this.sim.ball.carrier)?.team === 'them') {
        if (!(await this.continueDefense())) { tally(); streak = this.result === 'goalAgainst' ? 0 : streak + 1; live = streak > 0 && streak <= 4; continue; }
      } else if (live) await this.continueLive();
      else { streak = 0; this.load(rounds[next++ % rounds.length]); await this.pre(); }
      const opt = await this.decide(), good = this.isGood(opt);
      await this.outcome(opt, good);
      tally();
      // Play flows on until a goal; after 4 plays in a row without one, start a fresh situation.
      streak = this.result === 'goal' || this.result === 'goalAgainst' ? 0 : streak + 1;
      live = streak > 0 && streak <= 4;
      if (i >= toWin * 12) break; // safety: don't let a match run forever
    }
    return score;
  }

  home() { this.mode = 'home'; this.reset(); this.sim.setup(demoScenario('look-up')); this.camMode = 'orbit'; this.cam = null; this.hud.caption(''); }

  // ---------- input ----------
  get canAct() { return this.phase === 'decide' && this.mode !== 'demo'; }
  get canLook() { return (this.phase === 'pre' || this.phase === 'decide') && this.mode !== 'demo'; }
  // LOOK is a toggle: head up to see the field, head down to watch the ball.
  toggleLook() { if (!this.canLook) return; this.lookUp = !this.lookUp; this.sfx(this.lookUp ? 'up' : 'down'); if (this.lookUp) this.scanned = true; else this.turn = 0; }
  // Turning stays where he leaves it, so he can turn all the way around to find someone behind him.
  turnStart(dir) { if (!this.canLook || this.step === 'dribble') return; this.lookUp = true; this.scanned = true; this.turn = dir; }
  turnEnd() { this.turn = 0; }
  lookStart(x, width) { if (this.canLook && this.step !== 'dribble') this.drag = { x0: x, yaw0: this.yaw, w: width }; }
  lookMove(x) {
    if (!this.drag) return;
    const dx = x - this.drag.x0;
    if (Math.abs(dx) > 12) { if (!this.lookUp) this.sfx('up'); this.lookUp = true; this.scanned = true; this.yaw = wrap(this.drag.yaw0 - dx / this.drag.w * 3.2); }
  }
  lookEnd() { this.drag = null; }
  // Shooting is offered when he is close enough to goal to have a real chance.
  get canShoot() { const h = this.sim.a('hero'); return this.phase === 'decide' && this.sc?.kind !== 'defense' && !!h && h.x > L - (this.sc?.skill === 'shoot-close' ? 18 : 13); }
  shoot() { if (this.canAct && this.canShoot && !this.locked) this.choose('shoot'); }
  // PASS and DRIBBLE are always on screen; tapping one switches to it, tapping it again un-picks it.
  pass() {
    if (!this.canAct) return;
    if (this.step === 'pass') { this.step = null; return; }
    if (this.locked) return this.lookFirst();
    this.step = 'pass';
    if (!this.seen.size) this.hud.toast('Find a friend first! 👀', true);
  }
  dribble() { if (!this.canAct) return; if (this.locked) return this.lookFirst(); this.step = this.step === 'dribble' ? null : 'dribble'; this.turn = 0; this.pendingDir = null; }
  // After picking an arrow in the dribble lesson: keep it close, or knock it ahead and race for it.
  touch(kind) { if (!this.pendingDir) return; const d = this.pendingDir; this.pendingDir = null; this.choose((kind === 'big' ? 'push:' : 'drib:') + d); }
  // In the "Look up" lesson he has to look up before he can pass or dribble.
  get locked() { return this.mode === 'lesson' && this.sc?.skill === 'look-up' && !this.scanned; }
  lookFirst() { this.hud.toast('Look up first! 👀', true); }
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
    if (!best) return false;
    if (this.step === 'dribble' && this.pushAllowed) { this.pendingDir = best.opt.slice(5); return true; } // then: small touches or big push?
    this.choose(best.opt); return true;
  }
  targets() {
    const h = this.sim.a('hero');
    if (this.step === 'spot') return this.sc.spots.map(sp => ({ opt: 'spot:' + sp.id, x: sp.x, y: sp.y, z: 0 }));
    if (this.step === 'pass') return Object.entries(MATE).filter(([, id]) => this.seen.has(id)).map(([opt, id]) => ({ opt, ...this.sim.a(id), z: .8 }));
    if (this.step === 'dribble') return Object.keys(DRIBBLE_DIRS).map(d => { const e = dribbleEnd(h, d, L, W); return { opt: 'drib:' + d, x: lerp(h.x, e.x, .8), y: lerp(h.y, e.y, .8), z: 0 }; });
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

    // Teammates count as found when he can see them with his head up. Everyone spotted together shows in one message.
    if (this.look > .8 && (this.phase === 'pre' || this.phase === 'decide')) {
      const cw = this.world.canvas.clientWidth, ch = this.world.canvas.clientHeight, found = [];
      for (const id of ['m1', 'm2']) {
        if (this.seen.has(id)) continue;
        const a = s.a(id), q = this.world.project(a.x, a.y, .9);
        if (q && q[0] > cw * .05 && q[0] < cw * .95 && q[1] > ch * .05 && q[1] < ch * .95) { this.seen.add(id); found.push(this.name(id)); }
      }
      if (found.length && this.mode !== 'demo' && this.sc?.kind !== 'defense' && this.sc?.skill !== 'dribble-to-space' && (this.step === 'pass' || (!this.step && this.lookUp))) this.hud.seen(`👀 You see ${found.join(' and ')}`);
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
    // On attack, head down looks at the ball at his feet. On defense the ball is away from him, so head down
    // looks a few meters ahead of him toward the ball, keeping him in view.
    let dx = b.x, dy = b.y;
    if (this.sc?.kind === 'defense') { const [ax, ay] = rot(3.5, 0, this.yaw); dx = lerp(h.x + ax, b.x, .25); dy = lerp(h.y + ay, b.y, .25); }
    return { eye: [h.x + bx, h.y + by, lerp(2.9, 2.8, k)], tgt: [lerp(dx, h.x + fx, k), lerp(dy, h.y + fy, k), lerp(0, .5, k)], Ff: lerp(1.05, .9, k), Fw: lerp(.64, .52, k) };
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
    const hud = this.hud, s = this.sim;
    let prompt = '';
    if (this.mode === 'lesson' || this.mode === 'match' || this.mode === 'free') {
      if (this.phase === 'pre') prompt = this.lookUp ? '' : 'Tap 👀 to look up';
      else if (this.phase === 'decide') prompt =
        this.step === 'spot' ? (this.lookUp ? 'Tap where to run' : 'Watch the ball… tap 👀 to look up') :
        this.pendingDir ? 'Small touches or big push?' :
        this.step === 'pass' ? (this.seen.size ? 'Tap a friend you found' : 'Drag to look for a friend') :
        this.step === 'dribble' ? 'Tap an arrow' :
        this.seen.size ? 'Pass or dribble?' : this.lookUp ? 'Drag to look around' : 'Tap 👀 to look up';
    }
    // The only nudge: if he hasn't looked up after a while, pulse LOOK. Never point at the answer.
    const nudge = this.canAct && !this.lookUp && (this.locked || (!this.seen.size && s.time - this.decideAt > 5)) ? 'look' : null;
    hud.state({ phase: this.phase, step: this.step, mode: this.mode, prompt, nudge, lookUp: this.lookUp, look: this.look, locked: this.locked, kind: this.sc?.kind || 'attack', touchPick: !!this.pendingDir, canShoot: this.canAct && this.canShoot });
    const glow = {}, arrows = {};
    if (this.phase === 'decide' && this.step === 'pass') for (const id of this.seen) glow[id] = .8;
    if (this.phase === 'decide' && this.step === 'dribble') for (const d of Object.keys(DRIBBLE_DIRS)) arrows[d] = !this.pendingDir || this.pendingDir === d ? 1 : .3;
    const spots = this.phase === 'decide' && this.step === 'spot' ? this.sc.spots : [];
    this.ui = { glow, arrows, spots, lines: this.lines, heroRing: this.camMode === 'player' };
  }
}
