// The rondos (v88), on the real classes: a pass through a defender's reach is his; he stays on his side (keep) or in
// the box (win); friends pass to him only on an open line; STEAL wins in the glow and only there; two lives end a run;
// the difficulty only rises, a little a round; the view is from behind and above him.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rondo } from '../js/mini/rondo-play.js';
import * as K from '../js/mini/rondo.js';
import { newRun, attempt, STEP } from '../js/mini/rules.js';
import { MINI, miniById } from '../js/mini/games.js';
import { miniLines } from '../js/voicelines.js';
import { stream } from '../js/shot.js';
import { dist } from '../js/fast/rules.js';

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
// Plays until f() or `secs` of real time; each frame a thirtieth of a second.
async function play(g, secs, f = () => false) { for (let t = 0; t < secs; t += 1 / 30) { g.tick(1 / 30); await flush(); if (f()) return true; } return false; }
const place = (g, id, x, y) => { const a = g.sim.a(id); Object.assign(a, { x, y, tx: x, ty: y, sp: 0, speed: 0 }); };
// A round at level L, past its start (the ball at his feet: 'keep'; at o1's: 'win').
// The level's numbers without the first rounds' generosity (K.early), for the rules that do not depend on it.
function noEarly(g) { const D = g.D, e = D.early || 0; Object.assign(D, { stand: D.stand - K.EK.stand * e, press: D.press / (1 - K.EK.press * e), cutRun: D.cutRun / (1 - K.EK.cutRun * e), cutReact: D.cutReact - K.EK.cutReact * e, early: 0 }); }
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

test('win: a pass into his body is blocked (never through anyone); within his reach the ball glows', async () => {
  const { g, p } = await begun('win');
  const s = g.sim, b = g.box, o1 = s.a('o1'), o3 = s.a('o3');
  place(g, 'o1', b.x1, b.cy); place(g, 'o3', b.x0 + 3, b.y0); place(g, 'hero', (b.x1 + b.x0 + 3) / 2, (b.cy + b.y0) / 2);
  Object.assign(s.ball, { x: o1.x - .4, y: o1.y, state: 'carried', carrier: 'o1', reach: null, move: null });
  g.busy.set('o1', s.time + 9); g.busy.set('hero', s.time + 9);
  g.gotAt = s.time; g.rnd = () => .99; // (no heavy touch)
  assert.ok(g.pass('o1', 'o3', 5));
  let r = null, glowed = false; p.then(x => { r = x; });
  await play(g, 6, () => { glowed ||= g.glowing(); return !!r; });
  assert.ok(glowed, 'it glowed on its way into his reach');
  assert.equal(r?.res, 'won'); assert.equal(r.why, 'cut'); void o3;
});

test('keep: he cannot leave his side of the box; win: he cannot leave the box', async () => {
  const { g } = await begun('keep');
  const b = g.box, me = g.sim.a('hero');
  for (const p of [{ x: b.cx, y: b.cy }, { x: b.x0 - 5, y: b.y1 + 5 }, { x: b.x1 + 3, y: b.y0 - 9 }, { x: b.x0 + 1, y: b.cy - 2 }]) {
    const q = g.moveTo(p); assert.ok(q); assert.ok(K.offSide(b, 'near', q) < 1e-9, 'he goes to a point of his side');
    await play(g, 2.5); assert.ok(K.offSide(b, 'near', me) < 1e-6, `he is on his side (${me.x.toFixed(2)}, ${me.y.toFixed(2)})`);
    assert.ok(Math.abs(K.along(b, 'near', me)) <= K.reachOf(b) + 1e-6, 'and not past its corners');
  }
  const w = (await begun('win')).g, wb = w.box, h = w.sim.a('hero');
  for (const p of [{ x: wb.x0 - 6, y: wb.cy }, { x: wb.x1 + 4, y: wb.y1 + 4 }, { x: wb.cx, y: wb.y0 - 3 }]) {
    w.moveTo(p); await play(w, 3, () => w.phase !== 'play'); if (w.phase !== 'play') break;
    assert.ok(K.isIn(wb, h, -.3), `he stays in the box (${h.x.toFixed(2)}, ${h.y.toFixed(2)})`);
  }
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
      if (g.phase === 'play' && t > next) { next = t + .8; if (g.owner() === 'hero') g.passTo(['m1', 'm2', 'm3'][Math.floor(r() * 3)]); else g.moveTo(K.sideAt(g.box, 'near', (r() * 2 - 1) * K.reachOf(g.box))); }
    }
  }
  assert.ok(toMe >= 5, `passes to him: ${toMe}`);
  assert.equal(shut, 0, 'never on a shut line');
});

