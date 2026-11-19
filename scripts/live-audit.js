// The live-play audit (round 6): whole matches, played by a bot that taps the best choice, measured between the
// choices (the plays themselves and the moments before the next choice opens), where the team AI moves the players.
//   hover   no defender is within 1.5 m of the ball carrier for more than 0.5 s without a tackle attempt (sim.js a.tk)
//           and without being beaten (a.beat: off balance after the attempt). In a choice's window the one who is
//           already there jockeys, by design (window.js): windows are not counted.
//   yoyo    no defender's distance to the ball goes down, then up by more than 1 m, then down again (by 0.8 m or more) within 3 s, unless
//           he made a tackle attempt in between (beaten, he is left behind and chases) or the ball changed sides or
//           was passed or shot, or it was the ball that moved away (he himself went less than 0.6 m back from it).
//   short   no live choice opens with less time than the floor (window.js windowFloor)
//   noring  every live choice has a window (a ring and a time-out)
//   defbest "one goes, one guards": in a live defending choice the best answer is to go to the ball only when his player
//           is our nearest to it (by a metre), and to guard when a friend is (by a metre)
//   passback after his pass in a match the friend never gives it back with a clear shot or open space ahead of him, and
//           at most once in a move
//   walk    (v78) his own pass or shot with nobody on him is played from where he is (WALK, kickWatch, walkMatches)
//   cut     (v82) no new situation starts with a cut, except at the start and after a goal (cutWatch, cutMatches)
//   twoball after a defending play, never two of ours on the ball (within 2 m of their player on it, with the ball as
//           their job: his own player, and a friend who is pressing, chasing or has no job) while another of theirs
//           within 12 m of it has nobody of ours within 3 m
// Usage: node scripts/live-audit.js [size] [matches] [wrong share] [--v]   (exit 1 on any flag, or hover/yoyo/twoball over RATE)
import { PATH } from '../js/skills.js';
import { SIZES, setSize, PITCH } from '../js/geom.js';
import { makeGame, drive, optionsFor } from '../tests/harness.js';
import { pathAt } from '../js/window.js';

// (v76) heading: as a choice opens with his own player carrying the ball (a lesson's scene after its run-up, a match's
// scene, the next choice from live play), the camera looks the way he runs. Measured on the camera itself, the way it
// really points (eye to target, the camera as it has eased so far: the eye sits over his shoulder, and from live play it
// swings over), against his way (his planned velocity), and his body against his way: HEADING.lim degrees or less as the
// window opens, and again HEADING.later s (real) into it. (The owner, v75: the view faced the side line while he ran up the
// field across the screen, sideways, with nobody there.) In live play a camera still coming round may be over the limit as
// the window opens in at most HEADING.share of windows (scripts/motion-audit.js); never HEADING.later s in. Not counted,
// each with its reason: a pass on its way to him (he faces the passer); a view from above that frames the rings (a lead
// pass, a run: not a view from behind him), whose angles are reported.
export const HEADING = { lim: 40, speed: .6, later: .7, share: .05 };
const headingWhy = r => (r.kind === 'receive' ? 'a pass to him: he faces the passer' : r.spotView ? 'a view from above that frames the rings' : null);
const camDeg = (g, run) => { const c = g.cam; if (!c) return null; const a = Math.atan2(c.tgt[1] - c.eye[1], c.tgt[0] - c.eye[0]) - run; return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI; };
const degOf = a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI;
// A per-frame watcher: done(r) once per window with { kind, sc, live, open, body (degrees as it opens), later (degrees
// HEADING.later s in, or null if it closed sooner), why (a reason, or null), bad (over the limit as it opens), badLater }.
export function headingWatch(g, done) {
  let w = null, r = null;
  const run = () => { const p = w?.plan?.paths?.hero; if (!p) return null; const q = pathAt(p, Math.max(0, g.sim.time - w.t0)); return Math.hypot(q.vx, q.vy) >= HEADING.speed ? Math.atan2(q.vy, q.vx) : null; };
  const fin = () => { if (r) { r.badLater = !r.why && r.later != null && r.later > HEADING.lim; done(r); } r = null; };
  return () => {
    const s = g.sim, h = s.a('hero');
    if (r && (g.win !== w || g.phase !== 'decide')) fin();
    if (g.win && g.win !== w && g.phase === 'decide') {
      w = g.win; const a = run(); if (a == null || !h || s.ball.carrier !== 'hero' || !g.cam) return;
      r = { sc: g.sc?.id, live: !!g.sc?.live, kind: g.sc?.kind || 'attack', spotView: !!(g.spotPre?.() || g.step === 'spot'), open: camDeg(g, a), body: degOf(Math.atan2(h.face[1], h.face[0]) - a), later: null, t0: w.real };
      r.why = headingWhy(r); r.bad = !r.why && (r.open > HEADING.lim || r.body > HEADING.lim); return;
    }
    if (r && w.real - r.t0 >= HEADING.later) { const a = run(); if (a != null && s.ball.carrier === 'hero') r.later = camDeg(g, a); fin(); }
  };
}
// (v76) The heading check on whole matches played as a child plays them: he taps 1 to 7 s (real) after a choice opens,
// so the camera's way HEADING.later s in is seen too (the bots elsewhere tap at once).
export async function headingMatches(size, N = 6) {
  setSize(size); const real = Math.random, rows = [];
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      let y = seed * 31337; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 }; g.skills = new Set(PATH.map(s => s.id));
      let T = 0, last = null, delay = 0, openT = 0; const hw = headingWatch(g, r => rows.push({ seed, ...r }));
      await drive(g, g.match(PATH.map(k => k.id), [], 5, 'free'), { maxSec: 9000, onFrame: () => { T += 1 / 30; hw(); },
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; delay = 1 + rnd() * 6; openT = T; } if (T - openT < delay) return null;
          return gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); } });
      hw();
    }
  } finally { Math.random = real; }
  return rows;
}

