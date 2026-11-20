// (v76 SL) Never two of ours on their player with the ball (the live audit's twoball, scripts/live-audit.js): a second
// one of ours close to him steps off instead of going in too (outcomes.js stepIn, team.js otherOnBall/stepOff).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './harness.js';

function scene(g, us, carrier) {
  g.mode = 'free'; g.sim.setup({ hero: us[0], mates: us.slice(1), opps: [carrier, [20, 3], [20, 17]], carrier: 'o1' }); g.scripted = new Set(); g.phase = 'outcome';
  return g.sim;
}
test('as their player plays it away, only the nearest of ours goes in; a second one close by steps off it', () => {
  const { g } = makeGame(), s = scene(g, [[10.9, 10], [9.2, 10.6], [5, 5]], [10, 10]);
  g.stepIn(s.a('o1'));
  const near = s.a('hero'), far = s.a('m1');
  assert.ok(near.tk === s.time && near.beat > s.time, 'the nearest goes in');
  assert.ok(!(far.beat > s.time), 'the other does not');
  assert.ok(Math.hypot(far.tx - s.ball.x, far.ty - s.ball.y) >= 2.5, 'he steps off, out to 2.6 m');
});
