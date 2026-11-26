// Soccer puzzles (v90, rules redone in v93, v96: a friend's run and the lane defender: mini/puzzle.js): every puzzle
// shown is solved first; the obvious lines fail and few first moves win; a keeper standing still covers the whole goal,
// one who just moved covers his spot and the one he came from; the other team answers by the stated rule; a tap that is
// not a move costs nothing; a cut pass, a tackle, a block, a save and running out of moves fail it; two lives end a run;
// the difficulty only rises. (The new situations: tests/puzzle-v96.test.js.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, rebuild, puzzleLevel, STEPPED, Board, startOf, shortest, solutions, Solver, ideaOf, ideasOf, IDEAS, check, play, cutBy, goalRows, mid, inBox, movesFrom, bestFirst, rng, LANE, easyPuzzle, covers, obviousWin } from '../js/mini/puzzle.js';
import { STEP, newRun, attempt } from '../js/mini/rules.js';

const cheb = (a, b, c, d) => Math.max(Math.abs(a - c), Math.abs(b - d));
// A small hand-made board: W 6, H 5 (goal rows 1..3), ours, theirs (roles: -1 presses, j marks friend j), the keeper's
// spot and where he came from (-1: standing still).
const board = (o, b, d, roles, g = 2, k = -1, press = 1) => ({ W: 6, H: 5, press, roles, start: { o, b, d, g, k } });

test('every puzzle shown is solved first, the obvious lines fail, few first moves win (levels 0 to 13)', () => {
  for (let i = 0; i <= 40; i += 2) for (const seed of [1, 2]) {
    const L = i * STEP, pz = makePuzzle(L, seed * 7919 + i), D = puzzleLevel(L), s = startOf(pz);
    const b = new Board(pz); let r; for (const mv of pz.best) r = b.tap(mv);
    assert.equal(r.res, 'goal', `level ${L.toFixed(2)} seed ${pz.seed}: the solution scores`);
    assert.equal(pz.best.length, pz.len); assert.equal(shortest(pz, s, pz.moves), pz.len, 'no shorter solution');
    assert.ok(pz.len >= D.lenLo && pz.len <= D.lenHi, `length ${pz.len} in ${D.lenLo}..${D.lenHi}`);
    assert.equal(pz.moves, pz.len + D.spare);
    if (!D.first) assert.equal(obviousWin(pz, s, pz.moves), null, 'shoot at once, dribble straight on, pass to the nearest: all fail');
    assert.ok(new Solver(pz).firsts(s, pz.moves).length <= D.firsts, 'few winning first moves');
    assert.ok(ideasOf(pz, pz.best).length >= D.ideas && IDEAS.includes(pz.idea) && ideaOf(pz, pz.best) === pz.idea);
    assert.ok(pz.tries > 0, 'made by the generator, not the last resort');
  }
});
test('the first puzzle is the plainest keeper case (pass across, finish); a score of 1 is two moves again; from 2, three', () => {
  for (let i = 0; i < 30; i++) {
    const p0 = makePuzzle(0, 100 + i), s0 = startOf(p0);
    assert.deepEqual([p0.len, p0.moves, p0.start.d.length / 2, p0.start.o.length / 2, p0.best[0][0], p0.best[1][0]], [2, 4, 1, 3, 'p', 's']); // (v96 fix: two friends and a spare ball more: the cues point the way, tests/v96-fix.test.js)
    assert.equal(shortest(p0, s0, 1), 0, 'no shot at once');
    const r = play(p0, s0, p0.best[0]); assert.ok(r.s.k >= 0 && !covers(r.s, +p0.best[1].slice(1)), 'the pass moves the keeper; the shot goes to the spot he cannot reach');
    const p1 = makePuzzle(STEP, 100 + i), s1 = startOf(p1);
    assert.deepEqual([p1.len, p1.moves, p1.start.d.length / 2], [2, 3, 1], 'a score of 1: the keeper rule again, two moves, one defender to get round');
    assert.equal(obviousWin(p1, s1, p1.moves), null, 'but not the obvious line');
    const pz = makePuzzle(2 * STEP, 100 + i), s = startOf(pz);
    assert.equal(pz.len, 3); assert.equal(pz.moves, 4); assert.equal(shortest(pz, s, 2), 0, 'no two-move goal');
    const p6 = makePuzzle(6 * STEP, 200 + i); assert.ok(p6.moves === p6.len && p6.len >= 3, 'from 6: no spare move');
    const p13 = makePuzzle(13 * STEP, 200 + i); assert.ok(p13.ideas.length >= 2, `score 13: ${p13.ideas}`);
  }
});

