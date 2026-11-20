// The review page's burn list (dev/review.html): the situations a grown-up can jump straight into, repeat and note.
// The page is for the people building the game. Nothing in the game links to it.
//
// OPEN IT
//   Locally: serve the project folder with any static server (for example `npx serve .` or `python3 -m http.server`
//   in the project folder), then open http://localhost:<port>/dev/review.html.
//   Published: <the site's address>/dev/review.html (for example …/soccer-iq/dev/review.html).
//   A link to one entry: …/dev/review.html#keeper-save. The page uses its own throwaway save (everything unlocked).
//   It never writes the child's save: the notes live under their own key, 'soccer-iq:review'.
//
// ADD AN ENTRY
//   Add one object to ENTRIES below, in its group. The fields are:
//     id      a short unique name (it is also the page's #link)
//     group   one of GROUPS (the list shows the groups in this order)
//     title   what the list shows
//     look    one line: what to look at (say so here if this is only the nearest thing to what you want to see)
//     and one way to start it:
//       round:  { lesson, pattern, first?, where? }   one lesson round (js/generate.js PATTERNS), seed from the seed chooser.
//               first: the very first round of a new idea (the longest window). where: 'close' | 'far' | 'midfield'.
//       match:  { goals, first?: { lesson, pattern, where? }, without?: [lesson ids], forceGuess? }   a match in the stadium.
//               first: the situation it opens with. without: lessons treated as not passed yet. forceGuess: their keeper
//               always guesses wrong on a placed shot (game/outcomes.js guessWrong).
//       screen: 'home' | 'sizes' | 'lessons' | 'menu' | 'report' | 'cups'   a screen of the game.
//       results: 'lesson' | 'training' | 'match'   the real flow, played through at once, up to its results card.
//       keeper: 'game' | 'match'   the keeper mini game (lights up once the build has #keeperBtn).
//     pick    which choosers apply: any of 'size', 'level', 'think', 'seed' (left out: none)
//     size    a fixed team size, when the entry only exists at one size ('5v5')
//     level / think / seed   defaults for the choosers (level 1, 'normal', seed 1)
//     reach   what "it is up" means for the page's own check (tests and the walk script): 'decide' (a choice is open),
//             'defend' (a defending choice is open), 'timeout' (the "He got there!" card), 'skill' (the skill moment's two buttons),
//             'guess' (their keeper guessed), 'shown:#id' (that screen is showing). Default: 'decide' for rounds and
//             matches, the screen for screens.
//     act     what the walk script does once it is up, before checking `reach`: 'best' picks the best choice, 'shoot' taps
//             SHOOT. (The page itself never chooses for you.)
//   tests/review.test.js checks every entry: the fields, and that every round entry's situation can be made at its sizes.

export const GROUPS = [
  'Decisions in a moving world (new in v66)',
  'Shooting',
  'Dribbling',
  'Restarts: "Our ball? Spread out!"',
  'Team ideas',
  'Matches',
  'Screens and flow',
  'Goalkeeper',
];
const [MOVE, SHOOT, DRIB, RESTART, TEAM, MATCH, SCREEN, KEEPER] = GROUPS;
const ALL = ['size', 'level', 'think', 'seed'];

