// Constants and small helpers that more than one part of Game uses (see js/game.js for how the parts join up).
import { PITCH } from '../skills.js';
import { DRIBBLE_DIRS } from '../geom.js';

export const { L, W, gy0, gy1 } = PITCH;
export const MATE = { 'pass:0': 'm1', 'pass:1': 'm2' };
export const MATES = ['m1', 'm2'], DIRS = Object.keys(DRIBBLE_DIRS);
export const NONE = Object.freeze([]); // "nothing to show", shared so no new list is made each frame
// Rounds where he taps a spot on the field: where to run (defending, or getting open while a friend has the ball),
// or where to pass (in front of a running friend).
export const spotKind = sc => sc?.kind === 'defense' || sc?.kind === 'support' || sc?.kind === 'lead';
// Rounds where he faces the ball carrier instead of the goal: running to a spot, or the 1v1 steal.
export const facesBall = sc => (spotKind(sc) && sc.kind !== 'lead') || sc?.kind === 'tackle' || sc?.kind === 'receive';
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// Turns player `a` to face the point (x, y).
export const faceTo = (a, x, y) => { const dx = x - a.x, dy = y - a.y, l = Math.hypot(dx, dy) || 1; a.face = [dx / l, dy / l]; };
