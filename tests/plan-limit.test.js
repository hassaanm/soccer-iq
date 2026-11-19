// (v83) A match never leaves the picture still for seconds while the next scene's plan is made. The plan is made a fixed
// number of steps a frame (game/window.js prePlan), so how long it takes is the scene's own: gen-shot-open-110 needed
// 1800 frames (30 s at 60 a second). A scene whose plan takes more than PLAN_LIMIT frames is left out of the match's list
// (game/window.js vetRounds), by what the scene needs alone. Runs at the size being played (SOCCER_SIZE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH, pickRounds } from '../js/skills.js';
import { generate, generates, shotLook } from '../js/generate.js';
import { planSteps, kindOf } from '../js/window.js';
import * as GW from '../js/game/window.js';
import * as H from './harness.js';

const LIMIT = GW.PLAN_LIMIT ?? 170, PER = 5; // (frames; steps a frame: PLAN_STEPS + 1)
const TRIES = [0, 5.2, 4.2, 3.4];

// How many frames the plan of a scene takes before it is set up, as prePlan makes it: counted here on its own (not the
// game's own count), over every try prePlan makes.
function framesOf(g, sc) {
  if (!g.prePlanned?.(sc) && (sc.spots || sc.intro === 'won' || sc.kind === 'receive' || sc.kind === 'lead' || sc.kind === 'tackle' || sc.run === 'follow' || kindOf(sc) !== 'attack')) return 0; // (planned as it is set up, a few frames at 61 steps each)
  const sim = new g.sim.constructor(); sim.setup(sc);
  const ghost = Object.assign(Object.create(g), { sc, sim, timeouts: 0, yaw: sc.shots && sc.shotPlan ? shotLook(sc.heroTo, sc.mates) : 0 });
  let frames = 1;
  for (const rCap of TRIES) {
    const [s0, st, opts] = ghost.planArgs(false, rCap ? { rCap } : {}); let r = { done: false, it: null };
    do { r = planSteps(s0, st, opts, PER - 1, r.it); frames++; } while (!r.done);
    const p = r.plan; if (!p) break;
    const t = ghost.threatFit(p); if (!t || t.seen || !p.threat || p.rP >= (rCap || 9)) break;
  }
  return frames;
}
// The scenes a match is made of: a lesson's ten (pickRounds), the first-time ones, and some more of the seeds a match's fresh scenes come from.
const scenes = () => PATH.filter(sk => generates(sk.id)).flatMap(sk => [...Array.from({ length: 10 }, (_, i) => generate(sk.id, 101 + i)), ...Array.from({ length: 10 }, (_, i) => generate(sk.id, 1 + i)), ...Array.from({ length: 12 }, (_, i) => generate(sk.id, 1000 + i * 7919))]).filter(Boolean);

test('every scene a match can use plans within the limit; the few that do not are left out', async () => {
  const { g } = H.makeGame(); g.mode = 'free';
  const pool = scenes(), cost = new Map(pool.map(sc => [sc, framesOf(g, sc)]));
  const kept = typeof g.vetRounds === 'function' ? await H.drive(g, g.vetRounds(pool), { maxSec: 6000 }) : pool;
  const over = kept.filter(sc => cost.get(sc) > LIMIT);
  assert.deepEqual(over.map(sc => `${sc.id}: ${cost.get(sc)} frames`), [], `a match could use a scene that leaves the picture still for more than ${LIMIT} frames`);
  const left = pool.filter(sc => !kept.includes(sc));
  assert.ok(left.length <= 8, `${left.length} scenes left out: ${left.map(sc => sc.id)}`);
  for (const sc of left) assert.ok(cost.get(sc) > LIMIT, `${sc.id} is left out but plans in ${cost.get(sc)} frames`);
});

test('a match never plays a scene that is left out', async () => {
  const { g } = H.makeGame(); g.mode = 'free';
  const slow = scenes().filter(sc => framesOf(g, sc) > LIMIT)[0];
  assert.ok(slow, 'no scene over the limit at this size in the sample');
  const seen = new Set();
  const ids = ['look-up', 'pass-to-open'], mine = [slow, ...pickRounds(ids, 6)];
  await H.drive(g, g.match(ids, mine, 4, 'free'), { maxSec: 3000, onFrame: gm => { if (gm.sc) seen.add(gm.sc.id); }, pick: gm => gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:fwd') }).catch(e => console.log('ERR', e.message));
  assert.ok(g.matchRounds?.length >= 4, 'the match has its list of scenes');
  assert.ok(!g.matchRounds.includes(slow), `${slow.id} is in the match's list`);
  assert.ok(!seen.has(slow.id), `${slow.id} was played`);
});
