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
//   defbest "one goes, one guards": in a live defending choice the best answer is to go to the ball only when his player
//           is our nearest to it (by a metre), and to guard when a friend is (by a metre)
//   passback after his pass in a match the friend never gives it back with a clear shot or open space ahead of him, and
//           at most once in a move
//   twoball after a defending play, never two of ours on the ball (within 2 m of their player on it, with the ball as
//           their job: his own player, and a friend who is pressing, chasing or has no job) while another of theirs
//           within 12 m of it has nobody of ours within 3 m
// Usage: node scripts/live-audit.js [size] [matches] [--v]   (exit 1 on any flag)
import { PATH } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { makeGame, drive } from '../tests/harness.js';

export async function liveAudit(size, N = 4, verbose = false) {
  setSize(size); const flags = [], real = Math.random, stat = { plays: 0, windows: 0, minWin: 9, hover: 0, yoyo: 0 };
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id)); const s = g.sim, rec = []; let last = null, nDec = 0, lastWin = null, defPlay = null, defSeen = null, defD0 = null;
      const side = id => (id == null ? null : s.a(id)?.team || null);
      await drive(g, g.match(PATH.map(k => k.id), [], 5, 'free'), { maxSec: 9000,
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; nDec++; stat.plays++;
            if (gm.sc.live && gm.sc.kind !== 'tackle') { if (!gm.win) flags.push(['noring', `${size} match ${seed} choice ${nDec} (${gm.sc.kind || 'attack'} ${gm.sc.id || ''}): no window`]); }
            // defbest: "one goes, one guards": the best answer is to go to the ball only when his player is our nearest to it
            if (gm.sc.live && gm.sc.kind === 'defense' && gm.sc.best && gm.sc.nearest) { stat.def = (stat.def || 0) + 1; const b = gm.sc.best.slice(5), goes = b === 'home' || b === 'chase'; stat['def ' + (goes ? 'go' : 'guard') + ', nearest ' + (gm.sc.nearest === 'hero' ? 'him' : gm.sc.nearest === 'close' ? 'close' : 'a friend')] = (stat['def ' + (goes ? 'go' : 'guard') + ', nearest ' + (gm.sc.nearest === 'hero' ? 'him' : gm.sc.nearest === 'close' ? 'close' : 'a friend')] || 0) + 1;
              const guardOK = (gm.sc.spots || []).some(sp => sp.id !== 'home' && sp.id !== 'chase' && !gm.sc.exploits[sp.id]);
              if (goes && gm.sc.nearest !== 'hero' && gm.sc.nearest !== 'close' && guardOK) flags.push(['defbest', `${size} match ${seed} choice ${nDec}: the best answer is to go to the ball (${b}), but ${gm.sc.nearest} is more than a metre nearer it and a guard spot stops them`]);
              if (!goes && gm.sc.nearest === 'hero' && !gm.sc.exploits.home && gm.sc.spots.some(sp => sp.id === 'home')) flags.push(['defbest', `${size} match ${seed} choice ${nDec}: the best answer is to guard (${b}), but he is our nearest to the ball by a metre and going stops them`]);
              defPlay = nDec; const c1 = s.a(gm.sc.carrier); defD0 = Object.fromEntries(s.team('us').map(a => [a.id, c1 ? Math.hypot(a.x - c1.x, a.y - c1.y) : 0])); } }
          return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); },
        onFrame: gm => { const w = gm.win;
          // twoball: after a defending play, never two of ours on the ball while one of theirs stands free
          if (defPlay != null && gm.result && gm.phase === 'outcome' && defSeen !== defPlay) { defSeen = defPlay; const c0 = s.ball.carrier && s.a(s.ball.carrier);
            if (c0 && c0.team === 'them' && !c0.gk) { const us = s.team('us').filter(a => !a.gk), onJob = a => { const j = a.id === 'hero' ? null : gm.roles?.jobs?.[a.id] ?? gm.teamJob?.[a.id]?.job; return !j || j === 'press' || j === 'chase'; }, on = us.filter(a => Math.hypot(a.x - c0.x, a.y - c0.y) < 2 && onJob(a)) /* (a friend whose job is another of their players, on his way to him round the ball when the play ended, is not on the ball) */, fr = s.team('them').filter(o => o !== c0 && !o.gk && Math.hypot(o.x - c0.x, o.y - c0.y) < 12 && us.every(a => Math.hypot(a.x - o.x, a.y - o.y) > 3));
              stat.defEnds = (stat.defEnds || 0) + 1;
              if (on.length >= 2 && fr.length) flags.push(['twoball', `${size} match ${seed} after choice ${defPlay}: ${on.map(a => a.id).join(' and ')} are within 2 m of ${c0.id} while ${fr.map(o => o.id).join(', ')} has nobody within 3 m (his job ${JSON.stringify(gm.teamJob)}, best ${gm.sc.best}, nearest ${gm.sc.nearest}, result ${gm.result}, roles ${JSON.stringify(gm.roles?.jobs)}, scripted ${[...gm.scripted]}, ${on.map(a => a.id + " tk " + (a.tk ?? -9).toFixed(1) + " beat " + (a.beat ?? -9).toFixed(1) + " now " + s.time.toFixed(1)).join("; ")})`]); } }
          if (w && w !== lastWin) { lastWin = w; stat.windows++; if (gm.sc.live) { stat.minWin = Math.min(stat.minWin, w.R); const fl = gm.windowMin(); if (w.R < fl - .05) flags.push(['short', `${size} match ${seed} choice ${nDec + 1} (${gm.sc.kind || 'attack'}): ${w.R.toFixed(2)} s, the floor is ${fl.toFixed(1)} s (G ${w.G.toFixed(2)}, ${w.plan.cls || ""}${w.plan.live ? " live" : ""}${w.plan.fromLive ? " from-live" : ""}, threat ${w.threat?.id || "none"}, run ${w.plan.r0?.toFixed(1)}→${w.plan.rP?.toFixed(1)})`]); } }
          const c = s.ball.carrier, cs = side(c);
          rec.push({ t: s.time, win: !!w, c, cs, st: s.ball.state, b: [s.ball.x, s.ball.y], at: Object.fromEntries([...s.agents.values()].filter(a => !a.gk).map(a => [a.id, [a.x, a.y, a.team, a.tk ?? -9, a.beat ?? -9]])), n: nDec, k: gm.sc?.kind, ph: gm.phase, scr: [...gm.scripted], res: gm.result }); } });
      if (process.env.LT) { const [sd, a0, a1, id] = process.env.LT.split(','); if (+sd === seed) for (const r of rec) if (r.t >= +a0 && r.t <= +a1 && r.at[id]) console.log(r.t.toFixed(2), r.ph, r.win ? 'W' : '-', r.c, r.st, id, r.at[id].slice(0, 2).map(n => n.toFixed(1)).join(','), 'd', Math.hypot(r.at[id][0] - r.b[0], r.at[id][1] - r.b[1]).toFixed(2), 'tk', r.at[id][3].toFixed(1), 'beat', r.at[id][4].toFixed(1), r.scr.includes(id) ? 'scr' : 'ai', r.res || '', r.k || ''); }
      // (one running past on his way somewhere else, to the player he guards: at 1.5 m/s or more and not at the ball: is not standing by it)
      const passing = (i, id) => { if (i < 3) return false; const A = rec[i - 3].at[id], B = rec[i].at[id], T = rec[i].t - rec[i - 3].t; if (!A || T < .01) return false; const vx = (B[0] - A[0]) / T, vy = (B[1] - A[1]) / T, sp = Math.hypot(vx, vy), bx = rec[i].b[0] - B[0], by = rec[i].b[1] - B[1], bl = Math.hypot(bx, by) || 1; return sp >= 1.5 && (vx * bx + vy * by) / (sp * bl) < .5; };
      // B (round 6): what the friend did with his pass: never back to him with a clear shot or open space ahead; at most one return in a move
      for (const f of g.friendLog || []) { stat['friend ' + f.act] = (stat['friend ' + f.act] || 0) + 1; stat.friendMaxReturns = Math.max(stat.friendMaxReturns || 0, f.returns + (f.act === 'back' ? 1 : 0));
        if (f.act === 'back' && (f.shot || f.space)) flags.push(['passback', `${size} match ${seed}: the friend gave it back with ${f.shot ? 'a clear shot' : 'open space ahead'}`]);
        if (f.act === 'back' && f.returns >= 1) flags.push(['passback', `${size} match ${seed}: a second return in one move`]); }
      // hover: runs of frames outside windows where a defender is within 1.5 m of the carrier
      const ids = Object.keys(rec[0]?.at || {});
      for (const id of ids) { let t0 = null, f0 = null;
        for (let i = 0; i < rec.length; i++) { const r = rec[i], a = r.at[id], on = a && !r.win && !(id === 'hero' && r.k === 'tackle') /* (his own tackle: when to go in is the choice he is making) */ && r.c && r.cs && a[2] !== r.cs && r.st !== 'flying' && Math.hypot(a[0] - r.b[0], a[1] - r.b[1]) < 1.5 && !(a[3] > r.t - .5 && a[3] <= r.t + .01) && !(a[4] > r.t) && !passing(i, id);
          if (on) { if (t0 == null) { t0 = r.t; f0 = r; } else if (r.t - t0 > .5 && !f0.done) { f0.done = true; stat.hover++; flags.push(['hover', `${size} match ${seed} after choice ${r.n}: ${id} within 1.5 m of ${r.c} for more than 0.5 s with no tackle (from t=${t0.toFixed(1)})`]); } }
          else t0 = null; } }
      // yoyo: down, up more than 1 m, down again within 3 s
      for (const id of ids) { let i = 0; const D = rec.map(r => (r.at[id] ? Math.hypot(r.at[id][0] - r.b[0], r.at[id][1] - r.b[1]) : 99));
        while (i < rec.length) { const r = rec[i], a = r.at[id]; if (!a || !r.cs || a[2] === r.cs) { i++; continue; }
          // a local low after coming down by .5 m or more
          let j = i, lo = D[i]; let found = false;
          for (let k = i + 1; k < rec.length && rec[k].t - r.t <= 3; k++) { const q = rec[k];
            if (q.cs !== r.cs || q.c !== r.c || q.st === 'flying' || q.win || q.n !== r.n || Math.hypot(q.at[id][0] - rec[k - 1].at[id][0], q.at[id][1] - rec[k - 1].at[id][1]) > 1.5) break; // (the ball went elsewhere, a choice opened (the plan moves him there), or a new situation was set up)
            if (D[k] < lo) { lo = D[k]; j = k; }
            if (D[k] > lo + 1 && j > i && D[i] - lo > .5 && lo < 3) { // (within three metres of it: the ones on the ball, not markers going with their players) // up by more than 1 m after a low
              if (q.at[id][3] > rec[j].t - 1.2 || q.at[id][4] > rec[j].t - 1.5) break; // (he went in for it and was beaten)
              { const A = rec[j].at[id], B = q.at[id], bx = rec[j].b[0], by = rec[j].b[1], l = Math.hypot(A[0] - bx, A[1] - by) || 1; if (((B[0] - A[0]) * (A[0] - bx) + (B[1] - A[1]) * (A[1] - by)) / l < .6) break; } // (the ball went away from him: he did not back off)
              for (let m = k + 1; m < rec.length && rec[m].t - r.t <= 3; m++) { const p = rec[m]; if (p.cs !== r.cs || p.c !== r.c || p.st === 'flying' || p.win) break; if (D[m] < D[k] - .5) { found = true; stat.yoyo++; flags.push(['yoyo', `${size} match ${seed} after choice ${r.n}: ${id} to the ball ${D[i].toFixed(1)} → ${lo.toFixed(1)} → ${D[k].toFixed(1)} → ${D[m].toFixed(1)} m in ${(p.t - r.t).toFixed(1)} s (t=${r.t.toFixed(1)})`]); i = m; break; } }
              break; } }
          i = found ? i + 1 : i + 6; } }
    }
  } finally { Math.random = real; }
  stat.counts = { hover: stat.hover, yoyo: stat.yoyo, short: flags.filter(f => f[0] === 'short').length, noring: flags.filter(f => f[0] === 'noring').length, defbest: flags.filter(f => f[0] === 'defbest').length, twoball: flags.filter(f => f[0] === 'twoball').length,
    passback: flags.filter(f => f[0] === 'passback').length, ...Object.fromEntries(Object.entries(stat).filter(([k]) => k.startsWith('def') || k.startsWith('friend'))) };
  return { flags, stat };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--')), sizes = args[0] ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer); let bad = 0;
  for (const size of sizes) { const { flags, stat } = await liveAudit(size, +(args[1] || 4)); bad += flags.length;
    console.log(`${size} live play: ${stat.plays} choices, ${stat.windows} windows (shortest live ${stat.minWin.toFixed(2)} s); ${Object.entries(stat.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const by = {}; for (const [k, m] of flags) (by[k] ||= []).push(m); for (const [k, v] of Object.entries(by)) { console.log(`  ${k}: ${v.length}`); for (const m of v.slice(0, process.argv.includes('--v') ? 99 : 6)) console.log('    ' + m); } }
  process.exitCode = bad ? 1 : 0;
}
