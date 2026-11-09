// The results card at the end of a lesson, training, match or cup round.
import { $, reducedMotion } from './dom.js';
import { sfx } from '../sound.js';

const el = $('#results'), part = k => el.querySelector(k);

// The sticker he just earned (replaces the plain emoji).
function showSticker(emoji, trophy) {
  const st = part('.sticker'), clone = st.cloneNode(true); // a fresh copy restarts the slap animation
  clone.querySelector('span').textContent = emoji; clone.classList.toggle('trophy', !!trophy); clone.classList.remove('hidden');
  st.replaceWith(clone); part('.emoji').classList.add('hidden'); setTimeout(() => sfx('star', 2), 250);
}
// Paper confetti falls over the card after a win.
const PAPER = ['#ffd84d', '#2fcf6a', '#5aa2ff', '#ef4444', '#ffffff', '#ff8ad0'];
function confetti(n) {
  $('#confetti')?.remove();
  if (!n || reducedMotion()) return;
  const box = document.createElement('div'), rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  box.id = 'confetti';
  box.innerHTML = Array.from({ length: n }, (_, i) => `<i style="left:${rnd(0, 100)}%;background:${PAPER[i % PAPER.length]};--dx:${rnd(-90, 90)}px;--rot:${rnd(-720, 720)}deg;`
    + `animation-duration:${rnd(170, 330) / 100}s;animation-delay:${rnd(0, 80) / 100}s"></i>`).join('');
  document.body.append(box); setTimeout(() => box.remove(), 4500);
}
// The main button is big, in its activity's color (lesson green, match blue, cup gold), and ends in ▶.
// The other one is plain white. With no main button, the other one takes its place.
const KIND = { lesson: 'btn-green', match: 'btn-blue', cup: 'btn-gold' };
function buttons(main, other) {
  const set = (b, btn, big, arrow) => {
    b.className = `btn ${big ? 'btn-lg ' + KIND[btn?.kind] : 'btn-ghost'}${btn ? '' : ' hidden'}`; if (!btn) return;
    b.innerHTML = `${btn.icon ? `<i class="ico">${btn.icon}</i>` : ''}${btn.text}${arrow ? ' ▶' : ''}`; b.onclick = btn.go;
  };
  if (main) { set($('#nextLessonBtn'), main, true, true); set($('#againBtn'), other, false); }
  else { set($('#nextLessonBtn'), other, true, false); set($('#againBtn'), null); }
}

// Fills in the results card:
//   emoji, title, line   the picture, the headline and the line under it (the score, mostly)
//   sticker, trophy      a sticker he earned (shown in place of the emoji); `trophy` adds the gold burst
//   rounds, note         one circle per round (true = right on the first try), and the count in words
//   news, extra          level news (text), and a block of HTML under it (a backyard game, the cup path)
//   main, other          buttons: { kind, icon, text, go }
//   paper                how many pieces of confetti
export function fillResults({ emoji = '', sticker, trophy, title, line = '', rounds = [], note = '', news = '', extra = '', main, other, paper = 0 }) {
  part('.sticker').classList.add('hidden'); part('.emoji').classList.remove('hidden'); part('.emoji').textContent = emoji;
  if (sticker) showSticker(sticker, trophy);
  part('h2').textContent = title; part('p').textContent = line;
  part('.roundsrow').innerHTML = rounds.map((ok, i) => `<span class="${ok ? 'star' : 'done'}" style="--i:${i}"></span>`).join('');
  part('.roundsnote').textContent = note; part('.levelup').textContent = news; part('.outside').innerHTML = extra;
  buttons(main, other); confetti(paper);
}
