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
