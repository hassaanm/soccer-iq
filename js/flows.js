// What a tap on PLAY, Match or Cup starts. Each flow sets the stage, plays its rounds or its match, saves the
// progress and fills in the results card.
import { $, $$, wireSheet } from './ui/dom.js';
import { P, save } from './ui/store.js';
import { hud } from './ui/hud.js';
import { say, unlockSpeech } from './ui/speech.js';
import { world, game } from './ui/stage.js';
import { show, card } from './ui/screens.js';
import { fillResults } from './ui/results.js';
import { renderPickers, lessonOpen, trainingNext } from './ui/home.js';
import { shirtImg } from './ui/shirt.js';
import { teamById, displayName } from './teams.js';
import { PATH, UNLOCKS, BUILDS, skillById, sessionRounds } from './skills.js';
import { CUPS, cupById, newCup, roundsOf, goalsToWin } from './cups.js';
import { generate } from './generate.js';
import { preloadClips } from './sound.js';
import { pieces } from './voice.js';
import { shuffle } from './geom.js';
import { nextSkill, reviewsDue, finishSession, reviewed, level, skills, graduated, playOpen, trainingPlan, trained, note, today } from './progress.js';

// ---------- shared steps ----------
// One flow runs at a time. If one breaks, he lands back on the home screen instead of a stuck field.
let running = false;
const flow = fn => async (...args) => {
  if (running) return;
  running = true; unlockSpeech();
  try { await fn(...args); } catch (e) { console.error(e); game.home(); show('#home'); } finally { running = false; }
};
const seed = () => Math.floor(Math.random() * 1e9);
// `n` new scenes drawn from the lessons in `ids`.
const fresh = (n, ids) => Array.from({ length: n }, () => generate(ids[Math.floor(Math.random() * ids.length)], seed())).filter(Boolean);
// The teams take the field: the park for practice, the stadium for matches.
function setStage(us, them, env) {
  game.setTeams(us, them);
  preloadClips([...us.players, ...them.players].map(p => 'name:' + pieces(displayName(p.name))[0]?.name));
  world.setEnv(env); show(null); hud.hideScore(); hud.dots([], 0);
}
// Matches use every situation from the lessons he has passed, with everything those lessons unlock.
function matchSkills() { const has = skills(P, PATH); game.skills = has; return has.size ? [...has] : ['look-up']; }
// Plays the rounds in order. Returns, per round, whether he got it right on the first try.
// Hints (the glowing cue, LOOK pulsing) show in the first `early` rounds, and after two misses in a row.
async function playRounds(rounds, early, onRound) {
  const results = [];
  let misses = 0;
  hud.dots(results, rounds.length);
  for (const [i, sc] of rounds.entries()) {
    const r = await game.round(sc, { hint: i < early || misses >= 2 }), right = r.firstTry && r.stars === 3;
    results.push(right); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, rounds.length);
    onRound?.(sc, right);
  }
  return results;
}
// The results card comes up, and the coach says the headline.
function finish(said) { say(said); game.home(); show('#results'); renderPickers(); }
const scoreLine = (us, them, s) => `${us.short} ${s.us} – ${s.them} ${them.short}`;
const outside = sk => (sk.outside ? `<b>🏡 Try it outside</b>${sk.outside}` : '');
const countRight = results => `${results.filter(Boolean).length} of ${results.length} right on the first try`;

// ---------- a lesson ----------
// A card (with the demo the first time), the lesson's rounds with review rounds mixed in, then a mini match.
const howTo = (sk, hero) => sk.id === 'steal-it' ? `You are ${hero}, defending. Tap STEAL when the ball rolls away from his feet.`
  : sk.id === 'peek-and-turn' ? `You are ${hero}. A friend passes to you. Drag to peek behind you, then tap the arrow to turn.`
  : sk.id === 'give-and-go' ? `You are ${hero}. Pass, then tap where to run.`
  : sk.side === 'defense' ? `You are ${hero}, defending. Tap 👀 to look up, then tap where to run.`
  : sk.id === 'get-open' ? `You are ${hero}. A friend has the ball. Tap 👀 to look up, then tap where to run.` : `You are ${hero}. Tap 👀 to look up, then drag to look around.`;
