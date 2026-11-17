// The motion audit (v64): plays every lesson scene (and, with --gen N, N fresh scenes per lesson) at every size, through
// the decision window, tapping each choice early (5% of the window), in the middle and late (95%), and once tapping
// nothing (the time-out). It checks what the owner and the research ask of play that goes on while he chooses:
//   grade   what he sees when he taps agrees with how the choice is graded (window.js disagree)
//   result  the play ends the same kind of way as the frozen play did (with --base: a file of v63's results)
//   speed   nobody moves faster than a child sprints (window.js SPEED) or speeds up or slows down faster than ACC
//   turn    nobody's way turns by more than 120° in the window (toward, away, toward again), or sharply on the spot
//   still   nobody outfield stands still through the window; the player on the ball is never still
//   jump    nobody's speed jumps as the window opens (the run-up brings him to it)
//   gap     two players closer than 0.5 m
//   threat  on a time-out the one who gets the ball is the threat the window showed, and he is within reach of it
//   late    the time-out happens when the reach on the grass says (u = 1), and the steal follows soon after (real s)
// Usage: node scripts/motion-audit.js [size] [--gen N] [--base results.json] [--only skill] [--json out.json]
import { PATH, allScenarios } from '../js/skills.js';
import { SIZES, setSize, TEAM, PITCH } from '../js/geom.js';
import { generate } from '../js/generate.js';
import { disagree, kindOf, SPEED, ACC } from '../js/window.js';
import { optionsFor, makeGame, drive } from '../tests/harness.js';
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const sizes = args[0] && !args[0].startsWith('--') ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer);
const nGen = +(flag('--gen') || 0), scene = flag('--scene'), base = flag('--base') ? JSON.parse(readFileSync(flag('--base'), 'utf8')) : null, only = flag('--only'), taps = [.05, .5, .95];
const LIM = { speed: SPEED.sprint[1] + .05, acc: ACC + .5, turn: 120, still: SPEED.stand, gap: .5, late: 1.25, lateFar: 2, reach: .9 };

// What kind of end a play had (its banners), for comparing with the frozen play.
const KIND = { 'GOAL!': 'kept', 'Kept the ball!': 'kept', 'Stolen!': 'lost', 'They got it!': 'lost', 'Cut out!': 'lost', 'Stole it!': 'stopped', 'Stopped him!': 'stopped', 'They scored': 'conceded',
  'Saved!': 'saved', 'Over the bar!': 'over', 'Wide!': 'wide', 'Cleared!': 'cleared', 'He got there!': 'timeout', 'Great save!': 'kept' };
const endOf = banners => { const k = banners.map(b => KIND[b]).filter(Boolean); return k.at(-1) || 'none'; };
const sameEnd = (a, b) => a === b || (a === 'kept' && b === 'kept');

