// Boot: screens (team picker, cards, results, grown-ups menu), HUD wiring, input, and the session flow.
import { World } from './world.js';
import { Game } from './game.js';
import { TEAMS, teamById, displayName } from './teams.js';
import { PATH, CHAPTERS, UNLOCKS, BUILDS, skillById, sessionRounds } from './skills.js';
import { CUPS, cupById, newCup, roundsOf, goalsToWin } from './cups.js';
import { generate } from './generate.js';
import { VERSION } from './version.js';
import { sfx, unlock as unlockSound, setSoundOn, setMusicOn, setMuted, setVolumes, voiceVolume, duck, loadVoice, canSpeak, speakClips, stopVoice, preloadClips } from './sound.js';
import { pieces, clipKey } from './voice.js';
import { shuffle } from './geom.js';
import { load, save, nextSkill, reviewsDue, finishSession, reviewed, level, isOpen, skills, defaultProgress, graduated, playOpen, trainingPlan, trained, note, today } from './progress.js';


const $ = s => document.querySelector(s);
const P = load();
const canvas = $('#view');
let world;
try { world = new World(canvas, { art: P.settings.art }); } catch (e) {
  document.body.innerHTML = '<p style="padding:24px;font:600 18px system-ui">This device can’t show 3D graphics (WebGL is off).</p>'; throw e;
}

// ---------- voice ----------
// English voices, warmest first: downloaded Premium/Enhanced voices sound far less robotic than the defaults.
// Joke voices (Bubbles, Zarvox...) are left out. The grown-ups menu can pick any of them.
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/;
const WARM = ['Ava', 'Zoe', 'Allison', 'Samantha', 'Nicky', 'Evan', 'Nathan', 'Tom', 'Susan', 'Karen', 'Serena', 'Daniel', 'Moira', 'Google US English'];
const voiceScore = v => (/Premium/.test(v.name) ? 0 : /Enhanced/.test(v.name) ? 100 : 200) + ((WARM.findIndex(n => v.name.startsWith(n)) + 1) || 50) + (v.lang === 'en-US' ? 0 : 5);
let voice = null, voices = [];
const pickVoice = () => {
  voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en') && !NOVELTY.test(v.name)).sort((a, b) => voiceScore(a) - voiceScore(b));
  voice = voices.find(v => v.name === P.settings.voiceName) || voices[0] || null;
};
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
loadVoice();
// Says a line. Returns a promise that resolves once it has been said (null when the voice is off), so demos can
// wait for the end of a sentence before moving on.
function say(text) {
  if (!P.settings.voice || P.settings.muted) return null;
  const line = text.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '');
  // Recorded clips first: they play through the speakers like the game sounds (loud in the car too).
  const keys = pieces(line).map(clipKey);
  if (P.settings.recorded !== false && canSpeak(keys)) { if ('speechSynthesis' in window) speechSynthesis.cancel(); return speakClips(keys); }
  if (!('speechSynthesis' in window)) return null;
  stopVoice();
  const u = new SpeechSynthesisUtterance(line);
  if (voice) u.voice = voice; u.rate = .92; u.pitch = 1.12; u.volume = voiceVolume();
  // The music dips while he talks, so the words stand out (in the car the voice can come through quieter).
  u.onstart = () => duck(true);
  // iOS sometimes never fires onend, so a timeout (about the time the line takes) finishes it too.
  const done = new Promise(res => { u.onend = u.onerror = () => { duck(false); res(); }; setTimeout(res, 1500 + line.length * 90); });
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return done;
}

