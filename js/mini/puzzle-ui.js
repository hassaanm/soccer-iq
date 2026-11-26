// Soccer puzzles on the page (v90; v96 in the game's own 3D world): a mini game (mini/chooser.js). mini/puzzle.js has
// the rules; this plays them in the stadium at night with the game's own players (pro/rig.js, their run, pass, shot,
// save and tackle from pro/motion.js and pro/keeper.js, moved by the game's sim.js), seen from one camera that stays put
// for the whole puzzle and shows all of it. His choices are marks on the grass (mini/puzzle-marks.js): the places he can
// run to, a ring at each friend's feet, a friend's run arrow, the three goal spots with the keeper's cover, the lanes and
// each red player's reach. A move plays out (the pass, his run, the shot), then their answer for a beat (the keeper
// shuffles, the red players step), so cause and effect are seen; about 1.2 s for both. A failed move shows why (the
// interception, the tackle, the save) before the life goes; then the solution plays itself once.
// It goes on the stage as the keeper game does (ui/goalie.js onStage: main.js ticks and draws it, the pause holds it, a
// touch on the picture comes to tapAt). Every mark, body and page node is made before play (build, dress, behind the
// start); in play only what is shown and where changes (nothing made, no layout read in the game step).
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { sfx } from '../sound.js';
import { PITCH } from '../geom.js';
import { Goalie } from '../game/goalie.js';
import { onStage, sizeGoal } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { teamById, keeperKit } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { faceTo } from '../game/shared.js';
import { onPause } from '../pause.js';
import { ball as ballSvg } from './pics.js';
import { STEP } from './rules.js';
import { startRun, runStep, endRun, runOff } from './run.js';
import { makePzMarks } from './puzzle-marks.js';
import { puzzleSteps, makePuzzle, Board, startOf, parse, mid, inBox, ourAt, theirAt, rng, covers, cutBy, goalRows, canRun, laneOf, BOX, PZ_SAID, PZ_WHY, PZ_IDEA } from './puzzle.js';

// ---------- the board on the pitch ----------
// We attack our own goal's end (x = 0: ui/goalie.js sizeGoal makes it the 5 m goal at every size). A place is C metres;
// the goal line is a place past the last column; the keeper stands on it.
const C = 2, K_X = .15, GOAL_X = -.5;
const V = { dribble: 4.4, run: 7, step: 5, gk: 4, pass: 14, shot: 15 }; // m/s
const T = { beat: .08, why: 1.35, hint: 4, hintNew: 2.5, replayEnd: 1.2, goal: 1.3 }; // s (real time)
// The camera: one for the whole puzzle, fitted so the whole board, the goal and the players' heads are in the picture
// clear of the HUD (the moves down the left edge; the bar, home and pause at the top). 'side': raised above the far
// touchline, looking across and down (the goal on the right); 'top': straight down. EL: its height angle; FF: the lens.
export const VIEWS = { side: { el: 62, Ff: 1.55 }, top: { el: 89.4, Ff: 1.55 } };
let VIEW = 'side';
const SAFE = { l: 66, r: 16, t: 62, b: 8 }; // px kept clear round the picture's edge
let pz = null, board = null, cy = PITCH.W / 2;
const wx = x => (pz.W - x) * C, wy = y => cy + (y - mid(pz)) * C;
const at3 = (x, y) => ({ x: wx(x), y: wy(y) });
const goalAt = r => ({ x: GOAL_X, y: wy(r) });
const ourId = i => (i ? 'm' + i : 'hero'), theirId = k => 'o' + (k + 1);

// ---------- the stage (main.js ticks and draws it; the pause holds it) ----------
class Stage extends Goalie {
  constructor(o) { super(o); this.kind = 'puzzles'; this.covers = false; this.speed = 1; }
  tick(dt) { super.tick(dt * this.speed); } // (speed: the review tools only)
  // The keeper's dive or reach (pro/keeper.js draws it from k.gkm, as for the match keepers and mini/penalty.js).
  gameStep(dt) {
    const s = this.sim, k = s.a('k2'), m = k?.gkm;
    if (m && m.body) {
      if (!m.went && s.time >= m.t0) { m.went = true; s.go('k2', m.body.x, m.body.y, m.spd); }
      if (s.time > m.t0 + m.dur + (m.k === 'dive' ? 1.1 : .5)) { k.gkm = null; s.stop('k2'); }
    }
    s.step(dt);
    if (k) k.face = [1, 0];
  }
  frame() { const ui = this.ui; ui.timer = null; ui.heroRing = false; ui.lines = null; ui.ghost = false; ui.tell = null; ui.hand = null; frame(); }
  tapAt(x, y) { return tapAt(x, y); }
}
export const stage = new Stage({ world, hud, say, sfx });
const sim = () => stage.sim;
const until = (f, max = 3) => { const t0 = stage.real || 0; return stage.wait(99, () => f() || (stage.real || 0) - t0 > max); };
const gwait = sec => { const t = sim().time + sec; return stage.wait(99, () => sim().time >= t); };
const now = () => stage.real || 0;
const near = (a, p, r) => Math.hypot(a.x - p.x, a.y - p.y) < r;

