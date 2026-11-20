// A mini game's run on the page (v87): the bar along the top (two hearts, the score, his best), a heart lost kindly,
// the play log, and the results card at the end (his score, his best, "New best!" when he beats it; Again and back to
// the mini games). Each game plays its own attempts and calls runStep after each (ui/goalie.js, mini/pens-ui.js).
// Painting stays cheap: the bar's nodes are made once; only transform and opacity animate (css: the mini block).
import { $, replay } from '../ui/dom.js';
import { P, save } from '../ui/store.js';
import { say } from '../ui/speech.js';
import { show } from '../ui/screens.js';
import { fillResults } from '../ui/results.js';
import { renderPickers } from '../ui/home.js';
import { game } from '../ui/stage.js';
import { ASK } from '../flows.js';
import { miniDone, miniBest, oldKeeperBest } from '../progress.js';
import { newRun, attempt, LIVES } from './rules.js';
import { miniById, MINI_SAID } from './games.js';
import { CUP } from './pics.js';

// Set by mini/chooser.js: opens the Mini games screen (the results card's second tile).
export const hooks = { open: null };
const plog = (is, o) => { try { game.plog?.('mini', { is, ...o }); } catch { /* the log is never in the way */ } };

// ---------- the bar (made once) ----------
const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 20.6S3.4 15.2 1.6 10C.4 6.4 2.7 2.4 6.6 2.4c2.3 0 4 1.3 5.4 3.2 1.4-1.9 3.1-3.2 5.4-3.2 3.9 0 6.2 4 5 7.6-1.8 5.2-10.4 10.6-10.4 10.6Z"/></svg>';
let bar = null, hearts = [], scoreEl = null, unitEl = null, bestEl = null, bestBox = null;
function makeBar() {
  if (bar) return;
  bar = document.createElement('div'); bar.id = 'miniBar'; bar.className = 'hidden';
  bar.innerHTML = `<span class="lives" aria-label="Lives">${Array.from({ length: LIVES }, () => `<i class="heart"><span class="bg">${HEART}</span><span class="fg">${HEART}</span></i>`).join('')}</span>`
    + '<span class="sc" aria-label="Score"><i class="u"></i><b>0</b></span><span class="best" aria-label="Best">' + CUP + '<b>0</b></span>';
  ($('#hud') || document.body).appendChild(bar); // (v88: at the top left, by the pause button: the middle of the top stays clear for the goal and the keeper's eyes)
  hearts = [...bar.querySelectorAll('.heart')]; scoreEl = bar.querySelector('.sc b'); unitEl = bar.querySelector('.sc .u'); bestBox = bar.querySelector('.best'); bestEl = bestBox.querySelector('b');
}

// ---------- a run ----------
// Starts a run of game `id`: the bar shows full hearts, a score of 0 and his best (hidden while he has none).
export function startRun(id) {
  makeBar();
  const g = miniById(id), best = miniBest(P, id), run = { ...newRun(), id, best, beat: false, t0: Date.now() };
  unitEl.textContent = g?.unit || '⭐'; scoreEl.textContent = '0'; bestEl.textContent = String(best);
  bestBox.classList.toggle('none', !best); bestBox.classList.remove('beat');
  for (const h of hearts) h.classList.remove('lost', 'gone');
  bar.classList.remove('hidden', 'last');
  plog('start', { game: id, best });
  return run;
}
// One attempt is over: success or not; `info` goes to the play log. Returns whether the run goes on.
export function runStep(run, success, info = {}) {
  const lv = run.level; attempt(run, success);
  plog('try', { game: run.id, n: run.n, level: Math.round(lv * 100) / 100, ok: success ? 1 : 0, score: run.score, lives: run.lives, ...info });
  if (!bar) return !run.over;
  if (success) {
    scoreEl.textContent = String(run.score); replay(scoreEl, 'bump');
    if (run.best && run.score > run.best && !run.beat) { run.beat = true; bestBox.classList.add('beat'); } // (past his best: the star turns gold and stays so)
    if (run.beat) bestEl.textContent = String(run.score);
  } else {
    const h = hearts[run.lost - 1]; if (h) { h.classList.remove('lost'); void h.offsetWidth; h.classList.add('lost'); } // (the heart pops, then fades to its grey outline)
    bar.classList.toggle('last', run.lives === 1); if (run.lives === 1) replay(bar, 'shake');
  }
  return !run.over;
}
// The bar off (a run ended, or broke).
export function runOff() { if (bar) bar.classList.add('hidden'); }
// The end: the save keeps his score (and his best); the results card shows them, with "New best!" when he beat it.
// opts: again (the game's runner), sticker ({ emoji, skill, at } for a good run: the keeper game), title (the headline
// when it is not a new best).
export function endRun(run, { again, sticker = null, title = null } = {}) {
  runOff();
  const g = miniById(run.id), d = miniDone(P, run.id, run.score, { sticker: sticker && { at: 6, ...sticker } }), old = run.id === 'keeper' ? oldKeeperBest(P) : null;
  save();
  plog('end', { game: run.id, score: run.score, best: miniBest(P, run.id), newBest: d.best ? 1 : 0, tries: run.n, sec: Math.round((Date.now() - run.t0) / 1000) });
  const head = d.best ? MINI_SAID.best : title || MINI_SAID.again;
  // (v88) His score big, with his best beside it as a badge with the cup (v90) (on a new best the badge under it says so instead);
  // the old 8-shot game's best once, in words for a grown-up.
  const extra = `<div class="miniEnd${d.best ? ' nb' : ''}"><div class="score"><i>${g.unit}</i><b>${run.score}</b></div>`
    + (d.best ? `<div class="newbest"><span>${CUP}New best!</span></div>` : `<div class="best" aria-label="Best">${CUP}<b>${miniBest(P, run.id)}</b></div>`)
    + (old ? `<div class="old">Best in the old 8-shot game: ${old} ${old === 1 ? 'save' : 'saves'}</div>` : '') + '</div>';
  fillResults({
    emoji: g.unit, sticker: d.sticker ? sticker.emoji : null, title: g.name, line: '', rounds: [], note: '', news: '', extra, // (the title: the game's name; "New best!" has its own badge under the score)
    lesson: { icon: '🔁', text: 'Again', label: '', go: () => again?.() },
    match: { icon: '🕹️', text: 'Mini games', go: () => { show('#home'); hooks.open?.(); } }, cup: null, again: null,
    paper: d.best ? 90 : d.sticker ? 60 : 0,
  });
  $('#results').classList.add('mini');
  if (g.pic && !d.sticker) $('#results .emoji').innerHTML = g.pic; // (v88: the game's own picture at the top, as on its tile)
  show('#results'); renderPickers();
  const lines = d.sticker ? (d.best ? ['Great try! You got a new sticker!', MINI_SAID.best] : ['Great try! You got a new sticker!']) : [head];
  (async () => { for (const l of lines) await say(l); })().then(() => setTimeout(() => { if (!$('#results').classList.contains('hidden')) say(ASK); }, 300));
  return d;
}
// Any other results card is not a mini game's (its own look goes). (Removed only when it is there: a remove sets the
// attribute again, which would call this again, for ever.)
if (typeof MutationObserver === 'function') { const r = $('#results'); if (r) new MutationObserver(() => { if (r.classList.contains('hidden') && r.classList.contains('mini')) r.classList.remove('mini'); }).observe(r, { attributes: true, attributeFilter: ['class'] }); }
