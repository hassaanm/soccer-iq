// The keeper game (v67): its save rule, its tells, a round played through, and what the save file keeps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, zoneAt, spotsFor, rightSpot, standOf, saveOf, crossAt, tellOf, roundPlan, makeShot, START, DIVE_MAX, BODY, SHOTS, TELL, WHY } from '../js/saves.js';
import { CLOSE } from '../js/shot.js';
import { Goalie } from '../js/game/goalie.js';
import { keeperDone, load, defaultProgress } from '../js/progress.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const allShots = () => SEEDS.flatMap(roundPlan);
const wrongSpots = sh => spotsFor(sh).filter(p => !p.right);

test('a round: eight shots from the left, the middle and the right, close and far, one or two 1v1s, a penalty to end it', () => {
  for (const seed of SEEDS) {
    const plan = roundPlan(seed);
    assert.equal(plan.length, SHOTS);
    assert.equal(plan.at(-1).kind, 'pen');
    const v = plan.filter(s => s.kind === '1v1').length; assert.ok(v >= 1 && v <= 2, `seed ${seed}: ${v} 1v1s`);
    const us = plan.map(s => s.from.u); assert.ok(us.some(u => u > 1) && us.some(u => u < -1) && us.some(u => Math.abs(u) < .6), `seed ${seed}: sides`);
    const d = plan.map(s => Math.hypot(s.from.x, s.from.u)); assert.ok(d.some(x => x <= CLOSE) && d.some(x => x > CLOSE), `seed ${seed}: close and far`);
    assert.deepEqual(roundPlan(seed), plan, 'the same seed, the same round');
    plan.forEach((s, i) => { assert.ok(s.dive >= 2.7 && s.dive <= 4, 'the dive window is about 3 to 4 s'); if (i) assert.ok(s.dive <= plan[i - 1].dive && s.stand <= plan[i - 1].stand, 'a little quicker as the round goes on'); });
  }
});

test('where to stand: one right spot of three, on the line from the ball to the middle of the goal, a step off the line', () => {
  for (const sh of allShots()) {
    const sp = spotsFor(sh), r = sp.filter(p => p.right);
    if (sh.kind === 'pen') { assert.deepEqual(sp, [], 'a penalty: on his line, no spots'); assert.equal(standOf(sh, START), 'right'); continue; }
    assert.equal(sp.length, 3); assert.equal(r.length, 1);
    assert.ok(sp.every(p => p.x === r[0].x), 'side by side, at one depth');
    const R = r[0], cross = R.u * sh.from.x - sh.from.u * R.x; // (zero when the ball, the spot and the goal's middle are in one line)
    assert.ok(Math.abs(cross) < 1e-9, 'ball, you, goal');
    assert.ok(Math.abs(R.x - (sh.kind === '1v1' ? 2.2 : 1)) < 1e-9, 'a step off the line (two in a 1v1)');
    for (const p of sp) assert.ok(Math.abs(p.u) <= 2.15, 'every spot is inside the posts');
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(sp[i].x - sp[j].x, sp[i].u - sp[j].u) >= 1.4 - 1e-9, 'spots are apart, so a finger can tell them apart');
    assert.equal(standOf(sh, R), 'right'); for (const p of wrongSpots(sh)) assert.equal(standOf(sh, p), 'wrong');
  }
});

test('the same taps in the same shot give the same result', () => {
  for (const sh of allShots().slice(0, 64)) for (const p of [...spotsFor(sh), START]) for (const z of [null, ...ZONES]) assert.deepEqual(saveOf(sh, p, z), saveOf(sh, p, z));
});

test('a ball he can reach where he chose is saved; one out of his reach never is', () => {
  for (const sh of allShots()) for (const p of [...spotsFor(sh), START]) for (const tap of [null, ...ZONES]) {
    const r = saveOf(sh, p, tap), c = crossAt(sh.from, sh.zone, p.x), far = Math.abs(c.u - p.u);
    if (far > DIVE_MAX) assert.equal(r.res, 'goal', 'out of his reach: in');
    if (tap === sh.zone && far <= DIVE_MAX) assert.equal(r.res, 'save', 'he went where it went, and could get there');
    if (r.res === 'save') {
      assert.ok(far <= DIVE_MAX, 'saved only within reach');
      assert.ok(Math.abs(r.hand.u - c.u) < 1e-9 && Math.abs(r.hand.z - c.z) < 1e-9, 'a save: his hands on the ball');
      assert.ok(tap ? tap === sh.zone || zoneAt(tap).col === zoneAt(sh.zone).col : far <= BODY, 'a save is his choice, the other height on that side, or a ball at his body');
    } else assert.ok(Math.hypot(r.hand.u - c.u, r.hand.z - c.z) > .4, 'a goal: his hands are not where the ball goes');
  }
});

