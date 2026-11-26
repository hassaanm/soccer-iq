// The mini games (v87): two lives end a run, the score and the best are kept, the difficulty only rises and in small
// steps, the keeper game is endless and varied, and penalties (v93): the keeper never moves first, early taps are read,
// played out on the real game classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVES, STEP, newRun, attempt } from '../js/mini/rules.js';
import { MINI, miniById } from '../js/mini/games.js';
import { penLevel, penKick, readChance, keeperGoes, kickOf, target, TARGETS, sideU, PEN_X, PEN_WHY } from '../js/mini/pens.js';
import { keeperLevel, endlessShot, tellOf, zoneAt, spotsFor, START } from '../js/saves.js';
import { CLOSE, stream } from '../js/shot.js';
import { miniDone, miniBest, oldKeeperBest, defaultProgress, load } from '../js/progress.js';
import { Goalie } from '../js/game/goalie.js';
import { Penalty } from '../js/mini/penalty.js';

const LEVELS = Array.from({ length: 121 }, (_, i) => i * STEP); // 0 to 40 levels, a success at a time

test('a run: a success scores and adds a third of a level; a miss costs a life; the second miss ends it', () => {
  assert.equal(LIVES, 2);
  const r = newRun();
  attempt(r, true); attempt(r, true); assert.deepEqual([r.score, r.lives, r.over], [2, 2, false]); assert.ok(Math.abs(r.level - 2 / 3) < 1e-9);
  attempt(r, false); assert.deepEqual([r.score, r.lives, r.over], [2, 1, false]);
  attempt(r, true); attempt(r, false); assert.deepEqual([r.score, r.lives, r.over], [3, 0, true]);
  attempt(r, true); assert.equal(r.score, 3, 'nothing counts after the end');
});

test('the best score per game: kept, a new best only when beaten, across a reload; the old keeper best shows once', () => {
  const p = defaultProgress(); p.keeper = { best: 6, plays: 4, last: 3, day: 1, stickers: 1 };
  let d = miniDone(p, 'pens', 0, { day: 5, now: 1 }); assert.deepEqual([d.best, d.first], [false, true]); assert.equal(miniBest(p, 'pens'), 0);
  d = miniDone(p, 'pens', 4, { day: 5, now: 2 }); assert.equal(d.best, true); assert.equal(miniBest(p, 'pens'), 4);
  d = miniDone(p, 'pens', 4, { day: 6, now: 3 }); assert.equal(d.best, false, 'equal is not a new best');
  d = miniDone(p, 'pens', 2, { day: 6, now: 4 }); assert.equal(d.best, false); assert.equal(miniBest(p, 'pens'), 4);
  assert.deepEqual(p.mini.pens, { best: 4, plays: 4, last: 2, day: 6, at: 2 });
  d = miniDone(p, 'keeper', 7, { now: 5, sticker: { at: 6, emoji: '🧤', skill: 'keeper' } }); assert.deepEqual([d.best, d.sticker], [true, true]);
  assert.equal(p.keeper.stickers, 2); assert.deepEqual(p.stickers.at(-1), { emoji: '🧤', skill: 'keeper', at: 5 });
  assert.equal(miniDone(p, 'keeper', 5, { sticker: { at: 6, emoji: '🧤', skill: 'keeper' } }).sticker, false);
  assert.equal(oldKeeperBest(p), 6, 'the old best (saves of 8) once'); assert.equal(oldKeeperBest(p), null); assert.equal(p.keeper.best, 6, 'and it stays in the save');
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  storage.setItem('soccer-iq:v1', JSON.stringify(p)); assert.deepEqual(load(storage).mini, p.mini);
  assert.equal(miniBest(defaultProgress(), 'keeper'), 0, 'a save from before the mini games: no best yet');
});

test('the Mini games list: every game has a name, a spoken name, a picture and its own id', () => {
  assert.deepEqual(MINI.map(g => g.id), ['keeper', 'pens', 'rondoKeep', 'rondoWin', 'attack', 'puzzles', 'whoOpen', 'dash']); // the eight tiles in their order (v88 six; v96 whoOpen, dash)
  assert.equal(new Set(MINI.map(g => g.id)).size, MINI.length);
  for (const g of MINI) { assert.ok(g.name && g.say && g.unit && /^<svg/.test(g.pic)); assert.equal(miniById(g.id), g); }
});

