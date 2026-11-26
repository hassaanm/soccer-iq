// The rondos on the page (v88): two mini games (mini/chooser.js) played on the Fast engine's pieces. This puts the
// box (white lines, an orange cone at each corner) and the players in the 3D world, puts the game on the stage
// (ui/goalie.js onStage: main.js runs and draws it, the pause holds it), takes his touches as Fast mode does (a tap
// acts; a finger held down slows the world; moving it turns his head), and runs it with two lives (mini/run.js).
//  - Keep the ball: the view from behind and above him, on the near side, looking into the box. Five fixed spots on his
//    side (v93, D2): a tap goes to the nearest one, the ball at his feet if he has it; a tap on a friend he can see
//    passes; friends whose line is open glow gold while he has the ball (as in Fast mode); a red ring warns of a
//    defender about to take it; a pass to a spot he is not on pulses there; after a while with his line shut, the
//    best of his spots pulses.
//  - Win the ball: the view from behind and above him in the middle, turned to the ball. Spots in front of each passer
//    and in each passing lane (a new set each time he arrives); a tap goes to the nearest. STEAL (always bright, D3)
//    puts a foot out: it wins a ball within his reach (the ball glows exactly then); a miss and he stumbles a moment.
// The round and its seconds: a plain label at the top edge (v93: no ring at his feet). No slow motion by itself (the
// owner, 2026-11-19: "maybe this one does not have a slow-down effect at all"), only while a finger is held.
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game, canvas } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { PITCH } from '../geom.js';
import { sfx } from '../sound.js';
import { held, onPause, later } from '../pause.js';
import { onStage } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { makeMarks } from '../fast/marks.js';
import * as R from '../fast/rules.js';
import { Rondo } from './rondo-play.js';
import { stealState, setStealLook } from '../ui/steal-look.js';
import * as K from './rondo.js';
import { startRun, runStep, endRun, runOff } from './run.js';

const ID = { keep: 'rondoKeep', win: 'rondoWin' };
const run0Level = () => 0; // (the picture before the first round: level 0's box)
const TURN_MAX = 2.5, VIEW_BACK = 1, HINT_S = 3, SAY_HINT = 6, SAY_HINTS = 2, WARN_S = 1.6, TOP = 62;
const plog = o => { try { game.plog?.('rondo', o); } catch { /* the log is never in the way */ } };

// ---------- the stage (what main.js runs and draws) ----------
let g = null; // the Rondo playing now
export const stage = {
  on: false, kind: 'rondo', cam: { eye: [10, 10, 6], tgt: [15, 10, 0], Ff: .86, Fw: .5 }, ui: { glow: {}, clock: 0 },
  get sim() { return g ? g.sim : null; }, get phase() { return g ? g.phase : 'idle'; },
  tick(dt) { if (!this.on || !g || !dt) return; g.tick(dt); frame(dt); },
  tapAt() { return false; }, // (ui/goalie.js hands it a touch as the finger goes down: ours go through down/up below)
};