// ---------- HUD ----------
const hudEl = $('#hud');
const timers = {};
const flash = (el, cls, text, ms) => {
  el.textContent = text; el.className = cls; void el.offsetWidth; el.classList.add('show');
  clearTimeout(timers[el.id]); timers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
};
const tunnel = $('#tunnel');
const hud = {
  state({ phase, step, mode, prompt, nudge, lookUp, look, locked, kind, touchPick, canShoot, showing }) {
    const d = hudEl.dataset;
    hudEl.classList.toggle('showing', !!showing);
    if (d.phase !== phase) d.phase = phase;
    if (d.step !== (step || 'none')) d.step = step || 'none';
    if (d.mode !== mode) d.mode = mode;
    hudEl.classList.toggle('up', lookUp); hudEl.dataset.kind = kind; hudEl.classList.toggle('touchpick', !!touchPick); hudEl.classList.toggle('shoot', !!canShoot);
    const pr = $('#prompt'); if (pr.textContent !== prompt) pr.textContent = prompt;
    $('#lookBtn').classList.toggle('nudge', nudge === 'look');
    $('#passBtn').classList.toggle('locked', !!locked); $('#dribBtn').classList.toggle('locked', !!locked);
    $('#passBtn').classList.toggle('active', step === 'pass'); $('#dribBtn').classList.toggle('active', step === 'dribble');
    const lb = $('#lookBtn'); lb.classList.toggle('on', lookUp);
    const label = lookUp ? 'HEAD DOWN' : 'LOOK UP'; if (lb.lastChild.textContent !== label) { lb.firstChild.textContent = lookUp ? '⚽' : '👀'; lb.lastChild.textContent = label; }
    // Head down = tunnel vision: blurry, darker edges. Clears as he looks up.
    const playerView = (mode === 'lesson' || mode === 'match' || mode === 'demo' || mode === 'free') && (phase === 'pre' || phase === 'decide') && step !== 'dribble';
    tunnel.style.opacity = playerView ? ((1 - look) * .95).toFixed(3) : '0';
  },
  // One result card for every play: the outcome ("GOAL!", "Stole it!"...) appears the moment it happens,
  // then the stars and a short tip fill in underneath. With `watch`, it waits for "Watch the 3-star play" or "Next".
  // `rated` = { stars, text, watch }: in lessons the whole card (title, stars, tip) appears at once, the moment
  // the play ends. Without it (matches, demos) the card is just the title.
  banner(text, kind, rated) {
    const el = $('#rate'), title = el.querySelector('.title');
    title.textContent = text; title.className = 'title ' + kind;
    el.className = rated ? 's' + rated.stars : 'solo';
    el.querySelector('.stars').innerHTML = rated ? [1, 2, 3].map(i => `<span class="${i <= rated.stars ? 'on' : ''}">★</span>`).join('') : '';
    el.querySelector('.txt').textContent = rated?.text || ''; el.querySelector('.btns').classList.toggle('hidden', !rated?.watch);
    void el.offsetWidth; el.classList.add('show'); hudEl.classList.add('rating');
    sfx(kind === 'bad' ? 'aww' : text === 'GOAL!' ? 'goal' : 'yay');
    clearTimeout(timers.rate);
    const done = v => { el.classList.remove('show'); hudEl.classList.remove('rating'); return v; };
    if (!rated) { timers.rate = setTimeout(done, 1700); return Promise.resolve(); }
    [...el.querySelectorAll('.stars span.on')].forEach((sp, i) => setTimeout(() => { sp.classList.add('pop'); sfx('star', i); }, 250 + i * 160));
    return new Promise(res => {
      if (!rated.watch) { timers.rate = setTimeout(() => res(done('next')), rated.stars === 3 ? 1600 + rated.text.length * 45 : 2200); return; }
      $('#rateWatch').onclick = () => res(done('watch')); $('#rateNext').onclick = () => res(done('next'));
    });
  },
  // "You see …": a small note near the top, so it doesn't look like something he has to act on.
  seen(text) { flash($('#seenNote'), '', text, 1400); sfx('ping'); },
  // The teaching hand: `pos` is a button id or a screen point [x, y]; null hides it. A new `tap` number taps once.
  hand(pos, tap) {
    const el = $('#hand'), old = hudEl.querySelector('.pointed');
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
    if (tap && el.dataset.tap !== String(tap)) { el.dataset.tap = tap; el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap'); }
  },
  toast(text, warn) { flash($('#toast'), warn ? 'warn' : '', text, 1600); },
  caption(text) { const c = $('#caption'); c.textContent = text; c.classList.toggle('show', !!text); hudEl.classList.toggle('captioning', !!text); },
  dots(results, n) {
    $('#dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < results.length ? (results[i] ? 'star' : 'done') : i === results.length ? 'now' : ''}"></span>`).join('');
  },
  score(s, us, them) {
    const el = $('#score'); el.classList.remove('hidden');
    el.innerHTML = `<span>${us.short}</span><b>${s.us} – ${s.them}</b><span>${them.short}</span>`;
  },
};

const game = new Game({ world, hud, say, sfx });
// ---------- sound button + popover ----------
const SPEAKER = on => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>${on
  ? '<path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  : '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'}</svg>`;
function applySound() {
  const st = P.settings;
  setSoundOn(st.sound !== false); setMusicOn(st.music !== false); setMuted(!!st.muted);
  setVolumes({ sfx: st.sfxVol ?? 1, music: st.musicVol ?? 1, voice: st.voiceVol ?? 1 });
  const silent = st.muted || (st.sound === false && st.music === false && !st.voice);
  document.querySelectorAll('.soundBtn').forEach(b => { b.innerHTML = SPEAKER(!silent); b.classList.toggle('off', silent); });
  const pop = $('#soundPop'); pop.classList.toggle('muted', !!st.muted);
  $('#muteAll').classList.toggle('on', !!st.muted); $('#muteAll').textContent = st.muted ? 'Unmute' : 'Mute all';
  pop.querySelectorAll('.sp-row').forEach(r => {
    const on = r.dataset.k === 'voice' ? !!st.voice : st[r.dataset.k] !== false;
    r.querySelector('input[type=checkbox]').checked = on; r.classList.toggle('off', !on);
    r.querySelector('input[type=range]').value = Math.round((st[r.dataset.v] ?? 1) * 100);
  });
}
function toggleSoundPop(btn) {
  const pop = $('#soundPop'), open = pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !open);
  if (open) { pop.classList.toggle('in-game', btn.classList.contains('hud-sound')); applySound(); }
}
document.querySelectorAll('.soundBtn').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); unlockSound(); toggleSoundPop(b); }));
// Tapping anywhere outside closes it.
document.addEventListener('pointerdown', e => { if (!e.target.closest('#soundPop, .soundBtn')) $('#soundPop').classList.add('hidden'); }, true);
$('#soundPop').addEventListener('pointerdown', e => e.stopPropagation());
$('#muteAll').onclick = () => { P.settings.muted = !P.settings.muted; save(P); applySound(); };
$('#soundPop').querySelectorAll('.sp-row').forEach(r => {
  const k = r.dataset.k, v = r.dataset.v;
  r.querySelector('input[type=checkbox]').onchange = e => { P.settings[k] = e.target.checked; if (e.target.checked) P.settings.muted = false; save(P); applySound(); };
  const range = r.querySelector('input[type=range]');
  range.oninput = () => { P.settings[v] = range.value / 100; applySound(); };
  // Let go of the slider: save it and play a sample at the new level.
  range.onchange = () => { save(P); if (k === 'sound') sfx('kick'); if (k === 'voice') say('Nice pass! You looked up!'); };
});
applySound();
// Sound can only start after a tap; every chunky button also clicks.
document.addEventListener('pointerdown', e => { unlockSound(); if (e.target.closest('.btn,.chip')) sfx('click'); }, true);

// ---------- screens ----------
const screens = ['#home', '#card', '#results', '#menu'];
const show = id => { for (const s of screens) $(s).classList.toggle('hidden', s !== id); hudEl.classList.toggle('hidden', id !== null); };

