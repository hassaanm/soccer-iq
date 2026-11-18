// (v78) His own player plays a pass or a shot from where he is, with a natural turn, at the size being played
// (SOCCER_SIZE): with nobody of theirs within 2 m he gets no more than 0.5 m farther from their goal (from the window
// opening to the kick) or from where he kicks it (from the choice), and his body turns no more than 30° farther off the
// kick. In lesson scenes, tapped with his head down and after a look at the friend or the goal (looking up turns his body
// with the view), and in whole matches. scripts/live-audit.js WALK has the rule.
// The owner (v76): "my player was right in front of the goal… starts walking away from the goal with his back towards the
// goal, and then sort of turning and then passing to the teammate. Very bizarre."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH, allScenarios } from '../js/skills.js';
import { TEAM, PITCH } from '../js/geom.js';
import { makeGame, drive, optionsFor } from './harness.js';
import { kickWatch, walkMatches, walkText } from '../scripts/live-audit.js';

const KICKS = /^(pass:|shoot|turn:B)/;
test('in lesson scenes a pass or a shot is played from where he is', async () => {
  const bad = []; let n = 0;
  for (const sk of PATH) for (const sc of allScenarios(sk.id).slice(0, 3)) {
    if (sc.kind === 'tackle') continue;
    for (const opt of optionsFor(sc).filter(o => KICKS.test(o))) for (const look of ['none', 'target', 'goal']) {
      const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 }; g.mode = 'lesson'; g.load(sc);
      const kw = kickWatch(g, r => { n++; if (r.bad) bad.push(`${look}: ${walkText(r)}`); });
      await drive(g, g.pre(), { onFrame: kw });
      let looked = false;
      const pick = gm => { if (!gm.win) return opt;
        if (!looked && look !== 'none' && gm.win.u > .04) { looked = true; gm.lookUp = true; gm.scanned = true; const h = gm.sim.a('hero'), t = look === 'target' ? gm.target(opt) : { x: PITCH.L, y: PITCH.W / 2 }; gm.yaw = Math.atan2(t.y - h.y, t.x - h.x); }
        return gm.win.u >= .5 ? opt : null; };
      const o = await drive(g, g.decide(), { pick, onFrame: kw, maxSec: 90 });
      await drive(g, g.outcome(o, g.isGood(o)), { onFrame: kw, maxSec: 60 });
    }
  }
  assert.ok(n > 40, `kicks measured: ${n}`);
  assert.deepEqual(bad, [], `${TEAM.size}: not played from where he is`);
});

test('in matches a pass or a shot is played from where he is', async () => {
  const rows = await walkMatches(TEAM.size, 2), bad = rows.filter(r => r.bad);
  assert.ok(rows.filter(r => r.calm).length > 4, `calm kicks measured: ${rows.length}`);
  assert.deepEqual(bad.map(r => `match ${r.seed} ${walkText(r)}`), [], `${TEAM.size}: not played from where he is`);
});