// ---------- made once, before play ----------
let marks = null, layer = null, ballsEl = null, sandEl = null, sandFill = null, whyText = null, built = false;
const MAX_MOVES = 8;
function build() {
  if (built) return; built = true;
  marks = makePzMarks(world);
  // The page: the moves he has left (balls down the left edge), the sand timer (right edge) and a line of words for a
  // grown-up (why it failed: its own text node, changed in place). Pointer events pass through to the picture.
  layer = document.createElement('div'); layer.id = 'pz'; layer.className = 'hidden';
  const BALL = `<svg viewBox="-12.5 -12.5 25 25" aria-hidden="true"><ellipse cx="1.5" cy="9.5" rx="9" ry="3" fill="#24193a" opacity=".35"/>${ballSvg(0, 0, 10)}</svg>`;
  layer.innerHTML = `<div class="balls" aria-label="Moves">${Array.from({ length: MAX_MOVES }, () => `<i class="off">${BALL}</i>`).join('')}</div><div class="sand hidden" aria-label="Time"><i></i></div><div class="why"> </div>`;
  hudEl.insertBefore(layer, hudEl.firstChild);
  ballsEl = layer.querySelector('.balls'); sandEl = layer.querySelector('.sand'); sandFill = sandEl.querySelector('i'); whyText = layer.querySelector('.why').firstChild;
  onPause(on => { if (stage.on) layer.classList.toggle('held', on); });
}
// Bodies the world does not have at this size: a fourth friend and a fourth of theirs (3 v 3), their keeper (3 v 3 and
// 4 v 4). Made at the start of the run (kept for the next), put back after.
const madeRigs = new Map(); let added = [];
function dress(us, them) {
  added = [];
  const want = [['m3', () => makeRig(us.players[3] || us.players[1], us.kit, false)], ['o4', () => makeRig(them.players[3] || them.players[1], them.kit, false)],
    ['k2', () => { const p = them.players.find(q => q.gk) || them.players[4] || them.players[0]; const g = makeRig({ ...p, gk: true }, keeperKit(them, us), false); g.userData.gk = true; return g; }]];
  for (const [id, mk] of want) {
    if (world.rigs.get(id)) continue;
    const key = id + JSON.stringify([them.id, us.id]); let g = madeRigs.get(key); if (!g) { g = mk(); madeRigs.set(key, g); }
    world.scene.add(g); world.rigs.set(id, g); added.push(g);
  }
}
function undress() { for (const g of added) world.scene.remove(g); added = []; world.resetRigs(); }

// ---------- the camera ----------
const fitCam3 = new THREE.PerspectiveCamera(40, 2, .1, 500); fitCam3.up.set(0, 0, 1);
const V3 = new THREE.Vector3();
export function fitCam(p = pz, view = VIEW) {
  const w = world.width || 932, h = world.height || 430, v = VIEWS[view], el = v.el * Math.PI / 180, F = h * v.Ff;
  const keepPz = pz; pz = p;
  const pts = [];
  for (const x of [-.5, p.W - .5]) for (const y of [-.5, p.H - .5]) { const q = at3(x, y); pts.push([q.x, q.y, 0], [q.x, q.y, 1.5]); }
  for (const y of [cy - 2.7, cy + 2.7]) pts.push([-1.2, y, 0], [-1.2, y, 1.9], [0, y, 1.9]);
  pz = keepPz;
  fitCam3.fov = 2 * Math.atan(h / 2 / F) * 180 / Math.PI; fitCam3.aspect = w / h; fitCam3.updateProjectionMatrix();
  const tgt = new THREE.Vector3(pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length, .4);
  const dir = new THREE.Vector3(0, Math.cos(el), Math.sin(el)); let dist = 22;
  const sx = [SAFE.l, w - SAFE.r], sy = [SAFE.t, h - SAFE.b], cxs = (sx[0] + sx[1]) / 2, cys = (sy[0] + sy[1]) / 2;
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  for (let it = 0; it < 40; it++) {
    fitCam3.position.copy(tgt).addScaledVector(dir, dist); fitCam3.lookAt(tgt); fitCam3.updateMatrixWorld();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const q of pts) { V3.set(q[0], q[1], q[2]).project(fitCam3); const px = (V3.x + 1) / 2 * w, py = (1 - V3.y) / 2 * h; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    const k = Math.max((x1 - x0) / (sx[1] - sx[0]), (y1 - y0) / (sy[1] - sy[0]));
    right.setFromMatrixColumn(fitCam3.matrixWorld, 0); up.setFromMatrixColumn(fitCam3.matrixWorld, 1);
    const mpp = dist / F; tgt.addScaledVector(right, ((x0 + x1) / 2 - cxs) * mpp * .9).addScaledVector(up, -((y0 + y1) / 2 - cys) * mpp * .9);
    dist *= Math.pow(k, .8);
  }
  const eye = tgt.clone().addScaledVector(dir, dist);
  return { eye: [eye.x, eye.y, eye.z], tgt: [tgt.x, tgt.y, tgt.z], Ff: v.Ff, Fw: 0 };
}

