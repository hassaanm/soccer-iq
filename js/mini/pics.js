// The mini games' tile pictures (v88): one look for every tile, the game's own: a night stadium with its coloured
// boards, striped grass, chunky kids with big heads and dark outlines, the game's ball and its gold targets. Our side is
// always blue; the other side red; a keeper in orange with green gloves. Inline SVG (crisp at any size, no ids, so a
// picture can show many times on a page), no text. No page code here, so the tests can read it.
// Each picture is a whole <svg> (viewBox 120 x 84, the tile's shape): PIC.keeper, PIC.pens, and four ready for the games
// being built: PIC.rondoKeep, PIC.rondoWin, PIC.attack, PIC.puzzles. A game's entry in mini/games.js takes one as its `pic`.

const INK = '#24193a', GOLD = '#ffd23f', WHITE = '#fff';
const BLUE = { shirt: '#4f8dff', shorts: '#1f3f9e', socks: '#4f8dff' };
const RED = { shirt: '#ff5a5f', shorts: '#8e1f3a', socks: '#ff5a5f' };
const GK = { shirt: '#ff8a3d', shorts: '#2b2350', socks: '#ff8a3d', gloves: true };
const SKIN = ['#f6cfa8', '#d79f72', '#9a6442'], HAIR = ['#3b2a20', '#1f1a2e', '#b86a2c', '#e8c25a'];
const n = v => Math.round(v * 100) / 100;
const rad = d => d * Math.PI / 180;

// ---------- the scenery ----------
// The stands at night (a few crowd dots) above the coloured boards (the game's LOOK, PASS, DRIBBLE, SHOOT colours), then
// the grass in mown stripes down to the bottom. h: where the grass starts.
const CROWD = ['#5b4d8a', '#7a5fa8', '#c2486a', '#4f6fb8', '#d8a84a', '#e6e0f0'];
function stadium(h) {
  let s = `<rect width="120" height="84" fill="#3c8f46"/>`;
  for (let i = 0, y = h; y < 84; i++, y += 7 + i * 2.2) s += i % 2 ? '' : `<rect x="0" y="${n(y)}" width="120" height="${n(Math.min(84 - y, 7 + (i + 1) * 2.2))}" fill="#47a352"/>`;
  s += `<rect width="120" height="${h - 4}" fill="#2a1f4d"/>`;
  for (let r = 0; r < 3; r++) for (let x = 3 + r * 2; x < 120; x += 7) { const y = h - 7 - r * 4.4; if (y < 2) continue; s += `<circle cx="${x}" cy="${n(y)}" r="1.5" fill="${CROWD[(x * 7 + r * 3) % CROWD.length]}" opacity=".7"/>`; }
  ['#2f7bf6', '#23b45c', '#f5c400', '#8b3ce0'].forEach((c, i) => { s += `<rect x="${i * 30}" y="${h - 4}" width="30" height="4" fill="${c}"/>`; });
  return s + `<path d="M0 ${h}H120" stroke="${INK}" stroke-width=".8" opacity=".35"/>`;
}
// The goal from the front: white posts with a dark edge, the net behind. x, y: top left; w, h: its size.
function goal(x, y, w, h, t = 3) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" opacity=".2"/>`;
  const gx = Math.max(3, Math.round(w / 12)), gy = Math.max(2, Math.round(h / 7));
  for (let i = 1; i < gx; i++) s += `<path d="M${n(x + i * w / gx)} ${y}v${h}" stroke="#fff" stroke-width=".6" opacity=".55"/>`;
  for (let i = 1; i < gy; i++) s += `<path d="M${x} ${n(y + i * h / gy)}h${w}" stroke="#fff" stroke-width=".6" opacity=".55"/>`;
  const p = `M${x} ${y + h}V${y}H${x + w}V${y + h}`;
  return s + `<path d="${p}" fill="none" stroke="${INK}" stroke-width="${t + 2}" stroke-linejoin="round" stroke-linecap="round"/><path d="${p}" fill="none" stroke="#fff" stroke-width="${t}" stroke-linejoin="round" stroke-linecap="round"/>`;
}
// The game's ball: white, a dark middle patch and its seams.
export function ball(x, y, r) {
  const P = Array.from({ length: 5 }, (_, i) => [Math.sin(rad(i * 72)), -Math.cos(rad(i * 72))]);
  const pent = P.map(([a, b], i) => `${i ? 'L' : 'M'}${n(x + a * r * .4)} ${n(y + b * r * .4)}`).join('') + 'Z';
  const seams = P.map(([a, b]) => `M${n(x + a * r * .4)} ${n(y + b * r * .4)}L${n(x + a * r * .92)} ${n(y + b * r * .92)}`).join('');
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><path d="${pent}" fill="${INK}"/><path d="${seams}" stroke="${INK}" stroke-width="${n(r * .14)}" stroke-linecap="round"/>`
    + `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${INK}" stroke-width="${n(Math.max(1.2, r * .2))}"/>`;
}
// The game's gold target (as in the goal mouth): a dark disc, a gold ring, a white dot.
const target = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}" opacity=".5"/><circle cx="${x}" cy="${y}" r="${n(r * .72)}" fill="none" stroke="${INK}" stroke-width="${n(r * .44)}"/>`
  + `<circle cx="${x}" cy="${y}" r="${n(r * .72)}" fill="none" stroke="${GOLD}" stroke-width="${n(r * .27)}"/><circle cx="${x}" cy="${y}" r="${n(r * .2)}" fill="#fff"/>`;
