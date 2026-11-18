// (v76) He never runs across the screen sideways as a choice opens, at the size being played (SOCCER_SIZE): the camera
// itself (eye to target) points the way he carries the ball, within 40°, as the window opens and 0.7 s in, in a lesson's
// scenes; and in whole matches (a child's taps) 0.7 s in, with at most 5% of windows over it as they open (a camera
// still coming round from the last play). scripts/live-audit.js HEADING has the rule and its reasons (a pass to him; a
// view from above that frames the rings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH, allScenarios } from '../js/skills.js';
import { TEAM } from '../js/geom.js';
import { makeGame, drive, optionsFor } from './harness.js';
import { headingWatch, headingMatches, HEADING } from '../scripts/live-audit.js';

test('a lesson scene opens with the camera the way he runs', async () => {
  const bad = []; let n = 0;
  for (const sk of PATH) for (const sc of allScenarios(sk.id).slice(0, 3)) {
    if (sc.kind === 'tackle') continue;
    const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 }; g.mode = 'lesson'; g.load(sc);
    const hw = headingWatch(g, r => { if (r.why) return; n++; if (r.bad || r.badLater) bad.push(`${sc.id}: ${Math.round(r.open)}° as it opens, ${r.later == null ? '-' : Math.round(r.later)}° ${HEADING.later} s in`); });
    await drive(g, g.pre(), { onFrame: hw });
    const ring = gm => { hw(); const l = gm.win && gm.phase === 'decide' ? gm.timerUi()?.left : null; if (l != null && !(typeof l === 'number' && l >= 0 && l <= 1)) bad.push(`${sc.id}: the ring reads ${l}`); }; // (and his timer ring is a share of the window)
    let k = 0; await drive(g, g.decide(), { onFrame: ring, pick: gm => (++k > 40 ? optionsFor(gm.sc)[0] : null) }); hw();
  }
  assert.ok(n > 20, `windows measured: ${n}`);
  assert.deepEqual(bad, [], `${TEAM.size}: the camera is more than ${HEADING.lim}° off his run`);
});

test('in matches the camera comes round to his run as a choice opens', async () => {
  const rows = (await headingMatches(TEAM.size, 2)).filter(r => !r.why), open = rows.filter(r => r.bad), later = rows.filter(r => r.badLater);
  assert.ok(rows.length > 5, `windows measured: ${rows.length}`);
  assert.deepEqual(later.map(r => `${r.sc} ${Math.round(r.later)}°`), [], `${HEADING.later} s into a choice the camera is more than ${HEADING.lim}° off his run`);
  assert.ok(open.length <= Math.max(1, HEADING.share * rows.length), `as choices open, ${open.length} of ${rows.length} over ${HEADING.lim}°`);
});
