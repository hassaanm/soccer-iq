// (v78) One LOOK UP per play, at the size being played (SOCCER_SIZE): once he has looked up in a play, the later steps
// of the same play open with his head up (no head-down edge or blur, LOOK UP not offered) and count as a look; a new
// scene, or their ball, starts head-down. game.js beginStep.
// The owner (v76): "if there's a play where I'm going to give a pass and then get a pass back, and in order to give the
// pass I had to look up, I shouldn't have to look up again."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH, allScenarios } from '../js/skills.js';
import { TEAM } from '../js/geom.js';
import { makeGame, drive, optionsFor } from './harness.js';

test("a give-and-go's return needs no second look", async () => {
  const scs = allScenarios('give-and-go').filter(sc => sc.then); assert.ok(scs.length, 'give-and-go scenes');
  for (const sc of scs.slice(0, 3)) {
    const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 };
    let step2 = null, low = 1, k = 0; const log = []; g.onChoice = r => log.push(r); g.choiceLog = 'lesson';
    const done = g.round(sc, { hint: false });
    await drive(g, done, { maxSec: 200,
      onFrame: gm => { if (step2 && (gm.phase === 'pre' || gm.phase === 'decide') && gm.sc.id.endsWith('-2')) low = Math.min(low, gm.look); },
      pick: gm => { if (!gm.sc.id.endsWith('-2')) { if (!gm.lookUp) { gm.toggleLook(); k = 0; return null; } return ++k > 10 ? gm.sc.best : null; }
        step2 ||= { lookUp: gm.lookUp, scanned: gm.scanned }; return gm.sc.best; } });
    assert.ok(step2, `${sc.id}: the second step opened`);
    assert.deepEqual(step2, { lookUp: true, scanned: true }, `${TEAM.size} ${sc.id}: his head is up for the return`);
    assert.ok(low > .97, `${TEAM.size} ${sc.id}: the head-down blur came back in the second step (look ${low.toFixed(2)})`);
    assert.equal(log.at(-1)?.looked, true, `${sc.id}: the second step counts as a look (decision log)`);
    g.load(sc); assert.equal(g.lookUp, false, 'a new scene starts head-down'); await drive(g, g.pre()); assert.equal(g.lookUp, false);
  }
});

test('in matches a look carries through the play, not past it', async () => {
  const real = Math.random; let carried = 0, fresh = 0; const bad = [];
  try { for (let seed = 1; seed <= 3; seed++) {
    let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 }; g.skills = new Set(PATH.map(s => s.id));
    // (what a play is, kept by the test itself: from a scene set up, or our ball won back, until their ball)
    let looked = false, lastW = null, k = 0, last = null;
    const ld = g.load.bind(g); g.load = sc => { looked = false; return ld(sc); };
    const cd = g.continueDefense.bind(g); g.continueDefense = () => { looked = false; return cd(); };
    const cl = g.continueLive.bind(g); g.continueLive = () => { if (g.sc?.kind === 'defense' || g.sc?.kind === 'tackle') looked = false; return cl(); };
    await drive(g, g.match(PATH.map(s => s.id), [], 3, 'free'), { maxSec: 6000,
      onFrame: gm => { if (gm.win && gm.win !== lastW && gm.phase === 'decide') { lastW = gm.win; const kind = gm.sc.kind || 'attack'; if (kind === 'tackle') return;
        if (looked) { carried++; if (!gm.lookUp || gm.look < .97) bad.push(`match ${seed} ${gm.sc.id} (${kind}): head down after a look in the same play`); } else fresh++; } },
      pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
        if (gm._choose !== last) { last = gm._choose; k = 0; }
        if (!gm.lookUp && gm.sc.kind !== 'defense') { gm.toggleLook(); if (gm.lookUp) looked = true; return null; } if (gm.lookUp && gm.sc.kind !== 'defense') looked = true;
        if (++k <= 8) return null; // (a pass that keeps the ball when there is one: more plays of more than one step)
        const pass = (gm.sc.kind || 'attack') === 'attack' && !gm.sc.spots ? optionsFor(gm.sc).find(o => o.startsWith('pass:') && gm.rating(o) !== 'bad') : null;
        return pass || gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); } });
  } } finally { Math.random = real; }
  assert.ok(carried > 3 && fresh > 3, `windows after a look in the same play ${carried}, others ${fresh}`);
  assert.deepEqual(bad, [], TEAM.size);
});
