// Turning with the ball (sim.js): a foot moves the ball onto the new line, the turn takes time, and the ball never
// swings round him or slides to him without a foot on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, turnFoot } from '../js/sim.js';

const DT = 1 / 60, deg = Math.PI / 180;
// He dribbles up the field (+x), then at `at` seconds runs off `turn` degrees to his left (minus: right).
// Returns what happened each step from the turn on.
function turnRun(turn, { speed = 4.4, at = 1.7, opp = null, go = 9 } = {}) {
  const s = new Sim(); s.setup({ hero: [4, 10], mates: [], opps: opp ? [opp] : [] });
  const h = s.a('hero'), out = []; let t0 = null;
  s.go('hero', 28, 10, speed);
  for (let k = 0; k < 60 * 4; k++) {
    if (t0 == null && s.time >= at) { t0 = s.time; s.go('hero', h.x + go * Math.cos(turn * deg), h.y + go * Math.sin(turn * deg), speed); }
    const b = s.ball, rx = b.x - h.x, ry = b.y - h.y, wx = b.x, wy = b.y;
    s.step(DT);
    if (t0 == null) continue;
    const f = Math.atan2(h.face[1], h.face[0]), bx = b.x - h.x, by = b.y - h.y, tf = turnFoot(s, 'hero');
    out.push({ t: s.time - t0, k: b.move?.k, jump: Math.hypot(bx - rx, by - ry), vx: b.x - wx, vy: b.y - wy, face: f, h: b.h,
      ahead: bx * Math.cos(f) + by * Math.sin(f), left: by * Math.cos(f) - bx * Math.sin(f), foot: tf && { ...tf } });
  }
  return out;
}
const kindOf = run => run.find(r => r.k)?.k;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

test('the move is picked by the size of the turn', () => {
  assert.equal(kindOf(turnRun(30)), 'push');
  assert.equal(kindOf(turnRun(-90)), 'cut');
  assert.equal(kindOf(turnRun(170)), 'hook');
  // a defender close in front: he pulls the ball back away from him
  assert.equal(kindOf(turnRun(180, { opp: [13, 10.3] })), 'pull');
});

test('while carried, the ball never jumps: at most 12 cm a step (60 a second) next to him', () => {
  for (const turn of [30, -30, 60, -60, 90, -90, 135, -135, 180, -170]) for (const speed of [2, 4.4]) for (const opp of [null, [13, 10.3]]) {
    const run = turnRun(turn, { speed, opp }), worst = Math.max(...run.map(r => r.jump));
    assert.ok(worst < .12, `turn ${turn}° at ${speed} m/s: ${worst.toFixed(3)} m in one step`);
  }
});

test('a big turn takes time, and he ends facing the new way with the ball in front of him', () => {
  for (const [turn, opp] of [[180, null], [180, [13, 10.3]], [-150, null], [100, null]]) {
    const run = turnRun(turn, { opp }), want = turn * deg;
    const done = run.find(r => !r.k && Math.abs(wrap(r.h - want)) < .05);
    assert.ok(done, `turn ${turn}°: the ball reaches the new line`);
    if (Math.abs(turn) >= 150) assert.ok(done.t > .45 && done.t < .9, `turn ${turn}°: took ${done.t.toFixed(2)} s`);
    const end = run.find(r => r.t > done.t + .1);
    assert.ok(Math.abs(wrap(end.face - want)) < .1, `turn ${turn}°: faces the new way`);
    assert.ok(end.ahead > .25 && Math.abs(end.left) < .15, `turn ${turn}°: ball ${end.ahead.toFixed(2)} ahead, ${end.left.toFixed(2)} to the side`);
  }
});

