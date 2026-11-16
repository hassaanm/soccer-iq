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
import { SIZES, setSize, TEAM } from '../js/geom.js';
import { generate } from '../js/generate.js';
import { disagree, kindOf, SPEED, ACC } from '../js/window.js';
import { optionsFor, makeGame, drive } from '../tests/harness.js';
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2), flag = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const sizes = args[0] && !args[0].startsWith('--') ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer);
const nGen = +(flag('--gen') || 0), base = flag('--base') ? JSON.parse(readFileSync(flag('--base'), 'utf8')) : null, only = flag('--only'), taps = [.05, .5, .95];
const LIM = { speed: SPEED.sprint[1] + .05, acc: ACC + .5, turn: 120, still: SPEED.stand, gap: .5, late: 1.2, lateFar: 2, reach: .9 };

// What kind of end a play had (its banners), for comparing with the frozen play.
const KIND = { 'GOAL!': 'kept', 'Kept the ball!': 'kept', 'Stolen!': 'lost', 'They got it!': 'lost', 'Cut out!': 'lost', 'Stole it!': 'stopped', 'Stopped him!': 'stopped', 'They scored': 'conceded',
  'Saved!': 'saved', 'Over the bar!': 'over', 'Wide!': 'wide', 'Cleared!': 'cleared', 'He got there!': 'timeout', 'Great save!': 'kept' };
const endOf = banners => { const k = banners.map(b => KIND[b]).filter(Boolean); return k.at(-1) || 'none'; };
const sameEnd = (a, b) => a === b || (a === 'kept' && b === 'kept');

// One play: the run-up, the window (tap `opt` at fraction `u` of it, or nothing), the play after. Records everyone's
// way in game time through the window and the time-out play.
async function play(sc, opt, u) {
  const { g, events } = makeGame(); g.mode = 'lesson'; g.load(sc);
  const s = g.sim, rec = [], wins = [], flags = [];
  const snap = () => { const at = {}; for (const a of s.agents.values()) at[a.id] = [a.x, a.y]; return at; };
  const onFrame = gm => { if (gm.win || gm.phase === 'outcome') rec.push({ t: s.time, real: gm.realTime, win: !!gm.win, wi: wins.length, out: gm.phase === 'outcome', at: snap(), ball: [s.ball.x, s.ball.y], carrier: s.ball.carrier }); };
  await drive(g, g.pre(), { onFrame });
  const decideAt = async want => {
    const p = g.decide(), w = g.win; if (w) wins.push({ G: w.G, R: w.R, f: w.f, t0: w.t0, threat: w.threat?.id, kind: w.kind, k: w.plan.k, a: w.plan.a, at0: { ...w.at0 } });
    let tapped = null;
    const pick = gm => { if (want === 'timeout') return null; if (!gm.win) return want; if (gm.win.u >= u) { tapped = { u: gm.win.u, at: snap(), t: s.time }; return want; } return null; };
    const o = await drive(g, p, { pick, onFrame, maxSec: 60 });
    if (tapped && w && want !== 'timeout') { // what he sees when he taps
      const pos = id => ({ x: tapped.at[id][0], y: tapped.at[id][1] }), at0 = id => w.at0[id] || pos(id);
      const own = g.spot0 && g.sc.spots ? { ...g.sc, spots: g.spot0.map(sp => ({ ...sp })) } : g.sc; // (the rings as the scene put them: disagree moves them itself)
      const d = disagree(own, pos, tapped.t - w.t0, { at0, options: g.offerList(), ids: Object.keys(tapped.at).filter(id => !s.a(id)?.gk), ball: s.ball });
      if (d.length) flags.push(['grade', `${d.join(',')} at u=${tapped.u.toFixed(2)}`]);
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
  return { g, rec, wins, flags, banners, o };
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
    if (!gk(id) && max < LIM.still && grid.length > 4) flags.push(['still', `${id} still through the window`]);
  }
  // the player on the ball keeps it moving
  const c0 = inWin[0].carrier; if (c0 && ids.includes(c0)) { const a = inWin[0].at[c0], b = inWin.at(-1).at[c0], T = inWin.at(-1).t - inWin[0].t; if (T > .2 && Math.hypot(b[0] - a[0], b[1] - a[1]) / T < .2) flags.push(['still', `${c0} on the ball nearly still`]); }
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

const all = [], counts = {}, mis = [];
for (const size of sizes) {
  setSize(size);
  for (const sk of PATH.filter(s => s.ready && (!only || s.id === only))) {
    const scs = [...allScenarios(sk.id), ...Array.from({ length: nGen }, (_, i) => generate(sk.id, 5001 + i, { even: true })).filter(Boolean).map(s => ({ ...s, id: s.id + 'e' }))];
    for (const sc of scs) {
      if (kindOf(sc) === 'tackle') continue;
      const row = { size, skill: sk.id, sc: sc.id, kind: kindOf(sc), plays: [] };
      for (const opt of optionsFor(sc)) for (const u of taps) {
        const r = await play(sc, opt, u), fl = motion(r, sc), end = endOf(r.banners), want = base?.[`${size}|${sk.id}|${sc.id}|${opt}`];
        if (want && !sameEnd(end, endOf(want))) fl.push(['result', `${end} (frozen: ${endOf(want)})`]);
        row.plays.push({ opt, u, end, flags: fl, win: r.wins[0] });
      }
      const r = await play(sc, null, 1), fl = timeout(r, sc); motion(r, sc).forEach(f => fl.push(f));
      row.plays.push({ opt: 'timeout', u: 1, end: endOf(r.banners), flags: fl, win: r.wins[0], gap: r.gap, far: r.far });
      row.win = r.wins[0] && { G: r.wins[0].G, f: +r.wins[0].f.toFixed(3), threat: r.wins[0].threat, k: r.wins[0].k, a: r.wins[0].a };
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
for (const far of [false, true]) { const g = all.flatMap(r => r.plays.filter(p => p.gap != null && !!p.far === far).map(p => p.gap)).sort((a, b) => a - b); if (g.length) console.log(`  threat ${far ? 'getting back from far (over 3.4 m at the end, allowed ' + LIM.lateFar : 'pressing (allowed ' + LIM.late)} s): ${g.length} time-outs, median ${g[g.length >> 1].toFixed(2)} s, max ${g.at(-1).toFixed(2)} s`); }
console.log('flags:', JSON.stringify(counts));
for (const m of mis.slice(0, 80)) console.log('  ' + m);
if (mis.length > 80) console.log(`  … ${mis.length - 80} more`);
if (flag('--json')) writeFileSync(flag('--json'), JSON.stringify(all));
console.log(`\n${mis.length} flag(s)`);
process.exitCode = mis.length ? 1 : 0;
void TEAM;
