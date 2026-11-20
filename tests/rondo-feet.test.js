// The rondos (v93): the ball he gets always comes to his feet, and he can always move along his side with it (the
// owner's "the ball froze in front of me and I could not move": a pass taken a little off his line was left out of his
// reach, and the box kept him on his line, so he never got to it). Also: his friends play the rondo as coaches teach it
// (never back into a corner at him with the defender coming), and a careless child never gets stuck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rondo } from '../js/mini/rondo-play.js';
import * as K from '../js/mini/rondo.js';
import { stream } from '../js/shot.js';
import { dist } from '../js/fast/rules.js';

const flush = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };
async function play(g, secs, f = () => false) { for (let t = 0; t < secs; t += 1 / 30) { g.tick(1 / 30); await flush(); if (f()) return true; } return false; }
const place = (g, id, x, y) => { const a = g.sim.a(id); Object.assign(a, { x, y, tx: x, ty: y, sp: 0, speed: 0 }); };
async function begun(mode, L = 0, seed = .3) { const g = new Rondo({ mode, rnd: stream(seed) }); const p = g.round(L); await play(g, 5, () => g.phase === 'play'); return { g, p }; }

test('keep: a pass he takes off his line comes in to his feet, and he dribbles along his side with it', async () => {
  for (const off of [.5, .7, 1.2, 1.8]) {
    const { g } = await begun('keep', 0, .2 + off / 10);
    const s = g.sim, b = g.box, me = s.a('hero'), sp = g.spots();
    place(g, 'hero', sp[2].x, sp[2].y); place(g, 'o1', b.x1 - .5, b.y1 - .5); g.busy.set('o1', s.time + 99);
    // the ball reaches him `off` m in front of him, inside the box (the log's frozen ball)
    Object.assign(s.ball, { x: me.x + off, y: me.y, z: 0, state: 'loose', carrier: null, move: null, reach: null });
    g.give('hero', 'pass');
    await play(g, .5);
    assert.equal(g.owner(), 'hero'); assert.ok(dist(me, s.ball) < .8, `at his feet (${dist(me, s.ball).toFixed(2)} m, off ${off})`);
    for (const i of [4, 0, 3]) {
      const x0 = { x: me.x, y: me.y }; assert.ok(g.goSpot(sp[i]));
      await play(g, 4, () => dist(me, sp[i]) < .3 || g.owner() !== 'hero');
      assert.equal(g.owner(), 'hero', 'still his'); assert.ok(dist(me, x0) > 1, 'he moved with it'); assert.ok(dist(me, s.ball) < 1.1, 'the ball at his feet');
    }
    assert.equal(g.stats.far, 0, 'his ball was never out of his reach');
  }
});

test('keep: a pass to a spot he is not on stops there for him (he goes and meets it)', async () => {
  const { g } = await begun('keep', 0, .9);
  const s = g.sim, b = g.box, me = s.a('hero'), sp = g.spots();
  place(g, 'hero', sp[1].x, sp[1].y); place(g, 'm2', b.x1, b.cy); place(g, 'o1', b.x1 - .5, b.y0 + .5); g.busy.set('o1', s.time + 99); g.busy.set('m2', s.time + 99);
  Object.assign(s.ball, { x: b.x1 - .4, y: b.cy, state: 'carried', carrier: 'm2', reach: null, move: null }); g.give('m2', 'pass');
  g.heroTarget = () => sp[3]; assert.ok(g.pass('m2', 'hero', 9));
  await play(g, 3, () => s.ball.state === 'loose' || g.owner() === 'hero');
  assert.ok(dist(s.ball, sp[3]) < .9, 'it went to the other spot'); assert.notEqual(g.owner(), 'hero');
  assert.ok(g.goSpot(sp[3])); await play(g, 4, () => g.owner() === 'hero');
  assert.equal(g.owner(), 'hero'); await play(g, .4); assert.ok(dist(me, s.ball) < .8);
});

