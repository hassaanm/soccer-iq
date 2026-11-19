// Soccer puzzles (v90, mini/puzzle.js): every puzzle shown is solved first and solvable within its moves; the
// defenders answer by the stated rule; a tap that is not a move costs nothing; a cut pass, a tackle, a save and running
// out of moves fail it; two lives end a run; the difficulty only rises, a little a success; a seed rebuilds its puzzle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, rebuild, puzzleLevel, STEPPED, Board, startOf, shortest, solutions, Solver, ideaOf, IDEAS, check, play, answer, cutBy, goalRows, mid, inBox, movesFrom, bestFirst, rng, LANE, easyPuzzle } from '../js/mini/puzzle.js';
import { STEP, newRun, attempt } from '../js/mini/rules.js';

const LEVELS = Array.from({ length: 91 }, (_, i) => i * STEP); // 0 to 30 levels, a success at a time
const cheb = (a, b, c, d) => Math.max(Math.abs(a - c), Math.abs(b - d));
// A small hand-made board: W 6, H 5 (goal rows 1..3), ours, theirs (roles: -1 presses, j marks friend j), keeper row.
const board = (o, b, d, roles, g = 2, press = 1) => ({ W: 6, H: 5, press, roles, start: { o, b, d, g } });

test('every puzzle shown is solved first: its solution scores within its moves, at every level', () => {
  for (const L of LEVELS) for (const seed of [1, 2, 3]) {
    const pz = makePuzzle(L, seed * 7919 + Math.round(L * 3)), D = puzzleLevel(L);
    const b = new Board(pz); let r; for (const mv of pz.best) r = b.tap(mv);
    assert.equal(r.res, 'goal', `level ${L.toFixed(2)} seed ${pz.seed}: the solution scores`);
    assert.equal(pz.best.length, pz.len); assert.equal(shortest(pz, startOf(pz), pz.moves), pz.len, 'no shorter solution');
    assert.ok(pz.len >= D.lenLo && pz.len <= D.lenHi, `length ${pz.len} in ${D.lenLo}..${D.lenHi}`);
    assert.equal(pz.moves, pz.len + D.spare); assert.ok(pz.ways >= D.ways && pz.firsts >= D.firsts, 'enough ways');
    assert.ok(IDEAS.includes(pz.idea)); assert.equal(ideaOf(pz, pz.best), pz.idea, 'the idea is the solution\'s');
    assert.ok(pz.tries > 0, 'made by the generator, not the last resort');
  }
});
test('early puzzles have three ways or more and two spare moves; later fewer', () => {
  for (let i = 0; i < 40; i++) {
    const pz = makePuzzle(0, 100 + i), sv = new Solver(pz);
    assert.equal(pz.moves - pz.len, 2); assert.ok(pz.ways >= 3);
    assert.ok(solutions(pz, startOf(pz), pz.len + 1).length >= 3, 'three different winning sequences');
    assert.ok(sv.firsts(startOf(pz), pz.len + 1).length >= 2, 'with two different first moves');
  }
  assert.equal(puzzleLevel(10).spare, 0); assert.equal(puzzleLevel(10).ways, 1);
});

test('the same seed gives the same puzzle; a play log line rebuilds it', () => {
  for (const L of [0, 4, 11, 20]) {
    const a = makePuzzle(L, 4242), b = makePuzzle(L, 4242), c = makePuzzle(L, 4243);
    assert.deepEqual(a, b); assert.notDeepEqual(a.start, c.start);
    assert.deepEqual(rebuild({ at: Math.round(L * 3), seed: 4242 }), makePuzzle(Math.round(L * 3) / 3, 4242));
  }
  const r1 = rng(9), r2 = rng(9); for (let i = 0; i < 20; i++) assert.equal(r1(), r2());
});

