// Soccer puzzles on the page (v90): a mini game (mini/chooser.js), the one with the top view. mini/puzzle.js has the
// rules; this draws the board over the whole screen (an SVG pitch drawn once a puzzle, the counters and the ball as
// HTML nodes made once and moved by transform only), takes his taps, plays the defenders' answer in a short beat, and
// runs it with two lives (mini/run.js). After a failed puzzle the shortest solution plays itself once as a gold dotted
// path. It goes on the stage as the keeper game does (ui/goalie.js onStage: main.js ticks it, the pause holds it), so
// every wait and every movement here runs on the game's clock and stops while paused.
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
import { puzzleSteps, makePuzzle, Board, startOf, parse, mid, inBox, ourAt, theirAt, rng, PZ_SAID, PZ_WHY, PZ_IDEA } from './puzzle.js';

const INK = '#24193a', GOLD = '#ffd23f';
const KIT = { us: '#4f8dff', them: '#ff5a5f', gk: '#ff8a3d' };
const T = { pass: .3, dribble: .26, shot: .32, answer: .45, replay: .55 }; // seconds (game clock): his move, their answer

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

// ---------- the nodes (made once) ----------
const counter = (fill, gloves) => `<svg viewBox="-1 -1 2 2" aria-hidden="true"><circle cy=".08" r=".72" fill="${INK}" opacity=".3"/><circle r=".72" fill="${fill}" stroke="${INK}" stroke-width=".14"/><circle r=".4" fill="none" stroke="#fff" stroke-width=".12" opacity=".7"/>`
  + (gloves ? `<circle cx="-.62" cy=".3" r=".2" fill="#3fdc6a" stroke="${INK}" stroke-width=".08"/><circle cx=".62" cy=".3" r=".2" fill="#3fdc6a" stroke="${INK}" stroke-width=".08"/>` : '') + '</svg>';
const BALL = `<svg viewBox="-12.5 -12.5 25 25" aria-hidden="true">${ballSvg(0, 0, 10)}</svg>`; // (pics.js draws it in pixels: its outline is at least 1.2 wide)
const layer = document.createElement('div');
layer.id = 'pz'; layer.className = 'hidden';
layer.innerHTML = '<svg class="pitch" aria-hidden="true"></svg><svg class="marks" aria-hidden="true"><g class="tether"></g><g class="path"></g><g class="cut"></g></svg>'
  + '<div class="pcs"></div><div class="ring"></div><div class="bad"></div><div class="pzball">' + BALL + '</div>'
  + '<div class="balls" aria-label="Moves"></div><div class="sand hidden" aria-label="Time"><i></i></div>';
const hudEl = $('#hud'); hudEl.insertBefore(layer, hudEl.firstChild); // (under the bar, the home and pause buttons)
const pitchEl = layer.querySelector('.pitch'), marks = layer.querySelector('.marks'), pcs = layer.querySelector('.pcs');
const ringEl = layer.querySelector('.ring'), badEl = layer.querySelector('.bad'), ballEl = layer.querySelector('.pzball');
const ballsEl = layer.querySelector('.balls'), sandEl = layer.querySelector('.sand'), sandFill = sandEl.querySelector('i');
ringEl.innerHTML = `<svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r=".88" fill="none" stroke="${GOLD}" stroke-width=".13"/></svg>`;
badEl.innerHTML = `<svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r=".9" fill="none" stroke="#fff" stroke-width=".2"/><circle r=".9" fill="none" stroke="#e8213a" stroke-width=".12"/><path d="M-.42 -.42L.42 .42M.42 -.42L-.42 .42" stroke="#fff" stroke-width=".3" stroke-linecap="round"/><path d="M-.42 -.42L.42 .42M.42 -.42L-.42 .42" stroke="#e8213a" stroke-width=".16" stroke-linecap="round"/></svg>`;
const pool = { us: [], them: [], gk: [], hint: [], foot: [] };
function node(kind, i) {
  const a = pool[kind];
  while (a.length <= i) {
    const el = document.createElement(kind === 'foot' ? 'i' : 'div');
    if (kind === 'foot') { el.innerHTML = BALL; ballsEl.appendChild(el); } else {
      el.className = 'pzp ' + kind; el.innerHTML = kind === 'hint' ? `<svg viewBox="-1 -1 2 2" aria-hidden="true"><circle r=".42" fill="${GOLD}" opacity=".18"/><circle r=".42" fill="none" stroke="${GOLD}" stroke-width=".09" stroke-dasharray=".2 .14"/></svg>` : counter(KIT[kind], kind === 'gk');
      pcs.appendChild(el);
    }
    a.push(el);
  }
  return a[i];
}
const showN = (kind, n) => { for (let i = 0; i < Math.max(n, pool[kind].length); i++) node(kind, i).classList.toggle('off', i >= n); };

