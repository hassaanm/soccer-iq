// Fast mode (v84, js/fast/): the rules the owner asked for, on the game's own sim, with no page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match, LEVELS, oppOf } from '../js/fast/match.js';
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

test('a steal: the glow comes only once he has been on the carrier a moment; a press in it wins, one outside it is a lunge and spends STEAL', () => {
  for (const when of ['in', 'early', 'none', 'after']) {
    const { sim, m } = match(); m.me = 'hero'; m.meAuto = false; m.dead = false;
    assert.ok(m.opp.glow / .75 >= .6, `the window lasts ${(m.opp.glow / .75).toFixed(2)} s of real time`);
    park(sim, ['hero', 'o1']); place(sim, { o1: [15, W / 2], hero: [13.6, W / 2] }); sim.give('o1');
    Object.assign(sim.ball, { x: when === 'none' ? 15.3 : 14.3, y: W / 2 }); // (off his foot toward him, or at his foot)
    m.stealWindow(); assert.equal(m.stealOpen(), false, 'never the moment STEAL shows');
    if (when !== 'early') { sim.time += m.opp.glowFirst * 1.26; m.stealWindow(); }
    assert.equal(m.stealOpen(), when === 'in' || when === 'after', when);
    if (when === 'after') sim.time += m.opp.glow + .01;
    const t0 = sim.time, r = m.steal();
    assert.equal(r, when === 'in' ? 'won' : 'missed', when); assert.equal(m.owner(), when === 'in' ? 'hero' : 'o1');
    if (r === 'missed') {
      assert.ok(m.meMove.kind === 'lunge' && m.meMove.until - sim.time >= 1, 'a lunge costs him about 1.5 s');
      assert.ok(m.stealSpent() && m.stealLeft() > .99, 'STEAL is spent'); assert.equal(m.steal(), null, 'a press while it is spent does nothing');
      sim.time = t0 + m.opp.recover * .5; assert.ok(Math.abs(m.stealLeft() - .5) < .02, 'it comes back over opp.recover s');
      sim.time = t0 + m.opp.recover + .01; assert.ok(!m.stealSpent(), 'and is back');
      Object.assign(sim.ball, { x: 14.3, y: W / 2 }); place(sim, { o1: [15, W / 2], hero: [13.6, W / 2] }); m.stealWindow(); assert.equal(m.stealOpen(), false, 'no glow straight after it is back');
    }
  }
});

// The steal tool's two players (fast2/tools/r-steal.mjs, shorter): both chase their carrier; one presses STEAL 0.4 s
// after the glow starts, the other every 0.7 s whenever it can be pressed.
function stealBot(policy, secs = 200, seed = 3) {
  const { sim, m } = match(seed); m.me = m.favor = 'hero'; m.meAuto = false; m.setup('them'); m.kickoff('them');
  m.on.goal = () => m.after(1.8, () => m.kickoff('them'));
  let real = 0, next = 0, glowOn = false, last = -9, presses = 0, won = 0; const pend = [], dt = 1 / 60;
  while (real < secs) {
    real += dt; for (let i = pend.length - 1; i >= 0; i--) if (pend[i].at <= real) pend.splice(i, 1)[0].f();
    m.step(dt * .75); sim.step(dt * .75); if (m.dead) { glowOn = false; continue; }
    const me = sim.a('hero'), c = m.owner(), shown = c && m.team(c) === 'them' && R.stealShown(sim.a(c), me), glow = shown && m.stealOpen();
    const press = d => { last = real; pend.push({ at: real + d, f: () => { const r = m.steal(); if (r) presses++; if (r === 'won') won++; } }); };
    if (policy === 'wait' && glow && !glowOn) press(.4);
    if (policy === 'mash' && shown && !m.stealSpent() && real - last > .7) press(.1);
    glowOn = glow;
    if (real > next) { next = real + .8; const t = c && m.team(c) === 'them' ? sim.a(c) : c ? null : sim.ball; if (t) { const p = R.moveTarget(me, t, L, W); m.meTo(p.x, p.y, p.ring || 1); } }
  }
  return { presses, won, rate: won / (presses || 1), perMin: won / (secs / 60) };
}
test('waiting for the glow wins STEAL; mashing it does not pay (under 20%, and fewer steals a minute)', () => {
  const wait = stealBot('wait'), mash = stealBot('mash');
  assert.ok(wait.presses >= 3 && wait.rate >= .85, `waiting: ${JSON.stringify(wait)}`);
  assert.ok(mash.rate < .2, `mashing: ${JSON.stringify(mash)}`);
  assert.ok(mash.perMin < wait.perMin, `steals a minute: mashing ${mash.perMin.toFixed(2)}, waiting ${wait.perMin.toFixed(2)}`);
});

