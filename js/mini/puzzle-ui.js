// Soccer puzzles on the page (v90; v93 redrawn in the mini game pictures' style): a mini game (mini/chooser.js), the
// one with the top view. mini/puzzle.js has the rules; this draws the board over the whole screen and takes his taps.
// The stadium and the pitch are one SVG drawn once a puzzle (and on a resize); the goal's cover marks and the lanes are a
// second SVG written only when they change; the players and the ball are HTML nodes made once and moved by transform
// only, and only while something moves. A move plays out (the ball rolls, ours run), then their answer plays out for a
// beat (the keeper shuffles, the red players step), so cause and effect are seen. A failed move shows why (the ball to
// the red player who cut it, the keeper's save, the tackle) for a moment before the life goes; then the solution plays
// itself once. It goes on the stage as the keeper game does (ui/goalie.js onStage: main.js ticks it, the pause holds it).
import { $ } from '../ui/dom.js';
import { P } from '../ui/store.js';
import { hud } from '../ui/hud.js';
import { say, unlockSpeech } from '../ui/speech.js';
import { world, game } from '../ui/stage.js';
import { show, card } from '../ui/screens.js';
import { sfx } from '../sound.js';
import { PITCH } from '../geom.js';
import { Goalie } from '../game/goalie.js';
import { onStage } from '../ui/goalie.js';
import { warmKeeper } from '../ui/voicewarm.js';
import { held } from '../pause.js';
import { ball as ballSvg } from './pics.js';
import { STEP } from './rules.js';
import { startRun, runStep, endRun, runOff } from './run.js';
import { puzzleSteps, makePuzzle, Board, startOf, parse, mid, inBox, ourAt, theirAt, rng, covers, cutBy, goalRows, PZ_SAID, PZ_WHY, PZ_IDEA } from './puzzle.js';

const INK = '#24193a', GOLD = '#ffd23f', n2 = v => Math.round(v * 100) / 100, rad = d => d * Math.PI / 180;
const BLUE = { shirt: '#4f8dff', shorts: '#1f3f9e', socks: '#4f8dff' };
const RED = { shirt: '#ff5a5f', shorts: '#8e1f3a', socks: '#ff5a5f' };
const GK = { shirt: '#ff8a3d', shorts: '#2b2350', socks: '#ff8a3d', gloves: true };
const SKIN = ['#f6cfa8', '#d79f72', '#9a6442'], HAIR = ['#3b2a20', '#1f1a2e', '#b86a2c', '#e8c25a'];
const T = { pass: .34, dribble: .3, shot: .32, beat: .12, answer: .5, why: 1.2, replay: .5 }; // seconds (game clock)

// ---------- the stage (main.js ticks it; the pause holds it) ----------
class Stage extends Goalie {
  constructor(o) { super(o); this.kind = 'puzzles'; this.t = 0; this.tw = []; }
  setup() { // the 3D world under the board: nobody in it, a still view (it is covered)
    const cx = PITCH.L / 2, cy = PITCH.W / 2;
    this.sim.setup({ hero: [cx, cy], mates: [], opps: [], carrier: 'hero' });
    this.cam = { eye: [cx - 6, cy, 30], tgt: [cx, cy, 0], Ff: 1.2, Fw: 0 };
  }
  tick(dt) {
    for (const j of this.jobs.splice(0)) { j.t += dt; if (j.t >= j.sec || j.f?.()) j.res(); else this.jobs.push(j); }
    if (!this.on) return;
    this.real = (this.real || 0) + dt; this.ui.clock += dt; this.t += dt;
    for (const w of this.tw.splice(0)) { const u = Math.min(1, (this.t - w.t0) / w.dur); w.fn(u); if (u < 1) this.tw.push(w); else w.res(); }
    frame(dt);
  }
  // A movement over `dur` seconds of the game's clock: fn(u) with u from 0 to 1 each frame. Resolves at its end.
  anim(dur, fn) { return new Promise(res => { fn(0); this.tw.push({ t0: this.t, dur: Math.max(.01, dur), fn, res }); }); }
  tapAt() { return false; } // (his taps come to the board, not the 3D picture)
}
export const stage = new Stage({ world, hud, say, sfx });

