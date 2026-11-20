// Fast mode's small rules, with no page and no 3D world, so the tests use them as they are: the spots he can tap, where
// his head may turn, where the camera looks when he does not drag, what a pass meets on its way, which friend the
// computer passes to, and when a steal is in time.
//
// The pitch: x from 0 (our goal) to L (theirs), y from 0 to W. Our team attacks +x.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerp = (a, b, k) => a + (b - a) * k;
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// Closest point on segment a→b to p, from t0 on (so the passer's own feet do not count).
export function onLane(p, a, b, t0 = .12) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, t0, 1);
  const x = a.x + dx * t, y = a.y + dy * t; return { t, x, y, d: Math.hypot(p.x - x, p.y - y), along: t * Math.sqrt(l2) };
}

// ---------- moving: a free tap, the marks only a guide ----------
// He can tap any point of the pitch (v84 round 2, the owner's "no gaps"): within NEAR_R m of him a jog (with the ball a
// close dribble), farther a sprint (a big push), the target brought in to FAR_MAX m that way and onto the pitch (EDGE m
// inside the lines); within STAY_R m of his feet, stay. Toward a defender too: running into one is his choice to make.
export const NEAR = 3, FAR = 7, EDGE = .7, BODY = 1.1, NEAR_R = 4.5, FAR_MAX = 9, STAY_R = .8;
export function moveTarget(me, p, L, W) {
  const dx = p.x - me.x, dy = p.y - me.y, d = Math.hypot(dx, dy);
  if (d < STAY_R) return { x: me.x, y: me.y, ring: 0 };
  const k = d > FAR_MAX ? FAR_MAX / d : 1;
  return { x: clamp(me.x + dx * k, EDGE, L - EDGE), y: clamp(me.y + dy * k, EDGE, W - EDGE), ring: d <= NEAR_R ? 1 : 2 };
}
// The guide on the grass: eight soft dots NEAR m round him and twelve small ticks on a faint ring FAR m out (the ring a
// broken line where it leaves the pitch: `dash`, 48 pieces). Marks off the pitch are left out; one on a player is not
// drawn (`hid`), but a tap there still works. Each mark: { x, y, ring, dir (0: toward the goal he attacks) }.
export const DIRS = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4), TICKS = 12, DASHES = 48;
const onPitch = (x, y, L, W) => x >= EDGE && x <= L - EDGE && y >= EDGE && y <= W - EDGE;
export function spots(me, others, L, W) {
  const out = [{ x: me.x, y: me.y, ring: 0, dir: -1 }];
  const add = (a, r, ring, dir) => { const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r; if (!onPitch(x, y, L, W)) return; out.push({ x, y, ring, dir, hid: others.some(o => Math.hypot(o.x - x, o.y - y) < BODY) }); };
  DIRS.forEach((a, i) => add(a, NEAR, 1, i));
  for (let i = 0; i < TICKS; i++) add(i * 2 * Math.PI / TICKS, FAR, 2, i * 8 / TICKS); // (dir: in eighths of a turn)
  return out;
}
export function dashes(me, L, W) { const out = []; for (let i = 0; i < DASHES; i++) { const a = (i + .5) * 2 * Math.PI / DASHES, x = me.x + Math.cos(a) * FAR, y = me.y + Math.sin(a) * FAR; if (x >= 0 && x <= L && y >= 0 && y <= W) out.push({ x, y, a }); } return out; }