// ---------- the page (made once) ----------
let dom = null, marks = null, box = null;
function build() {
  if (dom) return;
  const el = document.createElement('div'); el.id = 'rondoHud';
  el.innerHTML = '<button id="rSteal" class="btn btn-gold btn-round" type="button" aria-label="Steal"><i>🦶</i><span>STEAL</span></button><div id="rSlow" aria-hidden="true"></div><div id="rClock" aria-live="off"><span>Round 1</span><b>20</b></div>';
  hudEl.appendChild(el);
  dom = { el, steal: el.querySelector('#rSteal'), clock: el.querySelector('#rClock'), clockN: el.querySelector('#rClock span'), clockS: el.querySelector('#rClock b'), n: null, sec: null };
  // STEAL (D3): always bright, always pressable; it acts as the finger goes down. A press while he stumbles does nothing more.
  dom.steal.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.isPrimary === false || !stage.on || held.on || !g) return; const me = g.sim.a('hero'), d = me ? R.dist(me, g.sim.ball) : 0, r = g.steal(); plog({ is: 'steal', res: r || 'stumbling', d: +d.toFixed(2) }); if (r === 'missed') sfx('tap'); });
  marks = makeMarks(world); box = makeBox(); spotM = makeSpots();
  canvas.addEventListener('pointerdown', down);
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', e => up(e, true));
  const lost = () => dropFinger(); addEventListener('blur', lost); addEventListener('pagehide', lost); document.addEventListener('visibilitychange', lost);
  onPause(on => { if (on && stage.on) resetTransient(); });
}
// The box on the grass: four white lines and a cone at each corner, moved to each round's box.
function makeBox() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: .9, depthWrite: false, toneMapped: false }); // (yellow: not the pitch's own white lines)
  const geo = new THREE.PlaneGeometry(1, .09), lines = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(geo, mat); m.renderOrder = 1; m.visible = false; world.scene.add(m); return m; });
  const cg = new THREE.ConeGeometry(.15, .34, 14), cm = new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: .55 });
  const cones = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(cg, cm); m.rotation.x = Math.PI / 2; m.castShadow = false; m.visible = false; world.scene.add(m); return m; }); // (the cones cast no shadow: its cost on a phone, v89 integration)
  let key = '';
  return {
    set(b) {
      const k = b ? `${b.cx} ${b.cy} ${b.size}` : ''; if (k === key) return; key = k;
      for (const m of [...lines, ...cones]) m.visible = !!b; if (!b) return;
      [[b.x0, b.cy, Math.PI / 2], [b.x1, b.cy, Math.PI / 2], [b.cx, b.y0, 0], [b.cx, b.y1, 0]].forEach(([x, y, r], i) => { const m = lines[i]; m.position.set(x, y, .022); m.rotation.z = r; m.scale.x = b.size; });
      [[b.x0, b.y0], [b.x0, b.y1], [b.x1, b.y0], [b.x1, b.y1]].forEach(([x, y], i) => cones[i].position.set(x, y, .17));
    },
  };
}

// His spots on the grass (D2): fixed marks, faint; the one he is going to, bright (with marks.js's go mark on it).
let spotM = null;
function makeSpots() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.lineWidth = 12; x.strokeStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc(64, 64, 44, 0, 7); x.stroke(); x.lineWidth = 7; x.strokeStyle = '#ffcf2e'; x.stroke();
  x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc(64, 64, 9, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1, 1), ms = Array.from({ length: 9 }, () => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false })); m.renderOrder = 2; m.visible = false; world.scene.add(m); return m; });
  let key = '';
  return {
    // list: the spots; lit: the one he is going to (or null). Set only when something changed (no work most frames).
    set(list, lit) {
      const k = list.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') + (lit ? ` @${lit.x.toFixed(2)},${lit.y.toFixed(2)}` : ''); if (k === key) return; key = k;
      ms.forEach((m, i) => { const p = list[i]; m.visible = !!p; if (!p) return; const on = !!lit && R.dist(p, lit) < .05; m.position.set(p.x, p.y, .04); m.scale.setScalar(on ? 1.15 : .95); m.material.opacity = on ? 1 : lit ? .4 : .7; });
    },
    hide() { key = ''; for (const m of ms) m.visible = false; },
  };
}

