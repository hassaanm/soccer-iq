// The pause (v79): "Sometimes you need to just stop and think about it." While paused, nothing that moves or counts goes
// on. Everything in play runs on the time the frame loop hands the game (game time, the game's real-time jobs, the skill
// moment, the keeper game, the camera, the picture's clock for the crowd and the sparks), so the loop hands it none; the
// few waits on the page's own clock (the HUD's timers: a result's card, a toast) go through later() below, which holds
// them too. On resume, play eases back in over EASE seconds (share, below), so it never jumps to full speed, and a run
// with a pause in it plays every game step as it would have without (tests/pause.test.js). No DOM here (js/ui/pause.js
// has the buttons and the drawing), so the tests use it as it is.
export const EASE = .5; // seconds play takes to come back to full speed after a resume
export const held = { on: false, why: null, since: 0, t: EASE, ease: 1, acc: 0, lerp: 1 };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const subs = new Set();
// f(on, why, seconds paused) after every change.
export function onPause(f) { subs.add(f); return () => subs.delete(f); }
// Pauses (on) or resumes. `why`: 'button', 'hidden' (the app went to the background), 'menu'. Returns whether it changed.
export function setPause(on, why = 'button') {
  on = !!on; if (held.on === on) return false;
  const sec = on ? 0 : (now() - held.since) / 1000;
  held.on = on; held.why = on ? why : null;
  if (on) { held.since = now(); holdTimers(); } else { held.t = 0; held.ease = 0; held.acc = 0; held.lerp = 0; freeTimers(); }
  for (const f of subs) { try { f(on, why, sec); } catch (e) { console.error(e); } }
  return true;
}
// What the game gets of a frame of `dt` real seconds: none while paused, all of it otherwise. While play eases back in,
// the speed of play rises smoothly from none to full over EASE seconds, but the game is still handed whole frames, each
// as long as it was (frames of other lengths would make a run go a little differently: a demo's words, the gaps between
// shots and the skill moment end on frames): a frame either goes to the game whole or is skipped. Skipped ones are drawn
// part way between the game's last two frames (`held.lerp`, ui/pause.js easeDraw), so the picture eases in smoothly.
export function share(dt) {
  if (held.on) return 0;
  if (held.t >= EASE) { held.lerp = 1; return dt; }
  const a = held.t; held.t = Math.min(EASE, a + dt);
  if (held.t >= EASE) { held.acc = 0; held.ease = held.lerp = 1; return dt; }
  const u = (a + held.t) / 2 / EASE; held.ease = u * u * (3 - 2 * u);
  held.acc = (held.acc || 0) + dt * held.ease;
  const go = held.acc >= dt; if (go) held.acc -= dt;
  held.lerp = Math.min(1, held.acc / dt);
  return go ? dt : 0;
}
// Whether play is easing back in (frames are being skipped and drawn part way).
export const easing = () => !held.on && held.t < EASE;

// ---------- waits on the page's clock ----------
// later(f, ms) and unlater(id): setTimeout and clearTimeout, held while paused (the time left goes on after it). A file
// whose timers belong to play imports them under the usual names: import { later as setTimeout, ... }.
const timers = new Map();
let nextId = 1;
export function later(fn, ms = 0, ...args) {
  const id = nextId++, t = { fn, args, left: Math.max(0, +ms || 0), at: 0, h: 0 };
  timers.set(id, t); if (!held.on) arm(id, t);
  return id;
}
export function unlater(id) { const t = timers.get(id); if (!t) return; clearTimeout(t.h); timers.delete(id); }
function arm(id, t) { t.at = now(); t.h = setTimeout(() => { timers.delete(id); t.fn(...t.args); }, t.left); }
function holdTimers() { const n = now(); for (const t of timers.values()) { clearTimeout(t.h); t.left = Math.max(0, t.left - (n - t.at)); } }
function freeTimers() { for (const [id, t] of timers) arm(id, t); }
