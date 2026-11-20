// Fast mode, v93 (the owner's D2 and the shot): movement by fixed spots, the ball always at his feet, a tackle he sees
// coming, and a shot's result only once the ball has got there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match, STEAL_REACH } from '../js/fast/match.js';
import * as R from '../js/fast/rules.js';
import { shotResult } from '../js/shot.js';

const L = PITCH.L, W = PITCH.W;
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
function match(seed = 7, keepers = !!sizeOf().keeper) {
  const sim = new Sim(), sz = sizeOf();
  const m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers, rnd: seeded(seed) });
  m.setup('us'); return { sim, m };
}
const run = (m, sim, secs, f) => { for (let t = 0; t < secs; t += 1 / 60) { m.step(1 / 60); sim.step(1 / 60); if (f?.()) return true; } return false; };
const sets = (m, sim, state) => { const s = sim, c = m.owner(); return R.spotSet({ me: s.a(m.me), state, carrier: c && s.a(c), ball: s.ball, mates: m.usIds.filter(id => id !== m.me).map(id => s.a(id)), foes: m.foes('us'), keeper: m.keeper('them'), L, W }); };

test('the spots: on the pitch, apart, never on a player, five to seven when there is room; with the ball never through one of theirs; theirs: a press first', () => {
  const rnd = seeded(5); let n = 0, few = 0;
  for (let k = 0; k < 300; k++) {
    const { sim, m } = match(k + 1); m.dead = false;
    for (const a of sim.agents.values()) if (!a.gk) { const x = 3 + rnd() * (L - 6), y = 2 + rnd() * (W - 4); Object.assign(a, { x, y, tx: x, ty: y }); }
    const me = sim.a('hero'), state = ['mine', 'ours', 'theirs', 'loose'][k % 4];
    if (state === 'mine') { Object.assign(sim.ball, { x: me.x + .4, y: me.y }); sim.give('hero'); }
    else if (state === 'ours') { const f = sim.a('m1'); Object.assign(sim.ball, { x: f.x + .4, y: f.y }); sim.give('m1'); }
    else if (state === 'theirs') { const o = sim.a('o1'); Object.assign(sim.ball, { x: o.x - .4, y: o.y }); sim.give('o1'); }
    else Object.assign(sim.ball, { state: 'loose', carrier: null, x: me.x + 4, y: me.y });
    const sp = sets(m, sim, state), bodies = [...sim.agents.values()].filter(a => a.id !== 'hero');
    n++; if (sp.length < R.SPOT_MIN) few++;
    assert.ok(sp.length <= R.SPOT_MAX, `${sp.length} spots`); assert.equal(sp.filter(p => p.best).length, sp.length ? 1 : 0, 'one best');
    for (const p of sp) {
      const inn = p.follow ? 0 : R.SPOT_IN; assert.ok(p.x >= inn - 1e-9 && p.x <= L - inn + 1e-9 && p.y >= inn - 1e-9 && p.y <= W - inn + 1e-9, `on the pitch: ${JSON.stringify(p)} ${state}`);
      if (!p.follow) assert.ok(bodies.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= R.SPOT_BODY - 1e-9), 'not on a player');
      for (const q of sp) if (q !== p) assert.ok(Math.hypot(q.x - p.x, q.y - p.y) >= R.SPOT_GAP - 1e-9, 'apart');
      if (state === 'mine') for (const o of m.allFoes('us')) assert.ok(R.onLane(o, me, p, 0).d >= 1 - 1e-9, 'never a dribble through one of theirs');
    }
    if (state === 'theirs') assert.equal(sp[0]?.kind, 'press');
    if (state === 'loose') assert.equal(sp[0]?.kind, 'ball');
  }
  assert.ok(few / n < .3, `fewer than ${R.SPOT_MIN} spots in ${(100 * few / n).toFixed(0)}% of crowded random places`);
});

test('the spots stay where they are: a set is the same for the same places (a grid, nothing slides)', () => {
  const { sim, m } = match(3); m.dead = false; Object.assign(sim.ball, { x: sim.a('hero').x + .4, y: sim.a('hero').y }); sim.give('hero');
  const a = sets(m, sim, 'mine'); for (const p of a) { assert.equal(p.x % R.GRID, 0); assert.equal(p.y % R.GRID, 0); }
});

// (D2) His own dribble never leaves the ball loose: to spot after spot, at every size, with their players pressing him.
test('no loose ball from his own dribble: to spot after spot, he keeps it until one of theirs takes it', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { sim, m } = match(seed); m.me = 'hero'; m.dead = false; m.cmd.clear(); sim.give('hero');
    let loose = 0, lostTo = null, moves = 0, prev = 'carried';
    m.on.gain = (id, how) => { if (m.team(id) === 'them' && !lostTo) lostTo = how; };
    run(m, sim, 40, () => {
      const b = sim.ball;
      if (prev === 'carried' && b.state === 'loose' && !m.flight && !lostTo) loose++;
      prev = b.state === 'carried' && b.carrier === 'hero' ? 'carried' : 'other';
      if (m.owner() === 'hero' && (!m.meMove || sim.time >= m.meMove.until)) { const sp = sets(m, sim, 'mine'); if (sp.length) { const p = sp[Math.floor(seed * 7 + moves) % sp.length]; m.meTo(p.x, p.y, p.kind); moves++; } }
      if (m.owner() === 'hero') { const h = sim.a('hero'); assert.ok(Math.hypot(sim.ball.x - h.x, sim.ball.y - h.y) < 1.6, 'at his feet'); }
      return lostTo || m.owner() !== 'hero';
    });
    assert.equal(loose, 0, `seed ${seed}: never loose from his own touch`);
    assert.ok(moves >= 1, `seed ${seed}: ${moves} moves`);
    if (lostTo) assert.ok(['tackle', 'cut', 'block'].includes(lostTo), `taken by one of theirs: ${lostTo}`);
  }
});

