// The skill moves' symbols (v93, the owner): ONE plain emoji per move above its name, in both modes, from one mapping
// (js/flair.js MOVE_SYM). No drawn picture of the move: no defender, no legs, no arrows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOVE_SYM, MOVE_NAME } from '../js/flair.js';

const MOVES = ['stepover', 'scissors', 'feint', 'fakeshot', 'double', 'croqueta', 'chop', 'roll', 'cruyff'];
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('nine moves: each has a symbol and a name, and all nine symbols differ', () => {
  for (const k of MOVES) { assert.ok(MOVE_SYM[k], k + ' has a symbol'); assert.ok(MOVE_NAME[k], k + ' has a name'); }
  assert.equal(new Set(MOVES.map(k => MOVE_SYM[k])).size, MOVES.length);
  assert.deepEqual(Object.keys(MOVE_SYM).sort(), [...MOVES].sort(), 'no symbol for a move that does not exist');
  assert.equal(MOVE_SYM.croqueta, '↔️'); assert.equal(MOVE_SYM.chop, '🗡️');
});
test('both modes show the symbol as plain text, no move diagram left', () => {
  const html = read('index.html'), fast = read('js/fast/fast.js'), hud = read('js/ui/hud.js');
  assert.doesNotMatch(html, /id="mv-|id="mvDef"|id="mvCrowd"|id="mvArrow"|id="skillPics"/, 'the drawn pictures are gone');
  assert.equal((html.match(/<i class="sym" aria-hidden="true"><\/i><b class="nm"><\/b>/g) || []).length, 2, 'Classic: a symbol over the name in each button');
  assert.match(hud, /MOVE_SYM\[/); assert.match(fast, /MOVE_SYM\[mv\]/);
  assert.doesNotMatch(fast, /#mv-|#mvDef/);
});
