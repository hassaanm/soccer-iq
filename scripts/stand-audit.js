// The standing audit (alive-shape): how often the players round his own look like they are standing about. The owner's
// son: "players just stand around, both teammates and defenders". Measured on the bodies as they are drawn: the game's
// own pro/motion.js poses every player every frame here (three.js is stood in for: only the maths that places the hips
// and the feet is used, and it needs none of it), as world.js does, on the picture's clock.
//
// A player stands through a second of real time when, over that second, his hips move on the screen (844x390, through
// the game's own camera; the camera's own movement taken out: both places through the camera of the moment) by less than
// STAND.k of his own height on the screen (0.12: about 20 cm, more than a shift of his weight), neither foot moves more
// than that (a step, lifted or slid: a real step is 25 cm and more), and his body turns less than STAND.yaw degrees. Counted: every outfield player on the screen, except his own player and the one who comes for the
// ball (and a second one who comes with him), for every whole second he is on the screen in one phase:
//   runup    the run-up before a choice opens (a lesson's scene, a match's fresh situation)
//   window   a choice's window, slow motion (lessons and matches; a demo's window once its idea has been said)
//   crawl    a demo's window while its idea is said (play crawls on)
//   outcome  the play after a lesson's choice
//   live     a match between choices (the play after a choice, and the moments before the next)
//   restart  a dead ball before it is played (kick-off, a goal kick, a pass in from the side): reported, not limited
// Flows: every lesson scene (generated, ids like gen-...-101) tapped at the middle of its window with its best choice, the
// demo of every lesson, and MATCHES whole matches by a bot that looks up and taps the best choice part way in.
// The limit (LIMIT, by phase): the share of standing seconds, at every size. Before alive-shape (v78, 10 matches a size)
// the players stood in 32-35% of a window's seconds, 82-84% of a demo's crawl, 26% of the play after a lesson's choice,
// 5-12% of a match's live play and 3-4% of a run-up; after it, 11-12%, 12-15%, 3%, 2% and 3%. What still stands in a
// window: a friend on the ball in slow motion (his carry is the play), a passer in his follow-through, a marker whose man
// stands. At a dead ball (restart, 44-51% before and after) the players stand until it is played, as they do.
//   node scripts/stand-audit.js [size] [--matches N] [--v]     (also run by scripts/motion-audit.js, at the end)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PATH, allScenarios } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { makeGame, drive } from '../tests/harness.js';

export const STAND = { k: .12, yaw: 15, VW: 844, VH: 390 };
// Rooted (reported, not limited): a second of play at full speed in which the ball moves ROOT.ball m or more and he, in
// the game itself (his small moves on the spot not counted), less than ROOT.him m.
export const ROOT = { ball: 2, him: .3 };
// The most standing a phase may have (a share of its counted seconds).
export const LIMIT = { runup: .08, window: .18, crawl: .2, outcome: .08, live: .06 };

// ---- the poses: pro/motion.js, with three.js stood in for ----
let animateRig = null;
export async function poser() {
  if (animateRig) return animateRig;
  const rig = readFileSync(new URL('../js/pro/rig.js', import.meta.url), 'utf8').match(/export const HIP = [^;]*;/)[0];
  // (a stand-in that takes any call and gives itself back: the joints' angles are worked out on it and thrown away)
  const stub = `const h = { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : P), apply: () => P, construct: () => P, set: () => true }; const P = new Proxy(function () {}, h);
    export const Vector3 = P, Matrix4 = P, Quaternion = P;`;
  const data = s => 'data:text/javascript,' + encodeURIComponent(s);
  const hook = `export async function resolve(spec, ctx, next) {
    if (spec === 'three') return { url: ${JSON.stringify(data(stub))}, shortCircuit: true };
    if (spec === './rig.js' && ctx.parentURL && ctx.parentURL.endsWith('/pro/motion.js')) return { url: ${JSON.stringify(data(rig))}, shortCircuit: true };
    return next(spec, ctx); }`;
  register(data(hook));
  ({ animateRig } = await import('../js/pro/motion.js'));
  return animateRig;
}
const fakeRig = seed => {
  const o = () => ({ set() {}, setScalar() {} }), part = () => ({ rotation: o(), position: o(), scale: o() });
  const P = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : P), apply: () => P });
  const legs = [0, 1].map(() => ({ hip: { position: { x: 0 }, quaternion: P }, knee: { rotation: {} }, foot: { quaternion: P } }));
  const g = { userData: { seed, legs, arms: [part(), part()], elbows: [{ rotation: {} }, { rotation: {} }], pelvis: part(), torso: part(), head: part(), blob: part(), yaw: null, face: null },
    pos: [0, 0, 0], rotation: o() };
  g.position = { set: (x, y, z) => { g.pos[0] = x; g.pos[1] = y; g.pos[2] = z; } };
  return g;
};

