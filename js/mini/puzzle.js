// Soccer puzzles (v90, rules redone in v93, v96: a friend's run and the lane defender), a mini game: "score in N moves"
// on a small part of the pitch. The rules, the other team's answer, the solver, the generator and the difficulty; no page
// here, so the tests and the bots use it as it is (mini/puzzle-ui.js plays it in the 3D world).
//
// The board: W places from our end to their goal (x = 0 .. W-1; the goal is past x = W-1) and H places across
// (y = 0 .. H-1). The goal mouth is three places: the rows mid-1, mid, mid+1 (mid: the middle row).
// Ours stand on places; one has the ball. Theirs press the ball, mark a man or stand in a passing lane; their keeper is
// in the goal.
//
// THE KEEPER (v93: the heart of it; the owner: "once you're in front the goalie can't really do anything"):
//   a keeper standing still covers the whole goal. A keeper who just had to move covers only the spot he is on and the
//   spot he came from. So a goal needs his last move to pull him across, and the shot to the one spot he cannot reach
//   ("move the keeper, then finish the other side"). He moves when the ball changes side: after each move he steps one
//   spot toward the ball's row (the ball above the goal: the top spot; below it: the bottom spot; level with it: the middle).
//
// His move is one tap:
//   pass:    tap a friend. A red player within LANE of the ball's path cuts it out. After a pass the passer runs on one
//            place toward the goal, if that place is free (the give-and-go run).
//   dribble: tap a free place next to the ball. A place next to a red player (or next to the keeper) is a tackle.
//   shoot:   tap a spot in the goal, from the box (the last BOX columns, within BOX rows of the middle). The keeper saves
//            a shot at a spot he covers; a red player within LANE of its path blocks it.
//   run (v96): tap a friend's arrow. A friend with an arrow on the grass can make that run once, without the ball, from
//            where he started (two places). Nobody tackles a run. The ball does not move, so the keeper stands still.
// A tap that is none of these is refused and costs nothing. A cut pass, a tackle, a save or a block fails the puzzle; so
// does running out of moves.
// After each of his moves (not a shot) their answer, in this order:
//   1. the keeper steps one spot toward the ball's side (see above);
//   2. each marker steps one place toward the place next to his man that is nearest the ball (with his man on the ball,
//      the place next to him nearest the goal), never leaving his man if he can help it; a man who ran two places is a
//      place ahead of him after it (the run beats his marker for a move);
//   3. (v96) each lane defender steps one place toward the middle of the passing lane from the ball to his man (he
//      stands in the lane, not on the man); with his man on the ball he marks him;
//   4. the nearest presser (the `press` nearest, later) steps one place toward the ball, and stops next to it.
import { ease } from './rules.js';

export const LANE = .62;   // places: a red player this close to a pass or shot's path cuts it out
export const BOX = 2;      // shots from the last BOX columns, within BOX rows of the middle
export const DIRS = [[1, 0], [0, -1], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1]]; // (a fixed order: ties go to the first)
// The ideas a solution carries. Every goal moves the keeper ('keeper'); the others come on top of it.
//   getOpen (v96): a friend runs, beats his marker, and gets the ball.   decoy (v96): a friend runs, takes his marker
//   with him, and that opens the way for the ball to someone else.        screen (v96): the ball goes round a defender
//   who stood in the lane to a friend (it gets to that friend another way, or after he was pulled out of the lane).
export const IDEAS = ['keeper', 'dribble', 'switch', 'around', 'draw', 'giveGo', 'screen', 'getOpen', 'decoy'];
const RANK = { decoy: 9, getOpen: 8, screen: 7, giveGo: 6, draw: 5, around: 4, switch: 3, dribble: 1, keeper: 0 };
// Roles: -1 a presser; j >= 0 marks friend j; LANE_ROLE(j) = -2 - j stands in the lane to friend j.
export const LANE_ROLE = j => -2 - j;
export const laneOf = role => (role <= -2 ? -2 - role : -1);

