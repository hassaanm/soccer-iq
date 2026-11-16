import test from 'node:test';
import assert from 'node:assert/strict';
import { allScenarios, pickRounds, PITCH, PATH } from '../js/skills.js';
import { interceptor, dribbleEnd, closestOnLane } from '../js/geom.js';

const pt = ([x, y]) => ({ x, y });
// Positions at the freeze, matching what the game builds (ball half a meter in front of the hero).
function frozen(sc) {
  const hero = pt(sc.heroTo);
  return { hero, ball: { x: hero.x + 0.5, y: hero.y },
    opps: sc.opps.map((p, i) => pt((sc.oppsTo || [])[i] || p)), mates: sc.mates.map(pt) };
}

for (const sk of PATH.filter(s => s.ready)) {
  for (const sc of allScenarios(sk.id).filter(s => !s.id.startsWith('gen-'))) { // hand-made ones; generated ones are covered by generate.test.js
    test(`${sc.id}: good passes are open and bad passes are cut out`, () => {
      const s = frozen(sc), good = new Set([sc.best, ...(sc.ok || [])]);
      s.mates.forEach((m, i) => {
        const ic = interceptor(s.ball, m, s.opps);
        if (good.has(`pass:${i}`)) assert.ok(ic.d > 0.9, `pass:${i} lane blocked (${ic.d.toFixed(2)} m)`);
        else assert.ok(ic.d < 1.0, `pass:${i} should be blocked but nearest defender is ${ic.d.toFixed(2)} m away`);
      });
    });
    if (sc.best.startsWith('drib:')) test(`${sc.id}: best dribble path is clear`, () => {
      const s = frozen(sc), end = dribbleEnd(s.hero, sc.best.slice(5), PITCH.L, PITCH.W);
      for (const o of s.opps) assert.ok(closestOnLane(o, s.hero, end, 0).d > 1.5);
    });
    test(`${sc.id}: positions are on the pitch`, () => {
      for (const p of [sc.hero, sc.heroTo, ...sc.mates, ...sc.opps, ...(sc.oppsTo || []).filter(Boolean)])
        assert.ok(p[0] >= 0 && p[0] <= PITCH.L && p[1] >= 0 && p[1] <= PITCH.W, `${p} off the pitch`);
    });
  }
}

test('pickRounds never repeats a scenario back to back', () => {
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const rounds = pickRounds(['look-up'], 8, rnd);
  assert.equal(rounds.length, 8);
  for (let i = 1; i < rounds.length; i++) assert.notEqual(rounds[i].id.replace(/m$/, ''), rounds[i - 1].id.replace(/m$/, ''));
});

// ---------- off the ball: "Run to the goal too!" and "Follow your shot!" ----------
import { generate, laneClear, DEF_RUN, SHOT } from '../js/generate.js';
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const spotsOf = sc => Object.fromEntries(sc.spots.map(s => [s.id, [s.x, s.y]]));

test('run to the goal: the right run is ahead of the ball on the open side, with an open pass; each wrong one is plainly wrong', () => {
  for (const pattern of ['go-goal', 'go-far', 'go-shot']) for (let seed = 1; seed <= 40; seed++) {
    const sc = generate('go-to-goal', seed, { pattern }), sp = spotsOf(sc), best = sp[sc.best.slice(5)], [c] = sc.matesTo, opps = sc.oppsTo;
    assert.ok(best[0] > c[0] + 2, `${sc.id}: the right run is not ahead of the ball`);
    assert.ok(Math.abs(best[1] - PITCH.W / 2) < 6.5, `${sc.id}: the right run is not toward the goal`);
    if (!sc.shot) {
      assert.ok(laneClear(c, best, opps), `${sc.id}: the pass to the right run is not open`);
      const front = opps.filter(o => o[0] > c[0] && D(o, c) < 3.6);
      assert.equal(front.length, 1, `${sc.id}: ${front.length} defenders in front of the friend with the ball`);
    }
    for (const s of sc.spots) if ('spot:' + s.id !== sc.best && !s.why) { // (the added runs carry their own reason: generate.js moreSpots)
      const p = [s.x, s.y];
      assert.ok(D(p, c) < 2.6 || p[0] < c[0] || opps.some(o => D(o, p) < 1.6), `${sc.id}: ${s.id} is not plainly wrong`);
    }
  }
});

