// Frame time: how long the game's own work takes in the frames in which a choice opens or closes (npm run audit:frames,
// and at the end of npm run audit:motion).
//
// A frame that takes too long is a hitch on the phone: the picture stops, then jumps. The heavy work is all at a
// choice's edges (the window's plan, the fit of the view, the next scene), so those frames are timed here: matches at
// every size and a scene of every lesson, in Node, with the game's own frame loop (a frame, then everything that was
// waiting on it). A phone is taken as four times slower than this machine: no such frame may take more than
// FRAME_MS / 4 here (FRAME_MS: 50, three frames of a 60 Hz screen). Every run is made twice and the quicker time of each
// frame counts, so that a busy machine does not fail it.
//
// And no jump: between two frames nobody moves by more than a frame's travel (12 cm and 9 m/s of the game time gone
// by), except as his player becomes another one or a new scene is set up (both cuts). A jump is somebody put somewhere
// as a choice opens or closes: a plan that does not start where he is, bodies pushed apart at once.
//
//   node scripts/frame-audit.js [--ms 50] [--matches 3] [--size 5v5]
import { PATH, allScenarios } from '../js/skills.js';
import { setSize } from '../js/geom.js';
import * as H from '../tests/harness.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = +arg('ms', process.env.FRAME_MS || 50) / 4, MATCHES = +arg('matches', 3), SIZES = arg('size', null) ? [arg('size')] : ['3v3', '4v4', '5v5'];

// One flow, frame by frame: [{ ms, edge }] where edge names what changed in or next to that frame.
async function timed(g, promise, pick, maxSec = 9000) {
  let done = false; promise.then(() => { done = true; }, () => { done = true; });
  const out = []; let was = !!g.win, wasPh = g.phase, prev = null, cut = 0; out.jumps = [];
  if (!g.__cuts) { g.__cuts = true; for (const fn of ['takeOver', 'load']) { const f = g[fn].bind(g); g[fn] = (...a) => { g.__cut = 3; return f(...a); }; } }
  for (let t = 0, k = 0; t < maxSec && !done; k++) {
    const dt = H.frameDt(k); t += dt; const a = performance.now();
    g.tick(dt, t);
    if (g.canAct && g._choose) { const o = pick(g); if (o) { g.seen.add('m1'); g.seen.add('m2'); if (g.sim.a('m3')) g.seen.add('m3'); g.choose(o); } }
    await new Promise(r => setImmediate(r));
    const ms = performance.now() - a, now = !!g.win;
    { const at = {}; for (const p of g.sim.agents.values()) at[p.id] = [p.x, p.y]; const st = g.sim.time; if (g.__cut > 0) g.__cut--;
      else if (prev) for (const id in at) { const q = prev.at[id]; if (!q) continue; const d = Math.hypot(at[id][0] - q[0], at[id][1] - q[1]); if (d > .12 + 9 * Math.max(0, st - prev.st)) out.jumps.push(`${id} ${d.toFixed(2)} m, ${wasPh}>${g.phase}${now && !was ? ' (opens)' : was && !now ? ' (closes)' : ''} ${g.sc?.kind || 'attack'}${g.sc?.live ? ' live' : ''} ${g.sc?.id || ''}`); }
      prev = { at, st }; }
    out.push({ ms, edge: now && !was ? 'opens' : was && !now ? 'closes' : g.phase !== wasPh && (g.phase === 'pre' || wasPh === 'idle') ? 'scene' : null, what: `${wasPh}>${g.phase} ${g.sc?.kind || 'attack'}${g.sc?.live ? ' live' : ''} ${g.sc?.id || ''}` });
    was = now; wasPh = g.phase;
  }
  return out;
}
const bot = miss => gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null; if (gm.win && gm.win.u < .3) return null; if (miss(gm)) return null; return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); };
const seeded = seed => { let x = seed * 7907 + 11; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; };

async function runs(size) {
  const flows = [];
  for (let seed = 1; seed <= MATCHES; seed++) flows.push([`match ${seed}`, () => { seeded(seed); const { g } = H.makeGame(); g.skills = new Set(PATH.map(s => s.id)); let n = 0, last = null;
    return timed(g, g.match(PATH.map(s => s.id), [], 3, 'free'), bot(gm => { if (gm.win !== last) { last = gm.win; n++; } return seed === 2 && n % 4 === 0; })); }]); // (the second match lets every fourth choice time out)
  for (const sk of PATH) { const list = allScenarios(sk.id); if (!list.length) continue; const sc = list[Math.min(1, list.length - 1)];
    flows.push([`lesson ${sc.id}`, () => { seeded(5); const { g } = H.makeGame(); g.levelOf = () => 1; g.mode = 'lesson'; return timed(g, g.round(sc, { hint: false, level: 1, first: false }), bot(() => false), 200); }]); }
  const rows = [];
  for (const [name, make] of flows) {
    let a, b; try { a = await make(); b = await make(); } catch (e) { rows.push({ name, err: String(e.message || e) }); continue; }
    const n = Math.min(a.length, b.length), same = a.length === b.length;
    for (const j of a.jumps) rows.push({ name, jump: j });
    for (let i = 0; i < n; i++) { // a frame at an edge, or next to one
      const near = [i - 1, i, i + 1].map(j => a[j]?.edge).find(Boolean); if (!near) continue;
      rows.push({ name, i, edge: a[i].edge || near, ms: same ? Math.min(a[i].ms, b[i].ms) : a[i].ms, what: a[i].what });
    }
  }
  return rows;
}

export async function frameAudit({ sizes = SIZES, limit = LIMIT, log = console.log } = {}) {
  let fails = 0;
  for (const size of sizes) {
    setSize(size); const rows = await runs(size), errs = rows.filter(r => r.err), J = rows.filter(r => r.jump), R = rows.filter(r => !r.err && !r.jump);
    for (const e of errs) { fails++; log(`  ${size} ${e.name}: did not run (${e.err})`); }
    fails += J.length; log(`  ${size} jumps (somebody moved by more than a frame's travel): ${J.length}`); for (const r of J.slice(0, 6)) log(`     ${r.name}: ${r.jump}`);
    for (const edge of ['opens', 'closes', 'scene']) {
      const v = R.filter(r => r.edge === edge).sort((p, q) => q.ms - p.ms), over = v.filter(r => r.ms > limit), strict = edge !== 'scene';
      log(`  ${size} choice ${edge === 'scene' ? 'set up (a new scene: a cut, reported only)' : edge}: ${v.length} frames, worst ${v[0]?.ms.toFixed(1) ?? '-'} ms here (${((v[0]?.ms || 0) * 4).toFixed(0)} ms on a phone four times slower), over the limit: ${strict ? over.length : '-'}`);
      if (strict) { fails += over.length; for (const r of over.slice(0, 5)) log(`     ${r.ms.toFixed(1)} ms  ${r.name} frame ${r.i}: ${r.what}`); }
    }
  }
  return fails;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Frame time at a choice's edges (limit ${LIMIT.toFixed(1)} ms here, ${(LIMIT * 4).toFixed(0)} ms on a phone four times slower):`);
  const fails = await frameAudit();
  console.log(fails ? `${fails} long frames or jumps` : 'no frame over the limit, no jump');
  process.exit(fails ? 1 : 0);
}