// One play: the run-up, the window (tap `opt` at fraction `u` of it, or nothing), the play after. Records everyone's
// way in game time through the window and the time-out play.
async function play(sc, opt, u) {
  const { g, events } = makeGame(); g.world.canvas = { clientWidth: VW, clientHeight: VH }; g.mode = 'lesson'; g.load(sc);
  const s = g.sim, rec = [], wins = [], flags = [], info = {};
  const snap = () => { const at = {}; for (const a of s.agents.values()) at[a.id] = [a.x, a.y]; return at; };
  const onFrame = gm => { if (gm.win || gm.phase === 'outcome') rec.push({ t: s.time, real: gm.realTime, win: !!gm.win, wi: wins.length, out: gm.phase === 'outcome', at: snap(), ball: [s.ball.x, s.ball.y], carrier: s.ball.carrier, cam: gm.cam && { eye: [...gm.cam.eye], tgt: [...gm.cam.tgt], Ff: gm.cam.Ff, Fw: gm.cam.Fw }, yaw: gm.yaw, spot: gm.step === 'spot' }); };
  await drive(g, g.pre(), { onFrame });
  const decideAt = async want => {
    const p = g.decide(), w = g.win; if (w) wins.push({ G: w.G, R: w.R, f: w.f, t0: w.t0, threat: w.threat?.id, kind: w.kind, k: w.plan.k, a: w.plan.a, cls: w.plan.cls || 'co-moving', at0: { ...w.at0 } });
    let tapped = null;
    const pick = gm => { if (want === 'timeout') return null; if (!gm.win) return want; if (gm.win.u >= u) { tapped = { u: gm.win.u, at: snap(), t: s.time }; return want; } return null; };
    const o = await drive(g, p, { pick, onFrame, maxSec: 60 });
    if (tapped && w && want !== 'timeout') { // what he sees when he taps
      const pos = id => ({ x: tapped.at[id][0], y: tapped.at[id][1] }), at0 = id => w.at0[id] || pos(id);
      const own = g.spot0 && g.sc.spots ? { ...g.sc, spots: g.spot0.map(sp => ({ ...sp })) } : g.sc; // (the rings as the scene put them: disagree moves them itself)
      const d = disagree(own, pos, tapped.t - w.t0, { at0, options: g.offerList(), ids: Object.keys(tapped.at).filter(id => !s.a(id)?.gk), ball: s.ball });
      if (d.length) info.grade = (info.grade || 0) + 1; // (round 2: the early picture is not the graded one; the result decides, below)
    }
    if (o === 'timeout' && wins.length) wins.at(-1).timeoutAt = { u: (s.time - w.t0) / w.G, real: g.realTime };
    return o;
  };
  let step2 = null, first = opt;
  if (sc.then && opt?.startsWith('then:')) { step2 = opt.slice(5); first = sc.best; } else if (sc.then && opt === sc.best) step2 = sc.then.best;
  const o = await decideAt(first || 'timeout');
  if (!first && o !== 'timeout') flags.push(['late', `no time-out (${o})`]);
  const good = g.isGood(o);
  await drive(g, g.outcome(o, good), { onFrame, maxSec: 60 });
  if (step2 && g.result === 'passed') { await drive(g, g.toStep2(), { onFrame }); const o2 = await decideAt(step2); await drive(g, g.outcome(o2, g.isGood(o2)), { onFrame, maxSec: 60 }); }
  const banners = events.filter(e => e[0] === 'banner').map(e => e[1]);
  return { g, rec, wins, flags, banners, o, info };
}
// Where a point is on a 844x390 screen through the game's own camera (as world.js draws it), or null behind it.
const VW = 844, VH = 390;
function screen(cam, [x, y, z = .9]) {
  if (!cam) return null;
  const f = [cam.tgt[0] - cam.eye[0], cam.tgt[1] - cam.eye[1], cam.tgt[2] - cam.eye[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r) || 1; r = r.map(v => v / rl);
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], d = [x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]];
  const zz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (zz < .3) return null;
  const F = Math.max(VH * cam.Ff, VW * (cam.Fw || 0));
  return [VW / 2 + F * (d[0] * r[0] + d[1] * r[1]) / zz, VH / 2 - F * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zz];
}
// Round 2's floor: in a whole window (the time-out play), how far the threat closes on the ball (m; defending, how far
// their dribbler gets on toward our goal), how far he moves on the screen (px at 844x390), how far his own player
// travels, whether anyone moves at all, and whether the threat is in view as it opens. The screen is the one he looks
// for the threat in: head up (the player view looking out, view.js camSpec), or the fitted view when he picks a spot.
const headUp = (h, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return { eye: [h[0] - 5.2 * c - .3 * s, h[1] - 5.2 * s + .3 * c, 2.8], tgt: [h[0] + 9 * c, h[1] + 9 * s, .5], Ff: .9, Fw: .52 }; };
const camOf = q => q.spot ? q.cam : headUp(q.at.hero, q.yaw);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const clampS = p => p && [Math.max(0, Math.min(VW, p[0])), Math.max(0, Math.min(VH, p[1]))];
function floor(r, sc) {
  const w = r.wins[0], f = r.rec.filter(x => x.win && x.wi === 1); if (!w || f.length < 3 || !w.threat) return null;
  const a = f[0], b = f.at(-1), th = w.threat, kind = kindOf(sc), our = [0, PITCH.W / 2];
  const d = q => kind === 'follow' ? Math.hypot(q.at[th][0] - sc.shot.loose[0], q.at[th][1] - sc.shot.loose[1]) : kind === 'defense' ? Math.hypot(q.at[th][0] - our[0], q.at[th][1] - our[1]) : Math.hypot(q.at[th][0] - q.ball[0], q.at[th][1] - q.ball[1]);
  const pa = screen(camOf(a), a.at[th]), pb = screen(camOf(b), b.at[th]), on = p => p && p[0] >= 0 && p[0] <= VW && p[1] >= 0 && p[1] <= VH;
  const moved = Object.keys(a.at).filter(id => id[0] !== 'k').map(id => Math.hypot(b.at[id][0] - a.at[id][0], b.at[id][1] - a.at[id][1]));
  // in view at the start, or within the first third (the view swings to the play as it opens)
  const third = f.filter(x => x.t - a.t <= (b.t - a.t) / 3), seen = third.some(x => on(screen(camOf(x), x.at[th])));
  // How far he moves on the screen: in the view the game shows (head down, by default) and in the head-up view, the
  // larger; across the screen (from where he comes into it) or in size as he comes at the camera.
  const pxIn = cam => { const f0 = screen(cam(a), [...a.at[th], 0]), f1 = screen(cam(b), [...b.at[th], 0]), h0 = screen(cam(a), [...a.at[th], 1.3]), h1 = screen(cam(b), [...b.at[th], 1.3]);
    if (!on(f1) && !on(h1)) return 0; const c0 = clampS(f0), c1 = clampS(f1); return Math.max(c0 && c1 ? Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) : 0, f0 && f1 && h0 && h1 ? Math.abs((f1[1] - h1[1]) - (f0[1] - h0[1])) : 0); };
  const px = Math.max(pxIn(q => q.cam), pxIn(camOf));
  const ca = clampS(pa), cb = clampS(pb), h = b.at.hero, e = b.at[th], ang = Math.abs(wrapA(Math.atan2(e[1] - h[1], e[0] - h[0]) - a.yaw)), behind = ang > 2.1 && (Math.hypot(e[0] - h[0], e[1] - h[1]) < 2.8 || sc.intro === 'won'); // (won it: the idea is that they are behind him)
  void ca; void cb;
  return { close: d(a) - d(b), px, hero: Math.hypot(b.at.hero[0] - a.at.hero[0], b.at.hero[1] - a.at.hero[1]), most: Math.max(...moved), seen, kind,
    th, from: a.at[th].map(v => +v.toFixed(1)), to: b.at[th].map(v => +v.toFixed(1)), ball: a.ball.map(v => +v.toFixed(1)), yaw: +a.yaw?.toFixed(2), scr: pa?.map(Math.round), spot: a.spot, behind, restart: !!sc.restart };
}