test('the same seed gives the same puzzle; a play log line rebuilds it', () => {
  for (const L of [0, 4 / 3, 3, 6]) {
    const a = makePuzzle(L, 4242), b = makePuzzle(L, 4242), c = makePuzzle(L, 4243);
    assert.deepEqual(a, b); if (L) assert.notDeepEqual(a.start, c.start);
    assert.deepEqual(rebuild({ at: Math.round(L * 3), seed: 4242 }), makePuzzle(Math.round(L * 3) / 3, 4242));
  }
  const r1 = rng(9), r2 = rng(9); for (let i = 0; i < 20; i++) assert.equal(r1(), r2());
});

test('passes and shots: a red player on the path cuts it; the keeper standing still saves every spot', () => {
  const pz = board([0, 2, 4, 2], 0, [2, 2], [-1]);
  assert.equal(check(pz, pz.start, 'p1').why, 'cut'); assert.equal(cutBy(pz, pz.start, 0, 2, 4, 2).who, 0);
  const pz2 = board([0, 2, 4, 2], 0, [2, 3], [-1]);
  assert.equal(check(pz2, pz2.start, 'p1').ok, true, 'a place beside the line: open');
  assert.ok(LANE < 1 && LANE > .5);
  // in front of goal with the keeper still: every spot saved ("once you're in front the goalie can't do anything": now he can)
  const pz3 = board([4, 2, 0, 0], 0, [0, 4], [-1], 2);
  assert.ok(inBox(pz3, 4, 2)); assert.deepEqual(goalRows(pz3), [1, 2, 3]);
  for (const r of [1, 2, 3]) assert.equal(check(pz3, pz3.start, 's' + r).why, 'saved');
  // the keeper just moved from 2 to 1: he covers 1 and 2; spot 3 is open
  const s = { ...pz3.start, g: 1, k: 2 };
  assert.deepEqual([1, 2, 3].map(r => covers(s, r)), [true, true, false]);
  assert.equal(check(pz3, s, 's3').goal, true); assert.equal(check(pz3, s, 's1').why, 'saved');
  // a red player on the shot's path blocks it
  const pz4 = { ...board([4, 1, 0, 0], 0, [5, 2], [-1]) }; assert.equal(check(pz4, { ...pz4.start, g: 1, k: 2 }, 's3').why, 'blocked');
  const pz5 = board([2, 2, 0, 0], 0, [0, 4], [-1]);
  assert.equal(check(pz5, pz5.start, 's1'), null, 'from outside the box: not a move');
});

test('a tap that is not a move is refused and costs nothing; a cut pass, a tackle, a save and no moves left fail it', () => {
  const pz = { ...board([1, 2, 4, 0, 1, 4], 0, [3, 3], [-1]), moves: 3 };
  for (const mv of ['d3,2', 'd3,3', 'd1,2', 'p0', 'p7', 's2', 'x1']) {
    const b = new Board(pz), s0 = JSON.stringify(b.s), r = b.tap(mv);
    assert.equal(r.res, 'refused', mv); assert.equal(b.left, 3); assert.equal(JSON.stringify(b.s), s0); assert.deepEqual(b.taps, []); assert.equal(b.over, null);
  }
  let b = new Board({ ...board([1, 2, 4, 2], 0, [2, 2], [-1]), moves: 3 }); let r = b.tap('p1'); assert.deepEqual([r.res, r.why, b.left], ['fail', 'cut', 2]);
  b = new Board({ ...board([1, 2, 4, 0], 0, [3, 3], [-1]), moves: 3 }); r = b.tap('d2,2'); assert.deepEqual([r.res, r.why, r.by], ['fail', 'tackle', [3, 3]]);
  b = new Board({ ...board([4, 2, 0, 0], 0, [0, 4], [-1]), moves: 3 }); r = b.tap('s1'); assert.deepEqual([r.res, r.why], ['fail', 'saved']);
  b = new Board({ ...board([0, 0, 0, 4], 0, [5, 4], [-1]), moves: 2 }); assert.equal(b.tap('d1,0').res, 'ok'); r = b.tap('d2,0'); assert.deepEqual([r.res, r.why, b.over], ['fail', 'out', 'out']);
  assert.equal(b.tap('d3,0').why, 'over', 'nothing after the end');
  b = new Board({ ...board([4, 2, 0, 0], 0, [0, 4], [-1], 1, 2), moves: 3 }); r = b.tap('s3'); assert.equal(r.res, 'goal');
  b = new Board(easyPuzzle()); assert.equal(b.timeUp(), true); assert.equal(b.over, 'time'); assert.equal(b.tap(easyPuzzle().best[0]).res, 'refused');
});

