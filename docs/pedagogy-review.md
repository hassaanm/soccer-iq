# Pedagogy review: does Soccer IQ teach the right soccer?

Independent review by a "youth coach + learning designer" reader. I changed no code. Evidence uses file and pattern names from `js/generate.js`, `js/skills.js`, and `js/game.js`.

## Bottom line

**The game's ideas are mostly sound, but the grading rules have drifted toward "pass whenever anyone is near you" and "don't go to the ball."** That is the opposite of what U6–U8 coaching stresses: dribble, take people on, shoot, and win the ball back.

The three problems that most mislead the child:

1. **One defender close = you lose the ball if you dribble.** Any defender within 2.6 m of the hero makes every dribble direction "bad", even turning away. Most pass lessons put exactly one presser about 2 m in front. So the child learns "one defender near me? Pass." The research said the trigger is *two* defenders.
2. **The dribble lesson contradicts its own tip.** The tip says "Defender close? Keep it close." But 3 of the 7 patterns (`space-close`) reward a 7 m kick-and-race with a defender about 2 m away, and grade small touches as "lost it".
3. **The AI teammates do not do what the defense lessons teach.** In `teamAI()` the second defender leaves his player to stand in a zone, so one attacker is always open. On a wrong spot, all three Blue players chase the shooter: a swarm, shown right after "only one bee chases".

The "Run home first" vs "Only one bee chases" clash is real, but it comes from **wording, not geometry**. Both lessons reward the same thing: get between the ball and our goal. Only the labels disagree ("Chase" is wrong in one lesson and right in the next).

---

## 1. Is each lesson's right answer right?

| Lesson | Right answer in code | Coach's verdict |
|---|---|---|
| Look up (`one-open`, `none-open`, `two-open`, hand-made `LOOK_UP`) | Mostly pass to the open friend; dribble into space if nobody is open | **Partly wrong.** Looking up is right. But in `one-open` (half the generated rounds), one presser 1.7–2.1 m in front makes *all* dribbles 1-star. That punishes a 1v1 take-on. |
| Run home first (`goal-side`) | Run to a spot 3.4 m in front of the ball (`goalSide(c, 3.4)`), then tackle from the front | **Right idea, wrong name.** The spot is not "home". It is "get in front of the ball". He is the closest defender, so he *is* the bee. |
| Run into space (`space-far`, `space-behind`, `space-near`, `space-close`) | Big 7 m push when there's space; small touches around a far defender | **Mixed.** Running with the ball into space is right. A 7 m knock for a 5-year-old is too long (a quarter of the 30 m pitch). `space-close` (push with a defender 2 m away) is kick-and-chase, which coaches correct. |
| Only one bee (`one-goes`, `you-go`) | Friend on the ball → guard the open player; nobody on the ball and you're closest → go | **Right.** This is the core anti-swarm idea and the cues are clear. |
| Two shirts? (`trap`) | Pass when two defenders close in | **Right**, but it has no contrast case (one defender → keep going). Without that, "two" is never separated from "one". |
| Guard the open player (`mark-free`) | Stand goal-side of the free attacker | **Right.** It is almost the same decision as `one-goes`, though. |
| Pass to the open friend (`marked`, `one-open`) | Friend with nobody next to him | **Right as a pass choice**, but dribbling is always a 1-star loss, because of the same single presser. |
| Forward first (`forward`, `two-open`) | Forward open friend 3★, back pass 2★ | **Fine as "look forward first",** but it is a U11–U12 team plan (US Soccer 9v9). At 5–8 the "forward" answer should often be *dribble* or *shoot*, not just pass. |

### The bad habit the grading builds

5 of 8 lessons reward a pass. Only one rewards dribbling. No lesson rewards shooting or a 1v1. Across the 4 defense patterns, the answer is "don't go to the ball" in 3 of 4.

The research said to reward dribbling and teach passing only as the answer to a trap (`research/skill-tree.md`, "Why this order"; "Where the sources disagree → Dribble vs. pass"). The code teaches passing as the answer to *any* close defender. The FA's foundation-phase lead says coaches should have children "take people on" and warns against "get rid of it" coaching ([FA, Pete Sturgess](https://www.thefa.com/bootroom/resources/coaching/what-does-transition-look-like-for-young-players)).

**Root cause (`generate.js`, `grade()`):**

