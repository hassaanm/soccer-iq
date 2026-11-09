import test from 'node:test';
import assert from 'node:assert/strict';
import { load, save, finishSession, nextSkill, isMastered, defaultProgress, level, reviewsDue, reviewed, isOpen, skills } from '../js/progress.js';
import { PATH } from '../js/skills.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('load falls back to defaults and round-trips', () => {
  const st = mem();
  const p = load(st);
  assert.equal(p.us, 'barca');
  p.us = 'spain'; save(p, st);
  assert.equal(load(st).us, 'spain');
});

test('load survives broken storage', () => {
  const p = load({ getItem: () => { throw new Error('blocked'); } });
  assert.deepEqual(p, defaultProgress());
});

test('a level needs a good session on a new day; a bad day never takes stars away', () => {
  const p = defaultProgress();
  finishSession(p, 'look-up', 5, 6, 100);
  finishSession(p, 'look-up', 6, 6, 100);           // same day: no second level
  assert.equal(level(p, 'look-up'), 1);
  const r = finishSession(p, 'look-up', 6, 6, 101);
  assert.equal(level(p, 'look-up'), 2); assert.ok(r.leveledUp);
  finishSession(p, 'look-up', 5, 6, 103);
  assert.equal(isMastered(p, 'look-up'), true);
  finishSession(p, 'look-up', 1, 6, 104);
  assert.equal(level(p, 'look-up'), 3, 'level shown stays at the best reached');
  assert.equal(p.skills['look-up'].box, 2, 'but the review gap gets shorter');
});

test('nextSkill: grown-up lock, then his pick, then learning, then new lessons, then reviews', () => {
  const p = defaultProgress();
  assert.equal(nextSkill(p, PATH, 100), 'look-up');
  p.settings.skill = 'one-goes';
  assert.equal(nextSkill(p, PATH, 100), 'one-goes');
  p.settings.skill = 'not-a-skill';
  assert.equal(nextSkill(p, PATH, 100), 'look-up');
  p.settings.skill = null;
  finishSession(p, 'look-up', 6, 6, 100);           // leveled today: move on to the next new lesson
  assert.equal(nextSkill(p, PATH, 100), 'dribble-to-space');
  assert.equal(nextSkill(p, PATH, 101), 'look-up', 'next day: back to the Level 1 lesson first');
  p.pick = 'take-him-on';
  assert.equal(nextSkill(p, PATH, 101), 'look-up', 'a locked lesson cannot be picked');
  p.pick = 'dribble-to-space';
  assert.equal(nextSkill(p, PATH, 101), 'dribble-to-space');
});

test('reviews come back after 1, 3, 7... days, most overdue first', () => {
  const p = defaultProgress();
  finishSession(p, 'look-up', 6, 6, 100); finishSession(p, 'dribble-to-space', 6, 6, 100);
  assert.deepEqual(reviewsDue(p, PATH, 'take-him-on', 100), []);
  assert.deepEqual(reviewsDue(p, PATH, 'take-him-on', 101).sort(), ['dribble-to-space', 'look-up']);
  finishSession(p, 'look-up', 6, 6, 101);           // box 2: next review 3 days later
  assert.deepEqual(reviewsDue(p, PATH, null, 103), ['dribble-to-space']);
  assert.deepEqual(reviewsDue(p, PATH, null, 104), ['dribble-to-space', 'look-up']);
});

test('old saves (before levels) still load and play', () => {
  const p = defaultProgress();
  p.skills['look-up'] = { box: 3, last: 4, sessions: 4, firstTry: 20, rounds: 24 };
  assert.equal(level(p, 'look-up'), 3);
  assert.ok(nextSkill(p, PATH, 100));
});

test('a review round counts as practice: the lesson waits for its next gap; a miss brings it back sooner', () => {
  const p = defaultProgress();
  finishSession(p, 'look-up', 6, 6, 100); finishSession(p, 'look-up', 6, 6, 101); // box 2: gap of 3 days
  assert.deepEqual(reviewsDue(p, PATH, null, 104), ['look-up']);
  reviewed(p, 'look-up', true, 104);
  assert.deepEqual(reviewsDue(p, PATH, null, 105), []);
  reviewed(p, 'look-up', false, 107);
  assert.equal(p.skills['look-up'].box, 1); assert.equal(level(p, 'look-up'), 2);
  assert.deepEqual(reviewsDue(p, PATH, null, 108), ['look-up']);
});

