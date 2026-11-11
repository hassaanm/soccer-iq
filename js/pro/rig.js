// Player bodies: a young athlete about six heads tall, with a separate shirt, shorts,
// socks and boots, knees and elbows that bend, and a soft light along his edges (rim light) so he stands out
// from the grass. The body faces +x, z is up, and his left side is +y.
import * as THREE from 'three';
import { canvasTex, blobTex } from '../tex.js';
import { addHair, headAt } from './hair.js';

// The rim light's colour and strength, shared by every player; the world sets them for day or night.
export const RIM = { color: { value: new THREE.Color('#ffffff') }, k: { value: .5 } };
function withRim(m) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = RIM.color; sh.uniforms.uRimK = RIM.k;
    sh.fragmentShader = 'uniform vec3 uRim;\nuniform float uRimK;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
      outgoingLight += uRim * uRimK * rimF * (0.3 + 0.7 * diffuseColor.rgb);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'rim';
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
// The head: a ball moved by `headAt` (pro/hair.js) into a skull, a jaw and a chin. Its picture, the face, covers
// only the front: FA radians round each way from the nose and from under the chin up to FE. Past its edges the
// picture's edge, plain skin, carries on, so the back of the head is plain.
const FA = 1.6, FE = .9, FW = 384, FH = 320;
const HEAD_GEO = (() => {
  const geo = ball(R, 30, 22), pos = geo.attributes.position, uv = geo.attributes.uv, nm = geo.attributes.normal, v = new THREE.Vector3(), same = new Map();
  for (let i = 0; i < pos.count; i++) {
    headAt(v.fromBufferAttribute(pos, i).divideScalar(R)).multiplyScalar(R); pos.setXYZ(i, v.x, v.y, v.z);
    const az = (uv.getX(i) - .5) * TAU, el = (uv.getY(i) - .5) * Math.PI;
    uv.setXY(i, Math.min(1, Math.max(0, .5 + az / (2 * FA))), Math.min(1, (el + Math.PI / 2) / (FE + Math.PI / 2)));
  }
  geo.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) { const k = v.fromBufferAttribute(pos, i).toArray().map(c => c.toFixed(5)).join(); same.set(k, [...same.get(k) || [], i]); }
  for (const l of same.values()) if (l.length > 1) {   // where the ball's edges meet (the seam at the back, the poles): one smooth normal
    v.set(0, 0, 0); for (const i of l) v.x += nm.getX(i), v.y += nm.getY(i), v.z += nm.getZ(i);
    v.normalize(); for (const i of l) nm.setXYZ(i, v.x, v.y, v.z);
  }
  geo.userData.shared = true; return geo;
})();
// An ear: a flat shell with a rim and a hollow, its back against the head, narrower at the lobe. It faces +y.
const EAR_GEO = (() => {
  const geo = new THREE.LatheGeometry([[0, -.3], [.9, -.3], [1.06, 0], [1, .5], [.78, .7], [.55, .3], [.2, .15], [0, .15]].map(([r, h]) => new THREE.Vector2(r, h)), 12), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setXYZ(i, x * .019 * (1 - .22 * Math.max(0, -z)), pos.getY(i) * .014 * (1 - .6 * Math.max(0, x) ** 1.5), z * .031); }   // the front edge lies flat
  geo.computeVertexNormals(); geo.userData.shared = true; return geo;
})();
// The nose: only its lower part shows, a soft rounded bump (the tip and the wings) that rises out of the face;
// above it the bridge is just a gentle swell that melts into the face. It sits partly inside the head, and its
// normals turn to the face's where it meets the face, so there is no hard edge. It shares the head's picture.
const onHead = (x, y, z) => headAt(new THREE.Vector3(x, y, z)).multiplyScalar(R);
const NOSE_GEO = (() => {
  const geo = ball(1, 16, 12), pos = geo.attributes.position, uv = geo.attributes.uv, nm = geo.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3();
  const zt = -.031;   // the height of the tip
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), up = Math.max(0, z), dn = Math.max(0, -z);
    // up: a long, low, narrow swell to the bridge; down: short, round, wide at the wings
    v.set(x * (.0145 - .0125 * up ** .8), y * (.0165 - .008 * up ** .7) * (1 - .1 * dn), z > 0 ? z * .021 : z * .009);
    f.copy(onHead(1, v.y / R, (zt + v.z) / R));   // the face just behind this point
    v.x += f.x - .003; v.z += zt; pos.setXYZ(i, v.x, v.y, v.z);
    uv.setXY(i, .5 + Math.atan2(v.y, v.x) / (2 * FA), (Math.asin(v.z / v.length()) + Math.PI / 2) / (FE + Math.PI / 2));
  }
  geo.computeVertexNormals();
  for (let i = 0; i < nm.count; i++) {   // out of the face: its own normal; where it meets the face: the face's
    v.fromBufferAttribute(pos, i); f.copy(onHead(1, v.y / R, v.z / R)); const t = Math.min(1, Math.max(0, (v.x - f.x) / .011));
    n.fromBufferAttribute(nm, i).lerp(v.normalize(), 1 - t * t * (3 - 2 * t)).normalize(); nm.setXYZ(i, n.x, n.y, n.z);
  }
  geo.userData.shared = true; return geo;
})();

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
// The face, painted in angles: `X(a)` is the column a degrees round from the nose (+ is his left), `Y(e)` the row e
// degrees up from the eyes' level. Shades are the skin made darker, so they suit every skin.
function faceTex(p) {
  const D = Math.PI / 180, X = a => FW * (.5 + a * D / (2 * FA)), Y = e => FH * (FE - e * D) / (FE + Math.PI / 2), kx = X(1) - X(0), ky = Y(0) - Y(1);
  const sk = new THREE.Color(p.skin), hc = new THREE.Color(p.hair), lum = c => c.r * .3 + c.g * .6 + c.b * .1, hash = [...p.name || ''].reduce((h, c) => h * 31 + c.charCodeAt(0) >>> 0, 7);
  const rgb = (c, k = 1) => `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${k})`;
  const shade = sk.clone().multiply(new THREE.Color(.62, .5, .46)), deep = sk.clone().multiply(new THREE.Color(.36, .25, .22));
  const brow = hc.clone().lerp(new THREE.Color('#2a1a10'), Math.min(.75, Math.max(0, lum(hc) - .08) * 2.5));   // fair hair: darker brows, so they read
  const iris = new THREE.Color(lum(sk) > .6 && lum(hc) > .2 && hash % 3 === 0 ? ['#56707e', '#5f6a3a'][hash % 2] : ['#4a2e1b', '#3b2416', '#56361f'][hash % 3]);
  return canvasTex(FW, FH, g => {
    g.fillStyle = p.skin; g.fillRect(0, 0, FW, FH);
    const soft = (a, e, rx, ry, k, c = shade) => {   // a soft shade, rx and ry degrees across
      g.save(); g.translate(X(a), Y(e)); g.scale(rx * kx, ry * ky);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, rgb(c, k)); r.addColorStop(1, rgb(c, 0));
      g.fillStyle = r; g.fillRect(-1, -1, 2, 2); g.restore();
    };
    soft(0, -95, 75, 42, .5); for (const s of [-1, 1]) soft(s * 55, -45, 30, 30, .26);   // under the jaw, and the jaw's sides
    for (const s of [-1, 1]) {
      soft(s * 36, -22, 13, 14, .16);                    // under the cheekbone
      soft(s * 15, 3, 14, 6, .16);                       // under the brow
      soft(s * 6.5, -10, 3.5, 9, .1);                    // beside the nose
    }
    soft(0, -14, 6, 8, .14);                             // on the nose, so it does not shine
    soft(0, -18.5, 7, 3.2, .45, deep);                       // under the nose
    soft(0, -35, 11, 3, .22);                             // under the lower lip
    // The mouth: closed, a soft line that turns up a little at the corners, the upper lip a little darker and a hint of the lower lip.
    soft(0, -29.5, 11.5, 2.6, .2, deep); soft(0, -32, 9, 2.2, .12);
    g.lineCap = 'round';
    for (const [w, k] of [[3, .16], [1.5, .5]]) {
      const lg = g.createLinearGradient(X(-13), 0, X(13), 0); lg.addColorStop(0, rgb(deep, 0)); lg.addColorStop(.3, rgb(deep, k)); lg.addColorStop(.7, rgb(deep, k)); lg.addColorStop(1, rgb(deep, 0));
      g.strokeStyle = lg; g.lineWidth = w; g.beginPath(); g.moveTo(X(-13), Y(-29.3)); g.bezierCurveTo(X(-7), Y(-31.1), X(7), Y(-31.1), X(13), Y(-29.3)); g.stroke();   // the corners turn up a little
    }
    for (const s of [-1, 1]) {
      // An eye: almond shaped, the outer corner a little higher; the upper lid covers the top of the iris.
      const ex = X(s * 15), ey = Y(0), w = 7.65 * kx, up = 3.15 * ky, dn = 2 * ky, ix = ex + s * .3 * kx;
      const lid = () => { g.moveTo(ex - s * w, ey + 1); g.bezierCurveTo(ex - s * w * .5, ey - up * 1.3, ex + s * w * .45, ey - up * 1.35, ex + s * w, ey - 1.5); };
      g.save(); g.beginPath(); lid(); g.bezierCurveTo(ex + s * w * .4, ey + dn * 1.4, ex - s * w * .45, ey + dn * 1.4, ex - s * w, ey + 1); g.clip();
      g.fillStyle = rgb(new THREE.Color('#ece6de').lerp(sk, .25)); g.fillRect(ex - w - 2, ey - up * 2, w * 2 + 4, up * 4);
      g.fillStyle = rgb(iris); g.beginPath(); g.arc(ix, ey + .5, 3.8 * ky, 0, 7); g.fill();
      g.strokeStyle = 'rgba(15,8,5,.5)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#0d0806'; g.beginPath(); g.arc(ix, ey + .5, 1.3 * ky, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.arc(ix - 1.4, ey - 1.4, .9, 0, 7); g.fill();
      g.fillStyle = 'rgba(20,10,5,.28)'; g.fillRect(ex - w - 2, ey - up * 2, w * 2 + 4, up * 1.15);   // the lid's shadow on the eye
      g.restore();
      g.strokeStyle = 'rgba(22,13,9,.92)'; g.lineWidth = 2.2; g.beginPath(); lid(); g.stroke();   // the upper lid line
      g.strokeStyle = rgb(deep, .16); g.lineWidth = 1.3; g.beginPath(); g.moveTo(ex - s * w * .8, ey - up * 1.9); g.quadraticCurveTo(ex, ey - up * 2.5, ex + s * w * .85, ey - up * 1.7); g.stroke();   // the crease above
      g.strokeStyle = rgb(deep, .35); g.lineWidth = 1.2; g.beginPath(); g.moveTo(ex - s * w * .7, ey + dn * 1.05); g.quadraticCurveTo(ex, ey + dn * 1.5, ex + s * w * .95, ey); g.stroke();   // the lower lid
      // A brow: soft dabs along a low arch, fuller at the inner end, thinner out to a round end; level, so he
      // looks focused, not cross.
      g.fillStyle = rgb(brow, .9); g.beginPath();
      for (let k = 0; k <= 24; k++) { const t = k / 24, r = (1.3 - .65 * t ** 1.4) * ky, x = X(s * (6 + 19 * t)), y = Y(7.8 + 2.3 * Math.sin(Math.PI * t * .8) - .4 * t); g.moveTo(x + r * 1.3, y); g.ellipse(x, y, r * 1.3, r, 0, 0, 7); }
      g.fill('nonzero');
    }
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
    legs.push({ hip, knee, foot });
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
  const head = new THREE.Group(); head.rotation.order = 'ZYX'; head.position.z = HEAD; head.scale.set(1, .92, 1.1); torso.add(head);
  const face = mat('#ffffff', .62, { map: faceTex(p) }); add(head, HEAD_GEO, face); add(head, NOSE_GEO, face);
  for (const s of [-1, 1]) { const e = add(head, EAR_GEO, skin); e.position.copy(onHead(-.1, s, -.08)); e.position.y -= s * .002; e.scale.y = s; e.rotation.set(0, -.15, -s * .22); }
  addHair(head, p, kit, R, mat, add);
  const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); blob.position.z = .012; g.add(blob);
  g.rotation.order = 'ZYX';
  g.userData = { mats, legs, arms, elbows, pelvis, torso, head, blob, yaw: null, seed: Math.random() * 6 };
  return g;
}
