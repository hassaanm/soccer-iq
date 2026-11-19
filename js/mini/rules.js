// The rules every mini game shares (v87): a run is endless; he has LIVES lives; each success adds one to his score and
// STEP of a level to the difficulty; a miss costs a life; the run ends with the last life. His best score per game is
// kept in the save (progress.js miniDone). No page and no clock here, so the tests and the bots use it as it is.
export const LIVES = 2;
// Difficulty: a third of a level for every success, so it rises a little with each one and never in a jump (the owner,
// 2026-11-19: "smooth, not a wall"). Each game turns the level into its own numbers in one function (saves.js
// keeperLevel, mini/pens.js penLevel).
export const STEP = 1 / 3;
export const newRun = (lives = LIVES) => ({ score: 0, lives, lost: 0, level: 0, n: 0, over: false });
// One attempt is over: a success (true) or a miss (false). Returns the run (changed in place).
export function attempt(run, success) {
  if (run.over) return run;
  run.n++;
  if (success) { run.score++; run.level = run.score * STEP; } else { run.lives--; run.lost++; if (run.lives <= 0) { run.lives = 0; run.over = true; } }
  return run;
}
// A smooth fall from `a` at level 0 toward `b` (never reaching it): most of the way by about 3 × `k` levels. Every curve
// of the games is one of these, so each moves a little with every success and never backward.
export const ease = (a, b, k) => L => b + (a - b) * Math.exp(-Math.max(0, L) / k);
// A share that starts at `from` levels and rises by `per` a level up to `max`.
export const ramp = (from, per, max) => L => Math.max(0, Math.min(max, (L - from) * per));
