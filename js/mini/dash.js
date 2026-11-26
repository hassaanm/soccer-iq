// Dribble dash (v96), a mini game: he carries the ball up the pitch at a jog, by himself, and lines of red defenders
// come at him in waves. In front of each line the grass shows two or three fixed choices (fat gold arrows: his left gap,
// the middle, his right gap; later now and then a friend out wide instead of a third gap). He taps one and carries the
// ball that way. A gap nobody closes: he is through (+1). A gap a defender closes: that defender tackles him. Each run of
// waves ends with a shot into the open goal, and he starts again from his own half (a "leg"). After a tackle he starts
// again just before that wave. The score is the number of lines he got through.
//
// What it teaches (coaching sources, see the v96 report): dribble into open space, not at a defender; keep your head up
// while you carry the ball and judge a gap by what the defenders are doing, not only by where they stand: one stepping
// across is closing that gap and opening the one he leaves. A wall pass (one-two) beats a defender only when the friend is
// really free.
//
// THE RULES, the same in the game, the tests and the bots:
//  - A tackle is the Live game's own reach: a defender wins the ball when it passes within STEAL_R (1.5 m) of him
//    (fast/rules.js). The judging moment is the crossing of his line.
//  - Every choice is plainly one or the other at the crossing: open (nobody within CLEAR_M, 2.2 m, of it: 0.7 m beyond a
//    tackle) or shut (a defender within BLOCK_M, 0.8 m, of it: 0.7 m inside a tackle). For the friend: free (nobody
//    within MARK_M of him) or marked (a defender within BLOCK_M of him).
//  - Readable (never unfair): every defender's movement is settled (no more changes of pace or way) by `settle`, at
//    least `react` s before the choice locks; after that he moves at one steady pace to where he ends. So at that
//    moment the picture says it all, by one rule a person can use at a glance (readLine): a defender standing still
//    shuts the lane he stands on; a defender moving shuts the next lane in front of him on his way. The tests check the rule
//    against the outcome for thousands of waves at every level.
//  - His run: before `settle` a tap makes him lean a little toward his pick (the arrow lights up); from `settle` on he
//    cuts across to it at SIDE_V, in time for the crossing (LOCK s before it, his pick is final). No tap by then: he
//    hesitates and the nearest defender closes him down (standing still loses the ball, as in the Live game). In the
//    second line of a double he keeps straight on if he does not tap.
// No page here: mini/dash-ui.js puts it in the 3D world, the tests and the bots play it as it is.
import { STEAL_R } from '../fast/rules.js';
import { ease, ramp } from './rules.js';

export const G = 3;            // m between the lanes (his left, the middle, his right)
export const TACKLE_R = STEAL_R, CLEAR_M = 2.2, BLOCK_M = .8, MARK_M = 2.2;
export const FRIEND_OUT = 2.9, FRIEND_AHEAD = 4; // m beyond the side lane where the friend runs, and ahead of him
export const SIDE_V = 3.4, LEAN_V = .8, LEAN_MAX = .5, HOME_V = 2.2, SIDE_ACC = 14; // his cut across (m/s), his lean, back to the middle
export const LOCK = 1.15;      // s before the crossing that his pick is final (a cut of G m takes about 1.1 s)
export const MOVE_MIN = .8, MOVE_MAX = 2.6, RAMP = .25, TURN_RAMP = .3; // a defender's sideways pace (m/s) once he moves; speeding up, turning back
export const AFTER_S = .45;    // s of running between a crossing and the next wave's arrows
export const START_X = 9, SHOT_BACK = 13, GOAL_ROOM = 12.5; // a leg starts here (far enough out that the camera behind him is in front of his own goal, not looking through its net); the shot is from at most SHOT_BACK m out; the last line leaves GOAL_ROOM m to their goal
export const LANES = { L: 1, M: 0, R: -1 }; // +y is his left (geom.js)

// What he hears (all recorded already: voicelines.js loads every string this module exports, ui/voicewarm.js).
export const DASH_SAID = { intro: 'Run into the space!', good: 'Great run!', choice: 'Great choice!', pass: 'Great pass!', tackled: 'Tackled! Stay away from the other team.', space: 'Run where nobody is!', wall: 'Pass and go, then get it back!', goal: 'Goal!', look: 'Where is the space?' };

// ---------- how hard, by level (a third of a level a line: mini/rules.js) ----------
// The one place to tune it. Everything moves a little with each line and never back:
//   v       his jog (m/s)
//   see     s from the arrows showing (and the defenders starting to move) to the lock: his time to choose
//   react   s, at least, between the last change in any defender's movement and the lock
//   narrow  how far (m) toward the open lane a defender may end up (0: the open lane is wide; .8: as close as fair)
//   moveP   the share of defenders who step across into the lane they shut (from score 2)
//   lateP   the share of lines with a late shift (from score 3): one defender goes one way, then back the other
//   wide    the first two lines: two arrows, nobody moves, one gap wide open
//   friend  from score 6 a friend runs alongside, one wave in three; doubleP from score 8: a second line right behind
//   vmax    a defender's fastest pace across (m/s)
// (v96 fix: no ceiling) Up to score 8 as before; from score 8 on (`past`: scores past 8) it keeps rising, in steady steps
// through score 40 and beyond, by things he can see and learn: less time to choose (see), less time after the last change
// of movement (react: a defender who turns back late must be seen at once), faster defenders (vmax), more late turns
// (lateP), more second rows (doubleP). Never a hidden one: the rule he reads (readLine) still says it all from `settle`.
export const CEIL = { from: 8, react: .02, reactMin: .3, see: .02, seeMin: 1.4, late: .006, lateMax: .95, dbl: .007, dblMax: .65, vmax: .02, late2: .025, late2From: 8, late2Max: .8 };
export function dashLevel(L) {
  L = Math.max(0, L);
  const past = Math.max(0, L * 3 - CEIL.from);
  return {
    level: L, v: ease(2.9, 5.4, 2.6)(L), see: Math.max(CEIL.seeMin, ease(3.3, 1.8, 1.6)(L) - CEIL.see * past), react: Math.max(CEIL.reactMin, ease(1.15, .6, 1.5)(L) - CEIL.react * past),
    narrow: ramp(2 / 3, .35, .8)(L), moveP: ramp(.6, .45, .9)(L), lateP: L < 1 - 1e-9 ? 0 : Math.min(CEIL.lateMax, Math.min(.8, .3 + (L - 1) * .25) + CEIL.late * past),
    wide: L < 2 / 3 - 1e-9, friend: L >= 2 - 1e-9, doubleP: L < 8 / 3 - 1e-9 ? 0 : Math.min(CEIL.dblMax, Math.min(.4, .22 + (L - 8 / 3) * .12) + CEIL.dbl * past),
    third: ramp(1.5, .3, .6)(L), // the share of plain lines with a third defender (out wide, covering)
    vmax: MOVE_MAX + CEIL.vmax * past,
    late2: Math.min(CEIL.late2Max, Math.max(0, L * 3 - CEIL.late2From) * CEIL.late2), // (from score 16) a second late turn: both sides of an open middle, or in a second row
  };
}
// (v96 fix) The first EASY_LEGS legs of a run (a leg: from his own half to the shot; a tackle starts the same leg again)
// are forgiving, whatever the score: three arrows and ONE slow defender, so two ways are wide open; he stands on his lane
// or steps slowly across into it from the next one (EASY_V m/s: the picture changes, as it will later); EASY_SEE s to
// choose; no tap and the boy runs on straight (no hesitation); and the leg's first tackle costs no life (he sees it, then
// the leg starts again: hooks.again). Varied: his lane (left, middle or right) and whether he steps across.
export const EASY_LEGS = 2, EASY_SEE = 4.6, EASY_V = [.85, 1.1];
export const easyLevel = L => ({ ...dashLevel(0), level: L, see: EASY_SEE, easy: true });

