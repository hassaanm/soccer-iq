// The mini games (v87): two lives end a run, the score and the best are kept, the difficulty only rises and in small
// steps, the keeper game is endless, and penalties: the keeper's tell is honest, played out on the real game classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVES, STEP, newRun, attempt } from '../js/mini/rules.js';
import { MINI, miniById } from '../js/mini/games.js';
import { penLevel, penKick, tellSteps, showing, readTime, kickOf, rightTaps, target, TARGETS, other, sideU, PEN_X } from '../js/mini/pens.js';
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
  assert.deepEqual(MINI.map(g => g.id).slice(0, 2), ['keeper', 'pens']); assert.ok(miniById('attack'), 'score attack (v88)');
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
test('the keeper game gets harder with every save, a little at a time; the first saves are easy', () => {
  smooth(keeperLevel, [['stand', -1, .16], ['dive', -1, .15], ['flash', -1, .05], ['tell', -1, 1], ['side', 1, .04], ['far', 1, .03], ['v1', 1, .02], ['top', 1, .03], ['speed', 1, .01]]);
  const e = keeperLevel(5 * STEP); assert.ok(e.stand > 3.1 && e.dive > 2.9 && e.tell >= 2 && e.far === 0 && e.v1 === 0, 'five saves in: long windows, his eyes the whole time, close shots');
  const hard = keeperLevel(40); assert.ok(hard.stand < 1 && hard.dive < 1, 'it keeps getting harder');
});
test('penalties get harder with every goal, a little at a time; the first goals are easy', () => {
  smooth(penLevel, [['win', -1, .16], ['at', 1, .01], ['step', -1, .07], ['stepT', -1, .01], ['fakeP', 1, .01]]);
  for (let i = 1; i < LEVELS.length; i++) { const a = penLevel(LEVELS[i - 1]), b = penLevel(LEVELS[i]); assert.ok(readTime({ ...b, side: 'L', fake: null }) <= readTime({ ...a, side: 'L', fake: null }) + 1e-12); assert.ok(b.eyes <= a.eyes); }
  const e = penLevel(5 * STEP); assert.ok(readTime({ ...e, side: 'L', fake: null }) > 2.8 && e.step > .8 && e.fakeP === 0, 'five goals in: a big, early step and no fakes');
  assert.ok(penLevel(40).win < 1.1, 'it keeps getting harder');
});

test('the endless keeper game: honest tells at every level, the foot by the distance, the level\'s windows', () => {
  const r = stream(.42);
  for (const L of LEVELS) for (let j = 0; j < 4; j++) {
    const sh = endlessShot(L, r, j), t = tellOf(sh), Z = zoneAt(sh.zone), D = keeperLevel(L);
    assert.equal(t.col, Z.col); assert.equal(t.top, Z.top); assert.equal(t.level, D.tell); assert.equal(t.flash, D.flash);
    assert.equal(sh.foot, Math.hypot(sh.from.x, sh.from.u) <= CLOSE ? 'in' : 'las');
    assert.deepEqual([sh.stand, sh.dive], [D.stand, D.dive]);
    if (sh.kind !== 'pen') assert.equal(spotsFor(sh).filter(p => p.right).length, 1);
  }
});

