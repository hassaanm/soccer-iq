// The grown-ups menu: every control the code reads is still in the markup, grouped under four headings, and the CSS keeps rows >= 40 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const menu = html.slice(html.indexOf('<section id="menu"'), html.indexOf('<section id="report"'));

test('the menu keeps every control, under four headings', () => {
  for (const id of ['skillSel', 'sizeSel', 'roundsSel', 'thinkSel', 'keeperSel', 'keeperHint', 'openChk', 'gfxNow', 'gfxResetRow', 'gfxReset', 'speedTestBtn',
    'recordedChk', 'voiceSel', 'voiceTest', 'recChk', 'recShow', 'recCopy', 'logClearM', 'recBox', 'reportBtn', 'progressList', 'resetBtn', 'menuClose'])
    assert.match(menu, new RegExp(`id="${id}"`), id);
  assert.deepEqual([...menu.matchAll(/<h3>(.*?)<\/h3>/g)].map(m => m[1]), ['Play', 'Graphics and speed', 'Sound', 'Help and data']);
});
test('the menu lays out in two columns with 40 px rows and scrolls under a fixed title', () => {
  assert.match(css, /#menu \.menubody\{[^}]*overflow-y:auto/);
  assert.match(css, /@media \(min-width:560px\)\{#menu \.menubody\{grid-template-columns:repeat\(2,/);
  assert.match(css, /#menu \.mrow\{[^}]*min-height:40px/);
  assert.match(css, /#menu select\{[^}]*min-height:40px/);
  assert.doesNotMatch(css.slice(css.indexOf('grown-ups menu ----------'), css.indexOf('"How is he doing?"')), /backdrop-filter|filter:/);
});