// ---------- where things are on the screen ----------
// The board is as big as it fits: under the top bar across the whole width, or beside the bar down the whole height
// (whichever gives bigger places). The moves (footballs) go down the left edge, the sand timer down the right.
const L = { ox: 0, oy: 0, c: 50 };
function layout(pz) {
  const w = innerWidth, h = innerHeight, r = el => el?.getBoundingClientRect();
  const home = r($('#homeBtn')), bar = r($('#miniBar')), snd = r(hudEl.querySelector('.hud-sound'));
  const sl = Math.max(0, (home?.left || 14) - 14), band = Math.max(home?.bottom || 58, bar?.bottom || 58) + 6;
  const right = snd?.width ? snd.left - 8 : w - 64, cols = pz.W + 1.15, rows = pz.H + .15;
  const a = { x0: sl + 64, x1: w - (w - right) - 6, y0: band, y1: h - 6 }; // under the bar (the sound button is in the bar's band)
  a.x1 = Math.min(a.x1, w - sl - 60);
  const b = { x0: Math.max(bar?.right || 360, home?.right || 60) + 10, x1: right, y0: 8, y1: h - 6 }; // beside it
  const fit = q => Math.min((q.x1 - q.x0) / cols, (q.y1 - q.y0) / rows);
  const q = fit(a) >= fit(b) * .92 ? a : b, c = Math.floor(fit(q)); // (in the middle under the bar, unless beside it is clearly bigger)
  L.c = c; L.ox = Math.round((q.x0 + q.x1) / 2 - (pz.W + 1) * c / 2); L.oy = Math.round((q.y0 + q.y1) / 2 - pz.H * c / 2);
  layer.style.setProperty('--c', c + 'px');
  const vb = `-.15 -.15 ${pz.W + 1.3} ${pz.H + .3}`, css = `left:${L.ox - .15 * c}px;top:${L.oy - .15 * c}px;width:${(pz.W + 1.3) * c}px;height:${(pz.H + .3) * c}px`;
  for (const s of [pitchEl, marks]) { s.setAttribute('viewBox', vb); s.style.cssText = css; }
  ballsEl.style.top = Math.max(band, 64) + 'px';
}
// The screen point of a place (x, y: places; the goal is x = W).
export const toScreen = (x, y) => [L.ox + (x + .5) * L.c, L.oy + (y + .5) * L.c];
const put = (el, x, y, k = 1) => { el.style.transform = `translate3d(${(L.ox + (x + .5) * L.c - L.c / 2).toFixed(1)}px,${(L.oy + (y + .5) * L.c - L.c / 2).toFixed(1)}px,0)` + (k !== 1 ? ` scale(${k.toFixed(3)})` : ''); };

