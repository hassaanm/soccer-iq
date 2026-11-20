// v93, the UI worker's five fixes: the Mode toggle, the play-log button and panel, the speed test that applies nothing until
// asked, the skill buttons that say their move, and a tap on a mini game's tile that starts exactly one thing. The browser
// modules cannot run here, so the pure parts are loaded (mode.js, graphics.js, starter.js) and the pages are read as text;
// dev/speed.js's choice code is run against stand-ins for the page and the storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeOf, modeName, nextMode } from '../js/ui/mode.js';
import { tunedFrom, graphicsState, differences, resultSentence, shortDate, STANDARD } from '../js/ui/graphics.js';
import { makeStarter, NAME_WAIT_MS } from '../js/mini/starter.js';
import { nameButtons, SKILL_IDS } from '../js/game/skill.js';
import { MOVE_NAME } from '../js/flair.js';
import { RUN_MOVES } from '../js/sim.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const SFX = ['one', 'pool', 'later', 'pool+later'];

// ---------- 1. the Mode toggle ----------
test('one Mode toggle: a tap flips settings.mode between slow (Classic) and fast (Live); unset reads as Classic', () => {
  const s = {};
  assert.equal(modeOf(s), 'slow'); assert.equal(modeName(s), 'Classic');
  assert.equal(modeName({ mode: 'slow' }), 'Classic'); assert.equal(modeName({ mode: 'fast' }), 'Live');
  assert.equal(modeOf({ mode: 'turtle' }), 'slow', 'anything else is Classic');
  s.mode = nextMode(s); assert.equal(s.mode, 'fast');
  s.mode = nextMode(s); assert.equal(s.mode, 'slow');
  // the home screen: its tap handler writes the setting through nextMode and saves it
  const home = code('js/ui/home.js');
  assert.match(home, /modeBtn\.onclick = \(\) => \{ P\.settings\.mode = nextMode\(P\.settings\); save\(\); renderMode\(\); \};/);
  assert.match(home, /aria-label', `Mode: \$\{name\}`/);
});

test('the Mode toggle is ONE button with words; the tortoise and the hare are gone', () => {
  const html = read('index.html'), css = read('css/app.css');
  assert.equal(html.match(/id="modePick"/g).length, 1);
  assert.match(html, /<button id="modePick" class="modetoggle" type="button" role="switch" aria-checked="false"[^>]*>Mode: <b>Classic<\/b><\/button>/);
  assert.ok(!/data-mode="(slow|fast)"|class="modepick"/.test(html), 'no pair of picture buttons');
  assert.ok(!/\.modepick/.test(css), 'their css is gone');
  const mid = html.slice(html.indexOf('<div class="mid">'), html.indexOf('data-side="them"'));
  assert.ok(!/<svg/.test(mid.slice(mid.indexOf('id="modePick"'))), 'no drawing under the size chip');
});

// ---------- 2. the play log: a small button at the left edge and a panel ----------
test('the play-log buttons: a round button at the left edge opens a panel with Copy log, Clear log and the size; a tap outside closes it', () => {
  const html = read('index.html'), css = read('css/app.css'), js = code('js/ui/playlog.js');
  assert.ok(!html.includes('id="logBar"') && !/#logBar/.test(css), 'the old bar over the home buttons is gone');
  const home = html.slice(html.indexOf('<section id="home"'), html.indexOf('<div id="soundPop"'));
  for (const id of ['logTab', 'logPanel', 'logCopy', 'logClear', 'logSize']) assert.match(home, new RegExp(`id="${id}"`), id + ' is on the home screen');
  assert.match(home, /id="logPanel" class="hidden"/, 'closed to start with');
  assert.match(home, />Copy log<\/button><button id="logClear"[^>]*>Clear log</, 'two big buttons with words');
  assert.match(css, /body\.logon #logTab\{display:grid\}/, 'only while "Record play" is on');
  assert.match(css, /#logTab\{display:none;position:absolute;[^}]*left:calc\(8px \+ var\(--safe-l\)\);top:50%;transform:translateY\(-50%\)/, 'left edge, centred');
  assert.match(js, /logPanel\?\.addEventListener\('click', e => \{ if \(e\.target === logPanel\) logPanelOpen\(false\); \}\)/, 'a tap on the sheet outside the panel closes it');
  assert.match(js, /logTab\?\.addEventListener\('click', \(\) => logPanelOpen\(logPanel\.classList\.contains\('hidden'\)\)\)/);
  assert.match(js, /copyText\(e\.currentTarget, 'Copy log'\)/, 'the copy feedback stays');
  assert.match(js, /clearLog\(e\.currentTarget, 'Clear log'\)/);
  assert.match(js, /if \(!on \|\| throwaway\) logPanelOpen\(false\)/, 'recording off closes it');
});

// ---------- 3. the speed test applies nothing until asked ----------
test('the graphics words: "Graphics: standard", or "tuned for this phone (Nov 20)" for a result already in the save', () => {
  assert.deepEqual(tunedFrom({}, SFX), { ...STANDARD, fromTest: false });
  assert.equal(graphicsState(tunedFrom({}, SFX)).text, 'Graphics: standard');
  // a save written by the old automatic test keeps its settings, shown as tuned
  const old = { tuned: { tv: 2, blur: true, glow: false, soft: true, pr: 2, at: '2026-11-20', v: 'v92' } };
  const t = tunedFrom(old, SFX);
  assert.equal(t.fromTest, true); assert.equal(t.glow, false); assert.equal(t.pr, 2);
  assert.equal(graphicsState(t).text, 'Graphics: tuned for this phone (Nov 20)');
  assert.equal(graphicsState({ ...t, at: undefined }).text, 'Graphics: tuned for this phone', 'no date: none shown');
  assert.equal(shortDate('2026-01-05'), 'Jan 5'); assert.equal(shortDate('junk'), '');
  assert.equal(graphicsState(tunedFrom({ tuned: { tv: 1, glow: false } }, SFX)).text, 'Graphics: standard', "another version's result is ignored");
});

test('the result sentence: what the phone can use, or that the standard is already best', () => {
  assert.equal(resultSentence({ blur: true, glow: true, soft: true, pr: 0, sfx: null }), 'The standard settings are already the best for this phone.');
  assert.equal(resultSentence({ blur: true, glow: true, soft: true, pr: 0, sfx: 'pool+later' }), 'The standard settings are already the best for this phone.');
  assert.equal(resultSentence({ blur: true, glow: false, soft: true, pr: 2, sfx: null }), 'This phone can use: sharper picture, no glow.');
  assert.deepEqual(differences({ blur: false, glow: false, soft: false, pr: 0, sfx: 'pool' }), ['no head-down blur', 'no glow', 'no soft shadow', 'sounds that start another way']);
  const inForce = tunedFrom({ tuned: { tv: 2, glow: false, pr: 2 } }, SFX);
  assert.match(resultSentence({ blur: true, glow: false, soft: true, pr: 2 }, inForce), /already in use\.$/);
});

// dev/speed.js's choice code (from "the test applies nothing by itself" to the end of the file), run against a fake page and a fake storage.
function speedPage(save, result) {
  const src = read('dev/speed.js'), w0 = src.indexOf('function writeTuned('), w1 = src.indexOf('\n}\n', w0) + 3,
    part = src.slice(w0, w1) + src.slice(src.indexOf('// (v93) The test applies nothing by itself'));
  const store = { 'soccer-iq:v1': save ? JSON.stringify(save) : null }, writes = [], els = {};
  const $ = sel => (els[sel] ||= { hidden: false, textContent: '', onclick: null });
  const REAL = { setItem: (k, v) => { writes.push(v); store[k] = v; } };
  const realGet = k => store[k], parse = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };
  const G = { TUNED_VERSION: 2, VERSION: 'test', tunedFrom: s => tunedFrom(s, SFX), graphicsState, differences, resultSentence, sameSettings: (a, b) => JSON.stringify(differences(a)) === JSON.stringify(differences(b)) };
  const run = new Function('G', 'parse', 'realGet', 'REAL', 'SAVE_KEY', '$', 'words', 'result',
    `let best = result; ${part}; return { offer, applyBest, showState };`)(G, parse, realGet, REAL, 'soccer-iq:v1', $, () => 'words', result);
  return { ...run, els, writes, $, store };
}
const B = (o = {}) => ({ blur: true, glow: true, soft: true, pr: 0, sfx: null, measuredSfx: true, ...o });

test('the speed test applies nothing until "Use these settings"', () => {
  const gain = B({ glow: false, pr: 2 }), p = speedPage({ settings: {} }, gain);
  p.offer(gain);
  assert.deepEqual(p.writes, [], 'showing the result writes nothing');
  assert.equal(p.els['#stChoice'].hidden, false, 'the two buttons show');
  assert.equal(p.els['#stMsg'].textContent, 'This phone can use: sharper picture, no glow.');
  assert.equal(p.els['#stState'].textContent, 'Graphics: standard'); assert.equal(p.els['#stNormal'].hidden, true, 'no way back while the standard is in force');
  p.els['#stUse'].onclick();
  assert.equal(p.writes.length, 1, 'one write, from the button');
  const saved = JSON.parse(p.store['soccer-iq:v1']).settings.tuned;
  assert.equal(saved.glow, false); assert.equal(saved.pr, 2); assert.equal(saved.tv, 2);
  assert.match(p.els['#stState'].textContent, /^Graphics: tuned for this phone \(\w{3} \d+\)$/);
  assert.equal(p.els['#stNormal'].hidden, false, 'Back to standard shows now');
  p.els['#stNormal'].onclick();
  assert.equal(JSON.parse(p.store['soccer-iq:v1']).settings.tuned, undefined); assert.equal(p.els['#stState'].textContent, 'Graphics: standard');
});

test('"Keep what I have" changes nothing; a result equal to the standard shows no choice at all', () => {
  const gain = B({ blur: false }), p = speedPage({ settings: {} }, gain);
  p.offer(gain); p.els['#stKeep'].onclick();
  assert.deepEqual(p.writes, []); assert.equal(p.els['#stChoice'].hidden, true); assert.equal(p.els['#stState'].textContent, 'Graphics: standard');
  const q = speedPage({ settings: {} }, B());
  q.offer(B());
  assert.equal(q.els['#stChoice'].hidden, true, 'nothing to choose');
  assert.equal(q.els['#stMsg'].textContent, 'The standard settings are already the best for this phone.'); assert.deepEqual(q.writes, []);
  // tuned settings already in force and the same result: nothing to choose either, and "Back to standard" is offered
  const r = speedPage({ settings: { tuned: { tv: 2, blur: true, glow: false, soft: true, pr: 2, at: '2026-11-18' } } }, B({ glow: false, pr: 2 }));
  r.offer(B({ glow: false, pr: 2 }));
  assert.equal(r.els['#stChoice'].hidden, true); assert.equal(r.els['#stState'].textContent, 'Graphics: tuned for this phone (Nov 18)'); assert.equal(r.els['#stNormal'].hidden, false);
  // standard result while tuned ones are in force: no choice, but the way back is there
  const s = speedPage({ settings: { tuned: { tv: 2, glow: false, at: '2026-11-18' } } }, B());
  s.offer(B()); assert.equal(s.els['#stChoice'].hidden, true); assert.equal(s.els['#stNormal'].hidden, false);
});

test('the speed test page and the menu are wired to the words and buttons', () => {
  const page = code('dev/speed.js'), html = read('dev/speed.html'), idx = read('index.html'), sp = code('js/ui/speed.js');
  assert.ok(!/applyBest\(b\)/.test(page.slice(page.indexOf('function showResults'), page.indexOf("$('#stCopy').onclick"))), 'showResults never applies');
  assert.equal(page.match(/applyBest\(/g).length, 2, 'applyBest: its definition and the "Use these settings" button');
  assert.match(html, /id="stUse"[^>]*>Use these settings</); assert.match(html, /id="stKeep"[^>]*>Keep what I have</); assert.match(html, /id="stNormal"[^>]*hidden[^>]*>Back to standard</);
  assert.match(idx, /<b id="gfxNow">Graphics: standard<\/b>/); assert.match(idx, /id="gfxResetRow" style="display:none"/);
  assert.match(sp, /\$\('#gfxNow'\)\.textContent = w\.text;/); assert.match(sp, /\$\('#gfxResetRow'\)\.style\.display = w\.set \? '' : 'none';/);
});

// ---------- 4. the Slow game's skill buttons say their move ----------
test('each skill button shows its move in words, written only when the name changes', () => {
  const els = {}, writes = [];
  globalThis.document = { querySelector: sel => (els[sel] ||= { _t: '', get textContent() { return this._t; }, set textContent(v) { writes.push([sel, v]); this._t = v; } }) };
  try {
    assert.deepEqual(SKILL_IDS, ['skillA', 'skillB']);
    nameButtons([{ k: 'stepover', dir: 'l' }, { k: 'scissors', dir: 'r' }]);
    assert.deepEqual(writes, [['#skillA .nm', 'Stepover'], ['#skillB .nm', 'Scissors']]);
    nameButtons([{ k: 'stepover', dir: 'l' }, { k: 'scissors', dir: 'r' }]);
    assert.equal(writes.length, 2, 'the same pair again: nothing written');
    nameButtons([{ k: 'double' }, { k: 'cruyff' }]);
    assert.deepEqual(writes.slice(2), [['#skillA .nm', MOVE_NAME.double], ['#skillB .nm', MOVE_NAME.cruyff]]);
  } finally { delete globalThis.document; }
  const html = read('index.html');
  assert.equal(html.match(/<b class="nm"><\/b><\/button>/g).length, 2, 'a name holder in each button');
  assert.match(read('css/app.css'), /\.skillPick \.nm\{[^}]*font:700 18px/, 'large');
});

test('every move on offer has a name and a picture that is defined before it is used; the demo caption has no emoji', () => {
  const html = read('index.html'), moves = [...RUN_MOVES, 'double', 'chop', 'croqueta', 'roll', 'cruyff'];
  const symbols = [...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m.index), ids = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
  for (const m of moves) { assert.ok(MOVE_NAME[m], m + ' has a name'); assert.ok(ids.has('mv-' + m), m + ' has a picture'); }
  for (const u of html.matchAll(/<use[^>]*href="#([^"]+)"/g)) assert.ok(ids.has(u[1]), `<use href="#${u[1]}"> points at a symbol that exists`);
  const firstUse = html.indexOf('<use '), lastSymbol = Math.max(...symbols);
  assert.ok(lastSymbol < firstUse, 'every symbol is defined above the first <use>');
  const skill = read('js/game/skill.js');
  for (const c of skill.matchAll(/hud\.caption\(([^)]*)\)/g)) assert.ok(!/\p{Extended_Pictographic}/u.test(c[1]), 'no emoji in ' + c[0]);
});

// ---------- 5. one tap on a mini game tile starts one thing ----------
test('a tile tap starts exactly one thing: the chooser stays up until the game takes over, and a second tap does nothing', async () => {
  const log = [];
  let release; const said = new Promise(r => { release = r; });
  const start = makeStarter({ say: id => { log.push('say ' + id); return said; }, pick: id => log.push('pick ' + id), closeSheet: id => log.push('close ' + id), run: async id => { log.push('run ' + id); },
    wait: ms => new Promise(r => setTimeout(r, ms)) });
  const first = start('rondoKeep');
  assert.equal(start.busy(), true);
  assert.equal(await start('rondoKeep'), false, 'a second tap on the same tile');
  assert.equal(await start('pens'), false, 'a tap on another tile');
  assert.deepEqual(log, ['pick rondoKeep', 'say rondoKeep'], 'the sheet is still up while the name is said');
  release(); await first;
  assert.deepEqual(log, ['pick rondoKeep', 'say rondoKeep', 'close rondoKeep', 'run rondoKeep', 'pick null'], 'close and run come after the name, once');
  assert.equal(start.busy(), false);
  assert.equal(await start('pens'), true, 'and a tap after the game ended starts the next');
});

test('the name is waited for at most its limit; an error in the game frees the chooser', async () => {
  const log = [];
  const slow = new Promise(() => {}); // a name that never ends
  const start = makeStarter({ say: () => slow, closeSheet: () => log.push('close'), run: async () => { log.push('run'); }, wait: () => Promise.resolve() });
  await start('a'); assert.deepEqual(log, ['close', 'run'], 'a stuck name does not hold the game');
  assert.equal(NAME_WAIT_MS, 1400);
  const errs = [], boom = makeStarter({ say: () => 0, closeSheet() {}, run: async () => { throw new Error('x'); }, wait: () => Promise.resolve(), onError: e => errs.push(e.message) });
  await boom('a'); assert.deepEqual(errs, ['x']); assert.equal(boom.busy(), false);
});

test('the chooser is built on the starter and shields the sheet while a game starts', () => {
  const ch = code('js/mini/chooser.js'), css = read('css/app.css');
  assert.match(ch, /const start = makeStarter\(\{/);
  assert.ok(!/sheet\.classList\.add\('hidden'\);\s*\n?\s*\/\/ Its name/.test(ch) && !/let starting = false/.test(ch), 'the sheet no longer hides before its name is said');
  assert.match(ch, /sheet\.addEventListener\('click', e => \{ if \(start\.busy\(\)\) e\.stopImmediatePropagation\(\); \}, true\)/, 'nothing on the sheet answers while starting');
  assert.match(css, /#miniSheet\.starting \.tile\{pointer-events:none\}/);
  assert.match(read('index.html'), /'mini\/starter'/, 'index.html lists the module for the fresh re-fetch');
});
