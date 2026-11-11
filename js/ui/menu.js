// The grown-ups menu: hold the gear on the home screen to open it.
import { $ } from './dom.js';
import { P, save } from './store.js';
import { voice, voices, pickVoice, say, SAMPLE } from './speech.js';
import { applySound } from './soundmenu.js';
import { show } from './screens.js';
import { renderPickers } from './home.js';
import { PATH, skillById } from '../skills.js';
import { nextSkill, level, graduated, defaultProgress } from '../progress.js';

// A short tap on the gear only shows the "hold" tip; a 1.2-second hold opens the menu.
const HOLD = 1200, gear = $('#gear');
let holdTimer, tipTimer, downAt = 0;
gear.addEventListener('pointerdown', () => { downAt = Date.now(); gear.classList.add('holding'); holdTimer = setTimeout(openMenu, HOLD); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) gear.addEventListener(ev, () => {
  gear.classList.remove('holding'); clearTimeout(holdTimer);
  if (ev === 'pointerup' && downAt && Date.now() - downAt < HOLD) {
    $('#gearTip').classList.add('show'); clearTimeout(tipTimer); tipTimer = setTimeout(() => $('#gearTip').classList.remove('show'), 1800);
  }
  downAt = 0;
});

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
function openMenu() {
  gear.classList.remove('holding');
  // "Automatic" names what PLAY would start with no lesson locked.
  const auto = graduated(P, PATH) ? "Today's training" : skillById(nextSkill({ ...P, settings: { ...P.settings, skill: null } }, PATH)).kid;
  $('#skillSel').innerHTML = `<option value="">Automatic (${auto})</option>`
    + PATH.map(s => `<option value="${s.id}" ${s.ready ? '' : 'disabled'} ${P.settings.skill === s.id ? 'selected' : ''}>${s.emoji} ${s.kid}${s.ready ? '' : ' (coming soon)'}</option>`).join('');
  $('#openChk').checked = !!P.settings.alwaysOpen; $('#roundsSel').value = String(P.settings.rounds);
  pickVoice();
  $('#voiceSel').innerHTML = voices.length ? voices.map(v => `<option ${v === voice ? 'selected' : ''}>${v.name}</option>`).join('') : '<option>Default</option>';
  $('#recordedChk').checked = P.settings.recorded !== false;
  $('#progressList').innerHTML = PATH.map(s => {
    const st = P.skills[s.id];
    const status = !s.ready ? 'not built yet' : !st ? 'not started' : `Level ${level(P, s.id)} · ${plural(st.days || 1, 'day')} · ${st.firstTry}/${st.rounds} first try`;
    return `<div><span>${s.emoji} ${s.adult}</span><span>${status}</span></div>`;
  }).join('') + `<div><span>Sessions played</span><span>${P.sessions}</span></div>`;
  show('#menu');
}
$('#menuClose').onclick = () => {
  const s = P.settings;
  s.skill = $('#skillSel').value || null; s.alwaysOpen = $('#openChk').checked; s.rounds = +$('#roundsSel').value;
  s.recorded = $('#recordedChk').checked; s.voiceName = $('#voiceSel').value;
  pickVoice(); applySound(); save();
  renderPickers(); show('#home');
};
$('#voiceSel').onchange = () => { P.settings.voiceName = $('#voiceSel').value; pickVoice(); say(SAMPLE); };
$('#voiceTest').onclick = () => say(SAMPLE);
// Reset keeps the two teams he picked and wipes the rest.
$('#resetBtn').onclick = () => {
  if (!confirm('Reset all progress and stickers?')) return;
  const fresh = Object.assign(defaultProgress(), { us: P.us, them: P.them });
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, fresh); save(); renderPickers(); openMenu();
};
