// Skill moves (sim.js, flair.js): a skill never changes where anyone goes or when, a skill turn ends with the ball
// where the plain turn leaves it, the ball only bends with a foot on it, and who does which move is fixed per play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, turnFoot, skillNow, dribbleAt } from '../js/sim.js';
import { flairOf } from '../js/flair.js';

const DT = 1 / 60, deg = Math.PI / 180, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const only = (k, own = true) => ({ ctx: 'test', own, by: { hero: { p: 1, can: [k], fav: [k], tier: 'test' } } });
// He dribbles up the field (+x) at `speed`; at `at` seconds he runs off `turn` degrees to his left (0: straight on).
// A defender stands at `opp`. Returns every step: his and the ball's place, the move, the foot on the ball.
function run({ turn = 0, speed = 4.4, at = 1.7, opp = [13, 10.3], flair = null, secs = 0, back = 0 }) {
  secs ||= turn ? at + 2.5 : 4;
  const s = new Sim(); s.setup({ hero: [4, 10], mates: [], opps: opp ? [opp] : [] }); s.flair = flair;
  const h = s.a('hero'), out = []; let t0 = null;
  s.go('hero', 28, 10, speed); if (opp && back) s.go('o1', opp[0] + 9, opp[1], back);
  for (let k = 0; k < 60 * secs; k++) {
    if (turn && t0 == null && s.time >= at) { t0 = s.time; s.go('hero', h.x + 9 * Math.cos(turn * deg), h.y + 9 * Math.sin(turn * deg), speed); }
    const b = s.ball, rx = b.x - h.x, ry = b.y - h.y, wx = b.x, wy = b.y;
    s.step(DT);
    const tf = turnFoot(s, 'hero'), sk = skillNow(s, 'hero');
    out.push({ t: s.time, hx: h.x, hy: h.y, ox: s.a('o1')?.x, oy: s.a('o1')?.y, bx: b.x, by: b.y, k: b.move?.k, jump: Math.hypot(b.x - h.x - rx, b.y - h.y - ry),
      vx: b.x - wx, vy: b.y - wy, foot: tf && { ...tf }, sk: sk && { ...sk }, n: Math.floor(dribbleAt(h) / 1.4), skill: h.skill && { ...h.skill } });
  }
  return out;
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
// When to turn so the defender is about 2 m in front of him (he takes a moment to get going).
const when = (opp, speed) => .35 + Math.max(.5, ((opp ? opp[0] : 13) - 4 - 2.2) / speed);

test('a skill turn keeps him on the plain turn: same place every step, and the ball ends on the same spot', () => {
  for (const [k, turn, opp, speed] of [['chop', 90, [12.4, 7.8], 4.4], ['chop', -100, [12.4, 12.2], 4.4], ['roll', 90, [12, 7.8], 2], ['cruyff', 180, [14.6, 10.3], 4.4], ['cruyff', 180, [12.6, 10.3], 4.4], ['cruyff', 170, [9.5, 13.5], 4.4], ['croqueta', 40, [13.8, 9.3], 4.4], ['croqueta', -40, [13.8, 10.7], 4.4], ['double', 40, [13.8, 9.3], 4.4]]) {
    for (const own of k === 'double' ? [false] : [true, false]) {
      const at = when(opp, speed), plain = run({ turn, opp, speed, at }), sk = run({ turn, opp, speed, at, flair: only(k, own) });
      const used = sk.find(r => r.k === k);
      if (!own && k === 'croqueta') { assert.ok(!used, 'a croqueta only goes its own way, never where the AI plays'); continue; }
      if (!own && plain.find(r => r.k)?.k === 'pull') { assert.ok(!used, 'the pull back is only made a Cruyff with its own way'); continue; }
      assert.ok(used, `${k} (${turn}°, own ${own}) was used`);
      for (let i = 0; i < plain.length; i++) assert.ok(near(plain[i].hx, sk[i].hx) && near(plain[i].hy, sk[i].hy) && near(plain[i].ox ?? 0, sk[i].ox ?? 0), `${k}: he is where the plain turn has him at ${plain[i].t.toFixed(2)} s`);
      const end = sk.findIndex((r, i) => i > 0 && sk[i - 1].k === k && !r.k);
      assert.ok(end > 0, `${k}: the move ended`);
      assert.ok(near(plain[end].bx, sk[end].bx) && near(plain[end].by, sk[end].by), `${k}: the ball ends where the plain turn leaves it`);
      if (!own) for (let i = 0; i < plain.length; i++) assert.ok(near(plain[i].bx, sk[i].bx) && near(plain[i].by, sk[i].by), `${k}: the plain way, touch for touch`);
    }
  }
});

test('in a skill turn the ball never jumps, and it only changes direction with a foot on it', () => {
  let bends = 0;
  for (const [k, turn, opp, speed] of [['chop', 90, [12.4, 7.8], 2], ['chop', -90, [12.4, 12.2], 4.4], ['roll', 90, [12, 7.8], 2], ['cruyff', 180, [14.6, 10.3], 2], ['cruyff', 180, [14.6, 10.3], 4.4], ['croqueta', 40, [13.8, 9.3], 4.4], ['croqueta', -40, [13.8, 10.7], 3], ['double', -40, [13.8, 10.7], 4.4]]) {
    const r = run({ turn, opp, speed, at: when(opp, speed), flair: only(k, k !== 'double') }).filter(q => q.k === k);
    assert.ok(r.length > 10, `${k}: the move ran`);
    assert.ok(Math.max(...r.map(q => q.jump)) < .12, `${k}: the ball jumped`);
    for (let i = 1; i < r.length; i++) {
      const p = r[i - 1], q = r[i], sp = Math.hypot(p.vx, p.vy), sq = Math.hypot(q.vx, q.vy);
      if (sp * 60 < .4 || sq * 60 < .4) continue;
      const bend = Math.abs(wrap(Math.atan2(q.vy, q.vx) - Math.atan2(p.vy, p.vx)));
      if (bend > .25) { bends++; assert.ok(q.foot && q.foot.w > .5, `${k} ${turn}°: the ball bends ${(bend / deg).toFixed(0)}° with no foot on it`); }
    }
  }
  assert.ok(bends >= 4, `only ${bends} bends were checked`);
});

test('the croqueta goes from the inside of one foot to the inside of the other; the Cruyff drags with the far foot', () => {
  const feet = k => run({ turn: k === 'cruyff' ? 180 : 40, opp: k === 'cruyff' ? [14.6, 10.3] : [13.8, 9.3], at: k === 'cruyff' ? 1.7 : when([13.8], 4.4), flair: only(k, k !== 'double') }).filter(r => r.k === k && r.foot && r.foot.w > .9).map(r => r.foot.leg + r.foot.part);
  assert.deepEqual([...new Set(feet('croqueta'))], ['0inside', '1inside']); // turning left: right foot, then left foot
  assert.deepEqual([...new Set(feet('double'))], ['0inside', '1outside']);   // the double touch: inside of the right, outside of the left
  assert.deepEqual([...new Set(feet('cruyff'))], ['1inside']);           // turning right, away from him: the left foot
});

test('a dribble skill changes nothing in the game: everyone and the ball go exactly as without it', () => {
  for (const k of ['stepover', 'feint', 'scissors']) {
    const plain = run({ back: 1.4, speed: 4.4 }), sk = run({ back: 1.4, speed: 4.4, flair: only(k) });
    assert.ok(sk.some(r => r.skill?.k === k), `${k} was used`);
    for (let i = 0; i < plain.length; i++) assert.ok(near(plain[i].hx, sk[i].hx) && near(plain[i].bx, sk[i].bx) && near(plain[i].by, sk[i].by) && near(plain[i].ox, sk[i].ox), `${k}: same at ${plain[i].t.toFixed(2)} s`);
  }
});

test('a dribble skill fakes one way and the next touch takes the ball the other way', () => {
  const r = run({ back: 1.4, flair: only('stepover') }), i = r.findIndex(q => q.skill), first = r[i].skill;
  assert.ok(i > 0 && r[i].sk.c >= 0 && r[i].sk.c < .2, 'it starts just after a touch');
  const j = r.findIndex((q, k) => k > i && q.n > first.n); // the next touch
  const side = Math.sign((r[j + 8].by - r[j].by)); // the ball's sideways roll after that touch (he runs along +x)
  assert.equal(side, -first.fake);
  const o = r[i], d = o.ox - o.hx; assert.ok(d > 1.6 && d < 5, `the defender is ${d.toFixed(1)} m in front`);
});

test('no skill without a defender near, for a player who is not allowed, or twice within 3 s', () => {
  assert.ok(!run({ opp: null, flair: only('stepover') }).some(r => r.skill), 'nobody to beat');
  assert.ok(!run({ back: 1.4 }).some(r => r.skill || r.sk), 'no flair: never');
  const r = run({ back: 1.4, secs: 7, flair: { ...only('stepover'), by: { hero: { p: 1, can: ['stepover', 'feint'], fav: [], tier: 't' } } } });
  const starts = r.filter((q, i) => q.skill && !r[i - 1].skill).map(q => q.t);
  assert.ok(starts.length >= 1);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 3, 'two skills close together');
});

