// The full-screen layers over the field (home, card, results, grown-ups menu) and the card that asks one thing.
import { $ } from './dom.js';
import { hudEl } from './hud.js';
import { say } from './speech.js';

const screens = ['#home', '#card', '#results', '#menu'];
// Shows one screen; null shows the field with its HUD.
export const show = id => { for (const s of screens) $(s).classList.toggle('hidden', s !== id); hudEl.classList.toggle('hidden', id !== null); };

// Shows a card and resolves 'main' or 'alt' with the button that was tapped. The title is said aloud, then `lines`.
export function card({ emoji, title, sub, html, lines = [], button, alt }) {
  const el = $('#card'), main = $('#cardMain'), other = $('#cardAlt');
  el.querySelector('.emoji').textContent = emoji; el.querySelector('h2').textContent = title;
  if (html) el.querySelector('p').innerHTML = html; else el.querySelector('p').textContent = sub || '';
  main.textContent = button; other.textContent = alt || ''; other.classList.toggle('hidden', !alt);
  el.classList.remove('hidden', 'out'); const tok = el.tok = (el.tok || 0) + 1;
  (async () => { await say(title); for (const l of lines) if (!el.classList.contains('hidden')) await say(l); })();
  return new Promise(res => {
    // (v72) The card fades out over a third of a second while what it leads to starts under it: the next scene (a
    // demo, or the first round after a demo) comes in as a soft cross-fade, not a hard jump from where the last one ended.
    const done = v => { el.classList.add('out'); setTimeout(() => { if (el.tok === tok) el.classList.add('hidden'); el.classList.remove('out'); }, 300); res(v); };
    main.onclick = () => done('main'); other.onclick = () => done('alt');
  });
}