// (v78) walk: his own player plays a pass or a shot from where he is, with a natural turn. For every pass and shot he
// chooses with the ball at his feet and nobody of theirs within WALK.pressure m of him: from the window opening to the
// kick he gets no more than WALK.away m farther from their goal; from the choice to the kick no more than WALK.away m
// farther from where it is kicked to; and his body turns no more than WALK.turn degrees farther off that way than it was
// as he chose. (The owner, v76: in front of the goal, nobody on him, he walked away from the goal with his back to it,
// turned and passed. Two causes: in matches the carry he settled into went back the way the touch took him, toward his
// own goal, through the whole window (game/window.js settle); and after any choice he walked on with his run while the
// ball came round, then his body swung back to his run in the wind-up (game/outcomes.js plantFor).)
export const WALK = { pressure: 2, away: .5, turn: 30 };
const KICKS = /^(pass:|shoot|turn:B)/;
// A per-frame watcher: done(r) for each kick of his that follows a choice, with { opt, sc, live, near (m, the nearest of
// theirs as he chose), goal (m farther from their goal, from the window's opening), target (m farther from the kick's
// point, from the choice), turn (degrees his body turned farther off the kick's way), calm (nobody on him), bad }.
export function kickWatch(g, done) {
  const s = g.sim, G = () => [PITCH.L, PITCH.W / 2], deg = a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI;
  let cur = null, wo = null, lastW = null;
  const ch = g.choose.bind(g);
  g.choose = opt => { const can = g.canAct && g._choose; ch(opt); if (!can) return; const h = s.a('hero');
    if (!h || s.ball.carrier !== 'hero' || !KICKS.test(String(opt))) { cur = null; return; }
    const near = Math.min(99, ...s.team('them').filter(o => !o.gk).map(o => Math.hypot(o.x - h.x, o.y - h.y)));
    cur = { opt, sc: g.sc?.id, live: !!g.sc?.live, near, win: wo && wo.w === lastW ? wo.path : [], path: [[h.x, h.y, Math.atan2(h.face[1], h.face[0])]] }; };
  const kick = s.kick.bind(s);
  s.kick = (x, y, o) => {
    if (cur && s.ball.carrier === 'hero') { const r = cur, h = s.a('hero'); cur = null; r.path.push([h.x, h.y, Math.atan2(h.face[1], h.face[0])]);
      const gl = G(), d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]), T = [x, y], p0 = r.path[0], o0 = deg(Math.atan2(y - p0[1], x - p0[0]) - p0[2]), w0 = r.win[0] || p0;
      let goal = 0, target = 0, off = 0; for (const p of [...r.win, ...r.path]) goal = Math.max(goal, d(p, gl) - d(w0, gl));
      for (const p of r.path) { target = Math.max(target, d(p, T) - d(p0, T)); off = Math.max(off, deg(Math.atan2(y - p[1], x - p[0]) - p[2])); }
      const calm = r.near >= WALK.pressure, out = { opt: r.opt, sc: r.sc, live: r.live, near: r.near, goal, target, turn: Math.max(0, off - o0), calm };
      out.bad = calm && (goal > WALK.away || target > WALK.away || out.turn > WALK.turn); done(out); }
    return kick(x, y, o);
  };
  return () => {
    if (g.win && g.win !== lastW) { lastW = g.win; wo = s.ball.carrier === 'hero' && s.a('hero') ? { w: g.win, path: [] } : null; }
    if (wo && g.win === wo.w && g.phase === 'decide') { const h = s.a('hero'); wo.path.push([h.x, h.y]); }
    if (cur) { const h = s.a('hero'); cur.path.push([h.x, h.y, Math.atan2(h.face[1], h.face[0])]); if (cur.path.length > 400) cur = null; }
  };
}
export const walkText = r => `${r.sc} ${r.opt}: ${r.goal > WALK.away ? `${r.goal.toFixed(1)} m farther from the goal; ` : ''}${r.target > WALK.away ? `${r.target.toFixed(1)} m farther from where he kicks it; ` : ''}${r.turn > WALK.turn ? `his body turns ${Math.round(r.turn)}° away; ` : ''}nearest of theirs ${r.near.toFixed(1)} m`;
// (v78) The walk check on whole matches: a bot that looks up and passes or shoots (a pass or a shot it picks, now and
// then, wherever it has the ball), at a child's pace (0.4 to 3 s after a choice opens). Looking up turns his body with
// the view (game.js frame): some looks are at the friend or the goal, as a child drags the view to find them.
export async function walkMatches(size, N = 4) {
  setSize(size); const real = Math.random, rows = [];
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      let y = seed * 31337; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.world.canvas = { clientWidth: 844, clientHeight: 390 }; g.skills = new Set(PATH.map(s => s.id));
      let T = 0, last = null, delay = 0, openT = 0, pk = null, look = 0, looked = false; const kw = kickWatch(g, r => rows.push({ seed, ...r }));
      await drive(g, g.match(PATH.map(k => k.id), [], 5, 'free'), { maxSec: 9000, onFrame: () => { T += 1 / 30; kw(); },
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; delay = .4 + rnd() * 2.6; openT = T; pk = null; looked = false; look = Math.floor(rnd() * 3);
            const ks = gm.sim.ball.carrier === 'hero' && !gm.sc.spots ? optionsFor(gm.sc).filter(o => KICKS.test(o)) : []; if (ks.length && rnd() < .7) pk = ks[Math.floor(rnd() * ks.length)]; }
          if (pk && !looked && T - openT > .2) { looked = true; gm.lookUp = true; gm.scanned = true; const h = gm.sim.a('hero'), t = look === 1 ? gm.target(pk) : look === 2 ? { x: PITCH.L, y: PITCH.W / 2 } : null; if (h && t) gm.yaw = Math.atan2(t.y - h.y, t.x - h.x); }
          if (T - openT < delay) return null;
          return pk || gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); } });
    }
  } finally { Math.random = real; }
  return rows;
}

