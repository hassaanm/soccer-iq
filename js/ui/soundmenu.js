// The speaker button and its popover: mute, and a switch and a volume for sounds, music and voice.
import { $, $$ } from './dom.js';
import { P, save } from './store.js';
import { say, SAMPLE } from './speech.js';
import { sfx, unlock as unlockSound, setSoundOn, setMusicOn, setMuted, setVolumes } from '../sound.js';

const SPEAKER = on => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>${on
  ? '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  : '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'}</svg>`;
const pop = $('#soundPop'), rows = [...pop.querySelectorAll('.sp-row')];

// Sends the saved sound settings to the sound engine and redraws the buttons and the popover.
export function applySound() {
  const st = P.settings;
  setSoundOn(st.sound !== false); setMusicOn(st.music !== false); setMuted(!!st.muted);
  setVolumes({ sfx: st.sfxVol ?? 1, music: st.musicVol ?? 1, voice: st.voiceVol ?? 1 });
  const silent = st.muted || (st.sound === false && st.music === false && !st.voice);
  for (const b of $$('.soundBtn')) { b.innerHTML = SPEAKER(!silent); b.classList.toggle('off', silent); }
  pop.classList.toggle('muted', !!st.muted);
  $('#muteAll').classList.toggle('on', !!st.muted); $('#muteAll').textContent = st.muted ? 'Unmute' : 'Mute all';
  for (const r of rows) {
    const on = r.dataset.k === 'voice' ? !!st.voice : st[r.dataset.k] !== false;
    r.querySelector('input[type=checkbox]').checked = on; r.classList.toggle('off', !on);
    r.querySelector('input[type=range]').value = Math.round((st[r.dataset.v] ?? 1) * 100);
  }
}
function togglePop(btn) {
  const open = pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !open);
  if (open) { pop.classList.toggle('in-game', btn.classList.contains('hud-sound')); applySound(); }
}
for (const b of $$('.soundBtn')) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); unlockSound(); togglePop(b); });
// Tapping anywhere outside closes it.
document.addEventListener('pointerdown', e => { if (!e.target.closest('#soundPop, .soundBtn')) pop.classList.add('hidden'); }, true);
pop.addEventListener('pointerdown', e => e.stopPropagation());
$('#muteAll').onclick = () => { P.settings.muted = !P.settings.muted; save(); applySound(); };
for (const r of rows) {
  const k = r.dataset.k, v = r.dataset.v, range = r.querySelector('input[type=range]');
  r.querySelector('input[type=checkbox]').onchange = e => { P.settings[k] = e.target.checked; if (e.target.checked) P.settings.muted = false; save(); applySound(); };
  range.oninput = () => { P.settings[v] = range.value / 100; applySound(); };
  // Let go of the slider: save it and play a sample at the new level.
  range.onchange = () => { save(); if (k === 'sound') sfx('kick'); if (k === 'voice') say(SAMPLE); };
}
applySound();
// Sound can only start after a tap; every chunky button also clicks.
document.addEventListener('pointerdown', e => { unlockSound(); if (e.target.closest('.btn,.chip')) sfx('click'); }, true);
