// Headless run of the game flow with a stub renderer: demo, rounds (right and wrong), and the mini match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { allScenarios } from '../js/skills.js';
import { TEAMS } from '../js/teams.js';
import { OPTIONS } from './harness.js';

const ALL = new Set(['look-up', 'dribble-to-space', 'take-him-on', 'shoot-close', 'get-goal-side', 'steal-it', 'won-it-go', 'peek-and-turn', 'see-the-trap', 'get-open', 'pass-to-open', 'lead-pass', 'give-and-go', 'one-goes', 'mark-the-free-one', 'forward-first']);
function makeGame(skills = ALL) {
  const events = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {} });
  g.setTeams(TEAMS[3], TEAMS[13]); g.skills = new Set(skills);
  return { g, events };
}
// Runs frames until the promise settles; pick(g) is called whenever a choice is possible.
async function drive(g, promise, pick, maxSec = 120, each = null) {
  let done = false, value; promise.then(v => { done = true; value = v; });
  for (let t = 0; t < maxSec && !done; t += 1 / 30) {
    each?.(g);
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
  const sc = allScenarios('look-up').find(s => s.pattern === 'none-open');
  const r = await drive(g, g.round(sc, { hint: false }), gm => (tries++ ? gm.sc.best : 'pass:0'));
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
  const s = await drive(g, g.match(['look-up']), gm => (i++, gm.sc.best || (gm.sc.kind === 'defense' ? 'spot:' + gm.sc.spots[0].id : 'drib:back')), 300);
  assert.equal(s.us, 2, `always choosing the best play should win (${JSON.stringify(s)}, ${i} choices)`);
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

// Matches shuffle with Math.random; a fixed sequence makes these runs repeatable.
function seeded(seed) { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647; }
test('after losing the ball in a match he gets to defend from right there', async () => {
  const real = Math.random; Math.random = seeded(7);
  const { g, events } = makeGame();
  let liveDef = 0, decisions = 0;
  const pick = gm => {
    decisions++;
    if (gm.sc.kind === 'defense') { if (gm.sc.live) liveDef++; return gm.sc.best; }
    const all = ['pass:0', 'pass:1', 'drib:fwd', 'drib:fl', 'drib:fr', 'drib:left', 'drib:right'];
    return all.find(o => gm.rating(o) === 'bad') || gm.sc.best || 'drib:fwd';
  };
  try { await drive(g, g.match(['look-up', 'pass-to-open'], [], 5, 'free'), pick, 2500); } finally { Math.random = real; }
  assert.ok(liveDef > 0, 'never got a defending choice after losing the ball');
  assert.ok(events.some(e => e[0] === 'banner' && (e[1] === 'Stopped him!' || e[1] === 'Stole it!')), 'defending never stopped them');
});

test('give-and-go: the pass, then the run, both count', async () => {
  const { g, events } = makeGame();
  const sc = allScenarios('give-and-go')[0];
  const r = await drive(g, g.round(sc, { hint: false }), gm => gm.sc.best);
  assert.equal(r.firstTry, true); assert.equal(r.stars, 3);
  assert.equal(g.sc.kind, 'support', 'the second choice is where to run');
  assert.ok(events.some(e => e[0] === 'banner' && (e[1] === 'GOAL!' || e[1] === 'Kept the ball!')));
});

test('give-and-go: a wrong run is retried on its own, without redoing the pass', async () => {
  const { g } = makeGame();
  const sc = allScenarios('give-and-go')[0]; let passes = 0, runs = 0;
  const r = await drive(g, g.round(sc, { hint: false }), gm => {
    if (gm.sc.kind !== 'support') { passes++; return gm.sc.best; }
    return runs++ ? gm.sc.best : 'spot:stay';
  });
  assert.equal(r.firstTry, false); assert.equal(passes, 1); assert.equal(runs, 2);
});

// The real STEAL button grades the moment he taps it.
test('steal it: tapping when the ball rolls away wins it; tapping early lets him past', async () => {
  for (const mode of ['good', 'early']) {
    const { g, events } = makeGame();
    const sc = allScenarios('steal-it')[0]; let tries = 0;
    const p = g.round(sc, { hint: true });
    let done = false, value; p.then(v => { done = true; value = v; });
    for (let t = 0; t < 120 && !done; t += 1 / 30) {
      g.tick(1 / 30, t);
      if (g.canAct && g._choose && g.sc.kind === 'tackle') {
        const st = g.tackleState();
        if (tries === 0 && (mode === 'early' ? true : st === 'good')) { tries++; g.stealTap(); }
        else if (tries > 0 && st === 'good') { tries++; g.stealTap(); }
      }
      await null;
    }
    assert.ok(done, 'round did not finish');
    assert.equal(value.firstTry, mode === 'good', `${mode}: firstTry ${value.firstTry}`);
    assert.ok(events.some(e => e[0] === 'banner' && e[1] === 'Stole it!'));
    if (mode === 'early') assert.ok(events.some(e => e[0] === 'banner' && e[1] === 'They scored'));
  }
});

test('won it? go!: he takes the ball off their player before deciding', async () => {
  const { g } = makeGame();
  const sc = allScenarios('won-it-go')[0];
  g.mode = 'lesson'; g.load(sc);
  const p = g.pre(); let done = false; p.then(() => { done = true; });
  for (let t = 0; t < 10 && !done; t += 1 / 30) { g.tick(1 / 30, t); await null; }
  assert.equal(g.sim.ball.carrier, 'hero');
  assert.ok(g.sim.a('o1').x < g.sim.a('hero').x, 'the player he beat ends up behind him');
});

test('steal it: a tap a moment after the ball was loose still counts (reaction time)', async () => {
  const { g, events } = makeGame();
  const sc = allScenarios('steal-it')[0];
  const p = g.round(sc, { hint: false });
  let done = false, value, closedAt = null, tapped = false; p.then(v => { done = true; value = v; });
  let wasGood = false;
  for (let t = 0; t < 120 && !done; t += 1 / 30) {
    g.tick(1 / 30, t);
    if (!tapped && g.canAct && g._choose && g.sc.kind === 'tackle') {
      const good = g.tackleState() === 'good';
      if (wasGood && !good && closedAt == null) closedAt = t;
      if (closedAt != null && t - closedAt >= .2) { tapped = true; g.stealTap(); }
      wasGood = good;
    } else if (tapped && g.canAct && g._choose) g.choose(g.sc.best);
    await null;
  }
  assert.ok(done); assert.equal(value.firstTry, true);
  assert.ok(events.some(e => e[0] === 'banner' && e[1] === 'Stole it!'));
});

test('free play with every lesson (1v1s and give-and-gos included) runs to the end', async () => {
  const { PATH } = await import('../js/skills.js');
  const { generate } = await import('../js/generate.js');
  const ids = PATH.map(s => s.id), extra = ids.flatMap((id, i) => [generate(id, 500 + i), generate(id, 900 + i)]).filter(Boolean);
  const { g } = makeGame(); let decisions = 0; const kinds = new Set();
  const s = await drive(g, g.match(ids, extra, 3, 'free'), gm => { decisions++; kinds.add(gm.sc.kind); return gm.sc.best || (gm.sc.kind === 'defense' ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); }, 1500);
  assert.ok(s.us === 3 || s.them === 3 || decisions > 60, `match did not finish (${JSON.stringify(s)})`);
  assert.ok(decisions > 3);
});

test('give-and-go: anything but the pass in step 1 is a miss, never a skip to step 2', async () => {
  const { g } = makeGame();
  const sc = allScenarios('give-and-go')[0]; let first = true, step2 = 0;
  const r = await drive(g, g.round(sc, { hint: false }), gm => {
    if (gm.sc.kind === 'support') { step2++; return gm.sc.best; }
    const o = first ? 'drib:back' : gm.sc.best; first = false; return o;
  });
  assert.equal(r.firstTry, false); assert.equal(step2, 1);
});

test('every lesson demo plays to the end and shows how the play ended', async () => {
  const { PATH } = await import('../js/skills.js');
  for (const sk of PATH) {
    const { g, events } = makeGame();
    await drive(g, g.demo(sk.id), () => null, 60);
    const ends = events.filter(e => e[0] === 'banner').map(e => e[1]);
    assert.ok(ends.some(b => ['GOAL!', 'Kept the ball!', 'Stole it!', 'Stopped him!'].includes(b)), `${sk.id} demo ended with ${ends.join(',') || 'nothing'}`);
    assert.equal(g.mode, 'between', `${sk.id}: Skip still showing after the demo`);
  }
});

test('peek, then turn: the pass waits in the air while he decides; turning away keeps it, into the defender loses it', async () => {
  const sc = allScenarios('peek-and-turn').find(s => s.pattern === 'peek-turn');
  const { g, events } = makeGame();
  g.mode = 'lesson'; g.load(sc);
  let done = false; g.pre().then(() => { done = true; });
  for (let t = 0; t < 5 && !done; t += 1 / 30) { g.tick(1 / 30, t); await null; }
  assert.equal(g.sim.ball.state, 'flying', 'the pass is on its way at the freeze');
  const p = g.decide(); const at = { ...g.sim.ball };
  for (let i = 0; i < 30; i++) g.tick(1 / 30, 9 + i / 30);
  assert.ok(Math.hypot(g.sim.ball.x - at.x, g.sim.ball.y - at.y) < .01, 'the ball waits while he decides');
  g.yaw += 2; for (let i = 0; i < 3; i++) g.tick(1 / 30, 10 + i / 30);
  assert.ok(g.peeked, 'looking over his shoulder counts as a peek');
  const wrong = sc.best === 'turn:L' ? 'turn:R' : 'turn:L';
  assert.equal(g.rating(sc.best), 'best'); assert.equal(g.rating(wrong), 'bad');
  g.choose(sc.best); await p;
  const r = await drive(g, g.round(sc, { hint: false }), gm => gm.sc.best);
  assert.equal(r.firstTry, true);
  assert.ok(events.some(e => e[0] === 'banner' && (e[1] === 'GOAL!' || e[1] === 'Kept the ball!')));
});

test('matches grow with his skills: with every lesson passed, live runs, peeks and 1v1s all happen', async () => {
  const real = Math.random, kinds = {}, need = ['live-support', 'live-receive', 'live-tackle', 'live-defense'];
  try {
    for (let seed = 1; seed <= 16 && !need.every(k => kinds[k]); seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g } = makeGame();
      await drive(g, g.match([...ALL], [], 4, 'free'), gm => {
        const k = (gm.sc.live ? 'live-' : '') + gm.sc.kind; kinds[k] = (kinds[k] || 0) + 1;
        if (gm.sc.kind === 'receive') for (const t of gm.turnArcs()) assert.ok(Math.abs(t.a1 - t.a0) > 1, `live turn arrow ${t.id} is a stub`);
        if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
        // Sometimes the wrong choice, so the other team gets the ball and he has to defend.
        return Math.random() < .3 ? (gm.sc.spots ? 'spot:' + gm.sc.spots.at(-1).id : 'pass:1') : gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back');
      }, 4000);
    }
  } finally { Math.random = real; }
  for (const k of need) assert.ok(kinds[k] > 0, `never got a ${k} choice (${JSON.stringify(kinds)})`);
});

test('before any lesson is passed, matches have no live runs, peeks, 1v1s or defending choices', async () => {
  const real = Math.random; let x = 5; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const kinds = {};
  try {
    const { g } = makeGame([]);
    await drive(g, g.match(['look-up'], [], 3, 'free'), gm => { const k = (gm.sc.live ? 'live-' : '') + gm.sc.kind; kinds[k] = (kinds[k] || 0) + 1; return gm.sc.best || 'drib:back'; }, 2500);
  } finally { Math.random = real; }
  for (const k of ['live-support', 'live-receive', 'live-tackle', 'live-defense']) assert.ok(!kinds[k], `${k} showed up without its lesson (${JSON.stringify(kinds)})`);
});

test('won it? go!: their player dribbles right up to him and the ball never jumps', async () => {
  const { generate } = await import('../js/generate.js');
  for (let seed = 1; seed <= 30; seed++) {
    const sc = generate('won-it-go', seed * 7919), { g } = makeGame();
    g.mode = 'lesson'; g.load(sc);
    let prev = null, worst = 0, closest = 9, done = false; g.pre().then(() => { done = true; });
    for (let t = 0; t < 8 && !done; t += 1 / 30) {
      g.tick(1 / 30, t); await null;
      const b = g.sim.ball; if (prev) worst = Math.max(worst, Math.hypot(b.x - prev.x, b.y - prev.y)); prev = { x: b.x, y: b.y };
      closest = Math.min(closest, Math.hypot(g.sim.a('hero').x - g.sim.a('o1').x, g.sim.a('hero').y - g.sim.a('o1').y));
    }
    assert.ok(done && g.sim.ball.carrier === 'hero', `${sc.id}: he doesn't have the ball`);
    assert.ok(worst < .4, `${sc.id}: the ball jumped ${worst.toFixed(2)} m in one frame`);
    assert.ok(closest < 1.4, `${sc.id}: their player never got near him (${closest.toFixed(2)} m)`);
  }
});

test('demos wait for a sentence to finish before moving on', async () => {
  const { g } = makeGame(); let release = null;
  g.say = () => new Promise(res => { release = res; });
  let done = false; g.talk('Short.', 0).then(() => { done = true; });
  for (let t = 0; t < 10; t += 1 / 30) { g.tick(1 / 30, t); await null; }
  assert.equal(done, false, 'moved on while the line was still being said');
  release(); for (let i = 0; i < 10; i++) { g.tick(1 / 30, 11 + i / 30); await new Promise(r => setImmediate(r)); }
  assert.equal(done, true);
});

test('peek, then turn: two curved turn arrows show from the start and stay put while he peeks', async () => {
  const sc = allScenarios('peek-and-turn').find(s => s.pattern === 'peek-turn');
  const { g } = makeGame(); g.mode = 'lesson'; g.load(sc);
  let done = false; g.pre().then(() => { done = true; });
  for (let t = 0; t < 5 && !done; t += 1 / 30) { g.tick(1 / 30, t); await null; }
  g.decide(); g.tick(1 / 30, 6);
  const before = JSON.stringify(g.ui.turnArrows);
  assert.equal(g.ui.turnArrows.length, 2);
  assert.deepEqual([...new Set(g.targets().map(t => t.opt))].sort(), ['turn:L', 'turn:R']);
  g.lookStart(400, 800); g.lookMove(400 - 600); g.tick(1 / 30, 6.1);
  assert.ok(g.peeked); assert.equal(JSON.stringify(g.ui.turnArrows), before, 'arrows moved while he peeked');
  // Each arrow sweeps through his own shoulder: left counterclockwise from facing the ball, right clockwise.
  const [L, R] = ['L', 'R'].map(id => g.ui.turnArrows.find(t => t.id === id));
  assert.ok(L.a1 > L.a0 && R.a1 < R.a0);
});

test('after a wrong turn and the replay, the retry still faces the incoming pass (not up the field)', async () => {
  const sc = allScenarios('peek-and-turn').find(s => s.pattern === 'peek-turn');
  const { g } = makeGame(); let tries = 0, yaws = [];
  const wrong = sc.best === 'turn:L' ? 'turn:R' : 'turn:L';
  await drive(g, g.round(sc, { hint: false }), gm => { yaws.push(gm.yaw); return tries++ ? gm.sc.best : wrong; });
  assert.equal(yaws.length, 2);
  assert.ok(Math.abs(Math.atan2(Math.sin(yaws[1] - yaws[0]), Math.cos(yaws[1] - yaws[0]))) < .05, `facing changed from ${yaws[0].toFixed(2)} to ${yaws[1].toFixed(2)}`);
});

test('every lesson demo shows the taps with the hand: LOOK UP first, then the play\'s button or target', async () => {
  const { PATH } = await import('../js/skills.js');
  for (const sk of PATH) {
    const { g, events } = makeGame();
    await drive(g, g.demo(sk.id), () => null, 60);
    const hands = events.filter(e => e[0] === 'hand' && e[1]);
    const taps = new Set(hands.map(e => e[2]).filter(Boolean));
    assert.ok(hands.length && taps.size, `${sk.id}: the hand never tapped`);
    const btns = hands.map(e => e[1]).filter(p => typeof p === 'string');
    if (!['steal-it', 'peek-and-turn'].includes(sk.id)) assert.equal(btns[0], 'lookBtn', `${sk.id}: first tap should be LOOK UP`);
    if (sk.id === 'steal-it') assert.ok(btns.includes('stealBtn'));
    assert.equal(g.showing, false); assert.equal(g.handAt, null);
  }
});

test('"Watch this way!" replays show the taps, and he can\'t tap while the hand plays', async () => {
  const { g, events } = makeGame();
  const sc = allScenarios('look-up').find(s => s.best.startsWith('pass:'));
  let wrong = true;
  const bad = gm => ['drib:fwd', 'drib:fl', 'drib:fr', 'drib:left', 'drib:right', 'pass:0', 'pass:1'].find(o => gm.rating(o) === 'bad');
  await drive(g, g.round(sc, { hint: false }), gm => { assert.ok(!gm.showing); if (wrong) { wrong = false; return bad(gm); } return gm.sc.best; });
  const btns = events.filter(e => e[0] === 'hand' && typeof e[1] === 'string').map(e => e[1]);
  assert.ok(btns.includes('passBtn'), 'the replay should tap PASS');
});

test('after the hand taps Small touches or Big push, those buttons go away when the play starts', async () => {
  const { g, events } = makeGame();
  await drive(g, g.demo('dribble-to-space'), () => null, 60);
  const states = events.filter(e => e[0] === 'state');
  assert.ok(states.some(e => e[1].touchPick), 'the demo should show the Small/Big choice');
  assert.ok(states.filter(e => e[1].phase === 'outcome').every(e => !e[1].touchPick));
});

test('peek and turn: the arrows go around his body, even if he looked away before the pass', async () => {
  const { generate } = await import('../js/generate.js');
  for (let seed = 1; seed <= 12; seed++) {
    const sc = generate('peek-and-turn', seed), { g } = makeGame();
    const p = g.round(sc, { hint: false });
    let checked = false;
    await drive(g, p, gm => {
      if (!checked) {
        const h = gm.sim.a('hero'), c = gm.sim.a(gm.sc.carrier), face = Math.atan2(c.y - h.y, c.x - h.x);
        assert.ok(Math.abs(Math.atan2(Math.sin(gm.yaw0 - face), Math.cos(gm.yaw0 - face))) < .01, 'arrows not centered on him facing the passer');
        for (const t of gm.turnArcs()) assert.ok(Math.abs(t.a1 - t.a0) > 1, `arrow ${t.id} is a stub`);
        checked = true;
      }
      return gm.sc.best;
    }, 60, g2 => { if (g2.phase === 'pre') g2.yaw = 1.2; }); // he looks away while the pass comes
    assert.ok(checked);
  }
});

test('pass in front!: the play freezes mid-run; in front he takes it in stride, to his feet it lands behind him', async () => {
  const { generate } = await import('../js/generate.js');
  for (let seed = 1; seed <= 8; seed++) for (const opt of ['spot:lead', 'spot:feet']) {
    const sc = generate('lead-pass', seed), { g, events } = makeGame();
    g.mode = 'lesson'; g.load(sc); await drive(g, g.pre(), () => null);
    const p = g.decide(), m = g.sim.a('m1'), at = { x: m.x, y: m.y };
    for (let i = 0; i < 20; i++) g.tick(1 / 30, 50 + i / 30);
    assert.ok(Math.hypot(m.x - at.x, m.y - at.y) < .01, `${sc.id}: the runner moved while he decides`);
    assert.equal(g.rating('spot:lead'), 'best'); assert.equal(g.rating('spot:feet'), sc.pattern === 'lead-free' ? 'safe' : 'bad'); assert.equal(g.rating('spot:far'), 'bad');
    g.choose(opt); await p;
    const [dx, dy] = sc.dir, b = g.sim.ball; let took = null, behind = null;
    await drive(g, g.outcome(opt, g.isGood(opt)), () => null, 20, gm => {
      if (took === null && b.carrier === 'm1') took = m.speed;
      if (behind === null && b.state === 'loose' && opt === 'spot:feet') behind = (b.x - m.x) * dx + (b.y - m.y) * dy;
    });
    if (opt === 'spot:lead') assert.ok(took >= 5, `${sc.id}: he slowed down to take it (${took} m/s)`); // full run, then on to goal at 5.2
    else assert.ok(behind < -1.5, `${sc.id}: the ball was not behind him (${behind})`);
    const ends = events.filter(e => e[0] === 'banner').map(e => e[1]);
    assert.ok(opt === 'spot:lead' ? ends.some(e => e === 'GOAL!' || e === 'Kept the ball!') : ends.includes(sc.pattern === 'lead-free' ? 'Kept the ball!' : 'Stolen!'), `${sc.id} ${opt}: ${ends}`);
  }
});
