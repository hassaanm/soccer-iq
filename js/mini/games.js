// The mini games (v87): score chases, apart from the lessons ("Dad, I got this high score"). Each is endless, with two
// lives and a best score kept per game (mini/rules.js). This list is what the Mini games screen shows, in this order:
// one big tile per game, with its picture, its name (said aloud when tapped) and his best.
// To add a game: an entry here (id: its key in the save; name; say: the spoken name, a recorded clip; unit: the
// picture next to its score; pic: the tile's picture, an SVG), and its runner in mini/chooser.js RUN. No page code here,
// so the tests can read it.
import { PIC } from './pics.js'; // (v88: the tiles' pictures, one look for all: mini/pics.js)
import { RONDO_SAID } from './rondo.js'; // (v88: the rondos' spoken lines, recorded with the rest: voicelines.js miniLines)

export const MINI = [
  { id: 'keeper', name: 'Goalkeeper', say: 'Goalkeeper!', unit: '🧤', pic: PIC.keeper },
  { id: 'pens', name: 'Penalties', say: 'Penalties!', unit: '⚽', pic: PIC.pens },
  { id: 'rondoKeep', name: 'Keep the ball', say: 'Keep the ball!', unit: '🔁', pic: PIC.rondoKeep, lines: Object.values(RONDO_SAID) }, // (v88: mini/rondo-ui.js)
  { id: 'rondoWin', name: 'Win the ball', say: 'Win the ball!', unit: '🦶', pic: PIC.rondoWin, lines: Object.values(RONDO_SAID) }, // (v88: mini/rondo-ui.js)
  { id: 'attack', name: 'Score attack', say: 'Score attack!', unit: '⚽', pic: PIC.attack },
  { id: 'puzzles', name: 'Soccer puzzles', say: 'Soccer puzzles!', unit: '🧩', pic: PIC.puzzles }, // (v90: mini/puzzle.js, mini/puzzle-ui.js)
];
export const miniById = id => MINI.find(g => g.id === id);
// What the mini games say (spoken: tests/spoken.js; loaded as a game starts: voicelines.js miniLines).
export const MINI_SAID = { open: 'Mini games!', best: 'New best!', again: 'Good game!' };
