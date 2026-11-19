// The mini games (v87): score chases, apart from the lessons ("Dad, I got this high score"). Each is endless, with two
// lives and a best score kept per game (mini/rules.js). This list is what the Mini games screen shows, in this order:
// one big tile per game, with its picture, its name (said aloud when tapped) and his best.
// To add a game: an entry here (id: its key in the save; name; say: the spoken name, a recorded clip; unit: the
// picture next to its score; pic: the tile's picture, an SVG), and its runner in mini/chooser.js RUN. No page code here,
// so the tests can read it.
import { RONDO_SAID } from './rondo.js'; // (v88: the rondos' spoken lines, recorded with the rest: voicelines.js miniLines)
const GRASS = '<rect x="0" y="0" width="120" height="84" rx="12" fill="#3f9a4a"/><path d="M0 62h120" stroke="#56b15f" stroke-width="10"/>';
const GOAL = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,255,255,.18)"/>`
  + `<path d="M${x} ${y + h}V${y}h${w}v${h}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"/>`
  + Array.from({ length: 5 }, (_, i) => `<path d="M${x + (i + 1) * w / 6} ${y}v${h}" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`).join('');
const BALL = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="#24193a" stroke-width="2"/><path d="M${x} ${y - r * .45}l${r * .43} ${r * .31}-${r * .16} ${r * .5}h-${r * .54}l-${r * .16}-${r * .5}z" fill="#24193a"/>`;
// The keeper: he flies across his goal, gloves out, to the ball.
const KEEPER = GRASS + GOAL(14, 14, 92, 46)
  + '<g transform="rotate(-24 60 40)"><rect x="36" y="33" width="40" height="15" rx="7.5" fill="#ff9447" stroke="#24193a" stroke-width="2.4"/><circle cx="31" cy="40" r="8" fill="#f2c9a0" stroke="#24193a" stroke-width="2.4"/>'
  + '<path d="M74 37l14-7M74 44l15 2" stroke="#ff9447" stroke-width="5" stroke-linecap="round"/><circle cx="90" cy="29" r="5" fill="#b6f22a" stroke="#24193a" stroke-width="2"/><circle cx="91" cy="47" r="5" fill="#b6f22a" stroke="#24193a" stroke-width="2"/></g>'
  + BALL(98, 22, 7);
// Penalties: the ball on the spot, the keeper leaning one way, the shot going the other.
const PENS = GRASS + GOAL(18, 10, 84, 40)
  + '<g transform="rotate(14 50 40)"><rect x="44" y="24" width="12" height="20" rx="5" fill="#5aa2ff" stroke="#24193a" stroke-width="2.2"/><circle cx="50" cy="19" r="6" fill="#f2c9a0" stroke="#24193a" stroke-width="2.2"/><path d="M44 30l-9 7M56 30l9-6" stroke="#5aa2ff" stroke-width="4.4" stroke-linecap="round"/></g>'
  + '<path d="M60 70Q74 46 86 26" fill="none" stroke="#ffd23f" stroke-width="3.4" stroke-dasharray="5 4" stroke-linecap="round"/><path d="M80 25l7-1-1 7" fill="none" stroke="#ffd23f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<ellipse cx="57" cy="76" rx="9" ry="3" fill="rgba(255,255,255,.75)"/>' + BALL(57, 70, 7.5);
const svg = body => `<svg viewBox="0 0 120 84" aria-hidden="true">${body}</svg>`;
// (v88) The rondos: placeholder pictures (the house-style ones come with the picture module). The box, four on its
// sides and the ball; keep: one in the middle (theirs); win: him in the middle (gold ring).
const MAN = (x, y, c) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${c}" stroke="#24193a" stroke-width="2.2"/>`;
const BOX = GRASS + '<rect x="30" y="12" width="60" height="58" fill="none" stroke="#fff" stroke-width="2.6" stroke-dasharray="6 4"/>' + MAN(60, 12, '#5aa2ff') + MAN(30, 41, '#5aa2ff') + MAN(90, 41, '#5aa2ff');
const RONDO_KEEP = BOX + MAN(60, 70, '#5aa2ff') + '<circle cx="60" cy="70" r="10" fill="none" stroke="#ffd23f" stroke-width="2.6"/>' + MAN(60, 40, '#ff6b6b') + '<path d="M60 64L36 44" stroke="#ffd23f" stroke-width="2.6" stroke-dasharray="4 3"/>' + BALL(50, 57, 5);
const RONDO_WIN = BOX + MAN(60, 70, '#ff6b6b') + MAN(60, 41, '#5aa2ff') + '<circle cx="60" cy="41" r="10" fill="none" stroke="#ffd23f" stroke-width="2.6"/>' + '<circle cx="70" cy="51" r="9" fill="rgba(255,210,63,.45)"/>' + BALL(70, 51, 5);

export const MINI = [
  { id: 'keeper', name: 'Goalkeeper', say: 'Goalkeeper!', unit: '🧤', pic: svg(KEEPER) },
  { id: 'pens', name: 'Penalties', say: 'Penalties!', unit: '⚽', pic: svg(PENS) },
  { id: 'rondoKeep', name: 'Keep the ball', say: 'Keep the ball!', unit: '🔁', pic: svg(RONDO_KEEP), lines: Object.values(RONDO_SAID) }, // (v88: mini/rondo-ui.js)
  { id: 'rondoWin', name: 'Win the ball', say: 'Win the ball!', unit: '🦶', pic: svg(RONDO_WIN), lines: Object.values(RONDO_SAID) }, // (v88: mini/rondo-ui.js)
];
export const miniById = id => MINI.find(g => g.id === id);
// What the mini games say (spoken: tests/spoken.js; loaded as a game starts: voicelines.js miniLines).
export const MINI_SAID = { open: 'Mini games!', best: 'New best!', again: 'Good game!' };
