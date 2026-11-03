// Small pure helpers shared by the sim, the game and the tests.
export const PITCH = { L: 30, W: 20, gy0: 8, gy1: 12, gh: 1.6 };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Dribble directions, as angles from "toward the other goal" (+x). Left is +y.
const Q = Math.PI / 4;
export const DRIBBLE_DIRS = { fwd: 0, fl: Q, left: 2 * Q, bl: 3 * Q, back: 4 * Q, br: -3 * Q, right: -2 * Q, fr: -Q };
export const BACKWARD = new Set(['bl', 'back', 'br']); // away from the goal he attacks
export const DRIBBLE_LEN = 4.5;

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

// Flip a scenario top-to-bottom so each one can be played on both sides.
export function mirrorScenario(sc, W) {
  const f = p => p && [p[0], W - p[1]];
  const SWAP = { left: 'right', right: 'left', fl: 'fr', fr: 'fl', bl: 'br', br: 'bl' };
  const opt = o => o.startsWith('drib:') && SWAP[o.slice(5)] ? 'drib:' + SWAP[o.slice(5)] : o;
  return {
    ...sc, id: sc.id + 'm', hero: f(sc.hero), heroTo: f(sc.heroTo),
    mates: sc.mates.map(f), opps: sc.opps.map(f), oppsTo: (sc.oppsTo || []).map(f),
    best: opt(sc.best), ok: (sc.ok || []).map(opt),
  };
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
