// Boot: screens (team picker, cards, results, grown-ups menu), HUD wiring, input, and the session flow.
import { World } from './world.js';
import { Game } from './game.js';
import { TEAMS, teamById, displayName } from './teams.js';
import { PATH, skillById, pickRounds } from './skills.js';
import { generateLookUp } from './generate.js';
import { shuffle } from './geom.js';
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
const tunnel = $('#tunnel');
const hud = {
  state({ phase, step, mode, prompt, nudge, lookUp, look, locked }) {
    const d = hudEl.dataset;
    if (d.phase !== phase) d.phase = phase;
    if (d.step !== (step || 'none')) d.step = step || 'none';
    if (d.mode !== mode) d.mode = mode;
    hudEl.classList.toggle('up', lookUp);
    const pr = $('#prompt'); if (pr.textContent !== prompt) pr.textContent = prompt;
    $('#lookBtn').classList.toggle('nudge', nudge === 'look');
    $('#passBtn').classList.toggle('locked', !!locked); $('#dribBtn').classList.toggle('locked', !!locked);
    $('#passBtn').classList.toggle('active', step === 'pass'); $('#dribBtn').classList.toggle('active', step === 'dribble');
    const lb = $('#lookBtn'); lb.classList.toggle('on', lookUp);
    const label = lookUp ? 'HEAD DOWN' : 'LOOK UP'; if (lb.lastChild.textContent !== label) { lb.firstChild.textContent = lookUp ? '⚽' : '👀'; lb.lastChild.textContent = label; }
    // Head down = tunnel vision: blurry, darker edges. Clears as he looks up.
    const playerView = (mode === 'lesson' || mode === 'match' || mode === 'demo') && (phase === 'pre' || phase === 'decide') && step !== 'dribble';
    tunnel.style.opacity = playerView ? ((1 - look) * .95).toFixed(3) : '0';
  },
  toast(text, warn) { flash($('#toast'), warn ? 'warn' : '', text, 1600); },
  banner(text, kind) { const b = $('#banner'); b.firstChild.textContent = text; b.className = kind; void b.offsetWidth; b.classList.add('show'); clearTimeout(timers.banner); timers.banner = setTimeout(() => b.classList.remove('show'), 1500); },
  caption(text) { const c = $('#caption'); c.textContent = text; c.classList.toggle('show', !!text); hudEl.classList.toggle('captioning', !!text); },
  dots(results, n) {
    $('#dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < results.length ? (results[i] ? 'star' : 'done') : i === results.length ? 'now' : ''}"></span>`).join('');
  },
  score(s, us, them) {
    const el = $('#score'); el.classList.remove('hidden');
    el.innerHTML = `<span>${us.short}</span><b>${s.us} – ${s.them}</b><span>${them.short}</span>`;
  },
};

const game = new Game({ world, hud, say });

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
const neighbor = (id, dir, skip) => { let i = TEAMS.findIndex(t => t.id === id); do { i = (i + dir + TEAMS.length) % TEAMS.length; } while (TEAMS[i].id === skip); return TEAMS[i]; };
function renderPickers(flip) {
  for (const side of ['us', 'them']) {
    const el = $(`.team[data-side=${side}]`), t = teamById(P[side]), other = side === 'us' ? P.them : P.us;
    const prev = neighbor(t.id, -1, other), next = neighbor(t.id, 1, other);
    drawShirt(el.querySelector('.main'), t.kit, t.players[0].num);
    drawShirt(el.querySelector('.side.l'), prev.kit, prev.players[0].num);
    drawShirt(el.querySelector('.side.r'), next.kit, next.players[0].num);
    el.style.setProperty('--team', t.kit.colors[0]);
    el.querySelector('.tname').textContent = t.name;
    el.querySelector('.roster').innerHTML = t.players.map(p => `<span>${displayName(p.name)}</span>`).join('');
    if (flip && flip.side === side) { const sh = el.querySelector('.shirts'); sh.classList.remove('flip-next', 'flip-prev'); void sh.offsetWidth; sh.classList.add(flip.dir > 0 ? 'flip-next' : 'flip-prev'); }
  }
  game.setTeams(teamById(P.us), teamById(P.them));
  $('#stickers').innerHTML = P.stickers.slice(-10).map(s => `<span>${s.emoji}</span>`).join('');
}
function cycle(side, dir) {
  P[side] = neighbor(P[side], dir, side === 'us' ? P.them : P.us).id; save(P); renderPickers({ side, dir });
}
document.querySelectorAll('.team').forEach(el => {
  const side = el.dataset.side;
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

// ---------- session ----------
let running = false;
async function runSession() {
  if (running) return; running = true;
  const skillId = nextSkill(P, PATH), sk = skillById(skillId), reviews = reviewsDue(P, PATH, skillId).slice(0, 2);
  const us = teamById(P.us), them = teamById(P.them), hero = displayName(us.players[0].name);
  game.setTeams(us, them);
  world.setEnv('crowd');
  show(null); $('#score').classList.add('hidden'); hud.dots([], 0);
  // The demo plays the first time a lesson is played; after that it's one tap away.
  const firstTime = !P.skills[skillId]?.sessions;
  const watch = await card({ emoji: sk.emoji, title: sk.kid, sub: firstTime ? `Watch ${hero} first` : `Want to watch ${hero} first?`,
    button: firstTime ? 'Watch' : 'Play', alt: firstTime ? 'Skip' : 'Watch' });
  if (firstTime ? watch === 'main' : watch === 'alt') await game.demo(skillId);
  await card({ emoji: '⭐', title: 'Your turn!', sub: `You are ${hero}. Tap 👀 to look up, then drag to look around.`, button: 'Play' });
  // First session: the hand-made scenarios. After that, about two thirds are freshly generated so no two sessions match.
  const n = P.settings.rounds, fresh = n => Array.from({ length: n }, () => generateLookUp(Math.floor(Math.random() * 1e9))).filter(Boolean);
  const gen = skillId === 'look-up' && !firstTime ? Math.round(n * 2 / 3) : 0;
  const rounds = shuffle([...pickRounds([skillId, ...reviews], n - gen), ...fresh(gen)]), results = [];
  let misses = 0;
  hud.dots(results, n);
  for (let i = 0; i < rounds.length; i++) {
    const r = await game.round(rounds[i], { hint: i < 2 || misses >= 2 });
    results.push(r.firstTry); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, n);
  }
  await card({ emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: 'Kick off' });
  const score = await game.match([skillId, ...reviews], skillId === 'look-up' ? fresh(6) : []);
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
$('#skipBtn').onclick = () => game.skipDemo();
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
$('#lookBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.toggleLook(); });
addEventListener('pointermove', e => game.lookMove(e.clientX));
addEventListener('pointerup', () => game.lookEnd());
addEventListener('pointercancel', () => game.lookEnd());
$('#passBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.pass(); });
$('#dribBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.dribble(); });
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
