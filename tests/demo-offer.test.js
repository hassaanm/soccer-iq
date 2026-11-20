// (v76 SL, review) The skill moment (game/skill.js) belongs to matches and to "Take him on!" (its rounds and its demo):
// once that lesson was open, another lesson's demo (look-up, spread-out, get-open) offered a trick, said "Pick a trick!",
// tapped one, and its own closing line came 4 to 8 s late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';
import { SKILL_LESSON } from '../js/game/skill.js';

test('no skill moment in a demo but the one about it', async () => {
  const bad = [];
  for (const sk of PATH) {
    if (sk.id === SKILL_LESSON) continue;
    const { g } = makeGame(); g.skillsOpen = () => true; let offered = false, done = false;
    g.demo(sk.id).then(() => { done = true; });
    for (let f = 0; f < 30 * 120 && !done; f++) { g.tick(1 / 30, f / 30); await null; if (g.sk) offered = true; }
    if (offered) bad.push(sk.id);
  }
  assert.deepEqual(bad, []);
});
