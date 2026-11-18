// Round 13 (lag on the phone): the speed test page (dev/speed.html) and the fixes it checks. The browser modules can't
// run here, so these checks read the source as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.match(page, /else \{ G\.hush\(\); sound\.setMuted\(true\); \}/, 'and mute again as they end');
  assert.match(read('dev/speed.html'), /you will <b>hear<\/b> the game's sounds/, 'the page says so');
  // the one audio run plays zeros on muted players
  assert.match(page, /el\.muted = true; el\.volume = 0;/);
  assert.match(read('dev/speed.js'), /new ArrayBuffer\(44 \+ n \* 2\), v = new DataView\(buf\); \/\/ the samples stay zero/, 'nothing is written into the samples');
  assert.ok(!/setInt16|Float32Array/.test(page.slice(page.indexOf('function silentWav'), page.indexOf('let quiet'))), 'no sample is ever set');
});

test('the speed test writes nothing to his save but settings.tuned', () => {
  const page = code('dev/speed.js');
  assert.equal(page.match(/REAL\.setItem\(/g)?.length, 1, 'one write to the real storage');
  assert.match(page, /s\.settings\.tuned = \{/);
  assert.match(page, /defineProperty\(window, 'localStorage'/, 'the game sees a throwaway copy');
});

test('the speed test runs every switch the brief asks for', () => {
  const page = code('dev/speed.js'), runs = page.match(/const RUNS = \[([\s\S]*?)\n\];/)[1];
  for (const want of ["id: 'base'", "body: ['blur']", 'bloom: 1', 'shadowPass: false', 'pr: 1 ', 'pr: 2 ', 'pr: 3 ', "body: ['nofx']", 'particles: false', 'cap: false', 'sound: true', 'sfx: true', 'voice: true', "body: ['v75look', 'v75layers']", "body: ['softwords']", 'pretty: true', "id: 'base2'"])
    assert.ok(runs.includes(want), want);
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

test('an iPhone never reads the picture back for the iPad strip', () => {
  const main = code('js/main.js');
  assert.match(main, /const STRIP = !\/iPhone\|iPod\/\.test\(navigator\.userAgent\);/);
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
  const src = s.slice(s.indexOf('const LOADS'), s.indexOf('function clip('));
  const q = new Function(src + '; return { queued, state: () => ({ loading, waiting: waiting.map(j => j.file) }) };')();
  const done = {}, go = f => () => new Promise(r => { done[f] = r; });
  for (const f of ['a', 'b', 'c', 'd', 'e', 'f']) q.queued(f, go(f), false);
  assert.deepEqual(q.state(), { loading: 4, waiting: ['e', 'f'] });
  q.queued('f', null, true); assert.deepEqual(q.state().waiting, ['f', 'e'], 'a clip needed now goes first');
  assert.equal(q.queued('a', null, true), null, 'a clip in flight is left alone');
  assert.equal(q.state().loading, 4);
});

test('Smooth with the tuned blur uses the blurred edge; without it, the plain one', () => {
  const hud = code('js/ui/hud.js'), css = read('css/app.css'), sp = code('js/ui/speed.js');
  assert.match(hud, /classList\.contains\('smooth'\) && !document\.body\.classList\.contains\('blur'\)/);
  assert.match(css, /body\.smooth\.blur #tunnel\{[^}]*backdrop-filter:blur\(7px\)/);
  assert.match(sp, /classList\.toggle\('blur', sm && !!t\.blur\)/);
});

test('Smooth paints what shows in play the cheap way; Pretty and the speed test\'s v75 run keep the old way', () => {
  const css = read('css/app.css'), tail = css.slice(css.indexOf('(round 13) Graphics on Smooth: what shows or moves in play'));
  for (const sel of ['#rate .stars span.on.pop', '#kGlove', '#hand span', '#skillBtn .ring circle'])
    assert.match(tail, new RegExp('body\\.smooth:not\\(\\.v75look\\) ' + sel.replace(/[.#()]/g, m => '\\' + m) + '\\{filter:none'), sel);
  assert.match(tail, /@keyframes nudgeS\{0%,100%\{scale:1\}50%\{scale:1\.07\}\}/, 'the pulse keeps its size change');
  assert.match(tail, /#tunnel > img\.edge\{display:block/, 'the edge picture');
  assert.ok(!/filter|box-shadow|left|top|width|height/.test(tail.match(/@keyframes nudgeS[^}]*\}[^}]*\}\}/)[0].replace('nudgeS', '')), 'the new pulse animates scale only');
  assert.match(read('index.html'), /<circle class="glow" cx="50" cy="50" r="47"\/>/);
  assert.match(code('js/ui/hud.js'), /g\.translate\(128, \.57 \* 256\); g\.scale\(\.23 \* 256, \.26 \* 256\);/, 'the edge picture uses the CSS gradient\'s ellipse');
  assert.match(css, /body\.smooth #tunnel\{[^}]*radial-gradient\(ellipse 23% 26% at 50% 57%,rgba\(14,10,26,0\) 50%,rgba\(14,10,26,\.62\) 72%,rgba\(14,10,26,\.9\) 100%\)/);
});
