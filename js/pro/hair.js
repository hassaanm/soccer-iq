// Hair for the 'pro' players. Every style is one sheet that starts at a hairline (high on the forehead, down in
// front of the ear as a sideburn, over the ear, and down to the nape) and rises to the crown. A style says how
// thick the hair is at each place, where the skin shows through (a fade), and what sits on top (a bun, a band,
// spikes). Places are in head units: the head is a ball of radius 1, the face looks along +x, his left is +y.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v, sm = t => (t = clamp(t), t * t * (3 - 2 * t)), mix = (a, b, t) => a + (b - a) * t;
const bell = (v, w) => Math.exp(-((v / w) ** 2));

// The head narrows below the ears (to the jaw, and at the back to the neck); hair that hangs there narrows too.
export const jawX = (x, z) => x * (1 - (x < 0 ? .2 : .06) * Math.max(0, -z) ** 2);
export const jawY = (y, z) => y * (1 - .24 * Math.max(0, -z) ** 2);

// The hairline: [angle round from the front, angle up from the level of the ears], smoothed between the points.
const LINE = [[0, .57], [.7, .61], [1, .52], [1.2, .2], [1.32, .12], [1.5, .24], [1.78, .2], [2.05, -.25], [2.45, -.5], [Math.PI, -.55]];
function hairline(a) {
  let i = 1; while (i < LINE.length - 1 && a > LINE[i][0]) i++;
  const [a0, h0] = LINE[i - 1], [a1, h1] = LINE[i];
  return mix(h0, h1, sm((a - a0) / (a1 - a0)));
}
const curl = q => .5 + .5 * Math.sin(q.az * 9 + 1.6 * Math.sin(q.el * 8 + q.seed)) * Math.sin(q.el * 10 + 1.2 * Math.sin(q.az * 7));   // soft lumps
const knot = q => (.5 + .5 * Math.sin(q.az * 15 + 2.2 * Math.sin(q.el * 9 + q.seed))) * (.5 + .5 * Math.sin(q.el * 17 + q.seed));        // small knots
const fade = (k = .75, up = .5) => q => k * q.side * (1 - sm(q.t / up));   // skin shows at the sides and back, near the hairline

