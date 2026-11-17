// Tiny match simulation: players walk toward targets, the ball is carried or flying,
// and outcomes run as generator scripts that yield seconds or "wait until" predicates.
import { lerp, PITCH } from './geom.js';
import { MOVE_W } from './flair.js';

const SPACE = .75; // meters between two players' centers
const EASE = 3.5;   // m/s² a child speeds up or slows down at (v64 research Q1; window.js ACC)
// From a walk he changes it at MOM_A; the faster he is going, the harder he can push off (up to MOM_MAX), but never so
// hard that he is going back the way he came within the first 0.6 s: over that time his net way is still the old one.
const MOM_T = 1.2, MOM_A = 3, MOM_MAX = 7.7; // (v66) how long a player carries his velocity on out of a planned way, and how fast it changes (m/s²)
const TURN = 9;            // radians per second a player can turn
// Turn a player's facing toward (fx, fy) at a limited speed, so direction changes look like real turns.
function turnToward(a, fx, fy, dt) {
  const cur = Math.atan2(a.face[1], a.face[0]), want = Math.atan2(fy, fx);
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), step = Math.max(-TURN * dt, Math.min(TURN * dt, d));
  a.face[0] = Math.cos(cur + step); a.face[1] = Math.sin(cur + step); // every player has his own `face` list, so it is changed in place
}
const SIDE = [0, .14, -.14]; // how far a dribble touch sits to the side: laces / inside / outside
// How far along his dribble he is: metres of his run counted from `d0` (set when he gets the ball or ends a turn, so the
// dribble starts from where the ball really is). His run is cut into touches: the a.tN-th started a.tA metres in and
// takes the ball a.tL metres of his run on (see touchLen: 1.4 m close in, more in open space at speed). touchAt: how
// many touches along he is, with the part of the way to the next (0 to 1). pro/motion.js times his feet by the same count.
export const dribbleAt = a => a.dist - (a.d0 || 0);
export const touchAt = a => (a.tN || 0) + (dribbleAt(a) - (a.tA || 0)) / (a.tL || 1.4);
const restart = (a, k = 0) => { a.d0 = a.dist - k * 1.4; a.tA = 0; a.tL = 1.4; a.tN = 0; };
// Starts his dribble count so the ball's spot (sim step: .34 m ahead, plus up to .55 m more just after a touch at a run)
// is where the ball is now, `r` metres from him.
const rephase = (a, r) => { const run = Math.min(1, a.sp / 2.5), k = run > .05 ? Math.max(0, Math.min(.95, 1 - (r - .34) / (.55 * run))) : 0; restart(a, k); };
// How far his next touch takes the ball (metres of his run until the touch after). Close control, 1.4 m: at a jog
// (3.5 m/s or less), within 4 m of anyone of the other team or 3 m of the way the ball would go, near the goal he attacks (where he may shoot), near the end of
// his run (so the ball is at his feet when he stops or turns). In open space at speed he pushes it ahead and runs onto
// it, farther the faster he goes: about 2.8 m at 4.4 m/s, 4 m from 5.1 m/s. (Nothing else counts, so a skill move,
// tapped for or not, never changes where the ball goes. sim.close: close control always, for tests of the touch itself.)
const LONG = 4.1;
export function touchLen(sim, a) {
  if (sim.close || a.sp <= 3.5) return 1.4;
  const L = Math.min(LONG, 1.4 + (a.sp - 3.5) * 1.6);
  const ch = Math.cos(sim.ball.h), sh = Math.sin(sim.ball.h);
  for (const o of sim.agents.values()) if (o.team !== a.team) { // anyone of theirs close by, or near the way the ball would go
    const f = Math.max(0, Math.min(L + 1, (o.x - a.x) * ch + (o.y - a.y) * sh)), px = a.x + ch * f, py = a.y + sh * f;
    if (Math.hypot(o.x - a.x, o.y - a.y) < 4 || Math.hypot(o.x - px, o.y - py) < 3) return 1.4;
  }
  if (Math.hypot((a.team === 'us' ? PITCH.L : 0) - a.x, PITCH.W / 2 - a.y) < 12 || Math.hypot(a.tx - a.x, a.ty - a.y) < L + 1.2) return 1.4;
  return L;
}
// (A long touch pushes the ball straight on, with the laces: the sideways nudges are for close control.)
// The ball's extra lead (metres) in a long touch at part k of it: it leaves the foot quickly, gets as far as .45 m for
// each metre over 1.4 m of the touch (about .65 m at 2.8 m, 1.2 m at 4.1 m) about a third of the way, and he catches up.
export const longLead = (L, k) => { if (L <= 1.4) return 0; const u = 1 - k; return (L - 1.4) * .45 / .4725 * (u - u * u * u * u); };
const HAND = 3.2, BALL_LOW = .12; // a keeper's hands with the ball (m/s); the ball's height as he bowls it along the grass
const OFFER_END = -.3; // a skill offer (see Sim.taps) closes this far before its move starts (in dribble touches), so the move has a moment to set up
const REACH = .8, CLOSE = .5; // a ball farther than REACH from his middle is out of reach of his feet; within CLOSE it is at his feet
// The part of the gap that closes in `dt` seconds, for something that closes `k`/30 of it every 1/30 s: the same
// motion at any frame rate (it was `min(1, dt * k)`, which is the same at 30 fps, the rate the tests and audits run at,
// and faster or slower at others).
const ease = (dt, k) => 1 - Math.pow(1 - k / 30, dt * 30);
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
  else if (k === 'double') { const a = own ? .05 : t[0], b = own ? .55 : t[1], h = (a + b) / 2; out.t = [[a, h - .02, O, 'inside', E, 1], [h, b, T, 'outside', E, .4]]; } // on the plain way: the two touches split the plain touch's time, while the ball moves
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
const SK = { k: '', c: 0, fake: 0, yaw: 0, fx: 0, fy: 0, at: 0, tap: -9 }; // tap: when the child tapped for it (sim time; see Sim.take), else long ago
export function skillNow(sim, id) {
  const a = sim.a(id), b = sim.ball; if (!a || b.carrier !== id || b.state !== 'carried') return null;
  const m = b.move;
  if (m && TURN_SKILLS.has(m.k)) { SK.k = m.k; SK.c = (sim.time - m.t0) / m.dur; SK.fake = -m.s; SK.yaw = m.a0; SK.at = m.t[0][0]; SK.tap = -9; }
  else if (a.skill && !m) { SK.k = a.skill.k; SK.c = touchAt(a) - a.skill.n; SK.fake = a.skill.fake; SK.yaw = a.skill.yaw; SK.at = .5; SK.tap = a.skill.tap ?? -9; }
  else return null;
  SK.fx = -Math.sin(SK.yaw) * SK.fake; SK.fy = Math.cos(SK.yaw) * SK.fake;
  return SK;
}
// Which way he turns (+1 to his left) from the ball's line `h` to `want`: the way he was told (c.openS, see Sim.open),
// else the short way, but nearly straight back he turns away from a player of the other team close by. Also used by
// the picture to ready the foot for a pass he will turn with.
export function turnSide(sim, c, h, want) {
  if (c.openS) return c.openS;
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
  let lx = p1[0] - p0[0], ly = p1[1] - p0[1]; if (Math.hypot(lx, ly) < 1e-5) { lx = best[4][0] - p0[0]; ly = best[4][1] - p0[1]; } // (the ball not moving yet: the way the touch will send it)
  const l = Math.hypot(lx, ly) || 1, c = Math.cos(m.a0), s = Math.sin(m.a0);
  TF.leg = best[2]; TF.part = best[3]; TF.w = bw; TF.pre = 1 - sm((u - best[0] + r * .3) / (r * .3)); TF.dx = (lx * c - ly * s) / l; TF.dy = (lx * s + ly * c) / l;
  return TF;
}

