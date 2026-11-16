// The shot with six targets and a keeper who dives (v64): one result function (shot.js shotResult) for lessons,
// matches and audits; lessons decided by the picture, matches by seeded chances (v64 research, section 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setSize, PITCH } from '../js/geom.js';
import { generate } from '../js/generate.js';
import { shotResult, zoneGrade, relations, ZONES, zone, stream, rightFoot, CLOSE, CHANCE } from '../js/shot.js';
import { makeGame } from './harness.js';

const RES = new Set(['goal', 'save', 'over', 'wide', 'cleared']), ACTS = new Set(['stay', 'reach', 'low', 'high', 'wrong', 'watch']);
const mid = () => (PITCH.gy0 + PITCH.gy1) / 2;
const shooter = (d, a) => ({ x: PITCH.L - d * Math.cos(a), y: mid() + d * Math.sin(a) });
const keeper = side => ({ x: PITCH.L - .7, y: mid() + side * 1.0 });

test('every target, foot, distance and keeper side gives a sane result, the same every time in a lesson', () => {
  setSize('5v5');
  for (const d of [5, 7, 9.5, 12]) for (const a of [-.5, 0, .5]) for (const side of [-1, 0, 1]) for (const z of ZONES) for (const foot of ['in', 'las']) {
    const from = shooter(d, a), k = keeper(side), args = { from, zone: z, foot, k, stray: .35 }, r = shotResult(args), again = shotResult(args), tag = `${d} m ${a} ${side} ${z} ${foot}`;
    assert.ok(RES.has(r.res) && ACTS.has(r.act), `${tag}: ${r.res} ${r.act}`);
    assert.deepEqual(again, r, `${tag}: a lesson gives the same answer every time`);
    if (r.res === 'goal') assert.ok(r.to.y > PITCH.gy0 && r.to.y < PITCH.gy1 && r.to.z < PITCH.gh, `${tag}: a goal is inside the goal`);
    if (r.res === 'save') assert.ok(Number.isFinite(r.t) && r.t > 0 && r.at && Math.hypot(r.at.x - k.x, r.at.y - k.y) < 3, `${tag}: a save is near him`);
    if (foot === 'las' && d < CLOSE - .5) assert.equal(r.res, 'over', `${tag}: laces from close fly over the bar`);
    for (const seed of [.1, .5, .9]) { const m = shotResult({ ...args, rand: stream(seed), duel: d <= 8 }); assert.ok(RES.has(m.res) && ACTS.has(m.act), `${tag} (match)`); assert.deepEqual(shotResult({ ...args, rand: stream(seed), duel: d <= 8 }), m, `${tag}: a match's seed gives the same answer`); }
  }
  setSize('3v3');
});

test('what the results teach: low and away best, at the keeper wrong, high never best, top laces from close over', () => {
  setSize('5v5');
  const from = shooter(6, .2), k = keeper(1), rel = relations(from, k);
  assert.equal(rel.L, 'at'); assert.equal(rel.R, 'away');
  assert.equal(zoneGrade(from, 'R', k), 'best', 'low, away from him');
  assert.equal(zoneGrade(from, 'TR', k), 'okay', 'high, away: it can go over');
  for (const z of ['L', 'TL']) assert.equal(zoneGrade(from, z, k), 'bad', `${z}: at him`);
  for (const d of [5, 7, 10]) for (const s of [-1, 0, 1]) for (const z of ['TL', 'TM', 'TR']) assert.notEqual(zoneGrade(shooter(d, .3 * s), z, keeper(s)), 'best', 'high is never best');
  assert.equal(shotResult({ from, zone: 'TR', foot: 'las', k }).res, 'over', 'laces at the top from close: over the bar');
  let over = 0; for (let i = 0; i < 400; i++) if (shotResult({ from, zone: 'TR', foot: 'las', k, rand: stream(i / 400 + .001) }).res === 'over') over++;
  assert.ok(over > 400 * .4, `a match: laces at the top from close mostly fly over (${over} of 400)`);
  // The inside of the foot is true but slow: from far, a ball near him he gets to; laces get there first.
  const far = shooter(11, 0), kc = keeper(0);
  assert.equal(shotResult({ from: far, zone: 'R', foot: 'in', k: kc }).res, 'save'); assert.equal(shotResult({ from: far, zone: 'R', foot: 'las', k: kc, stray: .3 }).res, 'goal');
  for (const f of ['in', 'las']) for (const b of ['close', 'far']) { const t = CHANCE[f][b]; assert.ok(t.awayL[0] <= t.awayT[0] && t.awayL[1] <= t.awayT[1] && t.besideL[0] <= t.besideT[0] && t.at[0] > t.besideT[0], `${f} ${b}: low beats high, at him is the worst`); }
  setSize('3v3');
});

