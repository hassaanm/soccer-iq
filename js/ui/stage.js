// The 3D world and the game that plays in it.
import { $ } from './dom.js';
import { hud } from './hud.js';
import { say } from './speech.js';
import { sfx } from '../sound.js';
import { World } from '../world.js';
import { Game } from '../game.js';

export const canvas = $('#view');
let made;
try { made = new World(canvas); } catch (e) {
  document.body.innerHTML = '<p style="padding:24px;font:600 18px system-ui">This device can’t show 3D graphics (WebGL is off).</p>'; throw e;
}
export const world = made;
export const game = new Game({ world, hud, say, sfx, fx: (ev, v) => world.fx(ev, v) });
