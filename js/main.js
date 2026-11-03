// Boot: screens (team picker, cards, results, grown-ups menu), HUD wiring, input, and the session flow.
import { World } from './world.js';
import { Game } from './game.js';
import { TEAMS, teamById, displayName } from './teams.js';
import { PATH, skillById, pickRounds } from './skills.js';
import { load, save, nextSkill, reviewsDue, finishSession, skillState, isMastered, defaultProgress } from './progress.js';

const $ = s => document.querySelector(s);
const P = load();
const canvas = $('#view');
let world;
try { world = new World(canvas); } catch (e) {
  document.body.innerHTML = '<p style="padding:24px;font:600 18px system-ui">This device can’t show 3D graphics (WebGL is off).</p>'; throw e;
}

// ---------- voice ----------
let voice = null;
const pickVoice = () => {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  voice = vs.find(v => /Samantha|Google US English|Karen|Daniel/.test(v.name)) || vs[0] || null;
};
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text) {
  if (!P.settings.voice || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, ''));
  if (voice) u.voice = voice; u.rate = .95; u.pitch = 1.1;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- HUD ----------
const hudEl = $('#hud');
const timers = {};
const flash = (el, cls, text, ms) => {
  el.textContent = text; el.className = cls; void el.offsetWidth; el.classList.add('show');
  clearTimeout(timers[el.id]); timers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
};
const hud = {
  state({ phase, step, mode, prompt, nudge, holding }) {
    const d = hudEl.dataset;
    if (d.phase !== phase) d.phase = phase;
    if (d.step !== (step || 'none')) d.step = step || 'none';
    if (d.mode !== mode) d.mode = mode;
    const pr = $('#prompt'); if (pr.textContent !== prompt) pr.textContent = prompt;
    for (const [id, k] of [['#lookBtn', 'look'], ['#passBtn', 'pass'], ['#dribBtn', 'dribble']]) $(id).classList.toggle('nudge', nudge === k);
    $('#lookBtn').classList.toggle('held', holding);
  },
  toast(text, warn) { flash($('#toast'), warn ? 'warn' : '', text, 1600); },
  banner(text, kind) {
    flash($('#banner'), kind, text, 1500);
    if (kind === 'goal') confetti();
  },
  caption(text) { const c = $('#caption'); c.textContent = text; c.classList.toggle('show', !!text); hudEl.classList.toggle('captioning', !!text); },
  dots(results, n) {
    $('#dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < results.length ? (results[i] ? 'star' : 'done') : i === results.length ? 'now' : ''}"></span>`).join('');
  },
  score(s, us, them) {
    const el = $('#score'); el.classList.remove('hidden');
    el.innerHTML = `<span>${us.short}</span><b>${s.us} – ${s.them}</b><span>${them.short}</span>`;
  },
};
function confetti() {
  const box = $('#confetti');
  for (let i = 0; i < 22; i++) {
    const e = document.createElement('i'); e.textContent = ['⭐', '🎉', '⚽', '✨'][i % 4];
    e.style.left = Math.random() * 100 + '%'; e.style.animationDelay = Math.random() * .3 + 's'; e.style.fontSize = 18 + Math.random() * 18 + 'px';
    box.appendChild(e); setTimeout(() => e.remove(), 1900);
  }
}

const game = new Game({ world, hud, say });

// ---------- screens ----------
const screens = ['#home', '#card', '#results', '#menu'];
const show = id => { for (const s of screens) $(s).classList.toggle('hidden', s !== id); hudEl.classList.toggle('hidden', id !== null); };

function drawShirt(cv, kit, num) {
  const g = cv.getContext('2d'), Wd = cv.width; g.clearRect(0, 0, Wd, Wd); g.save(); g.scale(Wd / 160, Wd / 160);
  const body = new Path2D('M50 22 L68 14 Q80 28 92 14 L110 22 L142 48 L122 70 L110 60 L110 146 L50 146 L50 60 L38 70 L18 48 Z');
  g.fillStyle = kit.colors[0]; g.fill(body);
  g.save(); g.clip(body);
  if (kit.pattern === 'stripes') { g.fillStyle = kit.colors[1]; for (let x = 44; x < 116; x += 24) g.fillRect(x, 0, 12, 160); }
  if (kit.pattern === 'band') { g.fillStyle = '#fff'; g.fillRect(66, 0, 28, 160); g.fillStyle = kit.colors[1]; g.fillRect(71, 0, 18, 160); }
  if (kit.pattern === 'sleeves') { g.fillStyle = kit.colors[1]; g.fill(new Path2D('M50 22 L18 48 L38 70 L50 60 Z')); g.fill(new Path2D('M110 22 L142 48 L122 70 L110 60 Z')); }
  g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(100, 0, 60, 160);
  g.restore();
  g.strokeStyle = kit.trim; g.lineWidth = 5; g.beginPath(); g.moveTo(68, 15); g.quadraticCurveTo(80, 30, 92, 15); g.stroke();
  g.fillStyle = kit.shorts; g.fillRect(52, 140, 56, 6);
  g.font = '900 46px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.35)';
  g.strokeText(num, 80, 92); g.fillStyle = kit.num; g.fillText(num, 80, 92);
  g.strokeStyle = 'rgba(40,20,10,.55)'; g.lineWidth = 3; g.stroke(body);
  g.restore();
}
function renderPickers() {
  for (const side of ['us', 'them']) {
    const el = $(`.picker[data-side=${side}]`), t = teamById(P[side]);
    drawShirt(el.querySelector('canvas'), t.kit, t.players[0].num);
    el.querySelector('.tname').textContent = t.name;
    el.querySelector('.stars').textContent = t.players.map(p => displayName(p.name)).join(' · ');
  }
  game.setTeams(teamById(P.us), teamById(P.them));
  const stickers = P.stickers.slice(-12);
  $('#stickers').innerHTML = stickers.length ? stickers.map(s => `<span title="${s.skill}">${s.emoji}</span>`).join('') : '';
}
function cycle(side, dir) {
  const other = side === 'us' ? P.them : P.us;
  let i = TEAMS.findIndex(t => t.id === P[side]);
  do { i = (i + dir + TEAMS.length) % TEAMS.length; } while (TEAMS[i].id === other);
  P[side] = TEAMS[i].id; save(P); renderPickers();
}
document.querySelectorAll('.picker').forEach(el => {
  el.querySelector('.prev').onclick = () => cycle(el.dataset.side, -1);
  el.querySelector('.next').onclick = () => cycle(el.dataset.side, 1);
});

function card({ emoji, title, sub, button }) {
  $('#card .emoji').textContent = emoji; $('#card h2').textContent = title; $('#card p').textContent = sub || ''; $('#card button').textContent = button;
  $('#card').classList.remove('hidden');
  say(title);
  return new Promise(res => { $('#card button').onclick = () => { $('#card').classList.add('hidden'); res(); }; });
}

// ---------- session ----------
let running = false;
async function runSession() {
  if (running) return; running = true;
  const skillId = nextSkill(P, PATH), sk = skillById(skillId), reviews = reviewsDue(P, PATH, skillId).slice(0, 2);
  const us = teamById(P.us), them = teamById(P.them), hero = displayName(us.players[0].name);
  game.setTeams(us, them);
  world.setEnv(['park', 'empty', 'crowd'][P.sessions % 3]);
  show(null); $('#score').classList.add('hidden'); hud.dots([], 0);
  await card({ emoji: sk.emoji, title: sk.kid, sub: `Watch ${hero} first`, button: '▶ Watch' });
  await game.demo(skillId);
  await card({ emoji: '⭐', title: 'Your turn!', sub: `You are ${hero}. Hold 👀 to look up.`, button: '▶ Play' });
  const n = P.settings.rounds, rounds = pickRounds([skillId, ...reviews], n), results = [];
  let misses = 0;
  hud.dots(results, n);
  for (let i = 0; i < rounds.length; i++) {
    const r = await game.round(rounds[i], { hint: i < 2 || misses >= 2 });
    results.push(r.firstTry); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, n);
  }
  await card({ emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: '▶ Kick off' });
  const score = await game.match([skillId, ...reviews]);
  const firstTry = results.filter(Boolean).length, won = score.us > score.them;
  finishSession(P, skillId, firstTry, rounds.length);
  P.stickers.push({ emoji: won ? '🏆' : sk.emoji, skill: skillId, at: Date.now() }); save(P);
  $('#results .emoji').textContent = won ? '🏆' : sk.emoji;
  $('#results h2').textContent = won ? 'You won!' : 'Great try!';
  $('#results .starsrow').textContent = '⭐'.repeat(firstTry) + '☆'.repeat(rounds.length - firstTry);
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short} · New sticker!`;
  say(won ? 'You won! You got a new sticker!' : 'Great try! You got a new sticker!');
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#playBtn').onclick = () => { unlockAudio(); runSession(); };
$('#againBtn').onclick = () => runSession();
$('#teamsBtn').onclick = () => show('#home');
$('#homeBtn').onclick = () => location.reload();
function unlockAudio() { if ('speechSynthesis' in window && P.settings.voice) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } }

// ---------- grown-ups menu (hold the gear) ----------
let gearTimer;
$('#gear').addEventListener('pointerdown', () => { $('#gear').classList.add('holding'); gearTimer = setTimeout(openMenu, 1200); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('#gear').addEventListener(ev, () => { $('#gear').classList.remove('holding'); clearTimeout(gearTimer); });
function openMenu() {
  $('#gear').classList.remove('holding');
  $('#skillSel').innerHTML = `<option value="">Automatic (${skillById(nextSkill({ ...P, settings: { ...P.settings, skill: null } }, PATH)).kid})</option>` +
    PATH.map(s => `<option value="${s.id}" ${s.ready ? '' : 'disabled'} ${P.settings.skill === s.id ? 'selected' : ''}>${s.emoji} ${s.kid}${s.ready ? '' : ' (coming soon)'}</option>`).join('');
  $('#roundsSel').value = String(P.settings.rounds);
  $('#voiceChk').checked = P.settings.voice;
  $('#progressList').innerHTML = PATH.map(s => {
    const st = P.skills[s.id];
    return `<div><span>${s.emoji} ${s.adult}</span><span>${!s.ready ? 'not built yet' : !st ? 'not started' : isMastered(P, s.id) ? 'mastered ✓' : `box ${st.box}/4 · ${st.firstTry}/${st.rounds} first try`}</span></div>`;
  }).join('') + `<div><span>Sessions played</span><span>${P.sessions}</span></div>`;
  show('#menu');
}
$('#menuClose').onclick = () => {
  P.settings.skill = $('#skillSel').value || null; P.settings.rounds = +$('#roundsSel').value; P.settings.voice = $('#voiceChk').checked;
  save(P); show('#home');
};
$('#resetBtn').onclick = () => {
  if (!confirm('Reset all progress and stickers?')) return;
  const fresh = defaultProgress(); fresh.us = P.us; fresh.them = P.them; Object.keys(P).forEach(k => delete P[k]); Object.assign(P, fresh); save(P); renderPickers(); openMenu();
};

// ---------- input ----------
canvas.addEventListener('pointerdown', e => {
  if (game.tap(e.clientX, e.clientY)) return;
  game.lookStart(e.clientX, canvas.clientWidth); e.preventDefault();
});
$('#lookBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.lookStart(e.clientX, canvas.clientWidth); });
addEventListener('pointermove', e => game.lookMove(e.clientX));
addEventListener('pointerup', () => game.lookEnd());
addEventListener('pointercancel', () => game.lookEnd());
$('#passBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.pass(); });
$('#dribBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.dribble(); });
$('#backBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.back(); });
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- loop ----------
renderPickers(); show('#home');
let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt;
  requestAnimationFrame(frame);
  try { game.tick(dt, time); world.render(game.sim, game.cam, game.ui, time); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);
window.__game = game; // for debugging in the console
