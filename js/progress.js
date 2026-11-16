// Saved progress in localStorage, and the plan for what to play next (research/curriculum-plan.md).
// Each lesson sits in a Leitner box. A good session moves it up one box, at most once per day, so levels need
// separate days. Boxes set the review gaps in days; the level shown is the highest box ever reached, so a bad
// day never takes stars away.
import { shuffle, SAVE_KEY } from './geom.js';
const KEY = SAVE_KEY;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // days before a lesson in each box comes back as review rounds
const MASTER_BOX = 3;
export const PASS = 2 / 3; // right on the first try in at least 4 of 6 rounds passes a session

export function defaultProgress() {
  return { v: 1, us: 'barca', them: 'madrid', sessions: 0, skills: {}, stickers: [], pick: null, trophies: [], cup: null, openDay: -1, log: { days: {}, weeks: {} },
    settings: { voice: true, sound: true, rounds: 6, skill: null, alwaysOpen: false, size: '3v3', think: 'normal' } }; // size: see geom.js SIZES; think: how long he has to choose (v64, window.js THINK)
}

export function load(storage = globalThis.localStorage) {
  const d = defaultProgress();
  try {
    const p = JSON.parse(storage.getItem(KEY));
    if (p && p.v === 1) return { ...d, ...p, settings: { ...d.settings, ...p.settings }, log: { days: {}, weeks: {}, ...p.log } };
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

// A lesson opens once the one before it is passed (or once it has been played itself, for older saves), or when a
// new lesson was put in before it after it had already opened (see catchUp).
// (A lesson only for some sizes, `keeper`, is never the one a later lesson waits for: it waits for the one before it.)
export const isOpen = (p, path, i) => { const prev = path.slice(0, i).reverse().find(s => !s.keeper); return i === 0 || !prev || passed(p, prev.id) || played(p, path[i].id) || !!p.opened?.includes(path[i].id); };

// When the path changes (lessons added, moved or merged), a save keeps everything it had: each lesson that was open
// on the path the save knew stays open, wherever it is now. `known` is that path, in its order. Saves from before it
// was kept (v58 and earlier) knew KNOWN_BEFORE. A lesson merged into another (MERGED) passes its stars, level and
// "open" on to the lesson that keeps them (the better of the two). Levels and stars are never lowered, and a new
// lesson opens by the usual rule (the lesson before it is passed). `fresh` lists the lessons new to this save, not
// played yet, so the lesson sheet can mark them.
export const MERGED = { 'mark-the-free-one': 'one-goes' };
const KNOWN_BEFORE = ['look-up', 'dribble-to-space', 'take-him-on', 'shoot-close', 'get-goal-side', 'steal-it', 'won-it-go', 'peek-and-turn',
  'see-the-trap', 'get-open', 'pass-to-open', 'give-and-go', 'one-goes', 'mark-the-free-one', 'forward-first']; // the path before "Pass in front!" (v54), when saves started keeping `known`
export function catchUp(p, path) {
  const ids = path.map(s => s.id);
  if (!p.known && !Object.keys(p.skills || {}).length) { p.known = ids; return p; } // a new player: nothing to keep
  const old = p.known || KNOWN_BEFORE, to = id => MERGED[id] || id;
  if (old.join() !== ids.join() || Object.keys(MERGED).some(id => p.skills[id])) {
    const open = new Set(old.filter((id, i) => i === 0 || passed(p, old[i - 1]) || played(p, id) || p.opened?.includes(id)).map(to));
    for (const [from, into] of Object.entries(MERGED)) merge(p, from, into);
    p.opened = [...new Set((p.opened || []).map(to))];
    for (const k of ['pick']) if (MERGED[p[k]]) p[k] = MERGED[p[k]];
    if (MERGED[p.settings?.skill]) p.settings.skill = MERGED[p.settings.skill];
    for (const st of p.stickers || []) if (MERGED[st.skill]) st.skill = MERGED[st.skill];
    ids.forEach((id, i) => { if (open.has(id) && !isOpen(p, path, i)) p.opened.push(id); });
    p.fresh = [...new Set([...(p.fresh || []), ...ids.filter(id => !old.includes(id) && !old.some(o => MERGED[o] === id))])];
  }
  p.known = ids;
  if (p.fresh) p.fresh = p.fresh.filter(id => ids.includes(id) && !played(p, id));
  return p;
}
// Folds lesson `from` into `into`: the better state (more stars, then a higher box) is kept with its days and recent
// results; the counts add up, so it has been played if either had.
function merge(p, from, into) {
  const b = p.skills[from]; if (!b) return;
  delete p.skills[from];
  const a = p.skills[into]; if (!a) { p.skills[into] = b; return; }
  skillState(p, into); p.skills[from] = b; skillState(p, from); delete p.skills[from];
  const rank = s => (s.sessions > 0 ? 1 : 0) * 100 + s.top * 10 + s.box, best = rank(b) > rank(a) ? b : a;
  p.skills[into] = { ...best, top: Math.max(a.sessions ? a.top : 0, b.sessions ? b.top : 0), sessions: a.sessions + b.sessions, firstTry: a.firstTry + b.firstTry, rounds: a.rounds + b.rounds,
    days: a.days + b.days, last: Math.max(a.last, b.last), recent: [...best.recent] };
}

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
  touchDay(s, day); practised(p, id, day);
  if (!right) s.box = Math.max(0, s.box - 1);
  remember(s, right);
  return s;
}
// Adds a lesson's own rounds to how sure he is (lesson sessions; reviews and training do it themselves).
export const note = (p, id, results) => remember(skillState(p, id), ...results);
const remember = (s, ...right) => { s.recent.push(...right.map(r => (r ? 1 : 0))); s.recent.splice(0, s.recent.length - 8); };
// The idea he missed most in a match (flows.js): from the next day it comes back in his practice, in today's training
// (trainingPlan) or as a review round in a lesson (flows.js), until he has practised it on a later day.
export const focus = (p, id, day = today()) => { p.focus = { id, day }; };
const practised = (p, id, day) => { if (p.focus?.id === id && day > p.focus.day) p.focus = null; };

// ---------- daily training (once every lesson is passed) ----------
// Every ready lesson passed: PLAY becomes "Today's training" (unless a lesson is picked).
export const graduated = (p, path) => path.filter(s => s.ready).every(s => passed(p, s.id));
// The Cup opens for the day after a lesson or a training session (or always, if a grown-up says so). (Up to v63 this
// opened Match too.)
export const playOpen = (p, day = today()) => !!p.settings.alwaysOpen || p.openDay === day;
// Play first (v64): Match is open every day from the start, once his first lesson has ever been passed; training is
// short (TRAINING_ROUNDS) and sits between matches. To go back to "Match after training", set MATCH_ANY_DAY to false
// and TRAINING_ROUNDS to null (training then plays settings.rounds again).
export const MATCH_ANY_DAY = true, TRAINING_ROUNDS = 4, TRAINING_IDEAS = 2; // (4 rounds: 2 ideas, 2 rounds each)
export const matchOpen = (p, day = today()) => playOpen(p, day) || (MATCH_ANY_DAY && Object.keys(p.skills || {}).some(id => passed(p, id)));
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
  // The idea he missed most in a match on an earlier day (see focus) comes back too, if it isn't in already.
  const f = p.focus && p.focus.day < day && ids.includes(p.focus.id) && !shaky.includes(p.focus.id) ? [p.focus.id] : [];
  const pool = ids.filter(id => !shaky.includes(id) && !f.includes(id)).map(id => ({ id, w: need(id) })), out = [...f, ...shaky].slice(0, lessons);
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
  touchDay(s, day); practised(p, id, day);
  s.today++; s.firstTry += results.filter(Boolean).length; s.rounds += results.length;
  const before = level(p, id);
  // (v64) A box moves only on two answers or more: one answer (right or wrong) is too little to change his review gap.
  if (results.length >= 2 && results.every(Boolean) && wasDue && s.upDay !== day) { s.box = Math.min(INTERVALS.length - 1, s.box + 1); s.upDay = day; }
  else if (results.length >= 2 && !results.some(Boolean)) s.box = Math.max(0, s.box - 1);
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
  touchDay(s, day); practised(p, id, day);
  s.today++; s.sessions++; s.last = p.sessions; s.firstTry += firstTry; s.rounds += rounds;
  const rate = rounds ? firstTry / rounds : 0;
  if (rate >= PASS - 1e-9 && s.upDay !== day) { s.box = Math.min(INTERVALS.length - 1, s.box + 1); s.upDay = day; }
  else if (rate < 0.5) s.box = Math.max(0, s.box - 1);
  s.top = Math.max(s.top, s.box);
  const now = level(p, id);
  return { ...s, unlocked: before === 0 && now >= 1, leveledUp: before > 0 && now > before, level: now, passedNow: rate >= PASS - 1e-9 };
}

