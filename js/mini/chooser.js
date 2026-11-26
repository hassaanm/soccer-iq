// The Mini games screen (v87): the home screen's mini games button opens it; one big tile per game (mini/games.js), each
// with its picture, its name (said when tapped) and his best score. A tap says the name and starts that game.
// To add a game: its entry in mini/games.js, and its runner here in RUN (a function that plays a run to its results card).
import { $, $$, wireSheet } from '../ui/dom.js';
import { P } from '../ui/store.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { miniBest } from '../progress.js';
import { MINI, MINI_SAID } from './games.js';
import { CUP } from './pics.js';
import { hooks } from './run.js';
import { runKeeper } from '../ui/goalie.js';
import { runPenalties } from './pens-ui.js';
import { runRondoKeep, runRondoWin } from './rondo-ui.js'; // (v88)
import { runAttack } from './attack-ui.js';
import { runPuzzles } from './puzzle-ui.js';
import { runDash } from './dash-ui.js'; // (v96)
import { makeStarter } from './starter.js';

const RUN = { keeper: runKeeper, pens: runPenalties, rondoKeep: runRondoKeep, rondoWin: runRondoWin, attack: runAttack, puzzles: runPuzzles, dash: runDash };

// The sheet, made once (the lesson picker's look: css .sheet).
const sheet = document.createElement('section');
sheet.id = 'miniSheet'; sheet.className = 'screen hidden';
sheet.innerHTML = '<div class="panel wide sheet"><h2>Mini games</h2><div id="minis"></div><button id="miniClose" class="btn btn-ghost">Done</button></div>';
($('#albumSheet') || document.body.lastElementChild).after(sheet);
wireSheet('#miniSheet', '#miniClose');
// (v93) While a game is starting nothing on the sheet closes it: the sheet closes itself when the game takes over.
sheet.addEventListener('click', e => { if (start.busy()) e.stopImmediatePropagation(); }, true);

function render() {
  $('#minis').innerHTML = MINI.filter(g => RUN[g.id]).map(g => { const b = miniBest(P, g.id);
    return `<button class="tile mini" data-id="${g.id}" aria-label="${g.name}${b ? ', best ' + b : ''}"><span class="pic">${g.pic}</span><span class="nm"><span class="k">${g.name}</span>${b ? `<span class="st">${CUP}<b>${b}</b></span>` : ''}</span></button>`; }).join(''); // (v90: his best, a small cup and the number, beside the name or under it)
  for (const t of $$('#minis .tile')) t.onclick = () => start(t.dataset.id);
}
// (v93) One tap starts one thing: the sheet stays up, and answers nothing more, until the game itself takes over (starter.js).
const start = makeStarter({
  say: id => { unlockSpeech(); return say(MINI.find(x => x.id === id).say); }, // (its name, said first)
  pick: id => { sheet.classList.toggle('starting', !!id); for (const t of $$('#minis .tile')) t.classList.toggle('picked', t.dataset.id === id); },
  run: id => RUN[id]?.(),
  // The sheet closes when the game has taken the screen (the home screen is hidden by its show(null)), in the same turn.
  isTaken: () => $('#home').classList.contains('hidden'),
  watch: cb => { const mo = new MutationObserver(cb); mo.observe($('#home'), { attributes: true, attributeFilter: ['class'] }); return () => mo.disconnect(); },
  close: () => sheet.classList.add('hidden'),
});
// When a best has to go under a long name, the pictures are made a little smaller so both rows still fit (css .two).
function fit() {
  const m = $('#minis'); m.classList.remove('two');
  if ([...m.querySelectorAll('.nm')].some(n => n.querySelector('.st') && n.querySelector('.st').offsetTop > n.querySelector('.k').offsetTop + 4)) m.classList.add('two');
}
export function openMini() {
  render(); sheet.classList.remove('hidden', 'starting'); fit(); unlockSpeech(); say(MINI_SAID.open);
}
hooks.open = openMini;
const btn = $('#keeperBtn'); if (btn) btn.onclick = () => openMini();