// ---------- a seeded stream (the same seed: the same puzzle) ----------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- how hard, by level (a third of a level a puzzle solved: mini/rules.js) ----------
// The one place to tune it (v96, the owner's son "really likes the puzzles"; the brief: the first one or two gentle, then
// rising fast). The very first puzzle of a run, at a score of 0, is the plainest case of the keeper rule (pass across,
// finish). A score of 1: the keeper rule again, with a defender to get round (no new rule). From 2 each new situation
// comes alone first (the friend's run at 2, the lane defender at 4), then they mix (`sits`: the situations a puzzle may
// be, picked by its seed; 'both': the run and the lane defender in one). Each stepped number moves by one at its own
// score (no two at the same puzzle), and only the hard way.
//   W, H     the board (places to the goal, places across)       ours    our players, the ball carrier included
//   def      their field players (the keeper besides)              mark    how many of them mark a man (at least)
//   press    how many of the nearest step toward the ball          spare   moves beyond the shortest solution
//   lenLo/Hi the shortest solution's length (moves)                firsts  winning first moves at most
//   ideas    ideas the shortest solution carries at least (the keeper's is one)
//   first    the first puzzle: pass across, then finish (the obvious lines are allowed to win)
//   sec      the sand timer (s; 0: none)
// Each threshold is a number of puzzles solved (a score), all different. (The 3D world has bodies for four of ours and
// four of theirs: ours and def stay at 4 or less.)
const past = (L, at) => at.filter(n => L >= n / 3 - 1e-9).length;
// (v96 fix) At a score of 0 and 1 the puzzle is one whose right move the picture's cues point to: a child who only
// follows them (never a pass down a red lane, a run onto a red square or a shot at a grey spot; a shot at a gold spot
// whenever there is one; otherwise any other move) solves it at least CUE_MIN of the time (cueChance, worked out exactly).
export const CUE_MIN = .6, CUE_TO = 2, CUE_SPARE = 2;
export const FIRST = { W: 6, H: 5, ours: 3, def: 1, mark: 0, press: 1, spare: CUE_SPARE, lenLo: 2, lenHi: 2, firsts: 3, ideas: 1, first: true, sec: 0, sits: ['plain'], cue: CUE_MIN };
export const SITS = ['plain', 'run', 'screen', 'decoy', 'both'];
export function puzzleLevel(L) {
  L = Math.max(0, L);
  if (L < 1 / 3 - 1e-9) return { ...FIRST, sits: [...FIRST.sits] };
  const n = Math.round(L * 3);
  const sits = n < 2 ? ['plain'] : n < 4 ? ['run'] : n < 5 ? ['screen'] : n < 8 ? ['run', 'screen', 'decoy', 'plain'] : ['run', 'screen', 'decoy', 'both', 'both'];
  return {
    W: 6 + past(L, [15]), H: 5 + past(L, [11]), ours: 3 + past(L, [10]),
    def: 1 + past(L, [4, 8, 16]), mark: past(L, [7, 19]), press: 1 + past(L, [29]),
    spare: n < CUE_TO ? CUE_SPARE : 1 - past(L, [6]), lenLo: 2 + past(L, [3, 9, 17, 27]), lenHi: 2 + past(L, [2, 5, 14, 23]),
    firsts: 3 - past(L, [12, 18]), ideas: 1 + past(L, [13]), first: false,
    sec: L < 34 / 3 - 1e-9 ? 0 : ease(120, 30, 10)(L - 34 / 3), sits, cue: n < CUE_TO ? CUE_MIN : 0,
  };
}
// The numbers that move in steps, for the tests.
export const STEPPED = ['W', 'H', 'ours', 'def', 'mark', 'press', 'spare', 'lenLo', 'lenHi', 'firsts', 'ideas'];

// ---------- the board ----------
// A state: o (ours, flat [x0, y0, x1, y1, ...]), b (who has the ball), d (theirs, flat), g (the keeper's spot: a row),
// k (the spot he came from if he moved in the last answer, else -1: he stands still), u (v96: the runs made, one bit a
// friend). The puzzle holds what never changes: W, H, roles (per defender: see LANE_ROLE), press, runs (per friend: the
// place his arrow points to, or null).
export const mid = pz => (pz.H - 1) >> 1;
export const goalRows = pz => [mid(pz) - 1, mid(pz), mid(pz) + 1];
export const inBox = (pz, x, y) => x >= pz.W - BOX && Math.abs(y - mid(pz)) <= BOX;
const copy = s => ({ o: s.o.slice(), b: s.b, d: s.d.slice(), g: s.g, k: s.k, u: s.u || 0 });
export const startOf = pz => copy(pz.start);
export const keyOf = s => String.fromCharCode(...s.o, 40 + s.b, ...s.d, 50 + s.g, 60 + s.k, 70 + (s.u || 0));
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const e2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export function ourAt(s, x, y) { const o = s.o; for (let i = 0; i < o.length; i += 2) if (o[i] === x && o[i + 1] === y) return i >> 1; return -1; }
export function theirAt(s, x, y) { const d = s.d; for (let i = 0; i < d.length; i += 2) if (d[i] === x && d[i + 1] === y) return i >> 1; return -1; }
const free = (pz, s, x, y) => x >= 0 && y >= 0 && x < pz.W && y < pz.H && ourAt(s, x, y) < 0 && theirAt(s, x, y) < 0;
// The keeper's spot for a ball on row y: level with it, or the nearest post.
export const sideOf = (pz, y) => Math.max(mid(pz) - 1, Math.min(mid(pz) + 1, y));
// Whether the keeper covers goal spot r: all of them standing still; after a move, his spot and the one he came from.
export const covers = (s, r) => (s.k < 0 ? true : r === s.g || r === s.k);
// Who cuts out the path from (ax, ay) to (bx, by): the first red player within LANE of it, past the start and up to the
// end: { who (a defender's index), x, y, t (how far along) }, or null (open).
export function cutBy(pz, s, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, d = s.d; let best = null, bt = 9;
  for (let i = 0; i < d.length; i += 2) {
    const x = d[i], y = d[i + 1], t = ((x - ax) * vx + (y - ay) * vy) / l2; if (t <= 0 || t > 1 + 1e-9 || t >= bt) continue;
    const px = ax + vx * t - x, py = ay + vy * t - y;
    if (px * px + py * py < LANE * LANE) { bt = t; best = { who: i >> 1, x, y, t }; }
  }
  return best;
}
const isCut = (pz, s, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, d = s.d;
  for (let i = 0; i < d.length; i += 2) {
    const x = d[i], y = d[i + 1], t = ((x - ax) * vx + (y - ay) * vy) / l2; if (t <= 0 || t > 1 + 1e-9) continue;
    const px = ax + vx * t - x, py = ay + vy * t - y; if (px * px + py * py < LANE * LANE) return true;
  }
  return false;
};
// Whether a red player (or the keeper, from his goal) is on or next to a place: the tackle rule.
export function pressedAt(pz, s, x, y) {
  const d = s.d; for (let i = 0; i < d.length; i += 2) if (Math.abs(d[i] - x) <= 1 && Math.abs(d[i + 1] - y) <= 1) return true;
  return Math.abs(pz.W - x) <= 1 && Math.abs(s.g - y) <= 1;
}
// Who would tackle on that place: [x, y] of the red player or the keeper next to it (the nearest), or null.
export function tacklerAt(pz, s, x, y) {
  let who = null, best = 9;
  for (let k = 0; k < s.d.length; k += 2) { const c = cheb(s.d[k], s.d[k + 1], x, y); if (c <= 1 && c < best) { best = c; who = [s.d[k], s.d[k + 1]]; } }
  if (!who && Math.abs(pz.W - x) <= 1 && Math.abs(s.g - y) <= 1) who = [pz.W, s.g];
  return who;
}
// (v96) Whether friend i can make his run now: he has an arrow, has not run, is on his start place without the ball, and
// the place it points to is free.
export function canRun(pz, s, i) {
  const t = pz.runs?.[i]; if (!t || i === s.b || ((s.u || 0) >> i) & 1) return false;
  const st = pz.start.o; if (s.o[2 * i] !== st[2 * i] || s.o[2 * i + 1] !== st[2 * i + 1]) return false;
  return free(pz, s, t[0], t[1]);
}

