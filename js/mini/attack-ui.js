// Score attack on the page (v88): a mini game (mini/chooser.js). Each attempt is played by the Fast controller itself
// (js/fast/fast.js: his taps on the fixed spots (v93), the hold to slow and the drag to look, the action button with
// SHOOT and the SKILL names, the chips,
// the camera from behind his player, the pause), on an attempt's own match (mini/attack.js AttackMatch) in place of the
// Fast match. This file sets each attempt up, draws the timer (the world's own draining ring round his feet), shows the
// picture cue after a miss (a gold ring under the friend who was free and a gold line to him, or a line toward the goal
// when the way was clear), and runs the attempts with two lives (mini/run.js).
// The controller is started as for a match (fast.play), then given this match.
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById, keeperKit } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { stream, EDGE as SHOT_EDGE } from '../shot.js';
import { sfx } from '../sound.js';
import { PITCH } from '../geom.js';
import { later } from '../pause.js';
import { fast } from '../fast/fast.js';
import { project } from '../fast/rules.js';
import { AttackMatch, attackScene, cueMove } from './attack.js';
import { startRun, runStep, endRun, runOff } from './run.js';
import { miniById } from './games.js';

const AFTER_GOAL = 1700, AFTER_MISS = 1900; // ms (held while paused) the end of an attempt stays before the next
const wait = ms => new Promise(r => later(r, ms));

// ---------- bodies the world does not have at this size ----------
// 3 v 3 has three of theirs and no keepers, 4 v 4 four and no keepers: a fourth of theirs and their keeper are made
// here (kept for the next run) and put back after.
const made = new Map(); let added = [];
function dress(us, them) {
  added = [];
  const want = [['o4', () => makeRig(them.players[3], them.kit, false)], ['k2', () => { const p = them.players.find(q => q.gk) || them.players[4]; const g = makeRig({ ...p, gk: true }, keeperKit(them, us), false); g.userData.gk = true; return g; }]];
  for (const [id, mk] of want) {
    if (world.rigs.get(id)) continue;
    const key = id + JSON.stringify([them.id, us.id]); let g = made.get(key); if (!g) { g = mk(); made.set(key, g); }
    world.scene.add(g); world.rigs.set(id, g); added.push(g);
  }
}
function undress() { for (const g of added) world.scene.remove(g); added = []; world.resetRigs(); }

// ---------- the cue after a miss (in the 3D scene: made once) ----------
let ring = null;
function cueRing() {
  if (ring) return ring;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 10, 64, 64, 64); rg.addColorStop(0, 'rgba(255,220,90,.55)'); rg.addColorStop(.7, 'rgba(255,210,63,.25)'); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  g.lineWidth = 9; g.strokeStyle = '#ffd23f'; g.beginPath(); g.arc(64, 64, 44, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  ring = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  ring.renderOrder = 4; ring.visible = false; world.scene.add(ring); return ring;
}
// What would have worked (attack.js cueMove): the free friend, or the way to goal.
function showCue(m) {
  const s = m.sim, h = s.a(m.me), a = cueMove(m); if (!h || !a) return null;
  const f = a.kind === 'pass' && s.a(a.id);
  if (f) { const r = cueRing(); r.position.set(f.x, f.y, .03); r.visible = true; fast.ui.lines = [{ a: { x: h.x, y: h.y }, b: { x: f.x, y: f.y }, color: '#ffd23f' }]; return 'friend'; }
  if (a.kind === 'go' || a.kind === 'shoot') { const gx = m.L - .8, gy = m.W / 2, d = Math.hypot(gx - h.x, gy - h.y), k = Math.min(1, 6 / d); fast.ui.lines = [{ a: { x: h.x, y: h.y }, b: { x: h.x + (gx - h.x) * k, y: h.y + (gy - h.y) * k }, color: '#ffd23f' }]; return a.kind; }
  return null;
}
function hideCue() { if (ring) ring.visible = false; fast.ui.lines = null; }