test('the shot view: from every place SHOOT shows, all six targets on screen, under the HUD, at least 56 px apart', async () => {
  const { spaces, EDGE } = await import('../js/shot.js');
  for (const [w, h] of [[844, 390], [932, 430]]) {
    let n = 0;
    for (let x = L - EDGE; x <= L - 1; x += .5) for (let y = .7; y <= W - .7; y += .5) {
      if (Math.hypot(L - x, W / 2 - y) > EDGE) continue; n++;
      const t = spaces(), cam = R.aimCam({ x, y }, L, PITCH.gy0, PITCH.gy1, PITCH.gh, w, h, t), q = t.map(z => R.project(cam, { x: L + .02, y: z.y, z: z.z }, w, h));
      for (const p of q) { assert.ok(R.onScreen(p, w, h, 30), `on screen from ${x},${y}`); assert.ok(p[1] >= R.HUD_PX + 4, `under the HUD from ${x},${y}: ${p[1].toFixed(0)}`); }
      let g = 1e9; for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) g = Math.min(g, Math.hypot(q[i][0] - q[j][0], q[i][1] - q[j][1]));
      assert.ok(g >= 56, `${g.toFixed(0)} px apart from ${x},${y} at ${w}x${h}`);
    }
    assert.ok(n > 20);
  }
});

