// Reads a pasted play log ("Record play", js/log.js) and prints what happened: a short summary first, then details on
// request. It copes with a paste that lost its line breaks or picked up spaces.
//
//   node scripts/log-read.js <file|->                 the summary of every session, flags and odd moments
//   node scripts/log-read.js <file> --decision 4      one decision: who was where, the options and grades, the tap, the
//                                                     outcome, the camera against his run, his path to the goal
//   node scripts/log-read.js <file> --scene 3         every decision of a scene, and the scene's events
//   node scripts/log-read.js <file> --flag 2          10 s before to 5 s after flag 2: events, decisions, his path
//   node scripts/log-read.js <file> --all             every decision of the session
//   --session N  another session than the last one (each app start is a session)
// Odd moments (simple rules): the camera more than 40° off his run as a choice opens; his player moving away from the
// goal before a pass or a shot; a skill move offered for under 1 s; play reset to a new situation (not a kick-off);
// an error the game logged.
import { readFileSync } from 'node:fs';
import { parse, fields, track, decisions, options, places } from '../js/log.js';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && /^\d+$/.test(args[i + 1]) ? +args[i + 1] : true) : null; };
if (!file) { console.log('Usage: node scripts/log-read.js <file|-> [--decision N | --scene N | --flag N | --all] [--session N]'); process.exit(1); }
const text = readFileSync(file === '-' ? 0 : file, 'utf8');
const recs = parse(text);
if (!recs.length) { console.log('No play log lines found (each line starts with "|<seconds> <WORD>").'); process.exit(1); }

// ---------- helpers ----------
const mmss = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const r1 = x => (Number.isFinite(+x) ? (Math.round(+x * 10) / 10).toString() : '-');
const wrapD = d => ((((d + 180) % 360) + 360) % 360) - 180;
const sessions = [...new Set(recs.map(r => r.s))];
const want = opt('session') && opt('session') !== true ? opt('session') : sessions[sessions.length - 1];
const head = s => { const h = recs.find(r => r.s === s && r.type === 'LOG'); return h ? fields(h.rest) : {}; };
const pitchOf = s => { const p = String(head(s).pitch || '30x20').split('x').map(Number); return { L: p[0] || 30, W: p[1] || 20 }; };
const rowsOf = s => recs.filter(r => r.s === s && r.type === 'T').flatMap(r => { try { return track(r).rows; } catch { return []; } }).sort((a, b) => a.t - b.t);
const ua = s => { const u = recs.find(r => r.s === s && r.type === 'UA'); const x = u ? fields(u.rest).ua || u.rest : ''; return /iPhone/.test(x) ? `iPhone (iOS ${(/OS ([\d_]+)/.exec(x)?.[1] || '?').replace(/_/g, '.')})` : /iPad/.test(x) ? 'iPad' : /Android/.test(x) ? 'Android' : /HeadlessChrome/.test(x) ? 'headless Chrome' : /Chrome/.test(x) ? 'Chrome' : /Safari/.test(x) ? 'Safari' : x.slice(0, 40); };
// Where a player is against the goal he attacks (their goal at x = L): distance, and the way he moves against the way to it.
const toGoal = (p, P) => Math.hypot(P.L - p.x, P.W / 2 - p.y);
const bearing = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
const rel = (a, h) => { const d = Math.hypot(a.x - h.x, a.y - h.y), b = bearing(h, a); return `${r1(d)} m ${b > -45 && b <= 45 ? 'ahead' : b > 45 && b <= 135 ? 'to his left' : b > -135 && b <= -45 ? 'to his right' : 'behind'}`; };

