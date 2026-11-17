// The motion audit (v66): plays every lesson scene (and, with --gen N, N fresh scenes per lesson) at every size, through
// the decision window: every choice tapped early (5% of the window), in the middle and late (95%), and once nothing
// tapped (the time-out). The design it checks: the scene's picture holds for the whole window and one defender comes
// (window.js planHold). Checks marked "share" pass when the share of windows that meet them is at least the number
// given; every window that misses is listed. The others allow none.
//   comes    (share 95%) with our ball in open play, the one who comes is the nearest defender who is not marking a man
//            as the window opens
//   away     no defender within 3.5 m of the ball gets farther from it for more than 0.3 s of play (a marker going with
//            his man: only if he ends more than 1 m farther from it)
//   after    nobody turns more than 120° in the 0.6 s after the window closes (a tap, or the time-out): his velocity as it
//            closes against his net way over the 0.6 s after, both over 0.5 m/s
//   arrive   (share 95%) on a time-out where the threat tackles, he is within 0.8 m of the ball as the ring empties and
//            touches it within 0.3 s of real time
//   grade    (share 97% of taps) what he sees when he taps agrees with how the choice is graded: every relation that does
//            not hang on the threat as it is; the threat by his bearing and his coming (window.js agreeAt)
//   result   the play ends the same kind of way as the frozen play did (with --base: a file of v63's results)
//   size     (share 98%) his own player is at least 60 px tall at 844x390 and 48 px at 667x375 after the first 0.3 s
//   view     he never leaves the screen; the view never pulls back by more than 1.3x within 0.3 s
//   friends  (share 95% of friends) no friend ends more than 1.5 m farther from the ball than he started, or leaves the
//            view he was in
//   pace     the world never goes slower than 0.12x, and the window lasts until its ring is empty
//   closes   (share 90%) with the ball at his feet, the threat closes at least 2.5 m in the window
//   speed    nobody moves faster than a child sprints (window.js SPEED) or speeds up or slows down faster than ACC
//   turn     nobody's way turns by more than 120° in the window
//   still    nobody outfield stands still through the window; the player on the ball is never still (a dead ball apart)
//   gap      two players closer than 0.5 m
//   late     the time-out happens when the ring is empty (u = 1)
// An exemption names a pattern and a reason (EXEMPT, below), and every use of one is counted in the output.
// Usage: node scripts/motion-audit.js [size] [--gen N] [--base results.json] [--only skill] [--scene id] [--json out.json] [--notaps]
import { PATH, allScenarios } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { generate } from '../js/generate.js';
import { agreeAt, kindOf, SPEED, ACC, PACE } from '../js/window.js';
import { optionsFor, makeGame, drive } from '../tests/harness.js';
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const sizes = args[0] && !args[0].startsWith('--') ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer);
const nGen = +(flag('--gen') || 0), scene = flag('--scene'), base = flag('--base') ? JSON.parse(readFileSync(flag('--base'), 'utf8')) : null, only = flag('--only'), taps = args.includes('--notaps') ? [] : [.05, .5, .95];
export const LIM = { speed: SPEED.sprint[1] + .05, acc: ACC + .5, turn: 120, still: SPEED.stand, gap: .5, near: 3.5, away: .3, awayRate: .25, markGrow: 1, after: .6, afterTurn: 120, reach: .8, touch: .3,
  px: { 844: 60, 667: 48 }, pull: 1.3, pullT: .3, friendFar: 1.5, closes: 2.5 };
export const SHARE = { comes: .95, arrive: .95, grade: .97, size: .98, friends: .95, closes: .9 };
// Exemptions: [check, test(sc, row), reason]. Each use is counted and printed.
export const EXEMPT = [
  ['arrive', sc => kindOf(sc) === 'receive', 'a pass on its way to him: the window ends as the ball gets to him, with the defender behind at his place in the picture and still coming; he takes it a moment later'],
  ['arrive', sc => sc.pattern === 'keeper-out', 'the keeper who rushed out smothers the ball at his feet (he goes down on it; no touch away)'],
  ['comes', sc => sc.intro === 'won', 'won it: the player he just took it from is stumbling past behind him, and is not the one who comes'],
];
const exempt = (check, sc, row) => EXEMPT.find(e => e[0] === check && e[1](sc, row));

