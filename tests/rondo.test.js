// The rondos (v88, v93), on the real classes: a pass through a defender's reach is his; he moves only between fixed
// spots, on his side (keep) or in the box (win); a ball he gets always comes to his feet; friends pass to him only on an
// open line; STEAL wins a ball within his reach and only then (the glow is exactly that); two lives end a run; the
// difficulty only rises, a little a round; the view is from behind and above him.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rondo } from '../js/mini/rondo-play.js';
import * as K from '../js/mini/rondo.js';
import { newRun, attempt, STEP } from '../js/mini/rules.js';
import { MINI, miniById } from '../js/mini/games.js';
import { miniLines } from '../js/voicelines.js';
import { stream } from '../js/shot.js';
import { dist, STEAL_R } from '../js/fast/rules.js';

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
// Plays until f() or `secs` of real time; each frame a thirtieth of a second.
async function play(g, secs, f = () => false) { for (let t = 0; t < secs; t += 1 / 30) { g.tick(1 / 30); await flush(); if (f()) return true; } return false; }
const place = (g, id, x, y) => { const a = g.sim.a(id); Object.assign(a, { x, y, tx: x, ty: y, sp: 0, speed: 0 }); };
// A round at level L, past its start (the ball at his feet: 'keep'; at o1's: 'win').
async function begun(mode, L = 0, seed = .3) { const g = new Rondo({ mode, rnd: stream(seed) }); const p = g.round(L); await play(g, 5, () => g.phase === 'play'); return { g, p }; }

test('keep: a pass through a defender\'s reach is his, and the round is lost', async () => {
  const { g, p } = await begun('keep');
  const b = g.box, me = g.sim.a('hero'), m2 = g.sim.a('m2');
  place(g, 'hero', b.x0, b.cy); place(g, 'm2', b.x1, b.cy); place(g, 'o1', b.cx, b.cy + .4); // (right on the line across the box, .4 m off it)
  Object.assign(g.sim.ball, { x: me.x + .4, y: me.y, state: 'carried', carrier: 'hero', reach: null, move: null });
  g.busy.set('o1', g.sim.time + 9); // (he stays where he is: the ball comes to him)
  assert.equal(g.openLine('hero', 'm2', K.ME.pass), false, 'the line is shut');
  assert.ok(g.passTo('m2'));
  let r = null; p.then(x => { r = x; });
  await play(g, 8, () => !!r);
  assert.equal(r?.res, 'lost'); assert.equal(r.why, 'cut'); assert.equal(r.by, 'o1');
  void m2;
});

test('keep: he moves only between the fixed spots on his side; a tap far from every spot does nothing', async () => {
  const { g } = await begun('keep');
  const b = g.box, me = g.sim.a('hero'), sp = g.spots(); g.busy.set('o1', g.sim.time + 99); place(g, 'o1', b.x1 - .5, b.cy); // (the defender keeps away: this is about where he goes)
  assert.equal(sp.length, K.KEEP_SPOTS); for (const p of sp) assert.ok(K.offSide(b, 'near', p) < 1e-9, 'each spot is on his side');
  assert.equal(g.moveTo({ x: b.cx, y: b.cy }), null, 'a tap in the middle of the box: nothing');
  assert.equal(g.moveTo({ x: b.x0 - 6, y: b.y1 + 6 }), null, 'a tap far outside: nothing');
  for (const i of [0, 4, 2, 1]) {
    const q = g.moveTo({ x: sp[i].x + .7, y: sp[i].y - .5 }); assert.ok(q, 'a tap near a spot counts as that spot'); assert.ok(dist(q, sp[i]) < 1e-9);
    await play(g, 6, () => g.phase !== 'play' || (dist(me, sp[i]) < .3 && !g.goAt)); if (g.phase !== 'play') break;
    assert.ok(K.offSide(b, 'near', me) < 1e-6, 'he is on his side'); assert.ok(dist(me, sp[i]) < .35, `he got to the spot (${dist(me, sp[i]).toFixed(2)} m)`);
  }
  assert.deepEqual(g.spots(), sp, 'the spots never move');
});

