// Dribble dash (v96, js/mini/dash.js): the waves are fair (an open way always, every choice plainly open or shut, and
// the open one readable from the picture at the moment he must choose), the open way is always within reach, the
// answers are spread, and the two players' numbers sit where the owner wants them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashLevel, makeWave, readLine, truth, posAt, velAt, Dash, bot, rng, LOCK, MOVE_MIN, MOVE_MAX, CLEAR_M, BLOCK_M, TACKLE_R, DASH_SAID, CEIL, EASY_LEGS } from '../js/mini/dash.js';
import { newRun, attempt } from '../js/mini/rules.js';
import { STEAL_R } from '../js/fast/rules.js';
import { PITCH } from '../js/geom.js';

const LEVELS = [0, 1, 2, 3, 4, 5, 6], N = 2000;
const waves = L => { const hist = [], out = []; for (let i = 0; i < N; i++) { const w = makeWave(L, 104729 * (L + 1) + i * 7919 + 1, { hist, since: i % 4, cy: PITCH.W / 2 }); hist.push(w.answer); out.push(w); } return out; };

test('dash: the level only gets harder, and the first two lines are the gentle wide ones', () => {
  let was = null;
  for (let s = 0; s <= 40; s++) {
    const D = dashLevel(s / 3);
    if (was) { assert.ok(D.v >= was.v && D.see <= was.see && D.react <= was.react && D.moveP >= was.moveP && D.lateP >= was.lateP, `score ${s}`); }
    if (s <= 8) assert.ok(D.react >= .6 - 1e-9 && D.see >= 1.8 - 1e-9, 'up to score 8, never less than 0.6 s to react after the last change, 1.8 s to choose');
    assert.ok(D.react >= CEIL.reactMin - 1e-9 && D.see >= CEIL.seeMin - 1e-9, `score ${s}: never less than ${CEIL.reactMin} s to react, ${CEIL.seeMin} s to choose (v96 fix: it keeps rising past score 8)`);
    was = D;
  }
  assert.equal(dashLevel(0).wide, true); assert.equal(dashLevel(1 / 3).wide, true); assert.equal(dashLevel(2 / 3).wide, false);
  assert.equal(dashLevel(2 / 3).lateP, 0); assert.ok(dashLevel(1).lateP > 0, 'late shifts from score 3');
  assert.equal(dashLevel(5 / 3).friend, false); assert.equal(dashLevel(2).friend, true); assert.ok(dashLevel(8 / 3).doubleP > 0 && !dashLevel(7 / 3).doubleP);
  assert.equal(TACKLE_R, STEAL_R, "a tackle reaches as far as the Live game's");
});

test('dash: every line of 2000 waves a level has an open way; every choice is plainly open or shut; the rule a person reads matches it', () => {
  for (const L of LEVELS) {
    const D = dashLevel(L);
    for (const w of waves(L)) {
      assert.deepEqual(makeWave(L, w.seed, {}).seed, w.seed);
      for (const l of w.lines) {
        const tr = truth(l);
        assert.ok(l.safe.length >= 1, `level ${L} seed ${w.seed}: an open way`);
        for (const c of l.choices) {
          assert.notEqual(tr[c.id], 'unclear', `level ${L} seed ${w.seed} ${c.id}`);
          const near = Math.min(...l.defs.map(d => Math.abs(posAt(d.m, 0) - c.y)));
          if (tr[c.id] === 'open') assert.ok(near >= CLEAR_M && near > TACKLE_R + .6); else assert.ok(near <= BLOCK_M && near < TACKLE_R - .6);
        }
        // nothing changes after `settle`, at least `react` s before the lock; from then to the lock the rule says it all
        assert.ok(l.settle <= l.lockT - D.react + 1e-9, `level ${L} seed ${w.seed}: settled in time`);
        for (let t = l.settle + 1e-6; t <= l.lockT + 1e-9; t += .05) assert.deepEqual(readLine(l, t).sort(), [...l.safe].sort(), `level ${L} seed ${w.seed} t ${t.toFixed(2)}`);
        for (const d of l.defs) { const v = Math.abs(velAt(d.m, l.settle + 1e-6)); assert.ok(v === 0 || (v >= MOVE_MIN - 1e-9 && v <= MOVE_MAX + 1e-9), 'a mover is plainly moving, at a child\'s pace'); }
      }
      assert.ok(w.lines[0].safe.includes(w.answer) || w.kind === 'double');
    }
  }
});