// ---------- his touches (as Fast mode: fast/fast.js down, move, up) ----------
let shutTaps = 0, shutFor = null, lastHint = null, finger = null, yaw = 0, holdYaw = null, holdT = 0, lastAct = 0, real = 0, warnAt = null, warnT = 0, hintSaid = 0, idleSay = 0;
function down(e) {
  if (finger && performance.now() - finger.t0 > 5000) dropFinger(); // (an old touch whose lift never came)
  if (!stage.on || !g || held.on || e.isPrimary === false || finger) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), f = finger = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, t0: performance.now(), yaw0: yaw, moved: false, held: false, w: r.width || world.width };
  f.timer = later(() => { if (finger === f && !held.on) hold(f); }, R.HOLD_S * 1000);
}
function hold(f) { if (f.held) return; f.held = true; g.holding = true; dom.el.classList.add('slowing'); sfx('down'); plog({ is: 'hold' }); }
function move(e) {
  const f = finger; if (!f || e.pointerId !== f.id || held.on) return;
  const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
  if (!f.moved && Math.hypot(dx, dy) > 12) { f.moved = true; hold(f); }
  if (f.moved) holdYaw = R.wrap(f.yaw0 - dx / f.w * 3.2);
}
function up(e, cancel = false) {
  const f = finger; if (!f || e.pointerId !== f.id) return; finger = null;
  const acts = R.pressActs((performance.now() - f.t0) / 1000, f.moved); // (a slow tap, the finger still, up to R.SLOW_TAP s: it acts too, as in Fast mode: v89 integration)
  if (f.held) { if (g) g.holding = false; dom.el.classList.remove('slowing'); holdT = real + (acts ? 0 : VIEW_BACK); sfx('up'); if (!acts) return; } // (play comes back to speed; after a look round the view stays where he left it a moment, then eases back)
  if (cancel || f.moved || held.on || !stage.on) return;
  const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top);
}
function dropFinger() { const f = finger; if (!f) return; finger = null; if (f.held) { if (g) g.holding = false; dom?.el.classList.remove('slowing'); } }
function resetTransient() { dropFinger(); holdYaw = null; holdT = 0; warnAt = null; if (g) g.holding = false; dom?.el.classList.remove('slowing'); lastAct = real; }
const seen = (p, z) => { const q = world.project(p.x, p.y, z); return !!q && R.onScreen(q, world.width, world.height, 10); };
// A tap: with the ball ('keep'), on a friend he can see, a pass; else to the spot nearest the tap on the screen (within
// SPOT_PX px, or near it on the grass: generous); a tap far from every spot does nothing.
function tap(x, y) {
  if (!g || (g.phase !== 'play' && g.phase !== 'ready')) return;
  const s = g.sim, reach = Math.max(60, Math.min(world.width, world.height) * .16);
  if (g.mode === 'keep' && g.owner() === 'hero' && g.phase === 'play') {
    let best = null, bd = 1e9;
    for (const id of ['m1', 'm2', 'm3']) { const a = s.a(id); if (!a) continue; for (const z of [.9, 0]) { const q = world.project(a.x, a.y, z); if (!q || !R.onScreen(q, world.width, world.height)) continue; const d = Math.hypot(q[0] - x, q[1] - y) * .8; if (d < bd) { bd = d; best = id; } } }
    if (best && bd <= reach) { const open = g.openLine('hero', best, K.ME.pass, .2); if (g.passTo(best)) { lastAct = real; sfx(open ? 'star' : 'tap', open ? 1 : undefined); plog({ is: 'pass', to: best, open: open ? 1 : 0 }); } return; }
  }
  const c = g.owner(); if (g.mode === 'keep' && c && c !== 'hero' && !g.openLine(c, 'hero', g.D.fPass, g.D.fMargin)) shutTaps++; // (his taps while his line stays shut: the hint comes sooner)
  const spot = spotFor(x, y);
  if (!spot) { plog({ is: 'miss' }); return; }
  const q = g.goSpot(spot); if (q) { lastAct = real; plog({ is: 'move', x: +q.x.toFixed(1), y: +q.y.toFixed(1), ball: g.owner() === 'hero' ? 1 : 0 }); }
}
const SPOT_PX = 70;
function spotFor(x, y) {
  let best = null, bd = Math.max(SPOT_PX, Math.min(world.width, world.height) * .15);
  for (const p of g.spots()) { const q = world.project(p.x, p.y, 0); if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = p; } }
  if (best) return best;
  const p = ground(x, y); return p ? K.spotAt(g.spots(), p, 1.6) : null;
}
// The point on the grass under a place on the screen (or null: the sky).
const ray = { c: new THREE.Raycaster(), n: new THREE.Vector2(), p: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), h: new THREE.Vector3() };
function ground(x, y) { ray.n.set(x / world.width * 2 - 1, -(y / world.height) * 2 + 1); ray.c.setFromCamera(ray.n, world.camera); return ray.c.ray.intersectPlane(ray.p, ray.h) ? { x: ray.h.x, y: ray.h.y } : null; }

