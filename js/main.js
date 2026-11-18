// Start-up: loads every screen, wires the home buttons and runs the frame loop.
import { $ } from './ui/dom.js';
import { world, game } from './ui/stage.js';
import { show } from './ui/screens.js';
import { hush } from './ui/speech.js';
import { renderPickers } from './ui/home.js';
import { matchStrip } from './ui/strip.js';
import { runSession, runFreePlay, openCups, gated } from './flows.js';
import { goalie } from './ui/goalie.js'; // (v67: the keeper game; its own button)
import { VERSION } from './version.js';
import { smooth } from './ui/speed.js';
import * as perf from './perf.js';
import './ui/soundmenu.js';
import './ui/menu.js';
import './ui/input.js';

$('#playBtn').onclick = () => runSession();
$('#freeBtn').onclick = () => gated(runFreePlay);
$('#cupBtn').onclick = () => gated(openCups);
$('#resultsHome').onclick = () => show('#home');
$('#homeBtn').onclick = () => location.reload(); // leaving mid-game: a reload is the one sure way to stop everything
$('#skipBtn').onclick = () => { game.skipDemo(); hush(); };
$('#version').textContent = VERSION;
renderPickers(); show('#home');

// One frame: step the game, draw the world. A long gap (a hidden tab) counts as at most 1/20 of a second.
let last = performance.now(), time = 0;
// (round 11) How often: with Graphics on Smooth, 60 pictures a second at most (a 120 Hz phone draws every other
// frame: half the work, the same play), and 30 where nothing is played (home, cards). ?fps=30 caps the loop for a test
// (a phone in Low Power Mode); ?fps=120 runs two frames of the loop for each of the screen's (a 120 Hz screen on a 60 Hz one).
let lastPhase = '';
const FPS = +new URLSearchParams(location.search).get('fps') || 0;
function frame(now) {
  requestAnimationFrame(frame);
  const cap = FPS && FPS < 100 ? FPS : smooth() ? (game.phase === 'idle' && !goalie.on ? 30 : 60) : 0;
  if (cap && now - last < 1000 / cap - 3) return;
  const ms = now - last; last = now;
  if (FPS >= 100) { one(now - ms / 2, ms / 2, false); one(now, ms / 2, false); } else one(now, ms, !cap || cap === 60);
}
function one(now, ms, judge) { // judge: the slow-device governor looks at this frame's length (not when the loop is held back on purpose)
  const dt = Math.min(.05, ms / 1000); time += dt;
  try {
    if (judge) world.pace(ms);
    if (world.pending != null && (goalie.on ? false : game.phase === 'idle' || (game.phase === 'pre' && lastPhase !== 'pre'))) world.applyPending(); lastPhase = game.phase;
    let end = perf.time('game');
    if (goalie.on) { goalie.tick(dt); end(); end = perf.time('draw'); world.render(goalie.sim, goalie.cam, goalie.ui, time); } // (the keeper game draws its own play: ui/goalie.js)
    else { goalie.tick(dt); game.tick(dt, time); end(); end = perf.time('draw'); world.render(game.sim, game.cam, game.ui, time); }
    end(); end = perf.time('strip'); matchStrip(now); end();
    perf.frame(now, goalie.on ? { phase: 'keeper', mode: 'keeper' } : game, world.renderer);
  } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);

window.__game = game; // for debugging in the console
try { sessionStorage.removeItem('healed'); } catch { /* storage blocked */ } // booted fine (see index.html)
