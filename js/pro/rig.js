// Player bodies: a young athlete about six heads tall, with a separate shirt, shorts,
// socks and boots, knees and elbows that bend, and a soft light along his edges (rim light) so he stands out
// from the grass. The body faces +x, z is up, and his left side is +y.
import * as THREE from 'three';
import { canvasTex, blobTex } from '../tex.js';
import { addHair, headAt } from './hair.js';

// The rim light's colour and strength, shared by every player; the world sets them for day or night.
export const RIM = { color: { value: new THREE.Color('#ffffff') }, k: { value: .5 }, detail: { value: 1 } }; // detail 0: no cloth bumps (slow devices)
// Cloth is told apart by its roughness (.8 to .95: shirt, shorts, socks; .9 and up: socks). It gets soft folds and a
// fine knit, socks get ribs, all as tiny bumps worked out from where the pixel is on his body (so they move with
// him), each fading out before it gets smaller than a pixel. Cloth shines less than skin or boots. Everything is a
// little darker near the grass (less sky reaches it), which sets him on the ground.
const CLOTH = `
  float clothK = step(0.79, roughnessFactor) * step(roughnessFactor, 0.95), sockK = step(0.885, roughnessFactor) * clothK;
  if (uDetail > 0.0) {
    vec3 p = vRigP; float fw = length(fwidth(p));
    float fold = (sin(p.z * 62.0 + sin(p.y * 29.0 + p.x * 15.0) * 2.2) + 0.6 * sin(p.z * 41.0 - p.y * 36.0 + p.x * 19.0) + 0.4 * sin(p.y * 53.0 + p.z * 23.0 + 1.7 * sin(p.x * 31.0))) * 0.0028 * (0.35 + 0.65 * smoothstep(1.3, 0.92, p.z)) * smoothstep(0.03, 0.008, fw) * (1.0 - sockK);
    float knit = sin(p.z * 1300.0) * sin((p.x + p.y) * 1300.0) * 0.00016 * smoothstep(0.0028, 0.0011, fw);
    float rib = sin(atan(p.y - sign(p.y) * 0.075, p.x) * 34.0) * 0.00028 * sockK * smoothstep(0.004, 0.0016, fw);
    float bh = (fold + knit + rib) * clothK;
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition), r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    vec3 g = sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2) / max(abs(det), 1e-12);
    float gl = length(g); g *= gl > 0.6 ? 0.6 / gl : 1.0;   // tilt the normal at most a little; never a zero normal
    normal = normalize(normal - g);
  }`;
const SHADE = `
  float aoH = mix(0.6, 1.0, smoothstep(0.04, 1.05, vRigZ));
  reflectedLight.indirectDiffuse *= aoH; reflectedLight.directDiffuse *= mix(1.0, aoH, 0.3);
  reflectedLight.directSpecular *= 1.0 - 0.6 * clothK; reflectedLight.indirectSpecular *= 1.0 - 0.45 * clothK;`;