export class Sim {
  constructor() { this.agents = new Map(); this.list = []; this.ball = {}; this.co = null; this.time = 0; this.restores = 0; this.on = () => {}; this.flair = null; this.skillLog = null; this.taps = null; this.offerOK = false; } // on(event, data): 'kick', 'touch', 'step'
  // flair: who may use a skill move now, set by the game's play scripts ({ ctx: what part of the play, by: { id: flairOf(...) } },
  // see flair.js), or null for none. skillLog: a list to note every chance in (for the counts), or null.
  // taps: the players whose skill moves wait for a tap (the child's player in the real game; null in the tests and
  // audits, where every chance is taken by itself). For such a player a run-at chance two touches ahead becomes an
  // offer (a.offer, see dribbleSkill) while `offerOK` (set by the game) allows one, and the move happens only if take()
  // comes in time. A skill turn starts the moment the turn does, so the game asks for it ahead (turnAhead) while play
  // stands still, and sets a.turnTap to the move when the child taps; without it his turns are plain.

  // Builds players for a scenario. Ids: hero, m1, m2 (m3) (our team), o1..o3 (o4) (them), and with keepers (5v5,
  // sc.gk) k1 (ours, in the goal at x = 0) and k2 (theirs, at x = L). Keepers are not in team(): the outfield play and
  // every rule about outfield players leave them out; game/keeper.js moves them and decides what they stop.
  setup(sc) {
    this.agents.clear();
    const add = (id, team, [x, y], gk = false) => this.agents.set(id, { id, team, x, y, tx: x, ty: y, speed: 0, sp: 0, dist: 0, d0: 0, tA: 0, tL: 1.4, tN: 0, kickAt: null, kickFoot: null, face: [team === 'us' ? 1 : -1, 0], ...(gk ? { gk: true } : {}) });
    add('hero', 'us', sc.hero);
    sc.mates.forEach((p, i) => add('m' + (i + 1), 'us', p));
    sc.opps.forEach((p, i) => add('o' + (i + 1), 'them', p));
    if (sc.gk?.us) add('k1', 'us', sc.gk.us, true);
    if (sc.gk?.them) add('k2', 'them', sc.gk.from || sc.gk.them, true); // (from: a keeper rushing out starts on his line)
    const c = this.a(sc.carrier || 'hero'); // in defense lessons the other team starts with the ball
    this.ball = { x: c.x + c.face[0] * .5, y: c.y, z: 0, state: 'carried', carrier: c.id, h: ang(c.face[0], c.face[1]), move: null, got: -9 };
    this.co = null; this.wait = 0; this.until = null;
  }

  // Snapshot / restore so a play can be replayed from the decision moment.
  save() { return { agents: [...this.agents.values()].map(a => ({ ...a, face: [...a.face], track: null })), ball: { ...this.ball } }; }
  restore(s) {
    this.agents.clear();
    for (const a of s.agents) this.agents.set(a.id, { ...a, face: [...a.face], tx: a.x, ty: a.y, speed: 0, sp: 0, offer: null, track: null });
    this.ball = { ...s.ball, move: null, reach: s.ball.reach && { ...s.ball.reach } }; this.co = null; this.wait = 0; this.until = null;
    this.restores++; // the picture starts each player's motion afresh (see pro/motion.js)
  }

