// v64: more options in the run-to and turn decisions, "Don't crowd your friend" (Get open!), the restart lesson
// ("Our ball? Spread out!") and matches open sooner. Runs at the size being played (SOCCER_SIZE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, OKAY, BAD, RESTART_LATER } from '../js/generate.js';
import { PATH, skillById, sessionRounds, runsAt, CHAPTERS } from '../js/skills.js';
import { sizeOf, W, L } from '../js/geom.js';
import { defaultProgress, matchOpen, playOpen, finishSession, isOpen, TRAINING_ROUNDS, MATCH_ANY_DAY } from '../js/progress.js';
import { optionsFor, playOption, judge, makeGame } from './harness.js';

const gradeOf = (sc, opt) => { const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); return g.rating(opt); };
const kinds = (sc, opts) => opts.map(o => gradeOf(sc, o));

test('turns: three choices at every level (left, right, or straight back to the passer, which keeps it: okay)', () => {
  let n = 0, back = 0;
  for (const pattern of ['peek-turn', 'peek-open']) for (let seed = 1; seed <= 12; seed++) {
    const sc = generate('peek-and-turn', seed, { pattern }); assert.ok(sc); n++;
    if (!sc.back) { assert.ok(sc.mates[0][0] <= 3, `${sc.id}: no pass back, though the passer is not by our goal`); continue; } // (the passer right by our goal: no pass back)
    back++; assert.deepEqual(optionsFor(sc), ['turn:L', 'turn:R', 'turn:B']);
    assert.equal(gradeOf(sc, 'turn:B'), 'safe', `${sc.id}: the pass back`);
  }
  assert.ok(back >= n * .8, `${back} of ${n}`);
});

test('defending: 3 places at Level 1, 4 from Level 2; the fourth (back to goal) is okay or bad from the picture', () => {
  for (const [skill, pats] of [['get-goal-side', ['goal-side', 'you-go']], ['one-goes', ['one-goes', 'mark-free', 'you-go', 'gs-covered']]]) for (const pattern of pats) for (let seed = 1; seed <= 6; seed++) {
    const a = generate(skill, seed, { pattern, runs: runsAt(1) }), b = generate(skill, seed, { pattern, runs: runsAt(2) });
    assert.equal(a.spots.length, 3); assert.equal(b.spots.length, 4, `${b.id}`);
    const deep = b.spots.find(s => s.id === 'deep'), gr = gradeOf(b, 'spot:deep');
    assert.ok(deep && (gr === 'safe') === !b.exploits.deep && (gr === 'bad') === !!b.exploits.deep, `${b.id}: deep graded ${gr}`);
    if (gr === 'safe') assert.equal(deep.why, 'deep');
  }
});

test('follow your shot: 3 places at Level 1, 4 from Level 2 (the fourth: just in time, okay; or too late, bad)', () => {
  for (const pattern of sizeOf().keeper ? ['follow-keeper', 'follow-post', 'follow-block'] : ['follow-post', 'follow-block', 'follow-friend']) for (let seed = 1; seed <= 5; seed++) {
    const a = generate('follow-shot', seed, { pattern, runs: 3 }), b = generate('follow-shot', seed, { pattern, runs: 4 });
    assert.equal(a.spots.length, 3); assert.equal(b.spots.length, 4);
    const x = b.spots[3]; assert.ok(['late', 'slow'].includes(x.why), x.why);
    assert.equal(gradeOf(b, 'spot:' + x.id), x.why === 'late' ? 'safe' : 'bad');
  }
});