// What kind of end a play had (its banners), for comparing with the frozen play.
const KIND = { 'GOAL!': 'kept', 'Kept the ball!': 'kept', 'Stolen!': 'lost', 'They got it!': 'lost', 'Cut out!': 'lost', 'Stole it!': 'stopped', 'Stopped him!': 'stopped', 'They scored': 'conceded',
  'Saved!': 'saved', 'Over the bar!': 'over', 'Wide!': 'wide', 'Cleared!': 'cleared', 'He got there!': 'timeout', 'He got past!': 'timeout', 'Too late!': 'timeout', 'Ball played!': 'timeout', 'Great save!': 'kept' };
const endOf = banners => { const k = banners.map(b => KIND[b]).filter(Boolean); return k.at(-1) || 'none'; };
const sameEnd = (a, b) => a === b || (a === 'kept' && b === 'kept');

let VW = 844, VH = 390;
// Where a point is on the screen through the game's own camera (as world.js draws it), or null behind it.
function screen(cam, [x, y, z = .9]) {
  if (!cam) return null;
  const f = [cam.tgt[0] - cam.eye[0], cam.tgt[1] - cam.eye[1], cam.tgt[2] - cam.eye[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r) || 1; r = r.map(v => v / rl);
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]], d = [x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]];
  const zz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (zz < .3) return null;
  const F = Math.max(VH * cam.Ff, VW * (cam.Fw || 0));
  return [VW / 2 + F * (d[0] * r[0] + d[1] * r[1]) / zz, VH / 2 - F * (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / zz];
}
const on = (p, m = 0) => !!p && p[0] >= m && p[0] <= VW - m && p[1] >= m && p[1] <= VH - m;
const heroPx = q => { const a = screen(q.cam, [...q.at.hero, 0]), b = screen(q.cam, [...q.at.hero, 1.65]); return a && b ? a[1] - b[1] : 0; };