// ---------- a little random stream from a seed (so a logged wave can be made again) ----------
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const U = (r, a, b) => a + (b - a) * r();

// ---------- a defender's sideways movement ----------
// y0: where he stands before he moves; keys [[t, v], ...]: his pace (m/s, +: toward his left) at times t (s from the
// crossing of his line), straight between keys, the last one held after it; 0 before the first. Exact, no stepping.
export function posAt(m, t) {
  const k = m.keys; let y = m.y0;
  if (!k.length || t <= k[0][0]) return y;
  for (let i = 0; i < k.length; i++) {
    const [t0, v0] = k[i], nx = k[i + 1];
    if (!nx) return y + v0 * (t - t0);
    const [t1, v1] = nx;
    if (t <= t1) { const u = t - t0; return y + v0 * u + (v1 - v0) * u * u / (2 * (t1 - t0)); }
    y += (v0 + v1) / 2 * (t1 - t0);
  }
  return y;
}
export function velAt(m, t) {
  const k = m.keys; if (!k.length || t <= k[0][0]) return 0;
  for (let i = 0; i < k.length; i++) { const [t0, v0] = k[i], nx = k[i + 1]; if (!nx) return v0; const [t1, v1] = nx; if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0); }
  return 0;
}
const lastKey = m => (m.keys.length ? m.keys[m.keys.length - 1][0] : -Infinity);
// A step across: from ys, moving from tm, to yF at the crossing (one steady pace after a short speed-up).
function stepTo(ys, yF, tm) { const u = (yF - ys) / (-tm - RAMP / 2); return { y0: ys, keys: [[tm, 0], [tm + RAMP, u]], u, kind: 'step' }; }
// A late shift: from ys, first toward the other way at u1 from ta, then turning back at ts, to yF at the crossing.
function lateTo(ys, yF, ta, u1, ts) {
  const a = u1 * (RAMP / 2 + (ts - ta - RAMP)), u2 = (yF - ys - a - u1 * TURN_RAMP / 2) / (-ts - TURN_RAMP / 2);
  return { y0: ys, keys: [[ta, 0], [ta + RAMP, u1], [ts, u1], [ts + TURN_RAMP, u2]], u: u2, u1, kind: 'late' };
}
const stand = y => ({ y0: y, keys: [], u: 0, kind: 'stand' });

// ---------- the lanes of a line, and the rule a person can read ----------
// lanes: [{ id, y, choice }]: L, M, R (and in a friend wave F, the friend's run, and the lane on his side is no choice).
export function readLine(line, t, see = 0) {
  const shut = new Set();
  for (const d of line.defs) {
    const y = posAt(d.m, t), v = velAt(d.m, t);
    if (Math.abs(v) <= see) { const ln = line.lanes.find(l => Math.abs(l.y - y) <= BLOCK_M + .1); if (ln) shut.add(ln.id); continue; }
    const s = Math.sign(v); let best = null, bd = Infinity;
    for (const l of line.lanes) { const a = (l.y - y) * s; if (a > 0 && a < bd) { bd = a; best = l; } }
    if (best) shut.add(best.id);
  }
  return line.choices.filter(c => !shut.has(c.id)).map(c => c.id);
}
// The outcome at the crossing, choice by choice: 'open', 'shut' or 'unclear' (never made: see the tests).
export function truth(line) {
  const out = {};
  for (const c of line.choices) {
    const ds = line.defs.map(d => Math.abs(posAt(d.m, 0) - c.y)), near = Math.min(...ds, Infinity);
    out[c.id] = near >= (c.id === 'F' ? MARK_M : CLEAR_M) ? 'open' : near <= BLOCK_M ? 'shut' : 'unclear';
  }
  return out;
}