test('passes and shots: a counter on the path cuts it; one a place beside a straight path does not', () => {
  const pz = board([0, 2, 4, 2], 0, [2, 2], [-1]);
  assert.equal(check(pz, pz.start, 'p1').why, 'cut'); assert.equal(cutBy(pz, pz.start, 0, 2, 4, 2).who, 0);
  const pz2 = board([0, 2, 4, 2], 0, [2, 3], [-1]);
  assert.equal(check(pz2, pz2.start, 'p1').ok, true, 'a place beside the line: open');
  assert.ok(LANE < 1 && LANE > .5);
  // shots: only from the box; the keeper's place saves; another goal place scores
  const pz3 = board([4, 2, 0, 0], 0, [0, 4], [-1], 2);
  assert.ok(inBox(pz3, 4, 2)); assert.deepEqual(goalRows(pz3), [1, 2, 3]);
  assert.equal(check(pz3, pz3.start, 's2').why, 'saved'); assert.equal(check(pz3, pz3.start, 's1').goal, true);
  const pz4 = board([2, 2, 0, 0], 0, [0, 4], [-1]);
  assert.equal(check(pz4, pz4.start, 's1'), null, 'from outside the box: not a move');
});

test('a tap that is not a move is refused and costs nothing; a cut pass, a tackle, a save and no moves left fail it', () => {
  const pz = { ...board([1, 2, 4, 0, 1, 4], 0, [3, 3], [-1]), moves: 3 };
  for (const mv of ['d3,2', 'd3,3', 'd1,2', 'p0', 'p7', 's2', 'x1']) {
    const b = new Board(pz), s0 = JSON.stringify(b.s), r = b.tap(mv);
    assert.equal(r.res, 'refused', mv); assert.equal(b.left, 3); assert.equal(JSON.stringify(b.s), s0); assert.deepEqual(b.taps, []); assert.equal(b.over, null);
  }
  let b = new Board({ ...board([1, 2, 4, 2], 0, [2, 2], [-1]), moves: 3 }); let r = b.tap('p1'); assert.deepEqual([r.res, r.why, b.left], ['fail', 'cut', 2]);
  b = new Board({ ...board([1, 2, 4, 0], 0, [3, 3], [-1]), moves: 3 }); r = b.tap('d2,2'); assert.deepEqual([r.res, r.why], ['fail', 'tackle']);
  b = new Board({ ...board([4, 2, 0, 0], 0, [0, 4], [-1]), moves: 3 }); r = b.tap('s2'); assert.deepEqual([r.res, r.why], ['fail', 'saved']);
  b = new Board({ ...board([0, 0, 0, 4], 0, [5, 4], [-1]), moves: 2 }); assert.equal(b.tap('d1,0').res, 'ok'); r = b.tap('d2,0'); assert.deepEqual([r.res, r.why, b.over], ['fail', 'out', 'out']);
  assert.equal(b.tap('d3,0').why, 'over', 'nothing after the end');
  b = new Board({ ...board([4, 2, 0, 0], 0, [0, 4], [-1]), moves: 3 }); r = b.tap('s1'); assert.equal(r.res, 'goal');
  b = new Board(easyPuzzle()); assert.equal(b.timeUp(), true); assert.equal(b.over, 'time'); assert.equal(b.tap(easyPuzzle().best[0]).res, 'refused');
});