const shadow = (x, y, rx) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${n(rx * .3)}" fill="${INK}" opacity=".25"/>`;
const dashes = (d, w = 2.4, c = GOLD) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 1.6}" stroke-dasharray="${n(w * 1.6)} ${n(w * 1.4)}" stroke-linecap="round" opacity=".35"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-dasharray="${n(w * 1.6)} ${n(w * 1.4)}" stroke-linecap="round"/>`;
const swish = (d, w = 1.8) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity=".85"/>`;

// ---------- a kid ----------
// A chunky kid, as the game's players: a big head, a shirt, shorts, socks and boots. In his own frame his hips are at
// 0,0, his head above (y -23), his feet below (y 12). Angles in degrees: 0 points down, 90 to the picture's right, 180 up.
// o: x, y (where his hips go), s (size), rot (his whole body turned), kit (BLUE, RED, GK), skin, hair, back (seen from
// behind: no face), look (-1..1: his eyes to a side), arms [left, right], legs [left, right], armLen, under/over (more
// drawing in his own frame, below or above him).
function limb(x, y, a, len, w, top, low, lowAt = .45) {
  const dx = Math.sin(rad(a)), dy = Math.cos(rad(a)), ex = x + dx * len, ey = y + dy * len, mx = x + dx * len * lowAt, my = y + dy * len * lowAt;
  return { s: `<path d="M${n(x)} ${n(y)}L${n(ex)} ${n(ey)}" stroke="${INK}" stroke-width="${w + 2.6}" stroke-linecap="round"/>`
    + `<path d="M${n(x)} ${n(y)}L${n(mx)} ${n(my)}" stroke="${top}" stroke-width="${w}" stroke-linecap="round"/><path d="M${n(mx)} ${n(my)}L${n(ex)} ${n(ey)}" stroke="${low}" stroke-width="${w}" stroke-linecap="round"/>`, ex, ey };
}
function kid(o) {
  const k = o.kit || BLUE, skin = o.skin || SKIN[0], hair = o.hair || HAIR[0], [aL, aR] = o.arms || [-28, 28], [lL, lR] = o.legs || [-6, 6], aLen = o.armLen || 11;
  let s = o.under || '';
  for (const [x, a] of [[-3.2, lL], [3.2, lR]]) { const L = limb(x, 1, a, 11, 4.4, skin, k.socks, .4); s += L.s + `<ellipse cx="${n(L.ex)}" cy="${n(L.ey + .6)}" rx="3.3" ry="2.4" fill="${INK}"/>`; }
  s += `<path d="M-7 -3H7L7.6 3.4Q7.6 4.6 6.3 4.6H1.2L0 2.6-1.2 4.6H-6.3Q-7.6 4.6-7.6 3.4Z" fill="${k.shorts}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
  s += `<path d="M-7.6 -14.2Q0 -16.4 7.6 -14.2L7.1 -1.6Q0 -.4 -7.1 -1.6Z" fill="${k.shirt}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += o.back ? `<path d="M-3.4 -14.6Q0 -13.2 3.4 -14.6" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` : `<path d="M-3 -15.2L0 -12.4 3 -15.2" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const [x, a] of [[-6.6, aL], [6.6, aR]]) {
    const A = limb(x, -12, a, aLen, 4, k.shirt, skin, .42); s += A.s;
    s += k.gloves ? `<circle cx="${n(A.ex)}" cy="${n(A.ey)}" r="3.7" fill="#8fe04f" stroke="${INK}" stroke-width="1.8"/><path d="M${n(A.ex - 1.6)} ${n(A.ey)}h3.2" stroke="${INK}" stroke-width=".9" opacity=".5"/>`
      : `<circle cx="${n(A.ex)}" cy="${n(A.ey)}" r="2.5" fill="${skin}" stroke="${INK}" stroke-width="1.6"/>`;
  }
  // the head: round, his hair on top (all of it from behind), eyes, cheeks and a smile from the front
  s += `<circle cx="0" cy="-23" r="8.8" fill="${skin}"/>`;
  s += o.back ? `<path d="M-8.8 -22A8.8 8.8 0 0 1 8.8 -22Q8.6 -17.6 6 -16.2Q0 -15 -6 -16.2Q-8.6 -17.6 -8.8 -22Z" fill="${hair}"/>`
    : `<path d="M-8.8 -22.4A8.8 8.8 0 0 1 8.8 -22.4Q6.6 -27 1.6 -26.2Q-1 -28 -4 -26Q-7.4 -26 -8.8 -22.4Z" fill="${hair}"/>`;
  if (!o.back) {
    const lx = (o.look || 0) * 1.6;
    s += `<ellipse cx="${n(-3.2 + lx)}" cy="-21.4" rx="1.45" ry="2" fill="${INK}"/><ellipse cx="${n(3.2 + lx)}" cy="-21.4" rx="1.45" ry="2" fill="${INK}"/>`
      + `<circle cx="${n(-2.7 + lx)}" cy="-22.2" r=".55" fill="#fff"/><circle cx="${n(3.7 + lx)}" cy="-22.2" r=".55" fill="#fff"/>`
      + `<circle cx="-5.6" cy="-18.4" r="1.6" fill="#ff8f8f" opacity=".55"/><circle cx="5.6" cy="-18.4" r="1.6" fill="#ff8f8f" opacity=".55"/>`
      + (o.mouth === 'o' ? `<ellipse cx="${n(lx * .5)}" cy="-17.6" rx="1.3" ry="1.5" fill="${INK}"/>` : `<path d="M${n(-2 + lx * .5)} -18.2Q${n(lx * .5)} -16.4 ${n(2 + lx * .5)} -18.2" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`);
  }
  s += `<circle cx="0" cy="-23" r="8.8" fill="none" stroke="${INK}" stroke-width="2.2"/>`;
  s += o.over || '';
  return `<g transform="translate(${o.x} ${o.y}) rotate(${o.rot || 0}) scale(${o.s || 1})">${s}</g>`;
}
// Where a point of a kid's own frame lands in the picture.
const at = (o, lx, ly) => { const c = Math.cos(rad(o.rot || 0)), s = Math.sin(rad(o.rot || 0)), k = o.s || 1; return [n(o.x + (lx * c - ly * s) * k), n(o.y + (lx * s + ly * c) * k)]; };
const svg = body => `<svg viewBox="0 0 120 84" aria-hidden="true">${body}</svg>`;

