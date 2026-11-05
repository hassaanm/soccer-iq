// Game flow: lesson demo → rounds with feedback → mini match. Owns input, camera, team AI and outcome scripts.
import { Sim } from './sim.js';
import { PITCH, demoScenario, pickRounds, skillById } from './skills.js';
import { lerp, clamp, smooth, rot, dist, interceptor, dribbleEnd, closestOnLane, shuffle, DRIBBLE_DIRS, BACKWARD } from './geom.js';
import { grade, pushEnd, goalSide, exploit, DEF_RUN, laneClear, laneBlocked, inPitch, takeOn } from './generate.js';
import { displayName } from './teams.js';

const { L, W, gy0, gy1 } = PITCH;
const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };
// Rounds where he picks a spot to run to: defending, or getting open while a friend has the ball.
const spotKind = sc => sc?.kind === 'defense' || sc?.kind === 'support';
// Rounds where he faces the ball carrier instead of the goal: picking a spot, or the 1v1 steal.
const facesBall = sc => spotKind(sc) || sc?.kind === 'tackle' || sc?.kind === 'receive';
const LOOSE = 1.05, REACH = 2; // steal: the ball is this far from the attacker's feet, and this close to him

// A decision built from wherever play is right now (continuous matches). The best choice is the good option that
// moves the ball farthest toward goal; other good options also earn 3 stars; backing away into space is "safe".
function liveScenario(s, skill, pushAllowed) {
  const P = a => [a.x, a.y], h = s.a('hero');
  const sc = { id: 'live', skill, kind: 'attack', live: true, hero: P(h), heroTo: P(h), mates: [P(s.a('m1')), P(s.a('m2'))],
    opps: ['o1', 'o2', 'o3'].map(id => P(s.a(id))) };
  sc.oppsTo = sc.opps;
  // Score each good option by how far it moves the ball toward goal. At this age staying on the ball comes first
  // (FA foundation phase), so a pass is the best answer only when it gains clearly more than running with it.
  const g = grade(sc);
  // Passes in live play: open unless a defender is in the lane or really on the receiver. A defender behind the
  // receiver (on his far side from the ball) only counts if he's right on him; the receiver is between him and the ball.
  const opps = s.team('them');
  sc.mates.forEach((m, i) => {
    const mate = s.a('m' + (i + 1)), d = interceptor(s.ball, mate, opps).d;
    const marked = opps.some(o => { const r = dist(o, mate); if (r < 1.2) return true; const behind = (o.x - mate.x) * (s.ball.x - mate.x) + (o.y - mate.y) * (s.ball.y - mate.y) < 0; return r < 1.8 && !behind; });
    g['pass:' + i] = d > 1.1 && !marked ? 'good' : 'bad';
  });
  const gain = o => o === 'shoot' ? 99 : (o.startsWith('pass:') ? sc.mates[+o[5]][0] - 1.5 : (o.startsWith('push:') ? pushEnd(h, o.slice(5)) : dribbleEnd(h, o.slice(5), L, W)).x) - h.x;
  const goods = Object.keys(g).filter(o => g[o] === 'good' && (pushAllowed || !o.startsWith('push:'))).sort((a, b) => gain(b) - gain(a));
  sc.grades = g; sc.best = goods[0] || null; sc.ok = goods.slice(1); sc.safe = Object.keys(g).filter(o => g[o] === 'safe');
  sc.cue = !sc.best ? 'That was a tough spot!' : sc.best.startsWith('pass:') ? `{m${sc.best[5]}} was open!` : sc.best.startsWith('push:') ? 'Lots of space! Push it and go!' : 'There was space to run into!';
  return sc;
}
// A defending decision built from wherever play is right now (after we lose the ball in a match). Spots: get in
// front of the ball, guard each attacker, or chase from behind. A spot is right when it leaves the attackers no
// open run or pass (the same check the defense lessons use). null when no spot can stop them.
function liveDefense(s, guard = true) {
  const c = s.a(s.ball.carrier); if (!c || c.team !== 'them') return null;
  const P = a => [a.x, a.y], h = s.a('hero'), others = s.team('them').filter(o => o.id !== c.id);
  const mates = [P(s.a('m1')), P(s.a('m2'))], near = (p, k) => mates.some(m => Math.hypot(m[0] - p[0], m[1] - p[1]) < k);
  const ok = ([x, y]) => x > 1 && x < L - 1 && y > 1 && y < W - 1;
  const cand = [{ id: 'home', p: goalSide(P(c), 2.6), label: 'In front' },
    ...(guard ? others.map(o => ({ id: o.id, p: goalSide(P(o), 1.2), label: near(P(o), 2) ? 'Help guard' : 'Guard' })) : []), // "Guard" spots come with Only one bee / Guard the open player
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
    this.tweens = []; this.speechWaits = [];
    this.skills = new Set(); // lessons he has passed: each adds its part to matches (see has())
    this.reset();
    this.mode = 'home';
    this.sim.setup(demoScenario('look-up'));
  }

  reset() {
    Object.assign(this, { phase: 'idle', step: null, seen: new Set(), look: 0, lookUp: false, yaw: 0, turn: 0, drag: null,
      scanned: false, hint: false, cam: null, camMode: 'orbit', lines: [], aimAt: null, decideAt: 0,
      ai: false, scripted: new Set(), ballTeam: 'us', follow: null, frozen: [], tk: null, yaw0: null, peeked: false, turnPick: false, showing: false, handAt: null });
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
    this.glide = 1; // the camera glides over to his new player instead of jumping there
  }
  // Continue a match from wherever the last play ended: a defender steps up, then he makes the next choice.
  async continueLive() {
    const s = this.sim, c = s.a(s.ball.carrier);
    if (c && c.team === 'us') this.takeOver(c.id);
    const h = s.a('hero');
    Object.assign(this, { phase: 'pre', step: null, seen: new Set(), lookUp: false, turn: 0, drag: null, scanned: false, lines: [], aimAt: null, ai: false, scripted: new Set(), camMode: 'player', yaw: 0, follow: null, grades: null });
    h.face = [1, 0];
    if (this.sc?.kind === 'tackle') this.sc = { ...this.sc, kind: 'attack' }; // after winning a 1v1: back to the normal view and buttons
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
    const choose = this.has('get-goal-side'), guard = this.has('one-goes') || this.has('mark-the-free-one');
    Object.assign(this, { phase: 'pre', step: null, seen: new Set(), lookUp: false, turn: 0, drag: null, scanned: false, lines: [], aimAt: null,
      roles: null, ai: true, scripted: new Set(['hero', c.id]), camMode: 'player', follow: null, grades: null, ballTeam: 'them' });
    const h = s.a('hero');
    this.sc = { kind: 'defense', carrier: c.id, spots: [] };
    this.yaw = Math.atan2(c.y - h.y, c.x - h.x); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)];
    s.go(c.id, Math.max(7, c.x - 2.5), lerp(c.y, W / 2, .3), 2.4); s.go('hero', h.x - 1.2, h.y, 2.4);
    await this.delay(1.1); this.ai = false; s.stopAll();
    const sc = choose ? liveDefense(s, guard) : null;
    if (sc) { this.sc = sc; this.yaw = this.frameYaw(sc, h, c); return true; }
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
    for (const f of this.speechWaits.splice(0)) f();
  }
  // Says a line with its caption, waits until it has been said, then gives him a moment to take it in. The wait
  // is never shorter than a slow reading of the line (about 12 letters a second), so it works with the voice off.
  async talk(text, pause = 1.2, caption = text) {
    if (this.skipping) return;
    this.hud.caption(caption);
    const spoken = this.say(text);
    const heard = typeof spoken?.then === 'function' ? new Promise(res => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; spoken.then(fin, fin); this.speechWaits.push(fin); }) : null;
    await Promise.all([this.delay(.6 + text.length / 12), heard]);
    await this.delay(pause);
  }

  // ---------- scenario setup ----------
  load(sc) {
    this.reset(); this.sc = sc; this.grades = null; this.sim.setup(sc); this.camMode = 'player'; this.cam = null;
    this.roster = { hero: 0, m1: 1, m2: 2 }; this.world.resetRigs?.();
    if (facesBall(sc)) { const h = this.sim.a('hero'), c = this.sim.a(sc.carrier); this.yaw = this.frameYaw(sc, h, c); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)]; }
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
  // Short run-up: he dribbles forward head-down while defenders close in.
  async pre() {
    this.phase = 'pre';
    const sc = this.sc, s = this.sim;
    if (sc.intro === 'won') return this.wonIntro();
    if (sc.kind === 'receive') return this.passIn();
    s.go('hero', ...sc.heroTo, 3.6);
    if (sc.kind === 'defense') s.go(sc.carrier, ...sc.oppsTo[0], 3);
    (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(1.3);
    s.stopAll();
  }
  // "Won it? Go!": their player dribbles straight at him, he steps in and pokes the ball off him, and their player
  // stumbles on past him (around him, on the camera's side) and ends up behind him.
  async wonIntro() {
    const sc = this.sc, s = this.sim, h = s.a('hero'), o1 = s.a('o1'), [hx, hy] = sc.heroTo, meet = { x: hx + 1, y: hy };
    Object.assign(o1, { x: hx + 4.6, y: hy + .2, tx: hx + 4.6, ty: hy + .2, face: [-1, 0] });
    s.give('o1'); Object.assign(s.ball, { x: o1.x - .5, y: o1.y });
    s.go('hero', hx, hy, 2.6); s.go('o1', meet.x, meet.y, 3.2);
    (sc.oppsTo || []).forEach((p, i) => i && p && s.go('o' + (i + 1), ...p, 3));
    const t0 = s.time;
    await this.until(() => dist(o1, h) < 1.3 || dist(o1, meet) < .15 || s.time - t0 > 3);
    s.give('hero'); this.sfx('tap'); s.go('hero', hx, hy, 2); // the ball is at his feet now (it rolls the last bit)
    this.hud.caption('You won the ball! 💪'); this.say('You won the ball!');
    s.go('o1', hx + .3, hy + 1.5, 3); await this.until(() => dist(o1, { x: hx + .3, y: hy + 1.5 }) < .3 || s.time - t0 > 4);
    s.go('o1', ...sc.oppsTo[0], 3.6); await this.delay(.8);
    s.stopAll(); this.hud.caption('');
  }
  // "Peek, then turn": he checks toward his friend, the friend passes, and the play freezes with the ball on its way.
  async passIn() {
    const sc = this.sc, s = this.sim, m = s.a('m1'), [hx, hy] = sc.heroTo;
    s.go('hero', hx, hy, 2.5); (sc.oppsTo || []).forEach((p, i) => p && s.go('o' + (i + 1), ...p, 3));
    await this.delay(.5);
    const l = Math.hypot(hx - m.x, hy - m.y) || 1; m.face = [(hx - m.x) / l, (hy - m.y) / l]; s.windup('m1'); await this.delay(.2);
    s.kick(hx - .45, hy, { speed: 6.5, arc: .05 }); await this.delay(.4);
    s.stopAll();
  }
  // Waits (in game time) until `f` is true.
  until(f) { return this.skipping ? Promise.resolve() : new Promise(res => this.tweens.push({ t: 0, dur: 1e9, f: null, res, until: f })); }

  decide() {
    this.phase = 'decide'; this.step = spotKind(this.sc) ? 'spot' : null; this.decideAt = this.sim.time; this.pendingDir = null;
    if (this.sc.kind === 'receive') { this.step = 'turn'; this.yaw0 = this.yaw; this.peeked = false; } // the ball waits in the air
    if (this.sc.kind === 'tackle') { // the attacker comes at him; he taps STEAL (or the attacker gets past)
      this.step = 'tackle'; this.lookUp = true; this.scanned = true;
      const g = this; this.sim.run((function* () { if (!(yield* g.approach(false))) g.choose('tackle:none'); })());
    }
    this.delay(1.2).then(() => { if (this.phase === 'decide') this.hud.caption(''); });
    return new Promise(res => { this._choose = res; });
  }
  // How good a choice is: 'best' (the star answer), 'ok' (just as good), 'safe' (keeps the ball but there was
  // a better choice) or 'bad' (loses it). Dribbles are graded by the real space on the field, so any of the
  // eight directions into open grass works, and only directions a defender blocks lose the ball.
  rating(opt) {
    if (this.sc.best && opt === this.sc.best) return 'best';
    if (this.sc.kind === 'tackle' || this.sc.then) return 'bad'; // a give-and-go step 1 has one right answer: the pass
    if (opt.startsWith('turn:')) return grade(this.sc)['drib:' + this.sc.turns[opt[5]]] === 'good' ? 'ok' : 'bad';
    if ((this.sc.ok || []).includes(opt)) return 'ok';
    if ((this.sc.safe || []).includes(opt)) return 'safe';
    if (spotKind(this.sc)) return 'bad';
    const g = (this.grades ||= this.sc.grades || grade(this.sc))[opt];
    if ((opt.startsWith('drib:') || opt.startsWith('push:') || opt === 'shoot') && g === 'good') return 'ok';
    if ((opt.startsWith('drib:') || opt.startsWith('push:')) && g === 'safe') return 'safe';
    return 'bad';
  }
  isGood(opt) { return this.rating(opt) !== 'bad'; }
  target(opt) {
    const h = this.sim.a('hero');
    if (opt.startsWith('tackle:')) return { x: this.sim.ball.x, y: this.sim.ball.y };
    if (opt.startsWith('turn:')) return dribbleEnd({ x: this.sc.heroTo[0], y: this.sc.heroTo[1] }, this.sc.turns[opt[5]], L, W);
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
    a.face = [(shot.x - a.x) / l, (shot.y - a.y) / l];
    for (const p of s.team('us')) if (p.id !== id && closestOnLane(p, s.ball, shot, 0).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, shot); }
    s.windup(id); yield .2;
    if (!shotClear(s.ball, shot, opps)) { this.result = 'kept'; s.stopAll(); this.emit('kept'); yield 1.1; return; }
    s.kick(shot.x, shot.y, { speed: 17, arc: .5 }); this.kicked = true;
    yield () => s.ball.state === 'loose';
    this.result = 'goal'; this.ai = false; s.stopAll(); this.emit('goal'); yield 1.4;
  }
  // Turn to face the target, wind up, then the ball leaves the foot at contact. Players the scripts aren't
  // moving freeze if they stand near the ball's path, so the team AI never walks anyone into (or through) it.
  // A player near the path of a kick stops; one right in it steps out of the way, to the side he is already on.
  giveWay(p, from, to, low = true) {
    const c = closestOnLane(p, from, to, 0);
    if (!low || c.d >= .8) { this.sim.stop(p.id); return; }
    const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy);
    let nx = l > .05 ? dx / l : -(to.y - from.y), ny = l > .05 ? dy / l : to.x - from.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    this.sim.go(p.id, clamp(c.x + nx * 1.3, .5, L - .5), clamp(c.y + ny * 1.3, .5, W - .5), 4.5);
  }
  *strike(id, x, y, opts) {
    const s = this.sim, a = s.a(id), dx = x - a.x, dy = y - a.y, l = Math.hypot(dx, dy) || 1;
    const to = { x, y };
    for (const p of s.agents.values()) if (p.id !== id && !this.scripted.has(p.id) && closestOnLane(p, s.ball, to, .02).d < 1.2) { this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, s.ball, to, (opts?.arc ?? .3) < .4); }
    a.face = [dx / l, dy / l]; s.windup(id); yield .2;
    s.kick(x, y, opts); this.kicked = true;
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
    const s = this.sim;
    // He has to actually reach the ball before it's his.
    const t0 = s.time; yield () => { s.go(opp.id, s.ball.x, s.ball.y, 5); return dist(opp, s.ball) < .75 || s.time - t0 > .7; };
    s.give(opp.id); s.stop('hero'); this.result = 'stolen'; this.emit('stolen');
    this.scripted.add(opp.id); s.go(opp.id, Math.max(2.5, opp.x - 4), clamp(lerp(opp.y, W / 2, .4), 1.5, W - 1.5), 4.8); yield .8;
  }
  *passBad(id) {
    const s = this.sim, m = s.a(id), them = s.team('them');
    // The defender who cuts it out is the first one along the path (not just the nearest to it).
    const along = them.map(o => ({ opp: o, ...closestOnLane(o, s.ball, m, .02) })).filter(c => c.d < .9).sort((a, b) => a.t - b.t)[0];
    const ic = along || interceptor(s.ball, m, them);
    let marker = s.team('them').sort((a, b) => dist(a, m) - dist(b, m))[0];
    // If the cut-off point is past where he'll meet the ball, the ball reaches him first: then it's a tackle, not an interception.
    const meetD = dist(s.ball, { x: lerp(m.x, s.ball.x, .3), y: lerp(m.y, s.ball.y, .3) }), late = dist(s.ball, ic) > meetD + .2;
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
    const s = this.sim, h = s.a('hero'), end = dribbleEnd(h, dir, L, W), cut = good && takeOn(h, dir, s.team('them'));
    this.scripted.add('hero'); s.go('hero', end.x, end.y, 4.4);
    const t0 = s.time;
    // A take-on: the defender bites, stepping in toward where the ball was, and he cuts past him on the open side.
    if (cut?.good) { const f = cut.foe; this.scripted.add(f.id); s.go(f.id, lerp(f.x, h.x, .5), lerp(f.y, h.y, .5), 3); yield .45; this.scripted.delete(f.id); }
    if (good) {
      yield () => dist(h, end) < .3 || s.time - t0 > 2.5;
      if (BACKWARD.has(dir) || this.keepOnly) { s.stop('hero'); this.result = 'kept'; this.ai = false; s.stopAll(); this.emit('kept'); yield 1.1; return; }
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
    // Defenders hold still for the moment of the kick (they rejoin the team AI once the ball lands).
    for (const o of opps) if (!this.scripted.has(o.id)) { this.scripted.add(o.id); s.stop(o.id); this.frozen.push(o.id); }
    // A bad push straight at a defender is his ball: he stops it where it reaches him.
    const inLane = !good && opps.map(o => ({ opp: o, ...closestOnLane(o, s.ball, end, .05) })).filter(c => c.d < 1).sort((a, b) => a.t - b.t)[0];
    if (inLane) {
      const o = inLane.opp; this.scripted.add(o.id); s.go(o.id, inLane.x, inLane.y, 4);
      yield* this.strike('hero', inLane.x, inLane.y, { speed: 8.5, arc: .1 });
      yield () => s.ball.state === 'loose';
      const t0 = s.time; yield () => dist(o, s.ball) < .7 || s.time - t0 > .8;
      yield* this.steal(o); return;
    }
    yield* this.strike('hero', end.x, end.y, { speed: 8.5, arc: .15 });
    s.go('hero', end.x, end.y, 5.4);
    // The nearest defender always races for it too. A push is only "good" when he clearly gets there first,
    // so the defender arrives a step late (and pulls up instead of running into him).
    const racer = opps.sort((a, b) => dist(a, end) - dist(b, end))[0];
    // He runs to just beside where it stops, on his own side of its line, so he chases it instead of running down the ball's path.
    const ex = end.x - s.ball.x, ey = end.y - s.ball.y, el = Math.hypot(ex, ey) || 1, rs = Math.sign(ex * (racer.y - s.ball.y) - ey * (racer.x - s.ball.x)) || 1;
    this.scripted.add(racer.id); s.go(racer.id, end.x - ey / el * .6 * rs, end.y + ex / el * .6 * rs, good ? DEF_RUN : 5);
    const t0 = s.time; yield () => s.ball.state === 'loose' && (dist(h, end) < .6 || (!good && dist(racer, end) < .6)) || s.time - t0 > 3;
    if (good) {
      s.give('hero');
      const back = Math.max(1.4, dist(racer, h)); s.go(racer.id, h.x + (racer.x - h.x) / (dist(racer, h) || 1) * back, h.y + (racer.y - h.y) / (dist(racer, h) || 1) * back, 2);
      yield .1; this.scripted.delete(racer.id);
      if (this.keepOnly) { this.result = 'kept'; this.ai = false; s.stopAll(); this.emit('kept'); yield 1.1; return; }
      yield* this.finish('hero');
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
      const lane = o => Math.min(...us.map(d => closestOnLane(d, s.ball, o, .05).d));
      const to = mates.filter(o => lane(o) > 1).sort((a, b) => lane(b) - lane(a))[0];
      if (to) { // he passes away to a teammate; with no open pass at all, he just turns away and holds it up
        this.scripted.add(to.id); s.stop(to.id);
        yield* this.strike(c.id, to.x, to.y, { speed: 10, arc: .15 });
        yield () => s.ball.state === 'loose';
        s.give(to.id);
      } else { const [hx, hy] = toGoal(c); c.face = [-hx, -hy]; yield .5; }
      this.result = 'held'; this.ai = false; s.stopAll(); this.emit('held'); yield 1.3; return;
    }
    if (good) {
      let guarded = spotId.startsWith('o') ? s.a(spotId) : null;
      if (guarded && s.team('us').some(d => d.id !== 'hero' && closestOnLane(d, c, guarded, .05).d < .7)) guarded = null; // a friend is in the way: he wins it in front instead
      if (guarded) { // the carrier tries the pass he was guarding; he steps in and takes it
        this.scripted.add(c.id); this.scripted.add(guarded.id);
        const cut = { x: lerp(c.x, guarded.x, .75), y: lerp(c.y, guarded.y, .75) };
        yield .35; s.go('hero', cut.x, cut.y, 5.4);
        yield* this.strike(c.id, cut.x, cut.y, { speed: 10, arc: .1 });
        yield () => s.ball.state === 'loose' || (s.ball.z < .9 && dist(h, s.ball) < .5); // he takes it the moment it reaches him
        s.give('hero');
      } else if (this.duelOK) { // in a match, once he has "Steal it!": now it's 1v1, and he picks the moment
        this.duelOK = false; this.result = 'duel'; return;
      } else { // pressure or recovery: he is now in front of the ball, so the carrier runs into him and loses it
        const [gx, gy] = toGoal(c);
        this.scripted.add(c.id); s.go(c.id, c.x + gx * 3, c.y + gy * 3, 2.8);          // keeps going at goal, facing it
        // The tackle comes from a defender who is goal-side of the ball (in front of him), never from behind.
        const front = [...defenders()].filter(d => (d.x - c.x) * gx + (d.y - c.y) * gy > .3).sort((a, b) => dist(a, c) - dist(b, c));
        const tackler = front.includes(h) ? h : front[0] || h; // he made the right run, so he makes the tackle
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
    this.ai = false; for (const d of s.team('us')) if (d.id !== 'hero') s.stop(d.id);
    if (plan.kind === 'pass') {
      const t1 = s.time; yield () => dist(h, sp) < .4 || s.time - t1 > 1;
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
  // Getting open: he runs to his spot while his defender follows a step behind. Open space: his friend passes
  // and he plays on. Behind a defender: the pass gets cut out. Next to the ball: both defenders close in and win it.
  *supportGen(spotId, good) {
    const s = this.sim, sp = this.sc.spots.find(x => x.id === spotId), h = s.a('hero'), c = s.a(this.sc.carrier || 'm1');
    const o1 = s.a(this.sc.pressId || 'o1'), o2 = s.a(this.sc.markId || 'o2'), o2id = o2.id;
    this.ai = false; s.stopAll(); for (const a of s.agents.values()) this.scripted.add(a.id);
    s.go('hero', sp.x, sp.y, 5);
    const t0 = s.time;
    yield () => { s.go(o2id, h.x + (c.x - h.x) * .12, h.y + (c.y - h.y) * .12, 2.6); return dist(h, sp) < .4 || s.time - t0 > 1.8; };
    s.stop('hero'); s.stop(o2id);
    if (sp.crowd) { // two defenders on two players right together: they win it
      const t1 = s.time; yield () => { s.go(o1.id, c.x, c.y, 4); s.go(o2id, lerp(h.x, c.x, .5), lerp(h.y, c.y, .5), 3.5); return dist(o1, c) < .9 || s.time - t1 > 1.5; };
      yield* this.steal(o1); return;
    }
    const l = Math.hypot(c.x - h.x, c.y - h.y) || 1; h.face = [(c.x - h.x) / l, (c.y - h.y) / l]; yield .25;
    if (good) {
      if (this.has('peek-and-turn')) { yield* this.strike(c.id, h.x - .3, h.y, { speed: 8, arc: .05 }); this.result = 'incoming'; return; } // he'll peek and turn
      yield* this.strike(c.id, h.x, h.y, { speed: 11, arc: .15 });
      yield () => s.ball.state === 'loose' || dist(h, s.ball) < .5;
      s.give('hero'); this.scripted = new Set(['hero']); this.ai = true; yield .2;
      yield* this.finish('hero'); return;
    }
    // The pass goes, but the defender standing in its path cuts it out.
    const them = s.team('them'), cut = them.map(o => ({ opp: o, ...closestOnLane(o, s.ball, h, .05) })).sort((a, b) => a.d - b.d)[0];
    s.go(cut.opp.id, cut.x, cut.y, 4);
    yield* this.strike(c.id, cut.x, cut.y, { speed: 11, arc: .1 });
    yield () => s.ball.state === 'loose';
    yield* this.steal(cut.opp);
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
  // ---------- 1v1: steal it ----------
  // 'good' when the ball is away from the attacker's feet and close enough to reach; 'early' when it is too far
  // away to reach; 'tight' when it is at his feet.
  tackleState() {
    const s = this.sim, c = s.a(this.sc.carrier), b = s.ball, h = s.a('hero');
    const loose = dist(b, c) > LOOSE, reach = dist(h, b) < REACH;
    return loose && reach ? 'good' : !reach ? 'early' : 'tight';
  }
  // The attacker dribbles at him with the scenario's touches while he backs off, staying in front, between the
  // ball and the goal. Returns true when a steal moment comes (if `untilWindow`), false once the attacker is past.
  *approach(untilWindow) {
    const s = this.sim, sc = this.sc, c = s.a(sc.carrier), h = s.a('hero'), b = s.ball, tk = this.tk ||= { i: 0, wait: 0 };
    this.ai = false; for (const a of s.agents.values()) this.scripted.add(a.id);
    for (const a of s.agents.values()) if (a.id !== c.id && a.id !== 'hero') s.stop(a.id);
    for (;;) {
      if (this.tackleState() === 'good') { tk.lastGood = s.time; if (untilWindow) return true; }
      if (c.x < h.x - .5 && b.carrier === c.id) return false;        // he's past
      // Jockey: stand about 1.8 m from the ball on its goal side, backing off a little slower than he comes.
      const gl = Math.hypot(b.x, b.y - W / 2) || 1, jx = b.x - b.x / gl * 1.8, jy = b.y + (W / 2 - b.y) / gl * 1.8;
      s.go('hero', jx, jy, 1.9);
      if (b.carrier === c.id) {
        if (tk.wait > 0) tk.wait -= 1 / 30;
        else {
          if (tk.i >= sc.touches.length) return false;
          const len = sc.touches[tk.i++], last = tk.i === sc.touches.length;
          // Every touch goes toward our goal; big ones drift a little to the side, the last one goes past him.
          let ax = -b.x, ay = W / 2 - b.y; const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
          const tilt = last ? .75 : len > 1.2 ? .35 : 0, sd = sc.passSide * (tk.i % 2 ? 1 : -1) * (last ? 1 : .6);
          const dx = ax * Math.cos(tilt * sd) - ay * Math.sin(tilt * sd), dy = ax * Math.sin(tilt * sd) + ay * Math.cos(tilt * sd);
          const to = { x: clamp(b.x + dx * len * (last ? 2.2 : 1), 1, L - 1), y: clamp(b.y + dy * len * (last ? 2.2 : 1), 1, W - 1) };
          for (const a of s.agents.values()) if (a.id !== c.id && a.id !== 'hero' && closestOnLane(a, b, to, 0).d < 1) this.giveWay(a, b, to); // nobody stands in its path
          s.kick(to.x, to.y, { speed: len > 1.2 ? 3.4 : 2.4, arc: 0, touch: true });
          tk.to = to; tk.wait = len > 1.2 ? .05 : .25; tk.big = len > 1.2;
        }
      } else if (b.state !== 'carried') {
        s.go(c.id, tk.to.x, tk.to.y, tk.big ? sc.speed * .7 : sc.speed); // after a big touch he has to reach for it
        if (b.state === 'loose' && dist(c, b) < .45) s.give(c.id);
      }
      yield 1 / 30;
    }
  }
  *tackleGen(opt) {
    const s = this.sim, sc = this.sc, c = s.a(sc.carrier), h = s.a('hero');
    this.ai = false; for (const a of s.agents.values()) { this.scripted.add(a.id); if (a.id !== c.id && a.id !== 'hero') s.stop(a.id); } // the others stay with their players
    if (opt === 'tackle:good') {
      const got = this.tk?.graceTap || (yield* this.approach(true));
      if (got !== false) {
        if (this.showing) { this.handTap = (this.handTap || 0) + 1; this.sfx('click'); } // the hand taps STEAL now
        // He pokes it away from the attacker, then turns with it, facing up the field.
        s.stop(c.id); const t0 = s.time;
        yield () => { s.go('hero', s.ball.x, s.ball.y, 5); return dist(h, s.ball) < .5 || s.time - t0 > .8; };
        s.give('hero'); h.face = [1, 0]; s.go('hero', h.x + 2.5, lerp(h.y, W / 2, .2), 3.4); s.go(c.id, c.x + .6, c.y, 1.5);
        this.result = 'won'; this.emit('won'); yield 1.3; s.stopAll(); return;
      }
    } else if (opt !== 'tackle:none') {
      // He dives in. The attacker gets there first and takes it around him; he lands where the ball was.
      const at = { x: s.ball.x, y: s.ball.y };
      s.go('hero', at.x, at.y, 4.5); yield .35; s.go('hero', h.x, h.y, 0);
      if (s.ball.carrier !== c.id) { const t0 = s.time; yield () => { s.go(c.id, s.ball.x, s.ball.y, sc.speed + .6); return dist(c, s.ball) < .5 || s.time - t0 > 1; }; s.give(c.id); }
      const side = c.y > h.y ? 1 : -1; s.go(c.id, Math.max(2, h.x - 1.2), clamp(h.y + side * 1.6, 1.5, W - 1.5), 4.2);
      yield () => c.x < h.x - .8 || dist(c, { x: c.tx, y: c.ty }) < .2;
    }
    // He's past: he runs in and scores, from a spot where none of our players stands in the way of the shot.
    const ours = s.team('us').filter(d => d.id !== 'hero');
    const clear = y => Math.min(9, ...ours.map(d => Math.min(closestOnLane(d, c, { x: 4.5, y }, 0).d, closestOnLane(d, { x: 4.5, y }, { x: -.7, y: clamp(y, gy0 + .8, gy1 - .8) }, 0).d)));
    const spot = { x: 4.5, y: [lerp(c.y, W / 2, .6), W / 2 - 2.5, W / 2, W / 2 + 2.5].sort((a, b) => clear(b) - clear(a))[0] };
    s.go(c.id, spot.x, spot.y, 4.6);
    const t1 = s.time; yield () => { s.go('hero', c.x + 1.4, c.y + (h.y > c.y ? 1 : -1), 3.2); return dist(c, spot) < .4 || s.time - t1 > 3; }; // he chases from behind
    s.stopAll(); yield* this.strike(c.id, -.7, clamp(c.y, gy0 + .8, gy1 - .8), { speed: 17, arc: .5 });
    yield () => s.ball.state === 'loose';
    this.result = 'goalAgainst'; this.emit('goalAgainst'); yield 1.3;
  }
  // Give-and-go, step 1: the pass to the wall friend. He stays where he is; step 2 asks where to run.
  *passOnly(id) {
    const s = this.sim, t = s.a(id);
    this.ai = false; s.stopAll(); this.scripted.add(id);
    yield* this.strike('hero', t.x, t.y, { speed: 13, arc: .2 });
    yield () => s.ball.state === 'loose';
    s.give(id); this.result = 'passed'; yield .2;
  }

  *outcomeGen(opt, good) {
    if (opt.startsWith('tackle:')) { yield* this.tackleGen(opt); this.ai = false; return; }
    if (opt.startsWith('turn:')) { // the ball arrives, and his first touch turns him that way
      const s = this.sim; this.scripted.add('hero'); s.stop('hero');
      const t0 = s.time; yield () => s.ball.state !== 'flying' || s.time - t0 > 1.5;
      s.give('hero'); yield* this.dribbleGen(this.sc.turns[opt[5]], good); this.ai = false; return;
    }
    if (good && this.sc.then && opt === this.sc.best) { yield* this.passOnly(MATE[opt]); this.ai = false; return; }
    if (good && this.offBall && MATE[opt]) { this.offBall = false; yield* this.passOnly(MATE[opt]); this.result = 'support'; this.ai = false; return; }
    if (opt === 'shoot') { this.ai = true; yield* this.shootGen(good); this.ai = false; return; }
    if (opt.startsWith('spot:')) { yield* (this.sc.kind === 'support' ? this.supportGen(opt.slice(5), good) : this.defendGen(opt.slice(5), good)); this.ai = false; return; }
    if (opt.startsWith('push:')) { yield* this.pushGen(opt.slice(5), good); this.ai = false; return; }
    if (MATE[opt]) {
      if (good) { yield* this.passGood(MATE[opt]); yield* this.finish(MATE[opt]); }
      else yield* this.passBad(MATE[opt]);
    } else yield* this.dribbleGen(opt.slice(5), good);
    this.ai = false;
  }
  async outcome(opt, good) {
    const h = this.sim.a('hero');
    if (this.sc?.kind !== 'tackle') this.handAt = null;
    // A "safe" dribble or push forward (onto a friend) keeps the ball and stops there; it doesn't run on to score.
    this.keepOnly = good && (opt.startsWith('drib:') || opt.startsWith('push:')) && this.sc.kind !== 'receive' && this.rating(opt) === 'safe';
    Object.assign(this, { roles: null, result: null, phase: 'outcome', step: null, pendingDir: null, drag: null, turn: 0, camMode: this.sc?.kind === 'tackle' ? 'player' : 'follow', ai: true, scripted: new Set(['hero']), ballTeam: 'us' });
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
    // Support shape: spread out. The attacker nearer the goal gives a target ahead and wide; the other is an
    // outlet a little behind, on the other side. Both stay out of the dribbler's path, at least 4.5 m from where
    // he is going, and apart from each other, so nobody runs into him or takes his space (what the AI players do
    // teaches too: space means nobody there, not even a friend).
    const goalAhead = (p, q) => (q.x - p.x) * dir, mover = carrier && carrier.team === atk ? carrier : null;
    const from = mover ? { x: mover.x, y: mover.y } : ball, fut = mover ? { x: mover.tx, y: mover.ty } : ball;
    const clearOf = p => {
      for (let k = 0; k < 3; k++) {
        const c = closestOnLane(p, from, fut, 0);
        if (c.d < 2.5) { const dx = p.x - c.x, dy = p.y - c.y, l = Math.hypot(dx, dy); const ny = l > .05 ? dy / l : (p.y < W / 2 ? -1 : 1), nx = l > .05 ? dx / l : 0; p.x = c.x + nx * 2.5; p.y = c.y + ny * 2.5; }
        const d = dist(p, fut); if (d < 4.5) { const l = d || 1; p.x = fut.x + (p.x - fut.x) / l * 4.5; p.y = fut.y + (p.y - fut.y) / l * 4.5; }
        p.x = clamp(p.x, 2, L - 2); p.y = clamp(p.y, 1.5, W - 1.5);
      }
      return p;
    };
    const sup = attackers.filter(free).sort(goalAhead), side0 = sup[0] && sup[0].y < fut.y ? -1 : 1;
    const wide = sgn => { const y = clamp(fut.y + sgn * 5, 2, W - 2); return Math.abs(y - fut.y) < 3.5 ? clamp(fut.y - sgn * 5, 2, W - 2) : y; };
    const spots = sup.map((a, i) => clearOf(i === 0 ? { x: clamp(fut.x + dir * 5, 2, L - 3), y: wide(side0) } : { x: clamp(fut.x - dir * 3, 2, L - 2), y: wide(-side0) }));
    if (spots.length === 2 && dist(spots[0], spots[1]) < 4) { spots[1].y = wide(spots[0].y > fut.y ? -1 : 1); clearOf(spots[1]); }
    sup.forEach((a, i) => s.go(a.id, spots[i].x, spots[i].y, i ? 3.4 : 3.8));
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
  // In demos he really looks around: head up, turn left, then right (past his shoulder, so he can see behind),
  // then settle on what he found. Shows a child that turning to look is part of the move.
  async lookAround(aim, wide = 1.5) {
    const turnTo = (to, sec) => { const y0 = this.yaw; return this.tween(sec, t => { this.yaw = y0 + wrap(to - y0) * smooth(t); }); };
    const base = this.yaw;
    this.hud.caption('👀 Look left…'); this.say('Look left.'); await turnTo(base + wide, 1.2);
    this.hud.caption('👀 …look right…'); this.say('Look right.'); await turnTo(base - wide, 1.8);
    await turnTo(aim, 1.2);
  }

  // ---------- the teaching hand ----------
  // In demos and replays a hand shows the taps that make the play: LOOK UP, then PASS and the friend, DRIBBLE and
  // the arrow (and small touches or big push), SHOOT, a spot to run to, a turn arrow, or STEAL. So he learns
  // which buttons do what along with the idea. `handAt` is a button id, a point on the field {x, y, z}, or a
  // point on the screen {sx, sy} (fractions of its size).
  async tapAt(target, wait = .8) {
    if (this.skipping) return;
    this.handAt = target; await this.delay(wait);
    if (this.skipping) return;
    this.handTap = (this.handTap || 0) + 1; this.sfx('click'); await this.delay(.4);
  }
  // A drag on the screen turns his head: the hand slides the way a finger would (see lookMove).
  async dragTo(yaw, sec = 1) {
    if (this.skipping) { this.yaw = yaw; return; }
    const y0 = this.yaw, d = wrap(yaw - y0), sx = .5 + clamp(-d / 3.2 * .5, -.3, .3);
    this.handAt = { sx: .5, sy: .62 }; await this.delay(.6);
    this.lookUp = true; this.scanned = true; this.handAt = { sx, sy: .62 };
    await this.tween(sec, t => { this.yaw = y0 + d * smooth(t); });
    await this.delay(.2);
  }
  onScreen(p) {
    const q = this.world.project(p.x, p.y, p.z ?? 0), cw = this.world.canvas.clientWidth, ch = this.world.canvas.clientHeight;
    return !!q && q[0] > cw * .1 && q[0] < cw * .9 && q[1] > ch * .12 && q[1] < ch * .85;
  }
  // Acts out the taps for `opt` (the decision is not made here: outcome() plays it right after).
  async showTaps(opt) {
    const sc = this.sc, h = this.sim.a('hero');
    this.showing = true; this.phase = 'decide'; this.pendingDir = null;
    if (this.skipping || !h) return;
    if (sc.kind === 'tackle') { this.step = 'tackle'; this.lookUp = true; this.handAt = 'stealBtn'; await this.delay(.6); return; } // tapped when the ball rolls loose (tackleGen)
    if (sc.kind === 'receive') this.step = 'turn';
    else if (!this.lookUp) { await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); await this.delay(.5); }
    const face = p => wrap(Math.atan2(p.y - h.y, p.x - h.x));
    if (MATE[opt]) {
      const m = this.sim.a(MATE[opt]);
      if (!this.onScreen({ ...m, z: .9 })) await this.dragTo(face(m));
      this.seen.add(MATE[opt]);
      await this.tapAt('passBtn'); this.step = 'pass'; await this.delay(.3);
      await this.tapAt({ x: m.x, y: m.y, z: .9 });
    } else if (opt === 'shoot') {
      if (Math.abs(wrap(this.yaw)) > .5) await this.dragTo(0, .8);
      await this.tapAt('shootBtn');
    } else if (/^(drib|push):/.test(opt)) {
      const d = opt.slice(5);
      await this.tapAt('dribBtn'); this.step = 'dribble'; await this.delay(.5); // the camera rises to show the arrows
      const t = this.targets().find(x => x.opt === 'drib:' + d);
      if (t) await this.tapAt(t);
      if (this.pushAllowed) { this.pendingDir = d; await this.delay(.3); await this.tapAt(opt.startsWith('push:') ? 'touchBig' : 'touchSmall'); }
    } else if (opt.startsWith('spot:') || opt.startsWith('turn:')) {
      this.step = opt.startsWith('spot:') ? 'spot' : 'turn';
      const t = this.targets().find(x => x.opt === opt);
      if (t && opt.startsWith('spot:') && !this.onScreen(t)) await this.dragTo(face(t));
      if (t) await this.tapAt(t);
    }
  }
  // Shows the taps, then plays the choice. Used by demos and by every replay of the better play.
  async showPlay(opt) {
    await this.showTaps(opt);
    await this.outcome(opt, true);
    this.showing = false; this.handAt = null;
  }

  async demo(skillId) {
    return this.demoGeneric(skillId);
  }
  // Demo for any lesson: run up, look up, show the idea in words, then play the 3-star choice.
  async demoGeneric(skillId) {
    this.mode = 'demo';
    const sc = demoScenario(skillId); this.load(sc);
    const hero = this.name('hero'), tip = skillById(skillId)?.tip || '';
    const intro = this.talk(`Watch ${hero}.`, .2, `Watch ${hero}!`);
    await this.pre(); await intro;
    this.phase = 'decide'; this.step = spotKind(sc) ? 'spot' : null; this.showing = true;
    await this.delay(.4);
    if (sc.kind === 'tackle' || sc.kind === 'receive') this.lookUp = true;
    else { await this.tapAt('lookBtn'); this.lookUp = true; this.scanned = true; this.sfx('up'); this.handAt = null; }
    await this.delay(.9);
    await this.talk(tip, 1.8); // the lesson's one idea: let it sit before anything moves
    // He looks around first, so the choice doesn't come out of nowhere. For a pass he ends up facing the open
    // friend; otherwise he turns back to the space ahead (or to the ball on defense).
    const mateId = MATE[sc.best], h = this.sim.a('hero');
    if (mateId) {
      const m = this.sim.a(mateId);
      await this.lookAround(wrap(Math.atan2(m.y - h.y, m.x - h.x)));
      this.seen.add(mateId); this.hint = true;
      await this.talk(`${this.name(mateId)} is open!`, 1);
    } else if (sc.kind === 'receive') {
      this.step = 'turn'; this.yaw0 = this.yaw;
      await this.talk('Peek over your shoulder.', .2, 'Peek! 👀');
      const o = this.sim.a('o1'), h = this.sim.a('hero'), side = wrap(Math.atan2(o.y - h.y, o.x - h.x) - this.yaw) > 0 ? 1 : -1;
      const y0 = this.yaw; await this.dragTo(y0 + side * 2.5, 1.1); await this.delay(.6);
      await this.talk(sc.pattern === 'peek-turn' ? 'A defender is behind you! Turn away!' : 'Nobody behind you! Turn and go!', .6);
      this.handAt = null; await this.tween(.6, t => { this.yaw = y0 + side * 2.5 * (1 - smooth(t)); }); // let go: his head comes back to the ball
      await this.talk(sc.pattern === 'peek-turn' ? 'Turn away from him!' : 'Turn and go!', .8); // the curved arrows show both turns
    } else if (sc.kind === 'tackle') {
      this.step = 'tackle'; this.hint = true;
      await this.talk('Watch the ball.', .4, 'Watch the ball… 👀');
    } else if (spotKind(sc)) {
      await this.lookAround(this.yaw, 1.1);
      const q = sc.kind === 'support' ? 'Where is the space? 👀' : 'See who is open? 👀';
      await this.talk(q.replace(/ 👀$/, ''), 1, q);
    } else {
      await this.lookAround(0);
      const saw = sc.best === 'shoot' ? 'Goal ahead! 🥅' : sc.pattern === 'trap-one' ? 'Only one defender! ⚡' : 'Space ahead! 💨';
      await this.talk(saw.replace(/ \S+$/u, ''), .8, saw);
    }
    this.hud.caption('');
    await this.showPlay(sc.best);
    if (sc.then && !this.skipping) { // give-and-go: now the run
      await this.toStep2(); this.phase = 'decide'; this.step = 'spot'; this.lookUp = true;
      await this.talk('Now run past him!', .6); this.hud.caption('');
      await this.showPlay(this.sc.best);
    }
    // Then say why it worked, with a moment to take it in.
    await this.delay(.8); // let the GOAL! (or the steal) land first
    if (!this.skipping) await this.talk(this.cue(), 2.5); // why it worked: the most important line, so it gets the longest pause
    this.hud.caption(''); this.skipping = false; this.showing = false; this.handAt = null; this.mode = 'between'; // the Skip button goes away
  }

  // Give-and-go, step 2: the friend has the ball; the defender who was on him turns to press the friend.
  async toStep2() {
    const s = this.sim, base = this.sc, t = base.then;
    this.sc = { ...t, skill: base.skill, id: base.id + '-2', pattern: base.pattern };
    Object.assign(this, { phase: 'pre', step: null, scripted: new Set(), lines: [], aimAt: null, ai: false, camMode: 'player', follow: null, grades: null, seen: new Set(), lookUp: false, turn: 0, drag: null });
    s.stopAll(); s.go('o1', ...t.move.o1, 3.2); s.go('o2', ...t.move.o2, 2.6);
    const h = s.a('hero'), m = s.a('m1'); this.yaw = this.frameYaw(this.sc, { x: base.heroTo[0], y: base.heroTo[1] }, m);
    await this.delay(.8); s.stopAll();
  }

  // Plays one scenario until he gets it. Wrong choices show why, replay the better way, then retry.
  // A give-and-go has two steps (the pass, then the run); each one is retried on its own.
  async round(sc, { hint }) {
    this.mode = 'lesson';
    this.load(sc); await this.pre();
    let firstTry = true;
    for (let k = 0; ; k++) {
      const more = !!this.sc.then, r = await this.attempt(hint, more);
      firstTry &&= r.firstTry;
      if (r.stars === 2) return { firstTry: false, stars: 2 };
      if (!more) return { firstTry, stars: 3 };
      await this.toStep2();
    }
  }
  // One decision, retried until it is right. `more`: another step follows, so a right choice shows no result yet.
  async attempt(hint, more) {
    const sc = this.sc, save = this.sim.save(), yawSave = this.yaw;
    // After a replay the round starts over facing the same way as before (toward the ball on a receive or on
    // defense), not up the field.
    const restart = () => { this.sim.restore(save); this.reset(); this.camMode = 'player'; this.yaw = yawSave; const h = this.sim.a('hero'); if (h && facesBall(sc)) h.face = [Math.cos(yawSave), Math.sin(yawSave)]; };
    for (let attempt = 1; ; attempt++) {
      this.hint = hint || attempt > 1;
      const opt = await this.decide();
      const rating = this.rating(opt), good = rating !== 'bad', scanned = this.scanned;
      // Every decision gets 0–3 stars. 3 = the best choice, 2 = safe but there was a better one, 0 = lost it.
      // The stars and tip are decided now and shown together with the result, the moment the play ends.
      const praise = sc.kind === 'receive' && this.peeked ? 'You peeked!' : sc.skill === 'look-up' && scanned ? 'You looked up!' : sc.kind === 'defense' ? 'Great defending!' : sc.kind === 'support' ? 'Great run!' : 'Great choice!';
      const tip = 'You kept it! Even better: ' + this.cue().replace(/^./, ch => ch.toLowerCase());
      this.rated = more && good && opt === sc.best ? null : rating === 'safe' ? { stars: 2, text: tip, watch: true, say: true }
        : good ? { stars: 3, text: sc.praise || `${sc.kind === 'tackle' ? 'Great steal!' : praise} ${this.cue()}` } // say why it was right, so the idea sticks
        : { stars: 0, text: sc.kind === 'defense' || sc.kind === 'tackle' ? 'He got through!' : sc.kind === 'support' ? 'No pass was on!' : 'Oops, lost it!' };
      this.card = null;
      await this.outcome(opt, good);
      if (more && good && opt === sc.best) return { firstTry: attempt === 1, stars: 3 };
      const answer = await (this.card || this.hud.banner('', 'goal', this.rated));
      this.rated = null;
      if (good && rating !== 'safe') return { firstTry: attempt === 1, stars: 3 };
      if (rating === 'safe') {
        if (answer === 'watch') {
          restart();
          await this.talk('Here is the 3-star play!', .2); await this.showPlay(sc.best); await this.delay(.8); this.hud.caption('');
        }
        return { firstTry: false, stars: 2 };
      }
      await this.feedback(save, opt);
      restart();
      await this.talk('Watch this way!', .2);
      await this.showPlay(sc.best);
      await this.delay(.8); // let the better play land before resetting
      restart();
      this.hud.caption('Your turn!'); this.say('Your turn!');
    }
  }
  // Freeze at the decision moment: red line for his choice, green for the better one.
  async feedback(save, opt) {
    if (this.sc.kind === 'tackle') { // no lines for a 1v1: just the cue, then the replay shows the moment
      const y = this.yaw; this.sim.restore(save); this.reset(); this.yaw = y; this.camMode = 'player'; this.phase = 'feedback';
      await this.talk(this.cue(), 1.5); return;
    }
    this.sim.restore(save); this.reset(); this.camMode = 'overview'; this.phase = 'feedback';
    const ball = { x: this.sim.ball.x, y: this.sim.ball.y }, bad = this.target(opt), best = this.target(this.sc.best);
    this.lines = [{ a: ball, b: { x: bad.x, y: bad.y }, color: '#e5484d' }, { a: ball, b: { x: best.x, y: best.y }, color: '#30a46c' }];
    this.aimAt = { x: (bad.x + best.x) / 2, y: (bad.y + best.y) / 2 };
    await this.talk(this.cue(), 1.5); // red line, green line, and why: wait for the whole sentence, then a beat
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
      this.praise(opt);
      // Chances that come from lessons he has passed (only some of the time, so play keeps flowing).
      this.offBall = !this.sc.then && this.has('get-open') && Math.random() < .6;
      this.duelOK = this.has('steal-it') && Math.random() < .6;
      await this.outcome(opt, good);
      await this.chain(); this.offBall = this.duelOK = false;
      tally();
      // Play flows on until a goal; after 4 plays in a row without one, start a fresh situation.
      streak = this.result === 'goal' || this.result === 'goalAgainst' ? 0 : streak + 1;
      live = streak > 0 && streak <= 4 && (this.result !== 'won' || this.has('won-it-go')); // play on after winning it: Won it? Go!
      if (i >= toWin * 25) break; // safety: don't let a match run forever
    }
    return score;
  }

  // In matches, a good choice gets a quick word that names what he did (the play doesn't stop for stars).
  praise(opt) {
    const r = this.rating(opt); if (r !== 'best' && r !== 'ok') return;
    const k = this.sc.kind, word = k === 'receive' ? (this.peeked ? 'Nice peek! 👀' : 'Nice turn!') : k === 'support' ? 'Great run!' : k === 'defense' ? 'Good defending!'
      : k === 'tackle' ? null : opt === 'shoot' ? null : opt.startsWith('pass:') ? 'Nice pass!' : opt.startsWith('push:') ? 'Into space! 💨' : 'Great dribble!';
    if (word) this.hud.toast(word);
  }

  // Follow-on decisions inside one play: the second step of a give-and-go, where to run after a pass, the pass
  // back to him (peek and turn), or a 1v1 once he's in front of the attacker.
  async chain() {
    const s = this.sim;
    for (let k = 0; k < 4; k++) {
      if (this.result === 'passed' && this.sc.then) await this.toStep2();
      else if (this.result === 'support') { if (!(await this.toSupport())) { this.result = 'kept'; return; } }
      else if (this.result === 'incoming') { if (!(await this.toReceive())) { await this.until(() => s.ball.state !== 'flying'); s.give('hero'); this.result = 'kept'; return; } }
      else if (this.result === 'duel') await this.toDuel();
      else return;
      const o = await this.decide(); this.praise(o); await this.outcome(o, this.isGood(o));
    }
  }
  // After his pass: he stays himself and picks where to run, from where everyone is right now. Spots: open space
  // with a clear path for the pass back (past his defender once he has "Pass and go!"), staying put, or running
  // to the ball. False when there's no fair choice (then he just takes over his friend, as before).
  async toSupport() {
    const s = this.sim, c = s.a(s.ball.carrier), h = s.a('hero'); if (!c || c.team !== 'us' || c.id === 'hero') return false;
    const opps = s.team('them'), O = opps.map(o => [o.x, o.y]), C = [c.x, c.y];
    const press = [...opps].sort((a, b) => dist(a, c) - dist(b, c))[0], mark = opps.filter(o => o !== press).sort((a, b) => dist(a, h) - dist(b, h))[0];
    const room = p => Math.min(...O.map(o => Math.hypot(o[0] - p[0], o[1] - p[1]))), past = this.has('give-and-go');
    let space = null, top = -1e9;
    for (let a = 0; a < 16; a++) for (const d of [3.5, 5]) {
      const p = [h.x + Math.cos(a * Math.PI / 8) * d, h.y + Math.sin(a * Math.PI / 8) * d];
      if (!inPitch(p, 1.2) || p[0] < c.x - 1 || Math.hypot(p[0] - c.x, p[1] - c.y) < 3.5 || !laneClear(C, p, O) || room(p) < 2.4) continue;
      const score = p[0] - Math.hypot(p[0] - h.x, p[1] - h.y) * .3 + (past && p[0] > press.x + 1.2 ? 4 : 0);
      if (score > top) { top = score; space = p; }
    }
    const H = [h.x, h.y], stayOpen = laneClear(C, H, O) && Math.hypot(h.x - c.x, h.y - c.y) > 2.6, stayBlocked = laneBlocked(C, H, O);
    const toH = Math.hypot(h.x - c.x, h.y - c.y) || 1, crowd = [c.x + (h.x - c.x) / toH * 1.6, c.y + (h.y - c.y) / toH * 1.6];
    const spots = [];
    if (space) spots.push({ id: 'space', x: space[0], y: space[1] });
    if (stayOpen || stayBlocked) spots.push({ id: 'stay', x: h.x, y: h.y });
    spots.push({ id: 'ball', x: crowd[0], y: crowd[1], crowd: true });
    if (spots.length < 2 || !(space || stayOpen) || spots.some((p, i) => spots.some((q, j) => j > i && Math.hypot(p.x - q.x, p.y - q.y) < 2.2))) return false;
    const best = space ? 'space' : 'stay';
    this.sc = { kind: 'support', live: true, id: 'live-run', skill: this.sc?.skill, carrier: c.id, pressId: press.id, markId: mark.id, spots,
      best: 'spot:' + best, ok: best === 'space' && stayOpen ? ['spot:stay'] : [], cue: past && space && space[0] > press.x + 1.2 ? 'Pass and go! Run past him into the space.' : 'Move to open space so your friend can pass to you!' };
    Object.assign(this, { phase: 'pre', step: null, scripted: new Set(), lines: [], aimAt: null, ai: false, camMode: 'player', follow: null, grades: null, seen: new Set(), lookUp: false, turn: 0, drag: null });
    s.stopAll(); this.yaw = this.frameYaw(this.sc, h, c); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)];
    await this.delay(.35);
    return true;
  }
  // A friend's pass is on its way to him: the ball waits in the air while he peeks, then he picks a turn. His left
  // and right turns lean up the field. False when neither turn is open (then he just takes the ball).
  async toReceive() {
    const s = this.sim, h = s.a('hero'), b = s.ball, face = Math.atan2(b.fy - h.y, b.fx - h.x);
    const nearest = ang => Object.entries(DRIBBLE_DIRS).sort((p, q) => Math.abs(wrap(p[1] - ang)) - Math.abs(wrap(q[1] - ang)))[0][0];
    const lean = side => Math.atan2(Math.sin(side), Math.cos(side) + 1);
    const turns = { L: nearest(lean(face + Math.PI / 2)), R: nearest(lean(face - Math.PI / 2)) };
    if (turns.L === turns.R) return false;
    const P = a => [a.x, a.y], mates = ['m1', 'm2'].map(id => P(s.a(id))), opps = s.team('them').map(P);
    const sc = { kind: 'receive', live: true, id: 'live-recv', skill: this.sc?.skill, carrier: s.team('us').find(a => a.id !== 'hero' && dist(a, { x: b.fx, y: b.fy }) < 1.5)?.id || 'm1',
      hero: P(h), heroTo: P(h), mates, opps, oppsTo: opps, turns };
    const g = grade(sc), goods = ['L', 'R'].filter(k => g['drib:' + turns[k]] === 'good').sort((p, q) => dribbleEnd(h, turns[q], L, W).x - dribbleEnd(h, turns[p], L, W).x);
    if (!goods.length) return false;
    Object.assign(sc, { best: 'turn:' + goods[0], ok: goods.slice(1).map(k => 'turn:' + k), cue: goods.length > 1 ? 'Nobody was behind you. Peek, then turn and go!' : 'A defender was behind you! Peek first, then turn away from him.' });
    this.sc = sc;
    Object.assign(this, { phase: 'pre', step: null, scripted: new Set(), lines: [], aimAt: null, ai: false, camMode: 'player', follow: null, grades: null, lookUp: false, turn: 0, drag: null });
    s.stopAll(); this.yaw = face; h.face = [Math.cos(face), Math.sin(face)];
    return true;
  }
  // He got in front of the attacker: now it's a 1v1, and he taps STEAL at the right moment.
  async toDuel() {
    const s = this.sim, c = s.a(s.ball.carrier), h = s.a('hero');
    const big = Math.random() < .5;
    this.sc = { kind: 'tackle', live: true, id: 'live-duel', skill: this.sc?.skill, carrier: c.id, touches: big ? [.3, 1.9, .3, 1.7] : [.3, .3, 1.8, .3, 1.6], speed: 3,
      passSide: Math.random() < .5 ? 1 : -1, best: 'tackle:good', ok: [], cue: 'Wait in front of him. Steal it when it rolls away from his feet!' };
    Object.assign(this, { phase: 'pre', step: null, scripted: new Set(), lines: [], aimAt: null, ai: false, camMode: 'player', follow: null, grades: null, tk: null });
    s.stopAll(); this.yaw = Math.atan2(c.y - h.y, c.x - h.x); h.face = [Math.cos(this.yaw), Math.sin(this.yaw)];
    await this.delay(.3);
  }

  home() { this.mode = 'home'; this.reset(); this.sim.setup(demoScenario('look-up')); this.camMode = 'orbit'; this.cam = null; this.hud.caption(''); }

  // ---------- input ----------
  get canAct() { return this.phase === 'decide' && this.mode !== 'demo' && !this.showing; }
  get canLook() { return (this.phase === 'pre' || this.phase === 'decide') && this.mode !== 'demo' && !this.showing; }
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
  // On a receive, a peek is a quick glance: when he lets go, his head turns back to the ball.
  lookEnd() {
    this.drag = null;
    if (this.sc?.kind === 'receive' && this.phase === 'decide' && this.yaw0 != null) { const y0 = this.yaw; this.tween(.35, t => { this.yaw = y0 + wrap(this.yaw0 - y0) * smooth(t); }); }
  }

  // Shooting is offered when he is close enough to goal to have a real chance.
  get canShoot() { const h = this.sim.a('hero'); return this.phase === 'decide' && !facesBall(this.sc) && !!h && h.x > L - (this.sc?.skill === 'shoot-close' ? 18 : 13); }
  shoot() { if (this.canAct && this.canShoot && !this.locked) this.choose('shoot'); }
  // The two turns as curved arrows around his feet: each starts just to one side of facing the ball and sweeps
  // around through that shoulder to the way the turn takes him (sc.turns). The facing is fixed for the round
  // (yaw0), so the arrows stay put while he peeks.
  turnArcs() {
    const f = this.yaw0 ?? this.yaw, out = [];
    for (const [id, d] of Object.entries(this.sc.turns || {})) {
      // His left is counterclockwise from where he faces (the pitch's y axis points to the left of +x).
      const to = DRIBBLE_DIRS[d], left = id === 'L', T = 2 * Math.PI, mod = v => ((v % T) + T) % T;
      const sweep = left ? mod(to - f) : -mod(f - to);
      out.push({ id, a0: f + (left ? .4 : -.4), a1: f + (left ? Math.max(.8, sweep) : Math.min(-.8, sweep)) });
    }
    return out;
  }
  // A tap up to a third of a second after the ball was loose still counts: that is about a child's reaction time.
  stealTap() {
    if (!this.canAct || this.sc?.kind !== 'tackle') return;
    const st = this.tackleState(), late = this.tk?.lastGood != null && this.sim.time - this.tk.lastGood < .35;
    if (late && st !== 'good') this.tk.graceTap = true; // steal right away, don't wait for the next loose touch
    this.choose('tackle:' + (late ? 'good' : st));
  }
  // PASS and DRIBBLE are always on screen; tapping one switches to it, tapping it again un-picks it.
  pass() {
    if (!this.canAct) return;
    this.pendingDir = null;
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
    if (this.step === 'turn') return this.turnArcs().flatMap(t => [t.a0 + (t.a1 - t.a0) * .5, t.a1].map(a => ({ opt: 'turn:' + t.id, x: h.x + Math.cos(a) * 1.35, y: h.y + Math.sin(a) * 1.35, z: 0 })));
    return [];
  }

  // ---------- per frame ----------
  tick(dt, time) {
    for (const t of this.tweens.slice()) {
      t.t += dt; const u = Math.min(1, t.t / t.dur); t.f?.(u);
      if (u >= 1 || t.until?.()) { this.tweens.splice(this.tweens.indexOf(t), 1); t.res(); }
    }
    if (this.sc?.kind === 'tackle' && this.camMode === 'player' && this.sim.a('hero')) { // keep the attacker in view
      const h = this.sim.a('hero'), b = this.sim.ball, want = Math.atan2(b.y - h.y, b.x - h.x);
      this.yaw = wrap(this.yaw + wrap(want - this.yaw) * Math.min(1, dt * 4));
    }
    // Players held still for a kick go back to the team AI once the ball has landed.
    // While a low ball is in the air, anyone the scripts aren't moving stops before stepping into its path.
    const fb = this.sim.ball;
    if (fb.state === 'flying') for (const p of this.sim.agents.values()) {
      const to = { x: fb.tx, y: fb.ty }, c = closestOnLane(p, fb, to, 0);
      if (this.scripted.has(p.id) || c.d >= 1) continue; // the receiver and the interceptor are scripted; everyone else gets out of the way
      this.scripted.add(p.id); this.frozen.push(p.id); this.giveWay(p, fb, to, fb.z < .9);
    }
    if (this.kicked && this.sim.ball.state !== 'flying') { for (const id of this.frozen) this.scripted.delete(id); this.frozen = []; this.kicked = false; }
    if (this.ai) this.teamAI();
    const held = this.phase === 'feedback' || (this.sc?.kind === 'receive' && this.phase === 'decide'); // a pass on its way waits while he peeks
    if (!held) this.sim.step(dt);
    if (this.sc?.kind === 'receive' && this.phase === 'decide' && this.yaw0 != null && Math.abs(wrap(this.yaw - this.yaw0)) > 1.4) this.peeked = true;

    const s = this.sim, h = s.a('hero');

    if (this.lookUp && this.turn) this.yaw = wrap(this.yaw + this.turn * TURN_SPEED * dt);
    this.look = clamp(this.look + (this.lookUp ? 1 : -1) * dt / .3, 0, 1);
    // While deciding with his head up, his body turns with his head (the ball stays at his feet).
    if (h && this.phase === 'decide' && this.lookUp && this.step !== 'dribble' && this.sc?.kind !== 'receive') {
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
      if (found.length && this.mode !== 'demo' && !facesBall(this.sc) && this.sc?.skill !== 'dribble-to-space' && (this.step === 'pass' || (!this.step && this.lookUp))) this.hud.seen(`👀 You see ${found.join(' and ')}`);
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
    // 1v1: a bit higher and farther back, aimed between him and the ball, so the ball and the attacker's feet
    // are always in view (seeing the touch is the whole lesson).
    if (this.sc?.kind === 'tackle') {
      const [bx, by] = rot(-4.2, 2, this.yaw); // over his shoulder, so his body never hides a ball rolling at him
      return { eye: [h.x + bx, h.y + by, 4.2], tgt: [lerp(h.x, b.x, .75), lerp(h.y, b.y, .75), 0], Ff: 1.02, Fw: .56 };
    }
    // Player view, behind him in the direction he's turned. Head down: close and aimed at the ball.
    // Head up: just above head height, looking out across the field.
    const k = smooth(this.look);
    const [bx, by] = rot(-lerp(3.1, 5.2, k), lerp(1.3, .3, k), this.yaw), [fx, fy] = rot(9, 0, this.yaw);
    // On attack, head down looks at the ball at his feet. On defense the ball is away from him, so head down
    // looks a few meters ahead of him toward the ball, keeping him in view.
    let dx = b.x, dy = b.y;
    if (facesBall(this.sc)) { const [ax, ay] = rot(3.5, 0, this.yaw); dx = lerp(h.x + ax, b.x, .25); dy = lerp(h.y + ay, b.y, .25); }
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
    if (this.glide > 0) this.glide -= dt;
    const k = 1 - Math.exp(-dt * (this.glide > 0 ? 2.6 : this.camMode === 'player' ? 12 : 4));
    for (let i = 0; i < 3; i++) { this.cam.eye[i] = lerp(this.cam.eye[i], want.eye[i], k); this.cam.tgt[i] = lerp(this.cam.tgt[i], want.tgt[i], k); }
    this.cam.Ff = lerp(this.cam.Ff, want.Ff, k); this.cam.Fw = lerp(this.cam.Fw ?? want.Fw, want.Fw, k);
  }
  updateHud() {
    const hud = this.hud, s = this.sim;
    let prompt = '';
    if ((this.mode === 'lesson' || this.mode === 'match' || this.mode === 'free') && !this.showing) {
      if (this.phase === 'pre') prompt = this.lookUp || this.sc?.kind === 'tackle' || this.sc?.kind === 'receive' ? '' : 'Tap 👀 to look up';
      else if (this.phase === 'decide') prompt =
        this.step === 'tackle' ? 'Wait… steal it when it rolls away!' :
        this.step === 'turn' ? (this.peeked ? 'Tap the arrow for your turn' : 'Ball coming! Drag to peek, then tap a turn arrow') :
        this.step === 'spot' ? (this.lookUp ? 'Tap where to run' : 'Watch the ball… tap 👀 to look up') :
        this.pendingDir ? 'Small touches or big push?' :
        this.step === 'pass' ? (this.seen.size ? 'Tap a friend you found' : 'Drag to look for a friend') :
        this.step === 'dribble' ? 'Tap an arrow' :
        this.seen.size ? 'Pass or dribble?' : this.lookUp ? 'Drag to look around' : 'Tap 👀 to look up';
    }
    // The only nudge: if he hasn't looked up after a while, pulse LOOK. Never point at the answer.
    const nudge = this.canAct && !this.lookUp && (this.locked || (!this.seen.size && s.time - this.decideAt > 5)) ? 'look' : null;
    hud.state({ phase: this.phase, step: this.step, mode: this.mode, prompt, nudge, lookUp: this.lookUp, look: this.look, locked: this.locked, kind: this.sc?.kind || 'attack', touchPick: !!this.pendingDir, canShoot: (this.canAct || this.showing) && this.canShoot, showing: !!this.showing });
    // The teaching hand follows its target (a spot on the field moves on screen as the camera moves).
    const at = this.handAt, cv = this.world.canvas;
    const pos = !at ? null : typeof at === 'string' ? at : at.sx != null ? [at.sx * cv.clientWidth, at.sy * cv.clientHeight] : this.world.project(at.x, at.y, at.z ?? 0);
    const key = at ? JSON.stringify(pos) + this.handTap : '';
    if (key !== this.handKey) { this.handKey = key; hud.hand(pos, this.handTap); }
    const glow = {}, arrows = {};
    if (this.phase === 'decide' && this.step === 'pass') for (const id of this.seen) glow[id] = .8;
    if (this.phase === 'decide' && this.step === 'dribble') for (const d of Object.keys(DRIBBLE_DIRS)) arrows[d] = !this.pendingDir || this.pendingDir === d ? 1 : .3;

    const spots = this.phase === 'decide' && this.step === 'spot' ? this.sc.spots : [];
    const loose = this.sc?.kind === 'tackle' && ((this.step === 'tackle' && this.hint) || (this.phase === 'outcome' && !this.result)) && this.tackleState() === 'good';
    const turnArrows = this.phase === 'decide' && this.step === 'turn' ? this.turnArcs() : [];
    this.ui = { glow, arrows, spots, lines: this.lines, heroRing: this.camMode === 'player', ballGlow: loose, turnArrows };
  }
}