// ---------- a chunky kid seen from above and in front (the mini game pictures' kid, mini/pics.js, drawn the same way) --
// His hips at 0,0, head above (y -23), feet below (y 12). Angles: 0 points down, 90 to the right. look: -1..1 (eyes).
function limb(x, y, a, len, w, top, low, lowAt = .45) {
  const dx = Math.sin(rad(a)), dy = Math.cos(rad(a)), ex = x + dx * len, ey = y + dy * len, mx = x + dx * len * lowAt, my = y + dy * len * lowAt;
  return { s: `<path d="M${n2(x)} ${n2(y)}L${n2(ex)} ${n2(ey)}" stroke="${INK}" stroke-width="${w + 2.6}" stroke-linecap="round"/>`
    + `<path d="M${n2(x)} ${n2(y)}L${n2(mx)} ${n2(my)}" stroke="${top}" stroke-width="${w}" stroke-linecap="round"/><path d="M${n2(mx)} ${n2(my)}L${n2(ex)} ${n2(ey)}" stroke="${low}" stroke-width="${w}" stroke-linecap="round"/>`, ex, ey };
}
function kid(o) {
  const k = o.kit, skin = o.skin, hair = o.hair, [aL, aR] = o.arms || [-28, 28], [lL, lR] = o.legs || [-6, 6], aLen = o.armLen || 11;
  let s = `<ellipse cx="0" cy="13.5" rx="11" ry="3.6" fill="${INK}" opacity=".32"/>`;
  for (const [x, a] of [[-3.2, lL], [3.2, lR]]) { const L = limb(x, 1, a, 11, 4.4, skin, k.socks, .4); s += L.s + `<ellipse cx="${n2(L.ex + (o.look || 0) * 1.2)}" cy="${n2(L.ey + .6)}" rx="3.3" ry="2.4" fill="${INK}"/>`; }
  s += `<path d="M-7 -3H7L7.6 3.4Q7.6 4.6 6.3 4.6H1.2L0 2.6-1.2 4.6H-6.3Q-7.6 4.6-7.6 3.4Z" fill="${k.shorts}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
  s += `<path d="M-7.6 -14.2Q0 -16.4 7.6 -14.2L7.1 -1.6Q0 -.4 -7.1 -1.6Z" fill="${k.shirt}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<path d="M-3 -15.2L0 -12.4 3 -15.2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const [x, a] of [[-6.6, aL], [6.6, aR]]) {
    const A = limb(x, -12, a, aLen, 4, k.shirt, skin, .42); s += A.s;
    s += k.gloves ? `<circle cx="${n2(A.ex)}" cy="${n2(A.ey)}" r="3.9" fill="#8fe04f" stroke="${INK}" stroke-width="1.8"/>` : `<circle cx="${n2(A.ex)}" cy="${n2(A.ey)}" r="2.5" fill="${skin}" stroke="${INK}" stroke-width="1.6"/>`;
  }
  const lx = (o.look || 0) * 2.2;
  s += `<circle cx="0" cy="-23" r="8.8" fill="${skin}"/><path d="M-8.8 -22.4A8.8 8.8 0 0 1 8.8 -22.4Q6.6 -27 1.6 -26.2Q-1 -28 -4 -26Q-7.4 -26 -8.8 -22.4Z" fill="${hair}"/>`;
  s += `<ellipse cx="${n2(-3.2 + lx)}" cy="-21.4" rx="1.45" ry="2" fill="${INK}"/><ellipse cx="${n2(3.2 + lx)}" cy="-21.4" rx="1.45" ry="2" fill="${INK}"/>`
    + `<circle cx="${n2(-2.7 + lx)}" cy="-22.2" r=".55" fill="#fff"/><circle cx="${n2(3.7 + lx)}" cy="-22.2" r=".55" fill="#fff"/>`
    + `<circle cx="-5.6" cy="-18.4" r="1.6" fill="#ff8f8f" opacity=".55"/><circle cx="5.6" cy="-18.4" r="1.6" fill="#ff8f8f" opacity=".55"/>`
    + `<path d="M${n2(-2 + lx * .5)} -18.2Q${n2(lx * .5)} -16.4 ${n2(2 + lx * .5)} -18.2" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`;
  s += `<circle cx="0" cy="-23" r="8.8" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  return `<g transform="rotate(${o.rot || 0} 0 6)">${s}</g>`;
}
// A node's two pictures: looking right (toward their goal) and looking left; a class picks one (written on a change).
const KV = '-16 -34 32 50'; // (his frame: the node is .76 by 1.19 places, his feet a quarter place below the place's middle)
const fig = (o, cls) => `<svg class="${cls}" viewBox="${KV}" aria-hidden="true">${kid(o)}</svg>`;
const look2 = o => fig({ ...o, look: .8, rot: 4 }, 'fr') + fig({ ...o, look: -.8, rot: -4 }, 'fl');
const BALL = `<svg viewBox="-12.5 -12.5 25 25" aria-hidden="true"><ellipse cx="1.5" cy="9.5" rx="9" ry="3" fill="${INK}" opacity=".35"/>${ballSvg(0, 0, 10)}</svg>`;

// ---------- the nodes (made once) ----------
const layer = document.createElement('div');
layer.id = 'pz'; layer.className = 'hidden';
layer.innerHTML = '<svg class="pitch" aria-hidden="true"></svg><svg class="marks" aria-hidden="true"><g class="cover"></g><g class="tether"></g><g class="lanes"></g><g class="path"></g><g class="cut"></g></svg>'
  + '<div class="pcs"></div><div class="ring"></div><div class="bad"></div><div class="pzball">' + BALL + '</div>'
  + '<div class="balls" aria-label="Moves"></div><div class="sand hidden" aria-label="Time"><i></i></div>';
const hudEl = $('#hud'); hudEl.insertBefore(layer, hudEl.firstChild); // (under the bar, the home and pause buttons)
const pitchEl = layer.querySelector('.pitch'), marks = layer.querySelector('.marks'), pcs = layer.querySelector('.pcs');
const G = k => marks.querySelector('.' + k);
const ringEl = layer.querySelector('.ring'), badEl = layer.querySelector('.bad'), ballEl = layer.querySelector('.pzball');
const ballsEl = layer.querySelector('.balls'), sandEl = layer.querySelector('.sand'), sandFill = sandEl.querySelector('i');
ringEl.innerHTML = `<svg viewBox="-1 -1 2 2" aria-hidden="true"><ellipse rx=".62" ry=".3" fill="${GOLD}" opacity=".25"/><ellipse rx=".62" ry=".3" fill="none" stroke="${GOLD}" stroke-width=".09"/></svg>`;
badEl.innerHTML = `<svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r=".5" fill="#e8213a" stroke="#fff" stroke-width=".12"/><path d="M-.22 -.22L.22 .22M.22 -.22L-.22 .22" stroke="#fff" stroke-width=".16" stroke-linecap="round"/></svg>`;
const LOOKS = {
  us: i => look2({ kit: BLUE, skin: SKIN[i % 3], hair: HAIR[(i + 2) % 4] }),
  them: i => look2({ kit: RED, skin: SKIN[(i + 1) % 3], hair: HAIR[(i + 1) % 4], arms: [-40, 40] }),
  gk: () => fig({ kit: GK, skin: SKIN[0], hair: HAIR[1], arms: [-128, 128], armLen: 12, legs: [-16, 16], look: -.8 }, 'fl') // (arms up and out: ready, the whole goal his)
    + fig({ kit: GK, skin: SKIN[0], hair: HAIR[1], arms: [-150, 160], armLen: 13, legs: [-24, 8], look: -.8, rot: -10 }, 'fr'), // (on the move: off balance)
};
const pool = { us: [], them: [], gk: [], hint: [], foot: [] };
function node(kind, i) {
  const a = pool[kind];
  while (a.length <= i) {
    const el = document.createElement(kind === 'foot' ? 'i' : 'div');
    if (kind === 'foot') { el.innerHTML = BALL; ballsEl.appendChild(el); } else {
      el.className = 'pzp ' + kind; el.innerHTML = kind === 'hint' ? `<svg viewBox="-1 -1 2 2" aria-hidden="true"><ellipse rx=".36" ry=".2" fill="#fff" opacity=".16"/><ellipse rx=".36" ry=".2" fill="none" stroke="#fff" stroke-width=".06" stroke-dasharray=".14 .1" opacity=".8"/></svg>` : LOOKS[kind](a.length);
      el._z = -1; el._f = null; pcs.appendChild(el);
    }
    a.push(el);
  }
  return a[i];
}
const showN = (kind, n) => { for (let i = 0; i < Math.max(n, pool[kind].length); i++) node(kind, i).classList.toggle('off', i >= n); };
const face = (el, left) => { if (el._f !== left) { el._f = left; el.classList.toggle('l', left); } };

// ---------- where things are on the screen ----------
// The board is as big as it fits under the top bar (the moves down the left edge, the sand timer down the right).
const L = { ox: 0, oy: 0, c: 50, w: 0, h: 0 };
function layout(pz) {
  const w = innerWidth, h = innerHeight, r = el => el?.getBoundingClientRect();
  const home = r($('#homeBtn')), bar = r($('#miniBar'));
  const band = Math.max(home?.bottom || 58, bar?.bottom || 58) + 10;
  const x0 = 70, x1 = w - 56, y0 = band, y1 = h - 10, cols = pz.W + 1.3, rows = pz.H + .3;
  const c = Math.floor(Math.min((x1 - x0) / cols, (y1 - y0) / rows));
  L.c = c; L.w = w; L.h = h; L.ox = Math.round((x0 + x1) / 2 - (pz.W + 1) * c / 2); L.oy = Math.round((y0 + y1) / 2 - pz.H * c / 2);
  layer.style.setProperty('--c', c + 'px');
  for (const s of [pitchEl, marks]) s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  ballsEl.style.top = Math.max(band, 64) + 'px';
}
// The screen point of a place's middle (x, y: places; the goal is x = W).
export const toScreen = (x, y) => [L.ox + (x + .5) * L.c, L.oy + (y + .5) * L.c];
const P2 = (x, y) => toScreen(x, y).map(v => n2(v)).join(' ');
const put = (el, x, y, k = 1, rot = 0) => {
  const [sx, sy] = toScreen(x, y), z = 10 + Math.round(y * 4);
  if (el._z !== z && el._z !== undefined) { el._z = z; el.style.zIndex = z; }
  el.style.transform = `translate3d(${(sx - L.c * .34).toFixed(1)}px,${(sy - L.c * .86).toFixed(1)}px,0)` + (k !== 1 ? ` scale(${k.toFixed(3)})` : '') + (rot ? ` rotate(${rot.toFixed(1)}deg)` : '');
};
const putFlat = (el, x, y) => { const [sx, sy] = toScreen(x, y); el.style.transform = `translate3d(${(sx - L.c / 2).toFixed(1)}px,${(sy - L.c / 2).toFixed(1)}px,0)`; };

// ---------- the stadium and the pitch (one SVG, drawn once a puzzle) ----------
const CROWD = ['#5b4d8a', '#7a5fa8', '#c2486a', '#4f6fb8', '#d8a84a', '#e6e0f0'];
function drawPitch(pz) {
  const { W, H } = pz, M = mid(pz), c = L.c, X = x => n2(L.ox + x * c), Y = y => n2(L.oy + y * c), pad = .32 * c;
  let s = `<defs><radialGradient id="pzLight" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="pzLamp"><stop offset="0" stop-color="#fff6c8" stop-opacity=".9"/><stop offset=".25" stop-color="#fff2b0" stop-opacity=".35"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${L.w}" height="${L.h}" fill="#2a1f4d"/>`;
  for (let r = 0; r < 5; r++) for (let x = 6 + (r % 2) * 5; x < L.w; x += 11) { const y = Y(0) - pad - 8 - r * 9; if (y < 4) continue; s += `<circle cx="${x}" cy="${n2(y)}" r="2.6" fill="${CROWD[(x * 7 + r * 3) % 6]}" opacity=".55"/>`; }
  for (let r = 0; r < 5; r++) for (let x = 3 + (r % 2) * 5; x < L.w; x += 11) { const y = Y(H) + pad + 8 + r * 9; if (y > L.h - 3) continue; s += `<circle cx="${x}" cy="${n2(y)}" r="2.6" fill="${CROWD[(x * 5 + r) % 6]}" opacity=".45"/>`; }
  for (const [x, y] of [[L.w * .06, 10], [L.w * .94, 10], [L.w * .06, L.h - 8], [L.w * .94, L.h - 8]]) s += `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(c * 1.4)}" fill="url(#pzLamp)"/>`;
  // the grass: mown stripes a place wide, then a soft floodlight pool
  const gx = X(0) - pad, gy = Y(0) - pad, gw = (W + 1) * c + 2 * pad, gh = H * c + 2 * pad;
  s += `<rect x="${n2(gx)}" y="${n2(gy)}" width="${n2(gw)}" height="${n2(gh)}" rx="${n2(c * .22)}" fill="#3c8f46" stroke="${INK}" stroke-width="3"/>`;
  for (let x = 0; x <= W; x += 2) s += `<rect x="${X(x)}" y="${n2(gy + 1.5)}" width="${n2(Math.min(c, X(W) + pad - X(x)))}" height="${n2(gh - 3)}" fill="#47a352"/>`;
  s += `<rect x="${n2(gx)}" y="${n2(gy)}" width="${n2(gw)}" height="${n2(gh)}" rx="${n2(c * .22)}" fill="url(#pzLight)"/>`;
  // the lines: the touchlines, a half circle at our end, the box he shoots from
  const b0 = Math.max(0, M - BOXR), b1 = Math.min(H, M + BOXR + 1);
  s += `<g fill="none" stroke="#fff" stroke-width="${n2(c * .05)}" opacity=".85"><rect x="${X(0)}" y="${Y(0)}" width="${n2(W * c)}" height="${n2(H * c)}"/>`
    + `<path class="box" d="M${X(W)} ${Y(b0)}H${X(W - 2)}V${Y(b1)}H${X(W)}"/><path d="M${X(0)} ${Y(H / 2 - 1.1)}A${n2(1.1 * c)} ${n2(1.1 * c)} 0 0 1 ${X(0)} ${Y(H / 2 + 1.1)}"/></g>`;
  s += `<rect x="${X(W - 2)}" y="${Y(b0)}" width="${n2(2 * c)}" height="${n2((b1 - b0) * c)}" fill="#fff" opacity=".07"/><rect class="boxlit" x="${X(W - 2)}" y="${Y(b0)}" width="${n2(2 * c)}" height="${n2((b1 - b0) * c)}" fill="${GOLD}"/>`;
  // the goal from above: the net behind the line (a frame, its mesh), white posts with a dark edge
  const gy0 = Y(M - 1), gy1 = Y(M + 2), nx = X(W + .95);
  s += `<rect x="${X(W)}" y="${gy0}" width="${n2(.95 * c)}" height="${n2(3 * c)}" fill="#fff" opacity=".16"/>`;
  for (let i = 1; i < 6; i++) s += `<path d="M${X(W + i * .16)} ${gy0}V${gy1}" stroke="#fff" stroke-width="1" opacity=".45"/>`;
  for (let i = 1; i < 15; i++) s += `<path d="M${X(W)} ${Y(M - 1 + i * .2)}H${nx}" stroke="#fff" stroke-width="1" opacity=".45"/>`;
  const p = `M${X(W)} ${gy0}H${nx}V${gy1}H${X(W)}`;
  s += `<path d="${p}" fill="none" stroke="${INK}" stroke-width="${n2(c * .14)}" stroke-linejoin="round"/><path d="${p}" fill="none" stroke="#fff" stroke-width="${n2(c * .08)}" stroke-linejoin="round"/>`;
  for (const y of [gy0, gy1]) s += `<circle cx="${X(W)}" cy="${y}" r="${n2(c * .11)}" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`;
  pitchEl.innerHTML = s;
}
const BOXR = 2; // (rows each side of the middle: puzzle.js BOX)
const dashes = (d, w, c = GOLD, o = 1) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${n2(w + 3)}" stroke-dasharray="${n2(w * 1.6)} ${n2(w * 1.4)}" stroke-linecap="round" opacity="${o * .35}"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${n2(w)}" stroke-dasharray="${n2(w * 1.6)} ${n2(w * 1.4)}" stroke-linecap="round" opacity="${o}"/>`;
// The goal spots: an orange glow on each one the keeper covers; a gold target on one he cannot reach (written when he moves).
function drawCover(s) {
  const c = L.c; let t = '';
  for (const r of goalRows(pz)) {
    const [x, y] = toScreen(pz.W, r);
    if (covers(s, r)) t += `<rect x="${n2(x - .45 * c)}" y="${n2(y - .46 * c)}" width="${n2(.86 * c)}" height="${n2(.92 * c)}" rx="${n2(.2 * c)}" fill="#ff8a3d" opacity=".55"/><rect x="${n2(x - .45 * c)}" y="${n2(y - .46 * c)}" width="${n2(.86 * c)}" height="${n2(.92 * c)}" rx="${n2(.2 * c)}" fill="none" stroke="#ffd0a8" stroke-width="2" stroke-dasharray="6 4"/>`;
    else t += `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(.3 * c)}" fill="${INK}" opacity=".45"/><circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(.22 * c)}" fill="none" stroke="${GOLD}" stroke-width="${n2(.08 * c)}"/><circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(.06 * c)}" fill="#fff"/>`;
  }
  G('cover').innerHTML = t;
}
// The markers' links to their men (thin red dashes).
function drawTethers(s) {
  let t = ''; pz.roles.forEach((j, i) => { if (j >= 0) t += `<path d="M${P2(s.d[2 * i], s.d[2 * i + 1])}L${P2(s.o[2 * j], s.o[2 * j + 1])}" stroke="#ff5a5f" stroke-width="${n2(L.c * .05)}" stroke-dasharray="${n2(L.c * .1)} ${n2(L.c * .08)}" opacity=".8"/>`; });
  G('tether').innerHTML = t;
}
// Picked (a tap on the ball carrier): his passes (white dashes if open; red up to the red player who would cut it), his
// shots from the box, and each red player's reach (the places where a dribble is tackled), all soft.
function drawLanes(on) {
  if (!on || !board) { G('lanes').innerHTML = ''; return; }
  const s = board.s, bx = s.o[2 * s.b], by = s.o[2 * s.b + 1], c = L.c; let t = '';
  for (let k = 0; k < s.d.length; k += 2) { const [x, y] = toScreen(s.d[k] - 1, s.d[k + 1] - 1); t += `<rect x="${n2(x - c / 2)}" y="${n2(y - c / 2)}" width="${3 * c}" height="${3 * c}" rx="${n2(c * .5)}" fill="#ff5a5f" opacity=".13"/>`; }
  for (let i = 0; i < s.o.length >> 1; i++) {
    if (i === s.b) continue;
    const tx = s.o[2 * i], ty = s.o[2 * i + 1], cut = cutBy(pz, s, bx, by, tx, ty);
    t += cut ? dashes(`M${P2(bx, by)}L${P2(bx + (tx - bx) * cut.t, by + (ty - by) * cut.t)}`, c * .06, '#ff5a5f', .8) : dashes(`M${P2(bx, by)}L${P2(tx, ty)}`, c * .06, '#fff', .8);
  }
  if (inBox(pz, bx, by)) for (const r of goalRows(pz)) if (!covers(s, r) && !cutBy(pz, s, bx, by, pz.W, r)) t += dashes(`M${P2(bx, by)}L${P2(pz.W, r)}`, c * .06, GOLD, .9);
  G('lanes').innerHTML = t;
}