// ---------- the bodies on the board ----------
// Everyone to where a board state has them, at once (a new puzzle, the replay's start): every body starts afresh.
function placeAll(s) {
  const S = sim(), n = s.o.length >> 1, m = s.d.length >> 1, P3 = i => { const q = at3(s.o[2 * i], s.o[2 * i + 1]); return [q.x, q.y]; };
  S.setup({ hero: P3(0), mates: Array.from({ length: n - 1 }, (_, i) => P3(i + 1)), opps: Array.from({ length: m }, (_, k) => { const q = at3(s.d[2 * k], s.d[2 * k + 1]); return [q.x, q.y]; }), gk: { them: [K_X, wy(s.g)] }, carrier: ourId(s.b) });
  S.restores++;
  for (let i = 0; i < n; i++) S.a(ourId(i)).face = [-1, 0];
  for (let k = 0; k < m; k++) S.a(theirId(k)).face = [1, 0];
  Object.assign(S.a('k2'), { face: [1, 0], gkm: null });
  const c = S.a(ourId(s.b)); Object.assign(S.ball, { x: c.x - .42, y: c.y, z: 0, state: 'carried', carrier: c.id, move: null, h: Math.PI, reach: null });
}

// ---------- what shows on the grass, and his choices ----------
// The marks for a board state; with `choices`, his moves too (at his move). Called only when the board changes.
function drawBoard(s, choices) {
  const bx = s.o[2 * s.b], by = s.o[2 * s.b + 1], ball = at3(bx, by), n = s.o.length >> 1, M = mid(pz), o = { cell: C, reach: [], lanes: [], shots: [], tethers: [], spots: [], friends: [], arrows: [], goal: [] };
  for (let k = 0; k < s.d.length; k += 2) o.reach.push(at3(s.d[k], s.d[k + 1]));
  o.reach.push({ x: wx(pz.W - .75), y: wy(s.g), w: C * 1.5, h: C * 3 }); // (the keeper's: the three places in front of him)
  o.area = { x0: wx(-.5), x1: wx(pz.W - .5), y0: wy(-.5), y1: wy(pz.H - .5) };
  pz.roles.forEach((j, k) => { const man = j >= 0 ? j : laneOf(j); if (man >= 0) o.tethers.push({ a: at3(s.d[2 * k], s.d[2 * k + 1]), b: at3(s.o[2 * man], s.o[2 * man + 1]) }); });
  for (const r of goalRows(pz)) o.goal.push({ ...goalAt(r), open: !covers(s, r), active: choices && inBox(pz, bx, by) });
  const box = { x0: wx(pz.W - BOX - .5), x1: wx(pz.W - .5), y0: wy(Math.max(-.5, M - BOX - .5)), y1: wy(Math.min(pz.H - .5, M + BOX + .5)), top: M - BOX > 0, bottom: M + BOX < pz.H - 1 };
  o.box = box;
  const glow = {};
  if (choices) {
    o.carrier = ball;
    for (let i = 0; i < n; i++) {
      if (i === s.b) continue;
      const f = at3(s.o[2 * i], s.o[2 * i + 1]), cut = cutBy(pz, s, bx, by, s.o[2 * i], s.o[2 * i + 1]);
      o.friends.push({ ...f, open: !cut });
      o.lanes.push({ a: ball, b: f, cut: cut ? at3(bx + (s.o[2 * i] - bx) * cut.t, by + (s.o[2 * i + 1] - by) * cut.t) : null });
      if (!cut) glow[ourId(i)] = .5;
      if (canRun(pz, s, i)) o.arrows.push({ a: { x: f.x + (wx(pz.runs[i][0]) - f.x) * .18, y: f.y + (wy(pz.runs[i][1]) - f.y) * .18 }, b: at3(pz.runs[i][0], pz.runs[i][1]) });
    }
    for (const [x, y] of nbrs(s)) o.spots.push(at3(x, y));
    if (inBox(pz, bx, by)) for (const r of goalRows(pz)) if (!covers(s, r) && !cutBy(pz, s, bx, by, pz.W, r)) o.shots.push({ a: ball, b: goalAt(r) });
  }
  stage.ui.glow = glow;
  marks.set(o);
}
// The free places next to the ball (where he can run with it).
function nbrs(s) {
  const out = [], bx = s.o[2 * s.b], by = s.o[2 * s.b + 1];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = bx + dx, y = by + dy; if ((!dx && !dy) || x < 0 || y < 0 || x >= pz.W || y >= pz.H || ourAt(s, x, y) >= 0 || theirAt(s, x, y) >= 0) continue;
    out.push([x, y]);
  }
  return out;
}
// Every move he can make now, with the points on the screen that pick it: the place's middle on the grass; a friend's
// feet and chest; a goal spot, and the goal mouth above it; a run arrow's head and middle. Worked out at a tap (the
// camera does not move during a puzzle).
function choices() {
  if (!board) return [];
  const s = board.s, bx = s.o[2 * s.b], by = s.o[2 * s.b + 1], out = [], n = s.o.length >> 1, P = (p, z = 0) => world.project(p.x, p.y, z);
  for (const [x, y] of nbrs(s)) out.push({ mv: `d${x},${y}`, pts: [P(at3(x, y))] });
  for (let i = 0; i < n; i++) if (i !== s.b) { const f = at3(s.o[2 * i], s.o[2 * i + 1]); out.push({ mv: 'p' + i, pts: [P(f), P(f, .8), P(f, 1.3)] }); }
  if (inBox(pz, bx, by)) for (const r of goalRows(pz)) out.push({ mv: 's' + r, pts: [P(goalAt(r)), P({ x: 0, y: wy(r) }, .9)] });
  for (let i = 0; i < n; i++) if (canRun(pz, s, i)) { const f = at3(s.o[2 * i], s.o[2 * i + 1]), t = at3(...pz.runs[i]); out.push({ mv: 'r' + i, pts: [P(t), P({ x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 })] }); }
  for (const c of out) c.pts = c.pts.filter(Boolean);
  return out;
}
// How far from a choice's point a tap still picks it: about half the space between two places on the screen (so the
// nearest one wins and no two overlap), 30 px at least, 80 at most.
function reach() {
  const a = world.project(wx(pz.W / 2), wy(mid(pz)), 0), b = world.project(wx(pz.W / 2 + 1), wy(mid(pz)), 0), c = world.project(wx(pz.W / 2), wy(mid(pz) + 1), 0);
  if (!a || !b || !c) return 50;
  return Math.max(30, Math.min(80, .62 * Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]))));
}
// The move a point on the screen means (or null: none near).
export function moveAt(x, y) {
  let best = null, bd = reach();
  for (const c of choices()) for (const q of c.pts) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = c.mv; } }
  return best;
}

