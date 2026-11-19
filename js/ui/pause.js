// The pause on the page (v79; the clock side is js/pause.js). A button right of home (two bars) shows whenever play is on
// screen; a tap pauses. Paused, the picture stays as it is, sharp, a big play triangle pulses in the middle, the pause
// button turns into the same triangle, and the choice buttons stay up, dimmed and dead (css/app.css, the pause block).
// A tap on either triangle resumes. The game also pauses by itself when the app goes to the background (or the phone
// locks), and when the sound menu is opened in play (the grown-ups menu is only on the home screen); it stays paused
// until a triangle is tapped. With his head already up, a drag still looks around while paused: the camera only.
import { $, onPress } from './dom.js';
import { hudEl } from './hud.js';
import { game } from './stage.js';
import { goalie } from './goalie.js';
import { held, setPause, onPause } from '../pause.js';
import { holdMusic } from '../sound.js';
import { mark } from '../perf.js';

const PLAY = new Set(['lesson', 'demo', 'match', 'free', 'keeper']);
const BARS = '<svg class="bars" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="5.5" y="4.5" width="4.4" height="15" rx="1.6" fill="currentColor"/><rect x="14.1" y="4.5" width="4.4" height="15" rx="1.6" fill="currentColor"/></svg>';
const TRI = '<svg class="tri" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L9.5 3.94A1 1 0 0 0 8 4.8Z" fill="currentColor"/></svg>';
// The nodes, made once.
const btn = document.createElement('button');
btn.id = 'pauseBtn'; btn.className = 'btn btn-glass btn-icon top-left'; btn.type = 'button'; btn.setAttribute('aria-label', 'Pause'); btn.innerHTML = BARS + TRI;
const big = document.createElement('button');
big.id = 'pausePlay'; big.className = 'btn'; big.type = 'button'; big.setAttribute('aria-label', 'Play'); big.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L9.5 3.94A1 1 0 0 0 8 4.8Z" fill="currentColor"/></svg>';
const home = $('#homeBtn'); home.after(btn); hudEl.appendChild(big);
const card = $('#card'), rate = $('#rate'), pop = $('#soundPop');

// Play is on screen: the field with its HUD, no card over it, in a mode that plays.
const inPlay = () => !hudEl.classList.contains('hidden') && card.classList.contains('hidden') && (goalie.on || PLAY.has(game.mode));
let can = false;
// Once a frame (main.js): whether the pause button shows (not over a lesson's result card either).
export function pauseFrame() {
  const c = inPlay() && !rate.classList.contains('show');
  if (c !== can) { can = c; hudEl.classList.toggle('canpause', c); }
}
onPress(btn, () => { if (held.on) setPause(false); else if (inPlay()) setPause(true, 'button'); });
onPress(big, () => setPause(false));
onPause((on, why, sec) => {
  hudEl.classList.toggle('paused', on);
  btn.setAttribute('aria-label', on ? 'Play' : 'Pause');
  holdMusic(on); mark(on ? `pause ${why}` : `resume ${sec.toFixed(1)}s`); look.t = 0;
});
// The app goes to the background, or the phone locks: paused, and still paused on return (the triangle shows).
const away = () => { if (inPlay()) setPause(true, 'hidden'); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') away(); });
addEventListener('pagehide', away);
// The sound menu opened in play.
if (pop && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pop.classList.contains('hidden') && inPlay()) setPause(true, 'menu'); }).observe(pop, { attributes: true, attributeFilter: ['class'] });

// A look around while paused (ui/input.js lets a drag start only with his head already up): only the camera follows it,
// in the player's own view. The camera's own counters (its frame count, its eases) are put back after, so the play goes
// on as it would have; where he looks is his to change, as in play. A moment after the finger lifts, the camera settles.
const LOOK = .6, look = { t: 0 };
export function stillView(dt) {
  if (goalie.on || game.camMode !== 'player' || game.sk || game.skCam > 0 || !game.cam) return false;
  if (game.drag) look.t = LOOK; else if (look.t > 0) look.t -= dt; else return false;
  const keep = { frameNo: game.frameNo, glide: game.glide, camSlow: game.camSlow, camT0: game.camT0, camWas: game.camWas, lastWant: game.lastWant, camAsk: game.camAsk };
  try { game.updateCamera(dt, game.clock); } finally { Object.assign(game, keep); }
  return true;
}
