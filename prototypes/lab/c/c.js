// Lab C: "Keep it". Four of ours keep the ball from two of theirs in a box of cones (a rondo). The picture never stops:
// his friends slide along their sides of the box to get open, and the two defenders hunt as a pair (one goes at the
// ball and blocks one pass with his body, the other cuts the next pass), so the friend who is open changes while he
// looks. Whoever has the ball is him (like Lab A). He taps a friend; it is judged on the picture at that moment. Six
// passes in a row is a point, and a pass between the two defenders counts double. Waiting is never wrong: nobody
// tackles, the picture just changes. A pass into a defender is cut out, he gives it back, and the count starts again.
// It runs on the 4 v 4 pitch with two of theirs (4 v 2): a box of 12 m.
import { boot, dist, clamp, onLane } from '../common/lab.js';

const lab = await boot({ letter: 'C', name: 'Keep it', version: 'v1', size: '4v4', us: 'barca', them: 'madrid', env: 'park', onStart: () => setTimeout(() => offer(), 300) });
const { sim, L, W } = lab;
const CX = L / 2, CY = W / 2, H = 6; // the box: 12 m a side
const ATT = ['hero', 'm1', 'm2', 'm3'], DEF = ['o1', 'o2'];
// each friend keeps to one side of the box: [fixed axis value, along-axis], s: his place along it (-H..H)
const SIDE = { hero: { y: CY - H }, m1: { x: CX + H }, m2: { y: CY + H }, m3: { x: CX - H } };
const at = (id, s) => SIDE[id].y != null ? { x: CX + s, y: SIDE[id].y } : { x: SIDE[id].x, y: CY + s };
sim.setup({ hero: [CX - 1, CY - H], mates: [[CX + H, CY + 2], [CX + 2, CY + H], [CX - H, CY - 1]], opps: [[CX, CY - 2], [CX + 1.5, CY + 2]], carrier: 'hero' });
for (const id of ATT) sim.a(id).face = [CX - sim.a(id).x, CY - sim.a(id).y];
lab.cones([[CX - H, CY - H], [CX + H, CY - H], [CX + H, CY + H], [CX - H, CY + H], [CX, CY - H - .9], [CX + H + .9, CY], [CX, CY + H + .9], [CX - H - .9, CY]].map(([x, y], i) => i < 4 ? [x + Math.sign(x - CX) * .9, y + Math.sign(y - CY) * .9] : [x, y]));
lab.box(CX - H, CY - H, CX + H, CY + H);
lab.ctrl = 'hero';
const st = { chain: 0, points: 0, best: 0, splits: 0, flight: null, back: null, press: 'o1', next: new Map(), aim: {} };

// ---------- how open a pass is, now ----------
// Open when neither defender is near its line (more room the farther along he is: he has time to step across).
// A split: the line goes between the two defenders.
function judgeP(from, to) {
  const a = sim.a(from), b = sim.a(to); let worst = null;
  for (const id of DEF) { const o = sim.a(id), c = onLane(o, a, b), need = .7 + .075 * c.along; if (c.t < .96 && c.d < need && (!worst || c.d - need < worst.m)) worst = { m: c.d - need, id, x: c.x, y: c.y }; }
  const side = id => { const o = sim.a(id); return Math.sign((b.x - a.x) * (o.y - a.y) - (b.y - a.y) * (o.x - a.x)); };
  const t = DEF.map(id => onLane(sim.a(id), a, b, 0).t), split = !worst && side('o1') !== side('o2') && t.every(v => v > .15 && v < .9);
  return worst ? { open: false, by: worst.id, cut: { x: worst.x, y: worst.y } } : { open: true, split };
}
function judge(os) {
  const c = sim.ball.carrier;
  for (const o of os) { o.j = judgeP(c, o.who); o.good = o.j.open; o.best = false; }
  const goods = os.filter(o => o.good), b = goods.find(o => o.j.split) || goods[0]; if (b) b.best = true;
  for (const o of os) { const j = o.j;
    o.word = j.open ? (j.split ? 'Through!' : 'Open!') : 'In the way!'; o.emo = j.open ? (j.split ? '⚡' : '👍') : '✋';
    o.line = j.open ? (j.split ? 'great pass' : `${lab.nameOf(o.who)} is open`) : goods.length ? 'he was in the way of the pass' : 'nobody was open wait a moment'; }
}

