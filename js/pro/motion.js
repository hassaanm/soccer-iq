// How the players move. The game moves each player as a point at a steady speed; this file turns that
// into a body in motion. Each foot follows a path (planted on the grass while it carries him, then lifted and
// swung through), the legs bend to reach their feet, steps get longer as he speeds up, and the whole body
// leans into speeding up, slowing down and turning. On top of that he handles the ball: he times his steps so
// a foot meets it at every dribble touch, passes with the inside of either foot, shoots with the inside of the
// laces, takes a pass with the inside of the foot (it gives with the ball) or the sole, puts his sole on the ball as
// he stops, and now and then (when sim.js picks one) does a skill move: see the skills block below. Turning with the
// ball, the foot the game picked for the move (sim.js plan:
// a push, a cut, a hook, a pull back) goes to the ball and moves it. The foot for a pass or shot comes from the game (`a.kickFoot`). Standing, he
// shifts his weight, breathes and moves his feet. Turning a joint by a positive y angle swings its part back.
// Between touches he plays the way coaches teach: head up (he checks over his shoulder every few seconds and once
// while a pass comes to him, then watches the ball onto his foot), on his toes with his body half open to the field
// when he waits for the ball, an arm up to ask for it, side-on and low with small quick steps when he defends the
// ball, side steps and backpedals to keep the ball in sight, short braking steps when he stops (a standing foot
// stays where it is on the grass until he steps it), and an arm out to hold off a defender close by.
import * as THREE from 'three';
import { THIGH, SHIN, HALF } from './rig.js';
import { turnFoot, turnSide, touchAt, touchLen, skillNow, longLead } from '../sim.js';
import { PITCH as FIELD } from '../geom.js';

const JAB = .34; // (round 13) how far a jockeying defender's weight goes in at the ball in a feint lunge (m)
const TAU = Math.PI * 2, ANKLE = .06, TOE = .12, REACH = THIGH + SHIN - .004, SOFT = .04, BALL = .125; // BALL: the ball's radius (world.js)
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * clamp(t), sm = t => (t = clamp(t), t * t * (3 - 2 * t)), frac = v => v - Math.floor(v);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), damp = (v, to, rate, dt) => v + (to - v) * (1 - Math.exp(-rate * dt)), sat = (v, a) => a * Math.tanh(v / a); // sat: a soft limit
// A critically damped spring toward `to` (smooth time `st` s, by elapsed time, so the same at any frame rate): returns the
// new value; SDV is its new speed, kept by the caller.
let SDV = 0;
function sdamp(x, v, to, st, dt) { const w = 2 / st, e = w * dt, k = 1 / (1 + e + .48 * e * e + .235 * e * e * e), c = x - to, q = (v + w * c) * dt; SDV = (v - w * q) * k; return to + (c + q) * k; }

// The body's tilt for the player being posed (set by `animateRig`, read by `reach`).
let LIFT = 0, CP = 1, SP = 0, CR = 1, SR = 0;
const N = new THREE.Vector3(), E = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), QK = new THREE.Quaternion(), HINGE = new THREE.Vector3(0, 1, 0);
// From the grass's frame (ahead, left, up) into the tilted body's frame.
const tilt = v => { const x = v.x * CP - v.z * SP, z = v.x * SP + v.z * CP; return v.set(x, v.y * CR + z * SR, -v.y * SR + z * CR); };

// Bends one leg so its ankle is at (x, y, z): metres ahead, to his left, and above the grass. The toes point
// `pitch` down from level and `turn` to his left, and the knee points `kn` to his left (most moves: the same way as
// the toes; a quick turn of the foot alone turns it less). A place too far away gets a straight leg pointing at it.
function reach(leg, x, y, z, pitch, turn, kn = turn) {
  N.set(x, y, z - LIFT); tilt(N).sub(leg.hip.position);
  // Near full stretch the leg straightens ever more slowly and never quite locks (the foot stops a centimetre or two
  // short), so the knee never snaps straight or out of straight.
  let d = Math.max(N.length(), .2); if (d > REACH - SOFT) d = REACH - SOFT + SOFT * (1 - Math.exp((REACH - SOFT - d) / SOFT));
  const ct = Math.cos(turn), st = Math.sin(turn), cp = Math.cos(pitch), sp = Math.sin(pitch);
  N.normalize();
  E.set(Math.cos(kn), Math.sin(kn), 0); tilt(E).addScaledVector(N, -E.dot(N)); // the way the knee goes: square to the leg's line
  if (E.lengthSq() < 1e-4) E.set(0, 0, 1).addScaledVector(N, -N.z);
  E.normalize();
  const cA = clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1), sA = Math.sqrt(1 - cA * cA);
  Z.copy(N).multiplyScalar(-cA).addScaledVector(E, -sA); X.copy(E).multiplyScalar(cA).addScaledVector(N, -sA); Y.crossVectors(Z, X);
  leg.hip.quaternion.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
  const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
  leg.knee.rotation.y = knee;
  tilt(X.set(ct * cp, st * cp, -sp)); tilt(Z.set(ct * sp, st * sp, cp)); Y.crossVectors(Z, X);
  Q.setFromRotationMatrix(M4.makeBasis(X, Y, Z));
  leg.foot.quaternion.copy(leg.hip.quaternion).multiply(QK.setFromAxisAngle(HINGE, knee)).invert().multiply(Q);
}

// For pro/keeper.js: pose the body's tilt (hips `lift` m down, leaning `pitch`, rolled `roll` to his right), then a leg.
export function tiltBody(lift, pitch, roll) { LIFT = lift; CP = Math.cos(pitch); SP = Math.sin(pitch); CR = Math.cos(roll); SR = Math.sin(roll); }
export const legTo = reach;

