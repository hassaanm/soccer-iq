// (round 11, 12) Which lines a mode can say: see ui/voicewarm.js, which loads them. No sound code here, so the tests can read it.
import { ALL_LESSONS } from './skills.js';
import { OKAY, BAD } from './generate.js';
import { MOVE_NAME } from './flair.js';
import { EXPLAIN, SKILL_TIP, SAW } from './game/skill.js';
import { TIMEOUT } from './game/rounds.js';
import { SAVED, WHY, SAID } from './saves.js';
import { MINI, MINI_SAID } from './mini/games.js';
import { PEN_SAID, PEN_WHY } from './mini/pens.js';
import { PZ_SAID, PZ_WHY, PZ_IDEA } from './mini/puzzle.js';
import { DASH_SAID } from './mini/dash.js'; // (v96: dribble dash)

export const clean = t => t.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '').trim();
export const fill = t => t.replaceAll('{m0}', 'Saka').replaceAll('{m1}', 'Rice').replaceAll('{m2}', 'Saka'); // (a friend's name is its own clip, loaded with the teams: flows.js setStage)
const SHARED = ['{m0} was open!', 'That was a tough spot!', 'Lots of space! Push it and go!', 'There was space to run into!',
  'Nobody was in front of the ball. Get in front!', 'Your friends had it covered. Stay close!', 'A friend was on the ball. Guard the open player!',
  'Pass and go! Run past him into the space.', 'Run to the goal, so your friend can pass to you!', 'Move to open space so your friend can pass to you!', 'Wait in front of him. Steal it when it rolls away from his feet!',
  'Saved!', 'So close!', 'Good space! Close? Inside, for control.', 'Good space! Far? Laces, for power!', 'Right side! But high can go over. Keep it low.', 'He can reach that one. Find the big space.',
  'Goal! Close up, inside is safer.', 'Close? Inside is safer.', 'Look at the goal. Where is the keeper?', 'Look at the goal. Nobody in the way!', // (v73: the shooting lessons)
  'Your turn!', 'Mini match!', 'New in matches!', 'Watch this way!', 'Here is the 3-star play!', 'Watch {m0}.', '{m0} looks up.', '{m0} is open!', '{m0} is running!', 'Great pass!', 'And looks around for a friend.', 'Pass!', 'Look left.', 'Look right.', 'Check your shoulder!',
  'See who is open?', 'Where is the space?', 'Where is the ball?', 'Where is the goal?', 'Off the post!', 'Blocked!', 'Goal ahead!', 'Only one defender!', 'Space ahead!',
  'You won the ball!', 'Watch the ball.', 'Now run past him!', 'Peek over your shoulder.', 'A defender is behind you! Turn away!', 'Nobody behind you! Turn and go!', 'Turn away from him!', 'Turn and go!',
  'Match time!', 'The final!', 'You won the cup!', 'You won! On to the next round!', 'So close! Try again!', 'You won! You got a new sticker!', 'Great try! You got a new sticker!', 'What do you want to play?',
  'You won the match!', 'Good game!', 'Nice pass! You looked up!', 'You looked up!', 'You looked early!', 'You peeked!', 'Great defending!', 'Great run!', 'Great choice!', 'Great steal!', "Today's training!", 'Training done!'];
const shared = () => [...SHARED, TIMEOUT.first, TIMEOUT.again, ...['restart', 'defense', 'off', 'receive', 'follow'].flatMap(k => [TIMEOUT[k]?.first, TIMEOUT[k]?.again]),
  ...Object.values(MOVE_NAME).map(n => n + '!'), EXPLAIN, SKILL_TIP, SAW, ...Object.values(OKAY), ...Object.values(BAD)];

// A round list (a lesson's, a training's, a match's): the shared lines, each scene's cue and what is said about it.
export function linesFor(scenes = []) {
  const lines = shared(), ids = new Set();
  for (const sc of scenes) { ids.add(sc.skill); for (const c of [sc.cue, sc.then?.cue]) if (c) lines.push(c, 'You kept it! Even better: ' + fill(c).replace(/^./, ch => ch.toLowerCase())); }
  for (const s of ALL_LESSONS) if (ids.has(s.id)) lines.push(s.kid, s.tip);
  return lines;
}
export const keeperLines = () => [SAVED, ...Object.values(WHY), ...Object.values(SAID), 'What do you want to play?', 'You won! You got a new sticker!', 'Great try! You got a new sticker!', ...miniLines()];
// (v87) The mini games' own lines (the screen, the end of a run, penalties): loaded with the keeper game's.
export const miniLines = () => [...MINI.map(g => g.say), ...Object.values(MINI_SAID), ...Object.values(PEN_SAID), ...Object.values(PEN_WHY), ...MINI.flatMap(g => g.lines || []), ...puzzleLines(), ...Object.values(DASH_SAID)]; // (v88: a game's own lines, games.js `lines`; v90: the puzzles' lines)
const puzzleLines = () => [...Object.values(PZ_SAID), ...Object.values(PZ_WHY), ...Object.values(PZ_IDEA)]; // (v90: soccer puzzles)
