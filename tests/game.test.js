// Headless run of the game flow with a stub renderer: demo, rounds (right and wrong), and the mini match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { allScenarios } from '../js/skills.js';
import { TEAMS } from '../js/teams.js';
import { OPTIONS } from './harness.js';

function makeGame() {
  const events = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {} });
  g.setTeams(TEAMS[3], TEAMS[13]);
  return { g, events };
}
// Runs frames until the promise settles; pick(g) is called whenever a choice is possible.
async function drive(g, promise, pick, maxSec = 120) {
  let done = false, value; promise.then(v => { done = true; value = v; });
  for (let t = 0; t < maxSec && !done; t += 1 / 30) {
    g.tick(1 / 30, t);
    if (g.canAct && g._choose) { const o = pick(g); if (o) { g.seen.add('m1'); g.seen.add('m2'); g.choose(o); } }
    await null;
  }
  assert.ok(done, 'flow did not finish');
  return value;
}

test('demo plays to the end and scores', async () => {
  const { g, events } = makeGame();
  await drive(g, g.demo('look-up'), () => null);
  assert.ok(events.some(e => e[0] === 'banner' && (e[1] === 'GOAL!' || e[1] === 'Kept the ball!')));
});

test('a right first choice counts as first try', async () => {
  const { g } = makeGame();
  const sc = allScenarios('look-up')[0];
  const r = await drive(g, g.round(sc, { hint: false }), gm => gm.sc.best);
  assert.equal(r.firstTry, true); assert.equal(r.stars, 3);
});

test('a wrong choice shows feedback, replays, then accepts the retry', async () => {
  const { g, events } = makeGame();
  let tries = 0;
  const r = await drive(g, g.round(allScenarios('look-up').find(s => s.id === 'lu-space'), { hint: false }), gm => (tries++ ? gm.sc.best : 'pass:0'));
  assert.equal(r.firstTry, false);
  assert.ok(events.some(e => e[0] === 'banner' && e[1] === 'Stolen!'));
  assert.ok(events.some(e => e[0] === 'caption' && /Nobody was open/.test(e[1])));
});

test('every scenario plays out for every option without getting stuck', async () => {
  for (const sc of allScenarios('look-up')) {
    for (const opt of OPTIONS) {
      const { g } = makeGame(); let first = true;
      await drive(g, g.round(sc, { hint: false }), gm => { const o = first ? opt : gm.sc.best; first = false; return o; });
    }
  }
});

test('mini match ends at 2 goals', async () => {
  const { g } = makeGame(); let i = 0;
  const s = await drive(g, g.match(['look-up']), gm => (i++ % 2 ? 'drib:back' : gm.sc.best), 300);
  assert.ok(s.us === 2 || s.them === 2);
});

test('skipping the demo ends it right away', async () => {
  const { g } = makeGame();
  const p = g.demo('look-up');
  for (let i = 0; i < 45; i++) g.tick(1 / 30, i / 30); // 1.5 s in
  g.skipDemo();
  let done = false; p.then(() => { done = true; });
  for (let i = 0; i < 3 && !done; i++) { g.tick(1 / 30, 2); for (let k = 0; k < 50; k++) await null; }
  assert.ok(done, 'demo should finish within a few frames of Skip');
  assert.equal(g.skipping, false);
});

test('a match flows on after kept-the-ball and still ends', async () => {
  const { g } = makeGame();
  let live = 0, decisions = 0;
  const pick = gm => { decisions++; if (gm.sc.live) live++; const opts = gm.sc.kind === 'defense' ? gm.sc.spots.map(s => 'spot:' + s.id) : ['pass:0', 'pass:1', 'drib:fwd']; return gm.sc.best || opts[0]; };
  const s = await drive(g, g.match(['look-up', 'one-goes', 'pass-to-open'], [], 3, 'free'), pick, 900);
  assert.ok(s.us === 3 || s.them === 3 || decisions > 25, `match did not finish (${JSON.stringify(s)})`);
  assert.ok(live > 0, 'play never continued from a live position');
});