test('standing right widens his reach: the other height on the side he chose, and no far corner out of reach', () => {
  let more = 0;
  for (const sh of allShots().filter(s => s.kind !== 'pen')) {
    const count = p => ZONES.reduce((n, ball) => n + ZONES.filter(tap => saveOf({ ...sh, zone: ball, foot: 'las' }, p, tap).res === 'save').length, 0);
    const R = spotsFor(sh).find(p => p.right), right = count(R);
    for (const p of wrongSpots(sh)) { const n = count(p); assert.ok(right > n, `${sh.kind} ${sh.n}: right ${right} > wrong ${n}`); more++; }
    for (const ball of ZONES) { // from the right spot: his choice and the other height beside it
      const B = zoneAt(ball);
      for (const tap of ZONES) assert.equal(saveOf({ ...sh, zone: ball, foot: 'las' }, R, tap).res, zoneAt(tap).col === B.col ? 'save' : 'goal', `${sh.kind} ${sh.n} right spot, ${tap} for ${ball}`);
    }
    for (const p of wrongSpots(sh)) for (const ball of ZONES) for (const tap of ZONES) if (tap !== ball && zoneAt(tap).col === zoneAt(ball).col && Math.abs(crossAt(sh.from, ball, p.x).u - p.u) > BODY)
      assert.equal(saveOf({ ...sh, zone: ball, foot: 'las' }, p, tap).res, 'goal', 'from a wrong spot only the target he chose');
  }
  assert.ok(more > 100);
  // From a spot off to one side, the far corner is out of reach.
  const sh = makeShot(0, 'shot', { x: 7, u: 0 }, 'L'), off = { x: 1, u: -1.4 };
  assert.equal(saveOf(sh, off, 'L').res, 'goal'); assert.equal(saveOf(sh, off, 'L').why, 'spot');
  assert.equal(saveOf(sh, rightSpot(sh), 'L').res, 'save');
});

test('every tell is honest: his eyes and body show the side and height it goes, the kick shows how', () => {
  for (const sh of allShots()) {
    const t = tellOf(sh), Z = zoneAt(sh.zone);
    assert.equal(t.col, Z.col); assert.equal(t.top, Z.top); assert.deepEqual(t.at, { u: Z.u, z: Z.z });
    const d = Math.hypot(sh.from.x, sh.from.u);
    assert.equal(sh.foot, d <= CLOSE ? 'in' : 'las', 'close: the inside of the foot; farther: the laces');
    if (sh.foot === 'in') assert.ok(!Z.top && sh.speed < 10, 'an inside-foot shot is low and slower');
    else assert.ok(sh.speed > 15, 'a laces shot is fast');
    assert.equal(t.level, TELL[sh.n]);
  }
  assert.deepEqual(TELL.slice(0, 2), [3, 3], 'clear on the first shots'); assert.ok(Math.max(...TELL.slice(5)) <= 1 && Math.min(...TELL) >= 1, 'subtler later, never gone');
});

// A stub world (projects every point to the middle of the screen) and a HUD that writes down what it is asked to show.
function makeGoalie() {
  const events = [], hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  return { g: new Goalie({ world: { project: () => [400, 200] }, hud }), events };
}
async function play(g, plan, pick) {
  let done = false, out; g.round(plan).then(v => { done = true; out = v; });
  const ball = [];
  for (let t = 0; t < 400 && !done; t += 1 / 30) {
    g.tick(1 / 30); pick(g);
    if (g.phase === 'flight') ball.push({ n: g.spec.n, x: g.sim.ball.x, y: g.sim.ball.y, z: g.sim.ball.z, state: g.sim.ball.state, carrier: g.sim.ball.carrier, k: { x: g.sim.a('hero').x, y: g.sim.a('hero').y } });
    await new Promise(r => setImmediate(r));
  }
  assert.ok(done, 'the round finished');
  return { res: out, ball };
}
const policy = choose => g => {
  if (g.phase === 'stand' && g.pickSpot == null && g.sim.time - g.win.t0 > g.win.T * .3) { const p = choose(g.spec, 'spot'); if (p != null) g.choose('spot:' + p); }
  if (g.phase === 'dive' && g.pickZone == null && g.sim.time - g.win.t0 > g.win.T * .3) { const z = choose(g.spec, 'zone'); if (z) g.choose('zone:' + z); }
};