test('win: spots in front of each passer (in reach of the ball at his feet) and in the passing lanes; a set stays put until he arrives', async () => {
  const { g } = await begun('win', 0, .4);
  const s = g.sim, me = s.a('hero'), sp = g.spots();
  assert.ok(sp.length >= 5 && sp.length <= 8, `${sp.length} spots`);
  for (const p of sp) assert.ok(K.isIn(g.box, p, -.5), 'inside the box');
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) assert.ok(dist(sp[i], sp[j]) >= K.MERGE - 1e-9, 'not crowded');
  const press = sp.filter(p => p.kind === 'press'); assert.ok(press.length >= 3, 'a place in front of the passers');
  for (const p of press) { const o = s.a(p.of); assert.ok(dist(p, o) < STEAL_R + .2, 'near enough to tackle'); }
  assert.ok(sp.some(p => p.kind === 'lane'), 'and in the lanes');
  const far = sp.slice().sort((a, b) => dist(b, me) - dist(a, me))[0]; assert.ok(g.goSpot(far));
  const set = JSON.stringify(g.spots()); let moved = 0;
  await play(g, 6, () => { if (g.phase !== 'play') return true; if (g.goAt) { assert.equal(JSON.stringify(g.spots()), set, 'no spot slides while he runs'); moved++; return false; } return true; });
  if (g.phase === 'play') { assert.ok(moved > 3); assert.ok(dist(me, far) < .4, 'he got there'); assert.notEqual(JSON.stringify(g.spots()), set, 'a new set round where he is now'); assert.ok(g.spots().every(p => dist(p, me) >= K.ON_SPOT), 'not the one he is on'); }
});
test('keep: his friends pass to him only when his line is open', async () => {
  let toMe = 0, shut = 0;
  for (let k = 0; k < 12; k++) {
    const g = new Rondo({ mode: 'keep', rnd: stream(.1 + k * .07) }), r = stream(.7 + k * .02);
    g.hooks.pass = (from, to) => { if (to !== 'hero') return; toMe++; if (!g.openLine(from, 'hero', g.D.fPass, 0)) shut++; };
    let done = false; g.round(k % 4).then(() => { done = true; });
    let next = 0;
    for (let t = 0; t < 40 && !done; t += 1 / 30) { // (he moves about his side at random, and passes on at once)
      g.tick(1 / 30); await flush();
      if (g.phase === 'play' && t > next) { next = t + .8; if (g.owner() === 'hero') g.passTo(['m1', 'm2', 'm3'][Math.floor(r() * 3)]); else { const sp = g.spots(); g.goSpot(sp[Math.floor(r() * sp.length)]); } }
    }
  }
  assert.ok(toMe >= 5, `passes to him: ${toMe}`);
  assert.equal(shut, 0, 'never on a shut line');
});

test('keep: a friend on the ball protects it; he loses it only after his line has stayed shut a while, and that loss is his', async () => {
  for (const meOpen of [true, false]) {
    const { g, p } = await begun('keep', 0, .2);
    const s = g.sim, b = g.box;
    g.openLine = (from, to) => meOpen && to === 'hero' && from !== 'hero'; // (every line shut; or only his open, but not free to pass to)
    g.passPoint = () => ({ x: s.a('o1').x, y: s.a('o1').y }); // (so his friend never passes it: the defender stands on the spot)
    place(g, 'm2', b.x1, b.cy); place(g, 'o1', b.x1 - .6, b.cy);
    Object.assign(s.ball, { x: b.x1 - .3, y: b.cy, state: 'carried', carrier: 'm2', reach: null, move: null }); g.give('m2', 'pass');
    let r = null; p.then(x => { r = x; });
    const t0 = s.time; await play(g, 2.4 / K.SPEED, () => !!r);
    assert.equal(r, null, 'no tackle in the first moments');
    await play(g, 20, () => !!r);
    if (meOpen) { assert.ok(!r || r.res === 'kept', 'his line open: his friend keeps it (the round runs out)'); continue; }
    assert.equal(r?.res, 'lost'); assert.equal(r.why, 'tackle'); assert.equal(r.fault, 'his'); assert.ok(s.time - t0 >= 2.4);
  }
});

