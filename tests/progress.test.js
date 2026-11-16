import test from 'node:test';
import assert from 'node:assert/strict';
import { load, save, finishSession, nextSkill, isMastered, defaultProgress, level, reviewsDue, reviewed, isOpen, skills, catchUp, MERGED } from '../js/progress.js';
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

// ---------- saved games across path changes (lessons added, moved and merged: see catchUp) ----------
// The path saves knew in v58 (with `known`), and before v54 (without it).
const V58 = ['look-up', 'dribble-to-space', 'take-him-on', 'shoot-close', 'get-goal-side', 'steal-it', 'won-it-go', 'peek-and-turn', 'see-the-trap',
  'get-open', 'pass-to-open', 'lead-pass', 'give-and-go', 'one-goes', 'mark-the-free-one', 'forward-first'];
const V53 = V58.filter(id => id !== 'lead-pass');
const at = id => PATH.findIndex(s => s.id === id);
// Was lesson i open on an old path (ids), by the rule the game used then?
const openOn = (p, ids, i) => i === 0 || level(p, ids[i - 1]) >= 1 || (p.skills[ids[i]]?.sessions || 0) > 0 || !!p.opened?.includes(ids[i]);
// A save from an old path: the first k lessons passed (on days 100+), lesson k played but not passed if `extra`.
function oldSave(ids, k, extra, known = true) {
  const p = defaultProgress();
  ids.slice(0, k).forEach((id, i) => finishSession(p, id, 6, 6, 100 + i));
  if (extra && ids[k]) finishSession(p, ids[k], 1, 6, 200);
  if (known) p.known = [...ids];
  return p;
}
const reload = p => { const st = mem(); save(p, st); return catchUp(load(st), PATH); };

test('saved games: nothing that was open closes, stars and levels stay, and the new lessons open by the usual rule', () => {
  for (const [ids, known] of [[V58, true], [V53, false]]) for (let k = 0; k <= ids.length; k++) for (const extra of [false, true]) {
    const before = oldSave(ids, k, extra, known);
    const open = ids.filter((_, i) => openOn(before, ids, i)), lv = Object.fromEntries(ids.map(id => [id, level(before, id)]));
    const now = reload(before), tag = `${known ? 'v58' : 'v53'} k=${k}${extra ? '+' : ''}`;
    for (const id of open) { const to = MERGED[id] || id; assert.ok(isOpen(now, PATH, at(to)), `${tag}: ${id} was open and closed`); }
    for (const id of ids.filter(id => !MERGED[id])) assert.ok(level(now, id) >= lv[id], `${tag}: ${id} lost stars`);
    for (const [from, to] of Object.entries(MERGED)) assert.equal(level(now, to), Math.max(lv[from], lv[to]), `${tag}: ${to} keeps the better level`);
    for (const id of ['follow-shot', 'go-to-goal']) {
      assert.equal(isOpen(now, PATH, at(id)), level(now, PATH[at(id) - 1].id) >= 1, `${tag}: ${id} opens once the lesson before it is passed`);
      assert.equal(level(now, id), 0);
      if (Object.keys(before.skills).length) assert.ok(now.fresh.includes(id), `${tag}: ${id} is marked new`);
    }
    assert.ok(!('mark-the-free-one' in now.skills), `${tag}: the merged lesson is gone from the save`);
    // It sticks: saved and loaded again, nothing changes.
    const again = reload(now);
    assert.deepEqual(PATH.map((_, i) => isOpen(again, PATH, i)), PATH.map((_, i) => isOpen(now, PATH, i)), `${tag}: changed on the second load`);
    assert.deepEqual(again.skills, now.skills);
  }
});

test('saved games: a brand new player starts at the start, with nothing marked new', () => {
  const p = catchUp(defaultProgress(), PATH);
  assert.deepEqual(PATH.map((_, i) => isOpen(p, PATH, i)), PATH.map((_, i) => i === 0));
  assert.deepEqual(p.known, PATH.map(s => s.id)); assert.ok(!p.fresh?.length);
  assert.equal(nextSkill(p, PATH, 300), 'look-up');
});

test('saved games: halfway (passed up to "Two defenders? Pass!" in the old order)', () => {
  const now = reload(oldSave(V58, V58.indexOf('see-the-trap') + 1, false));
  // "Get open!" was next in the old order: it stays open, though "Pass to the open friend" now comes before it.
  for (const id of ['get-open', 'pass-to-open', 'follow-shot']) assert.ok(isOpen(now, PATH, at(id)), id);
  for (const id of ['go-to-goal', 'one-goes', 'forward-first', 'lead-pass', 'give-and-go']) assert.ok(!isOpen(now, PATH, at(id)), id);
  assert.equal(nextSkill(now, PATH, 300), 'look-up', 'Level 1 lessons come first, as before');
  for (const id of V58.slice(0, V58.indexOf('see-the-trap') + 1)) finishSession(now, id, 6, 6, 300);
  assert.equal(nextSkill(now, PATH, 400), 'follow-shot', 'then the new lesson, the first open one not played');
});

