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
import { smooth, TEST } from './ui/speed.js';
import * as perf from './perf.js';
import './ui/soundmenu.js';
import './ui/menu.js';
import './ui/input.js';
import { held, share, easing } from './pause.js';
import { pauseFrame, stillView, easeMark, easeDraw } from './ui/pause.js';
import { fast } from './fast/fast.js'; // (v84: Fast mode; it gets the frames while it plays)
fast.goalie = goalie; // (v84: in a Fast match at 5v5 he plays our keeper for their clear shots, with the keeper game's moment)

$('#playBtn').onclick = () => runSession();
$('#freeBtn').onclick = () => gated(runFreePlay);
$('#cupBtn').onclick = () => gated(openCups);
$('#resultsHome').onclick = () => show('#home');
$('#homeBtn').onclick = () => location.reload(); // leaving mid-game: a reload is the one sure way to stop everything
$('#skipBtn').onclick = () => { if (held.on) return; game.skipDemo(); hush(); };
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
  const cap = FPS && FPS < 100 ? FPS : smooth() && TEST.cap ? (game.phase === 'idle' && !goalie.on && !fast.on ? 30 : 60) : 0;
  if (cap && now - last < 1000 / cap - 3) return;
  const ms = now - last; last = now;
  if (held.on) { still(now, ms); return; } // (v79: paused, js/pause.js)
  if (FPS >= 100) { one(now - ms / 2, ms / 2, false); one(now, ms / 2, false); } else one(now, ms, !cap || cap === 60);
}
// (round 13) The strip under the page that iPadOS paints with the page's colour (ui/strip.js) is only there in an iPad's
// home-screen app, so only that reads the picture back for it: reading pixels makes the page wait for the graphics chip
// to finish the frame, twice a second. An iPad says "iPad", or (as a desktop site) "Macintosh" with a touch screen; an
// iPhone asking for the desktop site says the same, so the screen's short side tells them apart (an iPad's is 744 or more).
const STRIP = (() => { try {
  const ua = navigator.userAgent, pad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return pad && navigator.standalone === true && Math.min(screen.width, screen.height) >= 700;
} catch { return false; } })();
function one(now, ms, judge) { // judge: the slow-device governor looks at this frame's length (not when the loop is held back on purpose)
  const eased = easing(), dt = share(Math.min(.05, ms / 1000)); time += dt; // (v79: none of it while paused; as play eases back in, a frame goes to the game whole or not at all)
  pauseFrame();
  try {
    if (judge) world.pace(ms);
    if (world.pending != null && (fast.on ? fast.calm : goalie.on ? false : game.phase === 'idle' || (game.phase === 'pre' && lastPhase !== 'pre'))) world.applyPending(); lastPhase = game.phase;
    const go = dt || !eased; if (eased && go) easeMark(fast.on ? fast : goalie.on ? goalie : game, time - dt);
    let end = perf.time('game');
    if (fast.on) { if (go) fast.tick(dt); end(); end = perf.time('draw'); easeDraw(fast, time); } // (v84: Fast mode, js/fast/fast.js)
    else if (goalie.on) { if (go) goalie.tick(dt); end(); end = perf.time('draw'); easeDraw(goalie, time); } // (the keeper game draws its own play: ui/goalie.js)
    else { if (go) { goalie.tick(dt); game.tick(dt, time); } end(); end = perf.time('draw'); easeDraw(game, time); }
    end(); end = perf.time('strip'); if (TEST.strip ?? STRIP) matchStrip(now); end();
    if (TEST.onFrame) TEST.onFrame(now);
    perf.frame(now, fast.on ? { phase: 'fast', mode: 'fast' } : goalie.on ? { phase: 'keeper', mode: 'keeper' } : game, world.renderer);
  } catch (e) { console.error(e); }
}
// (v79) A frame while paused: no game time, no real-time jobs, nothing for the governor or the speed record. The picture
// is drawn again only when it has to change: a look around (camera only, ui/pause.js stillView) or a new size.
function still(now, ms) {
  perf.idle(now); pauseFrame();
  if (!stillView(Math.min(.05, ms / 1000)) && !world.resized) return;
  try { if (fast.on) world.render(fast.sim, fast.cam, fast.ui, time); else if (goalie.on) world.render(goalie.sim, goalie.cam, goalie.ui, time); else world.render(game.sim, game.cam, game.ui, time); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);

window.__game = game; // for debugging in the console
try { sessionStorage.removeItem('healed'); } catch { /* storage blocked */ } // booted fine (see index.html)