// (round 3) Defending that makes common sense, over the whole window of the time-out play, when his team has the ball
// in open play: (a) the presser (the window's threat) is the nearest of their outfield players to the ball as it opens;
// (b) the nearest of them never gets farther from the ball for long; (c) nobody goes away from the ball for more than
// ROLE.away s, except the presser jockeying close to it or a marker going with his man; (d) never two of them within
// ROLE.pile m of one of ours as it ends, unless the pattern puts two on him by its idea (PILE); (e) a friend his pass
// to is graded right has nobody within OPEN m as it ends, and at most one other friend is left free (none within 4 m).
export const ROLE = { tol: .3, grow: .4, away: .4, pile: 2.5, open: 1.6, free: 4, mark: 3 };
// Patterns whose idea is two of theirs on one of ours: the trap (two close him down), the wall pass (two press him,
// the friend beside him is free), a cut-out on the pass (one presses the passer, one waits on the lane).
export const PILE = new Set(['trap', 'trap-one', 'give-go', 'give-go-ahead', 'marked', 'shadow', 'gs-covered', 'peek-turn', 'peek-back', 'counter-pass']);
const ourBall = sc => !['defense', 'tackle'].includes(kindOf(sc)) && !sc.restart;
function roles(r, sc) {
  const flags = [], w = r.wins[0], f = r.rec.filter(x => x.win && x.wi === 1); if (!w || f.length < 3 || !ourBall(sc)) return flags;
  const opp = Object.keys(f[0].at).filter(id => id[0] === 'o'), ours = Object.keys(f[0].at).filter(id => id === 'hero' || id[0] === 'm');
  const ballAt = q => kindOf(sc) === 'receive' ? q.at.hero : kindOf(sc) === 'follow' ? sc.shot.loose : q.ball;
  const d = (q, id) => Math.hypot(q.at[id][0] - ballAt(q)[0], q.at[id][1] - ballAt(q)[1]);
  const a = f[0], th = w.threat;
  // (free: not marking one of ours; a marker stays nearer his man than the ball, within ROLE.mark m of him, start and end)
  const e0 = f.at(-1), marks = (q, id) => ours.filter(m => m !== 'hero').some(m => { const dm = Math.hypot(q.at[m][0] - q.at[id][0], q.at[m][1] - q.at[id][1]); return dm < ROLE.mark && dm < d(q, id); });
  const won = sc.intro === 'won', freeOf = id => !(marks(a, id) && marks(e0, id)) && !(won && id === 'o1'); // (won it: the one he took it from stumbles on past him by the idea)
  if (th && th[0] === 'o') { const near = opp.filter(id => id !== th && freeOf(id)).map(id => d(a, id)), mine = d(a, th); if (near.length && mine > Math.min(...near) + ROLE.tol) flags.push(['role', `(a) presser ${th} ${mine.toFixed(1)} m from the ball, ${opp.find(id => id !== th && freeOf(id) && d(a, id) === Math.min(...near))} nearer (${Math.min(...near).toFixed(1)} m)`]); }
  // (b) and (c), on a 0.1 s grid
  const g = []; for (let t = a.t, k = 0; t <= f.at(-1).t + 1e-9; t += .1) { while (k + 1 < f.length && f[k + 1].t <= t) k++; g.push(f[k]); }
  let grow = 0, best = null; const away = Object.fromEntries(opp.map(id => [id, 0]));
  for (let i = 1; i < g.length; i++) {
    const q0 = g[i - 1], q = g[i], dt = q.t - q0.t || .1, n = opp.filter(freeOf).sort((x, y) => d(q, x) - d(q, y))[0];
    if (n === best && d(q, n) > d(q0, n) + .005) { grow += dt; if (grow > ROLE.grow) { flags.push(['role', `(b) ${n}, the nearest, gets farther from the ball for ${grow.toFixed(1)} s`]); grow = -1e9; } } else if (grow >= 0) grow = 0;
    best = n;
    for (const id of opp) {
      const vx = (q.at[id][0] - q0.at[id][0]) / dt, vy = (q.at[id][1] - q0.at[id][1]) / dt, v = Math.hypot(vx, vy), b = ballAt(q), bx = b[0] - q.at[id][0], by = b[1] - q.at[id][1], bl = Math.hypot(bx, by) || 1;
      const off = v > .5 && (vx * bx + vy * by) / (v * bl) < -.25;
      const jockey = id === th && bl < 3.5;
      const man = ours.map(m => ({ m, dd: Math.hypot(q.at[m][0] - q.at[id][0], q.at[m][1] - q.at[id][1]), mv: [(q.at[m][0] - q0.at[m][0]) / dt, (q.at[m][1] - q0.at[m][1]) / dt] })).sort((x, y) => x.dd - y.dd)[0];
      const tracking = man && man.dd < 3.5 && Math.hypot(man.mv[0] - vx, man.mv[1] - vy) < .8;
      away[id] = off && !jockey && !tracking && !(won && id === 'o1') ? away[id] + dt : 0;
      if (away[id] > ROLE.away + 1e-9) { flags.push(['role', `(c) ${id} goes away from the ball for over ${ROLE.away} s`]); away[id] = -1e9; }
    }
  }
  // (d) and (e), as it ends
  const e = f.at(-1);
  if (!PILE.has(sc.pattern)) for (const m of ours.filter(m => m !== e.carrier && m !== sc.carrier))  { /* (two on the friend with the ball is pressure on the ball, not a pile-up) */ const on = opp.filter(id => Math.hypot(e.at[id][0] - e.at[m][0], e.at[id][1] - e.at[m][1]) < ROLE.pile); if (on.length > 1) flags.push(['role', `(d) ${on.join('+')} both on ${m}`]); }
  const grades = sc.grades || {}, openIds = Object.keys(grades).filter(o => o.startsWith('pass:') && ['best', 'good', 'ok'].includes(grades[o]) || o === sc.best && o.startsWith('pass:')).map(o => 'm' + (+o.slice(5) + 1));
  for (const m of new Set(openIds)) if (e.at[m]) { const dd = Math.min(...opp.map(id => Math.hypot(e.at[id][0] - e.at[m][0], e.at[id][1] - e.at[m][1]))); if (dd < ROLE.open) flags.push(['role', `(e) ${m}, graded open, has one of theirs ${dd.toFixed(1)} m from him`]); }
  // (left free: a friend up the field from the ball (nearer their goal), nobody within ROLE.free m; one behind the ball
  // is no danger to them, and defenders rightly guard the way to goal first)
  const gx = PITCH.L, bx = ballAt(e)[0];
  const free = ours.filter(m => m !== 'hero' && !openIds.includes(m) && e.at[m][0] > bx + 1 && Math.min(...opp.map(id => Math.hypot(e.at[id][0] - e.at[m][0], e.at[id][1] - e.at[m][1]))) > ROLE.free); void gx;
  if (free.length > 1) flags.push(['role', `(e) ${free.join(', ')} left free`]);
  return flags;
}
// (round 3) His own player never stands and waits: with the ball he carries it at least HERO.carry m through the window
// (not at a dead ball), and he is never under walking pace for more than HERO.slow s of game time.
export const HERO = { carry: 1.5, walk: .8, slow: .5 };
function heroMoves(r, sc) {
  const flags = [], f = r.rec.filter(x => x.win && x.wi === 1); if (f.length < 3 || sc.restart || kindOf(sc) === 'tackle') return flags;
  const a = f[0], e = f.at(-1), trav = Math.hypot(e.at.hero[0] - a.at.hero[0], e.at.hero[1] - a.at.hero[1]);
  if (a.carrier === 'hero' && kindOf(sc) !== 'follow' && trav < HERO.carry) flags.push(['hero', `carries it only ${trav.toFixed(1)} m in the window`]);
  let slow = 0;
  for (let i = 1; i < f.length; i++) { const dt = f[i].t - f[i - 1].t; if (!(dt > 0)) continue; const v = Math.hypot(f[i].at.hero[0] - f[i - 1].at.hero[0], f[i].at.hero[1] - f[i - 1].at.hero[1]) / dt;
    slow = v < HERO.walk ? slow + dt : 0; if (slow > HERO.slow + 1e-9 && !(kindOf(sc) === 'receive' && f.at(-1).t - f[i].t < .4)) { flags.push(['hero', `under walking pace for over ${HERO.slow} s`]); break; } }
  return flags;
}

