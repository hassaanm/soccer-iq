// Hair for the 'pro' players, cut like a footballer's: short sides that fade to the skin and a shaped top.
// Every style is one mesh (one draw call, plus a band or a tie in the kit's trim colour). It has two parts:
// - the scalp: a thin sheet that hugs the head from a squared hairline (a line-up) to the crown. Its colours do
//   the fade: skin low on the sides and back, then stubble, then full hair where the top starts.
// - pieces that give the top its shape and direction: locks (tapered strands), coils, pods (short twists) and a curtain (long hair).
// Places are in head units: the head is a ball of radius 1, the face looks along +x, his left is +y, z is up.
import * as THREE from 'three';

const TAU = Math.PI * 2, V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, sm = t => (t = clamp(t), t * t * (3 - 2 * t)), mix = (a, b, t) => a + (b - a) * t;

// The head narrows below the ears (to the jaw, and at the back to the neck); hair that sits there narrows too.
export const jawX = (x, z) => x * (1 - (x < 0 ? .2 : .06) * Math.max(0, -z) ** 2);
export const jawY = (y, z) => y * (1 - .24 * Math.max(0, -z) ** 2);
const bend = v => { const z = v.z / v.length(); v.x = jawX(v.x, z); v.y = jawY(v.y, z); return v; };

// The hairline: [angle round from the front, angle up from the level of the ears], straight lines between the
// points: straight across the forehead, a square corner at each temple, a short sideburn, round the ear, and
// straight across the nape.
const LINE = [[0, .63], [.6, .63], [.74, .66], [.84, .62], [.93, .44], [1.14, .26], [1.22, -.04], [1.33, -.06], [1.42, .17], [1.62, .28], [1.86, .2], [2.04, -.12], [2.4, -.46], [2.75, -.53], [Math.PI, -.53]];
function hairline(a) {
  let i = 1; while (i < LINE.length - 1 && a > LINE[i][0]) i++;
  const [a0, h0] = LINE[i - 1], [a1, h1] = LINE[i];
  return mix(h0, h1, clamp((a - a0) / (a1 - a0)));
}
const lumps = (q, f = 1) => (.5 + .5 * Math.sin(q.az * 13 * f + 2 * Math.sin(q.el * 9 * f + q.seed))) * (.5 + .5 * Math.sin(q.el * 15 * f + 1.7 * Math.sin(q.az * 8 * f)));
// How much hair (0 skin, about .4 stubble, 1 full hair) a fade leaves at height z on the sides and the back:
// `low` below `lo`, full above `hi`. The forehead keeps full hair up to the line-up.
const fade = (lo, hi, low = 0) => q => mix(1, mix(low, 1, sm((q.z - lo) / (hi - lo))), q.side);

