// Every line the game can say out loud, for recording the voice clips and for checking none is missing.
// Names don't matter here: lines are cut at player names, and each name has its own clip.
import { PATH, ALL_LESSONS, allScenarios } from '../js/skills.js';
import { SIZES, TEAM, setSize } from '../js/geom.js';
import { generate, OKAY } from '../js/generate.js';
import { CUPS } from '../js/cups.js';
import { MOVE_NAME } from '../js/flair.js';
import { EXPLAIN } from '../js/game/skill.js';

const A = 'Saka', B = 'Rice';
const fill = t => t.replaceAll('{m0}', A).replaceAll('{m1}', B).replaceAll('{m2}', A); // ({m2}: the third friend, at 4v4)
// The same cleanup say() does before speaking.
export const clean = t => t.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '').trim();

export function spokenLines() {
  const cues = new Set(), was = TEAM.size;
  for (const size of Object.keys(SIZES).filter(k => SIZES[k].offer)) { // (each size: its own lessons and situations, v62)
    setSize(size);
    for (const sk of PATH) {
      for (const sc of allScenarios(sk.id)) for (const c of [sc.cue, sc.then?.cue]) if (c) cues.add(c);
      for (let seed = 1; seed <= (size === '3v3' ? 400 : 120); seed++) { const sc = generate(sk.id, seed); for (const c of [sc?.cue, sc?.then?.cue]) if (c) cues.add(c); }
    }
  }
  setSize(was);
  for (const c of ['{m0} was open!', '{m1} was open!', 'That was a tough spot!', 'Lots of space! Push it and go!', 'There was space to run into!',
    'Nobody was in front of the ball. Get in front!', 'Your friends had it covered. Stay close!', 'A friend was on the ball. Guard the open player!',
    // match decisions' cues, said after a miss (game/live.js react)
    'Pass and go! Run past him into the space.', 'Run to the goal, so your friend can pass to you!', 'Move to open space so your friend can pass to you!', 'Wait in front of him. Steal it when it rolls away from his feet!']) cues.add(c);
  const lines = [
    ...ALL_LESSONS.flatMap(s => [s.kid, s.tip]),
    'Saved!', 'So close!', 'Good space! Close? Inside, for control.', 'Good space! Far? Laces, for power!', // shots (v62)
    'Your turn!', 'Mini match!', 'New in matches!', 'Watch this way!', 'Here is the 3-star play!',
    `Watch ${A}.`, `${A} looks up.`, `${A} is open!`, `${A} is running!`, 'Great pass!', 'And looks around for a friend.', 'Pass!', 'Look left.', 'Look right.',
    'See who is open?', 'Where is the space?', 'Where is the ball?', 'Where is the goal?', 'Off the post!', 'Blocked!', 'Goal ahead!', 'Only one defender!', 'Space ahead!',
    'You won the ball!', 'Watch the ball.', 'Now run past him!', 'Peek over your shoulder.', 'A defender is behind you! Turn away!', 'Nobody behind you! Turn and go!', 'Turn away from him!', 'Turn and go!',
    "Today's training!", 'Training done!', 'Train first!', 'Start a new cup?', 'Match time!', 'The final!', 'You won the cup!', 'You won! On to the next round!', 'So close! Try again!',
    ...CUPS.map(c => c.name),
    'You won! You got a new sticker!', 'Great try! You got a new sticker!', 'What do you want to play?', // the results card asks what next (flows.js ASK)
    'You won the match!', 'Good game!', 'Nice pass! You looked up!',
    'You looked up!', 'You peeked!', 'Great defending!', 'Great run!', 'Great choice!', 'Great steal!',
    ...Object.values(MOVE_NAME).map(n => n + '!'), EXPLAIN,
    ...Object.values(OKAY), // only-okay runs (v60) // the skill move he tapped for, and the demo's line about the button (game/skill.js)
  ];
  for (const c of cues) {
    const cue = fill(c);
    lines.push(cue, 'You kept it! Even better: ' + cue.replace(/^./, ch => ch.toLowerCase()));
  }
  return [...new Set(lines.map(clean))];
}