// ---------- his taps ----------
// A tap near one of his choices plays it, whatever it is (a pass into a red player, a run beside one: the puzzle shows
// why it fails). A tap anywhere else does nothing to the puzzle: the choices pulse (a shot from outside the box: the box
// pulses too), so he sees where he can tap. Taps while a move plays are not his move: nothing happens.
let phase = 'off', tStart = 0, onEnd = null, hint = null, misses = 0;
function tapAt(x, y) {
  if (phase !== 'wait' || !board) return false;
  const mv = moveAt(x, y);
  if (!mv) { refuse(x, y); return false; }
  return tap(mv);
}
function tap(mv) {
  if (phase !== 'wait' || !board) return false;
  const r = board.tap(mv);
  if (r.res === 'refused') { refuse(); return false; }
  hint = null; hud.hand(null); phase = 'busy'; marks.hideChoices(); drawBalls(); tapAtT = now();
  act(mv, r).catch(e => { console.error(e); if (phase === 'busy' && board && !board.over) { phase = 'wait'; drawBoard(board.s, true); } }); // (a move that broke never leaves him stuck)
  return true;
}
function refuse(x, y) {
  misses++;
  const s = board.s, goalTap = x != null && pz && (() => { const q = world.project(0, cy, .9); return q && Math.abs(q[0] - x) < 90 && Math.abs(q[1] - y) < 90; })();
  marks.refuse(stage.ui.clock, goalTap && !inBox(pz, s.o[2 * s.b], s.o[2 * s.b + 1]));
}

