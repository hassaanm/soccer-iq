// (v96 small) The parts that need no browser: the switch's arithmetic, the chooser's layout rules, STEAL's look by distance
// (the rules, and that both buttons use them with classes only), the Live card's lesson offer, "Win the ball"'s soft start.
// The browser measurements are in small-v96-browser.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Rondo } from '../js/mini/rondo-play.js';
import * as K from '../js/mini/rondo.js';
import { stream } from '../js/shot.js';
import { stealState, setStealLook, FAR_ON, FAR_OFF } from '../js/ui/steal-look.js';
import { STEAL_R } from '../js/fast/rules.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const css = read('css/app.css');

test('switch: on is the mirror of off at every track width (knob 20, a 3 px gap at each end)', () => {
  assert.match(css, /\.sw\{--sw-w:44px;[^}]*width:var\(--sw-w\)/);
  assert.match(css, /#menu \.sw\{--sw-w:52px;/);
  assert.match(css, /\.sw input:checked \+ i::after\{transform:translateX\(calc\(var\(--sw-w\) - 26px\)\)/);
  const knob = css.match(/\.sw i::after\{[^}]*left:3px;width:20px/); assert.ok(knob, 'a 20 px knob 3 px from the left');
  for (const w of [44, 52]) { const off = 3, on = 3 + (w - 26); assert.equal(w - (on + 20), off, `${w} px track: gap right when on = gap left when off`); }
});

test('mini chooser: the columns follow the count (6: 3, 7-8: 4, 9-10: 5), more than ten scroll sideways, each tile 88 x 44 at least', () => {
  const js = read('js/mini/chooser.js');
  assert.match(js, /className = n > 10 \? 'more' : n > 8 \? 'c5' : n > 6 \? 'c4' : ''/);
  assert.match(css, /#minis\.c4\{--c:4\}/); assert.match(css, /#minis\.c5\{--c:5\}/);
  assert.match(css, /#minis\.more\{[^}]*grid-auto-flow:column[^}]*overflow:auto hidden/);
  assert.match(css, /#minis \.tile\.mini\{[^}]*min-width:88px;min-height:44px/);
});

test('STEAL by distance: far (not shown) past about 6 m, mid (small, dim) to reach, in (full, bright) within reach; a little room at the edge', () => {
  assert.ok(FAR_ON >= 6 && FAR_ON <= 6.6 && FAR_OFF < FAR_ON);
  assert.equal(stealState(12, false, false), 'far'); assert.equal(stealState(3, false, false), 'mid'); assert.equal(stealState(1, true, false), 'in');
  assert.equal(stealState(6.2, false, false), 'mid', 'just under the edge: shown'); assert.equal(stealState(6.2, false, true), 'far', 'once gone it stays gone a little longer');
  assert.equal(stealState(5.7, false, true), 'far'); assert.equal(stealState(5.5, false, true), 'mid');
  assert.equal(stealState(20, true, true), 'in', 'in reach (the glow\'s own test) always wins');
  const cls = new Set(), btn = { classList: { toggle: (k, on) => { on ? cls.add(k) : cls.delete(k); } } };
  for (const [st, want] of [['far', 'sl-far'], ['mid', 'sl-mid'], ['in', 'sl-in'], ['', null]]) { setStealLook(btn, st); assert.deepEqual([...cls], want ? [want] : []); }
  // the look in the CSS: opacity and scale only, 60% and 50%
  assert.match(css, /\.sl-mid\{opacity:\.5;scale:\.6/); assert.match(css, /\.sl-far\{opacity:0;scale:\.6/); assert.match(css, /\.sl-in\{opacity:1;scale:1;animation:stealPop/);
  const block = css.slice(css.indexOf('SMALL worker (v96)')); assert.doesNotMatch(block, /[;{](display|width|height|top|left|margin)\s*:/, 'no layout property in STEAL\'s states');
  assert.match(css, /#fAct\[data-kind=steal\],#rSteal\{--top:#ff7a45/, 'red-orange, apart from the gold SHOOT and skill button');
});

test('both STEAL buttons set the look only when it changes, by classes, and ask the games\' own reach test', () => {
  const fast = read('js/fast/fast.js'), rondo = read('js/mini/rondo-ui.js');
  assert.match(fast, /stealLook\(h\) \{[\s\S]*stealState\(Math\.hypot\(this\.sim\.ball\.x - h\.x, this\.sim\.ball\.y - h\.y\), this\.ui\.ballGlow, this\.stealSt === 'far'\)[\s\S]*if \(st !== this\.stealSt\)/);
  assert.match(rondo, /stealState\(R\.dist\(h, b\), ui\.ballGlow, dom\.stealSt === 'far'\)/);
  assert.match(rondo, /if \(sl !== dom\.stealSt\) \{ dom\.stealSt = sl; setStealLook\(dom\.steal, sl\); \}/);
  // the steal rule itself is untouched: a ball within STEAL_R only
  assert.equal(STEAL_R, 1.5);
});

test('after a Live match the card offers no Classic lesson; Classic still does', () => {
  const flows = read('js/flows.js');
  assert.match(flows, /export const nextLesson = \(\) => \(P\.settings\.mode === 'fast' \? null : toLessons\(\)\)/);
  const cards = [...flows.matchAll(/fillResults\(\{[\s\S]*?\}\);/g)].map(m => m[0]).filter(c => /lesson: (toLessons|nextLesson)\(\)/.test(c));
  assert.ok(cards.length >= 4); for (const c of cards) assert.match(c, /lesson: nextLesson\(\)/);
  // a mini game's own card (js/mini/run.js) uses the lesson tile for "Again": untouched
  assert.match(read('js/mini/run.js'), /lesson: \{ icon: '🔁', text: 'Again'/);
});
