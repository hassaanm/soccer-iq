// Small pure helpers shared by the sim, the game and the tests.
// Team sizes (P.settings.size), all read from this one table: `out` outfield players a side, `keeper` a goalkeeper as
// well (5v5: four outfield and a keeper; the keeper is not built yet), `pitch` the pitch it is played on (L long, W wide,
// the goal from gy0 to gy1 across, gh high), and `offer`: whether the home screen offers it. Pitches from the federations
// (v62 research): 3v3 30 x 20 m (DFB 25 x 20, US 23–32 x 14–23); 4v4 32 x 22 m (the US 4v4 maximum); 5v5 38 x 26 m with a
// 5 m goal (FA 37 x 27, DFB 40 x 25). "Close enough to shoot" stays about 9 m at every size: it is about a child's leg.
// `area`: the box in front of each goal (m deep, m wide): the keeper's area at 5v5, and at every size the landmark for
// "close" (inside it, shoot with the inside of the foot) against "the edge" (laces; shot.js CLOSE).
import { storage as STORE } from './storage.js'; // (round 13: the save's storage; see storage.js)
export const SIZES = {
  '3v3': { out: 3, keeper: false, pitch: { L: 30, W: 20, gy0: 8, gy1: 12, gh: 1.6 }, area: { d: 8, w: 12 }, offer: true },
  '4v4': { out: 4, keeper: false, pitch: { L: 32, W: 22, gy0: 9, gy1: 13, gh: 1.6 }, area: { d: 8, w: 13 }, offer: true },
  '5v5': { out: 4, keeper: true, pitch: { L: 38, W: 26, gy0: 10.5, gy1: 15.5, gh: 1.8 }, area: { d: 8, w: 14 }, offer: true }, // area: the keeper's (m deep, m wide)
};
// The size being played and its pitch. PITCH is changed in place, and L, W, gy0, gy1 are live bindings: a module that
// reads them when it runs (the generator, the game, the sim) always gets the current pitch. The 3D world builds its
// pitch once, from the size saved when the page loads (below); changing to a size with another pitch reloads the page.
export const TEAM = { size: '3v3' };
export const PITCH = { ...SIZES['3v3'].pitch };
export let L = PITCH.L, W = PITCH.W, gy0 = PITCH.gy0, gy1 = PITCH.gy1;
export const sizeOf = (id = TEAM.size) => SIZES[id] || SIZES['3v3'];
const SIZE_HOOKS = [];
export const onSize = f => { SIZE_HOOKS.push(f); f(); }; // (skills.js: the lessons that belong to a size)
export function setSize(id) {
  TEAM.size = SIZES[id] ? id : '3v3';
  Object.assign(PITCH, sizeOf().pitch); ({ L, W, gy0, gy1 } = PITCH);
  for (const f of SIZE_HOOKS) f();
}
export const SAVE_KEY = 'soccer-iq:v1'; // where progress.js keeps the save
try { setSize(globalThis.process?.env?.SOCCER_SIZE || JSON.parse(STORE?.getItem(SAVE_KEY) || 'null')?.settings?.size); } catch { /* no storage (tests, private mode): 3v3 */ }
// (SOCCER_SIZE=4v4 npm test: the tests and tools in Node at another size.)
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Dribble directions, as angles from "toward the other goal" (+x). Left is +y.
const Q = Math.PI / 4;
export const DRIBBLE_DIRS = { fwd: 0, fl: Q, left: 2 * Q, bl: 3 * Q, back: 4 * Q, br: -3 * Q, right: -2 * Q, fr: -Q };
export const BACKWARD = new Set(['bl', 'back', 'br']); // away from the goal he attacks
const DRIBBLE_LEN = 4.5;

export function dribbleEnd(from, dir, L, W) {
  const [dx, dy] = rot(DRIBBLE_LEN, 0, DRIBBLE_DIRS[dir]);
  return { x: clamp(from.x + dx, 1, L - 1), y: clamp(from.y + dy, 1, W - 1) };
}

// Closest point on segment a→b to p, limited to t in [t0, 1] so the passer's own feet don't count.
export function closestOnLane(p, a, b, t0 = 0.15) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, t0, 1);
  const x = a.x + dx * t, y = a.y + dy * t;
  return { t, x, y, d: Math.hypot(p.x - x, p.y - y) };
}

// The opponent best placed to cut out a pass from a to b, and where.
export function interceptor(a, b, opps) {
  let best = null;
  for (const o of opps) {
    const c = closestOnLane(o, a, b);
    if (!best || c.d < best.d) best = { opp: o, x: c.x, y: c.y, d: c.d };
  }
  return best;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