// ---------- he has the ball: the window stays open, the picture keeps moving ----------
function offer() {
  const c = sim.ball.carrier; if (!c || !ATT.includes(c) || lab.ended) return;
  lab.ctrl = c; lab.ctrlSoft = false;
  const options = ATT.filter(id => id !== c).map(id => ({ id: 'to:' + id, kind: 'player', who: id }));
  judge(options);
  lab.open({ kind: 'pass', options, slow: .62, hintAfter: 5, hintLine: 'see who is open', sound: st.chain === 0,
    from: () => ({ x: sim.a(c).x, y: sim.a(c).y }), judge, onPick: o => pass(c, o) });
}
function pass(from, o) {
  const a = sim.a(from), r = sim.a(o.who), j = o.j;
  sim.stop(from); sim.windup(from, 'pass');
  if (j.open) {
    sim.stop(o.who); st.flight = { from, to: o.who, good: true, split: j.split };
    lab.ctrl = o.who; lab.ctrlSoft = true;
    setTimeoutGame(.12, () => sim.kick(r.x, r.y, { speed: clamp(7 + dist(a, r) * .4, 9, 13), arc: .08 }));
  } else {
    sim.go(j.by, j.cut.x, j.cut.y, 5); st.flight = { from, to: j.by, good: false };
    setTimeoutGame(.12, () => sim.kick(j.cut.x, j.cut.y, { speed: 9, arc: .05 }));
  }
}
// game-time timers (they wait while paused or in slow motion)
const jobs = []; function setTimeoutGame(t, f) { jobs.push({ at: sim.time + t, f }); }

// ---------- the ball arriving ----------
function flightStep() {
  const f = st.flight, b = sim.ball; if (!f || b.state === 'carried') return;
  const r = sim.a(f.to), near = dist(r, b) < .6 || b.state === 'loose';
  if (!near || (b.state === 'flying' && (b.t || 0) < .3)) return;
  st.flight = null; sim.give(f.to);
  if (f.good) {
    st.chain++; if (f.split) { st.chain++; st.splits++; lab.world.fx('skill'); lab.sfx('skill'); }
    if (st.chain >= 6) { st.points++; st.chain = 0; lab.world.fx('won'); lab.sfx('goal'); lab.feedback(true, 'Point!', '⭐'); lab.say('you kept it'); }
    st.best = Math.max(st.best, st.chain); showScore(); offer();
  } else {
    lab.waiting = true; st.chain = 0; showScore(); lab.ctrl = null; lab.sfx('down');
    // he gives it back: to a friend of ours away from where it was lost, and play goes on
    const to = ATT.filter(id => id !== sim.ball.carrier).sort((p, q) => dist(sim.a(q), r) - dist(sim.a(p), r))[0];
    st.back = { from: f.to, to };
    setTimeoutGame(1.1, () => { const t = sim.a(st.back.to); sim.windup(st.back.from, 'pass'); setTimeoutGame(.12, () => { sim.kick(t.x, t.y, { speed: 10, arc: .1 }); st.flight = { from: st.back.from, to: st.back.to, good: null, restart: true }; }); });
  }
}
// a restart pass arriving: the chain starts again from nothing
function restartStep() {
  const f = st.flight, b = sim.ball; if (!f || f.good !== null || b.state === 'carried') return;
  const r = sim.a(f.to); if (dist(r, b) > .6 && b.state !== 'loose') return;
  st.flight = null; sim.give(f.to); lab.waiting = false; st.back = null; offer();
}

