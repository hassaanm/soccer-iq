// (v76) No demo can stop for good, whatever the timing of its spoken lines. A late-loading voice clip (a phone) makes a line
// end later than its planned reading time; the demo's play (the shot, the rebound, the run in) then has to go on as it would.
//   (a) each line of each demo in turn comes late by 0.5, 1.5, 3 and 5 s; (b) the whole voice runs 1.5 and 2 times its
//   planned time. The demo has to reach its end in a sensible time. "Follow your shot!" gets every line and every delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

const LIMIT = 90; // seconds of game: the longest demo takes about 40 s with the voice at twice its time
// Runs one demo; `late(i, text)` gives the extra seconds line `i` takes to be said (on top of its planned len/12 s).
async function run(id, late) {
  const { g } = makeGame(); let T = 0, i = 0; const timers = [], lines = [];
  g.say = text => { const n = i++; lines.push(text); const at = T + late(n, text) + text.length / 12; return new Promise(r => timers.push({ at, r })); };
  let done = false, err = null; g.demo(id).then(() => { done = true; }, e => { done = true; err = e; });
  for (let k = 0; k < 30 * LIMIT && !done; k++) {
    T += 1 / 30; for (const t of timers.splice(0)) { if (t.at <= T) t.r(); else timers.push(t); }
    g.tick(1 / 30, T); g.timerUi?.(); if (k % 4 === 3) await new Promise(r => setImmediate(r)); else for (let j = 0; j < 8; j++) await null; // (the promises of the script settle between frames; a real macrotask only every fourth frame, which is faster)
  }
  return { done, err, T, lines, g };
}

test('demos: the whole voice slower (1.5 and 2 times its time): every demo ends', async () => {
  for (const sk of PATH) for (const vk of [1.5, 2]) {
    const r = await run(sk.id, (n, t) => (vk - 1) * t.length / 12);
    assert.equal(r.err, null, `${sk.id} x${vk}: no error`);
    assert.ok(r.done, `${sk.id}: the demo ends with the voice at ${vk} times its time (stopped at ${r.T.toFixed(0)} s, phase ${r.g.phase})`);
  }
});

test('demos: any one line late (0.5, 1.5, 3, 5 s): every demo ends', async () => {
  for (const [j, sk] of PATH.entries()) {
    const n = (await run(sk.id, () => 0)).lines.length;
    // "Follow your shot!": every line with every delay. The others: every delay, with the line moving on from one demo to the
    // next (the first demo late on its first line, the next on its second, and so on), so that all the lines are tried
    // somewhere and the test stays short.
    const cases = [];
    for (const [i, d] of [.5, 1.5, 3, 5].entries()) for (let w = 0; w < n; w++) if (sk.id === 'follow-shot' || w === (i + j) % n) cases.push([w, d]);
    for (const [w, d] of cases) {
      const r = await run(sk.id, k => (k === w ? d : 0));
      assert.equal(r.err, null, `${sk.id}: line ${w} +${d}s: no error`);
      assert.ok(r.done, `${sk.id}: the demo ends with line ${w} "${r.lines[w]}" ${d} s late (stopped at ${r.T.toFixed(0)} s, phase ${r.g.phase})`);
    }
  }
});

test('"Follow your shot!": the shot, the rebound and the run in play out with a late line, with no help from the time limit', async () => {
  for (const d of [1.5, 3, 5]) {
    const r = await run('follow-shot', (k, t) => (/^(Watch|You shot)/.test(t) ? d : 0));
    assert.ok(r.done && !r.g.stalled, `follow-shot +${d}s: the play ended itself (stalled ${r.g.stalled || 0})`);
  }
});