test("get open, don't crowd your friend: he is beside a friend who dribbles; best is open space, the ball and staying are bad, with their reasons", async () => {
  for (const level of [1, 2]) for (let seed = 1; seed <= 8; seed++) {
    const sc = generate('get-open', seed, { pattern: 'crowd', runs: runsAt(level) }); assert.ok(sc, `seed ${seed}`);
    const c = sc.matesTo[0], h = sc.heroTo, sp = id => sc.spots.find(s => s.id === id);
    assert.ok(Math.hypot(h[0] - c[0], h[1] - c[1]) < 2.6, 'right beside him');
    assert.ok(Math.hypot(sc.mates[0][0] - c[0], sc.mates[0][1] - c[1]) > 2, 'the friend dribbles up in the run-up');
    assert.equal(sc.best, 'spot:space');
    assert.equal(gradeOf(sc, 'spot:ball'), 'bad'); assert.equal(sp('ball').why, 'inway'); assert.equal(BAD.inway, 'You got in his way!');
    assert.equal(gradeOf(sc, 'spot:stay'), 'bad'); assert.equal(sp('stay').why, 'close');
    const g = kinds(sc, sc.spots.map(s => 'spot:' + s.id));
    assert.equal(sc.spots.length, level === 1 ? 4 : 5, 'rings and staying'); assert.ok(g.includes('safe'), 'one more okay place');
    if (seed <= 2) for (const opt of optionsFor(sc)) assert.deepEqual(judge(await playOption(sc, opt)), [], `${sc.id} ${opt}`);
  }
});

test('"Our ball? Spread out!": in "Our team", after "Forward first"; the chapter row stays short; every situation builds', () => {
  const sk = skillById('spread-out'), i = PATH.findIndex(s => s.id === 'spread-out');
  assert.equal(sk.kid, 'Our ball? Spread out!'); assert.equal(CHAPTERS[sk.ch], 'Our team'); assert.equal(PATH[i - 1].id, 'forward-first');
  assert.ok(PATH.filter(s => s.ch === sk.ch).length <= 5);
  assert.ok(sk.tip.startsWith('Our ball? Spread out!') && sk.outside && sk.adult);
  const pats = ['side-in', 'side-take', 'side-pass', 'goal-kick', 'side-two', 'kick-off', ...(sizeOf().keeper ? ['keeper-ball'] : [])];
  for (const pattern of pats) for (let seed = 1; seed <= 4; seed++) {
    const sc = generate('spread-out', seed, { pattern }); assert.ok(sc, `${pattern} ${seed}`);
    assert.equal(sc.restart, true); assert.equal(sc.mates.length, sizeOf().out - 1); assert.equal(sc.opps.length, sizeOf().out);
    assert.equal(!!sc.gk, sizeOf().keeper, 'keepers only at keeper sizes');
    assert.ok(optionsFor(sc).includes(sc.best) && sc.cue);
  }
  assert.equal(generate('spread-out', 1, { pattern: 'keeper-ball' }) !== null, sizeOf().keeper);
});

test('restarts: the ball still on its line, their players standing off it (3 m, 5 m with keepers), back in their half at a goal kick', () => {
  const off = sizeOf().keeper ? 4.5 : 2.9;
  for (let seed = 1; seed <= 6; seed++) {
    for (const pattern of ['side-in', 'side-take', 'side-two']) {
      const sc = generate('spread-out', seed, { pattern }), c = sc.kind ? sc.mates[0] : sc.heroTo;
      assert.ok(c[1] < .5 || c[1] > W - .5, `${sc.id}: the taker is on the side line`);
      assert.ok(sc.opps.every(o => Math.hypot(o[0] - c[0], o[1] - c[1]) >= off), `${sc.id}: too close`);
      if (!sc.kind) assert.deepEqual(sc.hero, sc.heroTo, 'no run-up: the ball is still');
    }
    const gkick = generate('spread-out', seed, { pattern: 'goal-kick' });
    assert.ok(gkick.opps.every(o => o[0] > L / 2), 'retreat line'); assert.equal(gkick.best, 'spot:wide');
    const ko = generate('spread-out', seed, { pattern: 'kick-off' });
    assert.ok(Math.abs(ko.mates[0][0] - L / 2) < 1 && Math.abs(ko.mates[0][1] - W / 2) < .1, 'kick-off from the middle'); assert.ok(ko.opps.every(o => o[0] > L / 2));
  }
});