test('the ball only changes direction with a foot on it', () => {
  let bends = 0;
  for (const [turn, opp] of [[60, null], [-90, null], [170, null], [180, [13, 10.3]], [-150, [13, 9.7]]]) {
    const run = turnRun(turn, { speed: 2, opp }).filter(r => r.k); // the ball's path over the grass during the turn
    for (let i = 1; i < run.length; i++) {
      const p = run[i - 1], q = run[i], sp = Math.hypot(p.vx, p.vy), sq = Math.hypot(q.vx, q.vy);
      if (sp * 60 < .4 || sq * 60 < .4) continue;
      const bend = Math.abs(wrap(Math.atan2(q.vy, q.vx) - Math.atan2(p.vy, p.vx)));
      if (bend > .25) { bends++; assert.ok(q.foot && q.foot.w > .5, `turn ${turn}°: the ball bends ${(bend / deg).toFixed(0)}° at ${q.t.toFixed(2)} s with no foot on it`); }
    }
  }
  assert.ok(bends >= 5, `only ${bends} bends were checked`);
});

test('both feet work: the pull back drags with one foot and takes it on with the other, and cuts change foot', () => {
  const legs = run => new Set(run.filter(r => r.foot && r.foot.w > .9).map(r => r.foot.leg));
  assert.deepEqual([...legs(turnRun(180, { opp: [13, 10.3] }))].sort(), [0, 1]);
  const pull = turnRun(180, { opp: [13, 10.3] }).filter(r => r.foot && r.foot.w > .9).map(r => r.foot.part);
  assert.ok(pull.includes('sole') && pull.includes('inside'));
  const cutFeet = new Set([1.7, 1.86].map(at => turnRun(90, { at }).find(r => r.foot && r.foot.w > .9).foot.leg));
  assert.equal(cutFeet.size, 2, 'a cut a step later is made with the other foot');
});

test('taking a pass and turning at once is one move: the first touch turns him', () => {
  const s = new Sim(); s.setup({ hero: [10, 10], mates: [[17, 10]], opps: [] });
  const h = s.a('hero'); Object.assign(s.ball, { x: 16.6, y: 10 }); s.give('m1'); h.face = [1, 0];
  s.open('hero', 2, 10); s.kick(10, 10, { speed: 11, arc: .15 });
  for (let k = 0; k < 120 && s.ball.state === 'flying'; k++) s.step(DT);
  const opened = Math.atan2(h.face[1], h.face[0]);
  assert.ok(Math.abs(opened) > .3, 'he opens his body toward where he will go as the ball comes');
  s.give('hero'); s.go('hero', 2, 10, 5.2); s.step(DT);
  assert.equal(s.ball.move?.k, 'first');
  for (let k = 0; k < 60; k++) s.step(DT);
  const f = Math.atan2(h.face[1], h.face[0]), ahead = (s.ball.x - h.x) * Math.cos(f) + (s.ball.y - h.y) * Math.sin(f);
  assert.ok(Math.abs(wrap(f - Math.PI)) < .1 && ahead > .25 && h.x < 10, 'a second later he runs the other way with the ball in front');
});

test('a ball given out of his reach stays put until he gets to it', () => {
  const s = new Sim(); s.setup({ hero: [10, 10], mates: [], opps: [[12, 10]] });
  Object.assign(s.ball, { state: 'loose', carrier: null, x: 11.1, y: 10 });
  const o = s.a('o1'); s.give('o1'); s.go('o1', 18, 10, 4);
  const b = s.ball, x0 = b.x;
  for (let k = 0; k < 30 && b.reach; k++) { s.step(DT); if (b.reach) assert.equal(b.x, x0); }
  assert.ok(!b.reach && Math.hypot(b.x - o.x, b.y - o.y) < .8, 'he reached it');
});

test('turning his body on the spot leaves the ball where it is', () => {
  const s = new Sim(); s.setup({ hero: [10, 10], mates: [], opps: [] });
  for (let k = 0; k < 30; k++) s.step(DT);
  const b = s.ball, x = b.x, y = b.y, h = s.a('hero'); h.face = [0, 1];
  for (let k = 0; k < 30; k++) s.step(DT);
  assert.ok(Math.hypot(b.x - x, b.y - y) < .01, 'the ball did not swing round him');
  assert.ok(s.turn('hero', 10, 14) > .3 && s.ball.move, 'turning with it is a move');
});
