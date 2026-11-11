// Player bodies: a young athlete about six heads tall, with a separate shirt, shorts,
// socks and boots, knees and elbows that bend, and a soft light along his edges (rim light) so he stands out
// from the grass. The body faces +x, z is up, and his left side is +y.
import * as THREE from 'three';
import { canvasTex, blobTex } from '../tex.js';
import { addHair, jawX, jawY } from './hair.js';

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
const SHOULDER = .3, SHOULDER_Y = .165, HEAD = .55, R = .127;     // above the waist
const Z0 = -.078, Z1 = .385; // the shirt runs from below the waist to the collar; its picture maps to this range
// Rings up the shirt and the shorts: [height, half width, depth to the front, depth to the back].
const SHIRT = [[-.064, .128, .08, .078], [Z0, .15, .097, .094], [-.02, .145, .094, .09], [.05, .138, .09, .086], [.13, .148, .097, .088], [.2, .162, .104, .09],
  [.26, .168, .104, .09], [.3, .16, .098, .086], [.33, .128, .084, .078], [.355, .085, .066, .064], [.375, .058, .054, .054], [Z1, .052, .05, .05]];
const SHORTS = [[-.084, .004, .004, .004], [-.074, .09, .06, .06], [-.04, .136, .084, .088], [0, .146, .09, .096], [.06, .14, .088, .09], [.1, .13, .082, .082], [.14, .108, .068, .068]];

const TAU = Math.PI * 2;
const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);
// An arm or leg part hanging down from its joint: radius r0 at the joint, r1 at the far end, both ends rounded.
const limb = (len, r0, r1, bulge = 0) => lathe([[0, -len - r1 * .9], [r1 * .72, -len - r1 * .62], [r1, -len], [(r0 + r1) / 2 + bulge, -len * .45], [r0, 0], [r0 * .72, r0 * .62], [0, r0 * .9]], 14);
const ball = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h).rotateX(Math.PI / 2);
// A body part built from rings: each ring is a rounded box shape (`n` = 2 is an oval, higher is boxier), wider
// than it is deep, and deeper at the chest than at the back. Its picture wraps once around, starting at the
// right side seam, and runs from the first ring's height to the last.
function loft(rings, seg = 28, n = 2.5) {
  const pos = [], uv = [], idx = [], e = 2 / n, lo = Math.min(...rings.map(r => r[0])), hi = rings[rings.length - 1][0];
  for (const [z, w, f, b] of rings) for (let j = 0; j <= seg; j++) {
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
// The head: a ball that narrows to the jaw, with a flatter back below the ears.
function headGeo() {
  const geo = ball(R, 28, 20), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / R; pos.setXYZ(i, R * jawX(pos.getX(i) / R, z), R * jawY(pos.getY(i) / R, z), pos.getZ(i));
  }
  geo.computeVertexNormals();
  return geo;
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
// A calmer face than the low-poly one: eyes with whites, brows, a nose shadow and a small closed smile.
function faceTex(p) {
  return canvasTex(512, 256, g => {
    g.fillStyle = p.skin; g.fillRect(0, 0, 512, 256);
    const sh = g.createLinearGradient(0, 150, 0, 256); sh.addColorStop(0, 'rgba(60,20,10,0)'); sh.addColorStop(1, 'rgba(60,20,10,.22)'); g.fillStyle = sh; g.fillRect(0, 150, 512, 106); // under the chin
    for (const s of [-1, 1]) {
      const x = 256 + s * 25;
      g.fillStyle = 'rgba(255,110,100,.12)'; g.beginPath(); g.ellipse(256 + s * 42, 136, 13, 8, 0, 0, 7); g.fill();
      g.fillStyle = '#fbf8f4'; g.beginPath(); g.ellipse(x, 117, 9.5, 6.2, 0, 0, 7); g.fill();
      g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(x, 117.5, 5.2, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 1.8, 115.5, 1.7, 0, 7); g.fill();
      g.strokeStyle = 'rgba(30,18,12,.85)'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.ellipse(x, 117.5, 10, 7, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke(); // upper lid
      g.strokeStyle = p.hair; g.lineWidth = 4.2; g.beginPath(); g.moveTo(x - s * 10, 104); g.quadraticCurveTo(x, 100, x + s * 11, 103); g.stroke();
    }
    g.strokeStyle = 'rgba(70,30,20,.28)'; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.arc(256, 128, 5, .15 * Math.PI, .85 * Math.PI); g.stroke();
    g.strokeStyle = 'rgba(110,40,35,.8)'; g.lineWidth = 2.8; g.beginPath(); g.arc(256, 134, 11, .22 * Math.PI, .78 * Math.PI); g.stroke();
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
  add(torso, new THREE.TorusGeometry(.052, .012, 8, 18), mat(kit.trim, .86)).position.z = Z1 - .004;      // collar
  add(torso, new THREE.CylinderGeometry(.043, .05, .1, 14).rotateX(Math.PI / 2), skin).position.z = Z1 + .03; // neck
  const sleeve = mat(kit.pattern === 'sleeves' ? kit.colors[1] : kit.colors[0], .86), cuff = mat(kit.trim, .86);
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0, s * SHOULDER_Y, SHOULDER); torso.add(piv); arms.push(piv);
    add(piv, limb(.125, .056, .05), sleeve);
    add(piv, new THREE.CylinderGeometry(.052, .052, .02, 14).rotateX(Math.PI / 2), cuff).position.z = -.134;
    add(piv, limb(.235, .04, .034), skin);
    const elbow = new THREE.Group(); elbow.position.z = -.235; piv.add(elbow); elbows.push(elbow);
    add(elbow, limb(.215, .034, .027), skin);
    const hand = add(elbow, ball(.034, 12, 10), skin); hand.scale.set(1, .6, 1.3); hand.position.z = -.25;    // a flat hand, palm to the body
    const thumb = add(elbow, ball(.014, 8, 6), skin); thumb.scale.z = 1.7; thumb.position.set(.028, -s * .006, -.234);
  }
  const head = new THREE.Group(); head.rotation.order = 'ZYX'; head.position.z = HEAD; head.scale.set(1, .92, 1.1); torso.add(head);
  add(head, headGeo(), mat('#ffffff', .62, { map: faceTex(p) }));
  for (const s of [-1, 1]) add(head, ball(.028, 10, 8), skin).position.set(-.006, s * .121, -.012);          // ears
  addHair(head, p, kit, R, mat, add);
  const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); blob.position.z = .012; g.add(blob);
  g.rotation.order = 'ZYX';
  g.userData = { mats, legs, arms, elbows, pelvis, torso, head, blob, yaw: null, seed: Math.random() * 6 };
  return g;
}
