// The shot's two choices in the decision log, in a match's misses, and with the light result; our keeper in matches (v62).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setSize } from '../js/geom.js';
import { PATH } from '../js/skills.js';
import { generate } from '../js/generate.js';
import { defaultProgress, logChoice, logTotals } from '../js/progress.js';
import { makeGame, drive } from './harness.js';

setSize('5v5');
const scene = (pattern, seed = 1) => { for (let s = seed; s < seed + 40; s++) { const sc = generate('shoot-space', s, { pattern }); if (sc) return sc; } };
// Plays one round of a lesson scene, picking `opt` on the first try (then the right answer), and returns what was logged.
async function round(sc, opt, light = false) {
  const { g, events } = makeGame(), recs = []; g.onChoice = r => recs.push(r); g.choiceLog = 'lesson';
  let n = 0; await drive(g, g.round(sc, { hint: false, light }), { pick: gm => (n++ ? gm.sc.best : opt), maxSec: 200 });
  return { recs, events, g };
}

test('each part of a shot goes in the log under its own lesson, with how long it took', async () => {
  const sc = scene('aim-open'), sp = sc.best.split(':')[1], other = sp === 'L' ? 'R' : 'L';
  let { recs } = await round(sc, `shoot:${sp}:las`); // the right space, laces from close: only okay (v72)
  assert.deepEqual(recs.map(r => [r.id, r.grade]), [['shoot-space', 'best'], ['inside-laces', 'okay']]);
  assert.ok(recs.every(r => r.sec >= 0 && r.mode === 'lesson'));
  ({ recs } = await round(sc, `shoot:${other}:in`));  // the wrong space, the right foot
  assert.deepEqual(recs.map(r => [r.id, r.grade]), [['shoot-space', 'miss'], ['inside-laces', 'best']]);
  const p = defaultProgress(); for (const r of recs) logChoice(p, r, 500);
  const t = logTotals(p); assert.equal(t['shoot-space'].miss, 1); assert.equal(t['inside-laces'].best, 1);
});

test('"Inside or laces?" scenes log the foot once, under their own lesson', async () => {
  const sc = generate('inside-laces', 1, { pattern: 'foot-close' }), { recs } = await round(sc, 'shoot:*:las');
  assert.deepEqual(recs.map(r => [r.id, r.grade]), [['inside-laces', 'okay']], 'laces from close: only okay (v72)');
  const edge = generate('inside-laces', 2, { pattern: 'foot-edge' }), { recs: r2 } = await round(edge, 'shoot:*:in');
  assert.deepEqual(r2.map(r => [r.id, r.grade]), [['inside-laces', 'miss']], 'the inside from the edge: wrong');
});

test('a missed space or foot in a match counts for its lesson and its name is said once', () => {
  const { g } = makeGame(), sc = scene('aim-open'), sp = sc.best.split(':')[1], other = sp === 'L' ? 'R' : 'L';
  g.mode = 'free'; g.load(sc); g.skills = new Set(PATH.map(s => s.id));
  assert.equal(g.missIdea(`shoot:${other}:in`), 'shoot-space');
  assert.equal(g.missIdea(`shoot:${sp}:las`), null, 'laces from close: only okay, not a miss (v72)');
  const edge = generate('inside-laces', 2, { pattern: 'foot-edge' }); g.load(edge); assert.equal(g.missIdea('shoot:*:in'), 'inside-laces', 'the inside from the edge'); g.load(sc);
  assert.equal(g.missIdea(sc.best), null);
  assert.equal(g.cueFor('inside-laces'), 'Inside or laces?'); assert.equal(g.cueFor('shoot-space'), 'Shoot to the space!');
});

test('the light result works for a shot of three taps', async () => {
  const sc = scene('aim-open'), { events } = await round(sc, sc.best, true);
  const card = events.filter(e => e[0] === 'banner');
  assert.ok(card.length && card.every(e => !e[3]), 'the big words, no card');
  assert.ok(events.some(e => e[0] === 'pop' && e[1] === 3), 'stars over his player');
});

test('in matches our keeper stops some of their shots, then rolls it out to a friend: our ball', async () => {
  const real = Math.random; let saves = 0, after = 0;
  try {
    for (let seed = 1; seed <= 30 && !(saves && after); seed++) {
      let x = seed * 7717; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id)); let was = null;
      await drive(g, g.match(PATH.map(s => s.id), [], 3, 'free'), { pick: gm => gm.sc.spots ? 'spot:' + gm.sc.spots[gm.sc.spots.length - 1].id : gm.sc.best || 'drib:fwd', maxSec: 2000,
        onFrame: gm => { if (gm.result === 'keeperSave' && was !== 'keeperSave') saves++; if (was === 'keeperSave' && gm.result !== 'keeperSave' && gm.sim.a(gm.sim.ball.carrier)?.team === 'us') after++; was = gm.result; } });
    }
  } finally { Math.random = real; }
  assert.ok(saves > 0, 'our keeper made a save'); assert.ok(after > 0, 'and our team had the ball after it');
});
