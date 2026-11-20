// (v93, the owner's log: "res=over" then "shotEnd how=goal") A Live shot ends as it was planned: a shot planned over or
// wide flies over or wide and ends as a miss; a goal crosses the line inside the frame; a save ends in the keeper's hands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../js/sim.js';
import { PITCH, sizeOf } from '../js/geom.js';
import { Match } from '../js/fast/match.js';
import { shotResult } from '../js/shot.js';

const L = PITCH.L, W = PITCH.W;
const seeded = (seed = 7) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296); };
const run = (m, sim, secs, f) => { for (let t = 0; t < secs; t += 1 / 60) { m.step(1 / 60); sim.step(1 / 60); if (f?.()) return true; } return false; };
const WANT = { goal: ['goal'], save: ['save'], over: ['out', 'loose'], wide: ['out', 'loose'] };

test('every planned shot result ends as planned (over and wide never score)', () => {
  let n = 0; const seen = {};
  for (const seed of [1, 2, 3, 4]) for (const zone of ['TL', 'TR', 'L', 'R', 'M']) for (const foot of ['in', 'las']) for (const [d, side] of [[6, 0], [9, 2.5], [13, -3], [17, 1], [11, -6]]) {
    const sim = new Sim(), sz = sizeOf(), m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: true, rnd: seeded(5) });
    m.setup('us'); m.me = 'hero'; m.dead = false; m.cmd.clear();
    for (const a of sim.agents.values()) if (!['hero', 'k2', 'k1'].includes(a.id)) Object.assign(a, { x: 3, y: .9, tx: 3, ty: .9 });
    const h = sim.a('hero'), k = sim.a('k2'); Object.assign(h, { x: L - d, y: W / 2 + side, tx: L - d, ty: W / 2 + side }); Object.assign(sim.ball, { x: h.x + .4, y: h.y }); sim.give('hero');
    const res = shotResult({ from: { x: h.x, y: h.y }, zone, foot, k: { x: k.x, y: k.y }, gx: L, rand: seeded(seed * 31 + d) }), force = res.res;
    if (!WANT[force]) continue; seen[force] = (seen[force] || 0) + 1;
    let end = null; m.on.shotEnd = (f, how) => { end ??= how; };
    m.shoot('hero', res); run(m, sim, 5, () => end);
    assert.ok(WANT[force].includes(end), `${force} ${zone} ${foot} from ${d} m, ${side} m across: ended "${end}"`); n++;
  }
  assert.ok(n > 60 && seen.over && seen.wide && seen.goal && seen.save, `${n} shots: ${JSON.stringify(seen)}`);
});

// (the owner's log: tackled in the instant he pressed SHOOT) The aim gets its own AIM_TACKLE s, whatever the contact clock was.
test('a tackle already counting down when he starts to aim waits the aim\'s own time', async () => {
  const { AIM_TACKLE } = await import('../js/fast/match.js');
  for (const late of [.3, .7, .95]) {
    const sim = new Sim(), sz = sizeOf(), m = new Match({ sim, L, W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: sz.out, keepers: !!sz.keeper, rnd: seeded(9) });
    m.setup('us'); m.me = 'hero'; m.dead = false; m.cmd.clear();
    for (const a of sim.agents.values()) if (!['hero', 'o1'].includes(a.id) && !a.gk) Object.assign(a, { x: 2, y: .9, tx: 2, ty: .9 });
    const h = sim.a('hero'); Object.assign(h, { x: 12, y: W / 2, tx: 12, ty: W / 2 }); Object.assign(sim.a('o1'), { x: 14, y: W / 2, tx: 14, ty: W / 2 }); Object.assign(sim.ball, { x: 12.4, y: W / 2 }); sim.give('hero'); m.safeT = 0;
    let tackT = null, aimT = null; m.on.gain = (id, how) => { if (id === 'o1' && how === 'tackle') tackT ??= sim.time; };
    run(m, sim, 15, () => { if (aimT == null && (m.contact.get('o1') || 0) >= late * m.standT) { m.meAim = true; aimT = sim.time; } return tackT != null; });
    assert.ok(aimT != null && tackT != null, `late ${late}: aimed and tackled`);
    assert.ok(tackT - aimT >= AIM_TACKLE - .05, `late ${late}: tackled ${(tackT - aimT).toFixed(2)} s after the aim began`);
  }
});