// ---------- his moves ----------
// A move, as the log writes it: 'p<i>' (pass to friend i), 'd<x>,<y>' (dribble to that place), 's<row>' (shoot at that
// goal spot), 'r<i>' (v96: friend i makes his run). Inside, a number: i, 32 + x * 16 + y, 512 + row, or 768 + i.
export const toCode = mv => { const r = mv.slice(1).split(',').map(Number); return mv[0] === 'p' ? r[0] : mv[0] === 'd' ? 32 + r[0] * 16 + r[1] : mv[0] === 's' ? 512 + r[0] : mv[0] === 'r' ? 768 + r[0] : -1; };
export const toMove = c => (c < 32 ? 'p' + c : c < 512 ? 'd' + ((c - 32) >> 4) + ',' + ((c - 32) & 15) : c < 768 ? 's' + (c - 512) : 'r' + (c - 768));
export const parse = mv => { const c = typeof mv === 'number' ? mv : toCode(mv); return c < 0 || Number.isNaN(c) ? { k: '?' } : c < 32 ? { k: 'p', i: c } : c < 512 ? { k: 'd', x: (c - 32) >> 4, y: (c - 32) & 15 } : c < 768 ? { k: 's', i: c - 512 } : { k: 'r', i: c - 768 }; };
function codes(pz, s) {
  const out = [], bx = s.o[2 * s.b], by = s.o[2 * s.b + 1], n = s.o.length >> 1;
  for (let i = 0; i < n; i++) if (i !== s.b) out.push(i);
  for (const [dx, dy] of DIRS) { const x = bx + dx, y = by + dy; if (free(pz, s, x, y)) out.push(32 + x * 16 + y); }
  if (inBox(pz, bx, by)) { const M = mid(pz); out.push(512 + M - 1, 512 + M, 512 + M + 1); }
  if (pz.runs) for (let i = 0; i < n; i++) if (canRun(pz, s, i)) out.push(768 + i);
  return out;
}
// Every move he can make (not refused) from s.
export const movesFrom = (pz, s) => codes(pz, s).map(toMove);
// A move's outcome from s (no answer yet): 0 refused, 1 ok, 2 a goal, 3 cut / tackled / blocked, 4 saved.
function outcome(pz, s, c) {
  const bx = s.o[2 * s.b], by = s.o[2 * s.b + 1];
  if (!(c >= 0)) return 0;
  if (c < 32) { if (c >= s.o.length >> 1 || c === s.b) return 0; return isCut(pz, s, bx, by, s.o[2 * c], s.o[2 * c + 1]) ? 3 : 1; }
  if (c < 512) { const x = (c - 32) >> 4, y = (c - 32) & 15; if (cheb(bx, by, x, y) !== 1 || !free(pz, s, x, y)) return 0; return pressedAt(pz, s, x, y) ? 3 : 1; }
  if (c < 768) { const r = c - 512, M = mid(pz); if (r < M - 1 || r > M + 1 || !inBox(pz, bx, by)) return 0; return isCut(pz, s, bx, by, pz.W, r) ? 3 : covers(s, r) ? 4 : 2; }
  return canRun(pz, s, c - 768) ? 1 : 0;
}
// What a move does from s, before their answer: null (refused: costs nothing), or { ok, why, cut, goal, to }.
// why: 'cut' (a pass cut out), 'tackle' (a dribble next to theirs), 'blocked' (a shot into a red player), 'saved'.
export function check(pz, s, mv) {
  const c = typeof mv === 'number' ? mv : toCode(mv), o = outcome(pz, s, c); if (!o) return null;
  const m = parse(c), bx = s.o[2 * s.b], by = s.o[2 * s.b + 1];
  const to = m.k === 'p' ? [s.o[2 * m.i], s.o[2 * m.i + 1]] : m.k === 'd' ? [m.x, m.y] : m.k === 'r' ? pz.runs[m.i].slice() : [pz.W, m.i];
  const cut = o === 3 && m.k !== 'd' ? cutBy(pz, s, bx, by, to[0], to[1]) : null;
  const why = o === 4 ? 'saved' : o === 3 ? (m.k === 'p' ? 'cut' : m.k === 'd' ? 'tackle' : 'blocked') : null;
  return { ok: o < 3, why, cut, goal: o === 2, to, by: o === 3 && m.k === 'd' ? tacklerAt(pz, s, to[0], to[1]) : null };
}
// His move (one that is ok, not a shot), the run on and their answer. Returns { s (the new state), runs ([who, from,
// to]: ours that moved), steps ([who, from, to]: theirs; for the keeper, who is 'gk' and from, to are rows), was (the
// state before their answer) }.
export function play(pz, s0, mv) {
  const c = typeof mv === 'number' ? mv : toCode(mv), s = copy(s0), runs = [];
  move(pz, s, c, runs);
  const was = copy(s), steps = [];
  answer(pz, s, steps);
  return { s, runs, steps, was };
}
function move(pz, s, c, runs) {
  if (c < 32) {
    const from = s.b, x = s.o[2 * from], y = s.o[2 * from + 1]; s.b = c;
    if (free(pz, s, x + 1, y)) { s.o[2 * from] = x + 1; runs?.push([from, [x, y], [x + 1, y]]); } // (the passer runs on)
  } else if (c < 512) { const x = (c - 32) >> 4, y = (c - 32) & 15; runs?.push([s.b, [s.o[2 * s.b], s.o[2 * s.b + 1]], [x, y]]); s.o[2 * s.b] = x; s.o[2 * s.b + 1] = y; }
  else if (c >= 768) { const i = c - 768, t = pz.runs[i]; runs?.push([i, [s.o[2 * i], s.o[2 * i + 1]], [t[0], t[1]]]); s.o[2 * i] = t[0]; s.o[2 * i + 1] = t[1]; s.u = (s.u || 0) | (1 << i); }
}
const next = (pz, s0, c) => { const s = copy(s0); move(pz, s, c, null); answer(pz, s, null); return s; };
// Their answer (changes s; their steps go into `steps`). See the top of this file.
export function answer(pz, s, steps = []) {
  const bx = s.o[2 * s.b], by = s.o[2 * s.b + 1], M = mid(pz), d = s.d;
  const tr = sideOf(pz, by); // 1. the keeper
  if (tr !== s.g) { const g = s.g + Math.sign(tr - s.g); steps?.push(['gk', s.g, g]); s.k = s.g; s.g = g; } else s.k = -1;
  const step = (i, tx, ty) => { // one place toward (tx, ty), to a free place, only if it gets him closer
    const x = d[2 * i], y = d[2 * i + 1]; let bx2 = -1, by2 = -1, kc = cheb(x, y, tx, ty), ke = e2(x, y, tx, ty);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!free(pz, s, nx, ny)) continue;
      const c = cheb(nx, ny, tx, ty), e = e2(nx, ny, tx, ty);
      if (c < kc || (c === kc && e < ke)) { kc = c; ke = e; bx2 = nx; by2 = ny; }
    }
    if (bx2 >= 0) { steps?.push([i, [x, y], [bx2, by2]]); d[2 * i] = bx2; d[2 * i + 1] = by2; }
  };
  const roles = pz.roles;
  const mark = (i, j) => { // marker i stays with his man j
    const mx = s.o[2 * j], my = s.o[2 * j + 1], x = d[2 * i], y = d[2 * i + 1], onBall = j === s.b;
    const ax = onBall ? pz.W : bx, ay = onBall ? M : by; let tx = -1, ty = -1, tk = 1e9;
    for (const [dx, dy] of DIRS) {
      const nx = mx + dx, ny = my + dy; if (!(nx === x && ny === y) && !free(pz, s, nx, ny)) continue;
      const k = e2(nx, ny, ax, ay); if (k < tk) { tk = k; tx = nx; ty = ny; }
    }
    if (tx < 0 || (tx === x && ty === y)) return;
    let bx2 = x, by2 = y, k0 = [cheb(x, y, mx, my) <= 1 ? 0 : 1, cheb(x, y, tx, ty), e2(x, y, tx, ty)];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (!free(pz, s, nx, ny)) continue;
      const k = [cheb(nx, ny, mx, my) <= 1 ? 0 : 1, cheb(nx, ny, tx, ty), e2(nx, ny, tx, ty)];
      if (k[0] < k0[0] || (k[0] === k0[0] && (k[1] < k0[1] || (k[1] === k0[1] && k[2] < k0[2])))) { k0 = k; bx2 = nx; by2 = ny; }
    }
    if (bx2 !== x || by2 !== y) { steps?.push([i, [x, y], [bx2, by2]]); d[2 * i] = bx2; d[2 * i + 1] = by2; }
  };
  for (let i = 0; i < roles.length; i++) if (roles[i] >= 0) mark(i, roles[i]); // 2. the markers
  for (let i = 0; i < roles.length; i++) { // 3. (v96) the lane defenders
    const j = laneOf(roles[i]); if (j < 0) continue;
    if (j === s.b) { mark(i, j); continue; }
    const t = laneSpot(pz, s, bx, by, s.o[2 * j], s.o[2 * j + 1], d[2 * i], d[2 * i + 1]);
    if (t) step(i, t[0], t[1]);
  }
  let ps = null; // 4. the pressers, nearest first
  for (let i = 0; i < roles.length; i++) if (roles[i] === -1) (ps ||= []).push([cheb(d[2 * i], d[2 * i + 1], bx, by), e2(d[2 * i], d[2 * i + 1], bx, by), i]);
  if (ps) { ps.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]); for (let k = 0; k < Math.min(pz.press, ps.length); k++) if (ps[k][0] > 1) step(ps[k][2], bx, by); }
  return steps;
}
// (v96) Where a lane defender wants to stand: the place nearest the middle of the lane from the ball (bx, by) to his man
// (fx, fy), off both of them; where he is already counts (he stays when he is in it). null when the two are side by side.
export function laneSpot(pz, s, bx, by, fx, fy, x, y) {
  if (cheb(bx, by, fx, fy) <= 1) return null;
  const mx = (bx + fx) / 2, my = (by + fy) / 2; let best = null, bk = 1e9;
  for (let cx = Math.floor(mx) - 1; cx <= Math.ceil(mx) + 1; cx++) for (let cy = Math.floor(my) - 1; cy <= Math.ceil(my) + 1; cy++) {
    if (cx < 0 || cy < 0 || cx >= pz.W || cy >= pz.H || (cx === bx && cy === by) || (cx === fx && cy === fy)) continue;
    if (!(cx === x && cy === y) && !free(pz, s, cx, cy)) continue;
    // on the lane (within LANE of it) first, then nearest its middle; ties: the one he is on
    const vx = fx - bx, vy = fy - by, l2 = vx * vx + vy * vy, t = Math.max(0, Math.min(1, ((cx - bx) * vx + (cy - by) * vy) / l2));
    const off = Math.hypot(bx + vx * t - cx, by + vy * t - cy), k = (off < LANE ? 0 : 100) + e2(cx, cy, mx, my) - (cx === x && cy === y ? .01 : 0);
    if (k < bk) { bk = k; best = [cx, cy]; }
  }
  return best;
}