// ---------- one frame: his head, the camera, the marks ----------
// Where he looks by himself: into the box ('keep': its middle, a little toward the ball), or at the ball ('win').
function natural() {
  const s = g.sim, h = s.a('hero'), b = s.ball, bx = g.box;
  if (g.mode === 'keep') { const c = Math.atan2(bx.cy - h.y, bx.cx - h.x), t = Math.atan2(b.y - h.y, b.x - h.x); return R.wrap(c + R.clamp(R.wrap(t - c), -.5, .5) * .4); }
  return R.dist(h, b) > .6 ? Math.atan2(b.y - h.y, b.x - h.x) : yaw;
}
function frame(dt) {
  const s = g.sim, h = s.a('hero'), b = s.ball, bx = g.box; if (!h || !bx) return;
  real += dt;
  // his head: where he would look, or where he holds it
  const nat = natural();
  if (finger?.moved && holdYaw != null) yaw = R.wrap(nat + R.clamp(R.wrap(holdYaw - nat), -1.4, 1.4));
  else if (real > holdT) { const d = R.wrap(nat - yaw); yaw = R.wrap(yaw + R.clamp(d * (1 - Math.exp(-dt * 2.6)), -TURN_MAX * dt, TURN_MAX * dt)); holdYaw = null; }
  // the camera: behind and above him; pulled back and up until what he needs is in the picture
  const keep = [{ x: h.x, y: h.y, z: 0 }, { x: h.x, y: h.y, z: 1.8 }, { x: b.x, y: b.y, z: b.z || 0 }];
  if (g.mode === 'keep') for (const id of ['m1', 'm2', 'm3']) { const a = s.a(id); if (a) keep.push({ x: a.x, y: a.y, z: .9 }); }
  else { const c = g.owner() || g.flight?.to; const a = c && c !== 'hero' && s.a(c); if (a) keep.push({ x: a.x, y: a.y, z: .9 }); }
  if (lastHint) keep.push({ x: lastHint.x, y: lastHint.y, z: 0 }); // (the pulsing place, when there is one, in the picture too)
  const want = K.rondoCam(h, yaw, g.mode === 'keep' ? bx.h + .5 : Math.min(5, Math.max(2.5, R.dist(h, b))), finger?.moved ? [] : keep, world.width || 932, world.height || 430, TOP);
  const c = stage.cam, k = 1 - Math.exp(-dt * 5);
  for (let i = 0; i < 3; i++) { c.eye[i] += (want.eye[i] - c.eye[i]) * k; c.tgt[i] += (want.tgt[i] - c.tgt[i]) * k; } c.Ff += (want.Ff - c.Ff) * k; c.Fw += (want.Fw - c.Fw) * k;
  // what shows on the grass
  const play = g.phase === 'play' || g.phase === 'ready', has = g.owner() === 'hero';
  box.set(bx);
  if (play) spotM.set(g.spots(), g.goAt); else spotM.hide();
  const ui = g.ui;
  for (const id of ['m1', 'm2', 'm3']) ui.glow[id] = g.mode === 'keep' && has && g.phase === 'play' && g.openLine('hero', id, K.ME.pass, .2) ? .55 : 0; // (gold: a pass that will get there, with room to spare)
  if (warnAt && (real > warnT || !has)) warnAt = null;
  // the hint ('keep'): his line shut, a friend on the ball, and he has done nothing for HINT_S s, or (v89 integration) has
  // tapped twice with his line still shut while a defender is on that friend: the best place on his side pulses
  let hinted = null; const c0 = g.owner(), shut = g.mode === 'keep' && c0 && c0 !== 'hero' && !g.openLine(c0, 'hero', g.D.fPass, g.D.fMargin);
  if (!shut || c0 !== shutFor) { shutTaps = 0; shutFor = shut ? c0 : null; }
  const pressed = shut && g.takers().some(o => R.dist(o, s.a(c0)) < 2.6);
  if (g.mode === 'keep' && g.phase === 'play' && shut && ((!g.goAt && real - lastAct > HINT_S) || (shutTaps >= 2 && pressed))) {
    const p = bestOfSpots(g, s.a(c0));
    if (p && R.dist(p, h) > 1) hinted = [p];
    if (hinted && real - lastAct > SAY_HINT && hintSaid < SAY_HINTS && real - idleSay > 12) { hintSaid++; idleSay = real; say(K.RONDO_SAID.move); plog({ is: 'hint' }); }
  }
  if (!hinted && g.ui.landing && R.dist(g.ui.landing, h) > .8) hinted = [g.ui.landing]; // (a pass to a spot he is not on: there it goes, go and meet it)
  lastHint = hinted?.[0] || null;
  const danger = warnAt ? s.a(warnAt) : g.stumbling() ? h : null; // (the red ring: a defender about to take it; or on him while he stumbles after a miss)
  marks.draw([], [], null, has, ui.clock, danger, play, g.goAt, hinted);
  stage.ui = ui;
  const st = g.mode === 'win' && play; if (st !== dom.stealOn) { dom.stealOn = st; dom.steal.classList.toggle('show', st); }
  // (v96) STEAL by how far the ball is: not shown beyond about 6 m, small and dim until it is in reach, full and bright in reach (the glow's own test)
  { const sl = st ? stealState(R.dist(h, b), ui.ballGlow, dom.stealSt === 'far') : ''; if (sl !== dom.stealSt) { dom.stealSt = sl; setStealLook(dom.steal, sl); } }
  clockLabel();
}
// The round and its seconds (D5: a plain label for the grown-up), written only when they change.
let roundN = 1;
function clockLabel() {
  const sec = g ? g.secsLeft() : null, on = sec != null;
  if (on !== dom.clockOn) { dom.clockOn = on; dom.clock.classList.toggle('show', on); }
  if (!on) return;
  if (roundN !== dom.n) { dom.n = roundN; dom.clockN.textContent = `Round ${roundN}`; }
  if (sec !== dom.sec) { dom.sec = sec; dom.clockS.textContent = String(sec); dom.clock.classList.toggle('low', sec <= 5); }
}

