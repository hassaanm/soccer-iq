# Lesson plans and replay

Working notes for lessons that aren't built yet, and how the game keeps him coming back.
The skill order comes from `research/skill-tree.md`; the teaching rules come from `research/learning-design.md`.

## How every lesson works

- **One decision per round.** Each round grades a single choice. Chained decisions belong to the mini-match (see below).
- **Fixed outcomes while learning.** The best choice always works; a wrong choice always fails, then shows red and green lines, replays the better choice, and lets him retry.
- **No answer hints.** Nothing glows to point at the answer. The only nudge is on the skill being taught (for example, LOOK in "Look up").
- **A good choice ends in a goal only if the path and the shot are really open.** Otherwise the round ends with "Kept the ball!".
- **Every play is checked by the audit.** `npm run audit` covers the hand-made scenarios; `npm run audit:gen` covers generated ones.

## Next lessons

### Run into space (`dribble-to-space`)
Teaches the difference between **dribbling** (small touches, ball close) and **running with the ball** (one big touch into open space, then sprint after it).

- Each dribble arrow gets two lengths: **small touch** and **big push**.
- Who gets there first decides it: the big push works only if he reaches the spot before every defender. If a defender is closer, the defender takes it ("kick and chase").
- Scenarios pair the two cases: wide-open field with defenders far away (big push wins), and a defender nearby (small touches or a pass win).
- Cue words: "Lots of space? Push it and go!" / "Defender close? Keep it close."

### Get goal-side (`get-goal-side`) and Only one bee chases (`one-goes`)
The first defending lessons. He doesn't have the ball; the choice is where to run.
- Choices are spots on the field to tap: chase the ball, run home between the ball and the goal, or guard the open player.
- These fix the swarming his rec team does.

### Pass to the open friend, and Two shirts? Let it go
These are where **chaining** starts: after a pass, he takes over the receiver and makes the next choice.

## Replay: why he won't run out of things to do

1. **Generated scenarios (built for "Look up").** `js/generate.js` builds fresh situations from teaching patterns: one open teammate, nobody open, or two open with one nearer the goal. Teammates can be anywhere, including behind him. Unclear layouts are thrown away. After the first session most rounds are generated, so no two sessions are the same.
2. **Review mixing.** Mastered skills come back in later sessions (Leitner boxes counted in sessions).
3. **Mini-match.** Mixes every skill he has learned; once two skills exist, it uses chained decisions.
4. **Collecting.** A sticker per session today. Planned: a sticker album, unlocking stadiums and kits as skills are mastered, and a "beat your star record" for each lesson.
5. **Free Play (planned).** A full 3v3 match made of chained decisions using everything he has learned, with no lesson framing. This becomes the default "just play" mode once there are 3 or more skills.