// ---------- a move in motion ----------
// His move on the board as the players play it (r: Board.tap's result), then their answer. Shared by his play and the
// replay of the solution.
async function act(mv, r, replaying = false) {
  const m = parse(mv), lost = r.res === 'fail' && r.why !== 'out';
  if (m.k === 'p') { if (lost) return failCut(r); await pass(r); }
  else if (m.k === 'd') { if (lost) return failTackle(r); await dribble(r); }
  else if (m.k === 'r') await offBall(r);
  else { await shot(r); if (r.res === 'goal') return replaying ? null : done({ res: 'goal' }); return replaying ? null : failSay(r.why); }
  await answer(r.steps);
  if (replaying) return null;
  if (r.res === 'fail') { flashBalls(); await stage.wait(.4); return failSay('out'); }
  toWait();
  return null;
}
let tapAtT = 0; const moveMs = [];
function toWait() { if (phase === 'busy' && tapAtT) { moveMs.push(Math.round((now() - tapAtT) * 1000)); tapAtT = 0; } phase = 'wait'; drawBoard(board.s, true); }
// A pass: the passer turns to his friend and plays it along the grass; the friend takes it; the passer runs on.
async function pass(r) {
  const S = sim(), from = S.ball.carrier, to = ourId(board.s.b), a = S.a(from), t = S.a(to);
  faceTo(a, t.x, t.y); S.windup(from, 'pass'); await gwait(.17);
  S.kick(t.x, t.y, { speed: V.pass, arc: .05 });
  const runOn = r.runs.find(x => ourId(x[0]) === from); if (runOn) { const q = at3(...runOn[2]); S.go(from, q.x, q.y, V.step); }
  await until(() => S.ball.state !== 'flying', 2); S.give(to); // (the passer's run on goes on under their answer)
}
// His run with the ball to the place next to him.
async function dribble(r) {
  const S = sim(), [i, , to] = r.runs[0], id = ourId(i), q = at3(...to), a = S.a(id);
  S.go(id, q.x, q.y, V.dribble); await until(() => near(a, q, .3), 2.4); // (their answer starts as he gets there)
}
// A friend's run without the ball (two places, at a sprint).
async function offBall(r) {
  const S = sim(), [i, , to] = r.runs[0], id = ourId(i), q = at3(...to), a = S.a(id);
  S.go(id, q.x, q.y, V.run); await until(() => near(a, q, .4), 2);
}
// Their answer, after a beat: the keeper shuffles a spot, the red players step a place; all at once.
async function answer(steps) {
  await stage.wait(T.beat);
  const S = sim(), go = [];
  for (const [k, , to] of steps || []) {
    if (k === 'gk') { const q = { x: K_X, y: wy(to) }; S.go('k2', q.x, q.y, V.gk); go.push(['k2', q]); }
    else { const q = at3(...to); S.go(theirId(k), q.x, q.y, V.step); go.push([theirId(k), q]); }
  }
  await until(() => go.every(([id, q]) => near(S.a(id), q, .1)), 1.4);
  for (const [id] of go) S.stop(id);
}
// The shot: the keeper goes as it is struck: his hands on it at a spot he covers; beaten at the one he cannot reach.
async function shot(r) {
  const S = sim(), id = S.ball.carrier, a = S.a(id), row = r.to[1], g = goalAt(row), b = S.ball;
  faceTo(a, 0, g.y); S.windup(id, 'shot'); await gwait(.2);
  if (r.why === 'blocked' && r.cut) { // into a red player
    const q = at3(r.cut.x, r.cut.y), bid = theirId(r.cut.who); S.kick(q.x, q.y, { speed: V.shot * .8, arc: .1 }); await until(() => b.state !== 'flying', 2);
    S.windup(bid, 'touch'); S.give(bid); marks.bad({ ...q, z: 1.9 }); return;
  }
  const save = r.why === 'saved', z = save ? .55 : .45, hx = save ? Math.max(.4, S.a('k2').x + .3) : GOAL_X - .1, tLine = Math.hypot(a.x - hx, a.y - g.y) / V.shot;
  S.kick(hx, g.y, { speed: V.shot, arc: .12, z1: z });
  dive(save, g.y, z, tLine);
  await until(() => b.state !== 'flying', 2);
  if (save) { Object.assign(b, { state: 'held', carrier: 'k2', move: null }); world.fx('held'); const k = S.a('k2'); marks.bad({ x: k.x, y: k.y, z: 2 }); }
  else { world.fx('goal'); sfx('net'); }
}
function dive(save, y, z, tLine) {
  const S = sim(), K = S.a('k2'), dy = y - K.y, side = Math.sign(dy) || 1;
  const hand = save ? { x: Math.max(.35, K.x + .2), y, z } : { x: K_X + .15, y: K.y + side * Math.min(Math.abs(dy) * .55, 1.2), z: Math.min(z + .2, 1.1) };
  const reachIt = Math.abs(hand.y - K.y) < .9, d = Math.hypot(hand.x - K.x, hand.y - K.y) || .01, mv = reachIt ? Math.max(0, d - .55) : Math.max(Math.min(d, .3), d - .95);
  const body = { x: K.x + (hand.x - K.x) / d * mv, y: K.y + (hand.y - K.y) / d * mv }, go = .03, dur = Math.max(.2, tLine - go);
  K.gkm = { k: reachIt ? 'reach' : 'dive', guess: false, pre: .1, t0: S.time + go, dur, side, hand: { x: hand.x, y: hand.y }, hz: hand.z, low: hand.z < .8, high: !reachIt && hand.z > .9, save, keep: save, body, spd: Math.max(1, d / dur) };
  S.stop('k2');
}
// Cut out: the pass goes to the red player in the lane; he takes it.
async function failCut(r) {
  const S = sim(), from = S.ball.carrier, a = S.a(from), c = r.cut, q = at3(c.x, c.y), cid = theirId(c.who), t = at3(...r.to);
  faceTo(a, t.x, t.y); S.windup(from, 'pass'); await gwait(.2);
  S.kick(q.x, q.y, { speed: V.pass * .85, arc: .05 }); await until(() => S.ball.state !== 'flying', 2);
  S.windup(cid, 'touch'); S.give(cid); marks.bad({ ...q, z: 1.9 });
  return failSay('cut');
}
// Tackled: he runs to the place; the red player (or the keeper) next to it comes in and takes the ball.
async function failTackle(r) {
  const S = sim(), cid = S.ball.carrier, a = S.a(cid), q = at3(...r.to), who = r.by || [pz.W, board.s.g];
  const k = who[0] >= pz.W ? -1 : theirAt(board.s, who[0], who[1]), tid = k >= 0 ? theirId(k) : 'k2', t = S.a(tid);
  S.go(cid, q.x, q.y, V.dribble); await until(() => near(a, q, .9), 1.6);
  S.go(tid, S.ball.x, S.ball.y, 5); S.windup(tid, 'touch');
  await until(() => near(t, S.ball, .6), 1); S.stop(cid); S.stop(tid);
  if (tid === 'k2') Object.assign(S.ball, { state: 'held', carrier: 'k2', move: null }); else S.give(tid);
  marks.bad({ x: t.x, y: t.y, z: 1.9 }); world.fx('stolen');
  return failSay('tackle');
}
// He sees why for a moment, then the life goes (run.js) and the solution plays.
async function failSay(why) { sfx('aww'); stage.say(PZ_WHY[why]); words(PZ_WHY[why]); phase = 'busy'; await stage.wait(T.why); return done({ res: 'fail', why }); }
function done(x) { phase = 'over'; if (x.res === 'goal') marks.hide(); else marks.hideChoices(); const f = onEnd; onEnd = null; f?.(x); }
// The words for a grown-up (top right; one text node, changed in place).
let wordsNow = ' ';
function words(t) { const v = t || ' '; if (v !== wordsNow) { wordsNow = v; whyText.data = v; layer.classList.toggle('worded', !!t); } }

