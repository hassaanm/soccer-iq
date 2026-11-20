// Round 13 (lag on the phone): the speed test page (dev/speed.html) and the fixes it checks. The browser modules can't
// run here, so these checks read the source as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

test('the speed test is silent unless its sound box is ticked: no player can be made, and the game loads only after the switch is set', () => {
  const sound = code('js/sound.js'), page = code('dev/speed.js');
  assert.match(sound, /export function unlock\(\) \{\s*if \(SILENT\.on\) return;/, 'unlock() returns first thing when SILENT is on');
  const set = page.indexOf('SILENT.on = true'), main = page.indexOf("'../js/main.js'");
  assert.ok(set > 0 && main > set, 'SILENT is set before main.js is imported');
  assert.match(page, /muted: true, sound: false, music: false, voice: false/, 'the throwaway save has every sound off');
  // the game's players are unlocked only in the Start tap, only with the box ticked, and muted again at once
  assert.equal(page.match(/\.unlock\(\)/g)?.length, 1, 'one unlock');
  assert.match(page, /withSound = !!\$\('#stSound'\)\?\.checked;\s*if \(withSound\) \{ try \{ G\.sound\.SILENT\.on = false; G\.sound\.unlock\(\); G\.sound\.setMuted\(true\);/);
  assert.match(page, /if \(r\.sfx && withSound\)/, 'only the sound runs unmute');
  assert.match(page, /else \{ G\.hush\(\); sound\.setMuted\(true\); applyGraphics\(\); \}/, 'and mute again as they end');
  assert.match(read('dev/speed.html'), /you will <b>hear<\/b> the game's sounds/, 'the page says so');
  assert.ok(!/new Audio\(/.test(page), 'the page makes no player of its own');
});

test('the speed test writes nothing to his save but settings.tuned', () => {
  const page = code('dev/speed.js');
  assert.equal(page.match(/REAL\.setItem\(/g)?.length, 1, 'one write to the real storage');
  assert.match(page, /if \(tuned\) save\.settings\.tuned = tuned; else delete save\.settings\.tuned;\s*REAL\.setItem\(SAVE_KEY, JSON\.stringify\(save\)\);/, 'and it changes only settings.tuned');
  assert.match(page, /globalThis\.SOCCER_THROWAWAY = \{ map \};/, 'the game sees a throwaway copy');
  assert.ok(page.indexOf('SOCCER_THROWAWAY') < page.indexOf("import('../js/"), 'set before any game module loads');
  assert.ok(!/if \(!swapped\)/.test(page), 'replacing window.localStorage is not required');
});

test('the speed test (version 2): the standard three times, the ways of starting a sound, the pop-ups, under two minutes', () => {
  const page = code('dev/speed.js'), runs = page.match(/const RUNS = \[([\s\S]*?)\n\];/)[1];
  for (const want of ["id: 'base'", "id: 'base2'", "id: 'base3'", "sfx: 'one'", "sfx: 'pool'", "sfx: 'later'", "sfx: 'pool+later'", 'rebuild: true', "body: ['nofx']", "off: ['blur', 'softwords']", 'pr: 2 ', 'pretty: true'])
    assert.ok(runs.includes(want), want);
  const n = (runs.match(/\{ id:/g) || []).length, heard = (runs.match(/sfx: '/g) || []).length;
  const [RUN, HEARD] = page.match(/const RUN_MS = (\d+), HEARD_MS = (\d+)/).slice(1).map(Number);
  assert.ok(((n - heard) * RUN + heard * HEARD) / 1000 + 6 < 120, 'under two minutes');
  const first = runs.indexOf("id: 'base'"), second = runs.indexOf("id: 'base2'"), third = runs.indexOf("id: 'base3'");
  assert.ok(first < second && second < third && runs.indexOf("'pretty'") < third, 'the standard runs spread through the test');
  assert.match(page, /noise \(standard ×3\)/, 'the spread is printed');
  assert.ok(read('js/ui/menu.js').length && read('index.html').includes('id="speedTestBtn"'), 'the grown-ups menu has the row');
  assert.match(code('js/ui/speed.js'), /speedTestBtn'\)\.onclick = \(\) => \{ location\.href = 'dev\/speed\.html'; \}/);
});

test('the sunburst images are drawn from the same numbers as the CSS gradients they replace', () => {
  const css = read('css/app.css'), js = code('js/ui/speed.js');
  const grad = sel => {
    const rule = css.slice(css.indexOf(sel + '{'), css.indexOf('}', css.indexOf(sel + '{')));
    const [, color, on, period] = rule.match(/repeating-conic-gradient\((rgba\([^)]*\)) 0 (\d+)deg,rgba\([^)]*\) \d+deg (\d+)deg\)/);
    const [, inner, outer] = rule.match(/mask:radial-gradient\(circle,#000 (\d+)%,transparent (\d+)%\)/);
    return [color, +on, +period, +inner / 100, +outer / 100];
  };
  const call = name => { const m = js.match(new RegExp(`burst\\('${name}', [^,]+\\([^)]*\\)\\), '(rgba\\([^)]*\\))', (\\d+), (\\d+), ([.\\d]+), ([.\\d]+)\\)`)); return [m[1], +m[2], +m[3], +m[4], +m[5]]; };
  assert.deepEqual(call('--burst-goal'), grad('#banner.goal::before'));
  assert.deepEqual(call('--burst-trophy'), grad('.sticker.trophy::before'));
  assert.match(css, /html\.burst body:not\(\.v75look\) #banner\.goal::before\{background:var\(--burst-goal\)[^}]*mask:none\}/);
  assert.match(css, /html\.burst body:not\(\.v75look\) \.sticker\.trophy::before\{background:var\(--burst-trophy\)[^}]*mask:none\}/);
});

test('only an iPad home-screen app reads the picture back for the iPad strip', () => {
  const main = code('js/main.js');
  assert.match(main, /return pad && navigator\.standalone === true && Math\.min\(screen\.width, screen\.height\) >= 700;/, 'only an iPad home-screen app');
  assert.match(main, /if \(TEST\.strip \?\? STRIP\) matchStrip\(now\);/);
});

test('voice clips load a few at a time, and a line that needs one now puts it first', () => {
  const s = code('js/sound.js');
  assert.match(s, /const LOADS = 4/);
  assert.match(s, /export function preloadClips\(keys\) \{ if \(voiceIndex\) keys\.forEach\(k => clip\(k, false\)\); \}/, 'preloads queue at the back');
  assert.ok(!/\.map\(clip\)|\.forEach\(clip\)/.test(s), 'clip is never passed straight to map/forEach (the index would be taken for `now`)');
  // a clip already loading or loaded is only moved up the queue, never queued again with nothing to run
  assert.match(s, /return job\.p; \}\s*if \(!go\) return null;/);
  // and the queue itself, run here on its own: priority, the limit, and a second ask for a clip in flight
  const src = s.slice(s.indexOf('const LOADS'), s.indexOf('function clip(')).replace(/^export /gm, '');
  const q = new Function(src + '; return { queued, state: () => ({ loading, waiting: waiting.map(j => j.file) }) };')();
  const done = {}, go = f => () => new Promise(r => { done[f] = r; });
  for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) q.queued(f, go(f), false);
  assert.deepEqual(q.state(), { loading: 1, waiting: ['b', 'c', 'd', 'e', 'f'] }, '(v93) clips loaded ahead: one at a time (tests/pop.test.js)');
  q.queued('f', null, true); assert.deepEqual(q.state(), { loading: 2, waiting: ['b', 'c', 'd', 'e'] }, 'a clip needed now goes first, at once');
  assert.equal(q.queued('a', null, true), null, 'a clip in flight is left alone');
  assert.equal(q.state().loading, 2);
});

test('Smooth with the tuned blur uses the blurred edge; without it, the plain one', () => {
  const hud = code('js/ui/hud.js'), css = read('css/app.css'), sp = code('js/ui/speed.js');
  assert.match(hud, /classList\.contains\('smooth'\) && !document\.body\.classList\.contains\('blur'\)/);
  assert.match(css, /body\.smooth\.blur #tunnel\{[^}]*backdrop-filter:blur\(7px\)/);
  assert.match(sp, /classList\.toggle\('blur', sm && !!t\.blur\)/);
});

test('Smooth paints what shows in play the cheap way; Pretty and the speed test\'s v75 run keep the old way', () => {
  const css = read('css/app.css'), tail = css.slice(css.indexOf('(round 13) Graphics on Smooth: what shows or moves in play'));
  for (const sel of ['#rate .stars span.on.pop', '#kGlove', '#hand span', '.skillPick .ring circle'])
    assert.match(tail, new RegExp('body\\.smooth:not\\(\\.v75look\\) ' + sel.replace(/[.#()]/g, m => '\\' + m) + '\\{filter:none'), sel);
  assert.match(tail, /@keyframes nudgeS\{0%,100%\{scale:1\}50%\{scale:1\.07\}\}/, 'the pulse keeps its size change');
  assert.match(tail, /#tunnel > img\.edge\{display:block/, 'the edge picture');
  assert.ok(!/filter|box-shadow|left|top|width|height/.test(tail.match(/@keyframes nudgeS[^}]*\}[^}]*\}\}/)[0].replace('nudgeS', '')), 'the new pulse animates scale only');
  assert.match(read('index.html'), /<circle class="glow" cx="50" cy="50" r="47"\/>/);
  assert.match(code('js/ui/hud.js'), /g\.translate\(128, \.57 \* 256\); g\.scale\(\.23 \* 256, \.26 \* 256\);/, 'the edge picture uses the CSS gradient\'s ellipse');
  assert.match(css, /body\.smooth #tunnel\{[^}]*radial-gradient\(ellipse 23% 26% at 50% 57%,rgba\(14,10,26,0\) 50%,rgba\(14,10,26,\.62\) 72%,rgba\(14,10,26,\.9\) 100%\)/);
});

test('with the throwaway flag set, the game reads and writes its save only in memory', async () => {
  const touched = [];
  globalThis.localStorage = { getItem: k => { touched.push('get ' + k); return null; }, setItem: k => touched.push('set ' + k), removeItem: k => touched.push('remove ' + k), clear: () => touched.push('clear') };
  const map = { 'soccer-iq:v1': JSON.stringify({ v: 1, us: 'liverpool', sessions: 3, settings: { size: process.env.SOCCER_SIZE || '3v3', graphics: 'smooth' } }) };
  globalThis.SOCCER_THROWAWAY = { map };
  const st = await import('../js/storage.js'), pr = await import('../js/progress.js');
  assert.equal(st.throwaway, true);
  const p = pr.load(); assert.equal(p.us, 'liverpool'); assert.equal(p.sessions, 3);
  p.sessions = 9; p.settings.tuned = { blur: true }; pr.save(p);
  assert.equal(JSON.parse(map['soccer-iq:v1']).sessions, 9, 'written to the copy');
  assert.deepEqual(touched, [], 'the real storage was never read or written');
});

test('the game reaches the save only through js/storage.js', () => {
  const walk = d => readdirSync(join(root, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
  for (const f of walk('js')) if (f !== join('js', 'storage.js')) assert.ok(!/\blocalStorage\b/.test(code(f)), f + ' uses localStorage directly');
});

test('one standard look everywhere; a test result wins only with real values; the menu says what is in force', () => {
  const sp = code('js/ui/speed.js');
  assert.match(sp, /export const graphics = \(\) => 'smooth';/, 'no Smooth or Pretty choice: a saved settings.graphics is ignored');
  assert.match(sp, /export const STANDARD = \{ blur: true, glow: true, soft: true, pr: 0 \};/);
  const src = sp.match(/export const tuned = \(\) => \{[\s\S]*?return o; \};/)[0].replace('export ', '');
  const fn = P => new Function('P', 'SFX_MODES', 'STANDARD', 'TUNED_VERSION', src + 'return tuned();')(P, ['one', 'pool', 'later', 'pool+later'], { blur: true, glow: true, soft: true, pr: 0 }, 2);
  const std = { blur: true, glow: true, soft: true, pr: 0, fromTest: false };
  assert.deepEqual(fn({ settings: {} }), std, 'the standard');
  assert.deepEqual(fn({ settings: { graphics: 'pretty' } }), std, 'an old Pretty is ignored');
  assert.deepEqual(fn({ settings: { tuned: { pr: 3 } } }), std, "v76's result (no version) is ignored");
  assert.deepEqual(fn({ settings: { tuned: { tv: 1, blur: false, pr: 2 } } }), std, 'another version is ignored');
  assert.deepEqual(fn({ settings: { tuned: { tv: 2, blur: 'no', glow: 1, soft: 'yes', pr: '3', sfx: 'fast' } } }), std, 'every value invalid: the standard, and the menu says so');
  assert.deepEqual(fn({ settings: { tuned: { tv: 2, blur: false, glow: false, soft: true, pr: 2, sfx: 'pool', at: '2026-11-18' } } }), { blur: false, glow: false, soft: true, pr: 2, sfx: 'pool', at: '2026-11-18', fromTest: true });
  assert.match(sp, /const t = tuned\(\), set = t\.fromTest;/, 'the menu calls it a test result only when one is in force');
  assert.match(code('dev/speed.js'), /writeTuned\(\{ tv: G\.TUNED_VERSION,/, 'the test stamps its results');
  const html = read('index.html');
  assert.ok(!html.includes('gfxSel') && !/>Pretty</.test(html), 'no Smooth / Pretty row');
  assert.match(html, /<small id="gfxNow">/); assert.match(html, /id="gfxResetRow"/); assert.match(html, /Run the speed test<small>About 100 seconds, some of it with sound/);
  assert.match(sp, /if \(\$\('#gfxResetRow'\)\) \$\('#gfxResetRow'\)\.style\.display = w\.set \? '' : 'none';/, 'the reset row shows only with a test result');
  const page = code('dev/speed.js');
  assert.match(page, /\$\('#stMsg'\)\.textContent = `Green: as good as the standard runs\. \$\{applyBest\(b\)\}/, 'the test uses what it found, by itself');
  assert.match(read('dev/speed.html'), /id="stNormal"[^>]*>Back to standard settings</, 'and a way back');
  assert.ok(!read('dev/speed.html').includes('stBest'), 'no separate best-settings button');
});


test('effects start in the way the speed test found best; two players for the frequent ones, never one still playing', () => {
  const s = code('js/sound.js');
  assert.match(s, /export const SFX_START = \{ mode: 'pool\+later' \};/);
  assert.match(s, /const FREQ = new Set\(\['tap', 'click', 'kick', 'up', 'star:0', 'star:1', 'star:2'\]\), POOL = 2;/);
  const src = s.slice(s.indexOf('function fxPick('), s.indexOf('function fxStart('));
  const fxEls = new Map(), fxNext = new Map(), pick = new Function('fxEls', 'fxNext', src + 'return fxPick;')(fxEls, fxNext);
  const a = { paused: false, ended: false }, b = { paused: true, ended: false };
  fxEls.set('tap', [a, b]); fxEls.set('goal', [a]);
  assert.equal(pick('tap', true), b, 'the free one');
  b.paused = false; assert.ok([a, b].includes(pick('tap', true)), 'both busy: the one started longest ago');
  assert.equal(pick('tap', false), a, "'one' mode: always the first");
  assert.equal(pick('goal', true), a);
  assert.match(code('js/ui/speed.js'), /SFX_START\.mode = t\.sfx \|\| 'pool\+later';/);
});

test('the modules this work touches parse', () => {
  for (const f of ['js/sound.js', 'js/ui/speed.js', 'js/ui/hud.js', 'js/ui/results.js', 'js/world.js', 'js/main.js', 'js/storage.js', 'dev/speed.js']) {
    const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ': ' + r.stderr);
  }
});

test('a result builds no nodes: the big words, stars, dots and score reuse theirs', () => {
  const h = code('js/ui/hud.js');
  for (const gone of ["big.querySelector('b').innerHTML", "querySelector('.stars').innerHTML", 'inner.innerHTML', 'ui.dots.innerHTML'])
    assert.ok(!h.includes(gone), gone + ' is gone');
  assert.match(h, /if \(i\.firstChild\.nodeValue !== t\) i\.firstChild\.nodeValue = t;/, 'letters change their text in place');
  assert.match(h, /if \(was && was\.teams === `\$\{us\.id\} \$\{them\.id\}` && ems\.length === 2\)/, 'the score changes only its numbers');
  assert.match(read('css/app.css'), /:is\(#banner,#skillName\) i\.off\{display:none\}/);
  assert.match(code('js/ui/results.js'), /requestAnimationFrame\(\(\) => \{ if \(tok === paperTok\) \{ el\.prepend\(box\);/, 'confetti one frame after the card');
});

test('the governor steps down only after five slow seconds in a row, never while voice clips load', () => {
  const w = code('js/world.js');
  const src = 'function ' + w.slice(w.indexOf('  pace(ms) {') + 2, w.indexOf("  // (round 11) The grown-ups' \"Graphics\" setting") > 0 ? w.indexOf("  // (round 11) The grown-ups' \"Graphics\" setting") : w.indexOf('  setGraphics('));
  const QUALITY = eval(w.match(/const QUALITY = (\[[\s\S]*?\]);/)[1]);
  let loading = 0;
  const make = () => new Function('QUALITY', 'SLOW_SECONDS', 'clipsLoading', 'devicePixelRatio', 'performance', src + '; return pace;')(QUALITY, 5, () => loading, 3, { now: () => 1e9 });
  const world = () => ({ level: 0, pacer: { win: [], t: 0, slow: 0, skip: 3, first: 0, steps: 0, done: false }, pending: null });
  const run = (o, ms, secs) => { const pace = make(); for (let t = 0; t < secs * 1000; t += ms) pace.call(o, ms); };
  let o = world(); run(o, 16.7, 60); assert.equal(o.pending, null, 'a steady 60 never steps');
  o = world(); run(o, 19, 60); assert.equal(o.pending, null, 'about 52 a second never steps');
  o = world(); run(o, 40, 7); assert.equal(o.pending, null, '4 slow seconds (after the first 3 not judged) are not enough');
  o = world(); run(o, 40, 10); assert.equal(o.pending, 1, 'five slow seconds in a row step down once');
  o = world(); loading = 5; run(o, 40, 20); assert.equal(o.pending, null, 'not while clips load'); loading = 0;
});

test('the speed test changes a setting only when the evidence is outside the noise of the three standard runs', () => {
  const page = code('dev/speed.js'), bestOf = new Function(page.match(/function bestOf\(res\) \{[\s\S]*?\n\}\n/)[0] + 'return bestOf;')();
  const run = (id, fps, p95, slow, extra = {}) => ({ id, name: id, fps, p95, slow, max: 40, n: 300, ...extra });
  const base = (a = 0) => [run('base', 54 + a, 26, 6, { base: true }), run('base2', 55, 25, 5, { base: true }), run('base3', 53, 33, 8, { base: true })];
  const sounds = (one, pool, later, pl) => [run('one', ...one, { sfx: 'one' }), run('pool', ...pool, { sfx: 'pool' }), run('later', ...later, { sfx: 'later' }), run('poollater', ...pl, { sfx: 'pool+later' })];
  // all equal: nothing moves away from the standard (except a ratio 2 that is no worse on every measure)
  let b = bestOf([...base(), ...sounds([54, 26, 6], [54, 26, 6], [54, 26, 6], [54, 26, 6]), run('plain', 55, 25, 5), run('pr2', 54, 26, 6)]);
  assert.equal(b.sfx, null); assert.ok(b.blur && b.glow && b.soft); assert.equal(b.pr, 2);
  assert.ok(b.why.some(w => /no clear difference, kept standard/.test(w)), 'says so');
  // within the noise (3 slow frames of spread): still the standard
  b = bestOf([...base(), ...sounds([54, 26, 4], [54, 26, 5], [54, 26, 6], [54, 26, 6]), run('plain', 56, 25, 4), run('pr2', 42, 30, 6)]);
  assert.equal(b.sfx, null, 'one or two slow frames fewer is noise'); assert.ok(b.blur, 'a small gain is noise'); assert.equal(b.pr, 0, 'ratio 2 at 42 a second loses');
  // one clearly better: it wins
  b = bestOf([...base(), ...sounds([54, 26, 14], [54, 26, 2], [54, 26, 12], [54, 26, 12]), run('plain', 59, 19, 0), run('pr2', 54, 34, 6)]);
  assert.equal(b.sfx, 'pool'); assert.ok(!b.blur && !b.glow && !b.soft, 'off when clearly better without them'); assert.equal(b.pr, 0, 'ratio 2 worse on the 95th percentile');
  // no sound runs (box unticked)
  b = bestOf([...base(), run('pr2', 54, 26, 6)]); assert.equal(b.sfx, null); assert.equal(b.measuredSfx, false);
  assert.ok(b.why.length >= 4 && b.why.every(w => typeof w === 'string'), 'each decision says what it compared');
});

test('a voice clip fetch that never ends does not stop the governor for good', () => {
  const s = code('js/sound.js');
  assert.match(s, /export const clipsLoading = \(\) => \(performance\.now\(\) - moved < STUCK \? loading \+ waiting\.length : 0\);/);
  assert.match(s, /setTimeout\(\(\) => ctl\.abort\(\), 20000\)/, 'a fetch is given up after 20 s');
});
