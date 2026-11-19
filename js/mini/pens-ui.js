// Penalties on the page (v87): a mini game (mini/chooser.js). This puts their keeper's body in our goal (the 5v5 goal at
// every size: ui/goalie.js sizeGoal), puts the game on the stage (ui/goalie.js onStage: main.js draws it, the pause
// holds it, a tap on the field goes to it), draws the keeper's eyes and the ball on the target he picked over the
// picture, and runs it with two lives (mini/run.js).
import { $ } from '../ui/dom.js';
import { P } from '../ui/store.js';
import { hud } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById, keeperKit } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { stream } from '../shot.js';
import { sfx } from '../sound.js';
import { sizeGoal, onStage } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { Penalty } from './penalty.js';
import { penKick, TARGETS, PEN_SAID } from './pens.js';
import { startRun, runStep, endRun, runOff } from './run.js';

export const pens = new Penalty({ world, hud, say, sfx });

// ---------- their keeper's body ----------
let rig = null, rigKey = '', hidden = null;
function dress(us, them) {
  const p = them.players.find(q => q.gk) || them.players[4] || them.players[0], kit = keeperKit(them, us), key = JSON.stringify([p, kit]);
  if (key !== rigKey) { rig = makeRig({ ...p, gk: true }, kit, false); rig.userData.gk = true; rigKey = key; }
  hidden = world.rigs.get('k2'); if (hidden && hidden !== rig) hidden.visible = false; // (5v5: their own keeper's body stands aside)
  world.scene.add(rig); world.rigs.set('k2', rig);
}
function undress() { if (rig) world.scene.remove(rig); world.resetRigs(); hidden = null; }

// ---------- over the picture ----------
// The keeper's eyes over his head, looking to the side he will go (the same bubble as the keeper game's shooter), and a
// ball on the target he picked.
const eyes = $('#kEyes'), mark = document.createElement('div');
mark.id = 'pMark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '⚽'; ($('#kGlove')?.parentNode || document.body).appendChild(mark);
const TOP_BAR = 52;
let handTap = 0, handOn = false;
pens.onFrame = g => {
  const t = g.ui.tell, q = t && world.project(t.x, t.y, t.z);
  eyes.classList.toggle('show', !!q);
  if (q) {
    const k = t.big ? 1.25 : 1, side = q[1] - 62 * k < TOP_BAR;
    eyes.classList.toggle('side', side);
    eyes.style.transform = side ? `translate(${Math.round(q[0] + 14)}px,${Math.round(Math.max(q[1] + 8, TOP_BAR + 30 * k))}px) translate(0,-50%) scale(${k})` : `translate(${Math.round(q[0])}px,${Math.round(q[1])}px) translate(-50%,-100%) scale(${k})`;
    eyes.style.opacity = t.alpha; eyes.style.setProperty('--dx', t.dx); eyes.style.setProperty('--dy', t.dy);
  }
  const a = g.ui.pick && g.phase === 'aim' && g.ui.aims[TARGETS.indexOf(g.ui.pick)], p = a && world.project(a.x, a.y, a.z);
  mark.classList.toggle('show', !!p); if (p) mark.style.transform = `translate(${Math.round(p[0])}px,${Math.round(p[1])}px) translate(-50%,-50%)`;
  const h = g.ui.hand, hp = h && world.project(h.x, h.y, h.z || 0);
  if (hp) { if (!handOn) handTap++; handOn = true; hud.hand([hp[0], hp[1] + 6], handTap); } else if (handOn) { handOn = false; hud.hand(null); }
};

// ---------- a run ----------
let busy = false;
export async function runPenalties() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper();
  try {
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.pens?.plays, r = stream(Math.random()), sides = [];
    game.setTeams(us, them); game.mode = 'pens'; world.setEnv('crowd');
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'pens' }); hud.dots([], 0);
    dress(us, them); sizeGoal(true, false); onStage(pens);
    const run = startRun('pens'), next = i => { if (run.over) return null; const k = penKick(run.level, r, i, sides); sides.push(k.side); return k; };
    const k0 = next(0); pens.on = true; pens.setup(); show(null);
    if (first) await card({ emoji: '⚽', title: PEN_SAID.intro, sub: 'Watch the keeper. Then tap where to shoot!', button: 'Play' });
    await pens.endless(i => (i ? next(i) : k0), { first, onKick: x => runStep(run, x.res === 'goal', { level: x.kick.level, side: x.kick.side, fake: x.kick.fake, tap: x.tap, sec: x.sec, res: x.res, why: x.why }) });
    end();
    endRun(run, { again: runPenalties });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() { pens.on = false; hud.hand(null); eyes.classList.remove('show'); mark.classList.remove('show'); onStage(null); undress(); sizeGoal(false); game.home(); }
