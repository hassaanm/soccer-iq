// How the players move. The game moves each player as a point at a steady speed; this file turns that
// into a body in motion. Each foot follows a path (planted on the grass while it carries him, then lifted and
// swung through), the legs bend to reach their feet, steps get longer as he speeds up, and the whole body
// leans into speeding up, slowing down and turning. On top of that he handles the ball: he times his steps so
// a foot meets it at every dribble touch, passes with the inside of either foot, shoots with the inside of the
// laces, takes a pass with the inside of the foot (it gives with the ball) or the sole, puts his sole on the ball as
// he stops, and now and then sells a dummy. The foot for a pass or shot comes from the game (`a.kickFoot`). Standing, he
// shifts his weight, breathes and moves his feet. Turning a joint by a positive y angle swings its part back.
import * as THREE from 'three';
import { THIGH, SHIN, HALF } from './rig.js';

const TAU = Math.PI * 2, ANKLE = .06, TOE = .12, REACH = THIGH + SHIN - .004, BALL = .125; // BALL: the ball's radius (world.js)
const TOUCH = 1.4; // metres between dribble touches (as in sim.js)
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * clamp(t), sm = t => (t = clamp(t), t * t * (3 - 2 * t)), frac = v => v - Math.floor(v);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), damp = (v, to, rate, dt) => v + (to - v) * (1 - Math.exp(-rate * dt));

// The body's tilt for the player being posed (set by `animateRig`, read by `reach`).
let LIFT = 0, CP = 1, SP = 0, CR = 1, SR = 0;
const N = new THREE.Vector3(), E = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), QK = new THREE.Quaternion(), HINGE = new THREE.Vector3(0, 1, 0);
// From the grass's frame (ahead, left, up) into the tilted body's frame.
const tilt = v => { const x = v.x * CP - v.z * SP, z = v.x * SP + v.z * CP; return v.set(x, v.y * CR + z * SR, -v.y * SR + z * CR); };

