// (v78) No pressure: he takes his time (window.js CALM), at the size being played (SOCCER_SIZE). Where the one who comes
// is still 4.5 m or more off the ball in the scene's picture, in front of him, and nobody else of theirs is that near,
// his own player slows to a walk and keeps the ball alive with small touches from side to side, never standing still;
// everywhere else he carries it on as before (a quick decision). The real length of the window is the same either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH, allScenarios } from '../js/skills.js';
import { TEAM } from '../js/geom.js';
import { generate } from '../js/generate.js';
import { pathAt } from '../js/window.js';
import { makeGame, drive } from './harness.js';

test('with nobody on him he slows and keeps the ball alive; under pressure he carries on', async () => {
  let calm = 0, busy = 0; const bad = [];
  for (const sk of PATH) for (const sc of [...allScenarios(sk.id), ...[101, 102, 103, 109, 110].map(n => generate(sk.id, n)).filter(Boolean)]) {
    if (sc.kind === 'tackle') continue;
    const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre());
    const p = g.decide(), w = g.win, s = g.sim; if (!w || s.ball.carrier !== 'hero') { g.choose('timeout'); continue; }
    const h = s.a('hero'), q = pathAt(w.plan.paths.hero, 0), v = Math.hypot(q.vx, q.vy);
    if (!w.plan.calm) { busy++; g.choose('timeout'); continue; }
    calm++;
    let touches = 0, last = s.time, gap = 0, lo = 9, hi = -9, slow = 9, prev = [h.x, h.y, s.time]; const t0 = s.time; g.sim.on = ev => { if (ev === 'touch') { gap = Math.max(gap, s.time - last); last = s.time; touches++; } };
    for (let T = 0; T < 300 && g.win && (g.win.u ?? 0) < .9; T++) { g.tick(1 / 30, T / 30);
      const b = s.ball, side = (b.x - h.x) * -Math.sin(b.h) + (b.y - h.y) * Math.cos(b.h); lo = Math.min(lo, side); hi = Math.max(hi, side);
      if (s.time - prev[2] >= .5) { slow = Math.min(slow, Math.hypot(h.x - prev[0], h.y - prev[1]) / (s.time - prev[2])); prev = [h.x, h.y, s.time]; } }
    if (v > .85) bad.push(`${sc.id}: no pressure, but he carries at ${v.toFixed(2)} m/s`);
    if (slow < .2) bad.push(`${sc.id}: he stands still (${slow.toFixed(2)} m/s)`);
    if (s.time - t0 > 1.5 && (touches < 2 || gap > 1.1)) bad.push(`${sc.id}: ${touches} touches, the longest gap ${gap.toFixed(2)} s of play`);
    if (hi - lo < .15) bad.push(`${sc.id}: the ball goes only ${(hi - lo).toFixed(2)} m from side to side`);
    g.choose('timeout'); void p;
  }
  assert.ok(calm > 0 && busy > calm * 5, `${TEAM.size}: windows with no pressure ${calm}, under pressure ${busy}`);
  assert.deepEqual(bad, [], TEAM.size);
});
