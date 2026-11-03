// Generated "Look up" scenarios must be clean (one clear right answer) and play out realistically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLookUp, generate, grade } from '../js/generate.js';
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
    assert.ok(seen.size >= 2 || sk.id === 'mark-the-free-one', `${sk.id}: only ${[...seen]}`);
  }
});