// Each style: `thick` is the hair's depth at a place `q`; `skin` is how much skin shows through (0 to 1);
// `shade` makes it lighter or darker; `line` moves the hairline; `hang` lets it fall straight below the ears;
// `more` adds pieces. `q` has: az (angle round, + is his left), a (the same without its sign), el (angle up),
// t (0 at the hairline to 1 at the crown), r (0 at the hairline, soon 1), x y z (the place on the head),
// top (1 on top, 0 at the sides), side (0 at the front, 1 at the sides and back), part (+1 or -1), seed.
const STYLES = {
  crop: { thick: q => .03 + q.r * (.04 + .1 * q.top + .06 * q.top * sm(q.x * 1.5)), skin: fade() },
  buzz: { thick: q => .028 + .014 * q.r, skin: q => .32 + .45 * q.side * (1 - sm(q.t / .45)) },
  bald: { thick: () => .02, skin: q => 1 - .2 * sm(q.t / .3) },   // only the shadow of shaved hair
  quiff: { thick: q => .03 + q.r * (.05 + .07 * q.top) + .36 * bell(q.az, .75) * sm(q.t / .22) * (1 - .8 * sm((q.t - .3) / .6)), skin: fade(.65) },
  curls: { cols: 64, rows: 20, thick: q => .03 + q.r * (.03 + q.top * (.19 + .09 * curl(q)) + .1 * q.top * sm(q.x * 1.5)), skin: fade(.8, .55), shade: q => .82 + .36 * curl(q) * q.top },
  afro: { cols: 64, rows: 20, thick: q => .03 + sm(q.t / .28) * (.4 + .06 * curl(q)), shade: q => .85 + .3 * curl(q) },
  twists: { cols: 80, rows: 24, thick: q => .04 + q.r * (.05 + .13 * knot(q) * (.4 + .6 * q.top)), skin: fade(.5, .35), shade: q => .75 + .5 * knot(q) },
  braids: { cols: 88, rows: 16, thick: q => .03 + q.r * .07 * (.5 + .5 * Math.cos(q.y * 36)), skin: q => .4 * q.r * (.5 - .5 * Math.cos(q.y * 36)), shade: q => .8 + .3 * (.5 + .5 * Math.cos(q.y * 36)) },
  mohawk: { thick: q => .026 + .36 * bell(q.y, .19) * sm(q.t / .14) * sm((q.el + .3) / .5), skin: q => .62 * (1 - bell(q.y, .24)) },
  part: { thick: q => .04 + q.r * (.07 + .09 * q.top * sm(.5 + q.part * q.y * 2.4)) - .07 * q.top * q.r * bell(q.y + q.part * .34, .07) + .13 * bell(q.az - q.part * .35, .65) * sm(q.t / .22) * (1 - sm((q.t - .25) / .5)), skin: fade(.45, .35) },
  mop: { line: (h, q) => q.a < 1.05 ? h - .3 * (1 - sm((q.a - .55) / .5)) + .035 * Math.sin(q.az * 13 + q.seed) : h, thick: q => .05 + q.r * (.09 + .07 * q.top) },
  long: { hang: true, line: (h, q) => q.a > 1.12 ? mix(h, -.85 + .04 * Math.sin(q.az * 11 + q.seed), sm((q.a - 1.12) / .3)) : h, thick: q => .07 + q.r * (.13 + .02 * q.top) - .04 * q.top * bell(q.y, .06) * sm(q.x * 2) },
  band: { hang: true, line: (h, q) => q.a > 1.12 ? mix(h, -.5, sm((q.a - 1.12) / .3)) : h, thick: q => .07 + q.r * (.13 + .03 * q.top),
    more: (h, k) => { const m = h.add(new THREE.TorusGeometry(1.1, .06, 8, 36).rotateY(-.31), k.trim); m.position.set(-.13, 0, .23); m.scale.set(1.02, 1.07, 1); } },   // from the top of the forehead to the back of the head
  bun: { thick: q => .035 + q.r * .055, skin: fade(.35, .3),
    more: (h, k) => {
      const d = new THREE.Vector3(-Math.cos(.95), 0, Math.sin(.95)), Z = new THREE.Vector3(0, 0, 1);
      h.add(new THREE.SphereGeometry(.33, 14, 10), k.hair).position.copy(d).multiplyScalar(1.3);
      const b = h.add(new THREE.TorusGeometry(.17, .06, 6, 14), k.trim); b.position.copy(d).multiplyScalar(1.07); b.quaternion.setFromUnitVectors(Z, d);
    } },
  spiky: { thick: q => .04 + q.r * (.05 + .08 * q.top), skin: fade(.6),
    more: (h, k) => { // short tufts all over the top, each leaning a little forward
      const cone = new THREE.ConeGeometry(.27, .52, 6), Y = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
      for (let i = 0; i < 21; i++) {
        const z = 1 - .47 * (i + .5) / 21, r = Math.sqrt(1 - z * z), az = i * 2.4;
        const m = h.add(cone, k.hair); m.position.set(Math.cos(az) * r, Math.sin(az) * r, z).multiplyScalar(1.19);
        d.copy(m.position); d.x += .45; m.quaternion.setFromUnitVectors(Y, d.normalize());
      }
    } },
};
export const HAIR_STYLES = Object.keys(STYLES);
// Players a child may know by sight get the hair they are known for; everyone else gets a style from his name.
const KNOWN = { YAMAL: 'curls', 'MBAPPÉ': 'buzz', HAALAND: 'bun', MESSI: 'part', RONALDO: 'quiff', 'VINI JR': 'twists', BELLINGHAM: 'crop', SALAH: 'afro', 'DE BRUYNE': 'part', 'MODRIĆ': 'band',
  GRIEZMANN: 'quiff', SON: 'part', PEDRI: 'mop', RAPHINHA: 'crop', LEWANDOWSKI: 'quiff', KANE: 'part', PALMER: 'mop', MUSIALA: 'curls', SAKA: 'crop', PULISIC: 'mop', 'DEMBÉLÉ': 'twists',
  'VAN DIJK': 'bun', FODEN: 'buzz', 'LEÃO': 'braids', 'ØDEGAARD': 'part', 'NICO WILLIAMS': 'braids', DAVIES: 'afro', 'GÜLER': 'mop', WIRTZ: 'mop', 'SUÁREZ': 'crop', HAKIMI: 'crop', 'MANÉ': 'buzz' };
