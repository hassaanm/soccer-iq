// The decision window (v64): play goes on in slow motion while he chooses (js/window.js, js/game/window.js). The full
// check plays every scene through the window (npm run audit:motion); these are the quick ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, drive } from './harness.js';
import { PATH, allScenarios } from '../js/skills.js';
import { windowSeconds, planHold, agreeAt, rolesOf, attackOptions, pathAt, kindOf, SPEED, WINDOW, THINK, RETRY, PACE } from '../js/window.js';
import { logChoice, today } from '../js/progress.js';

test('the window: one table, by level, with the grown-ups\' Thinking time and longer after running out of time', () => {
  assert.equal(windowSeconds({ first: true }), WINDOW.first);
  assert.deepEqual([1, 2, 3].map(level => windowSeconds({ level })), [WINDOW[1], WINDOW[2], WINDOW[3]]);
  assert.ok(windowSeconds({ level: 3 }) >= 4, 'never under 4 s at Normal');
  assert.equal(windowSeconds({ level: 1, think: 'relaxed' }), WINDOW[1] * THINK.relaxed);
  assert.equal(windowSeconds({ level: 1, think: 'quick' }), WINDOW[1] * THINK.quick);
  assert.equal(windowSeconds({ level: 2, retry: 1 }), WINDOW[2] * RETRY);
});