test('the choice is the same for the same play, and stars try more often than a made-up player', () => {
  const pick = (name, y) => { const s = new Sim(); s.setup({ hero: [10, y], mates: [], opps: [[13, y]] }); s.flair = { ctx: 't', by: { hero: flairOf(name) } }; return s.pickSkill(s.a('hero'), ['stepover', 'feint', 'scissors'], 't'); };
  for (let y = 2; y < 18; y += .37) assert.equal(pick('VINI JR', y), pick('VINI JR', y));
  const rate = name => { let n = 0, m = 0; for (let y = 1; y < 19; y += .011) { m++; if (pick(name, y)) n++; } return n / m; };
  const star = rate('VINI JR'), plain = rate('RICE'), made = rate('SILVA');
  assert.ok(star > .4 && star < .6 && plain > .2 && plain < .36 && made > .09 && made < .21, `star ${star.toFixed(2)}, plain ${plain.toFixed(2)}, made-up ${made.toFixed(2)}`);
  let sc = 0; for (let y = 1; y < 19; y += .011) if (pick('VINI JR', y) === 'scissors') sc++;
  assert.ok(sc > 250, 'his favourite comes up most');
  for (let y = 1; y < 19; y += .05) assert.ok(pick('RICE', y) !== 'scissors', 'the scissors are for players with flair');
});