// ---------- the solver ----------
// Breadth first over his moves, each followed by their answer. shortest(pz, s, n): the length of the shortest solution
// from s within n moves (0: none).
export function shortest(pz, s, n) {
  let front = [s]; const seen = new Set([keyOf(s)]);
  for (let k = 1; k <= n; k++) {
    const nx = [];
    for (const st of front) for (const c of codes(pz, st)) {
      const o = outcome(pz, st, c); if (o === 2) return k; if (o !== 1 || k === n) continue;
      const r = next(pz, st, c), key = keyOf(r); if (!seen.has(key)) { seen.add(key); nx.push(r); }
    }
    front = nx; if (!front.length) break;
  }
  return 0;
}
// How many winning sequences there are from s within k moves (a goal ends one), with a memo shared by the calls on one
// puzzle.
export class Solver {
  constructor(pz) { this.pz = pz; this.memo = new Map(); }
  count(s, k, key = keyOf(s)) {
    if (k <= 0) return 0;
    const mk = key + k, m = this.memo.get(mk); if (m !== undefined) return m;
    let n = 0;
    for (const c of codes(this.pz, s)) {
      const o = outcome(this.pz, s, c); if (o === 2) n++; else if (o === 1 && k > 1) n += this.count(next(this.pz, s, c), k - 1);
    }
    this.memo.set(mk, n); return n;
  }
  // The first moves that win within k (codes, with how many ways each).
  firsts(s, k) {
    const out = [];
    for (const c of codes(this.pz, s)) { const o = outcome(this.pz, s, c); const n = o === 2 ? 1 : o === 1 && k > 1 ? this.count(next(this.pz, s, c), k - 1) : 0; if (n) out.push([c, n]); }
    return out;
  }
  // Every winning sequence of exactly the shortest length `len` from s (as moves), up to cap.
  shortestAll(s, len, cap = 60) {
    const out = [], path = [];
    const go = (st, left) => {
      for (const c of codes(this.pz, st)) {
        if (out.length >= cap) return;
        const o = outcome(this.pz, st, c);
        if (o === 2) { if (left === 1) out.push([...path, c].map(toMove)); continue; }
        if (o !== 1 || left === 1) continue;
        const r = next(this.pz, st, c); if (!this.count(r, left - 1)) continue;
        path.push(c); go(r, left - 1); path.pop();
      }
    };
    go(s, len); return out;
  }
}
// The first moves that still win from s within n moves (the bots' good move), and the shortest length.
export function bestFirst(pz, s, n) {
  const len = shortest(pz, s, n); if (!len) return { len: 0, moves: [] };
  const sv = new Solver(pz);
  return { len, moves: sv.firsts(s, len).map(([c]) => toMove(c)) };
}
// Every winning sequence within n moves (as moves), up to cap: for the tests.
export function solutions(pz, s, n, cap = 400) {
  const out = [], path = [];
  const go = (st, left) => {
    for (const c of codes(pz, st)) {
      if (out.length >= cap) return;
      const o = outcome(pz, st, c);
      if (o === 2) out.push([...path, c].map(toMove)); else if (o === 1 && left > 1) { path.push(c); go(next(pz, st, c), left - 1); path.pop(); }
    }
  };
  go(s, n); return out;
}

