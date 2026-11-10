// The 3D world and the game that plays in it.
import { $ } from './dom.js';
import { P } from './store.js';
import { hud } from './hud.js';
import { say } from './speech.js';
import { sfx } from '../sound.js';
import { World } from '../world.js';
import { ProWorld } from '../world-pro.js';
import { Game } from '../game.js';

export const canvas = $('#view');
// The art style comes from the grown-ups menu; `?art=pro` in the address tries one without saving it.
const art = new URLSearchParams(location.search).get('art') || P.settings.art;
let made;
try { made = art === 'pro' ? new ProWorld(canvas, { art }) : new World(canvas, { art }); } catch (e) {
  document.body.innerHTML = '<p style="padding:24px;font:600 18px system-ui">This device can’t show 3D graphics (WebGL is off).</p>'; throw e;
}
export const world = made;
export const game = new Game({ world, hud, say, sfx, fx: (ev, v) => world.fx(ev, v) });
