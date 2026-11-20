// (v76 SL) After a demo's idea, until the hand's choice, the picture keeps moving. Play crawls on toward the choice (the
// demo's clock: half the ring left as the hand taps), so for 2 to 4 s the picture hardly changed in several demos
// (shoot-close, shoot-space, lead-pass, get-goal-side, pass-to-open, see-the-trap, take-him-on, follow-shot: a mean
// change of 1.5 to 3.8 per half second against 10 to 14 during the idea; the owner read it as a freeze). Now the view
// goes on coming in toward him, evenly, until the choice (game/view.js CLOSE, demo.js `push.close`): in every half
// second from the idea's end to the choice the camera moves (MOVE m or more, eye and target together) or a player does
// (RUN m or more). (v76 SL, review: level, toward his player, keeping on the screen what is on it: game/view.js pushKeep.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

const MOVE = .03, RUN = .15; // (a half second is still when the view moves less than MOVE m and nobody on the pitch more than RUN m: 0.3 m/s)
test('every half second of a demo after its idea moves: the view comes in until the choice', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); let chose = false, crawl = false, last = null, f = 0; const still = [];
    const oc = g.outcome.bind(g); g.outcome = (o, good) => { chose = true; return oc(o, good); };
    let low = 99, near = 99; // (the eye's lowest height, and its least distance to his player's middle, after the idea)
    let scan = 0; const la = g.lookAround.bind(g); g.lookAround = async (...a) => { scan++; try { return await la(...a); } finally { scan--; } }; // (a look left and right in a view from above that frames the rings holds the view still while his head turns, as before v76: not counted)
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (; f < 30 * 120 && !done && !chose; f++) {
      g.tick(1 / 30, f / 30); await null; const w = g.win; if (w?.demo?.crawl != null) crawl = true;
      if (!crawl || !w || w.demo?.crawl != null || !g.cam || f % 15) continue;
      { const h = g.sim.a('hero'), e = g.cam.eye; low = Math.min(low, e[2]); if (h) near = Math.min(near, Math.hypot(e[0] - h.x, e[1] - h.y, e[2] - .9)); }
      const at = [...g.cam.eye, ...g.cam.tgt], ps = [...g.sim.agents.values()].map(a => [a.x, a.y]);
      if (last) { const m = Math.hypot(...at.slice(0, 3).map((v, i) => v - last.at[i])) + Math.hypot(...at.slice(3).map((v, i) => v - last.at[i + 3])), run = Math.max(...ps.map((p, i) => Math.hypot(p[0] - last.ps[i][0], p[1] - last.ps[i][1])));
        if (m < MOVE && run < RUN && !scan && !last.scan) still.push(`${(f / 30).toFixed(1)} s: view ${m.toFixed(3)} m, players ${run.toFixed(2)} m`); }
      last = { at, ps, scan };
    }
    assert.ok(crawl || sk.id === 'steal-it', `${sk.id}: its idea was said`); // ("Steal it!": no window, the play is his tackle)
    assert.deepEqual(still, [], `${sk.id}: half seconds with the view still after the idea`);
    assert.ok(low >= 2 && near >= 2.4, `${sk.id}: the view comes in level, never down to the grass (eye ${low.toFixed(2)} m high, ${near.toFixed(2)} m from him)`); // (review: v91's push went down the line to a far target in a scan, to 0.07 m)
  }
});