// ---------- fixed spots (v93, the owner's D2: no free tapping on the grass) ----------
// He moves only to spots: marks on the grass at fixed places of the pitch (points of a hidden GRID m grid), made when a
// new set is due (he arrived, got the ball, stopped, or the ball changed hands) and never moved after. Each one is a
// real choice, a place worth going, by who has the ball (youth coaching: width and depth in attack, support at an
// angle, a run in behind; in defence pressure on the ball, cover goal-side, a passing lane shut):
//  - his ball ('mine'): toward goal, into the space ahead on either side, wide on either side, back to safety. Never
//    through one of theirs (a dribble into a defender is no choice to offer) and never next to one.
//  - a friend's ball ('ours'): open for a pass (a clear line from the ball and room), wide, a run in behind their last
//    defender, support behind the ball.
//  - theirs ('theirs'): press the ball (a spot goal-side of the carrier: he runs at him and stays on him), get goal-side
//    (between the ball and his own goal), shut a lane (on the line from the carrier to one of theirs), mark the most
//    dangerous one goal-side, cover.
//  - a loose ball ('loose'): the ball itself (he runs to it), and places as for a friend's ball and goal-side.
// SPOT_MIN to SPOT_MAX at a time, SPOT_GAP m apart, SPOT_IN m inside the lines, none on a player. `seen(p)` (optional):
// only spots he can see on screen (the page passes the camera's view). One spot is marked `best` (the hint pulses it).
export const GRID = 2, SPOT_IN = 1.4, SPOT_GAP = 2.8, SPOT_MIN = 5, SPOT_MAX = 7, SPOT_BODY = 1.3;
// A tap counts as the spot nearest to it on screen when it is within TAP_PX px of it (a share of the screen's height,
// at least TAP_PX0) or within TAP_M m of it on the grass: generous, for a child's finger. Farther from every spot: nothing.
export const TAP_PX0 = 64, TAP_PX = .17, TAP_M = 2.4;
const lattice = (c, r0, r1, L, W) => { const out = []; for (let x = Math.ceil((c.x - r1) / GRID) * GRID; x <= c.x + r1; x += GRID) for (let y = Math.ceil((c.y - r1) / GRID) * GRID; y <= c.y + r1; y += GRID) { if (x < SPOT_IN || x > L - SPOT_IN || y < SPOT_IN || y > W - SPOT_IN) continue; const d = Math.hypot(x - c.x, y - c.y); if (d >= r0 && d <= r1) out.push({ x, y, d }); } return out; };
const snapPt = (p, L, W) => ({ x: clamp(Math.round(p.x / GRID) * GRID, SPOT_IN, L - SPOT_IN), y: clamp(Math.round(p.y / GRID) * GRID, SPOT_IN, W - SPOT_IN) });
const nearest = (ps, p) => ps.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.y - p.y)), 99);
function choose(cands, firsts, ok0 = () => true) {
  const out = [], ok = p => ok0(p) && out.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= SPOT_GAP);
  for (const f of firsts) { const b = cands.filter(c => c.kind === f.kind && (f.side == null || c.side === f.side) && ok(c)).sort((p, q) => q.s - p.s)[0]; if (b) out.push(b); if (out.length >= SPOT_MAX) break; }
  for (const c of cands.slice().sort((p, q) => q.s - p.s)) { if (out.length >= SPOT_MAX || (out.length >= SPOT_MIN && c.s < -1)) break; if (!out.includes(c) && ok(c)) out.push(c); }
  return out;
}
// o: { me, state, carrier (the one on the ball, or where a pass to him goes), ball, mates (his friends, not him),
// foes (their outfield players), keeper (theirs, or null), L, W, seen }.
export function spotSet({ me, state, carrier = null, ball, mates = [], foes = [], keeper = null, L, W, seen = () => true }) {
  const all = keeper ? [...foes, keeper] : foes, bodies = [...mates, ...all], free = p => nearest(bodies, p) >= SPOT_BODY && seen(p);
  const goal = { x: L, y: W / 2 }, own = { x: 0, y: W / 2 }, room = p => nearest(all, p);
  let out = [];
  if (state === 'mine') {
    const ga = Math.atan2(goal.y - me.y, goal.x - me.x), gd0 = dist(me, goal), cands = [];
    for (const relax of [0, 1]) {
      for (const c of lattice(me, 2.6, 7.4, L, W)) {
        let path = 99; for (const o of all) path = Math.min(path, onLane(o, me, c, 0).d);
        const r = room(c); if (path < (relax ? 1 : 1.4) || r < (relax ? 1.5 : 2)) continue;
        const a = wrap(Math.atan2(c.y - me.y, c.x - me.x) - ga), aa = Math.abs(a), kind = aa < .45 ? 'goal' : aa < 1.15 ? 'space' : aa < 2.05 ? 'wide' : 'back';
        const edge = Math.min(c.y, W - c.y) < 2.5 ? .6 : 0;
        cands.push({ x: c.x, y: c.y, kind, side: Math.sign(a) || 1, s: (gd0 - dist(c, goal)) * .45 + Math.min(r, 5) * .5 - edge + (kind === 'back' ? 1.5 : 0) });
      }
      if (cands.filter(free).length >= 4) break;
    }
    out = choose(cands, [{ kind: 'goal' }, { kind: 'space', side: 1 }, { kind: 'space', side: -1 }, { kind: 'wide', side: 1 }, { kind: 'wide', side: -1 }, { kind: 'back' }], free);
  } else if (state === 'ours' && carrier) {
    const deep = foes.reduce((m, o) => Math.max(m, o.x), -1), cands = [];
    for (const c of lattice(me, 1.8, 9.5, L, W)) {
      const dc = dist(c, carrier); if (dc < 3.5 || dc > 12.5) continue;
      let lane = 99; for (const o of all) lane = Math.min(lane, onLane(o, carrier, c, .12).d);
      const r = room(c); if (r < 1.8) continue;
      const kind = c.x > deep + .5 && c.x > carrier.x + 2 && lane >= .9 ? 'behind' : c.x < carrier.x - 1 ? 'support' : Math.abs(c.y - carrier.y) > 5 ? 'wide' : 'open';
      cands.push({ x: c.x, y: c.y, kind, side: Math.sign(c.y - carrier.y) || 1, s: Math.min(lane, 3) * 1.2 + Math.min(r, 4) * .5 + (c.x - carrier.x) * .1 - Math.abs(dc - 7) * .15 - c.d * .05 - (lane < 1.2 ? 3 : 0) + (kind === 'behind' ? .6 : 0) });
    }
    out = choose(cands, [{ kind: 'behind' }, { kind: 'open' }, { kind: 'wide' }, { kind: 'support' }], free);
  } else if ((state === 'theirs' || state === 'loose') && (carrier || ball)) {
    const c = state === 'theirs' && carrier ? carrier : ball, ux = own.x - c.x, uy = own.y - c.y, l = Math.hypot(ux, uy) || 1, cands = [];
    if (state === 'theirs') cands.push({ x: clamp(c.x + ux / l * 1, .5, L - .5), y: clamp(c.y + uy / l * 1, .5, W - .5), kind: 'press', follow: 'carrier', s: 4 - Math.max(0, dist(me, c) - 4) * .4 });
    else cands.push({ x: clamp(ball.x, .5, L - .5), y: clamp(ball.y, .5, W - .5), kind: 'ball', follow: 'ball', s: 5 - dist(me, ball) * .2 });
    const gs = snapPt({ x: c.x + ux / l * Math.min(4, l * .5), y: c.y + uy / l * Math.min(4, l * .5) }, L, W); cands.push({ ...gs, kind: 'goalside', s: 3 });
    const them = state === 'theirs' ? foes.filter(o => Math.hypot(o.x - c.x, o.y - c.y) > 1.5) : [];
    const danger = r => 3 - dist(r, own) / 8 + Math.min(nearest(mates.concat(me), r), 4) * .4;
    for (const r of them.slice().sort((p, q) => danger(q) - danger(p))) {
      cands.push({ ...snapPt({ x: c.x + (r.x - c.x) * .45, y: c.y + (r.y - c.y) * .45 }, L, W), kind: 'lane', s: danger(r) });
      const vx = own.x - r.x, vy = own.y - r.y, vl = Math.hypot(vx, vy) || 1; cands.push({ ...snapPt({ x: r.x + vx / vl * 1.8, y: r.y + vy / vl * 1.8 }, L, W), kind: 'mark', s: danger(r) - .5 });
    }
    for (const p of lattice(me, 2, 10, L, W)) { const q = onLane(p, c, own, 0); if (q.d < 3.5 && dist(p, own) < dist(c, own) - 2) cands.push({ x: p.x, y: p.y, kind: 'cover', s: 1 - q.d * .3 - Math.abs(dist(p, c) - 5) * .15 }); }
    if (state === 'loose') for (const p of lattice(me, 2, 9, L, W)) { const r = room(p); if (r > 2.5 && p.x > c.x) cands.push({ x: p.x, y: p.y, kind: 'open', s: .5 + Math.min(r, 4) * .3 - p.d * .05 }); }
    out = choose(cands, [{ kind: state === 'theirs' ? 'press' : 'ball' }, { kind: 'goalside' }, { kind: 'lane' }, { kind: 'mark' }, { kind: 'lane' }], p => p.follow ? seen(p) : free(p));
  }
  if (out.length) { const b = out.reduce((p, q) => (q.s > p.s ? q : p)); b.best = true; }
  return out;
}
// The spot a tap means (or null): the nearest on screen within the tap radius, or within TAP_M m on the grass.
// spots: [{ ..., q: its point on the screen }]; g: the grass under the tap (or null).
export function spotAt(spots, x, y, g, h) {
  let best = null, bd = 1e9;
  for (const s of spots) { if (!s.q) continue; const d = Math.hypot(s.q[0] - x, s.q[1] - y); if (d < bd) { bd = d; best = s; } }
  if (best && bd <= Math.max(TAP_PX0, h * TAP_PX)) return best;
  if (g) { let gb = null, gd = 1e9; for (const s of spots) { const d = Math.hypot(s.x - g.x, s.y - g.y); if (d < gd) { gd = d; gb = s; } } if (gb && gd <= TAP_M) return gb; }
  return null;
}

