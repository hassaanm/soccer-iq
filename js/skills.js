// The learning path (see research/curriculum-plan.md) and the scenarios for each lesson.
import { shuffle, PITCH, onSize, sizeOf } from './geom.js';
import { generate, generates, demoFor, patternsOf } from './generate.js';
export { PITCH };

// Five chapters, in the order US Youth Soccer, US Soccer and the FA teach them: me and the ball, winning it back on
// my own, playing with friends (starting with looking before the ball comes), the team, then the clever passes
// (wall passes and through balls come at about 9–10). See research/curriculum-plan.md.
export const CHAPTERS = ['Me and the ball', 'Win it back', 'Me and my friends', 'Our team', 'Clever passes'];

// side: 'attack' (he has the ball, or his team has it) or 'defense' (the other team has it). tip: the one cue, said to him.
// outside: a backyard game for the grown-up (shown on the results screen, not spoken).
// added: a lesson put in after children already had saved games (js/progress.js keeps their open lessons open).
// `keeper`: a lesson only for sizes with a keeper (5v5): it is on the path only then (PATH, below), and the lessons after
// it never wait for it (progress.js isOpen).
const ALL = [
  { id: 'look-up', ch: 0, emoji: '👀', kid: 'Look up!', side: 'attack', adult: 'Scan before deciding: goal, then space, then friends', ready: true,
    tip: 'Look up! Where is the space?', outside: 'Dribble around the yard. Hold up some fingers: he shouts how many without stopping.' },
  { id: 'dribble-to-space', ch: 0, emoji: '💨', kid: 'Run into space', side: 'attack', adult: 'Small touches vs. a big push into space', ready: true,
    tip: 'Lots of space? Push it and go!', outside: 'Open grass: he pushes it far and races after it. You stand close: he keeps it close and goes around you.' },
  { id: 'take-him-on', ch: 0, emoji: '⚡', kid: 'Take him on!', side: 'attack', adult: '1v1: stay on the ball and dribble past a lone defender', ready: true,
    tip: 'Only one defender? Dribble past him!', outside: 'Play 1v1 to a small goal. A goal only counts if he dribbles past you first.' },
  { id: 'shoot-close', ch: 0, emoji: '🥅', kid: 'Shoot when close!', side: 'attack', adult: 'Shoot from close range with a clear look; get closer or go around otherwise', ready: true,
    tip: 'Close to the goal and nobody in the way? Shoot!', outside: 'Mark a line near the goal. Goals only count from inside the line, so he dribbles closer first.' },
  { id: 'inside-laces', ch: 0, emoji: '🦶', kid: 'Inside or laces?', side: 'attack', added: true, ready: true,
    adult: 'Choose the shot: the inside of the foot to place it from close (in the box); the laces for pace from the edge of the box; farther out, get closer first. (The game makes its close shots need placing: from very close, laces are not always wrong.)',
    tip: 'Close? Inside, for control. Far? Laces, for power!', outside: 'Two lines of cones. From the near line only inside-of-the-foot goals count; from the far line only laces goals, while you walk slowly across the goal.' },
  { id: 'shoot-space', ch: 0, emoji: '🎯', kid: 'Shoot to the space!', side: 'attack', added: true, ready: true, keeper: true,
    adult: 'Finishing past a keeper: look, then pass it low into the bigger open side of the goal. If the keeper rushes out, go round him; if a friend is free at the far post, pass it across.',
    tip: 'Keeper in goal? Shoot to the big space!', outside: 'Pass it into the goal: stand in goal, a step off the middle. Goals count only into the bigger side, along the ground with the inside of the foot. Then swap.' },
  { id: 'follow-shot', ch: 0, emoji: '👟', kid: 'Follow your shot!', side: 'attack', adult: 'Follow up every shot: keep running in for the rebound off a block or the post', ready: true, added: true,
    tip: 'You shot? Keep running in!', outside: 'Stand in goal and knock every shot back out. A goal from the rebound counts double.' },
  { id: 'get-goal-side', ch: 1, emoji: '💪', kid: 'Get back in front!', side: 'defense', adult: 'Lost the ball: the closest player gets between the ball and goal and wins it back', ready: true,
    tip: 'Lost the ball? Get back in front of it!', outside: 'Take the ball off him and dribble to his goal. He races to get in front of you before you shoot.' },
  { id: 'steal-it', ch: 1, emoji: '🦶', kid: 'Steal it!', side: 'defense', adult: '1v1 defending: stay in front, wait, and tackle when the touch is loose', ready: true,
    tip: 'Stay in front. Steal it when it rolls away!', outside: 'Dribble slowly at him with some big touches. He waits in front and pokes the ball away after a big touch.' },
  { id: 'won-it-go', ch: 1, emoji: '🚀', kid: 'Won it? Go!', side: 'attack', adult: 'Transition: after winning the ball, attack fast while the other team is out of place', ready: true,
    tip: 'You won the ball? Go forward fast!', outside: 'Dribble at him. When he wins the ball, he races to your end line before you can turn around.' },
  { id: 'peek-and-turn', ch: 2, emoji: '🔄', kid: 'Peek, then turn!', side: 'attack', adult: 'Scan before receiving (shoulder check) and turn away from pressure with the first touch', ready: true,
    tip: 'Peek over your shoulder. Then turn away from the defender!', outside: 'Pass to him while you creep up behind him on one side. He peeks, then turns the other way with his first touch.' },
  { id: 'see-the-trap', ch: 2, emoji: '🚧', kid: 'Two defenders? Pass!', side: 'attack', adult: 'Recognize a 2v1 trap and release the ball to a free friend', ready: true,
    tip: 'Two defenders coming? Pass to an open friend.', outside: 'Play 2v1 with a friend on his team. When you and another grown-up close in on him, he passes.' },
  { id: 'pass-to-open', ch: 2, emoji: '🎯', kid: 'Pass to the open friend', side: 'attack', adult: 'Choose the unmarked teammate', ready: true,
    tip: 'Pass to the friend with nobody right next to him.', outside: 'Two cones are friends. Stand next to one: he passes to the other.' },
  { id: 'get-open', ch: 2, emoji: '🙋', kid: 'Get open!', side: 'attack', adult: 'Off the ball: move into a clear passing lane, away from your defender; spread out', ready: true,
    tip: 'Your friend has the ball? Find open space!', outside: 'You have the ball and a cone stands between you. He moves until you can pass to him.' },
  { id: 'go-to-goal', ch: 2, emoji: '👬', kid: 'Run to the goal too!', side: 'attack', adult: 'Off the ball in a 2v1: when a friend dribbles at goal, run toward goal on the open side, level or ahead, so the defender has to pick one', ready: true, added: true,
    tip: 'Your friend has the ball? Run to the goal, so he can pass to you!', outside: 'Play 2v1 to a small goal: you defend while a friend or sibling dribbles. A goal from a pass counts double, so he runs to the goal beside the dribbler.' },
  { id: 'one-goes', ch: 3, emoji: '🛡️', kid: 'One goes, one guards', side: 'defense', adult: 'One presses the ball; the others mark the free attackers, goal-side', ready: true,
    tip: 'A friend is on the ball? Guard the open player. Nobody on it? You go!', outside: 'With a friend: only one of them may chase you. The other guards the cone you want to pass to.' },
  { id: 'forward-first', ch: 3, emoji: '⬆️', kid: 'Forward first', side: 'attack', adult: 'Play forward (shoot, dribble or pass); nothing forward: keep the ball', ready: true,
    tip: 'Look to the goal first! Nothing forward? Keep the ball.', outside: 'Before he plays the ball, he points to the goal, then to a friend ahead.' },
  { id: 'lead-pass', ch: 4, emoji: '🏃', kid: 'Pass in front!', side: 'attack', adult: 'Lead pass: to a running friend, pass into the space ahead of him, where he will be, not to his feet', ready: true, added: true,
    tip: 'Your friend is running? Pass it in front of him!', outside: 'Jog across the yard. He passes it in front of you, so you can keep running without stopping.' },
  { id: 'give-and-go', ch: 4, emoji: '🔁', kid: 'Pass and go!', side: 'attack', adult: 'Give-and-go: pass, then run past the defender for the return pass', ready: true,
    tip: 'Pass it, then run past your defender to get it back!', outside: 'Be a wall: he passes to you, runs past a cone, and you pass it back in front of him.' },
];
// The lessons of the size being played, in order (kept up to date in place when the size changes).
export const PATH = [];
onSize(() => { PATH.length = 0; PATH.push(...ALL.filter(s => !s.keeper || sizeOf().keeper)); });
export const ALL_LESSONS = ALL;
export const skillById = id => ALL.find(s => s.id === id);

