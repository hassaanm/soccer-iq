// How the 'pro' players move. The game moves each player as a point at a steady speed; this file turns that
// into a body in motion. Each foot follows a path (planted on the grass while it carries him, then lifted and
// swung through), the legs bend to reach their feet, steps get longer as he speeds up, and the whole body
// leans into speeding up, slowing down and turning. Turning a joint by a positive y angle swings its part back.
import { lerp, TOUCH, TOUCH_TURN } from '../world.js';
import { HIP, THIGH, SHIN } from './rig.js';

const TAU = Math.PI * 2, ANKLE = .06, TOE = .12, REACH = THIGH + SHIN - .004, HALF = .085;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, sm = t => (t = clamp(t), t * t * (3 - 2 * t)), frac = v => v - Math.floor(v);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), damp = (v, to, rate, dt) => v + (to - v) * (1 - Math.exp(-rate * dt));

// The body's tilt for the player being posed (set by `animateRig`, read by `reach`).
let LIFT = 0, PITCH = 0, CP = 1, SP = 0, CR = 1, SR = 0;

// Bends one leg so its ankle is at (x, y, z): metres ahead, to his left, and above the grass. The foot points
// `pitch` down from level and `turn` outwards. A place too far away gets a straight leg pointing at it.
function reach(leg, x, y, z, pitch, turn) {
  z -= LIFT;
  const x1 = x * CP - z * SP, z1 = x * SP + z * CP, y1 = y * CR + z1 * SR, z2 = -y * SR + z1 * CR; // into the tilted body's frame
  const hp = leg.hip.position, dx = x1 - hp.x, dy = y1 - hp.y, dz = z2 - hp.z;
  const side = Math.atan2(dy, -dz), down = Math.hypot(dy, dz), d = clamp(Math.hypot(dx, down), .2, REACH);
  const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
  const h = Math.atan2(-dx, down) - Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
  leg.hip.rotation.set(side, h, turn); leg.knee.rotation.y = knee; leg.foot.rotation.y = pitch - PITCH - h - knee;
}

// Where one foot is at `q` (0 to 1) through a stride of `Ls` metres, of which it is on the grass for the part
// `D`. Fills F: x metres ahead of the hips, z the ankle's height, p the foot's pitch.
const F = { x: 0, z: 0, p: 0 };
function foot(q, D, Ls, run) {
  const xf = D * Ls * .5 + lerp(.02, -.15, run), xb = xf - D * Ls, strike = -.25 * (1 - .6 * run);
  if (q < D) { // on the grass: it stays where it landed while he passes over it, then the heel lifts to push off
    const u = q / D, push = .75 * sm((u - .6) / .4);
    F.x = lerp(xf, xb, u); F.p = strike * clamp(1 - u / .2) + push; F.z = ANKLE + TOE * Math.sin(push);
  } else {     // in the air: trails behind, the heel kicks up, the knee drives through, and it reaches for the grass
    const s = (q - D) / (1 - D), s2 = s * s, s3 = s2 * s, m = -Ls * (1 - D) * .7, up = Math.sin(Math.PI * Math.pow(s, .7));
    F.x = (2 * s3 - 3 * s2 + 1) * xb + (3 * s2 - 2 * s3) * xf + (2 * s3 - 3 * s2 + s) * m;
    F.z = lerp(ANKLE + TOE * Math.sin(.75), ANKLE, s) + lerp(.05, .3, run) * up * up;
    F.p = lerp(.75, strike, sm(s)) + .5 * run * Math.sin(Math.PI * s) * (1 - s);
  }
}
// The kicking foot: drawn back, through the ball at 0.2 s (when the game sends the ball off), then up and on.
function kickFoot(t) {
  if (t < .1) { const e = sm(t / .1); F.x = lerp(.02, -.36, e); F.z = lerp(.08, .36, e); F.p = lerp(.1, .9, e); }
  else if (t < .2) { const e = ((t - .1) / .1) ** 2; F.x = lerp(-.36, .22, e); F.z = lerp(.36, .11, e); F.p = lerp(.9, .55, e); }
  else { const e = 1 - (1 - clamp((t - .2) / .14)) ** 2; F.x = lerp(.22, .52, e); F.z = lerp(.11, .44, e); F.p = lerp(.55, .3, e); }
}

