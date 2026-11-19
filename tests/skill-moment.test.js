// The skill moment (game/skill.js, v78): in the real game two moves are offered early, a tap arms one, and it starts by
// itself at the right moment; play slows down meanwhile. The better move (or none) never changes how a play ends; the
// one to the wrong side is read by the defender, who steps in and stops him.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { Sim, EXIT_FREE, RUN_MOVES, MOVE_AT, touchAt } from '../js/sim.js';
import { TEAMS } from '../js/teams.js';
import { MOVE_NAME, MOVE_W } from '../js/flair.js';
import { TURN_MOVES, SAW } from '../js/game/skill.js';
import { generate } from '../js/generate.js';
import { setSize } from '../js/geom.js';
import { allScenarios, PATH } from '../js/skills.js';
import { optionsFor, pictureU } from './harness.js';
// Opens the choice and lets play go on (nothing tapped) until it is at the scene's own picture.
const toPicture = g => { g.decide(); const w = g.win; if (!w) return; const u = pictureU(w); for (let i = 0; i < 6000 && g.win && (g.win.u ?? 0) < u; i++) g.tick(1 / 60, 0); };

// A game as the real one runs (skillTaps), with a stub renderer; `tap(g)`, asked every frame of an offer, returns the
// button to tap (0, 1) or null. Each offer is logged with what it showed and for how long (real seconds).
function makeGame(tap = () => null, opts = {}) {
  const events = [], offers = [];
  const world = { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] };
  const hud = new Proxy({}, { get: (_, k) => (...a) => events.push([k, ...a]) });
  const g = new Game({ world, hud, say: () => {}, skillTaps: true, ...opts });
  g.setTeams(TEAMS[3], TEAMS[13]);
  const offer = g.skillOffer, watch = g.skillWatch;
  g.skillOffer = function (o) { const s = this.sim, h = s.a('hero'), b = s.ball, t = s.a(o.tgt);
    offer.call(this, o); const sk = this.sk; offers.push({ sk, phase: this.phase, good: this.playGood, h: b.h, at: [h.x, h.y], to: [h.tx, h.ty], tgt: t && [t.x, t.y], r0: this.realTime, vis: null, fired: null }); };
  g.skillWatch = function (dt) { watch.call(this, dt); const o = offers.at(-1);
    if (o && o.vis == null && (this.sk !== o.sk || o.sk.phase !== 'offer')) o.vis = this.realTime - o.r0;
    if (o && o.fired == null && o.sk.phase === 'move') o.fired = { real: this.realTime, t: this.sim.time };
    if (this.sk?.phase === 'offer') { const i = tap(this); if (i != null) this.skillTap(i); } };
  return { g, events, offers };
}
async function frames(g, promise, n = 6000) {
  let done = false; promise.then(() => { done = true; });
  for (let i = 0; i < n && !done; i++) { g.tick(1 / 60, 100 + i / 60); await null; }
  assert.ok(done, 'flow did not finish');
}
// One lesson play as a child plays it: the run-up, a moment to choose, then his choice. `tap`: 'better', 'worse' (one
// real second into the offer) or none.
const pickOf = tap => g => (tap && g.realTime - g.sk.r0 > 1 ? g.sk.alts.findIndex(a => (tap === 'better') === a.good) : null);
// Each play draws from a fixed sequence, the same for a scene and option whatever is tapped (unseeded, about one run in
// seven had an offer that broke a rule by chance); the plays with and without a tap stay comparable.
const seeded = seed => { let x = seed; return () => (x = (x * 16807) % 2147483647) / 2147483647; };
const seedOf = (...k) => [...k.join('|')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483646, 7) + 1;
async function play(sc, opt, tap = null) {
  const real = Math.random; Math.random = seeded(seedOf(sc.id, opt));
  try { return await playSeeded(sc, opt, tap); } finally { Math.random = real; }
}
async function playSeeded(sc, opt, tap) {
  const { g, events, offers } = makeGame(g => { g.sk.r0 ??= g.realTime; return pickOf(tap)(g); });
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre());
  toPicture(g); // (v66: he chooses in the window, when play is at the scene's own picture: the defender has come as near as the scene has him)
  let cutMid = false; const em = g.emit; g.emit = function (ev) { if (this.sk?.phase === 'move') cutMid = true; return em.call(this, ev); };
  g.rated = { stars: 3, text: 'x' }; // (as a lesson round sets it)
  await frames(g, g.outcome(opt, g.isGood(opt)));
  const s = g.sim, end = [...s.agents.values()].map(a => [a.id, a.x.toFixed(6), a.y.toFixed(6)].join(' ')).join('|');
  return { cutMid, result: g.result, banners: events.filter(e => e[0] === 'banner').map(e => e[1]), end, offers, moved: events.some(e => e[0] === 'skillName'), names: events.filter(e => e[0] === 'skillName').length, g, events };
}
const SCENES = () => [...allScenarios('take-him-on'), ...allScenarios('dribble-to-space').slice(0, 5)].flatMap(sc => optionsFor(sc).filter(o => /^drib:/.test(o)).map(opt => [sc, opt]));
let cache = null; // the plays with an offer, with no tap (the same for the tests below)
async function offered() { if (cache) return cache; cache = []; for (const [sc, opt] of SCENES()) { const none = await play(sc, opt); if (none.offers.length) cache.push({ sc, opt, none }); } return cache; }

