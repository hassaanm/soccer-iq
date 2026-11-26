// Soccer puzzles, v96 (mini/puzzle.js): the new situations. A friend with an arrow can make his run once (two places,
// without the ball; nobody tackles it; the ball does not move, so the keeper stands still), and his marker can only
// follow a place; a lane defender stands in the lane from the ball to his man; the ideas a solution carries say which
// was used (getOpen, decoy, screen); each situation comes alone first (the run at 2, the lane defender at 4), then mixed;
// every shortest solution of a situation's puzzle plays it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, puzzleLevel, Board, startOf, check, play, canRun, laneSpot, LANE_ROLE, laneOf, ideasOf, sitOf, movesFrom, cutBy, Solver, shortest, PZ_IDEA, IDEAS, SITS } from '../js/mini/puzzle.js';
import { STEP } from '../js/mini/rules.js';

const cheb = (a, b, c, d) => Math.max(Math.abs(a - c), Math.abs(b - d));
const board = (o, b, d, roles, extra = {}) => ({ W: 6, H: 5, press: 1, roles, start: { o, b, d, g: 2, k: -1, u: 0 }, ...extra });

test('a friend\'s run: once, from where he started, to the place his arrow shows; his marker follows a place; the keeper stays', () => {
  // ball at (0,2); friend 1 at (2,0) marked by defender 0 at (2,1), his arrow to (4,0)
  const pz = board([0, 2, 2, 0], 0, [2, 1], [1], { runs: [null, [4, 0]] }), s = startOf(pz);
  assert.ok(canRun(pz, s, 1)); assert.ok(!canRun(pz, s, 0), 'the ball carrier has no run');
  assert.ok(movesFrom(pz, s).includes('r1'));
  const c = check(pz, s, 'r1'); assert.deepEqual([c.ok, c.why, c.to], [true, null, [4, 0]]);
  const r = play(pz, s, 'r1');
  assert.deepEqual([r.s.o[2], r.s.o[3]], [4, 0], 'he is there'); assert.equal(r.s.u & 2, 2, 'his run is used');
  assert.equal(r.s.k, -1, 'the ball did not move: the keeper stands still (all the goal his)');
  assert.ok(cheb(2, 1, r.s.d[0], r.s.d[1]) === 1 && cheb(r.s.d[0], r.s.d[1], 4, 0) >= 1, 'his marker followed one place');
  assert.ok(!canRun(pz, r.s, 1) && !movesFrom(pz, r.s).includes('r1'), 'once only');
  const b = new Board({ ...pz, moves: 3 }); assert.equal(b.tap('r0').res, 'refused'); assert.equal(b.left, 3);
  // a run to a place someone is on: not a move
  const pz2 = board([0, 2, 2, 0, 4, 0], 0, [2, 1], [1], { runs: [null, [4, 0], null] }); assert.equal(check(pz2, startOf(pz2), 'r1'), null);
});

test('a lane defender stands in the lane from the ball to his man, and steps after it a place a move', () => {
  const pz = board([0, 2, 4, 2], 0, [1, 0], [LANE_ROLE(1)]), s = startOf(pz);
  assert.equal(laneOf(LANE_ROLE(1)), 1); assert.equal(laneOf(-1), -1); assert.equal(laneOf(0), -1);
  assert.deepEqual(laneSpot(pz, s, 0, 2, 4, 2, 1, 0), [2, 2], 'the middle of the lane');
  const r = play(pz, s, 'd0,1'); // the ball moves a place up: he steps toward the new lane's middle
  assert.ok(cheb(1, 0, r.s.d[0], r.s.d[1]) <= 1); assert.ok(Math.hypot(r.s.d[0] - 2, r.s.d[1] - 1.5) < Math.hypot(1 - 2, 0 - 1.5), 'nearer the lane');
  // standing in it, he cuts the pass
  const pz3 = board([0, 2, 4, 2], 0, [2, 2], [LANE_ROLE(1)]); assert.equal(check(pz3, startOf(pz3), 'p1').why, 'cut');
  // with his man on the ball he marks him
  const pz4 = board([0, 2, 4, 2], 1, [2, 2], [LANE_ROLE(1)]), r4 = play(pz4, startOf(pz4), 'd5,2'); assert.ok(cheb(r4.s.d[0], r4.s.d[1], 5, 2) <= 2);
});

