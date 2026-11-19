// Lab B: "Get open". He is one player (the orange boots and the ring) and stays him. Most of his choices are made
// without the ball, as in a real game: when a friend has it, he taps one of three gold spots to run to (one open, one
// hidden behind a defender, one crowding his friend); a good run gets the pass. When they have it, he taps where to go
// (in front of the ball, guard the open player, or chase from behind). With the ball: pass, shoot or run, as in Lab A,
// and after a pass the next choice is where to go next. 3 v 3: the spaces are big and easy to see.
import { boot, dist, clamp, onLane } from '../common/lab.js';
import { Match } from '../common/match.js';
import { ballWindow } from '../common/onball.js';

const lab = await boot({ letter: 'B', name: 'Get open first', version: 'v1', size: '3v3', us: 'barca', them: 'madrid', onStart: () => setTimeout(() => ballWindow(lab, m, 'hero'), 400) });
const m = new Match(lab, { n: 3, isAI: id => id !== 'hero' });
m.canPass = (id, to) => to !== 'hero'; // a friend passes to him only after a run he chose (or by the rules of the run)
const { sim, L, W } = lab;
m.setup('us'); lab.ctrl = 'hero';
let run = null, job = null, idleT = 0;

// ---------- a friend has it: where do I run? ----------
function runWindow(F) {
  if (m.owner() !== F || lab.ended || m.dead || lab.win) return;
  const f = sim.a(F), h = sim.a('hero'), other = m.ids('us').find(x => x !== F && x !== 'hero'), o2 = other && sim.a(other), foes = m.foes('us');
  const inside = p => p.x > 1.5 && p.x < L - 1.5 && p.y > 1.5 && p.y < W - 1.5;
  const look = p => { let lane = 99, by = null, room = 99; for (const o of foes) { const c = onLane(o, f, p); if (c.d < lane) { lane = c.d; by = c.t < .9 ? o : null; } room = Math.min(room, dist(o, p)); } return { lane, by, room, crowd: Math.min(dist(p, f), o2 ? dist(p, o2) : 99) }; };
  const cands = [];
  for (const r of [4.5, 6.5, 8.5]) for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, p = { x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r }; if (inside(p) && dist(p, h) < 11) cands.push({ ...p, ...look(p) }); }
  const score = p => (p.x - f.x) * .6 + Math.min(p.lane, 3) + Math.min(p.room, 4) * .4 - dist(p, h) * .25;
  let open = cands.filter(p => p.lane >= 1.3 && p.room >= 2.2 && p.crowd >= 3.2).sort((p, q) => score(q) - score(p));
  if (!open.length) open = cands.filter(p => p.lane >= .9 && p.room >= 1.6 && p.crowd >= 2.6).sort((p, q) => score(q) - score(p));
  if (!open.length) open = cands.slice().sort((p, q) => score(q) - score(p));
  if (!open.length) { open = [{ x: clamp(f.x + 5, 2, L - 2), y: clamp(h.y, 2, W - 2) }]; Object.assign(open[0], look(open[0])); }
  const goodP = open[0], far = p => dist(p, goodP) > 3;
  const shadow = cands.filter(p => p.lane < .6 && p.by && p.crowd >= 3 && far(p)).sort((p, q) => dist(p, h) - dist(q, h))[0];
  const ca = Math.atan2(h.y - f.y, h.x - f.x), crowdP = [{ x: f.x + Math.cos(ca) * 1.8, y: f.y + Math.sin(ca) * 1.8 }, o2 && { x: o2.x + 1.4, y: o2.y }].filter(p => p && inside(p) && far(p) && (!shadow || dist(p, shadow) > 2.6))[0];
  const fwd = goodP.x - f.x > 2.5;
  const options = [{ id: 'spot:open', kind: 'spot', x: goodP.x, y: goodP.y, good: true, best: true, word: 'Open!', emo: '👍', line: fwd ? 'great run' : 'great choice', why: 'open' }];
  if (shadow) options.push({ id: 'spot:hidden', kind: 'spot', x: shadow.x, y: shadow.y, good: false, word: 'Hidden!', emo: '✋', line: 'move to open space so your friend can pass to you', why: 'shadow', by: shadow.by.id });
  if (crowdP) options.push({ id: 'spot:crowd', kind: 'spot', x: crowdP.x, y: crowdP.y, good: false, word: 'Too close!', emo: '✋', line: "don't crowd your friend", why: 'crowd' });
  m.freeze = true; m.protect = F;
  lab.open({ kind: 'run', options, slow: .3, hintAfter: 5, hintLine: 'get open', from: () => ({ x: sim.a(F).x, y: sim.a(F).y }), onPick: o => {
    sim.go('hero', o.x, o.y, 4.8); m.cmd.set('hero', sim.time + 6);
    run = { F, o, t: 0 };
  } });
}
// The run plays out: when he gets there (or after 2.5 s), a good run gets the pass; a run behind a defender gets a pass
// that defender cuts out; one next to his friend gets nothing, and his friend is on his own.
function runStep(dt) {
  if (!run) return;
  run.t += dt; const h = sim.a('hero'), { F, o } = run;
  if (m.owner() !== F) { run = null; m.freeze = false; m.protect = null; return; }
  if (dist(h, o) > .7 && run.t < 2.5) return;
  run = null; m.freeze = false;
  if (o.good) { m.protect = null; m.pass(F, 'hero', null); }
  else if (o.why === 'shadow') { m.protect = null; m.pass(F, 'hero', o.by); }
  else { m.protect = null; m.cmd.delete('hero'); }
}

