// Dribble dash on the page (v96): a mini game (mini/chooser.js). mini/dash.js plays it (who stands where, what each tap
// does, when a defender wins the ball); this puts it in the night stadium on the game's own sim (js/sim.js: his dribble,
// the ball, the bodies' movement), draws the choices on the grass (fat gold arrows; a gold ring under a free friend),
// takes his taps (ui/goalie.js hands the stage a touch as the finger goes down), keeps the camera behind and above him
// looking up the pitch, and runs it with two lives (mini/run.js).
// Made before play (behind the start card): every body, every arrow and ring, the change-of-picture layer. In play only
// positions, visibility and opacity change in the 3D scene, and the page sees class changes only.
import * as THREE from 'three';
import { P } from '../ui/store.js';
import { hud, hudEl } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { teamById } from '../teams.js';
import { makeRig } from '../pro/rig.js';
import { PITCH } from '../geom.js';
import { sfx } from '../sound.js';
import { onStage } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { Sim } from '../sim.js';
import { Dash, DASH_SAID, TACKLE_S } from './dash.js';
import { startRun, runStep, endRun, runOff } from './run.js';

const ID = 'dash', SLOTS = ['o1', 'o2', 'o3', 'o4', 'm2', 'm3'];
const PAD_BACK = 2.6, PAD_LEN = 3, PAD_W = 1.9, SHOW_PAST = 1.4; // an arrow lies PAD_BACK m in front of its line, PAD_LEN long, PAD_W wide; after a tackle the way that was open shows SHOW_PAST m past the line
const CAM = { back: 7.5, up: 4.2, ahead: 7.5, follow: .55, Ff: 1.75, Fw: .8, outBack: 3, outUp: 1.6 }; // (out: drawn back and up while a tackle shows, so the tackle, the ball and the way that was open are all in sight) // behind and above him, looking up the pitch
const plog = o => { try { game.plog?.('dash', o); } catch { /* the log is never in the way */ } };

// ---------- the stage (what main.js runs and draws) ----------
let d = null, run = null, sim = null;
export const stage = {
  on: false, kind: 'dash', cam: { eye: [0, 10, 3], tgt: [10, 10, 0], Ff: CAM.Ff, Fw: CAM.Fw }, ui: { glow: {}, clock: 0 }, sim: null, phase: 'idle',
  tick(dt) { if (this.on && d && dt) step(dt); },
  tapAt(x, y) { tap(x, y); },
};

// ---------- made once: the arrows, the rings, the change-of-picture layer ----------
let pads = null, ring = null, warn = null, wipeEl = null;
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
// A fat arrow pointing up the pitch (+x in the texture): ink edge, white edge, gold fill (lit: brighter, a glow).
const arrowTex = lit => canvasTex(256, 160, (g, w, h) => {
  const c = h / 2, path = () => { g.beginPath(); g.moveTo(12, c - 30); g.lineTo(w - 96, c - 30); g.lineTo(w - 96, c - 66); g.lineTo(w - 12, c); g.lineTo(w - 96, c + 66); g.lineTo(w - 96, c + 30); g.lineTo(12, c + 30); g.closePath(); };
  g.lineJoin = 'round';
  if (lit) { g.shadowColor = 'rgba(255,214,70,.95)'; g.shadowBlur = 18; }
  path(); g.lineWidth = 16; g.strokeStyle = 'rgba(36,25,58,.7)'; g.stroke(); g.shadowBlur = 0;
  g.lineWidth = 9; g.strokeStyle = '#ffffff'; g.stroke();
  const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, lit ? 'rgba(255,224,90,.9)' : 'rgba(255,207,46,.55)'); lg.addColorStop(1, lit ? '#ffe45c' : '#ffcf2e'); g.fillStyle = lg; g.fill();
});
const ringTex = (col, glow) => canvasTex(128, 128, (g, w) => {
  const c = w / 2, rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, glow(.5)); rg.addColorStop(.7, glow(.2)); rg.addColorStop(1, glow(0)); g.fillStyle = rg; g.fillRect(0, 0, w, w);
  for (const [lw, s] of [[16, 'rgba(36,25,58,.55)'], [11, '#ffffff'], [7, col]]) { g.lineWidth = lw; g.strokeStyle = s; g.beginPath(); g.arc(c, c, 46, 0, 7); g.stroke(); }
});
// (In pieces, a frame apart, while the chooser still shows: no one frame does it all.)
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
async function build() {
  if (pads) return;
  const geo = new THREE.PlaneGeometry(1, 1), T = { idle: arrowTex(false) }; await nextFrame(); T.lit = arrowTex(true); await nextFrame();
  const mk = (map, order) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })); m.renderOrder = order; m.visible = false; world.scene.add(m); return m; };
  pads = Array.from({ length: 6 }, () => ({ idle: mk(T.idle, 3), lit: mk(T.lit, 4), key: '' }));
  ring = mk(ringTex('#ffcf2e', a => `rgba(255,214,70,${a})`), 3); ring.scale.setScalar(2.4);
  warn = mk(ringTex('#ff5a3c', a => `rgba(255,80,60,${a})`), 3); warn.scale.setScalar(2.2);
  wipeEl = document.createElement('div'); wipeEl.id = 'dashWipe'; wipeEl.setAttribute('aria-hidden', 'true'); hudEl.prepend(wipeEl); // (under the HUD's own buttons and words)
}
const allMeshes = () => [...pads.flatMap(p => [p.idle, p.lit]), ring, warn];