// ---------- each frame ----------
let sandQ = -1;
function frame() {
  if (!pz || !marks) return;
  marks.frame(stage.ui.clock);
  if (pz.sec && phase === 'wait') {
    const left = Math.max(0, 1 - (now() - tStart) / pz.sec), q = Math.ceil(left * 40) / 40; // (written 40 times a puzzle at most)
    if (q !== sandQ) { sandQ = q; sandFill.style.transform = `scaleY(${q})`; }
    if (left <= 0 && board.timeUp()) { phase = 'busy'; marks.hideChoices(); failSay('time'); }
  }
  if (hint && phase === 'wait' && now() - tStart > hint.after && !hint.on) { hint.on = true; const c = choices().find(x => x.mv === hint.mv), q = c?.pts[c.pts.length > 1 && hint.mv[0] === 'p' ? 1 : 0]; if (q) hud.hand([q[0], q[1]], 1); }
  if (gen.it && phase === 'wait') stepGen(); // (only while he thinks: a long step there shows nothing)
}
function drawBalls() { const n = pz.moves; [...ballsEl.children].forEach((el, i) => { const off = i >= n, gone = !off && i >= board.left; if (el._off !== off) { el._off = off; el.classList.toggle('off', off); } if (el._gone !== gone) { el._gone = gone; el.classList.toggle('gone', gone); } }); }
let flashAlt = false; function flashBalls() { flashAlt = !flashAlt; ballsEl.classList.remove(flashAlt ? 'flash' : 'flash2'); ballsEl.classList.add(flashAlt ? 'flash2' : 'flash'); } // (two names for one animation: it starts again without a layout read)