test('every move has a name a child sees, and a picture', async () => {
  for (const k of [...Object.keys(MOVE_W), ...RUN_MOVES, ...TURN_MOVES]) assert.ok(MOVE_NAME[k], k);
  const html = (await import('node:fs')).readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const k of [...RUN_MOVES, ...TURN_MOVES]) assert.match(html, new RegExp(`<symbol id="mv-${k}"`), `a picture for ${k}`);
  assert.equal(new Set(RUN_MOVES.map(k => MOVE_AT[k])).size, RUN_MOVES.length, 'each run-at move has its own distance');
});

test('an offer: two different moves, one better, shown at least 1.5 s (real) and mostly 2.5 s; one offer a play at most, never while he decides', async () => {
  const plays = await offered(); let n = 0;
  assert.ok(plays.length >= 6, `offers came (${plays.length})`);
  for (const { sc, opt, none } of plays) {
    assert.equal(none.offers.length, 1, `${sc.id} ${opt}: one offer`);
    const o = none.offers[0], [a, b] = o.sk.alts;
    assert.equal(o.phase, 'outcome'); assert.notEqual(o.good, false, `${sc.id} ${opt}: an offer in a play going wrong`);
    assert.notEqual(a.k, b.k, 'two different moves');
    assert.equal(o.sk.alts.filter(x => x.good).length, 1, 'one of them is the better one');
    assert.notEqual(a.dir, b.dir, 'they go opposite ways'); assert.equal(a.dir, 'l', 'the left button has the move that goes left');
    if (none.result) { assert.ok(o.vis >= 1.5, `${sc.id} ${opt}: the offer shows ${o.vis.toFixed(2)} s`); if (o.vis >= 2.4) n++; }
  }
  assert.ok(n >= plays.length * .8, `most offers show about 2.5 s or more (${n} of ${plays.length})`);
});

