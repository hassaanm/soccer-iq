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