// The best of his spots for a pass from `from`: an open line, then the widest gap from the defenders.
function bestOfSpots(g, from) {
  let best = null, bs = -1e9; const w = g.watch();
  for (const p of K.keepSpots(g.box)) { const open = K.lineOpen(from, p, g.D.fPass, w, g.D.cutRun, g.D.cutReact, .3), sc = (open ? 10 : 0) + Math.min(3, K.laneGap(from, p, w)) + Math.min(4, w.reduce((m, o) => Math.min(m, R.dist(o, p)), 99)) * .4; if (sc > bs) { bs = sc; best = p; } }
  return best;
}

// ---------- the players' bodies ----------
// At 3 v 3 the world has three of each side: a fourth body for the box (his third friend, or their fourth passer).
const extra = new Map(), added = [];
function dress(us, them, mode) {
  const need = mode === 'keep' ? [['m1', us, 1], ['m2', us, 2], ['m3', us, 3]] : [['o1', them, 0], ['o2', them, 1], ['o3', them, 2], ['o4', them, 3]];
  for (const [id, team, i] of need) {
    if (world.rigs.get(id)) continue;
    const p = team.players[i] || team.players[1], key = id + JSON.stringify([p, team.kit]);
    let r = extra.get(key); if (!r) { r = makeRig(p, team.kit, false); extra.set(key, r); }
    world.scene.add(r); world.rigs.set(id, r); added.push(r);
  }
}
function undress() { for (const r of added) world.scene.remove(r); added.length = 0; world.resetRigs(); }