function drawShirt(cv, kit, num) {
  const g = cv.getContext('2d'), Wd = cv.width; g.clearRect(0, 0, Wd, Wd); g.save(); g.scale(Wd / 160, Wd / 160);
  const body = new Path2D('M50 22 Q60 16 68 13 Q80 30 92 13 Q100 16 110 22 L143 46 Q138 60 124 70 L110 61 L111 146 Q80 152 49 146 L50 61 L36 70 Q22 60 17 46 Z');
  const sleeveL = new Path2D('M50 22 L17 46 Q22 60 36 70 L50 61 Z'), sleeveR = new Path2D('M110 22 L143 46 Q138 60 124 70 L110 61 Z');
  g.fillStyle = kit.colors[0]; g.fill(body);
  g.save(); g.clip(body);
  if (kit.pattern === 'stripes') { g.fillStyle = kit.colors[1]; for (let x = 44; x < 116; x += 24) g.fillRect(x, 0, 12, 160); }
  if (kit.pattern === 'band') { g.fillStyle = '#fff'; g.fillRect(65, 0, 30, 160); g.fillStyle = kit.colors[1]; g.fillRect(70, 0, 20, 160); }
  if (kit.pattern === 'sleeves') { g.fillStyle = kit.colors[1]; g.fill(sleeveL); g.fill(sleeveR); }
  g.fillStyle = kit.trim; for (const p of [[22, 52, 34, 64], [138, 52, 126, 64]]) { g.save(); g.lineWidth = 5; g.strokeStyle = kit.trim; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.stroke(); g.restore(); }
  const shade = g.createLinearGradient(0, 0, 160, 0); shade.addColorStop(0, 'rgba(255,255,255,.22)'); shade.addColorStop(.45, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,.18)');
  g.fillStyle = shade; g.fillRect(0, 0, 160, 160);
  g.restore();
  g.strokeStyle = kit.trim; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(67, 14); g.quadraticCurveTo(80, 32, 93, 14); g.stroke();
  g.font = '700 50px Fredoka, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.3)';
  g.strokeText(num, 80, 94); g.fillStyle = kit.num; g.fillText(num, 80, 94);
  g.strokeStyle = 'rgba(36,25,58,.55)'; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke(body);
  g.restore();
}
// Cycles through teams of the same kind (clubs or countries) as `id`, skipping the other side's team.
const neighbor = (id, dir, skip) => {
  const type = teamById(id).type, list = TEAMS.filter(t => t.type === type);
  let i = list.findIndex(t => t.id === id);
  do { i = (i + dir + list.length) % list.length; } while (list[i].id === skip && list.length > 1);
  return list[i];
};
function renderPickers(flip) {
  for (const side of ['us', 'them']) {
    const el = $(`.team[data-side=${side}]`), t = teamById(P[side]), other = side === 'us' ? P.them : P.us;
    const prev = neighbor(t.id, -1, other), next = neighbor(t.id, 1, other);
    drawShirt(el.querySelector('.main'), t.kit, t.players[0].num);
    drawShirt(el.querySelector('.side.l'), prev.kit, prev.players[0].num);
    drawShirt(el.querySelector('.side.r'), next.kit, next.players[0].num);
    el.style.setProperty('--team', t.kit.colors[0]);
    el.querySelector('.tname').textContent = t.name;
    el.querySelectorAll('.kind button').forEach(b => b.classList.toggle('on', b.dataset.type === t.type));
    el.querySelector('.roster').innerHTML = t.players.map(p => `<span>${displayName(p.name)}</span>`).join('');
    if (flip && flip.side === side) { const sh = el.querySelector('.shirts'); sh.classList.remove('flip-next', 'flip-prev'); void sh.offsetWidth; sh.classList.add(flip.dir > 0 ? 'flip-next' : 'flip-prev'); }
  }
  game.setTeams(teamById(P.us), teamById(P.them));
  renderLessons();
}
// A lesson unlocks after the one before it has been played once (or once it has been played itself).
const lessonOpen = i => isOpen(P, PATH, i);
// The lesson sheet: one row per chapter. Stars show the level reached (1–3); each level needs a good session
// on a new day. Picking a tile plays it next (once); otherwise PLAY uses the coach's pick.
// Once every lesson is passed, PLAY is "Today's training" unless he picked a lesson (or a grown-up locked one).
const trainingNext = () => graduated(P, PATH) && !(P.pick && skillById(P.pick)) && !(P.settings.skill && skillById(P.settings.skill)?.ready);
function renderLessons() {
  const training = trainingNext(), cur = training ? null : nextSkill(P, PATH), sk = training ? { emoji: '💪', kid: "Today's training" } : skillById(cur);
  const tile = l => {
    const i = PATH.indexOf(l), open = lessonOpen(i), lv = level(P, l.id);
    return `<button class="tile ${l.id === cur ? 'on' : ''} ${open ? '' : 'locked'} ${l.side === 'defense' ? 'def' : ''}" data-id="${l.id}" ${open ? '' : 'disabled'}>
      <span class="e">${open ? l.emoji : '🔒'}</span><span class="k">${l.kid}</span><span class="st">${'★'.repeat(lv)}<i>${'★'.repeat(lv ? 3 - lv : 0)}</i></span></button>`;
  };
  const top = graduated(P, PATH) ? `<button class="tile train ${training ? 'on' : ''}" data-id=""><span class="e">💪</span><span class="k">Today's training</span><span class="st">a mix of what you need</span></button>` : '';
  $('#lessons').innerHTML = top + CHAPTERS.map((name, ch) => `<div class="chap"><div class="cn"><b>${ch + 1}</b>${name}</div><div class="row">${PATH.filter(l => l.ch === ch).map(tile).join('')}</div></div>`).join('');
  $('#lessonBtn .le').textContent = sk.emoji; $('#lessonBtn b').textContent = sk.kid;
  document.querySelectorAll('#lessons .tile').forEach(c => c.onclick = () => { P.pick = c.dataset.id || null; save(P); renderLessons(); $('#lessonSheet').classList.add('hidden'); });
  renderGate();
}
// Match and Cup open for the day once he has done today's lesson or training.
function renderGate() { for (const b of ['#freeBtn', '#cupBtn']) $(b).classList.toggle('locked', !playOpen(P)); }
$('#lessonBtn').onclick = () => $('#lessonSheet').classList.remove('hidden');
// Sticker album: a sticker per lesson, ringed by the level reached (bronze, silver, gold), with how many he has.
// Lessons not played yet show a grey sticker, so he can see what is still to come.
function renderAlbum() {
  const count = id => P.stickers.filter(s => s.skill === id).length, cups = P.stickers.filter(s => s.emoji === '🏆').length;
  const cell = l => { const lv = level(P, l.id), n = count(l.id);
    return `<div class="st ${lv ? 'l' + lv : 'none'}"><div class="f">${l.emoji}</div><span class="nm">${l.kid}</span><span class="lv">${lv ? '★'.repeat(lv) : ''}${n ? ' ×' + n : ''}</span></div>`; };
  $('#album').innerHTML = CHAPTERS.map((name, ch) => `<div class="chap"><div class="cn"><b>${ch + 1}</b>${name}</div><div class="row">${PATH.filter(l => l.ch === ch).map(cell).join('')}</div></div>`).join('')
    + `<div class="chap"><div class="cn"><b>🏆</b>Cups</div><div class="row cups">${CUPS.map(c => { const n = (P.trophies || []).filter(t => t.cup === c.id).length;
      return `<div class="st ${n ? 'l3' : 'none'}"><div class="f">${c.emoji}</div><span class="nm">${c.name}</span><span class="lv">${n ? '🏆' + (n > 1 ? ' ×' + n : '') : ''}</span></div>`; }).join('')}</div></div>`
    + (cups ? `<div class="trophies">⚽ ${cups} match${cups === 1 ? '' : 'es'} won</div>` : '');
}
$('#albumBtn').onclick = () => { renderAlbum(); $('#albumSheet').classList.remove('hidden'); };
$('#albumClose').onclick = () => $('#albumSheet').classList.add('hidden');
$('#albumSheet').onclick = e => { if (e.target.id === 'albumSheet') $('#albumSheet').classList.add('hidden'); };
$('#sheetClose').onclick = () => $('#lessonSheet').classList.add('hidden');
$('#lessonSheet').onclick = e => { if (e.target.id === 'lessonSheet') $('#lessonSheet').classList.add('hidden'); };
function cycle(side, dir) {
  P[side] = neighbor(P[side], dir, side === 'us' ? P.them : P.us).id; save(P); renderPickers({ side, dir });
}
document.querySelectorAll('.team').forEach(el => {
  const side = el.dataset.side;
  el.querySelectorAll('.kind button').forEach(b => b.onclick = () => {
    if (teamById(P[side]).type === b.dataset.type) return;
    const skip = side === 'us' ? P.them : P.us;
    P[side] = TEAMS.find(t => t.type === b.dataset.type && t.id !== skip).id; save(P); renderPickers({ side, dir: 1 });
  });
  el.querySelector('.prev').onclick = () => cycle(side, -1);
  el.querySelector('.next').onclick = () => cycle(side, 1);
  el.querySelector('.side.l').onclick = () => cycle(side, -1);
  el.querySelector('.side.r').onclick = () => cycle(side, 1);
  let sx = null; const sh = el.querySelector('.shirts');
  sh.addEventListener('pointerdown', e => { sx = e.clientX; });
  sh.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 30) cycle(side, e.clientX < sx ? 1 : -1); sx = null; });
});

