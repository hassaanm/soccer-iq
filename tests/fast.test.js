// Fast mode (v84, js/fast/): the rules the owner asked for, on the game's own sim, with no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match } from '../js/fast/match.js';
import * as R from '../js/fast/rules.js';

const L = PITCH.L, W = PITCH.W;
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
function match(seed = 7) {
  const sim = new Sim(), sz = sizeOf();
  const m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, rnd: seeded(seed) });
  m.setup('us'); return { sim, m };
}
// Everyone where the test wants them, standing.
function place(sim, at) { for (const [id, [x, y]] of Object.entries(at)) { const a = sim.a(id); if (a) Object.assign(a, { x, y, tx: x, ty: y, sp: 0 }); } }
function park(sim, keep) { let k = 0; for (const a of sim.agents.values()) if (!keep.includes(a.id) && !a.gk) Object.assign(a, { x: 2 + (k++) * 1.5, y: .9, tx: 2 + (k - 1) * 1.5, ty: .9 }); } // (out of the way, along a side line)
const run = (m, sim, secs, f) => { for (let t = 0; t < secs; t += 1 / 60) { m.step(1 / 60); sim.step(1 / 60); if (f?.()) return true; } return false; };

test('a pass through a defender\'s reach is cut out and never arrives; an open one arrives', () => {
  for (const [dy, cut] of [[.3, true], [.6, true], [3.5, false]]) {
    const { sim, m } = match(); m.me = 'hero';
    park(sim, ['hero', 'm1', 'o1']); place(sim, { hero: [8, W / 2], m1: [18, W / 2], o1: [13, W / 2 + dy] });
    Object.assign(sim.ball, { x: 8.4, y: W / 2 }); sim.give('hero'); m.cmd.clear(); m.dead = false; m.next.set('o1', 1e9); m.cmd.set('o1', 1e9); // (he stays where he is: the ball must still not get through)
    let got = null; m.on.gain = id => { got ??= id; };
    m.pass('hero', 'm1'); run(m, sim, 4, () => got);
    if (cut) { assert.equal(got, 'o1', `a defender ${dy} m off the line takes it`); assert.notEqual(m.count.arrived, 1); }
    else { assert.equal(got, 'm1', 'an open pass arrives'); assert.equal(m.count.arrived, 1); }
  }
});

test('a ball in flight never goes through a body (any of theirs, planned or not)', () => {
  const ball = { x: 10, y: 5, z: .2, fx: 6, fy: 5 };
  assert.equal(R.bodyHit(ball, [{ id: 'o2', x: 10.2, y: 5.1 }])?.id, 'o2');
  assert.equal(R.bodyHit({ ...ball, z: 1.6 }, [{ id: 'o2', x: 10.2, y: 5.1 }]), null, 'a lofted ball goes over');
  assert.equal(R.bodyHit(ball, [{ id: 'o2', x: 10, y: 6.2 }]), null);
});

test('the guide marks never lie off the pitch, are not drawn on a player, and include his own spot', () => {
  const rnd = seeded(3);
  for (let i = 0; i < 400; i++) {
    const me = { x: rnd() * L, y: rnd() * W }, others = Array.from({ length: 7 }, () => ({ x: rnd() * L, y: rnd() * W }));
    const sp = R.spots(me, others, L, W);
    assert.ok(sp.some(s => s.ring === 0));
    for (const s of sp.filter(s => s.ring)) {
      assert.ok(s.x >= R.EDGE && s.x <= L - R.EDGE && s.y >= R.EDGE && s.y <= W - R.EDGE, 'on the pitch');
      assert.equal(!!s.hid, others.some(o => Math.hypot(o.x - s.x, o.y - s.y) < R.BODY), 'a mark on a player is not drawn');
    }
    assert.ok(sp.filter(s => s.ring === 1).length <= 8 && sp.filter(s => s.ring === 2).length <= R.TICKS);
    for (const d of R.dashes(me, L, W)) assert.ok(d.x >= 0 && d.x <= L && d.y >= 0 && d.y <= W, 'the far ring is broken where it leaves the pitch');
  }
});

