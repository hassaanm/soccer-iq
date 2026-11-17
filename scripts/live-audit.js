// The live-play audit (round 6): whole matches, played by a bot that taps the best choice, measured between the
// choices (the plays themselves and the moments before the next choice opens), where the team AI moves the players.
//   hover   no defender is within 1.5 m of the ball carrier for more than 0.5 s without a tackle attempt (sim.js a.tk)
//           and without being beaten (a.beat: off balance after the attempt). In a choice's window the one who is
//           already there jockeys, by design (window.js): windows are not counted.
//   yoyo    no defender's distance to the ball goes down, then up by more than 1 m, then down again within 3 s, unless
//           he made a tackle attempt in between (beaten, he is left behind and chases) or the ball changed sides or
//           was passed or shot, or it was the ball that moved away (he himself went less than 0.6 m back from it).
//   short   no live choice opens with less time than the floor (window.js windowFloor)
//   noring  every live choice has a window (a ring and a time-out)
// Usage: node scripts/live-audit.js [size] [matches] [--v]   (exit 1 on any flag)
import { PATH } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { makeGame, drive } from '../tests/harness.js';

export async function liveAudit(size, N = 4, verbose = false) {
  setSize(size); const flags = [], real = Math.random, stat = { plays: 0, windows: 0, minWin: 9, hover: 0, yoyo: 0 };
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id)); const s = g.sim, rec = []; let last = null, nDec = 0, lastWin = null;
      const side = id => (id == null ? null : s.a(id)?.team || null);
      await drive(g, g.match(PATH.map(k => k.id), [], 5, 'free'), { maxSec: 9000,
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; nDec++; stat.plays++;
            if (gm.sc.live && gm.sc.kind !== 'tackle') { if (!gm.win) flags.push(['noring', `${size} match ${seed} choice ${nDec} (${gm.sc.kind || 'attack'} ${gm.sc.id || ''}): no window`]); } }
          return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); },
        onFrame: gm => { const w = gm.win;
          if (w && w !== lastWin) { lastWin = w; stat.windows++; if (gm.sc.live) { stat.minWin = Math.min(stat.minWin, w.R); const fl = gm.windowMin(); if (w.R < fl - .05) flags.push(['short', `${size} match ${seed} choice ${nDec + 1} (${gm.sc.kind || 'attack'}): ${w.R.toFixed(2)} s, the floor is ${fl.toFixed(1)} s (G ${w.G.toFixed(2)}, ${w.plan.cls || ""}${w.plan.live ? " live" : ""}${w.plan.fromLive ? " from-live" : ""}, threat ${w.threat?.id || "none"}, run ${w.plan.r0?.toFixed(1)}→${w.plan.rP?.toFixed(1)})`]); } }
          const c = s.ball.carrier, cs = side(c);
          rec.push({ t: s.time, win: !!w, c, cs, st: s.ball.state, b: [s.ball.x, s.ball.y], at: Object.fromEntries([...s.agents.values()].filter(a => !a.gk).map(a => [a.id, [a.x, a.y, a.team, a.tk ?? -9, a.beat ?? -9]])), n: nDec, k: gm.sc?.kind, ph: gm.phase, scr: [...gm.scripted], res: gm.result }); } });
      if (process.env.LT) { const [sd, a0, a1, id] = process.env.LT.split(','); if (+sd === seed) for (const r of rec) if (r.t >= +a0 && r.t <= +a1 && r.at[id]) console.log(r.t.toFixed(2), r.ph, r.win ? 'W' : '-', r.c, r.st, id, r.at[id].slice(0, 2).map(n => n.toFixed(1)).join(','), 'd', Math.hypot(r.at[id][0] - r.b[0], r.at[id][1] - r.b[1]).toFixed(2), 'tk', r.at[id][3].toFixed(1), 'beat', r.at[id][4].toFixed(1), r.scr.includes(id) ? 'scr' : 'ai', r.res || '', r.k || ''); }
      // hover: runs of frames outside windows where a defender is within 1.5 m of the carrier
      const ids = Object.keys(rec[0]?.at || {});
      for (const id of ids) { let t0 = null, f0 = null;
        for (let i = 0; i < rec.length; i++) { const r = rec[i], a = r.at[id], on = a && !r.win && !(id === 'hero' && r.k === 'tackle') /* (his own tackle: when to go in is the choice he is making) */ && r.c && r.cs && a[2] !== r.cs && r.st !== 'flying' && Math.hypot(a[0] - r.b[0], a[1] - r.b[1]) < 1.5 && !(a[3] > r.t - .5 && a[3] <= r.t + .01) && !(a[4] > r.t);
          if (on) { if (t0 == null) { t0 = r.t; f0 = r; } else if (r.t - t0 > .5 && !f0.done) { f0.done = true; stat.hover++; flags.push(['hover', `${size} match ${seed} after choice ${r.n}: ${id} within 1.5 m of ${r.c} for more than 0.5 s with no tackle (from t=${t0.toFixed(1)})`]); } }
          else t0 = null; } }
      // yoyo: down, up more than 1 m, down again within 3 s
      for (const id of ids) { let i = 0; const D = rec.map(r => (r.at[id] ? Math.hypot(r.at[id][0] - r.b[0], r.at[id][1] - r.b[1]) : 99));
        while (i < rec.length) { const r = rec[i], a = r.at[id]; if (!a || !r.cs || a[2] === r.cs) { i++; continue; }
          // a local low after coming down by .5 m or more
          let j = i, lo = D[i]; let found = false;
          for (let k = i + 1; k < rec.length && rec[k].t - r.t <= 3; k++) { const q = rec[k];
            if (q.cs !== r.cs || q.c !== r.c || q.st === 'flying' || q.win) break; // (the ball went elsewhere, or a choice opened: the plan moves him there)
            if (D[k] < lo) { lo = D[k]; j = k; }
            if (D[k] > lo + 1 && j > i && D[i] - lo > .5 && lo < 3) { // (within three metres of it: the ones on the ball, not markers going with their players) // up by more than 1 m after a low
              if (q.at[id][3] > rec[j].t - 1.2 || q.at[id][4] > rec[j].t - 1.5) break; // (he went in for it and was beaten)
              { const A = rec[j].at[id], B = q.at[id], bx = rec[j].b[0], by = rec[j].b[1], l = Math.hypot(A[0] - bx, A[1] - by) || 1; if (((B[0] - A[0]) * (A[0] - bx) + (B[1] - A[1]) * (A[1] - by)) / l < .6) break; } // (the ball went away from him: he did not back off)
              for (let m = k + 1; m < rec.length && rec[m].t - r.t <= 3; m++) { const p = rec[m]; if (p.cs !== r.cs || p.c !== r.c || p.st === 'flying' || p.win) break; if (D[m] < D[k] - .5) { found = true; stat.yoyo++; flags.push(['yoyo', `${size} match ${seed} after choice ${r.n}: ${id} to the ball ${D[i].toFixed(1)} → ${lo.toFixed(1)} → ${D[k].toFixed(1)} → ${D[m].toFixed(1)} m in ${(p.t - r.t).toFixed(1)} s (t=${r.t.toFixed(1)})`]); i = m; break; } }
              break; } }
          i = found ? i + 1 : i + 6; } }
    }
  } finally { Math.random = real; }
  return { flags, stat };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--')), sizes = args[0] ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer); let bad = 0;
  for (const size of sizes) { const { flags, stat } = await liveAudit(size, +(args[1] || 4)); bad += flags.length;
    console.log(`${size} live play: ${stat.plays} choices, ${stat.windows} windows (shortest live ${stat.minWin.toFixed(2)} s), hover ${stat.hover}, yoyo ${stat.yoyo}`);
    const by = {}; for (const [k, m] of flags) (by[k] ||= []).push(m); for (const [k, v] of Object.entries(by)) { console.log(`  ${k}: ${v.length}`); for (const m of v.slice(0, process.argv.includes('--v') ? 99 : 6)) console.log('    ' + m); } }
  process.exitCode = bad ? 1 : 0;
}
