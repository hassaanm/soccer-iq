// "Peek, then turn!": the turn he plays is the arrow the child tapped. The arrow round his left shoulder (L) turns him
// to his left and he leaves on that side, the ball goes with him by touches, the body never swings back the other
// way first, and the result matches the picture (turning into the defender loses it, turning away keeps it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { allScenarios } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { Sim } from '../js/sim.js';
import { makeGame, drive, toPicture } from './harness.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), deg = 180 / Math.PI;
const plays = [...allScenarios('peek-and-turn'), ...Array.from({ length: 30 }, (_, i) => generate('peek-and-turn', i + 1)).filter(Boolean)];
// A side as he faced the passer: + his left.
const leftOf = (f, dx, dy) => dy * Math.cos(f) - dx * Math.sin(f);

// Plays one arrow the way the game does (the pass, the decision, the tap) and measures his body while the ball is his.
async function turnPlay(sc, opt) {
  const { g, events } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre());
  const p = g.decide(); g.tick(1 / 30, 0); toPicture(g); // (round 2: he turns as the scene has it, the pass nearly there)
  const arcs = g.turnArcs(), f0 = g.yaw0, good = g.isGood(opt);
  g.choose(opt); await p;
  const s = g.sim, h = s.a('hero'), x0 = h.x, y0 = h.y, r = { arcs, f0, good, rot: 0, lo: 0, hi: 0, sides: new Set(), side: 0 };
  let prev = Math.atan2(h.face[1], h.face[0]), had = false, lost = false, n = 0;
  await drive(g, g.outcome(opt, good), { onFrame: () => {
    if (s.ball.carrier === 'hero') had = true; else if (had) lost = true;
    if (lost || n++ > 75) return; // the turn and the run out of it, while it is still his ball
    const f = Math.atan2(h.face[1], h.face[0]); r.rot += wrap(f - prev); prev = f; r.lo = Math.min(r.lo, r.rot); r.hi = Math.max(r.hi, r.rot);
    if (s.ball.carrier === 'hero' && s.ball.move) r.sides.add(Math.sign(s.ball.move.d));
    if ((r.turned = Math.abs(r.rot) > 1.6 ? (r.turned || 0) + 1 : 0) < 15) r.side = leftOf(f0, h.x - x0, h.y - y0); // (the side he leaves on: as he comes out of the turn, not where his run on to goal takes him later)
  } });
  r.stolen = events.some(e => e[0] === 'banner' && e[1] === 'Stolen!');
  return r;
}

test('the turn arrows: L sweeps round his left shoulder, R round his right, both from the way he faces', async () => {
  for (const sc of plays.slice(0, 6)) {
    const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre());
    const p = g.decide(); g.tick(1 / 30, 0); toPicture(g); // (round 2: he turns as the scene has it, the pass nearly there)
    const f = g.yaw0, by = Object.fromEntries(g.turnArcs().map(t => [t.id, t]));
    assert.ok(by.L.a1 > by.L.a0 && by.R.a1 < by.R.a0, `${sc.id}: L goes counterclockwise (his left), R clockwise`);
    for (const [id, sgn] of [['L', 1], ['R', -1]]) { const mid = (by[id].a0 + by[id].a1) / 2; assert.ok(Math.sign(leftOf(f, Math.cos(mid), Math.sin(mid))) === sgn, `${sc.id}: arrow ${id} on his ${sgn > 0 ? 'left' : 'right'}`); }
    g.choose(sc.best); await p;
  }
});

test('he turns the way the tapped arrow goes, leaves on that side, and never swings the other way first', async () => {
  let n = 0;
  for (const sc of plays) for (const opt of ['turn:L', 'turn:R']) {
    const want = opt === 'turn:L' ? 1 : -1, r = await turnPlay(sc, opt), at = `${sc.id} ${opt} (${r.good ? 'good' : 'bad'})`;
    assert.equal(Math.sign(r.rot), want, `${at}: the body turned ${(r.rot * deg).toFixed(0)}°`);
    assert.ok(Math.abs(r.rot) > 1.6, `${at}: the body turned only ${(r.rot * deg).toFixed(0)}° before the play ended`);
    assert.ok(want > 0 ? r.lo > -.1 : r.hi < .1, `${at}: swung ${((want > 0 ? r.lo : r.hi) * deg).toFixed(0)}° the other way on the way round`);
    assert.deepEqual([...r.sides], [want], `${at}: the ball was turned ${[...r.sides]}`);
    if (r.good) assert.equal(Math.sign(r.side), want, `${at}: he left on the other side`);
    assert.equal(r.stolen, !r.good, `${at}: ${r.stolen ? 'lost' : 'kept'} the ball`);
    n++;
  }
  assert.ok(n >= 40, `only ${n} plays`);
});

test('with a defender close behind him, the right turn is the one away from him', () => {
  for (const sc of plays.filter(s => s.pattern === 'peek-turn')) {
    const [hx, hy] = sc.heroTo, [mx, my] = sc.mates[0], f = Math.atan2(my - hy, mx - hx), [ox, oy] = sc.opps[0];
    const away = leftOf(f, ox - hx, oy - hy) > 0 ? 'turn:R' : 'turn:L';
    assert.equal(sc.best, away, `${sc.id}: the defender is on his ${away === 'turn:R' ? 'left' : 'right'}`);
  }
});

