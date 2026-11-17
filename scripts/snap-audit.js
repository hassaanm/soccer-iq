// The snap-turn audit (round 6; the verifier's definition): every option of the first scenes of every lesson, tapped late
// (u 0.95). A snap turn: one of theirs whose heading flips more than 120° within 0.15 s of play while he goes 2 m/s or
// more both before and after, from the tap to 0.8 s after it. A turn takes a child half a second: none should be here.
// Usage: node scripts/snap-audit.js [size] [scenes per lesson, default 3]   (exit 1 when any is found)
import { PATH, allScenarios } from '../js/skills.js';
import { SIZES, setSize } from '../js/geom.js';
import { kindOf } from '../js/window.js';
import { makeGame, drive, optionsFor } from '../tests/harness.js';

const sizes = process.argv[2] ? [process.argv[2]] : Object.keys(SIZES).filter(k => SIZES[k].offer), per = +(process.argv[3] || 3); let total = 0;
for (const size of sizes) {
  setSize(size); const rows = []; let plays = 0;
  for (const sk of PATH) for (const sc of allScenarios(sk.id).slice(0, per)) {
    if (kindOf(sc) === 'tackle') continue;
    for (const opt of optionsFor(sc).filter(o => !o.startsWith('then:'))) {
      plays++; const { g } = makeGame(); g.mode = 'lesson'; g.load(sc); await drive(g, g.pre()); const s = g.sim, tr = [];
      const snap = () => Object.fromEntries([...s.agents.values()].filter(a => a.id[0] === 'o').map(a => [a.id, [a.x, a.y]]));
      const o = await drive(g, g.decide(), { maxSec: 60, pick: gm => (gm.win && gm.win.u >= .95 ? opt : null), onFrame: () => tr.push({ t: s.time, at: snap() }) });
      const tEnd = s.time;
      await drive(g, g.outcome(o, g.isGood(o)), { maxSec: 60, onFrame: () => { if (s.time - tEnd < 1) tr.push({ t: s.time, at: snap() }); } });
      const w = tr.filter(x => x.t >= tEnd - .3 && x.t <= tEnd + .8);
      for (const id of Object.keys(w[0]?.at || {})) { let worst = 0, at = null; const v = [];
        for (let i = 1; i < w.length; i++) { const dt = w[i].t - w[i - 1].t; if (dt < 1e-4) continue; v.push({ t: w[i].t, x: (w[i].at[id][0] - w[i - 1].at[id][0]) / dt, y: (w[i].at[id][1] - w[i - 1].at[id][1]) / dt }); }
        for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length && v[j].t - v[i].t <= .15; j++) { const a = v[i], b = v[j], sa = Math.hypot(a.x, a.y), sb = Math.hypot(b.x, b.y); if (sa < 2 || sb < 2 || a.t - tEnd < -.02) continue;
          const ang = Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / sa / sb))) * 180 / Math.PI; if (ang > worst) { worst = ang; at = [sa.toFixed(1), sb.toFixed(1), (a.t - tEnd).toFixed(2)]; } }
        if (worst > 120) rows.push(`${sk.id} ${sc.id} ${opt}: ${id} turns ${Math.round(worst)}° (${at[0]} then ${at[1]} m/s, ${at[2]} s after the tap)`); }
    }
  }
  total += rows.length; console.log(`${size}: ${plays} plays tapped late, snap turns: ${rows.length}`); for (const r of rows) console.log('   ' + r);
}
process.exitCode = total ? 1 : 0;
