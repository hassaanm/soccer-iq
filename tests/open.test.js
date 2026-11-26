// "Who's open?" (v96, mini/open.js): every layout has exactly the intended open friends by both of the game's pass
// checks (the Classic grade and the Live engine's own passCheck), each decoy is shut by its own red and is the kind it
// shows, the answer's place is spread round him and never the same twice running, every look it needs can be made in its
// time, the difficulty only rises, and a pass's result is the Live engine's. OPEN_N=2000 for the full proof (default 150
// a level, levels 0 to 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../js/mini/open.js';
import { MINI, miniById } from '../js/mini/games.js';
import { PIC } from '../js/mini/pics.js';
import { miniLines } from '../js/voicelines.js';
import { Match } from '../js/fast/match.js';
import { Sim } from '../js/sim.js';
import { PITCH } from '../js/geom.js';
import { dist } from '../js/fast/rules.js';

const N = +process.env.OPEN_N || 150;
const seedOf = (i, L) => (i * 2654435761 + L * 97 + 13) >>> 0;
const made = new Map();
function run(L, n = N) { const k = L + ' ' + n; if (made.has(k)) return made.get(k); const out = []; let prev = null; for (let i = 0; i < n; i++) { const lay = O.makeLayout(L, seedOf(i, L), prev); out.push(lay); prev = lay; } made.set(k, out); return out; }

test('the tile, its name and its lines', () => {
  const g = miniById('whoOpen');
  assert.ok(g && MINI.includes(g)); assert.equal(g.name, "Who's open?"); assert.equal(g.say, "Who's open!"); assert.equal(g.unit, '👀');
  assert.equal(g.pic, PIC.whoOpen); assert.match(g.pic, /^<svg viewBox="0 0 120 84"/);
  const lines = new Set(miniLines());
  for (const l of Object.values(O.OPEN_SAID)) assert.ok(lines.has(l), `"${l}" is recorded with the mini games' lines`);
});

test('the level mapping only gets harder, and the first two tries are gentle', () => {
  let a = O.openLevel(0);
  for (const L of [0, 1 / 3]) { const d = O.openLevel(L); assert.equal(Math.floor(d.friends), 3); assert.equal(d.hide, 0); assert.equal(d.move, 0); assert.equal(d.two, 0); assert.ok(d.secs > 6); }
  for (let k = 1; k <= 30; k++) {
    const b = O.openLevel(k / 3);
    for (const key of ['friends', 'hide', 'behind', 'subtle', 'press', 'roam', 'move', 'two']) assert.ok(b[key] >= a[key] - 1e-12, `${key} at level ${k}/3`);
    assert.ok(b.secs <= a.secs + 1e-12, 'secs'); a = b;
  }
  assert.ok(O.openLevel(10).secs >= 3, 'never under 3 s');
});

test('the view: in front, a turn for a side, two for behind', () => {
  const me = O.heroAt(), at = (a, r) => ({ x: me.x + Math.cos(a) * r, y: me.y + Math.sin(a) * r });
  assert.equal(O.lookSteps(me, at(0, 7)), 0); assert.equal(O.lookSteps(me, at(.6, 7)), 0);
  assert.equal(O.lookSteps(me, at(1.9, 8)), 1); assert.equal(O.lookSteps(me, at(-1.9, 8)), 1);
  assert.equal(O.lookSteps(me, at(Math.PI, 8)), 2);
});

test('the stand-in runs the Live engine\'s own pass check', () => {
  let n = 0;
  for (const L of [0, 1, 2]) for (const lay of run(L, 60)) {
    if (lay.friends.length > 3 || lay.foes.length > 4) continue;
    const sim = new Sim(); sim.setup({ hero: [lay.hero.x, lay.hero.y], mates: lay.friends.map(f => [f.x, f.y]), opps: lay.foes.map(o => [o.x, o.y]) });
    const m = new Match({ sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, n: 4, level: O.LIVE_LEVEL });
    const map = new Map(lay.friends.map((f, i) => [f.id, 'm' + (i + 1)]));
    const friends = lay.friends.map(f => ({ ...f, id: map.get(f.id) })), foes = lay.foes.map((o, i) => ({ ...o, id: 'o' + (i + 1) }));
    for (const f of friends) { const a = m.passCheck('hero', f.id), b = O.liveCheck(lay.hero, friends, foes, f.id); assert.equal(a.open, b.open); assert.equal(a.why, b.why); n++; }
  }
  assert.ok(n > 200, `${n} passes compared`);
});