const runLesson = flow(async () => {
  const skillId = nextSkill(P, PATH), sk = skillById(skillId), lvl = level(P, skillId);
  // Reviews: 1 round in a lesson's first session, 2 at Levels 1–2, 3 at Level 3 (mixing in more old lessons).
  const reviews = reviewsDue(P, PATH, skillId).slice(0, lvl === 0 ? 1 : lvl >= 3 ? 3 : 2);
  const us = teamById(P.us), them = teamById(P.them), hero = displayName(us.players[0].name);
  setStage(us, them, 'park'); // practice at the park; the mini match is in the stadium
  // The demo plays the first time a lesson is played; after that it's one tap away.
  const firstTime = !P.skills[skillId]?.sessions;
  const watch = await card({ emoji: sk.emoji, title: sk.kid, sub: firstTime ? `Watch ${hero} first` : `Want to watch ${hero} first?`,
    button: firstTime ? 'Watch' : 'Play', alt: firstTime ? 'Skip' : 'Watch' });
  if (firstTime ? watch === 'main' : watch === 'alt') await game.demo(skillId);
  await card({ emoji: '⭐', title: 'Your turn!', sub: howTo(sk, hero), button: 'Play' });
  // This lesson's rounds (the same scenes the first time, fresh ones after), with one review round from each
  // lesson that is due mixed in after the first two.
  const own = sessionRounds(skillId, P.settings.rounds - reviews.length, { first: firstTime, level: Math.max(1, lvl) });
  const rev = reviews.map(id => generate(id, seed(), { even: true })).filter(Boolean);
  const rounds = [...own.slice(0, 2), ...shuffle([...own.slice(2), ...rev])], need = Math.ceil(rounds.length * 2 / 3);
  const results = await playRounds(rounds, lvl <= 1 ? 2 : 0, (sc, right) => { if (sc.skill !== skillId) { reviewed(P, sc.skill, right); save(); } });
  // Score the lesson before the mini match, so a skill passed just now is already in it.
  const st = finishSession(P, skillId, results.filter(Boolean).length, rounds.length);
  P.pick = null; note(P, skillId, results.filter((_, i) => rounds[i].skill === skillId)); P.openDay = today(); save();
  world.setEnv('crowd'); game.skills = skills(P, PATH);
  await card(st.unlocked ? { emoji: '🔓', title: 'New in matches!', sub: `${UNLOCKS[skillId]}. First to 2 goals wins.`, button: 'Kick off' }
    : !st.passedNow && level(P, skillId) === 0 ? { emoji: '🏟️', title: 'Mini match!', sub: `Get ${need} right next time to unlock this in matches. First to 2 goals wins.`, button: 'Kick off' }
    : { emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: 'Kick off' });
  const score = await game.match([skillId, ...reviews], fresh(6, [skillId, ...reviews])), won = score.us > score.them;
  P.stickers.push({ emoji: won ? '🏆' : sk.emoji, skill: skillId, at: Date.now() }); save();
  const i = PATH.findIndex(s => s.id === skillId), nextSk = PATH[i + 1];
  fillResults({
    sticker: won ? '🏆' : sk.emoji, trophy: won, title: won ? 'You won!' : 'Great try!', line: scoreLine(us, them, score),
    rounds: results, note: countRight(results),
    // Level news, then a backyard game for the grown-up.
    news: st.unlocked ? `🔓 Unlocked: ${UNLOCKS[skillId]}` : st.leveledUp ? `${'⭐'.repeat(st.level)} Level ${st.level}!` : !level(P, skillId) ? `Get ${need} right to unlock the next lesson` : '',
    extra: outside(sk),
    // The next lesson opens once this one is passed.
    main: nextSk && lessonOpen(i + 1) ? { kind: 'lesson', text: 'Next lesson', go: () => { P.pick = nextSk.id; save(); runSession(); } } : null,
    other: { kind: 'lesson', icon: '↺', text: 'Play again', go: () => { P.pick = skillId; runSession(); } },
    paper: won ? 70 : 0,
  });
  finish(won ? 'You won! You got a new sticker!' : 'Great try! You got a new sticker!');
});