export const ENTRIES = [
  // ---------- decisions in a moving world ----------
  { id: 'ball-coming', group: MOVE, title: 'With the ball, a defender coming', pick: ALL, round: { lesson: 'look-up', pattern: 'carry' },
    look: 'Play goes on in slow motion while he chooses; the ring round him drains as the nearest defender runs in. Compare Level 1, 2 and 3.' },
  { id: 'time-out', group: MOVE, title: 'Let the time run out', pick: ALL, round: { lesson: 'look-up', pattern: 'carry' }, reach: 'timeout',
    look: 'Tap nothing. When the ring is empty he takes the ball: the card says "He got there!", then (Level 1) it plays once more and he tries again with more time.' },
  { id: 'carry-view', group: MOVE, title: 'With the ball: the view looks his way (v76)', pick: ALL, seed: 2, round: { lesson: 'look-up', pattern: 'carry' },
    look: 'As the choice opens (head down) the view looks the way he runs, up the field, raised to show the one who comes. Before v76 it turned up to 70° toward that player: he ran across the screen, sideways (seed 2 at 3v3 was one).' },
  { id: 'first-round', group: MOVE, title: 'The first round of a new idea', pick: ['size', 'think', 'seed'], level: 1, round: { lesson: 'look-up', pattern: 'carry', first: true },
    look: 'The same kind of play as "With the ball", with the longest window of all (the very first round of a lesson).' },
  { id: 'off-ball', group: MOVE, title: 'Off the ball: where to run', pick: ALL, round: { lesson: 'get-open', pattern: 'shadow' },
    look: 'A friend has the ball. He picks a ring to run to while play moves on; the rings move with the players.' },
  { id: 'get-back', group: MOVE, title: 'Defending: get back in front', pick: ALL, round: { lesson: 'get-goal-side', pattern: 'goal-side' },
    look: 'They have the ball and come at our goal. He picks where to run before the dribbler gets past.' },
  { id: 'receive', group: MOVE, title: 'Receiving a pass: peek, then turn', pick: ALL, round: { lesson: 'peek-and-turn', pattern: 'peek-turn' },
    look: 'The pass comes while he chooses: drag to peek behind, then tap a turn arrow before the ball gets to him.' },
  { id: 'receive-back', group: MOVE, title: 'Receiving: passing it back is best', pick: ALL, round: { lesson: 'peek-and-turn', pattern: 'peek-back' },
    look: 'Both turns are blocked: the right answer is a tap on the friend who passed, straight back to him.' },
  { id: 'trap', group: MOVE, title: 'Two defenders close in (the trap)', pick: ALL, round: { lesson: 'see-the-trap', pattern: 'trap' },
    look: 'A tight picture: two of theirs come at him at once. Pass to the free friend before they get there.' },
  { id: 'friend-shoots', group: MOVE, title: 'A friend about to shoot: run to the goal', pick: ALL, round: { lesson: 'go-to-goal', pattern: 'go-shot' },
    look: 'His friend dribbles in and shoots. The run toward the goal is right: the ball comes back off the post to him.' },

  // ---------- shooting ----------
  { id: 'six-close', group: SHOOT, title: 'SHOOT: six targets, then the foot (close)', size: '5v5', pick: ['level', 'think', 'seed'], round: { lesson: 'shoot-space', pattern: 'aim-open' },
    look: 'Tap SHOOT, pick one of the six gold targets, then Inside or Laces. Close in: low and away from the keeper, with the inside.' },
  { id: 'six-far', group: SHOOT, title: 'SHOOT: six targets, then the foot (far)', size: '5v5', pick: ['level', 'think', 'seed'],
    match: { goals: 5, first: { lesson: 'shoot-close', pattern: 'shot-open', where: 'far' } },
    look: 'Nearest thing: the lesson\'s six-target scenes are all close, so this is a match opening with a shot from about 10 m: SHOOT, a target, then the foot.' },
  { id: 'keeper-save', group: SHOOT, title: 'The keeper saves it', size: '5v5', pick: ['level', 'think', 'seed'], round: { lesson: 'shoot-space', pattern: 'aim-open' },
    look: 'Tap SHOOT and pick the target right at the keeper (the middle): in a lesson a shot at him or inside his reach is always saved.' },
  { id: 'keeper-guess', group: SHOOT, title: 'The keeper guesses wrong', size: '5v5', pick: ['level', 'think', 'seed'], reach: 'guess', act: 'shoot',
    match: { goals: 5, first: { lesson: 'shoot-close', pattern: 'shot-open' }, without: ['shoot-space', 'inside-laces'], forceGuess: true },
    look: 'Tap SHOOT (one tap here): their keeper leans and steps the wrong way before the kick. Forced on this page; in a real match it is about 1 shot in 10.' },
  { id: 'foot-only', group: SHOOT, title: 'Inside or laces alone (no keeper)', size: '3v3', pick: ['level', 'think', 'seed'], round: { lesson: 'inside-laces', pattern: 'foot-close' },
    look: 'At 3v3 there is no keeper, so SHOOT goes straight to the foot: Inside (close) or Laces (far).' },
  { id: 'rebound', group: SHOOT, title: 'Follow your shot (the rebound)', pick: ALL, round: { lesson: 'follow-shot', pattern: 'follow-post' },
    look: 'The shot comes back off the post. He picks where to run while it rolls: in to the loose ball is right.' },

  // ---------- dribbling ----------
  { id: 'touches', group: DRIB, title: 'Dribble: small touches or a big push', pick: ALL, round: { lesson: 'dribble-to-space', pattern: 'space-far' },
    look: 'Tap DRIBBLE, then an arrow: two buttons come up, Small touches and Big push. Lots of space ahead: the big push.' },
  { id: 'take-on', group: DRIB, title: 'Take him on', pick: ALL, round: { lesson: 'take-him-on', pattern: 'trap-one' },
    look: 'Only one defender: dribble past him (the arrow beside him, not into him).' },
  { id: 'skill', group: DRIB, title: 'A skill moment: two tricks to pick from (v78)', pick: ALL, reach: 'skill', act: 'best', round: { lesson: 'take-him-on', pattern: 'trap-one' },
    look: 'Dribble past him: as he sets off, two gold buttons with pictures come up where PASS and DRIBBLE were, play slows (about 3 s, the rings drain). Tap the one going to the space: it stays lit, its name is said, it plays slowly with its name up. Seed 3 offers; step the seed if none comes.' },
  { id: 'skill-wrong', group: DRIB, title: 'A skill moment: the trick toward him', pick: ALL, reach: 'skill', round: { lesson: 'take-him-on', pattern: 'trap-one' },
    look: 'As the two tricks come up, tap the one whose arrow goes toward the defender: he does not buy it, steps across and stops you (Kept the ball!, 2 stars and why).' },
  { id: 'skill-run', group: DRIB, title: 'A skill moment while running at a defender who is still coming', pick: ALL, match: { goals: 5 },
    look: 'In a match, dribble at a defender who is still a few metres off: two tricks come up early; tap one, and it starts by itself as he gets close. Rare: play on until one comes (at most one every 20 s).' },

  // ---------- restarts ----------
  { id: 'side-in', group: RESTART, title: 'In from the side line (off the ball)', pick: ALL, round: { lesson: 'spread-out', pattern: 'side-in' },
    look: 'Our ball on the side line, a friend takes it: he picks the space to spread out to before it is played.' },
  { id: 'side-take', group: RESTART, title: 'In from the side line (he takes it)', pick: ALL, round: { lesson: 'spread-out', pattern: 'side-take' },
    look: 'He takes it himself: lots of space, so dribble it in.' },
  { id: 'goal-kick', group: RESTART, title: 'The goal kick', pick: ALL, round: { lesson: 'spread-out', pattern: 'goal-kick' },
    look: 'Our goal kick: he spreads out wide to be free for it.' },
  { id: 'kick-off', group: RESTART, title: 'The kick-off', pick: ALL, round: { lesson: 'spread-out', pattern: 'kick-off' },
    look: 'Our kick-off (a Level 2 situation in the lesson): where does he go?' },
  { id: 'keeper-ball', group: RESTART, title: "The keeper's ball (5v5)", size: '5v5', pick: ['level', 'think', 'seed'], round: { lesson: 'spread-out', pattern: 'keeper-ball' },
    look: 'Our keeper has it in his hands: he moves wide and away to be free for the throw.' },

  // ---------- team ideas ----------
  { id: 'you-go', group: TEAM, title: 'One goes, one guards: he is nearest', pick: ALL, round: { lesson: 'one-goes', pattern: 'you-go' },
    look: 'Nobody of ours is on the ball and he is the closest: he goes.' },
  { id: 'friend-goes', group: TEAM, title: 'One goes, one guards: a friend is nearest', pick: ALL, round: { lesson: 'one-goes', pattern: 'one-goes' },
    look: 'A friend is already chasing the ball: he guards the open player.' },
  { id: 'crowd', group: TEAM, title: "Don't crowd your friend", pick: ALL, round: { lesson: 'get-open', pattern: 'crowd' },
    look: 'Running to the ball brings his defender too: the space away from his friend is right.' },
  { id: 'forward', group: TEAM, title: 'Forward first', pick: ALL, round: { lesson: 'forward-first', pattern: 'forward' },
    look: 'Look to the goal first: a friend ahead is the pass.' },
  { id: 'lead', group: TEAM, title: 'Pass in front', pick: ALL, round: { lesson: 'lead-pass', pattern: 'lead' },
    look: 'A friend is running: tap the spot in front of him, where he will be, not his feet.' },
  { id: 'give-go', group: TEAM, title: 'Pass and go', pick: ALL, round: { lesson: 'give-and-go', pattern: 'give-go' },
    look: 'Two choices in one play: pass to the friend, then pick the run past the defender for the ball back.' },

  // ---------- matches ----------
  { id: 'match-now', group: MATCH, title: 'A match, straight away (first to 5)', pick: ['size', 'level', 'think'], match: { goals: 5 },
    look: 'A whole match in the stadium with every lesson passed, at the size chosen above.' },
  { id: 'match-mid', group: MATCH, title: 'A match from our ball in midfield', pick: ALL, match: { goals: 5, first: { lesson: 'look-up', pattern: 'carry', where: 'midfield' } },
    look: 'It opens with him on the ball near the halfway line, then play flows on.' },
  { id: 'match-defend', group: MATCH, title: 'A match from their ball (defend first)', pick: ALL, reach: 'defend', match: { goals: 5, first: { lesson: 'get-goal-side', pattern: 'goal-side' } },
    look: 'It opens with their ball: a defending choice first.' },
  { id: 'match-won-new', group: MATCH, title: 'Win the ball before "Won it? Go!": the next situation comes in by play', pick: ALL, reach: 'defend',
    match: { goals: 5, first: { lesson: 'get-goal-side', pattern: 'goal-side' }, without: ['won-it-go'] },
    look: 'Pick the right spot and win the ball. No cut and no fade (v82): a short piece of play brings in the next situation (they win it back, or a pass on), everyone runs to his place and the camera follows, 2 to 4 s. After 60 s without a goal the same happens with a free kick, the ball out, a keeper catch or a tackle.' },
  { id: 'cup', group: MATCH, title: 'A cup round', screen: 'cups',
    look: 'The cup card (the road to the trophy), then Kick off plays the real cup round. Leaving it half way reloads the page.' },

  // ---------- screens and flow ----------
  { id: 'home', group: SCREEN, title: 'Home', screen: 'home',
    look: 'The home screen as he sees it with every lesson passed. PLAY, Match and Cup start the real thing.' },
  { id: 'sizes', group: SCREEN, title: 'The size picker', screen: 'sizes',
    look: 'Players on each team. Picking another pitch reloads the page at that size.' },
  { id: 'lessons', group: SCREEN, title: 'The lesson sheet', screen: 'lessons',
    look: 'Six chapters, every lesson open, with stars at the level chosen above.' },
  { id: 'demos', group: SCREEN, title: 'The "Watch" demos (v76)', screen: 'lessons',
    look: 'Tap a lesson, then Watch. As the choice opens, play crawls on and the view glides in from a wider one while the idea is said (the ring stays full), then the ring starts; he looks only at what the lesson is about (only "Look up!" looks left and right), and the hand taps with about half the ring left, the defender still coming. Try "Follow your shot!", "Two defenders? Pass!" and "Run into space".' },
  { id: 'results-lesson', group: SCREEN, title: 'Results: a lesson passed', results: 'lesson', pick: ['size'],
    look: 'The real lesson flow, played through at once (6 of 6 right, mini match won 2–1), up to its results card.' },
  { id: 'results-training', group: SCREEN, title: 'Results: training', results: 'training', pick: ['size'],
    look: 'The real training flow, played through at once (4 of 4 right), up to its results card.' },
  { id: 'results-match', group: SCREEN, title: 'Results: a match, Cup locked', results: 'match', pick: ['size'],
    look: 'The real match flow, played through at once (won 5–3), with the Cup still locked today.' },
  { id: 'menu', group: SCREEN, title: 'The grown-ups menu', screen: 'menu',
    look: 'Opened the way he would: holding the gear for a second. Its settings change only this page\'s throwaway save.' },
  { id: 'report', group: SCREEN, title: 'Progress: "How is he doing?"', screen: 'report',
    look: 'Uses the real decision log saved in this browser (read, never written); with none, a made-up sample.' },

  // ---------- goalkeeper ----------
  { id: 'keeper-game', group: KEEPER, title: 'Keeper mini game', keeper: 'game',
    look: 'The glove button: shots at him one after another, with two lives (a goal costs one); the shots get a little harder with each save. Tap a gold spot (between the ball and the goal), then where to dive (watch the shooter\'s eyes).' },
  { id: 'keeper-moment', group: KEEPER, title: 'Keeper moment in a match', keeper: 'match', size: '5v5', pick: ['seed'],
    look: 'Their player is through on our goal: the camera goes to our keeper ("You\'re the keeper!", the glove badge), the same two taps, then back to the match. Again: another one.' },
];