// Where one foot is at `q` (0 to 1) through a stride of `Ls` metres, of which it is on the grass for the part
// `D`. Fills F: x metres ahead of the hips, z the ankle's height, p the foot's pitch.
const F = { x: 0, z: 0, p: 0 };
function foot(q, D, Ls, run) {
  const xf = D * Ls * .5 + lerp(.02, -.07, run), xb = xf - D * Ls, strike = -.25 * (1 - .6 * run);
  if (q < D) { // on the grass: it stays where it landed while he passes over it, then the heel lifts to push off
    const u = q / D, push = .75 * sm((u - .6) / .4);
    F.x = lerp(xf, xb, u); F.p = strike * clamp(1 - u / .2) + push; F.z = ANKLE + TOE * Math.sin(push);
  } else {     // in the air: trails behind, the heel kicks up, the knee drives through, and it reaches for the grass.
    // It leaves the grass at the speed it had on it, and just before it lands it sweeps back a little (as a runner's
    // foot does), so it never stops dead in the air and then jumps to the grass's speed.
    const s = (q - D) / (1 - D), s2 = s * s, s3 = s2 * s, m = -Ls * (1 - D), up = Math.sin(Math.PI * Math.pow(s, .7));
    F.x = (2 * s3 - 3 * s2 + 1) * xb + (3 * s2 - 2 * s3) * xf + (2 * s3 - 3 * s2 + s) * m + (s3 - s2) * m * lerp(.3, .55, run);
    F.z = lerp(ANKLE + TOE * Math.sin(.75), ANKLE, s) + lerp(.05, .3, run) * up * up;
    F.p = lerp(.75, strike, sm(s)) + .5 * run * Math.sin(Math.PI * s) * (1 - s);
  }
}
// The kicking foot `t` seconds after the wind-up starts: drawn back, through the ball at 0.2 s (when the game
// sends the ball off) with the ankle at `hit` metres ahead, then on toward the target. A pass is the push pass: a
// short, low swing with the inside of the foot (toes turned out square to the target, ankle firm, toes a little
// up). A shot is a full swing from the hip with the inside of the laces (toes down and a little out), and he lands
// on the kicking foot.
const KICK = { // back x, back z, hit z, through x, through z, pitch back, pitch at the ball, pitch after, toes out, body, lands at x
  pass: [-.22, .13, .1, .42, .13, .1, -.15, -.15, 1.45, .45, 0],
  touch: [-.1, .1, .1, .32, .09, .3, .45, .3, .25, .2, 0], // a dribbler knocking the ball on: a short push with the laces, twice as quick
  shot: [-.42, .42, .14, .56, .5, 1, .7, .4, .45, 1, .48],
};
function kickFoot(t, k, hit) {
  if (t < .1) { const e = sm(t / .1); F.x = lerp(.02, k[0], e); F.z = lerp(.08, k[1], e); F.p = lerp(.1, k[5], e); }
  else if (t < .2) { const e = ((t - .1) / .1) ** 2; F.x = lerp(k[0], hit, e); F.z = lerp(k[1], k[2], e); F.p = lerp(k[5], k[6], e); }
  else { const e = 1 - (1 - clamp((t - .2) / .16)) ** 2; F.x = lerp(hit, k[3], e); F.z = lerp(k[2], k[4], e); F.p = lerp(k[6], k[7], e); }
  if (k[10] && t > .36) { const e = sm((t - .36) / .16); F.x = lerp(F.x, k[10], e); F.z = lerp(F.z, ANKLE, e); F.p = lerp(F.p, 0, e); } // down onto the kicking foot
}
const SIDE = [0, 1, -1]; // which way each dribble touch sends the ball: straight on, to his left, to his right (matches sim.js)
const PART = { sole: 0, inside: 1, outside: 2, laces: 3 };
// Joins between moves. A foot's pose (ankle x, y, z, the foot's pitch and turn, the knee's turn) comes from one move or
// another: the run, a touch, a trap, a turn's touch, a kick, a skill. When that source changes (`key`), the new pose
// may be somewhere else: the difference is kept and dies away over about 0.15 s (eased, by the picture's clock), so
// the foot goes on smoothly from where it was instead of jumping there. Nothing changes while the source stays.
const JW = 26, JP = [0, 0, 0, 0, 0, 0];
function join(fl, key, x, y, z, p, turn, kn, time, jw = JW) {
  JP[0] = x; JP[1] = y; JP[2] = z; JP[3] = p; JP[4] = turn; JP[5] = kn;
  if (key !== fl.k) { if (fl.k >= 0) for (let j = 0; j < 6; j++) fl.O[j] = fl.P[j] - JP[j]; fl.k = key; fl.bt = time; fl.jw = jw; }
  const t = time - fl.bt, w = fl.jw || JW, e = t >= 0 && t < .4 ? (1 + w * t) * Math.exp(-w * t) : 0;
  for (let j = 0; j < 6; j++) { if (e) JP[j] += fl.O[j] * e; fl.P[j] = JP[j]; }
  if (e && w !== JW) JP[2] += Math.min(.16, .7 * Math.hypot(fl.O[0], fl.O[1])) * 4 * e * (1 - e); // a foot going round the ball for a turn is lifted on the way (over it, not through it)
  return JP;
}

// A boot never goes into the ball. The boot is the rig's (pro/rig.js: an egg shape, its middle .06 m ahead of the
// ankle along the foot and .014 m under it, half as long as .126 m, as wide as .05 m and as high as .042 m), and the
// ball (dx, dy: from the ball to his middle; bz: its middle's height) is grown by that much. A boot found in it is
// moved out, just far enough, the way from the ball to the boot's middle; while it stays in, it keeps going out the
// same way (fl.bo), so a foot passing close by the ball's middle never flips to its other side. Along the grass if
// out that way is under the grass. Every move puts the foot beside the ball or on it; this only catches what the
// joins between moves let through.
const bootIn = (J, dx, dy, bz, ox = 0, oy = 0, oz = 0) => {
  const ct = Math.cos(J[4]), st = Math.sin(J[4]), cp = Math.cos(J[3]), sp = Math.sin(J[3]);
  const cx = J[0] + ox + dx + .06 * ct * cp - .014 * ct * sp, cy = J[1] + oy + dy + .06 * st * cp - .014 * st * sp, cz = J[2] + oz - bz - .06 * sp - .014 * cp; // the boot's middle, from the ball
  const qx = cx * ct * cp + cy * st * cp - cz * sp, qy = cy * ct - cx * st, qz = cx * ct * sp + cy * st * sp + cz * cp; // in the boot's frame
  BO[0] = cx; BO[1] = cy; BO[2] = cz;
  return Math.hypot(qx / (.126 + BALL), qy / (.05 + BALL), qz / (.042 + BALL)); // under 1: in the ball
};
const BO = [0, 0, 0];
function bootOut(J, dx, dy, bz, fl) {
  if (bootIn(J, dx, dy, bz) >= 1) { fl.bo = null; return; }
  let ux, uy, uz;
  if (fl.bo) [ux, uy, uz] = fl.bo;
  else { const l = Math.hypot(BO[0], BO[1], BO[2]) || 1; ux = BO[0] / l; uy = BO[1] / l; uz = BO[2] / l; if (J[2] + uz * .2 < ANKLE) { const h = Math.hypot(ux, uy) || 1; ux /= h; uy /= h; uz = 0; } fl.bo = [ux, uy, uz]; }
  let lo = 0, hi = .45; for (let n = 0; n < 10; n++) { const t = (lo + hi) / 2; if (bootIn(J, dx, dy, bz, ux * t, uy * t, uz * t) < 1) lo = t; else hi = t; }
  J[0] += ux * hi; J[1] += uy * hi; J[2] = Math.max(J[2] + uz * hi, Math.min(J[2], ANKLE));
}

