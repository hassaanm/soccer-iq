// The rondos (v88), two mini games on the Fast engine's rules: a keep-ball box. A few players stand on the sides of a
// marked box and pass the ball round; one or two in the middle try to win it.
//  - "Keep the ball" (mode 'keep'): he is one of the players on the outside, on the near side of the box, the whole
//    run. He moves along his side between fixed spots (a tap goes to the nearest), with the ball at his feet or without
//    it, and passes with a tap on a friend. His team keeps the ball for the round, or loses it (a life).
//  - "Win the ball" (mode 'win'): he is the defender in the middle. He moves between fixed spots (in front of each
//    passer, in each passing lane); a pass into his body is his; STEAL wins a ball within his reach (it glows then).
// What this file holds: the box, where a player may stand, when a line is open, and how hard each level is. No page,
// no 3D world and no sim here, so the tests and the bots use it as it is (mini/rondo-play.js plays it on the sim,
// mini/rondo-ui.js puts it on the page).
//
// Coaching behind it (sources in the v88 report): outside players keep the box wide and move along their line to
// give the ball an open line ("make the angle") before the ball comes; pass to the friend whose line is open, early,
// before the defender closes; the defender presses the ball on a curve that cuts the line to one friend (the cover
// shadow), a second defender cuts the next best line, and he wins it on a slow pass or a heavy touch.
import { clamp, dist, onLane, cutBy, project, REACH } from '../fast/rules.js';
import { ease, ramp } from './rules.js';

// ---------- time ----------
// SPEED: the one base speed, a share of real time. HOLD: the speed while a finger is held down (as Fast mode).
// A round's length is in REAL seconds (keepLevel / winLevel secs): the countdown on screen shows them as they are.
export const SPEED = .9, HOLD = .18, READY_S = 1.3, AFTER_S = 2.2;

// ---------- the box ----------
// Centred on (cx, cy); x0..x1 and y0..y1. His side in 'keep' is the near one (x = x0, the camera behind it), facing +x
// (ahead); +y is on his left. Each side is a segment from corner to corner; a player on it keeps INSET m from the
// corners, so two neighbours never stand on the same corner.
export const INSET = 1.1, SIDES = ['near', 'left', 'far', 'right'];
export function makeBox(cx, cy, size) { const h = size / 2; return { cx, cy, h, size, x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h }; }
const SEG = {
  near: b => ({ m: { x: b.x0, y: b.cy }, u: { x: 0, y: 1 } }), far: b => ({ m: { x: b.x1, y: b.cy }, u: { x: 0, y: -1 } }),
  left: b => ({ m: { x: b.cx, y: b.y1 }, u: { x: 1, y: 0 } }), right: b => ({ m: { x: b.cx, y: b.y0 }, u: { x: -1, y: 0 } }),
};
// m along a side from its middle (the side's own direction), the point at t m along, and the nearest point on it.
export const along = (b, side, p) => { const s = SEG[side](b); return (p.x - s.m.x) * s.u.x + (p.y - s.m.y) * s.u.y; };
export const reachOf = b => Math.max(0, b.h - INSET); // how far from a side's middle a player may go
export const sideAt = (b, side, t) => { const s = SEG[side](b), lim = reachOf(b); t = clamp(t, -lim, lim); return { x: s.m.x + s.u.x * t, y: s.m.y + s.u.y * t }; };
export const toSide = (b, side, p) => sideAt(b, side, along(b, side, p));
// Inside the box, m from its lines (the defenders, and him in 'win').
export const inBox = (b, p, m = .4) => ({ x: clamp(p.x, b.x0 + m, b.x1 - m), y: clamp(p.y, b.y0 + m, b.y1 - m) });
export const isIn = (b, p, m = 0) => p.x >= b.x0 - m && p.x <= b.x1 + m && p.y >= b.y0 - m && p.y <= b.y1 + m;
// How far p is from a side's segment (0: on it).
export const offSide = (b, side, p) => dist(p, toSide(b, side, p));
// N evenly spaced points along a side (the dots on the grass: "dots all across his line").
export const sideDots = (b, side, n = 9) => { const lim = reachOf(b); return Array.from({ length: n }, (_, i) => sideAt(b, side, -lim + (2 * lim * i) / (n - 1))); };

