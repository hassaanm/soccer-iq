// Penalties on the page (v87; v93 a timing game): a mini game (mini/chooser.js). This puts their keeper's body in our
// goal (the 5v5 goal at every size: ui/goalie.js sizeGoal), puts the game on the stage (ui/goalie.js onStage: main.js
// draws it, the pause holds it, a tap on the field goes to it), draws his eyes over his head and a ball in the goal on
// the target he picked, both in the 3D scene, and runs it with two lives (mini/run.js).
// (v93) Nothing here writes to the page while a kick plays (the phone pays for every change to the page over the 3D
// picture): the marks are in the 3D scene, and the teaching hand is moved only when it moves.
import * as THREE from 'three';
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

// ---------- in the 3D picture ----------
// (v88) The target he picked: a copy of the game's ball in the goal, in that target's ring, so he covers it as he runs
// up in front of it. It pops in at each new pick and turns slowly.
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
// (v93) His eyes: a white bubble over his head with two eyes looking at the corner he picked (the tell the keeper
// reads), drawn on a small canvas once per direction and shown as a sprite that follows him in the scene.
let eyes = null, eyesKey = '', eyesT0 = 0;
const EW = 128, EH = 84;
function drawEyes(ctx, dx, dy) {
  ctx.clearRect(0, 0, EW, EH);
  const R = 28; ctx.lineWidth = 6; ctx.strokeStyle = '#24193a'; ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(4, 4, EW - 8, EH - 8, R); ctx.fill(); ctx.stroke();
  for (const cx of [EW / 2 - 22, EW / 2 + 22]) {
    ctx.beginPath(); ctx.ellipse(cx, EH / 2, 15, 21, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + dx * 7, EH / 2 + dy * 10, 8, 0, Math.PI * 2); ctx.fillStyle = '#24193a'; ctx.fill();
  }
}
function makeEyes() {
  const c = document.createElement('canvas'); c.width = EW; c.height = EH;
  if (!c.getContext('2d')?.roundRect) return null; // (an old browser: no eyes, the body still turns)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  s.renderOrder = 20; s.visible = false; s.userData.c = c; world.scene.add(s); return s;
}
function showEyes(t) {
  if (!t) { if (eyes) eyes.visible = false; eyesKey = ''; return; }
  if (!eyes) { try { eyes = makeEyes(); } catch { eyes = null; } if (!eyes) return; }
  const key = t.dx + ',' + t.dy;
  if (key !== eyesKey) { if (!eyesKey) eyesT0 = performance.now(); eyesKey = key; drawEyes(eyes.userData.c.getContext('2d'), t.dx, t.dy); eyes.material.map.needsUpdate = true; } // (drawn again only when he looks somewhere else)
  const k = .36 * backOut(Math.min(1, (performance.now() - eyesT0) / 240));
  eyes.visible = true; eyes.position.set(t.x, t.y - .5, 1.3); eyes.scale.set(k * EW / EH, k, 1);
}
let handTap = 0, handOn = false, handAt = '';
pens.onFrame = g => {
  showEyes(g.on ? g.ui.tell : null);
  showMark(g.ui.pick && g.phase === 'aim' && g.ui.aims[TARGETS.indexOf(g.ui.pick)], g.ui.pick);
  const h = g.ui.hand, hp = h && world.project(h.x, h.y, h.z || 0);
  if (hp) { if (!handOn) handTap++; handOn = true; const at = Math.round(hp[0]) + ',' + Math.round(hp[1]); if (at !== handAt) { handAt = at; hud.hand([hp[0], hp[1] + 6], handTap); } } // (the page only when it moves)
  else if (handOn) { handOn = false; handAt = ''; hud.hand(null); }
};

// ---------- a run ----------
let busy = false;
export async function runPenalties() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper();
  try {
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.pens?.plays, r = stream(Math.random());
    game.setTeams(us, them); game.mode = 'pens'; world.setEnv('crowd');
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'pens' }); hud.dots([], 0);
    dress(us, them); sizeGoal(true, false); onStage(pens);
    const run = startRun('pens'), next = i => (run.over ? null : penKick(run.level, r, i));
    const k0 = next(0); pens.on = true; pens.setup(); show(null);
    if (first) await card({ emoji: '⚽', title: PEN_SAID.intro, sub: 'Tap a corner when the ball flashes. Tap too soon and he sees where you look!', button: 'Play' });
    await pens.endless(i => (i ? next(i) : k0), { first, onKick: x => runStep(run, x.res === 'goal', { level: x.kick.level, tap: x.tap, when: x.when, shown: Math.round(x.shown * 100) / 100, dive: x.dive, read: x.read ? 1 : 0, fake: x.kick.fake, sec: x.sec, res: x.res, why: x.why }) });
    end();
    endRun(run, { again: runPenalties });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() { pens.on = false; hud.hand(null); handOn = false; handAt = ''; showEyes(null); showMark(null); onStage(null); undress(); sizeGoal(false); game.home(); }
