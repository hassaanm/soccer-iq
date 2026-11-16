// Shots at a goal (v62, six targets and a keeper who dives since v64): where one goes and what stops it. One function,
// shotResult, says what a shot does, and everything asks it: the generator grades a lesson's scene with it, the game
// plays his shots, their shots and the shots the game plays by itself with it, and the audits check it.
// In a lesson nothing here is random: the scene fixes what varies (where the keeper stands, how far a laces shot strays,
// whether a save is held or spills), so the same choice in the same scene always ends the same way, and the result
// follows from the picture (inside his reach: saved). In a match a seeded random stream (`rand`) gives each shot its
// chances from a small table (v64 research, section 3): by where the target is from the keeper (at him, beside him,
// away from him), low or high, the foot, and close or far. Now and then, in a close 1v1, the keeper guesses a side.
import { PITCH, gy0, gy1, W, L, clamp, closestOnLane, sizeOf } from './geom.js';

// A recreational keeper aged 6 to 8 (v62 research, section 7): arms out he covers about a third of the goal (reach, m
// from his middle, a 5 m goal), he reacts a moment after the kick (react, s) and then steps or dives toward the ball at
// `speed` m/s. Getting down to a low ball takes him `down` s more, and going up for a high one `up` s more: a low shot
// is the hardest for him to get to. A ball within `catchR` of his middle he takes standing. He stands on his line or up
// to `off` m off it.
export const GK = { reach: .8, react: .3, speed: 2.6, off: 1, down: .2, up: .1, catchR: .35 };
// The two shots he can choose (no meters, no timing: a choice). Inside of the foot: slower, low, goes where it is aimed.
// Laces: fast, but it strays: in a lesson `stray` m to the outside of the aim (fixed per scene); in a match up to
// `wild` m either way (and its misses, CHANCE, are more). From close it flies over the bar (a lesson: always).
export const FOOT = { in: { speed: 8, arc: .06, wild: .12 }, las: { speed: 19, arc: .3, wild: .45 } };
// Distances (m from where he strikes it to the middle of the goal): inside the box use the inside of the foot; the edge
// of the box (CLOSE to EDGE) the laces; farther, get closer first ("too far to shoot", as grade() already says).
export const CLOSE = 8, EDGE = 12.5;
// A shot the game plays by itself (a friend's, or his own run on goal, or theirs at our goal): hard and placed in the
// biggest space, low, never over the bar.
export const PLACED = { speed: 17, arc: .5, wild: 0 };
// A match's chances (v64 research, section 3, "my estimate" there: tuned to teach, not measured): [save, miss] for
// each foot, close (CLOSE m or less) or far, and where the target is from the keeper: at him (low or high), beside
// him or away from him, low (L) or high (T). Miss: over the bar or wide. Everything else goes in. Two changes from the
// research's table, so a well-chosen shot (low, away, the right foot) scores about 9 in 10 from far too: laces, far,
// away low [.05, .06] (research: [.10, .15]) and away high [.08, .3] (research [.10, .35]).
export const CHANCE = {
  in: { close: { at: [.9, .02], besideL: [.45, .03], besideT: [.6, .15], awayL: [.05, .05], awayT: [.15, .2] },
    far: { at: [.95, .02], besideL: [.7, .03], besideT: [.8, .15], awayL: [.35, .05], awayT: [.45, .2] } },
  las: { close: { at: [.75, .1], besideL: [.25, .25], besideT: [.3, .5], awayL: [.05, .3], awayT: [.05, .6] },
    far: { at: [.8, .08], besideL: [.35, .12], besideT: [.4, .3], awayL: [.05, .06], awayT: [.08, .3] } },
};
// A column counts as "beside him" when the ball's way passes within BESIDE m of his middle (his reach and a step); the
// column nearest him is "at him"; the rest are "away".
export const BESIDE = 1.3;
// The keeper's guess (matches only): in a close 1v1 (DUEL m or closer, nobody else in the way) he goes early to one side
// GUESS of the time, about GUESS_T s before the kick (a lean and a step a watching child can see); to the bigger space
// GUESS_BIG of the time. A ball to the side he went he saves GUESS_SAVE of the time; one to the other side or the middle
// goes in. (The research said 1 in 4, always to the bigger space: with that a well-chosen shot in a 1v1 scored only 3 in
// 4. With these numbers it scores about 0.86 in a 1v1 and about 0.9 overall.)
export const DUEL = 6, GUESS = .1, GUESS_BIG = .6, GUESS_SAVE = .75, GUESS_T = .3;
// A save he takes standing or with a step is held CATCH of the time; a dive, DIVE_CATCH; a hard shot (laces) at him
// spills half the time (a rebound: "Follow your shot!").
export const CATCH = .8, DIVE_CATCH = .4, HARD_CATCH = .5;
export const keeperOn = () => sizeOf().keeper;