// ---------- one puzzle ----------
function showPuzzle(p) {
  pz = p; board = new Board(p); cy = PITCH.W / 2; words(''); hud.hand(null);
  placeAll(board.s); stage.cam = fitCam(p); marks.path(null); marks.bad(null); drawBoard(board.s, false); drawBalls();
  sandEl.classList.toggle('hidden', !p.sec); sandQ = -1; sandFill.style.transform = 'scaleY(1)';
  tStart = now(); misses = 0;
}
// Plays one puzzle. Resolves { res: 'goal' | 'fail', why }.
function playOne(p, { hintMv = null, after = T.hint } = {}) {
  showPuzzle(p); toWait();
  hint = hintMv ? { after, mv: hintMv, on: false } : null;
  return new Promise(res => { onEnd = res; });
}
// The shortest solution plays itself once (after a failed puzzle), its ball path in gold on the grass.
async function replay(p) {
  phase = 'replay'; hud.hand(null);
  const line = PZ_IDEA[p.idea] || PZ_SAID.watch; words('✨ ' + line); stage.say(line);
  await stage.wait(.5); marks.bad(null);
  const b = new Board(p); board = b; placeAll(b.s); drawBoard(b.s, false);
  await stage.wait(.35);
  const segs = [];
  for (const mv of p.best) {
    const s = b.s, from = at3(s.o[2 * s.b], s.o[2 * s.b + 1]), r = b.tap(mv), m = parse(mv);
    if (m.k === 'r') segs.push({ a: at3(s.o[2 * m.i], s.o[2 * m.i + 1]), b: at3(...r.to) }); // (a friend's run: his way, in gold too)
    else segs.push({ a: from, b: m.k === 's' ? goalAt(m.i) : at3(...r.to) });
    marks.path(segs);
    await act(mv, r, true);
    if (r.res === 'goal') break;
    if (r.res !== 'ok') { console.error('puzzle replay: the solution did not score', p.seed, p.level); break; }
    drawBoard(b.s, false);
  }
  await stage.wait(T.replayEnd); words(''); marks.path(null);
}

// ---------- the next puzzle, made between frames ----------
// While he thinks, the next puzzle is made a little at a time (a few ms a frame): one for the level after a solve and
// one for the level after a miss, so it is ready whichever way this one ends.
const gen = { it: null, jobs: [] };
function prepare(run, seeds) {
  gen.jobs = [run.score + 1, run.score].map(at => { const seed = seeds(); return { at, seed, it: puzzleSteps(at * STEP, seed), out: null }; });
  gen.it = true;
}
function stepGen(budget = 4) {
  const t0 = performance.now();
  for (const j of gen.jobs) while (!j.out && performance.now() - t0 < budget) { const r = j.it.next(); if (r.done) j.out = r.value; }
  if (gen.jobs.every(j => j.out)) gen.it = null;
}
function nextFor(at) {
  const j = gen.jobs.find(x => x.at === at); gen.it = null; if (!j) return null;
  while (!j.out) { const r = j.it.next(); if (r.done) j.out = r.value; }
  return j.out;
}