test('a well-chosen shot (low, away from him, the right foot) scores about 9 in 10 in matches', () => {
  setSize('5v5');
  const R = stream(.4242); let n = 0, goals = 0, nd = 0, gd = 0;
  for (let i = 0; i < 4000; i++) {
    const d = 5 + R() * 7.5, from = shooter(d, (R() - .5) * 1.1), k = { x: PITCH.L - .6 - R() * .4, y: mid() + (R() - .5) * 2.4 }, rel = relations(from, k), duel = d <= 8 && R() < .6;
    for (const z of ['L', 'R']) if (rel[z] === 'away') { const r = shotResult({ from, zone: z, foot: rightFoot(from), k, rand: stream(R()), duel }); n++; goals += r.res === 'goal'; if (duel) { nd++; gd += r.res === 'goal'; } }
  }
  assert.ok(goals / n > .85 && goals / n < .95, `overall ${(goals / n).toFixed(3)}`);
  assert.ok(gd / nd > .8, `in a close 1v1 (he may guess) ${(gd / nd).toFixed(3)}`);
  setSize('3v3');
});

test('the keeper guesses only when he shoots from close with nobody in the way, in matches only', () => {
  setSize('5v5');
  let guesses = 0;
  for (let i = 0; i < 2000; i++) {
    const from = shooter(5.5, .2), k = keeper(0);
    assert.equal(shotResult({ from, zone: 'R', foot: 'in', k, rand: stream(i / 2000 + 1e-4), duel: false }).guess, 0);
    if (shotResult({ from, zone: 'R', foot: 'in', k, rand: stream(i / 2000 + 1e-4), duel: true }).guess) guesses++;
    assert.equal(shotResult({ from, zone: 'R', foot: 'in', k }).guess, 0, 'a lesson: never');
  }
  assert.ok(guesses > 300 && guesses < 520, `about 1 in 5 (${guesses} of 2000)`);
  setSize('3v3');
});

test('"Shoot to the space!": six targets in every scene, one best low target, the high one beside it only okay; the game plays each as its table says', () => {
  setSize('5v5');
  const { g } = makeGame(); let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sc = generate('shoot-space', seed, { pattern: 'aim-open' }); if (!sc) continue; n++;
    assert.equal(Object.keys(sc.shots).length, 12, sc.id);
    const [, best] = sc.best.split(':'); assert.equal(zone(best).top, false, 'the best target is low');
    assert.ok(sc.safe.every(o => !o.startsWith('shoot:') || o.endsWith(':las') || zone(o.split(':')[1]).top || o.split(':')[1] !== best), sc.id);
    g.mode = 'lesson'; g.load(sc);
    for (const opt of Object.keys(sc.shots)) { const a = g.shotOf(opt), b = g.shotOf(opt); assert.equal(a.res, sc.shots[opt], `${sc.id} ${opt}`); assert.deepEqual(a, b, `${sc.id} ${opt}: the same every time`); }
    assert.equal(g.rating(sc.best), 'best');
    for (const z of ZONES) { const r = g.rating(`shoot:${z}:in`), gr = zoneGrade({ x: sc.heroTo[0] + .5, y: sc.heroTo[1] }, z, g.sim.keeper('them'), { stray: sc.stray, defs: sc.oppsTo.map(([x, y]) => ({ x, y })) }); assert.equal(r, gr === 'best' ? 'best' : gr === 'okay' ? 'safe' : 'bad', `${sc.id} ${z}`); }
  }
  assert.ok(n >= 20, `${n} scenes`);
  setSize('3v3');
});

test('results card: the lesson tile first, then Match, then Cup; no book mark', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), next = html.match(/<div class="next">(.*?)<\/div>/s)[1];
  assert.deepEqual([...next.matchAll(/id="(go\w+)"/g)].map(m => m[1]), ['goLesson', 'goMatch', 'goCup']);
  assert.ok(!next.includes('📖') && next.includes('class="lbl"'), 'a label over the lesson picture, no book');
});
