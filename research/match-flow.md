# How a match flows (v81, measured)

**A match is mostly deciding and watching play, but every few plays the game cuts to a new scene with no reason on
screen.** The cut is the "reset" the owner means. It comes from a rule written for the older engine: after five plays
without a goal (about 30 seconds), or the moment he wins the ball before "Won it? Go!", `match()` in
`js/game/live.js` loads a fresh scene. The players jump, the camera snaps, and the head-down edge comes on, so it reads
as a fade.

## How it was measured

- Whole matches in node with the tests' harness (`tests/harness.js`), 30 frames a second, real time = frames / 30.
- A child-paced bot: it chooses at 45 to 80 % of the ring, picks a wrong option one time in four, and taps STEAL at the
  right moment.
- 20 matches per size and mode, seeded:
  - **Match**: "Matches" mode, every lesson passed, first to 5 (`match(…, 5, 'free')` with 24 fresh scenes, as
    `flows.js` does).
  - **Mini**: the "Steal it!" lesson's mini match, first to 2, with the lessons up to "Steal it!" passed (no "Won it?
    Go!" yet).
- Time is split by what the picture shows: **deciding** (a window is open), **run-up** (the moments before a window,
  everyone moving), **play** (after a choice, someone moving), **skill** (the skill offer or move), and **waiting**
  (nobody and no ball moves).
- A **cut** is a frame where a player moves more than 0.8 m (a sprint covers 0.15 m in a frame). Two players who swap
  places in one frame (a hand-over: his player becomes the friend) do not count.
- The tool is `scratchpad/v76/match/measure.mjs` (copied into `scripts/flow-audit.js` in the next commit).

## The numbers

| | 3v3 match | 4v4 match | 5v5 match | 3v3 mini | 4v4 mini | 5v5 mini |
|---|---|---|---|---|---|---|
| Match length, s (median) | 150 | 141 | 186 | 63 | 57 | 81 |
| Decisions per match | 21.0 | 21.8 | 28.9 | 8.5 | 8.2 | 13.0 |
| Decisions per minute | 8.8 | 8.7 | 8.6 | 8.3 | 8.1 | 8.1 |
| Deciding, % of time | 38.8 | 38.0 | 37.8 | 34.1 | 33.0 | 32.9 |
| Run-up, % | 14.4 | 14.6 | 14.2 | 14.5 | 14.3 | 13.9 |
| Play, % | 32.5 | 32.8 | 37.3 | 31.9 | 33.7 | 37.7 |
| Skill moment, % | 1.6 | 1.7 | 1.1 | 1.9 | 1.9 | 0.9 |
| **Waiting, %** | 12.7 | 12.9 | 9.6 | 17.7 | 17.0 | 14.5 |
| Longest still picture, s | 6.0 | 5.7 | 6.5 | 5.8 | 8.6 | 5.4 |
| Goals per match | 6.5 | 7.0 | 6.8 | 2.6 | 2.5 | 2.6 |
| **Cuts with no reason on screen, per match** | 0.9 | 1.15 | 2.3 | 2.0 | 2.25 | 3.75 |
| Cuts after a goal, per match | 5.45 | 6.0 | 5.75 | 1.65 | 1.55 | 1.6 |
| Stall cut: seconds after the situation began (median, range) | 34 (25–42) | 31 (25–38) | 32 (23–47) | 28 | 30 | 31 (26–40) |

The cuts with no reason are the stall cut (five plays without a goal) and, in a mini match, the cut after he wins the
ball. In the mini match the second kind is the most common new situation of all: 1.9 to 3.0 a match, more than goals.