// ---------- the start of an attempt: the goal and their keeper in sight, no confetti left ----------
// The Fast camera fills the picture with the pitch, which can put their goal just over the top edge as an attempt
// starts. For the first START_S real s the camera is tipped up (its target raised, a step at a time) until the bar's
// two ends and the keeper's head are KEEP_PX px inside the top, as long as his own feet stay on screen; over the next
// FADE_S s the tip goes, and the Fast camera eases back to its own view. (fast.camNow is wrapped on the instance while
// a run plays: js/fast is not changed.) The tip is kept apart from Fast's own camera (v89 integration): taken off
// before Fast eases its camera and put back after (raised at once, lowered eased), so the two never fight (before, Fast's easing pulled
// the raised target down every frame and the tip pushed it up again: the view shook up and down a little).
const START_S = 1.6, FADE_S = .8, KEEP_PX = 20, STEP_Z = .12, TIP_RATE = 8, YAW_STEP = .05;
const baseCam = Object.getPrototypeOf(fast).camNow;
function camNow(snap, dt) {
  const c = this.cam; c.tgt[2] -= this.tipZ || 0; turn(c, -(this.tipYaw || 0)); // (Fast eases its own camera, without the tip and the turn)
  baseCam.call(this, snap, dt);
  const m = this.m, t = this.real || 0, h = m?.sim?.a(m.me);
  // (v89 integration) also while he has the ball within shooting distance (a shot is possible): the goal kept in view
  const shotNow = !!h && m.owner?.() === m.me && Math.hypot(m.L - h.x, m.W / 2 - h.y) <= SHOT_EDGE + 1;
  const k = shotNow ? 1 : t < START_S ? 1 : 1 - (t - START_S) / FADE_S;
  let want = 0, wantYaw = 0;
  if (k > 0 && m?.sim && !this.aiming && h) {
    const W = world.width || 932, H = world.height || 430, kp = m.sim.a('k2');
    const pts = [{ x: m.L, y: m.gy0, z: m.gh }, { x: m.L, y: m.gy1, z: m.gh }, ...(kp ? [{ x: kp.x, y: kp.y, z: 1.8 }] : [])];
    const feet = cam => { const f = project(cam, { x: h.x, y: h.y, z: 0 }, W, H); return !!f && f[1] <= H - 12 && f[0] > 12 && f[0] < W - 12; };
    const tip = { ...c, eye: [...c.eye], tgt: [...c.tgt] };
    // across: the posts inside the picture (turned toward the goal a step at a time, his feet still on screen)
    const side = cam => { const xs = [m.gy0, m.gy1].map(y => project(cam, { x: m.L, y, z: m.gh / 2 }, W, H)); if (xs.some(q => !q)) return 0; const lo = Math.min(...xs.map(q => q[0])), hi = Math.max(...xs.map(q => q[0])); return lo < W * .06 ? -1 : hi > W * .94 ? 1 : 0; };
    let da = 0; for (let i = 0; i < 12; i++) { const sd = side(tip); if (!sd) break; const step = sd * -YAW_STEP; turn(tip, step); if (!feet(tip)) { turn(tip, -step); break; } da += step; }
    // up: the bar's two ends and the keeper's head KEEP_PX px inside the top
    const top = cam => Math.min(...pts.map(p => project(cam, p, W, H)?.[1] ?? -1e9));
    let dz = 0; for (let i = 0; i < 24 && top(tip) < KEEP_PX; i++) { tip.tgt[2] += STEP_Z; if (!feet(tip)) { tip.tgt[2] -= STEP_Z; break; } dz += STEP_Z; }
    want = dz * k; wantYaw = da * k;
  }
  const ease = (was, w) => (snap || Math.abs(w) >= Math.abs(was) && Math.sign(w || 1) === Math.sign(was || w || 1) ? w : was + (w - was) * (1 - Math.exp(-(dt || 0) * TIP_RATE))); // (toward it at once, so the goal never slips out; back eased)
  this.tipZ = ease(this.tipZ || 0, want); const y0 = this.tipYaw || 0, lim = 2.4 * (dt || 0); this.tipYaw = snap ? wantYaw : y0 + Math.max(-lim, Math.min(lim, ease(y0, wantYaw) - y0)); // (the turn: never faster than 2.4 rad/s)
  turn(c, this.tipYaw); c.tgt[2] += this.tipZ;
}
// The camera's target turned `a` rad about its eye (across the pitch).
function turn(c, a) { if (!a) return; const dx = c.tgt[0] - c.eye[0], dy = c.tgt[1] - c.eye[1], co = Math.cos(a), si = Math.sin(a); c.tgt[0] = c.eye[0] + dx * co - dy * si; c.tgt[1] = c.eye[1] + dx * si + dy * co; }
// Confetti from the last goal is cleared as the next attempt starts (a new scene: it would fall on it).
function clearFx() {
  const P = world.particles; if (!P?.live) return;
  for (let i = 0; i < P.list.length; i++) if (P.list[i].life) { P.list[i].life = 0; P.mesh.setMatrixAt(i, P.zero); }
  P.live = 0; P.mesh.instanceMatrix.needsUpdate = true;
}