// ---------- the pitch (an SVG, drawn once a puzzle) ----------
function drawPitch(pz) {
  const { W, H } = pz, M = mid(pz), n = v => Math.round(v * 1000) / 1000;
  let s = `<rect x="-.15" y="-.15" width="${W + .3}" height="${H + .3}" rx=".22" fill="#3c8f46"/>`;
  for (let x = 0; x < W; x += 2) s += `<rect x="${x}" y="-.15" width="1" height="${H + .3}" fill="#47a352"/>`;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += `<circle cx="${x + .5}" cy="${y + .5}" r=".055" fill="#fff" opacity=".3"/>`;
  const b0 = Math.max(0, M - 2), b1 = Math.min(H, M + 3);
  s += `<rect x="${W - 2}" y="${b0}" width="2" height="${b1 - b0}" fill="#fff" opacity=".1"/>`; // (the box: he shoots from here)
  s += `<g fill="none" stroke="#fff" stroke-width=".05" opacity=".9"><rect x="0" y="0" width="${W}" height="${H}"/><path class="box" d="M${W} ${b0}H${W - 2}V${b1}H${W}"/>`
    + `<path d="M0 ${H / 2 - 1.1}A1.1 1.1 0 0 1 0 ${H / 2 + 1.1}"/></g>`;
  // the goal: three places past the line, a net, white posts
  const gy0 = M - 1, gy1 = M + 2;
  s += `<rect x="${W}" y="${gy0}" width=".95" height="3" fill="#fff" opacity=".2"/>`;
  for (let i = 1; i < 5; i++) s += `<path d="M${n(W + i * .19)} ${gy0}V${gy1}" stroke="#fff" stroke-width=".025" opacity=".5"/>`;
  for (let i = 1; i < 12; i++) s += `<path d="M${W} ${n(gy0 + i * .25)}H${W + .95}" stroke="#fff" stroke-width=".025" opacity=".5"/>`;
  const p = `M${W} ${gy0}H${W + .95}V${gy1}H${W}`;
  s += `<path d="${p}" fill="none" stroke="${INK}" stroke-width=".16" stroke-linejoin="round"/><path d="${p}" fill="none" stroke="#fff" stroke-width=".09" stroke-linejoin="round"/>`;
  s += `<circle cx="${W}" cy="${gy0}" r=".09" fill="#fff" stroke="${INK}" stroke-width=".04"/><circle cx="${W}" cy="${gy1}" r=".09" fill="#fff" stroke="${INK}" stroke-width=".04"/>`;
  pitchEl.innerHTML = s;
}
const dashes = (d, w = .1, c = GOLD) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + .07}" stroke-dasharray="${w * 1.5} ${w * 1.5}" stroke-linecap="round" opacity=".35"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-dasharray="${w * 1.5} ${w * 1.5}" stroke-linecap="round"/>`;
const ctr = (x, y) => `${x + .5} ${y + .5}`;
// The markers' links to their men (thin red dashes).
function drawTethers(pz, s) {
  let t = ''; pz.roles.forEach((j, i) => { if (j >= 0) t += `<path d="M${ctr(s.d[2 * i], s.d[2 * i + 1])}L${ctr(s.o[2 * j], s.o[2 * j + 1])}" stroke="#ff5a5f" stroke-width=".06" stroke-dasharray=".1 .08" opacity=".9"/>`; });
  marks.querySelector('.tether').innerHTML = t;
}

// ---------- the play ----------
let pz = null, board = null, view = null, phase = 'off', tStart = 0, onEnd = null, hint = null, refuseAt = -9;
// view: where the counters are drawn (places, moving between them in an answer): o, d, g, b, and the ball's place.
function setView(s) { view = { o: s.o.slice(), d: s.d.slice(), g: s.g, b: s.b, ball: [s.o[2 * s.b], s.o[2 * s.b + 1]] }; }
function drawAll() {
  if (!pz || !view) return;
  const n = view.o.length >> 1, m = view.d.length >> 1;
  showN('us', n); showN('them', m); showN('gk', 1);
  for (let i = 0; i < n; i++) put(node('us', i), view.o[2 * i], view.o[2 * i + 1]);
  for (let i = 0; i < m; i++) put(node('them', i), view.d[2 * i], view.d[2 * i + 1]);
  put(node('gk', 0), pz.W, view.g);
  ballEl.style.transform = `translate3d(${(L.ox + (view.ball[0] + .5 + .27) * L.c - L.c * .21).toFixed(1)}px,${(L.oy + (view.ball[1] + .5 + .27) * L.c - L.c * .21).toFixed(1)}px,0)`;
}
// The places he can dribble to (free, next to the ball: shown faintly, safe or not) and the gold ring round the ball.
function drawHints(on) {
  let k = 0;
  if (on && board) {
    const s = board.s, bx = s.o[2 * s.b], by = s.o[2 * s.b + 1];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = bx + dx, y = by + dy; if ((!dx && !dy) || x < 0 || y < 0 || x >= pz.W || y >= pz.H || ourAt(s, x, y) >= 0 || theirAt(s, x, y) >= 0) continue;
      put(node('hint', k++), x, y);
    }
    put(ringEl, bx, by); ringEl.classList.add('show');
  } else ringEl.classList.remove('show');
  showN('hint', k);
}
function drawBalls() { const n = pz.moves; showN('foot', n); for (let i = 0; i < n; i++) node('foot', i).classList.toggle('gone', i >= board.left); }

