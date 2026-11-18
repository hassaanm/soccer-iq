// Replays a decision from a pasted play log in the test harness (tests/harness.js, as the audits run the game): the
// scene is made again, play runs up to the moment the window opened, then on to the logged tap, which is made; the play
// that follows runs to its end. It prints how far the rebuilt players are from where the log has them (at the open: the
// AT line; at the tap: the track row written at that moment) and how the play ended.
//
//   node scripts/log-replay.js <file> --decision N [--session N]
//   node scripts/log-replay.js <file> --flag N        (the last decision opened before the flag)
//   node scripts/log-replay.js <file> --list          (every decision, and whether it can be made again from its seed)
//
// For a worker: import { loadDecision } from './scripts/log-replay.js'; const r = await loadDecision(text, 4);
// r.g is the game (harness), stopped with the window just opened; r.play() makes the logged choice at the logged moment
// and plays it out. How close: a scene loaded from its seed (a lesson round, a demo, a match's fresh situation) is the same
// scene, and its window opens with everyone where the log has them to the centimetre; a scene from live play (a match
// going on) starts from the log's picture of the moment it opened (AT: places to the centimetre, speeds to 0.1 m/s), and
// through the window everyone follows the logged track rows to the tap (log.js followRows): the picture at the tap is
// the logged one to the rows' 0.1 m; the play after the tap is the game's own from there (close, not exact).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse, fields, decisions, sceneFor, placeFrom, gap, rowAtTime, followRows } from '../js/log.js';
import { generate, demoFor } from '../js/generate.js';
import { runsAt } from '../js/skills.js';
import { setSize, TEAM } from '../js/geom.js';
import { makeGame, drive } from '../tests/harness.js';

export function findDecision(text, { decision, flag, session } = {}) {
  const recs = parse(text), all = decisions(recs), ss = [...new Set(recs.map(r => r.s))], s = session ?? ss[ss.length - 1];
  const ds = all.filter(d => d.s === s);
  let d = null;
  if (flag != null) { const fr = recs.find(r => r.s === s && r.type === 'FLAG' && +fields(r.rest).n === flag); d = fr ? [...ds].reverse().find(x => x.t <= fr.t + .5) : null; }
  else d = ds.find(x => x.n === decision);
  const head = fields(recs.find(r => r.s === s && r.type === 'LOG')?.rest || '');
  const mt = [...recs].reverse().find(r => r.s === s && r.type === 'MATCH' && fields(r.rest).is === 'start' && d && r.t <= d.t);
  return { recs, d, ds, s, head, lessons: mt ? String(fields(mt.rest).lessons || '').split(',').filter(Boolean) : null };
}

export async function loadDecision(text, decision, { session = null, flag = null } = {}) {
  const { recs, d, s, head, lessons } = findDecision(text, { decision, flag, session });
  if (!d) throw new Error(`No decision ${flag != null ? 'before flag ' + flag : decision} in the log.`);
  setSize(d.scene?.size || head.size || '3v3');
  const made = sceneFor(d, { generate, demoFor, runsAt });
  if (!made) throw new Error(`Decision ${d.n}: its scene (${d.scene?.id}) cannot be made again (no seed and no scene in the log).`);
  const { g, events } = makeGame(), sc = made.sc, mode = d.scene?.mode || 'lesson';
  g.levelOf = () => (d.lv != null && d.lv !== '' ? +d.lv : null); g.thinkTime = () => d.think || 'normal';
  g.mode = mode === 'demo' || mode === 'between' ? 'lesson' : mode; if (lessons) g.skills = new Set(lessons);
  g.firstRound = d.first === '1'; g.timeouts = +(d.retry || 0); g.toStreak = +(d.streak || 0);
  g.load(sc);
  if (made.how === 'seed') await drive(g, g.pre());
  else { g.phase = 'pre'; placeFrom(g, d.at); g.yaw = (+d.camYaw || 0) * Math.PI / 180; if (d.look === 'up') { g.lookUp = true; g.scanned = true; } }
  if (d.look === 'up') { g.lookUp = true; g.scanned = true; }
  const decided = g.decide();
  const followed = made.how === 'snapshot' ? followRows(g, recs, d) : 0; // (from live play: the window goes as the log has it)
  const atOpen = gap(g, d.at || rowAtTime(recs, s, +d.tt || d.t)); // (a scene from its seed has no AT line: the track row written as it opened, to 0.1 m)
  const out = { n: d.n, how: made.how, followed, scene: d.scene?.id, mode, size: TEAM.size, opt: d.choose?.opt || null, atOpen, g, events };
  // The logged tap, at the same game time into the window; then its play, to the end.
  out.play = async () => {
    const opt = d.choose?.opt, gt = +d.choose?.gt;
    if (!opt) throw new Error(`Decision ${d.n} has no tap in the log (the game showed it, or the round was left).`);
    let atTap = null;
    const pick = gm => { if (!gm.win || gm.sim.time - gm.win.t0 < gt - 1e-4) return null; const row = rowAtTime(recs, s, +d.choose.tt || d.choose.t); atTap = row ? gap(gm, row) : null; return opt; };
    let first = d.choose.look === 'up';
    const chose = await drive(g, decided, { pick: gm => { if (first && !gm.lookUp) { gm.toggleLook(); first = false; } return pick(gm); } });
    const good = g.isGood(chose); await drive(g, g.outcome(chose, good));
    return { opt: chose, rating: g.rating(chose), result: g.result, banners: events.filter(e => e[0] === 'banner').map(e => e[1]).filter(Boolean), atTap, logged: { rating: d.choose.rating, out: d.out?.title || null, result: null } };
  };
  return out;
}

// ---------- the command line ----------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
  const num = k => { const i = args.indexOf('--' + k); return i >= 0 && /^\d+$/.test(args[i + 1] || '') ? +args[i + 1] : null; };
  if (!file) { console.log('Usage: node scripts/log-replay.js <file> --decision N | --flag N | --list [--session N]'); process.exit(1); }
  const text = readFileSync(file, 'utf8');
  if (args.includes('--list')) {
    const { ds } = findDecision(text, { session: num('session') });
    for (const d of ds) { const m = sceneFor(d, { generate, demoFor, runsAt }); console.log(`${String(d.n).padStart(3)} ${d.scene?.mode || '-'} ${d.kind} ${d.scene?.id || '-'} ${d.choose ? 'tap ' + d.choose.opt : d.showing === '1' ? '(shown)' : '(no tap)'} -> ${m ? m.how : 'cannot be made again'}`); }
    process.exit(0);
  }
  const r = await loadDecision(text, num('decision'), { session: num('session'), flag: num('flag') });
  console.log(`Decision ${r.n} (${r.mode}, ${r.scene}, ${r.size}): made again from its ${r.how === 'seed' ? 'seed' : `logged picture, its window following the log's ${r.followed} rows`}`);
  console.log(`  at the open: largest gap to the log ${r.atOpen.worst.toFixed(3)} m (${r.atOpen.who || '-'})`);
  const p = await r.play();
  console.log(`  tap ${p.opt} (logged ${p.logged.rating}, now ${p.rating})${p.atTap ? `; at the tap: largest gap ${p.atTap.worst.toFixed(3)} m (${p.atTap.who}), his own player ${p.atTap.hero?.toFixed(3)} m, to the log's row (kept to 0.1 m)` : ''}`);
  console.log(`  play ended: ${p.result} ${p.banners.length ? '"' + p.banners.join('", "') + '"' : ''}${p.logged.out ? ` (logged: "${p.logged.out}")` : ''}`);
  process.exit(0);
}