// Shows a card and resolves 'main' or 'alt' with the button that was tapped.
function card({ emoji, title, sub, html, lines = [], button, alt }) {
  $('#card .emoji').textContent = emoji; $('#card h2').textContent = title;
  if (html) $('#card p').innerHTML = html; else $('#card p').textContent = sub || '';
  const main = $('#cardMain'), other = $('#cardAlt');
  main.textContent = button; other.textContent = alt || ''; other.classList.toggle('hidden', !alt);
  $('#card').classList.remove('hidden');
  (async () => { await say(title); for (const l of lines) if (!$('#card').classList.contains('hidden')) await say(l); })();
  return new Promise(res => {
    const done = v => { $('#card').classList.add('hidden'); res(v); };
    main.onclick = () => done('main'); other.onclick = () => done('alt');
  });
}

// The sticker he just earned, shown on the results card (replaces the plain emoji).
function showSticker(emoji, trophy) {
  const st = $('#results .sticker'), clone = st.cloneNode(true); // a fresh copy restarts the slap animation
  clone.querySelector('span').textContent = emoji; clone.classList.toggle('trophy', !!trophy); clone.classList.remove('hidden');
  st.replaceWith(clone); $('#results .emoji').classList.add('hidden'); setTimeout(() => sfx('star', 2), 250);
}

// Clears the results card before a flow fills it in.
function resetResults() {
  $('#results .sticker').classList.add('hidden'); $('#results .emoji').classList.remove('hidden');
  for (const k of ['.roundsrow', '.roundsnote', '.levelup', '.outside']) $('#results ' + k).innerHTML = '';
  $('#nextLessonBtn').classList.add('hidden'); $('#againBtn').classList.remove('hidden');
}
// Results buttons: the main one is big, in its activity's color (lesson green, match blue, cup gold), and ends in ▶.
// The other one is plain white. With no main button, the other one takes its place.
const KIND = { lesson: 'btn-green', match: 'btn-blue', cup: 'btn-gold' };
function resultsButtons(main, other) {
  const set = (el, b, big, arrow) => {
    el.className = `btn ${big ? 'btn-lg ' + KIND[b?.kind] : 'btn-ghost'}${b ? '' : ' hidden'}`; if (!b) return;
    el.innerHTML = `${b.icon ? `<i class="ico">${b.icon}</i>` : ''}${b.text}${arrow ? ' ▶' : ''}`; el.onclick = b.go;
  };
  if (main) { set($('#nextLessonBtn'), main, true, true); set($('#againBtn'), other, false); }
  else { set($('#nextLessonBtn'), other, true, false); set($('#againBtn'), null); }
}
// Match and Cup need today's lesson or training first (a grown-up can open them in the menu).
async function gated(run) {
  if (playOpen(P)) return run();
  const r = await card({ emoji: '🔒', title: 'Train first!', sub: `Do today's ${graduated(P, PATH) ? 'training' : 'lesson'} to open Match and Cup.`, button: '💪 Train', alt: 'Not now' });
  if (r === 'main') { unlockAudio(); runSession(); }
}

