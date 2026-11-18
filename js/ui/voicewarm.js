// (round 11) The lines a mode can say are fetched and decoded as the mode starts (while its intro, demo or first
// run-up shows), so no line is fetched or decoded in a frame of play: the lines every mode shares, this round list's
// own cues and its lessons' names and tips; the keeper game's lines for the keeper game. Not all 479 clips: decoded,
// they would be over 100 MB. (The list of shared lines is the fixed part of tests/spoken.js, which the recordings are
// made from; a line missing here is still said, fetched as it is needed, and shows in the speed record as voice-fetch.)
import { preloadClips } from '../sound.js';
import { pieces, clipKey } from '../voice.js';
import { ALL_LESSONS } from '../skills.js';
import { OKAY, BAD } from '../generate.js';
import { MOVE_NAME } from '../flair.js';
import { EXPLAIN } from '../game/skill.js';
import { TIMEOUT } from '../game/rounds.js';
import { SAVED, WHY, SAID } from '../saves.js';

const clean = t => t.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '').trim();
const fill = t => t.replaceAll('{m0}', 'Saka').replaceAll('{m1}', 'Rice').replaceAll('{m2}', 'Saka'); // (a friend's name is its own clip, loaded with the teams: flows.js setStage)
const SHARED = ['{m0} was open!', 'That was a tough spot!', 'Lots of space! Push it and go!', 'There was space to run into!',
  'Nobody was in front of the ball. Get in front!', 'Your friends had it covered. Stay close!', 'A friend was on the ball. Guard the open player!',
  'Pass and go! Run past him into the space.', 'Run to the goal, so your friend can pass to you!', 'Move to open space so your friend can pass to you!', 'Wait in front of him. Steal it when it rolls away from his feet!',
  'Saved!', 'So close!', 'Good space! Close? Inside, for control.', 'Good space! Far? Laces, for power!', 'Right side! But high can go over. Keep it low.', 'He can reach that one. Find the big space.',
  'Your turn!', 'Mini match!', 'New in matches!', 'Watch this way!', 'Here is the 3-star play!', 'Watch {m0}.', '{m0} looks up.', '{m0} is open!', '{m0} is running!', 'Great pass!', 'And looks around for a friend.', 'Pass!', 'Look left.', 'Look right.',
  'See who is open?', 'Where is the space?', 'Where is the ball?', 'Where is the goal?', 'Off the post!', 'Blocked!', 'Goal ahead!', 'Only one defender!', 'Space ahead!',
  'You won the ball!', 'Watch the ball.', 'Now run past him!', 'Peek over your shoulder.', 'A defender is behind you! Turn away!', 'Nobody behind you! Turn and go!', 'Turn away from him!', 'Turn and go!',
  'Match time!', 'The final!', 'You won the cup!', 'You won! On to the next round!', 'So close! Try again!', 'You won! You got a new sticker!', 'Great try! You got a new sticker!', 'What do you want to play?',
  'You won the match!', 'Good game!', 'Nice pass! You looked up!', 'You looked up!', 'You looked early!', 'You peeked!', 'Great defending!', 'Great run!', 'Great choice!', 'Great steal!', "Today's training!", 'Training done!'];
const shared = () => [...SHARED, TIMEOUT.first, TIMEOUT.again, ...['restart', 'defense', 'off', 'receive', 'follow'].flatMap(k => [TIMEOUT[k]?.first, TIMEOUT[k]?.again]),
  ...Object.values(MOVE_NAME).map(n => n + '!'), EXPLAIN, ...Object.values(OKAY), ...Object.values(BAD)];
const load = lines => preloadClips([...new Set(lines.filter(Boolean).map(l => clean(fill(l))).flatMap(l => pieces(l).map(clipKey)))]);

// A round list (a lesson's, a training's, a match's): the shared lines, each scene's cue and what is said about it.
export function warmVoice(scenes = []) {
  const lines = shared(), ids = new Set();
  for (const sc of scenes) { ids.add(sc.skill); for (const c of [sc.cue, sc.then?.cue]) if (c) lines.push(c, 'You kept it! Even better: ' + fill(c).replace(/^./, ch => ch.toLowerCase())); }
  for (const s of ALL_LESSONS) if (ids.has(s.id)) lines.push(s.kid, s.tip);
  try { load(lines); } catch (e) { console.error(e); }
}
export function warmKeeper() { try { load([SAVED, ...Object.values(WHY), ...Object.values(SAID), 'What do you want to play?', 'You won! You got a new sticker!', 'Great try! You got a new sticker!']); } catch (e) { console.error(e); } }
