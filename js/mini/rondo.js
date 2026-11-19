// The rondos (v88), two mini games on the Fast engine's rules: a keep-ball box. A few players stand on the sides of a
// marked box and pass the ball round; one or two in the middle try to win it.
//  - "Keep the ball" (mode 'keep'): he is one of the players on the outside, on the near side of the box, the whole
//    run. He moves along his side (a tap on the grass), with the ball or without it, and passes with a tap on a friend.
//    A round lasts ROUND_S s of play; his team keeps the ball for the round, or loses it (a life).
//  - "Win the ball" (mode 'win'): he is the defender in the middle. He moves with a tap; standing in a passing line
//    blocks it; the STEAL button wins the ball while it glows. A round: ROUND_S s to win it, or a life is lost.
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
// SPEED: the one base speed, a share of real time (calm for a five-year-old at level 0; no slow motion by itself).
// HOLD: the speed while a finger is held down (as Fast mode). ROUND_S: game seconds of play a round (about 30 real s).
export const SPEED = .8, HOLD = .18, ROUND_S = 24, READY_S = 1.3, AFTER_S = 2.2;

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
//
// Keep the ball (he is an outside player):
//   size     the box's side, m (roomy at first, toward 8.5)
//   two      the second defender's share of his full speed and sense (0: not there; he comes in at TWO_AT, slow and
//            often in the wrong place, and is at full speed over the next ten rounds: a gentle step, not a wall)
//   press    m/s the defender pressing the ball runs at; cover: the second's
//   cutRun   m/s a defender runs to a pass line, after cutReact s (how far from a line a pass is safe)
//   stand    s a defender needs on a player standing on the ball to win it
//   think    s between the defenders' choices (where to press, which line to cut)
//   smart    the share of choices the defenders get right (the pressing curve that cuts the best line)
//   fMargin  m to spare his friends want on a line before they pass (less forgiving: smaller)
//   fHold    s a friend keeps the ball before passing; fPass: m/s of their passes
//   fMove    s between his friends' moves to open their lines (slower: he must make more of the angles himself)
export const TWO_AT = 5 / 3; // (after 5 rounds kept)
export function keepLevel(L) {
  L = Math.max(0, L); const two = L >= TWO_AT - 1e-9 ? .3 + ramp(TWO_AT, .2, .7)(L) : 0; // (1e-9: five thirds of a level, counted a third at a time)
  return {
    size: ease(13, 8.5, 6)(L), two, press: ease(1.8, 4.6, 6)(L), cover: ease(2.2, 4.3, 6)(L) * two, cutRun: ease(2.8, 5.2, 6)(L), cutReact: ease(.6, .15, 6)(L),
    stand: ease(3.2, 1, 6)(L), think: ease(1, .25, 6)(L), smart: ease(.25, .97, 6)(L), fMargin: ease(.35, .05, 6)(L), fHold: ease(1, .55, 6)(L), fPass: ease(7.5, 10.5, 6)(L), fMove: ease(.9, 1.6, 6)(L),
  };
}
// Win the ball (he is the defender in the middle):
//   size     the box's side, m (a little bigger later: more room for them)
//   n        passers (3 at first, a fourth from FOUR_AT)
//   pass     m/s of their passes (slow at first: a slow pass glows)
//   heavy    the share of first touches that run loose (a heavy touch glows)
//   careless the share of passes made without looking at him (into the line he stands in)
//   hold     s a passer keeps it before passing
//   loose    the share of pressed passers who dribble away from him (the ball off the foot glows) instead of shielding it
//   move     the share of moves to open lines that are good ones
//   glow     s the ball glows for at least (a chance stays a moment), and the gap after a carrier's window
//   margin   m to spare they want on a line past him
export const FOUR_AT = 5 / 3; // (after 5 rounds won)
export function winLevel(L) {
  L = Math.max(0, L);
  return {
    size: ease(10, 12.5, 6)(L), n: L >= FOUR_AT - 1e-9 ? 4 : 3, pass: ease(5, 10.5, 2)(L), heavy: ease(.25, .02, 1.2)(L), careless: ease(.2, 0, 1.2)(L), loose: ease(.8, .1, 2.5)(L), hold: ease(1.8, .5, 2.2)(L),
    move: ease(.2, .95, 2.2)(L), glow: ease(.5, .2, 2.5)(L), gap: ease(1, 2.5, 2.2)(L), margin: ease(0, .5, 2.2)(L),
  };
}
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
export const ME = { jog: 3.6, sprint: 5.2, dribble: 3, far: 4.5, run: 4.6, react: .25, pass: 9, lunge: 1.2 };
// What is said (spoken: tests/spoken.js; each has a recorded clip).
export const RONDO_SAID = {
  keepIntro: 'Pass to a friend. Move so they can pass to you!', kept: 'You kept it!', lost: 'They got it!', move: 'Move to open space so your friend can pass to you!',
  winIntro: 'Stand in the way. Steal it when the ball glows!', won: 'Great steal!', time: 'So close! Try again!',
};