test('their answer: the keeper steps a spot toward the ball\'s side (and is then on the move), the nearest presser steps in, a marker stays with his man', () => {
  let pz = board([1, 0, 3, 4], 0, [5, 0], [-1], 3), r = play(pz, pz.start, 'd2,0');
  assert.deepEqual(r.steps.find(s => s[0] === 'gk'), ['gk', 3, 2]); assert.deepEqual([r.s.g, r.s.k], [2, 3], 'he moved: from 3');
  r = play(pz, r.s, 'd1,0'); assert.deepEqual([r.s.g, r.s.k], [1, 2]); r = play(pz, r.s, 'd0,0'); assert.deepEqual([r.s.g, r.s.k], [1, -1], 'not past the post: standing still again');
  pz = board([0, 2, 0, 0], 0, [3, 2, 5, 4], [-1, -1]); r = play(pz, pz.start, 'd0,3');
  assert.deepEqual(r.s.d, [2, 3, 5, 4]);
  pz.press = 2; r = play(pz, pz.start, 'd0,3'); assert.deepEqual(r.s.d, [2, 3, 4, 3], 'press 2: the two nearest step');
  pz = board([1, 2, 5, 0], 0, [3, 2], [-1]); r = play(pz, pz.start, 'd2,1'); assert.deepEqual(r.s.d, [3, 2], 'next to the ball he waits');
  pz = board([0, 2, 3, 0, 4, 4], 0, [4, 0], [1]); r = play(pz, pz.start, 'p1');
  assert.deepEqual(r.runs, [[0, [0, 2], [1, 2]]], 'the passer runs on'); assert.ok(cheb(r.s.d[0], r.s.d[1], r.s.o[2], r.s.o[3]) <= 1, 'next to his man');
  r = play(pz, pz.start, 'p2'); assert.deepEqual(r.s.d, [4, 1]); assert.ok(cheb(r.s.d[0], r.s.d[1], r.s.o[2], r.s.o[3]) <= 1, 'still next to his man');
});

test('the answer, played over many puzzles: one place a move each, the keeper in his goal, nobody on top of anybody', () => {
  const r = rng(77);
  for (let i = 0; i < 200; i++) {
    const pz = makePuzzle((i % 40) * STEP, 900 + i), b = new Board(pz);
    while (!b.over) {
      const all = movesFrom(pz, b.s).filter(m => check(pz, b.s, m).ok && m[0] !== 's'); if (!all.length) break;
      const mv = all[Math.floor(r() * all.length)], x = b.tap(mv); if (!x.s) break;
      const s = x.s, w = x.was, M = mid(pz);
      assert.ok(Math.abs(s.g - w.g) <= 1 && s.g >= M - 1 && s.g <= M + 1, 'the keeper: a spot at most, in his goal');
      assert.ok(s.k === -1 ? s.g === w.g : s.k === w.g && s.g !== w.g, 'on the move exactly when he moved');
      for (let k = 0; k < pz.roles.length; k++) assert.ok(cheb(w.d[2 * k], w.d[2 * k + 1], s.d[2 * k], s.d[2 * k + 1]) <= 1, 'one place at most');
      const all2 = []; for (let k = 0; k < s.o.length; k += 2) all2.push(s.o[k] * 16 + s.o[k + 1]); for (let k = 0; k < s.d.length; k += 2) all2.push(s.d[k] * 16 + s.d[k + 1]);
      assert.equal(new Set(all2).size, all2.length, 'one player a place');
    }
  }
});

