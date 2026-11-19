// Lab A: "Your ball". He is whoever of our team has the ball: when a friend gets it, control goes with it, so every
// touch of his team is his choice, and play never cuts. With the ball, play slows right down and he taps a friend
// (pass), the goal (shoot) or the arrow (run with it). When they have it, he taps which of ours goes to the ball.
// 4 v 4, no keepers: enough friends for a real pass every time, few enough to see them all.
import { boot, dist, clamp } from '../common/lab.js';
import { Match } from '../common/match.js';
import { ballWindow as onBall } from '../common/onball.js';

const lab = await boot({ letter: 'A', name: 'Your ball, always', version: 'v1', size: '4v4', us: 'barca', them: 'madrid', onStart: () => setTimeout(() => ballWindow('hero'), 400) });
const m = new Match(lab, { n: 4 });
const { sim, L, W } = lab;
m.setup('us'); lab.ctrl = 'hero';

// ---------- with the ball: pass, shoot or run (common/onball.js) ----------
const ballWindow = id => onBall(lab, m, id, { follow: true });

// ---------- they have it: who goes? ----------
function whoWindow() {
  const c = m.owner(); if (!c || m.team(c) !== 'them' || lab.ended || m.dead) return;
  m.freeze = true; m.pressUs = null; lab.ctrl = null;
  const options = m.ids('us').map(id => ({ id: 'go:' + id, kind: 'player', who: id }));
  lab.open({ kind: 'who', options, slow: .3, hintAfter: 4.5, hintLine: 'one goes one guards', from: () => { const a = sim.a(m.owner() || c); return { x: a.x, y: a.y }; }, judge: judgeWho, onPick: o => {
    m.freeze = false; m.pressUs = o.who; lab.ctrl = o.who; lab.ctrlSoft = true;
    if (!o.good) m.after(1.8, () => { if (m.team(m.owner()) === 'them') m.pressUs = 'auto'; });
  } });
  judgeWho(options);
}
function judgeWho(os) {
  const c = sim.a(m.owner()) || sim.ball, ds = os.map(o => dist(sim.a(o.who), c)), dMin = Math.min(...ds);
  os.forEach((o, i) => { o.good = ds[i] < dMin + .8; o.best = ds[i] === dMin; o.word = o.good ? 'Closest!' : 'Too far!'; o.emo = o.good ? '👍' : '✋'; o.line = o.good ? 'great choice' : 'the closest one goes'; });
}

// ---------- the match's events ----------
m.on.gain = (id, how) => {
  if (m.team(id) === 'us') {
    m.pressUs = null; m.freeze = false; m.protect = null;
    if (how === 'tackle' || how === 'cut' || how === 'loose' || how === 'block') { lab.feedback(true, 'Our ball!', '💪'); if (how !== 'loose') lab.say('you won the ball'); }
    ballWindow(id);
  } else {
    lab.close(); m.hold = false; m.protect = null;
    if (how !== 'pass' && how !== 'kickoff') lab.feedback(false, 'Their ball', '🔄');
    m.after(how === 'pass' ? .35 : .5, whoWindow);
  }
};
m.on.lost = () => {};
m.on.goal = team => {
  lab.close(); lab.waiting = true; m.hold = m.freeze = false; m.pressUs = null; lab.ctrl = null;
  lab.feedback(team === 'us', team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? '⚽' : '😮');
  lab.say(team === 'us' ? 'great choice' : 'good try');
  showScore();
  setTimeout(() => m.kickoff(team === 'us' ? 'them' : 'us', () => { lab.waiting = false; }), 1800);
};
const showScore = () => lab.setScore(`<i>${lab.us.short}</i> ${m.score.us} – ${m.score.them} <i>${lab.them.short}</i>`);
showScore(); lab.extraScore = () => ({ ...m.score, passes: m.passes });
lab.onEnd = () => `<div><b>${m.score.us}–${m.score.them}</b><small>⚽ score</small></div>`;

// ---------- each step and the camera ----------
lab.tick = dt => {
  m.step(dt);
  // a pass that went astray and nobody of ours has the ball while no window is open: nothing to do but watch
  if (lab.ctrlSoft && m.owner() && m.team(m.owner()) === 'us' && !lab.win) lab.ctrlSoft = false;
};
lab.camWant = () => {
  const b = sim.ball, c = m.owner() ? sim.a(m.owner()) : b, x = clamp(c.x * .8 + L / 2 * .2, 8, L - 8);
  const close = lab.win ? 1 : 0;
  return { eye: [x - 1, -4.6 + close * .6, 9.2 - close * .5], tgt: [x, W * .47, 0], Ff: 1.06 + close * .06, Fw: .44, k: 2.2 };
};
lab.run();