test('chips sit only on the side edges, clear of the HUD and the bottom buttons, never over each other or the middle', () => {
  const rnd = seeded(4), w = 844, h = 390;
  for (let i = 0; i < 300; i++) {
    const ps = Array.from({ length: 3 }, () => R.chipSpot(rnd() < .2 ? null : [rnd() * 3000 - 1000, rnd() * 1600 - 600], rnd() - .5, w, h));
    R.layoutChips(ps, h);
    for (const p of ps) { assert.ok(p[0] <= 56 || p[0] >= w - 56, 'an edge'); assert.ok(p[1] >= R.CHIP_Y0 && p[1] <= h - R.CHIP_Y1, 'clear of the HUD and the buttons'); }
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) if (ps[a][0] === ps[b][0]) assert.ok(Math.abs(ps[a][1] - ps[b][1]) >= R.CHIP_GAP - 1e-9 || h - R.CHIP_Y1 - R.CHIP_Y0 < 2 * R.CHIP_GAP, 'apart');
  }
  assert.deepEqual(R.chipSpot(null, 1, w, h), [R.CHIP_X, h - R.CHIP_Y1], 'behind him to his left: low on the left edge');
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

test('a press held over 0.25 s (or slid) slows the world; a quick tap acts, and so does a child\'s slow tap (0.3 to 0.5 s, the finger still)', () => {
  assert.equal(R.pressKind(.12, false), 'tap'); assert.equal(R.pressKind(.24, false), 'tap');
  assert.equal(R.pressKind(.3, false), 'hold'); assert.equal(R.pressKind(.1, true), 'hold');
  for (const t of [.1, .3, .4, .5]) assert.ok(R.pressActs(t, false), `a still press of ${t} s acts on the lift`);
  assert.ok(!R.pressActs(.3, true), 'a slide (a look round) never acts'); assert.ok(!R.pressActs(1.2, false), 'a long hold to look and think does not act');
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
  const done = run(m, sim, 1500, () => { const p = sim.ball.x + sim.ball.y; still = last != null && Math.abs(p - last) < 1e-5 && !m.dead ? still + 1 / 60 : 0; last = p; assert.ok(still < 12, 'the ball moves'); return Math.max(m.score.us, m.score.them) >= 3; }); // (a player standing on the ball: the defender walks in and needs about 4 s on him)
  assert.ok(done, `ended: ${m.score.us}-${m.score.them}`);
});

test('the pitch fills the picture: at least 75% of it at the median over every place and heading (rows 80% in 9 of 10), and he stays on screen', () => {
  for (const [w, h] of [[932, 430], [844, 390]]) {
    let n = 0, full = 0; const shares = [];
    for (let x = 1; x < L; x += 1.5) for (let y = .6; y < W; y += 1.5) for (let hd = 0; hd < 8; hd++) for (const has of [true, false]) for (const look of has ? [0, 1] : [1]) {
      const me = { x, y }, a = hd * Math.PI / 4, ball = has ? { x: x + .4, y, z: 0 } : { x: R.clamp(x + Math.cos(a) * 8, .5, L - .5), y: R.clamp(y + Math.sin(a) * 8, .5, W - .5), z: 0 };
      const cam = R.fitPitch(R.camSpec(me, ball, has, R.naturalYaw(me, ball, has, L, W), look), me, w, h, L, W, [ball]); n++;
      if (R.rowsOnPitch(cam, w, h, L, W) >= R.FILL) full++;
      assert.ok(R.onScreen(R.project(cam, { x, y, z: .5 }, w, h), w, h), `him at ${x},${y}`);
      shares.push(R.pitchShare(cam, w, h, L, W));
    }
    assert.ok(full / n >= .9, `rows full in ${(100 * full / n).toFixed(1)}%`);
    shares.sort((a, b) => a - b); assert.ok(shares[shares.length >> 1] >= .75, `the whole picture: pitch ${shares[shares.length >> 1].toFixed(2)} at the median`); assert.ok(shares[Math.floor(shares.length * .05)] >= .5, 'and seldom much less');
  }
});

// The view he does not steer near the lines (v86): over a grid of places (the ball at his feet, or 3 and 8 m away in 8
// ways), the real share of the picture that is pitch (24 x 24 rays): at least 0.8 at the median, near a side line or a
// goal line too, and much more often over 0.65 than the old view (naturalYaw + fitPitch alone); him and the ball always
// on screen; never looking down more steeply than TILT_MAX.
test('near the lines the view turns along the pitch and the pitch fills the picture: median 0.8 or more, him and the ball on screen', () => {
  const w = 932, h = 430, all = [], edge = [], old = []; let off = 0;
  for (let x = .8; x < L; x += 2.5) for (let y = .6; y < W; y += 1.7) for (const r of [0, 3, 8]) for (let hd = 0; hd < (r ? 8 : 1); hd++) {
    const me = { x, y }, has = r === 0, a = hd * Math.PI / 4, ball = has ? { x: x + .4, y, z: 0 } : { x: R.clamp(x + Math.cos(a) * r, .5, L - .5), y: R.clamp(y + Math.sin(a) * r, .5, W - .5), z: 0 };
    const cam = R.viewCam(me, ball, has, R.viewPick(me, ball, has, 1, w, h, L, W), 1, w, h, L, W), sh = R.pitchShare(cam, w, h, L, W, 24, 24);
    all.push(sh); if (Math.min(y, W - y) < 2.5 || Math.min(x, L - x) < 2.5) { edge.push(sh); const c0 = R.camSpec(me, ball, has, R.naturalYaw(me, ball, has, L, W), 1); old.push(R.pitchShare(R.fitPitch(c0, me, w, h, L, W, [ball], 1), w, h, L, W, 24, 24)); }
    if (!R.onScreen(R.project(cam, { x, y, z: .5 }, w, h), w, h) || !R.onScreen(R.project(cam, ball, w, h), w, h)) off++;
    assert.ok(Math.atan2(cam.eye[2] - cam.tgt[2], Math.hypot(cam.tgt[0] - cam.eye[0], cam.tgt[1] - cam.eye[1])) <= R.TILT_MAX + 1e-6, 'never a view from the top');
  }
  const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1], under = a => a.filter(v => v < .65).length / a.length;
  assert.equal(off, 0, 'him and the ball on screen');
  assert.ok(med(all) >= .8, `median ${med(all).toFixed(2)}`); assert.ok(med(edge) >= .8, `near a line: median ${med(edge).toFixed(2)}`);
  assert.ok(under(edge) < under(old) / 2, `near a line under 0.65: ${under(edge).toFixed(2)} (the old view ${under(old).toFixed(2)})`);
});
test('the view turns no faster than TURN_MAX, and a long turn near a line is never held at the line', () => {
  const w = 932, h = 430, st = { yaw: 0 }, me = { x: 2, y: W - 1.5 }; let tick = 0, last = st.yaw, max = 0;
  for (const ball of [{ x: L - 3, y: 3, z: 0 }, { x: .8, y: W - .6, z: 0 }, { x: 12, y: 2, z: 0 }]) for (let i = 0; i < 240; i++) {
    R.viewStep(st, { me, ball, has: false, look: 1, w, h, L, W, nat: R.naturalYaw(me, ball, false, L, W), drag: null, still: false }, 1 / 60, 1, () => (tick += .12));
    max = Math.max(max, Math.abs(R.wrap(st.yaw - last)) * 60); last = st.yaw;
  }
  assert.ok(max <= R.TURN_MAX + 1e-6, `turned at ${max.toFixed(2)} rad/s`);
  const ball = { x: 12, y: 2, z: 0 }, cam = R.viewCam(me, ball, false, st, 1, w, h, L, W);
  assert.ok(R.onScreen(R.project(cam, ball, w, h), w, h), 'and it got round to the ball');
});