// (v82) cut: no new situation starts with a cut: a player's body jumping more than CUT.jump m in one frame (a sprint covers
// 0.15 m), or the camera put somewhere new (game.js load: cam = null) or its eye more than CUT.cam m in a frame (its
// quickest swing round, to a defending choice, is about 4 m). Allowed only where the game shows a break: before the first choice of a
// match, and after a goal until the next choice opens. Bodies, not ids: a team's ids are handed round with the bodies (a
// hand-over: his player becomes the friend with the ball; a new situation brought in from play, live.js adopt). The owner
// (v81): "Whenever you make a decision and all of a sudden it fades out and there's a new scenario, it's really confusing."
export const CUT = { jump: .8, cam: 6 };
export function cutWatch(g, done) {
  let prev = null, eye = null, cam0 = null, open = true;
  return () => {
    const s = g.sim, now = [...s.agents.values()].map(a => [a.x, a.y, a.team, a.id]), c = g.cam;
    if (g.phase === 'decide') open = false;
    if (g.phase === 'outcome' && (g.result === 'goal' || g.result === 'goalAgainst')) open = true;
    if (prev) {
      const ids = now.filter(p => Math.min(...prev.filter(q => q[2] === p[2]).map(q => Math.hypot(p[0] - q[0], p[1] - q[1]))) > CUT.jump).map(p => p[3]);
      const camJump = !!(c && eye && (c !== cam0 || Math.hypot(c.eye[0] - eye[0], c.eye[1] - eye[1], c.eye[2] - eye[2]) > CUT.cam));
      // (one body alone stepping more than CUT.jump in a frame is not a new situation: two left overlapping are pushed apart,
      // sim.js SPACE; a new picture moves everyone, or the camera)
      if ((ids.length >= 2 || camJump) && !open) done({ t: s.time, ids, cam: camJump, sc: g.sc?.id, result: g.result, phase: g.phase });
    }
    prev = now; eye = c ? [...c.eye] : null; cam0 = c;
  };
}
// (v82) Whole matches as a child plays them (he taps at 45 to 80 % of the ring, a wrong option one time in four): every
// cut (cutWatch) and every new situation brought in from play (live.js bridgeTo: its event, how long it took, how long
// after the situation began). mode 'free': every lesson passed (Matches); 'mini': the "Steal it!" lesson's mini match (no
// "Won it? Go!" yet: winning the ball brings in the next situation). stall: seconds of play without a goal before a new
// situation (live.js STALL; shorter here to see more of them).
export async function cutMatches(size, N = 3, mode = 'free', stall = null) {
  setSize(size); const real = Math.random, cuts = [], bridges = [];
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907 + (mode === 'mini' ? 99991 : 0); Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      let y = seed * 31337; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
      const { g } = makeGame(), all = PATH.map(s => s.id), mini = mode === 'mini'; g.skills = new Set(mini ? all.slice(0, all.indexOf('steal-it') + 1) : all); if (stall != null) g.stallAfter = stall;
      let T = 0, last = null, st = null, br = null, start = 0; const cw = cutWatch(g, r => cuts.push({ seed, mode, T: +T.toFixed(2), ...r }));
      g.plog = (k, o) => { if (k === 'fresh' && o.why && !/no scene/.test(o.why)) bridges.push(br = { seed, mode, why: o.why, T, since: o.sec ?? T - start }); };
      const ld = g.load.bind(g); g.load = sc => { if (!g.bridging) start = T; return ld(sc); };
      const bt = g.bridgeTo?.bind(g); if (bt) g.bridgeTo = async p => { const b = br, t0 = T, ok = await bt(p); if (b && !ok) bridges.splice(bridges.indexOf(b), 1); else if (b) { b.sec = T - t0; b.ev = p.ev.kind; } start = T; return ok; }; // (false: nothing was brought in, play went on)
      await drive(g, g.match(mini ? ['steal-it', 'get-goal-side'] : all, [], mini ? 2 : 5, mini ? 'match' : 'free'), { maxSec: 9000, onFrame: () => { T += 1 / 30; cw(); },
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; st = { u: .45 + rnd() * .35, t: T, wrong: rnd() < .25 }; }
          if (gm.win ? (gm.win.u ?? 0) < st.u : T - st.t < 2) return null;
          let o = gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:fwd');
          if (st.wrong) { const bad = optionsFor(gm.sc).filter(q => !q.startsWith('then:') && gm.rating(q) === 'bad'); if (bad.length) o = bad[Math.floor(rnd() * bad.length)]; }
          return o; } });
    }
  } finally { Math.random = real; }
  return { cuts, bridges };
}
export const cutText = r => `${r.mode} match ${r.seed} at ${r.T} s (${r.phase}, after ${r.result || '-'}, ${r.sc}): ${r.ids.length ? r.ids.join(',') + ' jumped' : ''}${r.cam ? ' the camera jumped' : ''}`;

