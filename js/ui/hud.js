// The HUD over the field: prompt, buttons' states, the big outcome letters, the result card, dots and scoreboard.
// The game calls these; none of them knows the rules.
import { $, replay } from './dom.js';
import { sfx } from '../sound.js';
import { later as setTimeout, unlater as clearTimeout } from '../pause.js'; // (v79: the HUD's waits are held while the game is paused)

export const hudEl = $('#hud');
const ui = Object.fromEntries(['prompt', 'lookBtn', 'passBtn', 'dribBtn', 'shootBtn', 'tunnel', 'banner', 'rate', 'flash', 'seenNote', 'hand', 'toast', 'caption', 'dots', 'score', 'rateWatch', 'rateNext', 'skillA', 'skillB', 'skillName', 'skillTag', 'pop']
  .map(id => [id, $('#' + id)]));
const timers = {};
// (round 13) The Smooth head-down edge as a small picture: the same gradient as css/app.css body.smooth #tunnel, drawn once
// into 256x256 and stretched over the edge's box by the graphics chip (an image on its own layer is shown as it is, with no
// page-sized drawing). Until it is ready, or if anything fails, the CSS gradient stays.
function edgePicture() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); if (!g || !c.toBlob) return;
    g.translate(128, .57 * 256); g.scale(.23 * 256, .26 * 256); // ellipse 23% 26% at 50% 57%
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, 'rgba(14,10,26,0)'); r.addColorStop(.5, 'rgba(14,10,26,0)'); r.addColorStop(.72, 'rgba(14,10,26,.62)'); r.addColorStop(1, 'rgba(14,10,26,.9)');
    g.fillStyle = r; g.fillRect(-20, -20, 40, 40);
    c.toBlob(b => { if (!b) return; const img = new Image(); img.className = 'edge'; img.alt = ''; img.src = URL.createObjectURL(b);
      const done = () => { ui.tunnel.appendChild(img); document.documentElement.classList.add('edgeimg'); };
      (img.decode ? img.decode() : Promise.resolve()).then(done, done); }, 'image/png');
  } catch { /* the gradient stays */ }
}
setTimeout(edgePicture, 700);
// (v93) The sunburst behind the big words and the goal's flash as pictures made once, here, as the page loads: each an
// <img> on a layer of its own that the graphics chip only moves, turns and fades, so a result paints nothing big. The
// phone's play log (v92): every "SAVED!" and "GOAL!" in the mini games froze the picture 150 to 340 ms as the sunburst
// (a 1860 px square at the phone's sharpness) and the flash (the whole screen) were drawn again, each time they came.
// The sunburst is the same picture as the CSS one (the same numbers: tests/pop.test.js), the flash the same gradient.
// Until both are ready, or if anything fails, the CSS ones stay (html.hudimg).
function picture(c, cls) {
  return new Promise(res => { try { c.toBlob(b => { if (!b) return res(null); const img = new Image(); img.className = cls; img.alt = ''; img.src = URL.createObjectURL(b);
    (img.decode ? img.decode() : Promise.resolve()).then(() => res(img), () => res(img)); }, 'image/png'); } catch { res(null); } });
}
// A repeating conic gradient (`on` degrees of `color` every `period`) under a radial mask from `inner` to `outer` of the
// distance to the corners (css #banner.goal::before).
function burstPicture(size, color, on, period, inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); if (!g) return null;
  const m = size / 2, R = Math.SQRT1_2 * size, rad = d => (d - 90) * Math.PI / 180; // (CSS: 0deg is up, clockwise)
  g.fillStyle = color;
  for (let a = 0; a < 360; a += period) { g.beginPath(); g.moveTo(m, m); g.arc(m, m, R, rad(a), rad(Math.min(360, a + on))); g.closePath(); g.fill(); }
  const r = g.createRadialGradient(m, m, 0, m, m, R); r.addColorStop(0, '#000'); r.addColorStop(inner, '#000'); r.addColorStop(outer, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = r; g.fillRect(0, 0, size, size);
  return c;
}
// The flash: a circle at 50% 45% that reaches the farthest corner (css #flash), drawn at a quarter of the screen's size
// with its shape (a soft gradient loses nothing stretched).
function flashPicture(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(32, Math.round(w / 4)); c.height = Math.max(16, Math.round(h / 4)); const g = c.getContext('2d'); if (!g) return null;
  const x = c.width * .5, y = c.height * .45, R = Math.hypot(Math.max(x, c.width - x), Math.max(y, c.height - y)), r = g.createRadialGradient(x, y, 0, x, y, R);
  r.addColorStop(0, '#fff'); r.addColorStop(.45, 'rgba(255,240,170,.7)'); r.addColorStop(.8, 'rgba(255,240,170,0)'); r.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = r; g.fillRect(0, 0, c.width, c.height); return c;
}
function hudPictures() {
  try {
    const dpr = Math.min(3, Math.max(1, devicePixelRatio || 1)), b = burstPicture(Math.round(Math.min(1024, 620 * dpr)), 'rgba(255,236,150,.6)', 8, 22, .18, .66);
    const f = flashPicture(Math.max(innerWidth, innerHeight), Math.min(innerWidth, innerHeight)); // (landscape, as it is played)
    if (!b || !f) return;
    Promise.all([picture(b, 'burst'), picture(f, 'glow')]).then(([bi, fi]) => {
      b.width = b.height = f.width = f.height = 0; if (!bi || !fi) return;
      ui.banner.prepend(bi); ui.flash.appendChild(fi); document.documentElement.classList.add('hudimg');
    }, () => {});
  } catch { /* the CSS ones stay */ }
}
setTimeout(hudPictures, 800);
// (v93) A result comes in over three frames, not one: the big words and their sound now; the sunburst and the flash in
// the next frame; the stars (hud.pop) in the one after, their notes after that, one at a time. Each step is small, so no
// frame carries them all. A newer result, or bannerOff, cancels the steps still to come.
const inFrames = (n, f) => requestAnimationFrame(() => (n > 1 ? inFrames(n - 1, f) : f()));
let resultTok = 0, popTok = 0, flashAlt = false, bigAlt = false;
// The flash again from the start, with no layout: its animation's name changes (go, go2), which restarts it.
function flashGo() { const f = ui.flash; flashAlt = !flashAlt; f.classList.remove(flashAlt ? 'go' : 'go2'); f.classList.add(flashAlt ? 'go2' : 'go'); }
// The sunburst stops turning once the big words have faded (a moment after `show` goes).
const unlit = () => { clearTimeout(timers.unlit); timers.unlit = setTimeout(() => { if (!ui.banner.classList.contains('show')) ui.banner.classList.remove('lit'); }, 400); };
const flash = (el, cls, text, ms) => {
  el.textContent = text; el.className = cls; void el.offsetWidth; el.classList.add('show');
  clearTimeout(timers[el.id]); timers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
};
// (round 14) The big words, the stars, the dots and the score reuse their nodes: a result changes text and classes only,
// so the frame it shows in builds nothing (the phone's record: 29 to 38 nodes made and dropped in a result's frame, which
// took 85 to 105 ms). Each animation still starts again as its class comes back, as it did on fresh nodes.
function letters(b, text, spaces) {
  const chars = [...text];
  while (b.children.length < chars.length) { const i = document.createElement('i'); i.style.setProperty('--i', b.children.length); b.appendChild(i); }
  for (let k = 0; k < b.children.length; k++) {
    const i = b.children[k], ch = chars[k], off = ch === undefined; i.classList.toggle('off', off); if (off) continue;
    const sp = !!spaces && ch === ' ', t = sp ? '' : ch; i.classList.toggle('sp', sp);
    if (!i.firstChild) i.appendChild(document.createTextNode('')); if (i.firstChild.nodeValue !== t) i.firstChild.nodeValue = t; // (the text in place: no node made)
  }
}
const marks = (box, n, on, glyph = '★') => { // n spans showing `glyph`, `on` of them lit (or a class for each, from a function)
  while (box.children.length < n) { const e = document.createElement('span'); e.style.setProperty('--i', box.children.length); e.textContent = glyph; box.appendChild(e); }
  while (box.children.length > n) box.lastChild.remove();
  for (let k = 0; k < n; k++) box.children[k].className = typeof on === 'function' ? on(k) : k < on ? 'on' : '';
};
letters(ui.banner.querySelector('b'), ' '.repeat(18)); letters(ui.banner.querySelector('b'), ''); // (made once, now, while nothing shows)
letters(ui.skillName.querySelector('b'), ' '.repeat(18), true); letters(ui.skillName.querySelector('b'), '', true);
const SK = [ui.skillA, ui.skillB].map(el => ({ el, mv: el.querySelector('.mv'), k: el.querySelector('.mvK'), def: el.querySelector('.def'), crowd: el.querySelector('.crowd') })); // (v78: the skill moment's two buttons)
marks(ui.rate.querySelector('.stars'), 3, 0); marks(ui.pop.firstChild, 3, 0);
// state() runs every frame, so it remembers what is on screen and touches the page only when a value changes.
const shown = {};
const changed = (k, v) => shown[k] !== v && ((shown[k] = v), true);
let dotsDone = 0;    // rounds shown as played on the dots
let scoreNow = null; // the score on the scoreboard
// How strong the head-down tunnel is now (0 = off).
export const tunnelNow = () => shown.tunnel || 0;

