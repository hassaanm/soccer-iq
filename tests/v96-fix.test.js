// The v96 review's fixes to "Who's open?", "Dribble dash" and "Soccer puzzles" (one test or more for each; each fails on
// the release candidate it was found in). Browser-only proofs (the home screen's picture, the confetti, the 932x430 runs)
// are measured with silent headless Chrome and given in the v96 fix report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as O from '../js/mini/open.js';
import * as D from '../js/mini/dash.js';
import * as Z from '../js/mini/puzzle.js';
import { PIC } from '../js/mini/pics.js';
import { miniLines } from '../js/voicelines.js';
import { newRun, attempt } from '../js/mini/rules.js';
import { PITCH } from '../js/geom.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const OWNED = ['js/mini/open.js', 'js/mini/open-ui.js', 'js/mini/dash.js', 'js/mini/dash-ui.js', 'js/mini/puzzle.js', 'js/mini/puzzle-ui.js', 'js/mini/puzzle-marks.js', 'js/mini/pics.js'];
// A line's code and its trailing // comment (outside strings), or null.
function split(line) {
  let q = null;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && line[j + 1] === '/' && line[j - 1] !== ':') return [line.slice(0, j), line.slice(j + 2)];
  }
  return [line, null];
}
// A file's code with its // comments taken out (block comments kept: none hides code in these files).
const code = f => src(f).split('\n').map(l => split(l)[0]).join('\n');
// Between `start` and the next top-level function.
const body = (text, start) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const j = text.indexOf('\nfunction ', i + start.length), k = text.indexOf('\nexport ', i + start.length); return text.slice(i, Math.min(...[j, k].filter(x => x > 0), text.length)); };

// ---------- 1. Who's open? never draws its own scene on the home screen ----------
test("fix 1: Who's open warms up behind the home screen without drawing its own scene there", () => {
  const ui = code('js/mini/open-ui.js');
  const pre = body(ui, 'function prebuild()'), quiet = body(ui, 'function warmQuiet()');
  assert.match(pre, /warmQuiet\(\)/, 'the warm-up while the home screen shows is the quiet one');
  assert.doesNotMatch(pre, /[^.\w]warm\(\)/, 'not the one that draws the game\'s scene');
  assert.doesNotMatch(quiet, /world\.render\(|setup\(|stage\.cam/, 'the quiet warm-up draws the picture the screen already shows (no sim, no camera of its own)');
  assert.match(quiet, /cam\.near/, 'its bodies are drawn tiny, just in front of the camera as it is');
});

// ---------- 2. no code hidden after a // comment; the stadium after the training ground ----------
test('fix 2: no code sits after a // comment in the files this fix owns, and Who\'s open sets the night stadium', () => {
  const hits = [];
  for (const f of OWNED) src(f).split('\n').forEach((l, i) => {
    const [c, com] = split(l); if (com == null || !c.trim()) return;
    if (/\)\s+[\w$.]+\s*\(.*\)\s*;?\s*$/.test(com) || (/\b[\w$]+\.[\w$]+\([^)]*\)\s*;/.test(com)) || (/\b(const|let|if|for|return)\s+[\w$(]/.test(com) && /[;{]\s*$/.test(com))) hits.push(`${f}:${i + 1}`);
  });
  assert.deepEqual(hits, []);
  assert.match(body(code('js/mini/open-ui.js'), 'export async function runOpen()'), /world\.setEnv\('crowd'\)/, "runOpen calls world.setEnv('crowd') as code");
});

// ---------- 3. Who's open? welcoming first two tries ----------
test("fix 3: Who's open's first two tries of a run are welcoming, then the level's own numbers", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(O.welcomeOf), [0, 1, -1, -1, -1]);
  for (const w of [0, 1]) {
    const d = O.openLevel(0, w); assert.ok(d.secs >= 10 && d.friends === 2 && !d.hide && !d.press && !d.roam && !d.move && !d.two && !d.subtle);
    let prev = null; const kinds = new Set(), places = new Set();
    for (let i = 0; i < 120; i++) {
      for (const L of [0, 1, 7 / 3]) { // (welcoming whatever the score)
        const lay = O.makeLayout(L, 4000 + i * 31 + w, prev, w); prev = lay;
        assert.equal(lay.friends.length, 2); assert.equal(lay.foes.length, 1, 'one red only: the one that shuts the other friend');
        assert.equal(lay.ans.length, 1); assert.equal(lay.look, 0, 'the open friend is in view as the try starts');
        assert.ok(lay.friends.every(f => O.lookSteps(lay.hero, f) === 0), 'both friends in front of him');
        assert.ok(lay.secs >= O.WELCOME_SECS && lay.secs - lay.need >= 8, 'time to spare');
        const red = lay.foes[0], f = lay.friends.find(x => x.id === red.of), open = lay.friends.find(x => x.id === lay.ans[0]);
        assert.ok(red.job === 'marked' ? Math.hypot(red.x - f.x, red.y - f.y) <= .8 + 1e-9 : true, 'a marker right next to his man');
        assert.ok(Math.hypot(red.x - open.x, red.y - open.y) >= O.WELCOME_CLEAR[0], 'nobody near the open one');
        kinds.add(red.job); places.add(lay.place.key);
      }
    }
    assert.deepEqual([...kinds].sort(), ['lane', 'marked'], 'both kinds of shut friend'); assert.ok(places.size >= 6, 'the open one in many places');
  }
  // from the third try: as before (the level's own numbers)
  assert.deepEqual(O.openLevel(0), O.openLevel(0, -1)); assert.ok(O.openLevel(0).friends >= 3 && O.openLevel(2).hide > 0);
  const ui = code('js/mini/open-ui.js');
  assert.match(ui, /O\.welcomeOf\(run\.n\)/, 'the page asks for the welcoming layout by the try\'s number');
  assert.ok(O.AGAIN >= 1); assert.match(body(ui, 'function finish('), /T\.again > 0/, 'a welcoming try\'s first misses give more goes');
  assert.match(body(ui, 'async function playTry('), /begin\(lay, O\.AGAIN \* \(w >= 0 \? 1 : 0\)\)/, 'only in a welcoming try');
});