// Where everyone is in a scene's own picture, as the game plans before the run-up (game/window.js sceneState), and the
// plan's options as the game gives them (rounds.js).
const stateOf = sc => {
  const at = {}, put = (id, p, team, gk = false) => { if (p) at[id] = { x: p[0], y: p[1], vx: 0, vy: 0, team, gk }; };
  put('hero', sc.heroTo, 'us'); (sc.matesTo || sc.mates).forEach((p, i) => put('m' + (i + 1), sc.kind === 'lead' && i === 0 ? sc.moves.m1.at : p, 'us')); (sc.oppsTo || sc.opps).forEach((p, i) => put('o' + (i + 1), p, 'them'));
  if (sc.gk?.us) put('k1', sc.gk.us, 'us', true); if (sc.gk?.them) { put('k2', sc.gk.them, 'them', true); if (sc.gk.out) at.k2.rush = true; }
  return { at };
};
const planOf = (sc, R = 8) => {
  const kind = kindOf(sc), opts = { R, options: kind === 'attack' ? attackOptions(sc) : undefined };
  if (kind === 'lead') { const d = sc.dir, mv = sc.moves; opts.keep = { m1: [d[0] * mv.m1.speed, d[1] * mv.m1.speed], ...(mv.o2 ? { o2: [d[0] * mv.o2.speed, d[1] * mv.o2.speed] } : {}) }; }
  if (kind === 'receive') { opts.skip = ['m1']; opts.G = Math.max(.25, Math.hypot(sc.heroTo[0] - .45 - (sc.mates[0][0] + .4), sc.heroTo[1] - sc.mates[0][1]) / 5); }
  if (sc.intro === 'won') opts.never = ['o1'];
  return { p: planHold(sc, stateOf(sc), opts), opts, st: stateOf(sc) };
};
// (v66) The design: the picture holds for the whole window, and one defender comes.
test('every lesson scene: the shape holds all through the window, nobody strays from his place in the picture, and the one who comes runs straight in', () => {
  let n = 0, threats = 0;
  for (const sk of PATH) for (const sc of allScenarios(sk.id)) {
    const kind = kindOf(sc); if (kind === 'tackle' || kind === 'follow') continue; // (a 1v1 has no window; after a shot it opens from play going on: the motion audit plays it)
    const { p, opts, st } = planOf(sc); n++;
    assert.deepEqual(p.dis, [], `${sc.id}: ${p.dis}`);
    assert.ok(p.G >= .6 - 1e-9 && p.G <= 4.6, `${sc.id}: ${p.G} s of play`);
    assert.ok((p.G - .1) / (p.R - .1) >= PACE - 1e-6, `${sc.id}: the world at ${((p.G - .1) / (p.R - .1)).toFixed(3)}x`);
    const ids = Object.keys(st.at).filter(id => !st.at[id].gk), comers = new Set(p.comers.map(c => c.id)), tP = p.tP;
    for (const t of [0, p.G / 2, p.G]) {
      const pos = id => (p.paths[id] ? pathAt(p.paths[id], t) : st.at[id]); // (one the scene's own script moves, the passer: where the scene has him)
      // every relation that does not hang on the one who comes, as the scene grades it; and he spoils nothing he should not
      const a = agreeAt(sc, p, pos, t, { options: opts.options, ids });
      assert.deepEqual(a.dis, [], `${sc.id} at ${t.toFixed(2)} s: ${a.dis}`);
      if (!p.tviol) assert.deepEqual(a.threat, [], `${sc.id} at ${t.toFixed(2)} s: the threat spoils ${a.threat}`);
      // nobody more than 1.5 m from his place in the picture, moved on with the play (the scene's own runners apart)
      for (const id of ids) { if (comers.has(id) || opts.keep?.[id] || !p.paths[id]) continue; const q = pos(id), d = Math.hypot(q.x - st.at[id].x - p.D[0] * (t - tP), q.y - st.at[id].y - p.D[1] * (t - tP)); assert.ok(d <= 1.5, `${sc.id} ${id}: ${d.toFixed(2)} m off his place at ${t.toFixed(2)} s`); }
    }
    for (const [id, path] of Object.entries(p.paths)) for (const t of [0, p.G / 2, p.G]) { const q = pathAt(path, t), v = Math.hypot(q.vx, q.vy); assert.ok(v <= SPEED.sprint[1] + .05, `${sc.id} ${id}: ${v.toFixed(1)} m/s`); }
    const th = p.threat?.id;
    if (th && p.paths[th].run) { // straight in, never slowing, to the ball as the window ends
      threats++; const run = p.paths[th], a = pathAt(run, 0), m = pathAt(run, p.G / 2), e = pathAt(run, p.G), h = pathAt(p.paths[p.holder], p.G);
      // fast, then set: he never slows before his last metre, and is still over half his run speed half a metre out
      const sp = q => Math.hypot(q.vx, q.vy), tBrake = run.ta + run.tc - (run.shift || 0), vm = sp(pathAt(run, Math.max(0, tBrake - .02)));
      assert.ok(sp(m) >= sp(a) - 1e-6 || p.G / 2 > tBrake, `${sc.id}: ${th} slows down before his last metre`);
      if (kind !== 'receive' && !sc.shot) { let half = null; for (let t = p.G; t >= 0 && !half; t -= .01) { const q = pathAt(run, t); if (Math.hypot(q.x - e.x, q.y - e.y) >= .5) half = q; }
        assert.ok(!half || sp(half) >= vm * .5 - .05, `${sc.id}: ${th} crawls (${sp(half).toFixed(1)} of ${vm.toFixed(1)} m/s half a metre out)`);
        assert.ok(sp(e) >= 1 - 1e-6 || vm < 1.3, `${sc.id}: ${th} stops before the ball (${sp(e).toFixed(2)} m/s)`); }
      if (kind !== 'receive' && !sc.shot) assert.ok(Math.hypot(e.x - h.x, e.y - h.y) < 1.5, `${sc.id}: ${th} ends ${Math.hypot(e.x - h.x, e.y - h.y).toFixed(2)} m from the player on the ball`);
      // and he is the nearest free defender as it opens
      const at0 = Object.fromEntries(Object.entries(p.paths).map(([id, q]) => { const r = pathAt(q, 0); return [id, { ...st.at[id], x: r.x, y: r.y }]; })), ro = rolesOf(sc, at0, { never: opts.never });
      if (!st.at[th].gk) assert.ok(ro.free[0] === th || ro.free.filter(id => !(opts.never || []).includes(id) && !opts.keep?.[id])[0] === th, `${sc.id}: ${th} comes, but ${ro.free[0]} is the nearest free defender as it opens`);
    }
  }
  assert.ok(n > 100 && threats > 60, `${n} scenes, ${threats} with someone coming`);
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
  assert.ok(wins[0].f < .5 && wins[0].f >= PACE - 1e-6, `slow motion, never under ${PACE}x (${wins[0].f})`);
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

// (v66) In the game: the threat runs in from well out and is at the ball as the ring empties; he takes it at once.
test('the one who comes closes at least 2.5 m and is within 0.8 m of the ball as the window ends; nobody else leaves his place', async () => {
  let n = 0;
  for (const id of ['look-up', 'take-him-on', 'pass-to-open', 'see-the-trap']) for (const sc of allScenarios(id).slice(0, 3)) {
    const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre());
    const p = g.decide(), w = g.win, th = w.threat.id, a = g.sim.a(th), b = g.sim.ball, d0 = Math.hypot(a.x - b.x, a.y - b.y);
    const start = Object.fromEntries([...g.sim.agents.values()].map(q => [q.id, { x: q.x, y: q.y }]));
    let last = null; await drive(g, p, { pick: gm => { if (gm.win) last = { d: Math.hypot(a.x - b.x, a.y - b.y), at: Object.fromEntries([...gm.sim.agents.values()].map(q => [q.id, { x: q.x, y: q.y }])) }; return null; } });
    assert.ok(last.d < .8, `${sc.id}: ${th} is ${last.d.toFixed(2)} m from the ball as the window ends`);
    if (w.plan.cls === 'full') assert.ok(d0 - last.d >= 2.5, `${sc.id}: ${th} closed only ${(d0 - last.d).toFixed(2)} m`);
    const hm = [last.at.hero.x - start.hero.x, last.at.hero.y - start.hero.y];
    for (const q of g.sim.agents.values()) { if (q.id === th || q.id === w.plan.second || q.gk) continue; const dx = last.at[q.id].x - start[q.id].x - hm[0], dy = last.at[q.id].y - start[q.id].y - hm[1]; assert.ok(Math.hypot(dx, dy) <= 1.5, `${sc.id} ${q.id}: ${Math.hypot(dx, dy).toFixed(2)} m against the play`); }
    n++;
  }
  assert.ok(n >= 10, `only ${n} scenes checked`);
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