test('follow your shot: the ball comes back out off the post or a leg, slower, to rest in front of the goal; he is there first if he runs in', () => {
  for (const pattern of ['follow-post', 'follow-block', 'follow-friend']) for (let seed = 1; seed <= 40; seed++) {
    const sc = generate('follow-shot', seed, { pattern }), { from, hit, loose, block } = sc.shot, sp = spotsOf(sc);
    assert.deepEqual(sp.in, loose, `${sc.id}: the right spot is the loose ball`);
    assert.ok(loose[0] >= PITCH.L - 7 && Math.abs(loose[1] - PITCH.W / 2) <= (PITCH.gy1 - PITCH.gy0) / 2 + 3.5, `${sc.id}: the ball is not in front of the goal (${loose})`); // (up to 3.5 m outside a post: 5.5 m from the middle with a 4 m goal, 6 m with the 5 m goal at 5v5)
    // It bounces back off what it hit: away from the goal line (post) or out to the side (a leg), never on through it.
    const din = [hit[0] - from[0], hit[1] - from[1]], dout = [loose[0] - hit[0], loose[1] - hit[1]];
    const cos = (din[0] * dout[0] + din[1] * dout[1]) / Math.hypot(...din) / Math.hypot(...dout);
    assert.ok(block ? cos < .5 : cos < -.3, `${sc.id}: the rebound goes on the way the shot went (cos ${cos.toFixed(2)})`);
    if (!block) assert.ok(Math.abs(hit[0] - PITCH.L) < .3 && [PITCH.gy0, PITCH.gy1].some(y => Math.abs(hit[1] - y) < .3), `${sc.id}: it does not hit a post`);
    assert.ok(SHOT.out * 1.5 < SHOT.speed * .5, 'the rebound is slower than the shot');
    // The race from the freeze: he gets there first; if he waits, one of them gets there soon.
    const tH = D(sc.heroTo, loose) / 5.2, tO = Math.min(...sc.oppsTo.map((o, i) => D(o, loose) / DEF_RUN + ('o' + (i + 1) === block ? .75 : .3)));
    assert.ok(tH + .3 < tO && tO < 2.4, `${sc.id}: him ${tH.toFixed(2)} s, them ${tO.toFixed(2)} s`);
    assert.ok(D(sc.heroTo, loose) >= 3, `${sc.id}: watching from right next to it`);
    assert.equal(sc.shot.by, pattern === 'follow-friend' ? 'm1' : 'hero');
  }
});

test('get open and run to the goal (v60): 3 places to run at Level 1, 4 after, plus staying; one best, one or two okay, one or two bad; real runs, apart', () => {
  for (const [sk, pats] of [['get-open', ['shadow', 'spread', 'stay-open']], ['go-to-goal', ['go-goal', 'go-far', 'go-shot']]]) for (const pattern of pats) for (const runs of [3, 4]) for (let seed = 1; seed <= 30; seed++) {
    const sc = generate(sk, seed, { pattern, runs }), h = sc.heroTo, runSpots = sc.spots.filter(s => s.id !== 'stay');
    assert.equal(runSpots.length, runs, `${sc.id}: ${runSpots.length} places to run`);
    assert.ok(sc.spots.some(s => s.id === 'stay'), `${sc.id}: staying is a choice`);
    const okay = sc.safe.length;
    assert.ok(okay >= 1 && okay <= 2, `${sc.id}: ${okay} okay`);
    const wrong = sc.spots.filter(s => 'spot:' + s.id !== sc.best && !sc.safe.includes('spot:' + s.id) && s.id !== 'stay').length;
    assert.ok(wrong >= 1 && wrong <= 2, `${sc.id}: ${wrong} bad runs`);
    for (const s of sc.spots) for (const t of sc.spots) if (s !== t) assert.ok(D([s.x, s.y], [t.x, t.y]) >= 2.5 - 1e-9, `${sc.id}: ${s.id} and ${t.id} overlap`);
    for (const s of runSpots) { const d = D([s.x, s.y], h); assert.ok(d >= 3.4 && d <= 10.5, `${sc.id}: ${s.id} is ${d.toFixed(1)} m away`); }
  }
});