// ---------- hints: the two or three really good places, after a while ----------
// When he has done nothing for HINT_S s (and is not on his way anywhere), the best places now pulse: with the ball,
// space ahead and away from the one who presses him; his team's ball, open space that gives the carrier a line to him;
// theirs, goal-side of the ball. Only places on the pitch and good enough (a score over 0) are given; at most three.
export const HINT_S = 3;
export const hintsDue = (now, lastAct, moving) => !moving && now - lastAct >= HINT_S;
export function hints({ me, ball, carrier, mine, ours, foes, L, W }) {
  const cand = [];
  for (const r of [NEAR, 5.5, FAR]) for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r; if (onPitch(x, y, L, W)) cand.push({ x, y }); }
  const room = p => foes.reduce((m, o) => Math.min(m, Math.hypot(o.x - p.x, o.y - p.y)), 99);
  let score;
  if (mine) { const press = foes.slice().sort((p, q) => dist(p, me) - dist(q, me))[0]; score = p => (p.x - me.x) * .35 + Math.min(room(p), 4) - (press ? Math.max(0, 3 - dist(press, p)) * 1.5 : 0) - 2.2; }
  else if (ours && carrier) score = p => { let lane = 9; for (const o of foes) lane = Math.min(lane, onLane(o, carrier, p, 0).d); const d = dist(carrier, p); return Math.min(lane, 3) + Math.min(room(p), 3) * .5 - Math.abs(d - 7) * .3 + (p.x - carrier.x) * .08 - 2.6; };
  else { const own = { x: 0, y: W / 2 }; score = p => { const c = onLane(p, ball, own, 0); return 2.5 - c.d * 1.2 - Math.abs(dist(p, ball) - 2.5) * .5; }; }
  const out = [];
  for (const p of cand.map(p => ({ ...p, s: score(p) })).filter(p => p.s > 0).sort((p, q) => q.s - p.s)) { if (out.every(q => dist(q, p) > 3)) out.push(p); if (out.length === 3) break; }
  return out;
}

// ---------- where his head may turn ----------
// He looks over the pitch, never off it: a way of looking is allowed when the pitch goes on for at least LOOK_MIN m that
// way from where he stands (near a side line he looks along it or across the pitch, not into the stands). The yaw he
// wants is moved to the nearest allowed one.
export const LOOK_MIN = 7;
export const reachOut = (p, a, L, W) => { // m from p to the edge of the pitch, looking along a
  const c = Math.cos(a), s = Math.sin(a); let t = 1e9;
  if (c > 1e-6) t = Math.min(t, (L - p.x) / c); else if (c < -1e-6) t = Math.min(t, -p.x / c);
  if (s > 1e-6) t = Math.min(t, (W - p.y) / s); else if (s < -1e-6) t = Math.min(t, -p.y / s);
  return Math.max(0, t);
};
export function clampYaw(p, yaw, L, W, min = LOOK_MIN) {
  const need = Math.min(min, Math.max(L, W) * .3);
  if (reachOut(p, yaw, L, W) >= need - 1e-6) return wrap(yaw);
  let best = null, bd = 1e9;
  for (let i = 0; i < 144; i++) { const a = -Math.PI + i * Math.PI / 72; if (reachOut(p, a, L, W) < need) continue; const d = Math.abs(wrap(a - yaw)); if (d < bd) { bd = d; best = a; } }
  return best == null ? Math.atan2(W / 2 - p.y, L / 2 - p.x) : best;
}

// ---------- where the camera looks by itself ----------
// With the ball: at the goal he attacks. Without it: at the ball, and when the ball is right by him, a little toward the
// goal he attacks too (a ball at his feet gives no direction). Then kept over the pitch (clampYaw).
export function naturalYaw(me, ball, hasBall, L, W) {
  // (the ball and the goal are on the pitch: looking at them is never looking off it, however near the line they are)
  const toGoal = Math.atan2(W / 2 - me.y, L - me.x), dg = Math.hypot(L - me.x, W / 2 - me.y);
  if (hasBall) return clampYaw(me, toGoal, L, W, Math.min(LOOK_MIN, dg));
  const d = dist(me, ball), toBall = Math.atan2(ball.y - me.y, ball.x - me.x);
  if (d < 2.5) { const k = d / 2.5; return clampYaw(me, Math.atan2(Math.sin(toBall) * k + Math.sin(toGoal) * (1 - k), Math.cos(toBall) * k + Math.cos(toGoal) * (1 - k)), L, W, Math.min(LOOK_MIN, d + 1)); }
  return clampYaw(me, toBall, L, W, Math.min(LOOK_MIN, d));
}

