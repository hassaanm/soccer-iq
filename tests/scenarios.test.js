import test from 'node:test';
import assert from 'node:assert/strict';
import { allScenarios, pickRounds, PITCH, PATH } from '../js/skills.js';
import { interceptor, dribbleEnd, closestOnLane } from '../js/geom.js';

const pt = ([x, y]) => ({ x, y });
// Positions at the freeze, matching what the game builds (ball half a meter in front of the hero).
function frozen(sc) {
  const hero = pt(sc.heroTo);
  return { hero, ball: { x: hero.x + 0.5, y: hero.y },
    opps: sc.opps.map((p, i) => pt((sc.oppsTo || [])[i] || p)), mates: sc.mates.map(pt) };
}

for (const sk of PATH.filter(s => s.ready)) {
  for (const sc of allScenarios(sk.id)) {
    test(`${sc.id}: good passes are open and bad passes are cut out`, () => {
      const s = frozen(sc), good = new Set([sc.best, ...(sc.ok || [])]);
      s.mates.forEach((m, i) => {
        const ic = interceptor(s.ball, m, s.opps);
        if (good.has(`pass:${i}`)) assert.ok(ic.d > 0.9, `pass:${i} lane blocked (${ic.d.toFixed(2)} m)`);
        else assert.ok(ic.d < 1.0, `pass:${i} should be blocked but nearest defender is ${ic.d.toFixed(2)} m away`);
      });
    });
    if (sc.best.startsWith('drib:')) test(`${sc.id}: best dribble path is clear`, () => {
      const s = frozen(sc), end = dribbleEnd(s.hero, sc.best.slice(5), PITCH.L, PITCH.W);
      for (const o of s.opps) assert.ok(closestOnLane(o, s.hero, end, 0).d > 1.5);
    });
    test(`${sc.id}: positions are on the pitch`, () => {
      for (const p of [sc.hero, sc.heroTo, ...sc.mates, ...sc.opps, ...(sc.oppsTo || []).filter(Boolean)])
        assert.ok(p[0] >= 0 && p[0] <= PITCH.L && p[1] >= 0 && p[1] <= PITCH.W, `${p} off the pitch`);
    });
  }
}

test('pickRounds never repeats a scenario back to back', () => {
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const rounds = pickRounds(['look-up'], 8, rnd);
  assert.equal(rounds.length, 8);
  for (let i = 1; i < rounds.length; i++) assert.notEqual(rounds[i].id.replace(/m$/, ''), rounds[i - 1].id.replace(/m$/, ''));
});