export const hud = {
  state({ phase, step, mode, prompt, nudge, lookUp, look, locked, kind, touchPick, canShoot, showing, clear }) {
    const d = hudEl.dataset, cl = hudEl.classList;
    step = step || 'none'; lookUp = !!lookUp; locked = !!locked;
    if (changed('showing', !!showing)) cl.toggle('showing', !!showing);
    if (changed('phase', phase)) d.phase = phase;
    if (changed('step', step)) { d.step = step; ui.passBtn.classList.toggle('active', step === 'pass'); ui.dribBtn.classList.toggle('active', step === 'dribble'); ui.shootBtn.classList.toggle('active', step === 'aim'); } // (v64: SHOOT stays pressed while he picks a target; a tap un-picks, as PASS and DRIBBLE do)
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
    const playerView = (mode === 'lesson' || mode === 'match' || mode === 'demo' || mode === 'free') && (phase === 'pre' || phase === 'decide') && step !== 'dribble' && step !== 'aim' && step !== 'foot'; // (aiming a shot: he has his head up at the goal)
    const o = playerView ? Math.round((1 - look) * 95) / 100 : 0;
    if (changed('tunnel', o)) { ui.tunnel.style.opacity = o; ui.tunnel.classList.toggle('on', o > 0); }
    // (v66) What must stay sharp while his head is down: his own player (the clear middle goes to where he is on screen)
    // and the one who is coming (a clear patch over him). clear: { at: [x %, y %] | null, hole: [x px, y px, r px] | null }.
    if (o > 0) {
      const at = clear?.at, hole = clear?.hole, ka = at ? `${Math.round(at[0])} ${Math.round(at[1])}` : '', kh = hole ? `${Math.round(hole[0] / 3)} ${Math.round(hole[1] / 3)} ${Math.round(hole[2] / 4)}` : '';
      // (round 11) Graphics on Smooth: a soft dark edge with no blur (css: body.smooth #tunnel), moved with a transform only.
      if (document.body.classList.contains('smooth') && !document.body.classList.contains('blur')) { if (changed('clearAt', ka)) ui.tunnel.style.transform = at ? `translate(${Math.round(at[0]) - 50}vw, ${Math.round(at[1]) - 64}vh)` : ''; return; }
      if (changed('clearAt', ka)) { ui.tunnel.style.setProperty('--tx', at ? Math.round(at[0]) + '%' : '50%'); ui.tunnel.style.setProperty('--ty', at ? Math.round(at[1]) + '%' : '64%'); }
      if (changed('clearHole', kh)) { ui.tunnel.style.setProperty('--hx', hole ? Math.round(hole[0]) + 'px' : '-999px'); ui.tunnel.style.setProperty('--hy', hole ? Math.round(hole[1]) + 'px' : '-999px'); ui.tunnel.style.setProperty('--hr', hole ? Math.round(hole[2]) + 'px' : '1px'); }
    }
  },
  // The big moment. The outcome ("GOAL!", "Stole it!"…) lands in huge letters the moment it happens.
  // In lessons (`rated` = { stars, text, watch }) the big letters then shrink and move up, and the result card comes
  // in under them: the stars pop one by one over a short tip, and with `watch` it waits for "Watch the 3-star play"
  // or "Next". A missed play has no big letters: its card carries the words as a header. Matches and demos aren't
  // rated: they show just the big letters.
  banner(text, kind, rated) {
    const soft = kind === 'soft', big = ui.banner, el = ui.rate, good = kind !== 'bad' && !soft, splash = !!text && (good || !rated); // soft (v64): the defender got there first: kind words, no sound
    if (!soft) sfx(!good ? 'aww' : text === 'GOAL!' ? 'goal' : 'yay');
    clearTimeout(timers.rate); clearTimeout(timers.big); clearTimeout(timers.unlit);
    const tok = ++resultTok;
    if (!hudEl.classList.contains('rating')) hudEl.classList.add('rating'); ui.skillName.classList.remove('show'); // the result's big letters take over from a move's name
    if (splash) {
      // (v93) Its letters drop in again with no layout forced: a new result swaps the animation's name (css: #banner.alt).
      letters(big.querySelector('b'), text); bigAlt = !bigAlt;
      big.className = kind + ' show' + (bigAlt ? ' alt' : '');
    }
    inFrames(1, () => { if (tok !== resultTok) return; if (splash) big.classList.add('lit'); if (text === 'GOAL!') flashGo(); });
    const done = v => { big.classList.remove('show'); el.classList.remove('show'); hudEl.classList.remove('rating'); unlit(); return v; };
    if (!rated) { timers.big = setTimeout(done, 1700); return Promise.resolve(); }
    const title = el.querySelector('.title'), lead = splash ? 850 : 0, tip = rated.text || '';
    title.textContent = text; title.className = 'title ' + kind;
    el.className = 's' + rated.stars + (splash ? ' under' : '');
    const st = el.querySelector('.stars'); st.classList.toggle('none', !!rated.nostars); marks(st, 3, rated.stars); // (no stars taken for running out of time)
    el.querySelector('.txt').textContent = tip; el.querySelector('.btns').classList.toggle('hidden', !rated.watch);
    timers.big = setTimeout(() => {
      big.classList.toggle('up', splash); void el.offsetWidth; el.classList.add('show');
      [...el.querySelectorAll('.stars span.on')].forEach((sp, i) => setTimeout(() => { sp.classList.add('pop'); sfx('star', i); }, 250 + i * 160));
    }, lead);
    return new Promise(res => {
      // With nothing to tap, the card stays long enough to read the tip, then moves on by itself.
      if (!rated.watch) { timers.rate = setTimeout(() => res(done('next')), lead + (rated.stars === 3 || rated.soft ? 1600 + tip.length * 45 : 2200)); return; }
      ui.rateWatch.onclick = () => res(done('watch')); ui.rateNext.onclick = () => res(done('next'));
    });
  },
  // A new play begins: the last result's big words (a match's, which have no card to wait for) and the last choice's stars
  // go now.
  bannerOff() { popTok++; ui.pop.classList.remove('show'); if (!hudEl.classList.contains('rating') || !ui.rate.classList.contains('show')) { resultTok++; clearTimeout(timers.big); ui.banner.classList.remove('show', 'up'); hudEl.classList.remove('rating'); unlit(); } },
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
  // (v78) The skill moment's two buttons (game/skill.js), where PASS and DRIBBLE sit: `pair` is the two moves on offer,
  // left button first ([{ k, dir: 'l' | 'r' }], null hides them), `left` how much of the time to pick is left (0 to 1),
  // shown by the ring around each. Each shows its move's picture (index.html #skillPics), turned to the way it goes. The
  // nodes are made once: an offer changes two links and a transform.
  // `scene` (review): what both pictures show the same, as on the field: the defender's place across the picture (dx: -1
  // his far left to 1), where more of them crowd (crowd: -1, 1, 0 none) and their shirt colour.
  skill(pair, left = 1, scene = null) {
    if (changed('skillPair', pair ? pair.map(p => p.k + p.dir).join() + (scene ? scene.dx + ',' + scene.crowd + ',' + scene.color : '') : null)) {
      if (pair) { const dx = Math.round((scene?.dx || 0) * 22), cx = (scene?.crowd || 0) * 38;
        if (scene?.color) hudEl.style.setProperty('--def', scene.color);
        pair.forEach((p, i) => { const b = SK[i]; b.mv.setAttribute('transform', p.dir === 'l' ? 'matrix(-1 0 0 1 100 0)' : ''); b.k.setAttribute('href', '#mv-' + p.k); b.el.classList.remove('on', 'off');
          b.def.setAttribute('transform', `translate(${dx} 0)`); b.crowd.setAttribute('transform', `translate(${cx} 0)`); b.crowd.style.display = cx ? '' : 'none'; });
        ui.toast.classList.remove('show'); } // (a praise pill from his choice gives way)
      hudEl.classList.toggle('skilling', !!pair); hudEl.classList.remove('armed'); shown.skillLeft = null;
    }
    if (pair && changed('skillLeft', left)) for (const b of SK) b.el.style.setProperty('--left', left);
  },
  // He picked one (0: left, 1: right): it stays lit, with its ring full, and the other fades.
  skillArm(i) { hudEl.classList.add('armed'); SK.forEach((b, j) => { b.el.classList.toggle('on', j === i); b.el.classList.toggle('off', j !== i); }); },
  // The name of the move he just did, in big letters for a moment.
  skillName(text) {
    const el = ui.skillName; letters(el.querySelector('b'), text, true);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    for (const n of [ui.skillTag, ui.seenNote, ui.toast]) n.classList.remove('show'); // nothing else up there while it shows: one name at a time
    if (ui.caption.classList.contains('show')) this.caption('');
    clearTimeout(timers.skillName); timers.skillName = setTimeout(() => el.classList.remove('show'), 2200); // (v78: up while the move plays, slowly)
  },
  // Someone else's skill move: a small tag in the corner (not while his own move's name shows).
  skillTag(move, who) { if (!ui.skillName.classList.contains('show')) flash(ui.skillTag, '', `⚡ ${move} · ${who}`, 1500); },
  // Stars for a choice in a match (game/live.js react): 3 or 2 small stars pop one after another with a rising note each,
  // and fade within a second. `at()` gives his place on screen each frame: they ride along over his head.
  // (v93) They come two frames after the call (a result's big words come first: hud.banner), from a frame with them
  // hidden, so their animation starts again with no layout forced; their notes start one by one after that.
  pop(stars, at) {
    const el = ui.pop, inner = el.firstChild, tok = ++popTok;
    marks(inner, 3, stars);
    el.classList.remove('show'); clearTimeout(timers.pop);
    inFrames(2, () => {
      if (tok !== popTok) return;
      // With a praise word up, the stars sit at its end (so they never meet it, and never jump); otherwise over his head.
      // With no `at` (a lesson's light result) they sit just under the result's big words.
      const t = ui.toast.classList.contains('show') && ui.toast.getBoundingClientRect(), b = !at && ui.banner.getBoundingClientRect();
      const side = t ? [t.right + 48, t.bottom - 4] : b ? [b.left + b.width / 2, b.top + b.height * .5 + 82] : null;
      let was = '';
      const t0 = performance.now(), follow = () => {
        if (tok !== popTok) return;
        const q = side || at?.(), s = q ? `translate(${Math.round(q[0])}px,${Math.round(q[1])}px)` : was;
        if (s !== was) { el.style.transform = s; was = s; } // (written only when it moves)
        if (el.classList.contains('show') && performance.now() - t0 < 1300) requestAnimationFrame(follow);
      };
      el.classList.add('show'); follow();
      for (let i = 0; i < stars; i++) setTimeout(() => { if (tok === popTok) sfx('star', i); }, 40 + i * 110);
      timers.pop = setTimeout(() => el.classList.remove('show'), 1200);
    });
  },
  // Words are on screen or being said (a caption, a skill move's name): a spoken hint waits for another time.
  busy() { return hudEl.classList.contains('captioning') || ui.skillName.classList.contains('show'); },
  toast(text, warn) { flash(ui.toast, warn ? 'warn' : '', text, 1600); },
  caption(text) { ui.caption.textContent = text; ui.caption.classList.toggle('show', !!text); hudEl.classList.toggle('captioning', !!text); },
  // One dot per round: gold = right on the first try. The dot just earned pops.
  dots(results, n) {
    const done = results.length, fresh = done > dotsDone; dotsDone = done;
    marks(ui.dots, n, i => (i < done ? (results[i] ? 'star' : 'done') + (fresh && i === done - 1 ? ' new' : '') : i === done ? 'now' : ''), '');
  },
  // The scoreboard: each team's color and short name, the score in the middle. A goal makes its number jump.
  score(s, us, them) {
    const el = ui.score, key = `${us.id} ${s.us} ${them.id} ${s.them}`, was = scoreNow;
    el.classList.remove('hidden');
    if (was?.key === key) return;
    scoreNow = { key, us: s.us, them: s.them };
    const ems = el.querySelectorAll('em');
    if (was && was.teams === `${us.id} ${them.id}` && ems.length === 2) { // (round 14) the same two teams: only the numbers change
      scoreNow.teams = was.teams;
      [[ems[0], s.us, was.us], [ems[1], s.them, was.them]].forEach(([em, v, old]) => { if (em.textContent !== String(v)) em.textContent = v; em.classList.remove('bump'); if (v > old) { void em.offsetWidth; em.classList.add('bump'); } });
      return;
    }
    scoreNow.teams = `${us.id} ${them.id}`;
    const chip = t => `<i style="background:${t.kit.colors[0]}"></i>`, num = (v, old) => `<em class="${was && v > old ? 'bump' : ''}">${v}</em>`;
    el.innerHTML = `${chip(us)}<span>${us.short}</span><b>${num(s.us, was?.us)}–${num(s.them, was?.them)}</b><span>${them.short}</span>${chip(them)}`;
  },
  hideScore() { ui.score.classList.add('hidden'); scoreNow = null; },
};
