// Saved progress in localStorage. Review spacing counts sessions played, not days (Leitner boxes).
const KEY = 'soccer-iq:v1';
export const INTERVALS = [0, 1, 2, 4, 8]; // sessions to wait before a skill in each box comes back
export const MASTER_BOX = 3;

export function defaultProgress() {
  return { v: 1, us: 'barca', them: 'madrid', sessions: 0, skills: {}, stickers: [],
    settings: { voice: true, rounds: 6, skill: null } };
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

export function skillState(p, id) {
  return p.skills[id] || (p.skills[id] = { box: 0, last: -1, sessions: 0, firstTry: 0, rounds: 0 });
}

export const isMastered = (p, id) => { const s = p.skills[id]; return !!s && s.box >= MASTER_BOX && s.sessions >= 2; };

// The skill to teach next: the grown-up's pick if set, else the first ready skill not yet mastered.
export function nextSkill(p, path) {
  const ready = path.filter(s => s.ready);
  if (p.settings.skill && ready.some(s => s.id === p.settings.skill)) return p.settings.skill;
  return (ready.find(s => !isMastered(p, s.id)) || ready[ready.length - 1]).id;
}

// Mastered skills whose review is due this session.
export function reviewsDue(p, path, current) {
  return path.filter(s => s.ready && s.id !== current && isMastered(p, s.id))
    .filter(s => p.sessions - p.skills[s.id].last >= INTERVALS[p.skills[s.id].box]).map(s => s.id);
}

// After a session: move the skill up a box for 75%+ first-try, down for under 50%.
export function finishSession(p, id, firstTry, rounds) {
  p.sessions++;
  const s = skillState(p, id);
  s.sessions++; s.last = p.sessions; s.firstTry += firstTry; s.rounds += rounds;
  const rate = rounds ? firstTry / rounds : 0;
  if (rate >= 0.75) s.box = Math.min(INTERVALS.length - 1, s.box + 1);
  else if (rate < 0.5) s.box = Math.max(0, s.box - 1);
  return s;
}