test('two lives end a run: puzzles solved score, a failed one costs a life', () => {
  const run = newRun(), r = rng(5); let n = 0;
  while (!run.over && n < 50) {
    const pz = makePuzzle(run.level, Math.floor(r() * 2 ** 31)), b = new Board(pz); n++;
    if (n % 4 === 0) { while (!b.over) b.tap(movesFrom(pz, b.s).find(m => check(pz, b.s, m)?.why) || movesFrom(pz, b.s)[0]); }
    else for (const mv of pz.best) b.tap(mv);
    attempt(run, b.over === 'goal');
  }
  assert.equal(run.over, true); assert.equal(run.lives, 0); assert.equal(n, 8); assert.equal(run.score, 6);
});

test('the difficulty: every number goes the hard way only, one of them a success at most, by one step', () => {
  const up = { W: 1, H: 1, ours: 1, def: 1, mark: 1, press: 1, lenLo: 1, lenHi: 1, spare: -1, firsts: -1, ideas: 1 }; // (the first puzzle to the second: several at once, all the hard way)
  const big = Array.from({ length: 151 }, (_, i) => i * STEP);
  for (let i = 1; i < big.length; i++) {
    const a = puzzleLevel(big[i - 1]), b = puzzleLevel(big[i]); let changed = 0;
    for (const k of STEPPED) {
      const d = (b[k] - a[k]) * up[k]; assert.ok(d >= 0, `${k} eased at level ${big[i].toFixed(2)}`);
      if (d) { changed++; assert.ok(d <= (k === 'H' ? 2 : 1), `${k} jumped`); }
    }
    if (i > 1) assert.ok(changed <= 1, `level ${big[i].toFixed(2)}: ${changed} numbers changed at one success`);
    assert.ok(b.lenHi >= b.lenLo && b.lenHi <= 6);
    if (a.sec) assert.ok(b.sec <= a.sec && a.sec - b.sec <= 4, 'the sand timer shortens a little');
    if (!a.sec && b.sec) assert.ok(b.sec >= 110, 'it comes in long');
  }
  const z = puzzleLevel(0), o = puzzleLevel(STEP); assert.deepEqual([z.def, z.ours, z.lenLo, z.lenHi, z.spare, z.sec], [1, 3, 2, 2, 2, 0], 'the first: one defender, two friends, two moves and two spare (v96 fix)');
  assert.deepEqual([o.def, o.lenLo, o.lenHi, o.spare, o.firsts, o.sec], [1, 2, 2, 1, 3, 0], 'then: two moves again, one defender, one spare');
  const h = puzzleLevel(50); assert.ok(h.lenLo === 6 && h.def === 4 && h.sec > 30 && h.sec < 40, 'it keeps getting harder');
  for (const L of big) { const d = puzzleLevel(L); assert.ok(d.W <= 7 && d.H <= 6 && d.ours <= 4 && d.def <= 4, 'the board fits the screen (taps 44 px and more) and the 3D world\'s bodies (four a side)'); }
});

test('bots: picking a winning move 90% of the time does far better than random; random rarely scores', () => {
  const runOf = (p, seed) => {
    const r = rng(seed), run = newRun(); let n = 0;
    while (!run.over && n < 200) {
      const pz = makePuzzle(run.level, Math.floor(r() * 2 ** 31)), b = new Board(pz); n++;
      while (!b.over) {
        let mv = null;
        if (r() < p) { const m = bestFirst(pz, b.s, b.left).moves; mv = m[Math.floor(r() * m.length)] || null; }
        if (!mv) { const all = movesFrom(pz, b.s); mv = all[Math.floor(r() * all.length)]; }
        b.tap(mv);
      }
      attempt(run, b.over === 'goal');
    }
    return run.score;
  };
  const mean = (p, k = 12) => { let s = 0; for (let i = 0; i < k; i++) s += runOf(p, 31 + i * 97); return s / k; };
  const rand = mean(0), p90 = mean(.9);
  assert.ok(rand < .5, `random: ${rand}`); assert.ok(p90 >= 3 && p90 > 6 * rand, `90%: ${p90}, random: ${rand}`);
  assert.ok(solutions(makePuzzle(0, 3), startOf(makePuzzle(0, 3)), 4).length >= 1);
});