// The camera behind and above him, by how far his head is up (look, 0 head down … 1 up), as the game's own player view
// does it (js/game/view.js; ported in the Lab's eyes.js): back, to the side, height, ahead, toward the ball, target
// height, focal lengths (height, width).
// (v93) Head up is the Slow game's own head-up view (js/game/view.js: 5.2 m back, 2.8 m up, looking 9 m ahead at 0.5 m,
// focal .9 / .52): the owner found the Fast view "too high or too different" (before: 4.4 m up, looking down at the grass
// 7.5 m ahead, then raised up to 9 m and tipped down to 63° by fitPitch).
export const DOWN = [3.1, 1.3, 2.9, 3.5, .25, .8, 1.05, .64], UP = [5.2, .3, 2.8, 9, 0, .5, .9, .52];
export function camSpec(me, ball, carried, yaw, look) {
  const k = sm(look), C = DOWN;
  const [bx, by] = rot(-lerp(C[0], UP[0], k), lerp(C[1], UP[1], k), yaw), [fx, fy] = rot(UP[3], 0, yaw);
  let dx, dy;
  if (carried) { const [ax, ay] = rot(.45, 0, yaw); dx = me.x + ax; dy = me.y + ay; }
  else { const [ax, ay] = rot(C[3], 0, yaw); const ahead = (ball.x - me.x) * Math.cos(yaw) + (ball.y - me.y) * Math.sin(yaw) > 0; dx = lerp(me.x + ax, ball.x, ahead ? C[4] : 0); dy = lerp(me.y + ay, ball.y, ahead ? C[4] : 0); }
  return { eye: [me.x + bx, me.y + by, lerp(C[2], UP[2], k)], tgt: [lerp(dx, me.x + fx, k), lerp(dy, me.y + fy, k), lerp(C[5], UP[5], k)], Ff: lerp(C[6], UP[6], k), Fw: lerp(C[7], UP[7], k) };
}
// Where a point lands on a w x h screen for a camera spec (as js/world.js render sets up three.js: z up, the focal
// length the larger of h·Ff and w·Fw), or null behind the camera. For the tests and the counts.
export function project(cam, p, w, h) {
  const e = cam.eye, t = cam.tgt; let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2]; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fy * 1 - fz * 0, ry = fz * 0 - fx * 1, rz = 0; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; // right = forward × up(z)
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const vx = p.x - e[0], vy = p.y - e[1], vz = (p.z || 0) - e[2], z = vx * fx + vy * fy + vz * fz; if (z < .1) return null;
  const F = Math.max(h * cam.Ff, w * (cam.Fw || 0));
  return [w / 2 + (vx * rx + vy * ry + vz * rz) / z * F, h / 2 - (vx * ux + vy * uy + vz * uz) / z * F];
}
export const onScreen = (s, w, h, m = 6) => !!s && s[0] > m && s[0] < w - m && s[1] > m && s[1] < h - m;

// ---------- a pass on its way ----------
// A pass is a real ball: anyone of theirs who can get a foot to its line before it passes takes it. For each of their
// players: the point of the line nearest him, how long the ball takes to get there, and how long he takes to put a foot
// there (REACH m of it is his reach standing; beyond that he runs at RUN m/s after a REACT s start). The first one who
// gets there in time cuts it out, there (null: it gets through). Also used in flight, frame by frame, with the ball's
// own place: a ball that goes through a body (BODY_R m) low enough (under 1.2 m) is his, whatever was planned.
export const REACH = .75, RUN = 4.8, REACT = .2, BODY_R = .42;
export function cutBy(from, to, speed, foes, run = RUN, react = REACT, margin = 0) { // (margin: m more reach, for a stricter "open")
  const d = dist(from, to) || 1; let best = null;
  for (const o of foes) {
    const c = onLane(o, from, to, Math.min(.5, 1 / d)), tBall = c.along / speed, need = Math.max(0, c.d - REACH - margin), tFoot = need ? react + need / run : 0;
    if (tFoot <= tBall && c.t < .97 && (!best || c.along < best.along)) best = { id: o.id, x: c.x, y: c.y, along: c.along, t: tBall };
  }
  return best;
}
// The ball in flight passes through a body: the first of `foes` within BODY_R m of it while it is low.
export const bodyHit = (ball, foes) => ((ball.z || 0) < 1.2 && (ball.fx == null || Math.hypot(ball.x - ball.fx, ball.y - ball.fy) > 1) ? foes.find(o => Math.hypot(o.x - ball.x, o.y - ball.y) < BODY_R) || null : null); // (not in the first metre: the passer's own foot plays it past a defender on his toes)

// ---------- who the computer passes to ----------
// opts: the open friends, best first ({ m, fwd }). His player (`fav`) is picked `w` to 1 over each other open friend,
// unless another is far better placed (6 m or more farther forward). His player is in opts only when his line is open.
export function pickPass(opts, fav, w = 1.6, rnd = Math.random) {
  const f = fav && opts.find(o => o.m === fav); if (!f) return opts[0]?.m ?? null;
  const others = opts.filter(o => o !== f), great = others.find(o => o.fwd > f.fwd + 6); if (great) return great.m;
  const r = rnd() * (w + others.length); if (r < w) return f.m; return others[Math.floor(r - w)]?.m ?? f.m;
}

