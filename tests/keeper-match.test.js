// (v67) "Play the keeper": inside a 5v5 match, some of their shots are his, with the keeper game's taps and rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setSize } from '../js/geom.js';
import { KEEPER_PLAY, keeperGive, SOMETIMES, saveOf, spotsFor, matchShot, gradeOf, KEEPER_IDEA } from '../js/saves.js';
import { defaultProgress, load, logChoice } from '../js/progress.js';
import { seeded } from '../js/game/keeper.js';

setSize('5v5');
const { PATH } = await import('../js/skills.js');
const { makeGame, frameDt, optionsFor } = await import('./harness.js');
const { Goalie } = await import('../js/game/goalie.js');

test('the setting: off (the default), sometimes, always, kept in the save with the other settings', () => {
  assert.deepEqual(KEEPER_PLAY, ['off', 'sometimes', 'always']);
  assert.equal(defaultProgress().settings.keeperPlay, 'off');
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  for (const v of KEEPER_PLAY) { storage.setItem('soccer-iq:v1', JSON.stringify({ v: 1, settings: { keeperPlay: v } })); assert.equal(load(storage).settings.keeperPlay, v); }
  storage.setItem('soccer-iq:v1', JSON.stringify({ v: 1, settings: { rounds: 6 } })); assert.equal(load(storage).settings.keeperPlay, 'off', 'an older save: off');
  for (let i = 0; i < 50; i++) { const u = i / 50; assert.equal(keeperGive('off', false, u), false); assert.equal(keeperGive('always', true, u), true); assert.equal(keeperGive('sometimes', true, u), false); }
});

test('"Sometimes": about one of their shots in three over many seeded matches, never two in a row', () => {
  let given = 0, shots = 0;
  for (let m = 0; m < 300; m++) {
    let last = false;
    for (let k = 1; k <= 8; k++) { // (a match's shots at our goal, from seeded places as the game asks)
      const x = 3 + seeded(m, k, 1) * 6, y = 8 + seeded(m, k, 2) * 10, give = keeperGive('sometimes', last, seeded(x, y, m * .37 + k, k, 17));
      assert.ok(!(give && last), 'never two in a row'); last = give; given += give; shots++;
    }
  }
  const rate = given / shots; assert.ok(rate > .28 && rate < .39, `about a third: ${rate.toFixed(3)}`);
  assert.ok(Math.abs(SOMETIMES / (1 + SOMETIMES) - 1 / 3) < 1e-9);
});

// A 5v5 match, with the keeper's moments played by the keeper game itself (its own stub world and HUD).
async function playMatch(mode, { seed = 3, taps = 'right', toWin = 2, maxSec = 1500 } = {}) {
  const real = Math.random; let x = seed * 7717; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const { g, events } = makeGame(), hud = new Proxy({}, { get: (_, k) => (...a) => events.push(['k:' + k, ...a]) });
  const goalie = new Goalie({ world: { project: () => [400, 200], swapRigs() {} }, hud }), moments = [], logs = [];
  g.skills = new Set(PATH.map(s => s.id)); g.keeperPlay = () => mode; g.onChoice = r => logs.push(r);
  g.keeperMoment = (spec, id) => { const p = goalie.inMatch(g, spec, id); p.then(r => moments.push({ r, keeperId: g.sim.keeper('us').id, carrier: g.sim.ball.carrier, state: g.sim.ball.state })); return p; };
  let shots = 0; const concede = g.concede; g.concede = function* (sh) { shots++; yield* concede.call(this, sh); };
  try {
    let done = false, score; g.match(PATH.map(s => s.id), [], toWin, 'free').then(v => { done = true; score = v; });
    for (let t = 0, k = 0; t < maxSec && !done; k++) {
      const dt = frameDt(k); t += dt;
      if (goalie.on) {
        goalie.tick(dt);
        const sp = goalie.spec, right = spotsFor(sp).find(p => p.right);
        if (taps !== 'none' && goalie.phase === 'stand' && goalie.pickSpot == null && goalie.sim.time - goalie.win.t0 > goalie.win.T * .3) goalie.choose('spot:' + right.id);
        if (taps !== 'none' && goalie.phase === 'dive' && goalie.pickZone == null && goalie.sim.time - goalie.win.t0 > goalie.win.T * .3) goalie.choose('zone:' + (taps === 'right' ? sp.zone : sp.zone.endsWith('L') ? 'R' : 'L'));
      } else {
        g.tick(dt, t);
        if (g.canAct && g._choose) { g.seen.add('m1'); g.seen.add('m2'); g.seen.add('m3'); g.choose(g.sc.spots ? 'spot:' + g.sc.spots[g.sc.spots.length - 1].id : optionsFor(g.sc).find(o => !o.startsWith('shoot') && g.rating(o) === 'bad') || g.sc.best || 'drib:fwd'); } // (wrong choices, so they win the ball, get through and shoot)
      }
      await new Promise(r => setImmediate(r));
    }
    assert.ok(done, 'the match finished');
    return { g, score, moments, shots, logs, events };
  } finally { Math.random = real; }
}

