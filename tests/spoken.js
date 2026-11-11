// Every line the game can say out loud, for recording the voice clips and for checking none is missing.
// Names don't matter here: lines are cut at player names, and each name has its own clip.
import { PATH, allScenarios } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { CUPS } from '../js/cups.js';

const A = 'Saka', B = 'Rice';
const fill = t => t.replaceAll('{m0}', A).replaceAll('{m1}', B);
// The same cleanup say() does before speaking.
export const clean = t => t.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '').trim();

export function spokenLines() {
  const cues = new Set();
  for (const sk of PATH) {
    for (const sc of allScenarios(sk.id)) for (const c of [sc.cue, sc.then?.cue]) if (c) cues.add(c);
    for (let seed = 1; seed <= 400; seed++) { const sc = generate(sk.id, seed); for (const c of [sc?.cue, sc?.then?.cue]) if (c) cues.add(c); }
  }
  for (const c of ['{m0} was open!', '{m1} was open!', 'That was a tough spot!', 'Lots of space! Push it and go!', 'There was space to run into!',
    'Nobody was in front of the ball. Get in front!', 'Your friends had it covered. Stay close!', 'A friend was on the ball. Guard the open player!']) cues.add(c);
  const lines = [
    ...PATH.flatMap(s => [s.kid, s.tip]),
    'Your turn!', 'Mini match!', 'New in matches!', 'Watch this way!', 'Here is the 3-star play!',
    `Watch ${A}.`, `${A} looks up.`, `${A} is open!`, `${A} is running!`, 'Great pass!', 'And looks around for a friend.', 'Pass!', 'Look left.', 'Look right.',
    'See who is open?', 'Where is the space?', 'Goal ahead!', 'Only one defender!', 'Space ahead!',
    'You won the ball!', 'Watch the ball.', 'Now run past him!', 'Peek over your shoulder.', 'A defender is behind you! Turn away!', 'Nobody behind you! Turn and go!', 'Turn away from him!', 'Turn and go!',
    "Today's training!", 'Training done!', 'Train first!', 'Start a new cup?', 'Match time!', 'The final!', 'You won the cup!', 'You won! On to the next round!', 'So close! Try again!',
    ...CUPS.map(c => c.name),
    'You won! You got a new sticker!', 'Great try! You got a new sticker!', 'You won the match!', 'Good game!', 'Nice pass! You looked up!',
    'You looked up!', 'You peeked!', 'Great defending!', 'Great run!', 'Great choice!', 'Great steal!',
  ];
  for (const c of cues) {
    const cue = fill(c);
    lines.push(cue, 'You kept it! Even better: ' + cue.replace(/^./, ch => ch.toLowerCase()));
  }
  return [...new Set(lines.map(clean))];
}