// ---------- session ----------
const fresh = (n, ids) => Array.from({ length: n }, () => generate(ids[Math.floor(Math.random() * ids.length)], Math.floor(Math.random() * 1e9))).filter(Boolean);
let running = false;
async function runSession() {
  if (trainingNext()) return runTraining();
  if (running) return; running = true;
  const skillId = nextSkill(P, PATH), sk = skillById(skillId), lvl = level(P, skillId);
  // Reviews: 1 round in a lesson's first session, 2 at Levels 1–2, 3 at Level 3 (mixing in more old lessons).
  const reviews = reviewsDue(P, PATH, skillId).slice(0, lvl === 0 ? 1 : lvl >= 3 ? 3 : 2);
  const us = teamById(P.us), them = teamById(P.them), hero = displayName(us.players[0].name);
  game.setTeams(us, them);
  preloadClips([...us.players, ...them.players].map(p => 'name:' + pieces(displayName(p.name))[0]?.name));
  world.setEnv('park'); // practice at the park; the mini match is in the stadium
  show(null); $('#score').classList.add('hidden'); hud.dots([], 0);
  // The demo plays the first time a lesson is played; after that it's one tap away.
  const firstTime = !P.skills[skillId]?.sessions;
  const watch = await card({ emoji: sk.emoji, title: sk.kid, sub: firstTime ? `Watch ${hero} first` : `Want to watch ${hero} first?`,
    button: firstTime ? 'Watch' : 'Play', alt: firstTime ? 'Skip' : 'Watch' });
  if (firstTime ? watch === 'main' : watch === 'alt') await game.demo(skillId);
  const how = sk.id === 'steal-it' ? `You are ${hero}, defending. Tap STEAL when the ball rolls away from his feet.`
    : sk.id === 'peek-and-turn' ? `You are ${hero}. A friend passes to you. Drag to peek behind you, then tap the arrow to turn.`
    : sk.id === 'give-and-go' ? `You are ${hero}. Pass, then tap where to run.`
    : sk.side === 'defense' ? `You are ${hero}, defending. Tap 👀 to look up, then tap where to run.`
    : sk.id === 'get-open' ? `You are ${hero}. A friend has the ball. Tap 👀 to look up, then tap where to run.` : `You are ${hero}. Tap 👀 to look up, then drag to look around.`;
  await card({ emoji: '⭐', title: 'Your turn!', sub: how, button: 'Play' });
  // This lesson's rounds (the same scenes the first time, fresh ones after), with one review round from each
  // lesson that is due mixed in after the first two.
  const n = P.settings.rounds, own = sessionRounds(skillId, n - reviews.length, { first: firstTime, level: Math.max(1, lvl) });
  const rev = reviews.map(id => generate(id, Math.floor(Math.random() * 1e9), { even: true })).filter(Boolean);
  const rounds = [...own.slice(0, 2), ...shuffle([...own.slice(2), ...rev])], results = [];
  let misses = 0;
  hud.dots(results, rounds.length);
  for (let i = 0; i < rounds.length; i++) {
    // Hints (the glowing cue, LOOK pulsing) for the first two rounds at Level 1, and after two misses in a row.
    const r = await game.round(rounds[i], { hint: (i < 2 && lvl <= 1) || misses >= 2 });
    results.push(r.firstTry && r.stars === 3); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, rounds.length);
    if (rounds[i].skill !== skillId) { reviewed(P, rounds[i].skill, r.firstTry && r.stars === 3); save(P); }
  }
  // Score the lesson before the mini match, so a skill passed just now is already in it.
  const firstTry = results.filter(Boolean).length, st = finishSession(P, skillId, firstTry, rounds.length); P.pick = null;
  note(P, skillId, results.filter((_, i) => rounds[i].skill === skillId)); P.openDay = today(); save(P);
  world.setEnv('crowd'); game.skills = skills(P, PATH);
  await card(st.unlocked ? { emoji: '🔓', title: 'New in matches!', sub: `${UNLOCKS[skillId]}. First to 2 goals wins.`, button: 'Kick off' }
    : !st.passedNow && level(P, skillId) === 0 ? { emoji: '🏟️', title: 'Mini match!', sub: `Get ${Math.ceil(rounds.length * 2 / 3)} right next time to unlock this in matches. First to 2 goals wins.`, button: 'Kick off' }
    : { emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: 'Kick off' });
  const score = await game.match([skillId, ...reviews], fresh(6, [skillId, ...reviews]));
  const won = score.us > score.them;
  P.stickers.push({ emoji: won ? '🏆' : sk.emoji, skill: skillId, at: Date.now() }); save(P); resetResults();
  showSticker(won ? '🏆' : sk.emoji, won);
  $('#results h2').textContent = won ? 'You won!' : 'Great try!';
  // One circle per round, like the dots during the lesson: gold = right on the first try.
  $('#results .roundsrow').innerHTML = results.map(ok => `<span class="${ok ? 'star' : 'done'}"></span>`).join('');
  $('#results .roundsnote').textContent = `${firstTry} of ${rounds.length} right on the first try`;
  // Level news, then a backyard game for the grown-up.
  $('#results .levelup').textContent = st.unlocked ? `🔓 Unlocked: ${UNLOCKS[skillId]}` : st.leveledUp ? `${'⭐'.repeat(st.level)} Level ${st.level}!` : !level(P, skillId) ? `Get ${Math.ceil(rounds.length * 2 / 3)} right to unlock the next lesson` : '';
  $('#results .outside').innerHTML = sk.outside ? `<b>🏡 Try it outside</b>${sk.outside}` : '';
  const i = PATH.findIndex(s => s.id === skillId), nextSk = PATH[i + 1];
  // The next lesson opens once this one is passed.
  resultsButtons(nextSk && lessonOpen(i + 1) ? { kind: 'lesson', text: 'Next lesson', go: () => { P.pick = nextSk.id; save(P); runSession(); } } : null,
    { kind: 'lesson', icon: '↺', text: 'Play again', go: () => { P.pick = skillId; runSession(); } });
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  say(won ? 'You won! You got a new sticker!' : 'Great try! You got a new sticker!');
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#playBtn').onclick = () => { unlockAudio(); runSession(); };
// Match: first to 3 goals, mixing every lesson he has passed (attack and defense), with everything they unlock.
async function runFreePlay() {
  if (running) return; running = true; unlockAudio();
  // Every situation from the lessons he has passed, with everything those lessons unlock.
  const has = skills(P, PATH), ids = has.size ? [...has] : ['look-up']; game.skills = has;
  const us = teamById(P.us), them = teamById(P.them);
  game.setTeams(us, them); world.setEnv('crowd'); show(null); hud.dots([], 0);
  await card({ emoji: '⚽', title: 'Match time!', sub: `First to 3 goals. ${us.name} vs ${them.name}`, button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), 3, 'free'), won = score.us > score.them;
  if (won) { P.stickers.push({ emoji: '🏆', skill: 'free', at: Date.now() }); save(P); }
  resetResults(); $('#results .emoji').textContent = '⚽'; if (won) showSticker('🏆', true);
  $('#results h2').textContent = won ? 'You won the match!' : 'Good game!';
  resultsButtons({ kind: 'cup', icon: '🏆', text: 'Cup', go: openCups }, { kind: 'match', icon: '↺', text: 'Play again', go: runFreePlay });
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  say(won ? 'You won the match!' : 'Good game!');
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#freeBtn').onclick = () => gated(runFreePlay);
$('#cupBtn').onclick = () => gated(openCups);

// ---------- today's training ----------
// Once every lesson is passed, PLAY is a short mixed session: the 3 lessons he needs most today (see trainingPlan),
// 2 rounds each, mixed so he has to work out which idea fits. It opens with a reminder of the 3 ideas, and
// finishing it opens Match and Cup for the day.
// The tip without the lesson name, when the tip opens with it as its own sentence ("Get open! Move to…").
const tipAfterName = k => { const rest = k.tip.startsWith(k.kid) ? k.tip.slice(k.kid.length) : null;
  return rest !== null && (/[.!?]$/.test(k.kid) || /^[.!?]/.test(rest)) ? rest.replace(/^[.!?\s]+/, '') : k.tip; };
async function runTraining() {
  if (running) return; running = true;
  const day = today(), plan = trainingPlan(P, PATH, { day, builds: BUILDS }), n = P.settings.rounds;
  const us = teamById(P.us), them = teamById(P.them), hero = displayName(us.players[0].name);
  game.setTeams(us, them);
  preloadClips([...us.players, ...them.players].map(p => 'name:' + pieces(displayName(p.name))[0]?.name));
  world.setEnv('park'); show(null); $('#score').classList.add('hidden'); hud.dots([], 0);
  const sks = plan.map(skillById);
  await card({ emoji: '💪', title: "Today's training!", html: `<span class="remind">${sks.map(k => `<span><i>${k.emoji}</i><b>${k.kid}</b><small>${tipAfterName(k)}</small></span>`).join('')}</span>`,
    lines: sks.map(k => k.kid), button: 'Play' });
  const order = Array.from({ length: n }, (_, i) => plan[i % plan.length]);
  const rounds = order.map(id => { for (let k = 0; k < 8; k++) { const sc = generate(id, Math.floor(Math.random() * 1e9), { even: true }); if (sc) return sc; } return null; }).filter(Boolean);
  const results = [], per = {};
  let misses = 0;
  hud.dots(results, rounds.length);
  for (const sc of rounds) {
    const r = await game.round(sc, { hint: misses >= 2 }), right = r.firstTry && r.stars === 3;
    results.push(right); (per[sc.skill] ||= []).push(right); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, rounds.length);
  }
  const ups = plan.filter(id => per[id] && trained(P, id, per[id], { day, builds: BUILDS }).leveledUp);
  P.openDay = day; P.sessions++; P.pick = null; save(P);
  resetResults(); $('#results .emoji').textContent = '💪';
  $('#results h2').textContent = 'Training done!';
  $('#results .roundsrow').innerHTML = results.map(ok => `<span class="${ok ? 'star' : 'done'}"></span>`).join('');
  $('#results .roundsnote').textContent = `${results.filter(Boolean).length} of ${results.length} right on the first try`;
  $('#results .levelup').textContent = ups.map(id => `${'⭐'.repeat(level(P, id))} ${skillById(id).kid}`).join(' · ');
  const weak = plan.find(id => per[id]?.some(ok => !ok)) || plan[0];
  $('#results .outside').innerHTML = skillById(weak).outside ? `<b>🏡 Try it outside</b>${skillById(weak).outside}` : '';
  $('#results p').textContent = '⚽ Match and 🏆 Cup are open!';
  resultsButtons({ kind: 'cup', icon: '🏆', text: 'Cup', go: openCups }, { kind: 'match', icon: '⚽', text: 'Match', go: runFreePlay });
  say('Training done!');
  game.home(); show('#results'); renderPickers(); running = false;
}