// (D2) A tackle on him is seen coming: the warning ring, then a clear moment before the tackle.
test('their tackle on him comes a clear moment after the warning, never at once', () => {
  for (const moving of [false, true]) {
    const { sim, m } = match(9); m.me = 'hero'; m.dead = false; m.cmd.clear();
    for (const a of sim.agents.values()) if (!['hero', 'o1'].includes(a.id) && !a.gk) Object.assign(a, { x: 2, y: .9, tx: 2, ty: .9 });
    const h = sim.a('hero'); Object.assign(h, { x: 12, y: W / 2, tx: 12, ty: W / 2 }); Object.assign(sim.a('o1'), { x: 14, y: W / 2, tx: 14, ty: W / 2 }); Object.assign(sim.ball, { x: 12.4, y: W / 2 }); sim.give('hero'); m.safeT = 0;
    if (moving) m.meTo(17, W / 2); // (into him)
    let warnT = null, tackT = null; m.on.warn = () => { warnT ??= sim.time; }; m.on.gain = (id, how) => { if (id === 'o1') tackT ??= sim.time; };
    run(m, sim, 12, () => tackT != null);
    assert.ok(warnT != null && tackT != null, `${moving ? 'dribbling into him' : 'standing'}: warned and tackled`);
    assert.ok(tackT - warnT >= .9, `${(tackT - warnT).toFixed(2)} s from the warning to the tackle`);
  }
});

// (the owner: "it would just say saved way before the ball even went to the goalie") The result comes only as the ball
// gets there: a save in the keeper's hands, a goal over the line; and the keeper moves to it as it comes.
test('a shot: the result word never comes before the ball gets there; the keeper goes to it and has it in his hands', () => {
  for (const force of ['save', 'goal']) for (const zone of ['L', 'R', 'TL', 'M']) {
    const { sim, m } = match(4, true); m.me = 'hero'; m.dead = false; m.cmd.clear();
    for (const a of sim.agents.values()) if (!['hero', 'k2', 'k1'].includes(a.id)) Object.assign(a, { x: 3, y: .9, tx: 3, ty: .9 });
    const h = sim.a('hero'), k = sim.a('k2'); Object.assign(h, { x: L - 8, y: W / 2 + 1.5, tx: L - 8, ty: W / 2 + 1.5 }); Object.assign(sim.ball, { x: h.x + .4, y: h.y }); sim.give('hero');
    const k0 = { x: k.x, y: k.y }, res = shotResult({ from: { x: h.x, y: h.y }, zone, foot: 'in', k: { x: k.x, y: k.y }, gx: L, force });
    let end = null; m.on.shotEnd = (f, how) => { end ??= { how, t: sim.time - f.t0, b: { ...sim.ball }, eta: f.eta - f.t0 }; };
    m.shoot('hero', res); run(m, sim, 4, () => end);
    assert.ok(end, `${force} ${zone}: it ended`);
    assert.equal(end.how, force, `${force} ${zone}`);
    assert.ok(end.t >= end.eta - .2, `${force} ${zone}: the word at ${end.t.toFixed(2)} s, the ball due at ${end.eta.toFixed(2)} s`);
    if (force === 'save') {
      assert.equal(sim.ball.state, 'held'); assert.equal(sim.ball.carrier, 'k2');
      assert.ok(Math.hypot(res.at.x - end.b.x, res.at.y - end.b.y) < .6, 'where the ball got to (at his hands)'); assert.ok(Math.hypot(k.x - k0.x, k.y - k0.y) > .1 || Math.abs(res.at.y - k0.y) < .4, 'he went to it');
      assert.ok(Math.hypot(k.x - end.b.x, k.y - end.b.y) < 1.4, `his body at the ball (${Math.hypot(k.x - end.b.x, k.y - end.b.y).toFixed(2)} m)`);
      run(m, sim, 2); assert.equal(m.owner(), 'k2', 'then he plays it');
    } else assert.ok(end.b.x >= L - .1, 'over the line');
  }
});

test('STEAL reach is about 1.5 m, and a ball in the air is never stolen', () => {
  assert.ok(STEAL_REACH >= 1.2 && STEAL_REACH <= 1.6);
  const { sim, m } = match(); m.me = 'hero'; m.dead = false; sim.give('o1'); const o = sim.a('o1'); Object.assign(sim.a('hero'), { x: o.x - 1, y: o.y }); Object.assign(sim.ball, { x: o.x - .4, y: o.y, z: 1.2 });
  assert.equal(m.canSteal(), false);
});

// Standing still must lose (the owner's rule): a whole match with him never doing anything, at the size's own start
// level and at the gentlest, is theirs.
test('standing still loses a Fast match (start level and the gentlest)', async () => {
  const { LEVELS, LEVEL_MIN } = await import('../js/fast/match.js');
  const size = Object.keys(LEVELS).find(k => sizeOf(k) === sizeOf()) || '3v3';
  for (const level of [LEVELS[size], LEVEL_MIN]) for (const seed of [11, 12]) {
    const sim = new Sim(), sz = sizeOf(), m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, level, rnd: seeded(seed) });
    m.me = m.favor = 'hero'; m.meAuto = false; m.setup('us'); m.kickoff('us');
    m.on.goal = team => { if (Math.max(m.score.us, m.score.them) < 3) m.after(1.8, () => m.kickoff(team === 'us' ? 'them' : 'us')); };
    run(m, sim, 1800, () => Math.max(m.score.us, m.score.them) >= 3);
    assert.ok(m.score.them > m.score.us, `level ${level} seed ${seed}: ${m.score.us}-${m.score.them}`);
  }
});
