// (v82) How a match brings in a new situation. The owner (v81): "Whenever you make a decision and all of a sudden it fades
// out and there's a new scenario, it's really confusing what happened." Only a goal (and the start) may cut to the next
// scene; anywhere else a piece of play on screen brings it in (game/live.js bridgeTo), in 2 to 4 seconds, and only after
// STALL seconds of play without a goal (or when he wins the ball before "Won it? Go!").
import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeOf, TEAM } from '../js/geom.js';
import { cutMatches, cutText } from '../scripts/live-audit.js';

const size = TEAM.size || (sizeOf().keeper ? '5v5' : '3v3');

test('a new situation never starts with a cut, except after a goal (Matches, play going on for a while)', async () => {
  const { cuts, bridges } = await cutMatches(size, 3, 'free', 15); // (15 s without a goal: more new situations to see)
  assert.deepEqual(cuts.map(cutText), []);
  assert.ok(bridges.length >= 2, `only ${bridges.length} new situation(s) were brought in from play`);
  for (const b of bridges) assert.ok(b.sec >= 1.8 && b.sec <= 4.2, `${b.why}: it took ${b.sec?.toFixed(2)} s`);
});

test('a mini match before "Won it? Go!": winning the ball brings in the next situation, with no cut', async () => {
  const { cuts, bridges } = await cutMatches(size, 4, 'mini');
  assert.deepEqual(cuts.map(cutText), []);
  assert.ok(bridges.some(b => /won it/.test(b.why)), 'no ball won before "Won it? Go!" brought in a new situation');
  for (const b of bridges) assert.ok(b.sec >= 1.8 && b.sec <= 4.2, `${b.why}: it took ${b.sec?.toFixed(2)} s`);
});

test('play goes on 60 s without a goal before the game brings in a new situation', async () => {
  const { STALL } = await import('../js/game/live.js');
  assert.equal(STALL, 60);
  const { cuts, bridges } = await cutMatches(size, 2, 'free');
  assert.deepEqual(cuts.map(cutText), []);
  for (const b of bridges.filter(b => /without a goal/.test(b.why))) assert.ok(b.since >= STALL - .1, `brought in ${b.since.toFixed(1)} s after the situation began`);
});