// ---------- a steal ----------
// The ball off the carrier's foot (OFF m or more from him, between touches) and within his own reach of it (STEAL_R m)
// opens a steal window (match.js: it lasts by the level, at least 0.7 s at the default); a press in it wins.
export const OFF = .62, STEAL_R = 1.5, CLOSE_TO = 2.4;
export const stealNow = (carrier, ball, me) => dist(carrier, ball) >= OFF && dist(me, ball) <= STEAL_R;
export const stealShown = (carrier, me) => dist(carrier, me) <= CLOSE_TO;

// ---------- his head ----------
// Coaching (see the report): look round before the ball comes, eyes on the ball for the first touch, then head up to
// carry it with the ball low in sight. So his head goes down only as a ball comes to him (a pass, a loose ball, one he
// wins); never for his own dribble or push, and never without the ball.
export const RECEIVE = new Set(['pass', 'loose', 'cut', 'tackle', 'steal', 'block', 'save']);
export const headDownOn = (id, me, how) => id === me && RECEIVE.has(how);

// ---------- a press: a tap or a hold ----------
// A finger that lifts within HOLD_S s without sliding is a tap (it acts); one held longer, or slid, is a hold (it slows
// the world and looks round), wherever it went down: on the grass, a spot, a friend or a button. A child's slow tap
// still acts (v86): one that lifts within SLOW_TAP s without sliding acts on the lift too, after the world slowed a
// moment (pressActs).
export const HOLD_S = .25, SLIDE_PX = 12, SLOW_TAP = .6;
export const pressKind = (secs, slid) => (slid || secs > HOLD_S ? 'hold' : 'tap');
export const pressActs = (secs, slid) => !slid && secs <= SLOW_TAP;

// ---------- friends he cannot see: chips at the edge of the screen ----------
// friends: [{ id, seenAt (when he last had him on screen, s), on (on screen now) }]. A chip for each friend off screen
// whom he saw within FADE s, fading out over the last FADE_OUT s; gold (and a pass when tapped) only while he has the ball.
export const FADE = 6, FADE_OUT = 1.5;
export function chipList(friends, now, has) {
  return friends.filter(f => !f.on && f.seenAt != null && now - f.seenAt < FADE)
    .map(f => ({ id: f.id, alpha: clamp((FADE - (now - f.seenAt)) / FADE_OUT, 0, 1), gold: !!has, tap: !!has }));
}
// Where a chip sits: on the screen's edge (inset m px), toward the screen point q of the place he last saw him (q may
// be off screen, or behind: then it is mirrored). Returns [x, y].
export function edgeAt(q, behind, w, h, m = 34) {
  let x = q[0], y = q[1]; if (behind) { x = w - x; y = h + Math.abs(h - y); }
  const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy, k = Math.min(Math.abs(dx) > 1e-6 ? (cx - m) / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? (cy - m) / Math.abs(dy) : 1e9);
  return k >= 1 ? [clamp(x, m, w - m), clamp(y, m, h - m)] : [cx + dx * k, cy + dy * k];
}

// ---------- where a small hint sits (the scan reminder, the hold hint) ----------
// Never over a goal or a player he needs: of the places it may sit (HINT_AT, as shares of the screen: low in the
// middle, low left and right of it, high in the middle, halfway up on either side), the one whose box (HINT_BOX px)
// is farthest from every point in `avoid` (screen points: his player, the ball, the goals, his friends, theirs near
// him). Returns [x, y], the box's middle.
export const HINT_AT = [[.5, -44], [.33, -44], [.67, -44], [.5, 96], [.27, .5], [.73, .5]], HINT_BOX = [150, 52];
export function hintSpot(avoid, w, h) {
  let best = null, bd = -1;
  for (const [fx, fy] of HINT_AT) {
    const x = fx * w, y = fy < 0 ? h + fy : fy > 1 ? fy : fy * h, bx = HINT_BOX[0] / 2, by = HINT_BOX[1] / 2;
    const d = avoid.reduce((m, p) => (p ? Math.min(m, Math.hypot(Math.max(0, Math.abs(p[0] - x) - bx), Math.max(0, Math.abs(p[1] - y) - by))) : m), 1e9);
    if (d > bd + 20) { bd = d; best = [x, y]; } // (the first places win a near tie: low in the middle where it was)
  }
  return best;
}