// ---------- a run ----------
let busy = false;
export const runRondoKeep = () => runRondo('keep');
export const runRondoWin = () => runRondo('win');
async function runRondo(mode) {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper(); // (the mini games' lines are loaded with the keeper game's: voicelines.js miniLines)
  try {
    build();
    const us = teamById(P.us), them = teamById(P.them), id = ID[mode], first = !P.mini?.[id]?.plays;
    game.setTeams(us, them); game.mode = 'rondo'; world.setEnv('park');
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'rondo' }); hud.dots([], 0);
    g = new Rondo({ mode, cx: PITCH.L / 2, cy: PITCH.W / 2, fx: ev => world.fx(ev), sfx });
    g.sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx('kick'); } else if (ev === 'touch') world.fx('touch'); };
    hooks(g);
    dress(us, them, mode); onStage(stage);
    roundN = 1; g.setup(run0Level(id)); g.phase = 'idle'; real = 0; lastAct = 0; hintSaid = 0; idleSay = -99; yaw = natural(); holdYaw = null; holdT = 0; warnAt = null; lastHint = null;
    stage.ui = g.ui; frame(0); const w = K.rondoCam(g.sim.a('hero'), yaw, g.mode === 'keep' ? g.box.h + .5 : 4, [], world.width || 932, world.height || 430, TOP); stage.cam = { eye: [...w.eye], tgt: [...w.tgt], Ff: w.Ff, Fw: w.Fw };
    const run = startRun(id);
    stage.on = true; dom.el.classList.add('on'); show(null);
    plog({ is: 'start', mode });
    if (first) await card(mode === 'keep' ? { emoji: '⚽', title: K.RONDO_SAID.keepIntro, sub: 'Tap a friend to pass. Tap a spot to move.', button: 'Play' } : { emoji: '🦶', title: K.RONDO_SAID.winIntro, sub: 'Tap a spot to move. Press STEAL when the ball glows.', button: 'Play' });
    for (roundN = 1; ; roundN++) {
      const r = await g.round(run.level), ok = r.res === 'kept' || r.res === 'won';
      plog({ is: 'round', mode, n: roundN, res: r.res, why: r.why, level: +r.level.toFixed(2), sec: r.sec, len: +g.len.toFixed(1), passes: r.passes, mine: r.myPasses, touches: r.myTouches, steals: r.steals, misses: r.lunges, presses: r.presses, glows: r.glows });
      if (!runStep(run, ok, { res: r.res, why: r.why, sec: r.sec })) break;
    }
    end();
    endRun(run, { again: () => runRondo(mode) });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() {
  stage.on = false; resetTransient(); marks?.hide(); spotM?.hide(); box?.set(null);
  if (dom) { dom.el.classList.remove('on', 'slowing'); dom.steal.classList.remove('show'); dom.clock.classList.remove('show', 'low'); dom.stealOn = false; dom.stealSt = ''; setStealLook(dom.steal, ''); dom.clockOn = false; dom.n = dom.sec = null; }
  if (g) { g.phase = 'idle'; g.done = null; }
  onStage(null); undress(); game.home();
}
// What he hears and sees as play goes: a whistle to start, the warning, the end of a round.
function hooks(r) {
  r.hooks.go = () => { sfx('whistle'); lastAct = real; };
  r.hooks.warn = id => { warnAt = id; warnT = real + WARN_S; sfx('ping'); };
  r.hooks.lunge = () => { plog({ is: 'lunge' }); };
  r.hooks.end = x => {
    resetTransient();
    if (x.res === 'kept') { hud.banner('KEPT IT!', 'good'); say(K.RONDO_SAID.kept); }
    else if (x.res === 'lost') { hud.banner('LOST IT', 'bad'); say(K.RONDO_SAID.lost); }
    else if (x.res === 'won') { hud.banner('GOT IT!', 'good'); say(K.RONDO_SAID.won); }
    else { hud.banner('TIME!', 'bad'); say(K.RONDO_SAID.time); }
  };
}
if (typeof window !== 'undefined') window.__rondo = { stage, get game() { return g; } }; // (for the checks and the console)
