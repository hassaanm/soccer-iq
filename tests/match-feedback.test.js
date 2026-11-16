// What a choice in a match shows and says (game/live.js react): stars by grade, the lesson's cue after a miss (once
// per idea, three at most, never over other words), and the idea missed most, which comes back the next day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, drive } from './harness.js';
import { PATH, BUILDS } from '../js/skills.js';
import { defaultProgress, finishSession, focus, trainingPlan, trained } from '../js/progress.js';

async function playMatch(pick, busy = false) {
  const { g, events } = makeGame(), said = [], decisions = [];
  const hud = g.hud; g.hud = new Proxy({}, { get: (_, k) => (k === 'busy' ? () => busy : hud[k]) });
  g.say = t => { said.push([events.length, t]); return null; };
  g.skills = new Set(PATH.map(s => s.id));
  await drive(g, g.match(['look-up', 'pass-to-open', 'get-goal-side'], [], 3, 'free'), { maxSec: 900, pick: gm => {
    const o = pick(gm); decisions.push({ at: events.length, rating: gm.rating(o), best: gm.sc.best }); return o;
  } });
  return { g, events, said, decisions };
}
const worst = gm => (gm.sc.kind === 'defense' || gm.sc.kind === 'support' || gm.sc.kind === 'lead' ? gm.sc.spots.map(s => 'spot:' + s.id)
  : gm.sc.kind === 'receive' ? ['turn:L', 'turn:R'] : gm.sc.kind === 'tackle' ? ['tackle:early'] : ['pass:0', 'pass:1', 'drib:back', 'drib:fwd']).find(o => gm.rating(o) === 'bad') || gm.sc.best || 'drib:back';

test('match: stars pop by grade the moment he chooses (3 best, 2 only keeps it, none for a miss)', async () => {
  let k = 0;
  const { events, decisions } = await playMatch(gm => (k++ % 2 ? worst(gm) : gm.sc.best || 'drib:back'));
  let checked = 0;
  for (const [i, d] of decisions.entries()) {
    const pops = events.slice(d.at, decisions[i + 1]?.at ?? events.length).filter(e => e[0] === 'pop');
    const want = !d.best || d.rating === 'bad' ? 0 : d.rating === 'safe' ? 2 : 3;
    assert.equal(pops.length, want ? 1 : 0); if (want) { assert.equal(pops[0][1], want); checked++; }
  }
  assert.ok(checked >= 2, `only ${checked} rated choices`);
});

test('match: a miss says the cue once per idea, three at most, and never while other words show', async () => {
  const { g, said, decisions } = await playMatch(worst);
  const misses = decisions.filter(d => d.best && d.rating === 'bad').length;
  assert.ok(misses >= 2, `only ${misses} misses`);
  assert.ok(said.length >= 1 && said.length <= Math.min(3, misses), `${said.length} cues for ${misses} misses`);
  assert.equal(new Set(said.map(s => s[1])).size, said.length);
  assert.ok(g.mostMissed() && g.missed[g.mostMissed()].n === Math.max(...Object.values(g.missed).map(m => m.n)));
  const quiet = await playMatch(worst, true);
  assert.equal(quiet.said.length, 0);
});

test('the idea missed most in a match comes back in the next day\'s training, until it is practised', () => {
  const p = defaultProgress();
  for (const s of PATH) { finishSession(p, s.id, 6, 6, 100); finishSession(p, s.id, 6, 6, 101); finishSession(p, s.id, 6, 6, 102); }
  focus(p, 'steal-it', 200);
  for (let i = 0; i < 20; i++) assert.ok(trainingPlan(p, PATH, { day: 201, builds: BUILDS }).includes('steal-it'));
  trained(p, 'steal-it', [true, true], { day: 200, builds: BUILDS });
  assert.equal(p.focus?.id, 'steal-it'); // practised the same day: still tomorrow's
  trained(p, 'steal-it', [true, true], { day: 201, builds: BUILDS });
  assert.equal(p.focus, null);
});
