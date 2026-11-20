// (v93 PERF) The mini games' freezes on the phone (v92 play log): a result painted its sunburst and full-screen flash again
// and started several sounds at once; a mini game's start loaded every mini game's clips at once. These read the source
// (the browser modules cannot run here) and run the small pure parts on their own. The browser check is
// scripts/pop-audit.js (npm run audit:pop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

test('effects: at most one starts a frame; the same one asked twice in a wait starts once; none is lost', () => {
  const s = code('js/sound.js');
  const src = s.slice(s.indexOf('const fxWaiting = []'), s.indexOf('export function sfx('));
  const frames = [], started = [];
  const late = [], run = new Function('requestAnimationFrame', 'setTimeout', 'fxStart', 'SFX_START', src + '; return { fxWaiting, fxLater };')(f => frames.push(f), (f, ms) => (ms >= 100 ? late.push(f) : f()), k => started.push(k), { mode: 'pool+later' });
  for (const k of ['tap', 'yay', 'tap', 'star:0', 'star:1']) { run.fxWaiting.push(k); run.fxLater(); }
  assert.equal(frames.length, 1, 'one wait asked for, however many effects');
  const perFrame = []; while (frames.length) { const n = started.length; frames.shift()(); perFrame.push(started.length - n); }
  assert.deepEqual(started, ['tap', 'yay', 'star:0', 'star:1']);
  // with no frame at all (a hidden page, no frame loop) each wait ends by its timer
  started.length = 0; late.length = 0; for (const k of ['kick', 'tap']) { run.fxWaiting.push(k); run.fxLater(); }
  frames.length = 0; while (late.length) late.shift()(); assert.deepEqual(started, ['kick', 'tap'], 'no frame: the timer starts them, one per wait');
  assert.ok(perFrame.every(n => n <= 1), 'one a frame: ' + perFrame);
});

test('clips loaded ahead load one at a time, a frame apart; a clip a line needs now goes first, up to four at once', async () => {
  const s = code('js/sound.js');
  const af = s.slice(s.indexOf('const afterFrame'), s.indexOf('\n', s.indexOf('const afterFrame')));
  const src = af + '\n' + s.slice(s.indexOf('const LOADS'), s.indexOf('function clip(')).replace(/^export /gm, '');
  const frames = [];
  const q = new Function('requestAnimationFrame', 'setTimeout', 'performance', src + '; return { queued, state: () => ({ loading, waiting: waiting.map(j => j.file) }) };')(f => frames.push(f), (f, ms) => (ms >= 100 ? null : f()), { now: () => 0 });
  const done = {}, go = f => () => new Promise(r => { done[f] = r; });
  for (const f of ['a', 'b', 'c']) q.queued(f, go(f), false);
  assert.deepEqual(q.state(), { loading: 1, waiting: ['b', 'c'] }, 'one ahead at a time');
  q.queued('x', go('x'), true); q.queued('y', go('y'), true);
  assert.equal(q.state().loading, 3, 'lines needed now load beside it');
  q.queued('c', null, true); assert.deepEqual(q.state(), { loading: 4, waiting: ['b'] }, 'a waiting clip asked for now goes first');
  done.a(); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(q.state().waiting, ['b'], 'the next one ahead waits for a frame');
  for (const k of ['x', 'y', 'c']) done[k](); await new Promise(r => setTimeout(r, 0));
  assert.equal(q.state().loading, 0);
  frames.shift()(); assert.deepEqual(q.state(), { loading: 1, waiting: [] }, 'a frame later, the next');
});