// ---------- cups ----------
// The cup sheet: every cup as a same-size tile. Dots show the rounds (green = won, gold = next);
// a badge counts the trophies won.
function openCups() {
  show('#home');
  $('#cups').innerHTML = CUPS.map(c => {
    const won = (P.trophies || []).filter(t => t.cup === c.id).length, run = P.cup?.id === c.id ? P.cup : null;
    const dots = roundsOf(c).map((_, i) => `<i class="${run && i < run.round ? 'done' : run && i === run.round ? 'now' : ''}"></i>`).join('');
    return `<button class="tile ${run ? 'on' : ''}" data-id="${c.id}">${won ? `<span class="won">🏆${won > 1 ? won : ''}</span>` : ''}`
      + `<span class="e">${c.emoji}</span><span class="k">${c.name}</span><span class="dots">${dots}</span></button>`;
  }).join('');
  document.querySelectorAll('#cups .tile').forEach(t => t.onclick = () => { $('#cupSheet').classList.add('hidden'); runCup(t.dataset.id); });
  $('#cupSheet').classList.remove('hidden');
}
$('#cupClose').onclick = () => $('#cupSheet').classList.add('hidden');
$('#cupSheet').onclick = e => { if (e.target.id === 'cupSheet') $('#cupSheet').classList.add('hidden'); };
// A team's shirt as a small image, for the cup path.
const shirts = {};
function shirtImg(t) {
  if (!shirts[t.id]) { const cv = document.createElement('canvas'); cv.width = cv.height = 96; drawShirt(cv, t.kit, t.players[0].num); shirts[t.id] = cv.toDataURL(); }
  return shirts[t.id];
}
// The road to the trophy: one same-size step per round (won, next, still to come), then the cup.
const STEP = { 'Quarter-final': 'Quarters', 'Semi-final': 'Semis', Final: 'Final' };
function cupPath(run) {
  const cup = cupById(run.id);
  const steps = roundsOf(cup).map((name, i) => { const t = teamById(run.opps[i]), st = i < run.round ? 'done' : i === run.round ? 'now' : '';
    return `<span class="step ${st}"><small>${STEP[name]}</small><span class="pic"><img src="${shirtImg(t)}" alt="">${st === 'done' ? '<em>✓</em>' : ''}</span><b>${t.short}</b></span>`; });
  return `<span class="cuppath">${steps.join('<span class="link"></span>')}<span class="link"></span><span class="step prize"><small>Win</small><span class="pic">${cup.emoji}</span><b>Cup!</b></span></span>`;
}
async function runCup(cupId) {
  if (running) return; running = true; unlockAudio();
  const cup = cupById(cupId);
  if (P.cup?.id !== cupId) { P.cup = newCup(cup, P.us); save(P); }
  const run = P.cup, names = roundsOf(cup), us = teamById(run.team), them = teamById(run.opps[run.round]), final = run.round === names.length - 1;
  const has = skills(P, PATH), ids = has.size ? [...has] : ['look-up']; game.skills = has;
  game.setTeams(us, them);
  preloadClips([...us.players, ...them.players].map(p => 'name:' + pieces(displayName(p.name))[0]?.name));
  world.setEnv('crowd'); show(null); hud.dots([], 0);
  await card({ emoji: cup.emoji, title: cup.name, html: `<b>${names[run.round]}</b> · ${us.name} vs ${them.name} · first to ${goalsToWin(run)} goals${cupPath(run)}`, lines: [final ? 'The final!' : ''].filter(Boolean), button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), goalsToWin(run), 'free'), won = score.us > score.them;
  if (won && final) { (P.trophies ||= []).push({ cup: cup.id, team: run.team, at: Date.now() }); P.cup = null; }
  else if (won) run.round++;
  save(P);
  resetResults(); $('#results .emoji').textContent = cup.emoji;
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  if (won && final) {
    showSticker(cup.emoji, true); $('#results h2').textContent = 'Champions!';
    $('#results .levelup').textContent = `You won the ${cup.name}!`;
    resultsButtons({ kind: 'cup', icon: '🏆', text: 'Another cup', go: openCups }, null);
    say('You won the cup!');
  } else {
    $('#results h2').textContent = won ? 'You won!' : 'So close!';
    $('#results .levelup').textContent = won ? `On to the ${names[run.round].toLowerCase()}!` : `Play the ${names[run.round].toLowerCase()} again!`;
    $('#results .outside').innerHTML = cupPath(run);
    resultsButtons({ kind: 'cup', icon: '⚽', text: won ? names[run.round] : 'Try again', go: () => runCup(cupId) }, { kind: 'cup', icon: '🏆', text: 'All cups', go: openCups });
    say(won ? 'You won! On to the next round!' : 'So close! Try again!');
  }
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#shootBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.shoot(); });
$('#stealBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.stealTap(); });
$('#touchSmall').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.touch('small'); });
$('#touchBig').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.touch('big'); });
$('#resultsHome').onclick = () => show('#home');
$('#homeBtn').onclick = () => location.reload();
$('#skipBtn').onclick = () => { game.skipDemo(); stopVoice(); if ('speechSynthesis' in window) speechSynthesis.cancel(); };
function unlockAudio() { if ('speechSynthesis' in window && P.settings.voice) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } }

