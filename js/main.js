// Start-up: loads every screen, wires the home buttons and runs the frame loop.
import { $ } from './ui/dom.js';
import { world, game } from './ui/stage.js';
import { show } from './ui/screens.js';
import { hush } from './ui/speech.js';
import { renderPickers } from './ui/home.js';
import { matchStrip } from './ui/strip.js';
import { runSession, runFreePlay, openCups, gated } from './flows.js';
import { VERSION } from './version.js';
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
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000);
  last = now; time += dt;
  requestAnimationFrame(frame);
  try { game.tick(dt, time); world.render(game.sim, game.cam, game.ui, time); matchStrip(now); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);

window.__game = game; // for debugging in the console
try { sessionStorage.removeItem('healed'); } catch { /* storage blocked */ } // booted fine (see index.html)
