// (v79) The pause (js/pause.js): "Sometimes you need to just stop and think about it." In every mode (a lesson round, a
// watch demo, a live match, a skill offer, the keeper game), a run is played twice: once straight through, once with 30 s
// pauses at several moments (each 900 frames that hand the game no time, with everything waiting on them let run). While
// paused nothing changes: positions, the ring, the script's progress, every timer. After it, play eases back in, and the
// play itself is the same to the last bit: every game step of it, and how it ends. (Only the frame the run is looked at
// last can fall a step or two of game time apart, as with any other frame lengths: tests/harness.js drive.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, pictureU } from './harness.js';
import { allScenarios, PATH } from '../js/skills.js';
import { optionsFor } from './harness.js';
import { Goalie } from '../js/game/goalie.js';
import { roundPlan } from '../js/saves.js';
import { held, setPause, share, later, unlater, EASE } from '../js/pause.js';

const DT = 1 / 30, HOLD = 900; // 30 s
const tick = () => new Promise(r => setImmediate(r));
// The same random numbers in both runs (live play draws some).
const seeded = seed => { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296); };

// What must not change while paused: where everyone is, the clocks, the window and its ring, the jobs and the script.
const gameState = (g, events) => JSON.stringify({
  a: [...g.sim.agents.values()].map(a => [a.id, a.x, a.y, a.tx, a.ty, a.face]), b: g.sim.ball, t: g.sim.time, rt: g.realTime, clock: g.ui.clock, acc: g.acc,
  ph: g.phase, st: g.step, slow: g.slow, win: g.win && [g.win.u, g.win.real], ring: g.timerUi?.()?.left ?? null, sk: g.sk && [g.sk.phase, g.sk.pace], look: g.look, yaw: g.yaw,
  jobs: g.tweens.map(j => [j.t, j.dur, j.real, j.dead]), said: events.length, cam: g.cam,
});
const keeperState = (k, events) => JSON.stringify({ a: [...k.sim.agents.values()].map(a => [a.id, a.x, a.y]), b: k.sim.ball, t: k.sim.time, real: k.real, slow: k.slow, ph: k.phase, jobs: k.jobs.map(j => [j.t, j.sec]), win: k.win, said: events.length, cam: k.cam });