test('a round played through: eight shots, the score, and the picture matches the result', async () => {
  const plan = roundPlan(7);
  // Even shots: the right spot and the right target (saved). Odd shots: no taps at all (in, unless it is at him).
  const pick = (sh, what) => (sh.n % 2 ? null : what === 'spot' ? spotsFor(sh).find(p => p.right)?.id ?? null : sh.zone);
  const { g, events } = makeGoalie(), { res, ball } = await play(g, plan, policy(pick));
  assert.equal(res.length, 8);
  res.forEach((r, i) => {
    assert.equal(r.spec.n, i);
    if (i % 2 === 0) assert.equal(r.res, 'save', `shot ${i}`);
    else assert.equal(r.res, saveOf(plan[i], START, null).res, `shot ${i}: no taps`);
  });
  const saves = res.filter(r => r.res === 'save').length;
  assert.equal(events.filter(e => e[0] === 'banner' && e[1] === 'SAVED!').length, saves);
  assert.equal(events.filter(e => e[0] === 'caption' && Object.values(WHY).some(w => String(e[1]).startsWith(w))).length, 8 - saves, 'a kind line for each goal');
  const dots = events.filter(e => e[0] === 'dots').at(-1); assert.deepEqual(dots[1], res.map(r => r.res === 'save')); assert.equal(dots[2], 8);
  // The ball: in a save it ends in his hands (or off them); in a goal it ends in the net.
  for (const r of res) {
    const last = ball.filter(b => b.n === r.spec.n).at(-1);
    if (r.res === 'goal') assert.ok(last.x < 0, `shot ${r.spec.n}: in the net`);
    else if (r.held) { assert.equal(last.carrier, 'hero'); assert.equal(last.state, 'held'); } else assert.ok(last.x > 0, 'pushed away, out in front');
  }
});

test('the same taps in the same round give the same results, played out', async () => {
  const plan = roundPlan(3), pick = (sh, what) => (what === 'spot' ? spotsFor(sh)[sh.n % 3]?.id ?? null : ZONES[(sh.n * 5) % 6]);
  const a = (await play(makeGoalie().g, plan, policy(pick))).res, b = (await play(makeGoalie().g, plan, policy(pick))).res;
  const key = r => [r.res, r.why, r.act, r.held, r.spot, r.tap].join();
  assert.deepEqual(a.map(key), b.map(key));
});

test('the save file keeps his best score, his rounds and a sticker for 6 or more', () => {
  const p = defaultProgress();
  let r = keeperDone(p, 4, { day: 10, now: 1 }); assert.deepEqual([r.first, r.best, r.sticker], [true, false, false]);
  assert.deepEqual(p.keeper, { best: 4, plays: 1, last: 4, day: 10, stickers: 0 });
  r = keeperDone(p, 6, { day: 11, now: 2 }); assert.deepEqual([r.first, r.best, r.sticker], [false, true, true]);
  r = keeperDone(p, 5, { day: 11, now: 3 }); assert.deepEqual([r.best, r.sticker], [false, false]);
  assert.deepEqual(p.keeper, { best: 6, plays: 3, last: 5, day: 11, stickers: 1 });
  assert.deepEqual(p.stickers, [{ emoji: '🧤', skill: 'keeper', at: 2 }]);
  // Kept across a reload; a save from before the keeper game has none (and nothing else changes).
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  storage.setItem('soccer-iq:v1', JSON.stringify(p)); assert.deepEqual(load(storage).keeper, p.keeper);
  storage.setItem('soccer-iq:v1', JSON.stringify({ v: 1, skills: {} })); assert.equal(load(storage).keeper, undefined);
});