// ---------- the play ----------
let pz = null, board = null, view = null, phase = 'off', tStart = 0, onEnd = null, hint = null, refuseAt = -9, picked = false, gkPose = null;
// view: where everything is drawn (places, in between them during a movement): o, d, g, b, and the ball's place.
function setView(s) { view = { o: s.o.slice(), d: s.d.slice(), g: s.g, b: s.b, ball: [s.o[2 * s.b] + .3, s.o[2 * s.b + 1] + .12], gx: 0, rot: 0 }; }
function drawAll() {
  if (!pz || !view) return;
  const n = view.o.length >> 1, m = view.d.length >> 1, bx = view.ball[0];
  showN('us', n); showN('them', m); showN('gk', 1);
  for (let i = 0; i < n; i++) { const el = node('us', i); put(el, view.o[2 * i], view.o[2 * i + 1]); face(el, i !== view.b && bx < view.o[2 * i] - .4); }
  for (let i = 0; i < m; i++) { const el = node('them', i); put(el, view.d[2 * i], view.d[2 * i + 1]); face(el, bx < view.d[2 * i] + .3); }
  const gk = node('gk', 0); put(gk, pz.W - .1 + view.gx, view.g + .14, 1, view.rot); face(gk, !gkPose);
  const [sx, sy] = toScreen(view.ball[0], view.ball[1]);
  ballEl.style.transform = `translate3d(${(sx - L.c * .2).toFixed(1)}px,${(sy - L.c * .2).toFixed(1)}px,0)`;
  ballEl.style.zIndex = 12 + Math.round(view.ball[1] * 4);
}
// The places he can run to (free, next to the ball: shown faintly, safe or not) and the gold ring under the ball carrier.
function drawHints(on) {
  let k = 0;
  if (on && board) {
    const s = board.s, bx = s.o[2 * s.b], by = s.o[2 * s.b + 1];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = bx + dx, y = by + dy; if ((!dx && !dy) || x < 0 || y < 0 || x >= pz.W || y >= pz.H || ourAt(s, x, y) >= 0 || theirAt(s, x, y) >= 0) continue;
      putFlat(node('hint', k++), x, y + .25);
    }
    putFlat(ringEl, bx, by + .25); ringEl.classList.add('show');
  } else ringEl.classList.remove('show');
  showN('hint', k);
}
function drawBalls() { const n = pz.moves; showN('foot', n); for (let i = 0; i < n; i++) node('foot', i).classList.toggle('gone', i >= board.left); }