// (v82) hover, yoyo and twoball are judged as a rate, not one by one. They are rare faults of the team's shape that v81
// already had: over 160 matches a size (seeds 1 to 160, this bot) v81 gave hover, yoyo or twoball 4 times at 3v3 (2.5 in
// 100 matches), 2 at 4v4 (1.25) and 17 at 5v5 (10.6), from 0 to 6 in a batch of 40 at 5v5; v82 gave 0, 5 and 25 (0 to 10 a
// batch). In 8 matches one case is luck either way. So the live audit plays RATE.N matches a size and fails only when
// these come more often than v81's rate allows: more than its expected number plus three times its square root, plus one
// (Poisson: about 1 in 700 for v81's own rate). Every other live-play flag still fails on a single case.
export const RATE = { kinds: ['hover', 'yoyo', 'twoball'], N: 40, v81: { '3v3': 2.5, '4v4': 1.25, '5v5': 10.6 } };
export function rateJudge(size, flags, N) {
  const n = flags.filter(f => RATE.kinds.includes(f[0])).length, exp = (RATE.v81[size] ?? 5) * N / 100, limit = Math.floor(exp + 3 * Math.sqrt(exp) + 1);
  return { n, limit, ok: n <= limit, text: `${size} ${RATE.kinds.join('/')}: ${n} in ${N} matches (${(n / N * 100).toFixed(1)} in 100; v81 ${RATE.v81[size] ?? '?'} in 100), at most ${limit} allowed` };
}
export const hardFlags = flags => flags.filter(f => !RATE.kinds.includes(f[0]));