// ---------- the pictures ----------
// Goalkeeper: he flies across his goal, head first, arms out past his head, his green gloves at the ball by the post.
function keeperPic() {
  const o = { x: 47, y: 47, s: .98, rot: 62, kit: GK, skin: SKIN[0], hair: HAIR[0], arms: [194, 166], armLen: 19, legs: [-4, 12], look: 0, mouth: 'o' };
  const [bx, by] = at(o, 0, -40);
  o.under = swish('M-6 22q-4 6-2 12') + swish('M2 22q0 7 3 12') + swish('M8 18q4 5 9 7');
  return svg(stadium(26) + goal(10, 10, 100, 58, 3.4) + shadow(56, 73, 20) + kid(o) + ball(bx, by, 7.4)
    + swish(`M${bx + 9} ${by - 3}l4 -2`, 1.6) + swish(`M${bx + 9} ${by + 3}l4 1`, 1.6));
}
// Penalties: the ball on the spot, the keeper stepping to one side, the other side open with the gold target there.
function pensPic() {
  const k = { x: 45, y: 38, s: .6, rot: -17, kit: GK, skin: SKIN[1], hair: HAIR[1], arms: [-104, 146], legs: [-30, 2], look: -1 };
  return svg(stadium(18) + `<path d="M0 46H120M14 46L2 84M106 46L118 84" stroke="#fff" stroke-width="1.6" opacity=".8"/>` + goal(20, 8, 80, 38, 3)
    + shadow(46, 46, 11) + kid(k) + target(85, 19, 8.5)
    + dashes('M62 66Q74 40 83 25', 2.6)
    + `<ellipse cx="60" cy="77" rx="12" ry="3.6" fill="#fff" opacity=".85"/>` + shadow(61, 77, 9) + ball(60, 69, 9.5));
}
// Rondo, keep the ball: four friends round a box of cones, two defenders inside, the ball going from friend to friend.
const box = (pts) => { const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('') + 'Z';
  return `<path d="${d}" fill="#fff" opacity=".1"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1.4" stroke-dasharray="3 2.4" opacity=".9"/>`
    + pts.map(([x, y]) => `<path d="M${x - 2.6} ${y + 1.2}L${x} ${y - 4.6}L${x + 2.6} ${y + 1.2}Z" fill="#ff8a1f" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/><path d="M${x - 1.6} ${y - 1.4}h3.2" stroke="#fff" stroke-width="1"/>`).join(''); };