test('every layout, levels 0 to 6: exactly the intended friends open, by both checks', () => {
  for (let L = 0; L <= 6; L++) {
    const lays = run(L); let prev = null;
    for (const lay of lays) {
      const st = O.statusAt(lay, 0), open = O.openIds(st).sort();
      assert.deepEqual(open, lay.ans.slice().sort(), `level ${L} seed ${lay.seed}: open`);
      for (const f of lay.friends) if (!lay.ans.includes(f.id)) assert.equal(st[f.id].s, 'shut', `level ${L} seed ${lay.seed}: ${f.id} is shut by both`);
      // each decoy: shut by its own red alone, and the kind it shows
      for (const o of lay.foes.filter(x => x.of)) {
        const f = lay.friends.find(x => x.id === o.of);
        assert.equal(O.statuses(lay.hero, lay.friends, lay.foes.filter(x => x !== o))[f.id].s, 'open', 'without his red he is open');
        if (o.job === 'marked') assert.ok(dist(o, f) <= 1.3, 'a marker a step from him'); else assert.ok(lay.foes.every(x => dist(x, f) >= 1.8), 'a lane decoy has nobody near him');
      }
      if (lay.two) { const [a, b] = lay.ans.map(id => lay.friends.find(f => f.id === id)); assert.ok(a.x >= b.x + 3, 'forward first: the best is 3 m nearer their goal'); }
      if (lay.after) {
        assert.deepEqual(O.openIds(O.statusAt(lay, lay.at.arrive + .05)), lay.after, 'after the red\'s run');
        for (let t = 0; t < lay.at.arrive; t += .1) assert.ok(O.openIds(O.statusAt(lay, t)).every(id => id === lay.ans[0] || id === lay.after[0]), 'on the way: never anyone else');
      }
      const k = Math.min(...lay.ans.map(id => O.lookSteps(lay.hero, lay.friends.find(f => f.id === id))));
      assert.ok(k <= 2 && O.needSecs(k) <= lay.secs - .3, 'a quick child can find him in time');
      if (L < 2 / 3) { assert.equal(lay.friends.length, 3); assert.ok(lay.friends.every(f => O.lookSteps(lay.hero, f) === 0), 'the first tries: all in front of him'); }
      if (prev) assert.notEqual(lay.place.key, prev.place.key, 'never the same place twice running');
      prev = lay;
    }
  }
});

test('the answer\'s place is spread: sides, near and far, round him; no friend and no rank is a tell', () => {
  for (let L = 1; L <= 6; L++) {
    const lays = run(L), share = f => lays.filter(f).length / lays.length, a = lay => O.placeKey(lay.hero, lay.friends.find(f => f.id === lay.ans[0]));
    assert.ok(share(l => a(l).lr === 'l') > .25 && share(l => a(l).lr === 'r') > .25, `level ${L}: left and right`);
    assert.ok(share(l => a(l).d === 'near') > .3 && share(l => a(l).d === 'far') > .3, `level ${L}: near and far`);
    assert.ok(share(l => a(l).zone === 'view') > .3 && share(l => a(l).zone === 'side') > .12 && share(l => a(l).zone === 'behind') > .03, `level ${L}: in front, to a side, behind`);
    const rank = (lay, pick) => { const ds = lay.friends.map(f => dist(f, lay.hero)), d = ds[lay.friends.findIndex(f => f.id === lay.ans[0])]; return d === pick(...ds); };
    assert.ok(share(l => rank(l, Math.max)) < .5 && share(l => rank(l, Math.min)) < .5, `level ${L}: not always the farthest or the nearest`);
    for (const id of ['m1', 'm2', 'm3']) assert.ok(share(l => l.ans[0] === id) > .08, `level ${L}: ${id} is the answer sometimes`);
  }
});

test('a pass: to the open friend it gets there; to a decoy it does not; the ring out: the nearest red', () => {
  for (const lay of run(3, 40)) {
    for (const f of lay.friends) assert.equal(O.passResult(lay.hero, lay.friends, lay.foes, f.id).ok, lay.ans.includes(f.id));
    const t = O.taker(lay.hero, lay.foes); assert.ok(lay.foes.every(o => dist(o, lay.hero) >= dist(t, lay.hero)));
  }
  const a = O.makeLayout(2, 4242), b = O.makeLayout(2, 4242); assert.deepEqual(a, b, 'a seed makes the same layout');
});