test('win: STEAL never wins from out of reach; a miss slows him a moment; a press in reach wins, at a passer\'s feet too', async () => {
  const { g, p } = await begun('win', 0, .5);
  const s = g.sim, me = s.a('hero'), b = g.box;
  // the ball at a passer's feet, far from him: no glow, and a press misses
  place(g, 'hero', b.cx, b.cy); g.busy.set('o1', s.time + 99); g.gotAt = s.time + 99; // (o1 keeps it: he does not pass now)
  Object.assign(s.ball, { x: s.a('o1').x - .4, y: s.a('o1').y, z: 0, state: 'carried', carrier: 'o1', reach: null, move: null });
  assert.ok(dist(me, s.ball) > STEAL_R + 1); assert.equal(g.glowing(), false);
  assert.equal(g.steal(), 'missed'); assert.equal(g.phase, 'play'); assert.equal(g.owner(), 'o1');
  assert.ok(g.stumbling(), 'he stumbles'); assert.equal(g.steal(), null, 'a press while he stumbles does nothing more'); assert.equal(g.glowing(), false);
  // slow while he stumbles: the far side of the box takes him far longer
  const sp = g.spots().slice().sort((x, y) => dist(y, me) - dist(x, me))[0], x0 = { x: me.x, y: me.y }; assert.ok(g.goSpot(sp));
  const t0 = s.time; await play(g, .3); const slowV = dist(me, x0) / (s.time - t0); assert.ok(slowV <= K.ME.stumbleV + .2, `slow: ${slowV.toFixed(2)} m/s`);
  await play(g, (K.ME.stumble + .05) / K.SPEED); assert.equal(g.stumbling(), false, 'then back to normal');
  const x1 = { x: me.x, y: me.y }, t1 = s.time; await play(g, .3); assert.ok(dist(me, x1) / (s.time - t1) > 2.5, 'at his own speed again');
  // right in front of the passer, the ball at his feet: it glows, and a press takes it
  const o1 = s.a('o1'); place(g, 'hero', o1.x - 1.4, o1.y); Object.assign(s.ball, { x: o1.x - .4, y: o1.y, z: 0, state: 'carried', carrier: 'o1', reach: null, move: null });
  assert.ok(dist(me, s.ball) <= STEAL_R); assert.equal(g.glowing(), true);
  let r = null; p.then(x => { r = x; });
  assert.equal(g.steal(), 'won');
  await play(g, 5, () => !!r);
  assert.equal(r.res, 'won'); assert.equal(r.why, 'steal'); assert.equal(r.steals, 1); assert.equal(r.lunges, 1);
  assert.ok(dist(me, s.ball) < 1, 'the ball comes to his feet');
});

test('win: the glow is exactly "a press would win now" (never a ball out of reach: the owner\'s far steal)', async () => {
  const { g } = await begun('win', 0, .6);
  const s = g.sim, me = s.a('hero');
  let n = 0, on = 0;
  await play(g, 18, () => { if (g.phase !== 'play') return true; n++; const reach = !g.stumbling() && s.ball.carrier !== 'hero' && (s.ball.z || 0) < 1.2 && dist(me, s.ball) <= STEAL_R; assert.equal(g.glowing(), reach); if (reach) on++; return false; });
  assert.ok(n > 100);
  // the moment from the log (session 5, 30.7 s): a pass flying 3.9 m from him, just after it passed close by
  const w = (await begun('win', 0, .7)).g, ws = w.sim, h = ws.a('hero'); place(w, 'hero', w.box.cx, w.box.cy);
  Object.assign(ws.ball, { x: h.x - 1.5, y: h.y + 3.6, z: 0, state: 'flying', carrier: null, fx: h.x - 1, fy: h.y - 2, tx: h.x - 1.6, ty: h.y + 4.2, t: .7, dur: 1, arc: 0, z1: 0, z0: 0 });
  w.flight = { kind: 'pass', from: 'o3', to: 'o2', t0: ws.time, speed: 7, tgt: { x: h.x - 1.6, y: h.y + 4.2 } };
  assert.equal(w.glowing(), false); assert.equal(w.steal(), 'missed'); assert.notEqual(w.owner(), 'hero');
});