// ---------- the decisions, with what the rules find ----------
function study(s) {
  const P = pitchOf(s), rows = rowsOf(s), ds = decisions(recs).filter(d => d.s === s), odd = [];
  const rs = recs.filter(r => r.s === s);
  for (const d of ds) {
    d.odd = [];
    const off = +d.camOff; if (Number.isFinite(off) && Math.abs(off) > 40) d.odd.push(`camera ${Math.abs(off)}° off his run as it opened`);
    const o = d.choose?.opt || d.play?.opt || '';
    if (/^(pass|shoot)/.test(o)) {
      // from the open to the kick (the first row after the choice with the ball in the air), or 4 s
      // (to the kick: the first row after the choice with the ball in the air; at the latest the play's end, or 4 s)
      const t0 = d.t, tc = d.choose?.t ?? d.play?.t ?? t0, endAt = rs.find(r => r.t > tc && ['OUT', 'PLAYEND', 'SCENE', 'WIN'].includes(r.type))?.t ?? tc + 4;
      const kick = rows.find(r => r.t > tc && r.t <= endAt && r.ball.st === 'flying'), t1 = Math.min(kick ? kick.t : endAt, tc + 4);
      const path = rows.filter(r => r.t >= t0 - .05 && r.t <= t1 && r.p.hero).map(r => ({ t: r.t, d: toGoal(r.p.hero, P), h: r.p.hero }));
      if (path.length > 1) {
        const min = Math.min(...path.map(p => p.d)), end = path[path.length - 1], after = path.filter(p => p.t >= tc);
        const a0 = after[0], away = a0 ? end.d - Math.min(...after.map(p => p.d)) : 0;
        if (end.d - min > 1 || away > 1) d.odd.push(`his player moved ${r1(Math.max(end.d - min, away))} m away from the goal before the ${o.startsWith('pass') ? 'pass' : 'shot'} (${r1(min)} m → ${r1(end.d)} m)`);
        d.path = path;
      }
    }
    if (d.odd.length) odd.push(...d.odd.map(x => ({ t: d.t, what: `decision ${d.n}: ${x}` })));
  }
  for (const r of rs) {
    if (r.type === 'SKILL') { const f = fields(r.rest); if (f.is === 'missed' && +f.shown < 1) odd.push({ t: r.t, what: `skill move ${f.move} offered for only ${f.shown} s` }); }
    if (r.type === 'FRESH') { const f = fields(r.rest); if (!/kick-off/.test(f.why || '')) odd.push({ t: r.t, what: `play reset to a new situation: ${f.why} (after ${f.after})` }); }
    if (r.type === 'ERR') odd.push({ t: r.t, what: `error logged: ${r.rest}` });
  }
  odd.sort((a, b) => a.t - b.t);
  return { P, rows, ds, odd, rs };
}

// ---------- the summary ----------
function summary(s) {
  const h = head(s), { ds, odd, rs } = study(s), end = rs.length ? rs[rs.length - 1].t : 0;
  const by = k => rs.filter(r => r.type === k);
  const modes = [];
  for (const r of rs) {
    const f = fields(r.rest);
    if (r.type === 'DEMO' && f.is === 'start') modes.push(`demo ${f.skill}`);
    else if (r.type === 'ROUNDS') modes.push(`${f.log} rounds (${String(f.list || '').split(',').length})`);
    else if (r.type === 'MATCH' && f.is === 'end') modes.push(`match ${f.us}–${f.them}`);
    else if (r.type === 'KROUND' && f.is === 'end') modes.push(`keeper ${f.saves} saved`);
  }
  const grades = {}; for (const d of ds) if (d.choose) { const g = d.choose.opt === 'timeout' ? 'time-out' : d.choose.rating; grades[g] = (grades[g] || 0) + 1; }
  const sk = by('SKILL').map(r => fields(r.rest)), flags = by('FLAG');
  console.log(`Session ${s}: ${h.v || '?'} · ${h.at || '?'} · ${ua(s)}${h.app === '1' ? ' (home-screen app)' : ''} · ${h.size || '?'} · graphics ${h.gfx || '?'} · ${mmss(end)} long`);
  if (modes.length) console.log(`  Played: ${modes.join(', ')}`);
  console.log(`  ${by('SCENE').length} scenes, ${ds.length} choice windows (${ds.filter(d => d.choose).length} his taps: ${Object.entries(grades).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}); ${ds.filter(d => d.showing === '1').length} shown by the game`);
  if (sk.length) console.log(`  Skill moves: ${sk.filter(f => f.is === 'offer').length} offered, ${sk.filter(f => f.is === 'tapped').length} tapped, ${sk.filter(f => f.is === 'missed').length} missed`);
  for (const r of flags) { const f = fields(r.rest), d = [...ds].reverse().find(x => x.t <= r.t + .5); console.log(`  FLAG ${f.n} at ${mmss(r.t)}: ${near(r.t, s)}${d ? ` (decision ${d.n}, ${r1(r.t - d.t)} s after it opened)` : ''}`); }
  if (odd.length) { console.log(`  Odd (${odd.length}):`); for (const o of odd.slice(0, 12)) console.log(`    ${mmss(o.t)} ${o.what}`); if (odd.length > 12) console.log(`    … and ${odd.length - 12} more (--all)`); }
  const perf = by('PERF').map(r => r.rest); if (perf.length) console.log(`  Speed: ${perf.slice(1, 3).join('; ')}`);
  const thin = recs.filter(r => r.type === 'THIN'); if (thin.length) console.log(`  (The log was thinned to fit: ${fields(thin[0].rest).dropped})`);
}
// What was going on at time t: the scene and the mode.
function near(t, s) {
  const sc = [...recs].reverse().find(r => r.s === s && r.type === 'SCENE' && r.t <= t + .05), f = sc ? fields(sc.rest) : null;
  return f ? `scene ${f.n} (${f.mode}${f.skill ? ', ' + f.skill : ''}${f.pattern ? '/' + f.pattern : ''}${f.live === '1' ? ', from live play' : ''})` : 'no scene';
}

