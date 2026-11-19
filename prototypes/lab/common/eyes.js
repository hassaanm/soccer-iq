// The player view for the lab (round 2): what his own player sees, as the real game shows it (js/game/view.js
// HEAD_DOWN and the head-up view, js/game/input.js LOOK and drag, css/app.css #tunnel on Smooth), ported here so
// nothing under js/ changes.
//  - Head down (on the ball): close behind and above his player, a narrow view, the dark edge round it.
//  - LOOK UP (or any drag) lifts his head: farther back, looking out across the pitch, no edge.
//  - A drag turns his head, and the camera with it; it stays where he leaves it for a while, then comes back round to
//    where he would naturally look (the goal with the ball, the ball without it).
//  - What is behind him is not on screen until he turns; the lab only lets him tap what is on screen (cfg.mustSee).
// Also here: the avatar button (top right) that pauses and lets him change his player, with shirts drawn from the kit.
import { clamp } from './lab.js';

// back, to the side, height, ahead, toward the ball (part), target height, focal lengths (height, width)
const DOWN = [3.1, 1.3, 2.9, 3.5, .25, .8, 1.05, .64], UP = [5.2, .3, 2.8, 9, 0, .5, .9, .52];
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;

export function eyes(lab, opt) {
  const sim = lab.sim, world = lab.world, canvas = world.canvas;
  const v = lab.eyes = { me: opt.me, yaw: 0, look: 0, lookUp: true, drag: null, holdT: 0, looks: 0, natural: opt.natural, auto: true };
  const tun = document.createElement('div'); tun.id = 'tunnel'; document.body.insertBefore(tun, document.querySelector('#chrome'));
  const btn = document.createElement('button'); btn.id = 'lookB'; btn.className = 'lb gold'; btn.innerHTML = '<i>👀</i><span>LOOK UP</span>'; btn.setAttribute('aria-label', 'Look up');
  document.querySelector('#chrome').append(btn);
  const setUp = up => { if (v.lookUp !== up) { v.lookUp = up; lab.sfx(up ? 'up' : 'down'); if (up) v.looks++; } btn.classList.toggle('up', up); btn.querySelector('span').textContent = up ? 'HEAD DOWN' : 'LOOK UP'; };
  v.setUp = setUp;
  btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (lab.paused || !lab.started) return; setUp(!v.lookUp); v.holdT = lab.real + 4; });
  // a finger on the pitch: a drag turns his head, a tap (lifted where it went down) is a tap
  canvas.addEventListener('pointerdown', e => { const r = canvas.getBoundingClientRect(); v.drag = { x0: e.clientX - r.left, y0: e.clientY - r.top, yaw0: v.yaw, moved: false, w: r.width || world.width }; });
  canvas.addEventListener('pointermove', e => {
    const d = v.drag; if (!d || lab.paused) return; const r = canvas.getBoundingClientRect(), dx = e.clientX - r.left - d.x0;
    if (!d.moved && Math.abs(dx) > 12) { d.moved = true; v.looks++; if (!v.lookUp) setUp(true); }
    if (d.moved) { v.yaw = wrap(d.yaw0 - dx / d.w * 3.2); v.holdT = lab.real + 4; }
  });
  const up = e => { const d = v.drag; v.drag = null; if (!d) return; if (!d.moved && e.type === 'pointerup') { const r = canvas.getBoundingClientRect(); lab.tapAt(e.clientX - r.left, e.clientY - r.top); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  // each frame: his look eases up or down; his head comes back round when he has not looked for a while
  lab.onFrame = dt => {
    v.look += ((v.lookUp ? 1 : 0) - v.look) * (1 - Math.exp(-dt * 6));
    const me = sim.a(v.me); if (!me) return;
    if (!v.drag?.moved && lab.real > v.holdT && v.auto) { const n = v.natural(); if (n != null) { const d = wrap(n - v.yaw); v.yaw = wrap(v.yaw + d * (1 - Math.exp(-dt * 2.4))); } }
    v.drawEdge();
  };
  v.snap = () => { const n = v.natural(); if (n != null) v.yaw = n; };
  // the camera: behind and above him, by his look (as js/game/view.js camSpec does it)
  lab.camWant = () => {
    const h = sim.a(v.me), b = sim.ball; if (!h) return null;
    const k = sm(v.look), C = DOWN, yaw = v.yaw;
    const [bx, by] = rot(-lerp(C[0], UP[0], k), lerp(C[1], UP[1], k), yaw), [fx, fy] = rot(UP[3], 0, yaw);
    let dx, dy;
    if (b.state === 'carried' && b.carrier === v.me) { const [ax, ay] = rot(.45, 0, yaw); dx = h.x + ax; dy = h.y + ay; }
    else { const [ax, ay] = rot(C[3], 0, yaw); const ahead = (b.x - h.x) * Math.cos(yaw) + (b.y - h.y) * Math.sin(yaw) > 0; dx = lerp(h.x + ax, b.x, ahead ? C[4] : 0); dy = lerp(h.y + ay, b.y, ahead ? C[4] : 0); }
    return { eye: [h.x + bx, h.y + by, lerp(C[2], UP[2], k)], tgt: [lerp(dx, h.x + fx, k), lerp(dy, h.y + fy, k), lerp(C[5], UP[5], k)], Ff: lerp(C[6], UP[6], k), Fw: lerp(C[7], UP[7], k), k: 60 };
  };
  // the edge: a dark ring on a layer twice the screen's size, moved (transform only) so its clear middle is on him
  let lastT = '', lastO = -1;
  v.drawEdge = () => {
    const h = sim.a(v.me), o = Math.round((1 - sm(v.look)) * 100) / 100;
    if (o !== lastO) { tun.style.opacity = o; tun.classList.toggle('on', o > .02); lastO = o; }
    if (!h || o <= .02) return;
    const s = world.project(h.x, h.y, .9); if (!s) return;
    const tx = `translate(${Math.round(s[0] - world.width / 2)}px,${Math.round(s[1] - world.height * .64)}px)`;
    if (tx !== lastT) { tun.style.transform = tx; lastT = tx; }
  };
  // the yaw that brings a point to the middle of the view, and whether it is on screen now
  v.turnTo = p => { const h = sim.a(v.me); return Math.atan2(p.y - h.y, p.x - h.x); };
  v.sees = p => { const s = world.project(p.x, p.y, p.z ?? .5); return !!s && s[0] > 6 && s[0] < world.width - 6 && s[1] > 6 && s[1] < world.height - 6; };
  return v;
}

// A shirt in the kit's colours with a number, as an SVG string.
export function shirt(team, num, size = 64) {
  const k = team.kit, c0 = k.colors[0], c1 = k.colors[1] || c0, id = 's' + Math.random().toString(36).slice(2, 7);
  const body = 'M18 8 L30 4 Q36 10 42 4 L54 8 L64 22 L54 28 L52 60 L20 60 L18 28 L8 22 Z';
  const pat = k.pattern === 'stripes' ? `<pattern id="${id}" width="12" height="10" patternUnits="userSpaceOnUse"><rect width="6" height="10" fill="${c0}"/><rect x="6" width="6" height="10" fill="${c1}"/></pattern>` : '';
  return `<svg viewBox="0 0 72 64" width="${size}" height="${size * 64 / 72}" aria-hidden="true"><defs>${pat}</defs><path d="${body}" fill="${pat ? `url(#${id})` : c0}" stroke="#24193a" stroke-width="2.5" stroke-linejoin="round"/>${k.pattern === 'sleeves' ? `<path d="M8 22 L18 8 L18 28 Z M64 22 L54 8 L54 28 Z" fill="${c1}"/>` : ''}<text x="36" y="44" text-anchor="middle" font-family="Fredoka,system-ui,sans-serif" font-weight="700" font-size="20" fill="${k.num}" stroke="#24193a" stroke-width=".8">${num}</text></svg>`;
}
// The avatar button (top right): his player's shirt. A tap pauses and shows the team; a tap on another changes him.
export function avatar(lab, ids, me, onSwap) {
  const team = lab.us, pl = id => team.players[id === 'hero' ? 0 : +id.slice(1)];
  const b = document.createElement('button'); b.id = 'avatarB'; b.className = 'lb glass icon'; b.setAttribute('aria-label', 'Change your player');
  document.querySelector('#chrome').append(b); document.body.classList.add('hasAvatar');
  const sheet = document.createElement('div'); sheet.id = 'swapS'; sheet.className = 'sheet hide';
  sheet.innerHTML = `<div class="card"><h2>Who are you?</h2><div class="pickRow">${ids.map(id => `<button class="lb glass pickIt" data-id="${id}">${shirt(team, pl(id).num, 70)}<b>${pl(id).name}</b></button>`).join('')}</div></div>`;
  document.querySelector('#chrome').append(sheet);
  const draw = id => { b.innerHTML = shirt(team, pl(id).num, 38); for (const x of sheet.querySelectorAll('.pickIt')) x.classList.toggle('me', x.dataset.id === id); };
  draw(me);
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (!lab.started || lab.ended) return; lab.pause(true); document.querySelector('#pauseS').classList.add('hide'); sheet.classList.remove('hide'); });
  for (const x of sheet.querySelectorAll('.pickIt')) x.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const id = x.dataset.id; sheet.classList.add('hide'); draw(id); onSwap(id); lab.pause(false); });
  return { draw, pickHtml: id => `${shirt(team, pl(id).num, 70)}<b>${pl(id).name}</b>` };
}

// (for the checks) For each choice: was its best option off screen as it opened, and was it on screen (after a look)
// when he chose? Wraps lab.open; the counts are in lab.sight.
export function trackSight(lab, v) {
  const S = lab.sight = { wins: 0, offAtOpen: 0, foundByLook: 0, looks: 0 }, open0 = lab.open;
  lab.open = w => {
    const pick = w.onPick; let off = null, looks0 = v.looks;
    w.onPick = (o, rt) => { if (off) { S.offAtOpen++; if (v.looks > looks0 && lab.seen(w.options.find(x => x.best) || o)) S.foundByLook++; } S.looks += v.looks - looks0; return pick?.(o, rt); };
    open0(w); S.wins++;
    setTimeout(() => { if (lab.win && lab.win.onPick === w.onPick) { const b = lab.win.options.find(x => x.best); off = !!b && !lab.seen(b); } }, 60);
  };
}