test('win: a ball that runs into him is his with no press', async () => {
  const { g, p } = await begun('win', 0, .8);
  const s = g.sim, b = g.box, o1 = s.a('o1'), o3 = s.a('o3');
  place(g, 'o1', b.x1, b.cy); place(g, 'o3', b.x0 + 3, b.y0); place(g, 'hero', (b.x1 + b.x0 + 3) / 2, (b.cy + b.y0) / 2);
  Object.assign(s.ball, { x: o1.x - .4, y: o1.y, state: 'carried', carrier: 'o1', reach: null, move: null });
  g.busy.set('o1', s.time + 9); g.busy.set('hero', s.time + 9); g.gotAt = s.time; g.rnd = () => .99;
  assert.ok(g.pass('o1', 'o3', 5));
  let r = null; p.then(x => { r = x; }); await play(g, 6, () => !!r);
  assert.equal(r?.res, 'won'); assert.equal(r.why, 'block'); assert.equal(r.presses, 0); void o3;
});
test('two lives end a run: rounds lost one after the other (he stands on the ball; nobody gets it back)', async () => {
  for (const mode of ['keep', 'win']) {
    const g = new Rondo({ mode, rnd: stream(.4) }), run = newRun(); let rounds = 0;
    while (!run.over && rounds < 5) { const pr = g.round(run.level); let r = null; pr.then(x => { r = x; }); await play(g, 60, () => !!r); rounds++; attempt(run, r.res === 'kept' || r.res === 'won'); }
    assert.equal(rounds, 2, mode); assert.equal(run.lives, 0); assert.equal(run.score, 0);
  }
  const r = newRun(); attempt(r, true); attempt(r, false); attempt(r, true); attempt(r, false); assert.deepEqual([r.score, r.over], [2, true]);
});

test('the countdown is in real seconds, whole numbers going down, slow motion or not', async () => {
  const { g } = await begun('keep');
  assert.ok(g.secsLeft() <= Math.ceil(g.len) && g.secsLeft() >= Math.ceil(g.len) - 5);
  const a = g.left; g.holding = true; await play(g, 1); g.holding = false;
  assert.ok(Math.abs(a - g.left - 1) < .05, `a real second off the clock while held (${(a - g.left).toFixed(2)})`);
  let last = g.secsLeft(), ok = true; await play(g, 3, () => { const x = g.secsLeft(); if (x != null && x > last) ok = false; last = x ?? last; return g.phase !== 'play'; });
  assert.ok(ok, 'it only goes down');
});

test('a round ends by itself: kept when the time runs out with the ball, and time up in win', async () => {
  const { g, p } = await begun('keep');
  let r = null; p.then(x => { r = x; });
  g.left = .5; g.busy.set('o1', g.sim.time + 99); place(g, 'o1', g.box.x1 - .5, g.box.y1 - .5); // (the defender far away)
  await play(g, 6, () => !!r); assert.equal(r.res, 'kept');
  const w = await begun('win'); let r2 = null; w.p.then(x => { r2 = x; }); w.g.left = .2; place(w.g, 'hero', w.g.box.x0 + .5, w.g.box.y0 + .5);
  await play(w.g, 6, () => !!r2); assert.ok(r2.res === 'time' || r2.res === 'won');
});

