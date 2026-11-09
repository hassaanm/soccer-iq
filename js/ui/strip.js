// On iPad, a home-screen app can leave a thin strip under the page that the page can't draw into. iPadOS paints
// it with the page's background color, so while he plays, that color follows the grass along the bottom edge of
// the field (read from the frame just drawn, twice a second). On the menus it stays peach.
import { hudEl, tunnelNow } from './hud.js';
import { world } from './stage.js';

const PEACH = '#ffc89a', EVERY = 500, SAMPLES = 15;
const themeMeta = document.querySelector('meta[name="theme-color"]');
const sample = new Uint8Array(SAMPLES), rgb = [0, 0, 0];
let row = new Uint8Array(0), tint = PEACH, readAt = 0;

// The median of each color across the bottom row of the frame: a player's boot on the edge doesn't change it.
// Returns false while nothing has been drawn yet.
function grass() {
  const gl = world.renderer.getContext(), w = gl.drawingBufferWidth;
  if (row.length !== w * 4) row = new Uint8Array(w * 4);
  gl.readPixels(0, 0, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row); // WebGL rows start at the bottom
  let drawn = false;
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < SAMPLES; i++) sample[i] = row[Math.floor(w * (i + 1) / (SAMPLES + 1)) * 4 + k];
    sample.sort(); rgb[k] = sample[SAMPLES >> 1]; drawn ||= sample[SAMPLES - 1] > 0;
  }
  return drawn;
}
const hex = v => Math.round(Math.min(255, v)).toString(16).padStart(2, '0');

// Call once per frame, after the world is drawn. `now` is the frame's time in milliseconds.
export function matchStrip(now) {
  if (now - readAt < EVERY) return;
  readAt = now;
  let c = PEACH;
  if (!hudEl.classList.contains('hidden') && grass()) {
    // Head down, the screen edges are dimmed (the tunnel: brightness .8, saturation .75), so dim the strip to match.
    const o = tunnelNow(), gray = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    c = '#' + rgb.map(v => hex((gray + (v - gray) * (1 - .25 * o)) * (1 - .2 * o))).join('');
  }
  if (c === tint) return;
  tint = c; document.documentElement.style.backgroundColor = c; document.body.style.backgroundColor = c; themeMeta?.setAttribute('content', c);
}