// What passing each lesson adds to matches and free play (shown when it unlocks). Every lesson also adds its
// own situations to free play.
export const UNLOCKS = {
  'look-up': 'Look up, pass and dribble',
  'dribble-to-space': 'Big pushes into space',
  'take-him-on': '1v1 chances',
  'shoot-close': 'Chances to shoot',
  'inside-laces': 'Pick your shot: inside or laces',
  'shoot-space': 'Pick the space in the goal',
  'follow-shot': 'Blocked shots: run in for the rebound',
  'get-goal-side': 'You pick where to run when they have the ball',
  'steal-it': 'STEAL when you get in front of him',
  'won-it-go': 'Win it, then go! Play keeps going',
  'peek-and-turn': 'Peek and turn when a friend passes to you',
  'see-the-trap': 'Two-defender traps',
  'get-open': 'After you pass, you pick where to run',
  'pass-to-open': 'More passing chances',
  'go-to-goal': 'When a friend has the ball, you run to the goal',
  'lead-pass': 'Passes in front of a running friend',
  'give-and-go': 'Pass and go: run past him for the ball back',
  'one-goes': 'Guard the open player',
  'forward-first': 'Forward-first chances',
};

// The earlier lessons each lesson includes. Daily training treats those as practiced whenever the later lesson
// comes up (almost everything starts with looking up), so it spends its rounds on the bigger ideas.
export const BUILDS = {
  'dribble-to-space': ['look-up'],
  'take-him-on': ['look-up', 'dribble-to-space'],
  'shoot-close': ['look-up'],
  'inside-laces': ['shoot-close'],
  'shoot-space': ['shoot-close', 'inside-laces'],
  'follow-shot': ['shoot-close'],
  'steal-it': ['get-goal-side'],
  'won-it-go': ['look-up', 'dribble-to-space'],
  'peek-and-turn': ['look-up'],
  'see-the-trap': ['look-up'],
  'pass-to-open': ['look-up'],
  'lead-pass': ['look-up', 'pass-to-open'],
  'give-and-go': ['look-up', 'pass-to-open', 'get-open'],
  'go-to-goal': ['look-up', 'get-open'],
  'one-goes': ['get-goal-side'],
  'forward-first': ['look-up', 'shoot-close', 'pass-to-open', 'dribble-to-space'],
};

