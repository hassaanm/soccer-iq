// The home screen: the two team pickers, the lesson sheet and the sticker album.
import { $, $$, wireSheet, replay } from './dom.js';
import { P, save } from './store.js';
import { game } from './stage.js';
import { drawShirt } from './shirt.js';
import { TEAMS, teamById, displayName } from '../teams.js';
import { PATH, CHAPTERS, skillById } from '../skills.js';
import { CUPS } from '../cups.js';
import { nextSkill, level, isOpen, graduated, playOpen } from '../progress.js';

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
    el.querySelector('.roster').innerHTML = t.players.map(p => `<span>${displayName(p.name)}</span>`).join('');
    if (flip?.side === side) { const sh = el.querySelector('.shirts'); sh.classList.remove('flip-next', 'flip-prev'); replay(sh, flip.dir > 0 ? 'flip-next' : 'flip-prev'); }
  }
  game.setTeams(teamById(P.us), teamById(P.them));
  renderLessons();
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
    return `<button class="tile ${l.id === cur ? 'on' : ''} ${open ? '' : 'locked'} ${l.side === 'defense' ? 'def' : ''}" data-id="${l.id}" ${open ? '' : 'disabled'}>
      <span class="e">${open ? l.emoji : '🔒'}</span><span class="k">${l.kid}</span><span class="st">${'★'.repeat(lv)}<i>${'★'.repeat(lv ? 3 - lv : 0)}</i></span></button>`;
  };
  const top = graduated(P, PATH) ? `<button class="tile train ${training ? 'on' : ''}" data-id=""><span class="e">💪</span><span class="k">Today's training</span><span class="st">a mix of what you need</span></button>` : '';
  $('#lessons').innerHTML = top + chapters(tile);
  $('#lessonBtn .le').textContent = sk.emoji; $('#lessonBtn b').textContent = sk.kid;
  for (const c of $$('#lessons .tile')) c.onclick = () => { P.pick = c.dataset.id || null; save(); renderLessons(); $('#lessonSheet').classList.add('hidden'); };
  // Match and Cup open for the day once he has done today's lesson or training.
  for (const b of ['#freeBtn', '#cupBtn']) $(b).classList.toggle('locked', !playOpen(P));
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
  const cup = c => { const n = (P.trophies || []).filter(t => t.cup === c.id).length; return sticker(n ? 3 : 0, c.emoji, c.name, n ? '🏆' + (n > 1 ? ' ×' + n : '') : ''); };
  $('#album').innerHTML = chapters(lesson)
    + `<div class="chap"><div class="cn"><b>🏆</b>Cups</div><div class="row cups">${CUPS.map(cup).join('')}</div></div>`
    + (wins ? `<div class="trophies">⚽ ${wins} match${wins === 1 ? '' : 'es'} won</div>` : '');
}
$('#albumBtn').onclick = () => { renderAlbum(); $('#albumSheet').classList.remove('hidden'); };
wireSheet('#albumSheet', '#albumClose');
