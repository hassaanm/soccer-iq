// One tap on a mini game's tile starts exactly one thing, and the home screen never shows on the way (v93). In the phone's
// play log a tile was tapped, its name was being said (up to 1.4 s) with the chooser already closed, and the home screen
// showed and answered a second tap: PLAY began a lesson while the mini game started under it. So the chooser stays up, and
// answers nothing, from the first tap until the game itself has taken over the screen; only then does it close (handOver),
// in the same turn, so no picture of the home screen is ever drawn between. No DOM here: the chooser passes in what to do
// (the test is tests/ui-v93.test.js).
export const NAME_WAIT_MS = 1400; // the most the chooser waits for a game's name to be said, so the name is not cut off by the game's first words

// Starts `run` (a game: it resolves when the game is over) and closes the chooser when the game has taken the screen
// (`isTaken()`: the home screen is hidden), watching for it with `watch(callback)` (returns a way to stop watching). If the
// game never takes over (it failed, or was busy), the chooser closes when `run` ends.
export async function handOver({ run, isTaken, watch, close }) {
  let p, off = () => {};
  try { p = run(); } catch (e) { close(); throw e; }
  if (isTaken()) close(); else off = watch(() => { if (isTaken()) { off(); close(); } });
  try { await p; } finally { off(); close(); }
}

export function makeStarter({ say, pick, run, isTaken, watch, close, wait = ms => new Promise(r => setTimeout(r, ms)), onError = e => console.error(e) }) {
  let starting = null;
  const start = async id => {
    if (starting) return false; // a second tap, on the same tile or on another, does nothing
    starting = id;
    try {
      pick?.(id); // the tile is lit and pulses, the others dim: the tap was heard
      await Promise.race([Promise.resolve(say(id)), wait(NAME_WAIT_MS)]);
      await handOver({ run: () => run(id), isTaken, watch, close });
    } catch (e) { onError(e); } finally { starting = null; pick?.(null); }
    return true;
  };
  start.busy = () => starting !== null;
  return start;
}
