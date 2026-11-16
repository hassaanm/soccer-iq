// The decision window (v64): play goes on in slow motion while he chooses (js/window.js, js/game/window.js). The full
// check plays every scene through the window (npm run audit:motion); these are the quick ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, drive } from './harness.js';
import { PATH, allScenarios } from '../js/skills.js';
import { windowSeconds, planWindow, pathAt, kindOf, SPEED, ACC, WINDOW, THINK, RETRY } from '../js/window.js';
import { logChoice, today } from '../js/progress.js';

test('the window: one table, by level, with the grown-ups\' Thinking time and longer after running out of time', () => {
  assert.equal(windowSeconds({ first: true }), WINDOW.first);
  assert.deepEqual([1, 2, 3].map(level => windowSeconds({ level })), [WINDOW[1], WINDOW[2], WINDOW[3]]);
  assert.ok(windowSeconds({ level: 3 }) >= 4, 'never under 4 s at Normal');
  assert.equal(windowSeconds({ level: 1, think: 'relaxed' }), WINDOW[1] * THINK.relaxed);
  assert.equal(windowSeconds({ level: 1, think: 'quick' }), WINDOW[1] * THINK.quick);
  assert.equal(windowSeconds({ level: 2, retry: 1 }), WINDOW[2] * RETRY);
});

// Where everyone is in a scene's own picture, as the game plans before the run-up (game/window.js sceneState).
const stateOf = sc => {
  const at = {}, put = (id, p, team, gk = false) => { if (p) at[id] = { x: p[0], y: p[1], vx: 0, vy: 0, team, gk }; };
  put('hero', sc.heroTo, 'us'); (sc.matesTo || sc.mates).forEach((p, i) => put('m' + (i + 1), p, 'us')); (sc.oppsTo || sc.opps).forEach((p, i) => put('o' + (i + 1), p, 'them'));
  if (sc.gk?.us) put('k1', sc.gk.us, 'us', true); if (sc.gk?.them) put('k2', sc.gk.them, 'them', true);
  return { at };
};
test('every lesson scene gets a window in which every choice keeps its grade, at child speeds, with nobody turning back', () => {
  for (const sk of PATH) for (const sc of allScenarios(sk.id).slice(0, 3)) {
    if (kindOf(sc) === 'tackle' || kindOf(sc) === 'receive' || kindOf(sc) === 'lead' || kindOf(sc) === 'follow' || sc.restart) continue; // (restarts: a dead ball, round 2's planner only) // (these open from play going on: the motion audit plays them)
    const p = planWindow(sc, stateOf(sc), { fixed: true });
    assert.deepEqual(p.dis, [], `${sc.id}: ${p.dis}`);
    assert.ok(p.G >= .9 && p.G <= 2, `${sc.id}: ${p.G} s of play`);
    for (const [id, path] of Object.entries(p.paths)) {
      const v0 = pathAt(path, 0), v1 = pathAt(path, p.G), s0 = Math.hypot(v0.vx, v0.vy), s1 = Math.hypot(v1.vx, v1.vy);
      assert.ok(Math.max(s0, s1) <= SPEED.sprint[1], `${sc.id} ${id}: ${s1.toFixed(1)} m/s`);
      if (s0 > .4 && s1 > .4) assert.ok((v0.vx * v1.vx + v0.vy * v1.vy) / (s0 * s1) > -.5, `${sc.id} ${id} turns back`);
      if (!path.tau) assert.ok(true); else assert.ok(Math.hypot(path.v1[0] - path.v0[0], path.v1[1] - path.v0[1]) * 1.5 / path.tau <= ACC + 1e-6, `${sc.id} ${id} speeds up too fast`);
    }
  }
});

