// Generated "Look up" scenarios must be clean (one clear right answer) and play out realistically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLookUp, grade } from '../js/generate.js';
import { OPTIONS, playOption, judge } from './harness.js';

test('the generator is repeatable and always produces a scenario', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const a = generateLookUp(seed), b = generateLookUp(seed);
    assert.ok(a, `seed ${seed} produced nothing`);
    assert.deepEqual(a, b);
    assert.equal(grade(a)[a.best], 'good');
  }
});

for (let seed = 1000; seed < 1030; seed++) {
  test(`generated scenario ${seed} plays out realistically`, async () => {
    const sc = generateLookUp(seed);
    for (const opt of OPTIONS) { const broken = judge(await playOption(sc, opt)); assert.deepEqual(broken, [], `${sc.id} ${opt}: ${broken.join('; ')}`); }
  });
}
