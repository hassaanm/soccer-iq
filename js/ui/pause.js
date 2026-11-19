// The pause on the page (v79; the clock side is js/pause.js). A button right of home (two bars) shows whenever play is on
// screen; a tap pauses. Paused, the picture stays as it is, sharp, a big play triangle pulses in the middle, the pause
// button turns into the same triangle, and the choice buttons stay up, dimmed and dead (css/app.css, the pause block).
// A tap on either triangle resumes. The game also pauses by itself when the app goes to the background (or the phone
// locks), and when the sound menu is opened in play (the grown-ups menu is only on the home screen); it stays paused
// until a triangle is tapped. With his head already up, a drag still looks around while paused: the camera only.
import { $, onPress } from './dom.js';
import { hudEl } from './hud.js';
import { game, world } from './stage.js';
import { goalie } from './goalie.js';
import { held, setPause, onPause, easing } from '../pause.js';
import { holdMusic } from '../sound.js';
import { mark } from '../perf.js';

const PLAY = new Set(['lesson', 'demo', 'match', 'free', 'keeper', 'fast']); // (v84: fast, js/fast/fast.js)
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
// Where the big triangle goes as it pauses: low in the middle, or in the very middle (css: #hud.playmid), whichever is
// farther from his player and the ball on the screen (his head down, he is in the middle; head up, low). In the keeper
// game, always the middle: his goal, its gold spots and the hand are low.
const R = 58;
function place() {
  const g = goalie.on ? goalie : game, s = g.sim, h = s?.a?.('hero'), b = s?.ball, w = innerWidth, ht = innerHeight;
  const pts = []; try { if (h) pts.push(world.project(h.x, h.y, 0), world.project(h.x, h.y, 1.8)); if (b) pts.push(world.project(b.x, b.y, b.z || 0)); } catch { /* no picture yet */ }
  const near = (cx, cy) => Math.min(...pts.filter(Boolean).map(p => Math.hypot(p[0] - cx, p[1] - cy)), 1e9);
  const low = near(w / 2, ht - 14 - R), mid = near(w / 2, ht / 2);
  hudEl.classList.toggle('playmid', goalie.on || mid > low);
}
onPress(btn, () => { if (held.on) setPause(false); else if (inPlay()) setPause(true, 'button'); });
onPress(big, () => setPause(false));
onPause((on, why, sec) => {
  hudEl.classList.toggle('paused', on);
  btn.setAttribute('aria-label', on ? 'Play' : 'Pause');
  if (on) place(); holdMusic(on); mark(on ? `pause ${why}` : `resume ${sec.toFixed(1)}s`); look.t = 0;
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

// (Easing back in, js/pause.js share) Before each frame the game gets: where everything is. Each picture is then drawn
// `held.lerp` of the way from there to where the game is now (the players, the ball, the camera, the picture's clock),
// and everything is put back after: the game never sees it.
const tw = { sim: null, at: new Map(), ball: [0, 0, 0], eye: [0, 0, 0], tgt: [0, 0, 0], cam: null, clock: 0, time: 0 };
const keep = { at: new Map(), ball: [0, 0, 0], eye: [0, 0, 0], tgt: [0, 0, 0], clock: 0 };
export function easeMark(g, time) {
  const s = g.sim, b = s.ball; tw.sim = s; tw.at.clear();
  for (const a of s.agents.values()) tw.at.set(a, [a.x, a.y]);
  tw.ball[0] = b.x; tw.ball[1] = b.y; tw.ball[2] = b.z || 0; tw.cam = g.cam;
  if (g.cam) for (let i = 0; i < 3; i++) { tw.eye[i] = g.cam.eye[i]; tw.tgt[i] = g.cam.tgt[i]; }
  tw.clock = g.ui.clock; tw.time = time;
}
const mix = (a, b, k) => a + (b - a) * k;
export function easeDraw(g, time) {
  const s = g.sim, k = held.lerp, on = easing() && tw.sim === s && k < 1;
  if (!on) { world.render(s, g.cam, g.ui, time); return; }
  const b = s.ball, c = tw.cam === g.cam ? g.cam : null; keep.at.clear();
  for (const a of s.agents.values()) { const q = tw.at.get(a); if (!q) continue; keep.at.set(a, [a.x, a.y]); a.x = mix(q[0], a.x, k); a.y = mix(q[1], a.y, k); }
  keep.ball[0] = b.x; keep.ball[1] = b.y; keep.ball[2] = b.z; b.x = mix(tw.ball[0], b.x, k); b.y = mix(tw.ball[1], b.y, k); if (b.z != null) b.z = mix(tw.ball[2], b.z, k);
  if (c) for (let i = 0; i < 3; i++) { keep.eye[i] = c.eye[i]; keep.tgt[i] = c.tgt[i]; c.eye[i] = mix(tw.eye[i], c.eye[i], k); c.tgt[i] = mix(tw.tgt[i], c.tgt[i], k); }
  keep.clock = g.ui.clock; if (g.ui.clock != null && tw.clock != null) g.ui.clock = mix(tw.clock, g.ui.clock, k);
  try { world.render(s, g.cam, g.ui, mix(tw.time, time, k)); } finally {
    for (const [a, p] of keep.at) { a.x = p[0]; a.y = p[1]; }
    b.x = keep.ball[0]; b.y = keep.ball[1]; b.z = keep.ball[2];
    if (c) for (let i = 0; i < 3; i++) { c.eye[i] = keep.eye[i]; c.tgt[i] = keep.tgt[i]; }
    g.ui.clock = keep.clock;
  }
}