test('keep: a friend on the ball protects it; he loses it only after his line has stayed shut a while, and that loss is his', async () => {
  for (const meOpen of [true, false]) {
    const { g, p } = await begun('keep', 0, .2);
    const s = g.sim, b = g.box; noEarly(g); // (this rule as it is after the first rounds' generosity, K.early)
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

test('win: STEAL wins the ball in the glow; outside it he lunges, is slow a moment, and the round goes on', async () => {
  const { g, p } = await begun('win', 0, .5);
  const s = g.sim, me = s.a('hero');
  // outside the glow: the ball far from him
  place(g, 'hero', g.box.cx, g.box.cy); Object.assign(s.ball, { state: 'carried', carrier: 'o1', reach: null, move: null }); g.glowUntil = -9; g.glowWin = null;
  assert.ok(dist(me, s.ball) > 2.5); assert.equal(g.glowing(), false);
  assert.equal(g.steal(), 'missed'); assert.equal(g.phase, 'play');
  assert.equal(g.moveTo({ x: g.box.x0, y: g.box.y0 }), null, 'a moment he cannot move');
  assert.equal(g.steal(), null, 'nor steal again at once');
  await play(g, K.ME.lunge / K.SPEED + .3);
  assert.ok(g.moveTo({ x: g.box.cx, y: g.box.cy }), 'then he can');
  // in the glow: a loose ball rolling by within his reach
  place(g, 'hero', g.box.cx, g.box.cy);
  Object.assign(s.ball, { x: me.x + 1.1, y: me.y, z: 0, state: 'loose', carrier: null, move: null, reach: null }); g.flight = { kind: 'heavy', from: 'o1', to: 'o1', t0: s.time, tgt: { x: me.x + 1.1, y: me.y } };
  g.glowNext = -9; g.lungeT = -9; g.glowStep(1 / 30);
  assert.equal(g.glowing(), true);
  let r = null; p.then(x => { r = x; });
  assert.equal(g.steal(), 'won');
  await play(g, 5, () => !!r);
  assert.equal(r.res, 'won'); assert.equal(r.why, 'steal'); assert.equal(r.steals, 1); assert.equal(r.lunges, 1);
});

test('two lives end a run: rounds lost one after the other (he stands on the ball; nobody gets it back)', async () => {
  for (const mode of ['keep', 'win']) {
    const g = new Rondo({ mode, rnd: stream(.4) }), run = newRun(); let rounds = 0;
    while (!run.over && rounds < 5) { const pr = g.round(run.level); let r = null; pr.then(x => { r = x; }); await play(g, 60, () => !!r); rounds++; attempt(run, r.res === 'kept' || r.res === 'won'); }
    assert.equal(rounds, 2, mode); assert.equal(run.lives, 0); assert.equal(run.score, 0);
  }
  const r = newRun(); attempt(r, true); attempt(r, false); attempt(r, true); attempt(r, false); assert.deepEqual([r.score, r.over], [2, true]);
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
// (v89 integration) While the first rounds' generosity fades (K.early, up to EARLY + EARLY_FADE levels), the numbers it
// eases may move a little more a round (`fade`): still only the hard way, and smoothly.
function smooth(of, keys) {
  for (const [k, dir, max, fade = 0] of keys) for (let i = 1; i < LEVELS.length; i++) {
    const a = of(LEVELS[i - 1])[k], b = of(LEVELS[i])[k], lim = max == null ? null : max + (LEVELS[i] <= K.EARLY + K.EARLY_FADE + 1e-9 ? fade : 0);
    assert.ok(dir < 0 ? b <= a + 1e-12 : b >= a - 1e-12, `${k} goes the hard way only (level ${LEVELS[i].toFixed(2)})`);
    if (lim != null) assert.ok(Math.abs(b - a) <= lim + 1e-9, `${k} moves a little a round (level ${LEVELS[i].toFixed(2)}: ${a} → ${b})`);
  }
}
test('the difficulty only rises, a little each round; the second defender and the fourth passer come in gently', () => {
  smooth(K.keepLevel, [['size', -1, .3], ['press', 1, .2, .1], ['cover', 1, 1.2], ['cutRun', 1, .2, .25], ['cutReact', -1, .04, .08], ['stand', -1, .15, .6], ['think', -1, .05], ['smart', 1, .05], ['fMargin', -1, .03], ['fHold', -1, .04], ['fPass', 1, .2], ['fMove', 1, .05], ['two', 1, .3]]);
  smooth(K.winLevel, [['size', 1, .15], ['n', 1, 1], ['pass', 1, .9], ['heavy', -1, .07], ['careless', -1, .06], ['loose', -1, .12], ['hold', -1, .2], ['move', 1, .12], ['glow', -1, .05], ['gap', 1, .25], ['margin', 1, .08]]);
  const k = K.keepLevel(K.TWO_AT), k0 = K.keepLevel(K.TWO_AT - STEP);
  assert.equal(k0.two, 0); assert.ok(k.two > 0 && k.two <= .35, 'the second defender comes in at about a third of his strength');
  assert.ok(K.keepLevel(K.TWO_AT + 10 * STEP).two < 1 && K.keepLevel(40).two === 1, 'and grows over many rounds');
  assert.equal(K.winLevel(K.FOUR_AT - STEP).n, 3); assert.equal(K.winLevel(K.FOUR_AT).n, 4);
  assert.equal(K.winLevel(0).n, 3, 'three passers at first'); assert.equal(K.keepLevel(0).two, 0, 'four against one at first');
  assert.ok(K.winLevel(0).pass < 5.5 && K.winLevel(0).heavy >= .2, 'slow passes and heavy touches at first');
  assert.ok(K.keepLevel(0).size >= 12, 'a roomy box at first');
  assert.ok(K.keepLevel(0).stand >= 6 && K.keepLevel(.67).stand >= 6 && K.keepLevel(K.EARLY + K.EARLY_FADE).early === 0, 'the first three rounds: a long time on the ball; then the normal curve');
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
