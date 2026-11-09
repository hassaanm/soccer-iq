// The HUD over the field: prompt, buttons' states, the big outcome letters, the result card, dots and scoreboard.
// The game calls these; none of them knows the rules.
import { $, replay } from './dom.js';
import { sfx } from '../sound.js';

export const hudEl = $('#hud');
const ui = Object.fromEntries(['prompt', 'lookBtn', 'passBtn', 'dribBtn', 'tunnel', 'banner', 'rate', 'flash', 'seenNote', 'hand', 'toast', 'caption', 'dots', 'score', 'rateWatch', 'rateNext']
  .map(id => [id, $('#' + id)]));
const timers = {};
const flash = (el, cls, text, ms) => {
  el.textContent = text; el.className = cls; void el.offsetWidth; el.classList.add('show');
  clearTimeout(timers[el.id]); timers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
};
// state() runs every frame, so it remembers what is on screen and touches the page only when a value changes.
const shown = {};
const changed = (k, v) => shown[k] !== v && ((shown[k] = v), true);
let dotsDone = 0;    // rounds shown as played on the dots
let scoreNow = null; // the score on the scoreboard
// How strong the head-down tunnel is now (0 = off).
export const tunnelNow = () => shown.tunnel || 0;

export const hud = {
  state({ phase, step, mode, prompt, nudge, lookUp, look, locked, kind, touchPick, canShoot, showing }) {
    const d = hudEl.dataset, cl = hudEl.classList;
    step = step || 'none'; lookUp = !!lookUp; locked = !!locked;
    if (changed('showing', !!showing)) cl.toggle('showing', !!showing);
    if (changed('phase', phase)) d.phase = phase;
    if (changed('step', step)) { d.step = step; ui.passBtn.classList.toggle('active', step === 'pass'); ui.dribBtn.classList.toggle('active', step === 'dribble'); }
    if (changed('mode', mode)) d.mode = mode;
    if (changed('kind', kind)) d.kind = kind;
    if (changed('touchPick', !!touchPick)) cl.toggle('touchpick', !!touchPick);
    if (changed('canShoot', !!canShoot)) cl.toggle('shoot', !!canShoot);
    if (changed('prompt', prompt)) ui.prompt.textContent = prompt;
    if (changed('nudge', nudge === 'look')) ui.lookBtn.classList.toggle('nudge', nudge === 'look');
    if (changed('locked', locked)) { ui.passBtn.classList.toggle('locked', locked); ui.dribBtn.classList.toggle('locked', locked); }
    if (changed('lookUp', lookUp)) {
      const lb = ui.lookBtn;
      cl.toggle('up', lookUp); lb.classList.toggle('on', lookUp);
      lb.firstChild.textContent = lookUp ? '⚽' : '👀'; lb.lastChild.textContent = lookUp ? 'HEAD DOWN' : 'LOOK UP';
    }
    // Head down = tunnel vision: blurry, darker edges. Clears as he looks up.
    const playerView = (mode === 'lesson' || mode === 'match' || mode === 'demo' || mode === 'free') && (phase === 'pre' || phase === 'decide') && step !== 'dribble';
    const o = playerView ? Math.round((1 - look) * 95) / 100 : 0;
    if (changed('tunnel', o)) { ui.tunnel.style.opacity = o; ui.tunnel.classList.toggle('on', o > 0); }
  },
  // The big moment. The outcome ("GOAL!", "Stole it!"…) lands in huge letters the moment it happens.
  // In lessons (`rated` = { stars, text, watch }) the result card follows: the stars pop one by one over a short
  // tip, and with `watch` it waits for "Watch the 3-star play" or "Next". A missed play skips the big letters and
  // goes straight to the card. Matches and demos aren't rated: they show just the big letters.
  banner(text, kind, rated) {
    const big = ui.banner, el = ui.rate, good = kind !== 'bad', splash = !!text && (good || !rated);
    sfx(!good ? 'aww' : text === 'GOAL!' ? 'goal' : 'yay');
    clearTimeout(timers.rate); clearTimeout(timers.big);
    hudEl.classList.add('rating');
    if (splash) {
      big.querySelector('b').innerHTML = [...text].map((ch, i) => `<i style="--i:${i}">${ch}</i>`).join('');
      big.className = kind; void big.offsetWidth; big.classList.add('show');
    }
    if (text === 'GOAL!') replay(ui.flash, 'go');
    const done = v => { big.classList.remove('show'); el.classList.remove('show'); hudEl.classList.remove('rating'); return v; };
    if (!rated) { timers.big = setTimeout(done, 1700); return Promise.resolve(); }
    const title = el.querySelector('.title'), lead = splash ? 850 : 0, tip = rated.text || '';
    title.textContent = text; title.className = 'title ' + kind;
    el.className = 's' + rated.stars;
    el.querySelector('.stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= rated.stars ? 'on' : ''}">★</span>`).join('');
    el.querySelector('.txt').textContent = tip; el.querySelector('.btns').classList.toggle('hidden', !rated.watch);
    timers.big = setTimeout(() => {
      big.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      [...el.querySelectorAll('.stars span.on')].forEach((sp, i) => setTimeout(() => { sp.classList.add('pop'); sfx('star', i); }, 250 + i * 160));
    }, lead);
    return new Promise(res => {
      // With nothing to tap, the card stays long enough to read the tip, then moves on by itself.
      if (!rated.watch) { timers.rate = setTimeout(() => res(done('next')), lead + (rated.stars === 3 ? 1600 + tip.length * 45 : 2200)); return; }
      ui.rateWatch.onclick = () => res(done('watch')); ui.rateNext.onclick = () => res(done('next'));
    });
  },
  // "You see …": a small note near the top, so it doesn't look like something he has to act on.
  seen(text) { flash(ui.seenNote, '', text, 1400); sfx('ping'); },
  // The teaching hand: `pos` is a button id or a screen point [x, y]; null hides it. A new `tap` number taps once.
  hand(pos, tap) {
    const el = ui.hand, old = hudEl.querySelector('.pointed');
    const btn = typeof pos === 'string' ? $('#' + pos) : null;
    if (old && old !== btn) old.classList.remove('pointed');
    let xy = pos;
    if (btn) { const r = btn.getBoundingClientRect(); xy = r.width ? [r.left + r.width / 2, r.top + r.height * .55] : null; }
    if (!xy) { el.classList.remove('show', 'tap'); el.dataset.tap = ''; return; }
    btn?.classList.add('pointed');
    const at = `translate(${Math.round(xy[0])}px,${Math.round(xy[1])}px)`;
    if (!el.classList.contains('show')) { // come in from below the target
      el.style.transition = 'none'; el.style.transform = `translate(${Math.round(xy[0] + 60)}px,${Math.round(xy[1] + 120)}px)`;
      void el.offsetWidth; el.style.transition = ''; el.classList.add('show');
    }
    if (el.style.transform !== at) el.style.transform = at;
    if (tap && el.dataset.tap !== String(tap)) { el.dataset.tap = tap; replay(el, 'tap'); }
  },
  toast(text, warn) { flash(ui.toast, warn ? 'warn' : '', text, 1600); },
  caption(text) { ui.caption.textContent = text; ui.caption.classList.toggle('show', !!text); hudEl.classList.toggle('captioning', !!text); },
  // One dot per round: gold = right on the first try. The dot just earned pops.
  dots(results, n) {
    const done = results.length, fresh = done > dotsDone; dotsDone = done;
    ui.dots.innerHTML = Array.from({ length: n }, (_, i) =>
      `<span class="${i < done ? (results[i] ? 'star' : 'done') + (fresh && i === done - 1 ? ' new' : '') : i === done ? 'now' : ''}"></span>`).join('');
  },
  // The scoreboard: each team's color and short name, the score in the middle. A goal makes its number jump.
  score(s, us, them) {
    const el = ui.score, key = `${us.id} ${s.us} ${them.id} ${s.them}`, was = scoreNow;
    el.classList.remove('hidden');
    if (was?.key === key) return;
    scoreNow = { key, us: s.us, them: s.them };
    const chip = t => `<i style="background:${t.kit.colors[0]}"></i>`, num = (v, old) => `<em class="${was && v > old ? 'bump' : ''}">${v}</em>`;
    el.innerHTML = `${chip(us)}<span>${us.short}</span><b>${num(s.us, was?.us)}–${num(s.them, was?.them)}</b><span>${them.short}</span>${chip(them)}`;
  },
  hideScore() { ui.score.classList.add('hidden'); scoreNow = null; },
};
