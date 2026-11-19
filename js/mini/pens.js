// Penalties (v87), a mini game: he takes penalty kicks, seen from behind the ball. Before each kick the keeper shows
// where he will go (a step to that side, his eyes looking there, and at the kick a lean into his dive); he taps one of
// the six targets in the goal. A kick to the side the keeper leaves scores; one where the keeper goes is saved, and so
// is one down the middle (the keeper's body is there: "He can reach that one"). The decision: look at the keeper, then
// choose. The tell is honest: where the keeper shows last is always where he goes (tests/mini.test.js). After level 8
// he sometimes fakes: he steps one way first, then at his usual time clearly steps across to the side he will go.
// Nothing here is chance once a kick is planned, and nothing needs a page: mini/penalty.js plays it, the tests and the
// bots use it as it is. The goal is the 5v5 goal at every size (saves.js GOAL), our end of the pitch (x = 0).
import { GOAL } from '../saves.js';
import { LOW_Z } from '../shot.js';
import { ease, ramp } from './rules.js';

export const PEN_X = 7; // m from the goal line to the spot (as the keeper game's penalty)
// The six targets as he sees them from behind the ball: L his left, R his right, T the top row. u: metres across from
// the goal's middle (+u: his right, the keeper's left), z: height. The same places as the keeper game's (saves.js zoneAt).
export const TARGETS = ['TL', 'TM', 'TR', 'L', 'M', 'R'];
const IN = .6, TOP = .4;
export const target = id => { const col = id.slice(-1), top = id.length > 1; return { id, col, top, u: col === 'L' ? IN - GOAL.half : col === 'R' ? GOAL.half - IN : 0, z: top ? GOAL.gh - TOP : LOW_Z }; };
export const other = side => (side === 'L' ? 'R' : 'L');
export const sideU = side => (side === 'L' ? -1 : 1); // the side he sees, as the sign of u

// ---------- how hard, by level (a third of a level a goal: mini/rules.js) ----------
// The one place to tune it. Everything moves a little with each goal and never back:
//   win     real seconds from the targets showing to the kick (4.2 at first, toward 1.0)
//   at      the share of that time before the keeper shows his side (0.1 at first, toward 0.6): later tells
//   step    metres he steps to his side (1.1 at first, toward 0.25): smaller tells
//   stepT   the share of the window his step takes (quicker keeper)
//   eyes    picture seconds his eyes show after a step (99: the whole time, until level 4; then shorter, toward 0.25)
//   arrow   a gold arrow on the grass from his feet to his side (the first few kicks: it teaches what to watch)
//   fakeP   the chance he fakes (from level 8, rising to 0.35): a first step the other way, at `early` of his usual
//           time; his true step comes at the usual time, so the true tell is there as long as without a fake
export function penLevel(L) {
  L = Math.max(0, L);
  return {
    win: ease(4.2, 1, 8)(L), at: .1 + ramp(0, .025, .5)(L), step: ease(1.1, .25, 6)(L), stepT: ease(.24, .1, 8)(L),
    eyes: L < 4 ? 99 : ease(1.4, .25, 6)(L - 4), big: L < 2, arrow: L < 1.5,
    fakeP: ramp(8, .03, .35)(L), early: .45,
  };
}
// One kick at `level`: where the keeper goes (side), whether he fakes first (fake: the side he shows first, or null),
// and the level's numbers. r: a stream 0..1 (shot.js stream); last: the sides of the kicks before, newest last (never four
// to one side in a row, so guessing never pays).
export function penKick(level, r, n = 0, last = []) {
  const D = penLevel(level), run = last.slice(-3);
  let side = r() < .5 ? 'L' : 'R';
  if (run.length === 3 && run.every(s => s === side)) side = other(side);
  const fake = r() < D.fakeP ? other(side) : null;
  return { ...D, n, level, side, fake, fakeStep: D.step * .7 };
}
// The keeper's steps before the kick: [{ f: when (share of the window), u: where he steps to (m across), side }]. The
// last one is always the side he goes.
export function tellSteps(k) {
  const real = { side: k.side, u: sideU(k.side) * k.step };
  if (!k.fake) return [{ f: k.at, ...real }];
  return [{ f: k.at * k.early, side: k.fake, u: sideU(k.fake) * k.fakeStep }, { f: k.at, ...real }];
}
// The side he shows at a share f of the window (null before his first step).
export const showing = (k, f) => { let s = null; for (const t of tellSteps(k)) if (f >= t.f) s = t.side; return s; };
// Real seconds he has from the keeper's last step to the kick: how long the true tell is there to see.
export const readTime = k => k.win * (1 - tellSteps(k).at(-1).f);

// ---------- what a kick does ----------
// kickOf(kick, tap): tap = the target he picked, or null (no tap: a soft one down the middle). Returns { res: 'goal' |
// 'save', why: null | 'side' (where the keeper went) | 'middle' (at the keeper) | 'late' (no tap), zone }.
export function kickOf(k, tap) {
  if (!tap) return { res: 'save', why: 'late', zone: 'M' };
  const col = target(tap).col;
  if (col === other(k.side)) return { res: 'goal', why: null, zone: tap };
  return { res: 'save', why: col === 'M' ? 'middle' : 'side', zone: tap };
}
// The right targets: the side he leaves, high or low.
export const rightTaps = k => TARGETS.filter(id => target(id).col === other(k.side));
// What is said (spoken: tests/spoken.js): the first time, after a goal, and the kind line after a save, by why.
export const PEN_SAID = { intro: 'Watch the keeper. Shoot where he is not!', goal: 'Goal!' };
export const PEN_WHY = { side: 'Good try! Watch the keeper.', middle: 'He can reach that one. Find the big space.', late: 'Tap where to shoot!' };