// ---------- one attempt ----------
// Starts the Fast controller as for a match (its own state all fresh), then gives it this attempt's match. Resolves
// the attempt's result (attack.js AttackMatch end) once it has been shown.
function attempt(sc, us, them) {
  return new Promise(done => {
    let res = null;
    clearFx(); fast.me = 'hero';
    const pl = game.plog; game.plog = (k, o) => (k === 'fast' && o?.is === 'start' ? undefined : pl?.(k, o)); // (not a Fast match: its start is not logged)
    try { fast.play({ us, them, warm: 'attack', noE: true }); } finally { game.plog = pl; } // (v96 noE: Score attack plays variant E as A; B, C, D as picked)
    const m = new AttackMatch({ sim: fast.sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, scene: sc, fx: ev => world.fx(ev), sfx: n => sfx(n),
      real: () => fast.real, pace: () => (fast.aiming ? .3 : fast.holding ? .5 : 1), // (the timer drains slower while he holds to look, slower still while he aims)
      frame: x => { fast.ui.timer = x.res ? null : { left: x.left / x.total, wide: false, scale: 1.35 }; },
      onEnd: r => { res = r; shown(); } });
    m.me = m.favor = 'hero';
    m.on = { ...fast.m.on, lost: () => {}, out: () => {}, goal: team => { if (team !== 'us') return; hud.banner('GOAL!', 'goal'); sfx('goal'); say(m.lastOwner === m.me ? 'Great choice!' : 'Great pass!'); } };
    fast.m = m; m.setup();
    fast.sudden = true; // (no "next goal wins": an attempt is short)
    fast.yaw = fast.natural(); fast.camNow(1); fast.calm = false; hud.hideScore();
    game.plog?.('attack', { is: 'try', n: sc.n, kind: sc.kind, style: sc.style, challenge: sc.challenge ? 1 : 0, level: Math.round(sc.level * 100) / 100, time: Math.round(sc.D.time) });
    // the end: shown, then resolved
    const shown = async () => {
      if (!res.goal) { const cue = showCue(m); res.cue = cue; sfx('aww'); game.plog?.('attack', { is: 'miss', why: res.why, cue, advice: m.advice?.kind || null }); await wait(AFTER_MISS); hideCue(); }
      else await wait(AFTER_GOAL);
      done(res);
    };
  });
}

// ---------- a run ----------
let busy = false;
// opts.plan (the review tools: pictures of chosen situations): [{ kind, style, level }], played in turn.
export async function runAttack(opts) {
  if (busy) return; busy = true; unlockSpeech();
  const plan = Array.isArray(opts?.plan) ? opts.plan : null;
  try {
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.attack?.plays, r = stream(Math.random()), kinds = [], ctx = { lost: false, challenge: false };
    game.setTeams(us, them); world.setEnv('crowd'); hud.caption(''); hud.dots?.([], 0);
    dress(us, them); hudEl.classList.add('fattack'); fast.camNow = camNow;
    const run = startRun('attack');
    show(null);
    if (first && !plan) await card({ emoji: '⚽', title: miniById('attack').say, sub: 'Draw the defender, then pass to the free friend. Nobody in front? Go and shoot!', button: 'Play' });
    while (!run.over) {
      const sc = plan ? planned(plan[run.n % plan.length], r, run.n) : attackScene(run.level, r, run.n, kinds, ctx); kinds.push(sc.kind);
      const res = await attempt(sc, us, them); ctx.lost = !res.goal; ctx.challenge = !!sc.challenge;
      runStep(run, res.goal, { kind: sc.kind, style: sc.style, challenge: sc.challenge ? 1 : 0, why: res.why, sec: res.sec, by: res.by, cue: res.cue || null });
    }
    end();
    endRun(run, { again: runAttack });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function planned(p, r, n) { let sc = null; for (let i = 0; i < 400; i++) { sc = attackScene(p.level ?? 0, r, 1 + i, []); if (sc.kind === p.kind && (!p.style || sc.style === p.style)) break; } sc.n = n; return sc; }
function end() { hideCue(); fast.ui.timer = null; delete fast.camNow; fast.cam.tgt[2] -= fast.tipZ || 0; turn(fast.cam, -(fast.tipYaw || 0)); fast.tipZ = fast.tipYaw = 0; fast.stop(); undress(); hudEl.classList.remove('fattack'); game.home(); }
if (typeof window !== 'undefined') window.__attack = { runAttack, fast };