// ---------- decision log (for the grown-ups page, ui/report.js) ----------
// Every choice he makes, per day and per idea (lesson id): { r, s, u }
//   r  { lesson, training, match }: [best, okay, missed] in each (a lesson or training round counts its first try only)
//   s  how long he took, from the decision opening to his tap (real seconds): counts in half-second bins, the last one
//      15 s and more (v64: windows run to about 15 s at the longest; logs from before v64 have 13 bins, the last 6 s and more)
//   u  [looked first, choices where looking applies] (looking up, or peeking before a turn; not for a steal)
//   t  times the defender got there before he chose (v64: kept apart from his choices, so it never counts as a miss here)
// About 60–100 bytes per idea per day played. Days older than LOG_DAYS fold into weekly totals (weeks, keyed by the
// first day of the week), so the log stays small however long he plays.
export const LOG_DAYS = 90, BIN = .5, BINS = 31;
const GRADE = { best: 0, okay: 1, miss: 2 };
const entry = () => ({ r: {}, s: Array(BINS).fill(0), u: [0, 0], t: 0 });
function addEntry(to, e) {
  for (const [m, v] of Object.entries(e.r)) { const t = (to.r[m] ||= [0, 0, 0]); v.forEach((n, i) => { t[i] += n; }); }
  e.s.forEach((n, i) => { to.s[i] = (to.s[i] || 0) + n; }); to.u[0] += e.u[0]; to.u[1] += e.u[1]; to.t = (to.t || 0) + (e.t || 0);
  return to;
}
export function logChoice(p, { id, mode, grade, sec, looked, timeout = false }, day = today()) {
  if (!id || !(grade in GRADE)) return;
  const log = (p.log ||= { days: {}, weeks: {} }), e = ((log.days[day] ||= {})[id] ||= entry());
  if (timeout) { e.t = (e.t || 0) + 1; return; } // (out of time: counted on its own)
  (e.r[mode] ||= [0, 0, 0])[GRADE[grade]]++;
  if (sec >= 0) { if (e.s.length < BINS) e.s.push(...Array(BINS - e.s.length).fill(0)); e.s[Math.min(BINS - 1, Math.floor(sec / BIN))]++; }
  if (looked != null) { e.u[1]++; if (looked) e.u[0]++; }
  for (const d of Object.keys(log.days)) {
    if (+d > day - LOG_DAYS) continue;
    const wk = +d - ((+d % 7) + 7) % 7, w = (log.weeks[wk] ||= {});
    for (const [id2, e2] of Object.entries(log.days[d])) addEntry((w[id2] ||= entry()), e2);
    delete log.days[d];
  }
}
// Each idea's log over the days from..to (whole weeks count when their first day is in range), added up.
export function logRange(p, from = -Infinity, to = Infinity) {
  const out = {}, log = p.log || { days: {}, weeks: {} };
  for (const src of [log.days, log.weeks]) for (const [d, ids] of Object.entries(src)) {
    if (+d < from || +d > to) continue;
    for (const [id, e] of Object.entries(ids)) addEntry((out[id] ||= entry()), e);
  }
  return out;
}
// Each idea's best, okay and missed choices over the whole log.
export const logTotals = p => Object.fromEntries(Object.entries(logRange(p)).map(([id, e]) => [id, counts(e)]));
// An entry's counts: { best, okay, miss, n } over every kind of play, or one (`mode`).
export function counts(e, mode) {
  const c = { best: 0, okay: 0, miss: 0 };
  for (const [m, v] of Object.entries(e.r)) if (!mode || m === mode) { c.best += v[0]; c.okay += v[1]; c.miss += v[2]; }
  return { ...c, n: c.best + c.okay + c.miss };
}
// The median time to choose, in seconds (the middle of its half-second bin), or null.
export function medianTime(e) {
  const n = e.s.reduce((a, b) => a + b, 0); if (!n) return null;
  let k = 0; for (let i = 0; i < e.s.length; i++) { k += e.s[i]; if (k * 2 >= n) return (i + .5) * BIN; }
  return null;
}
// How strong an idea is now: the share of good choices (best 1, okay half), match choices counting twice and
// training one and a half (he chooses most freely in a match). n: how many choices it rests on.
export function strength(e) {
  const W = { lesson: 1, training: 1.5, match: 2 }; let got = 0, all = 0, n = 0;
  for (const [m, v] of Object.entries(e.r)) { const w = W[m] || 1; got += w * (v[0] + v[1] / 2); all += w * (v[0] + v[1] + v[2]); n += v[0] + v[1] + v[2]; }
  return { score: all ? got / all : null, n };
}