// ---------- the "obvious" lines (they must all fail: the generator checks) ----------
// 1. shoot at once (any spot); 2. dribble straight at the goal, shooting at any spot whenever he can; 3. pass to the
// nearest friend, then shoot (any spot) or dribble straight at the goal and shoot. Returns the line that scores, or null.
export function obviousWin(pz, s0, n) {
  const shots = s => { if (!inBox(pz, s.o[2 * s.b], s.o[2 * s.b + 1])) return false; for (const r of goalRows(pz)) if (outcome(pz, s, 512 + r) === 2) return true; return false; };
  const straight = (s, left, line) => { // dribble east, shooting whenever he can
    for (let k = 0; k < left; k++) {
      if (shots(s)) return line;
      const x = s.o[2 * s.b] + 1, y = s.o[2 * s.b + 1], c = 32 + x * 16 + y; if (outcome(pz, s, c) !== 1 || k === left - 1) return null;
      s = next(pz, s, c); line += ' d';
    }
    return null;
  };
  if (shots(s0)) return 'shoot';
  const a = straight(s0, n, 'straight'); if (a) return a;
  const bx = s0.o[2 * s0.b], by = s0.o[2 * s0.b + 1]; let j = -1, jd = 1e9;
  for (let i = 0; i < s0.o.length >> 1; i++) if (i !== s0.b) { const e = e2(bx, by, s0.o[2 * i], s0.o[2 * i + 1]); if (e < jd) { jd = e; j = i; } }
  if (j >= 0 && n > 1 && outcome(pz, s0, j) === 1) { const s = next(pz, s0, j), r = straight(s, n - 1, 'nearest'); if (r) return r; }
  return null;
}