// ---------- grown-ups menu (hold the gear) ----------
let gearTimer;
let gearDown = 0, tipTimer;
$('#gear').addEventListener('pointerdown', () => { gearDown = Date.now(); $('#gear').classList.add('holding'); gearTimer = setTimeout(openMenu, 1200); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#gear').addEventListener(ev, () => {
  $('#gear').classList.remove('holding'); clearTimeout(gearTimer);
  if (ev === 'pointerup' && gearDown && Date.now() - gearDown < 1200) { $('#gearTip').classList.add('show'); clearTimeout(tipTimer); tipTimer = setTimeout(() => $('#gearTip').classList.remove('show'), 1800); }
  gearDown = 0;
});
function openMenu() {
  $('#gear').classList.remove('holding');
  $('#skillSel').innerHTML = `<option value="">Automatic (${graduated(P, PATH) ? "Today's training" : skillById(nextSkill({ ...P, settings: { ...P.settings, skill: null } }, PATH)).kid})</option>` +
    PATH.map(s => `<option value="${s.id}" ${s.ready ? '' : 'disabled'} ${P.settings.skill === s.id ? 'selected' : ''}>${s.emoji} ${s.kid}${s.ready ? '' : ' (coming soon)'}</option>`).join('');
  $('#openChk').checked = !!P.settings.alwaysOpen; $('#roundsSel').value = String(P.settings.rounds); $('#artSel').value = P.settings.art || 'lowpoly';
  if ('speechSynthesis' in window) pickVoice();
  $('#voiceSel').innerHTML = voices.length ? voices.map(v => `<option ${v === voice ? 'selected' : ''}>${v.name}</option>`).join('') : '<option>Default</option>';
  $('#recordedChk').checked = P.settings.recorded !== false;
  $('#progressList').innerHTML = PATH.map(s => {
    const st = P.skills[s.id];
    return `<div><span>${s.emoji} ${s.adult}</span><span>${!s.ready ? 'not built yet' : !st ? 'not started' : `Level ${level(P, s.id)} · ${st.days || 1} day${(st.days || 1) > 1 ? 's' : ''} · ${st.firstTry}/${st.rounds} first try`}</span></div>`;
  }).join('') + `<div><span>Sessions played</span><span>${P.sessions}</span></div>`;
  show('#menu');
}
$('#menuClose').onclick = () => {
  P.settings.skill = $('#skillSel').value || null; P.settings.alwaysOpen = $('#openChk').checked; P.settings.rounds = +$('#roundsSel').value; P.settings.recorded = $('#recordedChk').checked; P.settings.voiceName = $('#voiceSel').value; if ('speechSynthesis' in window) pickVoice(); applySound();
  const art = $('#artSel').value; if (art !== (P.settings.art || 'lowpoly')) { P.settings.art = art; save(P); location.reload(); return; }
  save(P); renderPickers(); show('#home');
};
$('#voiceSel').onchange = () => { P.settings.voiceName = $('#voiceSel').value; pickVoice(); say('Nice pass! You looked up!'); };
$('#voiceTest').onclick = () => say('Nice pass! You looked up!');
$('#resetBtn').onclick = () => {
  if (!confirm('Reset all progress and stickers?')) return;
  const fresh = defaultProgress(); fresh.us = P.us; fresh.them = P.them; Object.keys(P).forEach(k => delete P[k]); Object.assign(P, fresh); save(P); renderPickers(); openMenu();
};

