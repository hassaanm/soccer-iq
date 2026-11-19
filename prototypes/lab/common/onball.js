// The choice with the ball, shared by Lab A and Lab B: tap a friend (pass), the goal (shoot) or the arrow (run with it).
// Graded on the picture at the moment of the tap. `follow`: control goes with the pass to the friend (Lab A).
import { dist, clamp } from './lab.js';

export function ballWindow(lab, m, id, opt = {}) {
  const sim = lab.sim, L = lab.L, W = lab.W;
  if (m.owner() !== id || lab.ended || m.dead) return;
  const me = sim.a(id), friends = m.ids('us').filter(f => f !== id), toGoal = Math.atan2(W / 2 - me.y, L - me.x);
  const options = friends.map(f => ({ id: 'pass:' + f, kind: 'player', who: f, act: 'pass', to: f }));
  if (L - me.x < 17) options.push({ id: 'shoot', kind: 'goal', act: 'shoot' });
  options.push({ id: 'run', kind: 'arrow', who: id, ang: clamp(toGoal, -.9, .9), act: 'run' });
  m.hold = true; if (opt.follow) { lab.ctrl = id; lab.ctrlSoft = false; }
  lab.open({ kind: 'ball', options, slow: .22, hintAfter: 5, hintLine: 'see who is open', from: () => ({ x: sim.a(id).x, y: sim.a(id).y }), judge: os => judgeBall(lab, m, id, os), onPick: o => act(lab, m, id, o, opt) });
  judgeBall(lab, m, id, options);
}
// What each choice is worth now. Best: a shot when it is on; else a pass that gains clearly more than running with it
// (at this age staying on the ball comes first); else the run; else the most forward open pass.
export function judgeBall(lab, m, id, os) {
  const me = lab.sim.a(id);
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
      o.word = c.good ? 'Space!' : c.why === 'line' ? 'Out!' : 'Defender!'; o.line = c.good ? 'space ahead keep it and run' : c.why === 'line' ? 'run where nobody is' : 'a defender was right there'; o.emo = c.good ? '🏃' : '✋';
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
function act(lab, m, id, o, opt) {
  const sim = lab.sim; m.hold = false;
  if (o.act === 'pass') { m.pass(id, o.to, o.good ? null : o.check.by); if (opt.follow) { lab.ctrl = o.to; lab.ctrlSoft = true; } opt.passed?.(o); }
  else if (o.act === 'shoot') m.shoot(id, o.check);
  else {
    const me = sim.a(id), tx = me.x + Math.cos(o.ang) * 4.2, ty = me.y + Math.sin(o.ang) * 4.2;
    if (o.good) { m.protect = id; m.dribble(id, tx, ty, 3.9, 1.3); m.after(1.15, () => { if (m.protect === id) m.protect = null; ballWindow(lab, m, id, opt); }); }
    else { m.dribble(id, tx, ty, 3.4, 1.4); m.pressThem = o.check.by || null; m.after(1.6, () => { m.pressThem = null; if (m.owner() === id) ballWindow(lab, m, id, opt); }); }
  }
}