test('in a window play goes on, slowly; at its end the defender takes the ball, and the round is tried again with more time', async () => {
  const sc = allScenarios('pass-to-open').find(s => s.pattern === 'one-open'), { g, events } = makeGame();
  const log = []; g.onChoice = rec => log.push(rec); g.choiceLog = 'lesson';
  const wins = [];
  const r = await drive(g, g.round(sc, { hint: false, level: 1 }), { pick: gm => { if (gm.win && !wins.includes(gm.win)) wins.push(gm.win); return wins.length > 1 ? gm.sc.best : null; }, maxSec: 200,
    onFrame: gm => { if (gm.win && gm.win.u > .2 && gm.win.u < .3) { const h = gm.sim.a('hero'); assert.ok(h.speed > .1, 'he keeps the ball moving'); } } });
  assert.equal(r.firstTry, false, 'running out of time is not right on the first try');
  assert.ok(events.some(e => e[0] === 'banner' && e[2] === 'soft'), 'kind words, no harsh card');
  assert.ok(wins.length >= 2 && Math.abs(wins[1].R / wins[0].R - RETRY) < .01, `the retry has a longer window (${wins.map(w => w.R).join(', ')})`);
  assert.ok(wins[0].f < .4 && wins[0].f > .03, `slow motion (${wins[0].f})`);
  assert.equal(log[0]?.timeout, true, 'the time-out goes in the decision log');
});

test('the decision log keeps time-outs apart from his choices, and the time to choose in real seconds', () => {
  const p = { log: { days: {}, weeks: {} } }, d = today();
  logChoice(p, { id: 'look-up', mode: 'lesson', grade: 'miss', sec: 9, looked: false, timeout: true }, d);
  logChoice(p, { id: 'look-up', mode: 'lesson', grade: 'best', sec: 11.2, looked: true }, d);
  const e = p.log.days[d]['look-up'];
  assert.equal(e.t, 1); assert.deepEqual(e.r.lesson, [1, 0, 0]);
  assert.equal(e.s[22], 1, 'half-second bins, now up to 15 s');
});

test('in a match the time-out hands them the ball and play goes on', async () => {
  const real = Math.random; let x = 77; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  try {
    const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id)); let skipped = 0, theirs = 0;
    await drive(g, g.match(PATH.map(s => s.id), [], 2, 'free'), { maxSec: 3000,
      pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null; if (skipped < 2 && gm.win && gm.sc.kind !== 'defense') return null; return gm.sc.best || null; },
      onFrame: gm => { if (gm.result === 'stolen' && gm.phase === 'outcome' && gm.lastWin?.u >= 1 && !gm._seen) { gm._seen = true; skipped++; theirs += gm.sim.a(gm.sim.ball.carrier)?.team === 'them' ? 1 : 0; } if (gm.phase !== 'outcome') gm._seen = false; } });
    assert.ok(g.timeoutsInMatch >= 1, 'he ran out of time in a match');
    assert.ok(theirs >= 1, 'their team has the ball after it');
  } finally { Math.random = real; }
});

// Round 2: the scene's own picture is the end of the window. The threat runs in from well out, on a child's run, and is
// where the scene has him as it ends; whoever is still in the picture moves.
test('round 2: the threat arrives at the scene\'s own picture as the window ends, from at least 2.5 m further out', async () => {
  let n = 0;
  for (const id of ['look-up', 'take-him-on', 'pass-to-open', 'see-the-trap']) for (const sc of allScenarios(id).slice(0, 3)) {
    const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre());
    const p = g.decide(), w = g.win, th = w.threat.id, a = g.sim.a(th), start = { x: a.x, y: a.y };
    if (w.plan.Gpost) { g.choose(sc.best); await p; continue; } // (one getting back from far runs on past his place)
    let last = null; await drive(g, p, { pick: gm => { if (gm.win) last = { x: a.x, y: a.y }; return null; } });
    const want = sc.oppsTo[+th.slice(1) - 1], end = Math.hypot(last.x - want[0], last.y - want[1]), ran = Math.hypot(last.x - start.x, last.y - start.y);
    assert.ok(end < .4, `${sc.id}: ${th} ends ${end.toFixed(2)} m from his place in the scene`);
    assert.ok(ran >= 2.5, `${sc.id}: ${th} ran only ${ran.toFixed(2)} m in the window`);
    n++;
  }
  assert.ok(n >= 6, `only ${n} scenes checked`);
});

test('round 2: after three time-outs in a row the next window is Relaxed, until he chooses in time again', () => {
  const { g } = makeGame(); g.mode = 'lesson'; g.load(allScenarios('look-up')[0]);
  const base = g.windowReal();
  g.win = { u: 0 }; g.phase = 'decide';
  for (let i = 0; i < 3; i++) { g._choose = () => {}; g.choose('timeout'); }
  assert.equal(g.windowReal(), base * THINK.relaxed);
  g._choose = () => {}; g.choose('pass:0');
  assert.equal(g.windowReal(), base);
});
