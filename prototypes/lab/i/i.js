// Lab I: "Coach asks". The shared one-player match (common/flow.js) flows at 0.6 of real speed, and he plays it freely
// as in E. About every 12 s of play, at a teaching moment, the coach stops play (a near-freeze: it still creeps, so
// the picture is alive) and asks one question, answered by a tap on the pitch:
//  - he has the ball: "Who is open?" (tap a friend he can see; then he passes to him);
//  - a friend has it: "Where is the space?" (three spots, some only seen with a look; then he runs there, and a
//    good run gets the pass);
//  - they have it: "Who goes?" (tap one of ours; the closest is right; that player goes to the ball).
// Feedback at once, then his answer plays out. Between questions nothing is announced. 4 v 4.
import { onePlayer } from '../common/flow.js';
import { runSpots } from '../common/offball.js';
import { dist } from '../common/lab.js';

const EVERY = 12; // game seconds of free play between questions (at 0.6 speed: about 20 s of real time)
let since = 6, run = null, asks = 0;
const ctx = await onePlayer({ letter: 'I', name: 'Coach asks', version: 'v1', base: .6, whySwitch: true, why: false, tick: (c, dt) => step(c, dt) });
const { lab, m, view } = ctx, sim = lab.sim;
lab.asks = () => asks;

function step(c, dt) {
  // a "where is the space" run playing out: a good one gets the pass
  if (run) { const h = sim.a(c.me); if (m.owner() !== run.F) run = null; else if (dist(h, run.o) < .8 || (run.t += dt) > 2.5) { const r = run; run = null; if (r.o.good) m.pass(r.F, c.me, null); else if (r.o.why === 'shadow') m.pass(r.F, c.me, r.o.by); } }
  if (lab.win || lab.waiting || m.dead || run) return;
  if ((since += dt) < EVERY) return;
  const o = m.owner(); if (!o) return;
  since = 0; asks++;
  const me = c.me, opts = { slow: .05, hintAfter: 6, from: () => { const a = sim.a(m.owner() || me); return { x: a.x, y: a.y }; } };
  if (o === me) {
    const options = m.ids('us').filter(f => f !== me).map(f => ({ id: 'pass:' + f, kind: 'player', who: f }));
    const judge = os => { for (const x of os) { const k = m.passCheck(me, x.who); x.good = k.open; x.best = false; x.word = k.open ? 'Open!' : 'Not open!'; x.emo = k.open ? '👍' : '✋'; x.line = k.open ? `${lab.nameOf(x.who)} is open` : k.why === 'lane' ? 'he was in the way of the pass' : 'a defender was right there'; } const g = os.filter(x => x.good).sort((p, q) => sim.a(q.who).x - sim.a(p.who).x)[0]; if (g) g.best = true; };
    judge(options); lab.say('see who is open');
    lab.open({ kind: 'ask-open', options, ask: '❓ Who is open?', hintLine: 'see who is open', judge, onPick: x => c.pass(x.who, true), ...opts });
  } else if (m.team(o) === 'us') {
    const options = runSpots(lab, m, me, o); lab.say('where is the space');
    lab.open({ kind: 'ask-space', options, ask: '❓ Where is the space?', hintLine: 'where is the space', onPick: x => { c.ground({ x: x.x, y: x.y }, true); run = { F: o, o: x, t: 0 }; }, ...opts });
  } else {
    const ca = sim.a(o), ids = m.ids('us'), ds = ids.map(id => dist(sim.a(id), ca)), dMin = Math.min(...ds);
    const options = ids.map((id, i) => ({ id: 'go:' + id, kind: 'player', who: id, good: ds[i] < dMin + .8, best: ds[i] === dMin, word: ds[i] < dMin + .8 ? 'Closest!' : 'Too far!', emo: ds[i] < dMin + .8 ? '👍' : '✋', line: ds[i] < dMin + .8 ? 'great choice' : 'the closest one goes' }));
    lab.say('one goes one guards');
    lab.open({ kind: 'ask-who', options, ask: '❓ Who goes to the ball?', hintLine: 'one goes one guards', onPick: x => { if (x.who === me) c.ground({ x: ca.x, y: ca.y }, true); else m.pressUs = x.who; }, ...opts });
  }
}
lab.run();