test('restarts: taking it, the dribble-in is best with space ahead, the pass with a free friend and the line blocked; out over the line is lost', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const t = generate('spread-out', seed, { pattern: 'side-take' }), p = generate('spread-out', seed, { pattern: 'side-pass' });
    assert.equal(t.best, 'drib:fwd'); assert.equal(gradeOf(t, 'pass:0'), 'bad');
    assert.equal(p.best, 'pass:0'); assert.equal(gradeOf(p, 'drib:fwd'), 'bad');
    const out = t.heroTo[1] < W / 2 ? 'drib:right' : 'drib:left'; assert.equal(gradeOf(t, out), 'bad');
  }
});

test('restarts: wrong places say why; okay places say what is better; every line has a reason', () => {
  for (const pattern of ['side-in', 'goal-kick', 'side-two', 'kick-off', ...(sizeOf().keeper ? ['keeper-ball'] : [])]) for (let seed = 1; seed <= 4; seed++) {
    const sc = generate('spread-out', seed, { pattern });
    for (const s of sc.spots) {
      const gr = gradeOf(sc, 'spot:' + s.id);
      if (gr === 'safe') assert.ok(OKAY[s.why], `${sc.id} ${s.id}`);
      if (gr === 'bad' && s.why && !['hidden', 'slow'].includes(s.why)) assert.ok(BAD[s.why], `${sc.id} ${s.id} ${s.why}`);
    }
  }
});

test('restarts: Level 1 has the clear ones; the keeper\'s ball, the second friend and the kick-off come from Level 2', () => {
  for (const first of [true, false]) assert.ok(sessionRounds('spread-out', 6, { first, level: 1 }).every(sc => !RESTART_LATER.has(sc.pattern)));
  const seen = new Set(); for (let k = 0; k < 6; k++) for (const sc of sessionRounds('spread-out', 6, { level: 2 })) seen.add(sc.pattern);
  assert.ok(seen.has('side-two') && seen.has('kick-off'));
});

test('Match opens every day once his first lesson is passed; the Cup needs today\'s lesson or training; training is 4 rounds', () => {
  const p = defaultProgress();
  assert.equal(MATCH_ANY_DAY, true); assert.equal(TRAINING_ROUNDS, 4);
  assert.equal(matchOpen(p, 100), false, 'nothing passed yet'); assert.equal(playOpen(p, 100), false);
  finishSession(p, 'look-up', 2, 6, 100); assert.equal(matchOpen(p, 100), false, 'played but not passed');
  finishSession(p, 'look-up', 5, 6, 101); assert.equal(matchOpen(p, 101), true);
  assert.equal(matchOpen(p, 150), true, 'any later day, without a lesson first'); assert.equal(playOpen(p, 150), false, 'the Cup waits for a session');
  p.openDay = 150; assert.equal(playOpen(p, 150), true);
  const q = defaultProgress(); q.settings.alwaysOpen = true; assert.equal(matchOpen(q, 1), true);
});

test('the new lesson opens after "Forward first", and the lessons after it wait for it', () => {
  const p = defaultProgress(), i = PATH.findIndex(s => s.id === 'spread-out');
  for (const s of PATH.slice(0, i)) if (!s.keeper) finishSession(p, s.id, 6, 6, 10);
  assert.equal(isOpen(p, PATH, i), true); assert.equal(isOpen(p, PATH, i + 1), false);
  finishSession(p, 'spread-out', 6, 6, 10); assert.equal(isOpen(p, PATH, i + 1), true);
});

test('once learned, restarts come up in matches, and a match with them runs to the end', async () => {
  const { drive } = await import('./harness.js');
  const real = Math.random; let x = 4242; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
  try {
    const { g } = makeGame(); g.skills = new Set(['look-up', 'get-open', 'pass-to-open', 'spread-out']);
    const ids = [...g.skills], extra = Array.from({ length: 10 }, (_, k) => generate('spread-out', 300 + k)).filter(Boolean);
    let restarts = 0;
    const score = await drive(g, g.match(ids, extra, 3, 'free'), { pick: gm => { if (gm.sc.restart) restarts++; if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null; return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); }, maxSec: 1500 });
    assert.ok(score.us >= 3 || score.them >= 3, JSON.stringify(score)); assert.ok(restarts > 0, 'no restart came up');
  } finally { Math.random = real; }
});