// ---------- the pitch fills the picture ----------
// The share of screen rows whose middle pixel looks at the pitch (not the stands, the boards or the sky), for a camera
// spec on a w x h screen (n rows sampled).
export function rowsOnPitch(cam, w, h, L, W, n = 40) {
  const e = cam.eye, t = cam.tgt; let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2]; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx, k = (h / 2) / Math.max(h * cam.Ff, w * (cam.Fw || 0));
  let on = 0;
  for (let i = 0; i < n; i++) {
    const yn = 1 - (i + .5) / n * 2, dx = fx + ux * yn * k, dy = fy + uy * yn * k, dz = fz + uz * yn * k;
    if (dz >= -1e-6) continue; const s = -e[2] / dz, x = e[0] + dx * s, y = e[1] + dy * s;
    if (x >= 0 && x <= L && y >= 0 && y <= W) on++;
  }
  return on / n;
}
// The share of the whole picture that is pitch (cols x n points over the screen), the measure the owner sees.
export function pitchShare(cam, w, h, L, W, n = 24, cols = 9) {
  const e = cam.eye, t = cam.tgt; let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2]; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx, F = Math.max(h * cam.Ff, w * (cam.Fw || 0));
  let on = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < cols; j++) {
    const sx = ((j + .5) / cols - .5) * w / F, sy = -((i + .5) / n - .5) * h / F, dx = fx + rx * sx + ux * sy, dy = fy + ry * sx + uy * sy, dz = fz + uz * sy;
    if (dz >= -1e-6) continue; const k = -e[2] / dz, x = e[0] + dx * k, y = e[1] + dy * k; if (x >= 0 && x <= L && y >= 0 && y <= W) on++;
  }
  return on / n / cols;
}
// The camera made to fill the picture with the pitch (FILL of the rows): its eye brought back over the pitch along the
// line to him (never past him), then raised and tipped down step by step until the pitch fills it, as long as his player
// and the points in `keep` (the ball) stay on screen and it never looks down more steeply than TILT_MAX (never a view
// from the top). `pull` (0 … 1): how far the eye is brought in over the pitch first (1: all the way; 0: it may stay out
// over a line, looking in). Changes and returns `cam`.
// (v93) The pitch is still kept in the picture near the lines (viewSearch turns the view along the pitch), but never by a
// high view: the eye goes up to EYE_MAX m at most (the Slow view: 2.8 m) and looks down no more than TILT_MAX (before:
// 9 m and 63°, a view from above).
export const FILL = .7, SHARE = .62, TILT_MAX = .26, EYE_MAX = 3.2; // (SHARE: of the whole picture, as the owner sees it; TILT_MAX: rad below level, 15°; the Slow view looks down 9°)
const tilt = c => Math.atan2(c.eye[2] - c.tgt[2], Math.hypot(c.tgt[0] - c.eye[0], c.tgt[1] - c.eye[1]));
export function fitPitch(cam, me, w, h, L, W, keep = [], pull = 1) {
  const e = cam.eye, t = cam.tgt, m = .3, inside = () => e[0] >= m && e[0] <= L - m && e[1] >= m && e[1] <= W - m;
  const ok = () => onScreen(project(cam, { x: me.x, y: me.y, z: .5 }, w, h), w, h, 8) && keep.every(p => onScreen(project(cam, p, w, h), w, h, 12)) && tilt(cam) <= TILT_MAX; // (the ball on screen, not at its very edge)
  if (pull > 0) {
    const o = [...e];
    if (!inside()) { const s0 = [...e]; e[0] = clamp(e[0], m, L - m); e[1] = clamp(e[1], m, W - m); if (!ok()) e.splice(0, 3, ...s0); } // (moved in over the line, if he stays in view)
    for (let i = 0; i < 12 && !inside() && Math.hypot(e[0] - me.x, e[1] - me.y) > 3; i++) { const s0 = [...e], k = .9; e[0] = me.x + (e[0] - me.x) * k; e[1] = me.y + (e[1] - me.y) * k; if (!ok()) { e.splice(0, 3, ...s0); break; } }
    if (pull < 1) { e[0] = o[0] + (e[0] - o[0]) * pull; e[1] = o[1] + (e[1] - o[1]) * pull; }
  }
  // (the ball not on screen, as while the view is still turning to it: back and up a little at a time until it is)
  for (let i = 0; i < 16 && !keep.every(p => onScreen(project(cam, p, w, h), w, h, 12)); i++) { const s0 = [...e], fx = t[0] - e[0], fy = t[1] - e[1], fl = Math.hypot(fx, fy) || 1; e[0] -= fx / fl * .4; e[1] -= fy / fl * .4; e[2] = Math.min(EYE_MAX + 1.5, e[2] + .1); if (!onScreen(project(cam, { x: me.x, y: me.y, z: .5 }, w, h), w, h, 8)) { e.splice(0, 3, ...s0); break; } } // (never losing him for it)
  const score = () => rowsOnPitch(cam, w, h, L, W, 20) + pitchShare(cam, w, h, L, W, 10, 7);
  cam.best = score();
  for (let i = 0; i < 40 && (rowsOnPitch(cam, w, h, L, W, 20) < FILL || pitchShare(cam, w, h, L, W, 10, 7) < SHARE); i++) {
    const s0 = [...e], t0 = [...t];
    if (e[2] < EYE_MAX) e[2] = Math.min(EYE_MAX, e[2] + .15); t[2] -= .2; t[0] = me.x + (t[0] - me.x) * .97; t[1] = me.y + (t[1] - me.y) * .97;
    const sc = score();
    if (!ok() || sc < (cam.best ?? -1) - 1e-6) { e.splice(0, 3, ...s0); t.splice(0, 3, ...t0); break; } cam.best = sc; // (a step that loses him or the ball, looks down too steeply, or shows less pitch, is taken back)
  }
  return cam;
}
// ---------- the default view near the lines (v86) ----------
// The view he does not steer: camSpec at a yaw, the eye moved `side` m sideways (toward the middle of the pitch) and
// brought in over the pitch by `pull`, then fitted (fitPitch). Where the natural view (naturalYaw, side 0, pull 1) shows
// less than SHARE of pitch (near a side line, a goal line, a corner), viewPick tries others close to it: the yaw turned
// up to VIEW_SPAN rad along the pitch, the eye up to 4 m in from the line, or left out over the line looking in, and
// keeps the one that shows the most pitch for the least change (VIEW_COST per rad turned), always with him and the ball
// on screen, clear of the bar along the top; in a corner also close behind him and lower, looking into the pitch (`close`). fast.js eases to it (the
// turn capped at TURN_MAX rad/s, the side, the pull and the closeness at their own rates).
export const VIEW_SPAN = .9, VIEW_COST = .25, VIEW_SIDES = [0, 2, 4];
export const CLOSE = [4.4, 2.9, 7, .3], CLOSE_B = [4.6, 3.2, 3, -.2]; // (v93: lower, as the head-up view; before 4 m up and looking down steeply) // (the close view in a corner: back, height, ahead, target height; `close` 0 … 1 to CLOSE, 1 … 2 on to CLOSE_B, looking down at him from over the line)
export function viewCam(me, ball, has, v, look, w, h, L, W, keep = [ball]) {
  const c = camSpec(me, ball, has, v.yaw, look), sd = v.side || 0, k = v.close || 0;
  if (k) { const C = k <= 1 ? CLOSE : CLOSE.map((v, i) => lerp(v, CLOSE_B[i], Math.min(1, k - 1))), kk = Math.min(1, k), cx = Math.cos(v.yaw), cy = Math.sin(v.yaw), E = [me.x - cx * C[0], me.y - cy * C[0], C[1]], T = [me.x + cx * C[2], me.y + cy * C[2], C[3]]; for (let i = 0; i < 3; i++) { c.eye[i] = lerp(c.eye[i], E[i], kk); c.tgt[i] = lerp(c.tgt[i], T[i], kk); } }
  if (sd) { const px = -Math.sin(v.yaw), py = Math.cos(v.yaw), sg = Math.sign((W / 2 - me.y) * py + (L / 2 - me.x) * px) || 1; c.eye[0] += px * sd * sg; c.eye[1] += py * sd * sg; }
  return fitPitch(c, me, w, h, L, W, keep, v.pull ?? 1);
}
// (viewSearch yields after each try, so fast.js can spread the search over frames, about 1 ms a frame; viewPick runs it
// through at once, for the tests and the tools.)
export function* viewSearch(me, ball, has, look, w, h, L, W, nat = naturalYaw(me, ball, has, L, W)) {
  let best = { yaw: nat, rel: 0, side: 0, pull: 1, close: 0 }; const c0 = viewCam(me, ball, has, best, look, w, h, L, W);
  let bs = pitchShare(c0, w, h, L, W, 10, 7); best.share = bs; if (bs >= SHARE) return best;
  // (him and the ball clear of the score bar along the top and the buttons along the bottom)
  const safe = q => !!q && q[0] > w * .06 && q[0] < w * .94 && q[1] > h * .2 && q[1] < h * .9, seen = c => safe(project(c, ball, w, h)) && safe(project(c, { x: me.x, y: me.y, z: .9 }, w, h)), tryV = (v, cost) => { const c = viewCam(me, ball, has, v, look, w, h, L, W); if (!seen(c)) return; const s = pitchShare(c, w, h, L, W, 10, 7); if (s - cost > bs) { bs = s - cost; best = { ...v, share: s }; } };
  for (const side of VIEW_SIDES) for (let d = -VIEW_SPAN; d <= VIEW_SPAN + 1e-9; d += .15) if (side || Math.abs(d) > 1e-6) { tryV({ yaw: wrap(nat + d), rel: d, side, pull: 1, close: 0 }, VIEW_COST * Math.abs(d) + .02 * side); yield; }
  const toC = Math.atan2(W / 2 - me.y, L / 2 - me.x); // (the eye out over the line, looking into the pitch; and, in a corner, close behind him and lower: CLOSE)
  const ys = []; for (let d = -1; d <= 1 + 1e-9; d += .2) ys.push(wrap(toC + d));
  for (const [near, a] of [[me.x, 0], [L - me.x, Math.PI], [me.y, Math.PI / 2], [W - me.y, -Math.PI / 2]]) if (near < 5) ys.push(a); // (straight in from a line he is near)
  if (Math.min(me.x, L - me.x) < 5 && Math.min(me.y, W - me.y) < 5) for (const d of [-.6, -.3, 0, .3, .6]) { tryV({ yaw: wrap(nat + d), rel: d, side: 0, pull: 0, close: 2 }, VIEW_COST * Math.abs(d) + .07); yield; } // (in a corner, looking at the ball steeply from in front of the line)
  for (const y of ys) { const dy = VIEW_COST * .5 * Math.abs(wrap(y - nat)); tryV({ yaw: y, rel: null, side: 0, pull: 0, close: 0 }, dy + .03); yield; tryV({ yaw: y, rel: null, side: 0, pull: 0, close: 1 }, dy + .05); yield; if (Math.min(me.x, L - me.x) < 5 && Math.min(me.y, W - me.y) < 5) { tryV({ yaw: y, rel: null, side: 0, pull: 0, close: 2 }, dy + .07); yield; } }
  return best;
}
export function viewPick(...a) { const g = viewSearch(...a); for (;;) { const r = g.next(); if (r.done) return r.value; } }
// One frame of the view he does not steer, for fast.js and the tools alike. st: { yaw, side, pull, close } (kept between
// frames; the search too). o: { me, ball, has, look, w, h, L, W, nat (where he looks by himself), drag (the yaw his
// finger holds, or null), still (true: leave the yaw where it is, a moment after a drag) }. The target (viewSearch, again
// every VIEW_EVERY s, at most `ms` of it a frame): its yaw relative to `nat` while it is one of those, so it follows him;
// the yaw eased to it no faster than TURN_MAX rad/s; the side, the pull and the closeness at VIEW_RATE a second.
export const TURN_MAX = 2.5, VIEW_EVERY = .2, VIEW_RATE = { side: 3, pull: 1.5, close: 1.5 };
export function viewStep(st, o, dt, ms = 1, now = () => performance.now()) {
  const { me, ball, has, look, w, h, L, W, nat } = o;
  st.t = (st.t || 0) + dt;
  if (!st.gen && st.t - (st.at ?? -9) >= VIEW_EVERY) { st.gen = viewSearch(me, ball, has, look, w, h, L, W, nat); st.at = st.t; }
  if (st.gen) { const t0 = now(); for (;;) { const r = st.gen.next(); if (r.done) { st.tv = r.value; st.gen = null; break; } if (now() - t0 > ms) break; } }
  const tv = st.tv || { rel: 0, side: 0, pull: 1, close: 0 }, aim = tv.rel != null ? wrap(nat + tv.rel) : tv.yaw;
  const free = o.drag == null, goal = free ? tv : { side: 0, pull: 1, close: 0 };
  st.yaw ??= aim;
  if (!free) st.yaw = o.drag;
  else if (!o.still) { // (eased, and never faster than TURN_MAX rad/s: the ball changing sides does not whip the view round; a long turn goes the way that looks less into the stands)
    let d = wrap(aim - st.yaw);
    if (Math.abs(d) > .5) { const low = dd => { let m = 99; for (let i = 1; i < 8; i++) m = Math.min(m, reachOut(me, st.yaw + dd * i / 8, L, W)); return m; }, o2 = d - Math.sign(d) * 2 * Math.PI; if (low(o2) > low(d) + 1.5) d = o2; }
    if (st.turn != null && Math.abs(d) > .5 && Math.sign(st.turn) !== Math.sign(d) && Math.abs(wrap(d)) > 2.6) d = d - Math.sign(d) * 2 * Math.PI; // (keeps turning the way it started)
    st.turn = Math.abs(d) > .5 ? d : null;
    st.yaw = wrap(st.yaw + clamp(d * (1 - Math.exp(-dt * 2.4)), -TURN_MAX * dt, TURN_MAX * dt));
  }
  if (!free || o.still) st.yaw = clampYaw(me, st.yaw, L, W, Math.min(LOOK_MIN, reachOut(me, st.yaw, L, W))); // (his own look: never off the pitch)
  else if (Math.abs(wrap(aim - st.yaw)) < .05) st.yaw = clampYaw(me, st.yaw, L, W, Math.min(LOOK_MIN, reachOut(me, aim, L, W))); // (there: never off the pitch; the ball or the goal near a line still in view)
  for (const k of ['side', 'pull', 'close']) { const v = st[k] ?? (k === 'pull' ? 1 : 0), g = goal[k] ?? (k === 'pull' ? 1 : 0), r = VIEW_RATE[k] * dt; st[k] = v + clamp(g - v, -r, r); }
  return viewCam(me, ball, has, st, look, w, h, L, W, free ? [ball] : []);
}