// Bends one leg so its ankle is at (x, y, z): metres ahead, to his left, and above the grass. The toes point
// `pitch` down from level and `turn` to his left, and the knee points the same way as the toes. A place too far
// away gets a straight leg pointing at it.
function reach(leg, x, y, z, pitch, turn) {
  N.set(x, y, z - LIFT); tilt(N).sub(leg.hip.position);
  const d = clamp(N.length(), .2, REACH), ct = Math.cos(turn), st = Math.sin(turn), cp = Math.cos(pitch), sp = Math.sin(pitch);
  N.normalize();
  E.set(ct, st, 0); tilt(E).addScaledVector(N, -E.dot(N));               // the way the knee goes: square to the leg's line
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
// The kicking foot `t` seconds after the wind-up starts: drawn back, through the ball at 0.2 s (when the game
// sends the ball off) with the ankle at `hit` metres ahead, then on toward the target. A pass is the push pass: a
// short, low swing with the inside of the foot (toes turned out square to the target, ankle firm, toes a little
// up). A shot is a full swing from the hip with the inside of the laces (toes down and a little out), and he lands
// on the kicking foot.
const KICK = { // back x, back z, hit z, through x, through z, pitch back, pitch at the ball, pitch after, toes out, body, lands at x
  pass: [-.22, .13, .1, .42, .13, .1, -.15, -.15, 1.45, .45, 0],
  shot: [-.42, .42, .14, .56, .5, 1, .7, .4, .45, 1, .48],
};
function kickFoot(t, k, hit) {
  if (t < .1) { const e = sm(t / .1); F.x = lerp(.02, k[0], e); F.z = lerp(.08, k[1], e); F.p = lerp(.1, k[5], e); }
  else if (t < .2) { const e = ((t - .1) / .1) ** 2; F.x = lerp(k[0], hit, e); F.z = lerp(k[1], k[2], e); F.p = lerp(k[5], k[6], e); }
  else { const e = 1 - (1 - clamp((t - .2) / .16)) ** 2; F.x = lerp(hit, k[3], e); F.z = lerp(k[2], k[4], e); F.p = lerp(k[6], k[7], e); }
  if (k[10] && t > .36) { const e = sm((t - .36) / .16); F.x = lerp(F.x, k[10], e); F.z = lerp(F.z, ANKLE, e); F.p = lerp(F.p, 0, e); } // down onto the kicking foot
}
const SIDE = [0, 1, -1]; // which way each dribble touch sends the ball: straight on, to his left, to his right (matches sim.js)

// `time` is the clock of the picture, which keeps running when the game stops its own clock (`sim.time`).
export function animateRig(g, a, sim, mood = 0, moodT = 0, time = sim.time) {
  const u = g.userData, want = Math.atan2(a.face[1], a.face[0]), b = sim.ball, now = sim.time;
  let m = u.m;
  if (!m || u.yaw === null || m.rs !== sim.restores || Math.hypot(a.x - m.x, a.y - m.y) > 1.5) { // new, put back for a replay, or moved in one jump: start afresh
    m = u.m = { rs: sim.restores, t: now, rt: time, it: u.seed * 9, next: u.seed * 10 + 1, br: u.seed, x: a.x, y: a.y, sp: a.sp, ph: u.seed, acc: 0, bank: 0, cx: 1, cy: 0, hy: 0, hp: 0,
      ready: .3, puff: 0, stag: u.seed % 2 < 1 ? 1 : -1, fid: null, kickAt: a.kickAt, kf: 1, hit: .2, hitY: 0, bf: .34, bl: 0, spec: null, feint: null, ft: -9, n: Math.floor(u.seed * 3) };
    u.yaw = want;
  }
  const dt = clamp(now - m.t, 0, .05), rdt = clamp(time - m.rt, 0, .05), ds = Math.hypot(a.x - m.x, a.y - m.y), yaw0 = u.yaw;
  m.rt = time;
  if (dt > 0 || b.state !== 'flying') m.it += rdt; // his own clock for standing about; it stops only when the game freezes with the ball in the air
  const T = m.it;
  u.yaw += wrap(want - u.yaw) * (1 - Math.exp(-18 * (dt || rdt))); // while the game's clock is stopped he still turns, on the picture's clock
  const run = clamp(a.sp / 5.4), w = sm(a.sp / 1.1), idle = 1 - w, carrying = b.state === 'carried' && b.carrier === a.id;
  const cyaw = Math.cos(u.yaw), syaw = Math.sin(u.yaw), bx = b.x - a.x, by = b.y - a.y, bd = Math.hypot(bx, by);
  const bf = bx * cyaw + by * syaw, bl = by * cyaw - bx * syaw; // the ball: metres ahead of him, and to his left
  // Steps grow from 0.4 m at a walk to 1.2 m at a sprint (a little shorter with the ball), and the feet spend less time down.
  const Ls = 2 * lerp(.42, 1.22, run) * (carrying ? .88 : 1), D = lerp(.6, .31, run), QT = D + .72 * (1 - D); // QT: where in its cycle a foot meets the ball
  const dribble = carrying && w > .5, cyc = (a.dist % TOUCH) / TOUCH;
  let act = m.spec; // one foot busy with the ball: taking a pass ('trap') or resting on top of it ('sole')
  // Kicks: with the foot the game picked for the play (see game/outcomes.js), or else the foot on the ball's side. A kick ends any other move.
  if (a.kickAt !== m.kickAt) { m.kickAt = a.kickAt; m.kf = a.kickFoot === 0 || a.kickFoot === 1 ? a.kickFoot : Math.abs(bl) > .05 ? +(bl > 0) : +(frac(a.kickAt * 3.3 + u.seed) < .5); act = m.spec = m.feint = null; }
  const kt = a.kickAt != null ? now - a.kickAt : 9;
  if (dt > 0) {
    let adv = ds / Ls;
    if (dribble && cyc < .9) { // with the ball he lengthens or shortens his steps so that a foot swings through at every touch
      const left = TOUCH * (1 - cyc), at = m.ph + left / Ls - QT;
      adv *= clamp(1 - (at - Math.round(at * 2) / 2) * Ls / left, .6, 1.5);
    }
    m.ph = frac(m.ph + adv);
    m.acc = damp(m.acc, (a.sp - m.sp) / dt, 10, dt);
    m.bank = damp(m.bank, clamp(wrap(u.yaw - yaw0) / dt * a.sp * .012, -.3, .3), 7, dt);
    if (ds > 1e-4) { const rel = Math.atan2(a.y - m.y, a.x - m.x) - u.yaw; m.cx = damp(m.cx, Math.cos(rel), 12, dt); m.cy = damp(m.cy, Math.sin(rel), 12, dt); }
    // Stopping with the ball: more often than not a sole goes on top of it.
    if (carrying && !act && kt > .7 && m.sp >= 1.1 && a.sp < 1.1 && frac(u.seed + ++m.n * .618) < .65) act = m.spec = { k: 'sole', t: T, d: .8, leg: m.n & 1 };
    // Running at a defender with the ball: now and then he sells a dummy (drops a shoulder and swings a foot round the ball).
    if (dribble && run > .45 && !m.feint && kt > .7 && (now < m.ft || now - m.ft > 3.5)) for (let i = 0; i < sim.list.length; i++) {
      const o = sim.list[i], ox = o.x - a.x, oy = o.y - a.y, f = ox * cyaw + oy * syaw, l = oy * cyaw - ox * syaw;
      if (o.team !== a.team && f > .8 && f < 3.4 && Math.abs(l) < 1.5) { m.feint = { t: now, s: l > 0 ? 1 : -1 }; m.ft = now; break; }
    }
  }
  m.t = now; m.x = a.x; m.y = a.y; m.sp = a.sp;
  let fe = 0, fs = 0;
  if (m.feint) { const c = (now - m.feint.t) / .55; if (c >= 1 || c < 0 || !carrying) m.feint = null; else { fe = Math.sin(Math.PI * c) ** 2 * w; fs = m.feint.s; } }

  const K = a.kickKind === 'shot' ? KICK.shot : KICK.pass, ks = m.kf ? 1 : -1;
  const kw = kt >= 0 && kt < .7 ? sm(kt / .06) * (1 - sm((kt - .46) / .24)) : 0;
  let kX = 0, kY = 0, kZ = 0, kP = 0;
  if (kw) { // the ankle goes to where its striking part meets the middle of the ball: the arch for a pass, the laces for a shot
    if (kt < .2) { const sh = K === KICK.shot; m.bf = bf; m.bl = clamp(bl, -.14, .14); m.hit = clamp(bf - BALL - (sh ? .1 : .05), .02, .32); m.hitY = m.bl - ks * (sh ? .02 : .06); }
    kickFoot(kt, K, m.hit); kX = F.x; kZ = F.z; kP = F.p; kY = lerp(ks * .1, m.hitY, sm(kt / .2));
  }
  // Taking a pass: as it arrives he sets a foot for it (the inside of the foot, or the sole on top), then moves it on.
  // The foot he takes it with: the one farther from a defender close by (his body shields the ball); with nobody
  // close, the one on the side of the goal he attacks, so his body opens to the field (the "back foot"); else the
  // foot on the ball's side.
  if (!act && !kw && b.state === 'flying' && w < .6 && (1 - b.t) * b.dur < .3 && Math.hypot(b.tx - a.x, b.ty - a.y) < 1.3 && Math.hypot(b.fx - a.x, b.fy - a.y) > 1) {
    const gl = (a.team === 'them' ? 1 : -1) * syaw; let leg = Math.abs(gl) > .3 ? +(gl > 0) : Math.abs(bl) > .05 ? +(bl > 0) : m.n & 1, near = 3.5;
    for (let i = 0; i < sim.list.length; i++) { const o = sim.list[i], ox = o.x - a.x, oy = o.y - a.y, d = Math.hypot(ox, oy); if (o.team !== a.team && d < near) { near = d; leg = +(oy * cyaw - ox * syaw < 0); } }
    act = m.spec = { k: 'trap', t: now, hit: -1, leg, sole: frac(u.seed + ++m.n * .618) < .35 };
  }
  // Standing about: now and then he shifts his feet, glances round or (with the ball) rests a sole on it. Turning on the spot, his feet step round.
  let fid = m.fid;
  if (fid && T - fid.t > fid.d) fid = m.fid = null;
  if (!fid && !act && kt > .7 && idle > .8 && (T > m.next || Math.abs(wrap(want - u.yaw)) > .3)) {
    const r = frac(Math.sin(T * 91.7 + u.seed) * 43758.5), k = T < m.next || r < .45 ? 'step' : carrying && r < .75 ? 'tap' : 'look';
    m.next = T + 2.5 + 4 * frac(r * 7.13);
    if (k === 'tap') act = m.spec = { k: 'sole', t: T, d: .95, leg: r < .6 ? 1 : 0 };
    else { fid = m.fid = { k, t: T, d: k === 'step' ? .5 : 1.2, leg: r * 10 & 1, from: m.stag, s: r * 100 & 1 ? 1 : -1 }; if (k === 'step') m.stag = -m.stag; }
  }
  // The busy foot: how much (fW), which leg, where its ankle goes, and the foot's pitch and turn.
  let fW = 0, fLeg = 0, fx = 0, fy = 0, fz = 0, fp = 0, ft = 0;
  if (act && act.k === 'trap') {
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
  // Standing: defenders near the ball crouch ready on their toes; his own team stands easier. He breathes harder
  // after a run, and his weight drifts from one leg to the other.
  m.ready = damp(m.ready, a.team === 'them' ? (bd < 7 ? 1 : .5) : carrying ? .4 : .2, 3, rdt);
  m.puff = damp(m.puff, run, run > m.puff ? .5 : .1, rdt); m.br += rdt * (2 + 2.5 * m.puff);
  const rd = m.ready, breath = Math.sin(m.br) * (1 + 2 * m.puff), sway = Math.sin(T * .8 + u.seed * 2) + .5 * Math.sin(T * .33 + u.seed);
  const bounce = rd * rd * (.5 + .5 * Math.sin(T * 8.5 + u.seed * 3)), tip = .035 * sway * idle * (1 - .5 * rd);
  const ox = .18 * K[9] * kw * sm(kt / .2); // striking, he steps his hips in over the ball (and his feet stay where they are)
  const oy = .03 * sway * idle * (1 - .5 * rd) - .08 * fW * (fLeg ? 1 : -1); // his body's shift to his left, over the leg that holds him
  const hop = mood > 0 ? Math.abs(Math.sin(moodT * 7.5 + u.seed)) : 0, air = .3 * hop * mood;
  const q1 = m.ph, c1 = Math.cos(TAU * (q1 + .04)); // +1 as the left foot lands in front
  // The hips: lower when ready or sprinting, bobbing with each step (down as a running foot takes his weight).
  LIFT = -lerp(.012 + .075 * rd + .012 * bounce - .004 * breath, .02 + .04 * run, w) - w * lerp(-.012, .028, sm(run * 2)) * Math.cos(2 * TAU * (q1 - D / 2))
    - .03 * K[9] * kw - .04 * fW + air - (mood > 0 ? .05 * (1 - hop) * mood : 0);
  const PITCH = clamp(m.acc * .02, -.15, .17) + .05 * run, roll = -m.bank * .6 - fs * .13 * fe;
  CP = Math.cos(PITCH); SP = Math.sin(PITCH); CR = Math.cos(roll); SR = Math.sin(roll);
  g.position.set(a.x + cyaw * ox - syaw * oy, a.y + syaw * ox + cyaw * oy, LIFT); g.rotation.set(roll, PITCH, u.yaw);
  u.blob.position.set(-ox, -oy, .012 - LIFT); u.blob.rotation.set(-roll, -PITCH, 0); u.blob.scale.setScalar(1 - air);
  const twist = -w * lerp(.08, .2, run) * c1 - ks * kX * .5 * kw; // the hip on the leading leg's side goes forward
  // A dribble touch: the foot swinging through as the touch comes turns to send the ball on. Straight ahead it is
  // the laces; to push the ball across it is the inside of one foot or the outside of the other.
  const tw = dribble ? Math.max(sm((cyc - .78) / .2), 1 - sm(cyc / .12)) : 0, side = SIDE[(Math.floor(a.dist / TOUCH) + (cyc > .5 ? 1 : 0)) % 3];
  const tf = Math.abs(frac(q1 - QT + .5) - .5) < .25 ? 1 : 0, wid = lerp(.1, .16, rd) + (carrying ? .02 : 0);

  for (let i = 0; i < 2; i++) { // plain loops: this runs for six players every frame
    const leg = u.legs[i], sgn = i ? 1 : -1, q = i ? q1 : frac(q1 + .5);
    foot(q, D, Ls, run);
    let stag = m.stag, up = 0; // standing, one foot is a little ahead; a shuffle lifts each foot in turn and swaps them
    if (fid && fid.k === 'step') { const e = clamp((T - fid.t) / fid.d * 2 - (i === fid.leg ? 0 : 1)); stag = lerp(fid.from, m.stag, sm(e)); up = Math.sin(Math.PI * e); }
    const heel = .1 * rd * (1 + bounce) + .2 * up;
    let x = lerp(sgn * stag * .045 - (carrying ? .06 : 0), F.x * m.cx, w), y = lerp(sgn * wid - oy, sgn * lerp(.085, .05, run) + F.x * m.cy, w); // feet step the way he moves, even sideways
    let z = lerp(ANKLE + .05 * up + TOE * Math.sin(heel), F.z, w), p = lerp(heel, F.p, w), turn = sgn * (.16 + .1 * rd) * idle;
    if (tw && i === tf) { // the touch meets the ball: laces behind it (toes down), or the inside / outside of the foot on the side it pushes from
      x = lerp(x, clamp(bf - BALL - (side ? .07 : .12), .02, .3), tw * .8); y = lerp(y, bl - side * .12, tw * .8); z = Math.max(z, .1 * tw); turn -= side * (sgn === side ? .42 : .95) * tw; if (!side) p += .5 * tw;
    }
    if (carrying && !kw && !(fW && i === fLeg) && bf > .1 && z < .32) x = lerp(x, Math.min(x, bf - BALL - (tw && i === tf ? .13 : .19)), sm((BALL + .1 - Math.abs(y - bl)) / .05)); // no foot goes into the ball
    if (fe && sgn === fs && q > D) { const o = fe * Math.sin(Math.PI * (q - D) / (1 - D)); y += fs * .2 * o; z += .06 * o; turn += fs * .5 * o; }
    if (fW && i === fLeg) { x = lerp(x, fx, fW); y = lerp(y, fy - oy, fW); z = lerp(z, fz, fW); p = lerp(p, fp, fW); turn = lerp(turn, ft, fW); }
    if (kw) { // the kicking foot swings; the other is planted beside the ball
      if (i === m.kf) { x = lerp(x, kX, kw); y = lerp(y, kY, kw); z = lerp(z, kZ, kw); p = lerp(p, kP, kw); turn = lerp(turn, ks * K[8], kw); }
      else { x = lerp(x, clamp(m.bf - .09, -.05, .3), kw); y = lerp(y, m.bl - ks * (BALL + .1), kw); z = lerp(z, ANKLE + .05 * Math.sin(Math.PI * clamp(kt / .14)), kw); p *= 1 - kw; turn = lerp(turn, 0, kw); } // beside the ball, toes to the target
    }
    if (air) { z += air * .85; p += .5 * hop * mood; }
    leg.hip.position.x = -sgn * HALF * twist;
    reach(leg, x - ox, y, z, p, turn);
    const swing = (i ? c1 : -c1) * w; // each arm swings against the leg on its side, elbow bent more as it comes forward
    u.arms[i].rotation.set(sgn * (.1 + .08 * w + .08 * rd * idle + .012 * breath + .4 * K[9] * kw + (sgn === -fs ? .5 * fe : 0)),
      swing * lerp(.4, .95, run) - idle * (.04 + .3 * rd - .03 * Math.sin(T * 1.1 + u.seed * 3 + i)) + sgn * ks * kX * 1.6 * K[9] * kw, 0);
    u.elbows[i].rotation.y = -(lerp(.2 + .75 * rd, lerp(.7, 1.5, sm(run * 1.6)), w) - .3 * swing * run) * (1 - .4 * kw);
  }
  // Chest: leans over ready knees and into a run, back on a kick's follow-through; shoulders turn against the hips.
  // When more of his weight is on one leg the hips tip and the shoulders stay level.
  const lean = lerp(.05 + .22 * rd + .012 * breath, .08 + .1 * run, w) + clamp(m.acc * .012, -.1, .14) + K[9] * kw * (.1 - .28 * sm((kt - .2) / .2)) + .14 * fW; // over the ball as he strikes it, back a little after
  u.pelvis.rotation.set(tip, lean * .45, 0);
  u.torso.rotation.set(roll * .5 - tip * .8 - fs * .2 * fe, lean * .55 + .01 * breath, w * lerp(.1, .24, run) * c1 + ks * kX * .5 * kw + fs * .25 * fe);
  // Eyes on the ball: the head turns to it and looks down at it when it is close, and stays level as the chest
  // moves. A glance lifts the head and looks to one side.
  const look = fid && fid.k === 'look' ? sm((T - fid.t) / .25) * (1 - sm((T - fid.t - .8) / .4)) : 0;
  m.hy = damp(m.hy, bd > .25 ? clamp(wrap(Math.atan2(by, bx) - u.yaw), -1.15, 1.15) : 0, 9, rdt);
  m.hp = damp(m.hp, clamp(Math.atan2(1.25, bd + .3) * .8 - .05, 0, .62), 9, rdt);
  u.head.rotation.set(-roll * .8, m.hp * (1 - look) - (lean + PITCH) * .8, clamp(m.hy + (look ? look * fid.s * .95 : 0), -1.3, 1.3) - u.torso.rotation.z);

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