// ---------- they have it: where do I go? ----------
function guardWindow() {
  const C = m.owner(); if (!C || m.team(C) !== 'them' || lab.ended || m.dead || lab.win) return;
  const c = sim.a(C), h = sim.a('hero'), friends = m.ids('us').filter(x => x !== 'hero').map(x => sim.a(x));
  const hD = dist(h, c), fD = Math.min(...friends.map(f => dist(f, c))), heroNear = hD < fD - .6, friendNear = fD < hD - .6;
  const gs = (p, k) => { const gx = 0 - p.x, gy = W / 2 - p.y, gl = Math.hypot(gx, gy) || 1; return { x: clamp(p.x + gx / gl * k, 1, L - 1), y: clamp(p.y + gy / gl * k, 1, W - 1) }; };
  const options = [];
  const add = o => { if (options.every(q => dist(q, o) > 2.3)) options.push(o); };
  add({ id: 'front', kind: 'spot', ...gs(c, 1.9), job: 'press', good: !friendNear, word: friendNear ? 'Friend closer!' : 'In front!', emo: friendNear ? '✋' : '👍', line: friendNear ? 'a friend was chasing the ball you guard the open player' : 'great choice' });
  for (const oid of m.ids('them').filter(x => x !== C)) add({ id: 'guard:' + oid, kind: 'spot', ...gs(sim.a(oid), 1.4), job: 'mark', who: oid, good: !heroNear, word: heroNear ? 'You were closest!' : 'Guard!', emo: heroNear ? '✋' : '👍', line: heroNear ? 'nobody was on the ball and you were closest go get it' : 'great choice' });
  add({ id: 'behind', kind: 'spot', x: clamp(c.x + 1.8, 1, L - 1), y: c.y, job: 'chase', good: false, word: 'Get in front!', emo: '✋', line: 'lost the ball get back in front of it' });
  const best = options.find(o => o.good && o.job === (heroNear ? 'press' : 'mark')) || options.find(o => o.good); if (best) best.best = true;
  m.freeze = true; m.pressUs = null;
  lab.open({ kind: 'guard', options, slow: .3, hintAfter: 5, hintLine: 'one goes one guards', from: () => ({ x: sim.a('hero').x, y: sim.a('hero').y }), onPick: o => {
    m.freeze = false;
    if (o.job === 'press') { job = null; m.pressUs = 'hero'; m.cmd.delete('hero'); }
    else if (o.job === 'mark') { job = { mark: o.who }; m.pressUs = 'auto'; }
    else { job = { chase: true, t: 0 }; sim.go('hero', o.x, o.y, 4.4); m.cmd.set('hero', sim.time + 1.4); m.pressUs = null; m.after(1.5, () => { if (m.team(m.owner()) === 'them') m.pressUs = 'auto'; }); }
  } });
}
function jobStep(dt) {
  if (!job) return;
  if (m.team(m.owner()) !== 'them' && sim.ball.state === 'carried') { job = null; return; }
  if (job.mark) { const o = sim.a(job.mark), gx = -o.x, gy = W / 2 - o.y, gl = Math.hypot(gx, gy) || 1; sim.go('hero', clamp(o.x + gx / gl * 1.3, 1, L - 1), clamp(o.y + gy / gl * 1.3, 1, W - 1), 3.6); m.cmd.set('hero', sim.time + .3); }
}

// ---------- the match's events ----------
m.on.gain = (id, how) => {
  job = null; run = null; m.freeze = false; m.protect = null; idleT = 0;
  if (m.team(id) === 'us') {
    m.pressUs = null; if (lab.win?.kind === 'guard') lab.close();
    if (how === 'tackle' || how === 'cut' || how === 'block') { lab.feedback(true, 'Our ball!', '💪'); if (id === 'hero') lab.say('great steal'); }
    if (id === 'hero') { lab.close(); ballWindow(lab, m, 'hero'); }
    else m.after(.3, () => runWindow(id));
  } else {
    lab.close(); m.hold = false;
    if (how !== 'pass' && how !== 'kickoff') lab.feedback(false, 'Their ball', '🔄');
    m.after(.45, guardWindow);
  }
};
m.on.goal = team => {
  lab.close(); lab.waiting = true; m.hold = m.freeze = false; m.pressUs = null; job = run = null;
  lab.feedback(team === 'us', team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? '⚽' : '😮');
  lab.say(team === 'us' ? 'great choice' : 'good try'); showScore();
  setTimeout(() => m.kickoff(team === 'us' ? 'them' : 'us', () => { lab.waiting = false; }), 1800);
};
const showScore = () => lab.setScore(`<i>${lab.us.short}</i> ${m.score.us} – ${m.score.them} <i>${lab.them.short}</i>`);
showScore(); lab.extraScore = () => ({ ...m.score, passes: m.passes });
lab.onEnd = () => `<div><b>${m.score.us}–${m.score.them}</b><small>⚽ score</small></div>`;

lab.tick = dt => {
  m.step(dt); runStep(dt); jobStep(dt);
  // never long without a choice: a friend who keeps the ball, or their long spell on it, asks again
  const c = m.owner();
  if (!lab.win && !run && c && !m.dead && c !== 'hero') { if ((idleT += dt) > 2.6) { idleT = 0; if (m.team(c) === 'us') runWindow(c); else if (!job || job.chase) guardWindow(); } }
  else idleT = 0;
};
lab.camWant = () => {
  const b = sim.ball, h = sim.a('hero'), c = m.owner() ? sim.a(m.owner()) : b, x = clamp((c.x * .55 + h.x * .45) * .85 + L / 2 * .15, 8, L - 8), close = lab.win ? 1 : 0;
  return { eye: [x - 1, -4.6 + close * .6, 9.2 - close * .5], tgt: [x, W * .47, 0], Ff: 1.06 + close * .06, Fw: .44, k: 2.2 };
};
lab.run();
