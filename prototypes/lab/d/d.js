// Lab D: "One player: step by step" (explicit). He picks one player of the four and is him for the whole match, seen
// from that player's own view (common/eyes.js: head down on the ball, LOOK UP, drag to turn his head). He can tap only
// what is on screen, so a friend or a spot behind him needs a look first. Each decision is announced by play slowing
// right down, as in the real game:
//  - with the ball: pass (tap a friend he can see), shoot (the goal), or run with it (the arrow);
//  - his team has it: three spots to run to, all round him (one open, one hidden behind a defender, one crowding);
//  - they have it: in front of the ball, guard the open one, or behind.
// Between his decisions play runs on by itself at a calm 0.7 speed. Friends favour him: open, he gets the pass 1.6 to 1
// over an equally open friend, and more often, unless a friend has a much better chance. The avatar (top right)
// pauses and lets him change player. 4 v 4.
import { boot, dist } from '../common/lab.js';
import { Match } from '../common/match.js';
import { ballWindow } from '../common/onball.js';
import { runSpots, guardSpots } from '../common/offball.js';
import { eyes, avatar, shirt, trackSight } from '../common/eyes.js';

const IDS = ['hero', 'm1', 'm2', 'm3'], FAVOR = 1.6, CALM = .7;
let me = 'hero';
const lab = await boot({ letter: 'D', name: 'One player: step by step', version: 'v1', size: '4v4', us: 'barca', them: 'madrid', tapOnUp: true, mustSee: true,
  picker: l => ({ title: 'Who are you?', items: IDS.map(id => { const p = l.us.players[id === 'hero' ? 0 : +id.slice(1)]; return { id, html: `${shirt(l.us, p.num, 70)}<b>${p.name}</b>` }; }) }),
  onPick: id => setMe(id), onStart: () => setTimeout(next, 500) });
const { sim, L, W } = lab;
const m = new Match(lab, { n: 4, isAI: id => id !== me });
m.favor = me; m.favorW = FAVOR;
m.setup('us');
lab.base = lab.slowTo = CALM;
const view = eyes(lab, { me, natural: () => { const h = sim.a(me), b = sim.ball; if (!h) return null; return m.owner() === me ? Math.atan2(W / 2 - h.y, L - h.x) : Math.atan2(b.y - h.y, b.x - h.x); } });
trackSight(lab, view);
const av = avatar(lab, IDS, me, id => setMe(id));
let run = null, job = null, idleT = 0;
const touches = Object.fromEntries(IDS.map(id => [id, 0]));
lab.ctrl = me;

