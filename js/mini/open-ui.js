// "Who's open?" on the page (v96): a mini game (mini/chooser.js). He stands in the middle of the night stadium with the
// ball at his feet; the view is the game's own, from behind and above him (fast/rules.js camSpec, head up). Each try is a
// new layout (mini/open.js makeLayout); a ring at his feet drains (the world's own timer ring).
//  - A tap on a friend passes to him (a white ring under each friend shows they are the choices; a tap anywhere else does
//    nothing and costs nothing). The pass is played whatever he taps, and the game's own pass check (open.js passResult:
//    the Live engine's) says what happens: it gets there; it is cut out in the lane (that red steps across and takes it);
//    or the marker steps in and wins it as it arrives.
//  - Looking round: a turn arrow at each bottom corner turns his head a big step that way (a child finds a button he can
//    see; a drag is a thing he must be shown), and a drag on the grass turns it with the finger, as in the Classic game.
//    The view stays where he left it until the try ends.
//  - A friend he has seen this try and who is now off the screen keeps a chip at the edge on his side for a few seconds
//    (Live's chips, fast/fast.js): a tap on it passes to him.
//  - The ring runs out: the nearest red comes and takes the ball from him.
// Then the next try at once (about a second after the pass gets there). Everything on the page and in the 3D scene is made
// before play (behind the start card); in play only classes, transforms and opacities change, and only when they do.
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game, canvas } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { animateRig } from '../pro/motion.js';
import { Sim } from '../sim.js';
import { sfx } from '../sound.js';
import { held, onPause, later } from '../pause.js';
import { onStage } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { shirt } from '../fast/marks.js';
import * as R from '../fast/rules.js';
import * as O from './open.js';
import { startRun, runStep, endRun, runOff } from './run.js';
import { STEP } from './rules.js';

const ID = 'whoOpen';
// ms (held while paused) from the ball getting there to the next try; after a miss, long enough to see why. FADE: s a
// chip stays after he last saw that friend. TAP_PX: how near a friend on screen a tap counts as his (a child's finger).
const NEXT_OK = 650, NEXT_BAD = 1300, FADE = 4, TAP_PX = 58, CHIP_Y = [118, 182, 246], READY_S = .25;
const plog = o => { try { game.plog?.('open', o); } catch { /* the log is never in the way */ } };
const wait = ms => new Promise(r => later(r, ms));

// ---------- the stage (what main.js runs and draws) ----------
let sim = null, T = null; // T: the try now ({ lay, t, phase, ... })
export const stage = {
  on: false, kind: 'open', cam: { eye: [10, 10, 3], tgt: [20, 10, .5], Ff: .9, Fw: .52 }, ui: { glow: {}, timer: null },
  get sim() { return sim; }, get phase() { return T ? T.phase : 'idle'; },
  tick(dt) { if (!this.on || !sim || !dt) return; step(dt); },
  tapAt() { return false }, // (touches come through down/up below)
};