```js
const end = dribbleEnd(hero, dir, L, W), near = Math.min(...opps.map(o => closestOnLane(o, hero, end, 0).d));
out['drib:' + dir] = near < PATH_HIT ? 'bad' : ...   // PATH_HIT = 2.6
```

`closestOnLane(..., 0)` includes the hero's own position. So any defender within 2.6 m of the hero makes **every** direction bad, including `back`, `bl` and `br`. Turning away or shielding from one defender is a basic U6 move, and the game calls it "Oops, lost it!"

The `one-open`, `marked`, `forward`, `two-open` and `trap` patterns all place a presser at about 1.5–2.1 m (`add(at(..., 1.7 + r() * .4))`). In live play, `continueLive()` places the presser at about 2.84 m, just outside 2.6. So live play allows dribbling, but lessons forbid it: a second mixed message.

### Shooting is never taught

`canShoot` needs `h.x > L - 13` (x > 17). In lessons, the hero ends at x = 8–15 (`attack()`: `hx = 5..12`, `heroTo = hx + 3`). **The shoot button never appears in any lesson.** Goals happen only because `finish()` auto-dribbles and auto-shoots.

In live play, a shot from 9.5–12 m with a clear lane grades as `unclear`. `rating()` turns that into `bad`, so the shot is "blocked" and the other team counters and scores. On a small no-goalie pitch, a clear 10 m shot is a good choice for a 5-year-old.

---

## 2. Do "Run home first" and "Only one bee chases" conflict?

**As written in the tips and labels, yes. In the geometry, no.**

What the code actually does:

- `goal-side`: the hero is 3.5–5 m *upfield* of the ball (behind it). Both friends are marking. The "Run home" spot is `goalSide(c, 3.4)`: 3.4 m in front of the ball. In `defendGen`, the carrier then runs into him and he wins the ball. **He is the closest defender, and he presses, from the front.**
- `you-go`: the hero is already goal-side. The "Chase the ball" spot is `goalSide(c, 1.1)`: 1.1 m in front of the ball. Best.
- `goal-side`: the "Chase" spot is `[c[0] + 1.3, c[1]]`: directly behind the ball. Bad.

So both lessons teach one rule: **go to the ball by getting in front of it.** The clash comes from three things:

