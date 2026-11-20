// (v76 SL) After a demo's idea, until the hand's choice, the picture keeps moving. Play crawls on toward the choice (the
// demo's clock: half the ring left as the hand taps), so for 2 to 4 s the picture hardly changed in several demos
// (shoot-close, shoot-space, lead-pass, get-goal-side, pass-to-open, see-the-trap, take-him-on, follow-shot: a mean
// change of 1.5 to 3.8 per half second against 10 to 14 during the idea; the owner read it as a freeze). Now the view
// goes on coming in toward him, evenly, until the choice (game/view.js CLOSE, demo.js `push.close`): in every half
// second from the idea's end to the choice the camera itself moves by MOVE m or more (eye and target together).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH } from '../js/skills.js';
import { makeGame } from './harness.js';

const MOVE = .06;
test('every half second of a demo after its idea moves: the view comes in until the choice', async () => {
  for (const sk of PATH) {
    const { g } = makeGame(); let chose = false, crawl = false, last = null, f = 0; const still = [];
    const oc = g.outcome.bind(g); g.outcome = (o, good) => { chose = true; return oc(o, good); };
    let done = false; g.demo(sk.id).then(() => { done = true; });
    for (; f < 30 * 120 && !done && !chose; f++) {
      g.tick(1 / 30, f / 30); await null; const w = g.win; if (w?.demo?.crawl != null) crawl = true;
      if (!crawl || !w || w.demo?.crawl != null || !g.cam || f % 15) continue;
      const at = [...g.cam.eye, ...g.cam.tgt]; if (last) { const m = Math.hypot(...at.slice(0, 3).map((v, i) => v - last[i])) + Math.hypot(...at.slice(3).map((v, i) => v - last[i + 3])); if (m < MOVE) still.push(`${(f / 30).toFixed(1)} s: ${m.toFixed(3)} m`); }
      last = at;
    }
    assert.ok(crawl || sk.id === 'steal-it', `${sk.id}: its idea was said`); // ("Steal it!": no window, the play is his tackle)
    assert.deepEqual(still, [], `${sk.id}: half seconds with the view still after the idea`);
  }
});
