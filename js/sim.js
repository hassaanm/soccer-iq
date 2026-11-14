// Tiny match simulation: players walk toward targets, the ball is carried or flying,
// and outcomes run as generator scripts that yield seconds or "wait until" predicates.
import { lerp } from './geom.js';

const SPACE = .75; // meters between two players' centers
const TURN = 9;            // radians per second a player can turn
// Turn a player's facing toward (fx, fy) at a limited speed, so direction changes look like real turns.
function turnToward(a, fx, fy, dt) {
  const cur = Math.atan2(a.face[1], a.face[0]), want = Math.atan2(fy, fx);
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), step = Math.max(-TURN * dt, Math.min(TURN * dt, d));
  a.face[0] = Math.cos(cur + step); a.face[1] = Math.sin(cur + step); // every player has his own `face` list, so it is changed in place
}
const SIDE = [0, .14, -.14]; // how far a dribble touch sits to the side: laces / inside / outside
// How far along his dribble he is: touches come every 1.4 m of his run, counted from `d0` (set when he gets the ball or
// ends a turn, so the dribble starts from where the ball really is). pro/motion.js times his feet by the same count.
export const dribbleAt = a => a.dist - (a.d0 || 0);
// Starts his dribble count so the ball's spot (sim step: .34 m ahead, plus up to .55 m more just after a touch at a run)
// is where the ball is now, `r` metres from him.
const rephase = (a, r) => { const run = Math.min(1, a.sp / 2.5), k = run > .05 ? Math.max(0, Math.min(.95, 1 - (r - .34) / (.55 * run))) : 0; a.d0 = a.dist - k * 1.4; };
const REACH = .8, CLOSE = .5; // a ball farther than REACH from his middle is out of reach of his feet; within CLOSE it is at his feet
const ang = (x, y) => Math.atan2(y, x), wrapA = a => Math.atan2(Math.sin(a), Math.cos(a)), sm = t => (t = Math.max(0, Math.min(1, t)), t * t * (3 - 2 * t));

