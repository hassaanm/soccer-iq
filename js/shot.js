// Shots at a goal (v62): where one goes and what stops it. The generator grades with it and the game plays it, so a
// lesson's shot ends the same way every time. Nothing here is random: a scene fixes everything that varies (where the
// keeper stands, how far a laces shot strays, whether a save is held or spills).
import { PITCH, gy0, gy1, W, L, clamp, closestOnLane, sizeOf } from './geom.js';

// A recreational keeper aged 6 to 8 (v62 research, section 7): arms out he covers about a third of the goal (reach, m
// from his middle, a 5 m goal), he reacts a moment after the kick (react, s) and then steps or falls toward the ball at
// `speed` m/s. He stands on his line or up to `off` m off it.
export const GK = { reach: .8, react: .3, speed: 2.6, off: 1 };
// The two shots he can choose (no meters, no timing: a choice). Inside of the foot: slower, low, goes where it is aimed.
// Laces: fast, but it strays `stray` m to the outside of the aim (fixed per scene), and from close it flies over the bar.
export const FOOT = { in: { speed: 8, arc: .06 }, las: { speed: 19, arc: .3 } };
// Distances (m from where he strikes it to the middle of the goal): inside the box use the inside of the foot; the edge
// of the box (CLOSE to EDGE) the laces; farther, get closer first ("too far to shoot", as grade() already says).
export const CLOSE = 8, EDGE = 12.5;
// A shot the game plays by itself (a friend's, or his own run on goal, or theirs at our goal): hard and placed in the
// biggest space, never over the bar.
export const PLACED = { speed: 17, arc: .5 };
export const keeperOn = () => sizeOf().keeper;
// The spaces in the goal at x = L he can pick, as he sees them facing it: left (+y), right, and the middle. Each is
// aimed half a metre inside the post (the middle: the goal's middle).
export function spaces(n = 2) {
  const out = [{ id: 'L', y: gy1 - .55 }, { id: 'R', y: gy0 + .55 }];
  if (n > 2) out.splice(1, 0, { id: 'M', y: (gy0 + gy1) / 2 });
  return out;
}
export const spaceY = id => spaces(3).find(s => s.id === id)?.y;
// The foot the rule says, from where he is.
export const rightFoot = from => (Math.hypot((PITCH.L) - from.x, W / 2 - from.y) <= CLOSE ? 'in' : 'las');
// Where a shot from `from` aimed at (gx, aimY) ends, and why. foot: 'in', 'las' or 'placed'. k: the keeper of that goal
// ({ x, y }) or null. stray: how far a laces shot goes to the outside of its aim. defs: their players ({ x, y }) who may
// run back to the ball's path (a slow shot can be reached; only for his own chosen shots).
// Returns { res: 'goal' | 'save' | 'over' | 'wide' | 'cleared', to: the line point it is aimed through, at: where it is
// stopped (save, cleared), t: when (s), speed, arc, by: who stopped it }.
export function resolve(from, aimY, foot, k = null, { gx = L, stray = 0, defs = [], DEF_RUN = 4.8 } = {}) {
  const F = foot === 'placed' ? PLACED : FOOT[foot], d = Math.hypot(gx - from.x, aimY - from.y);
  let y = aimY;
  if (foot === 'las') y += stray * (Math.sign(aimY - W / 2) || 1); // (the middle strays to the left)
  const to = { x: gx, y }, base = { to, speed: F.speed, arc: F.arc, d };
  if (foot === 'las' && d < CLOSE) return { ...base, res: 'over', t: d / F.speed };
  if (y < gy0 + .1 || y > gy1 - .1) return { ...base, res: 'wide', t: d / F.speed };
  let gap = 9; // how far outside the keeper's reach it goes by (negative: inside it)
  if (k) {
    const c = closestOnLane(k, from, to, 0), t = Math.hypot(c.x - from.x, c.y - from.y) / F.speed, R = GK.reach + Math.max(0, t - GK.react) * GK.speed;
    gap = c.d - R;
    if (gap <= 0) return { ...base, res: 'save', at: { x: c.x, y: c.y }, t, gap };
  }
  if (foot !== 'placed') for (const o of defs) { // a defender running back gets to a slow shot before it is in
    const c = closestOnLane(o, from, to, .3), tb = Math.hypot(c.x - from.x, c.y - from.y) / F.speed, td = c.d / DEF_RUN + .2;
    if (td < tb - .1) return { ...base, res: 'cleared', at: { x: c.x, y: c.y }, t: tb, by: o };
  }
  return { ...base, res: 'goal', t: d / F.speed, gap };
}
// The placed shot that is farthest from the keeper's reach: the aim point (y on the line at gx).
export function placedAim(from, k, gx = L) {
  const ys = [gy1 - .55, gy0 + .55];
  if (!k) return clamp(from.y, gy0 + .8, gy1 - .8);
  return ys.map(y => ({ y, g: closestOnLane(k, from, { x: gx, y }, 0).d })).sort((p, q) => q.g - p.g)[0].y;
}
// Where a save that spills ends up: 2 to 4 m out from where he stopped it, back toward the side the shot came from
// (`len` and `turn` fixed by the scene).
export function spill(at, from, len = 3, turn = .35) {
  const dx = from.x - at.x, dy = from.y - at.y, l = Math.hypot(dx, dy) || 1, c = Math.cos(turn), s = Math.sin(turn);
  return { x: at.x + (dx * c - dy * s) / l * len, y: clamp(at.y + (dx * s + dy * c) / l * len, 1, W - 1) };
}