function rondoKeepPic() {
  const B = [[30, 30], [90, 30], [106, 74], [14, 74]];
  const friend = (x, y, s, extra = {}) => kid({ x, y, s, kit: BLUE, arms: [-26, 26], ...extra });
  return svg(stadium(14) + box(B)
    + shadow(60, 31, 6) + friend(60, 24, .44, { hair: HAIR[2], look: -1 })
    + shadow(22, 53, 7) + friend(22, 46, .5, { skin: SKIN[2], hair: HAIR[1], arms: [-40, 30], legs: [-10, 30], look: 1 })
    + shadow(99, 53, 7) + friend(99, 46, .5, { skin: SKIN[1], look: -1 })
    + shadow(48, 54, 6.5) + kid({ x: 48, y: 47, s: .5, kit: RED, skin: SKIN[1], hair: HAIR[1], arms: [-64, 44], legs: [-16, 6], rot: -8, look: -1 })
    + shadow(77, 62, 7) + kid({ x: 77, y: 55, s: .54, kit: RED, skin: SKIN[0], hair: HAIR[3], arms: [-40, 112], legs: [-4, 18], rot: 6, look: -1 })
    + dashes('M27 54Q34 30 56 27', 2)
    + ball(37, 34.5, 3.8) + swish('M30.5 42l2.6-3.4', 1.2) + swish('M28 39l2.6-2.8', 1.2)
    + shadow(62, 81, 8.5) + friend(62, 72, .62, { back: true, hair: HAIR[0], arms: [-30, 34] }));
}
// Rondo, win the ball: the same box, seen from behind him, the defender in the middle, stretching a leg to the ball as it
// goes between two of theirs.
function rondoWinPic() {
  const B = [[24, 28], [96, 28], [112, 70], [8, 70]];
  const foe = (x, y, s, extra = {}) => kid({ x, y, s, kit: RED, arms: [-26, 26], ...extra });
  const me = { x: 54, y: 58, s: .82, rot: 14, kit: BLUE, back: true, hair: HAIR[0], arms: [-70, 96], legs: [-8, 62] };
  const [fx, fy] = at(me, 3.2 + Math.sin(rad(62)) * 11, 1 + Math.cos(rad(62)) * 11);
  return svg(stadium(12) + box(B)
    + shadow(36, 30, 5.5) + foe(36, 24, .4, { hair: HAIR[1], skin: SKIN[2], look: 1 })
    + shadow(84, 30, 5.5) + foe(84, 24, .4, { hair: HAIR[2], look: -1 })
    + shadow(14, 52, 7) + foe(14, 45, .5, { hair: HAIR[3], arms: [-30, 40], legs: [-6, 30], look: 1 })
    + shadow(106, 52, 7) + foe(106, 45, .5, { skin: SKIN[1], arms: [-60, 30], look: -1 })
    + dashes('M19 52Q60 58 101 52', 2)
    + shadow(52, 70, 13) + kid(me)
    + ball(fx + 6.5, fy - 2, 4.6) + swish(`M${fx + 13} ${fy - 6}l3 -1.6`, 1.3) + swish(`M${fx + 13.5} ${fy - 1}l3.2 .6`, 1.3) + swish(`M${fx + 12} ${fy + 3.6}l2.6 1.8`, 1.3));
}
// Score attack: three of ours run at their goal with the ball, two of theirs to beat.
function attackPic() {
  const run = (x, y, s, extra = {}) => kid({ x, y, s, kit: BLUE, back: true, arms: [-48, 40], legs: [-24, 18], ...extra });
  return svg(stadium(18) + `<path d="M30 30L12 84M90 30L108 84M30 30H90" stroke="#fff" stroke-width="1.4" opacity=".75"/>` + goal(40, 9, 40, 21, 2.4) + target(73, 15.5, 4.6)
    + shadow(46, 47, 6.5) + kid({ x: 46, y: 40, s: .48, kit: RED, skin: SKIN[1], hair: HAIR[1], arms: [-60, 60], legs: [-14, 14], look: 1 })
    + shadow(76, 45, 6.5) + kid({ x: 76, y: 38, s: .46, kit: RED, hair: HAIR[2], arms: [-60, 60], legs: [-14, 14], look: -1 })
    + dashes('M24 58Q22 44 30 34', 2) + dashes('M98 56Q100 44 92 34', 2)
    + shadow(22, 76, 8) + run(22, 66, .58, { hair: HAIR[3], rot: -6 })
    + shadow(98, 74, 8) + run(98, 64, .56, { skin: SKIN[2], hair: HAIR[2], arms: [-40, 48], legs: [-18, 24], rot: 6 })
    + shadow(60, 82, 10) + shadow(73, 79, 4) + ball(73, 75.5, 4.6) + run(60, 72, .68, { skin: SKIN[1], hair: HAIR[0], legs: [-10, 30] }));
}
// Soccer puzzles: a small pitch from above, players as round counters, a dotted path for the ball past theirs to the goal.
function puzzlesPic() {
  const ours = (x, y) => `<circle cx="${x}" cy="${y + 1.2}" r="6.2" fill="${INK}" opacity=".3"/><circle cx="${x}" cy="${y}" r="6.2" fill="${BLUE.shirt}" stroke="${INK}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="#fff" stroke-width="1.2" opacity=".7"/>`;
  const theirs = (x, y) => `<circle cx="${x}" cy="${y + 1.2}" r="6.2" fill="${INK}" opacity=".3"/><circle cx="${x}" cy="${y}" r="6.2" fill="${RED.shirt}" stroke="${INK}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="#fff" stroke-width="1.2" opacity=".7"/>`;
  let s = `<rect width="120" height="84" fill="#2a1f4d"/><rect x="4" y="4" width="112" height="76" rx="7" fill="#3c8f46"/>`;
  for (let x = 12; x < 108; x += 16) s += `<rect x="${x}" y="4" width="8" height="76" fill="#47a352"/>`;
  s += `<rect x="4" y="4" width="112" height="76" rx="7" fill="none" stroke="${INK}" stroke-width="2"/>`;
  s += `<g fill="none" stroke="#fff" stroke-width="1.5" opacity=".9"><rect x="10" y="10" width="100" height="64" rx="1.5"/><path d="M60 10V74"/><circle cx="60" cy="42" r="9"/><path d="M110 26H96V58H110"/><path d="M10 30H18V54H10"/></g>`;
  s += `<rect x="110" y="34" width="5" height="16" fill="#fff" opacity=".35" stroke="#fff" stroke-width="1.5"/>`;
  s += dashes('M26 58L52 30', 2.2) + dashes('M58 28Q80 22 88 40Q92 46 106 42', 2.2);
  s += target(106, 42, 5.2);
  s += theirs(44, 50) + theirs(76, 40) + theirs(92, 58);
  s += ours(22, 62) + ours(56, 27) + ours(84, 22) + ball(28.5, 56, 3.6);
  return svg(s);
}

export const PIC = { keeper: keeperPic(), pens: pensPic(), rondoKeep: rondoKeepPic(), rondoWin: rondoWinPic(), attack: attackPic(), puzzles: puzzlesPic() };

// (v90) The mark for his best score, wherever it shows (the tiles, the bar in a run, the results card): a little gold
// cup in the pictures' style, dark outline, a shine. One small SVG, sized by its container (css: .cup).
export const CUP = `<svg class="cup" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 6.2H4.4a2.7 2.7 0 0 0 3.4 4.6M16.8 6.2h2.8a2.7 2.7 0 0 1-3.4 4.6" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
  + `<path d="M12 14.6v3" stroke="${INK}" stroke-width="2.6"/><path d="M6.6 3.6h10.8v4.6a5.4 5.4 0 0 1-10.8 0Z" fill="${GOLD}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
  + `<path d="M7.6 21.2h8.8v-1a2.2 2.2 0 0 0-2.2-2.2H9.8a2.2 2.2 0 0 0-2.2 2.2Z" fill="${GOLD}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`
  + `<path d="M9.4 6.2v2.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".85"/></svg>`;