// ---------- a wave ----------
// makeWave(L, seed, ctx): one wave at level L, made from `seed` alone (and ctx). ctx: { hist (the answers before,
// newest last), n (waves before in this run), since (waves since the last friend wave), cy (the pitch's middle across) }.
// Returns { seed, level, kind ('wide' | 'gaps' | 'friend' | 'double'), D, lines: [line], answer } where each line is
// { id, dx (m behind the wave's first line), lanes, choices, defs: [{ m, dx }], openT, lockT, settle, answer, safe: [ids],
//   friend: { side, y } | undefined, second: bool }; times in s from that line's crossing.
export function makeWave(L, seed, ctx = {}) {
  const D = ctx.easy ? easyLevel(L) : dashLevel(L), r = rng(seed), cy = ctx.cy ?? 10, hist = ctx.hist || [], since = ctx.since ?? 9;
  let kind = D.easy ? 'easy' : D.wide ? 'wide' : 'gaps';
  if (!D.wide && !D.easy) {
    const u = r();
    if (D.friend && since >= 2 && (since >= 4 || u < .6)) kind = 'friend';
    else if (D.doubleP && hist.length && r() < D.doubleP && since >= 1) kind = 'double';
  }
  const openT = -(D.see + LOCK), lockT = -LOCK, settleMax = lockT - D.react;
  // the answer: never the same three times running; the first wave either side
  const avoid = hist.length >= 2 && hist.at(-1) === hist.at(-2) ? hist.at(-1) : null;
  const choose = ids => { const ok = ids.filter(i => i !== avoid); return pick(r, ok.length ? ok : ids); };
  for (let tries = 0; tries < 60; tries++) {
    let w = null;
    if (kind === 'easy') w = easyWave(r, D, cy, choose(['L', 'M', 'R']), openT, lockT, settleMax, ctx.n || 0);
    else if (kind === 'wide') w = wideWave(r, D, cy, choose(['L', 'R']), openT, lockT);
    else if (kind === 'gaps') w = gapsWave(r, D, cy, choose(['L', 'M', 'R']), openT, lockT, settleMax);
    else if (kind === 'friend') w = friendWave(r, D, cy, choose, openT, lockT, settleMax);
    else w = doubleWave(r, D, cy, choose(['L', 'R']), openT, lockT, settleMax);
    if (w && w.lines.every(l => ok(l, D))) return { seed, level: L, kind, D, ...w };
  }
  // (a safe fallback, never seen in the tests: the plain wide wave)
  return { seed, level: L, kind: 'wide', D, ...wideWave(r, D, cy, choose(['L', 'R']), openT, lockT) };
}
const lanesOf = (cy, ids) => ids.map(id => ({ id, y: cy + LANES[id] * G }));
function mkLine({ lanes, choices, defs, openT, lockT, answer, dx = 0, friend, second = false }) {
  const settle = Math.max(openT, ...defs.map(d => lastKey(d.m)));
  const line = { dx, lanes, choices, defs, openT, lockT, settle, answer, friend, second };
  const tr = truth(line); line.safe = choices.filter(c => tr[c.id] === 'open').map(c => c.id); line.truth = tr;
  return line;
}
// A line is fair: every choice plainly open or shut; one open at least; the readable rule matches it at `settle` and at
// the lock; every move within a child's pace.
function ok(line, D) {
  const tr = line.truth, vmax = D?.vmax ?? MOVE_MAX;
  if (Object.values(tr).includes('unclear') || !line.safe.length) return false;
  if (line.settle > line.lockT - Math.min(.3, D?.react ?? .3) + 1e-9) return false;
  for (const t of [line.settle + 1e-6, line.lockT]) { const rd = readLine(line, t); if (rd.length !== line.safe.length || rd.some(i => !line.safe.includes(i))) return false; }
  for (const d of line.defs) { const u = Math.abs(d.m.u); if (d.m.kind !== 'stand' && (u < MOVE_MIN || u > vmax || Math.abs(d.m.u1 || 0) > vmax)) return false; }
  return true;
}
// a defender's x: on his line, a little in front or behind, so a line does not look drawn with a ruler
const jx = r => U(r, -.35, .35);
// A forgiving wave (the first legs of a run): three arrows, one slow defender shutting lane `id` (the other two wide
// open). The first wave of a run: he stands; later, half the time, he steps slowly across into his lane from the next one.
// He stands on the middle a quarter of the time: with no tap the boy runs on straight here (no hesitation), mostly free.
function easyWave(r, D, cy, ans, openT, lockT, settleMax, n) {
  const lanes = lanesOf(cy, ['L', 'M', 'R']), ids = ['L', 'M', 'R'].filter(i => i !== ans), id = ids.includes('M') && r() < (ans === 'M' ? 0 : .375) ? 'M' : pick(r, ids.filter(i => i !== 'M')), lane = cy + LANES[id] * G;
  let m = stand(lane + U(r, -.2, .2));
  if (n > 0 && r() < .5) { // a slow step across: from the next lane toward the open side he leaves, into his own
    const from = id === 'M' ? pick(r, ['L', 'R']) : 'M', ys = cy + LANES[from] * G, u = U(r, ...EASY_V) * Math.sign(lane - ys), tm = (lane - ys) / u * -1 - RAMP / 2;
    if (tm - RAMP > openT + .2 && tm + RAMP < settleMax - .1) m = stepTo(ys, lane, tm);
  }
  return { lines: [mkLine({ lanes, choices: lanes, defs: [{ m, dx: jx(r) }], openT, lockT, answer: ans })], answer: ans };
}
// The first two lines: arrows left and right; one side shut by a defender on it, the middle shut by one leaning to that
// side; the other side wide open. Nobody moves.
function wideWave(r, D, cy, ans, openT, lockT) {
  const lanes = lanesOf(cy, ['L', 'M', 'R']), shutId = ans === 'L' ? 'R' : 'L', s = LANES[shutId];
  const defs = [{ m: stand(cy + s * G + U(r, -.3, .3)), dx: jx(r) }, { m: stand(cy + s * U(r, .4, .75)), dx: jx(r) }];
  return { lines: [mkLine({ lanes, choices: lanes.filter(l => l.id !== 'M'), defs, openT, lockT, answer: ans })], answer: ans };
}
// Where a defender ends who shuts lane `id` (a little toward the open lane `open` when the level allows).
const endOn = (r, D, cy, id, open) => { const y = cy + LANES[id] * G, toward = open ? Math.sign(LANES[open] - LANES[id]) : 0; return y + (toward ? toward * U(r, 0, D.narrow) : 0) + U(r, -.25, .25) * (toward ? 0 : 1); };
// How a defender who ends at yF (shutting lane `id`) gets there: standing, stepping across from the open lane (the gap
// looks shut at first and opens), or stepping in from outside.
function moverTo(r, D, cy, yF, id, open, openT, settleMax) {
  const adj = Math.abs(LANES[id] - LANES[open]) === 1, from = adj ? cy + LANES[open] * G + Math.sign(LANES[id] - LANES[open]) * U(r, 0, .5) : yF + Math.sign(LANES[id] - LANES[open]) * U(r, 1.6, 2.4);
  const hi = settleMax - RAMP, lo = openT + .1; if (hi < lo) return stand(yF);
  const tm = lo + (hi - lo) * Math.min(1, U(r, .1, .6) + D.level * .08); // (later and quicker as the level rises)
  return stepTo(from, yF, tm);
}
// A late shift: he stands on lane `id`, moves toward the open lane `open` (it looks like he is shutting it), then turns
// back and ends on `id`.
function lateMover(r, D, cy, yF, id, open, openT, settleMax) {
  const s = Math.sign(LANES[open] - LANES[id]), ys = cy + LANES[id] * G - s * U(r, 0, .3);
  const ta = openT - U(r, .2, .6), ts = settleMax - TURN_RAMP - U(r, 0, .1); if (ts - ta < .45) return null; // (he may already be on his way as the arrows come on)
  const ex = G - U(r, .8, 1.1), u1 = s * Math.min(MOVE_MAX, ex / (ts - ta - RAMP / 2));
  return lateTo(ys, yF, ta, u1, ts);
}
// One who shuts lane `id` (the open lane is `open`), standing, stepping across or shifting late. He always ends on the
// side of the lane he comes from, never past its middle, so while he moves the lane is still in front of him.
function blocker(r, D, cy, id, open, how, openT, settleMax) {
  const lane = cy + LANES[id] * G, tow = Math.sign(LANES[open] - LANES[id]), adj = Math.abs(LANES[open] - LANES[id]) === 1;
  if (how === 'late' && adj) { const yF = lane - tow * U(r, 0, .5), m = lateMover(r, D, cy, yF, id, open, openT, settleMax); if (m) return { m, dx: jx(r) }; }
  if (how === 'step') { const yF = adj ? lane + tow * U(r, 0, D.narrow) : lane - tow * U(r, 0, .4); return { m: moverTo(r, D, cy, yF, id, open, openT, settleMax), dx: jx(r) }; }
  return { m: stand(lane + tow * U(r, 0, D.narrow) + (tow ? 0 : U(r, -.25, .25))), dx: jx(r) };
}
function gapsWave(r, D, cy, ans, openT, lockT, settleMax) {
  const lanes = lanesOf(cy, ['L', 'M', 'R']), shut = ['L', 'M', 'R'].filter(i => i !== ans), late = r() < D.lateP;
  const adj = shut.filter(i => Math.abs(LANES[i] - LANES[ans]) === 1), lateId = late ? pick(r, adj) : null, both = late && adj.length > 1 && D.late2 && r() < D.late2;
  const defs = shut.map(id => blocker(r, D, cy, id, ans, id === lateId || (both && adj.includes(id)) ? 'late' : r() < D.moveP ? 'step' : 'stand', openT, settleMax));
  const sides = shut.filter(i => i !== 'M');
  if (sides.length && r() < D.third) { const s = LANES[pick(r, sides)]; defs.push({ m: stand(cy + s * (G + U(r, 2.3, 3))), dx: jx(r) + U(r, .5, 1.5) }); }
  return { lines: [mkLine({ lanes, choices: lanes, defs, openT, lockT, answer: ans })], answer: ans };
}
// A friend out wide on one side, alongside him: the choices are the gap on the other side, the middle and the friend.
// Free (nobody near him: a wall pass, he plays it first time back into the space behind their line) or marked (one of
// theirs goes out to him: the pass is cut out). As ever, the movement says which.
function friendWave(r, D, cy, choose, openT, lockT, settleMax) {
  const side = r() < .5 ? 'L' : 'R', other = side === 'L' ? 'R' : 'L', fy = cy + LANES[side] * (G + FRIEND_OUT);
  const ans = choose(['F', 'F', other, 'M']); // (the friend about half the time)
  const lanes = [...lanesOf(cy, ['L', 'M', 'R']), { id: 'F', y: fy }], choices = [lanes.find(l => l.id === other), lanes.find(l => l.id === 'M'), lanes.find(l => l.id === 'F')];
  const defs = [], gapShut = ans === 'F' ? [other, 'M'] : [other, 'M'].filter(i => i !== ans), late = r() < D.lateP;
  for (const id of gapShut) { const open = ans === 'F' ? null : ans; defs.push(open ? blocker(r, D, cy, id, open, r() < D.moveP ? 'step' : 'stand', openT, settleMax) : { m: stand(endOn(r, D, cy, id, null)), dx: jx(r) }); }
  // the one on the friend's side: inside on his lane (the friend is free) or out with the friend (marked)
  const sideY = cy + LANES[side] * G, s = Math.sign(fy - sideY);
  if (ans === 'F') { // free: he ends inside; he may start out wide and come in (or, late, go out and come back)
    const yF = sideY - s * U(r, 0, .4), how = r();
    const m = late ? lateTo(sideY - s * .2, yF, openT + U(r, .05, .2), s * Math.min(MOVE_MAX, (FRIEND_OUT - 1) / Math.max(.4, settleMax - TURN_RAMP - openT - .3)), settleMax - TURN_RAMP - .05) : how < D.moveP ? stepTo(fy - s * U(r, .3, .8), yF, openT + .1 + (settleMax - RAMP - openT - .1) * U(r, .1, .5)) : stand(yF);
    defs.push({ m, dx: jx(r) - .6 });
  } else { // marked: he ends with the friend; he may start inside and go out (or, late, come in first and go back out)
    const yF = fy - s * U(r, 0, .5), how = r();
    const ta = openT - U(r, .2, .5), ts = settleMax - TURN_RAMP - .05, m = late && how < .5 ? lateTo(fy - s * .3, yF, ta, -s * Math.min(MOVE_MAX, 2.2 / Math.max(.5, ts - ta - .1)), ts) : how < Math.max(.4, D.moveP) ? stepTo(sideY + s * U(r, 0, .5), yF, openT + .1 + (settleMax - RAMP - openT - .1) * U(r, .1, .5)) : stand(yF);
    defs.push({ m, dx: jx(r) - .6 });
  }
  return { lines: [mkLine({ lanes, choices, defs, openT, lockT, answer: ans, friend: { side, y: fy } })], answer: ans };
}
// Two lines, the second right behind the first, both in sight from the start: the first choice sets up the second.
// 'setup': both sides of the first line are open, but only one side of the second; from the other side he cannot get
// across in time. 'zig': one side of the first line is open, then the middle of the second.
export const DOUBLE_T = 1.2; // s between the two crossings (a cut of one lane fits, two do not)
function doubleWave(r, D, cy, s2, openT, lockT, settleMax) {
  const lanes = lanesOf(cy, ['L', 'M', 'R']), zig = r() < .5, dx = D.v * DOUBLE_T, other = s2 === 'L' ? 'R' : 'L';
  // line 1
  const defs1 = zig ? [other, 'M'].map(id => blocker(r, D, cy, id, s2, r() < D.moveP ? 'step' : 'stand', openT, settleMax))
    : [{ m: stand(cy + U(r, -.4, .4)), dx: jx(r) }];
  const a1 = s2; // (setup: the side whose second line is open; zig: the open side)
  const l1 = mkLine({ lanes, choices: lanes, defs: defs1, openT, lockT, answer: a1 });
  // line 2: its own times (from its own crossing, DOUBLE_T s after the first); in sight from the first one's arrows
  const o2 = openT - DOUBLE_T, sm2 = settleMax - .3; // (its movement settles a little before the usual: he reads it while he deals with the first)
  const shut2 = zig ? ['L', 'R'] : [other, 'M'], open2 = zig ? 'M' : s2;
  const late2 = D.late2 && r() < D.late2 ? pick(r, shut2.filter(i => Math.abs(LANES[i] - LANES[open2]) === 1)) : null; // (from score 16: one of the second row turns back late)
  const defs2 = shut2.map(id => blocker(r, D, cy, id, open2, id === late2 ? 'late' : r() < D.moveP * .7 ? 'step' : 'stand', o2, sm2));
  const l2 = mkLine({ lanes, choices: lanes, defs: defs2, openT: o2, lockT, answer: open2, dx, second: true });
  l1.next = l2;
  return { lines: [l1, l2], answer: a1, zig };
}

