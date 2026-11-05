# Lesson plans and replay

How the lessons work, what each one teaches, and how the game keeps him coming back. All 8 lessons are built.
The skill order comes from `research/skill-tree.md`; the teaching rules come from `research/learning-design.md`.

## How every lesson works

- **One decision per round.** Each round grades a single choice. Chained decisions belong to the mini-match (see below).
- **Fixed outcomes while learning.** The best choice always works; a wrong choice always fails, then shows red and green lines, replays the better choice, and lets him retry.
- **No answer hints.** Nothing glows to point at the answer. The only nudge is on the skill being taught (for example, LOOK in "Look up").
- **A good choice ends in a goal only if the path and the shot are really open.** Otherwise the round ends with "Kept the ball!".
- **Every play is checked by the audit.** `npm run audit` covers the hand-made scenarios; `npm run audit:gen` covers generated ones.

## Lessons (all built)

The path, chapters and reasons are in `research/curriculum-plan.md`. Each lesson has a generator in
`js/generate.js`; every generated play is checked by the tests and `npm run audit:gen`.

| # | Lesson | Side | Patterns | The right answer |
|---|---|---|---|---|
| 1 | Look up! 👀 | attack | carry / none-open / one-open / shot-open | look first, then space, goal, or the open friend |
| 2 | Run into space 💨 | attack | space-far / space-near / space-behind / space-friend | lots of space: big push; defender near: small touches around him; space means nobody there, not even a friend |
| 3 | Take him on ⚡ | attack | trap-one / carry / trap | one defender: cut diagonally past him on his open side (sideways only keeps it) |
| 4 | Shoot when close! 🥅 | attack | shot-open / shot-blocked / shot-far | close and clear: shoot; blocked: go around; far: get closer |
| 5 | Win it back! 💪 | defense | goal-side / you-go | nobody on the ball: get in front of it |
| 6 | Steal it! 🦶 | defense (1v1, real time) | steal / steal-fast / steal-big | wait, then STEAL when the ball rolls away from his feet |
| 7 | Won it? Go! 🚀 | attack | counter / counter-pass / counter-shot | just won it: push forward fast, or shoot if close |
| 8 | Peek, then turn! 🔄 | receiving | peek-turn / peek-open | peek behind before the ball comes; turn away from the defender |
| 9 | Two shirts? Let it go! 🚧 | attack | trap / trap-one | two defenders: pass to the free friend |
| 10 | Get open! 🙋 | off the ball | shadow / spread / stay-open | move to where a pass can reach you |
| 11 | Pass to the open friend 🎯 | attack | marked / one-open / carry | the friend with nobody next to him |
| 12 | Pass and go! 🔁 | attack, then off the ball | give-go / give-go-ahead | pass to the wall friend, then run past the defender |
| 13 | Only one bee chases 🐝 | defense | one-goes / you-go / gs-covered | a friend is on the ball: guard the open player; nobody is: you go |
| 14 | Guard the open player 🛡️ | defense | mark-free / gs-covered | stand goal-side of the free attacker |
| 15 | Forward first ⬆️ | attack | forward / two-open / carry / shot-open | forward open friend (3★) beats the safe back pass (2★) |

## Replay

- **Lessons are skills.** Passing a lesson (4 of 6 right first try) opens the next one and adds its part to
  matches: big pushes, defending choices, 1v1 steals, counters, peek-and-turn, runs after a pass, guard spots.
  See the table in `research/curriculum-plan.md`.
- **Levels 1–3 per lesson.** A good session (4 of 6 right first try) raises a level, at most once a day. Level 1 plays
  mostly the main pattern with hints; Level 2 gives every pattern the same share, without hints; Level 3
  mixes in a third review lesson. The level shown never drops.
- **Reviews.** Played lessons come back as one review round each after 1, 3, 7, 14 and 30 days.
- **Coach's pick (PLAY).** The grown-up's locked lesson, then the lesson he picked, then a Level 1 lesson not
  finished today, then the next new lesson, then the most overdue one.
- **Same scenes the first time.** A lesson's first session uses fixed seeds; later sessions are fresh.
- **Mini match and free play** mix every lesson he has played.
- **Sticker album** (📒 on the home screen): one sticker per lesson, ringed bronze, silver or gold by level,
  with how many he has collected, and a count of matches won. Lessons not played yet show grey, so he can see
  what is still to come.
- **Places:** lessons are practice at the park; the mini match and free play are in the stadium.

## Original notes

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