function withRim(m, more, key = '') {
  m.onBeforeCompile = sh => {
    more?.(sh);
    sh.uniforms.uRim = RIM.color; sh.uniforms.uRimK = RIM.k; sh.uniforms.uDetail = RIM.detail;
    sh.vertexShader = 'varying vec3 vRigP;\nvarying float vRigZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRigP = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRigZ = (modelMatrix * vec4(transformed, 1.0)).z;');
    sh.fragmentShader = 'uniform vec3 uRim;\nuniform float uRimK, uDetail;\nvarying vec3 vRigP;\nvarying float vRigZ;\n' + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + CLOTH)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + SHADE)
      .replace('#include <opaque_fragment>', `
      float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
      outgoingLight += uRim * uRimK * rimF * (0.3 + 0.7 * diffuseColor.rgb);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'rim' + key;
  return m;
}

// Heights (meters) of the joints. He is about 1.65 m and six heads tall: legs half his height, hips narrower
// than his shoulders.
export const HIP = .82, THIGH = .38, SHIN = .38, HALF = .075;   // HALF: each hip joint's distance from the middle
const WAIST = .13;                                                // the waist above the hip joints; the chest bends here
const SHOULDER = .28, SHOULDER_Y = .148, HEAD = .55, R = .127;  // above the waist; the shoulder joint sits just inside the shirt
const Z0 = -.08, Z1 = .385; // the shirt runs from below the waist to the collar; its picture maps to this range
// Rings up the shirt and the shorts: [height, half width, depth to the front, depth to the back, roundness (2 is
// an oval, higher is boxier)]. The shirt hangs loose over the shorts, narrows a little at the waist, is widest at
// the chest, then slopes down from the neck to round shoulders.
const SHIRT = [[-.068, .13, .096, .09, 2.3], [Z0, .152, .126, .11, 2.3], [-.03, .144, .112, .1, 2.3], [.04, .13, .096, .084, 2.4], [.12, .138, .105, .088],
  [.2, .148, .112, .096], [.26, .152, .106, .1], [.295, .153, .098, .097], [.318, .148, .091, .09], [.335, .128, .083, .082],
  [.35, .1, .073, .072, 2.3], [.362, .08, .065, .063, 2.1], [.375, .064, .058, .057, 2], [Z1, .059, .055, .054, 2]];
const SHORTS = [[-.084, .004, .004, .004], [-.074, .09, .06, .06], [-.04, .136, .084, .088], [0, .146, .09, .096], [.06, .136, .084, .086], [.1, .118, .074, .074], [.14, .098, .062, .064]];

const TAU = Math.PI * 2;
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);
// An arm or leg part hanging down from its joint: radius r0 at the joint, r1 at the far end, both ends rounded.
const limb = (len, r0, r1, bulge = 0) => lathe([[0, -len - r1 * .9], [r1 * .72, -len - r1 * .62], [r1, -len], [(r0 + r1) / 2 + bulge, -len * .45], [r0, 0], [r0 * .72, r0 * .62], [0, r0 * .9]], 14);
const ball = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h).rotateX(Math.PI / 2);
// A body part built from rings: each ring is a rounded box shape (roundness `n` = 2 is an oval, higher is boxier),
// wider than it is deep, and deeper at the chest than at the back. Its picture wraps once around, starting at the
// right side seam, and runs from the first ring's height to the last.
function loft(rings, seg = 28, n = 2.5) {
  const pos = [], uv = [], idx = [], lo = Math.min(...rings.map(r => r[0])), hi = rings[rings.length - 1][0];
  for (const [z, w, f, b, rn = n] of rings) for (let j = 0, e = 2 / rn; j <= seg; j++) {
    const a = j / seg * TAU, s = Math.sin(a), c = Math.cos(a);
    pos.push((s > 0 ? f : b) * Math.sign(s) * Math.abs(s) ** e, -w * Math.sign(c) * Math.abs(c) ** e, z); uv.push(j / seg, (z - lo) / (hi - lo));
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, c = a + seg + 1; idx.push(a, a + 1, c + 1, a, c + 1, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const nm = geo.attributes.normal; // the seam's two columns share one smooth normal
  for (let i = 0; i < rings.length; i++) {
    const a = i * (seg + 1), b = a + seg, x = nm.getX(a) + nm.getX(b), y = nm.getY(a) + nm.getY(b), z = nm.getZ(a) + nm.getZ(b), l = Math.hypot(x, y, z) || 1;
    nm.setXYZ(a, x / l, y / l, z / l); nm.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}
// The head: a ball moved by `headAt` (pro/hair.js) into a skull, a jaw and a chin; each player's own (`F`, his
// face). Its picture covers only the front: FA radians round each way from the nose and from under the chin up to
// FE. Past its edges the picture's edge, plain skin, carries on, so the back of the head is plain.
const FA = 1.6, FE = .9, FW = 384, FH = 320;
function headGeo(F) {
  const geo = ball(R, 30, 22), pos = geo.attributes.position, uv = geo.attributes.uv, nm = geo.attributes.normal, v = new THREE.Vector3(), same = new Map();
  for (let i = 0; i < pos.count; i++) {
    headAt(v.fromBufferAttribute(pos, i).divideScalar(R), F).multiplyScalar(R); pos.setXYZ(i, v.x, v.y, v.z);
    const az = (uv.getX(i) - .5) * TAU, el = (uv.getY(i) - .5) * Math.PI;
    uv.setXY(i, Math.min(1, Math.max(0, .5 + az / (2 * FA))), Math.min(1, (el + Math.PI / 2) / (FE + Math.PI / 2)));
  }
  geo.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) { const k = v.fromBufferAttribute(pos, i).toArray().map(c => c.toFixed(5)).join(); same.set(k, [...same.get(k) || [], i]); }
  for (const l of same.values()) if (l.length > 1) {   // where the ball's edges meet (the seam at the back, the poles): one smooth normal
    v.set(0, 0, 0); for (const i of l) v.x += nm.getX(i), v.y += nm.getY(i), v.z += nm.getZ(i);
    v.normalize(); for (const i of l) nm.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}
// An ear: a flat shell with a rim and a hollow, its back against the head, narrower at the lobe. It faces +y.
const EAR_GEO = (() => {
  const geo = new THREE.LatheGeometry([[0, -.3], [.9, -.3], [1.06, 0], [1, .5], [.78, .7], [.55, .3], [.2, .15], [0, .15]].map(([r, h]) => new THREE.Vector2(r, h)), 12), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setXYZ(i, x * .019 * (1 - .22 * Math.max(0, -z)), pos.getY(i) * .014 * (1 - .6 * Math.max(0, x) ** 1.5), z * .031); }   // the front edge lies flat
  geo.computeVertexNormals(); geo.userData.shared = true; return geo;
})();
// The nose: only its lower part shows, a soft rounded bump (the tip and the wings) that rises out of the face;
// above it the bridge is just a gentle swell that melts into the face. It sits partly inside the head, and its
// normals turn to the face's where it meets the face, so there is no hard edge. It shares the head's picture.
// Its base is F.nb degrees below the eyes; F.nw makes it wider.
const D2R = Math.PI / 180, onHead = (x, y, z, F) => headAt(new THREE.Vector3(x, y, z), F).multiplyScalar(R);
function noseGeo(F) {
  const geo = ball(1, 16, 12), pos = geo.attributes.position, uv = geo.attributes.uv, nm = geo.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3();
  const lo = .0105, zt = Math.tan(F.nb * D2R) * R * .97 + lo;   // the height of the tip, so that its base is at F.nb
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), up = Math.max(0, z), dn = Math.max(0, -z);
    // up: a long, low, narrow swell to the bridge; down: short, round, wide at the wings
    v.set(x * (.016 - .0138 * up ** .8), y * F.nw * (.0178 - .0088 * up ** .7) * (1 - .1 * dn), z > 0 ? z * (.03 + zt * .25) : z * lo);
    f.copy(onHead(1, v.y / R, (zt + v.z) / R, F));   // the face just behind this point
    v.x += f.x - .003; v.z += zt; pos.setXYZ(i, v.x, v.y, v.z);
    uv.setXY(i, .5 + Math.atan2(v.y, v.x) / (2 * FA), (Math.asin(v.z / v.length()) + Math.PI / 2) / (FE + Math.PI / 2));
  }
  geo.computeVertexNormals();
  for (let i = 0; i < nm.count; i++) {   // out of the face: its own normal; where it meets the face: the face's
    v.fromBufferAttribute(pos, i); f.copy(onHead(1, v.y / R, v.z / R, F)); const t = Math.min(1, Math.max(0, (v.x - f.x) / .011));
    n.fromBufferAttribute(nm, i).lerp(v.normalize(), 1 - t * t * (3 - 2 * t)).normalize(); nm.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

// Each player's own face, from his name (the same name always gives the same face), in degrees on the face's
// picture (see `faceTex`): ex, ey the middle of each eye (round from the nose, up from the eyes' level), ew half
// its width, eo how open (above the middle), ed the lower lid's depth, tilt the outer corner up, ir the iris;
// brows: bx where the inner end starts, bl the length, bh the height above the eye, bt half the thickness, ba the
// arch, bd the drop to the outer end; mouth: my its height, mw half its width, lip how full, set (- serious,
// + a slight smile); nose: nb its base, nw its width; head: w wider, h longer, jaw, chin (pro/hair.js);
// beard 0 to 1 (stubble to a short beard), freck freckles.
const IRIS = { brown: ['#3b2416', '#4a2e1b', '#5a3a20', '#2e1d12', '#563a22'], hazel: '#6b5428', green: '#55663a', blue: '#4d6f86', grey: '#68737a' };
// Real players a child may know: only what differs from the face their name gives.
const KNOWN_FACES = {
  YAMAL: { ew: 10, eo: 3.7, bt: 1.05, ba: 1.4, set: .3, w: 1.01, h: .97, jaw: -.05, chin: -.03, lip: 1, beard: 0 },
  'MBAPPÉ': { ew: 10.2, ex: 20.5, eo: 3.5, bt: 1.15, ba: 1.6, mw: 17, set: .45, lip: 1.15, w: 1.03, h: .99, jaw: .02, chin: -.02, beard: 0 },
  HAALAND: { iris: 'blue', ew: 9.1, eo: 3, bt: 1.4, ba: .5, bd: .2, set: -.25, mw: 15.5, lip: .7, w: .98, h: 1.04, jaw: .08, chin: .06, nb: -21.5, beard: 0 },
  MESSI: { ew: 9.3, eo: 3, bt: 1.35, ba: 1.1, bd: .8, set: .1, mw: 15, w: 1.02, h: .985, jaw: .03, chin: -.02, beard: .8 },
  RONALDO: { ew: 9.8, eo: 3.4, tilt: 3.5, bt: 1.15, ba: 2.4, bd: .2, mw: 16.5, set: .3, lip: .85, w: .98, h: 1.03, jaw: .08, chin: .07, beard: 0 },
  'VINI JR': { ew: 9.9, eo: 3.6, bt: 1.05, ba: 1.6, mw: 17.2, set: .5, lip: 1.2, w: 1.01, h: .99, jaw: -.02, beard: 0 },
  BELLINGHAM: { ew: 9.4, eo: 3.1, bt: 1.85, ba: .8, bd: .4, set: 0, lip: 1.05, w: 1, h: 1.02, jaw: .06, chin: .02, beard: .25 },
  SALAH: { ew: 9.6, eo: 3.4, bt: 1.75, ba: 1.6, set: .25, lip: 1, w: 1.02, h: 1, jaw: .04, beard: 1 },
  'DE BRUYNE': { iris: 'blue', ew: 9.2, eo: 2.9, tilt: -1, bt: 1.2, ba: 1, bd: 1.2, set: -.1, lip: .65, w: .98, h: 1.03, chin: .04, beard: .3, freck: .5 },
  'MODRIĆ': { iris: 'hazel', ew: 9, eo: 3, tilt: 1, bt: 1.05, ba: 1.6, bd: 1.4, set: .05, lip: .65, w: .965, h: 1.03, jaw: -.05, chin: .03, beard: .25 },
  GRIEZMANN: { ew: 9.6, eo: 3.5, set: .35, bt: 1.2, beard: .2 },
  LEWANDOWSKI: { iris: 'grey', ew: 9.1, eo: 3, bt: 1.2, ba: 1.6, set: -.2, lip: .7, w: .98, h: 1.035, jaw: .05, chin: .06, beard: .2 },
  KANE: { iris: 'blue', ew: 9.2, eo: 3.1, bt: 1.25, ba: 1.2, set: .15, w: 1.03, h: .99, jaw: .06, beard: 0 },
  'VAN DIJK': { ew: 9.5, eo: 3.2, bt: 1.7, ba: .9, set: .1, w: 1.01, h: 1.035, jaw: .07, chin: .04, beard: .9 },
  SON: { ew: 9.6, eo: 2.6, tilt: 2, bt: 1.4, ba: .6, mw: 16.5, set: .5, w: 1.02, h: .99, beard: 0 },
  SAKA: { ew: 10, eo: 3.7, bt: 1.3, ba: 1.5, set: .35, lip: 1.1, w: 1.01, h: .98, jaw: -.03, beard: 0 },
  MUSIALA: { ew: 9.9, eo: 3.5, bt: 1.2, set: .3, w: 1, h: .99, jaw: -.04, beard: 0 },
  PEDRI: { ew: 10.1, eo: 3.7, bt: 1.6, ba: 1.2, set: .05, w: .965, h: 1.02, jaw: -.05, chin: .02, beard: 0 },
  'ØDEGAARD': { iris: 'blue', ew: 9.6, eo: 3.2, bt: 1.2, ba: .8, set: .15, w: .97, h: 1.02, beard: 0 },
  FODEN: { iris: 'blue', ew: 9.8, eo: 3.4, bt: 1.1, set: .25, freck: .4, beard: 0 },
  'HØJLUND': { iris: 'blue', ew: 9.6, eo: 3.3, bt: 1.2, set: .05, w: .99, h: 1.02, beard: 0 },
  LUKAKU: { ew: 9.3, eo: 3.1, bt: 1.6, set: .1, lip: 1.15, w: 1.04, h: 1.02, jaw: .08, beard: .45 },
  'SUÁREZ': { ew: 9.4, eo: 3.2, bt: 1.6, ba: 1.4, mw: 16.5, set: .25, beard: .6 },
  RAPHINHA: { ew: 9.5, bt: 1.4, set: .2, beard: .45 },
  'LEÃO': { ew: 9.8, eo: 3.4, bt: 1.3, set: .15, w: .98, h: 1.02, jaw: -.02, beard: .35 },
  'MAC ALLISTER': { iris: 'hazel', bt: 1.2, beard: .3, freck: .3 },
  KUBO: { eo: 2.6, ew: 9.4, bt: 1.3, ba: .5, beard: 0 }, MITOMA: { eo: 2.6, bt: 1.2, ba: .7, beard: 0 }, ENDO: { eo: 2.5, bt: 1.4, ba: .6, beard: .15 },
};
const lum = c => c.r * .3 + c.g * .6 + c.b * .1;
export function faceOf(p) {
  let h = 2166136261; for (const c of p.name || '') h = Math.imul(h ^ c.codePointAt(0), 16777619);
  let rs = (h >>> 0) ^ 0x5bd1e995; const rnd = () => ((rs = Math.imul(rs ^ rs >>> 15, 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296, r = (a, b) => a + (b - a) * rnd();
  const sk = new THREE.Color(p.skin), fair = lum(sk) > .6, ew = r(8.7, 10.3);
  const F = { ew, ex: 0, ey: r(-.5, 1.8), eo: r(2.8, 3.7), ed: r(2, 2.8), tilt: r(-1.5, 5), ir: r(4.4, 4.9), hood: r(-.25, .2),
    bx: r(5, 7.6), bl: r(-1, 3.5), bh: r(8.2, 10.4), bt: r(1.6, 2.9), ba: r(.3, 2.6), bd: r(-1, 1.8),
    my: r(-31.5, -28.5), mw: r(14, 17), lip: r(.65, 1.25), set: r(-.15, .5), nb: r(-21.5, -19), nw: r(.92, 1.12),
    w: r(.945, 1.05), h: r(.96, 1.045), jaw: r(-.09, .1), chin: r(-.06, .08), beard: 0, freck: 0 };
  F.ex = ew * r(1.9, 2.2);   // about one eye's width between the eyes
  F.bl += F.ex + F.ew - F.bx;   // the brow ends about over the eye's outer corner
  const k = rnd(); F.beard = k < .1 ? r(.55, .85) : k < .3 ? r(.15, .4) : 0;
  if (fair && rnd() < .15) F.freck = r(.3, .6);
  const ik = rnd(); F.iris = fair && ik < .4 ? ['blue', 'green', 'grey', 'hazel', 'blue'][Math.floor(rnd() * 5)] : !fair && ik < .1 ? 'hazel' : 'brown';
  const kn = KNOWN_FACES[p.name] || {}; Object.assign(F, kn); if (kn.ew && !kn.ex) F.ex = F.ew * 2.02;
  if (kn.ew || kn.ex) F.bl = F.ex + F.ew - F.bx + 1.5;
  F.irisC = F.iris === 'brown' ? IRIS.brown[Math.floor(rnd() * 5)] : IRIS[F.iris];
  return F;
}

// The face's skin, painted in angles: `X(a)` is the column a degrees round from the nose (+ is his left), `Y(e)`
// the row e degrees up from the eyes' level. Only what never moves is painted: soft shades made from the skin
// (so they suit every skin), stubble or a beard, freckles. The eyes, brows and mouth are drawn by the face's
// shader (`faceMat`), so they can blink, look about and change with his mood.
function faceTex(p, F) {
  const D = Math.PI / 180, X = a => FW * (.5 + a * D / (2 * FA)), Y = e => FH * (FE - e * D) / (FE + Math.PI / 2), kx = X(1) - X(0), ky = Y(0) - Y(1);
  const sk = new THREE.Color(p.skin), hc = new THREE.Color(p.hair);
  const rgb = (c, k = 1) => `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${k})`;
  const shade = sk.clone().multiply(new THREE.Color(.62, .5, .46)), deep = sk.clone().multiply(new THREE.Color(.36, .25, .22));
  let rs = Math.floor(F.ew * 1e5) | 1; const rnd = () => ((rs = Math.imul(rs ^ rs >>> 15, 2246822507) + 1) >>> 0) / 4294967296;
  return canvasTex(FW, FH, g => {
    g.fillStyle = p.skin; g.fillRect(0, 0, FW, FH);
    const soft = (a, e, rx, ry, k, c = shade) => {   // a soft shade, rx and ry degrees across
      g.save(); g.translate(X(a), Y(e)); g.scale(rx * kx, ry * ky);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, rgb(c, k)); r.addColorStop(1, rgb(c, 0));
      g.fillStyle = r; g.fillRect(-1, -1, 2, 2); g.restore();
    };
    soft(0, -95, 75, 42, .5); for (const s of [-1, 1]) soft(s * 55, -45, 30, 30, .26 + .6 * Math.max(0, F.jaw));   // under the jaw, and the jaw's sides
    const nb = F.nb;
    for (const s of [-1, 1]) {
      soft(s * 38, -20, 13, 15, .16);                                // under the cheekbone
      soft(s * F.ex, F.ey + 2.5, F.ew * 1.45, 6.5, .15);              // the eye's socket, under the brow
      soft(s * (F.ex - F.ew * .95), F.ey + .5, 3.5, 4.5, .14);        // deeper by the nose
      soft(s * F.ex, F.ey - F.ed - 2.6, F.ew * .95, 2.2, .07);        // under the eye
      soft(s * 6.8 * F.nw, nb + 9, 3.5, 10, .1);                      // beside the nose
      soft(s * 3.4 * F.nw, nb + .9, 2.1, 1.2, .32, deep);             // the nostrils
      soft(s * (F.mw + 1.5), F.my + 3.5, 3, 6, .07);                  // the fold from the nose to the mouth's corner
    }
    soft(0, nb + 6, 6, 8, .14);                                       // on the nose, so it does not shine
    soft(0, nb - .4, 7.5 * F.nw, 3, .42, deep);                       // under the nose
    soft(0, (nb + F.my) / 2 + .8, 2.2, 3.2, .1);                      // the groove above the lip
    soft(0, F.my - 13 - 40 * F.chin, 9, 4, .1);                       // the chin's underside starts
    if (F.beard) {   // stubble or a short beard: a soft shade in the hair's colour (a small mask, drawn larger so it is smooth), then fine dots
      const bc = sk.clone().lerp(hc, .7 + .25 * F.beard), cl = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      const mask = (a, e) => {   // how much beard at a, e (degrees)
        const A = Math.abs(a), lip = cl(Math.hypot(A / (F.mw + .5), (e - F.my + .4) / (1.8 + 2.2 * F.lip)), 1, 1.25);
        const nose = 1 - cl(e, nb - 2.5, nb - .5) * (1 - cl(A, 8 * F.nw, 11 * F.nw)), cheek = cl(-27 + .3 * A - e, 0, 4), back = cl(82 - A, 0, 10);
        return Math.max(cheek, cl(F.mw + 3 - A, 0, 2) * cl(nb - e, 0, 2)) * lip * nose * back;
      };
      const mw = 86, mh = 38, mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
      const mg = mc.getContext('2d'), im = mg.createImageData(mw, mh);
      for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) { const k = (j * mw + i) * 4; im.data[k] = bc.r * 255; im.data[k + 1] = bc.g * 255; im.data[k + 2] = bc.b * 255; im.data[k + 3] = 255 * (.07 + .16 * F.beard) * mask(-86 + i * 2 + 1, -6 - j * 2 - 1); }
      mg.putImageData(im, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(mc, X(-86), Y(-6), X(86) - X(-86), Y(-82) - Y(-6));
      for (let i = 0; i < 6000 * F.beard + 1500; i++) {
        const a = (rnd() * 2 - 1) * 85, e = -80 + rnd() * 74, m = mask(a, e);
        if (m && rnd() < m) { g.fillStyle = rgb(bc.clone().multiplyScalar(.65 + .3 * rnd()), (.1 + .25 * F.beard) * (.5 + .5 * rnd())); g.beginPath(); g.arc(X(a), Y(e), .55, 0, 7); g.fill(); }
      }
      mc.width = mc.height = 0;
    }
    if (F.freck) for (let i = 0; i < 70; i++) {   // freckles over the nose and cheeks
      const a = (rnd() * 2 - 1) * 30, e = nb + 4 + (rnd() * 2 - 1) * 8 - .004 * a * a;
      if (Math.abs(a) > 4 || rnd() < .4) { g.fillStyle = rgb(sk.clone().multiply(new THREE.Color(.78, .6, .48)), F.freck * (.25 + .35 * rnd())); g.beginPath(); g.arc(X(a), Y(e), .6 + .8 * rnd(), 0, 7); g.fill(); }
    }
  });
}
// The face's material: the painted skin, with the eyes, brows and mouth drawn on it by its shader, so they cost no
// meshes and no painting while he plays. Its numbers (`U`) are his own: his face (`F`), and how it moves:
// fDyn = (blink 0 open to 1 shut, the irises' turn round and up in degrees), fMood = (happy, sad, effort, focus).
// Seen from far away (more than a degree or so of face in each pixel), the eyes fade to soft dark marks, so no
// white dots flicker at game size.
const FACE_GLSL = `{
  vec2 A = vec2((vMapUv.x - .5) * ${(2 * FA).toFixed(5)}, vMapUv.y * ${(FE + Math.PI / 2).toFixed(5)} - ${(Math.PI / 2).toFixed(5)}) * 57.29578;
  float sd = A.x < 0. ? -1. : 1.;
  vec2 P = vec2(abs(A.x), A.y), fw = fwidth(A);
  float px = max(fw.x, fw.y), aa = max(px * .9, .2), far = smoothstep(1.1, 3., px);
  float hap = fMood.x, sad = fMood.y, eff = fMood.z, foc = fMood.w, blink = fDyn.x;
  vec3 col = diffuseColor.rgb;
  if (P.x < 42. && P.y > -12. && P.y < 26.) {
    // The eye: almond shaped, turned by its tilt; u runs from -1 at the inner corner to 1 at the outer.
    vec2 d = P - fE.xy; float ct = cos(fE2.x), st = sin(fE2.x);
    vec2 e = vec2(d.x * ct + d.y * st, d.y * ct - d.x * st);
    float u = e.x / fE.z, w1 = max(0., 1. - u * u);
    float up0 = fE.w * pow(w1, .7) * (1. - (.16 + fB2.z) * u), dn0 = -fE2.z * pow(w1, .85) * (1. + .15 * u);
    float dn = dn0 + fE2.z * w1 * (.85 * hap + .5 * eff + .12 * foc);                         // cheeks push the lower lid up
    float up = up0 * (1. - .15 * foc - .38 * eff - .1 * hap - .2 * sad * (.6 + .4 * u));    // lids lower: focus, effort, sadness
    up = max(mix(up, dn, blink), dn);
    float inEye = clamp(min(up - e.y, e.y - dn) / aa + .5, 0., 1.) * step(abs(u), 1.) * smoothstep(0., .5, up - dn);
    vec3 scl = mix(vec3(.66, .62, .58), col, .32) * mix(1., .5, smoothstep(up - 2.6, up, e.y));   // the white, shaded under the lid
    vec2 ic = vec2(clamp(fDyn.y * sd, -fE.z * .48, fE.z * .48), clamp(fDyn.z, -2.2, 1.8) + .15);
    vec2 q = (e - ic) * vec2(.92, 1.1); float r = length(q), ir = fE2.y;
    vec3 irc = fIris * mix(1.15, .5, smoothstep(ir * .45, ir, r)) * mix(1., .55, smoothstep(up - 2.6, up, e.y));
    irc = mix(irc, vec3(.01, .007, .005), clamp((ir * .4 - r) / aa + .5, 0., 1.));                      // the pupil
    irc = mix(irc, vec3(.85), .4 * (1. - far) * clamp((ir * .17 - length(q - vec2(-.3 * sd, .38) * ir)) / aa + .5, 0., 1.));   // a faint glint
    vec3 eye = mix(scl, irc, clamp((ir - r) / aa + .5, 0., 1.));
    eye = mix(eye, col * .45, far * .8);                                                           // far away: a soft dark mark
    float lid = clamp(min(up0 - e.y, e.y - up) / aa + .5, 0., 1.) * step(abs(u), 1.);              // the lid, where it has come down
    col *= 1. - .07 * lid;
    col = mix(col, eye, inEye);
    float cr = clamp((.35 - abs(e.y - fE.w * pow(w1, .55) - 1.7 - .4 * u)) / (aa * 1.6) + .5, 0., 1.) * smoothstep(-.95, -.3, u) * smoothstep(1., .55, u);
    col = mix(col, fLine, .14 * cr * (1. - blink));                                              // the crease above the eye
    float ll = clamp((.28 - abs(e.y - dn - .15)) / aa + .5, 0., 1.) * smoothstep(.95, .2, abs(u - .15));
    col = mix(col, fLine, .3 * ll);                                                               // the lower lid
    float lt = fE2.w * (.7 + .55 * smoothstep(-.5, 1., u));
    float lash = clamp((lt * .5 - abs(e.y - up - lt * .3)) / aa + .5, 0., 1.) * smoothstep(-1.08, -.88, u) * smoothstep(1.13, .96, u);
    col = mix(col, fLine, .92 * lash);                                                            // the upper lid's dark edge
    // The brow: thicker at its inner end, thinner out to a soft end. Sad: the inner ends rise; focus and effort:
    // they come down and together.
    float b0 = fB.x - .9 * foc - 1.3 * eff + .4 * sad, t = (P.x - b0) / fB.y, tc = clamp(t, 0., 1.), ti = 1. - tc;
    float by = fE.y + fB.z + fB2.x * sin(2.7 * tc) - fB2.y * tc + 1.1 * hap + sad * (2.8 * ti * ti - .6 * tc) - (1.1 * foc + 2.1 * eff) * pow(ti, 1.4) + .3 * eff;
    float br = fB.w * (1.1 - .5 * pow(tc, 1.4)) * mix(.6, 1., smoothstep(-.02, .14, t)) * (1. - .75 * smoothstep(.7, 1.02, t));
    float ba = clamp((br - abs(P.y - by)) / (aa + .35) + .5, 0., 1.) * step(-.02, t) * smoothstep(1.04, .9, t);
    col = mix(col, fBrowC, .93 * ba);
  }
  if (P.x < 30. && P.y < -16. && P.y > -48.) {
    // The mouth: a soft line between the lips that smiles or droops at the corners; it opens to a grin (happy)
    // or to clenched teeth (effort).
    float mw = fM.y * (1. + .15 * hap + .1 * eff - .1 * sad - .05 * foc), u = P.x / mw, w1 = max(0., 1. - u * u), sw = sqrt(w1);
    float lift = .25 + 1.1 * fM.w + 2.4 * hap - 1.6 * sad - .3 * foc - .3 * eff;
    float yl = fM.x + lift * u * u + .5 * sad * w1, op = 3.8 * hap + 2.4 * eff;
    float yU = yl + op * .2 * w1, yD = yl - op * pow(w1, .8), lip = fM.z * (1. - .35 * foc - .25 * eff - .2 * hap);
    float on = step(abs(u), 1.);
    float ul = clamp(min(yU + 1.7 * lip * sw - P.y, P.y - yU) / (aa * 2.) + .5, 0., 1.) * on;
    float lo = clamp(min(yD - P.y, P.y - yD + 2.6 * lip * sw) / (aa * 2.5) + .5, 0., 1.) * on;
    col = mix(col, fLip, .75 * ul + .5 * lo);
    col *= 1. + .07 * lo * smoothstep(.7, 0., abs(u)) * smoothstep(yD - 2.6 * lip, yD - .8 * lip, P.y);   // light on the lower lip
    col *= 1. - .16 * clamp(1. - abs(P.y - yD + 2.6 * lip * sw + 1.) / 1.4, 0., 1.) * sw;               // the shade under it
    float inM = clamp(min(yU - P.y, P.y - yD) / aa + .5, 0., 1.) * on * smoothstep(0., .5, yU - yD);
    float g = yU - yD, tk = hap + eff + 1e-3;
    float tU = smoothstep(-aa, aa, P.y - yU + g * (.58 * hap + .46 * eff) / tk), tL = smoothstep(-aa, aa, yD + g * .44 * eff / tk - P.y);
    vec3 teeth = vec3(.6, .57, .52) * mix(1., .55, smoothstep(.35, .85, abs(u))) * mix(1., .7, far);
    col = mix(col, mix(fLip * .25, teeth, max(tU, tL) * smoothstep(.88, .62, abs(u))), inM);
    float ln = clamp((.5 - abs(P.y - yl)) / aa + .5, 0., 1.) * (1. - .5 * u * u) * step(abs(u), 1.04);
    col = mix(col, fLine, .7 * ln * (1. - inM));                                                // the line between the lips
    vec2 cq = vec2(P.x - mw, P.y - fM.x - lift); col *= 1. - .22 * exp(-dot(cq, cq) / 1.4);       // the corners
  }
  diffuseColor.rgb = col;
}`;
function faceMat(p, F, mats) {
  const V4 = (...a) => ({ value: new THREE.Vector4(...a) }), C = c => ({ value: new THREE.Color(c) });
  const sk = new THREE.Color(p.skin), hc = new THREE.Color(p.hair), toS = c => c.clone().convertLinearToSRGB();
  const brow = toS(hc).multiplyScalar(.8).lerp(new THREE.Color().setRGB(.165, .1, .063, THREE.SRGBColorSpace).convertLinearToSRGB(), Math.min(.75, Math.max(0, lum(hc) - .08) * 2.5));   // fair hair: darker brows, so they read
  const sS = toS(sk), lipS = sS.clone().multiply(new THREE.Color(.78, .52, .5)).lerp(new THREE.Color(.38, .2, .2), lum(sS) < .45 ? .25 : 0);
  const U = { fE: V4(F.ex, F.ey, F.ew, F.eo), fE2: V4(F.tilt * D2R, F.ir, F.ed, 1.15 + .1 * F.bt), fB: V4(F.bx, F.bl, F.bh, F.bt), fB2: V4(F.ba, F.bd, F.hood, 0),
    fM: V4(F.my, F.mw, F.lip, F.set), fDyn: V4(0, 0, -.6, 0), fMood: V4(0, 0, 0, 0),
    fIris: C(F.irisC), fBrowC: { value: new THREE.Color().setRGB(brow.r, brow.g, brow.b, THREE.SRGBColorSpace) }, fLine: C('#1c110c'),
    fLip: { value: new THREE.Color().setRGB(lipS.r, lipS.g, lipS.b, THREE.SRGBColorSpace) } };
  const m = withRim(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .62, map: faceTex(p, F) }), sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = 'uniform vec4 fE, fE2, fB, fB2, fM, fDyn, fMood;\nuniform vec3 fIris, fBrowC, fLine, fLip;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + FACE_GLSL);
  }, 'face');
  mats.push(m); return [m, U];
}
// The face's life, called every frame by animateRig (pro/motion.js): he blinks on his own rhythm, his eyes follow
// the ball, and his face goes with the moment: focused on the ball, a short effort as he kicks, a grin when his
// team scores, a let-down face when the other team does, calm otherwise. Only a few numbers change.
function faceLife(g, head, U, seed) {
  const s = { t: null, next: 1 + seed % 3, bl: -9, f: 0, lx: 0, ly: -.6, gx: 0, gy: 0, gt: 0, hold: null };
  let rs = Math.floor(seed * 1e6) | 1; const rnd = () => ((rs = Math.imul(rs ^ rs >>> 15, 2246822507) + 1) >>> 0) / 4294967296;
  const v = new THREE.Vector3(), sm = t => (t = Math.min(1, Math.max(0, t)), t * t * (3 - 2 * t)), damp = (x, to, k, dt) => x + (to - x) * (1 - Math.exp(-k * dt));
  const face = (a, sim, mood, moodT, time) => {
    if (s.hold) return;
    const dt = s.t === null ? 0 : Math.min(.1, Math.max(0, time - s.t)); s.t = time;
    // Blinks: every 2 to 6 seconds, now and then two in a row.
    if (time > s.next || time < s.bl) { s.bl = time; s.next = time + (rnd() < .15 ? .35 : 2 + 4 * rnd()); }
    const bt = time - s.bl, blink = bt < .07 ? sm(bt / .07) : sm(1 - (bt - .07) / .12);
    // The ball, from his head: how far round and up his eyes must turn.
    const b = sim.ball; let lx = 0, ly = -.6;
    if (b && g.parent) {
      v.set(g.position.x + b.x - a.x, g.position.y + b.y - a.y, (b.z || 0) + .11); g.parent.localToWorld(v); head.worldToLocal(v).divide(head.userData.shape);
      const az = Math.atan2(v.y, v.x) / D2R, el = Math.atan2(v.z, Math.hypot(v.x, v.y)) / D2R;
      lx = Math.max(-1, Math.min(1, az / 35)) * 3.6; ly = Math.max(-1, Math.min(1, el / 30)) * 1.8;
    }
    if ((s.gt -= dt) < 0) { s.gt = 1 + 2.5 * rnd(); s.gx = (rnd() - .5) * 1.4; s.gy = (rnd() - .5) * .8; }   // small glances about
    const carry = b && b.state === 'carried' && b.carrier === a.id, near = b ? Math.hypot(b.x - a.x, b.y - a.y) : 99;
    const happy = Math.max(0, mood), sad = Math.max(0, -mood), calm = 1 - happy - sad;
    s.f = damp(s.f, carry ? 1 : near < 4 ? .75 * (1 - near / 4) + .25 : 0, 3, dt);
    const kt = a.kickAt != null ? sim.time - a.kickAt : 9, effort = sm((kt + .12) / .1) * (1 - sm((kt - .25) / .35)) * calm;
    if (sad) ly = -2.2 * sad + ly * (1 - sad);
    s.lx = damp(s.lx, lx + s.gx * calm, 14, dt); s.ly = damp(s.ly, ly + s.gy * calm, 14, dt);
    U.fDyn.value.set(blink, s.lx, s.ly, 0); U.fMood.value.set(happy * sm(moodT / .25), sad, effort, s.f * calm * (1 - effort));
  };
  // Freezes the face (for the test page): blink, look [round, up], happy, sad, effort, focus; null lets it live.
  const set = o => { s.hold = o; if (o) { U.fDyn.value.set(o.blink || 0, ...(o.look || [0, -.6]), 0); U.fMood.value.set(o.happy || 0, o.sad || 0, o.effort || 0, o.focus || 0); } };
  return [face, set];
}

// The shirt's picture. Around the body: the right side seam is at x = 0, the chest at 256, the left side at 512,
// the back at 768. Up the body: `y(z)` is the row for a height z above the waist.
function shirtTex(kit, p) {
  return canvasTex(1024, 512, g => {
    const y = z => 512 * (1 - (z - Z0) / (Z1 - Z0)), [c0, c1] = kit.colors;
    g.fillStyle = c0; g.fillRect(0, 0, 1024, 512);
    if (kit.pattern === 'stripes') { g.fillStyle = c1; for (let k = 0; k < 8; k++) g.fillRect(96 + k * 128, 0, 64, 512); }
    if (kit.pattern === 'band') for (const c of [256, 768]) { g.fillStyle = '#fff'; g.fillRect(c - 60, 0, 120, 512); g.fillStyle = c1; g.fillRect(c - 40, 0, 80, 512); }
    for (const x of [0, 512, 1024]) { const s = g.createLinearGradient(x - 70, 0, x + 70, 0); s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(.5, 'rgba(0,0,0,.16)'); s.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = s; g.fillRect(x - 70, 0, 140, 512); } // darker under the arms
    g.fillStyle = kit.trim; g.fillRect(0, 0, 1024, y(.362)); g.fillRect(0, y(Z0 + .016), 1024, 12);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.55)';
    const text = (s, x, row, size, max, lw) => { g.font = `900 ${size}px system-ui,sans-serif`; g.lineWidth = lw; g.strokeText(s, x, row, max); g.fillStyle = kit.num; g.fillText(s, x, row, max); };
    text(p.name, 768, y(.285), 46, 270, 9); text(p.num, 768, y(.135), 150, 230, 13);   // back: name over a big number
    text(p.num, 256, y(.115), 68, 110, 8);                                              // chest: a small number
    g.fillStyle = '#fff'; g.beginPath(); g.arc(306, y(.245), 17, 0, 7); g.fill();       // badge over the heart
    g.fillStyle = kit.trim; g.beginPath(); g.arc(306, y(.245), 12, 0, 7); g.fill();
  });
}
const BLOB_GEO = new THREE.CircleGeometry(.5, 20), BLOB_MAT = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
BLOB_GEO.userData.shared = true;

export function makeRig(p, kit, isHero) {
  const g = new THREE.Group(), mats = [], legs = [], arms = [], elbows = [];
  const mat = (c, rough = .8, o = {}) => { const m = withRim(new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...o })); mats.push(m); return m; };
  const add = (parent, geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const skin = mat(p.skin, .62), shorts = mat(kit.shorts, .85), sock = mat(kit.socks, .9), boot = mat(isHero ? '#ff8a1c' : '#16181f', .22, { envMapIntensity: 1.3 }), sole = mat(isHero ? '#ffffff' : '#e8e8ec', .6);
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, s * HALF, HIP); g.add(hip);
    add(hip, limb(THIGH, .072, .05, .008), skin);
    add(hip, lathe([[.068, -.2], [.084, -.212], [.085, -.12], [.083, -.02], [.07, .04], [0, .07]], 14), shorts);   // the leg of the shorts, straight down to mid-thigh
    const knee = new THREE.Group(); knee.position.z = -THIGH; hip.add(knee);
    add(knee, limb(SHIN - .02, .05, .037, .013), sock);
    add(knee, new THREE.CylinderGeometry(.053, .053, .03, 14).rotateX(Math.PI / 2), mat(kit.trim, .9)).position.z = -.035; // sock top
    const foot = new THREE.Group(); foot.position.z = -SHIN; knee.add(foot);                                        // the ankle
    const b = add(foot, ball(.072, 16, 12), boot); b.scale.set(1.75, .7, .58); b.position.set(.06, 0, -.014);
    const so = add(foot, ball(.07, 12, 8), sole); so.scale.set(1.7, .64, .2); so.position.set(.06, 0, -.045);
    add(foot, ball(.045, 12, 10), boot).position.set(-.022, 0, -.006);                                             // heel
    const lace = add(foot, ball(.03, 10, 8), sole); lace.scale.set(1.5, .7, .4); lace.position.set(.062, 0, .024); // laces
    legs.push({ hip, knee, foot, boot: b.matrix });   // boot: where the boot sits on the foot (for the test pages)
  }
  // The spine bends in two places: `pelvis` turns on the hip joints and `torso` on the waist, so he can lean
  // from the hips and twist his chest over them.
  const pelvis = new THREE.Group(); pelvis.position.z = HIP; g.add(pelvis);
  add(pelvis, loft(SHORTS, 22, 2.3), shorts);
  const torso = new THREE.Group(); torso.position.z = WAIST; pelvis.add(torso);
  add(torso, loft(SHIRT), mat('#ffffff', .86, { map: shirtTex(kit, p) }));
  add(torso, new THREE.TorusGeometry(.057, .0075, 6, 22), mat(kit.trim, .86)).position.z = Z1 - .002;     // a thin collar rib
  const neck = add(torso, lathe([[.055, -.04], [.055, 0], [.053, .03], [.05, .06], [.049, .1]], 16), skin); neck.position.z = Z1; neck.scale.y = 1.06; // neck, a little wider than deep
  // A sleeve: its top is a dome round the shoulder joint, so it stays in place under the shirt however the arm
  // turns, and only the round of the shoulder shows past the shirt's side.
  const sleeve = mat(kit.pattern === 'sleeves' ? kit.colors[1] : kit.colors[0], .86), cuff = mat(kit.trim, .86);
  const sleeveGeo = lathe([[.051, -.128], [.052, -.07], [.055, -.02], [.056, 0], [.053, .02], [.045, .037], [.03, .05], [0, .056]], 14);
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(-.004, s * SHOULDER_Y, SHOULDER); torso.add(piv); arms.push(piv);
    add(piv, sleeveGeo, sleeve);
    add(piv, new THREE.CylinderGeometry(.053, .053, .018, 14).rotateX(Math.PI / 2), cuff).position.z = -.13;
    add(piv, limb(.225, .049, .038, .006), skin);
    const elbow = new THREE.Group(); elbow.position.z = -.225; piv.add(elbow); elbows.push(elbow);
    add(elbow, limb(.215, .038, .029, .004), skin);
    const hand = add(elbow, ball(.037, 12, 10), skin); hand.scale.set(1, .6, 1.3); hand.position.z = -.253;    // a flat hand, palm to the body
    const thumb = add(elbow, ball(.015, 8, 6), skin); thumb.scale.z = 1.7; thumb.position.set(.03, -s * .006, -.236);
  }
  // The head, with his own face (`faceOf`): a little wider or longer, its jaw and chin his own.
  const F = faceOf(p), head = new THREE.Group(); head.rotation.order = 'ZYX'; head.position.z = HEAD; head.scale.set(F.w, .92 * F.w, 1.1 * F.h); torso.add(head);
  const [face, U] = faceMat(p, F, mats); add(head, headGeo(F), face); add(head, noseGeo(F), face);
  for (const s of [-1, 1]) { const e = add(head, EAR_GEO, skin); e.position.copy(onHead(-.1, s, -.08, F)); e.position.y -= s * .002; e.scale.y = s; e.rotation.set(0, -.15, -s * .22); }
  addHair(head, p, kit, R, mat, add, F);
  const bones = [...legs.flatMap(l => [l.hip, l.knee, l.foot]), pelvis, torso, ...arms, ...elbows, head], [drawn, made, skeleton] = bake(g, bones, head);
  const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); blob.position.z = .012; g.add(blob);
  g.rotation.order = 'ZYX';
  g.userData = { mats: drawn, made, skeleton, legs, arms, elbows, pelvis, torso, head, blob, yaw: null, seed: Math.random() * 6 };
  [g.userData.face, g.userData.faceSet] = faceLife(g, head, U, g.userData.seed);
  return g;
}

// The parts above are built one mesh each, on the bone that moves them. `bake` then draws them with four meshes:
// every plain-coloured part in one (each corner keeps its part's colour, roughness and shine), and the face, the
// shirt and the hair in one each. Each corner follows exactly one bone (rigid skinning), so he looks and moves the
// same, for 4 draws instead of 37 (and 4 again for his shadow). The head's shape (its scale) goes into the corners,
// so the head bone only turns. Returns the four materials, the size of each part built (for the test page) and the
// bones.
const ONE = new THREE.Matrix4();
// The players' own shadow material: three.js's shared one would have to switch between bent (skinned) and plain
// meshes many times a frame, and each switch looks its shader up again.
const DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
function bodyMat() {
  return withRim(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true }), sh => {
    sh.vertexShader = 'attribute vec2 aMat;\nvarying vec2 vMat;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
    sh.fragmentShader = 'varying vec2 vMat;\n' + sh.fragmentShader.replace('#include <envmap_common_pars_fragment>', '#include <envmap_common_pars_fragment>\n#define envMapIntensity vMat.y')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMat.x;');   // aMat: roughness, shine (envMapIntensity)
  }, 'body');
}
function bake(g, bones, head) {
  g.updateMatrixWorld(true);
  const S = new THREE.Matrix4().makeScale(head.scale.x, head.scale.y, head.scale.z), groups = new Map(), made = [], meshes = [];
  g.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const M = o.matrix.clone(); let b = o.parent;
    while (!bones.includes(b)) { M.premultiply(b.matrix); b = b.parent; }
    if (b === head) M.premultiply(S);
    const geo = o.geometry.clone().applyMatrix4(M), ix = geo.index.array, m = o.material;
    if (M.determinant() < 0) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }   // a mirrored part: turn its faces back the right way
    const key = m.map || m.vertexColors ? m : 'body';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([geo, bones.indexOf(b), m]); made.push({ tris: ix.length / 3, head: b === head });
    o.removeFromParent();
  }
  head.scale.set(1, 1, 1); head.userData.shape = new THREE.Vector3().setFromMatrixScale(S);
  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), drawn = [];
  for (const [key, list] of groups) {
    const body = key === 'body', names = body ? ['position', 'normal'] : Object.keys(list[0][0].attributes), n = list.reduce((s, [geo]) => s + geo.attributes.position.count, 0);
    const out = Object.fromEntries(names.map(k => [k, new Float32Array(n * list[0][0].attributes[k].itemSize)])), idx = [], si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3), am = new Float32Array(n * 2);
    let v = 0;
    for (const [geo, bone, m] of list) {
      for (const k of names) out[k].set(geo.attributes[k].array, v * geo.attributes[k].itemSize);
      for (const i of geo.index.array) idx.push(i + v);
      for (let i = v; i < v + geo.attributes.position.count; i++) { si[i * 4] = bone; sw[i * 4] = 1; col[i * 3] = m.color.r; col[i * 3 + 1] = m.color.g; col[i * 3 + 2] = m.color.b; am[i * 2] = m.roughness; am[i * 2 + 1] = m.envMapIntensity; }
      v += geo.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    for (const k of names) geo.setAttribute(k, new THREE.BufferAttribute(out[k], list[0][0].attributes[k].itemSize));
    if (body) { geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aMat', new THREE.BufferAttribute(am, 2)); }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); geo.setIndex(idx);
    const mesh = new THREE.SkinnedMesh(geo, body ? bodyMat() : key);
    mesh.bind(skeleton, ONE); mesh.castShadow = true; mesh.customDepthMaterial = DEPTH; mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, .9), 1.5);   // room for arms up in a cheer
    g.add(mesh); drawn.push(mesh.material);
  }
  return [drawn, made, skeleton];
}