// ---------- the run (a leg: some waves, then a shot into the open goal) ----------
// new Dash({ L, W, run, seed, hooks }): run is a mini/rules.js run ({ score, lives, over }); the level of a wave is the
// run's level at the moment he reaches it. hooks (all optional, the page's and the bots'):
//   leg(dash)                         a new leg is set (everyone placed; the page snaps the camera, wipes)
//   open(line) / lock(line)           a line's arrows come on / his pick is final
//   tap(line, id, counted)            a tap on a choice
//   cross(line, ok, info)             a line is over: ok, or { why, by } (the page calls runStep; the run's score moves)
//   again(line, info)                 (v96 fix) a forgiving leg's first tackle: no life lost, the leg starts again
//   tackle(line, by, why)             a defender wins the ball (shown: TACKLE_S s, then fail goes on)
//   pass(line, free, by)              the wall pass goes; back(line): the friend plays it back
//   shot() / goal()                   the finish
//   wipe(on)                          the change of picture between legs (on: going out, off: coming in)
//   over()                            the run has ended (after the last tackle is shown)
export const TACKLE_S = 1.9, GOAL_S = 1, WIPE_S = .5, HESITATE_S = .55, SLOW_K = .55;
export class Dash {
  constructor({ L = 30, W = 20, run, seed = 1, hooks = {} } = {}) {
    Object.assign(this, { Lp: L, Wp: W, cy: W / 2, run, hooks, seed0: seed >>> 0, x0: Math.max(START_X, L - 28.5) }); // (x0: a leg starts in his own half, as far from their goal on every pitch)
    this.r = rng(seed); this.t = 0; this.phase = 'ready'; this.hist = []; this.waves = 0; this.since = 9; this.legsDone = 0; this.forgiven = new Set(); // (legs that ended with the shot; the forgiving legs whose free tackle is used)
    this.hero = { x: this.x0, y: this.cy, vy: 0, v: 0 }; this.defs = []; this.friend = null; this.lines = []; this.i = 0; this.timer = 0; this.ball = 'hero';
  }
  get line() { return this.lines[this.i] || null; }
  nextSeed() { return Math.floor(this.r() * 2147483646) + 1; }
  // ---------- a leg ----------
  // From x0: waves while they fit (at least one), each opening as he gets to it.
  buildLeg(x0) {
    const lines = [], slots = ['o1', 'o2', 'o3', 'o4', 'm2', 'm3']; let x = x0, k = 0, friend = null;
    for (;;) {
      const L = ((this.run?.score || 0) + k) / 3, seed = this.nextSeed();
      const w = makeWave(L, seed, { hist: this.hist, n: this.waves + k, since: this.since, cy: this.cy, easy: this.legsDone < EASY_LEGS });
      const v = w.D.v, X1 = x + v * (w.D.see + LOCK), nDef = w.lines.reduce((a, l) => a + l.defs.length, 0);
      if (lines.length && (X1 + (w.lines.at(-1).dx || 0) > this.Lp - GOAL_ROOM || slots.length < nDef || (friend && w.kind === 'friend'))) break;
      w.lines.forEach((l, j) => {
        l.X = X1 + l.dx; l.v = v; l.wave = w; l.n = j; l.pick = null; l.tapT = null; l.taps = []; l.state = 'wait';
        l.ids = l.defs.map(d => { d.id = slots.shift(); d.x0 = l.X + d.dx; return d.id; });
        lines.push(l);
      });
      if (w.kind === 'friend') friend = { line: lines.at(-1), y: w.lines[0].friend.y };
      this.hist.push(w.answer); if (w.kind === 'double') this.hist.push(w.lines[1].answer);
      this.since = w.kind === 'friend' ? 0 : this.since + 1;
      k += w.lines.length; x = lines.at(-1).X + v * AFTER_S;
      if (lines.at(-1).X > this.Lp - GOAL_ROOM) break;
    }
    this.lines = lines; this.i = 0;
    this.defs = lines.flatMap(l => l.defs.map(d => ({ id: d.id, d, line: l, x: d.x0, y: d.m.y0, vy: 0, vx: 0, beat: 0, over: null })));
    this.friend = friend ? { line: friend.line, y: friend.y, x: x0 + FRIEND_AHEAD, vx: 0, vy: 0, off: false } : null;
    Object.assign(this.hero, { x: x0, y: this.cy, vy: 0, v: lines[0].v });
    this.ball = 'hero'; this.waves += new Set(lines.map(l => l.wave)).size;
    this.place(); this.hooks.leg?.(this);
  }
  // The first leg, set out before play (the page shows it behind the start card); then play.
  prepare() { if (!this.lines.length) this.buildLeg(this.x0); }
  start() { if (this.phase !== 'ready') return; this.prepare(); this.phase = 'run'; }
  // ---------- a tap on a choice (true: it counts) ----------
  tap(id) {
    const l = this.tappable(); let counted = false;
    if (l && l.choices.some(c => c.id === id)) { const t = this.rel(l); if (l.pick !== id) { l.pick = id; l.tapT = t; } counted = true; l.taps.push([+t.toFixed(2), id]); }
    this.hooks.tap?.(l, id, counted); return counted;
  }
  // The line his taps go to now: the first line not yet locked, once its arrows are on; the second line of a double
  // only after the first is locked.
  tappable() {
    if (this.phase !== 'run') return null;
    const l = this.line; if (!l) return null;
    if (l.state === 'open') return l;
    if (l.state === 'locked' && l.next?.state === 'open') return l.next;
    return null;
  }
  rel(l) { return (this.hero.x - l.X) / l.v; } // s from the crossing of line l (negative before it)
  // ---------- one step ----------
  tick(dt) {
    if (!dt || this.phase === 'ready' || this.phase === 'over') return;
    this.t += dt; const h = this.hero;
    if (this.phase === 'wipe') { this.timer -= dt; if (!this.swapped && this.timer <= WIPE_S / 2) { this.swapped = true; this.next?.(); this.hooks.wipe?.(false); } if (this.timer <= 0) this.phase = 'run'; this.place(); return; }
    if (this.phase === 'tackle') { h.v = Math.max(0, h.v - dt * 7); h.x += h.v * dt; h.vy *= Math.exp(-dt * 6); h.y += h.vy * dt; this.timer -= dt; this.moveOver(dt); this.place(); if (this.timer <= 0) this.afterFail(); return; }
    if (this.phase === 'finish' || this.phase === 'goal') return this.finishStep(dt);
    // running: forward at his jog, across as his pick says
    const l = this.line; h.v = l ? l.v * (l.hes ? SLOW_K : 1) : h.v; h.x += h.v * dt;
    for (let j = this.i; j < this.lines.length; j++) {
      const q = this.lines[j], t = this.rel(q);
      if (q.state === 'wait' && t >= q.openT && (j === this.i || q.second)) { q.state = q.second ? 'shown' : 'open'; q.openAt = this.t; this.hooks.open?.(q); }
      if (q.state === 'shown' && this.lines[j - 1]?.state !== 'open' && this.lines[j - 1]?.state !== 'wait') { q.state = 'open'; this.hooks.open?.(q); }
      if (q.state === 'open' && t >= q.lockT) { q.state = 'locked'; if (!q.pick && !q.second && q.wave.kind !== 'easy') { q.hes = this.t; } this.hooks.lock?.(q); } // (a forgiving wave: no tap, he runs on straight)
    }
    this.steer(dt, l);
    this.moveOver(dt); this.place();
    if (!l) { this.phase = 'finish'; return; }
    // the wall pass
    if (l.pick === 'F' && !l.passed && l.state !== 'open' && this.rel(l) >= Math.max(l.tapT ?? -9, l.settle, l.lockT - .05)) this.wallPass(l);
    if (l.passed && !l.free && this.t >= l.cutAt) { this.fail(l, l.by, 'marked'); return; }
    if (l.passed && l.free && this.ball === 'friend' && this.t >= l.backAt) { this.ball = 'air'; this.hooks.back?.(l); }
    if (l.passed && l.free && this.ball === 'air' && this.t >= l.gotAt) { this.ball = 'hero'; this.done(l, true); return; }
    // no pick: he hesitates, the nearest one closes him down
    if (l.hes && !l.passed && this.t - l.hes >= HESITATE_S) { const by = this.nearest(l); this.fail(l, by, 'none'); return; }
    if (!l.passed && this.rel(l) >= 0 && l.state !== 'done') {
      const by = this.tackler(l);
      if (by) this.fail(l, by, (l.second || l.wave.kind === 'easy') && !l.pick ? 'straight' : 'shut'); else this.done(l, true);
    }
  }
  // the defender within reach of the ball at the crossing (the nearest), or null
  tackler(l) { let best = null, bd = TACKLE_R; for (const d of this.defs) if (d.line === l) { const q = Math.abs(d.y - this.hero.y); if (q < bd) { bd = q; best = d; } } return best; }
  nearest(l) { let best = null, bd = Infinity; for (const d of this.defs) if (d.line === l) { const q = Math.abs(d.y - this.hero.y); if (q < bd) { bd = q; best = d; } } return best; }
  steer(dt, l) {
    const h = this.hero; let want = h.y, sp = HOME_V;
    if (l && !l.passed) {
      const t = this.rel(l), c = l.pick && l.choices.find(x => x.id === l.pick), prev = l.second ? this.lines[this.i - 1] : null;
      const canCut = !prev || prev.state === 'done';
      if (c && c.id === 'F') { // a pass to the friend: on his lane, just past the one in front of him on the friend's side
        const by = this.nearest(l), s = Math.sign(c.y - this.cy); want = by && Math.abs(by.y - h.y) < 1.4 ? by.y + s * 1.4 : h.y; sp = t >= l.settle ? SIDE_V : LEAN_V;
      } else if (c && canCut && t >= Math.max(l.tapT, l.settle)) { want = c.y; sp = SIDE_V; }
      else if (c) { const base = l.second ? (prev?.pickY ?? h.y) : this.cy; want = base + Math.max(-LEAN_MAX, Math.min(LEAN_MAX, c.y - base)); sp = LEAN_V; }
      else if (!l.second) { want = this.cy; sp = HOME_V; }
      if (l.hes) { const by = this.nearest(l); if (by) by.over = { x: h.x + .6, y: h.y, at: l.hes }; }
    } else if (l && l.passed && l.free) { const by = this.nearest(l), s = Math.sign(l.friend.y - this.cy); want = by && Math.abs(by.y - h.y) < 1.4 ? by.y + s * 1.4 : h.y; sp = SIDE_V; }
    const dy = want - h.y, vw = Math.sign(dy) * Math.min(sp, 6 * Math.abs(dy)), a = SIDE_ACC * dt;
    h.vy += Math.max(-a, Math.min(a, vw - h.vy)); h.y += h.vy * dt;
  }
  wallPass(l) {
    const f = this.friend; l.passed = this.t; l.free = l.truth.F === 'open';
    if (l.free) { this.ball = 'friend'; l.backAt = this.t + .55; l.gotAt = l.backAt + .65; l.by = null; }
    else { let by = null, bd = Infinity; for (const d of this.defs) if (d.line === l) { const q = Math.abs(posAt(d.d.m, 0) - f.y); if (q < bd) { bd = q; by = d; } } l.by = by; l.cutAt = this.t + .45; this.ball = 'air'; }
    this.hooks.pass?.(l, l.free, l.by);
  }
  done(l, ok) {
    l.state = 'done'; l.pickY = this.hero.y; l.endT = this.t;
    for (const d of this.defs) if (d.line === l) d.beat = this.t;
    this.i++;
    this.hooks.cross?.(l, true, { pick: l.pick, sec: l.endT - (l.openAt ?? l.endT) });
    if (!this.line) this.phase = 'finish';
  }
  fail(l, by, why) {
    l.state = 'done'; l.failed = why; this.phase = 'tackle'; this.timer = TACKLE_S; this.ball = by ? by.id : 'loose';
    if (by) by.over = { x: this.hero.x + .5, y: this.hero.y, at: this.t, lunge: true };
    this.hooks.tackle?.(l, by, why);
    this.failInfo = { l, by, why };
  }
  afterFail() {
    const { l, by, why } = this.failInfo; this.failInfo = null;
    // (v96 fix) a forgiving leg forgives its first tackle: he saw why; it costs no life, and the leg starts again
    if (l.wave.kind === 'easy' && !this.forgiven.has(this.legsDone)) { this.forgiven.add(this.legsDone); this.hooks.again?.(l, { why, by: by?.id || null, pick: l.pick }); }
    else this.hooks.cross?.(l, false, { why, by: by?.id || null, pick: l.pick });
    if (this.run?.over) { this.phase = 'over'; this.hooks.over?.(); return; }
    // again from just before that wave (its first line), with a new wave there
    const first = l.second ? this.lines[this.lines.indexOf(l) - 1] : l, x0 = Math.max(this.x0, first.X - first.v * (first.wave.D.see + LOCK) - .5);
    this.wipe(() => this.buildLeg(x0));
  }
  wipe(next) { this.phase = 'wipe'; this.timer = WIPE_S; this.swapped = false; this.next = next; this.hooks.wipe?.(true); }
  finishStep(dt) {
    const h = this.hero;
    h.x += h.v * dt; const dy = this.cy - h.y; h.vy += Math.max(-SIDE_ACC * dt, Math.min(SIDE_ACC * dt, Math.sign(dy) * Math.min(HOME_V * .6, 3 * Math.abs(dy)) - h.vy)); h.y += h.vy * dt;
    this.moveOver(dt); this.place();
    if (this.phase === 'finish' && h.x >= Math.max(this.lines.at(-1).X + 2, this.Lp - SHOT_BACK)) { this.phase = 'goal'; this.timer = GOAL_S; this.ball = 'air'; this.hooks.shot?.(); this.goalAt = .6; }
    if (this.phase === 'goal') {
      h.v = Math.max(1.5, h.v - dt * 2.5); this.timer -= dt;
      if (this.goalAt != null && GOAL_S - this.timer >= this.goalAt) { this.goalAt = null; this.hooks.goal?.(); }
      if (this.timer <= 0) this.wipe(() => { this.legsDone++; this.buildLeg(this.x0); });
    }
  }
  // Defenders: each on his line, moving across as his plan says (by the time from his line's crossing); one closing him
  // down or winning the ball goes at him; once beaten they turn and chase a little. The friend runs alongside.
  moveOver(dt) {
    const h = this.hero;
    for (const p of this.defs) {
      const l = p.line, t = this.rel(l);
      if (p.over && this.t >= p.over.at) { const k = Math.min(1, dt * (p.over.lunge ? 9 : 4)); p.vx = (p.over.x - p.x) * k / dt; p.vy = (p.over.y - p.y) * k / dt; p.x += (p.over.x - p.x) * k; p.y += (p.over.y - p.y) * k; if (p.over.lunge && this.phase === 'tackle' && this.timer < TACKLE_S - .45) { p.over = null; p.away = true; } continue; }
      if (p.away) { p.vx = -2.6; p.vy = 0; p.x += p.vx * dt; continue; }
      const ny = posAt(p.d.m, Math.min(t, l.state === 'done' ? 0 : t));
      p.vy = l.state === 'done' ? 0 : velAt(p.d.m, t); p.y = ny;
      if (p.beat) { const s = this.t - p.beat; p.vx = s < 1 ? 2.2 * (1 - s) : 0; p.x += p.vx * dt; } else p.vx = 0;
    }
    const f = this.friend;
    if (f) {
      const l = f.line, live = l.state !== 'done' || this.t - (l.endT ?? this.t) < .5;
      if (live && !f.off) { const want = h.x + FRIEND_AHEAD; f.vx = (want - f.x) / Math.max(dt, 1e-3) * Math.min(1, dt * 5); f.x += f.vx * dt; f.vy = 0; }
      else { f.off = true; f.vx = Math.max(0, f.vx - dt * 6); f.x += f.vx * dt; }
    }
  }
  place() {} // (the page reads hero, defs, friend after each tick)
  // What a person sees now, for the bots: the line his taps go to, the time to its lock, every defender of the lines in
  // sight (where, how fast across), the choices.
  view() {
    const l = this.tappable(); if (!l) return null;
    const t = this.rel(l), see = this.lines.slice(this.i).filter(q => q.state !== 'wait');
    return { line: l, t, toLock: l.lockT - t, hero: { ...this.hero }, choices: l.choices, lanes: l.lanes, defs: this.defs.filter(d => see.includes(d.line)).map(d => ({ id: d.id, line: d.line, y: d.y, vy: d.vy })), next: l.next && l.next.state !== 'wait' ? l.next : null };
  }
}