export async function liveAudit(size, N = 4, wrong = 0) { // wrong: the share of choices where the bot taps a bad option (more defending choices and lost balls)
  setSize(size); const flags = [], real = Math.random, stat = { plays: 0, windows: 0, minWin: 9, hover: 0, yoyo: 0 };
  try {
    for (let seed = 1; seed <= N; seed++) {
      let x = seed * 7907; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647;
      let y = seed * 31337, lastW = null, pickW = null; const rnd = () => (y = (y * 48271) % 2147483647) / 2147483647;
      const { g } = makeGame(); g.skills = new Set(PATH.map(s => s.id)); const s = g.sim, rec = []; let last = null, nDec = 0, lastWin = null, defPlay = null, w0 = null, two = null, prevT = 0, move = null, lastCar = null, hp = null, hpNow = null, scId = null;
      const side = id => (id == null ? null : s.a(id)?.team || null);

      await drive(g, g.match(PATH.map(k => k.id), [], 5, 'free'), { maxSec: 9000,
        pick: gm => { if (gm.sc.kind === 'tackle') return gm.tackleState() === 'good' ? gm.sc.best : null;
          if (gm._choose !== last) { last = gm._choose; nDec++; stat.plays++;
            if (gm.sc.live && gm.sc.kind !== 'tackle') { if (!gm.win) flags.push(['noring', `${size} match ${seed} choice ${nDec} (${gm.sc.kind || 'attack'} ${gm.sc.id || ''}): no window`]); }
            // defbest (round 7, as the verifier measures it): by where everyone is as the window opens (what he sees): his
            // player nearer the ball carrier than any friend by more than a metre and the best answer is not to go, or a
            // friend nearer by more than a metre and the best answer is to go
            if (gm.sc.live && gm.sc.kind === 'defense' && gm.sc.best && w0 && w0.w === gm.win) { stat.def = (stat.def || 0) + 1; const b = gm.sc.best.slice(5), goes = ['home', 'chase', 'press'].includes(b), who = w0.dh < w0.dm - 1 ? 'him' : w0.dm < w0.dh - 1 ? 'a friend' : 'close';
              stat['def nearest ' + who] = (stat['def nearest ' + who] || 0) + 1;
              if ((who === 'him' && !goes) || (who === 'a friend' && goes)) flags.push(['defbest', `${size} match ${seed} choice ${nDec}: ${who} is nearest the ball (his player ${w0.dh.toFixed(1)} m, a friend ${w0.dm.toFixed(1)} m), and the best answer is ${b} (rings ${gm.sc.spots.map(p => p.id).join(',')})`]);
              two = { t0: s.time, run: 0, max: 0, n: nDec };
            } }
          if (wrong && gm._choose !== lastW) { lastW = gm._choose; pickW = null; if (rnd() < wrong) { const bad = optionsFor(gm.sc).filter(o => !o.startsWith('then:') && gm.rating(o) === 'bad'); if (bad.length) pickW = bad[Math.floor(rnd() * bad.length)]; } }
          return pickW || gm.sc.best || (gm.sc.spots ? 'spot:' + gm.sc.spots[0].id : 'drib:back'); },
        onFrame: gm => { const w = gm.win; const dtF = s.time - prevT; prevT = s.time;
          if (w && gm.sc?.live && gm.sc.kind === 'defense' && w0?.w !== w) { const c1 = s.a(gm.sc.carrier) || (s.ball.carrier && s.a(s.ball.carrier)), h1 = s.a('hero'); if (c1 && h1) w0 = { w, dh: Math.hypot(h1.x - c1.x, h1.y - c1.y), dm: Math.min(99, ...s.team('us').filter(a => a.id !== 'hero' && !a.gk).map(a => Math.hypot(a.x - c1.x, a.y - c1.y))) }; }
          // twoball (round 7, as the verifier measures it): in the 4 s after a defending choice, two of ours within 2 m of
          // their player on the ball while another of theirs within 12 m of it has nobody of ours within 3 m, for more than 0.5 s on end
          if (two && process.env.TW && +process.env.TW.split(',')[0] === seed && +process.env.TW.split(',')[1] === two.n) { const cc = s.ball.carrier && s.a(s.ball.carrier); if (cc && (two.k = (two.k || 0) + 1) % 4 === 0) console.log('TW', s.time.toFixed(2), gm.phase, gm.result || '', 'car', cc.id, s.team('us').filter(a => !a.gk).map(a => `${a.id} ${Math.hypot(a.x - cc.x, a.y - cc.y).toFixed(1)}m job ${a.id === 'hero' ? gm.teamJob?.hero : gm.roles?.jobs?.[a.id] || gm.teamJob?.[a.id]?.job || '-'}${a.beat > s.time ? ' beat' : ''}${gm.scripted.has(a.id) ? ' scr' : ''}`).join(' | '), 'free', s.team('them').filter(o => o !== cc && !o.gk && Math.min(...s.team('us').filter(a => !a.gk).map(a => Math.hypot(a.x - o.x, a.y - o.y))) > 3).map(o => o.id).join(',')); }
          if (two) { if (s.time - two.t0 > 4) { if (two.max > .5) flags.push(['twoball', `${size} match ${seed} after choice ${two.n}: two of ours on the ball with one of theirs free for ${two.max.toFixed(1)} s`]); two = null; }
            else { const cc = s.ball.state === 'carried' && s.a(s.ball.carrier); if (cc && cc.team !== 'us') { const ours = s.team('us').filter(a => !a.gk), on = ours.filter(a => Math.hypot(a.x - cc.x, a.y - cc.y) < 2).length, fr = s.team('them').some(o => o !== cc && !o.gk && Math.hypot(o.x - s.ball.x, o.y - s.ball.y) < 12 && Math.min(...ours.map(a => Math.hypot(a.x - o.x, a.y - o.y))) > 3);
              if (on >= 2 && fr) { two.run += dtF; two.max = Math.max(two.max, two.run); } else two.run = 0; } else two.run = 0; } }
          // twice (round 7): in one spell of our possession (from one situation set up or ball won, until it is lost or a new one is set up) the ball comes to his player from the same friend twice (by the ids: taking over a friend who carried it on counts too)
          { const hq = s.a('hero'); hp = hpNow; hpNow = hq ? [hq.x, hq.y] : null; }
          // (a new situation set up, after a goal or four plays: a lesson's scene, with its own pass to him: is a new move)
          if (gm.sc && !gm.sc.live && gm.sc.id !== scId) { scId = gm.sc.id; move = null; lastCar = null; } if (gm.sc?.live) scId = null;
          { const car = s.ball.state === 'carried' ? s.ball.carrier : null; if (car && car !== lastCar) { const a = s.a(car);
            if (a?.team !== 'us') move = null; else { move ||= { seq: [], ret: {} }; const hh = s.a('hero'); move.seq.push(car === 'hero' && hp && Math.hypot(hh.x - hp[0], hh.y - hp[1]) > 1.5 ? 'hero(took over)' : car === 'hero' ? 'hero' : car); if (move.seq.at(-1) !== car) move.seq[move.seq.length - 1] = car, move.note = (move.note || '') + ` [${move.seq.length}: took over, ${gm.sc?.kind || 'attack'} ${gm.result || ''}]`; else if (car === 'hero' && move.seq.length > 1) move.note = (move.note || '') + ` [${move.seq.length}: passed to him, ${gm.sc?.id || ''} ${gm.result || ''}]`; const q = move.seq; if (q.length >= 3 && q.at(-1) === 'hero' && q.at(-3) === 'hero' && !/took over[^\]]*\]$/.test(move.note || '')) { const f = q.at(-2); move.ret[f] = (move.ret[f] || 0) + 1; stat.returns = (stat.returns || 0) + 1; if (move.ret[f] === 2) flags.push(['twice', `${size} match ${seed}: ${q.join('>')}${move.note || ''}`]); } } lastCar = car; } }
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
        for (let i = 0; i < rec.length; i++) { const r = rec[i], a = r.at[id], on = a && !r.win && r.ph !== 'pre' /* (the moments before a choice opens: everyone is on the way its plan gave him) */ && !(id === 'hero' && r.k === 'tackle') /* (his own tackle: when to go in is the choice he is making) */ && r.c && r.cs && a[2] !== r.cs && r.st !== 'flying' && Math.hypot(a[0] - r.b[0], a[1] - r.b[1]) < 1.5 && !(a[3] > r.t - .5 && a[3] <= r.t + .01) && !(a[4] > r.t) && !passing(i, id);
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
              for (let m = k + 1; m < rec.length && rec[m].t - r.t <= 3; m++) { const p = rec[m]; if (p.cs !== r.cs || p.c !== r.c || p.st === 'flying' || p.win) break; if (D[m] < D[k] - .8) { found = true; stat.yoyo++; flags.push(['yoyo', `${size} match ${seed} after choice ${r.n}: ${id} to the ball ${D[i].toFixed(1)} → ${lo.toFixed(1)} → ${D[k].toFixed(1)} → ${D[m].toFixed(1)} m in ${(p.t - r.t).toFixed(1)} s (t=${r.t.toFixed(1)})`]); i = m; break; } }
              break; } }
          i = found ? i + 1 : i + 6; } }
    }
  } finally { Math.random = real; }
  stat.counts = { hover: stat.hover, yoyo: stat.yoyo, short: flags.filter(f => f[0] === 'short').length, noring: flags.filter(f => f[0] === 'noring').length, defbest: flags.filter(f => f[0] === 'defbest').length, twoball: flags.filter(f => f[0] === 'twoball').length, twice: flags.filter(f => f[0] === 'twice').length, returns: stat.returns || 0,
    passback: flags.filter(f => f[0] === 'passback').length, ...Object.fromEntries(Object.entries(stat).filter(([k]) => k.startsWith('def') || k.startsWith('friend'))) };
  return { flags, stat };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--')), sizes = args[0] ? [args[0]] : Object.keys(SIZES).filter(k => SIZES[k].offer); let bad = 0;
  for (const size of sizes) { const N = +(args[1] || RATE.N), { flags, stat } = await liveAudit(size, N, +(args[2] || 0)), rj = rateJudge(size, flags, N); bad += hardFlags(flags).length + (rj.ok ? 0 : 1); console.log((rj.ok ? 'rate ok: ' : 'RATE OVER: ') + rj.text);
    console.log(`${size} live play: ${stat.plays} choices, ${stat.windows} windows (shortest live ${stat.minWin.toFixed(2)} s); ${Object.entries(stat.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const by = {}; for (const [k, m] of flags) (by[k] ||= []).push(m); for (const [k, v] of Object.entries(by)) { console.log(`  ${k}: ${v.length}`); for (const m of v.slice(0, process.argv.includes('--v') ? 99 : 6)) console.log('    ' + m); }
    for (const mode of ['free', 'mini']) { const { cuts, bridges } = await cutMatches(size, +(args[1] || 4), mode); bad += cuts.length;
      console.log(`${size} cut (${mode}, ${args[1] || 4} matches, a child's taps): ${bridges.length} new situations brought in from play (${bridges.map(b => b.ev).join(', ') || 'none'}), ${cuts.length} cut(s) with no goal before them`);
      for (const r of cuts.slice(0, 10)) console.log('  cut: ' + cutText(r)); }
    const wr = await walkMatches(size, +(args[1] || 4)), wb = wr.filter(r => r.bad); bad += wb.length;
    console.log(`${size} walk: ${wr.length} passes and shots after a choice in ${args[1] || 4} matches (${wr.filter(r => r.calm).length} with nobody within ${WALK.pressure} m); played from where he is in all but ${wb.length}`);
    for (const r of wb.slice(0, 10)) console.log(`  walk: match ${r.seed} ${walkText(r)}`); }
  process.exitCode = bad ? 1 : 0;
}
