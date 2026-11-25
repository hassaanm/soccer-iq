// Constants and small helpers that more than one part of Game uses (see js/game.js for how the parts join up).
import { DRIBBLE_DIRS } from '../geom.js';

export { L, W, gy0, gy1 } from '../geom.js'; // live: the pitch of the size being played (geom.js setSize)
export const MATE = { 'pass:0': 'm1', 'pass:1': 'm2', 'pass:2': 'm3' }; // (m3 plays at 4v4)
export const MATES = ['m1', 'm2', 'm3'], DIRS = Object.keys(DRIBBLE_DIRS);
// Which of his team's players (teams.js, by place in the list) each sim id is, before any takeover in a match.
export const ROSTER = { hero: 0, m1: 1, m2: 2, m3: 3 };
export const NONE = Object.freeze([]); // "nothing to show", shared so no new list is made each frame
// Rounds where he taps a spot on the field: where to run (defending, or getting open while a friend has the ball),
// or where to pass (in front of a running friend).
export const spotKind = sc => sc?.kind === 'defense' || sc?.kind === 'support' || sc?.kind === 'lead';
// Rounds where he faces the ball carrier instead of the goal: running to a spot, or the 1v1 steal.
export const facesBall = sc => (spotKind(sc) && sc.kind !== 'lead') || sc?.kind === 'tackle' || sc?.kind === 'receive';
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// Turns player `a` to face the point (x, y).
export const faceTo = (a, x, y) => { const dx = x - a.x, dy = y - a.y, l = Math.hypot(dx, dy) || 1; a.face = [dx / l, dy / l]; };
// (v96) The lens (focal length, px) for a view `c` ({ Ff, Fw, Fa }) on a w x h picture, as world.js draws it: from the
// height (Ff) and the width (Fw), whichever is longer, so a wide phone does not see more of the field. `Fa` (the player's
// own views, game/view.js): on a screen narrower than a phone's (an iPad's 4:3, a square window), the field is never taller
// than at aspect Fa (the phone the game is tuned for, PHONE): his player and the ball fill the same share of the height,
// and the screen shows less to the sides, not more above and below him (the owner on a square window: "a bird's-eye view,
// very high up"). It starts below FA_FROM (1.75: a 16:9 phone and every wider one are as before) and is whole by FA_FULL.
export const PHONE = 932 / 430, FA_FROM = 1.75, FA_FULL = 1.45;
export function focal(w, h, c) {
  const F = Math.max(h * c.Ff, w * (c.Fw || 0)), a = w / h;
  if (!c.Fa || !c.Fw || a >= FA_FROM) return F;
  const t = Math.min(1, (FA_FROM - a) / (FA_FROM - FA_FULL)), k = t * t * (3 - 2 * t);
  return Math.max(F, h * c.Fw * (a + (Math.max(a, c.Fa) - a) * k));
}