// ---------- 4. Dribble dash: forgiving first legs ----------
// The reviewer's careless child (v96 review minis2.mjs, its dash part): a first look 0.4 to 2.8 s after the arrows (one
// line in 12 never), then every 0.15 to 3.5 s a tap: on any arrow (7 in 10) or on the grass; now and then 10 s away.
function careless(R) {
  let key = null, at = 0, idle = 0;
  return { step(d) {
    const v = d.view(), now = d.t; if (!v) return;
    const k = d.lines.indexOf(v.line) + ':' + v.line.X.toFixed(1) + ':' + d.waves; if (k !== key) { key = k; at = now + (R() < .08 ? 1e9 : .4 + R() * 2.4); }
    if (now < at || now < idle) return; if (R() < .05) { idle = now + 10; at = idle; return; }
    if (R() >= .3) d.tap(v.choices[Math.floor(R() * v.choices.length)].id); at = now + (R() < .3 ? .15 + R() * .4 : 1.5 + R() * 2);
  } };
}
const rnd = s => { s = s >>> 0 || 1; return () => ((s = Math.imul(s ^ s >>> 15, 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296; };
function dashRuns(kind, runs, seed) {
  const scores = [], why = {};
  for (let k = 0; k < runs; k++) {
    const R = rnd(seed * 1000 + k), run = newRun(); let over = false;
    const d = new D.Dash({ L: PITCH.L, W: PITCH.W, run, seed: Math.floor(R() * 2 ** 31), hooks: { cross: (l, ok, info) => { if (!ok) why[info.why] = (why[info.why] || 0) + 1; attempt(run, ok); }, over: () => { over = true; } } });
    const b = kind === 'child' ? careless(R) : D.bot(kind, R); d.start();
    for (let i = 0; i < 60 * 60 * 40 && !over; i++) { d.tick(1 / 60); b.step(d); }
    scores.push(run.score);
  }
  return { mean: scores.reduce((a, b) => a + b, 0) / runs, scores, why };
}
test('fix 4: Dribble dash: the first two legs of a run are forgiving and varied; the careless child scores 2 or more', () => {
  const lanes = {}, moves = {}; let lines = 0;
  for (let i = 0; i < 400; i++) {
    const w = D.makeWave(i % 7 / 3, 900 + i, { easy: true, n: i % 3, cy: PITCH.W / 2 });
    assert.equal(w.kind, 'easy'); const l = w.lines[0]; lines++;
    assert.equal(l.choices.length, 3); assert.equal(l.defs.length, 1, 'one defender'); assert.equal(l.safe.length, 2, 'two ways wide open');
    assert.ok(Math.abs(D.velAt(l.defs[0].m, l.settle + 1e-6)) <= D.EASY_V[1] + 1e-9, 'and he is slow');
    assert.ok(l.openT <= -(D.EASY_SEE + D.LOCK) + 1e-9, 'time to choose');
    const shut = l.choices.find(c => !l.safe.includes(c.id)).id; lanes[shut] = (lanes[shut] || 0) + 1; moves[l.defs[0].m.kind] = (moves[l.defs[0].m.kind] || 0) + 1;
  }
  assert.ok(Object.keys(lanes).length === 3 && Object.keys(moves).length === 2, `varied: ${JSON.stringify({ lanes, moves })}`);
  // in play: legs 1 and 2 forgiving (a tackle restarts the same leg), leg 3 as the level says
  const run = newRun(1e9), kinds = []; let agains = 0;
  const d = new D.Dash({ L: PITCH.L, W: PITCH.W, run, seed: 3, hooks: { cross: (l, ok) => { kinds.push([d.legsDone, l.wave.kind]); attempt(run, ok); }, again: () => { agains++; } } });
  const b = D.bot('careful', rnd(4)); d.start();
  for (let i = 0; i < 60 * 240 && d.legsDone < 3; i++) { d.tick(1 / 60); b.step(d); }
  assert.ok(kinds.filter(([n]) => n < D.EASY_LEGS).every(([, k]) => k === 'easy') && kinds.some(([n, k]) => n >= D.EASY_LEGS && k !== 'easy'));
  // no tap in a forgiving leg: he runs on straight (no hesitation); the leg's first tackle costs no life
  const run2 = newRun(), whys = []; let again2 = 0;
  const d2 = new D.Dash({ L: PITCH.L, W: PITCH.W, run: run2, seed: 11, hooks: { cross: (l, ok, info) => { if (!ok) whys.push(info.why); attempt(run2, ok); }, again: () => { again2++; } } });
  d2.start(); for (let i = 0; i < 60 * 120 && !run2.over; i++) d2.tick(1 / 60);
  assert.ok(!whys.includes('none') || whys.indexOf('none') >= whys.length - 2, 'no hesitation tackle in the forgiving legs'); assert.ok(again2 <= D.EASY_LEGS);
  const c = dashRuns('child', 150, 1); assert.ok(c.mean >= 2, `the careless child's mean ${c.mean.toFixed(2)}`);
});

// ---------- 5. Dribble dash keeps rising past score 8 ----------
test('fix 5: Dribble dash keeps getting harder from score 8 through 40, by things he can see; a careful adult with human limits scores 10 to 30', () => {
  let was = D.dashLevel(8 / 3);
  for (let s = 12; s <= 40; s += 4) {
    const L = D.dashLevel(s / 3), up = [was.see - L.see >= .05, was.react - L.react >= .03, L.late2 - was.late2 >= .05, L.doubleP - was.doubleP >= .015, L.vmax - was.vmax >= .05, L.lateP - was.lateP >= .01];
    assert.ok(up.filter(Boolean).length >= 2, `score ${s - 4} to ${s}: ${up}`); was = L;
  }
  // the waves stay fair at the top: every choice plainly open or shut, the rule matches from `settle`, movers within the level's pace
  for (const s of [16, 28, 40]) for (let i = 0; i < 300; i++) {
    const w = D.makeWave(s / 3, 77 + i * 13, { hist: [], since: i % 4, cy: PITCH.W / 2 }), Lv = D.dashLevel(s / 3);
    for (const l of w.lines) { assert.ok(l.safe.length >= 1 && !Object.values(l.truth).includes('unclear')); assert.deepEqual(D.readLine(l, l.settle + 1e-6).sort(), [...l.safe].sort()); assert.ok(l.settle <= l.lockT - Lv.react + 1e-9); for (const p of l.defs) assert.ok(Math.abs(p.m.u) <= Lv.vmax + 1e-9); }
  }
  const a = dashRuns('careful', 10, 1); assert.ok(a.mean >= 10 && a.mean <= 30, `careful adult mean ${a.mean} (${a.scores})`);
  assert.deepEqual(Object.keys(a.why), ['shut'], 'his lives go to a gap that was shut as he crossed (seen, fair)');
});

// ---------- 6. the tackle line names the other team ----------
test('fix 6: "Tackled! Stay away from the other team." everywhere the old line was', () => {
  const LINE = 'Tackled! Stay away from the other team.';
  assert.equal(D.DASH_SAID.tackled, LINE); assert.equal(Z.PZ_WHY.tackle, LINE);
  const all = miniLines(); assert.ok(all.includes(LINE)); assert.ok(!all.some(l => /red players/i.test(l)), 'no spoken line speaks of red players');
  assert.doesNotMatch(src('js/mini/dash-ui.js'), /red players/i, 'nor the start card');
});

// ---------- 7. the first puzzles of a run: the cues point the way; the hand after a miss ----------
test('fix 7: at a score of 0 and 1 the cues point the way (a cue follower solves 60% or more), and the hand shows after a miss there', () => {
  for (const score of [0, 1]) {
    let sum = 0; const n = 60, starts = new Set();
    for (let i = 0; i < n; i++) {
      const p = Z.makePuzzle(score / 3, 700 + i), c = Z.cueChance(p, Z.startOf(p), p.moves); sum += c;
      assert.ok(p.len === 2, 'short: two moves'); starts.add(p.start.o.join() + '|' + p.start.d.join());
    }
    assert.ok(sum / n >= .6, `score ${score}: the cue follower solves ${(sum / n).toFixed(2)}`); assert.ok(starts.size >= n * .8, 'and they differ');
  }
  assert.equal(Z.puzzleLevel(2 / 3).cue, 0, 'from a score of 2, as before');
  assert.equal(Z.handWhen({ failedAt: 0 }), 'again'); assert.equal(Z.handWhen({ failedAt: 1 }), 'again');
  assert.equal(Z.handWhen({ failedAt: 2 }), null); assert.equal(Z.handWhen({ failedAt: null, i: 3 }), null);
  assert.equal(Z.handWhen({ firstEver: true, i: 0 }), 'plain'); assert.equal(Z.handWhen({ isNew: true }), 'new');
  assert.match(code('js/mini/puzzle-ui.js'), /handWhen\(\{ firstEver: first, i, isNew, failedAt \}\)/);
});

// ---------- 8. the moves counter without a CSS filter ----------
test('fix 8: no CSS filter in the puzzles\' page rules', () => {
  const rules = src('css/app.css').split('}').filter(r => /#pz\b/.test(r));
  assert.ok(rules.length > 5); assert.ok(rules.every(r => !/(^|[;{\s])(-webkit-)?(backdrop-)?filter\s*:/.test(r)), rules.filter(r => /filter/.test(r)).join('}'));
});

// ---------- 9. the confetti goes before the next board ----------
test('fix 9: a new board clears the last goal\'s confetti first', () => {
  const show = body(code('js/mini/puzzle-ui.js'), 'function showPuzzle(');
  assert.match(show, /clearFx\(\)/); assert.match(body(code('js/mini/puzzle-ui.js'), 'function clearFx()'), /P\.live = 0/);
});

// ---------- 10. the puzzles tile shows the 3D game ----------
test('fix 10: the puzzles tile shows the game as it is now: kids, their keeper in a goal, a planned pass and shot', () => {
  const p = PIC.puzzles;
  assert.match(p, /^<svg viewBox="0 0 120 84"/);
  assert.ok(!p.includes('width="112" height="76"'), 'not the old flat board');
  for (const c of ['#4f8dff', '#ff5a5f', '#ff8a3d', '#ffd23f', '#24193a']) assert.ok(p.includes(c), `colour ${c}`);
  assert.ok((p.match(/r="8.8"/g) || []).length >= 4, 'four chunky kids (their round heads)'); assert.match(p, /stroke-dasharray/, 'a planned path'); assert.match(p, /skewY/, 'the goal seen from the side');
});
