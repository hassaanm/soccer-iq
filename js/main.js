// Boot: screens (team picker, cards, results, grown-ups menu), HUD wiring, input, and the session flow.
import { World } from './world.js';
import { Game } from './game.js';
import { TEAMS, teamById, displayName } from './teams.js';
import { PATH, skillById, pickRounds } from './skills.js';
import { generate } from './generate.js';
import { VERSION } from './version.js';
import { sfx, unlock as unlockSound, setSoundOn } from './sound.js';
import { shuffle } from './geom.js';
import { load, save, nextSkill, reviewsDue, finishSession, skillState, isMastered, defaultProgress } from './progress.js';

const $ = s => document.querySelector(s);
const P = load();
const canvas = $('#view');
let world;
try { world = new World(canvas, { art: P.settings.art }); } catch (e) {
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
  banner(text, kind) {
    const el = $('#rate');
    el.querySelector('.title').textContent = text; el.querySelector('.title').className = 'title ' + kind;
    el.querySelector('.stars').innerHTML = ''; el.querySelector('.txt').textContent = ''; el.querySelector('.btns').classList.add('hidden');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(timers.rate); timers.rate = setTimeout(() => el.classList.remove('show'), 1700);
    sfx(kind === 'bad' ? 'aww' : text === 'GOAL!' ? 'goal' : 'yay');
  },
  rate(stars, text, watch) {
    const el = $('#rate'); clearTimeout(timers.rate);
    el.querySelector('.stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join('');
    el.querySelector('.txt').textContent = text; el.querySelector('.btns').classList.toggle('hidden', !watch);
    el.className = 's' + stars; el.classList.add('show');
    [...el.querySelectorAll('.stars span.on')].forEach((sp, i) => setTimeout(() => { sp.classList.add('pop'); sfx('star', i); }, 120 + i * 160));
    return new Promise(res => {
      const done = v => { el.classList.remove('show'); res(v); };
      if (!watch) return setTimeout(() => done('next'), stars === 3 ? 1500 : 1000);
      $('#rateWatch').onclick = () => done('watch'); $('#rateNext').onclick = () => done('next');
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
setSoundOn(P.settings.sound !== false);
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
// Lesson chips on the home screen: each unlocks after the one before it has been played once.
function renderLessons() {
  const cur = nextSkill(P, PATH);
  $('#lessons').innerHTML = PATH.map((sk, i) => {
    const st = P.skills[sk.id], open = i === 0 || (P.skills[PATH[i - 1].id]?.sessions || 0) > 0 || (st?.sessions || 0) > 0;
    return `<button class="chip ${sk.id === cur ? 'on' : ''} ${open ? '' : 'locked'}" data-id="${sk.id}" ${open ? '' : 'disabled'} title="${sk.kid}">
      <span>${open ? sk.emoji : '🔒'}</span>${st?.sessions ? `<i>${'★'.repeat(Math.min(3, st.box))}</i>` : ''}</button>`;
  }).join('');
  $('#lessonName').textContent = `${skillById(cur).emoji} ${skillById(cur).kid}` + (skillById(cur).side === 'defense' ? '  ·  defense' : '');
  document.querySelectorAll('#lessons .chip').forEach(c => c.onclick = () => { P.settings.skill = c.dataset.id; save(P); renderLessons(); });
}
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

// ---------- session ----------
const fresh = (n, ids) => Array.from({ length: n }, () => generate(ids[Math.floor(Math.random() * ids.length)], Math.floor(Math.random() * 1e9))).filter(Boolean);
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
  await card({ emoji: '⭐', title: 'Your turn!', sub: sk.side === 'defense' ? `You are ${hero}, defending. Tap 👀 to look up, then tap where to run.` : `You are ${hero}. Tap 👀 to look up, then drag to look around.`, button: 'Play' });
  // First session: the hand-made scenarios. After that, about two thirds are freshly generated so no two sessions match.
  // "Look up" starts with its hand-made rounds; everything else (and later sessions) is freshly generated.
  const n = P.settings.rounds, gen = skillId === 'look-up' && firstTime ? 0 : skillId === 'look-up' ? Math.round(n * 2 / 3) : n;
  const rounds = shuffle([...pickRounds([skillId, ...reviews], n - gen), ...fresh(gen, [skillId])]), results = [];
  let misses = 0;
  hud.dots(results, n);
  for (let i = 0; i < rounds.length; i++) {
    const r = await game.round(rounds[i], { hint: i < 2 || misses >= 2 });
    results.push(r.firstTry && r.stars === 3); misses = r.firstTry ? 0 : misses + 1; hud.dots(results, n);
  }
  await card({ emoji: '🏟️', title: 'Mini match!', sub: 'First to 2 goals wins', button: 'Kick off' });
  const score = await game.match([skillId, ...reviews], fresh(6, [skillId, ...reviews]));
  const firstTry = results.filter(Boolean).length, won = score.us > score.them;
  finishSession(P, skillId, firstTry, rounds.length);
  P.stickers.push({ emoji: won ? '🏆' : sk.emoji, skill: skillId, at: Date.now() }); save(P);
  $('#results .emoji').textContent = won ? '🏆' : sk.emoji;
  $('#results h2').textContent = won ? 'You won!' : 'Great try!';
  // One circle per round, like the dots during the lesson: gold = right on the first try.
  $('#results .roundsrow').innerHTML = results.map(ok => `<span class="${ok ? 'star' : 'done'}"></span>`).join('');
  $('#results .roundsnote').textContent = `${firstTry} of ${rounds.length} right on the first try`;
  const i = PATH.findIndex(s => s.id === skillId), nextSk = PATH[i + 1];
  $('#nextLessonBtn').classList.toggle('hidden', !nextSk);
  $('#nextLessonBtn').onclick = () => { P.settings.skill = nextSk.id; save(P); runSession(); };
  $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short} · New sticker!`;
  say(won ? 'You won! You got a new sticker!' : 'Great try! You got a new sticker!');
  $('#againBtn').onclick = () => runSession();
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#playBtn').onclick = () => { unlockAudio(); runSession(); };
// Free play: a match to 3 goals mixing every lesson he has played (attack and defense), with big pushes allowed.
async function runFreePlay() {
  if (running) return; running = true; unlockAudio();
  const learned = PATH.filter(s => P.skills[s.id]?.sessions).map(s => s.id), ids = learned.length ? learned : ['look-up'];
  const us = teamById(P.us), them = teamById(P.them);
  game.setTeams(us, them); world.setEnv('crowd'); show(null); hud.dots([], 0);
  await card({ emoji: '⚽', title: 'Free play!', sub: `First to 3 goals. ${us.name} vs ${them.name}`, button: 'Kick off' });
  const score = await game.match(ids, fresh(24, ids), 3, 'free'), won = score.us > score.them;
  if (won) { P.stickers.push({ emoji: '🏆', skill: 'free', at: Date.now() }); save(P); }
  $('#results .emoji').textContent = won ? '🏆' : '⚽'; $('#results h2').textContent = won ? 'You won the match!' : 'Good game!';
  $('#results .roundsrow').innerHTML = ''; $('#results .roundsnote').textContent = ''; $('#nextLessonBtn').classList.add('hidden'); $('#results p').textContent = `${us.short} ${score.us} – ${score.them} ${them.short}`;
  say(won ? 'You won the match!' : 'Good game!');
  $('#againBtn').onclick = runFreePlay;
  game.home(); show('#results'); renderPickers(); running = false;
}
$('#freeBtn').onclick = runFreePlay;
$('#shootBtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.shoot(); });
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
  $('#voiceChk').checked = P.settings.voice; $('#soundChk').checked = P.settings.sound !== false;
  $('#progressList').innerHTML = PATH.map(s => {
    const st = P.skills[s.id];
    return `<div><span>${s.emoji} ${s.adult}</span><span>${!s.ready ? 'not built yet' : !st ? 'not started' : isMastered(P, s.id) ? 'mastered ✓' : `box ${st.box}/4 · ${st.firstTry}/${st.rounds} first try`}</span></div>`;
  }).join('') + `<div><span>Sessions played</span><span>${P.sessions}</span></div>`;
  show('#menu');
}
$('#menuClose').onclick = () => {
  P.settings.skill = $('#skillSel').value || null; P.settings.rounds = +$('#roundsSel').value; P.settings.voice = $('#voiceChk').checked; P.settings.sound = $('#soundChk').checked; setSoundOn(P.settings.sound);
  const art = $('#artSel').value; if (art !== (P.settings.art || 'lowpoly')) { P.settings.art = art; save(P); location.reload(); return; }
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
$('#version').textContent = VERSION;
let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now; time += dt;
  requestAnimationFrame(frame);
  try { game.tick(dt, time); world.render(game.sim, game.cam, game.ui, time); } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);
window.__game = game; // for debugging in the console
