// The skill moment (game/skill.js): in the real game his player's skill moves wait for a tap on the SKILL button,
// play slows down meanwhile, and none of it may change how a play ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { Sim } from '../js/sim.js';
import { TEAMS } from '../js/teams.js';
import { MOVE_NAME, MOVE_W } from '../js/flair.js';
import { allScenarios } from '../js/skills.js';
import { optionsFor, pictureU } from './harness.js';
// Opens the choice and lets play go on (nothing tapped) until it is at the scene's own picture.
const toPicture = g => { g.decide(); const w = g.win; if (!w) return; const u = pictureU(w); for (let i = 0; i < 6000 && g.win && (g.win.u ?? 0) < u; i++) g.tick(1 / 60, 0); };

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
  const offer = g.skillOffer; g.skillOffer = function (kind, k, n) { const s = this.sim, h = s.a('hero'), b = s.ball; // (round 6: and the picture at the offer, for the direction test)
    log.push({ kind, k, phase: this.phase, good: this.playGood, fake: h.offer?.fake, h: b.h, at: [h.x, h.y], to: [h.tx, h.ty], opps: s.team('them').filter(o => !o.gk).map(o => [o.x, o.y]) }); return offer.call(this, kind, k, n); };
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre());
  toPicture(g); // (v66: he chooses in the window, when play is at the scene's own picture: the defender has come as near as the scene has him)
  await frames(g, g.outcome(opt, g.isGood(opt)));
  const s = g.sim, end = [...s.agents.values()].map(a => [a.id, a.x.toFixed(6), a.y.toFixed(6)].join(' ')).join('|');
  return { result: g.result, banners: events.filter(e => e[0] === 'banner').map(e => e[1]), end, offers: log, moved: events.some(e => e[0] === 'skillName'), names: events.filter(e => e[0] === 'skillName').length, g };
}

test('every move has a name a child sees', () => {
  for (const k of Object.keys(MOVE_W)) assert.ok(MOVE_NAME[k], k);
});

test('a tap or none: the play ends the same, with everyone in the same place; one offer at most, never while he decides', async () => {
  let offers = 0, turns = 0, runs = 0, late = 0;
  for (const sc of [...allScenarios('take-him-on').slice(0, 6), ...allScenarios('dribble-to-space').slice(0, 4)]) for (const opt of optionsFor(sc)) { // (v66: both dribbling lessons: the defender comes running now, so a chance to run at him is rarer)
    const none = await play(sc, opt, () => false), tapped = await play(sc, opt, g => { if (g.clock - g.sk.t0 > .3) { g.skillTap(); return true; } return false; }); // (two taps: the second does nothing)
    assert.equal(tapped.result, none.result, `${sc.id} ${opt}`);
    assert.deepEqual(tapped.banners, none.banners, `${sc.id} ${opt}`);
    assert.equal(tapped.end, none.end, `${sc.id} ${opt}: everyone ends in the same place`);
    assert.ok(none.offers.length <= 1 && none.offers.every(o => o.phase === 'outcome'), `${sc.id} ${opt}`);
    if (tapped.moved || !tapped.offers.length) assert.equal(tapped.moved, tapped.offers.length > 0, 'a move only with an offer'); else late++; // (an offer that closes before his tap, 0.3 s in: no move; counted)
    assert.ok(tapped.names <= 1, 'one name, however many taps');
    assert.ok(!none.moved, 'no tap: no move');
    offers += none.offers.length; turns += none.offers.filter(o => o.kind === 'turn').length; runs += none.offers.filter(o => o.kind === 'run').length;
  }
  assert.ok(turns + runs > 0 && runs > 0, `offers came (turns ${turns}, runs ${runs})`);
  assert.ok(late <= Math.max(1, offers / 2), `a tap 0.3 s into an offer mostly makes the move (${late} of ${offers} closed first)`); // (v64: play goes on into the choice, so a turn from a standstill is rare now)
});

test('a tap after the window, or a second tap, does nothing', async () => {
  // (v64: the first play with an offer, as which ones have one changes with how play goes on into the choice)
  let sc = null, opt = null;
  for (const s of [...allScenarios('take-him-on'), ...allScenarios('dribble-to-space')]) { for (const o of optionsFor(s).filter(o => /^(drib|push):/.test(o))) if ((await play(s, o, () => false)).offers.length) { sc = s; opt = o; break; } if (sc) break; }
  assert.ok(sc, 'some play offers a skill move');
  // two taps at once: one move, one name
  const twice = await play(sc, opt, g => { if (g.clock - g.sk.t0 > .3) { g.skillTap(); return true; } return false; });
  assert.ok(twice.moved);
  // taps just after it closed: nothing
  const { g, events: ev } = makeGame(() => false), watch = g.skillWatch;
  g.skillWatch = function (dt) { const was = this.sk?.phase; watch.call(this, dt); if (was === 'offer' && this.sk?.phase !== 'offer') { this.skillTap(); this.skillTap(); } };
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre()); toPicture(g);
  await frames(g, g.outcome(opt, g.isGood(opt)));
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

// (round 6) A move that makes sense. A fake or a stepover goes toward the side he will not take: at the defender in his
// way (or, when his run bends, away from the bend), and he goes by on the other side. A turn is offered only when he
// really changes direction. And no move is offered in a play that is going wrong (a dribble into their players).
test('a skill move fits the play: the fake goes at the defender and away from where he goes; a turn only with a real change of direction', async () => {
  let runs = 0, turns = 0;
  for (const sk of ['take-him-on', 'dribble-to-space', 'look-up']) for (const sc of allScenarios(sk)) for (const opt of optionsFor(sc).filter(o => /^(drib|push):/.test(o))) {
    const r = await play(sc, opt, () => false);
    for (const o of r.offers) {
      assert.notEqual(o.good, false, `${sc.id} ${opt}: a move offered in a play that is going wrong`);
      const ch = Math.cos(o.h), sh = Math.sin(o.h), rel = ([x, y]) => [(x - o.at[0]) * ch + (y - o.at[1]) * sh, (y - o.at[1]) * ch - (x - o.at[0]) * sh];
      const tb = Math.atan2(o.to[1] - o.at[1], o.to[0] - o.at[0]) - o.h, bend = Math.atan2(Math.sin(tb), Math.cos(tb));
      if (o.kind === 'turn') { turns++; assert.ok(Math.abs(bend) >= .3, `${sc.id} ${opt}: a ${o.k} offered for a change of direction of only ${(bend * 57.3).toFixed(0)}°`); continue; }
      runs++; assert.ok(o.fake === 1 || o.fake === -1, `${sc.id} ${opt}: the fake has a side`);
      // the nearest of theirs ahead of him and in his way (2.8 m on: where the move starts)
      const inWay = o.opps.map(rel).filter(([f, l]) => f - 2.8 > 1.6 && f - 2.8 < 6 && Math.abs(l) < 2.5).sort((p, q) => p[0] - q[0])[0];
      if (Math.abs(bend) > .2) assert.equal(o.fake, -Math.sign(bend), `${sc.id} ${opt}: his run bends ${bend > 0 ? 'left' : 'right'}, and the fake goes the same way`);
      else if (inWay && Math.abs(inWay[1]) > .35) assert.equal(o.fake, Math.sign(inWay[1]), `${sc.id} ${opt}: the defender in his way is on his ${inWay[1] > 0 ? 'left' : 'right'}, and the fake goes to the open side`);
    }
  }
  assert.ok(runs > 3 && turns > 10, `offers came (run-at ${runs}, turns ${turns})`);
});