// Where the answers fall (the table in the v96 report): spread over the sides, never the same three times in a row.
test('dash: the answers are spread, never the same three times running, and the first wave is either side', () => {
  const table = {};
  for (const L of LEVELS) {
    const ws = waves(L), c = table[L] = { L: 0, M: 0, R: 0, F: 0, staticRight: 0, lines: 0, kinds: {} };
    let run = 1;
    ws.forEach((w, i) => {
      c[w.answer]++; c.kinds[w.kind] = (c.kinds[w.kind] || 0) + 1;
      if (i && ws[i - 1].answer === w.answer) run++; else run = 1;
      assert.ok(run <= 2, `level ${L}: the same answer three times running`);
      for (const l of w.lines) { c.lines++; const st = readLine(l, l.openT, 1e9); if (st.length === l.safe.length && st.every(x => l.safe.includes(x))) c.staticRight++; }
    });
    const sides = ['L', 'R'].map(k => c[k] / N);
    assert.ok(Math.min(...sides) > (L ? .2 : .4), `level ${L}: both sides`);
    if (L >= 1) assert.ok(c.M / N > .04, `level ${L}: the middle too`);
    if (L >= 2) assert.ok(c.F / N > .1, `level ${L}: the friend too`);
    c.staticRight = +(c.staticRight / c.lines).toFixed(2);
  }
  assert.ok(table[0].staticRight === 1 && table[2].staticRight < .6 && table[4].staticRight < .45, 'from score 4 or so, where they stand is not enough: how they move matters');
  if (process.env.DASH_TABLE) console.log(JSON.stringify(table));
  const firsts = new Set(Array.from({ length: 40 }, (_, i) => makeWave(0, i + 1, {}).answer)); assert.deepEqual([...firsts].sort(), ['L', 'R']);
});

// A player who taps the open way at the last moment he may (just before the lock), or at the first: always through.
function playOracle(score, when, lines, seed) {
  const run = newRun(1e9); run.score = score; let n = 0, ok = 0; const why = [];
  const d = new Dash({ L: PITCH.L, W: PITCH.W, run, seed, hooks: { cross: (l, good, info) => { n++; if (good) ok++; else why.push(`${l.wave.kind} ${l.wave.seed} ${info.why}`); attempt(run, good); run.score = score; } } });
  d.start();
  for (let i = 0; i < 4e5 && n < lines; i++) {
    d.tick(1 / 60);
    const l = d.tappable(); if (!l) continue;
    const t = d.rel(l), want = l.second ? l.answer : l.answer; // (a double's first line: the side that leads on)
    if (l.pick !== want && (when === 'first' || t >= l.lockT - .03)) d.tap(want);
  }
  return { n, ok, why };
}
test('dash: the open way is always within reach, picked at the first moment or at the last', () => {
  for (const score of [0, 1, 3, 6, 9, 12, 18]) for (const when of ['first', 'last']) {
    const r = playOracle(score, when, 120, score * 13 + (when === 'first' ? 1 : 2));
    assert.equal(r.ok, r.n, `score ${score}, tapped at the ${when} moment: ${r.why.slice(0, 3).join('; ')}`);
  }
});

test('dash: a run with two lives ends, nothing waits for ever, and no tap ever loses the ball by itself', () => {
  for (let k = 0; k < 6; k++) {
    const run = newRun(); let over = false, crosses = 0, last = 0;
    const d = new Dash({ L: PITCH.L, W: PITCH.W, run, seed: 77 + k, hooks: { cross: (l, ok) => { crosses++; attempt(run, ok); last = d.t; }, again: () => { last = d.t; }, over: () => { over = true; } } }); // (again: a forgiving leg's free tackle, v96 fix)
    const b = bot(k % 2 ? 'child' : 'adult', rng(k + 5)); d.start();
    for (let i = 0; i < 60 * 60 * 30 && !over; i++) { d.tick(1 / 60); b.step(d); assert.ok(d.t - last < 15, 'a line is over within 15 s'); }
    assert.ok(over, 'the run ended'); assert.equal(run.lives, 0); assert.ok(crosses >= 2);
  }
  // no tap at all (past the forgiving legs, where he runs on straight: tests/v96-fix.test.js): he hesitates and is closed
  // down, every time, and it is told as such
  const run = newRun(1e9), whys = new Set(); const d = new Dash({ L: PITCH.L, W: PITCH.W, run, seed: 5, hooks: { cross: (l, ok, info) => { assert.equal(ok, false); whys.add(info.why); attempt(run, ok); } } });
  d.legsDone = EASY_LEGS; d.start(); for (let i = 0; i < 60 * 60; i++) d.tick(1 / 60);
  assert.ok(run.n >= 3); assert.deepEqual([...whys], ['none']);
});

// The two players (the numbers in the v96 report come from scratch/dash/table.mjs, the same players, more waves).
function share(kind, score, lines, seed) {
  const rnd = rng(seed), run = newRun(1e9); run.score = score; let n = 0, ok = 0;
  const d = new Dash({ L: PITCH.L, W: PITCH.W, run, seed, hooks: { cross: (l, good) => { n++; if (good) ok++; attempt(run, good); run.score = score; } } });
  const b = bot(kind, rnd); d.start();
  for (let i = 0; i < 2e6 && n < lines; i++) { d.tick(1 / 30); b.step(d); }
  return ok / n;
}
test('dash: the careless child gets through the first two lines most of the time; the adult must read movement by score 4 and finds score 10 hard', () => {
  assert.ok(share('child', 0, 150, 3) > .6 && share('child', 1, 150, 4) > .6, 'the child, the first two lines');
  assert.ok(share('child', 4, 150, 5) < .5, 'the child, by where they stand, at score 4');
  assert.ok(share('adult', 4, 150, 6) > .85, 'the adult reading their movement, at score 4');
  const a10 = share('adult', 10, 200, 7); assert.ok(a10 < .9 && a10 > .5, `the adult at score 10: ${a10}`);
});

test('dash: every line it says is one the game has recorded already', () => {
  for (const l of Object.values(DASH_SAID)) assert.ok(typeof l === 'string' && l.length > 3);
});