**Most waiting comes after goals.** About 1.6 s of still picture follows each goal (the 1.2 s celebration, then the
next scene's plan is made over several frames while the picture stays frozen). The longest still stretches (5 to 8.6 s)
are all after a goal or after a won ball: the hold, then the planning frames, then a scene whose run-up starts slowly.

## Every way play ends, and what comes next

Per match, at 3v3 "Matches" (5v5 in brackets where it differs). "Readable" means a watcher can tell from the picture
why the new situation started.

| Play ends with | Per match | What comes next | Readable? |
|---|---|---|---|
| GOAL! / They scored | 6.5 | Cut to the next scene in a shuffled list (any lesson's scene, rarely a kick-off) | Partly: the goal shows why play stops, but the new picture is not a kick-off and can be anywhere |
| Kept the ball | 4.6 (7.1) | `continueLive`: he carries on from there; the next choice opens after 0.7 s | Yes |
| … and a friend has it | 0.6 (1.2) | Hand-over: his player becomes that friend, the camera glides over | Mostly: the ring moves to the friend who has the ball |
| Stolen! / They got it! / Cut out! | 3.1 (4.1) | `continueDefense`: he defends from there | Yes |
| Stopped him! | 2.5 (4.6) | He defends again from there | Yes |
| Stole it! (with "Won it? Go!") | 2.3 (3.2) | He attacks from there | Yes |
| Stole it! (mini match, no "Won it? Go!") | 1.9–3.0 | **Cut** to a new scene | **No**: the new picture has nothing to do with where he won it |
| Their keeper saves, or a shot goes over or wide | (0.8) | Their keeper rolls it out (after a miss, the ball goes behind the goal and appears in his hands) | Yes |
| Our keeper saves | (0.5) | He rolls it to a friend, and his player becomes that friend | Yes |
| His keeper turn (5v5 Matches only, run by the page, not in these numbers) | — | The keeper view and back | Yes |
| A step inside one play (give-and-go, run after a pass, a pass to him, a 1v1, a rebound) | 2.4 | The next choice of the same play | Yes |
| No fair defending choice | 0.7 (1.3) | Play runs on with him where he is; it counts as a play | Yes |
| **Five plays without a goal** (`streak > 4`) | 0.9 (2.3) | **Cut** to a new scene | **No**: the last banner ("Kept the ball!", "Stopped him!") gives no reason; the players jump, the camera snaps and the head-down edge comes on |

Frame strips of the two cuts (headless, muted Chrome, 844 x 390):
`scratchpad/v76/match/strips/before-stall.jpg` and `before-won.jpg`. In the stall strip he keeps the ball, the banner
shows, and 0.2 s later the picture is a different place on the pitch. (The black frames in those strips are frames the
capture caught before they were drawn, not a real fade.)

## What was built for the older engine and no longer fits

1. **The stall rule counts plays, not time or progress.** `match()` starts a fresh scene after five plays without a goal
   (`live = streak > 0 && streak <= 4`). It dates from when play froze between choices. Now play runs on between
   choices, and the count ends live play at any moment, about 30 s in.
2. **A new situation is a hard cut.** `load()` calls `sim.setup` (everyone jumps), `world.resetRigs()` (after a
   hand-over, the ring jumps back to his first player's body), and sets `cam = null` (the camera snaps). The new scene
   starts head-down, so the dark edge comes on with the cut. The game now has a moving world and players who never
   stand still, and the cut is the one place where that breaks.
3. **"Won it? Go!" is gated by a cut.** Before that lesson, winning the ball ends play with a cut. The lesson's point
   (play on after you win it) can be kept without cutting.
4. **After a goal the next scene is random.** It is the next of a shuffled list, not a kick-off, so the cut lands
   anywhere.
5. **The next scene is planned only after the result's hold.** `prePlan` runs after the play ends, so the picture stays
   frozen for its frames (up to about 4 s after a goal).
6. **Everyone stops dead at each result** (`end()` calls `stopAll()`, then holds 0.5 to 1.4 s). The calm moves of v81
   are drawn over it, so this reads better than it measures.
7. **The 1v1 stops everyone** (`toDuel` calls `stopAll()`), while the rest of the game keeps players moving.
8. **The end of the match has no moment of its own.** The last goal's celebration goes straight to the results card,
   with no final whistle and no look at the final score.
9. **Small leftovers:** the comment "Only a goal resets to a fresh situation" is out of date; `i >= toWin * 25` caps a
   match by loop turns, not time.

# v82: what changed, and the numbers after

**No new situation starts with a cut any more, except after a goal and at the start.** Play goes on 60 s without a goal
(it was 5 plays, about 30 s) before the game brings in a new situation. Then, and when he wins the ball before "Won it?
Go!", a short piece of soccer with the same players carries it in, on screen, in 2 to 4 s.

## The new rule (`js/game/live.js`)

- **When:** `STALL = 60` real seconds since the situation began without a goal (`goOn`). Why 60: the old count fired at a
  median of 31–34 s, about 4 decisions in, which cut into play that was going fine. Goals come every 20–30 s, so 60 s
  only catches play that really goes round in circles (0.05 to 0.6 times a match now), and fresh lesson scenes still
  come after every goal.
- **Which scene:** of the next 4 in the match's own order, the quickest to reach (`bridgePick`): each team's players go to
  the nearest free place of their team (the longest run as short as possible, at most 10.5 m). 1v1s, passes to him and
  lead passes can be reached too, so the mix of situations stays the match's. Not: a kick-off (only after a goal), a
  "Won it? Go!" intro, a "Follow your shot!" rebound.
- **The event** (`bridgeEvent`), on the old picture, by who has the ball now and in the new scene:
  - their ball → ours, for a pass-in from the side: the ball goes out off one of theirs; whistle, "Our ball!";
  - their ball near our goal → a goal kick: their pass or shot goes wide of our post; whistle, "Goal kick!";
  - their shot → our keeper's ball (5v5): our keeper catches it; "Saved!";
  - our ball → ours, one of theirs just went in: a foul; whistle, "Free kick!";
  - a change of team: the other team's nearest player wins it ("They got it!", "You won the ball!");
  - otherwise: a pass on, with no stop.
- **The run** (`adopt`, `bridgeRun`): the new scene is set up around everyone where he is (the bodies, the roster and the
  camera are kept), and everyone runs on a smooth path to his place as the new choice opens, no faster than 5.4 m/s. The
  ball is carried, passed, rolled or picked up on the line. The camera comes round behind his player and follows him; the
  head-down edge comes on only in the last 0.8 s. Players not in the event set off during it.
- **If its plan is not ready** when the event ends, nothing is brought in: play goes on from the event (a free kick
  taken, their ball). Rare: a scene whose plan was slow once is not picked again in that match.

## Also changed

- The score changes as the goal goes in, with the GOAL! banner (it changed after the celebration, as the next scene cut in).
- The goal that ends a match brings the final whistle and "Full time!" over its own celebration.
- The next scene's plan is made over the goal's celebration. (A version that also swapped out a scene whose plan was
  still slow was dropped: it made the order of play depend on which plans were already made, so a match did not play the
  same twice. One scene, `gen-shot-open-110`, still needs about 60 s of frames to plan, a frozen picture after a goal as
  in v81: a `game/window.js` matter.)
- The live audit judges hover, yoyo and twoball as a rate over 40 matches a size against v81's measured rate
  (`scripts/live-audit.js` RATE).
- A 1v1 won before "Won it? Go!" holds 0.7 s like any won ball in a match (`MATCH_HOLD`), not 1.3 s: the new
  situation follows from there. With "Won it? Go!" (and in lessons) it stays 1.3 s.

## Before and after (the same bot and seeds; v82 = this branch)

| | decisions/min v81 → v82 | waiting % | cuts with no reason, per match | longest still, s | stall: s after the situation began |
|---|---|---|---|---|---|
| 3v3 Matches (60) | 8.65 → 8.90 | 13.7 → 10.5 | 0.92 → 0 | 61.7 → 9.8 | 32 → 64 |
| 4v4 Matches (60) | 8.60 → 8.74 | 12.8 → 10.5 | 1.10 → 0 | 7.8 → 7.7 | 31 → 71 |
| 5v5 Matches (60) | 8.43 → 8.69 | 10.3 → 8.1 | 2.55 → 0 | 33.2 → 9.5 | 34 → 63 |
| 3v3 mini (100) | 8.43 → 8.84 | 16.8 → 8.7 | 2.30 → 0 | 7.0 → 8.1 | — |
| 4v4 mini (100) | 8.09 → 8.31 | 16.8 → 9.5 | 2.09 → 0 | 8.6 → 6.9 | — |
| 5v5 mini (100) | 7.77 → 7.97 | 13.8 → 8.4 | 3.04 → 0 | 8.1 → 6.0 | — |

A new situation that is not after a goal now takes 2.6–3.2 s from the end of the play to the next choice (it was
2.1–2.4 s of hold, frozen picture and run-up, with a cut). New situations brought in from play: 0.1–0.6 a match in
Matches (after 60 s without a goal), 3.6–4.4 in a mini match before "Won it? Go!" (after a won ball). One player alone can still be pushed more than 0.8 m in a
frame when two overlap (`sim.js` SPACE, about once in 50 matches); that is not a new situation and was there in v81.

The check: `tests/match-flow.test.js` and the `cut` line of `scripts/live-audit.js` (in `audit:motion`). Both fail on
v81 and pass on v82.

## A scene whose plan takes too long is left out of the match (v83)

The next scene's plan is made PLAN_STEPS + 1 = 5 steps a frame (game/window.js prePlan), so how many frames it takes is the
scene's own. Over the scenes a match can use (a lesson's ten, the first-time ones, and a sample of the random seeds a
match's fresh scenes come from; about 900 a size) the middle scene needs 28 to 32 frames (0.5 s at 60 a second), the 90th
percentile 121 to 125, and the 99th 156 to 191. The tail is a few scenes: gen-shot-open-110 (3v3) 1814 frames, gen-shot-open-109
(5v5) 1306, and a random seed at 4v4 (gen-shot-open-88109) 2128. Those are 30 s or more at 60 a second.

Why: in these the plan has no run for the one who comes that is clean (a try that agrees all the way, with nothing too near).
`pick` then looks at every distance and angle (up to 14 by 9 runs, about 20 steps each) and gives the best of them, and `solve`
asks again for each new window length, up to 8 times: about 1100 steps for each. A bound that leaves every other plan the
same was not found: the plans of other scenes also fail to find a clean run once or three times and then go on to find one
(one at 4v4 does so on 3 of 4 asks), so any cap on those asks changes a plan that is quick today.

So the guarantee is a limit: game/window.js `vetRounds` counts, for each scene in a match's list, the frames prePlan will take
(`prePlanFrames`: the same tries, 5 steps a frame, nothing kept), up to PLAN_LIMIT = 170 frames (1.2 s of celebration it is made
over, and about 1.6 s of picture still after it), and leaves out a scene past it. The count depends on the scene (and the
size and the window the game plays it with), never on timing or on what was played before. It is made a frame at a time, 80 steps a
frame, as the match starts. Left out at 170 over the sample: 3v3 3 (gen-shot-open-110 and two random seeds), 4v4 1 (a random
seed), 5v5 8 (gen-shot-open-109, seven random seeds). With a limit of 90 frames (1.5 s from the start of the plan) 94 to 112 of
the sample (about one in nine) would go: that is not a handful. tests/plan-limit.test.js checks it.