// Runs `start()` to its end with frames of DT, as main.js does (the game is handed share(DT) of each frame). `when(i, g)`
// says whether to pause before frame i; `pick(g)` acts for him each frame. Records a fingerprint of every game step.
async function run({ make, start, pick = () => {}, when = () => false, state, maxFrames = 30 * 900, ease = true }) {
  const real = Math.random; Math.random = seeded(4242);
  try {
    const it = make(), { g, events, sim } = it, steps = [];
    const s0 = sim().step.bind(sim()); sim().step = dt => { s0(dt); const s = sim(); steps.push(JSON.stringify([s.time, [...s.agents.values()].map(a => [a.x, a.y]), s.ball.x, s.ball.y, s.ball.z, s.ball.state])); };
    let done = false, out, t = 0, pauses = 0, changed = [];
    start(it).then(v => { done = true; out = v; });
    for (let i = 0; i < maxFrames && !done; i++) {
      if (when(i, g)) {
        pauses++; setPause(true); const before = state(g, events);
        for (let k = 0; k < HOLD; k++) { assert.equal(share(DT), 0); await tick(); }
        if (state(g, events) !== before) changed.push(i);
        setPause(false); if (!ease) share(EASE); // (no ease-in: straight back to full speed)
      }
      const d = share(DT); if (d) { t += d; it.tick(d, t); pick(g); } else assert.ok(held.lerp >= 0 && held.lerp < 1, 'a skipped frame is drawn part way'); // (as main.js: a skipped frame easing in is drawn, not played)
      await tick();
    }
    assert.ok(done, 'the run finished');
    return { steps, events: events.map(e => JSON.stringify(e.slice(0, 3))), out, pauses, changed };
  } finally { Math.random = real; if (held.on) setPause(false); share(EASE); }
}
// The paused run against the straight one: nothing changed in a pause, every game step of the play the same to the last
// bit, and the same ending. (Only the frame a run is last looked at can fall a step or two of game time apart.)
function same(a, b, what, exact) {
  assert.ok(b.pauses >= 2, `${what}: paused ${b.pauses} times`);
  assert.deepEqual(b.changed, [], `${what}: something changed while paused (before frames ${b.changed})`);
  if (exact) {
    const n = Math.min(a.steps.length, b.steps.length);
    for (let i = 0; i < n; i++) if (a.steps[i] !== b.steps[i]) assert.fail(`${what}: game step ${i} of ${n} differs`);
    assert.ok(Math.abs(a.steps.length - b.steps.length) <= 4, `${what}: ${a.steps.length} and ${b.steps.length} game steps`);
  }
  const outs = r => r.events.filter(e => /^\["(banner|skillName|pop|dots|score)"/.test(e));
  assert.deepEqual(outs(b), outs(a), `${what}: the same results and names`);
  assert.deepEqual(b.out, a.out, `${what}: the same result`);
}
// Pauses at three moments spread over a run of `n` frames, and at the first frame `extra(g)` is true.
const spread = (n, extra = () => false) => { const at = new Set([Math.floor(n * .2), Math.floor(n * .5), Math.floor(n * .8)]); let x = false; return (i, g) => at.has(i) || (!x && extra(g) && (x = true)); };
const lessonGame = () => { const { g, events } = makeGame(); return { g, events, sim: () => g.sim, tick: (d, t) => g.tick(d, t) }; };
// Straight through; paused and straight back to full speed; paused and easing back in (js/pause.js share). Each paused
// run plays every game step as the straight one does, and ends as it does.
async function both(spec, what, extra) {
  let n = 0; const a = await run({ ...spec, when: i => { n = i; return false; } });
  const b = await run({ ...spec, when: spread(n, extra), ease: false });
  same(a, b, what, true);
  const c = await run({ ...spec, when: spread(n, extra) });
  same(a, c, what + ' (eased back in)', true);
  return { a, b, c };
}

test('pause: nothing moves or counts while paused, and play eases back in over half a second, in whole frames', async () => {
  const { g } = makeGame(), sc = allScenarios('pass-to-open')[0]; g.mode = 'lesson'; g.load(sc);
  const job = (g.realJobs = true, g.job(.5)); g.realJobs = false; let fired = false; job.done.then(() => { fired = true; });
  for (let i = 0; i < 6; i++) g.tick(DT, i * DT);
  setPause(true);
  for (let k = 0; k < HOLD; k++) { const d = share(DT); if (d) g.tick(d, 0); await tick(); }
  assert.equal(fired, false, 'a real-time job does not run out while paused');
  setPause(false);
  const fed = []; for (let k = 0; k < 24; k++) fed.push(share(DT));
  assert.ok(fed.every(d => d === 0 || d === DT), 'the game is handed whole frames, or none');
  const n = Math.round(EASE / DT), first = fed.slice(0, n / 3).filter(Boolean).length, last = fed.slice(2 * n / 3, n).filter(Boolean).length;
  assert.ok(first <= 1 && last >= 3 && fed.slice(n).every(d => d === DT), `play comes back slowly at first (${first} of ${n / 3}), then faster (${last}), all of it after half a second`);
  for (let i = 0; i < 20 && !fired; i++) { g.tick(DT, 1); await tick(); }
  assert.equal(fired, true, 'and runs on after it');
});

test('pause: the page\'s timers (the HUD\'s waits) are held while paused', async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let a = 0, b = 0; later(() => { a++; }, 60); const id = later(() => { b++; }, 60);
  setPause(true); await wait(150); assert.equal(a, 0, 'not while paused');
  unlater(id); setPause(false); share(EASE);
  await wait(30); assert.equal(a, 0, 'the time left goes on from where it was'); await wait(80);
  assert.deepEqual([a, b], [1, 0], 'then it fires (and a cleared one never does)');
});