// ---------- the level follows him (v86: js/fast/level.js, js/progress.js) ----------
test('the level: up a little after a win, more after a clear one; down a little after a loss, more after a heavy one; in bounds; stars never go down', async () => {
  const Lv = await import('../js/fast/level.js'), M = await import('../js/fast/match.js');
  const l0 = Lv.startLevel('4v4');
  assert.equal(l0, M.LEVELS['4v4']);
  const up = Lv.levelAfter(l0, { us: 3, them: 2 }) - l0, upC = Lv.levelAfter(l0, { us: 3, them: 0 }) - l0, dn = Lv.levelAfter(l0, { us: 1, them: 3 }) - l0, dn1 = Lv.levelAfter(l0, { us: 2, them: 3 }) - l0;
  assert.ok(up > 0 && upC > up && dn1 < 0 && dn < dn1, JSON.stringify({ up, upC, dn1, dn }));
  assert.ok(Math.max(up, upC, -dn, -dn1) <= .12, 'small steps: no match is a wall');
  assert.equal(Lv.levelAfter(l0, { us: 1, them: 1 }), l0, 'a draw leaves it');
  assert.equal(Lv.levelAfter(M.LEVEL_MAX, { us: 3, them: 0 }), M.LEVEL_MAX); assert.equal(Lv.levelAfter(M.LEVEL_MIN, { us: 0, them: 3 }), M.LEVEL_MIN);
  for (const k of ['run', 'press', 'tackle', 'stand', 'cutRun', 'glow', 'glowGap', 'recover']) assert.ok(Number.isFinite(M.oppOf(M.LEVEL_MIN)[k]) && M.oppOf(M.LEVEL_MIN)[k] > 0, k);
  assert.ok(M.oppOf(-.5).run < M.oppOf(0).run && M.oppOf(-.5).cutRun === M.oppOf(0).cutRun, 'below 0 they are slower, but a closed pass line is still closed');
  assert.equal(Lv.stars(l0, '4v4').n, 0); assert.equal(Lv.stars(l0 + Lv.STAR * 6, '4v4').row, 1); assert.equal(Lv.stars(l0 + Lv.STAR * 6, '4v4').medals, 1);
  const html = Lv.badge(l0 + Lv.STAR * 2, '4v4', 1); assert.equal((html.match(/class="on/g) || []).length, 2); assert.equal((html.match(/ new"/g) || []).length, 1); assert.ok(/Level 3/.test(html));
  const { fastLevel, fastLevelDone } = await import('../js/progress.js'), p = {};
  assert.deepEqual(fastLevel(p, '4v4', l0), { level: l0, best: l0, n: 0 });
  fastLevelDone(p, '4v4', l0, l0 + .1); const e = fastLevelDone(p, '4v4', l0, l0 + .03);
  assert.deepEqual(e, { level: l0 + .03, best: l0 + .1, n: 2 }, 'the level eases, the best (the stars) stays');
  assert.deepEqual(fastLevel(JSON.parse(JSON.stringify(p)), '4v4', l0), e, 'kept in the save'); assert.equal(fastLevel(p, '3v3', -.85).level, -.85, 'each size its own');
});
test('a Match takes his level (no level: the size\'s start)', () => {
  const sim = new Sim(), sz = sizeOf();
  const m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, level: .3 }); assert.equal(m.level, .3);
  const m2 = new Match({ sim: new Sim(), size: '5v5', L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper }); assert.equal(m2.level, LEVELS['5v5']);
});