test('saved games: passed "Pass in front!" and "Pass and go!" but not the guard lessons', () => {
  const p = oldSave(V58, V58.indexOf('give-and-go') + 1, false), now = reload(p);
  for (const id of ['lead-pass', 'give-and-go']) { assert.ok(isOpen(now, PATH, at(id)), id); assert.equal(level(now, id), 1); }
  assert.ok(isOpen(now, PATH, at('one-goes')), 'One goes, one guards stays open (it was next)');
  assert.ok(isOpen(now, PATH, at('go-to-goal')), 'the new lesson after "Get open!" is open');
  assert.ok(!isOpen(now, PATH, at('forward-first')));
});

test('saved games: passed everything; the new lessons come up next, then training again', () => {
  const p = defaultProgress(); V58.forEach((id, i) => { finishSession(p, id, 6, 6, 100 + i); finishSession(p, id, 6, 6, 200 + i); }); p.known = [...V58];
  const now = reload(p);
  assert.ok(PATH.every((_, i) => isOpen(now, PATH, i)));
  assert.ok(!graduated(now, PATH)); assert.equal(nextSkill(now, PATH, 300), 'follow-shot');
  for (const id of ['follow-shot', 'go-to-goal']) finishSession(now, id, 6, 6, 300);
  assert.ok(graduated(now, PATH)); assert.equal(reload(now).fresh.length, 0, 'played: no longer new');
});

test('saved games: "Guard the open player" folds into "One goes, one guards" (the better of the two, passed if either was)', () => {
  const p = defaultProgress(); p.known = [...V58];
  finishSession(p, 'mark-the-free-one', 6, 6, 100); finishSession(p, 'mark-the-free-one', 6, 6, 101); // 2 stars
  finishSession(p, 'one-goes', 2, 6, 102);                                                               // played, not passed
  p.pick = 'mark-the-free-one'; p.stickers.push({ emoji: '🛡️', skill: 'mark-the-free-one', at: 1 });
  const now = reload(p);
  assert.equal(level(now, 'one-goes'), 2); assert.equal(now.skills['one-goes'].sessions, 3);
  assert.equal(now.pick, 'one-goes'); assert.equal(now.stickers[0].skill, 'one-goes');
  const q = defaultProgress(); q.known = [...V58]; finishSession(q, 'one-goes', 6, 6, 100);           // only the other one
  assert.equal(level(reload(q), 'one-goes'), 1);
  const r = defaultProgress(); r.known = [...V58]; finishSession(r, 'mark-the-free-one', 1, 6, 100);  // played, not passed
  assert.equal(level(reload(r), 'one-goes'), 0); assert.ok(isOpen(reload(r), PATH, at('one-goes')), 'it was played: it stays open');
});

import { logChoice, logRange, logTotals, counts, medianTime, strength, LOG_DAYS } from '../js/progress.js';
test('decision log: counts by idea and kind of play, times, looking first; old days fold into weeks', () => {
  const p = defaultProgress();
  logChoice(p, { id: 'look-up', mode: 'lesson', grade: 'best', sec: 1.2, looked: true }, 500);
  logChoice(p, { id: 'look-up', mode: 'match', grade: 'miss', sec: 3.1, looked: false }, 500);
  logChoice(p, { id: 'look-up', mode: 'match', grade: 'okay', sec: 2.0, looked: true }, 500);
  logChoice(p, { id: 'steal-it', mode: 'training', grade: 'best', sec: .4, looked: null }, 501);
  const e = p.log.days[500]['look-up'];
  assert.deepEqual(e.r, { lesson: [1, 0, 0], match: [0, 1, 1] });
  assert.deepEqual(e.u, [2, 3]); assert.equal(medianTime(e), 2.25);
  assert.deepEqual(p.log.days[501]['steal-it'].u, [0, 0]);
  assert.deepEqual(counts(e), { best: 1, okay: 1, miss: 1, n: 3 });
  const st = strength(e); assert.equal(st.n, 3); assert.ok(Math.abs(st.score - (1 + 1) / 5) < 1e-9); // matches count twice
  logChoice(p, { id: 'look-up', mode: 'lesson', grade: 'best', sec: 1 }, 500 + LOG_DAYS + 3);
  assert.equal(p.log.days[500], undefined); assert.equal(p.log.days[501], undefined);
  const wk = Object.keys(p.log.weeks).map(Number); assert.equal(wk.length, 1); assert.ok(wk[0] <= 500 && wk[0] > 493);
  assert.deepEqual(logTotals(p)['look-up'], { best: 2, okay: 1, miss: 1, n: 4 });
  assert.deepEqual(Object.keys(logRange(p, 500 + LOG_DAYS, 1e9)), ['look-up']);
  assert.ok(JSON.stringify(p.log).length < 600);
});
test('an old save loads with an empty decision log', () => {
  const st = mem(); st.setItem('soccer-iq:v1', JSON.stringify({ v: 1, us: 'spain', skills: {}, settings: {} }));
  assert.deepEqual(load(st).log, { days: {}, weeks: {} });
});