// ---------- two players for the checks (tests/dash.test.js, the numbers in the v96 report) ----------
// Each looks at what is on the pitch now (Dash.view: where each defender is and how fast he moves across) and taps.
//  - 'adult': looks for a moment after the arrows come on (0.5 s and more, longer with more defenders), reads by the
//    rule (readLine: standing shuts his lane, moving shuts the next lane on his way; a drift slower than SEE_V m/s looks
//    like standing; now and then he takes a moving one for standing, more often the more of them move), taps; keeps
//    watching, and when a defender changes his movement, reads again after a reaction time (0.4 to 0.9 s) and taps again
//    if the answer changed. In a double he picks the gap of the first line that leads to an open gap in the second.
//  - 'child': careless: taps at a random moment, often early, by where the defenders stand (not how they move); a third
//    of his taps are anywhere; now and then he does not tap, or taps twice.
//  - 'careful' (v96 fix): an adult who reads by the rule and never slips, with a person's limits: he sees a change of
//    movement only after a reaction time (REACT_MIN s and more), and judges each defender's pace with an error of up to
//    SPEED_ERR (a drift under CAREFUL_V m/s, as he judges it, looks like standing).
export const SEE_V = .6, REACT_MIN = .35, SPEED_ERR = .25, CAREFUL_V = .45;
export function bot(kind, rnd) {
  if (kind === 'careful') return careful(rnd);
  let cur = null, at = 0, picked = null, mem = null, again = null, extra = null;
  const nearY = (v, y) => v.defs.filter(d => d.line === v.line).reduce((a, d) => Math.min(a, Math.abs(d.y - y)), Infinity);
  const ruleRead = v => { const ds = v.defs.filter(d => d.line === v.line), mv = ds.filter(d => Math.abs(d.vy) >= SEE_V), slip = mv.length && rnd() < .03 + .07 * mv.length ? pick(rnd, mv) : null; // (a slip: one moving defender taken for standing; likelier the more of them move)
    const line = { lanes: v.lanes, choices: v.choices, defs: ds.map(d => ({ m: { y0: d.y, keys: [[0, d === slip ? 0 : d.vy]], kind: '' } })) }; return readLine(line, 1e-9, SEE_V); }; // (what he sees now: where each is, how fast across)
  const choose = v => {
    if (kind === 'child') {
      if (rnd() < .33) return pick(rnd, v.choices).id;
      const free = v.choices.filter(c => nearY(v, c.y) >= 1.6); return (free.length ? pick(rnd, free) : pick(rnd, v.choices)).id;
    }
    let ok = ruleRead(v);
    if (v.next && ok.length > 1) { const nx = readLine(v.next, Math.max(v.next.openT, v.t - DOUBLE_T), SEE_V).map(id => v.next.choices.find(c => c.id === id).y); const lead = ok.filter(id => { const y = v.choices.find(c => c.id === id).y; return nx.some(q => Math.abs(q - y) <= G + .1); }); if (lead.length) ok = lead; }
    if (!ok.length) return v.choices.reduce((a, c) => (nearY(v, c.y) > nearY(v, a.y) ? c : a)).id;
    return ok.reduce((a, id) => (Math.abs(v.choices.find(c => c.id === id).y - v.hero.y) < Math.abs(v.choices.find(c => c.id === a).y - v.hero.y) ? id : a));
  };
  return {
    step(d) {
      const v = d.view(), now = d.t; if (!v) return;
      if (v.line !== cur) {
        cur = v.line; picked = null; again = null; mem = new Map(); extra = null;
        const n = v.defs.filter(x => x.line === cur).length;
        at = now + (kind === 'child' ? (rnd() < .08 ? 99 : U(rnd, .4, 2.6) * (rnd() < .3 ? 1.3 : 1)) : (cur.second ? .3 + .2 * rnd() : .5 + .12 * n + .3 * rnd()));
      }
      if (kind === 'adult') for (const x of v.defs) if (x.line === cur) { const q = Math.abs(x.vy) < SEE_V ? 0 : Math.sign(x.vy), was = mem.get(x.id); if (was !== undefined && was !== q && picked) again = now + .4 + .35 * rnd() + (v.defs.filter(y => y.line === cur && Math.abs(y.vy) >= SEE_V).length > 1 ? .15 : 0); mem.set(x.id, q); }
      if (!picked && now >= at) { picked = choose(v); d.tap(picked); if (kind === 'child' && rnd() < .35) extra = now + U(rnd, .2, .9); }
      else if (again && now >= again) { again = null; const p = choose(v); if (p !== picked) { picked = p; d.tap(p); } }
      else if (extra && now >= extra) { extra = null; d.tap(rnd() < .5 ? pick(rnd, v.choices).id : picked); }
    },
  };
}

