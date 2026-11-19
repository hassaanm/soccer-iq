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

// ---------- the spots on the grass ----------
// Eight ways round him (the first one toward the goal he attacks), each with a near spot (NEAR m) and a far one (FAR m),
// and his own spot ("stay"). A spot off the pitch (EDGE m inside the lines at least) or on top of another player (BODY m)
// is left out.
export const NEAR = 3, FAR = 7, EDGE = .7, BODY = 1.1;
export const DIRS = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
export function spots(me, others, L, W) {
  const out = [{ x: me.x, y: me.y, ring: 0, dir: -1 }];
  for (const [ring, r] of [[1, NEAR], [2, FAR]]) DIRS.forEach((a, dir) => {
    const x = me.x + Math.cos(a) * r, y = me.y + Math.sin(a) * r;
    if (x < EDGE || x > L - EDGE || y < EDGE || y > W - EDGE) return;
    if (others.some(o => Math.hypot(o.x - x, o.y - y) < BODY)) return;
    out.push({ x, y, ring, dir });
  });
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
export const DOWN = [3.1, 1.3, 2.9, 3.5, .25, .8, 1.05, .64], UP = [5.4, .3, 4.4, 7.5, 0, 0, .86, .5]; // (head up: higher and looking down onto the play, so the pitch fills the picture and the stands are a strip at the top)
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
export function cutBy(from, to, speed, foes) {
  const d = dist(from, to) || 1; let best = null;
  for (const o of foes) {
    const c = onLane(o, from, to, Math.min(.5, 1 / d)), tBall = c.along / speed, need = Math.max(0, c.d - REACH), tFoot = need ? REACT + need / RUN : 0;
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
// The right time: the ball is off the carrier's foot (OFF m or more from him, between touches) and within his own reach
// of it (STEAL_R m). A press then wins it; any other press is a lunge that misses.
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
// the world and looks round), wherever it went down: on the grass, a spot, a friend or a button.
export const HOLD_S = .25, SLIDE_PX = 12;
export const pressKind = (secs, slid) => (slid || secs > HOLD_S ? 'hold' : 'tap');

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
// The camera made to fill the picture with the pitch (FILL of the rows): its eye brought back over the pitch along the
// line to him (never past him), then raised and tipped down step by step until the pitch fills it, as long as his player
// and the points in `keep` (the ball) stay on screen. Changes and returns `cam`.
export const FILL = .8;
export function fitPitch(cam, me, w, h, L, W, keep = []) {
  const e = cam.eye, t = cam.tgt, m = .3, inside = () => e[0] >= m && e[0] <= L - m && e[1] >= m && e[1] <= W - m;
  const ok = () => onScreen(project(cam, { x: me.x, y: me.y, z: .5 }, w, h), w, h, 4) && keep.every(p => onScreen(project(cam, p, w, h), w, h, 4));
  if (!inside()) { const s0 = [...e]; e[0] = clamp(e[0], m, L - m); e[1] = clamp(e[1], m, W - m); if (!ok()) e.splice(0, 3, ...s0); } // (moved in over the line, if he stays in view)
  for (let i = 0; i < 12 && !inside() && Math.hypot(e[0] - me.x, e[1] - me.y) > 3; i++) { const s0 = [...e], k = .9; e[0] = me.x + (e[0] - me.x) * k; e[1] = me.y + (e[1] - me.y) * k; if (!ok()) { e.splice(0, 3, ...s0); break; } }
  for (let i = 0; i < 40 && rowsOnPitch(cam, w, h, L, W) < FILL; i++) {
    const s0 = [...e], t0 = [...t];
    if (e[2] < 9) e[2] += .25; t[2] -= .3; t[0] = me.x + (t[0] - me.x) * .96; t[1] = me.y + (t[1] - me.y) * .96;
    if (!ok()) { e.splice(0, 3, ...s0); t.splice(0, 3, ...t0); break; }
  }
  return cam;
}
