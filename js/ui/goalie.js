// The keeper game on the page (v67): the glove button on the home screen starts a round (game/goalie.js) in the stadium;
// this puts his keeper's body and the 5v5 goal in the 3D world, draws the shooter's eyes and the glove he picked over the
// picture, takes his taps, and fills the results card. Open from the start, at every team size.
import { $ } from './dom.js';
import { P, save } from './store.js';
import { hud } from './hud.js';
import { say, unlockSpeech } from './speech.js';
import { world, game, canvas } from './stage.js';
import { show, card } from './screens.js';
import { fillResults } from './results.js';
import { renderPickers } from './home.js';
import { teamById, keeperKit } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { PITCH } from '../geom.js';
import { Goalie } from '../game/goalie.js';
import { roundPlan, SHOTS, STICKER_AT, GOAL, SAID } from '../saves.js';
import { keeperDone } from '../progress.js';
import { toMatch, toCup, toLessons, ASK } from '../flows.js';
import { sfx } from '../sound.js';

export const goalie = new Goalie({ world, hud, say, sfx });
// Said the first time, on the card that opens it; and the headline on the results card, by how many he saved.
const INTRO = SAID.intro, HEADLINE = SAID;

// ---------- his body and his goal ----------
// He plays as his team's keeper (the fifth player, in a keeper's colours that are neither team's, with gloves).
let rig = null, rigKey = '';
function dress(us, them) {
  const p = us.players.find(q => q.gk) || us.players[0], kit = keeperKit(us, them), key = JSON.stringify([p, kit]);
  if (key !== rigKey) { rig = makeRig({ ...p, gk: true }, kit, true); rig.userData.gk = true; rigKey = key; }
  world.scene.add(rig); world.rigs.set('hero', rig);
}
function undress() { if (rig) world.scene.remove(rig); world.resetRigs(); }
// The 5v5 goal at every size: at 3v3 and 4v4 our goal is 4 m wide and 1.6 m high, so for the keeper game its bars move
// out and up and its nets stretch to 5 m by 1.8 m (world.js built them once, from the size the page loaded with), and it
// is put back after. The net behind him is fainter, so the picture through it stays clear.
let sized = false;
function sizeGoal(on) {
  if (sized === on) return; sized = on;
  const CY = PITCH.W / 2, half = (PITCH.gy1 - PITCH.gy0) / 2, dy = GOAL.half - half, dz = GOAL.gh - PITCH.gh, sg = on ? 1 : -1;
  const net = world.nets?.find(n => n.x === 0);
  if (net) { net.mesh.material.opacity = on ? .45 : 1; net.sides.material.opacity = on ? .45 : 1; }
  for (const g of world.aimPool || []) g.children[0].material.opacity = on ? .18 : .5; // (the targets' dark discs: fainter, so his body shows through the middle ones)
  if (!dy && !dz) return;
  for (const o of world.bars || []) {
    const pos = o.geometry.attributes.position, a = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      if (x > .3 || x < -1.4 || Math.abs(y - CY) > half + (on ? 0 : dy) + .3) continue; // (our goal's bars only: not theirs, not the corner flags)
      a[i * 3 + 1] += sg * Math.sign(y - CY) * dy;
      if (z > (PITCH.gh + (on ? 0 : dz)) / 2) a[i * 3 + 2] += sg * dz;
    }
    pos.needsUpdate = true; o.geometry.computeBoundingSphere();
  }
  if (net) for (const m of [net.mesh, net.sides]) { m.scale.set(1, on ? GOAL.half / half : 1, on ? GOAL.gh / PITCH.gh : 1); m.position.z = (on ? GOAL.gh : PITCH.gh) / 2; }
}

