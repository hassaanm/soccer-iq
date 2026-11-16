// How a goalkeeper moves (5v5, v62). The game moves him as a point (game/keeper.js) and says what he is doing
// (a.gkm: a save he steps or falls to, holding the ball, rolling it out); this turns that into a body. Ready: feet wide,
// knees bent, hands out in front. He side-steps: a foot stays where it is on the grass until he steps it, so his feet
// never slide. A reach: a step and both hands to the ball. A dive: a fall to the side, arms out after the ball, landing
// on his side, then up again. Holding: the ball at his chest. Rolling out: down low, one arm swings it along the grass.
import { tiltBody, legTo } from './motion.js';

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * clamp(t), sm = t => (t = clamp(t), t * t * (3 - 2 * t));
const damp = (v, to, rate, dt) => v + (to - v) * (1 - Math.exp(-rate * dt)), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const bump = (t, a, b, c, d) => sm((t - a) / (b - a)) * (1 - sm((t - c) / (d - c)));
const STANCE = .21, STEP_T = .16;
const LIE = .4, UP = .95; // after a dive: how long he lies there (s, once his hands are on the ball), how long getting up takes
const rcOf = (kt, gk) => bump(kt, -.05, Math.max(.05, gk.dur * .8), gk.dur + .1, gk.dur + .4); // feet half-apart when ready (m); how long one side-step of a foot takes (s)

