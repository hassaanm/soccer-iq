// (v96) "Win the ball": a careful player's win share fell from 85% (round 3) to 46% (round 4) because the forgiving start
// (`soft`) ended in a few rounds while the real curve was already rising. Its own, longer start (K.SOFT_WIN) spreads the fall:
// no round-to-round drop of more than about 15 points between rounds 1 and 8, rounds 1 and 2 as easy as before, round 8 the
// real game as before. The player: goes to the press spot in front of whoever has (or is to get) the ball, presses when the
// ball glows, after a reaction time (REACT s) and re-deciding every THINK s. Deterministic (fixed seeds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rondo } from '../js/mini/rondo-play.js';
import * as K from '../js/mini/rondo.js';
import { stream } from '../js/shot.js';

function careful(g, st, dt, react, think) {
  if (g.phase !== 'play') return; st.t = (st.t || 0) + dt;
  if (g.glowing()) { st.glow ??= st.t; if (st.t - st.glow >= react) { g.steal(); st.glow = null; } return; } st.glow = null;
  if (st.t < (st.next || 0)) return; st.next = st.t + think;
  const f = g.flight, who = f && f.kind === 'pass' ? f.to : g.owner(); if (!who || who === 'hero') return;
  const sp = g.spots().find(p => p.kind === 'press' && p.of === who); if (!sp) return;
  const me = g.sim.a('hero'); if (g.goAt && Math.hypot(g.goAt.x - sp.x, g.goAt.y - sp.y) < .6) return;
  if (Math.hypot(me.x - sp.x, me.y - sp.y) > .3) g.goSpot(sp);
}
function share(round, n, react, think) {
  const L = (round - 1) / 3; let won = 0;
  for (let k = 0; k < n; k++) {
    const g = new Rondo({ mode: 'win', rnd: stream(.03 + k * .0131 + L * .001) }), st = {}; g.round(L);
    for (let i = 0; i < 20 * 30 * 4 && !(g.phase === 'idle' && g.result); i++) { g.tick(1 / 30); careful(g, st, 1 / 30, react, think); }
    if (g.result.res === 'won') won++;
  }
  return 100 * won / n;
}

test('Win the ball: its soft start is its own, eases out over seven rounds, and leaves Keep the ball\'s alone', () => {
  assert.equal(K.SOFT_WIN[0], 1); assert.equal(K.SOFT_WIN[1], .85, 'rounds 1 and 2 as easy as before');
  assert.equal(K.SOFT_WIN.at(-1), 0, 'round 8 is the real game'); assert.equal(K.SOFT_WIN_TO, 7 / 3);
  for (let i = 1; i < K.SOFT_WIN.length; i++) assert.ok(K.SOFT_WIN[i] <= K.SOFT_WIN[i - 1], 'never easier again');
  for (let i = 1; i < K.SOFT_WIN.length; i++) assert.ok(K.SOFT_WIN[i - 1] - K.SOFT_WIN[i] <= .45 + 1e-9, 'no big step in the start itself');
  assert.deepEqual(K.SOFT, [1, .85, .45, .15, 0], 'Keep the ball: as before'); assert.equal(K.keepLevel(2 / 3).soft, K.soft(2 / 3));
  assert.equal(K.winLevel(K.SOFT_WIN_TO).soft, 0); assert.equal(K.winLevel(1).soft, K.softWin(1)); assert.equal(K.winLevel(0).soft, 1);
  assert.equal(K.winLevel(2 / 3).soft, K.SOFT_WIN[2]);
});

test('Win the ball: a careful player\'s win share falls steadily from round 2 to round 8 (no step like the old 85% to 46%)', () => {
  // 200 tries a round, the one careful player (reaction .8 s, a decision every 1.5 s: the one that wins 85% of round 3 and 46% of
  // round 4 under the old curve). Measured over 1500 tries a round the biggest fall is 16 points (it was 37); this smaller count
  // is noisier, so the limit here is looser: it still fails the old curve by a wide margin.
  const w = Array.from({ length: 7 }, (_, i) => share(i + 2, 200, .8, 1.5)), steps = w.slice(1).map((x, i) => w[i] - x);
  assert.ok(w[0] >= 95, `round 2 easy: ${w.map(Math.round)}`); assert.ok(w[6] >= 10 && w[6] <= 35, `round 8 hard: ${w.map(Math.round)}`);
  for (const d of steps) assert.ok(d <= 21, `no step near the old 37 (a fall of ${d.toFixed(0)} in ${w.map(Math.round)})`);
  assert.ok(w.every((x, i) => i === 0 || x <= w[i - 1] + 6), `it keeps falling: ${w.map(Math.round)}`);
});
