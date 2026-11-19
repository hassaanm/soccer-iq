// The home screen: the two team pickers, the lesson sheet and the sticker album.
import { $, $$, wireSheet, replay } from './dom.js';
import { P, save } from './store.js';
import { game } from './stage.js';
import { drawShirt } from './shirt.js';
import { TEAMS, teamById, displayName } from '../teams.js';
import { PATH, CHAPTERS, skillById } from '../skills.js';
import { CUPS } from '../cups.js';
import { nextSkill, level, isOpen, graduated, playOpen, matchOpen } from '../progress.js';
import { SIZES, TEAM, setSize, sizeOf } from '../geom.js';
import { lessonPic } from './pics.js';

// ---------- team size ----------
// The chip under VS shows how many play on each side as a picture: a little pitch with a dot per player in each team's
// colour, in the shape coaches teach (3: a triangle, 4: a diamond), and "3 v 3" under it. A tap opens the same pictures,
// big, one per size; a tap on one picks it, and it is kept. It applies from the next lesson, training, match or cup.
export const SIZE_IDS = Object.keys(SIZES).filter(k => SIZES[k].offer);
const SHAPE = { 3: [[17, 30], [35, 15], [35, 45]], 4: [[10, 30], [24, 13], [24, 47], [38, 30]] }; // our half (x 0-50), attacking right
const ink = c => (/^#f[0-9a-f]f[0-9a-f]f/i.test(c) ? '#24193a' : '#fff'); // a white kit gets a dark rim
// A keeper (5v5): in his goal, marked by the same glove as the "5 v 5" label (v64 round 2: the owner liked that one) on a
// dark disc ringed in the keepers' lime (round 3: the green glove stands out on it, about 6 : 1), big enough to read on the
// small chip too. (Round 2 compared the glove alone, the glove on a lime disc and a drawn glove: report.)
// (Round 4) On the small chip the keeper's disc is as big as the picture allows (bigger than the outfield dots), so the
// glove reads at phone size; the outfield dots there are smaller. The front dots stay clear of each other and of the
// centre circle.
const KEEP = { card: { kx: 8.5, kr: 7.8, font: 12, dot: 4.8, x0: 23.5, k: .52, ring: 5.5 }, chip: { kx: 11, kr: 10.5, font: 17, dot: 4.2, x0: 27.6, k: .44, ring: 5 } }; // (ring: the centre circle with keepers)
const keeperPic = (x, s, K) => `<rect x="${x - s * 2.5}" y="20" width="5" height="20" rx="1" fill="none" stroke="#fff" stroke-width="2"/>`
  + `<circle cx="${x + s * (K.kx - 3.5)}" cy="30" r="${K.kr}" fill="#24193a" stroke="#b6f22a" stroke-width="2.4"/><text x="${x + s * (K.kx - 3.5)}" y="${30 + K.font * .06}" font-size="${K.font}" text-anchor="middle" dominant-baseline="central">🧤</text>`;
const pitchPic = (id, where = 'card') => {
  const n = sizeOf(id).out, gk = sizeOf(id).keeper, K = KEEP[where], us = teamById(P.us).kit.colors[0], them = teamById(P.them).kit.colors[0], dot = (x, y, c) => `<circle cx="${x}" cy="${y}" r="${gk ? K.dot : 6.5}" fill="${c}" stroke="${ink(c)}" stroke-width="2"/>`;
  const shape = (SHAPE[n] || SHAPE[3]).map(([x, y]) => [gk ? K.x0 + (x - 10) * K.k : x, y]); // (with keepers: the diamond steps up in front of him, clear of him and of the centre circle)
  return `<svg viewBox="0 0 100 60" aria-hidden="true"><rect x="1.5" y="1.5" width="97" height="57" rx="7" fill="#3f9a4a" stroke="#fff" stroke-width="3"/><path d="M50 2v56" stroke="#fff" stroke-width="2.5"/><circle cx="50" cy="30" r="${gk ? K.ring : 9}" fill="none" stroke="#fff" stroke-width="2.5"/>`
    + (gk ? keeperPic(3.5, 1, K) + keeperPic(96.5, -1, K) : '') + shape.map(([x, y]) => dot(x, y, us) + dot(100 - x, y, them)).join('') + '</svg>';
};
const players = id => sizeOf(id).out + (sizeOf(id).keeper ? 1 : 0); // a side, the keeper too
const label = id => `<b>${players(id)} v ${players(id)}${sizeOf(id).keeper ? '<i class="glv">🧤</i>' : ''}</b>`; // (keepers: a glove, hanging off to the side: the words stay centred as on the others)
function renderSize() {
  $('#sizeBtn').innerHTML = pitchPic(TEAM.size, 'chip') + label(TEAM.size) + '<i class="caret" aria-hidden="true">▾</i>'; // (the caret: a tap opens the choices)
  $('#sizePop .choices').innerHTML = SIZE_IDS.map(id => `<button class="btn btn-glass choice ${id === TEAM.size ? 'on' : ''}" data-id="${id}" aria-label="${players(id)} players on each team${sizeOf(id).keeper ? ', with keepers' : ''}">${pitchPic(id)}${label(id)}</button>`).join('');
  for (const b of $$('#sizePop .choice')) b.onclick = () => { $('#sizePop').classList.add('hidden'); chooseSize(b.dataset.id); };
}
// Picks a size and keeps it. A size on another pitch reloads the page, so the 3D world is built for that pitch.
export function chooseSize(id) {
  if (!SIZES[id] || id === TEAM.size) return;
  const before = sizeOf().pitch; P.settings.size = id; save();
  if (JSON.stringify(SIZES[id].pitch) !== JSON.stringify(before)) { location.reload(); return; }
  setSize(id); game.home(); renderPickers();
}
$('#sizeBtn').onclick = () => { renderSize(); $('#sizePop').classList.remove('hidden'); };
$('#sizePop').onclick = e => { if (e.target === $('#sizePop')) $('#sizePop').classList.add('hidden'); };

// ---------- team pickers ----------
const otherSide = side => (side === 'us' ? P.them : P.us);
// Cycles through teams of the same kind (clubs or countries) as `id`, skipping the other side's team.
const neighbor = (id, dir, skip) => {
  const type = teamById(id).type, list = TEAMS.filter(t => t.type === type);
  let i = list.findIndex(t => t.id === id);
  do { i = (i + dir + list.length) % list.length; } while (list[i].id === skip && list.length > 1);
  return list[i];
};
// Redraws the home screen from the saved progress. `flip` = { side, dir } animates that side's shirts.
export function renderPickers(flip) {
  for (const side of ['us', 'them']) {
    const el = $(`.team[data-side=${side}]`), t = teamById(P[side]), other = otherSide(side);
    const prev = neighbor(t.id, -1, other), next = neighbor(t.id, 1, other);
    drawShirt(el.querySelector('.main'), t.kit, t.players[0].num);
    drawShirt(el.querySelector('.side.l'), prev.kit, prev.players[0].num);
    drawShirt(el.querySelector('.side.r'), next.kit, next.players[0].num);
    el.style.setProperty('--team', t.kit.colors[0]);
    el.querySelector('.tname').textContent = t.name;
    el.querySelectorAll('.kind button').forEach(b => b.classList.toggle('on', b.dataset.type === t.type));
    el.querySelector('.roster').innerHTML = t.players.slice(0, sizeOf().out + (sizeOf().keeper ? 1 : 0)).map(p => `<span${p.gk ? ' class="gk"' : ''}>${p.gk ? '🧤 ' : ''}${displayName(p.name)}</span>`).join(''); // (the keeper plays at 5v5)
    if (flip?.side === side) { const sh = el.querySelector('.shirts'); sh.classList.remove('flip-next', 'flip-prev'); replay(sh, flip.dir > 0 ? 'flip-next' : 'flip-prev'); }
  }
  game.setTeams(teamById(P.us), teamById(P.them));
  renderSize(); renderLessons();
}
const pickTeam = (side, id, dir) => { P[side] = id; save(); renderPickers({ side, dir }); };
const cycle = (side, dir) => pickTeam(side, neighbor(P[side], dir, otherSide(side)).id, dir);
for (const el of $$('.team')) {
  const side = el.dataset.side, sh = el.querySelector('.shirts');
  el.querySelectorAll('.kind button').forEach(b => b.onclick = () => {
    if (teamById(P[side]).type !== b.dataset.type) pickTeam(side, TEAMS.find(t => t.type === b.dataset.type && t.id !== otherSide(side)).id, 1);
  });
  for (const [sel, dir] of [['.prev', -1], ['.next', 1], ['.side.l', -1], ['.side.r', 1]]) el.querySelector(sel).onclick = () => cycle(side, dir);
  // A swipe across the shirts also turns the carousel.
  let sx = null;
  sh.addEventListener('pointerdown', e => { sx = e.clientX; });
  sh.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 30) cycle(side, e.clientX < sx ? 1 : -1); sx = null; });
}