test('the defenders\' answer: the keeper steps to face the ball, the nearest presser steps toward it, a marker stays with his man', () => {
  // the keeper: one row toward the ball's row, never out of his goal
  let pz = board([1, 0, 3, 4], 0, [5, 0], [-1], 3), r = play(pz, pz.start, 'd2,0');
  assert.deepEqual(r.steps.find(s => s[0] === 'gk'), ['gk', 3, 2]); assert.equal(r.s.g, 2);
  r = play(pz, r.s, 'd1,0'); assert.equal(r.s.g, 1); r = play(pz, r.s, 'd0,0'); assert.equal(r.s.g, 1, 'not past the post');
  // the nearest presser steps one place toward the ball; the others stay
  pz = board([0, 2, 0, 0], 0, [3, 2, 5, 4], [-1, -1]); r = play(pz, pz.start, 'd0,3');
  assert.deepEqual(r.s.d, [2, 3, 5, 4]);
  pz.press = 2; r = play(pz, pz.start, 'd0,3'); assert.deepEqual(r.s.d, [2, 3, 4, 3], 'press 2: the two nearest step');
  // next to the ball he waits
  pz = board([1, 2, 5, 0], 0, [3, 2], [-1]); r = play(pz, pz.start, 'd2,1'); assert.deepEqual(r.s.d, [3, 2]);
  // a marker steps toward the place next to his man nearest the ball, and stays next to him after he runs on
  pz = board([0, 2, 3, 0, 4, 4], 0, [4, 0], [1]); r = play(pz, pz.start, 'p1');
  assert.deepEqual(r.runs, [[0, [0, 2], [1, 2]]], 'the passer runs on'); assert.ok(cheb(r.s.d[0], r.s.d[1], r.s.o[2], r.s.o[3]) <= 1, 'next to his man');
  // the ball goes to the far friend: he steps toward the place by his man on the ball's side
  r = play(pz, pz.start, 'p2'); assert.deepEqual(r.s.d, [4, 1], 'from beside his man to the place by him nearest the ball');
  assert.ok(cheb(r.s.d[0], r.s.d[1], r.s.o[2], r.s.o[3]) <= 1, 'still next to his man');
});

test('the answer, played over many puzzles: one place a move each, the keeper in his goal, nobody on top of anybody', () => {
  const r = rng(77);
  for (let i = 0; i < 300; i++) {
    const pz = makePuzzle((i % 60) * STEP * 1.5, 900 + i), b = new Board(pz);
    while (!b.over) {
      const all = movesFrom(pz, b.s).filter(m => check(pz, b.s, m).ok && m[0] !== 's'); if (!all.length) break;
      const mv = all[Math.floor(r() * all.length)], x = b.tap(mv); if (!x.s) break;
      const s = x.s, w = x.was, M = mid(pz), ball = [s.o[2 * s.b], s.o[2 * s.b + 1]];
      assert.ok(Math.abs(s.g - w.g) <= 1 && s.g >= M - 1 && s.g <= M + 1, 'the keeper: a row at most, in his goal');
      const near = pz.roles.map((j, k) => [j, k]).filter(([j]) => j < 0).map(([, k]) => [cheb(w.d[2 * k], w.d[2 * k + 1], ...ball), Math.hypot(w.d[2 * k] - ball[0], w.d[2 * k + 1] - ball[1]), k]).sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
      for (let k = 0; k < pz.roles.length; k++) {
        const moved = cheb(w.d[2 * k], w.d[2 * k + 1], s.d[2 * k], s.d[2 * k + 1]);
        assert.ok(moved <= 1, 'one place at most');
        if (pz.roles[k] < 0 && !near.slice(0, pz.press).some(n => n[2] === k)) assert.equal(moved, 0, 'only the nearest press');
        if (pz.roles[k] < 0 && moved) assert.ok(cheb(s.d[2 * k], s.d[2 * k + 1], ...ball) < cheb(w.d[2 * k], w.d[2 * k + 1], ...ball) || Math.hypot(s.d[2 * k] - ball[0], s.d[2 * k + 1] - ball[1]) < Math.hypot(w.d[2 * k] - ball[0], w.d[2 * k + 1] - ball[1]), 'toward the ball');
      }
      const all2 = []; for (let k = 0; k < s.o.length; k += 2) all2.push(s.o[k] * 16 + s.o[k + 1]); for (let k = 0; k < s.d.length; k += 2) all2.push(s.d[k] * 16 + s.d[k + 1]);
      assert.equal(new Set(all2).size, all2.length, 'one counter a place');
      pz.roles.forEach((j, k) => { if (j >= 0 && cheb(w.d[2 * k], w.d[2 * k + 1], w.o[2 * j], w.o[2 * j + 1]) <= 1) assert.ok(cheb(s.d[2 * k], s.d[2 * k + 1], s.o[2 * j], s.o[2 * j + 1]) <= 1, 'a marker next to his man stays next to him'); });
    }
  }
});