// The checks on the recorded ways.
function motion(r, sc) {
  for (let i = 1; i <= r.wins.length; i++) motionIn(r, sc, r.rec.filter(f => f.win && f.wi === i));
  return r.flags;
}
function motionIn(r, sc, inWin) {
  const { rec, flags } = r;
  if (inWin.length < 3) return flags;
  // resample every 0.05 s of game time
  const grid = [], dt = .05; let k = 0;
  for (let t = inWin[0].t; t <= inWin.at(-1).t + 1e-9; t += dt) { while (k + 1 < inWin.length && inWin[k + 1].t <= t) k++; grid.push(inWin[k]); }
  const ids = Object.keys(inWin[0].at), gk = id => id[0] === 'k';
  for (const id of ids) {
    const v = []; for (let i = 1; i < grid.length; i++) { const a = grid[i - 1].at[id], b = grid[i].at[id], T = grid[i].t - grid[i - 1].t || dt; v.push([(b[0] - a[0]) / T, (b[1] - a[1]) / T]); }
    if (!v.length) continue;
    const sp = v.map(q => Math.hypot(...q)), max = Math.max(...sp);
    if (max > LIM.speed) flags.push(['speed', `${id} ${max.toFixed(1)} m/s`]);
    for (let i = 2; i < v.length; i++) { const a = Math.hypot(v[i][0] - v[i - 2][0], v[i][1] - v[i - 2][1]) / (2 * dt); if (a > LIM.acc) { flags.push(['speed', `${id} accel ${a.toFixed(1)} m/s²`]); break; } }
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (sp[i] > .4 && sp[j] > .4) {
      const c = (v[i][0] * v[j][0] + v[i][1] * v[j][1]) / (sp[i] * sp[j]); if (c < Math.cos(LIM.turn * Math.PI / 180)) { flags.push(['turn', `${id} turned ${Math.round(Math.acos(Math.max(-1, c)) * 180 / Math.PI)}° in the window`]); i = v.length; break; }
    }
    if (!gk(id) && max < LIM.still && grid.length > 4 && !(sc.restart && id === (sc.carrier || 'hero'))) flags.push(['still', `${id} still through the window`]); // (a restart's taker stands over the dead ball)
  }
  // the player on the ball keeps it moving
  const c0 = inWin[0].carrier; if (c0 && ids.includes(c0) && !sc.restart) { /* (a restart's taker: a dead ball) */ const a = inWin[0].at[c0], b = inWin.at(-1).at[c0], T = inWin.at(-1).t - inWin[0].t; if (T > .2 && Math.hypot(b[0] - a[0], b[1] - a[1]) / T < .2) flags.push(['still', `${c0} on the ball nearly still`]); }
  // nobody's speed jumps as the window opens (compare the last frame before with the first two inside)
  const before = rec.filter(f => !f.win && !f.out).at(-1);
  // players too close
  for (const f of inWin) { const at = Object.entries(f.at); for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) { const d = Math.hypot(at[i][1][0] - at[j][1][0], at[i][1][1] - at[j][1][1]); if (d < LIM.gap) { flags.push(['gap', `${at[i][0]}–${at[j][0]} ${d.toFixed(2)} m`]); return flags; } } }
  void before; void sc;
  return flags;
}
// After a time-out: who took the ball, and when, against what the window showed.
function timeout(r, sc) {
  const { rec, wins, flags } = r, w = wins[0]; if (!w) return flags;
  if (!w.timeoutAt) { flags.push(['late', 'no time-out']); return flags; }
  if (Math.abs(w.timeoutAt.u - 1) > .05) flags.push(['late', `time-out at u=${w.timeoutAt.u.toFixed(2)}`]);
  if (sc.restart) return flags; // (a restart: nobody tackles; the taker plays it to where he stands, outcomes.js timeoutGen)
  const out = rec.filter(f => f.out), first = out.find(f => f.carrier && f.carrier !== out[0]?.carrier && !['hero', 'm1', 'm2', 'm3', 'k1'].includes(f.carrier) || (kindOf(sc) === 'defense' && f.carrier && f.carrier[0] === 'o'));
  if (kindOf(sc) === 'defense' || kindOf(sc) === 'follow' || kindOf(sc) === 'goal') return flags; // (the attackers go on; they got there first)
  if (kindOf(sc) === 'receive' && !first && r.banners.includes('He got there!')) return flags; // (nobody near him: they got back in front of him instead)
  if (!first) { flags.push(['threat', 'nobody took the ball']); return flags; }
  const poke = out.find(f => f.at[w.threat] && Math.hypot(f.at[w.threat][0] - f.ball[0], f.at[w.threat][1] - f.ball[1]) < .65);
  if (!poke) flags.push(['threat', `${w.threat} never reached the ball (${first.carrier} took it)`]);
  else {
    // A threat still far from the ball as the window ends (more than PRESS m: he was not pressing, he was getting back)
    // needs his run to get there: explained, and allowed up to LIM.lateFar; one pressing must be there at once.
    const at = rec.find(f => f.out) || rec.at(-1), far = at && Math.hypot(at.at[w.threat][0] - at.ball[0], at.at[w.threat][1] - at.ball[1]) > 3.4, gap = poke.real - w.timeoutAt.real;
    if (gap > (far ? LIM.lateFar : LIM.late)) flags.push(['late', `steal ${gap.toFixed(1)} s after the reach touched the ball${far ? ' (from far)' : ''}`]);
    r.gap = gap; r.far = far;
  }
  return flags;
}