// ---- the screen ----
function screen(cam, x, y, z, VW = STAND.VW, VH = STAND.VH) {
  if (!cam) return null;
  const f = [cam.tgt[0] - cam.eye[0], cam.tgt[1] - cam.eye[1], cam.tgt[2] - cam.eye[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r) || 1; r = r.map(v => v / rl);
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], d = [x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]];
  const zz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (zz < .3) return null;
  const F = Math.max(VH * cam.Ff, VW * (cam.Fw || 0));
  return [VW / 2 + F * (d[0] * r[0] + d[1] * r[1]) / zz, VH / 2 - F * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zz];
}
const onScreen = p => !!p && p[0] >= 0 && p[0] <= STAND.VW && p[1] >= 0 && p[1] <= STAND.VH;

// The phase a frame is in (above), or null (not counted: a celebration, the feedback, between flows).
export function phaseOf(g) {
  const live = g.mode === 'match' || g.mode === 'free', dead = !!g.sc?.restart;
  if (g.phase === 'decide' && g.win) return dead ? 'restart' : g.win.demo?.crawl != null ? 'crawl' : 'window';
  if (g.phase === 'pre') return dead ? 'restart' : 'runup';
  if (g.phase === 'outcome') return live ? 'live' : 'outcome';
  return null;
}
// Who is not counted now: his own player, keepers, the one who comes (and a second) while a choice is being set up or open.
function skipOf(g) {
  const p = g.win?.plan || (g.phase === 'pre' ? g.wplan : null), out = new Set(['hero']);
  if (p) { if (p.threat?.id) out.add(p.threat.id); if (p.second) out.add(p.second); }
  if (g.win?.threat?.id) out.add(g.win.threat.id);
  return out;
}