// ---------- lesson sheet ----------
// A lesson unlocks after the one before it has been played once (or once it has been played itself).
export const lessonOpen = i => isOpen(P, PATH, i);
// Once every lesson is passed, PLAY is "Today's training" unless he picked a lesson (or a grown-up locked one).
export const trainingNext = () => graduated(P, PATH) && !(P.pick && skillById(P.pick)) && !(P.settings.skill && skillById(P.settings.skill)?.ready);
const chapters = cell => CHAPTERS.map((name, ch) => `<div class="chap"><div class="cn"><b>${ch + 1}</b>${name}</div><div class="row">${PATH.filter(l => l.ch === ch).map(cell).join('')}</div></div>`).join('');
// One row per chapter. Stars show the level reached (1–3); each level needs a good session on a new day.
// Picking a tile plays it next (once); otherwise PLAY uses the coach's pick.
function renderLessons() {
  const training = trainingNext(), cur = training ? null : nextSkill(P, PATH), sk = training ? { emoji: '💪', kid: "Today's training" } : skillById(cur);
  const tile = l => {
    const open = lessonOpen(PATH.indexOf(l)), lv = level(P, l.id);
    const fresh = open && !P.skills[l.id]?.sessions && P.fresh?.includes(l.id); // a lesson added since his last visit (see progress.js catchUp)
    return `<button class="tile ${l.id === cur ? 'on' : ''} ${open ? '' : 'locked'} ${l.side === 'defense' ? 'def' : ''} ${fresh ? 'new' : ''}" data-id="${l.id}" ${open ? '' : 'disabled'}>
      <span class="e">${open ? lessonPic(l.id, l.emoji) : '🔒'}</span><span class="k">${l.short || l.kid}</span><span class="st">${'★'.repeat(lv)}<i>${'★'.repeat(lv ? 3 - lv : 0)}</i></span></button>`;
  };
  const top = graduated(P, PATH) ? `<button class="tile train ${training ? 'on' : ''}" data-id=""><span class="e">💪</span><span class="k">Today's training</span><span class="st">a mix of what you need</span></button>` : '';
  $('#lessons').innerHTML = top + chapters(tile);
  $('#lessonBtn .le').innerHTML = lessonPic(cur, sk.emoji); $('#lessonBtn b').textContent = sk.kid;
  for (const c of $$('#lessons .tile')) c.onclick = () => { P.pick = c.dataset.id || null; save(); renderLessons(); $('#lessonSheet').classList.add('hidden'); };
  // Match is open once his first lesson is passed; the Cup for the day once he has done today's lesson or training
  // (v64). While the Cup is locked, PLAY glows a little (a tap on the Cup says how to open it).
  $('#freeBtn').classList.toggle('locked', !matchOpen(P)); $('#cupBtn').classList.toggle('locked', !playOpen(P));
  $('#playBtn').classList.toggle('hot', !playOpen(P) && matchOpen(P));
}
$('#lessonBtn').onclick = () => $('#lessonSheet').classList.remove('hidden');
wireSheet('#lessonSheet', '#sheetClose');

