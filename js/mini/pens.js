// Penalties (v87; v93 a timing game), a mini game: he takes penalty kicks, seen from behind the ball. His player runs up
// by himself; he taps one of the six targets in the goal while he runs. The keeper is a player to beat, as in a real
// penalty (keepers read the taker's hips, eyes and standing foot; takers either pick a spot early or wait to the last
// moment):
//   - the keeper never commits before the kick: he stays on his line, alive (small steps), and dives as it is struck;
//   - a tap early in the run-up shows on the taker's body (he turns and looks at the corner: his eyes over his head),
//     and the longer it shows the more often the keeper reads it, more and more as the level rises;
//   - a tap in the last moment (the plant: the ball flashes) is too late to read: the keeper has to guess;
//   - no tap: a soft one down the middle, saved; a shot at the middle is near him, saved; the corners are the answer;
//   - a top corner tapped in the very last moment (rushed) hits the post.
// The keeper's guesses come from numbers drawn when the kick is planned (penKick), so a kick and its taps always end
// the same way. Nothing here needs a page: mini/penalty.js plays it, the tests and the bots use it as it is. The goal is
// the 5v5 goal at every size (saves.js GOAL), our end of the pitch (x = 0).
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
export const sideU = side => (side === 'L' ? -1 : side === 'R' ? 1 : 0); // the side he sees, as the sign of u

// ---------- how hard, by level (a third of a level a goal: mini/rules.js) ----------
// The one place to tune it. Everything moves a little with each goal and never back:
//   run       real seconds of the run-up before the last moment (2.0 at first, toward 1.0)
//   late      real seconds of the last moment (the plant, the ball flashing): a tap then cannot be read (0.7, toward 0.3)
//   read      the share of early taps the keeper reads, for one shown long before the last moment (0.35, toward 0.97)
//   lateRead  the share of last-moment taps he reads all the same (none at first; from 2 goals, toward 0.5)
//   stay      when he guesses, the share he stays in the middle (else half each way)
//   low, high when he guesses the right way, the share of low and of top corners he gets to
//   lowR, highR the same when he read it (he goes with a head start)
//   feint     the share of kicks in which he feints one way in the run-up (from 2 goals)
//   rush      real seconds before the kick in which a tap at a top corner is rushed: it hits the post
//   easy      (v93) the first two kicks of a run (no goal yet, or one): forgiving. He holds at the plant with the ball
//             glowing until a tap (up to `hold` real s), the keeper hardly ever reads an early tap and gets to fewer of
//             his guesses. From two goals on, the timing as above.
export const EASY_BELOW = 2 / 3, HOLD = 3, EASY_COVER = .45;
export function penLevel(L) {
  L = Math.max(0, L);
  return {
    run: ease(2, 1, 4)(L), late: ease(.7, .3, 4)(L),
    read: ease(.35, .97, 1.6)(L), lateRead: ramp(2 / 3, .3, .5)(L), stay: .1 + ramp(0, .02, .1)(L),
    low: ease(.6, .97, 1.5)(L - 1 / 3), high: ease(.4, .9, 1.5)(L - 1 / 3), lowR: ease(.88, .98, 1.5)(L), highR: ease(.75, .95, 1.5)(L), // (his reach on a guess starts to grow after the easy kicks)
    feint: ramp(.5, .25, .7)(L), rush: .12, easy: L < EASY_BELOW - 1e-9, hold: L < EASY_BELOW - 1e-9 ? HOLD : 0,
  };
}
// One kick at `level`: the level's numbers and the numbers that decide the keeper's guesses (u: 0..1 each, drawn now).
// r: a stream 0..1 (shot.js stream); n: how many kicks came before; last: not used (kept for the callers' shape).
export function penKick(level, r, n = 0, last = []) {
  const D = penLevel(level), u = { read: r(), guess: r(), cover: r(), feint: r(), fside: r(), alive: r() };
  return { ...D, n, level, u, fake: u.feint < D.feint ? (u.fside < .5 ? 'L' : 'R') : null, fakeAt: .35 + .4 * u.alive };
}
// How long his pick showed before the kick: `when` 'early' (tapped in the run-up, `shown` real seconds before the kick)
// or 'late' (in the last moment). How likely the keeper is to read it.
export function readChance(k, when, shown) {
  if (k.easy) return when === 'late' ? 0 : k.read * .1; // (the first two kicks: an early tap is read only now and then)
  if (when === 'late') return k.lateRead;
  const extra = Math.max(0, shown - k.late);
  return k.read * Math.min(1, .5 + .5 * extra / .8); // (tapped just before the last moment: half as often as one shown long before)
}
// Where the keeper goes as it is struck: 'L' | 'R' (his dive, as he sees it from behind the ball) | 'M' (he stays).
// read: whether he read it.
export function keeperGoes(k, tap, when, shown) {
  if (!tap) return { dive: 'M', read: true }; // (no tap: a soft one at him, he sees it coming)
  const col = target(tap).col;
  if (k.u.read < readChance(k, when, shown)) return { dive: col, read: true };
  const g = k.u.guess, dive = g < k.stay ? 'M' : g < k.stay + (1 - k.stay) / 2 ? 'L' : 'R';
  return { dive, read: false };
}

// ---------- what a kick does ----------
// kickOf(kick, tap, when, shown): tap = the target he picked, or null (no tap: a soft one down the middle).
// Returns { res: 'goal' | 'save' | 'post', why, zone, dive, read }. why: null (a goal) | 'read' (he read his eyes) |
// 'guess' (he guessed the right way) | 'middle' (at him) | 'none' (no tap) | 'rush' (a top corner in the very last moment).
export function kickOf(k, tap, when = 'late', shown = 0) {
  const { dive, read } = keeperGoes(k, tap, when, shown);
  if (!tap) return { res: 'save', why: 'none', zone: 'M', dive, read };
  const T = target(tap);
  if (T.col === 'M') return { res: 'save', why: 'middle', zone: tap, dive: 'M', read };
  if (T.top && T.col !== 'M' && when === 'late' && shown < k.rush) return { res: 'post', why: 'rush', zone: tap, dive, read };
  if (dive !== T.col) return { res: 'goal', why: null, zone: tap, dive, read };
  const reach = (read ? (T.top ? k.highR : k.lowR) : (T.top ? k.high : k.low)) * (k.easy ? EASY_COVER : 1);
  return k.u.cover < reach ? { res: 'save', why: read ? 'read' : 'guess', zone: tap, dive, read } : { res: 'goal', why: null, zone: tap, dive, read, close: true };
}
// What is said (spoken: tests/spoken.js): the first time, after a goal, and the kind line after a miss, by why.
export const PEN_SAID = { intro: 'Tap where to shoot!', goal: 'Goal!' };
export const PEN_WHY = { read: 'He saw where you looked! Tap when the ball flashes.', guess: 'So close!', middle: 'He can reach that one. Find the big space.', none: 'Tap where to shoot!', rush: 'Off the post!' };
// The emoji beside each line (the caption: pictures for a child who cannot read).
export const PEN_PIC = { read: '👀', guess: '🧤', middle: '🧤', none: '👆', rush: '🥅' };