// The careful adult with a person's limits (bot 'careful'). Each line: a first look REACT_MIN to REACT_MIN + 0.25 s after
// its arrows come on (0.08 s more for each defender), then a tap by the rule (readLine) on what he sees then: where each
// defender is and how fast across, each pace judged with its own error (up to SPEED_ERR either way, the same all line).
// He keeps watching: when a defender's movement changes as he judges it (stands, goes one way, the other), he reads again
// a reaction time later (REACT_MIN to REACT_MIN + 0.3 s) and taps again if the answer changed. In a double he picks the gap
// of the first line that leads to an open gap of the second (as 'adult').
function careful(rnd) {
  let cur = null, at = 0, picked = null, mem = null, again = null, err = null;
  const seen = (v, x) => { if (!err.has(x.id)) err.set(x.id, 1 + (rnd() * 2 - 1) * SPEED_ERR); return x.vy * err.get(x.id); };
  const state = (v, x) => { const q = seen(v, x); return Math.abs(q) < CAREFUL_V ? 0 : Math.sign(q); };
  const read = v => {
    const ds = v.defs.filter(d => d.line === v.line);
    const line = { lanes: v.lanes, choices: v.choices, defs: ds.map(d => ({ m: { y0: d.y, keys: [[0, state(v, d) ? seen(v, d) : 0]], kind: '' } })) };
    let ok = readLine(line, 1e-9, CAREFUL_V - 1e-9);
    if (v.next && ok.length > 1) { const nx = readLine(v.next, Math.max(v.next.openT, v.t - DOUBLE_T), SEE_V).map(id => v.next.choices.find(c => c.id === id).y); const lead = ok.filter(id => { const y = v.choices.find(c => c.id === id).y; return nx.some(q => Math.abs(q - y) <= G + .1); }); if (lead.length) ok = lead; }
    const nearY = y => ds.reduce((a, d) => Math.min(a, Math.abs(d.y - y)), Infinity);
    if (!ok.length) return v.choices.reduce((a, c) => (nearY(c.y) > nearY(a.y) ? c : a)).id;
    return ok.reduce((a, id) => (Math.abs(v.choices.find(c => c.id === id).y - v.hero.y) < Math.abs(v.choices.find(c => c.id === a).y - v.hero.y) ? id : a));
  };
  return {
    step(d) {
      const v = d.view(), now = d.t; if (!v) return;
      if (v.line !== cur) { cur = v.line; picked = null; again = null; mem = new Map(); err = new Map(); at = now + REACT_MIN + .25 * rnd() + .08 * v.defs.filter(x => x.line === cur).length; }
      for (const x of v.defs) if (x.line === cur) { const q = state(v, x), was = mem.get(x.id); if (was !== undefined && was !== q && picked && !again) again = now + REACT_MIN + .3 * rnd(); mem.set(x.id, q); }
      if (!picked && now >= at) { picked = read(v); d.tap(picked); }
      else if (again && now >= again) { again = null; const p = read(v); if (p !== picked) { picked = p; d.tap(p); } }
    },
  };
}
