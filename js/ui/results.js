// The results card at the end of a lesson, training, match or cup round.
import { $, reducedMotion } from './dom.js';
import { sfx } from '../sound.js';
import { lessonPic } from './pics.js';

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
// What comes next: three tiles of the same size and weight, always in the same places (v64, left to right: the lesson
// violet, ⚽ Match blue, 🏆 Cup gold), a big picture with a short word under it. None is the "obvious" one. The lesson tile
// says over its picture what it is (`label`: "NEXT LESSON" unless the tile says otherwise, as "THIS LESSON" for Try again
// or "TODAY" for training). A tile that is null is not open now and is left out. `again` is a small extra button in the
// corner (play this again, all cups); Home is in the other corner.
function tile(b, t, label = null) {
  b.classList.toggle('hidden', !t); if (!t) return;
  b.querySelector('i').innerHTML = lessonPic(t.pic, t.icon); b.querySelector('b').textContent = t.text; b.onclick = t.go; // (i: a lesson's own picture, or the emoji)
  const lbl = b.querySelector('.lbl'); if (lbl) lbl.textContent = t.label ?? label ?? '';
  b.setAttribute('aria-label', [t.label ?? label, t.text].filter(Boolean).join(': '));
  if (t.small) b.querySelector('b').prepend(Object.assign(document.createElement('small'), { textContent: t.small + ' ' })); // (a cup's own emoji)
}

// Fills in the results card:
//   emoji, title, line   the picture, the headline and the line under it (the score, mostly)
//   sticker, trophy      a sticker he earned (shown in place of the emoji); `trophy` adds the gold burst
//   rounds, note         one circle per round (true = right on the first try), and the count in words
//   news, extra          level news (text), and a block of HTML under it (a backyard game, the cup path)
//   lesson, match, cup   the three next steps: { icon, text, small, label, pic, go }, or null when that one is not open
//                        (small: a little picture before the word, as a cup's own emoji; label: the lesson tile's
//                        line over its picture; pic: a lesson's id, for its own picture, ui/pics.js)
//   again                the small corner button: { text, go }, or none
//   paper                how many pieces of confetti
export function fillResults({ emoji = '', sticker, trophy, title, line = '', rounds = [], note = '', news = '', extra = '', match, cup, lesson, again, paper = 0 }) {
  part('.sticker').classList.add('hidden'); part('.emoji').classList.remove('hidden'); part('.emoji').textContent = emoji;
  if (sticker) showSticker(sticker, trophy);
  part('h2').textContent = title; part('p').textContent = line;
  part('.roundsrow').innerHTML = rounds.map((ok, i) => `<span class="${ok ? 'star' : 'done'}" style="--i:${i}"></span>`).join('');
  part('.roundsnote').textContent = note; part('.levelup').textContent = news; part('.outside').innerHTML = extra;
  tile($('#goLesson'), lesson, 'NEXT LESSON'); tile($('#goMatch'), match); tile($('#goCup'), cup);
  const a = $('#againBtn'); a.classList.toggle('hidden', !again); if (again) { a.textContent = again.text; a.onclick = again.go; }
  confetti(paper);
}