test('the ideas: a run then the ball to the runner (getOpen); a run that opens another lane (decoy); round a lane defender (screen)', () => {
  assert.ok(['getOpen', 'decoy', 'screen'].every(k => IDEAS.includes(k) && PZ_IDEA[k]));
  assert.equal(sitOf(['getOpen', 'keeper']), 'run'); assert.equal(sitOf(['screen']), 'screen'); assert.equal(sitOf(['decoy', 'screen']), 'both'); assert.equal(sitOf(['keeper']), 'plain');
  let seen = { getOpen: 0, decoy: 0, screen: 0 };
  for (let i = 0; i < 60; i++) for (const sc of [2, 4, 6, 9]) { const p = makePuzzle(sc * STEP, 300 + i); for (const k in seen) if (p.ideas.includes(k)) seen[k]++; assert.deepEqual(ideasOf(p, p.best), p.ideas); }
  for (const k in seen) assert.ok(seen[k] > 5, `${k}: ${seen[k]}`);
});

test('each situation alone first (the run at 2 and 3, the lane defender at 4), then mixed; every shortest solution plays it', () => {
  assert.deepEqual(puzzleLevel(STEP).sits, ['plain']); assert.deepEqual(puzzleLevel(2 * STEP).sits, ['run']); assert.deepEqual(puzzleLevel(4 * STEP).sits, ['screen']);
  assert.ok(puzzleLevel(6 * STEP).sits.length >= 3 && puzzleLevel(9 * STEP).sits.includes('both'));
  for (const s of puzzleLevel(20 * STEP).sits) assert.ok(SITS.includes(s));
  for (let i = 0; i < 25; i++) {
    const r2 = makePuzzle(2 * STEP, 500 + i), r4 = makePuzzle(4 * STEP, 500 + i);
    assert.equal(r2.sit, 'run'); assert.ok(r2.runs && r2.best.some(m => m[0] === 'r'), 'a run puzzle is solved with the run');
    assert.equal(r4.sit, 'screen'); assert.ok(r4.roles.some(x => x <= -2), 'a lane defender');
    for (const p of [r2, r4]) {
      const sv = new Solver(p), all = sv.shortestAll(startOf(p), p.len);
      for (const sol of all) assert.equal(sitOf(ideasOf(p, sol)), p.sit, `seed ${p.seed}: ${sol.join(' ')} plays ${p.sit}`);
      assert.equal(shortest(p, startOf(p), p.moves), p.len);
    }
  }
});

test('nothing in a puzzle needs more bodies than the 3D world has, nor a board too big for the screen', () => {
  for (let sc = 0; sc <= 45; sc += 3) for (const seed of [1, 2]) {
    const p = makePuzzle(sc * STEP, seed); assert.ok(p.start.o.length / 2 <= 4 && p.start.d.length / 2 <= 4 && p.W <= 7 && p.H <= 6, `score ${sc}`);
    const b = new Board(p); let r; for (const mv of p.best) r = b.tap(mv); assert.equal(r.res, 'goal');
    if (p.runs) for (let i = 0; i < p.runs.length; i++) if (p.runs[i]) { const [x, y] = p.runs[i]; assert.ok(cheb(x, y, p.start.o[2 * i], p.start.o[2 * i + 1]) === 2 && x >= p.start.o[2 * i], 'two places, never back'); }
    for (let k = 0; k < p.roles.length; k++) { const j = laneOf(p.roles[k]); if (j >= 0) assert.ok(cutBy(p, p.start, p.start.o[0], p.start.o[1], p.start.o[2 * j], p.start.o[2 * j + 1]), 'a lane defender starts in his lane'); }
  }
});
