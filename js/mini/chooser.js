// The Mini games screen (v87): the home screen's mini games button opens it; one big tile per game (mini/games.js), each
// with its picture, its name (said when tapped) and his best score. A tap says the name and starts that game.
// To add a game: its entry in mini/games.js, and its runner here in RUN (a function that plays a run to its results card).
import { $, $$, wireSheet } from '../ui/dom.js';
import { P } from '../ui/store.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { miniBest } from '../progress.js';
import { MINI, MINI_SAID } from './games.js';
import { hooks } from './run.js';
import { runKeeper } from '../ui/goalie.js';
import { runPenalties } from './pens-ui.js';
import { runRondoKeep, runRondoWin } from './rondo-ui.js'; // (v88)
import { runAttack } from './attack-ui.js';
import { runPuzzles } from './puzzle-ui.js';

const RUN = { keeper: runKeeper, pens: runPenalties, rondoKeep: runRondoKeep, rondoWin: runRondoWin, attack: runAttack, puzzles: runPuzzles };

// The sheet, made once (the lesson picker's look: css .sheet).
const sheet = document.createElement('section');
sheet.id = 'miniSheet'; sheet.className = 'screen hidden';
sheet.innerHTML = '<div class="panel wide sheet"><h2>Mini games</h2><div id="minis"></div><button id="miniClose" class="btn btn-ghost">Done</button></div>';
($('#albumSheet') || document.body.lastElementChild).after(sheet);
wireSheet('#miniSheet', '#miniClose');

function render() {
  $('#minis').innerHTML = MINI.filter(g => RUN[g.id]).map(g => { const b = miniBest(P, g.id);
    return `<button class="tile mini" data-id="${g.id}" aria-label="${g.name}${b ? ', best ' + b : ''}"><span class="pic">${g.pic}</span><span class="k">${g.name}</span><span class="st${b ? '' : ' none'}"><i>⭐</i><b>${b}</b></span></button>`; }).join('');
  for (const t of $$('#minis .tile')) t.onclick = () => start(t.dataset.id);
}
let starting = false;
async function start(id) {
  if (starting) return; starting = true; unlockSpeech();
  try {
    const g = MINI.find(x => x.id === id);
    sheet.classList.add('hidden');
    // Its name, then the game (a short wait at most, so the name is not cut off by the game's first words).
    await Promise.race([Promise.resolve(say(g.say)), new Promise(r => setTimeout(r, 1400))]);
    await RUN[id]?.();
  } catch (e) { console.error(e); } finally { starting = false; }
}
export function openMini() {
  render(); sheet.classList.remove('hidden'); unlockSpeech(); say(MINI_SAID.open);
}
hooks.open = openMini;
const btn = $('#keeperBtn'); if (btn) btn.onclick = () => openMini();
