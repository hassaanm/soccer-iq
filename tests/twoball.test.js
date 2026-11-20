// (v76 SL) Never two of ours on their player with the ball (the live audit's twoball, scripts/live-audit.js): a second
// one of ours close to him steps off instead of going in too (outcomes.js stepIn, team.js otherOnBall/stepOff), and one
// of ours a play's script has sent to the ball takes over from the one the team's shape had pressing (team.js defend).
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
test('one of ours the play sends to the ball takes over: the one pressing is given another job', () => {
  const { g } = makeGame(), s = scene(g, [[15, 10], [12.2, 10.4], [12, 15]], [10, 10]);
  g.ai = true; g.teamAI(); const pid = Object.keys(g.roles.jobs).find(id => g.roles.jobs[id] === 'press'); assert.equal(pid, 'm1', 'm1 presses');
  g.scripted.add('hero'); s.a('hero').x = 11.4; s.a('hero').y = 9.4; // (the play has sent his own player in at the ball)
  for (let i = 0; i < 3; i++) { s.time += .1; g.teamAI(); }
  assert.notEqual(g.roles.jobs.m1, 'press', 'm1 leaves the ball to him');
});