// Each style: `cov` is how much hair a place `q` has (see `fade`); `top` is the depth of the hair on top (where
// `cov` is full); `shade` makes the top lighter or darker; `more(c)` adds pieces with the tools in `c`. `q` has:
// az (angle round, + is his left), a (the same without its sign), el (angle up), t (0 at the hairline to 1 at the
// crown), x y z (the place on the head), side (0 at the forehead, 1 from the temples back), seed.
const STYLES = {
  // Textured crop, mid fade: a choppy top pushed forward, with a short ragged fringe that stops at the hairline.
  crop: { cov: fade(.02, .46, .42), top: q => .1 + .045 * lumps(q, 1.3) + .03 * sm(q.x * 2), shade: q => .82 + .3 * lumps(q, 1.3),
    more: c => { for (let i = 0; i < 11; i++) { const az = (i / 10 - .5) * 1.75 + c.jit(.04); c.lock({ at: c.sph(az, hairline(Math.abs(az)) + .32), dir: V(1, .3 * Math.sin(az), 0), len: .34 + c.jit(.07), n: 3, k: 4, w: .2, h: .05, lift: s => .12 + .03 * Math.sin(Math.PI * s), taper: s => 1 - s ** 1.5 }); } } },
  // Quiff, mid fade: the whole front swept up and back in a wedge, highest at the front edge.
  quiff: { cov: fade(.12, .56, .25), top: .06,
    more: c => {
      for (const [row, n, up, len] of [[.0, 8, .34, 1], [.2, 7, .26, .9], [.42, 6, .17, .75]]) for (let i = 0; i < n; i++) {
        const az = (i / (n - 1) - .5) * 1.5 + c.jit(.04), lift = up * (1 - .2 * az * az);
        c.lock({ at: c.sph(az, hairline(Math.abs(az)) + row), dir: P => V(-1, -.3 * P.y, 0), len: len + c.jit(.08), n: 5, k: 4, w: .3, h: .08, lift: s => .05 + lift * sm(s / .22) * (1 - .7 * s) });
      }
    } },
  // Side-swept top over a low taper, with a hard part shaved in.
  part: { cov: q => fade(-.12, .36, .45)(q) * (1 - .7 * Math.exp(-(((q.y - q.part * .36) / .07) ** 2)) * sm((q.z - .45) / .1) * sm((q.x + .5) / .2)), top: .05,
    more: c => {
      const py = .36 * c.part;
      for (let i = 0; i < 8; i++) {
        const x = .8 - i * .17, on = y => V(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))), at = on(py - .07 * c.part);   // the two sides start a little off the part, so it shows
        c.lock({ at, dir: V(-.55, -c.part, .1), len: .95 + c.jit(.08), n: 5, k: 4, w: .3, h: .07, lift: s => .03 + .025 * Math.sin(Math.PI * Math.min(1, .25 + s)), taper: s => 1 - .7 * s ** 2 });
        if (i % 2 < 1 && i && i < 7) c.lock({ at: on(py + .07 * c.part), dir: V(-.4, c.part, -.3), len: .42, n: 3, k: 4, w: .26, h: .06, lift: s => .05 + .03 * Math.sin(Math.PI * s) });
      }
    } },
  // Slick-back with an undercut: long top combed straight back, sides cut short up to a hard line.
  slick: { cov: fade(.44, .5, .38), top: .08,
    more: c => {
      for (let i = 0; i < 9; i++) {
        const az = (i / 8 - .5) * 1.75 + c.jit(.03);
        c.lock({ at: c.sph(az, hairline(Math.abs(az)) + .1), dir: P => V(-1, -.15 * P.y, -1.5 * Math.max(0, -P.x - .1)), len: (i % 8 ? 1.4 : .9) + c.jit(.08), n: 7, k: 4, w: .3, h: .06, lift: s => .03 + .03 * (1 - s) + .045 * sm(s / .12) * (1 - s), taper: s => 1 - .55 * s ** 2 });
      }
    } },
  // Curly top over a high skin fade.
  curls: { cols: 52, rows: 12, cov: fade(.26, .6, 0), top: .09,
    more: c => c.scatter(250, q => q.t > .03 && q.cov > .85, (P, q) => c.coil(P, .11 + .04 * c.rand(), 1.06 + .04 * c.rand() + .03 * q.top)) },
  // A short, tight top over a high skin fade, with a sharp line-up.
  fade: { cov: fade(.28, .6, 0), top: q => .07 + .03 * lumps(q, 1.6) + .03 * sm((q.z - .55) / .2), shade: q => .82 + .3 * lumps(q, 1.6) },
  // Short twists on top that stand up and lean out a little, with round ends, over a fade.
  twists: { cols: 40, rows: 10, cov: fade(.26, .56, .1), top: .05,
    more: c => c.scatter(330, q => q.t > .06 && q.cov > .9, P => c.pod(P, P.clone().add(V(c.jit(.2), c.jit(.2), .6)), .24 + .07 * c.rand(), .088)) },
  // Cornrows: close braids from the hairline straight back over the head to the nape, thin dark lines between.
  // Each braid lies on a plane through two poles, one just under the front hairline and one at the nape, so the
  // braids meet the hairline thin and close, and are widest on the crown.
  rows: { cols: 56, cov: () => 1, top: .012, shade: () => .62,
    more: c => {
      const A = V(Math.cos(.45), 0, Math.sin(.45)), U = V(-Math.sin(.45), 0, Math.cos(.45));
      const pt = (th, f) => {   // then the back half is turned down, so the braids meet below the nape, past their ends
        const P = A.clone().multiplyScalar(Math.cos(f)).addScaledVector(U, Math.sin(f) * Math.cos(th)).add(V(0, Math.sin(f) * Math.sin(th), 0)), g = .32 * sm(.2 - P.x);
        return V(P.x * Math.cos(g) - P.z * Math.sin(g), P.y, P.x * Math.sin(g) + P.z * Math.cos(g));
      };
      const ok = P => Math.asin(P.z) > hairline(Math.abs(Math.atan2(P.y, P.x))) + .03;
      for (let i = 0; i < 13; i++) {
        const th = (i / 12 - .5) * 3; let best = [0, 0], run = null;   // the longest stretch of the plane above the hairline
        for (let f = 0; f <= Math.PI; f += .02) if (ok(pt(th, f))) { run ??= f; if (f - run > best[1] - best[0]) best = [run, f]; } else run = null;
        const [f0, f1] = best; if (f1 - f0 < 1.3) continue;   // no stubs at the temples
        c.lock({ path: s => pt(th, mix(f0, f1, s)), n: 14, k: 4, w: .115, h: .042, lift: s => .012 + .016 * sm(s / .08) * sm((1 - s) / .08), band: 22, taper: s => Math.sin(mix(f0, f1, s)) * (.8 + .2 * sm(s / .1)) });
      }
      // and one braid on each side from the temple, round above the ear, to the back
      const way = [[.92, .5], [1.3, .38], [1.7, .36], [2.1, .16], [2.45, -.18]];
      for (const sg of [-1, 1]) c.lock({ path: s => { const u = s * (way.length - 1), i = Math.min(way.length - 2, Math.floor(u)), [a0, e0] = way[i], [a1, e1] = way[i + 1]; return c.sph(sg * mix(a0, a1, u - i), mix(e0, e1, u - i)); },
        n: 10, k: 4, w: .1, h: .04, lift: s => .012 + .016 * sm(s / .1), band: 16, taper: s => (.45 + .55 * sm(s / .15)) * (1 - .3 * s) });
    } },
  // Big curly hair all over the top, over a low taper (as Salah wears it).
  bigcurls: { cols: 48, rows: 12, cov: fade(-.15, .25, .4), top: q => .04 + .16 * sm((q.z - .1) / .6) * sm(q.t / .2),
    more: c => c.scatter(190, q => q.t > .04 && q.z > .2 + .3 * (1 - q.side), (P, q) => c.coil(P, .13 + .05 * c.rand(), 1 + c.thick(q) + .02 * c.rand())) },
  // Long hair tied back in a bun, sides undercut.
  bun: { cov: fade(.4, .48, .35), top: .03,
    more: c => {
      const at = V(-.6, 0, .8).normalize();
      for (let i = 0; i < 11; i++) {
        const az = i < 9 ? (i / 8 - .5) * 1.75 : (i === 9 ? -1 : 1) * 1.05, P = c.sph(az, i < 9 ? hairline(Math.abs(az)) + .02 : .66);
        c.lock({ at: P, dir: Q => at.clone().sub(Q), len: Math.acos(P.dot(at)) * .95, n: 6, k: 4, w: .27, h: .06, lift: s => .06 + .03 * Math.sin(Math.PI * s), taper: s => 1 - .5 * s });
      }
      c.ball(at.clone().multiplyScalar(1.3), .3, .27);
      c.trim(new THREE.TorusGeometry(.17, .05, 5, 12), at.clone().multiplyScalar(1.07), at);
    } },
  // Long hair pulled back under a headband, falling behind the ears to the neck.
  band: { cols: 48, rows: 12, cov: () => 1, top: .05,
    more: c => {
      for (let i = 0; i < 11; i++) {
        const az = (i / 10 - .5) * 2.2;
        c.lock({ at: c.sph(az, Math.max(hairline(Math.abs(az)) + .1, .55)), dir: P => V(-1, .3 * P.y, -2 * Math.max(0, -P.x + .1)), len: 2.15 + c.jit(.12), n: 8, k: 5, w: .3, h: .13, lift: s => .08 + .05 * Math.sin(Math.PI * s) + .04 * s, taper: s => 1 - .7 * s ** 2 });
      }
      c.curtain(1.45, -.9);
      c.trim(new THREE.TorusGeometry(.98, .05, 6, 32), V(-.1, 0, .374), V(-.217, 0, .976), V(1, .98, 1));   // across the hairline in front, under the hair behind
    } },
  // Mohawk over a burst fade: a strip of spikes from the forehead to the back, skin round the ears.
  mohawk: { cov: q => Math.max(1 - sm((Math.abs(q.y) - .24) / .1), .55 * sm((-q.x - .6) / .25) * (1 - sm((q.z + .1) / .3)), fade(.6, .9, .12)(q)), top: q => .05 * sm((.28 - Math.abs(q.y)) / .1),
    more: c => { for (let i = 0; i < 12; i++) { const el = .7 + i * .16; c.lock({ at: c.sph(el < Math.PI / 2 ? 0 : Math.PI, el < Math.PI / 2 ? el : Math.PI - el), dir: V(-1, 0, -.2), len: .4, n: 3, k: 4, w: .2, h: .07, lift: s => .05 + (.26 - .012 * i) * s }); } } },
  // A buzz cut with a sharp line-up.
  buzz: { cov: q => (q.t < .03 ? .95 : .7) * fade(-.2, .4, .45)(q), top: .015, shade: q => .9 + .1 * lumps(q, 2) },
  // Shaved: only the shadow of the hair.
  shaved: { cov: () => .22, top: .004, shade: () => .5 },
};
export const HAIR_STYLES = Object.keys(STYLES);
// Players a child may know by sight get the hair they are known for; everyone else gets a style from his name.
const KNOWN = { YAMAL: 'curls', 'MBAPPÉ': 'buzz', HAALAND: 'bun', MESSI: 'part', RONALDO: 'quiff', 'VINI JR': 'twists', BELLINGHAM: 'fade', SALAH: 'bigcurls', 'DE BRUYNE': 'crop', 'MODRIĆ': 'band',
  GRIEZMANN: 'slick', SON: 'part', PEDRI: 'part', RAPHINHA: 'crop', LEWANDOWSKI: 'slick', KANE: 'part', PALMER: 'crop', MUSIALA: 'curls', SAKA: 'fade', PULISIC: 'quiff', 'DEMBÉLÉ': 'twists',
  'VAN DIJK': 'bun', FODEN: 'buzz', 'LEÃO': 'rows', 'ØDEGAARD': 'part', 'NICO WILLIAMS': 'rows', DAVIES: 'twists', 'GÜLER': 'slick', WIRTZ: 'part', 'SUÁREZ': 'crop', HAKIMI: 'fade', 'MANÉ': 'buzz',
  LUKAKU: 'shaved', DOKU: 'twists', THURAM: 'twists', 'TCHOUAMÉNI': 'buzz', 'MAC ALLISTER': 'curls', 'HØJLUND': 'slick', GAKPO: 'fade', OLISE: 'fade' };