// Each number, level by level: it never goes the easy way, and a success moves it only a little.
function smooth(of, keys) {
  for (const [k, dir, max] of keys) for (let i = 1; i < LEVELS.length; i++) {
    const a = of(LEVELS[i - 1])[k], b = of(LEVELS[i])[k];
    assert.ok(dir < 0 ? b <= a + 1e-12 : b >= a - 1e-12, `${k} goes the hard way only (level ${LEVELS[i].toFixed(2)})`);
    assert.ok(Math.abs(b - a) <= max + 1e-12, `${k} moves at most ${max} a success (level ${LEVELS[i].toFixed(2)}: ${a} to ${b})`);
  }
}
// (v93, D1) A real challenge from the first try, rising fast and without a wall.
test('the keeper game gets harder with every save, a little at a time; quick and with feints from the first shot', () => {
  smooth(keeperLevel, [['stand', -1, .16], ['dive', -1, .15], ['flash', -1, .05], ['tell', -1, 1], ['fake', 1, .04], ['fakeAt', 1, .02], ['far', 1, .02], ['top', 1, .03], ['speed', 1, .01]]);
  const e = keeperLevel(0); assert.ok(e.stand <= 2 && e.dive <= 1.3 && e.fake >= .3, 'the first shot: short windows, and he may look one way first');
  const five = keeperLevel(5 * STEP); assert.ok(five.tell === 1 && five.flash < .8 && five.fake > .5, 'five saves in: his eyes for a moment only, feints most of the time');
  const hard = keeperLevel(40); assert.ok(hard.stand < 1 && hard.dive < .6, 'it keeps getting harder');
});
test('penalties get harder with every goal, a little at a time; the first kick already needs the timing', () => {
  smooth(penLevel, [['run', -1, .09], ['late', -1, .04], ['read', 1, .14], ['lateRead', 1, .1], ['stay', 1, .01], ['low', 1, .09], ['high', 1, .12], ['lowR', 1, .03], ['highR', 1, .05], ['feint', 1, .09]]);
  const e = penLevel(0); assert.ok(e.late >= .6 && e.read > .3 && e.read < .4 && e.lateRead === 0 && e.feint === 0, 'the first kick: a clear last moment; an early tap is read now and then');
  assert.ok(e.easy && penLevel(STEP).easy && e.hold === 3 && !penLevel(2 * STEP).easy && penLevel(2 * STEP).hold === 0, 'the first two kicks are forgiving; the timing starts at two goals');
  const five = penLevel(5 * STEP); assert.ok(five.read > .7 && five.lateRead > .2 && five.low > .8 && five.feint > .2, 'five goals in: he reads early taps, sometimes even late ones, and feints');
  assert.ok(penLevel(40).late < .32 && penLevel(40).read > .95, 'it keeps getting harder');
});

test('the endless keeper game: honest tells at every level (a feint looks the other way first), the foot by the distance, the level\'s windows', () => {
  const r = stream(.42);
  for (const L of LEVELS) for (let j = 0; j < 4; j++) {
    const sh = endlessShot(L, r, j), t = tellOf(sh), Z = zoneAt(sh.zone), D = keeperLevel(L);
    assert.equal(t.col, Z.col); assert.equal(t.top, Z.top); assert.equal(t.level, D.tell); assert.equal(t.flash, D.flash);
    assert.equal(sh.foot, Math.hypot(sh.from.x, sh.from.u) <= CLOSE ? 'in' : 'las');
    assert.deepEqual([sh.stand, sh.dive], [D.stand, D.dive]);
    if (sh.kind !== 'pen') assert.equal(spotsFor(sh).filter(p => p.right).length, 1);
    if (sh.fake) { assert.notEqual(zoneAt(sh.fake).col, Z.col, 'a feint looks at the other side first'); assert.ok(sh.foot === 'las' || !zoneAt(sh.fake).top); assert.equal(sh.fakeAt, D.fakeAt); }
  }
});
test('the keeper game varies from the first shot: kinds, sides, heights; never the same corner twice, nor one side three times', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = stream(seed / 61), hist = [], shots = [];
    for (let i = 0; i < 12; i++) { const sh = endlessShot(i * STEP, r, i, hist); hist.push({ k: sh.k, zone: sh.zone }); shots.push(sh); }
    const six = shots.slice(0, 6);
    assert.ok(new Set(six.map(s => s.k)).size >= 3, `seed ${seed}: three kinds of shot in the first six (${six.map(s => s.k)})`);
    assert.ok(six.some(s => zoneAt(s.zone).col === 'L') && six.some(s => zoneAt(s.zone).col === 'R'), `seed ${seed}: both sides in the first six`);
    for (let i = 1; i < shots.length; i++) { assert.notEqual(shots[i].zone, shots[i - 1].zone); assert.notEqual(shots[i].k, shots[i - 1].k); }
    for (let i = 2; i < shots.length; i++) { const c = [0, 1, 2].map(d => zoneAt(shots[i - d].zone).col); assert.ok(!(c[0] === c[1] && c[1] === c[2]), `seed ${seed}: one side three times`); }
  }
});