// ---------- Skill moves (sim.js picks them and when; see skillNow) ----------
// Dribble skills run over one dribble touch (c: 0 just after a touch, 1 at the next touch, which takes the ball the
// other way with the outside of the foot on that side). The ball rolls on as the dribble has it; the feet go round it.
//   stepover: the foot on the fake side lifts, crosses in behind the ball, goes over its front and lands wide on the
//             fake side (the body drops that way); then the outside of the other foot takes the ball away.
//   scissors: two stepovers, one with each foot (the first away from the fake, the second to it), then the outside of
//             the first foot takes the ball away.
//   feint:    the body feint: the foot on the fake side steps out wide without going over the ball and plants, his
//             hips and the shoulder go that way (a quarter of a metre: round 7), then the outside of the other foot takes it away.
// A path is keys [c, x, y, z]: x metres ahead of the ball (B) or of his hips (H), y to the fake side of the ball's line.
const B = 0, H = 1, OVER = [[.16, B, -.34, -.04, .2], [.3, B, -.04, -.02, .37], [.4, B, .13, .17, .27], [.5, B, .03, .32, .11]]; // in behind, over the front, down outside
const WIDE = [[.2, B, -.42, .3, .11], [.36, B, -.25, .6, .05]]; // (round 7: a real step out to the fake side: he plants it there)                                                               // a step out wide, short of the ball
const cr = (a, b, c, d, t) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
const PT = [0, 0, 0];
// Where a foot is at `c` on a path of keys [c, x, y, z] (already in his hip frame), through the keys on a smooth curve.
function along(k, c) {
  const n = k.length; let i = 0; while (i < n - 2 && c > k[i + 1][0]) i++;
  const t = clamp((c - k[i][0]) / (k[i + 1][0] - k[i][0])), a = k[Math.max(0, i - 1)], d = k[Math.min(n - 1, i + 2)];
  for (let j = 0; j < 3; j++) PT[j] = cr(a[j + 1], k[i][j + 1], k[i + 1][j + 1], d[j + 1], t);
  return PT;
}
// The dribble skill's two feet, in his hip frame: SKF[leg] = [x, y, z, pitch, turn, weight]. `ball`(c): how far ahead
// the ball is at c (the sim's dribble rule); `bl`: the ball's side; `fk`: the fake's side; a planted foot stays where it
// landed on the grass (as he runs on, it is a touch's length (TL) farther back for each whole touch).
const SKF = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
function dribbleSkillFeet(k, c, ball, bl, fk, TL = 1.4) {
  const S = fk > 0 ? 1 : 0, K = 1 - S, pl = (x0, c0, y) => [x0 - (c - c0) * TL, y, ANKLE];
  const key = (list, sgn, c0, c1, from, to) => { // a swing from `from` (planted at c0) through `list` (stretched to c0..c1) to `to` (at c1)
    const k = [[c0, ...from]];
    for (const [kc, f, x, y, z] of list) { const cc = c0 + (kc - .0) / .56 * (c1 - c0); k.push([cc, (f === B ? ball(cc) : 0) + x, bl + sgn * y, z]); }
    k.push([c1, ...to]); return along(k, c);
  };
  const set = (i, p, pitch, turn, w) => { SKF[i][0] = p[0]; SKF[i][1] = p[1]; SKF[i][2] = p[2]; SKF[i][3] = pitch; SKF[i][4] = turn; SKF[i][5] = w; };
  const land = (c0, sgn, y) => [ball(c0) - .06, bl + sgn * y, ANKLE];
  // the take-away foot: from where it stood to the outside of the foot against the ball's near side, then on with it
  const take = (i, c0, from) => {
    const t = c > c0 ? key([[.28, B, -.42, -.02, .13]], fk, c0, 1, from, [ball(1) - BALL - .11, bl + fk * .13, .1]) : from;
    if (c > 1) { t[0] = ball(c) - BALL - .12; t[2] = .1 + (c - 1) * .2; }
    set(i, t, c > c0 ? .1 : 0, fk * .42 * sm((c - c0) / (1 - c0)), 1);
  };
  if (k === 'scissors') { // A (K) goes over first, away from the fake; B (S) second, to the fake; A takes it away
    const a0 = [.3, bl - fk * .13, ANKLE], aL = land(.36, -fk, .34), b0 = pl(.3, 0, bl + fk * .13), bL = land(.68, fk, .34);
    if (c < .36) set(K, key(OVER, -fk, 0, .36, [-.25, bl - fk * .13, .1], aL), c > .3 ? 0 : -.2, -fk * .5, 1); else if (c < .7) set(K, pl(aL[0], .36, aL[1]), 0, -fk * .3, 1); else take(K, .7, pl(aL[0], .36, aL[1]).slice());
    if (c < .3) set(S, pl(.3, 0, bl + fk * .13), 0, 0, 1); else if (c < .68) set(S, key(OVER, fk, .3, .68, pl(.3, 0, bl + fk * .13), bL), -.2, fk * .5, 1); else set(S, pl(bL[0], .68, bL[1]), 0, fk * .3, 1);
    return;
  }
  const over = k === 'stepover', c1 = over ? .56 : .42, L = land(c1, fk, over ? .34 : .46);
  if (c < c1) set(S, key(over ? OVER : WIDE, fk, 0, c1, [-.3, bl + fk * .12, .08], L), over && c > .2 && c < .45 ? -.25 : 0, fk * (over ? .5 : .35), 1);
  else set(S, pl(L[0], c1, L[1]), 0, fk * .25, 1);
  if (c < .5) set(K, pl(.32, 0, bl - fk * .13), 0, 0, 1); else take(K, .5, pl(.32, 0, bl - fk * .13));
}
// How much his weight goes to the fake side (0 to 1, signed for the scissors' first fake) at c through a dribble skill.
const bump = (c, a, b, d) => sm((c - a) / (b - a)) * (1 - sm((c - b) / (d - b)));
// Then his weight goes the other way, after the ball (minus): the fake, then the go, so the move reads from far away.
const dropOf = (k, c) => k === 'scissors' ? bump(c, .4, .62, .9) - .8 * bump(c, .05, .3, .45) - .5 * bump(c, .85, 1.02, 1.3) : k === 'feint' ? 1.6 * bump(c, .08, .42, .8) - .6 * bump(c, .62, .9, 1.25) : bump(c, .15, .45, .78) - .6 * bump(c, .62, .9, 1.25);
const DRIB_SKILL = { stepover: 1, scissors: 1, feint: 1 };