  a(id) { return this.agents.get(id); }
  team(t) { const out = []; for (const a of this.agents.values()) if (a.team === t && !a.gk) out.push(a); return out; } // (outfield players only)
  keeper(t) { for (const a of this.agents.values()) if (a.gk && a.team === t) return a; return null; }
  // (round 7) hop: sent a step or less from where he is, to somewhere new (step: he goes there at a step's pace).
  go(id, x, y, speed = 4) { const a = this.a(id); a.hop = Math.hypot(x - a.x, y - a.y) < .5 ? (a.hop || Math.hypot(x - a.tx, y - a.ty) > .3) : false; a.tx = x; a.ty = y; a.speed = speed; if (this.ball.reach && this.ball.carrier === id) this.ball.reach.stop = false; }
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
  // the picture readies the foot the turn uses). It ends when he gets the ball. `side` (+1 his left, -1 his right):
  // the way round he was told to turn (the child's arrow), for the opening and for the turn he takes the ball with;
  // without it he picks the way himself (turnSide).
  open(id, x, y, side = 0) { const a = this.a(id); if (a) { a.open = ang(x - a.x, y - a.y); a.openS = side; } }
  // Turns the player with the ball toward (x, y) with a real move (see plan) when the ball's line is more than `min`
  // (radians) off. Returns how long it takes (0: no turn needed).
  turn(id, x, y, min = .35) { const a = this.a(id); return this.ball.carrier === id && this.ball.state === 'carried' ? this.startTurn(a, ang(x - a.x, y - a.y), min) : 0; }
  // `dry`: only ask which skill turn this turn would be a chance for (see turnAhead): nothing changes, and it returns
  // the move or null.
  startTurn(c, want, min = .35, kind = null, dry = false) {
    const b = this.ball; let d = wrapA(want - b.h);
    if (Math.abs(d) < min) return dry ? null : 0;
    const ad = Math.abs(d), dx = b.x - c.x, dy = b.y - c.y, ch = Math.cos(b.h), sh = Math.sin(b.h), s = turnSide(this, c, b.h, want), told = c.openS;
    if (!dry) c.openS = 0; // the way he was told to turn with this ball (see open) is used once
    if ((ad > 2.6 || told) && Math.sign(d) !== s) d += s * 2 * Math.PI; // nearly straight back (or told which way): the long way round, away from a defender
    const near = nearFoe(this, c, 3.5), ahead = near && (near.x - c.x) * ch + (near.y - c.y) * sh > .2; // a defender close in front: pull it back away from him
    let k = kind || (this.time - b.got < .5 && ad > 1.2 ? 'first' : ad < .8 ? 'push' : ad < 2.1 ? 'cut' : ahead ? 'pull' : 'hook');
    const P = [dx * ch + dy * sh, dy * ch - dx * sh], run = c.speed > 0 && Math.hypot(c.tx - c.x, c.ty - c.y) > .5, f0 = ang(c.face[0], c.face[1]);
    let m = plan(k, d, s, P, Math.floor(c.dist / .7) & 1, run);
    // A skill turn instead, now and then: only for a turn he chose to make (not taking a loose ball onto his run) with a
    // defender near (a push: close in front of him, and turning enough to need it).
    // A player who taps for his skills (see taps) makes one only when the child tapped for it (c.turnTap), and its ball
    // always takes the plain turn's way. (The chance is still counted without the tap, so what comes later is the same.)
    const tap = this.taps?.has(c.id), own = this.flair?.own && !tap, foe = !kind && min >= 0 && SKILL_T[k] && this.flair?.by[c.id] && nearFoe(this, c, k === 'push' ? 3.5 : 5);
    if (foe && (k !== 'push' || (ad > .45 && (foe.x - c.x) * ch + (foe.y - c.y) * sh > .5)) && (k !== 'pull' || own)) {
      // A cut is the commonest turn: only some of them are a chance (so the chop does not crowd out the rest), and a small
      // one can be a double touch instead.
      const cutOK = k !== 'cut' || this.flair.by[c.id].p >= 1 || rnd(c.x * 13, c.y * 17, idn(c.id)) < (ad < 1.6 ? .7 : .3); // (one who always takes his chance: every one)
      const sk = cutOK && this.pickSkill(c, k === 'push' && !own ? ['double'] : k === 'cut' && ad < 1.6 ? ['double', 'chop', 'roll'].filter(x => x !== 'roll' || c.sp < 2.6) : SKILL_T[k].filter(x => x !== 'roll' || c.sp < 2.6), 'turn', dry);
      if (dry) return sk || null;
      if (sk && (!tap || sk === c.turnTap)) { m = skillPlan(sk, m, s, P, own); k = sk; c.skill = null; }
    }
    if (dry) return null;
    if (tap) c.turnTap = null;
    let fd = wrapA(want - f0); if (Math.abs(fd) > (told ? .3 : 1.6) && Math.sign(fd) !== s) fd += s * 2 * Math.PI; // the body turns the same way round as the ball
    b.move = { k, t0: this.time, a0: b.h, d, s, P, f0, fd, ...m };
    this.on('touch');
    return m.dur;
  }
  // A chance for a skill move for `c` (one of `kinds` that he can do, see flair.js): he takes it as often as his flair
  // says, and the choice is the same whenever the play is replayed (it comes from where he is). At most one chance
  // every 3 s, taken or not, so he never does two skills close together. Returns the move, or null.
  pickSkill(c, kinds, sit, dry = false) {
    const f = this.flair?.by[c.id], w = f && kinds.map(k => (f.fav.includes(k) ? 4 : f.can.includes(k) ? 1 : 0) * (MOVE_W[k] || 1)), all = w ? w.reduce((p, q) => p + q, 0) : 0;
    if (!all || this.time - (c.skT ?? -9) < 2) return null; // none he can do here, or one too soon
    if (!dry) c.skT = this.time;
    const r = rnd(c.x * 20, c.y * 20, c.dist * 20, idn(c.id));
    let k = null, q = rnd(r * 1e6, 17) * all;
    // (round 7: the child's own player, who taps for his moves, is offered one whenever it fits: no dice)
    if (r < (this.taps?.has(c.id) ? 1 : f.p)) for (let i = 0; i < kinds.length && !k; i++) if ((q -= w[i]) < 0) k = kinds[i];
    if (!dry) this.skillLog?.push(`${k || '-'}|${this.flair.ctx}|${sit}|${f.tier}|${c.id}`);
    return k;
  }
  // The skill turn the next step would start for `id` (his run leaves the ball's line, as in step), or null. The
  // game asks it while play stands still, so the child can be offered the move before the turn begins.
  turnAhead(id) {
    const a = this.a(id), b = this.ball; if (!a || b.state !== 'carried' || b.carrier !== id || b.move || b.reach) return null;
    const dx = a.tx - a.x, dy = a.ty - a.y;
    if (!(Math.hypot(dx, dy) > .02 && a.speed > 0 && (a.kickAt == null || this.time - a.kickAt > .5))) return null;
    return this.startTurn(a, ang(dx, dy), .35, null, true);
  }
  // Running at a defender with the ball (about 1.6 to 6 m in front of him and in his way when the move starts) and a
  // touch just made: a chance for a skill that starts at the next touch (so he has a touch to set it up, and the
  // picture a moment to show it coming: see skillNow, whose c runs from -1) and sells a fake before the touch after,
  // which takes the ball the other way (or straight on). The ball's way is not changed: every touch is the dribble's
  // own. A stepover or a body feint fits one touch even at a sprint; the scissors (two stepovers) only when he is slower.
  dribbleSkill(a) {
    const b = this.ball; if (!this.flair?.by[a.id] || a.sp < 1.8 || (a.kickAt != null && this.time - a.kickAt < .7)) return;
    // A player who taps for his skills (see taps) is offered one two touches ahead, so the child has time to see it
    // and tap, and only when his run goes on long enough for the whole move (to its touch and a little past it).
    // (round 7: two touches ahead when a defender is that far off; else one touch ahead, a shorter moment to tap, rather than no offer)
    const tap = this.taps?.has(a.id), left = Math.hypot(a.tx - a.x, a.ty - a.y); let ahead = tap ? 2.8 : 1.4;
    if (tap && (!this.offerOK || a.offer)) return;
    if (tap) { const far = o => { const f = (o.x - a.x) * Math.cos(this.ball.h) + (o.y - a.y) * Math.sin(this.ball.h) - 2.8, l = (o.y - a.y) * Math.cos(this.ball.h) - (o.x - a.x) * Math.sin(this.ball.h); return o.team !== a.team && !o.gk && f > 1.6 && f < 6 && Math.abs(l) < 2.5; };
      if (left < 2.8 + 1.4 * 1.3 + .3 || ![...this.agents.values()].some(far)) ahead = 1.4; if (left < ahead + 1.4 * 1.3 + .3) return; }
    const ch = Math.cos(b.h), sh = Math.sin(b.h), n0 = a.tN || 0; // (just after a touch: the next is chosen after this, and is 1.4 m if a skill comes)
    // the defender in his way when the move would start: at the next touch (with a touch to set it up) or, too close
    // for that, at this one
    // (round 6: the nearest of them in his way, not the first one found)
    const near = ahead => { let best = null, bf = 9; for (const o of this.agents.values()) { const f = (o.x - a.x) * ch + (o.y - a.y) * sh - ahead, l = (o.y - a.y) * ch - (o.x - a.x) * sh; if (o.team !== a.team && !o.gk && f > (tap && ahead < 2 ? .5 : 1.6) && f < 6 && Math.abs(l) < 2.5 && f < bf) { bf = f; best = l; } } return best; }; // (round 7: his own player, one touch ahead: a defender close in front counts too: the fake is made right at him)
    let fl = near(ahead), n = n0 + ahead / 1.4; if (fl == null && !tap) { fl = near(0); n = n0; } // n: the touch the move starts at
    if (fl == null && this.flair.by[a.id].sure) for (const o of this.agents.values()) { // told a defender is near his way: one beside him counts too, if he is ahead of him (round 6: not one level with him or behind: a fake at nobody)
      const f = (o.x - a.x) * ch + (o.y - a.y) * sh - (ahead - 1.4), l = (o.y - a.y) * ch - (o.x - a.x) * sh; if (o.team !== a.team && !o.gk && f > 1 && Math.abs(l) < f + 1 && Math.hypot(f, l) < 6 && Math.hypot(f, l) > 1.4) { fl = l; n = n0 + ahead / 1.4; break; }
    }
    if (fl == null) return;
    // (round 6) A fake that makes sense: he fakes (or steps over) toward the side he will NOT take, and the ball leaves
    // on the side he is going. Which side that is comes from the play, in this order: his run bends to one side after
    // the move (he fakes the other way); the defender in his way stands to one side of his line (he fakes at him and
    // goes by on the open side); the defender is dead ahead (he fakes to the side with more of their players, the
    // crowded one). (The ball itself goes exactly as the dribble has it, a hand's width to either side: the fake is his body.)
    const tb = Math.atan2(a.ty - a.y, a.tx - a.x) - b.h, bend = Math.hypot(a.tx - a.x, a.ty - a.y) > 2 ? Math.atan2(Math.sin(tb), Math.cos(tb)) : 0;
    let crowd = 0; for (const o of this.agents.values()) { const f = (o.x - a.x) * ch + (o.y - a.y) * sh, l = (o.y - a.y) * ch - (o.x - a.x) * sh; if (o.team !== a.team && !o.gk && f > 0 && f < 8 && Math.abs(l) > .3) crowd += Math.sign(l) / Math.max(1, Math.hypot(f, l)); }
    const fake = Math.abs(bend) > .2 ? -Math.sign(bend) : Math.abs(fl) > .35 ? Math.sign(fl) : Math.abs(crowd) > .02 ? Math.sign(crowd) : fl >= 0 ? 1 : -1;
    // (The touch after the fake takes the ball on, a hand's width to one side or straight: never to the side of the fake.
    // If this touch's turn in the dribble would, the move waits a touch.)
    if (Math.sign(SIDE[(n + 1) % 3]) === fake) return;
    const k = this.pickSkill(a, a.sp < 3.3 ? ['stepover', 'feint', 'scissors'] : ['stepover', 'feint'], 'run-at'); // two stepovers in one touch only at a jog
    if (k) a[tap ? 'offer' : 'skill'] = { k, n, fake, yaw: b.h, why: Math.abs(bend) > .2 ? 'bend' : Math.abs(fl) > .35 ? 'defender' : 'crowd', fl };
  }
  // The child tapped in time: the offered move is his (from the next moment; the picture eases into it). Returns its
  // name, or null when the offer is gone (the window has closed). Nothing in the game moves differently for it.
  take(id) {
    const a = this.a(id), o = a?.offer; if (!o) return null;
    a.offer = null; a.skill = { ...o, yaw: this.ball.h, tap: this.time };
    return o.k;
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
    Object.assign(b, { state: 'flying', carrier: null, move: null, fx: b.x, fy: b.y, tx: x, ty: y, t: 0, arc, z1, z0: b.z || 0, vz: 0, // (z0: it leaves from where it is, a keeper's hands too)
      dur: Math.max(0.25, Math.hypot(x - b.x, y - b.y) / speed) });
  }
  run(gen) { this.co = gen; this.wait = 0; this.until = null; }
  // A player on a planned way (v64: the run-up and the decision window, see window.js): a.track = { at(t) → { x, y, vx,
  // vy }, t0, watch }. He is where the plan says at every step (so the play is the same at any frame rate and in the
  // tests), faces his way, or the ball while he gives ground or goes with it (watch), and with the ball he keeps it
  // rolling: a touch every TOUCH metres puts it on the way he goes. untrack() hands him back to targets (tx, ty), going
  // on as he was until something else moves him.
  follow(a, dt) {
    const b = this.ball, q = a.track.at(this.time - a.track.t0), dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy), v = Math.hypot(q.vx, q.vy);
    const before = a.dist; a.x = q.x; a.y = q.y; a.dist += d; a.speed = v; a.sp = v; a.tx = q.x + q.vx * .5; a.ty = q.y + q.vy * .5;
    if (a.id === 'hero' && Math.floor(a.dist / .7) > Math.floor(before / .7)) this.on('step');
    if (a.track.watch && b) { const bx = b.x - a.x, by = b.y - a.y, l = Math.hypot(bx, by); if (l > .3) turnToward(a, bx / l, by / l, dt); }
    else if (v > .05 && !a.gk) turnToward(a, q.vx / v, q.vy / v, dt);
    if (b.state === 'carried' && b.carrier === a.id && !b.move) {
      if (b.reach) b.reach = null;
      if (dribbleAt(a) - (a.tA || 0) >= (a.tL || 1.4)) { a.tN = (a.tN || 0) + 1; a.tA = (a.tA || 0) + (a.tL || 1.4); a.tL = 1.4; if (v > .05) b.h = ang(q.vx, q.vy); this.on('touch'); }
    }
  }
  // (v66) He comes off his planned way with the velocity he has (a.mom, for MOM_T s at most): whatever moves him next, he
  // goes into it from that velocity, changing it no faster than a child can (EASE), so nobody turns round on the spot
  // as the window closes. The player with the ball turns with a real move instead (startTurn).
  untrack(id) { const a = this.a(id); if (!a?.track) return; a.track = null; const vx = (a.tx - a.x) * 2, vy = (a.ty - a.y) * 2; a.tx = a.x + vx; a.ty = a.y + vy; const v0 = Math.hypot(vx, vy); if (!a.gk && v0 > .3) { a.mom = [vx, vy]; a.momT = this.time + MOM_T; a.momA = Math.min(MOM_MAX, Math.max(MOM_A, (.25 + .6 * v0) / .18)); a.momBack = false; } else a.mom = null; }
  // One step of a player coming round from the velocity he had (a.mom) to the one he wants (wx, wy). Returns true when he
  // is there (the usual way of moving takes over), false while he is still coming round (he has been moved).
  momentum(a, wx, wy, dt, d = 9, once = false) {
    const m = a.mom, acc = a.momA || MOM_A, sp0 = Math.hypot(m[0], m[1]);
    // (near where he is going he is let down onto it: the usual way takes over, at the speed he has)
    if (this.time > a.momT || (d < 9 && d < Math.max(.2, sp0 * .15) && m[0] * wx + m[1] * wy >= 0)) { a.mom = null; a.va = sp0; return true; } // (round 7: not when it is behind him: then he comes round to it)
    const w = Math.hypot(wx, wy), k = w > 1e-6 && d < 9 ? Math.min(1, Math.sqrt(2 * acc * d) / w) : 1; wx *= k; wy *= k; // (he slows into it)
    const ex = wx - m[0], ey = wy - m[1], el = Math.hypot(ex, ey), st = acc * dt;
    if (el <= st) { if (once) { a.mom = null; a.momBack = false; a.va = Math.hypot(wx, wy); return true; } m[0] = wx; m[1] = wy; } else { m[0] += ex / el * st; m[1] += ey / el * st; } // (once: he has come round, and goes on as the play says)
    const sp = Math.hypot(m[0], m[1]); a.x += m[0] * dt; a.y += m[1] * dt; a.dist += sp * dt; a.sp = sp; a.va = sp;
    if (w > .3) turnToward(a, wx / w, wy / w, dt * .6); // his body comes round to where he is going
    return false;
  }
  untrackAll() { for (const a of this.agents.values()) if (a.track) this.untrack(a.id); }

  step(dt) {
    this.time += dt;
    const b = this.ball;
    let kicking = b.state === 'flying'; if (!kicking) for (const a of this.agents.values()) if (a.kickAt != null && this.time - a.kickAt < .7) { kicking = true; break; } // (a ball being struck or on its way: the ones the play sends to it or off its line go at once)
    for (const a of this.agents.values()) {
      if (a.px != null && dt > 0) { a.lv ||= [0, 0]; a.lv[0] = (a.x - a.px) / dt; a.lv[1] = (a.y - a.py) / dt; } a.px = a.x; a.py = a.y; // (his velocity over the last step)
      if (a.track) { this.follow(a, dt); continue; }
      const has = b.state === 'carried' && b.carrier === a.id, fetch = has && b.reach; // his ball, out of reach: he goes to it first
      if (a.skill && (!has || b.move || b.reach || (a.kickAt != null && this.time - a.kickAt < .7) || touchAt(a) - a.skill.n > 1.4)) a.skill = null; // a dribble skill ends a little after its touch, or when anything else starts
      if (a.offer && (!has || b.move || b.reach || (a.kickAt != null && this.time - a.kickAt < .7) || touchAt(a) - a.offer.n > OFFER_END || a.sp < 1.5 || !this.offerOK)) { a.offer = null; this.offerOK = false; } // an offer closes in time for the move to set up (or when he slows down or anything else starts); the game allows the next one
      let dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      // (round 6) While a skill turn is offered to him (game/skill.js: a.holdTurn) his turn waits: he carries the ball on
      // the way it is going, at a walk, and the turn starts when the game lets it. Nothing else waits.
      const hold = a.holdTurn && has && !b.move && !b.reach && d > .02;
      if (hold) { dx = Math.cos(b.h) * 2; dy = Math.sin(b.h) * 2; d = 2; }
      if (fetch) {
        const bx = b.x - a.x, by = b.y - a.y, bd = Math.hypot(bx, by);
        if (bd < REACH - .1) { // in reach: a foot takes it, onto the way he goes, or (standing) in to his feet
          b.reach = null; b.h = ang(bx, by); rephase(a, bd); if (fetch.stop) { a.tx = a.x; a.ty = a.y; d = 0; }
          if (d > .02 && a.speed > 0) this.startTurn(a, ang(dx, dy), -1); else this.startTurn(a, b.h, -1, 'gather');
        } else { d = bd - (REACH - .15); dx = bx / bd * d; dy = by / bd * d; a.speed = Math.max(a.speed, 3); }
      }
      // With the ball, a run that leaves the ball's line starts a turn first (see plan).
      if (has && !b.move && !b.reach && d > 0.02 && a.speed > 0 && (a.kickAt == null || this.time - a.kickAt > .5)) {
        if (a.sp < .3) restart(a); // setting off from standing: his first step is a touch that pushes the ball on
        // (The ball pushed out ahead in a long touch: he runs onto it first, and his foot takes it onto the new way.)
        if ((a.tL || 1.4) > 1.4 && Math.abs(wrapA(ang(dx, dy) - b.h)) >= .35 && Math.hypot(b.x - a.x, b.y - a.y) > CLOSE + .2) b.reach = { stop: false };
        else this.startTurn(a, ang(dx, dy));
      }
      const m = has ? b.move : null, u = m ? (this.time - m.t0) / m.dur : 0, last = m ? m.last ?? m.t[m.t.length - 1][0] : 0;
      const sp = m ? a.speed * (u < last ? m.slow : m.slow + (1 - m.slow) * sm((u - last) / (1 - last))) : hold ? Math.min(a.speed, Math.max(.8, Math.min(a.sp, 1.4))) : a.speed; // nearly still while a foot turns the ball
      if (d > 0.02 && a.speed > 0) {
        if (m) a.sp = lerp(a.sp, sp, ease(dt, 10)); // he brakes into the turn and runs out of it
        let v = m ? a.sp : sp;
        if (a.ease && !m) { // (v64) a player the team AI moves speeds up and slows down as a child does, and slows into where he is going
          const want = Math.min(sp, Math.sqrt(2 * EASE * d)); a.va = (a.va ?? a.sp) + Math.max(-EASE * dt, Math.min(EASE * dt, want - (a.va ?? a.sp))); v = a.va;
        } else a.va = null;
        // (v66) One the team's shape moves never turns on the spot at speed: sent more than 60° off the way he is going
        // (a new job, a new place), he comes round from the velocity he has, like anyone coming off a planned way.
        // (round 6: and nobody, whoever moves him, snaps round at a run: sent more than 120° off his way at 2 m/s or more, he comes round too)
        // (round 7: whoever sends him, and whatever for: nobody flips at a run)
        if (!a.mom && !has && !m && !a.gk && a.lv && !(a.momOff > this.time)) { const ls = Math.hypot(a.lv[0], a.lv[1]), cs = (a.lv[0] * dx + a.lv[1] * dy) / (ls * d || 1); if (ls < 6 && (a.ease ? ls > .8 && cs < -.17 : ls >= 2 && a.speed >= 2 && cs < -.5)) { a.mom = [a.lv[0], a.lv[1]]; a.momT = this.time + (a.ease ? MOM_T : .4); a.momA = a.ease ? Math.min(MOM_MAX, Math.max(MOM_A, (.25 + .6 * ls) / .18)) : 20; a.momBack = false; } } // (one the play's script sends: round hard, in under half a second, so he is where the play needs him)
        if (a.mom && (!has || fetch) && !m) {
          // One the team's shape moves (a.ease) comes round as a child does. One the play's own script sends goes at once,
          // as before, unless that means turning back on himself at speed: then he too comes round first.
          const ms = Math.hypot(a.mom[0], a.mom[1]), back = ms > 1.5 && (a.mom[0] * dx + a.mom[1] * dy) / (ms * d) < -.17; // (at a run: from a walk he just turns)
          if (!a.ease && !back && !a.momBack) a.mom = null;
          else { a.momBack = !a.ease; if (!this.momentum(a, dx / d * v, dy / d * v, dt, d, !a.ease)) continue; }
        } // (still coming round from the way he was going)
        // (round 7) One the play's script sends sets off as a body can, not at full speed from the first step: 20 m/s² (a quarter of a second to a sprint).
        if (!a.ease && (!has || (a.id !== 'hero' && !m)) && !a.gk) { if (a.rd && a.rv > 1 && d > .6 && (a.rd[0] * dx + a.rd[1] * dy) / d < -.3) a.rv = 0; (a.rd ||= [0, 0])[0] = dx / d; a.rd[1] = dy / d; // (sent back the other way: he sets off anew)
          if (d > .3) v = Math.min(v, (a.rv || 0) + (a.rA || 20) * dt); a.rv = v;
          if (a.hop) v = Math.min(v, .8 + d * 5); } else a.rv = v; // (a hop of a step or less, to a place he was not already going to: at a step's pace, not a sprint's)
        const s = Math.min(v * dt, d);
        const before = a.dist; a.x += dx / d * s; a.y += dy / d * s; if (!m && !a.gk) turnToward(a, dx / d, dy / d, dt); a.dist += s; // (a keeper side-steps and dives: he keeps facing the play)
        if (a.id === 'hero' && Math.floor(a.dist / .7) > Math.floor(before / .7)) this.on('step');
        if (has && !m && !b.reach && dribbleAt(a) - (a.tA || 0) >= (a.tL || 1.4)) { // each dribble touch puts the ball on the way he runs
          a.tN = (a.tN || 0) + 1; a.tA = (a.tA || 0) + (a.tL || 1.4); this.on('touch'); b.h = ang(dx, dy); if (!a.skill) this.dribbleSkill(a); a.tL = touchLen(this, a);
        }
        if (!m) a.sp = lerp(a.sp, sp, ease(dt, 8));
      } else if (a.mom && !has) { if (Math.hypot(a.mom[0], a.mom[1]) < .15) a.mom = null; else if (!this.momentum(a, 0, 0, dt)) { a.tx = a.x; a.ty = a.y; } } // (told to stop: he slows to a stop over a step or two)
      else { a.sp = lerp(a.sp, 0, ease(dt, 8)); a.va = 0; a.rv = 0; a.rA = 0; if (has) a.mom = null; }
      if (m) { const f = m.f0 + m.fd * sm((u - m.face[0]) / (m.face[1] - m.face[0])); a.face[0] = Math.cos(f); a.face[1] = Math.sin(f); } // the body turns with the move
    }
    // Bodies take up space: nudge apart any two players closer than SPACE so nobody walks through anyone.
    const list = this.list; list.length = 0; for (const a of this.agents.values()) list.push(a); // one list, filled again each step
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i], q = list[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d < SPACE && d > 1e-6) { // (a player on a planned way keeps to it: the other one gives way; two on planned ways are kept apart by the plan)
        // (round 5: of two the plan does not hold, the one going faster goes round: a runner never shoves a walker off his way)
        const vp = (p.sp || 0) + .3, vq = (q.sp || 0) + .3, fp = vp * vp / (vp * vp + vq * vq);
        const kp = p.track ? 0 : q.track ? 1 : fp, kq = q.track ? 0 : p.track ? 1 : 1 - fp, push = SPACE - d;
        p.x -= dx / d * push * kp; p.y -= dy / d * push * kp; q.x += dx / d * push * kq; q.y += dy / d * push * kq;
      }
    }
    if (b.state === 'carried' && b.move) {
      // A turn: the ball goes where the foot sends it (see plan), from where it was as the move began.
      const c = this.a(b.carrier), m = b.move, u = (this.time - m.t0) / m.dur;
      if (u >= 1) { b.h = m.a0 + m.d; b.move = null; rephase(c, Math.hypot(b.x - c.x, b.y - c.y)); } // the dribble goes on from where the ball is
      const p = ballAt(m, Math.min(1, u)), cs = Math.cos(m.a0), sn = Math.sin(m.a0);
      b.x = c.x + p[0] * cs - p[1] * sn; b.y = c.y + p[0] * sn + p[1] * cs; b.z = 0;
      if (m.t.some(t => u >= t[0] && u - dt / m.dur < t[0] && t !== m.t[0])) this.on('touch');
    } else if (b.state === 'carried' && !b.reach) {
      // Dribbling: each touch (see touchLen) pushes the ball ahead, then the player catches up. Touches cycle laces /
      // inside / outside, nudging the ball sideways a little. The ball stays on its line (ball.h): when he turns his
      // body standing still, it stays where it is.
      const c = this.a(b.carrier), run = Math.min(1, c.sp / 2.5), k = Math.min(1, (dribbleAt(c) - (c.tA || 0)) / (c.tL || 1.4)), kind = ((c.tN || 0) % 3 + 3) % 3;
      // He stopped with the ball pushed out ahead in a long touch: it rests where it is and he goes to it.
      if ((c.tL || 1.4) > 1.4 && !(c.speed > 0 && Math.hypot(c.tx - c.x, c.ty - c.y) > .02) && Math.hypot(b.x - c.x, b.y - c.y) > CLOSE + .2) b.reach = { stop: true };
      const ahead = .34 + run * .55 * (1 - k) + longLead(c.tL || 1.4, k), side = (c.tL || 1.4) > 1.4 ? 0 : run * SIDE[kind] * (1 - k), hx = Math.cos(b.h), hy = Math.sin(b.h);
      // The ball rolls toward its spot at his feet instead of jumping there.
      const wx = c.x + hx * ahead - hy * side, wy = c.y + hy * ahead + hx * side, roll = ease(dt, 14);
      b.x += (wx - b.x) * roll; b.y += (wy - b.y) * roll; b.z = 0;
    } else if (b.state === 'held') { // a keeper has it in his hands, in front of his chest (game/keeper.js)
      // Where his hands hold it: down after a dive, in his hands on the grass; rolling it out, down low in front of him;
      // else at his chest. It goes there at a hand's speed (HAND m/s), never in one jump: a ball he stops on the grass
      // is gathered up to his chest, and brought down again to roll it out.
      const c = this.a(b.carrier), m = c?.gkm;
      if (c) {
        const down = m?.k === 'dive' && m.hand && this.time < m.t0 + m.dur + .45; // (after a dive: in his hands on the grass while he lies there, then up at his chest as he gets up)
        const roll = m?.k === 'roll', fwd = roll ? .45 : m?.k === 'reach' ? .42 : .3, tx = down ? m.hand.x : c.x + c.face[0] * fwd, ty = down ? m.hand.y : c.y + c.face[1] * fwd;
        // (still down after a save, 'reach': at his hands, low; then up with him)
        const tz = down ? (m.high ? Math.max(.2, (m.hz || 1.2) - 6 * Math.max(0, this.time - m.t0 - m.dur)) : .2) : m?.k === 'dive' ? .6 : roll ? BALL_LOW : m?.k === 'reach' ? .22 : .85, dx = tx - b.x, dy = ty - b.y, dz = tz - (b.z || 0), d = Math.hypot(dx, dy, dz), k = d > HAND * dt ? HAND * dt / d : 1;
        b.x += dx * k; b.y += dy * k; b.z = (b.z || 0) + dz * k;
      }
    } else if (b.state === 'flying') {
      b.t += dt / b.dur;
      const u = Math.min(1, b.t), e = 1 - Math.pow(1 - u, 1.5);
      b.x = lerp(b.fx, b.tx, e); b.y = lerp(b.fy, b.ty, e); b.z = (b.z0 || 0) * (1 - u) + b.arc * 4 * u * (1 - u) + b.z1 * u;
      if (u >= 1) b.state = 'loose';
    } else if (b.state === 'loose' && b.z > 0) { b.vz = (b.vz || 0) - 9.8 * dt; b.z = Math.max(0, b.z + b.vz * dt); } // (a shot that ends up high in the net drops to the grass)
    // Players standing still turn to watch the ball. One who will turn with a pass to him opens his body that way a little
    // (and stays open as it stops at his feet, until he takes it).
    for (const a of this.agents.values()) {
      if (a.sp < 0.3 && b.carrier !== a.id && !a.gk) { // (a keeper faces out of his goal: game/keeper.js)
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
        if (a.open != null && b.state !== 'carried') { const h = ang(dx, dy), f = h + turnSide(this, a, h, a.open) * Math.min(.75, Math.abs(wrapA(a.open - h))); turnToward(a, Math.cos(f), Math.sin(f), dt * .5); }
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