test('penalties: early taps are read more often the earlier they are and the higher the level; a last-moment tap is a guess', () => {
  const rate = (L, when, shown) => { const r = stream(.37); let n = 0; for (let j = 0; j < 4000; j++) n += keeperGoes(penKick(L, r, j), 'TL', when, shown).read; return n / 4000; };
  assert.ok(rate(0, 'early', 2) < .06 && rate(STEP, 'early', 2) < .06, 'the first two kicks: an early tap is hardly ever read');
  assert.ok(Math.abs(rate(2 * STEP, 'early', 2) - .56) < .04, 'from two goals: more than half of early taps are read');
  assert.ok(rate(2 * STEP, 'early', .8) < rate(2 * STEP, 'early', 2), 'a tap just before the last moment is read less often');
  assert.equal(rate(0, 'late', .3), 0, 'the first kicks: a last-moment tap is never read'); assert.equal(rate(2 * STEP, 'late', .3), 0);
  assert.ok(rate(1, 'early', 2) > .55 && rate(5 / 3, 'early', 2) > .7, 'from three goals on, most early taps are read');
  assert.ok(rate(5 / 3, 'late', .3) > .15 && rate(5 / 3, 'late', .3) < .35, 'later he reads some last-moment taps too');
  // his guess: half each way, a few in the middle; it does not depend on where the shot goes
  const r = stream(.71), seen = { L: 0, R: 0, M: 0 }; for (let j = 0; j < 4000; j++) { const k = penKick(0, r, j); seen[keeperGoes(k, j % 2 ? 'L' : 'R', 'late', .3).dive]++; }
  assert.ok(Math.abs(seen.L - seen.R) < 250 && seen.M > 250 && seen.M < 550, JSON.stringify(seen));
  for (const L of LEVELS) assert.ok(readChance(penKick(L, stream(.1)), 'early', 5) >= readChance(penKick(L, stream(.1)), 'late', 0));
});

test('penalties: the corners are the answer; the middle and no tap are saved; a top corner rushed hits the post', () => {
  const r = stream(.5);
  for (let j = 0; j < 400; j++) {
    const k = penKick(j / 30, r, j);
    for (const id of TARGETS) for (const [when, shown] of [['early', 1.8], ['late', .4]]) {
      const x = kickOf(k, id, when, shown), T = target(id);
      if (T.col === 'M') { assert.equal(x.res, 'save'); assert.equal(x.why, 'middle'); continue; }
      if (x.dive !== T.col) assert.equal(x.res, 'goal', `${id}: he went the other way (${x.dive})`);
      else assert.ok(x.res === 'save' ? x.why === (x.read ? 'read' : 'guess') : x.close, `${id}: he went that way`);
    }
    assert.deepEqual([kickOf(k, null).res, kickOf(k, null).why], ['save', 'none']);
    assert.equal(kickOf(k, 'TL', 'late', .05).res, 'post'); assert.notEqual(kickOf(k, 'L', 'late', .05).res, 'post', 'a low one is never rushed');
  }
  for (const w of ['read', 'guess', 'middle', 'none', 'rush']) assert.ok(PEN_WHY[w], w);
});

// ---------- played out on the real classes (a stub world, a HUD that writes down what it is asked) ----------
const stub = () => { const events = []; return { world: { project: () => [400, 200], fx: ev => events.push(['fx', ev]) }, hud: new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) }), events }; };
async function drive(g, done, pick, max = 900) {
  let t = 0; while (!done() && t < max) { g.tick(1 / 30); t += 1 / 30; pick(g); await new Promise(r => setImmediate(r)); }
  assert.ok(done(), 'the run ended'); return t;
}

test('the keeper game, played: shots keep coming until the second goal; the score is his saves', async () => {
  const { world, hud } = stub(), g = new Goalie({ world, hud }), run = newRun(), r = stream(.33), seen = [];
  let done = false; const SAVES = 5;
  g.endless(i => (run.over ? null : endlessShot(run.level, r, i)), { onShot: x => { seen.push(x); attempt(run, x.res === 'save'); } }).then(() => { done = true; });
  await drive(g, () => done, g => { // the first five: the right spot and the right target; then no taps (in, unless it is at him)
    const n = g.spec?.n ?? 0, f = g.win ? (g.sim.time - g.win.t0) / g.win.T : 0; if (f < .3) return;
    if (n < SAVES && g.phase === 'stand' && g.pickSpot == null && g.spots.length) g.choose('spot:' + g.spots.find(p => p.right).id);
    if (n < SAVES && g.phase === 'dive' && g.pickZone == null) g.choose('zone:' + g.spec.zone);
  }, 3000);
  assert.ok(seen.slice(0, SAVES).every(x => x.res === 'save'));
  assert.equal(seen.filter(x => x.res === 'goal').length, 2, 'two goals end it'); assert.equal(seen.at(-1).res, 'goal');
  assert.equal(run.score, seen.filter(x => x.res === 'save').length); assert.ok(run.score >= SAVES);
  assert.ok(seen[SAVES - 1].spec.level > seen[0].spec.level, 'harder after each save');
  assert.equal(g.onResult, null, 'nothing left hooked on the keeper game (its turns in matches are as before)');
});

