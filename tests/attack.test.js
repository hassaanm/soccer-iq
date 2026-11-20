// Score attack (v88, js/mini/attack.js): how an attempt ends (a goal, the timer, a lost ball, a save, the ball out), the
// situations and how they move with the level, and that the right decision is what scores, on the real classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH } from '../js/geom.js';
import { shotResult, stream, rightFoot, EDGE as SHOT_EDGE } from '../js/shot.js';
import { spotSet, dist } from '../js/fast/rules.js';
import { AttackMatch, attackScene, attackLevel, rightMove, heroShot, openSpot, KINDS, BASE } from '../js/mini/attack.js';
import { newRun, attempt, STEP, LIVES } from '../js/mini/rules.js';

const { L, W } = PITCH;
// One attempt of a scene; `at` puts players where the test wants them (standing).
function setup(sc, { seed = .3, at = null } = {}) {
  const sim = new Sim(); let clock = 0; const box = { res: null };
  const m = new AttackMatch({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, scene: sc, rnd: stream(seed), real: () => clock, onEnd: r => { box.res = r; } });
  m.me = 'hero'; m.setup();
  if (at) for (const [id, [x, y]] of Object.entries(at)) { const a = sim.a(id); Object.assign(a, { x, y, tx: x, ty: y, sp: 0 }); if (id === 'hero') Object.assign(sim.ball, { x: x + .45, y }); }
  const step = (secs, f) => { for (let t = 0; t < secs && !box.res; t += 1 / 30) { clock += 1 / 30; const g = BASE / 30; m.step(g); sim.step(g / 2); sim.step(g / 2); f?.(); } return box.res; };
  return { m, sim, box, step };
}
const sceneOf = (kind, style, level = 0, seed = .4) => { const r = stream(seed); for (let i = 1; i < 2000; i++) { const sc = attackScene(level, r, i, []); if (sc.kind === kind && (!style || sc.style === style)) return sc; } throw new Error('no ' + kind); };

test('the timer ends an attempt: standing still with nobody coming, it runs out (and it is about 26 s at the start: v93, a real challenge)', () => {
  const sc = sceneOf('2v1', 'press'); assert.ok(sc.D.time >= 24 && sc.D.time <= 28, `${sc.D.time} s`);
  const { m, step } = setup(sc); m.cmd.set('o1', 1e9); // (their player stays where he is)
  const res = step(60);
  assert.equal(res.why, 'time'); assert.equal(res.goal, false); assert.ok(Math.abs(res.sec - sc.D.time) < .2, `${res.sec} s`);
});

test('a lost ball, a save and the ball out each end the attempt without a goal; a goal scores', () => {
  // lost: their player wins it from him standing on the ball
  let s = setup(sceneOf('2v1', 'press'), { at: { hero: [L - 14, W / 2], o1: [L - 12.5, W / 2] } }); let res = s.step(30);
  assert.deepEqual([res.goal, res.why, res.by], [false, 'lost', 'o1']);
  // a save: his shot to the keeper's hands (no slip: the keeper keeps it)
  s = setup(sceneOf('2v1', 'drop'), { at: { hero: [L - 7, W / 2 + .5], o1: [L - 14, 2] } }); s.m.D = { ...s.m.D, slip: 0 };
  { const a = s.sim.a('hero'), k = s.sim.a('k2'); s.m.shoot('hero', shotResult({ from: { x: a.x, y: a.y }, zone: 'M', foot: 'in', k: { x: k.x, y: k.y }, gx: L, force: 'save' })); }
  res = s.step(10); assert.deepEqual([res.goal, res.why, res.by], [false, 'save', 'k2']);
  // out: a shot wide of the post
  s = setup(sceneOf('2v1', 'drop'), { at: { hero: [L - 7, W / 2], o1: [L - 14, 2] } });
  { const a = s.sim.a('hero'); const r = shotResult({ from: { x: a.x, y: a.y }, y: PITCH.gy0 - 1, foot: 'in', k: null, gx: L }); assert.equal(r.res, 'wide'); s.m.shoot('hero', r); }
  res = s.step(10); assert.deepEqual([res.goal, res.why], [false, 'out']);
  // a goal
  s = setup(sceneOf('2v1', 'drop'), { at: { hero: [L - 6, W / 2 + 1], o1: [L - 14, 2] } });
  { const a = s.sim.a('hero'), k = s.sim.a('k2'); s.m.shoot('hero', shotResult({ from: { x: a.x, y: a.y }, zone: 'R', foot: 'in', k: { x: k.x, y: k.y }, gx: L, force: 'goal' })); }
  res = s.step(10); assert.deepEqual([res.goal, res.why, res.by], [true, 'goal', 'hero']);
  // and on the run: a goal adds one to the score, a stop costs a life, two stops end it
  const run = newRun(); assert.equal(LIVES, 2); attempt(run, true); attempt(run, false); assert.deepEqual([run.score, run.lives, run.over], [1, 1, false]); attempt(run, false); assert.deepEqual([run.score, run.lives, run.over], [1, 0, true]);
});