// ---------- the six targets ----------
// The goal at x = L as he sees it facing it: columns L (his left, +y), M, R; rows low (L, M, R) and top (TL, TM, TR).
// Each column is IN m inside the post (the middle: the goal's middle); the low row is a ball along the grass (LOW_Z,
// the height its target is drawn at), the top row TOP m under the bar.
export const ZONES = ['TL', 'TM', 'TR', 'L', 'M', 'R'];
const IN = .75, TOP = .48;
export const LOW_Z = .3;
export const zone = id => {
  const c = id.slice(-1), top = id.length > 1;
  return { id, top, col: c, y: c === 'L' ? gy1 - IN : c === 'R' ? gy0 + IN : (gy0 + gy1) / 2, z: top ? PITCH.gh - TOP : LOW_Z };
};
export const spaces = () => ZONES.map(zone);
export const spaceY = id => zone(id).y;
// The foot the rule says, from where he is.
export const rightFoot = from => (Math.hypot((PITCH.L) - from.x, W / 2 - from.y) <= CLOSE ? 'in' : 'las');
// A seeded stream of numbers from 0 to 1 (a match's chances: the same play gives the same numbers).
export const stream = seed => { let s = Math.floor(seed * 4294967296) >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };

// ---------- what a shot does ----------
// Where each column is from the keeper, for a shot from `from`: { L: 'at' | 'beside' | 'away', M, R } (null: no keeper).
export function relations(from, k, gx = L) {
  if (!k) return null;
  const ds = ['L', 'M', 'R'].map(c => [c, closestOnLane(k, from, { x: gx, y: zone(c).y }, 0).d]), near = ds.reduce((p, q) => (q[1] < p[1] ? q : p))[0];
  return Object.fromEntries(ds.map(([c, d]) => [c, c === near ? 'at' : d < BESIDE ? 'beside' : 'away']));
}
// shotResult({ from, zone, foot, k, ... }) says what happens to a shot struck from `from` (x, y on the pitch):
//   zone      'TL' 'TM' 'TR' 'L' 'M' 'R', or y (and z) for an aim that is not one of them (a placed shot)
//   foot      'in', 'las' or 'placed'
//   k         the keeper of that goal ({ x, y }) or null; `down`: he is on the grass (after a dive), he saves nothing
//   gx        the goal line (L: theirs, 0: ours)
//   rand      a seeded stream (a match: CHANCE), or null (a lesson: no chance at all, the picture decides)
//   duel      a close 1v1 (a match: the keeper may guess)
//   stray     a lesson's laces stray (m, to the outside of the aim; the middle strays to the left)
//   defs      their players ({ x, y }) who may run back to the ball's path (a slow shot can be reached; his own shots)
//   spill     a lesson's save spills (a rebound) rather than being held
//   force     'save' or 'goal': what must happen (their shots at our keeper keep OUR_SAVE, game/keeper.js); the rest
//             (where it goes, what he does) still follows from the picture
// Returns { res: 'goal' | 'save' | 'over' | 'wide' | 'cleared', held (a save he keeps; else it spills out), act: what
// the keeper does ('stay' he blocks it with his body, 'reach' a step and both hands, 'low' down to it along the grass,
// 'high' a dive up to it, 'wrong' a guess to the other side, 'watch' it goes over or wide, 'none' no keeper), dir: the
// side he goes to (+1 toward +y), guess (+1/-1 the side he guessed early, 0 none), rel ('at', 'beside', 'away'), to:
// where it crosses the line or ends { x, y, z }, at: where it is stopped { x, y, z } (a save: in his hands; cleared: at
// the defender), t: when it gets there (s), speed, arc, d: how far it flies to the line, gap: how far past his reach it
// goes (m; negative: inside it), top, zone, by }.
export function shotResult({ from, zone: zid = null, y: aimY = null, z: aimZ = LOW_Z, foot, k = null, gx = L, rand = null, duel = false, stray = .3, defs = [], DEF_RUN = 4.8, spill = false, force = null, down = false }) {
  const F = foot === 'placed' ? PLACED : FOOT[foot], Z = zid ? zone(zid) : { y: aimY, z: aimZ, top: aimZ > 1, col: null }, mid = (gy0 + gy1) / 2;
  const match = !!rand && foot !== 'placed' && !force, top = !!Z.top;
  let y = Z.y, z = Z.z;
  // Where it really goes: a lesson's laces stray to the outside of the aim; in a match, a little either way.
  if (!rand) { if (foot === 'las') y += stray * (Math.sign(Z.y - mid) || 1); }
  else if (F.wild) y = clamp(y + (rand() + rand() - 1) * F.wild, gy0 + .25, gy1 - .25);
  const band = Math.hypot(gx - from.x, mid - from.y) <= CLOSE ? 'close' : 'far'; // (as the rule for the foot measures it)
  const rel = k && Z.col ? relations(from, k, gx)[Z.col] : null;
  // A match: the table says how it ends (a miss, a save or a goal); a guess comes first.
  let fate = null, guess = 0;
  if (match && k && !down) {
    const cols = relations(from, k, gx), big = ['L', 'R'].find(c => cols[c] === 'away' && Math.abs(zone(c).y - k.y) >= Math.abs(zone(c === 'L' ? 'R' : 'L').y - k.y)) || 'L';
    if (duel && rand() < GUESS) guess = (rand() < GUESS_BIG ? 1 : -1) * (Math.sign(zone(big).y - k.y) || 1);
    const [ps, pm] = CHANCE[foot][band][rel === 'at' ? 'at' : rel + (top ? 'T' : 'L')] || [0, 0], u = rand();
    const ballSide = Math.sign(y - k.y), wide = Math.abs(y - k.y) > GK.catchR;
    fate = u < pm ? 'miss' : guess ? (wide && ballSide === guess && rand() < GUESS_SAVE ? 'save' : 'goal') : u < pm + ps ? 'save' : 'goal';
    if (fate === 'miss') { // over the bar (a high one, or laces from close), else wide of the post on its side
      if (top || (foot === 'las' && band === 'close')) z = PITCH.gh + .35 + rand() * .3;
      else y = Math.sign(y - mid || 1) * (gy1 - gy0) / 2 + mid + Math.sign(y - mid || 1) * (.3 + rand() * .3);
    }
  }
  const d = Math.hypot(gx - from.x, y - from.y), to = { x: gx, y, z };
  const base = { to, speed: F.speed, arc: F.arc, d, top, zone: zid, guess, held: false, by: null, rel };
  const fly = { ...base, t: d / F.speed, gap: 9, act: k ? 'watch' : 'none', dir: k ? Math.sign(y - k.y) || 1 : 1 };
  if (!force) {
    if (!rand && foot === 'las' && band === 'close') return { ...fly, res: 'over' }; // a lesson: laces from close (as the rule for the foot measures it) rise over the bar
    if (z > PITCH.gh - .1) return { ...fly, res: 'over', act: guess ? 'wrong' : fly.act, dir: guess || fly.dir };
    if (y < gy0 + .1 || y > gy1 - .1) return { ...fly, res: 'wide', act: guess ? 'wrong' : fly.act, dir: guess || fly.dir };
  }
  let gap = 9, c = null, t = d / F.speed;
  if (k) {
    // The point on its way nearest him, when it gets there, and how far he gets in that time (less for a low ball: he
    // has to get down to it; a little less for a high one).
    c = closestOnLane(k, from, to, 0); t = Math.hypot(c.x - from.x, c.y - from.y) / F.speed;
    gap = c.d - (GK.reach + Math.max(0, t - GK.react - (foot === 'placed' ? 0 : top ? GK.up : GK.down)) * GK.speed); // (a placed shot: as v62 measured it)
  }
  const dy = c ? c.y - k.y : 0, dir = Math.sign(dy) || 1;
  const at = c && { x: c.x, y: c.y, z: z * clamp(Math.hypot(c.x - from.x, c.y - from.y) / (d || 1), 0, 1) };
  let res = 'goal';
  if (k && force) res = force;
  else if (k && !down && foot !== 'placed') res = fate ? fate : gap <= 0 || rel === 'at' ? 'save' : 'goal'; // (a lesson: inside his reach is a save, and so is a ball at him: he blocks it)
  if (res === 'goal' && foot !== 'placed' && !force && fate !== 'goal') for (const o of defs) { // a defender running back gets to a slow shot before it is in
    const q = closestOnLane(o, from, to, .3), tb = Math.hypot(q.x - from.x, q.y - from.y) / F.speed, td = q.d / DEF_RUN + .2;
    if (td < tb - .1) return { ...base, res: 'cleared', at: { x: q.x, y: q.y, z: 0 }, t: tb, by: o, gap, act: k ? 'watch' : 'none', dir };
  }
  if (!k) return { ...base, res: 'goal', t: d / F.speed, gap, act: 'none', dir: 1 };
  if (res === 'save') {
    // What he does: a ball at his body he blocks standing; one within his reach, a step and both hands; farther, down to
    // it along the grass (slowly: getting down is hard for him) or a dive up to a high one.
    const act = Math.abs(dy) <= GK.catchR ? 'stay' : Math.abs(dy) <= GK.reach + .15 ? 'reach' : top ? 'high' : 'low';
    const held = !rand ? !spill : rand() < (foot === 'las' && act === 'stay' ? HARD_CATCH : act === 'stay' || act === 'reach' ? CATCH : DIVE_CATCH);
    return { ...base, res, held, act, dir: guess || dir, at, t, gap };
  }
  // In: past his dive (or past his guess the other way).
  const act = guess && (guess !== dir || Math.abs(dy) <= GK.catchR) ? 'wrong' : Math.abs(dy) <= GK.reach + .15 ? 'reach' : top ? 'high' : 'low';
  return { ...base, res: 'goal', act, dir: guess || dir, at, t: d / F.speed, tk: t, gap };
}
// The old way of asking (an aim y on the line, a low ball): the shots the game plays by itself, and the generator's
// checks that a placed shot still beats the keeper.
export function resolve(from, aimY, foot, k = null, { gx = L, stray = 0, defs = [], DEF_RUN = 4.8 } = {}) {
  return shotResult({ from, y: aimY, z: LOW_Z, foot, k, gx, stray, defs, DEF_RUN });
}
// How good a target is as a choice (deterministic, as a lesson grades it, with the right foot from there).
// Research grades (v64): low and away best; high and away okay (it can go over); low beside him okay if it beats him;
// at him, or high beside him, wrong. Never best for a high one.
export function zoneGrade(from, zid, k, { stray = .35, defs = [], DEF_RUN = 4.8, gx = L } = {}) {
  const r = shotResult({ from, zone: zid, foot: rightFoot(from), k, stray, defs, DEF_RUN, gx }), Z = zone(zid);
  if (r.res !== 'goal' && r.res !== 'cleared') return 'bad';
  if (r.res === 'cleared') return 'bad';
  const rel = r.rel || 'away';
  return rel === 'at' || (rel === 'beside' && Z.top) ? 'bad' : rel === 'away' && !Z.top ? 'best' : 'okay';
}
// The target a shot of his own goes to when he does not pick one (the lesson about it not passed yet): the low one
// farthest outside the keeper's reach for a true (inside of the foot) shot; with no keeper, as SHOOT always aimed.
export const bestZone = (from, k) => ['L', 'R', 'M'].map(id => ({ id, g: shotResult({ from, zone: id, foot: 'in', k }).gap })).sort((p, q) => q.g - p.g)[0].id;
export const bestSpaceY = (from, k) => (k ? spaceY(bestZone(from, k)) : clamp(from.y, gy0 + .8, gy1 - .8));
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
