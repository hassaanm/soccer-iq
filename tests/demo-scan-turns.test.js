// (v78) A scan turns his view one way, back through straight ahead, then the other way, and back: never round behind him.
// The defect: lookAround turned to its second side with `wrap(to - y0)` from where the view was already; with the view
// 131° round, the other side was 216° away, so "the short way" went on round in the same direction: a full circle.
// Rule, for every demo at the size being played (SOCCER_SIZE):
//   - over each look (lookAround, scanSides, lookTo, shoulderLook) the unwrapped view never gets more than 180° to either
//     side of the heading it had when the look began (so no turn goes on one way past behind him without coming back);
//   - over the whole demo it never gets more than 200° from the heading the scene began with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

const DEG = 180 / Math.PI;

test('demos: every look and scan stays within 180° of where it began, and the demo within 200°, and a look reaches past 180°', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 };
    let T = 0, prev = null, unw = 0, lo = 0, hi = 0; const looks = [];
    for (const name of ['lookAround', 'scanSides', 'lookTo', 'shoulderLook']) {
      const f = g[name]?.bind(g); if (!f) continue;
      g[name] = async (...a) => { const l = { name, start: unw, lo: 0, hi: 0 }; looks.push(l); l.open = true; try { return await f(...a); } finally { l.open = false; } };
    }
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (let k = 0; k < 30 * 90 && !done; k++) {
      T += 1 / 30; g.tick(1 / 30, T);
      if (prev != null && k > 1) { // (the first ticks set the scene's own heading: not a look)
        const d = Math.atan2(Math.sin(g.yaw - prev), Math.cos(g.yaw - prev)) * DEG; unw += d;
        lo = Math.min(lo, unw); hi = Math.max(hi, unw);
      }
      prev = g.yaw;
      for (const l of looks) if (l.open) { l.lo = Math.min(l.lo, unw - l.start); l.hi = Math.max(l.hi, unw - l.start); }
      await new Promise(r => setImmediate(r));
    }
    assert.ok(done, `${sk.id}: the demo ends`);
    for (const l of looks) assert.ok(Math.max(l.hi, -l.lo) <= 180, `${sk.id}: ${l.name} turns ${l.lo.toFixed(0)}..${l.hi.toFixed(0)}° from where it began (at most 180 either side)`);
    assert.ok(Math.max(hi, -lo) <= 200, `${sk.id}: the view gets ${lo.toFixed(0)}..${hi.toFixed(0)}° from where the scene began (at most 200)`);
  }
});