test('a lesson is a skill once passed (4 of 6): that opens the next lesson; a miss means play it again', () => {
  const p = defaultProgress();
  let r = finishSession(p, 'look-up', 3, 6, 100);
  assert.equal(level(p, 'look-up'), 0); assert.equal(r.unlocked, false);
  assert.equal(isOpen(p, PATH, 1), false, 'next lesson stays locked');
  assert.equal(nextSkill(p, PATH, 100), 'look-up', 'PLAY repeats it');
  r = finishSession(p, 'look-up', 4, 6, 100);
  assert.equal(r.unlocked, true); assert.equal(level(p, 'look-up'), 1);
  assert.ok(isOpen(p, PATH, 1)); assert.deepEqual([...skills(p, PATH)], ['look-up']);
});

// ---------- daily training ----------
import { graduated, playOpen, trainingPlan, trained, sureness } from '../js/progress.js';
import { BUILDS } from '../js/skills.js';
const passAll = (p, day) => { for (const s of PATH) finishSession(p, s.id, 6, 6, day); };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('training starts once every lesson is passed; Match and Cup open after a session that day', () => {
  const p = defaultProgress();
  assert.equal(graduated(p, PATH), false);
  passAll(p, 100);
  assert.equal(graduated(p, PATH), true);
  assert.equal(playOpen(p, 100), false);
  p.openDay = 100;
  assert.equal(playOpen(p, 100), true); assert.equal(playOpen(p, 101), false, 'a new day needs a new session');
  p.settings.alwaysOpen = true; assert.equal(playOpen(p, 101), true);
});

test('training picks 3 different lessons, favoring the ones he keeps missing', () => {
  const p = defaultProgress(); passAll(p, 100);
  for (let k = 0; k < 4; k++) trained(p, 'see-the-trap', [false, false], { day: 101 + k });
  let trap = 0;
  for (let i = 0; i < 300; i++) {
    const plan = trainingPlan(p, PATH, { day: 106, builds: BUILDS });
    assert.equal(plan.length, 3); assert.equal(new Set(plan).size, 3);
    if (plan.includes('see-the-trap')) trap++;
  }
  assert.equal(trap, 300, `missed lesson picked in ${trap} of 300`);
  assert.ok(sureness(p, 'see-the-trap') < .2);
});

test('basic lessons inside later ones (Look up) rarely get their own turn', () => {
  const p = defaultProgress(); passAll(p, 100);
  // A fixed sequence of "random" numbers: with real ones, this count went over the limit about 1 run in 20.
  let seed = 7, look = 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < 4000; i++) if (trainingPlan(p, PATH, { day: 101, builds: BUILDS, rnd }).includes('look-up')) look++;
  assert.ok(look < 400, `look-up picked ${look} of 4000 times`);
});

test('training moves a due lesson up a star when all right, down when all missed, and refreshes what it builds on', () => {
  const p = defaultProgress(); passAll(p, 100);
  const r = trained(p, 'forward-first', [true, true], { day: 101, builds: BUILDS });
  assert.ok(r.leveledUp); assert.equal(level(p, 'forward-first'), 2);
  assert.equal(p.skills['look-up'].day, 101, 'look-up counts as practiced');
  assert.equal(trained(p, 'forward-first', [true, true], { day: 101, builds: BUILDS }).leveledUp, false, 'once a day');
  trained(p, 'one-goes', [false, false], { day: 101, builds: BUILDS });
  assert.equal(p.skills['one-goes'].box, 0); assert.equal(level(p, 'one-goes'), 1, 'stars never go down');
});

test('once everything is gold and sure, training is still a full mix', () => {
  const p = defaultProgress(); passAll(p, 100); passAll(p, 101); passAll(p, 102);
  for (const s of PATH) p.skills[s.id].recent = [1, 1, 1, 1, 1, 1, 1, 1];
  const seen = new Set();
  for (let i = 0; i < 200; i++) trainingPlan(p, PATH, { day: 103, builds: BUILDS }).forEach(id => seen.add(id));
  assert.ok(seen.size >= 12, `${seen.size} lessons seen`);
  assert.equal(trainingPlan(p, PATH, { day: 103, builds: BUILDS, rnd: seq(0) }).length, 3);
});