// ---------- today's training ----------
// Once every lesson is passed, PLAY is a short mixed session: the 3 lessons he needs most today (see trainingPlan),
// 2 rounds each, mixed so he has to work out which idea fits. It opens with a reminder of the 3 ideas, and
// finishing it opens Match and Cup for the day.
// The tip without the lesson name, when the tip opens with it as its own sentence ("Get open! Move to…").
const tipAfterName = k => {
  const rest = k.tip.startsWith(k.kid) ? k.tip.slice(k.kid.length) : null;
  return rest !== null && (/[.!?]$/.test(k.kid) || /^[.!?]/.test(rest)) ? rest.replace(/^[.!?\s]+/, '') : k.tip;
};
const runTraining = flow(async () => {
  const day = today(), plan = trainingPlan(P, PATH, { day, builds: BUILDS }), sks = plan.map(skillById);
  setStage(teamById(P.us), teamById(P.them), 'park');
  await card({ emoji: '💪', title: "Today's training!", html: `<span class="remind">${sks.map(k => `<span><i>${k.emoji}</i><b>${k.kid}</b><small>${tipAfterName(k)}</small></span>`).join('')}</span>`,
    lines: sks.map(k => k.kid), button: 'Play' });
  const scene = id => { for (let k = 0; k < 8; k++) { const sc = generate(id, seed(), { even: true }); if (sc) return sc; } return null; };
  const rounds = Array.from({ length: P.settings.rounds }, (_, i) => scene(plan[i % plan.length])).filter(Boolean), per = {};
  const results = await playRounds(rounds, 0, (sc, right) => (per[sc.skill] ||= []).push(right));
  const ups = plan.filter(id => per[id] && trained(P, id, per[id], { day, builds: BUILDS }).leveledUp);
  P.openDay = day; P.sessions++; P.pick = null; save();
  // The backyard game is for the idea he missed most today.
  const weak = skillById(plan.find(id => per[id]?.some(ok => !ok)) || plan[0]);
  fillResults({
    emoji: '💪', title: 'Training done!', line: '⚽ Match and 🏆 Cup are open!', rounds: results, note: countRight(results),
    news: ups.map(id => `${'⭐'.repeat(level(P, id))} ${skillById(id).kid}`).join(' · '), extra: outside(weak),
    main: { kind: 'cup', icon: '🏆', text: 'Cup', go: openCups }, other: { kind: 'match', icon: '⚽', text: 'Match', go: runFreePlay },
    paper: 50,
  });
  finish('Training done!');
});
// PLAY: the next lesson, or today's training once every lesson is passed.
export const runSession = () => (trainingNext() ? runTraining() : runLesson());

// ---------- match ----------
// First to 3 goals, mixing every lesson he has passed (attack and defense).
export const runFreePlay = flow(async () => {
  const ids = matchSkills(), us = teamById(P.us), them = teamById(P.them);
  setStage(us, them, 'crowd');
  await card({ emoji: '⚽', title: 'Match time!', sub: `First to 3 goals. ${us.name} vs ${them.name}`, button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), 3, 'free'), won = score.us > score.them;
  if (won) { P.stickers.push({ emoji: '🏆', skill: 'free', at: Date.now() }); save(); }
  fillResults({
    emoji: '⚽', sticker: won ? '🏆' : null, trophy: true, title: won ? 'You won the match!' : 'Good game!', line: scoreLine(us, them, score),
    main: { kind: 'cup', icon: '🏆', text: 'Cup', go: openCups }, other: { kind: 'match', icon: '↺', text: 'Play again', go: runFreePlay },
    paper: won ? 70 : 0,
  });
  finish(won ? 'You won the match!' : 'Good game!');
});