// A fixed sample of generated scenarios per lesson (tests, the audit, and the mini match's starting plays).
export function allScenarios(skillId) {
  return generates(skillId) ? Array.from({ length: 10 }, (_, i) => generate(skillId, 101 + i)).filter(Boolean) : [];
}

export const demoScenario = skillId => demoFor(skillId);

// The rounds for one lesson session. The other situations are mixed in from the second round on, so one answer
// never gets drilled in before he sees when it doesn't fit (interleaved practice). Level 1 starts with the main
// situation (the one the demo showed) and comes back to it every other round; Level 2 and up give every
// situation the same share. The first time through, the same scenes every time (seeds 1..n), so the lesson
// starts familiar; after that, fresh scenes.
// How many places to run to in a run-to round: 3 at Level 1, 4 from Level 2 (v60).
export const runsAt = level => (level >= 2 ? 4 : 3);
export function sessionRounds(skillId, n, { first = false, level = 1, rnd = Math.random } = {}) {
  const pats = patternsOf(skillId); if (!pats.length) return [];
  const [main, ...others] = pats, mix = first ? others : shuffle(others, rnd);
  const order = [];
  if (level >= 2 || !others.length) { let bag = []; while (order.length < n) { if (!bag.length) bag = first ? [...pats] : shuffle([...pats], rnd); const k = bag.findIndex(p => p !== order[order.length - 1]); order.push(bag.splice(k < 0 ? 0 : k, 1)[0]); } }
  else for (let i = 0; order.length < n; i++) order.push(i % 2 === 0 ? main : mix[(i >> 1) % mix.length]);
  const out = [];
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const seed = first ? i + 1 : Math.floor(rnd() * 1e9), sc = generate(skillId, seed, { pattern: order[out.length], runs: runsAt(level) });
    if (sc) out.push(sc);
  }
  return out;
}

// A round list: n scenarios, no repeats until the bank runs out, never the same base twice in a row.
export function pickRounds(skillIds, n, rnd = Math.random) {
  const pool = shuffle(skillIds.flatMap(allScenarios), rnd), out = [];
  while (out.length < n && pool.length) {
    const prev = out[out.length - 1];
    const i = pool.findIndex(s => !prev || s.id.replace(/m$/, '') !== prev.id.replace(/m$/, ''));
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