// ---------- the bodies ----------
// His team's player (hero) and a friend (m1); theirs in six places: o1 to o4, and m2, m3 dressed in their kit (the
// sim's own ids, so the 3D world draws them: world.js IDS). Made once per pair of teams, kept for the next run.
const made = new Map(), swapped = [];
const rigKey = (id, them) => id + JSON.stringify([them.id, them.kit]);
const needed = () => SLOTS.filter(id => !(id.startsWith('o') && world.rigs.get(id)));
function rigFor(id, them) { const key = rigKey(id, them); let g = made.get(key); if (!g) { g = makeRig(them.players[SLOTS.indexOf(id) % them.players.length] || them.players[0], them.kit, false); made.set(key, g); } return g; }
// (A body takes 10 to 50 ms to make on a phone: the ones the game will need are made while the home screen idles, one
// at a time, so the start of a game does not wait for them. A change of team makes them again at the start.)
function premake() {
  if (typeof window === 'undefined') return;
  const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 200));
  const next = () => { try { if (busy || !world.rigs.get('o1')) return; const them = teamById(P.them), id = needed().find(i => !made.has(rigKey(i, them))); if (id) { rigFor(id, them); idle(next); } } catch { /* made at the start instead */ } };
  setTimeout(() => idle(next), 2500);
}
async function dress(us, them) {
  for (const id of SLOTS) {
    const own = world.rigs.get(id); if (id.startsWith('o') && own) continue; // (their own players stand in for o1 … o4)
    if (!made.has(rigKey(id, them))) await nextFrame();
    const g = rigFor(id, them);
    if (own && own !== g) { own.visible = false; swapped.push(own); }
    world.scene.add(g); world.rigs.set(id, g);
  }
}
function undress() { for (const g of made.values()) world.scene.remove(g); world.resetRigs(); for (const g of swapped) g.visible = true; swapped.length = 0; }

// ---------- the sim: his dribble and everyone's bodies follow the model (each on a planned way: sim.js follow) ----------
const at = new Map(); // id -> { x, y, vx, vy } this frame
function makeSim() {
  const s = new Sim();
  s.setup({ hero: [0, PITCH.W / 2], mates: [[0, 2]], opps: [], carrier: 'hero' });
  const add = (id, team) => { const a = { id, team, x: 0, y: 0, tx: 0, ty: 0, speed: 0, sp: 0, dist: 0, d0: 0, tA: 0, tL: 1.4, tN: 0, kickAt: null, kickFoot: null, face: [team === 'us' ? 1 : -1, 0] }; s.agents.set(id, a); return a; };
  for (const id of SLOTS) add(id, 'them');
  s.all = new Map(s.agents);
  for (const a of s.all.values()) { const q = { x: 0, y: 0, vx: 0, vy: 0 }; at.set(a.id, q); a.track = { t0: 0, at: () => q, watch: a.team === 'them' }; }
  s.on = (ev, v) => { if (ev === 'kick') { world.fx('kick', v); sfx('kick'); } else if (ev === 'touch') world.fx('touch'); };
  return s;
}
// Who is on the pitch now and where (from the model), before the sim's step.
function syncBodies(snap = false) {
  const s = sim, h = d.hero, want = new Set(['hero', ...d.defs.map(p => p.id), ...(d.friend && !gone(d.friend) ? ['m1'] : [])]);
  for (const [id, a] of s.all) { if (want.has(id)) { if (!s.agents.has(id)) { s.agents.set(id, a); snap = true; } } else s.agents.delete(id); }
  put('hero', h.x, h.y, h.v, h.vy);
  for (const p of d.defs) { put(p.id, p.x, p.y, p.vx, p.vy); const a = s.agents.get(p.id); a.track.watch = sim.ball.carrier !== p.id; }
  if (d.friend && s.agents.has('m1')) { const f = d.friend; put('m1', f.x, f.y, f.vx, f.vy); s.agents.get('m1').track.watch = sim.ball.state === 'flying'; }
  if (snap) for (const a of s.agents.values()) { const q = at.get(a.id); a.x = q.x; a.y = q.y; a.px = a.x; a.py = a.y; }
}
const gone = f => f.off && f.x < d.hero.x - 12;
function put(id, x, y, vx, vy) { const q = at.get(id); q.x = x; q.y = y; q.vx = vx || 0; q.vy = vy || 0; }
// The ball at his feet again (a new leg, or before play).
function ballToHero() {
  const h = d.hero; Object.assign(sim.ball, { x: h.x + .45, y: h.y, z: 0, state: 'carried', carrier: 'hero', h: 0, move: null, reach: null, got: -9 });
  const a = sim.agents.get('hero'); a.face = [1, 0]; a.kickAt = null;
}

