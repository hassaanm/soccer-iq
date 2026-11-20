// One tap on a mini game's tile starts exactly one thing (v93). In the phone's play log a tile was tapped, its name was
// being said (up to 1.4 s) with the chooser already closed, and the home screen showed and answered a second tap: PLAY
// began a lesson while the mini game started under it. So the chooser stays up, and answers nothing, from the first tap
// until the game itself takes over; only then does it close. No DOM here: the chooser passes in what to do (the test is
// tests/ui-v93.test.js).
export const NAME_WAIT_MS = 1400; // the most the chooser waits for a game's name to be said, so the name is not cut off by the game's first words

export function makeStarter({ say, pick, closeSheet, run, wait = ms => new Promise(r => setTimeout(r, ms)), onError = e => console.error(e) }) {
  let starting = null;
  const start = async id => {
    if (starting) return false; // a second tap, on the same tile or on another, does nothing
    starting = id;
    try {
      pick?.(id); // the tile lights up and the others dim: the tap was heard
      await Promise.race([Promise.resolve(say(id)), wait(NAME_WAIT_MS)]);
      closeSheet(id); // only now: the game takes over the screen in the same turn
      await run(id);
    } catch (e) { onError(e); } finally { starting = null; pick?.(null); }
    return true;
  };
  start.busy = () => starting !== null;
  return start;
}