test('"Always": every shot of theirs is his; the result follows the keeper game\'s rule; a save gives us the ball', async () => {
  const { g, score, moments, shots, logs } = await playMatch('always', { taps: 'right' });
  assert.ok(shots > 0, 'they had shots'); assert.equal(moments.length, shots, 'every one was his');
  for (const { r, keeperId } of moments) {
    assert.equal(keeperId, 'k1', 'the ids are back after his moment');
    const sp = spotsFor(r.spec).find(p => p.right);
    assert.equal(r.res, saveOf(r.spec, sp, r.spec.zone).res, 'the same rule as the mini game');
    assert.equal(r.res, 'save', 'the right spot and the right target: saved');
  }
  for (const m of moments.filter(m => m.r.held)) { assert.equal(m.carrier, 'k1', 'held: our keeper has it'); assert.equal(m.state, 'held'); }
  assert.equal(g.keeperSaves(), moments.length, 'his saves, counted for the result line');
  assert.equal(score.them, 0, 'every one saved: they never scored');
  assert.equal(logs.filter(l => l.id === KEEPER_IDEA).length, moments.length, 'each moment in the decision log, under its own idea');
  assert.ok(logs.filter(l => l.id === KEEPER_IDEA).every(l => l.grade === 'best'));
});

test('no taps: he stays set and reacts late (only a ball at him is stopped); "Off": our keeper as before', async () => {
  const { moments, score } = await playMatch('always', { taps: 'none', seed: 5 });
  assert.ok(moments.length > 0);
  for (const { r } of moments) { assert.equal(r.spot, null); assert.equal(r.tap, null); if (r.res === 'save') assert.equal(r.act, 'stay'); assert.equal(gradeOf(r), 'timeout'); }
  assert.ok(score.them > 0, 'without his taps they score');
  const off = await playMatch('off', { seed: 3 });
  assert.equal(off.moments.length, 0); assert.equal(off.g.keeperSaves(), 0);
});

test('a keeper moment from where their shooter is: the right spot is between the ball and the goal, never past the ball', () => {
  for (let i = 0; i < 200; i++) {
    const from = { x: 4.2 + seeded(i, 1) * 8, u: (seeded(i, 2) - .5) * 9 }, sh = matchShot(from, from, seeded(i, 3)), R = spotsFor(sh).find(p => p.right);
    assert.ok(R.x < from.x * .5 && R.x > 0, 'between'); assert.ok(sh.foot === 'in' ? !sh.zone.startsWith('T') : true);
  }
  const p = defaultProgress(); logChoice(p, { id: KEEPER_IDEA, mode: 'free', grade: 'okay', sec: 1.2, looked: null }, 100);
  assert.deepEqual(p.log.days[100][KEEPER_IDEA].r.free, [0, 1, 0]);
});
