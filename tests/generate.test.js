// Generated "Look up" scenarios must be clean (one clear right answer) and play out realistically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLookUp, generate, grade, mainPattern } from '../js/generate.js';
import { PATH } from '../js/skills.js';
import { optionsFor, playOption, judge } from './harness.js';

test('the generator is repeatable and always produces a scenario', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const a = generateLookUp(seed), b = generateLookUp(seed);
    assert.ok(a, `seed ${seed} produced nothing`);
    assert.deepEqual(a, b);
    assert.equal(grade(a)[a.best], 'good');
  }
});

for (const sk of PATH) for (let seed = 1000; seed < 1006; seed++) {
  test(`${sk.id}: generated scenario ${seed} plays out realistically`, async () => {
    const sc = generate(sk.id, seed);
    assert.ok(sc, 'nothing generated');
    for (const opt of optionsFor(sc)) { const broken = judge(await playOption(sc, opt)); assert.deepEqual(broken, [], `${sc.id} ${opt}: ${broken.join('; ')}`); }
  });
}

test('every lesson makes every pattern, each with 3 defenders, 2 teammates, a right answer and a cue', () => {
  for (const sk of PATH) {
    const seen = new Set();
    for (let seed = 1; seed <= 120; seed++) {
      const sc = generate(sk.id, seed);
      assert.ok(sc, `${sk.id} ${seed}: nothing generated`);
      seen.add(sc.pattern);
      assert.equal(sc.opps.length, 3, `${sc.id}: ${sc.opps.length} defenders`);
      assert.equal(sc.mates.length, 2, `${sc.id}: ${sc.mates.length} teammates`);
      assert.ok(sc.best && sc.cue, `${sc.id}: no right answer or cue`);
      assert.ok(optionsFor(sc).includes(sc.best), `${sc.id}: right answer ${sc.best} is not an option`);
    }
    assert.ok(seen.size >= 2 || sk.id === 'give-and-go', `${sk.id}: only ${[...seen]}`);
  }
});

test('demos show each lesson\'s main idea, and tips never show a {name} placeholder', async () => {
  const { demoScenario } = await import('../js/skills.js');
  const { makeGame } = await import('./harness.js');
  for (const sk of PATH) {
    const sc = demoScenario(sk.id);
    if (sc.pattern) assert.equal(sc.pattern, mainPattern(sk.id), `${sk.id} demo is a contrast round (${sc.pattern})`);
    if (sc.best.startsWith('pass:')) assert.ok(sc.mates[+sc.best[5]][0] >= sc.heroTo[0], `${sk.id} demo passes backward`);
  }
  const { g } = makeGame();
  for (const sk of PATH) for (let seed = 1; seed < 40; seed++) {
    const sc = generate(sk.id, seed); g.sc = sc;
    assert.ok(!/\{m\d\}/.test(g.cue()), `${sc.id}: "${g.cue()}"`);
  }
});

test('take him on: with one defender in front, the right dribble cuts diagonally past him on his open side', () => {
  let n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const sc = generate('take-him-on', seed * 7919); if (sc.pattern !== 'trap-one') continue; n++;
    assert.ok(sc.best === 'drib:fl' || sc.best === 'drib:fr', `${sc.id}: best is ${sc.best}`);
    const o = sc.oppsTo.map(([x, y]) => ({ x, y })).sort((a, b) => Math.hypot(a.x - sc.heroTo[0], a.y - sc.heroTo[1]) - Math.hypot(b.x - sc.heroTo[0], b.y - sc.heroTo[1]))[0];
    const side = sc.best === 'drib:fl' ? 1 : -1, off = o.y - sc.heroTo[1];
    assert.ok(Math.abs(off) < .15 || Math.sign(off) !== side, `${sc.id}: cut toward the defender's side`);
    assert.ok(!(sc.ok || []).includes('drib:left') && !(sc.ok || []).includes('drib:right'), `${sc.id}: a sideways dribble counted as beating him`);
  }
  assert.ok(n > 50);
});

test('a dribble or push onto a friend only keeps the ball (2 stars): space means nobody there', () => {
  const sc = { heroTo: [10, 10], mates: [[13.2, 13.2], [4, 4]], opps: [[25, 4], [26, 16], [4, 16]] }; // friend right where the fl dribble ends
  const g = grade(sc);
  assert.equal(g['drib:fl'], 'safe'); assert.equal(g['push:fl'], 'safe');
  assert.equal(g['drib:fr'], 'good');
});

test('lesson rounds mix the other situations in from round 2 (never the same situation 3 times in a row)', async () => {
  const { sessionRounds } = await import('../js/skills.js');
  for (const sk of PATH) for (const opts of [{ first: true }, { level: 1 }, { level: 2 }]) {
    const pats = sessionRounds(sk.id, 6, opts).map(s => s.pattern);
    assert.equal(pats.length, 6, sk.id);
    if (new Set(pats).size > 1) assert.notEqual(pats[1], pats[0], `${sk.id}: round 2 repeats round 1 (${pats})`);
    for (let i = 2; i < 6; i++) assert.ok(!(pats[i] === pats[i - 1] && pats[i] === pats[i - 2]), `${sk.id}: ${pats}`);
  }
});

test('"space-friend": the friend stands right in front, so straight ahead only keeps it and the best goes around him', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const sc = generate('dribble-to-space', seed, { pattern: 'space-friend' }); if (!sc) continue;
    const h = sc.heroTo, front = sc.mates.find(m => m[0] > h[0] + 2.5 && Math.abs(m[1] - h[1]) < 1.6);
    assert.ok(front, `seed ${seed}: no friend in front`);
    assert.ok(!/fwd/.test(sc.best), sc.best);
    assert.ok(sc.safe.includes('drib:fwd'), `seed ${seed}: straight ahead should be 2 stars`);
    const away = front[1] > h[1] ? /fr|right/ : /fl|left/;
    assert.ok(away.test(sc.best), `seed ${seed}: ${sc.best} goes toward the friend`);
  }
});
