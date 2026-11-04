// Saved progress in localStorage, and the plan for what to play next (research/curriculum-plan.md).
// Each lesson sits in a Leitner box. A good session moves it up one box, at most once per day, so levels need
// separate days. Boxes set the review gaps in days; the level shown is the highest box ever reached, so a bad
// day never takes stars away.
const KEY = 'soccer-iq:v1';
export const INTERVALS = [0, 1, 3, 7, 14, 30]; // days before a lesson in each box comes back as review rounds
export const MASTER_BOX = 3;

export function defaultProgress() {
  return { v: 1, us: 'barca', them: 'madrid', sessions: 0, skills: {}, stickers: [], pick: null,
    settings: { voice: true, sound: true, rounds: 6, skill: null } };
}

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

export function skillState(p, id) {
  const s = p.skills[id] || (p.skills[id] = { box: 0, last: -1, sessions: 0, firstTry: 0, rounds: 0 });
  // Fields added in v30; older saves get them here.
  s.top ??= s.box; s.day ??= -1; s.days ??= 0; s.upDay ??= -1; s.today ??= 0;
  return s;
}
const played = (p, id) => (p.skills[id]?.sessions || 0) > 0;

// Level 1–3 for the lesson tile and the session setup (0 = never played).
export const level = (p, id) => (played(p, id) ? Math.max(1, Math.min(3, skillState(p, id).top)) : 0);
export const isMastered = (p, id) => played(p, id) && skillState(p, id).top >= MASTER_BOX;

// A lesson opens once the one before it has been played (or it has been played itself).
export const isOpen = (p, path, i) => i === 0 || played(p, path[i - 1].id) || played(p, path[i].id);

// What PLAY starts (the "coach's pick"): the grown-up's locked lesson, then the lesson he picked, then a
// Level 1 lesson he hasn't finished today, then the next new lesson, then the most overdue one.
export function nextSkill(p, path, day = today()) {
  const ready = path.filter(s => s.ready), valid = id => ready.some(s => s.id === id);
  if (p.settings.skill && valid(p.settings.skill)) return p.settings.skill;
  if (p.pick && valid(p.pick) && isOpen(p, path, path.findIndex(s => s.id === p.pick))) return p.pick;
  const doneToday = id => { const s = skillState(p, id); return s.day === day && (s.upDay === day || s.today >= 2); };
  const learning = ready.find(s => played(p, s.id) && level(p, s.id) === 1 && !doneToday(s.id));
  if (learning) return learning.id;
  const fresh = ready.find(s => !played(p, s.id) && isOpen(p, path, path.indexOf(s)));
  if (fresh) return fresh.id;
  const due = reviewsDue(p, path, null, day).filter(id => skillState(p, id).day !== day);
  if (due.length) return due[0];
  return [...ready].sort((a, b) => level(p, a.id) - level(p, b.id))[0].id;
}

// Played lessons whose review is due, most overdue first.
export function reviewsDue(p, path, current, day = today()) {
  const over = id => { const s = skillState(p, id); return day - s.day - INTERVALS[Math.min(s.box, INTERVALS.length - 1)]; };
  return path.filter(s => s.ready && s.id !== current && played(p, s.id) && over(s.id) >= 0)
    .sort((a, b) => over(b.id) - over(a.id)).map(s => s.id);
}

// A review round of an older lesson (inside another lesson's session). It counts as practice today, so the
// lesson isn't due again tomorrow; a miss moves it down a box so it comes back sooner. Levels never change here.
export function reviewed(p, id, right, day = today()) {
  const s = skillState(p, id);
  if (s.day !== day) { s.days++; s.day = day; s.today = 0; }
  if (!right) s.box = Math.max(0, s.box - 1);
  return s;
}

// After a session: 75%+ right on the first try moves the lesson up a box (once a day); under 50% moves it down.
// Returns the lesson's state plus `leveledUp` when the level shown on the tile went up.
export function finishSession(p, id, firstTry, rounds, day = today()) {
  p.sessions++;
  const s = skillState(p, id), before = level(p, id);
  if (s.day !== day) { s.days++; s.day = day; s.today = 0; }
  s.today++; s.sessions++; s.last = p.sessions; s.firstTry += firstTry; s.rounds += rounds;
  const rate = rounds ? firstTry / rounds : 0;
  if (rate >= 0.75 && s.upDay !== day) { s.box = Math.min(INTERVALS.length - 1, s.box + 1); s.upDay = day; }
  else if (rate < 0.5) s.box = Math.max(0, s.box - 1);
  s.top = Math.max(s.top, s.box);
  return { ...s, leveledUp: before > 0 && level(p, id) > before, level: level(p, id) };
}
