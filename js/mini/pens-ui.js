// Penalties on the page (v87): a mini game (mini/chooser.js). This puts their keeper's body in our goal (the 5v5 goal at
// every size: ui/goalie.js sizeGoal), puts the game on the stage (ui/goalie.js onStage: main.js draws it, the pause
// holds it, a tap on the field goes to it), draws the keeper's eyes over the picture and a ball in the 3D goal on the
// target he picked, and runs it with two lives (mini/run.js).
import * as THREE from 'three';
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
// The keeper's eyes over his head, looking to the side he will go (the same bubble as the keeper game's shooter).
const eyes = $('#kEyes');
// (v88) The target he picked: a copy of the game's ball in the goal, in that target's ring, drawn in the 3D scene, so
// he covers it as he runs up in front of it (it used to be a ball drawn over the picture, floating over his head as he
// ran past). It pops in at each new pick and turns slowly.
let mark = null, markPick = null, markT0 = 0;
const backOut = u => 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2;
function makeMark() {
  const src = world.ball, m = src.material.clone(); m.onBeforeCompile = src.material.onBeforeCompile; m.emissive?.set(0x333333); // (its panels, as the real ball's; a little brighter: it stands in the goal's shade)
  const b = new THREE.Mesh(src.geometry, m); b.visible = false; world.scene.add(b); return b;
}
function showMark(a, pick) {
  if (!mark && a && world.ball?.material) mark = makeMark();
  if (!mark) return;
  mark.visible = !!a; if (!a) { markPick = null; return; }
  if (pick !== markPick) { markPick = pick; markT0 = performance.now(); }
  const u = Math.min(1, (performance.now() - markT0) / 280);
  mark.position.set(a.x + .2, a.y, a.z); mark.scale.setScalar(1.75 * backOut(u)); mark.rotation.z += .02; // (1.75: it fills the ring's hole; .2 m in front of the ring, toward him)
}
let handTap = 0, handOn = false;
pens.onFrame = g => {
  const t = g.ui.tell, q = t && world.project(t.x, t.y, t.z);
  eyes.classList.toggle('show', !!q);
  if (q) { // (v88: on the crossbar over his head, css .onbar: the mini bar is at the top left; kept on the screen at the very top)
    const k = t.big ? 1.12 : 1, y = Math.max(q[1], 4 + 46 * k);
    eyes.classList.remove('side');
    eyes.style.transform = `translate(${Math.round(q[0])}px,${Math.round(y)}px) translate(-50%,-100%) scale(${k})`;
    eyes.style.opacity = t.alpha; eyes.style.setProperty('--dx', t.dx); eyes.style.setProperty('--dy', t.dy);
  }
  showMark(g.ui.pick && g.phase === 'aim' && g.ui.aims[TARGETS.indexOf(g.ui.pick)], g.ui.pick);
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
    dress(us, them); sizeGoal(true, false); onStage(pens); eyes.classList.add('onbar');
    const run = startRun('pens'), next = i => { if (run.over) return null; const k = penKick(run.level, r, i, sides); sides.push(k.side); return k; };
    const k0 = next(0); pens.on = true; pens.setup(); show(null);
    if (first) await card({ emoji: '⚽', title: PEN_SAID.intro, sub: 'He steps one way. Shoot the other way!', button: 'Play' });
    await pens.endless(i => (i ? next(i) : k0), { first, onKick: x => runStep(run, x.res === 'goal', { level: x.kick.level, side: x.kick.side, fake: x.kick.fake, tap: x.tap, sec: x.sec, res: x.res, why: x.why }) });
    end();
    endRun(run, { again: runPenalties });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() { pens.on = false; hud.hand(null); eyes.classList.remove('show', 'onbar'); showMark(null); onStage(null); undress(); sizeGoal(false); game.home(); }