export function animateRig(g, a, sim, mood = 0, moodT = 0) {
  const u = g.userData, want = Math.atan2(a.face[1], a.face[0]), b = sim.ball;
  let m = u.m;
  if (!m || u.yaw === null || Math.hypot(a.x - m.x, a.y - m.y) > 1.5) { // new, or moved in one jump: start afresh
    m = u.m = { t: sim.time, x: a.x, y: a.y, sp: a.sp, ph: u.seed, acc: 0, bank: 0, cx: 1, cy: 0, hy: 0, hp: 0 }; u.yaw = want;
  }
  const dt = clamp(sim.time - m.t, 0, .05), ds = Math.hypot(a.x - m.x, a.y - m.y), yaw0 = u.yaw;
  u.yaw += wrap(want - u.yaw) * (1 - Math.exp(-18 * dt));
  const run = clamp(a.sp / 5.4), w = sm(a.sp / 1.1), idle = 1 - w, carrying = b.state === 'carried' && b.carrier === a.id;
  // Steps grow from 0.4 m at a walk to 1.2 m at a sprint (a little shorter with the ball), and the feet spend less time down.
  const Ls = 2 * lerp(.42, 1.22, run) * (carrying ? .88 : 1), D = lerp(.6, .31, run);
  if (dt > 0) {
    m.ph = frac(m.ph + ds / Ls);
    m.acc = damp(m.acc, (a.sp - m.sp) / dt, 10, dt);
    m.bank = damp(m.bank, clamp(wrap(u.yaw - yaw0) / dt * a.sp * .012, -.3, .3), 7, dt);
    if (ds > 1e-4) { const rel = Math.atan2(a.y - m.y, a.x - m.x) - u.yaw; m.cx = damp(m.cx, Math.cos(rel), 12, dt); m.cy = damp(m.cy, Math.sin(rel), 12, dt); }
  }
  m.t = sim.time; m.x = a.x; m.y = a.y; m.sp = a.sp;

  const low = a.team === 'them' ? 1 : .55, breath = Math.sin(sim.time * 2.1 + u.seed); // defenders stand lower
  const kt = a.kickAt != null ? sim.time - a.kickAt : 9, kw = kt >= 0 && kt < .62 ? sm(kt / .06) * (1 - sm((kt - .42) / .2)) : 0;
  let kX = 0, kZ = 0, kP = 0; if (kw) { kickFoot(kt); kX = F.x; kZ = F.z; kP = F.p; }
  const hop = mood > 0 ? Math.abs(Math.sin(moodT * 7.5 + u.seed)) : 0, air = .3 * hop * mood;
  const q1 = m.ph, c1 = Math.cos(TAU * (q1 + .04)); // +1 as the left foot lands in front
  // The hips: lower when ready or sprinting, bobbing with each step (down as a running foot takes his weight).
  LIFT = -lerp(.07 * low + .004 * breath, .02 + .04 * run, w) - w * lerp(-.012, .028, sm(run * 2)) * Math.cos(2 * TAU * (q1 - D / 2)) - .03 * kw + air - (mood > 0 ? .05 * (1 - hop) * mood : 0);
  PITCH = clamp(m.acc * .02, -.15, .22) + .05 * run; const roll = -m.bank * .6;
  CP = Math.cos(PITCH); SP = Math.sin(PITCH); CR = Math.cos(roll); SR = Math.sin(roll);
  g.position.set(a.x, a.y, LIFT); g.rotation.set(roll, PITCH, u.yaw);
  u.blob.position.z = .012 - LIFT; u.blob.rotation.set(-roll, -PITCH, 0); u.blob.scale.setScalar(1 - air);
  const twist = -w * lerp(.08, .2, run) * c1 - kX * .5 * kw; // the hip on the leading leg's side goes forward
  const cyc = (a.dist % TOUCH) / TOUCH, nudge = carrying && w > .3 && cyc < .18 ? TOUCH_TURN[Math.floor(a.dist / TOUCH) % 3] : 0;

  for (let i = 0; i < 2; i++) { // plain loops: this runs for six players every frame
    const leg = u.legs[i], sgn = i ? 1 : -1, q = i ? q1 : frac(q1 + .5);
    foot(q, D, Ls, run);
    let x = lerp(i ? .05 : -.04, F.x * m.cx, w), y = sgn * lerp(.115, lerp(.085, .05, run), w) + F.x * m.cy * w; // feet step the way he moves, even sideways
    let z = lerp(ANKLE, F.z, w), p = F.p * w, turn = sgn * .18 * idle;
    if (nudge && q > D + .2 * (1 - D)) turn += nudge;       // the swinging foot turns to push the ball on
    if (i && kw) { x = lerp(x, kX, kw); y = lerp(y, .07, kw); z = lerp(z, kZ, kw); p = lerp(p, kP, kw); turn = lerp(turn, .35, kw); }
    if (air) { z += air * .85; p += .5 * hop * mood; }
    leg.hip.position.x = -sgn * HALF * twist;
    reach(leg, x, y, z, p, turn);
    const sw = (i ? c1 : -c1) * w; // each arm swings against the leg on its side, elbow bent more as it comes forward
    u.arms[i].rotation.set(sgn * (.12 + .08 * w + .1 * idle + .45 * kw), sw * lerp(.4, .95, run) - idle * .3 * low + sgn * kX * 1.6 * kw, 0);
    u.elbows[i].rotation.y = -(lerp(.45 + .5 * low, lerp(.7, 1.5, sm(run * 1.6)), w) - .3 * sw * run) * (1 - .4 * kw);
  }
  // Chest: leans over ready knees and into a run, back on a kick's follow-through; shoulders turn against the hips.
  const lean = lerp(.24 * low + .012 * breath, .08 + .1 * run, w) + clamp(m.acc * .012, -.1, .14) - .2 * kw * clamp(kX / .5, -1, 1);
  u.torso.rotation.set(roll * .5, lean, w * lerp(.1, .24, run) * c1 + kX * .5 * kw);
  // Eyes on the ball: the head turns to it and looks down at it when it is close, and stays level as the chest moves.
  const bx = b.x - a.x, by = b.y - a.y, bd = Math.hypot(bx, by);
  m.hy = damp(m.hy, bd > .25 ? clamp(wrap(Math.atan2(by, bx) - u.yaw), -1.15, 1.15) : 0, 9, dt);
  m.hp = damp(m.hp, clamp(Math.atan2(1.25, bd + .3) * .8 - .05, 0, .62), 9, dt);
  u.head.rotation.set(-roll * .8, m.hp - (lean + PITCH) * .8, m.hy - u.torso.rotation.z);

  if (mood > 0) { // his team scored: jumping with both arms up
    for (let i = 0; i < 2; i++) {
      u.arms[i].rotation.y = lerp(u.arms[i].rotation.y, -2.75 + .3 * Math.sin(moodT * 15 + i * 2 + u.seed), mood);
      u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.25, mood);
    }
    u.torso.rotation.y = lerp(u.torso.rotation.y, -.1, mood); u.head.rotation.y = lerp(u.head.rotation.y, -.3, mood);
  } else if (mood < 0) { // the other team scored: shoulders and head drop
    u.torso.rotation.y = lerp(u.torso.rotation.y, .3, -mood); u.head.rotation.y = lerp(u.head.rotation.y, .45, -mood);
    for (let i = 0; i < 2; i++) u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.12, -mood);
  }
}