test('his head never turns off the pitch, near a line or in a corner', () => {
  const rnd = seeded(5), need = Math.min(R.LOOK_MIN, Math.max(L, W) * .3);
  for (let i = 0; i < 600; i++) {
    const p = { x: .3 + rnd() * (L - .6), y: .3 + rnd() * (W - .6) }, yaw = R.clampYaw(p, (rnd() * 2 - 1) * Math.PI, L, W);
    assert.ok(R.reachOut(p, yaw, L, W) >= need - 1e-6, `from ${p.x.toFixed(1)},${p.y.toFixed(1)} he looks over the pitch`);
  }
  // by the side line (y = 0.5), looking straight out at the stands: turned back over the pitch
  const y = R.clampYaw({ x: L / 2, y: .5 }, -Math.PI / 2, L, W); assert.ok(Math.sin(y) > -.2);
});

test('his head goes down only as a ball comes to him, never on his own dribble, never without the ball', () => {
  for (const how of ['pass', 'loose', 'cut', 'tackle', 'steal']) assert.equal(R.headDownOn('hero', 'hero', how), true, how);
  for (const how of ['push', 'kickoff']) assert.equal(R.headDownOn('hero', 'hero', how), false, how);
  assert.equal(R.headDownOn('m1', 'hero', 'pass'), false, 'a friend getting it: his head stays up');
});

test('a steal at the wrong time fails (he lunges, the carrier goes on); at the right time it wins', () => {
  for (const right of [false, true]) {
    const { sim, m } = match(); m.me = 'hero'; m.meAuto = false; m.dead = false;
    park(sim, ['hero', 'o1']); place(sim, { o1: [15, W / 2], hero: [13.6, W / 2] }); sim.give('o1');
    const b = sim.ball; Object.assign(b, { x: right ? 14.3 : 15.3, y: W / 2 }); // (right: rolled off his foot, toward him)
    assert.equal(R.stealNow(sim.a('o1'), b, sim.a('hero')), right);
    const r = m.steal();
    assert.equal(r, right ? 'won' : 'missed'); assert.equal(m.owner(), right ? 'hero' : 'o1');
    if (!right) { run(m, sim, .5); assert.equal(m.owner(), 'o1', 'the carrier keeps it'); }
  }
});

test('friends pass to him clearly more when his line is open, and never when it is blocked', () => {
  const tally = blocked => {
    const n = { hero: 0, other: 0 };
    for (let k = 0; k < 300; k++) {
      const { sim, m } = match(k + 1); m.me = m.favor = 'hero'; m.dead = false;
      park(sim, ['m1', 'hero', 'm2', 'o1']);
      place(sim, { m1: [10, W / 2], hero: [16, W / 2 - 4], m2: [16, W / 2 + 4], o1: blocked ? [13, W / 2 - 2] : [8, W / 2 + .2] });
      Object.assign(sim.ball, { x: 10.4, y: W / 2 }); sim.give('m1'); m.cmd.clear(); m.aiT = 0;
      let to = null; const p0 = m.pass.bind(m); m.pass = (a, b) => { to = b; };
      m.aiCarrier('m1', 1 / 60); m.pass = p0;
      if (to === 'hero') n.hero++; else if (to) n.other++;
    }
    return n;
  };
  const open = tally(false), shut = tally(true);
  assert.ok(open.hero > open.other * 1.25, `open: to him ${open.hero}, to the other ${open.other}`);
  assert.equal(shut.hero, 0, 'blocked: never to him');
});