// ---------- the ideas a solution carries ----------
// keeper: every goal (he was pulled across). giveGo: a pass, then the pass straight back to the passer, who ran on.
// draw: a move after which their answer opens the next pass (that pass was cut out before they stepped). around: two
// passes where the direct one was cut out. switch: a pass across the board (3 rows or more). dribble: a dribble past a
// red player (one was next to his path) that is not just straight on. (v96) getOpen: a friend's run, and the ball to him
// next; decoy: a friend's run, and the next ball (a pass or the shot) goes where it was cut out before the run; screen:
// a pass to a friend whose lane defender stood in the way at the start.
export function ideasOf(pz, sol) {
  const tags = new Set(['keeper']); let s = startOf(pz); const s0 = startOf(pz);
  const lanes = new Set(pz.roles.map(laneOf).filter(j => j >= 0));
  for (let k = 0; k < sol.length; k++) {
    const m = parse(sol[k]), ax = s.o[2 * s.b], ay = s.o[2 * s.b + 1];
    if (m.k === 'p' && lanes.has(m.i) && isCut(pz, s0, s0.o[2 * s0.b], s0.o[2 * s0.b + 1], s0.o[2 * m.i], s0.o[2 * m.i + 1])) tags.add('screen');
    if (k === sol.length - 1) break;
    const n = parse(sol[k + 1]), r = play(pz, s, sol[k]);
    if (m.k === 'p') {
      if (Math.abs(s.o[2 * m.i + 1] - ay) >= 3) tags.add('switch');
      if (n.k === 'p' && n.i === s.b && r.runs.length) tags.add('giveGo');
      if (n.k === 'p' && n.i !== s.b && isCut(pz, s, ax, ay, s.o[2 * n.i], s.o[2 * n.i + 1])) tags.add('around');
    } else if (m.k === 'd' && m.y !== ay) {
      for (let i = 0; i < s.d.length; i += 2) if (cheb(s.d[i], s.d[i + 1], ax, ay) <= 2) { tags.add('dribble'); break; }
    } else if (m.k === 'r') {
      if (n.k === 'p' && n.i === m.i) tags.add('getOpen');
      else if (n.k === 'p' && isCut(pz, s, ax, ay, s.o[2 * n.i], s.o[2 * n.i + 1]) && !isCut(pz, r.s, ax, ay, r.s.o[2 * n.i], r.s.o[2 * n.i + 1])) tags.add('decoy');
      else if (n.k === 's' && isCut(pz, s, ax, ay, pz.W, n.i) && !isCut(pz, r.s, ax, ay, pz.W, n.i)) tags.add('decoy');
      else if (n.k === 'r' || n.k === 'd') { // (two runs, or a run and a step: the ball's next pass counts)
        const nx = sol.slice(k + 1).map(parse).find(q => q.k === 'p'); if (nx && nx.i === m.i) tags.add('getOpen');
      }
    }
    if (n.k === 'p' && m.k !== 'r') { // was the next pass open only after their answer?
      const w = r.was, bx = w.o[2 * w.b], by = w.o[2 * w.b + 1];
      if (r.steps.length && isCut(pz, w, bx, by, w.o[2 * n.i], w.o[2 * n.i + 1]) && !isCut(pz, r.s, bx, by, r.s.o[2 * n.i], r.s.o[2 * n.i + 1])) tags.add('draw');
    }
    s = r.s;
  }
  return [...tags].sort((a, b) => RANK[b] - RANK[a]);
}
export const ideaOf = (pz, sol) => ideasOf(pz, sol)[0];
// The situation a solution plays out (v96): 'run' (it uses a friend's run), 'screen' (round a lane defender), 'both',
// or 'plain'.
// Whether the shortest solutions play the situation: every one of them (none gets round it), and for 'both' one at least
// uses both; a 'decoy' puzzle's are all decoys.
const plays = (sit, tagged) => sit === 'plain' || (sit === 'decoy' ? tagged.every(([ids]) => ids.includes('decoy'))
  : tagged.every(([ids]) => sitOf(ids) === sit || (sit === 'both' && sitOf(ids) !== 'plain')) && (sit !== 'both' || tagged.some(([ids]) => sitOf(ids) === 'both')));
export const sitOf = ideas => { const r = ideas.includes('getOpen') || ideas.includes('decoy'), sc = ideas.includes('screen'); return r && sc ? 'both' : r ? 'run' : sc ? 'screen' : 'plain'; };