// ---------- his spots (v93, D2: he moves only to fixed spots) ----------
// 'keep': KEEP_SPOTS fixed places along his side, corner to corner (a tap goes to the nearest one).
// 'win': a set made when he arrives somewhere (or stops, or the ball changes hands): a place in front of each passer,
// near enough to put a foot on the ball at his feet (PRESS_IN m inside his line, toward the middle), and a place in each
// passing lane (the middle of the line between two neighbours, and the middle of the box for the lines across it).
// Places closer than MERGE m are one; the one he stands on is left out. They stay where they are until the next set.
export const KEEP_SPOTS = 5, MAX_SPOTS = 8, PRESS_IN = 1.05, MERGE = 1.6, ON_SPOT = .9, TAP_R = 2.2;
export const keepSpots = b => sideDots(b, 'near', KEEP_SPOTS);
const ORDER = ['far', 'left', 'near', 'right'];
// passers: [{ id, x, y, side }] (side: the box side he is on); me: where he is. Returns [{ x, y, kind, of }].
export function winSpots(b, passers, me = null) {
  const c = { x: b.cx, y: b.cy }, out = [], inner = p => inBox(b, p, .55);
  for (const p of passers) { const dx = c.x - p.x, dy = c.y - p.y, l = Math.hypot(dx, dy) || 1; out.push({ ...inner({ x: p.x + dx / l * PRESS_IN, y: p.y + dy / l * PRESS_IN }), kind: 'press', of: p.id }); }
  const by = Object.fromEntries(passers.map(p => [p.side, p]));
  for (let i = 0; i < 4; i++) { const p = by[ORDER[i]], q = by[ORDER[(i + 1) % 4]]; if (p && q) out.push({ ...inner({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }), kind: 'lane', of: p.id + q.id }); }
  out.push({ ...c, kind: 'lane', of: 'mid' });
  const kept = [];
  for (const s of out) if (!kept.some(k => dist(k, s) < MERGE) && !(me && dist(me, s) < ON_SPOT)) kept.push(s);
  while (kept.length > MAX_SPOTS) { const lanes = kept.filter(k => k.kind === 'lane' && k.of !== 'mid'), far = (lanes.length ? lanes : kept).reduce((f, k) => (me ? dist(k, me) > dist(f, me) : false) ? k : f); kept.splice(kept.indexOf(far), 1); } // (at most 8: a lane far from him goes)
  return kept;
}
// The spot a tap at p means: the nearest within TAP_R m, else null (a tap far from every spot does nothing).
export function spotAt(list, p, r = TAP_R) { let best = null, bd = r; for (const s of list) { const d = dist(s, p); if (d < bd) { bd = d; best = s; } } return best; }

// ---------- an open line ----------
// A pass from → to at `speed` m/s is open when no defender can put a foot on its line before the ball gets there
// (fast/rules.js cutBy: REACH m standing, then run m/s after react s) with `margin` m to spare, and nobody stands
// within reach of the receiver's feet. foes: the defenders ({ id, x, y }).
// A defender close to the passer (within CLOSE m) shuts any line that starts within his reach and a step more (NEAR_X m):
// he is moving, and a pass played right past his foot is his.
export const CLOSE = 2.2, NEAR_X = .3;
export function lineOpen(from, to, speed, foes, run, react, margin = 0) {
  if (cutBy(from, to, speed, foes, run, react, margin)) return false;
  for (const o of foes) { if (dist(o, to) < REACH + margin * .5) return false; if (dist(o, from) < CLOSE) { const c = onLane(o, from, to, 0); if (c.along > 0 && c.d < REACH + NEAR_X) return false; } }
  return true;
}
// The smallest gap between the line from → to and a defender (m), for scoring places.
export const laneGap = (from, to, foes) => foes.reduce((m, o) => Math.min(m, onLane(o, from, to, 0).d), 99);
// The best place on `side` to take a pass from `ball` (a point): open (as lineOpen) first, then the widest gap, then
// room from the defenders, and not too near the ball (a pass needs a few metres). Returns { x, y, open, score }.
export function bestSpot(b, side, ball, foes, { speed = 8, run = 4, react = .3, margin = .3, n = 13 } = {}) {
  let best = null;
  for (const p of sideDots(b, side, n)) {
    const open = lineOpen(ball, p, speed, foes, run, react, margin), gap = Math.min(laneGap(ball, p, foes), 3), room = Math.min(foes.reduce((m, o) => Math.min(m, dist(o, p)), 99), 4), d = dist(ball, p);
    const score = (open ? 10 : 0) + gap + room * .4 - (d < 3 ? (3 - d) * 2 : 0);
    if (!best || score > best.score) best = { ...p, open, score };
  }
  return best;
}