// ---------- a run ----------
// The teaching hand: on his very first puzzle, and in a run while a friend's run or a lane defender is new to him (until
// he has solved one), it points at the first move of the solution after a few seconds.
let busy = false;
export async function runPuzzles() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper();
  try {
    const first = !P.mini?.puzzles?.plays, r = rng(Math.floor(Math.random() * 2 ** 31)), seeds = () => Math.floor(r() * 2 ** 31);
    const us = teamById(P.us), them = teamById(P.them);
    game.setTeams(us, them); game.mode = 'puzzles'; world.setEnv('crowd');
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'puzzles' }); hud.dots([], 0);
    build(); dress(us, them); sizeGoal(true);
    const run = startRun('puzzles');
    let p = forced() || makePuzzle(run.level, seeds());
    onStage(stage); stage.on = true; layer.classList.remove('hidden'); phase = 'busy';
    showPuzzle(p); marks.warm(); show(null);
    if (first) await card({ emoji: '🧩', title: PZ_SAID.intro, sub: 'Tap a friend to pass, a ring to run, the goal to shoot. A keeper standing still saves everything: make him move!', button: 'Play' });
    const taught = new Set(); // (the new situations he has solved in this run: the hand points until he has)
    for (let i = 0; ; i++) {
      const at = run.score; prepare(run, seeds);
      const lane = p.roles.some(x => x <= -2), isNew = (!!p.runs && !taught.has('run')) || (lane && !taught.has('lane'));
      const x = await playOne(p, { hintMv: (first && i === 0) || isNew ? p.best[0] : null, after: isNew ? T.hintNew : T.hint }), ok = x.res === 'goal';
      if (ok) { if (p.runs) taught.add('run'); if (lane) taught.add('lane'); }
      if (ok) { hud.banner('GOAL!', 'goal'); stage.say(PZ_SAID.goal); }
      const goOn = runStep(run, ok, { at, seed: p.seed, idea: p.idea, ideas: p.ideas.join('+'), sit: p.sit, len: p.len, moves: p.moves, taps: board.taps.join(' '), res: ok ? 'goal' : x.why, miss: misses, sec: Math.round((now() - tStart) * 10) / 10 });
      if (ok) await stage.wait(T.goal); else await replay(p);
      if (!goOn) break;
      p = forced() || nextFor(run.score) || makePuzzle(run.level, seeds());
    }
    end(); endRun(run, { again: runPuzzles });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() {
  stage.on = false; phase = 'off'; pz = null; board = null; gen.it = null; gen.jobs = []; onEnd = null; hint = null;
  hud.hand(null); words(''); marks?.hide(); layer?.classList.add('hidden'); layer?.classList.remove('held'); stage.ui.glow = {};
  onStage(null); undress(); sizeGoal(false); game.home();
}
addEventListener('resize', () => { if (pz && stage.on) { world.measure(); stage.cam = fitCam(pz); } });

// For the review tools and the browser checks (read only, apart from `force`, `view` and `speed`): what is on the board,
// the moves he can make with their points on the screen, the move a screen point means, `force` ({ level, seed, sec }:
// the next puzzle shown is that one), `view` ('side' | 'top': the camera) and `speed` (the game's clock, for the bots).
// The smallest gap on the screen between two neighbouring places (px): a tap target's size.
function cellPx() {
  let m = 1e9; if (!pz) return 0;
  for (let x = 0; x < pz.W; x++) for (let y = 0; y < pz.H; y++) { const a = world.project(wx(x), wy(y), 0); for (const [dx, dy] of [[1, 0], [0, 1]]) { if (x + dx >= pz.W || y + dy >= pz.H) continue; const b = world.project(wx(x + dx), wy(y + dy), 0); if (a && b) m = Math.min(m, Math.hypot(b[0] - a[0], b[1] - a[1])); } }
  return m;
}
const dev = { force: null, stage, cellPx, moveMs, get hint() { return hint?.on ? hint.mv : null; }, get phase() { return phase; }, get pz() { return pz; }, get board() { return board; }, choices, moveAt, reach, fitCam,
  get view() { return VIEW; }, set view(v) { if (VIEWS[v]) { VIEW = v; if (pz) stage.cam = fitCam(pz); } }, get speed() { return stage.speed; }, set speed(v) { stage.speed = v; },
  // (a picture of a high level) a puzzle shown after k moves of its solution, nothing else changed
  preview(level, seed, k = 0) { const p = makePuzzle(level, seed); showPuzzle(p); for (const mv of p.best.slice(0, k)) board.tap(mv); placeAll(board.s); toWait(); return p.best.length; } };
function forced() { const f = dev.force; if (!f) return null; dev.force = null; const p = makePuzzle(f.level, f.seed ?? 1); if (f.sec != null) p.sec = f.sec; return p; }
if (typeof window !== 'undefined') window.__pz = dev;