// Turning with the ball. The ball sits on a line out from his feet (ball.h); it only changes line when a foot moves it,
// so it never swings round him. A turn is one of the moves coaches teach, picked by its size:
//   push  up to 45°: the inside or outside of a foot pushes it onto the new line
//   cut   to 120°: the inside of the far foot, or the outside of the near foot, cuts it across, and the body follows
//   hook  more: the inside of the far foot reaches round the ball and hooks it back, or
//   pull  (a defender in front): the sole drags it back, he spins, and the other foot takes it on
//   first taking a pass and turning at once: the far foot takes it across his body as he turns
//   gather a ball he took standing that is not quite at his feet: his sole rolls it in
// Each touch: [start, end] (parts of the move), leg (1 his left, 0 his right), part of the foot, the end point (metres
// ahead and to the left of the way he faced as the move began), the part of the touch the foot stays on the ball (a cut
// or a hook guides it all the way onto the new line, so it never bends after the foot leaves it), and
// a point the ball curves round (or none). He nearly stops while the foot works, then runs on (`run`: he goes on after the turn).
function plan(k, d, s, P, alt, run) {
  const T = s > 0 ? 1 : 0, O = 1 - T, e = r => [Math.cos(d) * r * (run ? 1 : .72), Math.sin(d) * r * (run ? 1 : .72)]; // turning on the spot, the ball stays closer
  if (k === 'gather') return { dur: .45, face: [0, .6], slow: 0, t: [[.05, .62, alt, 'sole', [.36, 0], 1]] }; // standing: the sole rolls it in to his feet
  if (k === 'push') return { dur: .32, face: [0, .7], slow: .85, t: [[.05, .55, alt ? T : O, alt ? 'outside' : 'inside', e(.55), .4]] };
  if (k === 'cut') return { dur: .5, face: [.15, .85], slow: .3, t: [[.25, .72, alt ? T : O, alt ? 'outside' : 'inside', e(.5), 1]] };
  if (k === 'hook') return { dur: .62, face: [.3, .95], slow: .12, t: [[.2, .8, O, 'inside', e(.5), 1, [Math.max(.3, P[0]), s * .55]]] };
  if (k === 'pull') return { dur: .74, face: [.36, .74], slow: .06, t: [[.04, .4, T, 'sole', [-.26, s * .07], 1], [.4, .56, T, 'sole', [-.26, s * .07], 1], [.66, .9, O, 'inside', e(.55), .4]] }; // drag it back, keep the sole on it as he spins, then the other foot takes it on
  return { dur: .56, face: [0, .78], slow: .2, t: [[.04, .7, O, 'inside', e(.5), 1, [.12, s * .4]]] }; // first
}
// Skill turns: now and then a turn is made as a skill move instead (see pickSkill). It keeps the plain turn's time, its
// slowing down and its body turn (and `last`, when he speeds up again), so he is where the plain turn puts him, when
// it puts him there, and the ball ends on the same spot. Where other players react to the ball (the team AI is on)
// the ball also takes the plain turn's way exactly (`path`: the plain turn's touches move the ball, the skill's
// touches say which foot is on it); elsewhere (`own`) the skill takes the ball its own way: a longer fake, then the touch.
//   chop     (for a cut): he shapes to shoot with the far foot, then its inside chops the ball across instead
//   roll     (for a cut from standing, a walk or a jog): the sole of the far foot rolls the ball across his body
//   cruyff   (for a hook, or with its own way a pull back): he shapes to pass with the far foot, then its inside drags
//            the ball back behind his standing leg and he spins after it
//   croqueta (a push past a defender close in front, its own way): the inside of the far foot knocks it across to the
//            inside of the other foot, which pushes it on
//   double   (the same push on the plain way): two quick touches across his body, the inside of the far foot, then
//            the outside of the near foot
const SKILL_T = { push: ['croqueta'], cut: ['chop', 'roll'], hook: ['cruyff'], pull: ['cruyff'] };
export const TURN_SKILLS = new Set(['croqueta', 'double', 'chop', 'roll', 'cruyff']);
function skillPlan(k, base, s, P, own) {
  const T = s > 0 ? 1 : 0, O = 1 - T, E = base.t[base.t.length - 1][4], t = base.t[0], out = { ...base, last: base.t[base.t.length - 1][0] }; // E: where the plain turn leaves the ball
  if (!own) out.path = base.t;
  if (k === 'croqueta') out.t = [[.02, .42, O, 'inside', [Math.max(.2, P[0] - .14), s * .3], 1], [.5, .92, T, 'inside', E, .5]];
  else if (k === 'double') out.t = [[.05, .28, O, 'inside', E, 1], [.3, .55, T, 'outside', E, .4]];
  else if (k === 'chop') out.t = [own ? [.4, .92, O, 'inside', E, 1] : [t[0], t[1], O, 'inside', E, 1]];
  else if (k === 'roll') out.t = [own ? [.08, .72, O, 'sole', E, 1, [Math.max(.25, P[0]), s * .22]] : [t[0], t[1], O, 'sole', E, 1]];
  else out.t = [own ? [.38, .84, O, 'inside', E, 1, [.04, s * .3]] : t]; // cruyff: behind the standing leg (T, planted beside the ball)
  return out;
}
// A number from 0 to 1 that is the same whenever the same things go in: a replay of a play makes the same choices.
const rnd = (...v) => { let h = 2166136261; for (const x of v) h = Math.imul(h ^ Math.round(x), 16777619); h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const idn = id => [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
// The skill he is doing now, for the picture (pro/motion.js): its kind, how far through it he is (c: a dribble skill
// runs over one dribble touch, 0 to 1 at the touch that takes the ball away, then a little past it; a skill turn is
// its part of the move, as in plan), the side he fakes to (+1 his left, as he faced when it began), that facing (yaw)
// and the fake's way on the grass (fx, fy). null when none.
const SK = { k: '', c: 0, fake: 0, yaw: 0, fx: 0, fy: 0, at: 0 };
export function skillNow(sim, id) {
  const a = sim.a(id), b = sim.ball; if (!a || b.carrier !== id || b.state !== 'carried') return null;
  const m = b.move;
  if (m && TURN_SKILLS.has(m.k)) { SK.k = m.k; SK.c = (sim.time - m.t0) / m.dur; SK.fake = -m.s; SK.yaw = m.a0; SK.at = m.t[0][0]; }
  else if (a.skill && !m) { SK.k = a.skill.k; SK.c = dribbleAt(a) / 1.4 - a.skill.n; SK.fake = a.skill.fake; SK.yaw = a.skill.yaw; SK.at = .5; }
  else return null;
  SK.fx = -Math.sin(SK.yaw) * SK.fake; SK.fy = Math.cos(SK.yaw) * SK.fake;
  return SK;
}
// Which way he turns (+1 to his left) from the ball's line `h` to `want`: the short way, but nearly straight back he
// turns away from a player of the other team close by. Also used by the picture to ready the foot for a pass he will turn with.
export function turnSide(sim, c, h, want) {
  const d = wrapA(want - h); if (Math.abs(d) <= 2.6) return Math.sign(d) || 1;
  const o = nearFoe(sim, c), ol = o ? (o.y - c.y) * Math.cos(h) - (o.x - c.x) * Math.sin(h) : 0;
  return o && Math.abs(ol) > .2 ? -Math.sign(ol) : Math.sign(d) || 1;
}
const nearFoe = (sim, c, r = 4) => { let near = null; for (const o of sim.agents.values()) { const q = Math.hypot(o.x - c.x, o.y - c.y); if (o.team !== c.team && q < r) { r = q; near = o; } } return near; };
// Where the ball is at part `u` of move `m`: metres ahead and to the left of the way he faced as it began.
const BP = [0, 0];
function ballAt(m, u) {
  let fx = m.P[0], fy = m.P[1];
  for (const t of m.path || m.t) {
    if (u <= t[0]) break;
    const [ex, ey] = t[4], v = t[6], q = Math.min(1, (u - t[0]) / (t[1] - t[0])), e = t[3] === 'sole' || v ? sm(q) : 1 - (1 - q) * (1 - q); // pushed: fast off the foot, then slowing; dragged or swept round: smooth
    if (v) { const a = (1 - e) * (1 - e), b = 2 * e * (1 - e), c = e * e; fx = a * fx + b * v[0] + c * ex; fy = a * fy + b * v[1] + c * ey; }
    else { fx += (ex - fx) * e; fy += (ey - fy) * e; }
  }
  BP[0] = fx; BP[1] = fy; return BP;
}
// The foot on the ball in a turn, for the picture (pro/motion.js): leg, part, how much it is on (0 to 1) and the way
// it moves the ball (a unit vector on the grass), and `pre` (1 while it is still on its way). null when no foot is busy.
const TF = { leg: 0, part: '', w: 0, pre: 0, dx: 1, dy: 0 };
export function turnFoot(sim, id) {
  const b = sim.ball, m = b.move; if (!m || b.carrier !== id) return null;
  const u = (sim.time - m.t0) / m.dur, r = .13 / m.dur; let best = null, bw = 0;
  for (const t of m.t) {
    const hold = t[0] + (t[1] - t[0]) * t[5], w = sm((u - t[0] + r) / r) * (1 - sm((u - hold) / r));
    if (w > bw) { bw = w; best = t; }
  }
  if (!best) return null;
  // the ball's way at this moment of the touch (or at its start, while the foot comes to it)
  const q = Math.max(best[0] + .02, Math.min(best[1] - .02, u)), p0 = [...ballAt(m, q - .01)], p1 = ballAt(m, q + .01);
  const lx = p1[0] - p0[0], ly = p1[1] - p0[1], l = Math.hypot(lx, ly) || 1, c = Math.cos(m.a0), s = Math.sin(m.a0);
  TF.leg = best[2]; TF.part = best[3]; TF.w = bw; TF.pre = 1 - sm((u - best[0] + r * .3) / (r * .3)); TF.dx = (lx * c - ly * s) / l; TF.dy = (lx * s + ly * c) / l;
  return TF;
}

export class Sim {
  constructor() { this.agents = new Map(); this.list = []; this.ball = {}; this.co = null; this.time = 0; this.restores = 0; this.on = () => {}; this.flair = null; this.skillLog = null; } // on(event, data): 'kick', 'touch', 'step'
  // flair: who may use a skill move now, set by the game's play scripts ({ ctx: what part of the play, by: { id: flairOf(...) } },
  // see flair.js), or null for none. skillLog: a list to note every chance in (for the counts), or null.

  // Builds players for a scenario. Ids: hero, m1, m2 (our team), o1..o3 (them).
  setup(sc) {
    this.agents.clear();
    const add = (id, team, [x, y]) => this.agents.set(id, { id, team, x, y, tx: x, ty: y, speed: 0, sp: 0, dist: 0, kickAt: null, kickFoot: null, face: [team === 'us' ? 1 : -1, 0] });
    add('hero', 'us', sc.hero);
    sc.mates.forEach((p, i) => add('m' + (i + 1), 'us', p));
    sc.opps.forEach((p, i) => add('o' + (i + 1), 'them', p));
    const c = this.a(sc.carrier || 'hero'); // in defense lessons the other team starts with the ball
    this.ball = { x: c.x + c.face[0] * .5, y: c.y, z: 0, state: 'carried', carrier: c.id, h: ang(c.face[0], c.face[1]), move: null, got: -9 };
    this.co = null; this.wait = 0; this.until = null;
  }

  // Snapshot / restore so a play can be replayed from the decision moment.
  save() { return { agents: [...this.agents.values()].map(a => ({ ...a, face: [...a.face] })), ball: { ...this.ball } }; }
  restore(s) {
    this.agents.clear();
    for (const a of s.agents) this.agents.set(a.id, { ...a, face: [...a.face], tx: a.x, ty: a.y, speed: 0, sp: 0 });
    this.ball = { ...s.ball, move: null, reach: s.ball.reach && { ...s.ball.reach } }; this.co = null; this.wait = 0; this.until = null;
    this.restores++; // the picture starts each player's motion afresh (see pro/motion.js)
  }

  a(id) { return this.agents.get(id); }
  team(t) { const out = []; for (const a of this.agents.values()) if (a.team === t) out.push(a); return out; }
  go(id, x, y, speed = 4) { const a = this.a(id); a.tx = x; a.ty = y; a.speed = speed; if (this.ball.reach && this.ball.carrier === id) this.ball.reach.stop = false; }
  stop(id) { const a = this.a(id); a.tx = a.x; a.ty = a.y; if (this.ball.reach && this.ball.carrier === id) this.ball.reach.stop = true; }
  stopAll() { for (const a of this.agents.values()) { a.tx = a.x; a.ty = a.y; } if (this.ball.reach) this.ball.reach.stop = true; }
  // He has the ball: it stays on its line out from his feet until a foot moves it. A pass he takes counts as "just
  // arrived" for a moment, so a turn straight away is taken as one move with the first touch. A ball out of his reach
  // (a steal, a tackle, a ball he runs onto) stays where it is until he gets to it (ball.reach), then his foot takes it.
  give(id) {
    const b = this.ball, a = this.a(id), dx = b.x - a.x, dy = b.y - a.y, r = Math.hypot(dx, dy);
    if (b.state !== 'carried') b.got = this.time;
    a.open = null; rephase(a, r);
    Object.assign(b, { state: 'carried', carrier: id, z: 0, move: null, h: Math.hypot(dx, dy) > .15 ? ang(dx, dy) : ang(a.face[0], a.face[1]),
      reach: r > CLOSE ? { stop: !(a.speed > 0 && Math.hypot(a.tx - a.x, a.ty - a.y) > .02) } : null });
  }
  // A pass is on its way to him and he will turn with it toward (x, y): he opens his body that way as it comes (and
  // the picture readies the foot the turn uses). It ends when he gets the ball.
  open(id, x, y) { const a = this.a(id); if (a) a.open = ang(x - a.x, y - a.y); }
  // Turns the player with the ball toward (x, y) with a real move (see plan) when the ball's line is more than `min`
  // (radians) off. Returns how long it takes (0: no turn needed).
  turn(id, x, y, min = .35) { const a = this.a(id); return this.ball.carrier === id && this.ball.state === 'carried' ? this.startTurn(a, ang(x - a.x, y - a.y), min) : 0; }
  startTurn(c, want, min = .35, kind = null) {
    const b = this.ball; let d = wrapA(want - b.h);
    if (Math.abs(d) < min) return 0;
    const ad = Math.abs(d), dx = b.x - c.x, dy = b.y - c.y, ch = Math.cos(b.h), sh = Math.sin(b.h), s = turnSide(this, c, b.h, want);
    if (ad > 2.6 && Math.sign(d) !== s) d += s * 2 * Math.PI; // nearly straight back: the long way round, away from a defender
    const near = nearFoe(this, c, 3.5), ahead = near && (near.x - c.x) * ch + (near.y - c.y) * sh > .2; // a defender close in front: pull it back away from him
    let k = kind || (this.time - b.got < .5 && ad > 1.2 ? 'first' : ad < .8 ? 'push' : ad < 2.1 ? 'cut' : ahead ? 'pull' : 'hook');
    const P = [dx * ch + dy * sh, dy * ch - dx * sh], run = c.speed > 0 && Math.hypot(c.tx - c.x, c.ty - c.y) > .5, f0 = ang(c.face[0], c.face[1]);
    let m = plan(k, d, s, P, Math.floor(c.dist / .7) & 1, run);
    // A skill turn instead, now and then: only for a turn he chose to make (not taking a loose ball onto his run) with a
    // defender near (a push: close in front of him, and turning enough to need it).
    const own = this.flair?.own, foe = !kind && min >= 0 && SKILL_T[k] && this.flair?.by[c.id] && nearFoe(this, c, k === 'push' ? 3.5 : 5);
    if (foe && (k !== 'push' || (ad > .45 && (foe.x - c.x) * ch + (foe.y - c.y) * sh > .5)) && (k !== 'pull' || own)) {
      const sk = this.pickSkill(c, k === 'push' && !own ? ['double'] : SKILL_T[k].filter(x => x !== 'roll' || c.sp < 2.6), 'turn');
      if (sk) { m = skillPlan(sk, m, s, P, own); k = sk; c.skill = null; }
    }
    let fd = wrapA(want - f0); if (Math.abs(fd) > 1.6 && Math.sign(fd) !== s) fd += s * 2 * Math.PI; // the body turns the same way round as the ball
    b.move = { k, t0: this.time, a0: b.h, d, s, P, f0, fd, ...m };
    this.on('touch');
    return m.dur;
  }
  // A chance for a skill move for `c` (one of `kinds` that he can do, see flair.js): he takes it as often as his flair
  // says, and the choice is the same whenever the play is replayed (it comes from where he is). At most one chance
  // every 3 s, taken or not, so he never does two skills close together. Returns the move, or null.
  pickSkill(c, kinds, sit) {
    const f = this.flair?.by[c.id], w = f && kinds.map(k => f.fav.includes(k) ? 4 : f.can.includes(k) ? 1 : 0), all = w ? w.reduce((p, q) => p + q, 0) : 0;
    if (!all || this.time - (c.skT ?? -9) < 3) return null; // none he can do here, or one too soon
    c.skT = this.time;
    const r = rnd(c.x * 20, c.y * 20, c.dist * 20, idn(c.id));
    let k = null, q = rnd(r * 1e6, 17) * all;
    if (r < f.p) for (let i = 0; i < kinds.length && !k; i++) if ((q -= w[i]) < 0) k = kinds[i];
    this.skillLog?.push(`${k || '-'}|${this.flair.ctx}|${sit}|${f.tier}|${c.id}`);
    return k;
  }
  // Running at a defender with the ball (2 to 5 m in front of him, about in his way) and a touch just made: a chance
  // to sell a fake before the next touch, which takes the ball the other way. Only when that next touch goes to one
  // side (the dribble's touches go on, left, right), and he must be running. The ball's way is not changed: the next
  // touch is the dribble's own. A stepover or a body feint fits one touch even at a sprint; the scissors (two
  // stepovers) only when he is slower.
  dribbleSkill(a) {
    const b = this.ball; if (!this.flair?.by[a.id] || a.sp < 1.8 || (a.kickAt != null && this.time - a.kickAt < .7)) return;
    const n = Math.floor(dribbleAt(a) / 1.4), side = Math.sign(SIDE[(n + 1) % 3]); if (!side) return;
    const ch = Math.cos(b.h), sh = Math.sin(b.h);
    let foe = null; for (const o of this.agents.values()) { const f = (o.x - a.x) * ch + (o.y - a.y) * sh, l = (o.y - a.y) * ch - (o.x - a.x) * sh; if (o.team !== a.team && f > 1.6 && f < 5 && Math.abs(l) < 1.8) foe = o; }
    if (!foe) return;
    const k = this.pickSkill(a, a.sp < 4.6 ? ['stepover', 'feint', 'scissors'] : ['stepover', 'feint'], 'run-at');
    if (k) a.skill = { k, n, fake: -side, yaw: b.h };
  }
  // Starts the kick animation; call it a moment before kick() so the foot meets the ball.
  // kind: 'pass' (inside of the foot) or 'shot' (laces); foot: 1 his left, 0 his right (game/outcomes.js picks it), or
  // null to let the picture pick the foot nearer the ball.
  windup(id, kind = 'pass', foot = null) { const a = this.a(id); if (a) { a.kickAt = this.time; a.kickKind = kind; a.kickFoot = foot; if (this.ball.carrier === id && this.ball.move) { const b = this.ball; b.move = null; b.h = ang(b.x - a.x, b.y - a.y); } } } // a kick ends a turn: the ball stays where it is
  kick(x, y, { speed = 11, arc = 0.3, z1 = 0, touch = false } = {}) {
    const b = this.ball;
    // A pass to a player stops at his feet, a small step in front of him, so he can take it with a foot (not in his middle).
    if (!touch) for (const a of this.agents.values()) if (a.id !== b.carrier && Math.min(Math.hypot(a.x - x, a.y - y), Math.hypot(a.tx - x, a.ty - y)) < .25) {
      const dx = b.x - x, dy = b.y - y, l = Math.hypot(dx, dy); if (l > 1.5) { x += dx / l * .4; y += dy / l * .4; } break;
    }
    this.on(touch ? 'touch' : 'kick', speed);
    Object.assign(b, { state: 'flying', carrier: null, move: null, fx: b.x, fy: b.y, tx: x, ty: y, t: 0, arc, z1,
      dur: Math.max(0.25, Math.hypot(x - b.x, y - b.y) / speed) });
  }
  run(gen) { this.co = gen; this.wait = 0; this.until = null; }

  step(dt) {
    this.time += dt;
    const b = this.ball;
    for (const a of this.agents.values()) {
      const has = b.state === 'carried' && b.carrier === a.id, fetch = has && b.reach; // his ball, out of reach: he goes to it first
      if (a.skill && (!has || b.move || b.reach || (a.kickAt != null && this.time - a.kickAt < .7) || dribbleAt(a) / 1.4 - a.skill.n > 1.4)) a.skill = null; // a dribble skill ends a little after its touch, or when anything else starts
      let dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (fetch) {
        const bx = b.x - a.x, by = b.y - a.y, bd = Math.hypot(bx, by);
        if (bd < REACH - .1) { // in reach: a foot takes it, onto the way he goes, or (standing) in to his feet
          b.reach = null; b.h = ang(bx, by); rephase(a, bd); if (fetch.stop) { a.tx = a.x; a.ty = a.y; d = 0; }
          if (d > .02 && a.speed > 0) this.startTurn(a, ang(dx, dy), -1); else this.startTurn(a, b.h, -1, 'gather');
        } else { d = bd - (REACH - .15); dx = bx / bd * d; dy = by / bd * d; a.speed = Math.max(a.speed, 3); }
      }
      // With the ball, a run that leaves the ball's line starts a turn first (see plan).
      if (has && !b.move && !b.reach && d > 0.02 && a.speed > 0 && (a.kickAt == null || this.time - a.kickAt > .5)) {
        if (a.sp < .3) a.d0 = a.dist; // setting off from standing: his first step is a touch that pushes the ball on
        this.startTurn(a, ang(dx, dy));
      }
      const m = has ? b.move : null, u = m ? (this.time - m.t0) / m.dur : 0, last = m ? m.last ?? m.t[m.t.length - 1][0] : 0;
      const sp = m ? a.speed * (u < last ? m.slow : m.slow + (1 - m.slow) * sm((u - last) / (1 - last))) : a.speed; // nearly still while a foot turns the ball
      if (d > 0.02 && a.speed > 0) {
        if (m) a.sp = lerp(a.sp, sp, Math.min(1, dt * 10)); // he brakes into the turn and runs out of it
        const s = Math.min((m ? a.sp : sp) * dt, d);
        const before = a.dist; a.x += dx / d * s; a.y += dy / d * s; if (!m) turnToward(a, dx / d, dy / d, dt); a.dist += s;
        if (a.id === 'hero' && Math.floor(a.dist / .7) > Math.floor(before / .7)) this.on('step');
        if (has && !m && !b.reach && Math.floor((a.dist - (a.d0 || 0)) / 1.4) > Math.floor((before - (a.d0 || 0)) / 1.4)) { this.on('touch'); b.h = ang(dx, dy); if (!a.skill) this.dribbleSkill(a); } // each dribble touch puts the ball on the way he runs
        if (!m) a.sp = lerp(a.sp, sp, Math.min(1, dt * 8));
      } else a.sp = lerp(a.sp, 0, Math.min(1, dt * 8));
      if (m) { const f = m.f0 + m.fd * sm((u - m.face[0]) / (m.face[1] - m.face[0])); a.face[0] = Math.cos(f); a.face[1] = Math.sin(f); } // the body turns with the move
    }
    // Bodies take up space: nudge apart any two players closer than SPACE so nobody walks through anyone.
    const list = this.list; list.length = 0; for (const a of this.agents.values()) list.push(a); // one list, filled again each step
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d < SPACE && d > 1e-6) { const push = (SPACE - d) / 2; p.x -= dx / d * push; p.y -= dy / d * push; q.x += dx / d * push; q.y += dy / d * push; }
    }
    if (b.state === 'carried' && b.move) {
      // A turn: the ball goes where the foot sends it (see plan), from where it was as the move began.
      const c = this.a(b.carrier), m = b.move, u = (this.time - m.t0) / m.dur;
      if (u >= 1) { b.h = m.a0 + m.d; b.move = null; rephase(c, Math.hypot(b.x - c.x, b.y - c.y)); } // the dribble goes on from where the ball is
      const p = ballAt(m, Math.min(1, u)), cs = Math.cos(m.a0), sn = Math.sin(m.a0);
      b.x = c.x + p[0] * cs - p[1] * sn; b.y = c.y + p[0] * sn + p[1] * cs; b.z = 0;
      if (m.t.some(t => u >= t[0] && u - dt / m.dur < t[0] && t !== m.t[0])) this.on('touch');
    } else if (b.state === 'carried' && !b.reach) {
      // Dribbling: each touch (every 1.4 m, matching world.js) pushes the ball ahead, then the player
      // catches up. Touches cycle laces / inside / outside, nudging the ball sideways a little. The ball stays on its
      // line (ball.h): when he turns his body standing still, it stays where it is.
      const c = this.a(b.carrier), run = Math.min(1, c.sp / 2.5), n = dribbleAt(c) / 1.4, k = n - Math.floor(n), kind = ((Math.floor(n) % 3) + 3) % 3;
      const ahead = .34 + run * .55 * (1 - k), side = run * SIDE[kind] * (1 - k), hx = Math.cos(b.h), hy = Math.sin(b.h);
      // The ball rolls toward its spot at his feet instead of jumping there.
      const wx = c.x + hx * ahead - hy * side, wy = c.y + hy * ahead + hx * side, roll = Math.min(1, dt * 14);
      b.x += (wx - b.x) * roll; b.y += (wy - b.y) * roll; b.z = 0;
    } else if (b.state === 'flying') {
      b.t += dt / b.dur;
      const u = Math.min(1, b.t), e = 1 - Math.pow(1 - u, 1.5);
      b.x = lerp(b.fx, b.tx, e); b.y = lerp(b.fy, b.ty, e); b.z = b.arc * 4 * u * (1 - u) + b.z1 * u;
      if (u >= 1) b.state = 'loose';
    }
    // Players standing still turn to watch the ball. One who will turn with a pass to him opens his body that way a little.
    for (const a of this.agents.values()) {
      if (a.sp < 0.3 && b.carrier !== a.id) {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
        if (a.open != null && b.state === 'flying') { const h = ang(dx, dy), f = h + turnSide(this, a, h, a.open) * Math.min(.75, Math.abs(wrapA(a.open - h))); turnToward(a, Math.cos(f), Math.sin(f), dt * .5); }
        else if (l > 0.3) turnToward(a, dx / l, dy / l, dt);
      }
    }
    if (!this.co) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    if (this.until && !this.until()) return;
    this.until = null;
    const r = this.co.next();
    if (r.done) this.co = null;
    else if (typeof r.value === 'number') this.wait = r.value;
    else if (typeof r.value === 'function') this.until = r.value;
  }
}