test('a pass through a defender\'s reach is lost; the same pass past him arrives', () => {
  for (const [dy, lost] of [[.3, true], [4.5, false]]) {
    const s = setup(sceneOf('2v1', 'press'), { at: { hero: [L - 16, W / 2], m1: [L - 9, W / 2], o1: [L - 12.5, W / 2 + dy] } });
    s.m.cmd.set('o1', 1e9); s.m.cmd.set('m1', 1e9);
    let got = null; const on = s.m.on.gain; s.m.on.gain = (id, how) => { got ??= id; on(id, how); };
    s.m.pass('hero', 'm1'); const res = s.step(3, () => got && !lost && s.box.res == null && (s.box.res = { done: true }));
    if (lost) assert.deepEqual([got, res?.why], ['o1', 'lost'], 'cut out: the attempt ends');
    else assert.equal(got, 'm1', 'an open pass arrives');
  }
});

test('the situations: the first is a 2 against 1; the mix moves from overloads to underloads in small steps', () => {
  const levels = Array.from({ length: 121 }, (_, i) => i * STEP), idx = id => KINDS.findIndex(k => k.id === id);
  let prev = null;
  for (const lv of levels) {
    const D = attackLevel(lv), mean = D.mix.reduce((a, x) => a + x.w * idx(x.id), 0);
    assert.ok(Math.abs(D.mix.reduce((a, x) => a + x.w, 0) - 1) < 1e-9);
    if (prev) {
      const tv = D.mix.reduce((a, x, i) => a + Math.abs(x.w - prev.D.mix[i].w), 0) / 2;
      assert.ok(tv <= .22, `a goal moves the mix, without a jump (level ${lv.toFixed(2)}: ${tv.toFixed(3)})`); // (v93, D1: it rises fast)
      assert.ok(mean >= prev.mean - 1e-9, 'and only toward the harder ones');
      for (const [k, dir] of [['react', -1], ['stand', -1], ['boost', 1], ['into', 1], ['keeper', 1], ['slip', -1], ['farSave', 1], ['friendSave', 1], ['time', -1], ['opp', 1]]) {
        assert.ok(dir < 0 ? D[k] <= prev.D[k] + 1e-12 : D[k] >= prev.D[k] - 1e-12, `${k} goes the hard way only`);
      }
      assert.ok(prev.D.time - D.time <= .6, 'the timer shortens a little a goal');
    }
    prev = { D, mean };
  }
  const at = lv => Object.fromEntries(attackLevel(lv).mix.map(x => [x.id, x.w]));
  assert.ok(at(0)['2v1'] > .5 && at(0)['2v1'] + at(0)['3v1'] > .85, 'at first: mostly 2 against 1, and 3 against 1');
  assert.ok(at(1)['2v1'] + at(1)['3v1'] + at(1)['3v2'] > .7, 'then mostly advantages');
  assert.ok(at(20)['2v3'] + at(20)['3v4'] > .6, 'late: mostly fewer attackers than defenders');
  for (let i = 0; i < 30; i++) assert.equal(attackScene(5, stream(i / 31), 0, []).kind, '2v1');
});