// A per-frame watcher for one game: poses everyone, and counts each player's whole seconds in a phase.
// tally: { [phase]: { n, still, role: { friend: [n, still], foe: [n, still] } } }
export function standWatch(g, tally, { mode = '' } = {}) {
  const s0 = () => g.sim;
  const rigs = new Map(), spans = new Map(); let lastRestores = null;
  const add = (ph, role, still, who, v, rooted) => { const t = tally[ph] ||= { n: 0, still: 0, role: {}, who: [], v: [], live: 0, rooted: 0, rw: [] }; t.n++; t.v.push(v); if (rooted != null) { t.live++; if (rooted) { t.rooted++; if (t.rw.length < 400) t.rw.push(who); } } if (still) { t.still++; if (t.who.length < 400) t.who.push(who); } const r = t.role[role] ||= [0, 0]; r[0]++; if (still) r[1]++; };
  const close = (id, sp) => { spans.delete(id); };
  const fn = () => {
    const s = g.sim, cam = g.cam, ph = phaseOf(g), skip = skipOf(g), T = g.realTime || 0, clock = g.ui?.clock ?? T;
    if (s.restores !== lastRestores) { lastRestores = s.restores; }
    for (const a of s.agents.values()) {
      if (a.gk) continue;
      let r = rigs.get(a.id); if (!r || r.agent !== a) { r = { g: fakeRig(1 + (a.id.charCodeAt(1) * 7 + (a.team === 'us' ? 3 : 0)) % 10 * .5), agent: a }; rigs.set(a.id, r); }
      animateRig(r.g, a, s, 0, 0, clock);
      const m = r.g.userData.m, hp = r.g.pos, F = m.fl.map(f => [f.px, f.py, f.P[2]]), yaw = r.g.userData.yaw;
      const counted = ph && !skip.has(a.id) && cam && onScreen(screen(cam, hp[0], hp[1], .9));
      let sp = spans.get(a.id);
      if (sp && (!counted || sp.ph !== ph)) { close(a.id, sp); sp = null; }
      if (!counted) continue;
      const H = () => { const A = screen(cam, hp[0], hp[1], 0), B = screen(cam, hp[0], hp[1], 1.65); return A && B ? Math.hypot(A[0] - B[0], A[1] - B[1]) : 0; }; // (his height on the screen)
      if (!sp) { spans.set(a.id, { ph, t0: T, hp: [...hp], F: F.map(f => [...f]), yaw, mHip: 0, mFoot: 0, mYaw: 0, H: H(), g0: [a.x, a.y], b0: [s.ball.x, s.ball.y], bm: 0 }); continue; }
      sp.bm = Math.max(sp.bm, Math.hypot(s.ball.x - sp.b0[0], s.ball.y - sp.b0[1]));
      // (each place against where it was as the second began, both through the camera of this moment)
      const px = (p, q) => { const A = screen(cam, p[0], p[1], p[2]), B = screen(cam, q[0], q[1], q[2]); return A && B ? Math.hypot(A[0] - B[0], A[1] - B[1]) : 0; };
      sp.mHip = Math.max(sp.mHip, px([hp[0], hp[1], .9], [sp.hp[0], sp.hp[1], .9]));
      for (let i = 0; i < 2; i++) sp.mFoot = Math.max(sp.mFoot, px(F[i], sp.F[i]));
      sp.mYaw = Math.max(sp.mYaw, Math.abs(Math.atan2(Math.sin(yaw - sp.yaw), Math.cos(yaw - sp.yaw))) * 180 / Math.PI);
      if (T - sp.t0 >= 1 - 1e-6) {
        const lim = STAND.k * Math.max(sp.H, 1), still = sp.mHip < lim && sp.mFoot < lim && sp.mYaw < STAND.yaw, role = a.team === s.a('hero')?.team ? 'friend' : 'foe';
        add(ph, role, still, `${mode} ${g.sc?.id || ''} ${a.id} ${ph} ${T.toFixed(1)}s hip ${sp.mHip.toFixed(1)}px foot ${sp.mFoot.toFixed(1)}px of ${sp.H.toFixed(0)}px turn ${Math.round(sp.mYaw)}° al ${(m.al||0).toFixed(2)} w ${(m.w||0).toFixed(2)} va ${(m.va||0).toFixed(2)} car ${s.ball.carrier === a.id ? 1 : 0} kt ${a.kickAt != null ? (s.time - a.kickAt).toFixed(2) : '-'} ax ${(m.ax||0).toFixed(2)},${(m.ay||0).toFixed(2)}`, [sp.mHip / sp.H, sp.mFoot / sp.H, sp.mYaw],
          // (rooted: in play at full speed, the ball moving 2 m or more in that second and he, in the game itself, less than 0.3 m)
          (ph === 'outcome' || ph === 'live' || ph === 'runup') && sp.bm >= ROOT.ball ? Math.hypot(a.x - sp.g0[0], a.y - sp.g0[1]) < ROOT.him : null);
        spans.set(a.id, { ph, t0: T, hp: [...hp], F: F.map(f => [...f]), yaw, mHip: 0, mFoot: 0, mYaw: 0, H: H(), g0: [a.x, a.y], b0: [s.ball.x, s.ball.y], bm: 0 });
      }
    }
  };
  fn.rigs = rigs;
  // where each player is drawn (his place in the game and his own small move, pro/motion.js ALIVE): for the grade of what is seen
  fn.drawn = () => { const out = {}; for (const a of s0().agents.values()) { const m = rigs.get(a.id)?.g.userData.m; out[a.id] = [a.x + (m?.ax || 0), a.y + (m?.ay || 0)]; } return out; };
  return fn;
}

