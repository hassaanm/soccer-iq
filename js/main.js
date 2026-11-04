// Boot: screens (team picker, cards, results, grown-ups menu), HUD wiring, input, and the session flow.
import { World } from './world.js';
import { Game } from './game.js';
import { TEAMS, teamById, displayName } from './teams.js';
import { PATH, CHAPTERS, UNLOCKS, skillById, sessionRounds } from './skills.js';
import { generate } from './generate.js';
import { VERSION } from './version.js';
import { sfx, unlock as unlockSound, setSoundOn, setMusicOn, setMuted, setVolumes, voiceVolume, duck, loadVoice, canSpeak, speakClips, stopVoice, preloadClips } from './sound.js';
import { pieces, clipKey } from './voice.js';
import { shuffle } from './geom.js';
import { load, save, nextSkill, reviewsDue, finishSession, reviewed, level, isOpen, skills, defaultProgress } from './progress.js';

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
function say(text) {
  if (!P.settings.voice || P.settings.muted) return;
  const line = text.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, '');
  // Recorded clips first: they play through the speakers like the game sounds (loud in the car too).
  const keys = pieces(line).map(clipKey);
  if (P.settings.recorded !== false && canSpeak(keys)) { if ('speechSynthesis' in window) speechSynthesis.cancel(); speakClips(keys); return; }
  if (!('speechSynthesis' in window)) return;
  stopVoice();
  const u = new SpeechSynthesisUtterance(line);
  if (voice) u.voice = voice; u.rate = .92; u.pitch = 1.12; u.volume = voiceVolume();
  // The music dips while he talks, so the words stand out (in the car the voice can come through quieter).
  u.onstart = () => duck(true); u.onend = u.onerror = () => duck(false);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
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
  state({ phase, step, mode, prompt, nudge, lookUp, look, locked, kind, touchPick, canShoot }) {
    const d = hudEl.dataset;
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
function renderLessons() {
  const cur = nextSkill(P, PATH), sk = skillById(cur);
  const tile = l => {
    const i = PATH.indexOf(l), open = lessonOpen(i), lv = level(P, l.id);
    return `<button class="tile ${l.id === cur ? 'on' : ''} ${open ? '' : 'locked'} ${l.side === 'defense' ? 'def' : ''}" data-id="${l.id}" ${open ? '' : 'disabled'}>
      <span class="e">${open ? l.emoji : '🔒'}</span><span class="k">${l.kid}</span><span class="st">${'★'.repeat(lv)}<i>${'★'.repeat(lv ? 3 - lv : 0)}</i></span></button>`;
  };
  $('#lessons').innerHTML = CHAPTERS.map((name, ch) => `<div class="chap"><div class="cn"><b>${ch + 1}</b>${name}</div><div class="row">${PATH.filter(l => l.ch === ch).map(tile).join('')}</div></div>`).join('');
  $('#lessonBtn .le').textContent = sk.emoji; $('#lessonBtn b').textContent = sk.kid;
  document.querySelectorAll('#lessons .tile').forEach(c => c.onclick = () => { P.pick = c.dataset.id; save(P); renderLessons(); $('#lessonSheet').classList.add('hidden'); });
}
$('#lessonBtn').onclick = () => $('#lessonSheet').classList.remove('hidden');
// Sticker album: a sticker per lesson, ringed by the level reached (bronze, silver, gold), with how many he has.
// Lessons not played yet show a grey sticker, so he can see what is still to come.
function renderAlbum() {
  const count = id => P.stickers.filter(s => s.skill === id).length, cups = P.stickers.filter(s => s.emoji === '🏆').length;
  const cell = l => { const lv = level(P, l.id), n = count(l.id);
    return `<div class="st ${lv ? 'l' + lv : 'none'}"><div class="f">${l.emoji}</div><span>${lv ? '★'.repeat(lv) : '–'}${n ? ' ×' + n : ''}</span></div>`; };
  $('#album').innerHTML = CHAPTERS.map((name, ch) => `<div class="chap"><div class="cn"><b>${ch + 1}</b>${name}</div><div class="row">${PATH.filter(l => l.ch === ch).map(cell).join('')}</div></div>`).join('')
    + `<div class="trophies">🏆 × ${cups} match${cups === 1 ? '' : 'es'} won</div>`;
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
function card({ emoji, title, sub, button, alt }) {
  $('#card .emoji').textContent = emoji; $('#card h2').textContent = title; $('#card p').textContent = sub || '';
  const main = $('#cardMain'), other = $('#cardAlt');
  main.textContent = button; other.textContent = alt || ''; other.classList.toggle('hidden', !alt);
  $('#card').classList.remove('hidden');
  say(title);
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

// ---------- session ----------
const fresh = (n, ids) => Array.from({ length: n }, () => generate(ids[Math.floor(Math.random() * ids.length)], Math.floor(Math.random() * 1e9))).filter(Boolean);
let running = false;
async function runSession() {
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
    : sk.id === 'peek-and-turn' ? `You are ${hero}. A friend passes to you. Drag to peek behind you, then pick which way to turn.`
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
  const firstTry = results.filter(Boolean).length, st = finishSession(P, skillId, firstTry, rounds.length); P.pick = null; save(P);
  world.setEnv('crowd'); game.skills = skills(P, PATH);
  await card(st.unlocked ? { emoji: '🔓', title: 'New in matches!', sub: `${UNLOCKS[skillId]}. First to 2 goals wins.`, button: 'Kick off' }
    : !st.passedNow && level(P, skillId) === 0 ? { emoji: '🏟️', title: 'Mini match!', sub: `Get ${Math.ceil(rounds.length * 2 / 3)} right next time to unlock this in matches. First to 2 goals wins.`, button: 'Kick off' }
    : { emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: 'Kick off' });
  const score = await game.match([skillId, ...reviews], fresh(6, [skillId, ...reviews]));
  const won = score.us > score.them;
  P.stickers.push({ emoji: won ? '🏆' : sk.emoji, skill: skillId, at: Date.now() }); save(P);
  showSticker(won ? '🏆' : sk.emoji, won);
  $('#results h2').textContent = won ? 'You won!' : 'Great try!';
  // One circle per round, like the dots during the lesson: gold = right on the first try.
  $('#results .roundsrow').innerHTML = results.map(ok => `<span class="${ok ? 'star' : 'done'}"></span>`).join('');
  $('#results .roundsnote').textContent = `${firstTry} of ${rounds.length} right on the first try`;
  // Level news, then a backyard game for the grown-up.
  $('#results .levelup').textContent = st.unlocked ? `🔓 Unlocked: ${UNLOCKS[skillId]}` : st.leveledUp ? `${'⭐'.repeat(st.level)} Level ${st.level}!` : !level(P, skillId) ? `Get ${Math.ceil(rounds.length * 2 / 3)} right to unlock the next lesson` : '';
  $('#results .outside').innerHTML = sk.outside ? `<b>Try it outside:</b> ${sk.outside}` : '';
  const i = PATH.findIndex(s => s.id === skillId), nextSk = PATH[i + 1];
  $('#nextLessonBtn').classList.toggle('hidden', !nextSk || !lessonOpen(i + 1)); // the next lesson opens once this one is passed
  $('#nextLessonBtn').onclick = () => { P.pick = nextSk.id; save(P); runSession(); };
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  say(won ? 'You won! You got a new sticker!' : 'Great try! You got a new sticker!');
  $('#againBtn').onclick = () => { P.pick = skillId; runSession(); };
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#playBtn').onclick = () => { unlockAudio(); runSession(); };
// Free play: a match to 3 goals mixing every lesson he has played (attack and defense), with big pushes allowed.
async function runFreePlay() {
  if (running) return; running = true; unlockAudio();
  // Free play: every situation from the lessons he has passed, with everything those lessons unlock.
  const has = skills(P, PATH), ids = has.size ? [...has] : ['look-up']; game.skills = has;
  const us = teamById(P.us), them = teamById(P.them);
  game.setTeams(us, them); world.setEnv('crowd'); show(null); hud.dots([], 0);
  await card({ emoji: '⚽', title: 'Free play!', sub: `First to 3 goals. ${us.name} vs ${them.name}`, button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), 3, 'free'), won = score.us > score.them;
  if (won) { P.stickers.push({ emoji: '🏆', skill: 'free', at: Date.now() }); save(P); }
  if (won) showSticker('🏆', true); else { $('#results .sticker').classList.add('hidden'); $('#results .emoji').classList.remove('hidden'); $('#results .emoji').textContent = '⚽'; }
  $('#results h2').textContent = won ? 'You won the match!' : 'Good game!';
  $('#results .roundsrow').innerHTML = ''; $('#results .roundsnote').textContent = ''; $('#results .levelup').textContent = ''; $('#results .outside').textContent = ''; $('#nextLessonBtn').classList.add('hidden'); $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  say(won ? 'You won the match!' : 'Good game!');
  $('#againBtn').onclick = runFreePlay;
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#freeBtn').onclick = runFreePlay;
$('#shootBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.shoot(); });
$('#stealBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.stealTap(); });
document.querySelectorAll('.turnBtn').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.turnTap(b.dataset.side); }));
$('#touchSmall').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.touch('small'); });
$('#touchBig').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.touch('big'); });
$('#resultsHome').onclick = () => show('#home');
$('#homeBtn').onclick = () => location.reload();
$('#skipBtn').onclick = () => game.skipDemo();
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
  $('#skillSel').innerHTML = `<option value="">Automatic (${skillById(nextSkill({ ...P, settings: { ...P.settings, skill: null } }, PATH)).kid})</option>` +
    PATH.map(s => `<option value="${s.id}" ${s.ready ? '' : 'disabled'} ${P.settings.skill === s.id ? 'selected' : ''}>${s.emoji} ${s.kid}${s.ready ? '' : ' (coming soon)'}</option>`).join('');
  $('#roundsSel').value = String(P.settings.rounds); $('#artSel').value = P.settings.art || 'lowpoly';
  if ('speechSynthesis' in window) pickVoice();
  $('#voiceSel').innerHTML = voices.length ? voices.map(v => `<option ${v === voice ? 'selected' : ''}>${v.name}</option>`).join('') : '<option>Default</option>';
  $('#voiceChk').checked = P.settings.voice; $('#recordedChk').checked = P.settings.recorded !== false; $('#soundChk').checked = P.settings.sound !== false; $('#musicChk').checked = P.settings.music !== false;
  $('#progressList').innerHTML = PATH.map(s => {
    const st = P.skills[s.id];
    return `<div><span>${s.emoji} ${s.adult}</span><span>${!s.ready ? 'not built yet' : !st ? 'not started' : `Level ${level(P, s.id)} · ${st.days || 1} day${(st.days || 1) > 1 ? 's' : ''} · ${st.firstTry}/${st.rounds} first try`}</span></div>`;
  }).join('') + `<div><span>Sessions played</span><span>${P.sessions}</span></div>`;
  show('#menu');
}
$('#menuClose').onclick = () => {
  P.settings.skill = $('#skillSel').value || null; P.settings.rounds = +$('#roundsSel').value; P.settings.voice = $('#voiceChk').checked; P.settings.recorded = $('#recordedChk').checked; P.settings.voiceName = $('#voiceSel').value; if ('speechSynthesis' in window) pickVoice(); P.settings.sound = $('#soundChk').checked; P.settings.music = $('#musicChk').checked; applySound();
  const art = $('#artSel').value; if (art !== (P.settings.art || 'lowpoly')) { P.settings.art = art; save(P); location.reload(); return; }
  save(P); show('#home');
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
  try { game.tick(dt, time); world.render(game.sim, game.cam, game.ui, time); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);
window.__game = game; // for debugging in the console
try { sessionStorage.removeItem('healed'); } catch { /* storage blocked */ } // booted fine (see index.html)