test('the camera he does not move always holds the ball, or (with it) the goal he attacks', () => {
  const rnd = seeded(11), w = 932, h = 430;
  let held = 0, n = 0;
  for (let i = 0; i < 500; i++) {
    const me = { x: 1 + rnd() * (L - 2), y: 1 + rnd() * (W - 2) }, has = rnd() < .4;
    const ball = has ? { x: me.x + .4, y: me.y, z: 0 } : { x: 1 + rnd() * (L - 2), y: 1 + rnd() * (W - 2), z: 0 };
    const yaw = R.naturalYaw(me, ball, has, L, W);
    for (const look of has ? [0, 1] : [1]) { // (his head is down only with the ball)
      const cam = R.fitPitch(R.camSpec(me, ball, has, yaw, look), me, w, h, L, W, [ball]); n++;
      const seesBall = R.onScreen(R.project(cam, ball, w, h), w, h), seesGoal = R.onScreen(R.project(cam, { x: L, y: W / 2, z: .8 }, w, h), w, h);
      if (has ? seesBall || seesGoal : seesBall) held++; else assert.fail(`no ball${has ? ' or goal' : ''} at ${me.x.toFixed(1)},${me.y.toFixed(1)} look ${look}`);
    }
  }
  assert.equal(held, n);
});

test('a press held over 0.25 s (or slid) slows the world instead of acting; a quick tap acts', () => {
  assert.equal(R.pressKind(.12, false), 'tap'); assert.equal(R.pressKind(.24, false), 'tap');
  assert.equal(R.pressKind(.3, false), 'hold'); assert.equal(R.pressKind(.1, true), 'hold');
});

test('chips: only for friends seen within the fade time and off screen; a tap passes only with the ball', () => {
  const fr = [{ id: 'm1', seenAt: 9, on: false }, { id: 'm2', seenAt: 2, on: false }, { id: 'm3', seenAt: 9.5, on: true }, { id: 'x', seenAt: null, on: false }];
  const c = R.chipList(fr, 10, false);
  assert.deepEqual(c.map(x => x.id), ['m1'], 'm2 too long ago, m3 on screen, x never seen');
  assert.equal(c[0].tap, false); assert.equal(c[0].gold, false);
  const d = R.chipList(fr, 10, true); assert.equal(d[0].tap, true); assert.equal(d[0].gold, true);
  assert.ok(R.chipList([{ id: 'm1', seenAt: 4.9, on: false }], 10.7, true)[0].alpha < .2, 'fading near the end');
  const [x, y] = R.edgeAt([2000, 200], false, 932, 430); assert.ok(x > 880 && y > 0 && y < 430, 'on the right edge');
});

test('a whole match with nobody steering him ends, first to three, and nothing stalls', () => {
  const { sim, m } = match(21); m.kickoff('us');
  m.on.goal = team => { if (m.score[team] < 3) m.after(1.8, () => m.kickoff(team === 'us' ? 'them' : 'us')); };
  let still = 0, last = null;
  const done = run(m, sim, 1500, () => { const p = sim.ball.x + sim.ball.y; still = last != null && Math.abs(p - last) < 1e-5 && !m.dead ? still + 1 / 60 : 0; last = p; assert.ok(still < 8, 'the ball moves'); return Math.max(m.score.us, m.score.them) >= 3; });
  assert.ok(done, `ended: ${m.score.us}-${m.score.them}`);
});

test('the pitch fills at least 80% of the picture\'s rows (with or without the ball, by the lines too), and he stays on screen', () => {
  for (const [w, h] of [[932, 430], [844, 390]]) {
    let n = 0, full = 0;
    for (let x = 1; x < L; x += 1.5) for (let y = .6; y < W; y += 1.5) for (let hd = 0; hd < 8; hd++) for (const has of [true, false]) for (const look of has ? [0, 1] : [1]) {
      const me = { x, y }, a = hd * Math.PI / 4, ball = has ? { x: x + .4, y, z: 0 } : { x: R.clamp(x + Math.cos(a) * 8, .5, L - .5), y: R.clamp(y + Math.sin(a) * 8, .5, W - .5), z: 0 };
      const cam = R.fitPitch(R.camSpec(me, ball, has, R.naturalYaw(me, ball, has, L, W), look), me, w, h, L, W, [ball]); n++;
      if (R.rowsOnPitch(cam, w, h, L, W) >= R.FILL) full++;
      assert.ok(R.onScreen(R.project(cam, { x, y, z: .5 }, w, h), w, h), `him at ${x},${y}`);
      if (x > 2 && x < L - 2 && y > 2 && y < W - 2) assert.ok(R.rowsOnPitch(cam, w, h, L, W) >= R.FILL, `2 m or more inside the lines, always full: ${x},${y} ${hd} ${has} ${look}`);
    }
    assert.ok(full / n >= .97, `full in ${(100 * full / n).toFixed(1)}% (the rest: hard against a side line, where the eye must stand outside it)`);
  }
});

