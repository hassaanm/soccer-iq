// (v96) A Live shot planned as "cleared" counts as blocked only where and when a defender really meets it. Before: a flight
// that ended at the planned point was cleared whenever that defender existed, even 30 m away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match, CLEAR_R } from '../js/fast/match.js';

const L = PITCH.L, W = PITCH.W;
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
// The hero 12 m out, a defender (o1) placed `gap` m from the spot on the shot's line where it is to be stopped, the others far away.
function scene({ gap, keeper = true, patch = null }) {
  const sim = new Sim(), sz = sizeOf(), m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: keeper, rnd: seeded(5) });
  m.setup('us'); m.me = 'hero'; m.dead = false; m.cmd.clear();
  for (const a of sim.agents.values()) if (!['hero', 'o1', 'k1', 'k2'].includes(a.id)) Object.assign(a, { x: 3, y: .9, tx: 3, ty: .9 });
  const h = sim.a('hero'), cy = W / 2, at = { x: L - 6, y: cy, z: 0 }, o = sim.a('o1');
  Object.assign(h, { x: L - 12, y: cy, tx: L - 12, ty: cy }); Object.assign(sim.ball, { x: h.x + .4, y: h.y }); sim.give('hero');
  Object.assign(o, { x: at.x, y: cy + gap, tx: at.x, ty: cy + gap });
  const k = sim.a('k2'); if (k) Object.assign(k, { x: L - .8, y: cy + 2, tx: L - .8, ty: cy + 2 });
  if (patch) patch(m);
  const speed = 11, d = L - h.x, res = { res: 'cleared', at, t: (at.x - h.x) / speed, by: { id: 'o1' }, to: { x: L, y: cy, z: .35 }, speed, arc: .1, d, act: 'watch', dir: 1, gap: 9 };
  return { sim, m, res };
}
const run = (m, sim, secs, f) => { for (let t = 0; t < secs; t += 1 / 60) { m.step(1 / 60); sim.step(1 / 60); if (f?.()) return true; } return false; };
function play(o) {
  const { sim, m, res } = scene(o); let end = null, atEnd = null;
  m.on.shotEnd = (f, how, by) => { if (!end) { end = { how, by, t: sim.time }; const d = sim.a('o1'), b = sim.ball; atEnd = { gap: Math.hypot(d.x - b.x, d.y - b.y) }; } };
  m.shoot('hero', res); run(m, sim, 6, () => end); if (atEnd) atEnd.owner = m.owner(); // (as the step that ended it finishes: he has it)
  return { end, atEnd, sim, m };
}

test('a defender close to the path steps into it and the ball hits him: cleared, and he has the ball', () => {
  for (const gap of [0, 1.2, 2.5]) {
    const { end, atEnd } = play({ gap });
    assert.equal(end?.how, 'cleared', `gap ${gap}`); assert.equal(end.by, 'o1');
    assert.ok(atEnd.gap <= CLEAR_R + .01, `gap ${gap}: the ball was ${atEnd.gap.toFixed(2)} m from him when it was called cleared`);
    assert.equal(atEnd.owner, 'o1', 'he has the ball');
  }
});

test('a defender who cannot get there in time does not clear it: the shot goes on to the goal', () => {
  for (const gap of [9, 20, 30]) {
    const { end, sim } = play({ gap });
    assert.ok(end && end.how !== 'cleared', `gap ${gap}: ended "${end?.how}"`);
    assert.equal(end.how, 'goal', `gap ${gap}`);
    assert.ok(Math.hypot(sim.a('o1').x - (L - 6), sim.a('o1').y - W / 2) > 3, 'and he was nowhere near the spot');
  }
});

test('even if the plan said he would get there, a ball that stops with nobody within reach goes on (never "cleared" for a defender who is not there)', () => {
  const { end } = play({ gap: 30, patch: m => { m.clearCheck = r => r; } }); // (the plan wrongly says yes)
  assert.ok(end && end.how === 'goal', `ended "${end?.how}"`);
});
