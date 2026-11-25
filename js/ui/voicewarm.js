// (round 11) The lines a mode can say are fetched and decoded as the mode starts (while its intro, demo or first
// run-up shows), so no line is fetched or decoded in a frame of play: the lines every mode shares, this round list's
// own cues and its lessons' names and tips; the keeper game's lines for the keeper game. Not all 479 clips: decoded,
// they would be over 100 MB. (The list of shared lines is the fixed part of tests/spoken.js, which the recordings are
// made from; a line missing here is still said, fetched as it is needed, and shows in the speed record as voice-fetch.)
// (v93) A mini game loads only its own lines (v92 loaded every mini game's and the keeper game's, 47 to 58 clips, for
// each), from the moment its tile is touched (its name is said first, then its card), and sound.js loads them one at a
// time, a frame apart. A game's lines are every string its own module exports (its said lines and its reasons): a line
// added there is loaded with no change here, and a string with no recording loads nothing.
import { preloadClips } from '../sound.js';
import { pieces, clipKey } from '../voice.js';
import { linesFor, clean, fill } from '../voicelines.js';
import { MINI, MINI_SAID } from '../mini/games.js';
import { MOVE_NAME } from '../flair.js';
import { P } from './store.js';
import * as Saves from '../saves.js';
import * as Pens from '../mini/pens.js';
import * as Rondo from '../mini/rondo.js';
import * as Puzzle from '../mini/puzzle.js';
import * as Open from '../mini/open.js'; // (v96)

const load = lines => preloadClips([...new Set(lines.filter(l => typeof l === 'string' && l).map(l => clean(fill(l))).flatMap(l => pieces(l).map(clipKey)))]);
export function warmVoice(scenes = []) { try { load(linesFor(scenes)); } catch (e) { console.error(e); } }

// Every string a module exports, alone or as a value of an exported object (its said lines: PEN_SAID, PEN_WHY…).
const strings = ns => Object.values(ns).flatMap(v => (typeof v === 'string' ? [v] : v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).filter(x => typeof x === 'string') : []));
// What Fast mode and Score attack say (js/fast/fast.js, js/mini/attack-ui.js), and the end of a Fast match.
const FAST = ['Great choice!', 'Great pass!', 'Where is the ball?', 'Great steal!', 'Check your shoulder!', 'Saved!', 'So close!', 'Next goal wins!', 'Match time!',
  'You won the match!', 'Good game!', 'What do you want to play?', ...Object.values(MOVE_NAME).map(n => n + '!'), 'Skill!'];
const OWN = { keeper: () => strings(Saves), pens: () => strings(Pens), rondoKeep: () => strings(Rondo), rondoWin: () => strings(Rondo), puzzles: () => strings(Puzzle), whoOpen: () => strings(Open), attack: () => FAST, fast: () => [...FAST, ...strings(Saves)] };
// A mini game's lines, in the order they are needed: its name (said as its tile is touched), its own lines, then the end
// of a run (mini/run.js). `fast`: a Fast match (and his keeper's moment in it, at 5v5).
export function gameLines(id) {
  const g = MINI.find(x => x.id === id);
  if (id === 'fast') return OWN.fast();
  return [g?.say, ...(g?.lines || []), ...(OWN[id]?.() || []), ...Object.values(MINI_SAID), 'Great try! You got a new sticker!', 'What do you want to play?'];
}
export function warmMini(id) { try { load(gameLines(id)); } catch (e) { console.error(e); } }
// (v93) The mini game whose tile was touched last: the games call warmKeeper() as they start, with no name.
let lastGame = null;
export function warmKeeper(id) { warmMini(id || lastGame || 'keeper'); }
if (typeof addEventListener === 'function') addEventListener('pointerdown', e => {
  try {
    const tile = e.target?.closest?.('#minis [data-id]');
    if (tile) { lastGame = tile.dataset.id; warmMini(lastGame); }
    else if (e.target?.closest?.('#freeBtn') && P.settings?.mode === 'fast') warmMini('fast'); // (a Fast match: its card shows while they load)
  } catch { /* the lines load as they are needed */ }
}, true);