const DARK = ['fade', 'twists', 'curls', 'buzz', 'rows', 'fade', 'bigcurls', 'mohawk', 'crop', 'twists', 'shaved', 'bigcurls'];
const FAIR = ['crop', 'part', 'quiff', 'slick', 'crop', 'curls', 'bun', 'part', 'fade', 'band', 'mohawk', 'quiff', 'buzz'];
function nameHash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }

const ICO = (() => { // a ball of 20 triangles, for coils
  const t = (1 + Math.sqrt(5)) / 2, v = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  return { v: v.map(k => k / Math.hypot(1, t)), f: [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1] };
})();

// Adds hair to `head` (a group whose origin is the head's centre). `R` is the head's radius; `mat(colour,
// roughness, options)` makes a material and `add(parent, shape, material)` a mesh, as in pro/rig.js.
export function addHair(head, p, kit, R, mat, add) {
  const hairC = new THREE.Color(p.hair), skinC = new THREE.Color(p.skin), hash = nameHash(p.name || '');
  const list = skinC.r * .3 + skinC.g * .6 + skinC.b * .1 < .45 ? DARK : FAIR;
  const S = STYLES[STYLES[p.hairStyle] ? p.hairStyle : KNOWN[p.name] || list[hash % list.length]];
  const pos = [], col = [], idx = [], c = new THREE.Color(), seed = hash % 97 / 15, part = hash & 8 ? 1 : -1;
  let rs = hash || 1; const rand = () => ((rs = Math.imul(rs ^ rs >>> 15, 2246822507) + 1) >>> 0) / 4294967296;
  const vert = (v, k) => { bend(v); pos.push(v.x * R, v.y * R, v.z * R); c.copy(hairC).multiplyScalar(k); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  const top = typeof S.top === 'function' ? S.top : () => S.top;
  const where = (az, el) => { // the place q on the head at this angle round and up
    const a = Math.abs(az), h = hairline(a), q = { az, a, el, seed, part, x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) };
    q.t = clamp((el - h) / (Math.PI / 2 - h)); q.side = sm((a - .45) / .3); q.top = sm((el - .4) / .65); q.cov = clamp(S.cov(q));
    return q;
  };
  const thick = q => .012 + .016 * q.cov + top(q) * sm((q.cov - .75) / .25) * (.3 + .7 * sm(q.t / .12));   // thinner right at the hairline: a clean edge, no lip

  // The scalp: rings from the hairline up to the crown (the last ring is one point).
  const cols = S.cols || 64, rows = S.rows || 13;
  for (let i = 0; i <= rows; i++) for (let j = 0; j < (i < rows ? cols : 1); j++) {
    const az = -Math.PI + j / cols * TAU, h = hairline(Math.abs(az)), q = where(az, i < rows ? mix(h, Math.PI / 2, (i / rows) ** 1.1) : Math.PI / 2);
    const k = q.cov * mix(1, .4 + .6 * sm(q.t / .15), q.side), lines = .93 + .07 * Math.sin(q.az * 26 + seed) + .05 * Math.sin(q.az * 61 + q.el * 3);   // strands run from the crown down
    pos.push(...bend(V(q.x, q.y, q.z).multiplyScalar(1 + thick(q))).multiplyScalar(R).toArray());
    c.copy(hairC).multiplyScalar((S.shade ? S.shade(q) : 1) * lines * (S.more ? .78 : 1));
    if (k < .55) c.lerp(skinC, 1 - .55 * sm(k / .4)); else c.lerp(skinC, .45 * (1 - sm((k - .55) / .3)));   // skin, stubble, then hair
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + (j + 1) % cols;
    if (i < rows - 1) idx.push(a, b, b + cols, a, b + cols, a + cols); else idx.push(a, b, rows * cols);
  }

  // The tools for pieces on top.
  const T = V(0, 0, 0), N = V(0, 0, 0), B = V(0, 0, 0), C = V(0, 0, 0);
  const tools = {
    part, rand, jit: k => (rand() * 2 - 1) * k, thick,
    sph: (az, el) => V(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)),
    // `n` spots spread evenly over the head; `keep(q)` picks some, and `f(spot, q)` is called for each.
    scatter(n, keep, f) {
      for (let i = 0; i < n; i++) {
        const z = 1 - (i + .5) / n * 1.7, r = Math.sqrt(1 - z * z), az = ((i * 2.39996 + seed + rand() * .3) % TAU + TAU) % TAU - Math.PI, q = where(az, Math.asin(z));
        if (keep(q)) f(V(r * Math.cos(az), r * Math.sin(az), z), q);
      }
    },
    // A lock: a strand that starts at the spot `at`, runs along the head in direction `dir` (a vector, or a
    // function of the place) for `len`, `lift(s)` above the head (s is 0 at the root, 1 at the tip). It is `w`
    // wide and `h` deep, with `k` sides and `n` steps, and narrows to the tip (`taper`). `band` paints stripes
    // across it (braids, twists); `hang` lets it fall straight down below the ears.
    // `path(s)` (a place on the head) sets the way instead of `at`, `dir` and `len`.
    lock({ at, dir, len, n = 4, k = 4, w, h, lift, taper = s => 1 - s ** 1.6, band = 0, hang = false, path }) {
      const P = (path ? path(0) : at).clone().normalize(), first = pos.length / 3, tint = .9 + .2 * rand();
      let fall = null;
      for (let i = 0; i <= n; i++) {
        const s = i / n, up = typeof lift === 'function' ? lift(s) : lift, tw = taper(s);
        if (fall) { N.set(fall.x, fall.y, 0).normalize(); T.set(0, 0, -1); C.copy(fall); fall.z -= len / n; }
        else {
          if (path) P.copy(path(s)).normalize();
          N.copy(P); T.copy(path ? path(Math.min(1, s + .01)).sub(path(Math.max(0, s - .01))) : typeof dir === 'function' ? dir(P, s) : dir); T.addScaledVector(N, -T.dot(N)).normalize();
          C.copy(P).multiplyScalar(1 + up);
          if (hang && P.z < .12) { fall = C.clone(); fall.z -= len / n; }
        }
        B.crossVectors(N, T).normalize();
        const shade = tint * mix(.8, 1.06, sm(s / .7)) * (band ? .8 + .3 * Math.abs(Math.sin(s * band * Math.PI)) : 1);
        for (let j = 0; j < k; j++) {
          const ang = j / k * TAU + (k === 3 ? Math.PI / 2 : 0), cs = Math.cos(ang), sn = Math.sin(ang);
          vert(C.clone().addScaledVector(B, cs * w * tw).addScaledVector(N, sn * h * mix(1, tw, .6)), shade * (sn < -.2 ? .78 : 1));
        }
        if (!fall && !path) { // the next step, kept above the hairline in front, so no lock hangs over the forehead
          P.addScaledVector(T, len / n).normalize();
          const az = Math.atan2(P.y, P.x), a = Math.abs(az), low = hairline(a) + .05;
          if (a < 1.2 && Math.asin(P.z) < low) P.set(Math.cos(low) * Math.cos(az), Math.cos(low) * Math.sin(az), Math.sin(low));
        }
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
        const a = first + i * k + j, b = first + i * k + (j + 1) % k;
        idx.push(a, b, b + k, a, b + k, a + k);
      }
    },
    // A coil: a small rough ball of hair at the spot `at`, `r` across, `d` from the middle of the head.
    coil(at, r, d) {
      const first = pos.length / 3, C0 = at.clone().normalize().multiplyScalar(d), k = .85 + .3 * rand();
      const st = V(rand() - .5, rand() - .5, rand() - .5).normalize();   // stretched along a random line: a clump, not a ball
      for (let i = 0; i < 12; i++) { const n = V(ICO.v[i * 3], ICO.v[i * 3 + 1], ICO.v[i * 3 + 2]); vert(C0.clone().addScaledVector(n, r * (.85 + .3 * rand())).addScaledVector(st, n.dot(st) * r * .5), k * (.9 + .12 * n.dot(at))); }
      for (const f of ICO.f) idx.push(first + f);
    },
    // A pod: a short blunt-ended twist that stands from the spot `at` along `dir`, `len` long and `r` thick.
    pod(at, dir, len, r) {
      const first = pos.length / 3, D = dir.clone().normalize(), C0 = at.clone().normalize().addScaledVector(D, len * .45), k = .85 + .3 * rand();
      for (let i = 0; i < 12; i++) { const n = V(ICO.v[i * 3], ICO.v[i * 3 + 1], ICO.v[i * 3 + 2]), u = n.dot(D); vert(C0.clone().addScaledVector(D, Math.sign(u) * Math.min(Math.abs(u), .7) * len * .6).addScaledVector(n.addScaledVector(D, -u), r), k * (.8 + .25 * u)); }   // blunt ends
      for (const f of ICO.f) idx.push(first + f);
    },
    // A curtain: long hair that falls round the back of the head from behind the ears (`a0`, angle round from the
    // front) to about `zb`, a thick sheet with a soft, uneven bottom edge, shorter towards the ears.
    curtain(a0, zb) {
      const first = pos.length / 3, J = 22, M = 7;
      for (let j = 0; j <= J; j++) {
        const u = j / J, az = mix(a0, TAU - a0, u), end = sm(Math.min(u, 1 - u) / .18), lines = .9 + .1 * Math.sin(az * 23) + .06 * Math.sin(az * 41 + 1);
        const z0 = mix(.25, .62, end), z1 = mix(-.35, zb + .05 * Math.sin(az * 9 + 1) + .035 * Math.sin(az * 17), end);
        for (let side = 0; side < 2; side++) for (let m = 0; m < M; m++) {   // down the outside, then up the inside
          const z = mix(z0, z1, (side ? M - 1 - m : m) / (M - 1)), rh = (z > 0 ? Math.sqrt(1 - z * z) : 1 - .1 * (-z) ** 1.5) + (side ? .01 : mix(.09, .13, sm((z0 - z) / .3)) * (.3 + .7 * end));
          vert(V(rh * Math.cos(az), rh * Math.sin(az), z), side ? .5 : lines * mix(1.1, 1.3, sm((z0 - z) / .4)));
        }
      }
      for (let j = 0; j < J; j++) for (let m = 0; m < 2 * M; m++) { const a = first + j * 2 * M + m, b = first + j * 2 * M + (m + 1) % (2 * M); idx.push(a, b, b + 2 * M, a, b + 2 * M, a + 2 * M); }
    },
    // A ball of hair (a bun), with swirls.
    ball(at, r, rz) {
      const first = pos.length / 3, sg = 10, rg = 8;
      for (let i = 0; i <= rg; i++) for (let j = 0; j <= sg; j++) {
        const u = i / rg * Math.PI, w = j / sg * TAU;
        pos.push(...V(Math.sin(u) * Math.cos(w) * r, Math.sin(u) * Math.sin(w) * r, Math.cos(u) * rz).add(at).multiplyScalar(R).toArray());
        c.copy(hairC).multiplyScalar(.8 + .25 * Math.sin(w * 3 + u * 4) * Math.sin(u)); col.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < rg; i++) for (let j = 0; j < sg; j++) { const a = first + i * (sg + 1) + j, b = a + sg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    },
    // Something in the kit's trim colour (a band, a tie): `shape` at `at`, its z turned to `up`, then sized.
    trim(shape, at, up, size) {
      if (!unit) { unit = new THREE.Group(); unit.scale.setScalar(R); head.add(unit); }   // trim pieces are made in head units
      const m = add(unit, shape, mat(kit.trim, .8)); m.position.copy(at); m.quaternion.setFromUnitVectors(V(0, 0, 1), up); if (size) m.scale.copy(size);
    },
  };
  let unit = null;
  S.more?.(tools);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  add(head, geo, mat('#ffffff', .7, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
}
