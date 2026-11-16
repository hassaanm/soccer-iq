// "How is he doing?": the grown-ups page, opened from the grown-ups menu. It reads the decision log in the save
// (progress.js logChoice): the last two weeks against the two before, every idea's strength, and the three ideas to
// work on with the game's own words for the sideline. For a parent, never shown to the child.
import { $, wireSheet } from './dom.js';
import { P } from './store.js';
import { PATH } from '../skills.js';
import { today, logRange, counts, medianTime, strength, level } from '../progress.js';

const ENOUGH = 10;   // choices an idea needs before the page says how strong it is
const LITTLE = 30;   // fewer choices than this in two weeks: the page says it is too early to tell
const pct = x => `${Math.round(x * 100)}%`;
const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
// Up, down or about the same as the two weeks before (nothing to compare with: no mark).
function trend(now, before, near) {
  if (before == null) return '';
  return now > before + near ? '<i class="up">▲</i>' : now < before - near ? '<i class="down">▼</i>' : '<i class="same">=</i>';
}
// Two weeks of play: days played, choices made, share of best choices.
function period(from, to) {
  const days = Object.keys(P.log?.days || {}).filter(d => +d >= from && +d <= to).length;
  const c = Object.values(logRange(P, from, to)).reduce((a, e) => { const k = counts(e); a.n += k.n; a.best += k.best; return a; }, { n: 0, best: 0 });
  return { days, n: c.n, share: c.n ? c.best / c.n : null };
}
const BAND = [[.75, 'strong', 'Strong'], [.5, 'mid', 'Getting there'], [0, 'weak', 'Needs work']];

export function renderReport(day = today()) {
  const now = period(day - 13, day), was = period(day - 27, day - 14), had = was.n > 0;
  const recent = logRange(P, day - 27, day);
  const early = now.n < LITTLE; // too early to tell: no strength ratings at all
  const ideas = PATH.filter(s => s.ready).map(s => {
    const e = recent[s.id], st = e ? strength(e) : { score: null, n: 0 }, band = !early && st.n >= ENOUGH ? BAND.find(([t]) => st.score >= t) : null;
    return { s, e, st, band, time: e ? medianTime(e) : null };
  });
  const stat = (label, value, mark) => `<div class="stat"><b>${value}${mark}</b><span>${label}</span></div>`;
  const stats = `<div class="stats">${stat('days played', now.days, had ? trend(now.days, was.days, 0) : '')}${stat('choices made', now.n, had ? trend(now.n, was.n, was.n * .1) : '')}`
    + `${stat('best choices', now.share == null ? '–' : pct(now.share), had && now.share != null && was.share != null ? trend(now.share, was.share, .03) : '')}</div>`
    + `<p class="small">The last two weeks${had ? ', against the two weeks before' : ''}.</p>`;
  const earlyHtml = early ? `<p class="early">Too early to tell: ${now.n ? `only ${now.n} choices` : 'no choices'} in the last two weeks. The picture gets clearer after a few days of play.</p>` : '';
  // Up to three to work on: the weakest ideas with enough choices to judge that are not strong yet, weakest first.
  const work = ideas.filter(x => x.band && x.band[1] !== 'strong').sort((a, b) => a.st.score - b.st.score || level(P, a.s.id) - level(P, b.s.id)).slice(0, 3);
  const workHtml = work.length ? `<div class="work">${work.map(({ s, band }) => `<div class="card"><div class="t"><i>${s.emoji}</i><b>${esc(s.kid)}</b><em class="${band[1]}">${band[2]}</em></div>`
      + `<div><span>Say</span>“${esc(s.tip)}”</div><div><span>Backyard</span>${esc(s.outside || '')}</div></div>`).join('')}</div>`
    : early || !ideas.some(x => x.band) ? '<p class="small">Nothing to pick yet: each idea needs about ten choices first.</p>'
    : '<p class="small">Nothing to work on right now: every idea he has played enough is strong. 🎉</p>';
  const rows = ideas.map(({ s, st, band, time }) => `<div class="row"><span class="nm"><i>${s.emoji}</i>${esc(s.kid)}</span>`
    + `<span class="bar ${band ? band[1] : 'none'}"><i style="width:${band ? Math.max(6, Math.round(st.score * 100)) : 0}%"></i></span>`
    + `<span class="lbl">${band ? band[2] : st.n ? 'Not enough yet' : 'Not played'}</span><span class="tm">${time == null ? '' : time.toFixed(1) + ' s'}</span></div>`).join('');
  $('#reportBody').innerHTML = stats + earlyHtml
    + `<h3>Work on next</h3>${workHtml}`
    + `<p class="tip"><b>At his game:</b> one cue before (the “Say” words), quiet while he plays, one question after: “When did you look up?”</p>`
    + `<h3>Every idea <small>last four weeks · matches count most · time to choose</small></h3><div class="ideas">${rows}</div>`;
}
export function openReport() { renderReport(); $('#report').classList.remove('hidden'); $('#reportBody').scrollTop = 0; }
wireSheet('#report', '#reportClose');