test('penalties, the first two kicks: he holds at the plant, the ball glowing, until a tap (or 3 s); then he kicks', async () => {
  const { world, hud } = stub(), g = new Penalty({ world, hud }), seen = []; let done = false, flashAt = null, strikeAt = null, struck = [];
  g.endless(i => (i < 2 ? penKick(i * STEP, stream(.3 + i / 10), i) : null), { onKick: x => { seen.push(x); struck.push(strikeAt); } }).then(() => { done = true; });
  await drive(g, () => done, g => {
    if (g.flash && flashAt == null) flashAt = g.real;
    if (g.phase === 'flight' && strikeAt == null) strikeAt = g.real;
    if (g.phase === 'ready') { flashAt = null; strikeAt = null; }
    if (g.kick?.n === 0 && g.flash && !g.pick && g.real - flashAt > 2) { assert.ok(g.ui.ballGlow && !g.sim.a('k2').gkm?.body, 'still waiting, the ball glowing'); g.choose('aim:TR'); }
  }, 2000);
  assert.equal(seen[0].when, 'late'); assert.equal(seen[0].tap, 'TR'); assert.notEqual(seen[0].res, 'post', 'a tap in the wait is never rushed');
  assert.deepEqual([seen[1].tap, seen[1].why], [null, 'none'], 'no tap: after the wait, a soft one, saved');
});

test('penalties, played: the keeper never moves first; a tap in the last moment is late, before it early; the word comes with the ball', async () => {
  const banners = [], hud = new Proxy({}, { get: (_, k) => (k === 'banner' ? w => banners.push({ word: w, x: g.sim.ball.x }) : () => {}) });
  const { world } = stub(), g = new Penalty({ world, hud }), run = newRun(), r = stream(.61), seen = [];
  let done = false, strikeAt = null, before = 0;
  g.endless(i => (run.over ? null : penKick(run.level, r, i)), { onKick: x => {
    const b = g.sim.ball; seen.push({ ...x, ball: { x: b.x, y: b.y - g.cy, state: b.state, carrier: b.carrier }, dive: g.sim.a('k2').gkm, strikeAt }); attempt(run, x.res === 'goal'); } }).then(() => { done = true; });
  await drive(g, () => done, g => {
    const K = g.sim.a('k2');
    if (g.phase === 'aim') {
      assert.ok(!K.gkm?.body, 'no dive before the kick'); assert.ok(Math.abs(K.y - g.cy) < .7, 'he stays near the middle of his line (a feint: one step)'); before++;
      const n = g.kick.n, f = (g.sim.time - g.win.t0) / g.win.T;
      if (n % 3 === 0 && !g.flash && f > .2) g.choose('aim:' + (n % 2 ? 'TL' : 'R')); // early
      if (n % 3 === 1 && g.flash && f > .3) g.choose('aim:' + (n % 2 ? 'L' : 'TR')); // in the last moment
      if (n % 3 === 2 && g.flash && f > .2) g.choose('aim:M'); // at him
    } else if (g.phase === 'flight' && strikeAt == null) strikeAt = g.sim.time;
    if (g.phase === 'ready') strikeAt = null;
  }, 6000);
  assert.ok(run.over && seen.length >= 2 && before > 100);
  seen.forEach((x, i) => {
    assert.equal(x.when, i % 3 === 0 ? 'early' : 'late', `kick ${i}: ${x.when}`);
    assert.ok(x.dive.t0 >= x.strikeAt - 1e-9, `kick ${i}: he went as it was struck, not before`);
    if (x.res === 'goal') assert.ok(x.ball.x < 0 && Math.sign(x.ball.y) === sideU(target(x.tap).col), `kick ${i}: in the net where he aimed`);
    else if (x.res === 'save') assert.ok(x.ball.x > 0, `kick ${i}: stopped in front of the line`);
    if (i % 3 === 2) assert.equal(x.why, 'middle');
  });
  assert.equal(banners.length, seen.length, 'one word a kick');
  for (const b of banners) assert.ok(b.word === 'GOAL!' ? b.x < .05 : b.x < 1.2, `the word once the ball is there (${b.word} at x ${b.x.toFixed(2)})`);
  assert.equal(banners.filter(b => b.word === 'GOAL!').length, run.score); assert.ok(Math.abs(PEN_X - 7) < 1e-9);
});