// ---------- how hard, by level (a third of a level a round: mini/rules.js) ----------
// The one place to tune each game. Every number moves a little with each round and never back (tests/rondo.test.js).
// (v93, D1) No easy start: from the first round the defender presses with purpose and the passes are brisk; a careful
// grown-up keeps about 3 rounds in 4 at first, and by a score of 5 it is hard.
//
// Keep the ball (he is an outside player):
//   secs     real seconds a round (shorter at first: no waiting)
//   size     the box's side, m
//   two      the second defender's share of his full speed and sense (0: not there; from TWO_AT he comes in at a
//            third of it and grows over the next rounds: a gentle rise, not a wall)
//   press    m/s the defender pressing the ball runs at; cover: the second's
//   cutRun   m/s a defender runs to a pass line, after cutReact s (how far from a line a pass is safe)
//   stand    s a defender needs on a player standing on the ball to win it (a red ring warns him first)
//   think    s between the defenders' choices (where to press, which line to cut)
//   smart    the share of choices the defenders get right (the pressing curve that cuts the best line)
//   fMargin  m to spare his friends want on a line before they pass
//   fHold    s a friend keeps the ball before passing (one or two touches); fPass: m/s of their passes
//   fMove    s between his friends' moves to open their lines
//   fRoom    m a friend wants between a defender and where a pass to him would get to him (time to take it)
export const TWO_AT = 1; // (after 3 rounds kept)
// (v93 follow-up) The first rounds are forgiving for a slow young player and the real difficulty comes in over a few
// rounds, smooth, no wall: `soft` is 1 at score 0, 0.85 at score 1, 0.45 at score 2, 0.15 at score 3 and 0 from score 4
// (SOFT_TO levels), straight between. Every number it touches still moves only the hard way (tests/rondo.test.js).
export const SOFT = [1, .85, .45, .15, 0], SOFT_TO = (SOFT.length - 1) / 3;
export const soft = L => { const x = Math.min(SOFT.length - 1, Math.max(0, L * 3)), i = Math.min(SOFT.length - 2, Math.floor(x)); return SOFT[i] + (SOFT[i + 1] - SOFT[i]) * (x - i); };
export function keepLevel(L) {
  L = Math.max(0, L); const sf = soft(L), two = L >= TWO_AT - 1e-9 ? .45 + ramp(TWO_AT, .5, .55)(L) : 0; // (1e-9: a level, counted a third at a time)
  return { // (soft: the defender closes a little slower, tackles later, cuts lines later, and his passes slip past a foot more often: rondo-play.js ballCheck)
    secs: Math.round(30 - 10 * Math.exp(-L / 2)), size: ease(11, 8, 3)(L), two, press: ease(3.6, 5.8, 2.5)(L) * (1 - .25 * sf), cover: ease(3, 4.6, 4)(L) * two, cutRun: ease(3.8, 5.6, 3)(L) * (1 - .3 * sf), cutReact: ease(.45, .12, 3)(L) + .4 * sf,
    stand: ease(1.4, .5, 2.5)(L) + .9 * sf, think: ease(.6, .25, 3)(L) + .2 * sf, smart: ease(.65, .97, 2.5)(L) - .2 * sf, fMargin: ease(.35, .25, 4)(L), fHold: ease(.7, .45, 3)(L), fPass: ease(9.5, 11.5, 4)(L), fMove: ease(.8, 1.1, 4)(L), fRoom: ease(2.4, 2.1, 3)(L), soft: sf,
  };
}
// Win the ball (he is the defender in the middle; four passers, one on each side, from the first round):
//   secs     real seconds he has to win it
//   size     the box's side, m (a little bigger later: more room for them)
//   pass     m/s of their passes
//   heavy    the share of first touches that run loose (toward the middle)
//   careless the share of passes made without looking at him
//   hold     s a passer keeps it before passing, with nobody near
//   feel     m: with him this near the ball (or closing on it), a passer gets rid of it...
//   react    ...after this many s (slow at first: get in his face and press, and it is yours)
//   move     the share of moves to open lines that are good ones
//   margin   m to spare they want on a line past him
//   look     the share of times a passer checks that he cannot get to the friend first...
//   lead     ...with this many s to spare for that friend
export const FOUR_AT = 0; // (v93: four passers from the first round, so no step when a fourth joins)
export function winLevel(L) {
  L = Math.max(0, L); const X = .5 + .5 * L, sf = soft(L); // (the passers' curves start half a level in, no easy first round, and rise a little slower)
  return { // (soft: they read him late, `lag` s behind where he is, so a pass may go into a lane he has just stepped into;
    //        they keep it longer with him in their face; and his reach for a press is a little longer, `reachPlus` m)
    secs: Math.round(16 + 4 * Math.exp(-L / 6)), size: ease(10.5, 13, 6)(X), n: 4, pass: ease(7, 10.5, 5)(X) * (1 - .1 * sf), heavy: ease(.08, .01, 4)(X), careless: ease(.08, 0, 4)(X) + .12 * sf,
    hold: ease(1.05, .45, 4)(X) + .4 * sf, feel: ease(3, 4.3, 4)(X), react: ease(.37, .12, 4)(X) * (1 + 1.5 * sf), move: ease(.5, .95, 5)(X), margin: ease(.1, .6, 5)(X), look: ease(.65, 1, 4)(X) * (1 - .5 * sf), lead: ease(.35, .9, 5)(X),
    lag: .6 * sf, reachPlus: .4 * sf, soft: sf,
  };
}
// (v89; Score attack's own first rounds use it: mini/attack.js) 1 for the first rounds, then easing smoothly to 0.
export const EARLY = .7, EARLY_FADE = 3.3;
export const early = L => { const u = Math.min(1, Math.max(0, (L - EARLY) / EARLY_FADE)); return (1 + Math.cos(Math.PI * u)) / 2; };
// ---------- the view ----------
// Behind and above his player, looking along `yaw` to a point `ahead` m in front of him (the game's own view: never
// from the top). It starts BACK m behind and UP m high and steps back and up (to at most MAX m back) until every point
// in `keep` is in the picture (below the bar along the top, `top` px). The view looks down at most about 30 degrees.
export const VIEW = { back: 5.6, up: 4, max: 11, step: .5, rise: .22, Ff: .86, Fw: .5 };
export function rondoCam(me, yaw, ahead, keep, w, h, top = 60) {
  const c = Math.cos(yaw), s = Math.sin(yaw), ok = p => { const q = project(cam, p, w, h); return !!q && q[0] > 24 && q[0] < w - 24 && q[1] > top && q[1] < h - 16; };
  let cam = null;
  for (let B = VIEW.back, H = VIEW.up; ; B += VIEW.step, H += VIEW.rise) {
    cam = { eye: [me.x - c * B, me.y - s * B, H], tgt: [me.x + c * ahead, me.y + s * ahead, .3], Ff: VIEW.Ff, Fw: VIEW.Fw };
    if (B >= VIEW.max || keep.every(ok)) return cam;
  }
}
// How fast he is (both games), and how fast he gets to a line in 'win' (their passes are judged against it).
// stumble: game s he stumbles after a STEAL that misses (0.8 real s at SPEED), at stumbleV m/s (D3).
export const ME = { jog: 3.6, sprint: 5.2, dribble: 3, far: 4.5, run: 4.6, react: .25, pass: 10, press: 4, stumble: .65, stumbleV: 1 };
// What is said (spoken: tests/spoken.js; each has a recorded clip).
export const RONDO_SAID = {
  keepIntro: 'Pass to a friend. Move so they can pass to you!', kept: 'You kept it!', lost: 'They got it!', move: 'Move to open space so your friend can pass to you!',
  winIntro: 'Stand in the way. Steal it when the ball glows!', won: 'Great steal!', time: 'So close! Try again!',
};