// ---------- details ----------
const fromRowsCam = (rows, t) => rows.reduce((b, r) => (Math.abs(r.t - t) < .08 && (!b || Math.abs(r.t - t) < Math.abs(b.t - t)) ? r : b), null)?.cam;
// Where everyone was at time t from the track row written then (a scene made from its seed has no AT line), with speeds
// from the next row (at the speed of play).
function fromRows(rows, t) {
  let i = -1; rows.forEach((r, k) => { if (Math.abs(r.t - t) < .08 && (i < 0 || Math.abs(r.t - t) < Math.abs(rows[i].t - t))) i = k; }); if (i < 0) return null;
  const r = rows[i], n = rows[i + 1], dt = n ? (n.t - r.t) * Math.max(.05, r.pace) : 0, p = {}; // (game speed: the rows are on real time, play may run slow)
  for (const [id, a] of Object.entries(r.p)) { const b = n?.p[id]; p[id] = { x: a.x, y: a.y, h: a.h > 180 ? a.h - 360 : a.h, vx: b && dt > 0 ? (b.x - a.x) / dt : 0, vy: b && dt > 0 ? (b.y - a.y) / dt : 0 }; }
  return { p, ball: { x: r.ball.x, y: r.ball.y, z: r.ball.z, st: r.ball.st[0], carrier: null } };
}
function decision(d, ctx) {
  const { P, rows } = ctx, sc = d.scene || {}, o = d.opts || options(''), at = d.at || fromRows(rows, +d.tt || d.t) || places(''), h = at.p?.hero;
  console.log(`\nDecision ${d.n} at ${mmss(d.t)} · scene ${sc.n || '?'} (${sc.mode || '?'}: ${sc.id || '-'}${sc.skill ? ' · ' + sc.skill : ''}${sc.pattern ? '/' + sc.pattern : ''}${sc.seed ? ' seed ' + sc.seed : ''}${sc.lv ? ' · level ' + sc.lv : ''})${d.showing === '1' ? ' · SHOWN by the game' : ''}`);
  console.log(`  Window: ${d.kind}; ring ${d.R} s (real) for ${d.G} s of play${d.jock ? ', a jockey' : ''}${d.retry ? `; retry ${d.retry}` : ''}${d.first ? '; first round of a new idea' : ''}; head ${d.look || "down"}${d.early ? ' (looked early)' : ''}${d.threat ? `; ${d.threat} comes, ${d.threatD} m from the ball` : ''}`);
  if (h) console.log(`  His player at (${r1(h.x)}, ${r1(h.y)}), ${r1(toGoal(h, P))} m from their goal, running ${d.run}° at ${d.heroV} m/s, facing ${d.face ?? d.run}°`);
  const cr = fromRowsCam(rows, +d.tt || d.t);
  console.log(`  Camera (${d.cam || 'player'} view) looks ${d.camYaw}°: ${Math.abs(+d.camOff)}° ${+d.camOff > 0 ? 'left' : 'right'} of his run${Math.abs(+d.camOff) > 40 ? '  <-- more than 40°' : ''}${cr ? `; at (${r1(cr.x)}, ${r1(cr.y)}) from ${r1(cr.dist)} m, ${r1(cr.pitch)}° down, fov ${Math.round(cr.fov)}°` : ''}`);
  if (h) for (const [id, a] of Object.entries(at.p)) if (id !== 'hero') console.log(`    ${id.padEnd(4)} (${r1(a.x)}, ${r1(a.y)}) ${rel(a, h)}, ${r1(toGoal(a, P))} m from their goal, ${r1(Math.hypot(a.vx, a.vy))} m/s, facing ${r1(a.h)}°`);
  if (at.ball) console.log(`    ball (${r1(at.ball.x)}, ${r1(at.ball.y)}) ${at.ball.st === 'c' ? 'with ' + (at.ball.carrier || 'a player') : at.ball.st === 'f' ? 'in the air' : at.ball.st === 'l' ? 'loose' : at.ball.st}`);
  const gl = r => o.list.filter(x => x.rating === r).map(x => x.opt + (x.x != null ? `@(${x.x},${x.y})` : '')).join(', ');
  console.log(`  Options: best ${gl('best') || '-'} | ok ${gl('ok') || '-'} | safe ${gl('safe') || '-'} | bad ${gl('bad') || '-'}${o.shots ? ` | shots ${o.shots}` : ''}`);
  const evs = ctx.rs.filter(r => r.t >= d.t - .05 && r.t <= (d.choose?.t ?? d.t + 30) + .05 && ['LOOK', 'DRAG', 'TAP', 'STEP', 'FLAG', 'PAUSE', 'RESUME'].includes(r.type));
  for (const r of evs) console.log(`    ${mmss(r.t)} +${r1(r.t - d.t)} s ${r.type} ${r.rest}`);
  if (d.choose) console.log(`  He chose ${d.choose.opt} after ${d.choose.sec} s (window ${Math.round(+d.choose.u * 100)}% run, ring ${Math.round(+d.choose.left * 100)}% left), head ${d.choose.look}: ${d.choose.rating}`);
  else if (d.play) console.log(`  The game played ${d.play.opt} (${d.showing === '1' ? 'showing the better play' : d.play.mode})`);
  else console.log('  No choice logged (the round was left)');
  const after = ctx.rs.filter(r => r.t > (d.choose?.t ?? d.t) && r.t <= (d.choose?.t ?? d.t) + 6 && ['OUT', 'SAY', 'CAP', 'TOAST', 'POP', 'PLAYEND', 'SKILL', 'HAND', 'FRESH'].includes(r.type)).slice(0, 10);
  for (const r of after) console.log(`    ${mmss(r.t)} ${r.type} ${r.rest}`);
  const path = d.path || rows.filter(r => r.t >= d.t - .05 && r.t <= (d.choose?.t ?? d.t) + 3 && r.p.hero).map(r => ({ t: r.t, d: toGoal(r.p.hero, P), h: r.p.hero }));
  if (path.length > 1) {
    console.log('  His path (distance to their goal; way he moves against the way to the goal):');
    let last = null; const step = Math.max(1, Math.floor(path.length / 14));
    path.forEach((p, i) => {
      if (i % step && i !== path.length - 1) return;
      const mv = last ? Math.hypot(p.h.x - last.h.x, p.h.y - last.h.y) : 0, way = last && mv > .05 ? wrapD(bearing(last.h, p.h) - bearing(last.h, { x: P.L, y: P.W / 2 })) : null;
      const dt = p.t - d.t, hh = p.h.h > 180 ? p.h.h - 360 : p.h.h;
      console.log(`    ${dt < 0 ? '-' : '+'}${r1(Math.abs(dt)).padStart(4)} s  ${r1(p.d).padStart(5)} m  ${way == null ? 'still' : Math.abs(way) < 50 ? `toward (${Math.round(way)}°)` : Math.abs(way) > 130 ? `AWAY (${Math.round(way)}°)` : `across (${Math.round(way)}°)`}  facing ${Math.round(hh)}°`);
      last = p;
    });
  }
  for (const x of d.odd || []) console.log(`  ODD: ${x}`);
}
function sceneDetail(n, ctx) {
  const scr = ctx.rs.find(r => r.type === 'SCENE' && +fields(r.rest).n === n); if (!scr) { console.log(`No scene ${n}.`); return; }
  const next = ctx.rs.find(r => r.type === 'SCENE' && +fields(r.rest).n === n + 1), t1 = next ? next.t : Infinity;
  console.log(`Scene ${n} at ${mmss(scr.t)}: ${scr.rest}`);
  for (const r of ctx.rs.filter(r => r.t >= scr.t && r.t < t1 && !['T', 'AT', 'OPT', 'SC', 'PERF'].includes(r.type))) console.log(`  ${mmss(r.t)} ${r.type} ${r.rest.slice(0, 160)}`);
  for (const d of ctx.ds.filter(d => +d.scene?.n === n)) decision(d, ctx);
}
function flagDetail(n, ctx) {
  const fr = ctx.rs.find(r => r.type === 'FLAG' && +fields(r.rest).n === n); if (!fr) { console.log(`No flag ${n}.`); return; }
  console.log(`Flag ${n} at ${mmss(fr.t)}, in ${near(fr.t, want)}. From 10 s before to 5 s after:`);
  for (const r of ctx.rs.filter(r => r.t >= fr.t - 10 && r.t <= fr.t + 5 && !['T', 'AT', 'OPT', 'SC', 'PERF'].includes(r.type))) console.log(`  ${mmss(r.t)} ${r.t < fr.t ? '-' : '+'}${r1(Math.abs(r.t - fr.t))} s ${r.type} ${r.rest.slice(0, 180)}`);
  const rows = ctx.rows.filter(r => r.t >= fr.t - 10 && r.t <= fr.t + 5 && r.p.hero);
  if (rows.length) {
    console.log('  His player (distance to their goal), the ball, the camera against his run, the pace of play:');
    const step = Math.max(1, Math.floor(rows.length / 24)); let last = null;
    rows.forEach((r, i) => {
      if (i % step && i !== rows.length - 1) return;
      const h = r.p.hero, mv = last ? Math.hypot(h.x - last.x, h.y - last.y) : 0, run = mv > .05 ? bearing(last, h) : null;
      console.log(`    ${r.t < fr.t ? '-' : '+'}${r1(Math.abs(r.t - fr.t)).padStart(4)} s  (${r1(h.x)}, ${r1(h.y)}) ${r1(toGoal(h, ctx.P)).padStart(5)} m  facing ${Math.round(h.h)}°  ball ${r.ball.st}  cam ${Math.round(r.cam.yaw)}°${run != null ? ` (${Math.round(Math.abs(wrapD(r.cam.yaw - run)))}° off his run)` : ''}  pace ${r1(r.pace)}  look ${r1(r.look)}`);
      last = h;
    });
  }
  const d = [...ctx.ds].reverse().find(x => x.t <= fr.t + .5); if (d) decision(d, ctx);
}

// ---------- out ----------
const kb = Math.round(text.length / 100) / 10;
console.log(`Heads Up! Soccer play log: ${sessions.length} session${sessions.length > 1 ? 's' : ''}, ${kb} KB, ${recs.length} lines${text.includes('\n') ? '' : ' (no line breaks: read from the "|" marks)'}`);
const ctx = study(want);
if (opt('decision')) { const d = ctx.ds.find(x => x.n === opt('decision')); if (d) decision(d, ctx); else console.log(`No decision ${opt('decision')} in session ${want}.`); }
else if (opt('scene')) sceneDetail(opt('scene'), ctx);
else if (opt('flag')) flagDetail(opt('flag'), ctx);
else if (opt('all')) { summary(want); for (const d of ctx.ds) decision(d, ctx); }
else { for (const s of sessions) summary(s); console.log(`\nDetails: --decision N (1-${ctx.ds.length}), --scene N, --flag N, --all${sessions.length > 1 ? ', --session N' : ''}.`); }