const all = [], counts = {}, mis = [], explained = [];
for (const size of sizes) {
  setSize(size);
  for (const sk of PATH.filter(s => s.ready && (!only || s.id === only))) {
    const scs = [...allScenarios(sk.id), ...Array.from({ length: nGen }, (_, i) => generate(sk.id, 5001 + i, { even: true })).filter(Boolean).map(s => ({ ...s, id: s.id + 'e' }))];
    for (const sc of scs) {
      if (kindOf(sc) === 'tackle' || (scene && sc.id !== scene)) continue;
      const row = { size, skill: sk.id, sc: sc.id, kind: kindOf(sc), plays: [] };
      for (const opt of optionsFor(sc)) for (const u of taps) {
        const r = await play(sc, opt, u), fl = motion(r, sc), end = endOf(r.banners), want = base?.[`${size}|${sk.id}|${sc.id}|${opt}`];
        if (want && !sameEnd(end, endOf(want))) fl.push(['result', `${end} (frozen: ${endOf(want)})`]);
        row.plays.push({ opt, u, end, flags: fl, win: r.wins[0] });
      }
      const r = await play(sc, null, 1), fl = timeout(r, sc); motion(r, sc).forEach(f => fl.push(f));
      const fo = floor(r, sc);
      for (const f of roles(r, sc)) fl.push(f); for (const f of heroMoves(r, sc)) fl.push(f);
      if (fo && fo.most < .5) fl.push(['floor', `nobody moves .5 m in the window (most ${fo.most.toFixed(2)} m)`]);
      // (explained: a chaser the scene's own picture has at his back, close; he cannot be seen coming, only felt)
      if (fo && !fo.seen && fo.kind !== 'receive') { if (fo.behind) explained.push(`${size} ${sc.id}: ${r.wins[0].threat} comes from behind him (at his back in the scene)`); else fl.push(['unseen', `${r.wins[0].threat} not in view as it opens`]); }
      row.plays.push({ opt: 'timeout', u: 1, end: endOf(r.banners), flags: fl, win: r.wins[0], gap: r.gap, far: r.far });
      row.win = r.wins[0] && { G: r.wins[0].G, f: +r.wins[0].f.toFixed(3), threat: r.wins[0].threat, k: r.wins[0].k, a: r.wins[0].a, cls: r.wins[0].cls };
      row.floor = fo;
      for (const p of row.plays) for (const [k2, m] of p.flags) { counts[`${size} ${k2}`] = (counts[`${size} ${k2}`] || 0) + 1; mis.push(`${size} ${sc.id} ${p.opt}@${p.u}: ${k2}: ${m}`); }
      all.push(row);
    }
    process.stderr.write(`${size} ${sk.id} done\n`);
  }
}
// Summary: the window lengths and slow motion by kind, and every flag.
const byKind = {}; for (const r of all) if (r.win) (byKind[`${r.size} ${r.kind}`] ||= []).push(r.win);
console.log('window (game s) and world speed, by kind:');
for (const [k, v] of Object.entries(byKind)) { const G = v.map(x => x.G).sort((a, b) => a - b), f = v.map(x => x.f).sort((a, b) => a - b); console.log(`  ${k.padEnd(14)} n ${String(v.length).padStart(3)}  G ${G[0]}–${G.at(-1)} (median ${G[G.length >> 1]})  speed ${f[0]}–${f.at(-1)}×`); }
const gaps = all.flatMap(r => r.plays.filter(p => p.gap != null).map(p => p.gap)).sort((a, b) => a - b);
if (gaps.length) console.log(`steal after the reach touched the ball: median ${gaps[gaps.length >> 1].toFixed(2)} s, max ${gaps.at(-1).toFixed(2)} s (real)`);
for (const far of [false, true]) {
  const g = all.flatMap(r => r.plays.filter(p => p.gap != null && !!p.far === far).map(p => p.gap)).sort((a, b) => a - b);
  const what = far ? `getting back from far (over 3.4 m away as it ends; allowed ${LIM.lateFar} s)` : `pressing (allowed ${LIM.late} s)`;
  if (g.length) console.log(`  threat ${what}: ${g.length} time-outs, median ${g[g.length >> 1].toFixed(2)} s, max ${g.at(-1).toFixed(2)} s`);
}
// The scenes by how their window comes about (round 2), and the floor on visible change.
const cls = {}; for (const r of all) if (r.win) { const k = `${r.size} ${r.win.cls}`; (cls[k] ||= []).push(r.sc); }
console.log('windows by class (full: the whole lead-in; short: a shorter one, where a run would start off the pitch or through someone; last-resort: shortened by pattern, window.js SHORT_LEAD; live: from play going on; co-moving: the round-1 plan):');
for (const [k, v] of Object.entries(cls)) console.log(`  ${k.padEnd(18)} ${v.length}${v.length < 12 ? '  ' + v.join(' ') : ''}`);
// (Windows whose threat is behind him by the scene's idea, or is the one the shot hit, cannot move on his screen: they
// are counted apart.)
const apart = r => r.floor.restart || r.floor.behind || (r.kind === 'receive' && !r.floor.seen) || (r.kind === 'follow' && r.floor.th === 'o1' && r.sc.includes('block'));
const fl2 = {}, apartN = {}; for (const r of all) if (r.floor) { if (apart(r)) { apartN[r.size] = (apartN[r.size] || 0) + 1; (fl2[`${r.size} ${r.skill}`] ||= []); continue; } (fl2[`${r.size} ${r.skill}`] ||= []).push(r.floor); }
console.log('floor per lesson (threat closes ≥ 2.5 m and moves ≥ 80 px on screen; his player travels):');
const share = {}; for (const [k, v] of Object.entries(fl2)) { if (!v.length) { console.log(`  ${k.padEnd(26)} (all apart)`); continue; }
  const ok = v.filter(x => x.close >= 2.5 && x.px >= 80).length, c = v.map(x => x.close).sort((a, b) => a - b), px = v.map(x => x.px).sort((a, b) => a - b), h = v.map(x => x.hero).sort((a, b) => a - b), sz = k.split(' ')[0];
  (share[sz] ||= [0, 0]); share[sz][0] += ok; share[sz][1] += v.length;
  console.log(`  ${k.padEnd(26)} ${ok}/${v.length}  close ${c[0].toFixed(1)}–${c.at(-1).toFixed(1)} m (median ${c[c.length >> 1].toFixed(1)})  px ${Math.round(px[0])}–${Math.round(px.at(-1))} (median ${Math.round(px[px.length >> 1])})  his player ${h[0].toFixed(1)}–${h.at(-1).toFixed(1)} m`);
}
for (const [sz, [ok, n]] of Object.entries(share)) { console.log(`  ${sz}: ${ok}/${n} windows meet the floor (${Math.round(100 * ok / n)}%), and ${apartN[sz] || 0} apart (the threat behind him by the idea, the one the shot hit, or a restart's dead ball)`); if (ok < .9 * n) { counts[`${sz} floor-share`] = 1; mis.push(`${sz} floor met in only ${ok}/${n} windows`); } }
if (explained.length) { console.log(`explained (${explained.length}):`); for (const m of explained) console.log('  ' + m); }
console.log('flags:', JSON.stringify(counts));
for (const m of mis.slice(0, 80)) console.log('  ' + m);
if (mis.length > 80) console.log(`  … ${mis.length - 80} more`);
if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(all));
console.log(`\n${mis.length} flag(s)`);
process.exitCode = mis.length ? 1 : 0;
void TEAM;
