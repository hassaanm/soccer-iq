// Lab H: "Hold to think". The shared one-player match (common/flow.js), flowing at 0.75 of real speed, a little quicker
// than E, but he owns time: a finger held still on the pitch slows the world to 0.15 for as long as it stays down
// (move the held finger to turn his head and look round); letting go plays on. A quick tap acts as in E. The idea:
// he learns to take a look when he needs one, as a player takes a moment on the ball. Mistakes are shown in a word;
// the 1.5 s "why" freeze is off at first (a switch on the pause sheet turns it on). 4 v 4.
import { onePlayer } from '../common/flow.js';
const ctx = await onePlayer({ letter: 'H', name: 'Hold to think', version: 'v1', base: .75, hold: .15, whySwitch: true, why: false,
  tick: (c) => { const a = document.querySelector('#ask'); const on = c.lab.real < 10 || (c.lab.real - (c.lastHoldHint || -99) < 4); if (a._on !== on) { a._on = on; a.textContent = '✋ Hold a finger down to slow time'; a.classList.toggle('show', on); } } });
// (a reminder for the grown-up when he has the ball and has not held for a while)
const { lab, m, view } = ctx; let lastHolds = 0;
setInterval(() => { if (view.holds !== lastHolds) { lastHolds = view.holds; ctx.lastHoldUse = lab.real; } if (m.owner() === ctx.me && lab.real - (ctx.lastHoldUse || 0) > 20) { ctx.lastHoldHint = lab.real; ctx.lastHoldUse = lab.real; } }, 500);
lab.run();
