// Fast mode's level follows the child (v86): the other team's strength (match.js oppOf) is his own, saved per team size
// (js/progress.js fastLevel), starting at LEVELS. After each match it moves a small step: up a little after a win, more
// after a clear win, down a little after a loss, more after a heavy loss, never past LEVEL_MIN or LEVEL_MAX. So it keeps
// getting harder smoothly while he wins, eases when he struggles, and settles where he wins about half: his own limit.
// What he sees never goes down: stars for the best level he has reached (a new star for each step up past it), five to
// a row, a medal for each full row. No page here: the tests and the bots use it as it is.
import { LEVELS, LEVEL_MIN, LEVEL_MAX } from './match.js';
import { clamp } from './rules.js';

export const UP = .06, UP_CLEAR = .1, DOWN = .05, DOWN_HEAVY = .09, CLEAR = 2; // (CLEAR: a win or a loss by this many goals or more)
export const startLevel = size => LEVELS[size] ?? 0;
// The level after a match that ended `score` ({ us, them }). A draw (the next goal tied it) leaves it as it was.
export function levelAfter(level, score) {
  const d = score.us - score.them, step = d >= CLEAR ? UP_CLEAR : d > 0 ? UP : d <= -CLEAR ? -DOWN_HEAVY : d < 0 ? -DOWN : 0;
  return +clamp(level + step, LEVEL_MIN, LEVEL_MAX).toFixed(3);
}
// The stars he has: one for each step of UP past where he started at this size, by the best level he reached.
export const STAR = UP, ROW = 5;
export function stars(best, size) {
  const n = Math.max(0, Math.floor((best - startLevel(size)) / STAR + 1e-6));
  return { n, row: n % ROW, medals: Math.floor(n / ROW), lv: n + 1 };
}
// The badge: a medal count, then a row of five stars (the ones he has filled, the newest `fresh` popping in). Its label
// says the level for a grown-up ("Level 4"); the number only ever goes up.
export function badge(best, size, fresh = 0) {
  const s = stars(best, size), on = s.row === 0 && s.n > 0 && fresh > 0 ? ROW : s.row, from = on - Math.min(fresh, on); // (a row he has just filled shows full once, by its new medal)
  const row = Array.from({ length: ROW }, (_, i) => `<i class="${i < on ? 'on' : ''}${i >= from && i < on ? ' new' : ''}" style="--i:${i - from}">★</i>`).join('');
  return `<span class="fLevel" role="img" aria-label="Level ${s.lv}">${s.medals ? `<b class="med">🏅${s.medals > 1 ? `<small>×${s.medals}</small>` : ''}</b>` : ''}<span class="stars">${row}</span><small class="lv">Lv ${s.lv}</small></span>`;
}