// ---------- sticker album ----------
// A sticker per lesson, ringed by the level reached (bronze, silver, gold), with how many he has.
// Lessons not played yet show a grey sticker, so he can see what is still to come.
function renderAlbum() {
  const count = id => P.stickers.filter(s => s.skill === id).length, wins = P.stickers.filter(s => s.emoji === '🏆').length;
  const sticker = (lv, emoji, name, under) => `<div class="st ${lv ? 'l' + lv : 'none'}"><div class="f">${emoji}</div><span class="nm">${name}</span><span class="lv">${under}</span></div>`;
  const lesson = l => { const lv = level(P, l.id), n = count(l.id); return sticker(lv, l.emoji, l.kid, `${lv ? '★'.repeat(lv) : ''}${n ? ' ×' + n : ''}`); };
  // (v67) The keeper game: its sticker (6 saves or more in a round), with how many he has and his best round.
  const keeper = () => { const k = P.keeper, n = count('keeper'); return sticker(n ? 3 : k?.plays ? 1 : 0, '🧤', 'Keeper', n ? `×${n}` : k?.plays ? `best ${k.best}` : ''); };
  const cup = c => { const n = (P.trophies || []).filter(t => t.cup === c.id).length; return sticker(n ? 3 : 0, c.emoji, c.name, n ? '🏆' + (n > 1 ? ' ×' + n : '') : ''); };
  $('#album').innerHTML = chapters(lesson)
    + `<div class="chap"><div class="cn"><b>🏆</b>Cups</div><div class="row cups">${CUPS.map(cup).join('')}</div></div>`
    + `<div class="chap"><div class="cn"><b>🧤</b>Keeper</div><div class="row cups">${keeper()}</div></div>`
    + (wins ? `<div class="trophies">⚽ ${wins} match${wins === 1 ? '' : 'es'} won</div>` : '');
}
$('#albumBtn').onclick = () => { renderAlbum(); $('#albumSheet').classList.remove('hidden'); };
wireSheet('#albumSheet', '#albumClose');

// ---------- how a match plays (v84) ----------
// Under the team-size chip: Slow (a tortoise: play stops at each choice) or Fast (a hare: real time, js/fast/).
// Kept in the settings (P.settings.mode); Match starts the one picked. Lessons, training, cups and the keeper game stay as they are.
const modeBtns = $$('#modePick button');
function renderMode() { const m = P.settings.mode === 'fast' ? 'fast' : 'slow'; for (const b of modeBtns) { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-pressed', b.dataset.mode === m); } }
for (const b of modeBtns) b.onclick = () => { P.settings.mode = b.dataset.mode; save(); renderMode(); };
renderMode();
