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

test('the speed test is silent: no player can be made, and the game loads only after the switch is set', () => {
  const sound = code('js/sound.js'), page = code('dev/speed.js');
  assert.match(sound, /export function unlock\(\) \{\s*if \(SILENT\.on\) return;/, 'unlock() returns first thing when SILENT is on');
  const set = page.indexOf('SILENT.on = true'), main = page.indexOf("'../js/main.js'");
  assert.ok(set > 0 && main > set, 'SILENT is set before main.js is imported');
  assert.match(page, /muted: true, sound: false, music: false, voice: false/, 'the throwaway save has every sound off');
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
  for (const want of ["id: 'base'", "body: ['blur']", 'bloom: 1', 'shadowPass: false', 'pr: 1 ', 'pr: 2 ', 'pr: 3 ', "body: ['nofx']", 'particles: false', 'cap: false', 'sound: true', 'pretty: true', "id: 'base2'"])
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
  assert.match(css, /html\.burst #banner\.goal::before\{background:var\(--burst-goal\)[^}]*mask:none\}/);
  assert.match(css, /html\.burst \.sticker\.trophy::before\{background:var\(--burst-trophy\)[^}]*mask:none\}/);
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
});

test('Smooth with the tuned blur uses the blurred edge; without it, the plain one', () => {
  const hud = code('js/ui/hud.js'), css = read('css/app.css'), sp = code('js/ui/speed.js');
  assert.match(hud, /classList\.contains\('smooth'\) && !document\.body\.classList\.contains\('blur'\)/);
  assert.match(css, /body\.smooth\.blur #tunnel\{[^}]*backdrop-filter:blur\(7px\)/);
  assert.match(sp, /classList\.toggle\('blur', sm && !!t\.blur\)/);
});