// Each number, level by level: it never goes the easy way, and a round moves it only a little.
const LEVELS = Array.from({ length: 121 }, (_, i) => i * STEP);
// (the forgiving first rounds, K.soft, ease out over their own steps: checked in the test below)
function smooth(of, keys) {
  for (const [k, dir, max] of keys) for (let i = 1; i < LEVELS.length; i++) {
    const a = of(LEVELS[i - 1])[k], b = of(LEVELS[i])[k];
    assert.ok(dir < 0 ? b <= a + 1e-12 : b >= a - 1e-12, `${k} goes the hard way only (level ${LEVELS[i].toFixed(2)})`);
    if (max != null && LEVELS[i] > K.SOFT_TO + 1e-9) assert.ok(Math.abs(b - a) <= max + 1e-9, `${k} moves a little a round (level ${LEVELS[i].toFixed(2)}: ${a} → ${b})`);
  }
}
test('the difficulty only rises, a little each round, from a real first round; the second defender comes in gently, four passers from the start', () => {
  smooth(K.keepLevel, [['secs', 1, 2], ['size', -1, .35], ['press', 1, .3], ['cover', 1, 1.6], ['cutRun', 1, .2], ['cutReact', -1, .04], ['stand', -1, .13], ['think', -1, .05], ['smart', 1, .05], ['fMargin', -1, .03], ['fHold', -1, .04], ['fPass', 1, .2], ['fMove', 1, .05], ['fRoom', -1, .1], ['two', 1, .5]]);
  smooth(K.winLevel, [['secs', -1, 1], ['size', 1, .15], ['n', 1, 0], ['pass', 1, .3], ['heavy', -1, .01], ['careless', -1, .01], ['hold', -1, .05], ['feel', 1, .1], ['react', -1, .02], ['move', 1, .03], ['margin', 1, .03], ['look', 1, .03], ['lead', 1, .03]]);
  const k = K.keepLevel(K.TWO_AT), k0 = K.keepLevel(K.TWO_AT - STEP);
  assert.equal(k0.two, 0); assert.ok(k.two > 0 && k.two <= .5, 'the second defender comes in at under half his strength');
  assert.ok(K.keepLevel(K.TWO_AT + 2 * STEP).two < 1 && K.keepLevel(40).two === 1, 'and grows over the next rounds');
  assert.equal(K.winLevel(0).n, 4, 'four passers from the first round: no step when one joins');
  // the first two rounds (score 0 and 1) forgive a slow young player; from score 2 the real curve, eased in (no cliff)
  assert.equal(K.soft(0), 1); assert.ok(K.soft(STEP) > .6 && K.soft(STEP) < .95, 'score 1: still mostly forgiving'); assert.equal(K.soft(2 * STEP), 0, 'score 2: the real game');
  assert.ok(K.keepLevel(0).stand > K.keepLevel(2 * STEP).stand + .5 && K.keepLevel(0).press < K.keepLevel(2 * STEP).press, 'keep: the defender is slower and tackles later at first');
  const w0 = K.winLevel(0); assert.ok(w0.lag > .3 && w0.reachPlus > 0 && STEAL_R + w0.reachPlus <= 1.9 + 1e-9 && w0.react > K.winLevel(2 * STEP).react, 'win: they read him late and keep it longer; his reach up to 1.9 m');
  assert.equal(K.winLevel(2 * STEP).lag, 0); assert.equal(K.winLevel(2 * STEP).reachPlus, 0);
  // a real first round (D1): the defender presses with purpose and the passes are brisk; rounds of 20 s or so
  const k1 = K.keepLevel(0), w1 = K.winLevel(0);
  const k2 = K.keepLevel(2 * STEP), w2 = K.winLevel(2 * STEP);
  assert.ok(k2.press >= 3.5 && k2.stand <= 1.5 && k1.fHold <= .75 && k1.fPass >= 9, 'keep: a real defender from score 2, brisk passes from the start');
  assert.ok(w2.hold <= 1.1 && w2.react <= .4 && w1.pass >= 6, 'win: they pass on quickly from score 2');
  for (const D of [k1, w1]) assert.ok(D.secs >= 18 && D.secs <= 22, `a first round of about 20 s (${D.secs})`);
});

test('the view: from behind and above his player, never from the top', () => {
  for (const yaw of [0, 1, -2, 3]) for (const keep of [[], [{ x: 30, y: 25, z: .9 }, { x: -5, y: 2, z: 0 }]]) {
    const me = { x: 10, y: 10 }, c = K.rondoCam(me, yaw, 6, keep, 844, 390), dx = me.x - c.eye[0], dy = me.y - c.eye[1], back = Math.hypot(dx, dy);
    assert.ok(back >= K.VIEW.back - 1e-9, 'behind him'); assert.ok((dx * Math.cos(yaw) + dy * Math.sin(yaw)) / back > .99, 'looking his way');
    const t = c.tgt, down = Math.atan2(c.eye[2] - t[2], Math.hypot(t[0] - c.eye[0], t[1] - c.eye[1])) * 180 / Math.PI;
    assert.ok(down > 10 && down < 35, `tipped down ${down.toFixed(0)}°, not from the top`);
  }
});

test('the rondos are on the Mini games screen, with their spoken lines', () => {
  for (const id of ['rondoKeep', 'rondoWin']) { const g = miniById(id); assert.ok(g && g.name && g.say && g.unit && /^<svg/.test(g.pic)); }
  assert.ok(MINI.findIndex(g => g.id === 'rondoKeep') > MINI.findIndex(g => g.id === 'pens'));
  const lines = new Set(miniLines());
  for (const l of [...Object.values(K.RONDO_SAID), 'Keep the ball!', 'Win the ball!']) assert.ok(lines.has(l), l);
});
