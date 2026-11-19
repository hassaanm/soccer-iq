// Lab A: "Your ball". He is whoever of our team has the ball: when a friend gets it, control goes with it, so every
// touch of his team is his choice, and play never cuts. With the ball, play slows right down and he taps a friend
// (pass), the goal (shoot) or the arrow (run with it). When they have it, he taps which of ours goes to the ball.
// 4 v 4, no keepers: enough friends for a real pass every time, few enough to see them all.
import { boot, dist, clamp } from '../common/lab.js';
import { Match } from '../common/match.js';

const lab = await boot({ letter: 'A', name: 'Your ball', version: 'v1', size: '4v4', us: 'barca', them: 'madrid', onStart: () => setTimeout(() => ballWindow('hero'), 400) });
const m = new Match(lab, { n: 4 });
const { sim, L, W } = lab;
m.setup('us'); lab.ctrl = 'hero';

// ---------- with the ball: pass, shoot or run ----------
function ballWindow(id) {
  if (m.owner() !== id || lab.ended || m.dead) return;
  const me = sim.a(id), friends = m.ids('us').filter(f => f !== id), toGoal = Math.atan2(W / 2 - me.y, L - me.x);
  const options = friends.map(f => ({ id: 'pass:' + f, kind: 'player', who: f, act: 'pass', to: f }));
  if (L - me.x < 17) options.push({ id: 'shoot', kind: 'goal', act: 'shoot' });
  options.push({ id: 'run', kind: 'arrow', who: id, ang: clamp(toGoal, -.9, .9), act: 'run' });
  m.hold = true; lab.ctrl = id; lab.ctrlSoft = false;
  lab.open({ kind: 'ball', options, slow: .22, hintAfter: 5, hintLine: 'see who is open', from: () => ({ x: sim.a(id).x, y: sim.a(id).y }), judge: os => judgeBall(id, os), onPick: o => act(id, o) });
  judgeBall(id, options);
}
// What each choice is worth now. Best: a shot when it is on; else a pass that gains clearly more than running with it
// (at this age staying on the ball comes first); else the run; else the most forward open pass.
function judgeBall(id, os) {
  const me = sim.a(id);
  for (const o of os) {
    o.best = false;
    if (o.act === 'pass') {
      const c = m.passCheck(id, o.to), n = lab.nameOf(o.to); o.check = c; o.good = c.open; o.gain = c.open ? c.fwd : -99;
      o.word = c.open ? 'Open!' : c.why === 'lane' ? 'In the way!' : 'Guarded!';
      o.line = c.open ? `${n} is open` : c.why === 'lane' ? 'he was in the way of the pass' : 'a defender was right there';
      o.emo = c.open ? '👍' : '✋';
    } else if (o.act === 'shoot') {
      const c = m.shotCheck(id); o.check = c; o.good = c.good;
      o.word = c.good ? 'Shoot!' : c.why === 'far' ? 'Too far!' : 'Blocked!';
      o.line = c.good ? 'great choice' : c.why === 'far' ? 'too far to shoot get closer first' : 'a defender was in the way dribble around him then shoot';
      o.emo = c.good ? '🥅' : '✋';
    } else if (o.act === 'run') {
      const c = m.runCheck(id, o.ang); o.check = c; o.good = c.good;
      o.word = c.good ? 'Space!' : 'Defender!'; o.line = c.good ? 'space ahead keep it and run' : 'a defender was right there'; o.emo = c.good ? '🏃' : '✋';
    }
  }
  const shot = os.find(o => o.act === 'shoot' && o.good), run = os.find(o => o.act === 'run' && o.good);
  const passes = os.filter(o => o.act === 'pass' && o.good).sort((p, q) => q.gain - p.gain);
  const best = shot || (passes[0] && passes[0].gain > 4 ? passes[0] : null) || run || passes[0];
  if (best) best.best = true;
  else { // nothing on: running away from the pressure into space is the right idea
    const near = m.foes('us').sort((p, q) => dist(p, me) - dist(q, me))[0], away = Math.atan2(me.y - near.y, me.x - near.x);
    const r = os.find(o => o.act === 'run'); r.ang = away; r.good = r.best = true; r.word = 'Space!'; r.line = 'run where nobody is'; r.emo = '🏃';
  }
}
function act(id, o) {
  m.hold = false;
  if (o.act === 'pass') { m.pass(id, o.to, o.good ? null : o.check.by); lab.ctrl = o.to; lab.ctrlSoft = true; }
  else if (o.act === 'shoot') m.shoot(id, o.check);
  else {
    const me = sim.a(id), tx = me.x + Math.cos(o.ang) * 4.2, ty = me.y + Math.sin(o.ang) * 4.2;
    if (o.good) { m.protect = id; m.dribble(id, tx, ty, 3.9, 1.3); m.after(1.15, () => { if (m.protect === id) m.protect = null; ballWindow(id); }); }
    else { m.dribble(id, tx, ty, 3.4, 1.4); m.pressThem = o.check.by || null; m.after(1.6, () => { m.pressThem = null; if (m.owner() === id) ballWindow(id); }); }
  }
}

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
  return { eye: [x - 1, -3 + close * .6, 8.5 - close * .5], tgt: [x, W * .55, 0], Ff: 1.06 + close * .06, Fw: .44, k: 2.2 };
};
lab.run();
