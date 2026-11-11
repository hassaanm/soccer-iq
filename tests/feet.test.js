// Which foot strikes the ball (game/outcomes.js pickFoot), and that a pass stops at the receiver's feet (sim.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFoot } from '../js/game/outcomes.js';
import { Sim } from '../js/sim.js';
import { PITCH } from '../js/geom.js';
import { allScenarios, PATH } from '../js/skills.js';
import { optionsFor, playOption } from './harness.js';

const { L, W } = PITCH, LEFT = 1, RIGHT = 0;
const at = (x, y, face = [1, 0]) => ({ x, y, face });

test('a shot from one side of the goal is struck with the foot on that side', () => {
  assert.equal(pickFoot(at(24, W / 2 + 3), L + .7, W / 2 + 1.2, 'shot'), LEFT);   // our attack: his left is +y
  assert.equal(pickFoot(at(24, W / 2 - 3), L + .7, W / 2 - 1.2, 'shot'), RIGHT);
  assert.equal(pickFoot(at(5, W / 2 - 3, [-1, 0]), -.7, W / 2 - 1.2, 'shot'), LEFT); // their attack, toward x = 0: his left is -y
  assert.equal(pickFoot(at(5, W / 2 + 3, [-1, 0]), -.7, W / 2 + 1.2, 'shot'), RIGHT);
});

test('a pass to his left uses the inside of the right foot, a pass to his right the left foot', () => {
  assert.equal(pickFoot(at(10, 10), 14, 15, 'pass'), RIGHT);
  assert.equal(pickFoot(at(10, 10), 14, 5, 'pass'), LEFT);
  assert.equal(pickFoot(at(10, 10, [0, 1]), 5, 12, 'pass'), RIGHT); // facing +y, the target at -x is to his left
});

test('straight on, he uses the foot farther from the nearest defender', () => {
  assert.equal(pickFoot(at(10, 10), 18, 10, 'pass', [{ x: 11, y: 11.5 }]), RIGHT); // defender on his left
  assert.equal(pickFoot(at(10, 10), 18, 10, 'pass', [{ x: 11, y: 8.5 }]), LEFT);
  assert.equal(pickFoot(at(24, W / 2 + .3), L + .7, W / 2 + .3, 'shot', [{ x: 25, y: W / 2 - 1 }]), LEFT);
});

test('windup keeps the foot, and a pass to a player stops a step in front of him', () => {
  const s = new Sim();
  s.setup({ hero: [10, 10], mates: [[18, 10]], opps: [] });
  s.windup('hero', 'pass', LEFT);
  assert.equal(s.a('hero').kickFoot, LEFT);
  s.kick(18, 10, { speed: 12 });
  assert.ok(Math.abs(s.ball.tx - 17.6) < 1e-9 && s.ball.ty === 10);
  s.setup({ hero: [10, 10], mates: [], opps: [] });
  s.kick(20, 12, { speed: 12 });                     // into space: it goes all the way
  assert.equal(s.ball.tx, 20);
});

test('across the lessons both feet strike, and the side follows the rule', async () => {
  const n = { L: 0, R: 0 }, side = { ok: 0, bad: 0 };
  const kick = Sim.prototype.kick;
  Sim.prototype.kick = function (x, y, o = {}) {
    const a = this.ball.carrier && this.a(this.ball.carrier);
    if (a && !o.touch && (a.kickFoot === 0 || a.kickFoot === 1)) {
      n[a.kickFoot ? 'L' : 'R']++;
      const fwd = a.team === 'us' ? 1 : -1, off = (a.y - W / 2) * fwd;
      if ((x > L - .5 || x < .5) && Math.abs(off) > .8) side[+(off > 0) === a.kickFoot ? 'ok' : 'bad']++;
    }
    return kick.call(this, x, y, o);
  };
  try {
    for (const sk of PATH.filter(s => s.ready).slice(0, 6)) for (const sc of allScenarios(sk.id).slice(0, 3)) for (const opt of optionsFor(sc)) await playOption(sc, opt);
  } finally { Sim.prototype.kick = kick; }
  const share = n.L / (n.L + n.R);
  assert.ok(n.L + n.R > 30 && share > .3 && share < .7, `left ${n.L}, right ${n.R}`);
  assert.equal(side.bad, 0);
});