// `time` is the clock of the picture, which keeps running when the game stops its own clock (`sim.time`).
export function animateRig(g, a, sim, mood = 0, moodT = 0, time = sim.time) {
  const u = g.userData, face = Math.atan2(a.face[1], a.face[0]), b = sim.ball, now = sim.time;
  let m = u.m;
  if (!m || u.yaw === null || m.rs !== sim.restores || Math.hypot(a.x - m.x, a.y - m.y) > 1.5) { // new, put back for a replay, or moved in one jump: start afresh
    const it = u.seed * 9, r = k => frac(u.seed * k);
    m = u.m = { rs: sim.restores, t: now, rt: time, it, next: u.seed * 10 + 1, br: u.seed, x: a.x, y: a.y, sp: a.sp, v: a.sp, pv: a.sp, ph: u.seed, pa: u.seed, rate: 1, mv: null, vt: null, gv: a.sp, pre: 1, prv: 0, fb: 0, fby: 0, ea: 0, lead: 0, tbx: 0, tby: 0, yv: 0, ac0: 0, w: sm(a.sp / 1.1), tk: null, tR: 0, tl: 1, tlp: 1, acc: 0, bank: 0, cx: 1, cy: 0, hy: 0, hp: 0,
      ready: .3, puff: 0, hs: 0, cf: b.carrier === a.id ? .88 : 1, stag: u.seed % 2 < 1 ? 1 : -1, fid: null, kickAt: a.kickAt, kf: 1, hit: .2, hitY: 0, bf: .34, bl: 0, spec: null, cp: null, n: Math.floor(u.seed * 3),
      yo: 0, bs: 1, kj: 0, ss: 1, poss: null, scan: null, ns: it + .4 + 2 * r(3.1), chk: false, sn: 0, ask: null, na: it + 1 + 3 * r(4.3),
      fl: [0, 1].map(() => ({ bo: null, on: 0, s: -1, x: 0, y: 0, fx: 0, fy: 0, px: a.x, py: a.y, k: -1, bt: -9, P: [0, 0, 0, 0, 0, 0], O: [0, 0, 0, 0, 0, 0], kn: 0, kv: 0, sh: 0, nb: 0 })),
      sw: (r(3.7) - .5) * .05, sr: .12 + .2 * r(1.7), se: r(5.3) }; // his own way of standing: feet wider or narrower, a little more or less ready, arms
    u.yaw = face;
  }
  const dt = clamp(now - m.t, 0, .05), rdt = clamp(time - m.rt, 0, .05), ds = Math.hypot(a.x - m.x, a.y - m.y), yaw0 = u.yaw;
  m.rt = time;
  if (dt > 0 || b.state !== 'flying') m.it += rdt; // his own clock for standing about; it stops only when the game freezes with the ball in the air
  const T = m.it;
  if (dt > 0) m.v = damp(m.v, Math.min(ds / dt, 9), 14, dt); // how fast he really moves (the game's speed runs on a moment after he stops)
  const kt = a.kickAt != null ? (now - a.kickAt) * (a.kickKind === 'touch' ? 2 : 1) : 9; // kt: a touch runs the kick at twice the speed
  // Who has the ball (kept while it is in the air), the nearest player of the other team, and where the goal he attacks is.
  const carrier = b.state === 'carried' ? sim.a(b.carrier) : null; if (carrier) m.poss = carrier.team;
  const carrying = carrier === a, vs = carrying ? a.sp : m.v, defending = !!m.poss && m.poss !== a.team, ours = m.poss === a.team && !carrying, dc = carrier ? Math.hypot(carrier.x - a.x, carrier.y - a.y) : 99;
  let foe = null, fd = 9;
  for (let i = 0; i < sim.list.length; i++) { const o = sim.list[i]; if (o.team !== a.team) { const d = Math.hypot(o.x - a.x, o.y - a.y); if (d < fd) { fd = d; foe = o; } } }
  const bx = b.x - a.x, by = b.y - a.y, bd = Math.hypot(bx, by), toBall = Math.atan2(by, bx), gdir = Math.atan2(FIELD.W / 2 - a.y, (a.team === 'us' ? FIELD.L : 0) - a.x);
  // His skill move now, if any (sim.js); through a skill turn's fake his chest stays square to the old way (hold).
  const sk = carrying && kt > .7 ? skillNow(sim, a.id) : null;
  const hold = sk && b.move && (sk.k === 'chop' || sk.k === 'cruyff') ? wrap(sk.yaw - face) * (1 - sm((sk.c - sk.at + .04) / .14)) : 0;
  // Which way his body faces, from the way the game turns him (`face`). Without the ball:
  let yo = 0, kd = 0;
  if (!carrying && kt > .7 && !mood && bd > .6) {
    let d = wrap(toBall - face); if (Math.abs(d) > 2.8) d = m.bs * Math.abs(d); else m.bs = Math.sign(d) || 1;
    // moving away from the ball at a jog he side-steps or backpedals to keep it in sight (faster, he turns and runs; a
    // defender jockeying the dribbler keeps facing him a little faster);
    const vmax = defending && dc < 6 ? 3.4 : 2.6;
    yo = (Math.hypot(a.tx - a.x, a.ty - a.y) > .05 && a.speed > 0) * (1 - sm((vs - vmax) / 1.2)) * sm((Math.abs(d) - 1) / .5) * (1 - sm((bd - 16) / 4)) * d;
    if (defending && carrier && dc < 5.5) { // defending the ball he is side-on, his chest to the nearer touchline, so he shows the dribbler that way
      const tc = Math.atan2(carrier.y - a.y, carrier.x - a.x); m.ss = Math.sign(Math.cos(tc) * (carrier.y < FIELD.W / 2 ? -1 : 1)) || 1;
      kd = sm((5.5 - dc) / 1.5) * sm((1.6 - Math.abs(wrap(tc - face - yo))) / .4); yo += .55 * kd * m.ss;
    } else if (ours && a.open == null) yo += (1 - sm(vs / 1.1)) * sm((bd - 3) / 1) * (1 - sm((bd - 28) / 4)) * clamp(wrap(gdir - toBall), -.65, .65); // waiting for it he stands half turned, open to the field
  }
  m.yo = damp(m.yo, carrying ? 0 : yo, carrying ? 6 : 9, rdt); // the body follows it smoothly (below), never in one jump; with the ball he squares up over a moment
  // A turn with the ball: his body turns through it at most about 8.5 radians a second (the game turns his facing in
  // the turn's own time, which for a big turn is a spin): the same turn, the same way round, over a longer time (vt),
  // so he turns like a child with the ball, not a top. The ball and his feet keep the game's time.
  // (It starts a little sooner and ends a little later in the move, and takes at most 1.3 times as long, so his body is
  // never far behind the ball.)
  if (carrying && b.move && b.move !== m.mv) { const mv = b.move, w0 = mv.face[0] * .6, w1 = Math.max(mv.face[1], .9); m.vt = { t0: mv.t0, f0: mv.f0, fd: mv.fd, w0, w1, look: Math.min(1.3 * mv.dur, Math.max(mv.dur, 1.5 * Math.abs(mv.fd) / (8.5 * (w1 - w0)))) }; }
  m.mv = carrying ? b.move : null;
  if (m.vt && (!carrying || kt < .7 || now < m.vt.t0 || now > m.vt.t0 + m.vt.look * m.vt.w1 + .02)) m.vt = null;
  const vt = m.vt, aim = (vt ? vt.f0 + vt.fd * sm(((now - vt.t0) / vt.look - vt.w0) / (vt.w1 - vt.w0)) : face) + m.yo + hold;
  // His body turns after it as a spring would (its turning speed never jumps, even when the game turns him at once);
  // while the game's clock is stopped he still turns, on the picture's clock.
  u.yaw = sdamp(u.yaw, m.yv, u.yaw + wrap(aim - u.yaw), .06, dt || rdt); m.yv = SDV;
  m.w = damp(m.w, sm(vs / 1.1), 10, rdt); // w: how much he runs (0 standing): it follows his speed over a step, not in a frame or two as he sets off
  m.gv = damp(m.gv, vs, 10, rdt); // the speed his stride is shaped for: it follows the game's speed over a moment (that can drop at once, as a turn starts)
  const run = clamp(m.gv / 5.4), w = m.w, idle = 1 - w;
  m.kj = damp(m.kj, defending && carrier && dc < 5 && vs < 4 ? 1 : 0, 6, rdt); const kj = m.kj; // jockeying: low, wide, small quick steps
  const back = carrying ? 0 : clamp(-m.cx) * w, low = Math.max(kj, .6 * back); // backpedalling he stays low too, on the balls of his feet
  const cyaw = Math.cos(u.yaw), syaw = Math.sin(u.yaw);
  const bf = bx * cyaw + by * syaw, bl = by * cyaw - bx * syaw; // the ball: metres ahead of him, and to his left
  // Steps grow from 0.4 m at a walk to 1.2 m at a sprint (a little shorter with the ball), quickly at first, so an easy
  // run is about 3 steps a second and a sprint 4.5 (pushing the ball out ahead, he strides as he would without it); and
  // the feet spend less time down. Held at a sprint (over 4.7 m/s for
  // more than about a second), he opens his stride to 1.5 m: a long sprint is about 3.6 to 4 steps a second.
  const E = run * (2 - run), Ls = 2 * lerp(.42, 1.22 + .28 * sm((m.hs - .5) / .7) * sm((m.gv - 4.7) / .5), E) * m.cf * lerp(1, .55, kj) * lerp(1, .7, clamp(-m.cx)), D = lerp(.6, .28, E), QT = D + .45 * (1 - D); // QT: where in its cycle a foot meets the ball (swinging through, just under his hips)
  const tm = carrying ? turnFoot(sim, a.id) : null, turning = carrying && !!b.move; // a turn with the ball (sim.js) owns the ball and one foot
  const dn = touchAt(a), dribble = carrying && w > .5 && !turning, cyc = dn - Math.floor(dn); // where he is between two dribble touches
  if (turning) m.spec = null;
  let act = m.spec; // one foot busy with the ball: taking a pass ('trap') or resting on top of it ('sole')
  // Kicks: with the foot the game picked for the play (see game/outcomes.js), or else the foot on the ball's side. A kick ends any other move.
  if (a.kickAt !== m.kickAt) { m.kickAt = a.kickAt; m.kf = a.kickFoot === 0 || a.kickFoot === 1 ? a.kickFoot : Math.abs(bl) > .05 ? +(bl > 0) : +(frac(a.kickAt * 3.3 + u.seed) < .5); act = m.spec = null; }
  if (dt > 0) {
    // With the ball he lengthens or shortens his steps so that a foot swings through at every touch. Which foot (the
    // nearer half step) is chosen once for each touch (tl; tlp: the touch before), and his step rate eases toward the
    // one that gets it there (none in the last moment before the touch), so his pace never changes all at once.
    let want = 1;
    if (dribble) {
      const ti = Math.floor(dn), left = (a.tL || 1.4) * (1 - cyc), at = m.pa + left / Ls - QT;
      if (m.tk !== ti) { m.tf = m.tk === ti - 1; m.tlp = m.tl; m.tk = ti; m.tR = Math.round(at * 2); m.tl = m.tR & 1 ? 0 : 1; }
      want = 1 + (clamp(1 - (at - m.tR / 2) * Ls / left, .65, 1.4) - 1) * sm((left - .1) / .3);
    } else m.tk = null;
    m.rate = damp(m.rate, want, 12, dt);
    m.hs = vs > 4.7 ? m.hs + dt : Math.max(0, m.hs - 3 * dt); // how long he has held a sprint
    m.cf = damp(m.cf, carrying ? .88 + .12 * sm(((a.tL || 1.4) - 1.4) / 1.2) : 1, 3, dt); // his stride's share with the ball (eased: a touch's length changes at once)
    m.pa += ds / Ls * m.rate; m.ph = frac(m.pa);
    m.ac0 = damp(m.ac0, (vs - m.pv) / dt, 8, dt); m.acc = damp(m.acc, m.ac0, 8, dt); m.pv = vs; // speeding up or slowing down, smoothed twice so the lean it gives never starts with a jerk
    m.bank = damp(m.bank, clamp(wrap(u.yaw - yaw0) / dt * vs * .012, -.3, .3), 7, dt);
    if (ds > 1e-4) { const rel = Math.atan2(a.y - m.y, a.x - m.x) - u.yaw; m.cx = damp(m.cx, Math.cos(rel), 12, dt); m.cy = damp(m.cy, Math.sin(rel), 12, dt); }
    // Stopping with the ball: more often than not a sole goes on top of it.
    if (carrying && !act && !turning && kt > .7 && m.sp >= 1.1 && a.sp < 1.1 && frac(u.seed + ++m.n * .618) < .65) act = m.spec = { k: 'sole', t: T, d: .8, leg: m.n & 1 };
  }
  m.t = now; m.x = a.x; m.y = a.y; m.sp = a.sp;
  // Skills (see the skills block above). sk: his own (sim.js skillNow); dsk: a dribble skill, sw how much it owns his
  // feet; fe, fs: how far his weight drops to a side (fs). A skill turn's fake: the far foot shapes to shoot (chop) or
  // to pass (cruyff) before its touch (fk: how far it is drawn back), and the standing foot plants beside the ball.
  const dsk = sk && !turning && DRIB_SKILL[sk.k] && sk.c >= 0 && sk.c < 1.3 ? sk : null;
  // The touch before a dribble skill (c from -1 to 0, see sim.js dribbleSkill) sets it up: he gets lower, his arms go
  // out and his weight starts toward the first fake, so the move shows coming before the feet do it.
  // (One the child tapped for comes in over a moment from the tap, wherever the set-up has got to.)
  const lead = sk && !turning && DRIB_SKILL[sk.k] && sk.c < 0 ? sm((sk.c + .7) / .7) * sm((now - sk.tap) / .15) * w : 0;
  let fe = 0, fs = 0, sw = 0, fk = 0, fkL = 0, pw = 0;
  if (dsk) {
    const c = dsk.c, rn = clamp(a.sp / 2.5); sw = sm(c / .25) * (1 - sm((c - 1.02) / .25)) * w;
    const L = a.tL || 1.4, pr = cc => .34 + rn * .55 * (1 - clamp(cc)) + longLead(L, clamp(cc)), dB = bf - pr(c); // where the ball will be: where it is now, moved on as the dribble rule moves it
    dribbleSkillFeet(dsk.k, c, cc => pr(cc) + dB, clamp(bl, -.2, .2), dsk.fake, L);
    const d = dropOf(dsk.k, c) + (dsk.k === 'scissors' ? -.4 : .4) * (1 - sm(c / .2)); fe = Math.abs(d) * Math.max(sw, 1 - sm(c / .2)) * w; fs = dsk.fake * Math.sign(d || 1); // the set-up lean hands over to the fake
  } else if (lead) { fe = .4 * lead; fs = sk.fake * (sk.k === 'scissors' ? -1 : 1); }
  else if (sk && turning && (sk.k === 'chop' || sk.k === 'cruyff')) {
    const u0 = sk.c, at = sk.at, q = clamp(u0 / (at * .95)), O = sk.fake > 0 ? 1 : 0; // the far foot: away from the way he turns
    fk = Math.sin(Math.PI * q) ** 1.5 * (u0 < at ? 1 : 0); fkL = O; fs = sk.fake; fe = .7 * fk;
    if (sk.k === 'cruyff') pw = sm((u0 - .02) / .2) * (1 - sm((u0 - .74) / .26));
  } else if (sk && turning && sk.k === 'croqueta') { fe = .6 * bump(sk.c, .05, .45, .95); fs = -sk.fake; }

  const K = KICK[a.kickKind] || KICK.pass, ks = m.kf ? 1 : -1;
  const kw = kt >= 0 && kt < .7 ? sm(kt / .12) * (1 - sm((kt - .46) / .24)) : 0;
  let kX = 0, kY = 0, kZ = 0, kP = 0;
  if (kw) { // the ankle goes to where its striking part meets the middle of the ball: the arch for a pass, the laces for a shot
    if (kt < .2) { const sh = K !== KICK.pass; m.bf = bf; m.bl = clamp(bl, -.24, .24); m.hit = clamp(bf - BALL - (sh ? .1 : .05), .02, .32); m.hitY = m.bl - ks * (sh ? .02 : .06); }
    kickFoot(kt, K, m.hit); kX = F.x; kZ = F.z; kP = F.p; kY = lerp(ks * .1, m.hitY, sm(kt / .2));
  }
  // Taking a pass: as it arrives he sets a foot for it (the inside of the foot, or the sole on top), then moves it on.
  // The foot he takes it with: the one farther from a defender close by (his body shields the ball); with nobody
  // close, the one on the side of the goal he attacks, so his body opens to the field (the "back foot"); else the
  // foot on the ball's side.
  if (!act && !kw && !turning && b.state === 'flying' && w < .6 && (1 - b.t) * b.dur < .3 && Math.hypot(b.tx - a.x, b.ty - a.y) < 1.3 && Math.hypot(b.fx - a.x, b.fy - a.y) > 1) {
    const gl = (a.team === 'them' ? 1 : -1) * syaw; let leg = Math.abs(gl) > .3 ? +(gl > 0) : Math.abs(bl) > .05 ? +(bl > 0) : m.n & 1, near = 3.5;
    for (let i = 0; i < sim.list.length; i++) { const o = sim.list[i], ox = o.x - a.x, oy = o.y - a.y, d = Math.hypot(ox, oy); if (o.team !== a.team && d < near) { near = d; leg = +(oy * cyaw - ox * syaw < 0); } }
    if (a.open != null) leg = +(turnSide(sim, a, Math.atan2(b.fy - a.y, b.fx - a.x), a.open) < 0); // he will turn as he takes it: the foot that turns it (sim.js plan, 'first')
    act = m.spec = { k: 'trap', t: now, hit: -1, leg, sole: frac(u.seed + ++m.n * .618) < .35 };
  }
  // Standing about: now and then he shifts his feet (the planted feet below step him there), glances round or (with the ball) rests a sole on it.
  let fid = m.fid;
  if (fid && T - fid.t > fid.d) fid = m.fid = null;
  if (!fid && !act && kt > .7 && idle > .8 && (T > m.next || Math.abs(wrap(aim - u.yaw)) > .3)) {
    const r = frac(Math.sin(T * 91.7 + u.seed) * 43758.5), k = T < m.next || r < .45 ? 'step' : carrying && r < .75 ? 'tap' : 'look';
    m.next = T + 2.5 + 4 * frac(r * 7.13);
    if (k === 'tap') act = m.spec = { k: 'sole', t: T, d: .95, leg: r < .6 ? 1 : 0 };
    else { fid = m.fid = { k, t: T, d: k === 'step' ? .5 : 1.2, s: r * 100 & 1 ? 1 : -1 }; if (k === 'step') m.stag = -m.stag; }
  }
  // The busy foot: how much (fW), which leg, where its ankle goes, and the foot's pitch and turn.
  let fW = 0, fLeg = 0, fx = 0, fy = 0, fz = 0, fp = 0, ft = 0;
  if (!tm) { m.pre = 1; m.prv = 0; }
  if (tm) { // turning with the ball: the foot sits against the ball on the side it pushes from (or on top, dragging it back)
    const sg = tm.leg ? 1 : -1, ph = wrap(Math.atan2(tm.dy, tm.dx) - u.yaw), nx = Math.cos(ph), ny = Math.sin(ph), k = tm.part;
    fW = tm.w; fLeg = tm.leg; m.pre = sdamp(m.pre, m.prv, tm.pre, .06, rdt); m.prv = SDV; const pre = m.pre; // pre: the foot still on its way (eased: the game's comes in a few hundredths)
    if (k === 'sole') { fx = bf - .06 - .1 * pre; fy = bl; fz = .3 + .08 * pre; fp = -.2; ft = sg * .2; }
    else { // inside: toes turned out so the arch faces the way the ball goes; outside: toes turned in; laces: toes on
      ft = k === 'inside' ? ph + sg * Math.PI / 2 : k === 'outside' ? ph - sg * Math.PI / 2 : ph; ft = wrap(ft); ft = sg * clamp(sg * ft, k === 'laces' ? -.6 : -1, k === 'laces' ? .6 : 1.6);
      const r = BALL + (k === 'laces' ? .12 : .05) + .1 * pre + (b.move.k === 'cruyff' || b.move.k === 'chop' ? .03 : 0), back = k === 'inside' ? .05 : k === 'outside' ? .07 : 0; // on its way it comes from that side, a little off the ball
      fx = bf - nx * r - Math.cos(ft) * back; fy = bl - ny * r - Math.sin(ft) * back; fz = (k === 'laces' ? .1 : .09) + .12 * pre; fp = k === 'laces' ? .5 : k === 'outside' ? .1 : -.15;
    }
  } else if (act && act.k === 'trap') {
    if (act.hit < 0 && b.state !== 'flying') act.hit = now;
    const c = act.hit < 0 ? 0 : now - act.hit, e = sm(c / .2);
    // Before it comes he sets the foot where the ball will stop (b.tx, b.ty); then the foot stays on the ball as it
    // gives a little (the cushion) and the ball settles at his feet.
    const tf = (b.tx - a.x) * cyaw + (b.ty - a.y) * syaw, tl = (b.ty - a.y) * cyaw - (b.tx - a.x) * syaw, f = act.hit < 0 ? tf : bf, l = clamp(act.hit < 0 ? tl : bl, -.14, .14);
    fW = sm((now - act.t) / .14) * (1 - sm((c - .22) / .28)) * (1 - sm((w - .3) / .5)); fLeg = act.leg; fy = l;
    if (act.sole) { fx = clamp(f - .05, .1, .42); fz = act.hit < 0 ? lerp(.4, .32, sm((now - act.t) / .28)) : lerp(.32, .3, e); fp = lerp(-.4, -.2, e); } // the sole meets the top of the ball
    else { fx = clamp(f - BALL - .06, .04, .3) - .04 * e * (1 - e) * 4; fy = l - (act.leg ? 1 : -1) * .06; fz = .09; fp = -.15; ft = (act.leg ? 1 : -1) * 1.45; }
    if (c > .5 || now < act.t || (act.hit < 0 && now - act.t > 1.2)) m.spec = null;
  } else if (act) {
    const c = T - act.t;
    fW = sm(c / .16) * (1 - sm((c - act.d + .24) / .24)) * idle; fLeg = act.leg;
    fx = clamp(bf - .06, .1, .34); fy = clamp(bl, -.14, .14); fz = .3; fp = -.2;
    if (c > act.d || !carrying) m.spec = null;
  }
  // Ready: defenders near the ball crouch on their toes; a player the pass comes to, and his friends near the ball,
  // stand on their toes with bent knees; the rest stand easier, each his own way. He breathes harder after a run,
  // and his weight drifts from one leg to the other.
  const passIn = !carrying && b.state === 'flying' && Math.hypot(b.tx - a.x, b.ty - a.y) < 1.6, left = passIn ? (1 - b.t) * b.dur : 9;
  m.ready = damp(m.ready, defending ? (bd < 7 ? 1 : .5) : carrying ? .4 : passIn ? .95 : ours && dc < 20 ? .6 : m.sr, 3, rdt);
  m.puff = damp(m.puff, run, run > m.puff ? .5 : .1, rdt); m.br += rdt * (2 + 2.5 * m.puff);
  const rd = m.ready * (.85 + .3 * m.se), breath = Math.sin(m.br) * (1 + 2 * m.puff), sway = Math.sin(T * .8 + u.seed * 2) + .5 * Math.sin(T * .33 + u.seed);
  const bounce = rd * rd * (.5 + .5 * Math.sin(T * 8.5 + u.seed * 3)), tip = .035 * sway * idle * (1 - .5 * rd);
  // A defender close in front of a dribbler doing a skill buys the fake a little (the picture only; the game moves him
  // as before): his weight shifts to the fake's side (rx ahead, ry to his left, rw how much) and that foot half-steps out.
  let rx = 0, ry = 0, rw = 0;
  if (defending && carrier && !carrying && dc < 5.5) {
    const q = skillNow(sim, carrier.id);
    if (q) { rw = (DRIB_SKILL[q.k] ? bump(q.c, .1, .5, 1.15) : bump(q.c, .03, Math.max(.2, q.at), q.at + .45) * (q.k === 'croqueta' || q.k === 'roll' ? .6 : 1)) * (1 - sm((dc - 3.5) / 2)); rx = q.fx * cyaw + q.fy * syaw; ry = q.fy * cyaw - q.fx * syaw; }
  }
  m.fb = damp(m.fb, fW, 12, rdt); m.fby = damp(m.fby, fW * (fLeg ? 1 : -1), 12, rdt); // his body's share of a busy foot, eased (its weight can start part way)
  // (round 13) A feint lunge by one who jockeys (window.js jockFeint): his weight goes in at the ball over his front foot,
  // a long half-step's worth (JAB), and back out, quicker than the game moves his place (a.x goes on along his way).
  const jf = a.track?.jf && !carrying ? a.track.jf(now - a.track.t0) : 0, jl = jf * JAB / Math.max(.3, bd);
  const ox = .18 * K[9] * kw * sm(kt / .2) + .05 * rw * rx + jl * bf; // striking, he steps his hips in over the ball (and his feet stay where they are)
  const oy = .03 * sway * idle * (1 - .5 * rd) - .08 * m.fby + .36 * fs * fe + .28 * rw * ry + jl * bl; // his body's shift to his left, over the leg that holds him (or to a fake: hips and shoulders sell it; round 10: his whole body steps 0.36 m to the side of the fake, drawn here: the game's own place for him, a.x, stays on the dribble's way)
  const hop = mood > 0 ? Math.abs(Math.sin(moodT * 7.5 + u.seed)) : 0, air = .3 * hop * mood;
  const q1 = m.ph, c1 = Math.cos(TAU * (q1 + .04)); // +1 as the left foot lands in front
  // The hips: lower when ready or sprinting, bobbing with each step (down as a running foot takes his weight).
  LIFT = -lerp(.012 + .075 * rd + .012 * bounce - .004 * breath, .02 + .04 * run + .08 * low, w) - w * lerp(-.012, .028, sm(run * 2)) * Math.cos(2 * TAU * (q1 - D / 2))
    - .03 * K[9] * kw - .04 * m.fb - .03 * (fe + rw) - .06 * jf + air - (mood > 0 ? .05 * (1 - hop) * mood : 0);
  const PITCH = sat(m.acc * .02, .16) + .05 * run, roll = -m.bank * .6 + fs * .32 * fe + .24 * rw * ry;
  CP = Math.cos(PITCH); SP = Math.sin(PITCH); CR = Math.cos(roll); SR = Math.sin(roll);
  g.position.set(a.x + cyaw * ox - syaw * oy, a.y + syaw * ox + cyaw * oy, LIFT); g.rotation.set(roll, PITCH, u.yaw);
  u.blob.position.set(-ox, -oy, .012 - LIFT); u.blob.rotation.set(-roll, -PITCH, 0); u.blob.scale.setScalar(1 - air);
  const twist = -w * lerp(.08, .2, run) * c1 - ks * kX * .5 * kw; // the hip on the leading leg's side goes forward
  // A dribble touch: the foot swinging through as the touch comes turns to send the ball on. Straight ahead it is
  // the laces; to push the ball across it is the inside of one foot or the outside of the other.
  // The foot meets the ball (tp) over the moment of the touch; it turns for it (tt) over a longer time, so the turn
  // eases in as it swings through and out as it lands. The touch's foot (tl) was chosen with the touch (above).
  const tf = m.tf ? 1 : 0, tp = dribble ? Math.max(sm((cyc - .7) / .3), tf * (1 - sm(cyc / .18))) : 0, tt = dribble ? Math.max(sm((cyc - .5) / .5), tf * (1 - sm(cyc / .3))) : 0; // tf: the touch just made was in this run of dribbling (not before a turn)
  const side = (cyc > .5 ? dribble && touchLen(sim, a) : a.tL || 1.4) > 1.4 ? 0 : SIDE[(((Math.floor(dn) + (cyc > .5 ? 1 : 0)) % 3) + 3) % 3], tl = cyc > .5 ? (dsk ? +(dsk.fake < 0) : m.tl) : m.tlp; // a dribble skill's last touch: the outside of the foot away from the fake; a long push: with the laces, straight on (the coming one as sim.js will choose it)
  const wid = lerp(.1, .16, rd) + (carrying ? .02 : 0) + .03 * kj + m.sw;

  // Eyes. The child's own player (hl 0) keeps his head down over the ball until he taps LOOK UP (game.js sets
  // `a.look`); everyone else plays with his head up. A scan: a quick look over one shoulder and back, every couple
  // of seconds while the ball is away from him, and once while a pass comes to him (his eyes are back on the ball
  // before it arrives). With the ball he looks up between dribble touches and down at each touch.
  const hl = a.id === 'hero' && a.look != null ? a.look : 1;
  if (!passIn) m.chk = false;
  let sc = m.scan; if (sc && (T - sc.t > .48 || T < sc.t)) sc = m.scan = null;
  if (!sc && hl > .5 && !mood && !kw && !act && !tm && kt > .7 && (carrying ? a.id !== 'hero' && w < .3 : bd > (defending ? 9 : 3.5)) && left > .6 && (T > m.ns || (passIn && !m.chk))) {
    const gr = wrap(gdir - u.yaw), br = wrap(toBall - u.yaw);
    sc = m.scan = { t: T, s: carrying ? (m.sn & 1 ? 1 : -1) * .6 : Math.abs(gr) > .6 ? Math.sign(gr) : -Math.sign(br) || 1 }; // the way he looks: to the goal he attacks, else away from the ball
    m.ns = T + 1.5 + 2.2 * frac(u.seed * 7.3 + ++m.sn * .618); if (passIn) m.chk = true;
  }
  const se = sc ? sm((T - sc.t) / .12) * (1 - sm((T - sc.t - .3) / .15)) : 0;
  const hu = (dribble && !kw ? sm((cyc - .14) / .14) * (1 - sm((cyc - .62) / .14)) : carrying && !turning && !act && !kw && w < .3 ? 1 : 0) * hl;
  // Asking for the ball: a friend of the player on the ball, in space and not far, puts an arm up now and then.
  let ea = 0;
  if (m.ask && T - m.ask.t > 1.5) m.ask = null;
  if (!m.ask && ours && carrier && dc > 4 && dc < 22 && vs < 2 && fd > 2.2 && !mood && kt > .7 && T > m.na) { m.ask = { t: T, i: wrap(gdir - u.yaw) > 0 ? 1 : 0 }; m.ai = m.ask.i; m.na = T + 3.5 + 3 * frac(u.seed * 3.9 + m.sn * .41); }
  m.ea = damp(m.ea, m.ask ? sm((T - m.ask.t) / .25) * (1 - sm((T - m.ask.t - 1.1) / .35)) * (ours && !passIn ? 1 : 0) : 0, 12, rdt); ea = m.ea; // (it comes down smoothly when the pass comes)
  // Holding off a defender close by: the arm on his side goes out (and he looks at him between touches).
  const fl_ = foe ? (foe.y - a.y) * cyaw - (foe.x - a.x) * syaw : 0, ksh = carrying && !kw ? 1 - sm((fd - 1.1) / .8) : 0, shs = fl_ > 0 ? 1 : -1;
  for (let i = 0; i < 2; i++) { // plain loops: this runs for six players every frame
    const leg = u.legs[i], sgn = i ? 1 : -1, q = i ? q1 : frac(q1 + .5);
    foot(q, D, Ls, run);
    // Standing, one foot is a little ahead (defending side-on, the inside foot well ahead). A standing foot stays where
    // it is on the grass; when his body has turned or moved away from it, or he shifts his stance, he steps it there
    // (one foot at a time, quickly): so he never slides, turns on the spot with small steps and brakes with short steps.
    let sx = sgn * (m.stag * .045 - m.ss * .13 * kj * kd) - (carrying ? .06 : 0), sy = sgn * wid + (sgn * ry > 0 ? .3 * ry * rw : 0), up = 0;
    const fl = m.fl[i], busy = kw || (fW && i === fLeg);
    if (w < .6 && !busy && !air) {
      const tx = a.x + cyaw * sx - syaw * sy, ty = a.y + syaw * sx + cyaw * sy;
      if (!fl.on) { fl.on = 1; fl.s = -1; fl.x = fl.px; fl.y = fl.py; }
      if (fl.s < 0 && m.fl[1 - i].s < 0 && Math.hypot(tx - fl.x, ty - fl.y) > .07) { fl.s = T; fl.fx = fl.x; fl.fy = fl.y; }
      if (fl.s >= 0) { const e = clamp((T - fl.s) / .2); fl.x = lerp(fl.fx, tx, sm(e)); fl.y = lerp(fl.fy, ty, sm(e)); up = Math.sin(Math.PI * e) * (1 - w); if (e >= 1) fl.s = -1; }
      const rx = fl.x - a.x, ry = fl.y - a.y; sx = cyaw * rx + syaw * ry; sy = cyaw * ry - syaw * rx;
    } else fl.on = 0;
    const heel = .1 * rd * (1 + bounce) + .2 * up;
    let x = lerp(sx, F.x * m.cx, w), y = lerp(sy - oy, sgn * lerp(lerp(.085, .05, run), .15, low) + F.x * m.cy, w); // feet step the way he moves, even sideways
    let z = lerp(ANKLE + .05 * up + TOE * Math.sin(heel), F.z, w), p = lerp(heel, F.p, w) + .3 * back, turn = sgn * (.16 + .1 * rd) * idle, kq = turn; // kq: the way the knee points (a foot turned well out or in turns the knee only part of the way, as a hip does)
    const tch = i === tl && (tp || tt);
    if (tch) { // the touch meets the ball: laces behind it (toes down), or the inside / outside of the foot on the side it pushes from (the knee opens with it a little)
      // where it meets the ball: up to the touch, behind the ball as it rolls in; after it, where it met it (the foot
      // swings on through; it does not chase the ball as the touch sends it away)
      if (cyc > .5) { m.tbx = clamp(bf - BALL - (side ? .07 : .12), -.05, .3); m.tby = bl - side * .12; }
      const ta = side * (sgn === side ? .3 : .6) * tt; x = lerp(x, m.tbx, tp * .5); y = lerp(y, m.tby, tp * .8); z = Math.max(z, .1 * tp); turn -= ta; kq -= .4 * ta; if (!side) p += .5 * tp;
    }
    // No foot goes into the ball (a foot busy with it, a kick or a skill's feet see to their own). How much this holds
    // a foot back is eased over a few hundredths of a second, as the ball rolls across in front of it in a turn.
    fl.nb = damp(fl.nb, carrying ? (1 - kw) * (i === fLeg ? 1 - fW : 1) * (1 - sw) * (turning ? 1 : sm((bf - .05) / .1)) * (1 - sm((z - .26) / .08)) * sm((BALL + .12 - Math.abs(y - bl)) / .1) : 0, 25, rdt);
    if (fl.nb > .001) x = lerp(x, Math.min(x, bf - BALL - (tch ? lerp(.19, .13, tp) : .19)), fl.nb);
    if (sw) { const f = SKF[i]; x = lerp(x, f[0], sw); y = lerp(y, f[1] - oy, sw); z = lerp(z, f[2], sw); p = lerp(p, f[3], sw); turn = lerp(turn, f[4], sw); kq = lerp(kq, f[4] * .65, sw); } // a dribble skill's feet
    if (fW && i === fLeg) { x = lerp(x, fx, fW); y = lerp(y, fy - oy, fW); z = lerp(z, fz, fW); p = lerp(p, fp, fW); turn = lerp(turn, ft, fW); kq = lerp(kq, ft * .65, fW); }
    if (fk && i === fkL) { const cj = sk.k === 'chop'; x = lerp(x, cj ? -.4 : -.3, fk); y = lerp(y, sgn * (cj ? .12 : .17) - oy, fk); z = lerp(z, cj ? .4 : .17, fk); p = lerp(p, cj ? .95 : .1, fk); turn = lerp(turn, sgn * (cj ? .25 : 1.2), fk); kq = lerp(kq, sgn * (cj ? .2 : .5), fk); } // the fake: drawn back to shoot (toes down) or to pass (toes out)
    if (pw && i !== fkL) { // the Cruyff's standing foot: planted beside the ball, on the side it goes behind him
      const id = b.move.t0; if (m.cp?.id !== id) { const lx = bf - .02, ly = bl + sgn * (BALL + .12); m.cp = { id, x: a.x + cyaw * lx - syaw * ly, y: a.y + syaw * lx + cyaw * ly }; }
      const rx_ = m.cp.x - a.x, ry_ = m.cp.y - a.y; x = lerp(x, cyaw * rx_ + syaw * ry_, pw); y = lerp(y, cyaw * ry_ - syaw * rx_ - oy, pw); z = lerp(z, ANKLE, pw); p = lerp(p, 0, pw); turn = lerp(turn, sgn * .3, pw); kq = lerp(kq, sgn * .3, pw);
    }
    if (kw) { // the kicking foot swings; the other is planted beside the ball
      if (i === m.kf) { x = lerp(x, kX, kw); y = lerp(y, kY, kw); z = lerp(z, kZ, kw); p = lerp(p, kP, kw); turn = lerp(turn, ks * K[8], kw); }
      else { x = lerp(x, clamp(m.bf - .09, -.05, .3), kw); y = lerp(y, m.bl - ks * (BALL + .1), kw); z = lerp(z, ANKLE + .05 * Math.sin(Math.PI * clamp(kt / .14)), kw); p *= 1 - kw; turn = lerp(turn, 0, kw); } // beside the ball, toes to the target
      kq = lerp(kq, i === m.kf ? ks * K[8] * lerp(.65, .4, w) : 0, kw);
    }
    if (air) { z += air * .85; p += .5 * hop * mood; }
    // Where his foot's pose comes from (a turn's touch and its part, a trap, a sole, a kick, a skill, a fake, a planted
    // foot, a dribble touch, a jump): when that changes, the foot goes on from where it was (see `join`).
    const key = (i === fLeg && fW > 0 ? (tm ? 4 + PART[tm.part] : act.k === 'trap' ? 2 : 3) : 0) + (kw > 0 ? 16 : 0) + (sw > 0 ? 32 : 0) + (fk > 0 && i === fkL ? 64 : 0) + (pw > 0 && i !== fkL ? 128 : 0) + (fl.on ? 256 : 0) + (tch ? 512 : 0) + (air > 0 ? 1024 : 0);
    const J = join(fl, key, x - ox, y, z, p, turn, kq, time, i === fLeg && tm && fW > 0 ? 34 : JW); // a foot going to the ball in a turn gets there sooner (about 0.1 s)
    if (bd < 1.2 && b.state !== 'flying' && !(kw && i === m.kf) && !(act?.k === 'trap' && i === fLeg) && !(tm && i === fLeg && fW > .5 && b.move.k === 'first')) bootOut(J, ox - bf, oy - bl, BALL, fl); else fl.bo = null; // (a kick's foot, a trap's and the foot taking a pass on with a turn meet it as they are made to)
    fl.px = a.x + cyaw * (J[0] + ox) - syaw * (J[1] + oy); fl.py = a.y + syaw * (J[0] + ox) + cyaw * (J[1] + oy); // where this foot is on the grass now
    leg.hip.position.x = -sgn * HALF * twist;
    fl.kn = sdamp(fl.kn, fl.kv, J[5], .1, rdt); fl.kv = SDV; // the knee's way round never snaps (the foot's place is not touched)
    reach(leg, J[0], J[1], J[2], J[3], J[4], fl.kn);
    const swing = (i ? c1 : -c1) * w * (1 - .6 * low); // each arm swings against the leg on its side, elbow bent more as it comes forward
    // Ready, his arms are a little out from his sides for balance (more when he defends); striking, they go out wide.
    let ax = sgn * (.1 + .08 * w + .2 * rd * idle + .22 * low + .012 * breath + .4 * K[9] * kw + (sgn === -fs ? .7 * fe : 0) + .35 * fk + .3 * rw),
      ay = swing * lerp(.4, .95, run) - idle * (.04 + .3 * rd + .12 * m.se - .03 * Math.sin(T * 1.1 + u.seed * 3 + i)) - .25 * low * w + sgn * ks * kX * 1.6 * K[9] * kw,
      ae = -(lerp(.2 + .3 * m.se + .9 * rd, lerp(.7, 1.5, sm(run * 1.6)), w) - .3 * swing * run) * (1 - .4 * kw);
    fl.sh = damp(fl.sh, sgn === shs ? ksh : 0, 10, rdt); // the arm toward the defender, out to hold him off (when he goes round to the other side, the arms change over smoothly)
    if (fl.sh > .001) { ax = lerp(ax, sgn * .95, fl.sh); ay = lerp(ay, -.3, fl.sh); ae = lerp(ae, -.4, fl.sh); }
    if (ea > .001 && i === m.ai) { ax = lerp(ax, -sgn * .4, ea); ay = lerp(ay, -2.75, ea); ae = lerp(ae, -.2, ea); } // a hand up, clear of his head (raised, a negative turn takes it out): "here!"
    u.arms[i].rotation.set(ax, ay, 0); u.elbows[i].rotation.y = ae;
  }
  // Chest: leans over ready knees and into a run, back on a kick's follow-through; shoulders turn against the hips.
  // When more of his weight is on one leg the hips tip and the shoulders stay level.
  m.lead = damp(m.lead, .35 * clamp(wrap(aim - u.yaw), -.6, .6), 14, rdt); // the chest turns ahead of the hips (eased: the way the game turns him can jump)
  const lean = lerp(.05 + .22 * rd + .012 * breath, .08 + .1 * run + .2 * low, w) + sat(m.acc * .012, .12) + K[9] * kw * (.1 - .28 * sm((kt - .2) / .2)) + .14 * m.fb; // over the ball as he strikes it, back a little after
  u.pelvis.rotation.set(tip, lean * .45, 0);
  // The chest turns ahead of the hips when he turns, and with his head when he scans.
  u.torso.rotation.set(roll * .5 - tip * .8 - fs * .3 * fe, lean * .55 + .01 * breath, w * lerp(.1, .24, run) * c1 + ks * kX * .5 * kw + fs * .35 * fe
    + m.lead + (sc ? .3 * sc.s * se : 0));
  // The head turns to the ball and looks down at it when it is close, and stays level as the chest moves; with the
  // ball and his head up he looks ahead (at a defender close by). A glance or a scan looks to one side.
  const look = fid && fid.k === 'look' ? sm((T - fid.t) / .25) * (1 - sm((T - fid.t - .8) / .4)) : 0, ball = bd > .25 ? clamp(wrap(toBall - u.yaw), -1.15, 1.15) : 0;
  m.hy = damp(m.hy, lerp(ball, foe && fd < 3 ? clamp(.6 * wrap(Math.atan2(foe.y - a.y, foe.x - a.x) - u.yaw), -.8, .8) : 0, hu), 9, rdt);
  m.hp = damp(m.hp, lerp(clamp(Math.atan2(1.25, bd + .3) * .8 - .05, 0, .62), .12, hu), dribble ? 14 : 9, rdt);
  u.head.rotation.set(-roll * .8, lerp(m.hp * (1 - look), .04, se) - (lean + PITCH) * .8, clamp(lerp(m.hy + look * (fid ? fid.s : 0) * .95, sc ? sc.s * 1.65 : 0, se), -1.7, 1.7) - u.torso.rotation.z);

  if (mood > 0) { // his team scored: jumping with both arms up
    for (let i = 0; i < 2; i++) {
      u.arms[i].rotation.x = lerp(u.arms[i].rotation.x, (i ? -.32 : .32) + .06 * Math.sin(moodT * 15 + i * 2 + u.seed), mood); // a V, clear of the head
      u.arms[i].rotation.y = lerp(u.arms[i].rotation.y, -2.85 + .3 * Math.sin(moodT * 15 + i * 2 + u.seed), mood);
      u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.25, mood);
    }
    u.torso.rotation.y = lerp(u.torso.rotation.y, -.1, mood); u.head.rotation.y = lerp(u.head.rotation.y, -.3, mood);
  } else if (mood < 0) { // the other team scored: shoulders and head drop
    u.torso.rotation.y = lerp(u.torso.rotation.y, .3, -mood); u.head.rotation.y = lerp(u.head.rotation.y, .45, -mood);
    for (let i = 0; i < 2; i++) u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.12, -mood);
  }
  if (u.face) u.face(a, sim, mood, moodT, time); // the face's own life (blinks, glances, moods), made in pro/rig.js
}
