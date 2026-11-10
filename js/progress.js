// Saved progress in localStorage, and the plan for what to play next (research/curriculum-plan.md).
// Each lesson sits in a Leitner box. A good session moves it up one box, at most once per day, so levels need
// separate days. Boxes set the review gaps in days; the level shown is the highest box ever reached, so a bad
// day never takes stars away.
import { shuffle } from './geom.js';
const KEY = 'soccer-iq:v1';
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days before a lesson in each box comes back as review rounds
const MASTER_BOX = 3;
export const PASS = 2 / 3; // right on the first try in at least 4 of 6 rounds passes a session

export function defaultProgress() {
  return { v: 1, us: 'barca', them: 'madrid', sessions: 0, skills: {}, stickers: [], pick: null, trophies: [], cup: null, openDay: -1,
    settings: { voice: true, sound: true, rounds: 6, skill: null, alwaysOpen: false } };
}

// The art style. 'pro' (Stadium) is the default; an older style counts only if a grown-up picked it after Stadium
// became the default (`artPick`), so a style that was saved earlier just for being the first in the list does not.
export const artOf = s => (s.artPick && s.art) || 'pro';

export function load(storage = globalThis.localStorage) {
  const d = defaultProgress();
  try {
    const p = JSON.parse(storage.getItem(KEY));
    if (p && p.v === 1) return { ...d, ...p, settings: { ...d.settings, ...p.settings } };
  } catch { /* private mode or bad data: start fresh */ }
  return d;
}