// ---------- input ----------
// A touch only picks a player, spot or arrow if the finger lifts without sliding; any slide is a look-around drag.
let press = null;
canvas.addEventListener('pointerdown', e => {
  press = { x: e.clientX, y: e.clientY, moved: false };
  game.lookStart(e.clientX, canvas.clientWidth); e.preventDefault();
});
$('#lookBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.toggleLook(); });
addEventListener('pointermove', e => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) press.moved = true;
  game.lookMove(e.clientX);
});
addEventListener('pointerup', e => {
  const p = press; press = null; game.lookEnd();
  if (p && !p.moved && e.target === canvas) game.tap(p.x, p.y);
});
addEventListener('pointercancel', () => { press = null; game.lookEnd(); });
$('#passBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.pass(); });
$('#dribBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.dribble(); });
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- loop ----------
renderPickers(); show('#home');
$('#version').textContent = VERSION;
let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt;
  requestAnimationFrame(frame);
  try { game.tick(dt, time); world.render(game.sim, game.cam, game.ui, time); matchStrip(now); } catch (e) { console.error(e); }
}
// On iPad, a home-screen app can leave a thin strip under the page that the page can't draw into. iPadOS paints
// it with the page's background color, so while he plays, that color follows the grass along the bottom edge of
// the field (read from the frame just drawn, twice a second). On the menus it stays peach.
const themeMeta = document.querySelector('meta[name="theme-color"]'), PEACH = '#ffc89a';
let tint = PEACH, tintAt = 0;
function matchStrip(now) {
  if (now - tintAt < 500) return; tintAt = now;
  let c = PEACH;
  if (!hudEl.classList.contains('hidden')) {
    const gl = world.renderer.getContext(), w = gl.drawingBufferWidth, px = new Uint8Array(w * 4);
    gl.readPixels(0, 0, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // the bottom row (WebGL rows start at the bottom)
    const mid = k => { const v = []; for (let i = 1; i < 16; i++) v.push(px[Math.floor(w * i / 16) * 4 + k]); return v.sort((a, b) => a - b)[7]; }; // median: a player's boot doesn't change it
    // Head down, the screen edges are dimmed (the tunnel: brightness .8, saturation .75), so dim the strip to match.
    const o = +tunnel.style.opacity || 0, rgb = [0, 1, 2].map(mid), gray = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    const dimmed = rgb.map(v => Math.round(Math.min(255, (gray + (v - gray) * (1 - .25 * o)) * (1 - .2 * o))));
    if (px.some(v => v)) c = '#' + dimmed.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  if (c === tint) return;
  tint = c; document.documentElement.style.backgroundColor = c; document.body.style.backgroundColor = c; themeMeta?.setAttribute('content', c);
}
requestAnimationFrame(frame);
window.__game = game; // for debugging in the console
try { sessionStorage.removeItem('healed'); } catch { /* storage blocked */ } // booted fine (see index.html)
