// Score attack on the page (v88): a mini game (mini/chooser.js). Each attempt is played by the Fast controller itself
// (js/fast/fast.js: his taps, the hold to slow and the drag to look, the action button with SHOOT and SKILL, the chips,
// the camera from behind his player, the pause), on an attempt's own match (mini/attack.js AttackMatch) in place of the
// Fast match. This file sets each attempt up, draws the timer (the world's own draining ring round his feet), shows the
// picture cue after a miss (a gold ring under the friend who was free and a gold line to him, or a line toward the goal
// when the way was clear), and runs the attempts with two lives (mini/run.js).
// Nothing in js/fast is changed: the controller is started as for a match (fast.play), then given this match.
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById, keeperKit } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { stream } from '../shot.js';
import { sfx } from '../sound.js';
import { PITCH } from '../geom.js';
import { later } from '../pause.js';
import { fast } from '../fast/fast.js';
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

// ---------- one attempt ----------
// Starts the Fast controller as for a match (its own state all fresh), then gives it this attempt's match. Resolves
// the attempt's result (attack.js AttackMatch end) once it has been shown.
function attempt(sc, us, them) {
  return new Promise(done => {
    let res = null;
    fast.me = 'hero';
    const pl = game.plog; game.plog = (k, o) => (k === 'fast' && o?.is === 'start' ? undefined : pl?.(k, o)); // (not a Fast match: its start is not logged)
    try { fast.play({ us, them }); } finally { game.plog = pl; }
    const m = new AttackMatch({ sim: fast.sim, L: PITCH.L, W: PITCH.W, gy0: PITCH.gy0, gy1: PITCH.gy1, gh: PITCH.gh, scene: sc, fx: ev => world.fx(ev), sfx: n => sfx(n),
      real: () => fast.real, pace: () => (fast.aiming ? .3 : fast.holding ? .5 : 1), // (the timer drains slower while he holds to look, slower still while he aims)
      frame: x => { fast.ui.timer = x.res ? null : { left: x.left / x.total, wide: false, scale: 1.35 }; },
      onEnd: r => { res = r; shown(); } });
    m.me = m.favor = 'hero';
    m.on = { ...fast.m.on, lost: () => {}, out: () => {}, goal: team => { if (team !== 'us') return; hud.banner('GOAL!', 'goal'); sfx('goal'); say(m.lastOwner === m.me ? 'Great choice!' : 'Great pass!'); } };
    fast.m = m; m.setup();
    fast.sudden = true; // (no "next goal wins": an attempt is short)
    fast.yaw = fast.natural(); fast.camNow(1); fast.calm = false; hud.hideScore();
    game.plog?.('attack', { is: 'try', n: sc.n, kind: sc.kind, style: sc.style, level: Math.round(sc.level * 100) / 100, time: Math.round(sc.D.time) });
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
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.attack?.plays, r = stream(Math.random()), kinds = [];
    game.setTeams(us, them); world.setEnv('crowd'); hud.caption(''); hud.dots?.([], 0);
    dress(us, them); hudEl.classList.add('fattack');
    const run = startRun('attack');
    show(null);
    if (first && !plan) await card({ emoji: '⚽', title: miniById('attack').say, sub: 'Draw the defender, then pass to the free friend. Nobody in front? Go and shoot!', button: 'Play' });
    while (!run.over) {
      const sc = plan ? planned(plan[run.n % plan.length], r, run.n) : attackScene(run.level, r, run.n, kinds); kinds.push(sc.kind);
      const res = await attempt(sc, us, them);
      runStep(run, res.goal, { kind: sc.kind, style: sc.style, why: res.why, sec: res.sec, by: res.by, cue: res.cue || null });
    }
    end();
    endRun(run, { again: runAttack });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function planned(p, r, n) { let sc = null; for (let i = 0; i < 400; i++) { sc = attackScene(p.level ?? 0, r, 1 + i, []); if (sc.kind === p.kind && (!p.style || sc.style === p.style)) break; } sc.n = n; return sc; }
function end() { hideCue(); fast.ui.timer = null; fast.stop(); undress(); hudEl.classList.remove('fattack'); game.home(); }
if (typeof window !== 'undefined') window.__attack = { runAttack, fast };