// ---------- everyone moving ----------
function moves(dt) {
  const t = sim.time, b = sim.ball, c = b.state === 'carried' ? b.carrier : null, ball = c ? sim.a(c) : b;
  // friends: each slides along his side to where the line from the ball is clearest (looked at again every 1 to 1.5 s,
  // so they are a beat behind the defenders, and the open one changes)
  for (const id of ATT) {
    if (id === c || st.flight?.to === id) continue;
    if ((st.next.get(id) || 0) > t) continue; st.next.set(id, t + 1 + Math.random() * .5);
    let bestS = 0, bs = -1e9; const a = sim.a(id), s0 = SIDE[id].y != null ? a.x - CX : a.y - CY;
    for (let s = -H + 1; s <= H - 1; s += 1) { const p = at(id, s); let lane = 9; for (const d of DEF) lane = Math.min(lane, onLane(sim.a(d), ball, p).d); const sc = Math.min(lane, 2.5) - Math.abs(s - s0) * .12 + (Math.random() - .5) * .9 - (dist(p, ball) < 4 ? 1.5 : 0); if (sc > bs) { bs = sc; bestS = s; } }
    const p = at(id, bestS); sim.go(id, p.x, p.y, 2.4);
  }
  // defenders as a pair: the one nearer the ball presses it and stands across one pass; the other cuts the clearest
  // pass that is left. Each looks again about once a second.
  if (!c || !ATT.includes(c)) { for (const d of DEF) if (!st.flight || st.flight.to !== d) { if ((st.next.get(d) || 0) <= t) { st.next.set(d, t + .8); const p = { x: clamp(CX + (b.x - CX) * .3 + (d === 'o1' ? -1.5 : 1.5), CX - H + 1, CX + H - 1), y: clamp(CY + (b.y - CY) * .3, CY - H + 1, CY + H - 1) }; sim.go(d, p.x, p.y, 2.5); } } return; }
  const dd = DEF.map(id => dist(sim.a(id), ball)); if (dd[DEF.indexOf(st.press)] > Math.min(...dd) + 1.5) st.press = DEF[dd.indexOf(Math.min(...dd))];
  const P = st.press, C = DEF.find(x => x !== P), mates = ATT.filter(id => id !== c);
  const clear = id => { const p = sim.a(id); return Math.min(...DEF.map(d => onLane(sim.a(d), ball, p).d)); };
  if ((st.next.get(P) || 0) <= t && st.flight?.to !== P) {
    st.next.set(P, t + .9 + Math.random() * .3);
    const near = mates.slice().sort((p, q) => dist(sim.a(p), ball) - dist(sim.a(q), ball)).slice(0, 2), blk = near.sort((p, q) => clear(q) - clear(p))[0], m = sim.a(blk);
    const dx = m.x - ball.x, dy = m.y - ball.y, l = Math.hypot(dx, dy) || 1; st.aim[P] = blk;
    sim.go(P, clamp(ball.x + dx / l * 1.4, CX - H + .4, CX + H - .4), clamp(ball.y + dy / l * 1.4, CY - H + .4, CY + H - .4), 3.3);
  }
  if ((st.next.get(C) || 0) <= t && st.flight?.to !== C) {
    st.next.set(C, t + 1 + Math.random() * .4);
    const blk = mates.filter(id => id !== st.aim[P]).sort((p, q) => clear(q) - clear(p))[0], m = sim.a(blk), k = .5;
    sim.go(C, clamp(lerp(ball.x, m.x, k), CX - H + .6, CX + H - .6), clamp(lerp(ball.y, m.y, k), CY - H + .6, CY + H - .6), 3);
  }
}
const lerp = (a, b, k) => a + (b - a) * k;

const showScore = () => lab.setScore(`<span class="dots">${[0, 1, 2, 3, 4, 5].map(i => `<b class="${i < st.chain ? 'on' : ''}"></b>`).join('')}</span> ⭐ ${st.points}`);
showScore();
lab.extraScore = () => ({ points: st.points, best: st.best, splits: st.splits });
lab.onEnd = () => `<div><b>⭐ ${st.points}</b><small>6 in a row</small></div>`;

let jt = 0, flips = 0, winT = 0, noneT = 0;
// (for the checks) how often who is open changes while he looks, and how long nobody is
lab.extra = () => ({ flipsPerMin: +(flips / Math.max(.1, winT / 60)).toFixed(1), noneShare: +(noneT / Math.max(.1, winT)).toFixed(2) });
lab.tick = dt => {
  for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].at <= sim.time) { const j = jobs.splice(i, 1)[0]; try { j.f(); } catch (e) { console.error(e); } }
  if (st.flight?.good === null) restartStep(); else flightStep();
  moves(dt);
  // the window's grades follow the picture (for the hint, which pulses whoever is open now)
  if (lab.win && (jt += dt) > .25) { jt = 0; judge(lab.win.options); const k = lab.win.options.filter(o => o.good).map(o => o.who).join(); if (lab.win._open != null && k !== lab.win._open) flips++; lab.win._open = k; if (!k) noneT += .25; winT += .25; }
};
lab.camWant = () => ({ eye: [CX, CY - 13, 11.5], tgt: [CX, CY + .9, 0], Ff: 1.1, Fw: .5, k: 2 });
lab.run();