// ---------- the generator ----------
// makePuzzle(level, seed): a puzzle the solver has solved and checked. Placed at random by the level's numbers (and the
// situation the seed picks from the level's `sits`), and kept only if: its shortest solution has the level's length;
// every obvious line fails (obviousWin); at most `firsts` different first moves win within his moves; a shortest
// solution carries the level's number of ideas and plays the situation (a run puzzle is solved with the run, a lane
// defender is gone round). The same level and seed give the same puzzle. puzzleSteps is the same, a try at a time, for
// making one between frames.
export function makePuzzle(level, seed) { const it = puzzleSteps(level, seed); for (;;) { const r = it.next(); if (r.done) return r.value; } }
export function* puzzleSteps(level, seed) {
  const D = puzzleLevel(level), r = rng(seed), want = D.sits[Math.floor(r() * D.sits.length)];
  // The situation the seed picked, then (rarely: it did not come out in its tries) a plainer one, never the last resort.
  const order = [...new Set([want, ...(want === 'both' || want === 'decoy' ? ['run'] : []), ...D.sits.filter(x => x !== 'both' && x !== 'decoy'), 'plain'])];
  let fallback = null, t = 0, cueBest = null; // (cueBest: at a score of 0 and 1, the puzzle the cues solved best, if none reached CUE_MIN)
  for (const sit of order) for (let k = 0; k < (sit === want ? 1500 : 600); k++, t++) {
    if (t) yield t;
    const pz = place(D, r, sit); if (!pz) continue;
    const len = shortest(pz, pz.start, D.lenHi); if (!len || len < D.lenLo) continue;
    const n = len + D.spare;
    if (!D.first && obviousWin(pz, pz.start, n)) continue;
    const sv = new Solver(pz), firsts = sv.firsts(pz.start, n);
    if (firsts.length > D.firsts) continue;
    const short = sv.shortestAll(pz.start, len);
    if (D.first && !short.some(x => x[0][0] === 'p')) continue; // (the first: pass across, then finish)
    const cue = D.cue ? cueChance(pz, pz.start, n) : 1;
    if (cue < D.cue && !(sit === order.at(-1) && k > 400 && (!cueBest || cue > cueBest.cue))) continue; // (v96 fix: score 0 and 1: the cues point the way)
    // Every shortest solution must play the situation (none gets round it), so the puzzle is about it.
    const tagged = short.map(x => [ideasOf(pz, x), x]);
    if (!plays(sit, tagged)) continue;
    tagged.sort((a, b) => b[0].length - a[0].length || RANK[b[0][0]] - RANK[a[0][0]]);
    const top = D.first ? tagged.find(([, x]) => x[0][0] === 'p') : tagged[0];
    const out = { ...pz, seed, level, sit, moves: n, len, ways: sv.count(pz.start, n), firsts: firsts.length, spare: D.spare, idea: top[0][0], ideas: top[0], best: top[1], sec: D.sec, tries: t + 1 };
    if (cue < D.cue) { cueBest = { cue, out }; continue; }
    if (top[0].length >= D.ideas) return out;
    fallback ||= out;
  }
  return fallback || cueBest?.out || easyPuzzle(seed, level);
}
// The places, at random by the level's numbers. Ours start outside the box; nobody of theirs next to the ball at the
// start; each marker on the place next to his man nearest the ball (where the rule keeps him); a lane defender in the
// lane to his man; the keeper level with the ball's side, standing still. A run puzzle: a friend with a marker gets an
// arrow two places on (forward or across, never back), clear of the others.
function place(D, r, sit = 'plain') {
  const { W, H } = D, M = (H - 1) >> 1, ri = n => Math.floor(r() * n), pz = { W, H, press: D.press, roles: [] };
  const s = { o: [], b: 0, d: [], g: M, k: -1, u: 0 }, taken = new Set(), at = (x, y) => taken.has(x * 16 + y), take = (x, y) => taken.add(x * 16 + y);
  const bx = ri(Math.max(1, W - 3)), by = ri(H);
  s.o.push(bx, by); take(bx, by);
  for (let i = 1; i < D.ours; i++) {
    let x, y, k = 0; do { x = 1 + ri(W - 1); y = ri(H); } while ((at(x, y) || (x >= W - 1 && r() < .7)) && ++k < 50);
    if (at(x, y)) return null; s.o.push(x, y); take(x, y);
  }
  const wantRun = (sit === 'run' || sit === 'decoy' || sit === 'both') && D.ours > 1, wantLane = (sit === 'screen' || sit === 'both') && D.ours > 1 && D.def > 1;
  const men = []; for (let i = 1; i < D.ours; i++) men.push(i);
  const runner = wantRun ? men[ri(men.length)] : -1;
  let laneMan = -1;
  if (wantLane) { const c = men.filter(j => j !== runner); laneMan = c.length ? c[ri(c.length)] : runner; }
  const marks = Math.max(D.mark, wantRun ? 1 : 0);
  // the roles, in order: the runner's marker first, the lane defender, then markers of the rest, then pressers
  const plan = [];
  if (runner > 0) plan.push(runner);
  if (laneMan > 0) plan.push(LANE_ROLE(laneMan));
  const rest = men.filter(j => j !== runner && j !== laneMan);
  while (plan.length < D.def) {
    if (plan.filter(x => x >= 0).length < marks && rest.length) plan.push(rest.splice(ri(rest.length), 1)[0]);
    else plan.push(-1);
  }
  if (plan.length > D.def) return null;
  for (const role of plan) {
    if (role >= 0) {
      const j = role, mx = s.o[2 * j], my = s.o[2 * j + 1]; let t = null, tk = 1e9;
      for (const [dx, dy] of DIRS) { const x = mx + dx, y = my + dy; if (x < 0 || y < 0 || x >= W || y >= H || at(x, y)) continue; const k = e2(x, y, bx, by); if (k < tk) { tk = k; t = [x, y]; } }
      if (!t || cheb(t[0], t[1], bx, by) <= 1) return null;
      pz.roles.push(j); s.d.push(t[0], t[1]); take(t[0], t[1]);
    } else if (role <= -2) {
      const j = laneOf(role), fx = s.o[2 * j], fy = s.o[2 * j + 1];
      const t = laneSpot(pz, { o: s.o, d: s.d, b: 0 }, bx, by, fx, fy, -9, -9);
      if (!t || at(t[0], t[1]) || cheb(t[0], t[1], bx, by) <= 1) return null;
      pz.roles.push(role); s.d.push(t[0], t[1]); take(t[0], t[1]);
    } else {
      let x, y, k = 0; do { x = 1 + ri(W - 1); y = ri(H); } while ((at(x, y) || cheb(x, y, bx, by) <= 1) && ++k < 50);
      if (at(x, y) || cheb(x, y, bx, by) <= 1) return null;
      pz.roles.push(-1); s.d.push(x, y); take(x, y);
    }
  }
  if (runner > 0) { // his arrow: two places forward, forward and across, or across; free, and not onto the place next to the ball
    const fx = s.o[2 * runner], fy = s.o[2 * runner + 1], opts = [];
    for (const [dx, dy] of [[2, 0], [2, -1], [2, 1], [2, -2], [2, 2], [1, -2], [1, 2], [0, -2], [0, 2]]) {
      const x = fx + dx, y = fy + dy; if (x < 0 || y < 0 || x >= W || y >= H || at(x, y) || cheb(x, y, bx, by) <= 1) continue;
      const mx = fx + Math.sign(dx), my = fy + Math.sign(dy); if (at(mx, my) && !(mx === fx && my === fy)) continue; // (nobody in his way)
      opts.push([x, y]);
    }
    if (!opts.length) return null;
    pz.runs = Array.from({ length: D.ours }, () => null); pz.runs[runner] = opts[ri(opts.length)];
  }
  s.g = Math.max(M - 1, Math.min(M + 1, by));
  pz.start = s;
  return pz;
}
// The last resort (never needed in the tests; still solved before it is shown).
export function easyPuzzle(seed = 0, level = 0) {
  const pz = { W: 6, H: 5, press: 1, roles: [-1], start: { o: [1, 0, 4, 0, 3, 4], b: 0, d: [2, 2], g: 1, k: -1, u: 0 } };
  const len = shortest(pz, pz.start, 5), sv = new Solver(pz), best = sv.shortestAll(pz.start, len)[0];
  return { ...pz, seed, level, sit: 'plain', moves: len + 1, len, ways: sv.count(pz.start, len + 1), firsts: sv.firsts(pz.start, len + 1).length, spare: 1, idea: ideaOf(pz, best), ideas: ideasOf(pz, best), best, sec: 0, tries: 0 };
}
// (v96 fix) The chance that a child who follows only the picture's cues solves the puzzle from s with `left` moves: he
// shoots at a gold spot (an open shot) whenever there is one; otherwise he picks, all alike, any move the picture does not
// mark as failing (no pass down a red lane, no step onto a red square, no shot at a grey spot); with none, any move.
export function cueChance(pz, s, left, memo = new Map()) {
  const key = keyOf(s) + left, m = memo.get(key); if (m !== undefined) return m;
  const cs = codes(pz, s); let out;
  if (cs.some(c => c >= 512 && c < 768 && outcome(pz, s, c) === 2)) out = 1;
  else {
    const safe = cs.filter(c => !(c >= 512 && c < 768) && outcome(pz, s, c) === 1), list = safe.length ? safe : cs;
    let sum = 0; for (const c of list) { const o = outcome(pz, s, c); sum += o === 2 ? 1 : o === 1 && left > 1 ? cueChance(pz, next(pz, s, c), left - 1, memo) : 0; }
    out = list.length ? sum / list.length : 0;
  }
  memo.set(key, out); return out;
}
// When the teaching hand points at the first move of the puzzle's solution (mini/puzzle-ui.js): 'new' while a friend's run
// or a lane defender is new to him in this run (until he has solved one), sooner; 'plain' on his very first puzzle ever,
// and (v96 fix) 'again' on the puzzle after one he failed at a score of 0 or 1 (failedAt: the score he failed at, or
// null), sooner; else null.
export const HAND_AFTER_FAIL_TO = 2;
export const handWhen = ({ firstEver = false, i = 0, isNew = false, failedAt = null } = {}) => (isNew ? 'new' : failedAt != null && failedAt < HAND_AFTER_FAIL_TO ? 'again' : firstEver && i === 0 ? 'plain' : null);
// A puzzle from a play log's line (mini try: at, the puzzles he had solved before it; seed).
export const rebuild = ({ at, seed }) => makePuzzle(at / 3, seed);