// ---------- cups ----------
// The cup sheet: every cup as a same-size tile. Dots show the rounds (green = won, gold = next);
// a badge counts the trophies won.
export function openCups() {
  show('#home');
  $('#cups').innerHTML = CUPS.map(c => {
    const won = (P.trophies || []).filter(t => t.cup === c.id).length, run = P.cup?.id === c.id ? P.cup : null;
    const dots = roundsOf(c).map((_, i) => `<i class="${run && i < run.round ? 'done' : run && i === run.round ? 'now' : ''}"></i>`).join('');
    return `<button class="tile ${run ? 'on' : ''}" data-id="${c.id}">${won ? `<span class="won">🏆${won > 1 ? won : ''}</span>` : ''}`
      + `<span class="e">${c.emoji}</span><span class="k">${c.name}</span><span class="dots">${dots}</span></button>`;
  }).join('');
  for (const t of $$('#cups .tile')) t.onclick = () => { $('#cupSheet').classList.add('hidden'); runCup(t.dataset.id); };
  $('#cupSheet').classList.remove('hidden');
}
wireSheet('#cupSheet', '#cupClose');
// The road to the trophy: one same-size step per round (won, next, still to come), then the cup.
const STEP = { 'Quarter-final': 'Quarters', 'Semi-final': 'Semis', Final: 'Final' };
function cupPath(run) {
  const cup = cupById(run.id);
  const steps = roundsOf(cup).map((name, i) => {
    const t = teamById(run.opps[i]), st = i < run.round ? 'done' : i === run.round ? 'now' : '';
    return `<span class="step ${st}"><small>${STEP[name]}</small><span class="pic"><img src="${shirtImg(t)}" alt="">${st === 'done' ? '<em>✓</em>' : ''}</span><b>${t.short}</b></span>`;
  });
  return `<span class="cuppath">${steps.join('<span class="link"></span>')}<span class="link"></span><span class="step prize"><small>Win</small><span class="pic">${cup.emoji}</span><b>Cup!</b></span></span>`;
}
// One round of a cup. The run (team, opponents, round reached) is saved, so a cup can span several days.
const runCup = flow(async cupId => {
  // Only one cup run is kept. Starting another cup would wipe a run with rounds already won, so ask first.
  if (P.cup && P.cup.id !== cupId && P.cup.round > 0) {
    const r = await card({ emoji: '🏆', title: 'Start a new cup?', sub: `Your ${cupById(P.cup.id).name} run starts over if you do.`, button: 'New cup', alt: 'Keep going' });
    if (r === 'alt') cupId = P.cup.id;
  }
  const cup = cupById(cupId);
  if (P.cup?.id !== cupId) { P.cup = newCup(cup, P.us); save(); }
  const run = P.cup, names = roundsOf(cup), us = teamById(run.team), them = teamById(run.opps[run.round]), final = run.round === names.length - 1;
  const ids = matchSkills(), again = () => runCup(cupId);
  setStage(us, them, 'crowd');
  await card({ emoji: cup.emoji, title: cup.name, html: `<b>${names[run.round]}</b> · ${us.name} vs ${them.name} · first to ${goalsToWin(run)} goals${cupPath(run)}`, lines: final ? ['The final!'] : [], button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), goalsToWin(run), 'free'), won = score.us > score.them, line = scoreLine(us, them, score);
  if (won && final) { (P.trophies ||= []).push({ cup: cup.id, team: run.team, at: Date.now() }); P.cup = null; }
  else if (won) run.round++;
  save();
  if (won && final) {
    fillResults({ sticker: cup.emoji, trophy: true, title: 'Champions!', line, news: `You won the ${cup.name}!`, main: { kind: 'cup', icon: '🏆', text: 'Another cup', go: openCups }, paper: 140 });
    return finish('You won the cup!');
  }
  const round = names[run.round];
  fillResults({
    emoji: cup.emoji, title: won ? 'You won!' : 'So close!', line, news: won ? `On to the ${round.toLowerCase()}!` : `Play the ${round.toLowerCase()} again!`, extra: cupPath(run),
    main: { kind: 'cup', icon: '⚽', text: won ? round : 'Try again', go: again }, other: { kind: 'cup', icon: '🏆', text: 'All cups', go: openCups },
    paper: won ? 70 : 0,
  });
  finish(won ? 'You won! On to the next round!' : 'So close! Try again!');
});

// Match and Cup need today's lesson or training first (a grown-up can open them in the menu).
export async function gated(run) {
  if (playOpen(P)) return run();
  const r = await card({ emoji: '🔒', title: 'Train first!', sub: `Do today's ${graduated(P, PATH) ? 'training' : 'lesson'} to open Match and Cup.`, button: '💪 Train', alt: 'Not now' });
  if (r === 'main') runSession();
}
