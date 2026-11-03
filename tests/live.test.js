// Mini-match realism: in live play, a good choice never loses the ball, and a wrong pass is lost to a defender
// who really gets there (in the lane or on the receiver), never one standing behind him or meters away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, drive } from './harness.js';

async function playMatches(n, pick) {
  const out = { goodLost: 0, steals: 0, fromBehind: 0 };
  for (let k = 0; k < n; k++) {
    const { g, events } = makeGame(); let from = null, recv = null, pending = null;
    const passBad = g.passBad.bind(g), steal = g.steal.bind(g);
    g.passBad = function* (id) { from = { x: g.sim.ball.x, y: g.sim.ball.y }; recv = id; yield* passBad(id); };
    g.steal = function* (opp) {
      if (recv) {
        const r = g.sim.a(recv), behind = (opp.x - r.x) * (from.x - r.x) + (opp.y - r.y) * (from.y - r.y) < 0;
        out.steals++; if (behind && Math.hypot(opp.x - r.x, opp.y - r.y) > 1.2) out.fromBehind++;
      }
      recv = null; yield* steal(opp);
    };
    const check = () => { if (pending != null && events.slice(pending).some(e => e[0] === 'banner' && e[1] === 'Stolen!')) out.goodLost++; pending = null; };
    await drive(g, g.match(['look-up', 'pass-to-open'], [], 3, 'free'), { maxSec: 900, pick: gm => {
      check();
      if (gm.sc.kind === 'defense') return gm.sc.best || 'spot:' + gm.sc.spots[0].id;
      const o = pick(gm); if (gm.rating(o) !== 'bad') pending = events.length; return o;
    } });
    check();
  }
  return out;
}

test('live play: good choices keep the ball', async () => {
  const r = await playMatches(4, gm => ['pass:0', 'pass:1'].find(o => gm.rating(o) !== 'bad') || gm.sc.best || 'drib:back');
  assert.equal(r.goodLost, 0);
});
test('live play: wrong passes are never stolen from behind the receiver', async () => {
  const r = await playMatches(4, gm => ['pass:0', 'pass:1'].find(o => gm.rating(o) === 'bad') || gm.sc.best || 'drib:back');
  assert.ok(r.steals > 10, `only ${r.steals} wrong passes were played`);
  assert.equal(r.fromBehind, 0);
});