// A tap on the board: a pass, a dribble, a shot, or nothing.
function moveAt(px, py) {
  const fx = (px - L.ox) / L.c, fy = (py - L.oy) / L.c, M = mid(pz);
  if (fx >= pz.W - .1 && fx < pz.W + 1.4 && fy >= M - 1.3 && fy < M + 2.3) return 's' + Math.max(M - 1, Math.min(M + 1, Math.floor(fy)));
  if (fx < -.4 || fy < -.4 || fx > pz.W + .1 || fy > pz.H + .4) return null;
  const x = Math.max(0, Math.min(pz.W - 1, Math.floor(fx))), y = Math.max(0, Math.min(pz.H - 1, Math.floor(fy))), s = board.s;
  const i = ourAt(s, x, y); if (i >= 0) return i === s.b ? null : 'p' + i;
  if (theirAt(s, x, y) >= 0) return null;
  return 'd' + x + ',' + y;
}
layer.addEventListener('pointerdown', e => {
  if (!e.isPrimary || held.on || phase !== 'wait' || !board) return;
  e.preventDefault(); tap(moveAt(e.clientX, e.clientY));
});
function tap(mv) {
  if (!mv || phase !== 'wait') return false;
  const r = board.tap(mv);
  if (r.res === 'refused') { refused(mv); return false; }
  hint = null; hud.hand(null);
  phase = 'busy'; drawBalls(); drawHints(false);
  act(mv, r).catch(e => console.error(e));
  return true;
}
// A tap that is not a move costs nothing: the places he can dribble to, or the box, light up for a moment.
function refused(mv) {
  if (stage.t - refuseAt < .5) return; refuseAt = stage.t;
  const box = pitchEl.querySelector('.box');
  if (mv[0] === 's' && box) { box.classList.remove('flash'); void box.getBBox?.(); box.classList.add('flash'); stage.anim(.9, u => { if (u >= 1) box.classList.remove('flash'); }); }
  else for (const h of pool.hint) { h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
}
const lerp = (a, b, u) => a + (b - a) * u, ease = u => u * u * (3 - 2 * u);
// The ball from where it is to a place (x, y), over dur.
function ballTo(x, y, dur, arc = 0) {
  const [x0, y0] = view.ball;
  return stage.anim(dur, u => { const k = ease(u); view.ball = [lerp(x0, x, k), lerp(y0, y, k) - arc * Math.sin(Math.PI * u)]; drawAll(); });
}
// Ours that run, theirs that step: all at once, over dur.
function moveAll(runs, steps, dur) {
  if (!runs.length && !steps.length) return Promise.resolve();
  const o0 = view.o.slice(), d0 = view.d.slice(), g0 = view.g, follow = runs.find(r => r[0] === view.b);
  return stage.anim(dur, u => {
    const k = ease(u);
    for (const [i, a, b] of runs) { view.o[2 * i] = lerp(a[0], b[0], k); view.o[2 * i + 1] = lerp(a[1], b[1], k); }
    for (const [i, a, b] of steps) { if (i === 'gk') view.g = lerp(a, b, k); else { view.d[2 * i] = lerp(a[0], b[0], k); view.d[2 * i + 1] = lerp(a[1], b[1], k); } }
    if (follow) view.ball = [view.o[2 * view.b], view.o[2 * view.b + 1]];
    drawAll();
  }).then(() => { view.g = Math.round(view.g); });
}
// His move on the board, then their answer (r: Board.tap's result).
async function act(mv, r) {
  const m = parse(mv), lost = r.res === 'fail' && r.why !== 'out'; // (out of moves: the move is played, then it ends)
  if (m.k === 'p') {
    sfx('kick');
    if (lost) return failCut(r);
    view.b = m.i; await ballTo(r.to[0], r.to[1], T.pass);
  } else if (m.k === 'd') {
    sfx('tap');
    if (lost) return failTackle(r);
    view.b = board.s.b; await moveAll(r.runs, [], T.dribble);
  } else {
    sfx('shot');
    if (r.res === 'goal') { await ballTo(pz.W + .1, r.to[1] - .27, T.shot); return done({ res: 'goal' }); } // (in the back of the net, in the middle of the place he shot at)
    return failCut(r);
  }
  await moveAll(m.k === 'p' ? r.runs : [], r.steps, T.answer);
  drawTethers(pz, board.s);
  if (r.res === 'fail') { stage.say(PZ_WHY.out); hud.caption('⚽ ' + PZ_WHY.out); return done({ res: 'fail', why: 'out' }); }
  phase = 'wait'; drawHints(true);
}
// Cut out or saved: the path in red to the one who stopped it; the ball goes to him.
async function failCut(r) {
  const c = r.cut, bx = view.ball[0], by = view.ball[1];
  marks.querySelector('.cut').innerHTML = dashes(`M${ctr(bx, by)}L${ctr(r.to[0], r.to[1])}`, .1, '#ff5a5f');
  if (c) { await ballTo(c.x - .3 * Math.sign(c.x - bx || 1), c.y + .2, T.pass); put(badEl, c.x, c.y); badEl.classList.add('show'); }
  return failSay(r.why);
}
async function failTackle(r) {
  const s = board.s, [x, y] = r.to, i = s.b; let who = null, best = 9;
  for (let k = 0; k < s.d.length; k += 2) { const d = Math.max(Math.abs(s.d[k] - x), Math.abs(s.d[k + 1] - y)); if (d <= 1 && d < best) { best = d; who = [s.d[k], s.d[k + 1]]; } }
  if (!who) who = [pz.W, s.g];
  await moveAll([[i, [view.o[2 * i], view.o[2 * i + 1]], [x, y]]], [], T.dribble);
  await ballTo(lerp(x, who[0], .6), lerp(y, who[1], .6), .18);
  put(badEl, who[0], who[1]); badEl.classList.add('show');
  return failSay('tackle');
}
function failSay(why) { sfx('aww'); stage.say(PZ_WHY[why]); hud.caption(PZ_WHY[why]); return done({ res: 'fail', why }); }
function done(x) { phase = 'over'; drawHints(false); const f = onEnd; onEnd = null; f?.(x); }

// ---------- each frame ----------
function frame() {
  if (!pz) return;
  if (pz.sec && phase === 'wait') {
    const left = Math.max(0, 1 - (stage.t - tStart) / pz.sec); sandFill.style.transform = `scaleY(${left.toFixed(4)})`;
    if (left <= 0 && board.timeUp()) { phase = 'busy'; failSay('time'); }
  }
  if (hint && phase === 'wait' && stage.t - tStart > hint.after && !hint.on) { hint.on = true; hud.hand(toScreen(...hint.at), 1); }
  if (gen.it) stepGen();
}

// ---------- one puzzle ----------
function showPuzzle(p) {
  pz = p; board = new Board(p); setView(board.s); hud.caption('');
  layout(p); drawPitch(p); drawTethers(p, board.s); marks.querySelector('.path').innerHTML = ''; marks.querySelector('.cut').innerHTML = '';
  badEl.classList.remove('show'); drawAll(); drawBalls();
  sandEl.classList.toggle('hidden', !p.sec); sandFill.style.transform = 'scaleY(1)';
  tStart = stage.t; layer.classList.remove('in'); void layer.offsetWidth; layer.classList.add('in');
}
// Plays one puzzle. Resolves { res: 'goal' | 'fail', why }.
function playOne(p, { first = false } = {}) {
  showPuzzle(p); phase = 'wait'; drawHints(true);
  hint = first ? { after: 3, at: targetOf(p.best[0]), on: false } : null;
  return new Promise(res => { onEnd = res; });
}
function targetOf(mv) { const m = parse(mv), s = board.s; return m.k === 'p' ? [s.o[2 * m.i], s.o[2 * m.i + 1]] : m.k === 'd' ? [m.x, m.y] : [pz.W, m.i]; }
// The shortest solution plays itself once, quickly, as a gold dotted path (after a failed puzzle).
async function replay(p) {
  phase = 'replay'; hud.hand(null);
  await stage.wait(1.1);
  const line = PZ_IDEA[p.idea] || PZ_SAID.watch; hud.caption('✨ ' + line); stage.say(line);
  marks.querySelector('.cut').innerHTML = ''; badEl.classList.remove('show');
  const b = new Board(p), from = { ...view, o: view.o.slice(), d: view.d.slice(), ball: view.ball.slice() }, s0 = startOf(p);
  await stage.anim(.4, u => { const k = ease(u); for (let i = 0; i < view.o.length; i++) view.o[i] = lerp(from.o[i], s0.o[i], k); for (let i = 0; i < view.d.length; i++) view.d[i] = lerp(from.d[i], s0.d[i], k); view.g = lerp(from.g, s0.g, k); view.ball = [lerp(from.ball[0], s0.o[2 * s0.b], k), lerp(from.ball[1], s0.o[2 * s0.b + 1], k)]; drawAll(); });
  setView(s0); drawAll(); drawTethers(p, s0);
  const path = marks.querySelector('.path'); let d = '';
  for (const mv of p.best) {
    const m = parse(mv), r = b.tap(mv), [x0, y0] = view.ball;
    d += `M${ctr(x0, y0)}L${ctr(r.to[0] - (m.k === 's' ? .35 : 0), r.to[1])}`; path.innerHTML = dashes(d);
    if (m.k === 'p') { sfx('kick'); view.b = m.i; await ballTo(r.to[0], r.to[1], T.pass * .8); }
    else if (m.k === 'd') { sfx('tap'); view.b = b.s.b; await moveAll(r.runs, [], T.dribble * .8); }
    else { sfx('shot'); await ballTo(p.W + .1, r.to[1] - .27, T.shot); sfx('net'); if (r.res !== 'goal') console.error('puzzle replay: the solution did not score', p.seed, p.level); break; }
    await moveAll(m.k === 'p' ? r.runs : [], r.steps || [], T.replay * .6); drawTethers(p, b.s);
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
    stage.setup(); onStage(stage); stage.on = true; layer.classList.remove('hidden');
    const run = startRun('puzzles');
    let p = forced() || makePuzzle(run.level, seeds()); show(null); showPuzzle(p);
    if (first) await card({ emoji: '🧩', title: PZ_SAID.intro, sub: 'Tap a friend to pass. Tap next to the ball to dribble. Tap the goal to shoot.', button: 'Play' });
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
  stage.on = false; phase = 'off'; pz = null; board = null; gen.it = null; gen.jobs = []; onEnd = null; hint = null;
  stage.tw.length = 0; hud.hand(null); hud.caption(''); layer.classList.add('hidden'); onStage(null); game.home();
}
addEventListener('resize', () => { if (pz && stage.on) { layout(pz); drawAll(); drawHints(phase === 'wait'); } });

// For the review tools and the browser checks: what is on the board and where (read only), the move a screen point
// means, and `force` ({ level, seed, sec }): the next puzzle shown is that one (for pictures of a high level).
const dev = { force: null, stage, get phase() { return phase; }, get pz() { return pz; }, get board() { return board; }, get layout() { return { ...L }; }, toScreen, moveAt };
function forced() { const f = dev.force; if (!f) return null; dev.force = null; const p = makePuzzle(f.level, f.seed ?? 1); if (f.sec != null) p.sec = f.sec; return p; }
if (typeof window !== 'undefined') window.__pz = dev;