// ---------- the shot view (SHOOT) ----------
// (v93) The same view from behind and above him, refocused, not another view (the owner: "it should still stay in that
// same view ... maybe it comes a little closer so you can see the net ... more like a zoom in"): the eye comes in to
// AIM_BACK m behind him on the line from the goal through him, over his shoulder (AIM_SIDE m) at AIM_H m, looks at the
// goal, and the lens zooms in (AIM_FMAX down to AIM_FMIN) as far as the six targets stay in the band under the HUD
// (HUD_PX), AIM_GAP px apart, and his head stays in the picture. Returns a camera spec. targets: the six shot targets
// ({ y, z } on the line x = L).
export const AIM_DEV = .7, AIM_BACK = 3.8, AIM_SIDE = .5, AIM_H = 2.6, AIM_FMAX = 2.1, AIM_FMIN = .9, AIM_GAP = 40, HUD_PX = 60;
export function aimCam(me, L, gy0, gy1, gh, w, h, targets) {
  const gc = (gy0 + gy1) / 2, d0 = Math.hypot(L - me.x, gc - me.y), a = clamp(Math.atan2(me.y - gc, L - me.x), -AIM_DEV, AIM_DEV), ux = Math.cos(a), uy = -Math.sin(a), sd = me.y > gc ? -1 : 1; // (from a sharp angle the eye swings toward straight on, AIM_DEV rad at most off it, so the goal is never seen edge-on; over the shoulder on the side of the middle)
  const de = d0 + AIM_BACK, eye = [L - ux * de - uy * AIM_SIDE * sd, gc - uy * de + ux * AIM_SIDE * sd, AIM_H], goal = [L, gc, gh * .5], head = { x: me.x, y: me.y, z: 1.55 };
  const good = cam => {
    const q = targets.map(t => project(cam, { x: L, y: t.y, z: t.z }, w, h)); if (q.some(p => !onScreen(p, w, h, 34) || p[1] < HUD_PX + 14)) return false;
    for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) if (Math.hypot(q[i][0] - q[j][0], q[i][1] - q[j][1]) < AIM_GAP) return false;
    return true;
  };
  const headIn = cam => { const p = project(cam, head, w, h); return !!p && p[1] < h - 8 && p[0] > 8 && p[0] < w - 8; };
  let fall = null;
  for (let F = AIM_FMAX; F >= AIM_FMIN - 1e-9; F -= .05) for (const k of [0, .1, .2, .3, .4]) { // (k: the aim lowered from the goal toward him, so he stays in)
    const cam = { eye: [...eye], tgt: [lerp(goal[0], me.x, k), lerp(goal[1], me.y, k), lerp(goal[2], 1.2, k)], Ff: F, Fw: 0 };
    if (!good(cam)) continue; if (headIn(cam)) return cam; fall ||= cam;
  }
  return fall || { eye, tgt: goal, Ff: AIM_FMIN, Fw: 0 };
}
// ---------- where a chip sits ----------
// Only on the left or right edge (CHIP_X px in), between CHIP_Y0 px from the top (under the HUD) and the bottom buttons
// (CHIP_Y1 px from the bottom): q the screen point of his last place (null: behind the camera, rel > 0 to his left).
// A friend above the picture goes to the top of the nearer side, one behind him to its lower part. layoutChips keeps
// them CHIP_GAP px apart on a side.
export const CHIP_X = 30, CHIP_Y0 = 84, CHIP_Y1 = 150, CHIP_GAP = 56;
export function chipSpot(q, rel, w, h) {
  const y1 = h - CHIP_Y1;
  if (!q) return [rel > 0 ? CHIP_X : w - CHIP_X, y1];
  return [q[0] < w / 2 ? CHIP_X : w - CHIP_X, clamp(q[1], CHIP_Y0, y1)];
}
export function layoutChips(ps, h) {
  const y1 = h - CHIP_Y1;
  for (const side of [CHIP_X, -1]) {
    const col = ps.filter(p => (side === CHIP_X ? p[0] === CHIP_X : p[0] !== CHIP_X)).sort((p, q) => p[1] - q[1]);
    for (let i = 1; i < col.length; i++) col[i][1] = Math.max(col[i][1], col[i - 1][1] + CHIP_GAP);
    for (let i = col.length - 1; i >= 0; i--) { const lim = i === col.length - 1 ? y1 : col[i + 1][1] - CHIP_GAP; if (col[i][1] > lim) col[i][1] = lim; }
    for (const p of col) p[1] = clamp(p[1], CHIP_Y0, y1);
  }
  return ps;
}