// ---------- his taps ----------
// A tap near one of the line's arrows (on the screen: its middle or its tip, generous) or near the free friend picks it;
// anywhere else does nothing.
function tap(x, y) {
  if (!d || d.phase !== 'run') return;
  const l = d.tappable(); if (!l) return;
  const W = world.width || 932, H = world.height || 430, reach = Math.max(72, Math.min(W, H) * .18);
  let best = null, bd = reach;
  for (const c of l.choices) {
    const pts = c.id === 'F' ? (d.friend ? [[d.friend.x, d.friend.y, 0], [d.friend.x, d.friend.y, .9]] : []) : [[l.X - PAD_BACK, c.y, 0], [l.X - PAD_BACK + PAD_LEN * .4, c.y, 0], [l.X - PAD_BACK - PAD_LEN * .4, c.y, 0]];
    for (const p of pts) { const q = world.project(p[0], p[1], p[2]); if (!q) continue; const dd = Math.hypot(q[0] - x, q[1] - y); if (dd < bd) { bd = dd; best = c.id; } }
  }
  if (!best) { plog({ is: 'miss' }); return; }
  const was = l.pick; if (d.tap(best) && best !== was) sfx('tap');
}

// ---------- one frame ----------
let slowT = 0, saidAt = -99, real = 0, pending = [], warm = 0, camY = 10, out = 0, agains = 0; // (agains: forgiven tackles since the page loaded, for the checks)
function step(dt) {
  real += dt;
  const k = slowT > 0 ? .35 : 1; slowT = Math.max(0, slowT - dt);
  const gdt = dt * k;
  d.tick(gdt);
  syncBodies();
  sim.step(gdt);
  for (let i = pending.length - 1; i >= 0; i--) if (sim.time >= pending[i].at) { const f = pending[i].f; pending.splice(i, 1); f(); }
  stage.ui.clock += gdt;
  camera(dt);
  marks();
}
const later = (s, f) => pending.push({ at: sim.time + s, f });
function camera(dt, snap = false) {
  const h = d.hero, cy = d.cy, want = cy + (h.y - cy) * CAM.follow, c = stage.cam;
  camY = snap ? want : camY + (want - camY) * (1 - Math.exp(-dt * 3));
  out = snap ? 0 : out + ((d.phase === 'tackle' ? 1 : 0) - out) * (1 - Math.exp(-dt * 2.5));
  const x = h.x;
  c.eye[0] = x - CAM.back - CAM.outBack * out; c.eye[1] = camY; c.eye[2] = CAM.up + CAM.outUp * out;
  c.tgt[0] = x + CAM.ahead; c.tgt[1] = cy + (camY - cy) * .6; c.tgt[2] = 0;
}
// The arrows and rings on the grass for the lines in sight. Set only when something about them changed.
function marks() {
  const t = stage.ui.clock, pulse = .5 + .5 * Math.sin(t * 5);
  if (warm > 0) { warm--; allMeshes().forEach((m, i) => { m.visible = warm > 0; m.position.set(d.hero.x + 5 + (i % 4), d.cy - 3 + (i % 3) * 3, .04); m.scale.set(1, 1, 1); }); for (const p of pads) p.key = ''; return; } // (each drawn once behind the card: nothing new to make in play)
  let n = 0, ringOn = null;
  const failed = d.phase === 'tackle' && d.failInfo?.l;
  for (let j = d.i; j < d.lines.length && n < pads.length; j++) {
    const l = d.lines[j], st = l.state;
    if (st === 'wait' && !(j === d.i && d.phase === 'ready')) continue;
    if (st === 'done' && l !== failed) continue;
    for (const c of l.choices) {
      if (c.id === 'F') { if (st !== 'done' || l === failed) ringOn = { l, c }; continue; }
      if (n >= pads.length) break;
      const answer = l === failed && l.safe.includes(c.id); if (l === failed && !answer) continue; // (after a tackle: only the way that was open, past the line, where he should have gone)
      const p = pads[n++], picked = l.pick === c.id, px = answer ? l.X + SHOW_PAST : l.X - PAD_BACK;
      const dim = st === 'shown' || st === 'wait' ? .35 : st === 'locked' && !picked ? .18 : l === failed ? .15 : l.pick ? .5 : .78 + .22 * pulse;
      const lit = (picked && l !== failed) || answer, key = `${px}|${c.y}|${lit}`;
      if (p.key !== key) { p.key = key; for (const m of [p.idle, p.lit]) { m.position.set(px, c.y, .045); m.scale.set(PAD_LEN, PAD_W, 1); } p.idle.visible = !lit; p.lit.visible = lit; }
      if (lit) { const s = answer ? 1 + .08 * pulse : 1.08; p.lit.scale.set(PAD_LEN * s, PAD_W * s, 1); p.lit.material.opacity = answer ? .55 + .45 * pulse : 1; } else p.idle.material.opacity = dim;
    }
  }
  for (; n < pads.length; n++) if (pads[n].key) { pads[n].key = ''; pads[n].idle.visible = pads[n].lit.visible = false; }
  // the friend's ring: under him while he is a choice; lit when picked; on a marked pass, red is under the one who cuts it out
  const f = d.friend;
  ring.visible = !!(ringOn && f && !(ringOn.l === failed && !ringOn.l.safe.includes('F')));
  if (ring.visible) { const l = ringOn.l, on = l.pick === 'F' || l === failed; ring.position.set(f.x, f.y, .04); ring.scale.setScalar(2.4 * (on ? 1.12 : 1) * (1 + .05 * pulse)); ring.material.opacity = l.state === 'shown' ? .35 : on ? 1 : l.pick ? .45 : .8 + .2 * pulse; }
  const by = d.phase === 'tackle' && d.failInfo?.by; warn.visible = !!by;
  if (by) { warn.position.set(by.x, by.y, .035); warn.material.opacity = .6 + .4 * pulse; }
}

