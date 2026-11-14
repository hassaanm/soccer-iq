// The skill moment (game/skill.js): in the real game his player's skill moves wait for a tap on the SKILL button,
// play slows down meanwhile, and none of it may change how a play ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { Sim } from '../js/sim.js';
import { TEAMS } from '../js/teams.js';
import { MOVE_NAME, MOVE_W } from '../js/flair.js';
import { allScenarios } from '../js/skills.js';
import { optionsFor } from './harness.js';

// A game as the real one runs (skillTaps), with a stub renderer; `tap` decides, every frame of an offer, whether to tap.
function makeGame(tap = () => false) {
  const events = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {}, skillTaps: true });
  g.setTeams(TEAMS[3], TEAMS[13]);
  const watch = g.skillWatch;
  g.skillWatch = function (dt) { watch.call(this, dt); if (this.sk?.phase === 'offer' && tap(this)) this.skillTap(); };
  return { g, events };
}
async function frames(g, promise, n = 3600) {
  let done = false; promise.then(() => { done = true; });
  for (let i = 0; i < n && !done; i++) { g.tick(1 / 60, i / 60); await null; }
  assert.ok(done, 'flow did not finish');
}
// One lesson play as a child plays it: the run-up, a moment to choose, then his choice.
async function play(sc, opt, tap) {
  const { g, events } = makeGame(tap), log = [];
  const offer = g.skillOffer; g.skillOffer = function (kind, k, n) { log.push({ kind, k, phase: this.phase }); return offer.call(this, kind, k, n); };
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre());
  for (let i = 0; i < 60; i++) g.tick(1 / 60, 0);
  await frames(g, g.outcome(opt, g.isGood(opt)));
  const s = g.sim, end = [...s.agents.values()].map(a => [a.id, a.x.toFixed(6), a.y.toFixed(6)].join(' ')).join('|');
  return { result: g.result, banners: events.filter(e => e[0] === 'banner').map(e => e[1]), end, offers: log, moved: events.some(e => e[0] === 'skillName'), names: events.filter(e => e[0] === 'skillName').length, g };
}

test('every move has a name a child sees', () => {
  for (const k of Object.keys(MOVE_W)) assert.ok(MOVE_NAME[k], k);
});

test('a tap or none: the play ends the same, with everyone in the same place; one offer at most, never while he decides', async () => {
  let offers = 0, turns = 0, runs = 0;
  for (const sc of allScenarios('take-him-on').slice(0, 6)) for (const opt of optionsFor(sc)) {
    const none = await play(sc, opt, () => false), tapped = await play(sc, opt, g => { if (g.clock - g.sk.t0 > .3) { g.skillTap(); return true; } return false; }); // (two taps: the second does nothing)
    assert.equal(tapped.result, none.result, `${sc.id} ${opt}`);
    assert.deepEqual(tapped.banners, none.banners, `${sc.id} ${opt}`);
    assert.equal(tapped.end, none.end, `${sc.id} ${opt}: everyone ends in the same place`);
    assert.ok(none.offers.length <= 1 && none.offers.every(o => o.phase === 'outcome'), `${sc.id} ${opt}`);
    assert.equal(tapped.moved, tapped.offers.length > 0, 'a tap in time makes the move');
    assert.ok(tapped.names <= 1, 'one name, however many taps');
    assert.ok(!none.moved, 'no tap: no move');
    offers += none.offers.length; turns += none.offers.filter(o => o.kind === 'turn').length; runs += none.offers.filter(o => o.kind === 'run').length;
  }
  assert.ok(turns > 3 && runs > 0, `offers came (turns ${turns}, runs ${runs})`);
});

test('a tap after the window, or a second tap, does nothing', async () => {
  const sc = allScenarios('take-him-on')[1];
  // two taps at once: one move, one name
  const twice = await play(sc, 'drib:fl', g => { if (g.clock - g.sk.t0 > .3) { g.skillTap(); return true; } return false; });
  assert.ok(twice.moved);
  // taps just after it closed: nothing
  const { g, events: ev } = makeGame(() => false), watch = g.skillWatch;
  g.skillWatch = function (dt) { const was = this.sk?.phase; watch.call(this, dt); if (was === 'offer' && this.sk?.phase !== 'offer') { this.skillTap(); this.skillTap(); } };
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre()); for (let i = 0; i < 60; i++) g.tick(1 / 60, 0);
  await frames(g, g.outcome('drib:fl', g.isGood('drib:fl')));
  assert.ok(ev.some(e => e[0] === 'skill' && e[1]), 'it was offered');
  assert.ok(!ev.some(e => e[0] === 'skillName'), 'a late tap makes no move');
  g.skillTap(); // and long after, with nothing on offer
  assert.equal(g.sk, null);
});

test('asking ahead for a skill turn changes nothing in the sim', () => {
  const s = new Sim(); s.setup({ hero: [10, 10], mates: [], opps: [[12.5, 10.2]] });
  s.taps = new Set(['hero']); s.flair = { ctx: 't', own: false, by: { hero: { p: 1, can: ['double', 'chop', 'roll'], fav: [], tier: 't' } } };
  for (let i = 0; i < 20; i++) s.step(1 / 60);
  s.go('hero', 13, 13, 4.4); s.a('hero').openS = 1;
  const before = JSON.stringify([...s.agents.values()]) + JSON.stringify(s.ball);
  s.turnAhead('hero');
  assert.equal(JSON.stringify([...s.agents.values()]) + JSON.stringify(s.ball), before);
  assert.equal(s.take('hero'), null, 'no offer, nothing to take');
});