// ---------- over the picture ----------
// The shooter's eyes over his head, looking where he will shoot (saves.js tellOf), and a glove on the target he picked.
const eyes = $('#kEyes'), glove = $('#kGlove'), badge = $('#kBadge');
let handTap = 0, handOn = false;
goalie.onFrame = g => {
  const t = g.ui.tell, q = t && world.project(t.x, t.y, t.z);
  eyes.classList.toggle('show', !!q);
  if (q) { eyes.style.transform = `translate(${Math.round(q[0])}px,${Math.round(q[1])}px) translate(-50%,-100%) scale(${t.big ? 1.25 : 1})`; eyes.style.opacity = t.alpha; eyes.style.setProperty('--dx', t.dx); eyes.style.setProperty('--dy', t.dy); }
  const a = g.ui.pick && g.phase === 'dive' && g.ui.aims[['TL', 'TM', 'TR', 'L', 'M', 'R'].indexOf(g.ui.pick)], p = a && world.project(a.x, a.y, a.z);
  glove.classList.toggle('show', !!p); if (p) glove.style.transform = `translate(${Math.round(p[0])}px,${Math.round(p[1])}px) translate(-50%,-50%)`;
  badge.classList.toggle('show', !!(g.on && g.match));
  const h = g.ui.hand, hp = h && world.project(h.x, h.y, h.z || 0);
  if (hp) { if (!handOn) handTap++; handOn = true; hud.hand([hp[0], hp[1] + 6], handTap); } else if (handOn) { handOn = false; hud.hand(null); }
};
// A touch on the field picks a spot or a target as the finger goes down (no dragging to look around in goal).
canvas.addEventListener('pointerdown', e => { if (!goalie.on || !e.isPrimary) return; const r = canvas.getBoundingClientRect(); goalie.tapAt(e.clientX - r.left, e.clientY - r.top); });

// ---------- a round ----------
let busy = false;
export async function runKeeper() {
  if (busy) return; busy = true; unlockSpeech();
  try {
    const us = teamById(P.us), them = teamById(P.them), first = !P.keeper?.plays, plan = roundPlan(Math.floor(Math.random() * 1e9));
    game.setTeams(us, them); game.mode = 'keeper'; world.setEnv('crowd');
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'keeper' });
    dress(us, them); sizeGoal(true);
    goalie.on = true; goalie.setup(plan[0]); show(null); hud.dots([], SHOTS);
    if (first) await card({ emoji: '🧤', title: INTRO, sub: 'Tap a gold spot to stand. Then tap where he shoots!', button: 'Play' });
    const res = await goalie.round(plan, { first }), saves = res.filter(r => r.res === 'save').length;
    const k = keeperDone(P, saves, { of: SHOTS, stickerAt: STICKER_AT }); save();
    end();
    const head = saves >= STICKER_AT ? HEADLINE.top : saves >= 4 ? HEADLINE.good : HEADLINE.try;
    fillResults({
      emoji: '🧤', sticker: k.sticker ? '🧤' : null, trophy: saves === SHOTS, title: saves >= STICKER_AT ? 'Super keeper!' : head,
      line: `🧤 ${saves} of ${SHOTS} saved`, rounds: res.map(r => r.res === 'save'), note: k.best ? `⭐ New best: ${saves}!` : `Best: ${P.keeper.best} of ${SHOTS}`,
      news: saves < STICKER_AT ? `Save ${STICKER_AT} for a sticker!` : '',
      lesson: toLessons(), match: toMatch(), cup: toCup(), again: { text: '🧤 Again', go: runKeeper }, paper: saves >= STICKER_AT ? 70 : 0,
    });
    show('#results'); renderPickers();
    say(head)?.then(() => setTimeout(() => { if (!$('#results').classList.contains('hidden')) say(ASK); }, 300));
  } catch (e) { console.error(e); end(); show('#home'); } finally { busy = false; }
}
// Back to the game's own world: his outfield body, the goal as it was, the home scene.
function end() { goalie.on = false; hud.hand(null); for (const el of [eyes, glove, badge]) el.classList.remove('show'); undress(); sizeGoal(false); game.home(); }
export const keeperOn = () => goalie.on;

// ---------- in a match (v67) ----------
// With "Play the keeper" on (the grown-ups' menu; 5v5 only, where there is a keeper), some of their shots are his:
// game/handover.js decides which and hands the moment here. The first few times he is told he is the keeper; a glove
// badge stays up while he is.
const YOURE = SAID.youre, TOLD = 3;
game.keeperPlay = () => P.settings.keeperPlay || 'off';
game.keeperMoment = (spec, shooter) => {
  const k = P.keeper ||= { best: 0, plays: 0, last: 0, day: -1, stickers: 0 };
  k.turns = (k.turns || 0) + 1; save();
  if (k.turns <= TOLD) { hud.caption('🧤 ' + YOURE); say(YOURE); setTimeout(() => { if (hud.busy?.()) hud.caption(''); }, 1800); }
  return goalie.inMatch(game, spec, shooter);
};
$('#keeperBtn').onclick = () => runKeeper();
window.__keeper = goalie; // (for debugging in the console, as window.__game)
