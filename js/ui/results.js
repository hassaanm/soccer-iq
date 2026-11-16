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
// Paper confetti falls around the card after a win (behind it).
const PAPER = ['#ffd84d', '#2fcf6a', '#5aa2ff', '#ef4444', '#ffffff', '#ff8ad0'];
function confetti(n) {
  $('#confetti')?.remove();
  if (!n || reducedMotion()) return;
  const box = document.createElement('div'), rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  box.id = 'confetti';
  box.innerHTML = Array.from({ length: n }, (_, i) => `<i style="left:${rnd(0, 100)}%;background:${PAPER[i % PAPER.length]};--dx:${rnd(-90, 90)}px;--rot:${rnd(-720, 720)}deg;`
    + `animation-duration:${rnd(170, 330) / 100}s;animation-delay:${rnd(0, 80) / 100}s"></i>`).join('');
  el.prepend(box); setTimeout(() => box.remove(), 4500); // behind the card, so it never covers the tiles
}
// What comes next: three tiles of the same size and weight, always in the same places (⚽ Match blue, 🏆 Cup gold, the
// lessons violet with a little book), a big picture with a short word under it. None is the "obvious" one. A tile that is null is not
// open now and is left out. `again` is a small extra button in the corner (play this again, all cups); Home is in
// the other corner.
function tile(b, t) {
  b.classList.toggle('hidden', !t); if (!t) return;
  b.querySelector('i').textContent = t.icon; b.querySelector('b').textContent = t.text; b.onclick = t.go; b.classList.toggle('hot', !!t.hot); // (v64: the next thing to do today)
  if (t.small) b.querySelector('b').prepend(Object.assign(document.createElement('small'), { textContent: t.small + ' ' })); // (a cup's own emoji)
}

// Fills in the results card:
//   emoji, title, line   the picture, the headline and the line under it (the score, mostly)
//   sticker, trophy      a sticker he earned (shown in place of the emoji); `trophy` adds the gold burst
//   rounds, note         one circle per round (true = right on the first try), and the count in words
//   news, extra          level news (text), and a block of HTML under it (a backyard game, the cup path)
//   match, cup, lesson   the three next steps: { icon, text, small, go }, or null when that one is not open (small:
//                        a little picture before the word, as a cup's own emoji)
//   again                the small corner button: { text, go }, or none
//   paper                how many pieces of confetti
export function fillResults({ emoji = '', sticker, trophy, title, line = '', rounds = [], note = '', news = '', extra = '', match, cup, lesson, again, paper = 0 }) {
  part('.sticker').classList.add('hidden'); part('.emoji').classList.remove('hidden'); part('.emoji').textContent = emoji;
  if (sticker) showSticker(sticker, trophy);
  part('h2').textContent = title; part('p').textContent = line;
  part('.roundsrow').innerHTML = rounds.map((ok, i) => `<span class="${ok ? 'star' : 'done'}" style="--i:${i}"></span>`).join('');
  part('.roundsnote').textContent = note; part('.levelup').textContent = news; part('.outside').innerHTML = extra;
  tile($('#goMatch'), match); tile($('#goCup'), cup); tile($('#goLesson'), lesson);
  const a = $('#againBtn'); a.classList.toggle('hidden', !again); if (again) { a.textContent = again.text; a.onclick = again.go; }
  confetti(paper);
}
