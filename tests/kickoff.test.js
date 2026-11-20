// (v76 SL) A match's first scene starts moving at once after Kick off: its scenes are vetted and its first scene planned
// while the match card is up (game/live.js prepareMatch, called by js/flows.js before the card). Without it that work
// was done after Kick off on a still picture: about 1 s on average, up to 2.5 s (8 s in the worst scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './harness.js';
import { PATH } from '../js/skills.js';

// Frames (60 a second) from match() to the first scene's play moving; `card`: seconds the card is up after prepareMatch.
async function toMotion(seed, card) {
  const real = Math.random; let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  try {
    const { g } = makeGame(); g.skills = new Set(PATH.map(k => k.id)); const ids = PATH.map(k => k.id), extra = [];
    if (card != null) { g.prepareMatch(ids, extra, null, 'free'); for (let k = 0; k < card * 60; k++) { g.tick(1 / 60, k / 60); await new Promise(r => setImmediate(r)); } }
    g.match(ids, extra, 5, 'free'); let t0 = null;
    for (let f = 0; f < 60 * 20; f++) { g.tick(1 / 60, 100 + f / 60); if (g.sc && t0 == null) t0 = g.sim.time; if (t0 != null && g.sim.time > t0 + .05) return f; await new Promise(r => setImmediate(r)); }
    return Infinity;
  } finally { Math.random = real; }
}

test('a match prepared while its card is up starts moving within a few frames of Kick off', async () => {
  for (const seed of [1, 2, 4, 7]) { const f = await toMotion(seed, 4); assert.ok(f <= 8, `seed ${seed}: ${f} frames of still picture after Kick off`); }
});