test('a challenge now and then: from goal 4, about one attempt in six two or three steps harder; never two in a row, never after a lost life', () => {
  const idx = id => KINDS.findIndex(k => k.id === id), r = stream(.77);
  let n = 0, ch = 0;
  for (let i = 0; i < 6000; i++) {
    const lv = (i % 60) * STEP, ctx = { lost: i % 7 === 0, challenge: i % 11 === 0 }, sc = attackScene(lv, r, 1 + (i % 5), [], ctx);
    if (sc.challenge) {
      assert.ok(lv >= 4 * STEP - 1e-9 && !ctx.lost && !ctx.challenge, 'only from goal 4, not after a lost life or a challenge');
      assert.ok(idx(sc.kind) >= Math.min(6, Math.round(sc.D.centre) + 2), `${sc.kind} is harder than the usual mix (level ${lv.toFixed(2)})`);
    }
    if (lv >= 4 * STEP && !ctx.lost && !ctx.challenge) { n++; if (sc.challenge) ch++; }
  }
  assert.ok(Math.abs(ch / n - 1 / 6) < .03, `about one in six (${(ch / n).toFixed(3)})`);
  assert.equal(attackScene(10, stream(.5), 0, [], {}).challenge, false, 'never the first attempt');
  const at = g => { const s = new Set(); for (let i = 0; i < 400; i++) { const sc = attackScene(g * STEP, stream(i / 401), 3, [], {}); if (sc.challenge) s.add(sc.kind); } return s; };
  assert.ok([...at(4)].some(k => KINDS.findIndex(x => x.id === k) >= 3), 'level numbers or fewer by goal 4'); assert.ok(at(9).has('2v3') || at(9).has('3v4'), 'outnumbered by goal 9');
});

test('every situation is on the pitch, theirs between him and the goal, nobody on top of anybody', () => {
  for (let lv = 0; lv <= 25; lv += 1) for (let i = 0; i < 40; i++) {
    const sc = attackScene(lv, stream((i + 1) / 41 + lv / 997), i + 1, []), all = [sc.hero, ...sc.mates, ...sc.opps];
    assert.equal(sc.mates.length, sc.us - 1); assert.equal(sc.opps.length, sc.them);
    for (const [x, y] of all) assert.ok(x > 1 && x < L - 1 && y > .9 && y < W - .9, `${sc.kind} on the pitch`);
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) assert.ok(Math.hypot(all[a][0] - all[b][0], all[a][1] - all[b][1]) > 1.2, `${sc.kind} ${sc.style}: apart`);
    for (const [x] of sc.opps) assert.ok(x > sc.hero[0] + 1.5, 'theirs are goal-side of him');
    assert.ok(L - sc.hero[0] >= 12 && L - sc.hero[0] <= 19, 'he starts outside shooting range, not far from it');
  }
});

test('the right move: pass as the defender comes to him, not before; go alone when nobody is in front', () => {
  // the defender has come to him: pass to the free friend
  let s = setup(sceneOf('2v1', 'press'), { at: { hero: [L - 14, W / 2], m1: [L - 13, W / 2 - 5.5], o1: [L - 12, W / 2 + .3] } });
  assert.deepEqual([rightMove(s.m).kind, rightMove(s.m).id], ['pass', 'm1']);
  // the defender far off, between them: not a pass yet; with nobody in front: go
  s = setup(sceneOf('2v1', 'press'), { at: { hero: [L - 16, W / 2], m1: [L - 15, W / 2 - 5.5], o1: [L - 8, W / 2 - 3.5] } });
  assert.equal(rightMove(s.m).kind, 'go');
  // close in and clear: shoot, with the right foot
  s = setup(sceneOf('2v1', 'drop'), { at: { hero: [L - 7, W / 2 + 1], m1: [L - 9, W / 2 - 5], o1: [L - 12, 2] } });
  const r = rightMove(s.m); assert.equal(r.kind, 'shoot'); assert.equal(r.foot, rightFoot(s.sim.a('hero')));
});