// One play: the run-up, the window (tap `opt` at fraction `u` of it, or nothing), the play after. Records everyone's
// way through the run-up's end, the window and the play that follows.
async function play(sc, opt, u) {
  const { g, events } = makeGame(); g.world.canvas = { clientWidth: VW, clientHeight: VH }; g.mode = 'lesson'; g.load(sc);
  const s = g.sim, rec = [], wins = [], flags = [], info = {};
  const snap = () => { const at = {}; for (const a of s.agents.values()) at[a.id] = [a.x, a.y]; return at; };
  const onFrame = gm => { rec.push({ t: s.time, real: gm.realTime, win: !!gm.win, wi: wins.length, out: gm.phase === 'outcome', pre: gm.phase === 'pre', at: snap(), ball: [s.ball.x, s.ball.y], carrier: s.ball.carrier, bstate: s.ball.state,
    cam: gm.cam && { eye: [...gm.cam.eye], tgt: [...gm.cam.tgt], Ff: gm.cam.Ff, Fw: gm.cam.Fw }, left: gm.ui.timer?.left, u: gm.win?.u }); };
  await drive(g, g.pre(), { onFrame });
  const decideAt = async want => {
    const p = g.decide(), w = g.win; if (w) wins.push({ G: w.G, R: w.R, f: w.f, t0: w.t0, threat: w.threat?.id, second: w.plan.second, kind: w.kind, k: w.plan.k, sp: w.plan.sp, cls: w.plan.cls || '?', role: w.plan.role, r0: w.plan.r0, rP: w.plan.rP, dis: w.plan.dis });
    let tapped = null;
    const pick = gm => { if (want === 'timeout') return null; if (!gm.win) return want; if (gm.win.u >= u) { tapped = { u: gm.win.u, at: snap(), t: s.time }; return want; } return null; };
    const o = await drive(g, p, { pick, onFrame, maxSec: 90 });
    if (tapped && w && want !== 'timeout' && w.plan.hold) { // what he sees when he taps
      const pos = id => ({ x: tapped.at[id][0], y: tapped.at[id][1] });
      const own = g.spot0 && g.sc.spots ? { ...g.sc, spots: g.spot0.map(sp => ({ ...sp })) } : g.sc; // (the rings as the scene put them: disagree moves them itself)
      const a = agreeAt(own, w.plan, pos, tapped.t - w.t0, { options: g.offerList(), ids: Object.keys(tapped.at).filter(id => !s.a(id)?.gk), ball: s.ball });
      info.taps = (info.taps || 0) + 1;
      if (a.dis.length || a.threat.length) (info.grade ||= []).push(`${a.dis.length ? 'shape: ' + a.dis.join(',') : ''}${a.threat.length ? ' threat: ' + a.threat.join(',') : ''}`.trim());
    }
    if (wins.length) { const x = wins.at(-1); x.closeAt = { t: s.time, real: g.realTime, u: g.lastWin?.u, winReal: g.lastWin?.real }; if (o === 'timeout') x.timeoutAt = x.closeAt; }
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

const ourBall = sc => !['defense', 'tackle', 'follow'].includes(kindOf(sc)) && !sc.restart;
const ballAt = (sc, q) => (kindOf(sc) === 'receive' ? q.at.hero : kindOf(sc) === 'follow' ? sc.shot.loose : q.ball);
const grid = (f, dt) => { const g = []; for (let t = f[0].t, k = 0; t <= f.at(-1).t + 1e-9; t += dt) { while (k + 1 < f.length && f[k + 1].t <= t) k++; g.push(f[k]); } return g; };

// The whole window of the time-out play: who comes, who goes away, the friends, the threat's run.
function shape(r, sc, st) {
  const flags = [], w = r.wins[0], f = r.rec.filter(x => x.win && x.wi === 1); if (!w || f.length < 3) return flags;
  const a = f[0], e = f.at(-1), ids = Object.keys(a.at), opp = ids.filter(id => id[0] === 'o'), ours = ids.filter(id => id === 'hero' || id[0] === 'm');
  const d = (q, id) => Math.hypot(q.at[id][0] - ballAt(sc, q)[0], q.at[id][1] - ballAt(sc, q)[1]), th = w.threat, g = grid(f, .1);
  if (ourBall(sc)) {
    // comes: the threat is the nearest defender not marking a man as it opens (marking: nearer one of ours off the ball than the ball, within 2.6 m)
    const off = ours.filter(m => m !== a.carrier && m !== (sc.carrier || (kindOf(sc) === 'receive' ? null : 'hero')));
    const marking = id => off.some(m => { const dm = Math.hypot(a.at[m][0] - a.at[id][0], a.at[m][1] - a.at[id][1]); return dm < 2.6 && dm < d(a, id); });
    if (th && th[0] === 'o') {
      const free = opp.filter(id => !marking(id)).sort((x, y) => d(a, x) - d(a, y)), ex = exempt('comes', sc);
      st.comes.n++;
      if (free[0] === th || (free[0] && Math.abs(d(a, free[0]) - d(a, th)) < .15)) st.comes.ok++;
      else if (ex) { st.comes.ok++; st.use(ex); }
      else st.comes.miss.push(`${st.size} ${sc.id}: ${th} comes from ${d(a, th).toFixed(1)} m; ${free[0] || 'nobody free'} is the nearest free one (${free[0] ? d(a, free[0]).toFixed(1) : '-'} m, ${w.role?.[free[0]] || '?'}); the threat is ${marking(th) ? 'marking by the measure' : 'free'} (${w.cls})`);
    }
    // away: a defender near the ball getting farther from it
    for (const id of opp) {
      let run = 0, from = 0, worst = 0, grew = 0;
      for (let i = 1; i < g.length; i++) { const dt = g[i].t - g[i - 1].t || .1, d0 = d(g[i - 1], id), d1 = d(g[i], id);
        if (d0 < LIM.near && (d1 - d0) / dt > LIM.awayRate) { if (!run) from = d0; run += dt; if (run > worst) { worst = run; grew = d1 - from; } } else run = 0; }
      const marker = (w.role?.[id] || '').startsWith('marker:');
      if (worst > LIM.away + 1e-9 && (!marker || d(e, id) - d(a, id) > LIM.markGrow)) flags.push(['away', `${id} (${w.role?.[id] || '?'}) within ${LIM.near} m of the ball gets ${grew.toFixed(1)} m farther from it over ${worst.toFixed(1)} s`]);
    }
    // closes: with the ball at his feet
    if (th && a.carrier === 'hero' && kindOf(sc) !== 'receive') { st.closes.n++; const c = d(a, th) - d(e, th); if (c >= LIM.closes) st.closes.ok++; else st.closes.miss.push(`${st.size} ${sc.id}: ${th} closes ${c.toFixed(1)} m (from ${d(a, th).toFixed(1)} m; ${w.cls}, in the picture ${w.rP?.toFixed(1)} m)`); }
    // friends: never away from the ball, never out of the view they were in
    for (const m of ours.filter(m => m !== 'hero' && m !== a.carrier)) {
      st.friends.n++;
      const far = d(e, m) - d(a, m), early = f.filter(x => x.real - a.real <= .3), was = early.every(x => on(screen(x.cam, [...x.at[m], .9]))), left = was && f.some(x => !on(screen(x.cam, [...x.at[m], .9])));
      if (far > LIM.friendFar) st.friends.miss.push(`${st.size} ${sc.id}: ${m} ends ${far.toFixed(1)} m farther from the ball`);
      else if (left) st.friends.miss.push(`${st.size} ${sc.id}: ${m} leaves the view`);
      else st.friends.ok++;
    }
  }
  return flags;
}
// His own player on the screen, from the last moments of the run-up through the window (at the size VW x VH).
function views(r, sc, st) {
  const flags = [], w = r.wins[0], f = r.rec.filter(x => x.win && x.wi === 1 && x.cam); if (!w || f.length < 3) return flags;
  const a = f[0], late = f.filter(x => x.real - a.real >= .3), px = late.map(heroPx), min = Math.min(...px), need = LIM.px[VW];
  const S = st.size_[VW]; S.n++; if (min >= need) S.ok++; else S.miss.push(`${st.size} ${sc.id} (${kindOf(sc)}): his player ${Math.round(min)} px at ${VW}x${VH} (needs ${need})`);
  S.all.push(min);
  if (f.some(x => !on(screen(x.cam, [...x.at.hero, .9])))) flags.push(['view', `his player off the screen for ${f.filter(x => !on(screen(x.cam, [...x.at.hero, .9]))).length} frame(s) at ${VW}x${VH}`]);
  // pull-back: his size against 0.3 s earlier, from 0.3 s before it opens to its end
  const seq = r.rec.filter(x => x.cam && x.wi <= 1 && !x.out && x.real >= a.real - .3 && x.real <= f.at(-1).real); let worst = 1;
  for (let i = 0, j = 0; i < seq.length; i++) { while (seq[i].real - seq[j].real > LIM.pullT) j++; const p0 = heroPx(seq[j]), p1 = heroPx(seq[i]); if (p0 > 0 && p1 > 0) worst = Math.max(worst, p0 / p1); }
  if (worst > LIM.pull + .005) flags.push(['view', `the view pulls back ${worst.toFixed(2)}x within ${LIM.pullT} s at ${VW}x${VH}`]);
  return flags;
}
// After the window closes (a tap or the time-out): nobody turns round. His own player does what was tapped (a turn
// with the ball is his choice), and a keeper sets himself: neither counts.
function after(r, sc) {
  const flags = [];
  for (let wi = 1; wi <= r.wins.length; wi++) {
    const w = r.wins[wi - 1], inW = r.rec.filter(x => x.win && x.wi === wi), post = r.rec.filter(x => !x.win && x.wi === wi && x.t > (inW.at(-1)?.t ?? 1e9) && x.t <= inW.at(-1).t + LIM.after + 1e-9);
    if (inW.length < 4 || post.length < 3) continue;
    // (as the review measured it: his velocity over the last moments of the window against his net way over the 0.6 s after)
    const e = inW.at(-1), b0 = inW[Math.max(0, inW.length - 6)], T0 = e.t - b0.t, b1 = post.at(-1), T1 = b1.t - e.t; if (T0 < .01 || T1 < LIM.after * .8) continue;
    const turnsBack = /^drib:(back|bl|br)/.test(r.o || '') || /^turn:/.test(r.o || ''); // (his own choice to turn with the ball)
    for (const id of Object.keys(e.at)) {
      if (id[0] === 'k' || (id === 'hero' && turnsBack)) continue;
      const v0 = [(e.at[id][0] - b0.at[id][0]) / T0, (e.at[id][1] - b0.at[id][1]) / T0], v1 = [(b1.at[id][0] - e.at[id][0]) / T1, (b1.at[id][1] - e.at[id][1]) / T1], s0 = Math.hypot(...v0), s1 = Math.hypot(...v1); if (s0 < .5 || s1 < .5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (v0[0] * v1[0] + v0[1] * v1[1]) / (s0 * s1)))) * 180 / Math.PI;
      if (ang > LIM.afterTurn) flags.push(['after', `${id} (${w.role?.[id] || '?'}) turns ${Math.round(ang)}° within ${LIM.after} s of the window closing (${s0.toFixed(1)} then ${s1.toFixed(1)} m/s)`]);
    }
  }
  return flags;
}
// The checks on the recorded ways inside each window.
function motion(r, sc) {
  for (let i = 1; i <= r.wins.length; i++) motionIn(r, sc, r.rec.filter(f => f.win && f.wi === i));
  return r.flags;
}
function motionIn(r, sc, inWin) {
  const { flags } = r;
  if (inWin.length < 3) return flags;
  const g = grid(inWin, .05), dt = .05, ids = Object.keys(inWin[0].at), gk = id => id[0] === 'k';
  for (const id of ids) {
    const v = []; for (let i = 1; i < g.length; i++) { const a = g[i - 1].at[id], b = g[i].at[id], T = g[i].t - g[i - 1].t || dt; v.push([(b[0] - a[0]) / T, (b[1] - a[1]) / T]); }
    if (!v.length) continue;
    const sp = v.map(q => Math.hypot(...q)), max = Math.max(...sp);
    if (max > LIM.speed) flags.push(['speed', `${id} ${max.toFixed(1)} m/s`]);
    for (let i = 2; i < v.length; i++) { const a = Math.hypot(v[i][0] - v[i - 2][0], v[i][1] - v[i - 2][1]) / (2 * dt); if (a > LIM.acc) { flags.push(['speed', `${id} accel ${a.toFixed(1)} m/s²`]); break; } }
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (sp[i] > .4 && sp[j] > .4) {
      const c = (v[i][0] * v[j][0] + v[i][1] * v[j][1]) / (sp[i] * sp[j]); if (c < Math.cos(LIM.turn * Math.PI / 180)) { flags.push(['turn', `${id} turned ${Math.round(Math.acos(Math.max(-1, c)) * 180 / Math.PI)}° in the window`]); i = v.length; break; }
    }
    if (!gk(id) && max < LIM.still && g.length > 4 && !(sc.restart && id === (sc.carrier || 'hero'))) flags.push(['still', `${id} still through the window`]); // (a restart's taker stands over the dead ball)
  }
  // the player on the ball keeps it moving
  const c0 = inWin[0].carrier; if (c0 && ids.includes(c0) && !sc.restart && !gk(c0)) { const a = inWin[0].at[c0], b = inWin.at(-1).at[c0], T = inWin.at(-1).t - inWin[0].t; if (T > .2 && Math.hypot(b[0] - a[0], b[1] - a[1]) / T < .2) flags.push(['still', `${c0} on the ball nearly still`]); }
  for (const f of inWin) { const at = Object.entries(f.at); for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) { const d = Math.hypot(at[i][1][0] - at[j][1][0], at[i][1][1] - at[j][1][1]); if (d < LIM.gap) { flags.push(['gap', `${at[i][0]}–${at[j][0]} ${d.toFixed(2)} m`]); return flags; } } }
  return flags;
}
// The time-out: when it comes, how long the window was, and the threat getting to the ball.
function timeout(r, sc, st) {
  const { rec, wins, flags } = r, w = wins[0]; if (!w) return flags;
  if (!w.timeoutAt) { flags.push(['late', 'no time-out']); return flags; }
  if (Math.abs(w.timeoutAt.u - 1) > .03) flags.push(['late', `time-out at u=${w.timeoutAt.u?.toFixed(2)}`]);
  if (w.f < PACE - 1e-6) flags.push(['pace', `the world at ${w.f.toFixed(3)}x`]);
  if (w.timeoutAt.winReal < w.R * .93 - .25 || w.timeoutAt.winReal > w.R * 1.03 + .1) flags.push(['pace', `the window lasted ${w.timeoutAt.winReal?.toFixed(1)} s of its ${w.R.toFixed(1)} s`]);
  const inW = rec.filter(x => x.win && x.wi === 1); if (inW.some((x, i) => i && x.left > inW[i - 1].left + 1e-9) || (inW.at(-1)?.left ?? 0) > .03) flags.push(['pace', `the ring is not empty as it ends (${inW.at(-1)?.left?.toFixed(2)})`]);
  const k = kindOf(sc), tackle = (k === 'attack' || k === 'lead' || k === 'support' || k === 'goal' || k === 'receive') && !sc.restart && w.threat && !sc.gk?.hold;
  if (!tackle) return flags;
  const ex = exempt('arrive', sc); st.arrive.n++;
  if (ex) { st.arrive.ok++; st.use(ex); return flags; }
  const e = inW.at(-1), dE = Math.hypot(e.at[w.threat][0] - e.ball[0], e.at[w.threat][1] - e.ball[1]), out = rec.filter(f => f.out);
  // (he touches it: within reach of it, or it is on its way off his foot, or his)
  const touch = out.find(f => f.at[w.threat] && (Math.hypot(f.at[w.threat][0] - f.ball[0], f.at[w.threat][1] - f.ball[1]) < .65 || f.carrier === w.threat || (f.bstate === 'flying' && f.carrier == null))), gap = touch ? touch.real - w.timeoutAt.real : 9;
  r.gap = gap; r.dEnd = dE;
  if (dE <= LIM.reach + 1e-6 && gap <= LIM.touch + 1e-6) st.arrive.ok++;
  else st.arrive.miss.push(`${st.size} ${sc.id} (${k}, ${w.cls}): ${w.threat} is ${dE.toFixed(2)} m from the ball as the ring empties and touches it ${gap === 9 ? 'never' : gap.toFixed(2) + ' s later'}`);
  return flags;
}