export function animateKeeper(g, a, sim, mood = 0, moodT = 0, time = sim.time) {
  const u = g.userData, now = sim.time, b = sim.ball;
  let m = u.k;
  if (!m || m.rs !== sim.restores || Math.hypot(a.x - m.x, a.y - m.y) > 2.5) { // new, a replay, or put somewhere else: start afresh
    m = u.k = { rs: sim.restores, x: a.x, y: a.y, t: time, yaw: Math.atan2(a.face[1], a.face[0]), fl: [0, 1].map(() => ({ x: null, y: null, s: -1, fx: 0, fy: 0 })), roll: 0, lift: 0, lean: .3 };
  }
  const dt = clamp(time - m.t, 0, .05); m.t = time; m.x = a.x; m.y = a.y;
  const gk = a.gkm, kt = gk ? now - gk.t0 : 9, k = gk?.k;
  // Facing: out of his goal (the game sets it), turned to the ball when it is near; when he rolls it out, to the friend.
  const toBall = Math.atan2(b.y - a.y, b.x - a.x), face = Math.atan2(a.face[1], a.face[0]);
  const want = k === 'roll' || k === 'hold' ? face : face + clamp(wrap(toBall - face), -.7, .7) * .6;
  m.yaw += wrap(want - m.yaw) * (1 - Math.exp(-8 * dt));
  const cy = Math.cos(m.yaw), syw = Math.sin(m.yaw);
  // A dive (k 'dive', side +1 his left): the fall to the side over its first part (dur), then he lies there a moment,
  // then (v64 round 3) he gets up over UP s through a kneel: he rolls back off his side onto his knees, then stands. The
  // same when the game moves on (to holding the ball) while he lies there: never in one frame.
  let dvT = 0;
  if (k === 'dive' && kt < gk.dur + LIE) { dvT = kt < 0 ? 0 : kt < gk.dur ? sm(kt / gk.dur) : 1; m.upT = null; }
  else if ((m.dvRaw || 0) > .05 && m.upT == null) { m.upT = k === 'dive' ? time - (kt - gk.dur - LIE) : time; m.dvUp = m.dvRaw; }
  let kneel = 0;
  if (m.upT != null) { const e = clamp((time - m.upT) / UP); dvT = m.dvUp * (1 - sm(e / .55)); kneel = m.dvUp * bump(e, .05, .35, .65, 1); if (e >= 1) m.upT = null; }
  m.dvRaw = dvT; m.dv = dvT; const dv = dvT;
  // A guess (gk.guess): before the kick only a lean that way (and one step: the game moves him), the dive at the kick.
  const guessLean = k === 'dive' && gk.guess && kt < 0 ? sm((kt + gk.pre) / gk.pre) : 0;
  // A high dive (gk.high): a short spring up and sideways, highest just before his hands meet the ball, and down onto his
  // side right after it (air: how far off the grass, 0 to 1). Never a float.
  const air = k === 'dive' && gk.high && kt > 0 ? Math.sin(Math.PI * clamp(kt / (1.45 * gk.dur))) : 0;
  m.air = damp(m.air || 0, air, 25, dt);
  const rc = k === 'reach' ? bump(kt, -.05, Math.max(.05, gk.dur * .8), gk.dur + .1, gk.dur + .4) : 0;
  const hold = k === 'hold' ? sm(kt / .35) : 0; // (stands up with it at his chest, over a moment)
  const down = Math.max(kneel, k === 'reach' && gk.low ? (gk.save ? sm((kt + .05) / .2) : rcOf(kt, gk)) : 0); // a ball along the grass: down to it (and, a save, he stays down with it until he stands up)
  const roll = k === 'roll' ? kt : -1, low = roll >= 0 ? bump(roll, 0, .2, .55, .85) : 0;
  const side = k === 'dive' && kt < gk.dur + LIE ? gk.side || 1 : (m.dv > .01 && m.lastSide) || gk?.side || 1; // (getting up from a dive: the side he lay on)
  const lie = k === 'dive' && gk.high ? lerp(.8, 1.38, clamp((kt - gk.dur) / .25)) : 1.38; // (a high one: a sideways leap, not flat in the air; flat only as he lands) // (in the air, more upright: reaching up)
  m.roll = damp(m.roll, -side * (lie * dv + .22 * guessLean), 30, dt); if (k === 'dive') m.lastSide = side; // (v64: a negative roll tips him to his left (the body turns in ZYX order, so roll is about his own forward line; v62 had the sign the other way, and he fell away from the ball); getting up, he rolls back from the side he lay on)
  m.lift = damp(m.lift, (.11 + .25 * low + .05 * rc + .3 * down + .12 * kneel + .06 * guessLean) * (1 - dv), 18, dt); // hips down: ready (knees bent), crouched to roll it out (diving, the fall itself takes him down)
  m.lean = damp(m.lean, .16 + .35 * low - .1 * dv + .08 * rc + .06 * down, 12, dt); // (down on his knees he stays upright, hands down in front)  // leaning a little over his toes
  tiltBody(-m.lift, m.lean, m.roll);
  g.position.set(a.x, a.y, -m.lift + .35 * m.air); g.rotation.set(m.roll, m.lean, m.yaw);
  u.blob.position.set(0, 0, .012); u.blob.rotation.set(-m.roll, -m.lean, 0); u.blob.scale.setScalar((1 - .4 * dv) / (1 + m.air)); // (off the grass: his shadow shrinks)
  // Feet: each stays where it is on the grass until he steps it toward its place in his stance (one at a time).
  for (let i = 0; i < 2; i++) {
    const sg = i ? 1 : -1, f = m.fl[i], leg = u.legs[i];
    const sx = .02 * sg, sy = sg * STANCE * (1 - .45 * dv) + (dv ? side * .35 * dv : 0);
    const tx = a.x + cy * sx - syw * sy, ty = a.y + syw * sx + cy * sy;
    if (f.x == null) { f.x = tx; f.y = ty; }
    let up = 0;
    if (f.s < 0 && m.fl[1 - i].s < 0 && Math.hypot(tx - f.x, ty - f.y) > .1) { f.s = time; f.fx = f.x; f.fy = f.y; }
    if (f.s >= 0) { const e = clamp((time - f.s) / STEP_T); f.x = lerp(f.fx, tx, sm(e)); f.y = lerp(f.fy, ty, sm(e)); up = Math.sin(Math.PI * e); if (e >= 1) f.s = -1; }
    const rx = f.x - a.x, ry = f.y - a.y, lx = cy * rx + syw * ry, ly = cy * ry - syw * rx;
    legTo(leg, lx, ly, .06 + .07 * up + .25 * dv * (i === (side > 0 ? 1 : 0) ? 1 : .4), .05 * up - .4 * dv, sg * .25, sg * .45);
  }
  // Arms (each: out from his side, swung forward/up, elbow): ready, hands low in front; reaching or diving, both after
  // the ball (up past his head, on the diving side); holding it at his chest; rolling, one arm swings it along the grass.
  for (let i = 0; i < 2; i++) {
    const sg = i ? 1 : -1;
    let ax = sg * .45, ay = -.75, ae = -.75;                                                // ready
    const hi = gk?.hand ? clamp(.2 + (gk.low ? 0 : .7), 0, 1) : .5;
    ax = lerp(ax, sg * (sg === side ? .25 : .05), rc); ay = lerp(ay, -1.3 - .9 * hi, rc); ae = lerp(ae, -.25, rc); // reach: both hands to the ball
    ax = lerp(ax, -sg * .05, down); ay = lerp(ay, -.75, down); ae = lerp(ae, -.35, down);                                 // a ball on the grass: hands down to it
    ax = lerp(ax, sg * .12, dv); ay = lerp(ay, -2.85, dv); ae = lerp(ae, -.12, dv);                            // dive: arms stretched past his head
    ax = lerp(ax, -sg * .18, hold); ay = lerp(ay, -1.05, hold); ae = lerp(ae, -1.75, hold);                    // the ball held to his chest
    if (roll >= 0 && i === 0) { const sw = sm(roll / .45); ax = lerp(ax, -.1, low); ay = lerp(ay, lerp(.7, -1.1, sw), low); ae = lerp(ae, -.15, low); }
    u.arms[i].rotation.set(ax, ay, 0); u.elbows[i].rotation.y = ae;
  }
  u.pelvis.rotation.set(0, .1 + .3 * low, 0);
  u.torso.rotation.set(0, .12 + .2 * low + .1 * hold, 0);
  const lookB = clamp(wrap(toBall - m.yaw), -1.2, 1.2) * (1 - dv);
  u.head.rotation.set(0, clamp(-.2 * (m.lean - .3) + .25 * low, -.4, .5), lookB);
  if (mood > 0) for (let i = 0; i < 2; i++) { u.arms[i].rotation.y = lerp(u.arms[i].rotation.y, -2.8, mood * (1 - dv)); }
  if (u.face) u.face(a, sim, mood, moodT, time);
}
