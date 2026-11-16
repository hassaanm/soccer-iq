// Touch input on the field and the game buttons.
import { $, onPress } from './dom.js';
import { canvas, game } from './stage.js';

// A touch only picks a player, spot or arrow if the finger lifts without sliding; any slide is a look-around drag.
// Only the finger that started the touch counts: a second finger (or a resting palm) changes nothing.
const SLIDE = 12; // pixels a finger may wobble and still count as a tap
let press = null;
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (press && !e.isPrimary) return;
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  game.lookStart(e.clientX, canvas.clientWidth);
});
addEventListener('pointermove', e => {
  if (e.pointerId !== press?.id) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLIDE) press.moved = true;
  game.lookMove(e.clientX);
});
addEventListener('pointerup', e => {
  if (e.pointerId !== press?.id) return;
  const p = press; press = null; game.lookEnd();
  if (!p.moved && e.target === canvas) game.tap(p.x, p.y);
});
addEventListener('pointercancel', e => { if (e.pointerId === press?.id) { press = null; game.lookEnd(); } });
// If the page loses the touch without an "up" (the app is sent to the background), drop it so the next one works.
addEventListener('blur', () => { if (press) { press = null; game.lookEnd(); } });

const BUTTONS = {
  '#lookBtn': () => game.toggleLook(), '#passBtn': () => game.pass(), '#dribBtn': () => game.dribble(), '#shootBtn': () => game.shoot(),
  '#stealBtn': () => game.stealTap(), '#skillBtn': () => game.skillTap(), '#touchSmall': () => game.touch('small'), '#touchBig': () => game.touch('big'),
  '#footIn': () => game.foot('in'), '#footLaces': () => game.foot('las'),
};
// (round 2) Play moves while he chooses: a friend he is passing to can run under a button. A press on the button right
// over a friend's body, while he picks who to pass to, is a tap on that friend.
const OVER = new Set(['#passBtn', '#dribBtn', '#shootBtn', '#lookBtn']);
for (const [sel, act] of Object.entries(BUTTONS)) onPress($(sel), e => { if (OVER.has(sel) && game.tapPlayer?.(e.clientX, e.clientY)) return; act(); });
// No long-press menu (copy, save image) while he plays.
document.addEventListener('contextmenu', e => e.preventDefault());