1. **The name "Run home".** A 5-year-old hears "run to our goal". The tip "Lost the ball? Run home first" generalizes to "every time we lose it, retreat". That is a bad habit. The natural, coached reaction for the closest player is to win it back right away (research `lost-it-react`, scenario 1; US Soccer U7–U8: "winning the ball back", [age guide](https://www.ussoccer.com/us-way/player-development/environment/age-group-guide/u7-u8)).
2. **The word "Chase" means wrong in lesson 2 and right in lesson 4.** The spot labels are `Chase` (bad) vs `Chase the ball` (best).
3. **Lesson 2 never asks "Am I closest?"** In `goal-side` he is always closest, but the cue says nothing about that. Lesson 4 is all about "closest".

**How to frame them as one rule.** Give the child one question, then two branches:

> "Is a friend on the ball?"
> - **No → you go!** Get in front of the ball first, then take it.
> - **Yes → guard someone.** Find the open player and stand between him and our goal.

- Rename `get-goal-side` to **"Get in front!"** (or "Beat him home"). Kid tip: "Ball going to our goal? Get in front of it!"
- Relabel `goal-side` spots: `Behind him` (bad), `In front of him` (best), `Help guard` (bad).
- In `goal-side`, change the cue to name the trigger: "Nobody was on the ball, so you go! Get in front of it first."
- Use the word "chase" only for the wrong, from-behind run, or drop it everywhere. Use "Go get it" for pressing.

---

## 3. Are the scenarios too manufactured?

Each generator builds a narrow world where the rule is always true. Some of those worlds teach a rule that breaks on a real field.

| Pattern | What it over-teaches | Bound it to |
|---|---|---|
| `one-open`, `marked`, `forward`, `two-open` | "One defender near = pass" | Two close defenders (a real trap), **or** one defender plus a friend clearly better placed. With one presser, let a take-on or turn-away count as `ok`/`safe`. |
| `trap` | Fine, but alone | Add a contrast pattern: one defender in front, open grass to the side → dribble is best. The research asked for this (`see-the-trap`, scenario 3). |
| `space-close` | Kick-and-race with a defender 2 m away | Remove it, or push only when the nearest defender is ≥ 4 m away *and* behind or level. Keep "defender close → small touches". |
| `space-far`, `space-behind` | 7 m knock-ons | Use a 3–4 m "run with it" touch. Grade small forward touches into space as `ok` (3★), not `safe`. |
| `goal-side` | "Retreat when we lose it" | Always make him the only free defender, and say so in the cue. Add a contrast round: a friend is already in front of the ball → guard the open player. |
| `goal-side` (attackers) | `o2`/`o3` always hug the touchlines (y ≈ 1.5–3.5 or 16.5–18.5) | Vary their width; real 5-year-olds rarely stand on the line. |
| `one-goes` | The marked `o3` is upfield of the ball | Fine for now. Later, teach "stay goal-side of the ball" over strict man-marking. |
| All defense patterns | 1-to-1 man-marking of every attacker | Keep it, but the rule for 5-year-olds should stay "get between the ball and the goal, then find the open one". US Soccer says no fixed positions at U5–U6. |
| `finish()` | Every good choice ends in a goal or "Kept the ball!" | Fine for deterministic learning. Later, add a probabilistic match mode, as planned in `learning-design.md`. |

---

## 4. Do the AI players model the lessons?

**No, in several places.** The child watches these animations after every choice, so they teach as much as the cues do.

| AI behavior (`game.js`) | Contradicts | Fix |
|---|---|---|
| `teamAI()`: defender #2 goes to `lerp(ball, goal, .4)`, a zone, not a player | "Everyone else guards someone"; "Guard the open player" | Defenders not on the ball mark the nearest unmarked attacker, goal-side. |
| `teamAI()`: only one of two non-carriers is marked (defender #3 marks the most advanced) | `mark-free`: there should be no open player | Same fix as above: assign each free defender to a different attacker. |
| `teamAI()`: roles are re-sorted by ball distance every frame | Marks swap mid-play, so teammates look like they leave their player | Keep roles fixed for the play; swap only when a pass lands or the ball carrier beats the presser. |
| `defendGen` (wrong spot): every Blue player runs at `shooter.x + 1.4` | "Only one bee chases" | The beaten player chases. The others sprint goal-side or stay on their marks. |
| `defendGen` (right spot): `ai = true` during the 0.55 s run | Friends drift off their marks while the hero does it right | Script the two friends to hold their marks during defense outcomes. |
| `counter()`: after any lost ball in a match, the carrier always scores; the hero is scripted to run home | Defending is pointless; no defensive decision | After a loss, give him a defense decision (`goal-side` / `one-goes` from the live position). |
| `teamAI()`: attackers without the ball always run 4 m ahead and wide | `look-up`/`lu-behind` (a friend behind you), "shield and wait for a friend" | Keep one attacker in support at an angle beside or behind the ball. |
| Opponent defenders use the same press/cover/mark | Not a contradiction | Fine. It shows good defending. |

---

## 5. Is the lesson order sensible?

The attack/defense interleave is good. The research rationale (look-up first, dribble before trap) is good. Two gaps:

- **Missing B0 skills that a 5-year-old needs first:** `shoot-when-open` ("Close and nobody in front? Shoot!"), `beat-or-keep` (take on one defender), and `lost-it-react` (closest player wins it back right away). The research tree marks all three as B0–B1, and the FA and US Soccer stress them. They are more important at 5 than `forward-first`.
- **Defense has three near-duplicate lessons.** `one-goes` and `mark-free` are nearly the same decision. `goal-side` is really "the closest one goes, from the front".

**Suggested order:**

1. Look up 👀 (attack)
2. Go get it! 🐝: closest one goes, get in front first (merges `get-goal-side` + `you-go`)
3. Shoot when close 🥅 (attack, new)
4. Friend on the ball? Guard the open one 🛡️ (merges `one-goes` + `mark-free`)
5. Run into space 💨 (attack; fixed per section 3)
6. Take him on 1v1 ⚡ (attack, new: one defender → beat him or turn away)
7. Two shirts? Let it go 🚧 (attack, with a one-defender contrast)
8. Pass to the open friend 🎯
9. Forward first ⬆️ (later, for 4v4: "goal, then a friend ahead, then sideways, then back")

For the move to 4v4, add `kickoff-spread`/`get-open` ("spread out so a friend can pass to you") soon after. Do not add fixed positions. US Soccer says players should "experience all positions" at U7–U8 ([US Soccer U7–U8](https://www.ussoccer.com/us-way/player-development/environment/age-group-guide/u7-u8)).

---

## 6. Is the grading fair?

**"Bad" choices that are reasonable soccer:**

- **Dribbling or turning away from one defender** (all pass patterns). This is the biggest one. It should be `ok` or `safe`, not 1★.
- **Small-touch dribbling in `space-close`** (graded bad). That is what the tip asks for.
- **A clear shot from 9.5–12 m in live play** (`unclear` becomes `bad`). It should be `ok`. If not, hide the shoot button beyond 9.5 m.
- **Backward dribble under pressure** (bad whenever a defender is within 2.6 m). This is shielding. It should be `safe`.

**"Best" choices that are debatable:**

- **`space-close` big push** past a defender 2 m away.
- **`goal-side` "Run home"** is correct, but its name makes it look like retreating.
- **`forward` pattern:** the back pass to an open friend is 2★. But in `two-open`, inside the same lesson, a less-forward pass is 3★. Pick one rule. I suggest 3★ for any open pass in `look-up`/`pass-to-open`, and the 2★ "forward was better" grade only in `forward-first`.

**How the 2-star "safe" choice is framed.** The text is built as `'Safe! But ' + cue`, which produces "Safe! But Look forward first! Sam was open up the field." and "Safe! But Lots of space! Push it ahead and run." The capital letters and doubled exclamations read badly. For a forward dribble into space, "Safe!" is also the wrong word: it was an attacking choice.

- **Rewrite:** "You kept it! Even better: {short cue}." For example, "You kept it! Even better: pass to Sam up the field."
- **Also:** if 2★ never offers a retry, a perfectionist child may feel stuck. Offer "Try for 3 stars?" as well as "Watch".

---

## 7. Cue and tip wording

Keep cues to 3–8 words, one idea, and the same cue words every time (`learning-design.md` §2 and §6). Use "the other team", not "him", where you can, since kits change.

| Where | Now | Problem | Suggested |
|---|---|---|---|
| `PATH` `get-goal-side` tip | "Lost the ball? Run home first, between the ball and your goal." | Reads as "retreat" | "Get in front of the ball, then take it!" |
| `goal-side` cue | "Your friends were each guarding a player, and nobody was in front of the ball. Run home and get between the ball and your goal!" | 27 words; doesn't say "you're the one" | "Nobody was on the ball, so you go! Get in front of it." |
| `goal-side` spot labels | Run home / Chase / Help guard | "Chase" means wrong here and right in lesson 4 | In front / Behind him / Help guard |
| `one-goes` tip | "Only one bee chases the ball. Everyone else guards someone." | Good | Keep. Optionally: "One bee on the ball. Everyone else, guard someone." |
| `you-go` cue | "Nobody was on the ball and you were closest. Go get it!" | Good | Keep. |
| `mark-free` cue | "Your friends already had the ball and one player covered…" | "Had the ball" sounds like *we* had it | "A friend was on the ball. Nobody was guarding him — you guard him!" |
| `dribble-to-space` tip | "Lots of space? Push it and go! Defender close? Keep it close." | Contradicted by `space-close` | Keep the tip. Fix the pattern. |
| `space-close` cue | "The defender was close, but not in your way. Push it away from him and race!" | Teaches kick-and-chase | Remove, or "Defender close? Keep it close and turn away!" |
| `trap` cue | "Two defenders were closing in on you. Pass it away before they trap you! {m0} was open." | Long; "closing in" is hard for a 5-year-old | "Two shirts coming! Pass to {m0}!" |
| `marked` cue | "{m1} had a defender right next to him. {m0} had nobody near him!" | OK | "{m0} had nobody near him. Pass to {m0}!" |
| `forward-first` tip | "Look forward first, then sideways, then back." | Abstract | "Look to the goal first!" (save the 3-step order for 4v4) |
| `lu-behind` cue | "Two defenders were close to you, so pass it away! {m0} was open behind you." | Good | Keep. |
| Live cue | "That was a tough spot!" | Fine | Keep. |
| 1★ text | "Oops, lost it!" / "They got through!" | Fine, mild | Keep. |
| 2★ text | "Safe! But {cue}" | Grammar, wrong framing | "You kept it! Even better: …" |

---

## Prioritized fix list

1. **Stop punishing dribbling against one defender.** In `grade()` (`js/generate.js`), measure dribble danger from about 0.8 m along the path, not from the hero's feet (`closestOnLane(o, hero, end, .2)`). Mark a dribble `bad` only when the path runs into a defender, or when two defenders are within about 2.5 m. Grade `back`/`bl`/`br` as `safe` under one-defender pressure. *Why:* it removes the strongest wrong lesson ("one defender = pass") and matches the research and the FA. Re-run `npm run audit:gen`; the pass patterns then need a second defender (make them traps) to keep a clear pass answer.
2. **Fix `space-close`.** Remove it from `PATTERNS['dribble-to-space']`, or require the nearest defender ≥ 4 m away and not ahead. Shorten `PUSH_LEN` to about 3.5–4 m. Grade small forward touches into space as `ok`. *Why:* the pattern contradicts the lesson's own tip and teaches kick-and-chase.
3. **Rename and reframe "Run home first".** Update the `PATH` kid name, tip, and `goal-side` cue and spot labels as in section 7. Use "chase" only for the from-behind run. *Why:* it ends the clash with "Only one bee", and it stops "always retreat when we lose it".
4. **Make AI teammates mark players.** In `teamAI()` (`js/game.js`): one presser goal-side of the ball; every other free defender marks a different unmarked attacker, goal-side; keep roles fixed within a play. In `defendGen`, script the friends to hold their marks, and on a wrong spot let only the beaten player chase. *Why:* the animations currently show the swarm the lessons try to fix.
5. **Teach shooting.** Add a `shoot-when-open` lesson early, with the hero within about 9 m (x ≥ 21). In live play, grade a clear shot from 9.5–12 m as `ok`, or show the shoot button only inside 9.5 m. *Why:* shooting when close is a top U6 skill, and the button is currently a trap.
6. **Add contrast rounds.** In `trap`: a one-defender pattern where dribbling is best. In `goal-side`: a pattern where a friend is already in front of the ball, so guarding is best. *Why:* a child learns a cue only by seeing when it does *and* doesn't apply.
7. **Add "Take him on" (1v1) and "Win it back" lessons; merge duplicates.** Merge `one-goes` + `mark-free`, and `get-goal-side` + `you-go`, and reorder as in section 5. *Why:* it fills the B0 gaps and shortens the defense path to one clear two-branch rule.
8. **Give him a defense decision after a lost ball in matches.** Replace the automatic goal in `counter()` with a live defense freeze. *Why:* it makes the defense lessons matter in play, and stops "one mistake = a goal".
9. **Make grading consistent and kind.** Use one rule for a less-forward open pass (3★ everywhere except `forward-first`). Rewrite the 2★ text to "You kept it! Even better: …". Fix the capital-after-"But" bug in `round()`. *Why:* consistent signals matter for young learners (`learning-design.md` §2).
10. **Shorten all cues** to 3–8 words with the same key words each time (section 7 table). *Why:* pre-readers keep short, repeated phrases, and those become the field cue words.
11. **Keep AI support behind the ball.** In `teamAI()`, have one attacker without the ball stay beside or behind the ball at an angle. *Why:* it keeps "look behind you" and "friend coming to help" real in matches, and it previews 4v4 support.

## Sources

- [US Soccer, U7–U8 age group guide](https://www.ussoccer.com/us-way/player-development/environment/age-group-guide/u7-u8): 4v4 roles, 1-2-1 with no GK, "experience all positions", "winning the ball back", short simple instructions.
- [The FA, What does transition look like for young players? (Pete Sturgess)](https://www.thefa.com/bootroom/resources/coaching/what-does-transition-look-like-for-young-players): ball-chasing is normal; don't fix positions early; encourage dribbling and taking people on; don't coach "get rid of it".
- [US Soccer, The Progression from 4v4 to 11v11 (2008 candidate reading)](https://www.soccerxpert.com/docs/us-soccer-4v4-to-11v11-progression.pdf): principles of play by format; "look forward first" as a 9v9 team plan.
- [APYSL coaching guidelines](https://irp.cdn-website.com/07891816/files/uploaded/Full_APYSL+Coaching+Guidelines-8750d2be.pdf) (club document, lower reliability): U8 defending focus "Steal the Ball, Step In, Pressure the Ball", starting from positioning between the goal and the ball.
- Project research: `research/skill-tree.md` (`see-the-trap` scenario 3, `beat-or-keep`, `lost-it-react`, "Where the sources disagree") and `research/learning-design.md` (§2 feedback, §6 cue words).
