// (v76) The "Watch" demos, at the size being played (SOCCER_SIZE): a look has a reason, and the demo has its own clock.
//   - Only "Look up!" looks left and right (looking around is that lesson); the shot demos glance at the goal; every
//     other look turns his head only to something the lesson is about that is not on the screen yet.
//   - The idea is said while play holds still on the picture the choice opens on; then, in the window, the hand's choice
//     lands with 40% to 60% of the ring left, the one who comes still on his way (not at the ball), and the play moves
//     on at once after it.
// The owner (v75): a look left and right in front of the goal for nothing; the ring empty and the defender standing at
// the ball long before the hand tapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

test('demos: a look only with a reason, and the choice with about half the ring left', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); let T = 0, scans = 0, glances = 0, chose = null, heldBefore = 0, moved = null, last = null;
    const la = g.lookAround.bind(g); g.lookAround = (...a) => { scans++; return la(...a); };
    const gg = g.glanceAtGoal.bind(g); g.glanceAtGoal = (...a) => { glances++; return gg(...a); };
    const oc = g.outcome.bind(g);
    g.outcome = (opt, good) => { if (!chose && g.win) { const w = g.win, th = w.threat?.id && g.sim.a(w.threat.id), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : g.sim.ball;
      chose = { left: 1 - Math.min(1, w.u || 0), d: th ? Math.hypot(th.x - to.x, th.y - to.y) : null, T }; } return oc(opt, good); };
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (let k = 0; k < 30 * 90 && !done; k++) {
      T += 1 / 30; g.tick(1 / 30, T);
      if (g.held) heldBefore += 1 / 30;
      const b = g.sim.ball, h = g.sim.a('hero');
      if (chose && moved == null && last) { const v = Math.max(Math.hypot(b.x - last[0], b.y - last[1]), Math.hypot(h.x - last[2], h.y - last[3])) * 30; if (v > 1.5) moved = T - chose.T; }
      last = [b.x, b.y, h.x, h.y];
      await new Promise(r => setImmediate(r));
    }
    assert.ok(done, `${sk.id}: the demo ends`);
    assert.equal(scans > 0, sk.id === 'look-up', `${sk.id}: looks left and right ${scans} time(s); only "Look up!" does`);
    if (g.sc.best?.startsWith('shoot')) assert.ok(glances > 0, `${sk.id}: a glance at the goal before the shot`);
    assert.ok(heldBefore > 2, `${sk.id}: the idea is said while play holds still (${heldBefore.toFixed(1)} s)`);
    if (g.sc.kind === 'tackle') continue; // (the 1v1 steal has no window: he taps as the ball rolls loose)
    assert.ok(chose, `${sk.id}: the demo chooses in a window`);
    assert.ok(chose.left >= .4 && chose.left <= .6, `${sk.id}: the choice lands with ${(chose.left * 100).toFixed(0)}% of the ring left (40–60%)`);
    if (chose.d != null) assert.ok(chose.d > 1.2, `${sk.id}: the one who comes is still on his way as the hand taps (${chose.d.toFixed(2)} m from the ball)`);
    if (sk.id !== 'take-him-on') assert.ok(moved != null && moved < .6, `${sk.id}: play moves on at once after the choice (${moved?.toFixed(2)} s)`); // ("Take him on!": the skill move's own explained pause, game/skill.js)
  }
});