test('two lives end a run: puzzles solved score, a failed one costs a life', () => {
  const run = newRun(), r = rng(5); let n = 0;
  while (!run.over && n < 50) {
    const pz = makePuzzle(run.level, Math.floor(r() * 2 ** 31)), b = new Board(pz); n++;
    if (n % 4 === 0) { const all = movesFrom(pz, b.s); while (!b.over) b.tap(all.find(m => check(pz, b.s, m)?.why) || movesFrom(pz, b.s)[0]); }
    else for (const mv of pz.best) b.tap(mv);
    attempt(run, b.over === 'goal');
  }
  assert.equal(run.over, true); assert.equal(run.lives, 0); assert.equal(n, 8); assert.equal(run.score, 6);
});

test('the difficulty: every number goes the hard way only, one of them a success at most, by one step', () => {
  const up = { W: 1, H: 1, ours: 1, def: 1, mark: 1, press: 1, lenLo: 1, lenHi: 1, spare: -1, ways: -1, firsts: -1 };
  const big = Array.from({ length: 151 }, (_, i) => i * STEP);
  for (let i = 1; i < big.length; i++) {
    const a = puzzleLevel(big[i - 1]), b = puzzleLevel(big[i]); let changed = 0;
    for (const k of STEPPED) {
      const d = (b[k] - a[k]) * up[k]; assert.ok(d >= 0, `${k} eased at level ${big[i].toFixed(2)}`);
      if (d) { changed++; assert.ok(d <= (k === 'H' ? 2 : 1), `${k} jumped`); }
    }
    assert.ok(changed <= 1, `level ${big[i].toFixed(2)}: ${changed} numbers changed at one success`);
    assert.ok(b.lenHi >= b.lenLo && b.lenHi <= 6);
    if (a.sec) assert.ok(b.sec <= a.sec && a.sec - b.sec <= 4, 'the sand timer shortens a little');
    if (!a.sec && b.sec) assert.ok(b.sec >= 110, 'it comes in long');
  }
  const z = puzzleLevel(0); assert.deepEqual([z.def, z.lenLo, z.lenHi, z.spare, z.sec], [1, 2, 2, 2, 0], 'the start: one defender, two-move puzzles, two spare, no timer');
  const h = puzzleLevel(50); assert.ok(h.lenLo === 6 && h.def === 6 && h.sec > 30 && h.sec < 40, 'it keeps getting harder');
});

test('bots: picking a shortest-solution move 60% of the time does clearly better than random; 95% still ends', () => {
  const runOf = (p, seed) => {
    const r = rng(seed), run = newRun(); let n = 0;
    while (!run.over && n < 400) {
      const pz = makePuzzle(run.level, Math.floor(r() * 2 ** 31)), b = new Board(pz); n++;
      while (!b.over) {
        let mv = null;
        if (r() < p) { const m = bestFirst(pz, b.s, b.left).moves; mv = m[Math.floor(r() * m.length)] || null; }
        if (!mv) { const all = movesFrom(pz, b.s); mv = all[Math.floor(r() * all.length)]; }
        b.tap(mv);
      }
      attempt(run, b.over === 'goal');
    }
    return { score: run.score, n };
  };
  const mean = (p, k = 20) => { let s = 0, mx = 0; for (let i = 0; i < k; i++) { const x = runOf(p, 31 + i * 97); s += x.score; mx = Math.max(mx, x.n); } return { mean: s / k, mx }; };
  const rand = mean(0), p60 = mean(.6), p95 = mean(.95);
  assert.ok(p60.mean >= rand.mean + 1 && p60.mean >= 3 * rand.mean, `60%: ${p60.mean}, random: ${rand.mean}`);
  assert.ok(p95.mean > p60.mean && p95.mx < 400, `95%: ${p95.mean}, longest run ${p95.mx}`);
});