// ---------- the page and the 3D marks (made once) ----------
let dom = null, rings = null;
const ARROW = s => `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M${s > 0 ? '36 30A13 13 0 1 0 14 17' : '12 30A13 13 0 1 1 34 17'}" fill="none" stroke="#24193a" stroke-width="9" stroke-linecap="round"/><path d="M${s > 0 ? '36 30A13 13 0 1 0 14 17' : '12 30A13 13 0 1 1 34 17'}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="${s > 0 ? 'M6 13L15 24L21 11Z' : 'M42 13L33 24L27 11Z'}" fill="#fff" stroke="#24193a" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
function build() {
  if (dom) return;
  const el = document.createElement('div'); el.id = 'openHud';
  el.innerHTML = `<button id="oLeft" class="btn btn-blue btn-round oTurn" type="button" aria-label="Look left">${ARROW(1)}<i>👀</i></button>`
    + `<button id="oRight" class="btn btn-blue btn-round oTurn" type="button" aria-label="Look right">${ARROW(-1)}<i>👀</i></button>`
    + `<div id="oChips">${'<button class="oChip" type="button" aria-label="A friend you saw"><span class="pic"></span></button>'.repeat(O.FRIENDS.length)}</div>`;
  hudEl.appendChild(el);
  dom = { el, left: el.querySelector('#oLeft'), right: el.querySelector('#oRight'), chips: [...el.querySelectorAll('.oChip')].map((b, i) => ({ b, id: O.FRIENDS[i], tf: '', on: false })) };
  for (const [b, s] of [[dom.left, 1], [dom.right, -1]]) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.isPrimary === false) return; turn(s); });
  for (const c of dom.chips) c.b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (e.isPrimary === false || !c.on) return; plog({ is: 'chip', to: c.id }); passTo(c.id, 'chip'); });
  rings = makeRings();
  canvas.addEventListener('pointerdown', down);
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', e => up(e, true));
  const lost = () => dropFinger(); addEventListener('blur', lost); addEventListener('pagehide', lost); document.addEventListener('visibilitychange', lost);
  onPause(on => { if (on && stage.on) dropFinger(); });
}
// A white ring under each friend: the choices (the same for every friend: no ring tells him which one).
function makeRings() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.lineWidth = 14; x.strokeStyle = 'rgba(36,25,58,.55)'; x.beginPath(); x.arc(64, 64, 48, 0, 7); x.stroke();
  x.lineWidth = 8; x.strokeStyle = 'rgba(255,255,255,.95)'; x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1.5, 1.5), mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  const ms = O.FRIENDS.map(() => { const m = new THREE.Mesh(geo, mat); m.renderOrder = 2; m.visible = false; world.scene.add(m); return m; });
  return { ms, set(on) { O.FRIENDS.forEach((id, i) => { const a = on && sim?.a(id), m = ms[i]; m.visible = !!a; if (a) m.position.set(a.x, a.y, .03); }); }, hide() { for (const m of ms) m.visible = false; } };
}

// ---------- the players' bodies ----------
// The world draws hero, m1..m3 and o1..o4 itself (js/world.js IDS); a body it lacks at this size is made here for those
// ids, and m4, m5, o5, o6 are made and posed here (animateRig, as the world does). Made before play, kept for the next run.
const made = new Map(), added = [], own = new Map(); let busy = false;
const W_IDS = new Set(['m1', 'm2', 'm3', 'o1', 'o2', 'o3', 'o4']);
function body(id, team, i, hero) { const ps = team.players, p = ps[i % ps.length]; return i < ps.length ? { ...p, gk: false } : { ...p, num: (p.num % 90) + 3, hair: ps[(i + 2) % ps.length].hair, skin: ps[(i + 1) % ps.length].skin, gk: false, hero }; }
const want = (us, them) => [...O.FRIENDS.map((id, i) => [id, us, i + 1]), ...O.FOES.map((id, i) => [id, them, i])].filter(([id]) => !(W_IDS.has(id) && world.home?.rigs.get(id)));
function rigFor(id, team, i) { const p = body(id, team, i), key = id + JSON.stringify([p, team.kit]); let r = made.get(key); if (!r) { r = makeRig(p, team.kit, false); made.set(key, r); } return r; }
function dress(us, them) {
  for (const [id, team, i] of want(us, them)) {
    const r = rigFor(id, team, i); world.scene.add(r); added.push(r); r.visible = false;
    if (W_IDS.has(id)) world.rigs.set(id, r); else own.set(id, r);
  }
}
// (The bodies the world lacks are made ahead, one a frame, while nothing is played: a few seconds after the page loads
// and again when the Mini games sheet opens (the teams may have changed), so the tile's tap never waits for them (about
// 60 ms each on a phone-slow CPU); then all are drawn once, under the sheet or the home screen. It stops as soon as any
// game starts. Any not made by then are made as this game starts.)
let pre = 0;
function prebuild() {
  let us, them; try { us = teamById(P.us); them = teamById(P.them); } catch { return; }
  const list = want(us, them), tok = ++pre, sheet = document.getElementById('miniSheet'), home = document.getElementById('home');
  const stop = () => busy || tok !== pre || sheet?.classList.contains('starting') || !home || home.classList.contains('hidden');
  let i = 0;
  const next = () => {
    if (stop()) return;
    if (i >= list.length) { if (!added.length && list.some(([id, team, k]) => !rigFor(id, team, k).userData.openWarm)) try { build(); chipShirts(us); dress(us, them); warmQuiet(); } catch (e) { console.error(e); } finally { undress(); } return; }
    const [id, team, k] = list[i++]; try { rigFor(id, team, k); } catch (e) { console.error(e); return; } setTimeout(() => requestAnimationFrame(next), 0);
  };
  requestAnimationFrame(next);
}
if (typeof document !== 'undefined') setTimeout(() => {
  const sh = document.getElementById('miniSheet'); if (sh && typeof MutationObserver === 'function') new MutationObserver(() => { if (!sh.classList.contains('hidden') && !sh.classList.contains('starting')) prebuild(); }).observe(sh, { attributes: true, attributeFilter: ['class'] });
  setTimeout(prebuild, 4000);
}, 0);
function undress() { for (const r of added) world.scene.remove(r); added.length = 0; own.clear(); world.resetRigs(); }
// The chips' shirts, made before play: each chip holds every friend's shirt; the one it stands for shows.
let shirtsFor = null;
function chipShirts(us) {
  if (shirtsFor === us.id + JSON.stringify(us.kit)) return; shirtsFor = us.id + JSON.stringify(us.kit);
  dom.chips.forEach((c, i) => { c.b.querySelector('.pic').innerHTML = shirt(us, body(c.id, us, i + 1).num, 34); }); // (one chip for each friend, his own shirt)
}

// The first time a body is drawn its shapes and pictures go to the graphics chip. Two ways, never a picture of this game
// on a screen that shows something else (v96 fix: the home screen's picture changed for one frame, 4.5 s after load):
//  - warmQuiet (while the home screen or the Mini games sheet shows): each body and ring drawn once, tiny, just in front
//    of the world's camera as it is now, in the picture the screen already shows (as mini/puzzle-marks.js warm and
//    fast/marks.js warm do): the frame looks the same as the one before it.
//  - warm (as the game starts, under the sheet, with the picture about to change to this game's anyway): everything drawn
//    once in this game's own scene, the players standing in view, the rings and the ring at his feet showing.
function warmQuiet() {
  const r = world.renderer, cam = world.camera; if (!r || !cam || added.every(g => g.userData.openWarm)) return;
  const objs = [...added, ...rings.ms], was = objs.map(o => ({ v: o.visible, p: o.position.clone(), s: o.scale.clone() }));
  const at = new THREE.Vector3(); cam.getWorldDirection(at); at.multiplyScalar(cam.near * 4).add(cam.position);
  for (const o of objs) { o.visible = true; o.position.copy(at); o.scale.setScalar(1e-4); }
  try { if (world.post) world.post.render(); else r.render(world.scene, cam); } catch (e) { console.error(e); }
  objs.forEach((o, i) => { const w = was[i]; o.visible = w.v; o.position.copy(w.p); o.scale.copy(w.s); });
  for (const g of added) g.userData.openWarm = true;
  warmQuiet.n = (warmQuiet.n || 0) + 1;
}
let staged = false; // (this game's own scene drawn once: the ring at his feet, the rings, every body standing in view)
function warm() {
  if (staged && added.every(r => r.userData.openWarm)) return;
  const h = O.heroAt(), lay = { hero: h, friends: O.FRIENDS.map((id, i) => ({ id, x: h.x + 6, y: h.y - 4 + i * 2 })), foes: O.FOES.map((id, i) => ({ id, x: h.x + 9, y: h.y - 5 + i * 2 })) };
  setup(lay); T = { lay, phase: 'idle', yaw: 0, yawTo: 0, turned: 0, seen: new Map(), moved: new Set(), t: 0, turns: 0, drags: 0 };
  for (const [id, r] of own) animateRig(r, sim.a(id), sim, 0, 0, 0);
  frame(0, true); rings.set(true);
  try { world.render(sim, stage.cam, { glow: {}, timer: TIMER }, 0); } catch (e) { console.error(e); }
  rings.hide(); T = null; for (const r of added) r.userData.openWarm = true; staged = true;
}

// ---------- a try ----------
let prevLay = null, seedN = 0, real = 0, playMarked = false;
const nextSeed = () => (((Math.random() * 4294967296) >>> 0) ^ (++seedN * 2654435761 >>> 0)) >>> 0;
function setup(lay) {
  sim = new Sim();
  sim.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx('kick'); } else if (ev === 'touch') world.fx('touch'); };
  const sc = { hero: [lay.hero.x, lay.hero.y], mates: [], opps: [] };
  sim.setup(sc);
  const add = (p, team) => sim.agents.set(p.id, { id: p.id, team, x: p.x, y: p.y, tx: p.x, ty: p.y, speed: 0, sp: 0, dist: 0, d0: 0, tA: 0, tL: 1.4, tN: 0, kickAt: null, kickFoot: null, face: [1, 0] });
  for (const f of lay.friends) add(f, 'us'); for (const o of lay.foes) add(o, 'them');
  for (const a of sim.agents.values()) if (a.id !== 'hero') { const h = lay.hero, dx = h.x - a.x, dy = h.y - a.y, l = Math.hypot(dx, dy) || 1; a.face = [dx / l, dy / l]; } // (everyone faces him and the ball)
  sim.a('hero').face = [1, 0]; Object.assign(sim.ball, { x: lay.hero.x + .45, y: lay.hero.y, z: 0, state: 'carried', carrier: 'hero', h: 0, move: null, reach: null });
  for (const [id, r] of own) r.visible = !!sim.a(id);
}
// Plays one try at the run's level; resolves { ok, why, tap, bonus } when it is over.
// The next try's layout is made during this one, a little each frame (open.js layoutSteps: MAKE_MS a frame in play,
// MAKE_IDLE between tries, shared by the candidates): one for the level after a success and one for the level after a
// miss, so nothing is worked out in one go between two tries. If the one needed is not ready, the next try waits a few
// frames for it (at most WAIT_MAX ms; very rare), rather than working it out in one frame.
const MAKE_MS = 1.5, MAKE_IDLE = 4, WAIT_MAX = 1500;
let ahead = [];
async function layoutFor(level, w = -1) {
  let a = ahead.find(x => Math.abs(x.level - level) < 1e-6 && x.w === w);
  if (!a) { a = { level, w, g: O.layoutSteps(level, nextSeed(), prevLay, w), lay: null }; ahead = [a]; } // (a bonus point: a level not made ahead)
  else ahead = [a];
  for (let w = 0; !a.lay && w < WAIT_MAX; w += 30) await wait(30);
  ahead = [];
  if (a.lay) return a.lay;
  for (;;) { const r = a.g.next(); if (r.done) return r.value; } // (still not done: the rest now)
}
function makeAhead() {
  const t0 = performance.now(), todo = ahead.filter(a => !a.lay); if (!todo.length) return;
  const per = (T && (T.phase === 'play' || T.phase === 'ready' || T.phase === 'pass' || T.phase === 'steal') ? MAKE_MS : MAKE_IDLE) / todo.length;
  for (const a of todo) { const end = performance.now() + per; while (performance.now() < end) { const r = a.g.next(); if (r.done) { a.lay = r.value; break; } } }
  void t0;
}
async function playTry(run) {
  const w = O.welcomeOf(run.n), lay = await layoutFor(run.level, w); prevLay = lay;
  const wNext = O.welcomeOf(run.n + 1); // (the next try: after this one, whichever way it ends)
  ahead = [run.level + STEP, run.level].map(level => ({ level, w: wNext, g: O.layoutSteps(level, nextSeed(), lay, wNext), lay: null }));
  begin(lay, O.AGAIN * (w >= 0 ? 1 : 0));
  plog({ is: 'layout', seed: lay.seed, level: +run.level.toFixed(2), right: lay.ans.join(','), after: lay.after?.join(',') || null, kinds: Object.entries(lay.kinds).map(([k, v]) => k + ':' + v).join(','), look: lay.look, secs: +lay.secs.toFixed(2), two: lay.two ? 1 : null, welcome: w >= 0 ? w + 1 : null });
  return new Promise(res => { T.done = res; });
}
// A try's picture, from the start (again: misses he has left that cost no life: a welcoming try's first misses).
function begin(lay, again, done = null) {
  setup(lay);
  T = { lay, t: 0, phase: 'ready', yaw: 0, yawTo: 0, turned: 0, seen: new Map(), moved: new Set(), tap: null, res: null, kick: null, done, t0: real, turns: 0, drags: 0, again };
  stage.cam.Ff = .9; frame(0, true);
}
// The time he has had (s); the ring shows what is left.
const left = () => (T ? Math.max(0, 1 - T.t / T.lay.secs) : 0), TIMER = { left: 1 };
function step(dt) {
  real += dt;
  if (T) {
    if (T.phase === 'ready' || T.phase === 'play') {
      T.t += dt; if (T.phase === 'ready' && T.t >= READY_S) { T.phase = 'play'; if (!playMarked) { playMarked = true; if (typeof window !== 'undefined') window.__open.playAt = performance.now(); } } // (for the checks: the run's play begins; nothing is made for the 3D picture after it)
      for (const o of T.lay.foes) if (o.move && !T.moved.has(o.id) && T.t >= o.move.t0) { T.moved.add(o.id); sim.go(o.id, o.move.to.x, o.move.to.y, o.move.v); }
      if (T.t >= T.lay.secs) timeUp();
    } else if (T.phase === 'pass') follow();
    else if (T.phase === 'steal') stealing();
    if ((T.phase === 'pass' || T.phase === 'steal') && real - T.from > 4) finish(T.phase === 'pass' && T.res.ok, T.phase === 'steal' ? 'time' : T.res.ok ? null : T.res.why); // (never stuck: whatever the ball did, the try ends)
    makeAhead();
  }
  sim.step(dt);
  for (const [id, r] of own) { const a = sim.a(id); if (!a) { r.visible = false; continue; } animateRig(r, a, sim, 0, 0, real); const e = stage.cam.eye; r.visible = !(Math.hypot(a.x - e[0], a.y - e[1]) < 1.7 && e[2] < 5); } // (as the world does: nobody right by the camera)
  frame(dt);
}

// ---------- his look: the arrows and the drag ----------
function turn(s) {
  if (!stage.on || held.on || !T || (T.phase !== 'play' && T.phase !== 'ready')) return;
  T.yawTo = R.wrap(T.yawTo + s * O.TURN_STEP); T.turns++; sfx('tap'); plog({ is: 'turn', way: s > 0 ? 'left' : 'right', t: +T.t.toFixed(2) });
  const b = s > 0 ? dom.left : dom.right; b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed');
}
let finger = null;
function down(e) {
  if (finger && performance.now() - finger.t0 > 5000) dropFinger();
  if (!stage.on || !T || held.on || e.isPrimary === false || finger) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  finger = { id: e.pointerId, x0: e.clientX - r.left, y0: e.clientY - r.top, t0: performance.now(), yaw0: T.yaw, moved: false, w: r.width || world.width };
}
function move(e) {
  const f = finger; if (!f || e.pointerId !== f.id || held.on || !T) return;
  const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - f.x0, dy = e.clientY - r.top - f.y0;
  if (!f.moved && Math.hypot(dx, dy) > 12) { f.moved = true; if (T.phase === 'play' || T.phase === 'ready') T.drags++; }
  if (f.moved && (T.phase === 'play' || T.phase === 'ready')) T.yawTo = T.yaw = R.wrap(f.yaw0 - dx / f.w * O.DRAG);
}
function up(e, cancel = false) {
  const f = finger; if (!f || e.pointerId !== f.id) return; finger = null;
  if (cancel || f.moved || held.on || !stage.on || !T) return;
  const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top);
}
function dropFinger() { finger = null; }
// A tap: the friend nearest it on screen (his feet or his middle), within TAP_PX; else nothing.
function tap(x, y) {
  if (!T || T.phase !== 'play') { if (T?.phase === 'ready') plog({ is: 'early' }); return; }
  let best = null, bd = TAP_PX;
  for (const f of T.lay.friends) { const a = sim.a(f.id); for (const z of [.9, .1]) { const q = world.project(a.x, a.y, z); if (!q || !R.onScreen(q, world.width, world.height)) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = f.id; } } }
  if (!best) { plog({ is: 'miss', x: Math.round(x), y: Math.round(y) }); return; }
  passTo(best, 'tap');
}

// ---------- the pass and what happens to it ----------
const pos = () => ({ hero: { x: sim.a('hero').x, y: sim.a('hero').y }, friends: T.lay.friends.map(f => ({ id: f.id, x: sim.a(f.id).x, y: sim.a(f.id).y })), foes: T.lay.foes.map(o => ({ id: o.id, x: sim.a(o.id).x, y: sim.a(o.id).y })) });
function passTo(id, how) {
  if (!T || T.phase !== 'play' || held.on) return;
  const p = pos(), res = O.passResult(p.hero, p.friends, p.foes, id), right = O.openIds(O.statuses(p.hero, p.friends, p.foes)), h = sim.a('hero'), f = sim.a(id);
  // a decoy shut by his own red: what it shows (open.js: 'marked', a red a step from him; 'lane', a red in the line) and
  // that red takes it; otherwise (a red on the move) as the check found it
  const red = T.lay.foes.find(o => o.of === id && !o.move);
  if (!res.ok && red) { res.why = T.lay.kinds[id]; res.by = red.id; }
  T.phase = 'pass'; T.from = real; T.tap = id; T.res = res; T.right = right; T.how = how; T.sec = +T.t.toFixed(2);
  for (const o of T.lay.foes) { const a = sim.a(o.id); sim.stop(o.id); a.speed = 0; } // (everyone stops where he is: the check was made with them there)
  // the view: him and the friend in the picture
  if (!O.onView(h, f, T.yaw, world.width || 932, world.height || 430)) T.yawTo = R.wrap(Math.atan2(f.y - h.y, f.x - h.x) * .8 + T.yaw * .2);
  const d = R.dist(h, f), sp = R.clamp(6 + d * .45, 8, 13.5);
  sim.windup('hero', 'pass'); sim.open(id, h.x, h.y);
  T.kick = { at: sim.time + .13, to: { x: f.x, y: f.y }, sp, d, by: res.by || null, cut: null };
  if (!res.ok && res.why === 'lane') { const o = sim.a(res.by), c = R.onLane(o, h, f, .12); T.kick.cut = { x: c.x, y: c.y, along: c.along }; sim.go(res.by, c.x, c.y, 5.6); }
  sfx('tap');
}
function follow() {
  const k = T.kick, b = sim.ball, h = sim.a('hero');
  if (k.at && sim.time >= k.at) { k.at = 0; sim.kick(k.to.x, k.to.y, { speed: k.sp, arc: .08 }); if (!T.res.ok && T.res.why === 'marked') { const o = sim.a(k.by), f = sim.a(T.tap), u = { x: h.x - f.x, y: h.y - f.y }, l = Math.hypot(u.x, u.y) || 1; sim.go(k.by, f.x + u.x / l * .55, f.y + u.y / l * .55, 4.2); void o; } return; }
  if (k.at || T.over) return;
  if (b.state !== 'flying' && b.state !== 'loose') return;
  const gone = Math.hypot(b.x - h.x, b.y - h.y);
  if (!T.res.ok && T.res.why === 'lane') {
    const o = sim.a(k.by);
    if (Math.hypot(o.x - b.x, o.y - b.y) < .7 || gone >= k.cut.along - .15) { if (Math.hypot(o.x - b.x, o.y - b.y) > 1.1) Object.assign(o, { x: b.x - (b.x - o.x) * .4, y: b.y - (b.y - o.y) * .4 }); take(k.by); finish(false, 'lane'); }
    return;
  }
  if (b.state === 'loose' || gone >= k.d - .5) {
    if (T.res.ok) { sim.give(T.tap); finish(true); }
    else { take(k.by); finish(false, T.res.why || 'marked'); }
  }
}
// One of theirs has it: it stops at his feet, and he takes it away a few steps.
function take(id) {
  const o = sim.a(id), h = sim.a('hero'); sim.give(id);
  const u = { x: o.x - h.x, y: o.y - h.y }, l = Math.hypot(u.x, u.y) || 1; later(() => { if (sim?.a(id)) sim.go(id, o.x + u.x / l * 2.6, o.y + u.y / l * 2.6, 3); }, 250);
}
// The ring ran out: the nearest of theirs comes for the ball.
function timeUp() {
  const p = pos(), o = O.taker(p.hero, p.foes); T.phase = 'steal'; T.from = real; T.tap = null; T.sec = +T.lay.secs.toFixed(2); T.right = O.openIds(O.statuses(p.hero, p.friends, p.foes));
  for (const x of T.lay.foes) if (x.id !== o.id) sim.stop(x.id);
  T.taker = o.id; const h = sim.a('hero'); sim.go(o.id, h.x, h.y, 5.2); sfx('ping');
}
function stealing() {
  const o = sim.a(T.taker), h = sim.a('hero');
  if (!T.over && Math.hypot(o.x - h.x, o.y - h.y) < 1.05) { sim.stop(o.id); take(T.taker); finish(false, 'time'); }
}
let talking = false, praised = -99; const PRAISE_S = 5; const hist = []; // (hist: the last tries, for the checks and the bots)
const speak = (line, force = false) => { if (talking && !force) return; talking = true; Promise.resolve(say(line)).finally(() => { talking = false; }); };
function finish(ok, why = null) {
  if (T.over) return; T.over = true; T.phase = 'after';
  const lay = T.lay, best = T.right?.length > 1 ? T.right.slice().sort((a, b) => sim.a(b).x - sim.a(a).x)[0] : null, bonus = ok && lay.two && best === T.tap && T.right.length > 1 ? O.FORWARD_BONUS : 0;
  const ansSteps = Math.min(...(T.right?.length ? T.right : lay.ans).map(id => O.lookSteps(lay.hero, lay.friends.find(f => f.id === id))));
  if (ok) {
    sfx('star', bonus ? 2 : 1);
    if (bonus) { hud.banner('FORWARD!', 'goal'); speak(O.OPEN_SAID.forward); }
    else { hud.banner('NICE PASS!', 'good'); const looked = ansSteps > 0 && T.turns + T.drags > 0; if (looked || real - praised > PRAISE_S) { praised = real; speak(looked ? O.OPEN_SAID.looked : O.OPEN_SAID.good); } } // (the plain praise at most every PRAISE_S s: the tries come fast)
  } else {
    hud.banner(why === 'lane' ? 'BLOCKED!' : why === 'time' ? 'TOO SLOW!' : 'MARKED!', 'bad');
    speak(why === 'lane' ? O.OPEN_SAID.lane : why === 'time' ? (ansSteps > 0 ? O.OPEN_SAID.behind : O.OPEN_SAID.time) : O.OPEN_SAID.marked, true);
  }
  const out = { ok, why, tap: T.tap, bonus, how: T.how || null, sec: T.sec, right: (T.right || []).join(',') || '-', seed: lay.seed, look: ansSteps, turns: T.turns, drags: T.drags, turned: Math.round(T.turned * 57.3), kind: lay.two ? 'two' : lay.after ? 'move' : 'one', ...(!ok && T.again > 0 ? { again: 1 } : {}) };
  hist.push(out); if (hist.length > 200) hist.shift();
  // (v96 fix) a welcoming try's first misses (open.js AGAIN) cost no life: once he has seen why, the same picture again, the ball his
  if (!ok && T.again > 0) { const t = T; plog({ is: 'again', why, tap: t.tap || 'none' }); later(() => { if (T === t && stage.on) { begin(t.lay, t.again - 1, t.done); if (why !== 'time') speak(O.OPEN_SAID.time); } }, NEXT_BAD + 250); return; } // ("So close! Try again!")
  later(() => { const d = T.done; T.phase = 'gone'; d?.(out); }, ok ? NEXT_OK : NEXT_BAD);
}

// ---------- one frame: the view, the chips, the rings, the ring at his feet ----------
function frame(dt, snap = false) {
  if (!T || !sim) return;
  const h = sim.a('hero'); if (!h) return;
  if (snap) T.yaw = T.yawTo;
  else if (!finger?.moved) { const d = R.wrap(T.yawTo - T.yaw); T.yaw = R.wrap(T.yaw + R.clamp(d * (1 - Math.exp(-dt * 9)), -O.TURN_RATE * dt, O.TURN_RATE * dt)); }
  T.turned = Math.max(T.turned, Math.abs(T.yaw));
  const c = R.camSpec(h, h, true, T.yaw, 1), cam = stage.cam; for (let i = 0; i < 3; i++) { cam.eye[i] = c.eye[i]; cam.tgt[i] = c.tgt[i]; } cam.Ff = c.Ff; cam.Fw = c.Fw;
  const play = T.phase === 'play' || T.phase === 'ready';
  stage.ui.timer = play ? (TIMER.left = left(), TIMER) : null;
  rings.set(play);
  chips(play);
  const on = play; if (on !== dom.on) { dom.on = on; dom.el.classList.toggle('live', on); }
}
// Friends he saw this try and who are off the screen now: a chip at the edge on their side, for FADE s after he last saw
// them. Written only when something changed.
function chips(play) {
  const w = world.width || 932, hh = world.height || 430, h = sim.a('hero'), list = { l: [], r: [] };
  if (play) for (const f of T.lay.friends) {
    const a = sim.a(f.id), on = [.9, .1].some(z => R.onScreen(world.project(a.x, a.y, z), w, hh, 10));
    if (on) { T.seen.set(f.id, real); continue; }
    const at = T.seen.get(f.id); if (at == null || real - at > FADE) continue;
    const rel = R.wrap(Math.atan2(a.y - h.y, a.x - h.x) - T.yaw); (rel > 0 ? list.l : list.r).push({ id: f.id, rel: Math.abs(rel) });
  }
  const show = [];
  for (const [k, side] of [['l', 0], ['r', 1]]) list[k].sort((p, q) => p.rel - q.rel).slice(0, CHIP_Y.length).forEach((c, i) => show.push({ ...c, x: side ? w - 34 : 34, y: CHIP_Y[i], side }));
  for (const d of dom.chips) {
    const c = show.find(x => x.id === d.id), on = !!c;
    if (on !== d.on) { d.on = on; d.b.classList.toggle('show', on); }
    if (!c) continue;
    const tf = `translate(${Math.round(c.x - 28)}px,${Math.round(c.y - 28)}px)`; if (tf !== d.tf) { d.tf = tf; d.b.style.transform = tf; d.b.classList.toggle('r', !!c.side); }
  }
}

// ---------- a run ----------
export async function runOpen() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper(ID);
  try {
    build();
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.[ID]?.plays;
    if (game.us !== us || game.them !== them) game.setTeams(us, them); // (the same teams: the world keeps its compiled look, and the first frame compiles nothing)
    game.mode = 'open'; world.setEnv('crowd'); // (v96 fix: the night stadium, also after a game on the training ground)
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'rondo' }); hud.dots([], 0);
    dress(us, them); chipShirts(us); warm();
    prevLay = null; real = 0; praised = -99; playMarked = false;
    const run = startRun(ID);
    // the first try's picture behind the card (its layout is made again when play starts)
    { const lay0 = O.makeLayout(0, nextSeed(), null, O.welcomeOf(0)); ahead = [{ level: 0, w: O.welcomeOf(0), lay: lay0 }]; setup(lay0); /* (the first try's own layout, shown behind the card) */ T = { lay: lay0, phase: 'idle', yaw: 0, yawTo: 0, turned: 0, seen: new Map(), moved: new Set(), t: 0, turns: 0, drags: 0 }; frame(0, true); }
    onStage(stage); stage.on = true; dom.el.classList.add('on'); show(null);
    plog({ is: 'start' });
    if (first) await card({ emoji: '👀', title: O.OPEN_SAID.intro, sub: 'Tap the friend with nobody from the other team near him and nobody in the way. The arrows turn to look around.', button: 'Play' });
    for (;;) {
      const r = await playTry(run), lv = run.level;
      const info = { seed: r.seed, tap: r.tap || 'none', how: r.how, right: r.right, sec: r.sec, why: r.why, look: r.look, turns: r.turns, drags: r.drags, turned: r.turned, kind: r.kind };
      if (!runStep(run, r.ok, info)) break;
      if (r.bonus) runStep(run, true, { bonus: 1, seed: r.seed, level0: +lv.toFixed(2) }); // ("forward first": one more point for the friend nearer their goal)
    }
    end();
    endRun(run, { again: runOpen });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() {
  stage.on = false; dropFinger(); rings?.hide();
  if (dom) { dom.el.classList.remove('on', 'live'); dom.on = false; for (const c of dom.chips) { c.on = false; c.b.classList.remove('show'); } }
  if (T) T.phase = 'gone'; T = null;
  onStage(null); undress(); game.home();
}
if (typeof window !== 'undefined') window.__open = {
  stage, hist, playAt: 0, get T() { return T; }, get sim() { return sim; }, get warms() { return warmQuiet.n || 0; },
  // (for the checks and the bots) where each friend and each of theirs is on the screen now, and the arrows and chips
  view() {
    if (!T?.lay || !sim) return null; const w = world.width, h = world.height, at = (id, z) => { const a = sim.a(id); const q = a && world.project(a.x, a.y, z); return q && R.onScreen(q, w, h, 4) ? [Math.round(q[0]), Math.round(q[1])] : null; };
    return { phase: T.phase, t: +T.t.toFixed(2), secs: T.lay.secs, yaw: +T.yaw.toFixed(2), level: T.lay.level, seed: T.lay.seed, ans: T.lay.ans, after: T.lay.after, two: T.lay.two, look: T.lay.look,
      friends: T.lay.friends.map(f => ({ id: f.id, x: +sim.a(f.id).x.toFixed(2), y: +sim.a(f.id).y.toFixed(2), feet: at(f.id, .1), mid: at(f.id, .9) })), foes: T.lay.foes.map(o => ({ id: o.id, x: +sim.a(o.id).x.toFixed(2), y: +sim.a(o.id).y.toFixed(2), feet: at(o.id, .1) })),
      hero: { x: sim.a('hero').x, y: sim.a('hero').y }, chips: dom.chips.filter(c => c.on).map(c => ({ id: c.id, r: c.b.getBoundingClientRect().toJSON() })) };
  },
};