test('keep: a friend in a corner with the defender on him never plays it back into the corner at him', async () => {
  // (coaching: play away from pressure. He may play it to him only into the space away from the defender, along his
  // side, so he bails out of the corner onto it; or to the far friend, or the other side)
  let intoCorner = 0, n = 0, toMe = 0;
  for (let k = 0; k < 12; k++) {
    const { g } = await begun('keep', k % 3, .1 + k * .07);
    const s = g.sim, b = g.box, sp = g.spots();
    // he is on his corner spot by the left side; m1 has it on the left side near that same corner; the defender comes at m1 from the middle
    place(g, 'hero', sp[4].x, sp[4].y); place(g, 'm1', b.x0 + 1.3, b.y1); place(g, 'm2', b.x1, b.cy); place(g, 'm3', b.cx, b.y0);
    place(g, 'o1', b.x0 + 2.2, b.y1 - 1.4); if (s.a('o2')) place(g, 'o2', b.cx + 2, b.cy - 1);
    Object.assign(s.ball, { x: b.x0 + 1.3, y: b.y1 - .4, state: 'carried', carrier: 'm1', reach: null, move: null }); g.give('m1', 'pass'); g.gotAt -= 2;
    g.hooks.pass = (from, to) => { if (from !== 'm1') return; n++; if (to !== 'hero') return; toMe++; const t = g.flight.tgt; if (dist(t, sp[4]) < .5 || g.takers().some(o => dist(o, t) < g.D.fRoom - .3)) intoCorner++; };
    await play(g, 3, () => g.flight || g.phase !== 'play');
  }
  assert.ok(n >= 3, `passes: ${n}`);
  assert.equal(intoCorner, 0, `into the corner at him: ${intoCorner} (to him: ${toMe} of ${n})`);
});
// A careless child: slow taps every 0.8-2 s at random places near (or far from) the spots, the same tap ten times now
// and then, taps between rounds, passes to anyone, STEAL pressed any time.
async function child(mode, seed, rounds) {
  const r = stream(seed), g = new Rondo({ mode, rnd: stream((seed * 5.3 + .2) % 1) }); let stuck = 0, done = 0, withBall = 0;
  for (let k = 0; k < rounds; k++) {
    let res = null; g.round(k % 4 / 3).then(x => { res = x; });
    let next = 0, burst = 0, act = null, walked = 0, last = null; const checks = [], clock = { t: 0 };
    for (let t = 0; !res && t < 60; t += 1 / 30) {
      g.tick(1 / 30); await flush(); clock.t = t;
      { const me = g.sim.a('hero'); if (last) walked += Math.hypot(me.x - last.x, me.y - last.y); last = { x: me.x, y: me.y }; } // (the way he has walked)
      for (let i = checks.length - 1; i >= 0; i--) if (t >= checks[i].at) { const c = checks.splice(i, 1)[0]; if (g.phase === 'play' && g.owner() === 'hero' && !g.flight && walked - c.from < .3) stuck++; } // (he has not taken a step since the tap)
      if (t < next) continue;
      if (burst > 0) { burst--; act(); next = t + .1; continue; }
      const sp = g.spots(), has = g.owner() === 'hero';
      act = mode === 'keep' && has && r() < .4 ? (m => () => g.passTo(m))(['m1', 'm2', 'm3'][Math.floor(r() * 3)])
        : mode === 'win' && r() < .35 ? () => g.steal()
        : (p => () => { const me = g.sim.a('hero'), had = g.owner() === 'hero', q = g.moveTo(p); if (q && had && !q.stay && dist(me, q) > .5) { withBall++; checks.push({ at: clock.t + 1.6, from: walked }); } })(sp.length ? { x: sp[Math.floor(r() * sp.length)].x + (r() - .5) * 4, y: sp[Math.floor(r() * sp.length)].y + (r() - .5) * 4 } : { x: 0, y: 0 });
      if (r() < .12) burst = 9; act(); next = t + .8 + r() * 1.2;
    }
    assert.ok(res, 'every round ends'); assert.equal(res.far, 0, 'his ball never out of his reach'); done++;
  }
  return { stuck, done, withBall };
}
test('a careless child never gets stuck: every move he taps with the ball happens, in both games', async () => {
  for (const mode of ['keep', 'win']) { const x = await child(mode, mode === 'keep' ? .31 : .57, 12); assert.equal(x.stuck, 0, `${mode}: ${x.stuck} stuck of ${x.withBall}`); assert.equal(x.done, 12); }
});