// ---- the flows ----
const seeded = seed => { let x = seed * 7907 + 11; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; };
const setup = g => { g.world.canvas = { clientWidth: STAND.VW, clientHeight: STAND.VH }; };
async function lessons(tally) {
  for (const sk of PATH) for (const sc of allScenarios(sk.id)) {
    if (sc.kind === 'tackle') continue;
    seeded(3); const { g } = makeGame(); setup(g); g.mode = 'lesson'; g.levelOf = () => 1; const w = standWatch(g, tally, { mode: 'lesson' });
    let ua = null; const best = sc.best || (sc.spots ? 'spot:' + sc.spots[0].id : 'drib:fwd');
    const pick = gm => { if (!gm.win) return best; ua ??= .5; return gm.win.u >= ua ? best : null; };
    try { g.load(sc); await drive(g, g.pre(), { onFrame: w }); const o = await drive(g, g.decide(), { pick, onFrame: w }); await drive(g, g.outcome(o, g.isGood(o)), { onFrame: w }); } catch (e) { tally.errors = (tally.errors || 0) + 1; if (process.env.STAND_DEBUG) console.error(e); }
  }
}
async function demos(tally) {
  for (const sk of PATH) {
    seeded(4); const { g } = makeGame(); setup(g); const w = standWatch(g, tally, { mode: 'demo' });
    try { await drive(g, g.demo(sk.id), { onFrame: w, maxSec: 120 }); } catch (e) { tally.errors = (tally.errors || 0) + 1; if (process.env.STAND_DEBUG) console.error(e); }
  }
}
async function matches(tally, n) {
  for (let seed = 1; seed <= n; seed++) {
    seeded(seed); const { g } = makeGame(); setup(g); g.skills = new Set(PATH.map(s => s.id)); const w = standWatch(g, tally, { mode: 'match' + seed });
    const pick = gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null; if (!gm.lookUp) gm.lookUp = true; if (gm.win && gm.win.u < .45) return null; return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); };
    try { await drive(g, g.match(PATH.map(s => s.id), [], 3, 'free'), { pick, onFrame: w, maxSec: 900 }); } catch (e) { tally.errors = (tally.errors || 0) + 1; if (process.env.STAND_DEBUG) console.error(e); }
  }
}

// Runs the flows at each size; returns { fails, text, tallies }.
export async function standAudit({ sizes = Object.keys(SIZES).filter(k => SIZES[k].offer), nMatch = 10, log = console.log, verbose = false } = {}) {
  await poser();
  let fails = 0; const tallies = {};
  for (const size of sizes) {
    setSize(size); const tally = tallies[size] = {};
    await lessons(tally); await demos(tally); await matches(tally, nMatch);
    const row = ph => { const t = tally[ph]; if (!t) return `${ph.padEnd(8)}      -`; const sh = t.still / t.n, lim = LIMIT[ph], bad = lim != null && sh > lim + 1e-9; if (bad) fails++;
      const roles = Object.entries(t.role).map(([k, [n, st]]) => `${k} ${(100 * st / n).toFixed(0)}% of ${n}`).join(', ');
      return `${bad ? 'MISS' : lim != null ? 'ok  ' : '    '} ${ph.padEnd(8)} ${(100 * sh).toFixed(1).padStart(5)}% standing of ${String(t.n).padStart(5)} player-seconds${lim != null ? ` (at most ${lim * 100}%)` : ' (not limited)'}; ${roles}${t.live ? `; rooted while the ball moves ${(100 * t.rooted / t.live).toFixed(1)}% of ${t.live}` : ''}`; };
    log(`  ${size}: ${['runup', 'window', 'crawl', 'outcome', 'live', 'restart'].map(row).join('\n  ' + size + ': ')}${tally.errors ? `\n  ${size}: ${tally.errors} flow(s) did not finish` : ''}`);
    if (tally.errors) fails += tally.errors;
    if (verbose) for (const ph of Object.keys(tally)) for (const w of (tally[ph].who || []).slice(0, 25)) log('     ' + w);
  }
  return { fails, tallies };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), i = args.indexOf('--matches'), sz = args[0] && !args[0].startsWith('--') ? [args[0]] : undefined;
  console.log(`Standing: the share of a second of real time in which a player round his own (not him, not the one who comes) moves less than ${STAND.k * 100}% of his height on the screen at ${STAND.VW}x${STAND.VH}, feet and hips, and turns less than ${STAND.yaw}°:`);
  const { fails } = await standAudit({ sizes: sz, nMatch: i >= 0 ? +args[i + 1] : 10, verbose: args.includes('--v') });
  console.log(fails ? `${fails} phase(s) over the limit` : 'no phase over the limit');
  process.exitCode = fails ? 1 : 0;
}