test('penalties: the keeper always goes where he shows last; a fake only after level 8, and then he steps clearly back across', () => {
  const r = stream(.17); let fakes = 0;
  for (const L of LEVELS) for (let j = 0; j < 30; j++) {
    const k = penKick(L, r, j), st = tellSteps(k);
    assert.equal(st.at(-1).side, k.side, 'the last step is to the side he goes'); assert.equal(showing(k, 1), k.side);
    assert.equal(showing(k, st[0].f - 1e-6), null, 'nothing before his first step');
    assert.equal(Math.sign(st.at(-1).u), sideU(k.side));
    if (k.fake) {
      fakes++; assert.ok(L > 8, 'fakes only at high levels'); assert.equal(st.length, 2); assert.equal(k.fake, other(k.side));
      assert.ok(Math.abs(st[1].u) >= Math.abs(st[0].u), 'the true step is at least as big as the fake one');
      assert.ok(Math.abs(st[1].u - st[0].u) >= 1.5 * .25, 'he steps right across: easy to see');
      assert.ok(Math.abs(readTime(k) - readTime({ ...k, fake: null })) < 1e-12, 'the true tell shows as long as without a fake');
    } else assert.equal(st.length, 1);
    assert.ok(readTime(k) >= .4, 'the true tell is there at least 0.4 s before the kick');
  }
  assert.ok(fakes > 50, `fakes do happen (${fakes})`);
});

test('penalties: the side he leaves scores (high or low); his side and the middle are saved; no tap is saved', () => {
  const r = stream(.5);
  for (let j = 0; j < 40; j++) {
    const k = penKick(j / 3, r, j);
    for (const id of TARGETS) { const x = kickOf(k, id); assert.equal(x.res, target(id).col === other(k.side) ? 'goal' : 'save', id); }
    assert.deepEqual(rightTaps(k).map(id => target(id).col), [other(k.side), other(k.side)]);
    assert.deepEqual(kickOf(k, null), { res: 'save', why: 'late', zone: 'M' });
  }
  const sides = [], r2 = stream(.9); for (let j = 0; j < 400; j++) sides.push(penKick(3, r2, j, sides).side);
  for (let j = 3; j < sides.length; j++) assert.ok(!(sides[j] === sides[j - 1] && sides[j] === sides[j - 2] && sides[j] === sides[j - 3]), 'never four to one side');
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

test('penalties, played: the ball goes in on the side he leaves and is stopped where the keeper went; two saves end it', async () => {
  const { world, hud, events } = stub(), g = new Penalty({ world, hud }), run = newRun(), r = stream(.61), sides = [], seen = [];
  let done = false, atKick = [];
  g.endless(i => { if (run.over) return null; const k = penKick(run.level, r, i, sides); sides.push(k.side); return k; }, { onKick: x => {
    const K = g.sim.a('k2'), b = g.sim.ball; seen.push({ ...x, ball: { x: b.x, y: b.y - g.cy, state: b.state, carrier: b.carrier }, kU: K.y - g.cy }); attempt(run, x.res === 'goal'); } }).then(() => { done = true; });
  await drive(g, () => done, g => {
    if (g.phase !== 'aim') return; const k = g.kick, f = (g.sim.time - g.win.t0) / g.win.T;
    if (f > .9 && !atKick[k.n]) atKick[k.n] = g.sim.a('k2').y - g.cy; // where he stands before his dive: his tell
    if (g.pick || f < tellSteps(k).at(-1).f + .2) return;
    g.choose('aim:' + (k.n < 6 ? rightTaps(k)[k.n % 2] : k.n === 6 ? k.side : 'M'));
  }, 3000);
  assert.equal(seen.length, 8); assert.equal(run.score, 6); assert.ok(run.over);
  seen.forEach((x, i) => {
    assert.equal(Math.sign(atKick[i]), sideU(x.kick.side), `kick ${i}: he stood on the side he showed`);
    assert.ok(Math.abs(atKick[i]) > .2, 'clearly off the middle');
    if (x.res === 'goal') assert.ok(x.ball.x < 0 && Math.sign(x.ball.y) === -sideU(x.kick.side), `kick ${i}: in the net, on the side he left`);
    else assert.ok(x.ball.x > 0, `kick ${i}: stopped in front of the line`);
  });
  assert.deepEqual(seen.slice(6).map(x => x.why), ['side', 'middle']);
  assert.equal(events.filter(e => e[0] === 'banner' && e[1] === 'GOAL!').length, 6);
  assert.ok(Math.abs(PEN_X - 7) < 1e-9);
});