test('a result: no layout forced, the sunburst and the flash are pictures made once, and it comes in over frames', () => {
  const h = code('js/ui/hud.js');
  const banner = h.slice(h.indexOf('  banner(text, kind, rated) {'), h.indexOf('  bannerOff()')), pop = h.slice(h.indexOf('  pop(stars, at) {'), h.indexOf('  busy()'));
  const head = banner.slice(0, banner.indexOf('if (!rated)'));
  assert.ok(!/offsetWidth|getBoundingClientRect|replay\(/.test(head), 'the big words and the flash force no layout');
  assert.ok(!/offsetWidth/.test(pop), 'the stars force no layout');
  assert.match(head, /inFrames\(1, \(\) => \{ if \(tok !== resultTok\) return; if \(splash\) big\.classList\.add\('lit'\); if \(text === 'GOAL!'\) flashGo\(\); \}\);/, 'sunburst and flash a frame after the words');
  assert.match(pop, /inFrames\(2, \(\) => \{/, 'the stars two frames after');
  const css = read('css/app.css');
  assert.match(css, /html\.hudimg body:not\(\.v75look\) #banner\.goal::before\{display:none\}/);
  assert.match(css, /#banner > img\.burst\{display:block;[^}]*will-change:transform,opacity;animation:spin 7s linear infinite paused\}/, 'the sunburst turns only while lit');
  assert.match(css, /html\.hudimg body:not\(\.v75look\) #flash\{background:none;will-change:opacity\}/);
  // the picture is drawn from the same numbers as the CSS gradient it replaces
  const rule = css.slice(css.indexOf('#banner.goal::before{'), css.indexOf('}', css.indexOf('#banner.goal::before{')));
  const [, color, on, period] = rule.match(/repeating-conic-gradient\((rgba\([^)]*\)) 0 (\d+)deg,rgba\([^)]*\) \d+deg (\d+)deg\)/);
  const [, inner, outer] = rule.match(/mask:radial-gradient\(circle,#000 (\d+)%,transparent (\d+)%\)/);
  const m = h.match(/burstPicture\(Math\.round\([^)]*\)\), '(rgba\([^)]*\))', (\d+), (\d+), ([.\d]+), ([.\d]+)\)/);
  assert.deepEqual([m[1], +m[2], +m[3], +m[4], +m[5]], [color, +on, +period, +inner / 100, +outer / 100]);
  const fl = css.match(/#flash\{position:absolute;inset:0;opacity:0;background:radial-gradient\(circle at 50% 45%,#fff 0,rgba\(255,240,170,\.7\) 45%,rgba\(255,240,170,0\) 80%\)\}/);
  assert.ok(fl, 'the flash gradient as drawn in flashPicture');
  assert.match(h, /r\.addColorStop\(0, '#fff'\); r\.addColorStop\(\.45, 'rgba\(255,240,170,\.7\)'\); r\.addColorStop\(\.8, 'rgba\(255,240,170,0\)'\)/);
});

test('a mini game loads its own lines (and every line its module says), not the other games\'', async () => {
  // voicewarm.js reads the page's save (ui/store.js); here only its list of lines is wanted, so it is read as text
  const src = code('js/ui/voicewarm.js');
  const { MINI, MINI_SAID } = await import('../js/mini/games.js'), { MOVE_NAME } = await import('../js/flair.js');
  const Saves = await import('../js/saves.js'), Pens = await import('../js/mini/pens.js'), Rondo = await import('../js/mini/rondo.js'), Puzzle = await import('../js/mini/puzzle.js');
  const body = src.slice(src.indexOf('const strings ='), src.indexOf('export function warmMini(')).replace(/^export /gm, '');
  const gameLines = new Function('MINI', 'MINI_SAID', 'MOVE_NAME', 'Saves', 'Pens', 'Rondo', 'Puzzle', body + '; return gameLines;')(MINI, MINI_SAID, MOVE_NAME, Saves, Pens, Rondo, Puzzle);
  const has = (id, ...ls) => { const g = new Set(gameLines(id)); for (const l of ls) assert.ok(g.has(l), `${id} loads "${l}"`); };
  has('keeper', 'Goalkeeper!', Saves.SAVED, ...Object.values(Saves.WHY), ...Object.values(Saves.SAID), MINI_SAID.best, 'What do you want to play?');
  has('pens', 'Penalties!', ...Object.values(Pens.PEN_SAID), ...Object.values(Pens.PEN_WHY));
  has('rondoKeep', ...Object.values(Rondo.RONDO_SAID)); has('rondoWin', 'Win the ball!', ...Object.values(Rondo.RONDO_SAID));
  has('puzzles', ...Object.values(Puzzle.PZ_SAID), ...Object.values(Puzzle.PZ_WHY), ...Object.values(Puzzle.PZ_IDEA));
  has('attack', 'Great pass!', 'Great choice!', 'Check your shoulder!', 'Where is the ball?');
  has('fast', 'Great pass!', 'Next goal wins!', Saves.SAID.youre);
  assert.ok(!gameLines('rondoKeep').includes(Saves.WHY.dive), 'the rondo does not load the keeper game\'s lines');
  assert.ok(!gameLines('keeper').some(l => Object.values(Rondo.RONDO_SAID).includes(l) && l !== 'Great steal!'), 'nor the keeper game the rondo\'s');
  assert.ok(gameLines('rondoKeep').length < 30 && gameLines('keeper').length < 30, 'a few lines, not every mini game\'s');
  assert.match(src, /export function warmKeeper\(id\) \{ warmMini\(id \|\| lastGame \|\| 'keeper'\); \}/, 'warmKeeper() as the games call it: the game whose tile was touched');
});

test('the speed record: a slow frame\'s parts are those of the gap (game, draw, page, wait); the usual frame for each mode', () => {
  const p = code('js/perf.js');
  assert.match(p, /\.\.\.prev\.sect, page, wait/);
  assert.match(p, /renderer\.info\.autoReset = false/, 'every pass of a frame counted');
  assert.match(p, /usual frame \$\{usual\.join\('; '\)/);
  assert.match(p, /obs\.observe\(document\.body/, 'the whole page watched');
  assert.match(p, /canvas \$\{c \? `\$\{c\.width\}x\$\{c\.height\}/, 'the canvas as it is when the report is made');
});