// A tap on the board: a pass, a dribble, a shot, picking the ball carrier, or nothing.
function moveAt(px, py) {
  const fx = (px - L.ox) / L.c, fy = (py - L.oy) / L.c + .2, M = mid(pz); // (+.2: a kid stands above his place; a tap on his body is a tap on him)
  if (fx >= 0 && fx < pz.W && fy >= 0 && fy < pz.H) { const i = ourAt(board.s, Math.floor(fx), Math.floor(fy)); if (i >= 0) return i === board.s.b ? 'pick' : 'p' + i; }
  if (fx >= pz.W - .1 && fx < pz.W + 1.4 && fy >= M - 1.3 && fy < M + 2.3) return 's' + Math.max(M - 1, Math.min(M + 1, Math.floor(fy)));
  if (fx < -.4 || fy < -.4 || fx > pz.W + .1 || fy > pz.H + .4) return null;
  const x = Math.max(0, Math.min(pz.W - 1, Math.floor(fx))), y = Math.max(0, Math.min(pz.H - 1, Math.floor(fy))), s = board.s;
  const i = ourAt(s, x, y); if (i >= 0) return i === s.b ? 'pick' : 'p' + i;
  if (theirAt(s, x, y) >= 0) return 'x';
  return 'd' + x + ',' + y;
}
layer.addEventListener('pointerdown', e => {
  if (!e.isPrimary || held.on || phase !== 'wait' || !board) return;
  e.preventDefault(); tap(moveAt(e.clientX, e.clientY));
});
function tap(mv) {
  if (!mv || phase !== 'wait') return false;
  if (mv === 'pick') { picked = !picked; drawLanes(picked); return false; } // (costs nothing: a look at his options)
  if (mv === 'x') { refused(mv); return false; }
  const r = board.tap(mv);
  if (r.res === 'refused') { refused(mv); return false; }
  hint = null; hud.hand(null); picked = false; drawLanes(false);
  phase = 'busy'; drawBalls(); drawHints(false);
  act(mv, r).catch(e => console.error(e));
  return true;
}
// A tap that is not a move costs nothing: the places he can run to, or the box, light up for a moment.
function refused(mv) {
  if (stage.t - refuseAt < .5) return; refuseAt = stage.t;
  const box = pitchEl.querySelector('.boxlit');
  if (mv[0] === 's' && box) { box.classList.remove('flash'); void pitchEl.getBoundingClientRect(); box.classList.add('flash'); }
  else for (const h of pool.hint) { h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
}
const lerp = (a, b, u) => a + (b - a) * u, ease = u => u * u * (3 - 2 * u);
// The ball from where it is to a point (x, y: places), over dur.
function ballTo(x, y, dur) {
  const [x0, y0] = view.ball;
  return stage.anim(dur, u => { const k = 1 - (1 - u) * (1 - u); view.ball = [lerp(x0, x, k), lerp(y0, y, k)]; drawAll(); });
}
const atFeet = i => [view.o[2 * i] + .3, view.o[2 * i + 1] + .12];
// Ours that run, theirs that step: all at once, over dur. The ball stays at its carrier's feet.
function moveAll(runs, steps, dur) {
  if (!runs.length && !steps.length) return Promise.resolve();
  const follow = runs.some(r => r[0] === view.b), gs = steps.find(x => x[0] === 'gk');
  if (gs) gkPose = 'move';
  return stage.anim(dur, u => {
    const k = ease(u);
    for (const [i, a, b] of runs) { view.o[2 * i] = lerp(a[0], b[0], k); view.o[2 * i + 1] = lerp(a[1], b[1], k); }
    for (const [i, a, b] of steps) { if (i === 'gk') { view.g = lerp(a, b, k); view.rot = Math.sin(Math.PI * u) * 12 * Math.sign(b - a); } else { view.d[2 * i] = lerp(a[0], b[0], k); view.d[2 * i + 1] = lerp(a[1], b[1], k); } }
    if (follow) view.ball = atFeet(view.b);
    drawAll();
  }).then(() => { view.g = Math.round(view.g); view.rot = 0; drawAll(); });
}
// His move on the board, then their answer (r: Board.tap's result).
async function act(mv, r) {
  const m = parse(mv), lost = r.res === 'fail' && r.why !== 'out'; // (out of moves: the move is played, then it ends)
  if (m.k === 'p') {
    sfx('kick');
    if (lost) return failCut(r);
    view.b = m.i; await ballTo(...atFeet(m.i), T.pass);
  } else if (m.k === 'd') {
    sfx('tap');
    if (lost) return failTackle(r);
    view.b = board.s.b; await moveAll(r.runs, [], T.dribble);
  } else {
    sfx('shot');
    if (r.res === 'goal') { await ballTo(pz.W + .62, r.to[1], T.shot); return done({ res: 'goal' }); }
    return r.why === 'saved' ? failSave(r) : failCut(r);
  }
  if (m.k === 'p' && r.runs.length) await moveAll(r.runs, [], T.dribble * .8); // (the passer runs on)
  await stage.wait(T.beat);
  gkPose = null; await moveAll([], r.steps, T.answer); // (their answer, for a beat: the keeper shuffles, the red players step)
  if (!r.steps.some(x => x[0] === 'gk')) gkPose = null; drawAll();
  drawTethers(board.s); drawCover(board.s);
  if (r.res === 'fail') { flashBalls(); await stage.wait(.5); return failSay('out'); }
  phase = 'wait'; drawHints(true);
}
// Cut out or blocked: the path in red to the red player who stopped it; the ball goes to him; a red mark on him.
async function failCut(r) {
  const c = r.cut, [bx, by] = view.ball;
  G('cut').innerHTML = dashes(`M${P2(bx - .3, by - .12)}L${P2(r.to[0], r.to[1])}`, L.c * .08, '#ff5a5f');
  if (c) { await ballTo(c.x + .3 * Math.sign(bx - c.x - .3 || -1), c.y + .12, T.pass); putFlat(badEl, c.x + .3, c.y - .3); badEl.classList.add('show'); hit(node('them', c.who)); }
  return failSay(r.why);
}
// Saved: the keeper dives to the spot (he covered it), the ball stops in his gloves.
async function failSave(r) {
  const g0 = view.g, to = r.to[1], dir = Math.sign(to - g0);
  G('cut').innerHTML = dashes(`M${P2(view.ball[0] - .3, view.ball[1] - .12)}L${P2(pz.W, to)}`, L.c * .08, '#ff8a3d');
  gkPose = dir ? 'move' : null;
  const b = ballTo(pz.W - .2, to - .2, T.shot);
  await stage.anim(T.shot, u => { const k = ease(u); view.g = lerp(g0, to, k); view.gx = -.15 * k; view.rot = dir * 60 * k; drawAll(); });
  await b; putFlat(badEl, pz.W, to - .8); badEl.classList.add('show');
  return failSay('saved');
}
async function failTackle(r) {
  const [x, y] = r.to, i = view.b, who = r.by || [pz.W, board.s.g];
  await moveAll([[i, [view.o[2 * i], view.o[2 * i + 1]], [x, y]]], [], T.dribble);
  await ballTo(lerp(x, who[0], .55) + .1, lerp(y, who[1], .55) + .1, .22);
  putFlat(badEl, who[0] + .3, who[1] - .3); badEl.classList.add('show');
  const k = theirAt(board.s, who[0], who[1]); if (k >= 0) hit(node('them', k)); else hit(node('gk', 0));
  return failSay('tackle');
}
const hit = el => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); };
function flashBalls() { ballsEl.classList.remove('flash'); void ballsEl.offsetWidth; ballsEl.classList.add('flash'); }
// He sees why for a moment, then the life goes (run.js) and the solution plays.
async function failSay(why) { sfx('aww'); stage.say(PZ_WHY[why]); hud.caption(PZ_WHY[why]); phase = 'busy'; await stage.wait(T.why); return done({ res: 'fail', why }); }
function done(x) { phase = 'over'; drawHints(false); drawLanes(false); const f = onEnd; onEnd = null; f?.(x); }