test('no tap: the play as with no offer; the better move goes by him; the wrong one: he is stopped, and the result shows it went wrong', async () => {
  let worse = 0, stopped = 0, dropped = 0, sides = new Set(), btns = new Set(); const plays = await offered();
  for (const { sc, opt, none } of plays) {
    const better = await play(sc, opt, 'better'), bad = await play(sc, opt, 'worse');
    assert.ok(!better.banners.includes(SAW), `${sc.id} ${opt}: the better move never shows as gone wrong`);
    if (none.offers[0].sk.kind === 'turn') { assert.equal(better.result, none.result, `${sc.id} ${opt}`); assert.deepEqual(better.banners, none.banners, `${sc.id} ${opt}`); }
    assert.ok(!none.banners.includes(SAW), 'no tap: the plain result');
    // (review) a move he picked plays to its end before the result shows
    for (const r of [better, bad]) if (r.moved) assert.notEqual(r.cutMid, true, `${sc.id} ${opt}: the result came mid-move`);
    if (!better.moved) { dropped++; continue; } // (the play stopped him before the move could start: another defender went in at him)
    assert.equal(better.names, 1, `${sc.id} ${opt}: its name once`);
    assert.ok(!none.moved, 'no tap: no move');
    const o = better.offers[0]; sides.add(o.sk.alts.find(x => x.good).dir); btns.add(o.sk.alts.findIndex(x => x.good));
    // the wrong one: the defender reads it and steps in (the play ends sooner, him stopped short of where it went)
    if (bad.moved) { worse++; const h0 = none.g.sim.a('hero'), h1 = bad.g.sim.a('hero'); if (bad.g.sim.time < none.g.sim.time - .2 || Math.hypot(h1.x - h0.x, h1.y - h0.y) > .5) stopped++;
      if (bad.result === 'kept') { const b = bad.events.find(e => e[0] === 'banner'); assert.equal(b[1], SAW, `${sc.id} ${opt}: the wrong move's result reads ${b[1]}`); assert.equal(b[2], 'bad', 'in the not-gold style'); assert.equal(b[3]?.stars, 2, 'and 2 stars on a lesson card'); } }
  }
  assert.ok(dropped <= Math.max(1, plays.length * .2), `the better move was made in nearly every play (${dropped} of ${plays.length} stopped first)`);
  assert.ok(worse > 3 && stopped >= worse * .6, `the wrong move gets him stopped (${stopped} of ${worse})`);
  assert.equal(sides.size, 2, 'the better move goes left in some scenes and right in others');
  assert.equal(btns.size, 2, 'the better move is on either button');
});

test('a tap after the offer has closed, or a second tap, does nothing', async () => {
  const { sc, opt } = (await offered())[0];
  const twice = await play(sc, opt, 'better'); assert.equal(twice.names, 1, 'one name, however many taps');
  const { g, events } = makeGame(), watch = g.skillWatch;
  g.skillWatch = function (dt) { const was = this.sk?.phase; watch.call(this, dt); if (was === 'offer' && this.sk?.phase !== 'offer') { this.skillTap(0); this.skillTap(1); } };
  g.mode = 'lesson'; g.load(sc); await frames(g, g.pre()); toPicture(g);
  await frames(g, g.outcome(opt, g.isGood(opt)));
  assert.ok(events.some(e => e[0] === 'skill' && e[1]), 'it was offered');
  assert.ok(!events.some(e => e[0] === 'skillName'), 'a late tap makes no move');
  g.skillTap(0); assert.equal(g.sk, null);
});

// A sim on its own: he runs at a defender who stands to one side of his line (y offset `side`), the child's player.
function runAt(side, { k = null, speed = 4.4, at = 14, opp2 = null } = {}) {
  const s = new Sim(); s.setup({ hero: [4, 10], mates: [], opps: [[at, 10 + side], ...(opp2 ? [opp2] : [])] });
  s.taps = new Set(['hero']); s.offerOK = true; s.flair = { ctx: 't', own: false, by: { hero: { p: 1, can: RUN_MOVES, fav: [], tier: 't' } } };
  if (k) s.movePair = () => [k, RUN_MOVES.find(x => x !== k)];
  s.go('hero', 30, 10, speed); const rec = []; let offer = null;
  for (let i = 0; i < 600; i++) { s.step(1 / 60); const h = s.a('hero'); if (h.offer && !offer) offer = { ...h.offer, t: s.time }; rec.push({ t: s.time, skill: h.skill && { ...h.skill }, n: touchAt(h) }); if (h.offer && k) s.take('hero', h.offer.alts.findIndex(m => m.k === k)); }
  return { s, offer, rec, first: rec.find(r => r.skill)?.skill };
}

test('the better move depends on the scene: it fakes toward the side the defender is on and goes to the space', () => {
  for (const side of [.9, -.9]) {
    const { offer } = runAt(side); assert.ok(offer, `an offer (defender ${side > 0 ? 'left' : 'right'})`);
    const good = offer.alts.find(m => m.good), bad = offer.alts.find(m => !m.good);
    assert.equal(good.fake, Math.sign(side), 'the better one fakes toward him'); assert.equal(bad.fake, -Math.sign(side), 'the other fakes to the space');
  }
});