// ---------- what he sees and hears as play goes (the model's hooks) ----------
function hooks() {
  let goodN = 0, tackles = 0, friends = 0;
  return {
    open(l) { if (l.state === 'open' && l.wave.kind === 'friend' && !friends++) speak(DASH_SAID.wall); }, // (the first friend of a run: "Pass and go, then get it back!")
    leg() { if (!sim) return; syncBodies(true); sim.restores++; ballToHero(); camera(0, true); world.mood = null; clearFx(); }, // (a new picture: the last goal's cheer and confetti go)
    wipe(on) { wipeEl.classList.toggle('on', on); },
    tap(l, id, counted) { plog({ is: 'tap', pick: id, ok: counted ? 1 : 0, t: l ? +d.rel(l).toFixed(2) : null }); },
    pass(l, free, by) {
      const f = d.friend; sim.windup('hero', 'pass');
      const to = free ? { x: f.x + 1.4, y: f.y } : { x: by.x - .4, y: by.y };
      sim.kick(to.x, to.y, { speed: 12, arc: .08 });
      if (free) later(.45, () => { if (sim.ball.state !== 'carried') { sim.give('m1'); } });
      if (!free) later(.4, () => { sim.give(by.id); sim.windup(by.id, 'touch'); });
    },
    back(l) {
      const h = d.hero; sim.give('m1'); sim.windup('m1', 'pass');
      sim.kick(h.x + h.v * .62 + .6, h.y + (d.cy - h.y) * .1, { speed: 10.5, arc: .05 });
    },
    cross(l, ok, info) {
      const taps = l.taps.map(([t, id]) => `${id}@${t}`).join('>') || '-', late = l.defs.some(p => p.m.kind === 'late') ? 1 : 0;
      const sec = l.openAt != null ? +(d.t - l.openAt).toFixed(1) : null;
      if (!runStep(run, ok, { kind: l.wave.kind + (l.second ? '2' : ''), seed: l.wave.seed, tap: taps, right: l.safe.join('/'), pick: l.pick || '-', sec, why: ok ? null : info.why, by: info.by || null, late, moving: l.defs.filter(p => p.m.kind !== 'stand').length })) return;
      if (!ok) return;
      goodN++;
      if (l.pick === 'F') { sim.give('hero'); hud.banner('GREAT PASS!', 'good'); speak(DASH_SAID.pass); return; }
      hud.banner('GREAT RUN!', 'good');
      if (goodN === 1 || late) speak(late ? DASH_SAID.choice : DASH_SAID.good); else if (goodN % 4 === 0) speak(DASH_SAID.good);
    },
    again(l, info) { agains++; plog({ is: 'again', why: info.why, by: info.by, pick: l.pick || '-', kind: l.wave.kind }); }, // (v96 fix: a forgiving leg's first tackle: no life lost, the leg again)
    tackle(l, by, why) {
      slowT = .55; tackles++;
      if (by && why !== 'marked') { sim.windup(by.id, 'touch'); later(.12, () => { sim.give(by.id); world.fx('stolen'); sfx('down'); }); }
      else if (by) { world.fx('stolen'); sfx('down'); }
      hud.banner(why === 'marked' ? 'CUT OUT!' : 'TACKLED!', 'bad');
      later(.5, () => speak(tackles === 1 || why === 'none' ? DASH_SAID.tackled : DASH_SAID.space, true));
      plog({ is: 'tackle', why, by: by?.id || null });
    },
    shot() { const h = d.hero; sim.windup('hero', 'shot'); later(.18, () => sim.kick(PITCH.L + .4, d.cy + (h.y - d.cy) * .3, { speed: 15, arc: .3, z1: .45 })); },
    goal() { world.fx('goal'); sfx('net'); if (real - saidAt > 2.5) speak(DASH_SAID.goal); },
    over() { finish?.(); },
  };
}
// Confetti from the last goal is cleared as a new leg starts (as mini/attack-ui.js clearFx).
function clearFx() {
  const P = world.particles; if (!P?.live) return;
  for (let i = 0; i < P.list.length; i++) if (P.list[i].life) { P.list[i].life = 0; P.mesh.setMatrixAt(i, P.zero); }
  P.live = 0; P.mesh.instanceMatrix.needsUpdate = true;
}
function speak(line, force = false) { if (!force && real - saidAt < 2.2) return; saidAt = real; say(line); }