// ---------- each frame ----------
function frame() {
  if (!pz) return;
  if (pz.sec && phase === 'wait') {
    const left = Math.max(0, 1 - (stage.t - tStart) / pz.sec); sandFill.style.transform = `scaleY(${left.toFixed(3)})`;
    if (left <= 0 && board.timeUp()) { phase = 'busy'; failSay('time'); }
  }
  if (hint && phase === 'wait' && stage.t - tStart > hint.after && !hint.on) { hint.on = true; hud.hand(toScreen(...hint.at), 1); }
  if (gen.it && phase === 'wait') stepGen(); // (only while the board stands still: a long step there shows nothing)
}

// ---------- one puzzle ----------
function showPuzzle(p) {
  pz = p; board = new Board(p); setView(board.s); hud.caption(''); gkPose = null; picked = false;
  layout(p); drawPitch(p); drawTethers(board.s); drawCover(board.s); drawLanes(false); G('path').innerHTML = ''; G('cut').innerHTML = '';
  badEl.classList.remove('show'); drawAll(); drawBalls();
  sandEl.classList.toggle('hidden', !p.sec); sandFill.style.transform = 'scaleY(1)';
  tStart = stage.t; layer.classList.remove('in'); void layer.offsetWidth; layer.classList.add('in');
}
// Plays one puzzle. Resolves { res: 'goal' | 'fail', why }.
function playOne(p, { first = false } = {}) {
  showPuzzle(p); phase = 'wait'; drawHints(true);
  hint = first ? { after: 4, at: targetOf(p.best[0]), on: false } : null;
  return new Promise(res => { onEnd = res; });
}
function targetOf(mv) { const m = parse(mv), s = board.s; return m.k === 'p' ? [s.o[2 * m.i], s.o[2 * m.i + 1]] : m.k === 'd' ? [m.x, m.y] : [pz.W, m.i]; }
// The shortest solution plays itself once (after a failed puzzle), its ball path in gold dashes.
async function replay(p) {
  phase = 'replay'; hud.hand(null);
  const line = PZ_IDEA[p.idea] || PZ_SAID.watch; hud.caption('✨ ' + line); stage.say(line);
  G('cut').innerHTML = ''; badEl.classList.remove('show'); gkPose = null;
  const b = new Board(p), from = { o: view.o.slice(), d: view.d.slice(), g: view.g, ball: view.ball.slice() }, s0 = startOf(p), f0 = [s0.o[2 * s0.b] + .3, s0.o[2 * s0.b + 1] + .12];
  await stage.anim(.4, u => { const k = ease(u); for (let i = 0; i < view.o.length; i++) view.o[i] = lerp(from.o[i], s0.o[i], k); for (let i = 0; i < view.d.length; i++) view.d[i] = lerp(from.d[i], s0.d[i], k); view.g = lerp(from.g, s0.g, k); view.gx = 0; view.rot = 0; view.ball = [lerp(from.ball[0], f0[0], k), lerp(from.ball[1], f0[1], k)]; drawAll(); });
  setView(s0); drawAll(); drawTethers(s0); drawCover(s0);
  const path = G('path'); let d = '';
  for (const mv of p.best) {
    const m = parse(mv), r = b.tap(mv), [x0, y0] = view.ball;
    d += `M${P2(x0 - .3, y0 - .12)}L${P2(r.to[0], r.to[1])}`; path.innerHTML = dashes(d, L.c * .07);
    if (m.k === 'p') { sfx('kick'); view.b = m.i; await ballTo(...atFeet(m.i), T.pass); if (r.runs.length) await moveAll(r.runs, [], T.dribble * .7); }
    else if (m.k === 'd') { sfx('tap'); view.b = b.s.b; await moveAll(r.runs, [], T.dribble); }
    else { sfx('shot'); await ballTo(p.W + .62, r.to[1], T.shot); sfx('net'); if (r.res !== 'goal') console.error('puzzle replay: the solution did not score', p.seed, p.level); break; }
    gkPose = null; await moveAll([], r.steps || [], T.replay); drawTethers(b.s); drawCover(b.s);
  }
  await stage.wait(1.2); hud.caption('');
}