test('an armed move starts by itself at its own distance from the defender; a later tap never moves it earlier', () => {
  const starts = {};
  for (const k of RUN_MOVES) {
    const { first } = runAt(.8, { k }); assert.ok(first, `${k} started`); assert.equal(first.k, k);
    assert.ok(first.gap <= MOVE_AT[k] + .75 && first.gap >= 1.1, `${k} starts ${first.gap.toFixed(2)} m from him (its distance ${MOVE_AT[k]})`);
    starts[k] = first.gap;
  }
  assert.ok(starts.scissors > starts.feint, `the scissors starts farther out than the body feint (${starts.scissors.toFixed(2)}, ${starts.feint.toFixed(2)})`);
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

// (round 13) A skill move never ends by a second man of theirs. Where he comes out is judged where he really will be
// as the move ends (on his own run), against where each of them will be by then (sim.js exitGap): a second defender
// coming in, or one keeping up at his side, counts there even if he is far from that spot as the move is offered.
test('a skill move\'s end is judged where everyone will be as it ends', () => {
  const room = opps => { const s = new Sim(); s.setup({ hero: [10, 10], mates: [], opps: opps.map(o => o.at) });
    const h = s.a('hero'); Object.assign(h, { tx: 28, ty: 10, speed: 4.5, sp: 4.5 });
    opps.forEach((o, i) => { const a = s.a('o' + (i + 1)); Object.assign(a, { tx: o.to[0], ty: o.to[1], speed: o.v, sp: o.v, lv: [(o.to[0] - o.at[0]) / (Math.hypot(o.to[0] - o.at[0], o.to[1] - o.at[1]) || 1) * o.v, (o.to[1] - o.at[1]) / (Math.hypot(o.to[0] - o.at[0], o.to[1] - o.at[1]) || 1) * o.v] }); });
    return s.exitGap(h, 2); };
  const one = { at: [15, 10.8], to: [14, 10.6], v: 3 }, far = { at: [10, 2], to: [10, 2.5], v: 1 };
  assert.ok(room([one, far]) >= EXIT_FREE, 'one defender in his way, the others far off: room to come out');
  assert.ok(room([one, { at: [15.5, 13.5], to: [15.5, 10.4], v: 4.5 }]) < EXIT_FREE, 'a second one coming in to where the move ends');
  assert.ok(room([one, { at: [9.4, 11.5], to: [28, 11.5], v: 4.5 }]) < EXIT_FREE, 'a second one at his side, keeping up');
  // and no offer at all when a second one stands where either move would end
  assert.ok(runAt(.8).offer, 'alone: offered'); assert.ok(!runAt(.8, { opp2: [12, 8.6] }).offer, 'a second one by where he comes out: none');
});

// In matches with a bot that taps the better move as each offer shows (and in some the other): no move ends with two of
// theirs within 1.5 m of his player (measured as the move ends), and offers come at most every 20 s.
test('in matches, no skill move ends by a second defender, and offers are 20 s apart or more', async () => {
  const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), real = Math.random; let moves = 0;
  try {
    for (const seed of [6, 10, 18, 20, 25]) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g, offers } = makeGame(gm => gm.sk.alts.findIndex(a => a.good === (seed % 2 === 0))); g.skills = new Set(PATH.map(k => k.id)); const s = g.sim; let skObj = null, skPh = null, done = false;
      const p = g.match(PATH.map(k => k.id), [], 5, 'free'); p.then(() => { done = true; });
      for (let i = 0; i < 60 * 900 && !done; i++) {
        g.tick(1 / 60, i / 60);
        const sk = g.sk, ph = sk?.phase ?? null;
        if (skPh === 'move' && (sk !== skObj || ph !== 'move')) { moves++; const h = s.a('hero'), ds = s.team('them').filter(o => !o.gk).map(o => D(o, h)).sort((p, q) => p - q);
          assert.ok(!(ds[1] < 1.5), `seed ${seed} t ${s.time.toFixed(2)}: a ${skObj.pick.k} ends with a second defender ${ds[1].toFixed(2)} m from him`); }
        skObj = sk; skPh = ph;
        if (g.canAct && g._choose && (!g.win || (g.win.u || 0) >= .45)) { const sc = g.sc; const o = sc.kind === 'tackle' ? (g.tackleState() === 'good' ? sc.best : null) : sc.best || (sc.spots ? 'spot:' + sc.spots[0].id : 'drib:back'); if (o) { g.seen.add('m1'); g.seen.add('m2'); if (s.a('m3')) g.seen.add('m3'); g.choose(o); } }
        await null;
      }
      assert.ok(done, `seed ${seed}: the match finished`);
      for (let i = 1; i < offers.length; i++) assert.ok(offers[i].r0 - offers[i - 1].r0 >= 20, `seed ${seed}: offers ${(offers[i].r0 - offers[i - 1].r0).toFixed(1)} s apart`);
    }
  } finally { Math.random = real; }
  assert.ok(moves > 0, 'skill moves were made');
});

