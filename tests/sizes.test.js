// Team sizes (v62): the table, and the game at four a side. Each test file runs in its own process, so this one plays
// at 4v4 throughout (the others at 3v3; `SOCCER_SIZE=4v4 npm test` runs them all at 4v4 as well).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, setSize, sizeOf, PITCH, L, W } from '../js/geom.js';
import { TEAMS } from '../js/teams.js';
import { load, defaultProgress } from '../js/progress.js';

setSize('4v4');
const { PATH, allScenarios } = await import('../js/skills.js');
const { generate, grade, patternsOf } = await import('../js/generate.js');
const { optionsFor, playOption, judge, makeGame, drive } = await import('./harness.js');

test('the size table: 3v3 and 4v4 offered, 5v5 kept for later as four outfield players and a keeper, each with its own pitch', () => {
  assert.deepEqual(Object.keys(SIZES).filter(k => SIZES[k].offer), ['3v3', '4v4']);
  assert.equal(SIZES['5v5'].out, 4); assert.equal(SIZES['5v5'].keeper, true);
  assert.deepEqual(SIZES['3v3'].pitch, { L: 30, W: 20, gy0: 8, gy1: 12, gh: 1.6 }); // as it always was
  for (const s of Object.values(SIZES)) assert.equal(s.pitch.gy1 - s.pitch.gy0 >= 4, true);
  assert.equal(sizeOf().out, 4); assert.equal(PITCH.L, 32); assert.equal(L, 32); assert.equal(W, 22); // (the live pitch follows setSize)
});

test('every team has a fourth player and a goalkeeper; old saves play 3v3', () => {
  for (const t of TEAMS) {
    assert.equal(t.players.length, 5, t.id);
    assert.ok(t.players.slice(0, 4).every(p => !p.gk && p.name && p.num && p.skin && p.hair), t.id);
    assert.equal(t.players[4].gk, true, t.id);
  }
  assert.equal(defaultProgress().settings.size, '3v3');
  const old = { getItem: () => JSON.stringify({ v: 1, settings: { rounds: 6 } }) };
  assert.equal(load(old).settings.size, '3v3');
});

test('at 4v4 every lesson makes every pattern with four a side, a right answer and a cue', () => {
  for (const sk of PATH) {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const sc = generate(sk.id, seed); assert.ok(sc, `${sk.id} ${seed}`);
      seen.add(sc.pattern);
      assert.equal(sc.opps.length, 4, sc.id); assert.equal(sc.oppsTo.length, 4, sc.id); assert.equal(sc.mates.length, 3, sc.id);
      if (sc.matesTo) assert.equal(sc.matesTo.length, 3, sc.id);
      assert.ok(optionsFor(sc).includes(sc.best) && sc.cue, sc.id);
    }
    assert.deepEqual([...seen].sort(), patternsOf(sk.id).sort(), sk.id);
  }
});

test('at 4v4 the fourth friend is a real pass: marked, he loses it; and any of the three friends can be the open one', () => {
  const best = new Set();
  for (const sk of ['pass-to-open', 'look-up', 'see-the-trap', 'forward-first']) for (let seed = 1; seed <= 40; seed++) {
    const sc = generate(sk, seed); if (sc.kind) continue;
    const g = grade(sc);
    assert.ok(['good', 'bad'].includes(g['pass:2']), `${sc.id}: pass:2 is ${g['pass:2']}`);
    if (sc.best.startsWith('pass:')) best.add(sc.best);
    for (const k of ['pass:0', 'pass:1', 'pass:2']) if (g[k] === 'bad') assert.ok(sc.best !== k && !(sc.ok || []).includes(k), `${sc.id}: a lost pass is right`);
  }
  assert.deepEqual([...best].sort(), ['pass:0', 'pass:1', 'pass:2']);
});

test('at 4v4 every option of every lesson scenario plays out as graded (a sample; npm run audit plays them all)', async () => {
  for (const sk of PATH) for (const sc of allScenarios(sk.id).slice(0, 2)) for (const opt of optionsFor(sc)) {
    const broken = judge(await playOption(sc, opt));
    assert.deepEqual(broken, [], `${sc.id} ${opt}: ${broken.join('; ')}`);
  }
});

test('a 4v4 match: eight players, the team AI spreads them out, and it finishes', async () => {
  const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id));
  let close = 0, frames = 0;
  const score = await drive(g, g.match(PATH.map(s => s.id), [], 2, 'free'), {
    pick: gm => gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:fwd'), maxSec: 1500,
    onFrame: gm => {
      const s = gm.sim; frames++; assert.equal(s.agents.size, 8);
      // Two of our free attackers on the same spot would be the shape breaking down.
      const us = s.team('us').filter(a => a.id !== s.ball.carrier && !gm.scripted.has(a.id));
      if (gm.ai && us.some((a, i) => us.some((b, j) => j > i && Math.hypot(a.tx - b.tx, a.ty - b.ty) < 1))) close++;
    },
  });
  assert.ok(score.us >= 2 || score.them >= 2, JSON.stringify(score));
  assert.ok(close < frames * .02, `${close} of ${frames} frames with two friends sent to the same place`);
});