const all = [], counts = {}, mis = [], used = new Map(), stats = {};
const mkShare = () => ({ n: 0, ok: 0, miss: [] });
for (const size of sizes) {
  setSize(size);
  const st = stats[size] = { size, comes: mkShare(), arrive: mkShare(), closes: mkShare(), friends: mkShare(), grade: mkShare(), size_: { 844: { ...mkShare(), all: [] }, 667: { ...mkShare(), all: [] } }, f: [], G: [], cls: {},
    use: e => used.set(e, (used.get(e) || 0) + 1) };
  for (const sk of PATH.filter(s => s.ready && (!only || s.id === only))) {
    const scs = [...allScenarios(sk.id), ...Array.from({ length: nGen }, (_, i) => generate(sk.id, 5001 + i, { even: true })).filter(Boolean).map(s => ({ ...s, id: s.id + 'e' }))];
    for (const sc of scs) {
      if (kindOf(sc) === 'tackle' || (scene && sc.id !== scene)) continue;
      const row = { size, skill: sk.id, sc: sc.id, kind: kindOf(sc), plays: [] };
      for (const opt of taps.length ? optionsFor(sc) : []) for (const u of taps) {
        const r = await play(sc, opt, u), fl = motion(r, sc), end = endOf(r.banners), want = base?.[`${size}|${sk.id}|${sc.id}|${opt}`];
        for (const x of after(r, sc)) fl.push(x);
        st.grade.n += r.info.taps || 0; st.grade.ok += (r.info.taps || 0) - (r.info.grade?.length || 0); for (const m of r.info.grade || []) st.grade.miss.push(`${size} ${sc.id} ${opt}@${u}: ${m}`);
        if (want && !sameEnd(end, endOf(want))) fl.push(['result', `${end} (frozen: ${endOf(want)})`]);
        row.plays.push({ opt, u, end, flags: fl });
      }
      VW = 844; VH = 390;
      const r = await play(sc, null, 1), fl = timeout(r, sc, st); motion(r, sc);
      for (const x of [...shape(r, sc, st), ...views(r, sc, st), ...after(r, sc)]) fl.push(x);
      VW = 667; VH = 375; { const r2 = await play(sc, null, 1); for (const x of views(r2, sc, st)) fl.push(x); } VW = 844; VH = 390;
      const w = r.wins[0];
      row.plays.push({ opt: 'timeout', u: 1, end: endOf(r.banners), flags: fl, gap: r.gap, dEnd: r.dEnd });
      if (w) { row.win = { G: +w.G.toFixed(2), R: +w.R.toFixed(1), f: +w.f.toFixed(3), threat: w.threat, second: w.second, k: w.k, sp: w.sp, cls: w.cls, r0: w.r0, rP: w.rP, dis: w.dis }; st.f.push(w.f); st.G.push(w.G); (st.cls[`${row.kind} ${w.cls}`] ||= []).push(sc.id); if (w.dis?.length) fl.push(['plan', `the shape does not hold all through: ${w.dis.join(',')}`]); }
      for (const p of row.plays) for (const [k2, m] of p.flags) { counts[`${size} ${k2}`] = (counts[`${size} ${k2}`] || 0) + 1; mis.push(`${size} ${sc.id} ${p.opt}@${p.u}: ${k2}: ${m}`); }
      all.push(row);
    }
    process.stderr.write(`${size} ${sk.id} done\n`);
  }
}
// ---- the summary ----
const pct = s => (s.n ? (100 * s.ok / s.n).toFixed(1) + '%' : '-'), q = v => { v = [...v].sort((a, b) => a - b); return v.length ? `${v[0].toFixed(2)}–${v.at(-1).toFixed(2)} (median ${v[v.length >> 1].toFixed(2)})` : '-'; };
let fails = 0;
for (const [size, st] of Object.entries(stats)) {
  console.log(`\n== ${size}: ${all.filter(r => r.size === size).length} scenes`);
  console.log(`  world speed ${q(st.f)}x; play in a window ${q(st.G)} s`);
  console.log('  windows by kind and class (full: a run-in of 2.5 m or more; short: less, where the pitch, the other players or the picture allow no more; calm: the play drifts at under a walk; dead: a dead ball; no-threat: their dribbler comes on):');
  for (const [k, v] of Object.entries(st.cls)) console.log(`    ${k.padEnd(20)} ${v.length}${v.length < 7 ? '  ' + v.join(' ') : ''}`);
  const rows = [['comes', st.comes, 'the one who comes is the nearest free defender as it opens'], ['arrive', st.arrive, 'within 0.8 m as the ring empties, touch within 0.3 s'], ['grade', st.grade, 'the picture agrees with the grade at the tap'],
    ['size', st.size_[844], 'his player 60 px at 844x390'], ['size', st.size_[667], 'his player 48 px at 667x375'], ['friends', st.friends, 'friends neither go away from the ball nor leave the view'], ['closes', st.closes, 'the threat closes 2.5 m with the ball at his feet']];
  for (const [k, s, what] of rows) {
    const ok = !s.n || s.ok / s.n >= SHARE[k] - 1e-9; if (!ok) { fails++; counts[`${size} ${k}-share`] = 1; }
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${k.padEnd(8)} ${String(s.ok).padStart(4)}/${String(s.n).padEnd(4)} ${pct(s).padStart(6)} (needs ${SHARE[k] * 100}%)  ${what}${s.all ? `; smallest ${Math.round(Math.min(...s.all))} px, median ${Math.round([...s.all].sort((a, b) => a - b)[s.all.length >> 1])} px` : ''}`);
    for (const m of s.miss.slice(0, 40)) console.log('         ' + m);
    if (s.miss.length > 40) console.log(`         … ${s.miss.length - 40} more`);
  }
}
const gaps = all.flatMap(r => r.plays.filter(p => p.gap != null && p.gap < 9).map(p => p.gap)).sort((a, b) => a - b), dEnds = all.flatMap(r => r.plays.filter(p => p.dEnd != null).map(p => p.dEnd)).sort((a, b) => a - b);
if (gaps.length) console.log(`\nthe threat as the ring empties: ${dEnds[0].toFixed(2)}–${dEnds.at(-1).toFixed(2)} m from the ball (median ${dEnds[dEnds.length >> 1].toFixed(2)}); he touches it ${gaps[0].toFixed(2)}–${gaps.at(-1).toFixed(2)} s later (median ${gaps[gaps.length >> 1].toFixed(2)}, real)`);
if (used.size) { console.log('exemptions used:'); for (const [e, n] of used) console.log(`  ${e[0]}: ${n} window(s): ${e[2]}`); }
console.log('flags:', JSON.stringify(counts));
for (const m of mis.slice(0, 80)) console.log('  ' + m);
if (mis.length > 80) console.log(`  … ${mis.length - 80} more`);
if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify({ all, stats: Object.fromEntries(Object.entries(stats).map(([k, s]) => [k, { comes: s.comes, arrive: s.arrive, closes: s.closes, friends: s.friends, grade: s.grade, size: s.size_, f: s.f, G: s.G }])), mis }));
console.log(`\n${mis.length} flag(s), ${fails} share(s) missed`);
process.exitCode = mis.length || fails ? 1 : 0;