test('told which way, he turns that way even when the other way round is shorter', () => {
  for (const side of [1, -1]) {
    // He faces -x with the ball in front of him and turns to face 30° off straight back on the side he was not told.
    const s = new Sim(); s.setup({ hero: [15, 10], mates: [], opps: [], carrier: 'hero' });
    const h = s.a('hero'); h.face = [-1, 0]; Object.assign(s.ball, { x: 14.55, y: 10, h: Math.PI });
    const want = Math.PI - side * (Math.PI - .5); // the short way to it is round his other shoulder
    s.open('hero', h.x + Math.cos(want) * 5, h.y + Math.sin(want) * 5, side);
    s.go('hero', h.x + Math.cos(want) * 5, h.y + Math.sin(want) * 5, 4);
    let rot = 0, prev = Math.PI;
    for (let k = 0; k < 60; k++) { s.step(1 / 60); const f = Math.atan2(h.face[1], h.face[0]); rot += wrap(f - prev); prev = f; }
    assert.equal(Math.sign(s.ball.move?.d ?? rot), side);
    assert.equal(Math.sign(rot), side, `told ${side}: turned ${(rot * deg).toFixed(0)}°`);
  }
});

test('in a match, a pass back to him is turned the way the tapped arrow goes too', async () => {
  const ALL = ['look-up', 'dribble-to-space', 'take-him-on', 'shoot-close', 'get-goal-side', 'steal-it', 'won-it-go', 'peek-and-turn', 'see-the-trap', 'get-open', 'pass-to-open', 'lead-pass', 'give-and-go', 'one-goes', 'forward-first', 'follow-shot', 'go-to-goal'];
  const real = Math.random, done = [];
  try {
    for (let seed = 1; seed <= 45; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.skills = new Set(ALL); let cur = null, k = 0; // (v66: 45 matches: a match has a few decisions fewer than it had)
      await drive(g, g.match(ALL, [], 4, 'free'), { maxSec: 4000, pick: gm => {
        if (gm.sc.kind === 'receive') { // the arrows in turn; his body and the ball are followed until the turn he takes it with is over
          const opt = k++ % 2 ? 'turn:L' : 'turn:R', h = gm.sim.a('hero');
          done.push(cur = { at: `match ${seed} ${opt}`, want: opt === 'turn:L' ? 1 : -1, rot: 0, lo: 0, hi: 0, prev: Math.atan2(h.face[1], h.face[0]), sides: new Set() });
          return opt;
        }
        if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
        return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back');
      }, onFrame: gm => {
        if (!cur || cur.over) return; const s = gm.sim, h = s.a('hero');
        if (s.ball.carrier === 'hero') cur.had = true; else if (cur.had) { cur.over = true; return; }
        // (one turn: the first he takes it with; game time runs in small steps, so the next can start in the same frame)
        if (cur.had && cur.moved && s.ball.move !== cur.moved) { cur.over = true; return; }
        if (cur.had && s.ball.move) { cur.moved = s.ball.move; cur.sides.add(Math.sign(s.ball.move.d)); }
        const f = Math.atan2(h.face[1], h.face[0]); cur.rot += wrap(f - cur.prev); cur.prev = f; cur.lo = Math.min(cur.lo, cur.rot); cur.hi = Math.max(cur.hi, cur.rot);
      } });
    }
  } finally { Math.random = real; }
  assert.ok(done.length >= 20, `only ${done.length} passes back to him`);
  for (const r of done) {
    assert.equal(Math.sign(r.rot), r.want, `${r.at}: the body turned ${(r.rot * deg).toFixed(0)}°`);
    assert.ok(r.want > 0 ? r.lo > -.1 : r.hi < .1, `${r.at}: swung ${((r.want > 0 ? r.lo : r.hi) * deg).toFixed(0)}° the other way first`);
    assert.ok([...r.sides].every(s => s === r.want), `${r.at}: the ball was turned ${[...r.sides]}`);
  }
});

test('after a wrong turn and the replay, the second try turns the right way cleanly too', async () => {
  for (const sc of plays.filter(s => s.pattern === 'peek-turn').slice(0, 8)) {
    const { g } = makeGame(), wrongT = sc.best === 'turn:L' ? 'turn:R' : 'turn:L', want = sc.best === 'turn:L' ? 1 : -1;
    let picks = 0, r = null;
    await drive(g, g.round(sc, { hint: false }), { pick: gm => { picks++; if (picks === 2) { const h = gm.sim.a('hero'); r = { h, rot: 0, lo: 0, hi: 0, prev: Math.atan2(h.face[1], h.face[0]) }; } return picks === 1 ? wrongT : sc.best; },
      onFrame: gm => {
        if (!r || r.over || gm.phase !== 'outcome') return; const s = gm.sim;
        if (s.ball.carrier === 'hero') r.had = true; if (r.had && r.moved && !s.ball.move) { r.over = true; return; } if (r.had && s.ball.move) r.moved = true;
        const f = Math.atan2(r.h.face[1], r.h.face[0]); r.rot += wrap(f - r.prev); r.prev = f; r.lo = Math.min(r.lo, r.rot); r.hi = Math.max(r.hi, r.rot);
      } });
    assert.equal(picks, 2, `${sc.id}: two tries`);
    assert.equal(Math.sign(r.rot), want, `${sc.id}: second try turned ${(r.rot * deg).toFixed(0)}°`);
    assert.ok(want > 0 ? r.lo > -.1 : r.hi < .1, `${sc.id}: second try swung ${((want > 0 ? r.lo : r.hi) * deg).toFixed(0)}° the other way first`);
  }
});