function setMe(id) {
  me = id; view.me = id; m.favor = id; lab.ctrl = id; av.draw(id);
  lab.close(); m.hold = m.freeze = false; m.protect = null; run = job = null; m.cmd.delete(id); view.snap();
  if (lab.started) setTimeout(next, 300);
}
// the next decision, from what is happening now
function next() {
  if (lab.win || lab.ended || m.dead) return;
  const c = m.owner(); if (!c) return;
  if (c === me) { view.setUp(false); ballWindow(lab, m, me, {}); }
  else if (m.team(c) === 'us') runWin(c);
  else guardWin();
}
function runWin(F) {
  const options = runSpots(lab, m, me, F); m.freeze = true; m.protect = F; view.setUp(true);
  lab.open({ kind: 'run', options, slow: .25, hintAfter: 5, hintLine: 'get open', from: () => ({ x: sim.a(F).x, y: sim.a(F).y }), onPick: o => {
    sim.go(me, o.x, o.y, 4.8); m.cmd.set(me, sim.time + 6); run = { F, o, t: 0 };
  } });
}
// The run plays out: a good run gets the pass; one behind a defender gets a pass he cuts out; one crowding gets nothing.
function runStep(dt) {
  if (!run) return;
  run.t += dt; const h = sim.a(me), { F, o } = run;
  if (m.owner() !== F) { run = null; m.freeze = false; m.protect = null; return; }
  if (dist(h, o) > .7 && run.t < 2.5) return;
  run = null; m.freeze = false; m.protect = null;
  if (o.good) m.pass(F, me, null); else if (o.why === 'shadow') m.pass(F, me, o.by); else m.cmd.delete(me);
}
function guardWin() {
  const options = guardSpots(lab, m, me); m.freeze = true; m.pressUs = null; view.setUp(true);
  lab.open({ kind: 'guard', options, slow: .3, hintAfter: 5, hintLine: 'one goes one guards', from: () => ({ x: sim.a(me).x, y: sim.a(me).y }), onPick: o => {
    m.freeze = false;
    if (o.job === 'press') { job = null; m.pressUs = me; m.cmd.delete(me); }
    else if (o.job === 'mark') { job = { mark: o.who }; m.pressUs = 'auto'; }
    else { job = { stay: true }; sim.go(me, o.x, o.y, 4.4); m.cmd.set(me, sim.time + (o.job === 'chase' ? 1.4 : 3)); m.pressUs = o.job === 'chase' ? null : 'auto'; if (o.job === 'chase') m.after(1.5, () => { if (m.team(m.owner()) === 'them') m.pressUs = 'auto'; }); }
  } });
}
function jobStep() {
  if (!job) return;
  if (m.team(m.owner()) !== 'them' && sim.ball.state === 'carried') { job = null; return; }
  if (job.mark) { const o = sim.a(job.mark), gx = -o.x, gy = W / 2 - o.y, gl = Math.hypot(gx, gy) || 1; sim.go(me, Math.max(1, o.x + gx / gl * 1.3), Math.min(W - 1, Math.max(1, o.y + gy / gl * 1.3)), 3.6); m.cmd.set(me, sim.time + .3); }
}

m.on.gain = (id, how) => {
  job = null; run = null; m.freeze = false; m.protect = null; idleT = 0;
  if (m.team(id) === 'us') {
    touches[id]++; m.pressUs = null; if (lab.win && lab.win.kind !== 'ball') lab.close();
    if ((how === 'tackle' || how === 'cut' || how === 'block') && id === me) { lab.feedback(true, 'Our ball!', '💪'); lab.say('great steal'); }
    if (id === me) { lab.close(); m.after(.05, next); } else m.after(.5, next);
  } else { lab.close(); m.hold = false; if (how !== 'pass' && how !== 'kickoff') lab.feedback(false, 'Their ball', '🔄'); m.after(.5, next); }
};
m.on.goal = team => {
  lab.close(); lab.waiting = true; m.hold = m.freeze = false; m.pressUs = null; job = run = null;
  lab.feedback(team === 'us', team === 'us' ? 'GOAL!' : 'Their goal', team === 'us' ? '⚽' : '😮'); lab.say(team === 'us' ? 'great choice' : 'good try'); showScore();
  setTimeout(() => m.kickoff(team === 'us' ? 'them' : 'us', () => { lab.waiting = false; }), 1800);
};
const showScore = () => lab.setScore(`<i>${lab.us.short}</i> ${m.score.us} – ${m.score.them} <i>${lab.them.short}</i>`);
showScore();
const share = () => { const all = Object.values(touches).reduce((a, b) => a + b, 0); return all ? touches[me] / all : 0; };
lab.extra = () => ({ ...lab.sight, touches, meShare: +share().toFixed(2), favor: FAVOR, score: m.score });
lab.onEnd = () => `<div><b>${m.score.us}–${m.score.them}</b><small>⚽ score</small></div><div><b>${touches[me]}</b><small>🙋 his touches</small></div>`;

lab.tick = dt => {
  m.step(dt); runStep(dt); jobStep();
  // never long without a choice: after about 3.5 s of calm play with no decision, the next one is asked
  if (!lab.win && !run && m.owner() && !m.dead) { if ((idleT += dt) > 2.4) { idleT = 0; next(); } } else idleT = 0;
};
lab.run();