test('pause: a lesson round, paused anywhere (also as the choice opens), plays and ends as it would have', async () => {
  for (const [skill, k] of [['pass-to-open', 0], ['dribble-to-space', 1], ['get-goal-side', 0]]) {
    const sc = allScenarios(skill)[k], opt = sc.best || optionsFor(sc)[0];
    await both({ make: lessonGame, state: gameState,
      start: async ({ g }) => { g.mode = 'lesson'; g.load(sc); await g.pre(); await g.decide(); return g.result; },
      pick: g => { if (g.canAct && g._choose && g.win && g.win.u >= pictureU(g.win)) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); g.choose(opt); } },
    }, `${skill} ${sc.id}`, g => g.phase === 'decide');
  }
});

test('pause: a watch demo (its script, its hand, its words) stops and goes on to the same end', async () => {
  for (const id of ['look-up', 'take-him-on'].filter(id => PATH.some(p => p.id === id)))
    await both({ make: lessonGame, state: gameState, start: async ({ g }) => { await g.demo(id); return g.result; } }, `demo ${id}`, g => g.win?.demo?.crawl != null);
});

test('pause: a skill offer (the moment and its timer) holds, and the move goes as it would have', async () => {
  const spec = (sc, opt) => ({ make: () => { const it = lessonGame(); it.g.mode = 'lesson'; return it; }, state: gameState,
    start: async ({ g }) => { g.load(sc); await g.pre(); g.decide(); const w = g.win; if (w) { const u = pictureU(w); for (let i = 0; i < 6000 && g.win && (g.win.u ?? 0) < u; i++) g.tick(1 / 60, 0); } await g.outcome(opt, g.isGood(opt)); return g.result; },
    pick: g => { if (g.sk?.phase === 'offer') { g.sk.r0 ??= g.realTime; if (g.realTime - g.sk.r0 > 1) g.skillTap(g.sk.alts.findIndex(x => x.good)); } } });
  let found = null; // (a play of the take-on lesson where a move is offered and played)
  for (const sc of allScenarios('take-him-on')) { for (const opt of optionsFor(sc).filter(o => o.startsWith('drib:'))) { const r = await run(spec(sc, opt)); if (r.events.some(e => e.startsWith('["skillName"'))) { found = [sc, opt]; break; } } if (found) break; }
  assert.ok(found, 'a play with a skill move');
  await both(spec(...found), `skill ${found[0].id} ${found[1]}`, g => g.sk?.phase === 'offer');
});

test('pause: a live match, paused at several moments, plays on the same', async () => {
  await both({ make: lessonGame, state: gameState, maxFrames: 30 * 400,
    start: async ({ g }) => { const r = await g.match(['look-up', 'pass-to-open'], [], 1, 'free'); return r && [r.us, r.them]; },
    pick: g => { if (g.canAct && g._choose && g.win && g.win.u >= .4) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); g.choose(g.sc.kind === 'defense' ? (g.sc.best || 'spot:' + g.sc.spots[0].id) : g.sc.best || 'pass:0'); } },
  }, 'match', g => g.phase === 'decide');
});

test('pause: the keeper game, paused as he stands and as the shot comes, saves the same shots', async () => {
  const make = () => { const events = [], hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) }), g = new Goalie({ world: { project: () => [400, 200] }, hud });
    return { g, events, sim: () => g.sim, tick: d => g.tick(d) }; };
  const pick = g => {
    if (g.phase === 'stand' && g.pickSpot == null && g.sim.time - g.win.t0 > g.win.T * .3) { const p = g.spec.n % 2 ? null : 'spot:' + (g.spec.spots?.find?.(s => s.right)?.id ?? 'M'); if (p) try { g.choose(p); } catch { /* */ } }
    if (g.phase === 'dive' && g.pickZone == null && g.sim.time - g.win.t0 > g.win.T * .3 && g.spec.n % 2 === 0) g.choose('zone:' + g.spec.zone);
  };
  const plan = roundPlan(7).slice(0, 4);
  await both({ make, state: keeperState, pick, start: async ({ g }) => { g.on = true; g.setup(plan[0]); const r = await g.round(plan); g.on = false; return r.map(x => x.res); } }, 'keeper', g => g.phase === 'dive');
});