test('every move comes round: four or more different moves within the first four offers of a session; sessions start at different moves', () => {
  const g = new Game({ world: { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] }, hud: new Proxy({}, { get: () => () => {} }), say: () => {} });
  const seen = new Set();
  for (let i = 0; i < 4; i++) { const pair = i % 2 ? g.movePair(TURN_MOVES, 'double') : g.movePair(RUN_MOVES); for (const k of pair) { seen.add(k); g.skSeen[k] = (g.skSeen[k] || 0) + 1; } }
  assert.ok(seen.size >= 4, `moves offered: ${[...seen].join(', ')}`);
  const firsts = new Set(); for (let i = 0; i < 8; i++) { const h = new Game({ world: { canvas: { clientWidth: 800, clientHeight: 400 }, setTeams() {}, swapRigs() {}, resetRigs() {}, project: () => [400, 200] }, hud: new Proxy({}, { get: () => () => {} }), say: () => {} }); firsts.add(h.movePair(RUN_MOVES).join() + '|' + h.movePair(TURN_MOVES).join()); }
  assert.ok(firsts.size >= 3, `a session's first offer differs (${[...firsts].join(' ; ')})`);
});

// (review) Both buttons show the same scene (the defender where he really is, in their shirt colour); only the move and its
// arrow differ, and the better arrow goes away from the defender's side.
test('the two pictures share one scene and differ by the move and its arrow', async () => {
  for (const { sc, opt, none } of (await offered()).slice(0, 8)) {
    const sk = none.offers[0].sk, ev = none.events.filter(e => e[0] === 'skill' && e[1]), [, pair, , scene] = ev[0];
    assert.ok(scene && scene.dx !== 0, `${sc.id} ${opt}: the defender has a place`); assert.equal(scene.color, TEAMS[13].kit.colors[0], 'in their shirt colour');
    assert.deepEqual(pair.map(p => p.dir), ['l', 'r'], 'the arrows: left on the left button, right on the right');
    const good = sk.alts.find(a => a.good); assert.equal(Math.sign(scene.dx), good.dir === 'l' ? 1 : -1, `${sc.id} ${opt}: the better arrow goes away from the defender`);
  }
});

// (review) Regression scenes (5v5 take-him-on): an armed move always starts (gen-carry-9059 hung armed), and the result
// waits for the move to finish (gen-carry-9073 showed it mid-move); and the moves of a session's first offer vary.
test('regression: an armed move starts, and the result waits for it (5v5 take-him-on scenes)', { skip: (process.env.SOCCER_SIZE || '3v3') !== '5v5' && 'a 5v5 case' }, async () => {
  setSize('5v5'); let n = 0;
  for (const seed of [9048, 9059, 9073, 9052]) { const sc = generate('take-him-on', seed); if (!sc) continue;
    for (const tap of ['better', 'worse']) { const r = await play(sc, sc.best, tap); if (!r.offers.length) continue; n++;
      assert.ok(r.moved, `${sc.id} ${tap}: the armed move started`); assert.equal(r.cutMid, false, `${sc.id} ${tap}: the result came mid-move`); } }
  assert.ok(n > 0, 'some of them offer');
});