test('every Fast mode file parses (no test loads the page modules)', async () => {
  const { spawnSync } = await import('node:child_process'); const { readdirSync } = await import('node:fs');
  const dir = new URL('../js/fast/', import.meta.url).pathname;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) { const r = spawnSync(process.execPath, ['--check', dir + f], { encoding: 'utf8' }); assert.equal(r.status, 0, `${f}: ${r.stderr}`); }
});

test('a tap anywhere moves him: between marks there, near a jog, far a sprint brought in to 9 m, off the pitch onto it, by his feet stay', () => {
  const me = { x: L / 2, y: W / 2 };
  const mid = { x: me.x + Math.cos(Math.PI / 8) * 3, y: me.y + Math.sin(Math.PI / 8) * 3 }, t1 = R.moveTarget(me, mid, L, W); // (between two near dots)
  assert.equal(t1.ring, 1); assert.ok(Math.hypot(t1.x - mid.x, t1.y - mid.y) < 1e-9, 'exactly where he tapped');
  const t2 = R.moveTarget(me, { x: me.x + 20, y: me.y + 1 }, L, W); assert.equal(t2.ring, 2); assert.ok(Math.hypot(t2.x - me.x, t2.y - me.y) <= R.FAR_MAX + 1e-9, 'a far tap is brought in');
  const t3 = R.moveTarget({ x: 3, y: 2 }, { x: -4, y: -5 }, L, W); assert.ok(t3.x >= R.EDGE && t3.y >= R.EDGE, 'onto the pitch');
  assert.equal(R.moveTarget(me, { x: me.x + .3, y: me.y }, L, W).ring, 0, 'by his feet: stay');
  // and the match takes him there: a jog to the point between the marks
  const { sim, m } = match(); m.me = 'hero'; m.dead = false; park(sim, ['hero']); place(sim, { hero: [me.x, me.y] }); Object.assign(sim.ball, { state: 'loose', carrier: null, x: 2, y: 2 }); m.restart = { team: 'us', id: 'x' };
  m.meTo(t1.x, t1.y, t1.ring); const h = sim.a('hero'); assert.ok(Math.hypot(h.tx - t1.x, h.ty - t1.y) < 1e-9, 'he sets off for the point between the marks'); const d0 = Math.hypot(h.x - t1.x, h.y - t1.y); run(m, sim, .5); assert.ok(Math.hypot(h.x - t1.x, h.y - t1.y) < d0 - .8, 'and gets nearer');
});

test('hints: only after he has done nothing for the delay (and is not on his way), never off the pitch, at most three', () => {
  assert.equal(R.hintsDue(10, 8, false), false); assert.equal(R.hintsDue(10, 10 - R.HINT_S, false), true); assert.equal(R.hintsDue(10, 0, true), false, 'not while he is on his way');
  const rnd = seeded(9);
  for (let i = 0; i < 200; i++) {
    const me = { x: rnd() * L, y: rnd() * W }, foes = Array.from({ length: 4 }, () => ({ x: rnd() * L, y: rnd() * W })), carrier = { x: rnd() * L, y: rnd() * W };
    for (const st of [{ mine: true }, { ours: true, carrier }, { carrier: foes[0] }]) {
      const h = R.hints({ me, ball: st.carrier || me, foes, L, W, ...st });
      assert.ok(h.length <= 3); for (const p of h) assert.ok(p.x >= R.EDGE && p.x <= L - R.EDGE && p.y >= R.EDGE && p.y <= W - R.EDGE);
    }
  }
});