// The bots (the report has the full numbers: 30 runs each at a child's pace): the right decisions score more.
function bot(kind, p = 1) {
  return (m, rnd) => {
    const s = m.sim, me = s.a(m.me), c = m.owner(), b = s.ball, tap = (x, y) => { const st = c === m.me ? 'mine' : c ? (m.team(c) === 'us' ? 'ours' : 'theirs') : 'loose', sp = spotSet({ me, state: st, carrier: c && s.a(c), ball: b, mates: m.usIds.filter(id => id !== m.me).map(id => s.a(id)), foes: m.foes('us'), keeper: m.keeper('them'), L, W }); const p = sp.sort((p, q) => dist(p, { x, y }) - dist(q, { x, y }))[0]; if (p) m.meTo(p.x, p.y, p.kind); }; // (v93: he moves only to spots: the one nearest where the bot would go)
    if (kind === 'still') return;
    if (c !== m.me) { if (b.state === 'loose' && !m.flight) tap(b.x, b.y); else if (kind === 'right' && c && m.team(c) === 'us') { const q = openSpot(m, m.me); tap(q.x, q.y); } return; }
    const gd = Math.hypot(L - me.x, W / 2 - me.y);
    if (kind === 'straight' || rnd() > p) { if (gd <= SHOT_EDGE) heroShot(m, rnd() < .5 ? 'L' : 'R', rightFoot(me), rnd); else tap(me.x + 3.6, me.y + (W / 2 - me.y) * .3); return; }
    const rm = rightMove(m);
    if (rm.kind === 'shoot') heroShot(m, rm.zone, rm.foot, rnd); else if (rm.kind === 'pass') m.pass(m.me, rm.id); else if (rm.x != null) tap(rm.x, rm.y);
  };
}
function playRun(b, seed) {
  const r = stream(seed), rnd = stream(seed / 3 + .1), run = newRun(), kinds = [], ends = [], ctx = { lost: false, challenge: false };
  while (!run.over && run.n < 200) {
    const sc = attackScene(run.level, r, run.n, kinds, ctx); kinds.push(sc.kind);
    const s = setup(sc, { seed: seed / 7 + .05 }); let next = .8;
    let t = 0; const res = s.step(200, () => { t += 1 / 30; if (t >= next) { b(s.m, rnd); next = t + .8 + rnd() * .7; } });
    ends.push(res.why); attempt(run, res.goal); ctx.lost = !res.goal; ctx.challenge = sc.challenge;
  }
  return { score: run.score, n: run.n, ends };
}
test('the bots: the right decisions score clearly more than dribbling at goal; standing still scores nothing; nobody goes on for ever', () => {
  const N = 10, mean = b => { let a = 0; const runs = []; for (let i = 0; i < N; i++) { const x = playRun(b, (i + 1) / (N + 1)); runs.push(x); a += x.score; } return { m: a / N, runs }; };
  const right = mean(bot('right', .95)), straight = mean(bot('straight')), still = mean(bot('still'));
  assert.ok(right.m >= 1.8 * straight.m && right.m - straight.m >= 1.5, `right ${right.m} vs straight ${straight.m}`);
  assert.equal(still.m, 0); for (const r of still.runs) { assert.equal(r.n, 2); for (const e of r.ends) assert.ok(e === 'time' || e === 'lost', e); }
  assert.ok(still.runs.some(r => r.ends.includes('time')), 'the timer stops a player who stands still');
  for (const r of right.runs) assert.ok(r.n < 200, 'a run ends');
});