const DARK = ['crop', 'buzz', 'twists', 'curls', 'afro', 'mohawk', 'braids', 'crop', 'bun', 'bald', 'twists'];
const FAIR = ['crop', 'part', 'quiff', 'mop', 'curls', 'long', 'band', 'spiky', 'buzz', 'part', 'quiff', 'crop', 'mohawk'];
function nameHash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }

// Adds hair to `head` (a group whose origin is the head's centre). `R` is the head's radius; `mat(colour,
// roughness, options)` makes a material and `add(parent, shape, material)` a mesh, as in pro/rig.js.
export function addHair(head, p, kit, R, mat, add) {
  const hairC = new THREE.Color(p.hair), skinC = new THREE.Color(p.skin), hash = nameHash(p.name || '');
  const list = skinC.r * .3 + skinC.g * .6 + skinC.b * .1 < .45 ? DARK : FAIR;
  const S = STYLES[STYLES[p.hairStyle] ? p.hairStyle : KNOWN[p.name] || list[hash % list.length]];
  const cols = S.cols || 52, rows = S.rows || 16, pos = [], col = [], idx = [], c = new THREE.Color();
  const q = { seed: hash % 97 / 15, part: hash & 8 ? 1 : -1 };
  for (let i = 0; i <= rows; i++) for (let j = 0; j < (i < rows ? cols : 1); j++) { // rings from the hairline up; the last is one point, the crown
    q.az = -Math.PI + j / cols * TAU; q.a = Math.abs(q.az); q.t = (i / rows) ** 1.25; q.r = sm(q.t / .18);
    let h = hairline(q.a); if (S.line) h = S.line(h, q);
    q.el = mix(h, Math.PI / 2, q.t); q.x = Math.cos(q.el) * Math.cos(q.az); q.y = Math.cos(q.el) * Math.sin(q.az); q.z = Math.sin(q.el);
    q.top = sm((q.el - .4) / .65); q.side = sm((q.a - .85) / .5);
    const d = 1 + Math.max(.02, S.thick(q));
    let x = jawX(q.x, q.z) * d, y = jawY(q.y, q.z) * d, z = q.z * d;
    if (S.hang && q.z < .15) { // below the tops of the ears it falls straight down instead of curving in under the head
      const k = sm((.15 - q.z) / .5) * q.r, w = (d + .03) / Math.hypot(q.x, q.y);
      x = mix(x, q.x * w * (q.x < 0 ? .93 : 1), k); y = mix(y, q.y * w * .96, k); z = mix(z, q.z * 1.25, k);
    }
    pos.push(x * R, y * R, z * R);
    const lines = .93 + .07 * Math.sin(q.az * 26 + q.seed) + .05 * Math.sin(q.az * 61 + q.el * 3);   // strands run from the crown down
    c.copy(hairC).multiplyScalar((S.shade ? S.shade(q) : 1) * lines).lerp(skinC, clamp(S.skin ? S.skin(q) : 0));
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * cols + j, b = i * cols + (j + 1) % cols;
    if (i < rows - 1) idx.push(a, b, b + cols, a, b + cols, a + cols); else idx.push(a, b, rows * cols);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  add(head, geo, mat('#ffffff', .6, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  if (S.more) { // the extra pieces are made in head units, inside a group that brings them to size
    const unit = new THREE.Group(); unit.scale.setScalar(R); head.add(unit);
    S.more({ add: (g, m) => add(unit, g, m) }, { hair: mat(p.hair, .6), trim: mat(kit.trim, .8) });
  }
}