// ---------- one puzzle in play ----------
// Board: the moves he has left, where everything is, and what each tap did. tap(mv) returns { res: 'refused' (nothing
// changes), 'ok' (the move and their answer: play's runs and steps), 'goal', or 'fail' (why: cut, tackle, blocked,
// saved, out) }.
export class Board {
  constructor(pz) { this.pz = pz; this.s = startOf(pz); this.left = pz.moves; this.taps = []; this.over = null; }
  tap(mv) {
    if (this.over) return { res: 'refused', why: 'over' };
    const c = check(this.pz, this.s, mv); if (!c) return { res: 'refused', why: 'not' };
    this.left--; this.taps.push(typeof mv === 'number' ? toMove(mv) : mv);
    if (!c.ok) { this.over = c.why; return { res: 'fail', why: c.why, cut: c.cut, by: c.by, to: c.to }; }
    if (c.goal) { this.over = 'goal'; return { res: 'goal', to: c.to }; }
    const r = play(this.pz, this.s, mv); this.s = r.s;
    if (this.left <= 0) { this.over = 'out'; return { res: 'fail', why: 'out', ...r, to: c.to }; }
    return { res: 'ok', ...r, to: c.to };
  }
  // Time ran out (the sand timer): failed, as out of moves.
  timeUp() { if (this.over) return false; this.over = 'time'; return true; }
}

// What is said (spoken: tests/spoken.js; recorded clips, so the lines reuse ones that have a clip): the first time, after
// a goal, after a fail (by why), and the idea as the solution plays.
export const PZ_SAID = { intro: 'Score before the balls run out!', goal: 'Goal!', watch: 'Watch this way!' };
export const PZ_WHY = { cut: 'Blocked! A defender was in the way.', blocked: 'Blocked! A defender was in the way.', tackle: 'Tackled! Stay away from the other team.', saved: 'Saved! Shoot where the keeper is not.', out: 'Out of moves!', time: 'Out of time!' };
export const PZ_IDEA = { keeper: 'Shoot where the keeper is not!', dribble: 'Run into the space!', switch: 'Switch to the empty side!', around: 'Pass around the defender!', draw: 'Bring the defender to you, then pass!', giveGo: 'Pass and go, then get it back!',
  screen: 'Pass around the defender!', getOpen: 'Move to open space so your friend can pass to you!', decoy: 'Pass to the open friend!' };
