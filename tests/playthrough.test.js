// Every scenario × every option must play out like real soccer (see judge() in harness.js).
// Run `npm run audit` for the same checks as a readable table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH, allScenarios } from '../js/skills.js';
import { OPTIONS, playOption, judge } from './harness.js';

for (const sk of PATH.filter(s => s.ready)) for (const sc of allScenarios(sk.id)) for (const opt of OPTIONS) {
  test(`${sc.id} ${opt}`, async () => {
    const r = await playOption(sc, opt), broken = judge(r);
    assert.deepEqual(broken, [], broken.join('; '));
  });
}