export function save(p, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

// Today as a whole number of days, in local time (a new day starts at midnight, not at UTC midnight).
export const today = (now = Date.now()) => Math.floor((now - new Date(now).getTimezoneOffset() * 6e4) / 864e5);

function skillState(p, id) {
  const s = p.skills[id] || (p.skills[id] = { box: 0, last: -1, sessions: 0, firstTry: 0, rounds: 0 });
  // Fields added in v30; older saves get them here.
  s.top ??= s.box; s.day ??= -1; s.days ??= 0; s.upDay ??= -1; s.today ??= 0;
  s.recent ??= []; // first-try results (1 right, 0 missed) of the last rounds, newest last: how sure he is now
  return s;
}
// The first time a lesson is touched on a new day: one more day of practice, and today's count starts again.
function touchDay(s, day) { if (s.day !== day) { s.days++; s.day = day; s.today = 0; } }
const played = (p, id) => (p.skills[id]?.sessions || 0) > 0;

// Stars 0–3: 0 = not passed yet (or never played); 1 = passed; 2 and 3 = passed again on later days.
export const level = (p, id) => (played(p, id) ? Math.min(3, skillState(p, id).top) : 0);
export const isMastered = (p, id) => played(p, id) && skillState(p, id).top >= MASTER_BOX;
// A passed lesson is a skill he has: it opens the next lesson and adds its part to matches (see game.js `has`).
export const passed = (p, id) => level(p, id) >= 1;
export const skills = (p, path) => new Set(path.filter(s => passed(p, s.id)).map(s => s.id));

// A lesson opens once the one before it is passed (or once it has been played itself, for older saves).
export const isOpen = (p, path, i) => i === 0 || passed(p, path[i - 1].id) || played(p, path[i].id);

// What PLAY starts (the "coach's pick"): the grown-up's locked lesson, then the lesson he picked, then a lesson
// not passed yet or at 1 star that he hasn't finished today, then the next new lesson, then the most overdue one.
export function nextSkill(p, path, day = today()) {
  const ready = path.filter(s => s.ready), valid = id => ready.some(s => s.id === id);
  if (p.settings.skill && valid(p.settings.skill)) return p.settings.skill;
  if (p.pick && valid(p.pick) && isOpen(p, path, path.findIndex(s => s.id === p.pick))) return p.pick;
  const doneToday = id => { const s = skillState(p, id); return s.day === day && (s.upDay === day || s.today >= 2); };
  const learning = ready.find(s => played(p, s.id) && level(p, s.id) <= 1 && !doneToday(s.id));
  if (learning) return learning.id;
  const fresh = ready.find(s => !played(p, s.id) && isOpen(p, path, path.indexOf(s)));
  if (fresh) return fresh.id;
  const due = reviewsDue(p, path, null, day).filter(id => skillState(p, id).day !== day);
  if (due.length) return due[0];
  return [...ready].sort((a, b) => level(p, a.id) - level(p, b.id))[0].id;
}

// Passed lessons whose review is due, most overdue first.
export function reviewsDue(p, path, current, day = today()) {
  const over = id => { const s = skillState(p, id); return day - s.day - INTERVALS[Math.min(s.box, INTERVALS.length - 1)]; };
  return path.filter(s => s.ready && s.id !== current && passed(p, s.id) && over(s.id) >= 0)
    .sort((a, b) => over(b.id) - over(a.id)).map(s => s.id);
}

// A review round of an older lesson (inside another lesson's session). It counts as practice today, so the
// lesson isn't due again tomorrow; a miss moves it down a box so it comes back sooner. Levels never change here.
export function reviewed(p, id, right, day = today()) {
  const s = skillState(p, id);
  touchDay(s, day);
  if (!right) s.box = Math.max(0, s.box - 1);
  remember(s, right);
  return s;
}
// Adds a lesson's own rounds to how sure he is (lesson sessions; reviews and training do it themselves).
export const note = (p, id, results) => remember(skillState(p, id), ...results);
const remember = (s, ...right) => { s.recent.push(...right.map(r => (r ? 1 : 0))); s.recent.splice(0, s.recent.length - 8); };

// ---------- daily training (once every lesson is passed) ----------
// Every ready lesson passed: PLAY becomes "Today's training" (unless a lesson is picked).
export const graduated = (p, path) => path.filter(s => s.ready).every(s => passed(p, s.id));
// Match and Cup open for the day after a lesson or a training session (or always, if a grown-up says so).
export const playOpen = (p, day = today()) => !!p.settings.alwaysOpen || p.openDay === day;
// How sure he is of a lesson, 0–1, from his last rounds of it (a guess of .7 until there are 3).
export const sureness = (p, id) => { const r = skillState(p, id).recent; return r.length < 3 ? .7 : r.reduce((a, b) => a + b, 0) / r.length; };

// Today's lessons for training: the ones that need it most. A lesson needs practice when its review gap is up,
// when he has been missing it lately, and while it is below gold (box 3). A lesson that later lessons build on
// (`builds`: lesson -> the earlier lessons it includes) counts as practiced whenever those come up, so it rarely
// needs its own turn: "Look up" is part of almost everything. Once all are gold and sure, it is a random mix.
// Returned in a mixed order, so the shaky lessons aren't always first.
export function trainingPlan(p, path, { day = today(), lessons = 3, builds = {}, rnd = Math.random } = {}) {
  const ids = path.filter(s => s.ready && passed(p, s.id)).map(s => s.id);
  const inside = new Set(ids.flatMap(id => builds[id] || []));
  const need = id => {
    const s = skillState(p, id), gap = INTERVALS[Math.min(s.box, INTERVALS.length - 1)], late = (day - s.day) / Math.max(1, gap);
    const w = (late >= 1 ? 2 + Math.min(late, 3) : late) + 4 * (1 - sureness(p, id)) + (s.box < MASTER_BOX ? .6 : 0) + .15;
    return inside.has(id) && sureness(p, id) >= .6 ? w * .25 : w;
  };
  // Lessons he has been missing lately always come back (up to 2 a day, the shakiest first); the rest is weighted.
  const shaky = ids.filter(id => sureness(p, id) < .5).sort((a, b) => sureness(p, a) - sureness(p, b)).slice(0, Math.min(2, lessons));
  const pool = ids.filter(id => !shaky.includes(id)).map(id => ({ id, w: need(id) })), out = [...shaky];
  while (out.length < lessons && pool.length) {
    let r = rnd() * pool.reduce((a, b) => a + b.w, 0), i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    out.push(pool.splice(i, 1)[0].id);
  }
  return shuffle(out, rnd);
}

// After a training session: each lesson's first-try results. All right while its gap was up moves it up a box
// (its stars can grow here too); none right moves it down. A right answer also counts as practice for the earlier
// lessons it includes, so those wait for their next gap.
export function trained(p, id, results, { day = today(), builds = {} } = {}) {
  const s = skillState(p, id), gap = INTERVALS[Math.min(s.box, INTERVALS.length - 1)], wasDue = day - s.day >= gap;
  touchDay(s, day);
  s.today++; s.firstTry += results.filter(Boolean).length; s.rounds += results.length;
  const before = level(p, id);
  if (results.length && results.every(Boolean) && wasDue && s.upDay !== day) { s.box = Math.min(INTERVALS.length - 1, s.box + 1); s.upDay = day; }
  else if (!results.some(Boolean)) s.box = Math.max(0, s.box - 1);
  s.top = Math.max(s.top, s.box);
  remember(s, ...results);
  if (results.some(Boolean)) for (const b of builds[id] || []) if (p.skills[b]) touchDay(skillState(p, b), day);
  return { leveledUp: level(p, id) > before, level: level(p, id) };
}

// After a session: 4 of 6 (2/3) right on the first try moves the lesson up a box (once a day); under half moves
// it down. Returns the lesson's state, plus `unlocked` the first time it is passed and `leveledUp` for stars 2–3.
export function finishSession(p, id, firstTry, rounds, day = today()) {
  p.sessions++;
  const s = skillState(p, id), before = level(p, id);
  touchDay(s, day);
  s.today++; s.sessions++; s.last = p.sessions; s.firstTry += firstTry; s.rounds += rounds;
  const rate = rounds ? firstTry / rounds : 0;
  if (rate >= PASS - 1e-9 && s.upDay !== day) { s.box = Math.min(INTERVALS.length - 1, s.box + 1); s.upDay = day; }
  else if (rate < 0.5) s.box = Math.max(0, s.box - 1);
  s.top = Math.max(s.top, s.box);
  const now = level(p, id);
  return { ...s, unlocked: before === 0 && now >= 1, leveledUp: before > 0 && now > before, level: now, passedNow: rate >= PASS - 1e-9 };
}