test('the scan reminder and the hold hint sit clear of his player, the ball and the goals when any place is clear', () => {
  const w = 932, h = 430, box = R.HINT_BOX;
  for (const avoid of [[[466, 380], [466, 300]], [[466, 390], [300, 386], [640, 380], [466, 96]], [[200, 215], [700, 215], [466, 380]]]) {
    const q = R.hintSpot(avoid, w, h), clear = p => Math.abs(p[0] - q[0]) > box[0] / 2 || Math.abs(p[1] - q[1]) > box[1] / 2;
    assert.ok(avoid.every(clear), `${JSON.stringify(avoid)} -> ${q}`);
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

test('a pass shown open (gold) at the tap arrives at least 9 times in 10', () => {
  const rnd = seeded(13); let open = 0, arrived = 0;
  for (let k = 0; k < 400 && open < 120; k++) {
    const { sim, m } = match(k + 3); m.me = 'hero'; m.dead = false; m.cmd.clear(); m.restart = null;
    for (const a of sim.agents.values()) if (!a.gk) { const x = 4 + rnd() * (L - 8), y = 2 + rnd() * (W - 4); Object.assign(a, { x, y, tx: x, ty: y }); }
    const h = sim.a('hero'); Object.assign(sim.ball, { x: h.x + .4, y: h.y }); sim.give('hero');
    const to = m.usIds.filter(id => id !== 'hero').find(id => m.passCheck('hero', id).open); if (!to) continue;
    open++; let got = null; m.on.gain = id => { got ??= id; }; m.pass('hero', to); run(m, sim, 5, () => got);
    if (got === to) arrived++;
  }
  assert.ok(open >= 60, `${open} open passes`); assert.ok(arrived / open >= .9, `${arrived} of ${open} arrived`);
});

test('standing on the ball: at the default level about 4 s of a defender on him before the tackle, and he comes in at a walk', () => {
  for (const size of Object.keys(LEVELS)) assert.ok(oppOf(LEVELS[size]).stand >= 3.9, `${size}: ${oppOf(LEVELS[size]).stand.toFixed(1)} s`);
});

test('a pass that meets one of his own friends is that friend\'s: it never goes through anyone', () => {
  const { sim, m } = match(); m.me = 'hero'; m.dead = false;
  park(sim, ['hero', 'm1', 'm2']); place(sim, { hero: [8, W / 2], m1: [13, W / 2 + .1], m2: [18, W / 2] });
  Object.assign(sim.ball, { x: 8.4, y: W / 2 }); sim.give('hero'); m.cmd.clear(); m.cmd.set('m1', 1e9); m.next.set('m1', 1e9);
  let got = null; m.on.gain = id => { got ??= id; }; m.pass('hero', 'm2'); run(m, sim, 4, () => got);
  assert.equal(got, 'm1');
});