// ---------- the next puzzle, made between frames ----------
// While he thinks, the next puzzle is made a little at a time (a few ms a frame): one for the level after a solve and
// one for the level after a miss, so it is ready whichever way this one ends.
const gen = { it: null, jobs: [] };
function prepare(run, seeds) {
  gen.jobs = [run.score + 1, run.score].map(at => { const seed = seeds(); return { at, seed, it: puzzleSteps(at * STEP, seed), out: null }; });
  gen.it = true;
}
function stepGen(budget = 4) {
  const t0 = performance.now();
  for (const j of gen.jobs) while (!j.out && performance.now() - t0 < budget) { const r = j.it.next(); if (r.done) j.out = r.value; }
  if (gen.jobs.every(j => j.out)) gen.it = null;
}
function nextFor(at) {
  const j = gen.jobs.find(x => x.at === at); gen.it = null; if (!j) return null;
  while (!j.out) { const r = j.it.next(); if (r.done) j.out = r.value; }
  return j.out;
}

// ---------- a run ----------
let busy = false;
export async function runPuzzles() {
  if (busy) return; busy = true; unlockSpeech(); warmKeeper();
  try {
    const first = !P.mini?.puzzles?.plays, r = rng(Math.floor(Math.random() * 2 ** 31)), seeds = () => Math.floor(r() * 2 ** 31);
    game.mode = 'puzzles'; hud.hideScore(); hud.caption(''); hud.state({ phase: 'idle', mode: 'puzzles' }); hud.dots([], 0);
    stage.setup(); onStage(stage); stage.on = true; stage.covers = true; layer.classList.remove('hidden'); // (covers: the board hides the 3D picture, so main.js does not draw it: v89 integration)
    const run = startRun('puzzles');
    let p = forced() || makePuzzle(run.level, seeds()); show(null); showPuzzle(p);
    if (first) await card({ emoji: '🧩', title: PZ_SAID.intro, sub: 'Tap a friend to pass, a spot by the ball to run, the goal to shoot. A keeper standing still saves everything: make him move!', button: 'Play' });
    for (let i = 0; ; i++) {
      const at = run.score; prepare(run, seeds);
      const x = await playOne(p, { first: first && i === 0 }), ok = x.res === 'goal';
      if (ok) { hud.banner('GOAL!', 'goal'); sfx('net'); stage.say(PZ_SAID.goal); }
      const goOn = runStep(run, ok, { at, seed: p.seed, idea: p.idea, len: p.len, moves: p.moves, taps: board.taps.join(' '), res: ok ? 'goal' : x.why, sec: Math.round((stage.t - tStart) * 10) / 10 });
      if (ok) await stage.wait(1.3); else await replay(p);
      if (!goOn) break;
      p = forced() || nextFor(run.score) || makePuzzle(run.level, seeds());
    }
    end(); endRun(run, { again: runPuzzles });
  } catch (e) { console.error(e); end(); runOff(); show('#home'); } finally { busy = false; }
}
function end() {
  stage.on = false; stage.covers = false; phase = 'off'; pz = null; board = null; gen.it = null; gen.jobs = []; onEnd = null; hint = null;
  stage.tw.length = 0; hud.hand(null); hud.caption(''); layer.classList.add('hidden'); onStage(null); game.home();
}
addEventListener('resize', () => { if (pz && stage.on && board) { layout(pz); drawPitch(pz); drawCover(board.s); drawTethers(board.s); drawLanes(picked); drawAll(); drawHints(phase === 'wait'); } });

// For the review tools and the browser checks: what is on the board and where (read only), the move a screen point
// means, and `force` ({ level, seed, sec }): the next puzzle shown is that one (for pictures of a high level).
const dev = { force: null, stage, get phase() { return phase; }, get pz() { return pz; }, get board() { return board; }, get layout() { return { ...L }; }, get picked() { return picked; }, toScreen, moveAt };
function forced() { const f = dev.force; if (!f) return null; dev.force = null; const p = makePuzzle(f.level, f.seed ?? 1); if (f.sec != null) p.sec = f.sec; return p; }
if (typeof window !== 'undefined') window.__pz = dev;
