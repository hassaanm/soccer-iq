// (v76) The "Watch" demos, at the size being played (SOCCER_SIZE): a look has a reason, and the demo has its own clock.
//   - (v78) A scan only with a reason (demo.js scanWhy): "Look up and scan!", friends on both sides, finding space off
//     the ball; a look over the shoulder when the one who comes is behind him; the shot demos glance at the goal; every
//     other look turns his head only to something the lesson is about that is not on the screen yet.
//   - The idea is said while play crawls on (never still: in every quarter second of it play moves on; over it the one who
//     comes gets nearer), the ring draining slowly and steadily (not still: the owner, v76: a full ring that does not change
//     looked wrong), and then on with no jump in its pace; then the hand's choice lands with 40% to 60% of the ring left, the one who
//     comes still on his way (more than 1.2 m off the ball; one who jockeys, 0.9 m), and the play moves on at once after it.
// The owner (v75): a look left and right in front of the goal for nothing; the ring empty and the defender standing at
// the ball long before the hand tapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';
import { pathAt } from '../js/window.js';

test('demos: a look only with a reason, and the choice with about half the ring left', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); let T = 0, scans = 0, glances = 0, chose = null, crawl = 0, still = [], ring = [], q0 = null, d0 = null, dEnd = null, moved = null, last = null;
    const la = g.lookAround.bind(g); g.lookAround = (...a) => { scans++; return la(...a); };
    let backs = 0, why, behind = null; // (v78: a look over the shoulder; why the demo scans; the one who comes behind him as the window opens, measured here)
    if (g.shoulderLook) { const sl = g.shoulderLook.bind(g); g.shoulderLook = (...a) => { backs++; return sl(...a); }; const sw = g.scanWhy.bind(g); g.scanWhy = (...a) => { const r = sw(...a); if (why === undefined) why = r; return r; }; }
    const gg = g.glanceAtGoal.bind(g); g.glanceAtGoal = (...a) => { glances++; return gg(...a); };
    const oc = g.outcome.bind(g);
    g.outcome = (opt, good) => { if (!chose && g.win) { const w = g.win, th = w.threat?.id && g.sim.a(w.threat.id), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : g.sim.ball;
      chose = { left: g.timerUi()?.left ?? 1 - Math.min(1, w.u || 0), // (the ring as it shows: game/window.js timerUi)
        d: th ? Math.hypot(th.x - to.x, th.y - to.y) : null, jock: !!w.jock, T }; } return oc(opt, good); };
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (let k = 0; k < 30 * 90 && !done; k++) {
      T += 1 / 30; g.tick(1 / 30, T);
      const w = g.win;
      if (w && behind == null && g.sim.ball.carrier === 'hero') { const h = g.sim.a('hero'), t = w.threat?.id && g.sim.a(w.threat.id), q = pathAt(w.plan.paths.hero, 0), run = Math.hypot(q.vx, q.vy) > .4 ? Math.atan2(q.vy, q.vx) : g.yaw, a = t ? Math.atan2(t.y - h.y, t.x - h.x) - run : 0; behind = !!t && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 2; }
      if (w?.demo?.crawl != null) { // the idea being said: every quarter second, play has moved on and the one who comes is nearer
        crawl += 1 / 30; const th = w.threat?.id && g.sim.a(w.threat.id), to = w.threat?.to ? { x: w.threat.to[0], y: w.threat.to[1] } : g.sim.ball;
        const q = { t: g.sim.time, d: th ? Math.hypot(th.x - to.x, th.y - to.y) : null, at: [...g.sim.agents.values()].map(a => [a.x, a.y]), T };
        if (!q0) q0 = d0 = q; else if (T - q0.T >= .25) { if (!(q.t > q0.t) || !q.at.some((p, i) => Math.hypot(p[0] - q0.at[i][0], p[1] - q0.at[i][1]) > .005)) still.push(`${T.toFixed(2)} s`); q0 = q; }
        dEnd = q;
        const L = g.timerUi()?.left; if (L != null) ring.push({ T, L, crawl: true });
      } else if (w && !chose && g.timerUi()?.left != null) ring.push({ T, L: g.timerUi().left, crawl: false });
      if (!w?.demo?.crawl && q0) { if (d0.d != null) assert.ok(dEnd.d < d0.d - .2, `${sk.id}: the one who comes gets nearer while the idea is said (${d0.d.toFixed(2)} → ${dEnd.d.toFixed(2)} m)`); q0 = null; }
      const b = g.sim.ball, h = g.sim.a('hero');
      if (chose && moved == null && last) { const v = Math.max(Math.hypot(b.x - last[0], b.y - last[1]), Math.hypot(h.x - last[2], h.y - last[3])) * 30; if (v > 1.5) moved = T - chose.T; }
      last = [b.x, b.y, h.x, h.y];
      await new Promise(r => setImmediate(r));
    }
    assert.ok(done, `${sk.id}: the demo ends`);
    // (v78) A scan with a reason (demo.js scanWhy): "Look up and scan!" itself; friends on both sides; off the ball, finding
    // space (not running at the goal). A look over the shoulder whenever the one who comes is behind him (measured here: more
    // than 115° off his run as the window opens), unless "Look up and scan!"'s own look goes round to him. A shot: one glance.
    const shot = !!g.sc.best?.startsWith('shoot'), wantScan = sk.id === 'look-up' || why === 'both' || why === 'around';
    assert.equal(scans > 0, wantScan, `${sk.id}: looks left and right ${scans} time(s) (${why || 'no reason'})`);
    if (behind && !shot && sk.id !== 'look-up') assert.ok(backs > 0, `${sk.id}: the one who comes is behind him, and he never looks over his shoulder`);
    assert.equal(backs > 0, why === 'shoulder' && sk.id !== 'look-up', `${sk.id}: looks over his shoulder ${backs} time(s) (${why || 'no reason'})`);
    if (shot) { assert.ok(glances > 0, `${sk.id}: a glance at the goal before the shot`); assert.equal(scans + backs, 0, `${sk.id}: no scan before a clear shot`); }
    if (g.sc.run === 'goal') assert.equal(scans, 0, `${sk.id}: no scan running at the goal`);
    if (g.sc.kind === 'tackle') continue; // (the 1v1 steal has no window: he taps as the ball rolls loose)
    assert.ok(crawl > 2, `${sk.id}: the idea is said while play crawls on (${crawl.toFixed(1)} s)`);
    assert.deepEqual(still, [], `${sk.id}: play stood still while the idea was said, at`);
    // the ring: every half second of the idea it drains a little (never still, never fast); by the idea's end 8% to 30% is
    // gone; after it, no half second drains more than three times the idea's own pace
    const rate = (a, b) => (a.L - b.L) / (b.T - a.T), cr = ring.filter(r => r.crawl), af = ring.filter(r => !r.crawl), half = l => l.filter((r, i) => i % 15 === 0);
    const hc = half(cr), rc = hc.slice(1).map((r, i) => rate(hc[i], r)), ha = half(af), ra = ha.slice(1).map((r, i) => rate(ha[i], r)), med = rc.length ? [...rc].sort((p, q) => p - q)[rc.length >> 1] : 0;
    assert.ok(rc.length > 3 && rc.every(v => v > .005 && v < .12), `${sk.id}: the ring drains slowly and steadily while the idea is said (${rc.map(v => v.toFixed(3)).join(' ')} a second)`);
    const gone = 1 - cr.at(-1).L; assert.ok(gone > .08 && gone < .3, `${sk.id}: ${(gone * 100).toFixed(0)}% of the ring gone as the idea ends (8–30%)`);
    assert.ok(ra.every(v => v < 3 * med + .01), `${sk.id}: after the idea the ring drains no faster than three times its pace before (${med.toFixed(3)}; ${ra.map(v => v.toFixed(3)).join(' ')})`);
    // (v78) and on the whole at the pace it had: from the idea's end to the choice, within 1.3 times its pace while the idea was said
    { const rc0 = rate(cr[0], cr.at(-1)), ra0 = af.length > 2 ? rate(af[0], af.at(-1)) : rc0; assert.ok(Math.max(ra0 / rc0, rc0 / ra0) <= 1.3, `${sk.id}: the ring's pace goes from ${(rc0 * 100).toFixed(1)}% to ${(ra0 * 100).toFixed(1)}% a second as the idea ends (1.3 times at most)`); }
    assert.ok(chose, `${sk.id}: the demo chooses in a window`);
    assert.ok(chose.left >= .4 && chose.left <= .6, `${sk.id}: the choice lands with ${(chose.left * 100).toFixed(0)}% of the ring left (40–60%)`);
    // (one who jockeys, already on him by the scene's idea, works his way in from about 1.6 m to 0.9 m and lunges only as the ring empties)
    if (chose.d != null) assert.ok(chose.d > (chose.jock ? .9 : 1.2), `${sk.id}: the one who comes is still on his way as the hand taps (${chose.d.toFixed(2)} m from the ball${chose.jock ? ', jockeying' : ''})`);
    if (sk.id !== 'take-him-on') assert.ok(moved != null && moved < .6, `${sk.id}: play moves on at once after the choice (${moved?.toFixed(2)} s)`); // ("Take him on!": the skill move's own explained pause, game/skill.js)
  }
});