// ---------- a run ----------
let busy = false, finish = null;
export async function runDash() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper(ID);
  try {
    await build();
    const us = teamById(P.us), them = teamById(P.them), first = !P.mini?.[ID]?.plays;
    game.setTeams(us, them); game.mode = 'dash'; await nextFrame(); world.setEnv('crowd'); await nextFrame();
    hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'dash' }); hud.dots([], 0);
    await dress(us, them); await nextFrame();
    sim = makeSim(); stage.sim = sim; stage.ui = { glow: {}, clock: 0 };
    run = startRun(ID);
    d = new Dash({ L: PITCH.L, W: PITCH.W, run, seed: Math.floor(Math.random() * 2 ** 31), hooks: hooks() });
    d.prepare(); syncBodies(true); ballToHero(); camera(0, true);
    real = 0; slowT = 0; saidAt = -99; pending = []; warm = 3; wipeEl.classList.remove('on');
    onStage(stage); stage.on = true; stage.phase = 'play'; show(null);
    plog({ is: 'start', size: `${PITCH.L}x${PITCH.W}` });
    if (first) await card({ emoji: '💨', title: DASH_SAID.intro, sub: 'Tap the gap nobody is closing. Watch which way the other team moves!', button: 'Play' });
    else await new Promise(r => setTimeout(r, 700));
    if (typeof window !== 'undefined') window.__dash.playAt = performance.now();
    d.start(); syncBodies(true); saidAt = real;
    await new Promise(r => { finish = r; });
    end();
    endRun(run, { again: runDash });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; finish = null; }
}
function end() {
  stage.on = false; stage.phase = 'idle';
  if (pads) { for (const m of allMeshes()) m.visible = false; for (const p of pads) p.key = ''; wipeEl.classList.remove('on'); }
  onStage(null); undress(); game.home();
}
premake();
if (typeof window !== 'undefined') window.__dash = { stage, runDash, get game() { return d; }, get sim() { return sim; }, get agains() { return agains; }, playAt: 0 };
