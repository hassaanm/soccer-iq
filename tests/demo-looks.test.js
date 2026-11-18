// (v76) The "Watch" demos, at the size being played (SOCCER_SIZE): a look has a reason, and the demo has its own clock.
//   - Only "Look up!" looks left and right (looking around is that lesson); the shot demos glance at the goal; every
//     other look turns his head only to something the lesson is about that is not on the screen yet.
//   - The idea is said while play crawls on (never still: in every quarter second of it play moves on; over it the one who
//     comes gets nearer) with the ring full; then the hand's choice lands with 40% to 60% of the ring left, the one who
//     comes still on his way (more than 1.2 m off the ball; one who jockeys, 0.9 m), and the play moves on at once after it.
// The owner (v75): a look left and right in front of the goal for nothing; the ring empty and the defender standing at
// the ball long before the hand tapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

test('demos: a look only with a reason, and the choice with about half the ring left', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); let T = 0, scans = 0, glances = 0, chose = null, crawl = 0, still = [], q0 = null, d0 = null, dEnd = null, moved = null, last = null;
    const la = g.lookAround.bind(g); g.lookAround = (...a) => { scans++; return la(...a); };
    const gg = g.glanceAtGoal.bind(g); g.glanceAtGoal = (...a) => { glances++; return gg(...a); };
    const oc = g.outcome.bind(g);
    g.outcome = (opt, good) => { if (!chose && g.win) { const w = g.win, th = w.threat?.id && g.sim.a(w.threat.id), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : g.sim.ball;
      const u = Math.min(1, w.u || 0), u0 = w.demo?.u0 ?? 0; // (the ring as it shows: demo.js showClock)
      chose = { left: w.demo ? 1 - (u - u0) / (1 - u0) : 1 - u, d: th ? Math.hypot(th.x - to.x, th.y - to.y) : null, jock: !!w.jock, T }; } return oc(opt, good); };
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (let k = 0; k < 30 * 90 && !done; k++) {
      T += 1 / 30; g.tick(1 / 30, T);
      const w = g.win;
      if (w?.demo?.crawl != null) { // the idea being said: every quarter second, play has moved on and the one who comes is nearer
        crawl += 1 / 30; const th = w.threat?.id && g.sim.a(w.threat.id), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : g.sim.ball;
        const q = { t: g.sim.time, d: th ? Math.hypot(th.x - to.x, th.y - to.y) : null, at: [...g.sim.agents.values()].map(a => [a.x, a.y]), T };
        if (!q0) q0 = d0 = q; else if (T - q0.T >= .25) { if (!(q.t > q0.t) || !q.at.some((p, i) => Math.hypot(p[0] - q0.at[i][0], p[1] - q0.at[i][1]) > .005)) still.push(`${T.toFixed(2)} s`); q0 = q; }
        dEnd = q;
        assert.ok(g.ui.timer?.left == null || g.ui.timer.left === 1, `${sk.id}: the ring stays full while the idea is said`);
      } else if (q0) { if (d0.d != null) assert.ok(dEnd.d < d0.d - .2, `${sk.id}: the one who comes gets nearer while the idea is said (${d0.d.toFixed(2)} → ${dEnd.d.toFixed(2)} m)`); q0 = null; }
      const b = g.sim.ball, h = g.sim.a('hero');
      if (chose && moved == null && last) { const v = Math.max(Math.hypot(b.x - last[0], b.y - last[1]), Math.hypot(h.x - last[2], h.y - last[3])) * 30; if (v > 1.5) moved = T - chose.T; }
      last = [b.x, b.y, h.x, h.y];
      await new Promise(r => setImmediate(r));
    }
    assert.ok(done, `${sk.id}: the demo ends`);
    assert.equal(scans > 0, sk.id === 'look-up', `${sk.id}: looks left and right ${scans} time(s); only "Look up!" does`);
    if (g.sc.best?.startsWith('shoot')) assert.ok(glances > 0, `${sk.id}: a glance at the goal before the shot`);
    if (g.sc.kind === 'tackle') continue; // (the 1v1 steal has no window: he taps as the ball rolls loose)
    assert.ok(crawl > 2, `${sk.id}: the idea is said while play crawls on (${crawl.toFixed(1)} s)`);
    assert.deepEqual(still, [], `${sk.id}: play stood still while the idea was said, at`);
    assert.ok(chose, `${sk.id}: the demo chooses in a window`);
    assert.ok(chose.left >= .4 && chose.left <= .6, `${sk.id}: the choice lands with ${(chose.left * 100).toFixed(0)}% of the ring left (40–60%)`);
    // (one who jockeys, already on him by the scene's idea, works his way in from about 1.6 m to 0.9 m and lunges only as the ring empties)
    if (chose.d != null) assert.ok(chose.d > (chose.jock ? .9 : 1.2), `${sk.id}: the one who comes is still on his way as the hand taps (${chose.d.toFixed(2)} m from the ball${chose.jock ? ', jockeying' : ''})`);
    if (sk.id !== 'take-him-on') assert.ok(moved != null && moved < .6, `${sk.id}: play moves on at once after the choice (${moved?.toFixed(2)} s)`); // ("Take him on!": the skill move's own explained pause, game/skill.js)
  }
});
