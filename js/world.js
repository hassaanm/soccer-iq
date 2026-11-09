// three.js renderer in a low-poly pastel style (inspired by A Short Hike).
// All art lives here so another style can replace this file later.
import * as THREE from 'three';
import { PITCH } from './skills.js';
import { DRIBBLE_DIRS, clamp } from './geom.js';
import { Particles } from './fx.js';

const { L, W, gy0, gy1, gh } = PITCH;
const CX = L / 2, CY = W / 2, UP = new THREE.Vector3(0, 0, 1);
// Art style: 'lowpoly' (faceted, the default) or 'smooth' (more polygons, soft shading). Set once when the World is made.
const ART = { smooth: false };
const SEG = n => ART.smooth ? n * 3 : n;
const M = (c, o = {}) => ART.smooth ? new THREE.MeshStandardMaterial({ color: c, roughness: .72, ...o }) : new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Shirt + shorts wrapped around the body. The lathe starts at phi = PI/8 so a flat facet sits at the middle of the
// chest and back; that puts the chest at u = 0.1875 (x = 96 of 512) and the back at u = 0.6875 (x = 352).
// Drawn at 2x so the name stays crisp. Number high on the back, name just above the shorts, where the camera
// (behind and above the player) can see it past the head.
const BACK = 352, CHEST = 96;
function bodyTex(kit, p) {
  return canvasTex(1024, 512, g => {
    g.scale(2, 2);
    g.fillStyle = kit.colors[0]; g.fillRect(0, 0, 512, 256);
    if (kit.pattern === 'stripes') { g.fillStyle = kit.colors[1]; for (let i = 0; i < 16; i += 2) g.fillRect(i * 32 + 16, 0, 32, 256); }
    if (kit.pattern === 'band') for (const c of [CHEST, BACK]) { g.fillStyle = '#fff'; g.fillRect(c - 30, 0, 60, 256); g.fillStyle = kit.colors[1]; g.fillRect(c - 20, 0, 40, 256); }
    g.fillStyle = kit.shorts; g.fillRect(0, 176, 512, 80);
    g.fillStyle = kit.trim; g.fillRect(0, 0, 512, 12);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.5)';
    g.font = '900 74px system-ui,sans-serif'; g.lineWidth = 9;
    g.strokeText(p.num, BACK, 94, 120); g.fillStyle = kit.num; g.fillText(p.num, BACK, 94, 120);
    g.font = '900 36px system-ui,sans-serif'; g.lineWidth = 7;
    g.strokeText(p.name, BACK, 150, 150); g.fillText(p.name, BACK, 150, 150);
    g.fillStyle = kit.trim; g.beginPath(); g.arc(CHEST + 22, 60, 11, 0, 7); g.fill();
  });
}
// Simple face: two dark eyes and a small smile, painted at u = 0.5 (front after rotateX).
function faceTex(p) {
  return canvasTex(512, 256, g => {
    g.fillStyle = p.skin; g.fillRect(0, 0, 512, 256);
    for (const s of [-1, 1]) {
      g.fillStyle = 'rgba(255,120,110,.22)'; g.beginPath(); g.ellipse(256 + s * 40, 132, 11, 7, 0, 0, 7); g.fill();      // cheeks
      g.fillStyle = '#1d1410'; g.beginPath(); g.ellipse(256 + s * 25, 116, 6.5, 8.5, 0, 0, 7); g.fill();                  // eyes
      g.fillStyle = '#fff'; g.beginPath(); g.arc(256 + s * 25 - 2, 112, 2.2, 0, 7); g.fill();                               // catchlight
      g.strokeStyle = p.hair; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(256 + s * 17, 101); g.lineTo(256 + s * 33, 99); g.stroke(); // brows
    }
    g.fillStyle = 'rgba(0,0,0,.08)'; g.beginPath(); g.ellipse(256, 125, 4, 3, 0, 0, 7); g.fill();                          // nose
    g.strokeStyle = '#5a2a1c'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.arc(256, 132, 7, .2 * Math.PI, .8 * Math.PI); g.stroke();
  });
}
// Soft dark spot under each player so they sit on the grass.
const blobTex = canvasTex(64, 64, g => {
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(30,20,40,.42)'); r.addColorStop(1, 'rgba(30,20,40,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});
const glowTex = canvasTex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(255,230,120,1)'); r.addColorStop(.55, 'rgba(255,210,63,.55)'); r.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
// The spot under a player is the same for everyone: one shape and one material, shared and never thrown away.
const BLOB_GEO = new THREE.CircleGeometry(.42, 16), BLOB_MAT = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
BLOB_GEO.userData.shared = true;
const IDS = ['hero', 'm1', 'm2', 'o1', 'o2', 'o3']; // the sim's player ids: three of ours, three of theirs

// One-piece body (lathe) with capsule legs and arms and a sphere head. Low segment counts give the faceted look.
const PROFILE = [[0, 0], [.15, 0], [.185, .05], [.19, .15], [.165, .27], [.17, .36], [.2, .48], [.215, .56], [.2, .63], [.14, .68], [.06, .705], [0, .71]];
function makeRig(p, kit, isHero) {
  const g = new THREE.Group(), mats = [], legs = [], arms = [];
  const mat = c => { const m = M(c); mats.push(m); return m; };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, SEG(1) + 1, SEG(6)).rotateX(Math.PI / 2);
  const sph = r => new THREE.SphereGeometry(r, SEG(10), SEG(8)).rotateX(Math.PI / 2);
  const add = (parent, geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const Lg = .42, hipZ = Lg + .06, skin = mat(p.skin), bodyH = .62, hs = bodyH / .71;
  const sock = mat(kit.socks), boot = mat(isHero ? '#f59e0b' : '#1d1f26');
  for (const s of [-1, 1]) {
    // Hip joint → thigh, knee joint → shin and boot, so legs bend instead of swinging stiff.
    const hip = new THREE.Group(); hip.position.set(0, s * .08, hipZ); g.add(hip);
    add(hip, cap(.062, Lg * .3), skin).position.z = -Lg * .24;
    const knee = new THREE.Group(); knee.position.z = -Lg * .5; hip.add(knee);
    add(knee, cap(.068, Lg * .3), sock).position.z = -Lg * .24;
    const bt = add(knee, sph(.085), boot); bt.scale.set(1.5, .95, .7); bt.position.set(.05, 0, -Lg * .5 + .03);
    legs.push({ hip, knee });
  }
  const body = add(g, new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), SEG(8), Math.PI / 8).rotateX(Math.PI / 2),
    (() => { const m = M('#ffffff', { map: bodyTex(kit, p) }); mats.push(m); return m; })());
  body.position.z = hipZ - .1; body.scale.set(.72, .9, hs);
  const top = hipZ - .1 + bodyH;
  const sleeve = mat(kit.pattern === 'sleeves' ? kit.colors[1] : kit.colors[0]);
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0, s * .19, top - .13 * hs); piv.rotation.x = s * .16; g.add(piv); arms.push(piv);
    add(piv, cap(.068, .05), sleeve).position.z = -.05;
    add(piv, cap(.05, .17), skin).position.z = -.18;
  }
  const R = .26, hz = top + R * .78;
  add(g, sph(R), (() => { const m = M('#ffffff', { map: faceTex(p) }); mats.push(m); return m; })()).position.z = hz;
  addHair(g, p, kit, hz, R, mat, add);
  const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
  blob.position.z = .012; g.add(blob);
  g.rotation.order = 'ZYX';
  g.userData = { mats, legs, arms, yaw: null, seed: Math.random() * 6 };
  return g;
}
// Frees what one player's body owns: its shapes, its materials and the two painted textures (shirt and face).
// The canvases behind those textures are emptied too: iOS counts canvas memory until the garbage collector runs.
// The shared spot under him (BLOB_GEO, BLOB_MAT, blobTex) is left alone.
function disposeRig(g) {
  g.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
  for (const m of g.userData.mats) {
    if (m.map) { const cv = m.map.image; m.map.dispose(); cv.width = cv.height = 0; }
    m.dispose();
  }
}
// Everything about a team that changes how its players look. Same key: the bodies already built can stay.
const lookKey = team => JSON.stringify([ART.smooth, team.kit, team.players.slice(0, 3)]);

// Hair. Styles are picked from a hash of the name unless the player sets p.hairStyle.
// The face is painted at +x: eyes ~8 degrees above the equator, brows ~20. Every piece stays above ~23 degrees
// at the front (or behind the ears at the sides), so hair never covers the face.
const HAIR_STYLES = ['buzz', 'curly', 'quiff', 'spiky', 'bun', 'swept', 'afro', 'headband', 'long'];
function nameHash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
function addHair(g, p, kit, hz, R, mat, add) {
  const style = HAIR_STYLES.includes(p.hairStyle) ? p.hairStyle : HAIR_STYLES[nameHash(p.name || '') % HAIR_STYLES.length];
  const hairM = mat(p.hair), Y = new THREE.Vector3(0, 1, 0);
  // Shell of a sphere around the head. Pole on +z; tilt < 0 lifts the front edge to `-tilt` radians above the equator.
  const shell = (r, theta, tilt, phi0 = 0, phiLen = Math.PI * 2) =>
    new THREE.SphereGeometry(r, SEG(10), SEG(7), phi0, phiLen, 0, theta).rotateX(Math.PI / 2).rotateY(tilt);
  // Point on the head at azimuth az (0 = front) and elevation el, at distance d * R from the head centre.
  const at = (az, el, d) => new THREE.Vector3(Math.cos(az) * Math.cos(el) * R * d, Math.sin(az) * Math.cos(el) * R * d, hz + Math.sin(el) * R * d);
  const lump = (r, pos, sx = 1, sy = 1, sz = 1, detail = 0) => { const m = add(g, new THREE.IcosahedronGeometry(r, ART.smooth ? detail + 2 : detail), hairM); m.position.copy(pos); m.scale.set(sx, sy, sz); return m; };
  const capOn = (r = 1.06, tilt = -.4) => add(g, shell(R * r, Math.PI * .5, tilt), hairM).position.set(-.01, 0, hz + .01);
  // Back half only (behind the ears), reaching lower than the cap. Back half of the raw sphere is phi in (-PI/2, PI/2).
  const backShell = (r, theta, m = hairM, spread = 1) => add(g, shell(R * r, theta, 0, -Math.PI / 2 * spread, Math.PI * spread), m).position.set(-.005, 0, hz);

  if (style === 'buzz') {
    capOn(1.03, -.42);
    backShell(1.015, Math.PI * .7, mat(new THREE.Color(p.hair).lerp(new THREE.Color(p.skin), .45))); // faded sides and back
  } else if (style === 'curly') {
    capOn(1.04, -.45);
    for (let i = 0; i < 8; i++) lump(R * .3, at(Math.PI * (.3 + 1.4 * i / 7), .42, .97));     // lower ring, sides and back only
    for (let i = 0; i < 6; i++) lump(R * .3, at(i / 6 * Math.PI * 2 + .3, .95, .95));          // upper ring
    lump(R * .32, at(0, Math.PI / 2, .98));
  } else if (style === 'quiff') {
    capOn(1.05, -.42);
    const q = lump(R * .44, at(.0, 1.05, .9), 1.25, .95, .7); q.rotation.y = -.45;
    lump(R * .3, at(Math.PI, .9, .88), 1.1, 1, .7);
  } else if (style === 'spiky') {
    capOn(1.04, -.42);
    const cone = new THREE.ConeGeometry(R * .17, R * .55, 4);
    for (const [az, el] of [[0, .78], [.9, .7], [-.9, .7], [2, .55], [-2, .55], [Math.PI, .6], [.45, 1.2], [-.45, 1.2], [2.6, 1.05], [-2.6, 1.05], [0, 1.5]]) {
      const d = at(az, el, 1).sub(new THREE.Vector3(0, 0, hz)).normalize(), m = add(g, cone, hairM);
      m.position.copy(at(az, el, 1.08)); m.quaternion.setFromUnitVectors(Y, d);
    }
  } else if (style === 'bun') {
    capOn(1.035, -.45);
    lump(R * .34, at(Math.PI, 1.1, 1.3), 1, 1, 1, 1);
    const band = add(g, new THREE.TorusGeometry(R * .15, R * .07, 4, 10), mat(kit.trim));
    band.position.copy(at(Math.PI, 1.1, 1.03)); band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), at(Math.PI, 1.1, 1).sub(new THREE.Vector3(0, 0, hz)).normalize());
  } else if (style === 'swept') {
    capOn(1.06, -.42);
    const s = (p.name || '').length % 2 ? 1 : -1;
    const f = lump(R * .42, at(s * .35, .82, .92), .75, 1.55, .5); f.rotation.x = -s * .35; f.rotation.y = -.35;
    lump(R * .3, at(-s * 1.6, .55, .95), .8, 1, .9);
  } else if (style === 'afro') {
    capOn(1.04, -.45);
    const c = new THREE.Vector3(-.085, 0, hz + .095), big = R * 1.16;
    lump(big, c, 1, 1, .95, 1);
    for (const [az, el] of [[1.3, .35], [-1.3, .35], [2.2, .55], [-2.2, .55], [Math.PI, .2], [.8, .95], [-.8, .95], [2.6, 1.1], [-2.6, 1.1]])
      lump(R * .36, c.clone().add(new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)).multiplyScalar(big * .9)));
  } else if (style === 'headband') {
    capOn(1.06, -.4);
    backShell(1.07, Math.PI * .7, hairM, 1.1);
    const band = add(g, new THREE.TorusGeometry(R * 1.07, R * .065, 4, 18).rotateY(-.52), mat(kit.trim));
    band.position.set(-.005, 0, hz);
  } else { // long
    capOn(1.07, -.42);
    backShell(1.09, Math.PI * .78, hairM, 1.15);
    const f = lump(R * .34, at(.5, .75, .95), .7, 1.3, .5); f.rotation.x = -.3;
  }
}

// Procedural run cycle driven by distance covered (so feet don't skate), with a knee bend,
// body bob and lean, dribble touches with the laces / inside / outside, and a kick wind-up.
const STEP = .7, TOUCH = 1.4; // meters per step; one ball touch every two steps (matches sim.js)
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
const TOUCH_TURN = [0, -.55, .45]; // how far the foot turns for a touch with the laces / inside / outside
// mood: > 0 while his team celebrates a goal (jumping, arms up), < 0 while the other team does (head down).
function animate(g, a, sim, mood = 0, moodT = 0) {
  const u = g.userData, run = Math.min(1, a.sp / 4.5), ph = a.dist / STEP * Math.PI;
  const want = Math.atan2(a.face[1], a.face[0]);
  if (u.yaw === null) u.yaw = want;
  u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * .3;
  g.position.set(a.x, a.y, run * .05 * Math.abs(Math.sin(ph)));
  g.rotation.z = u.yaw; g.rotation.y = run * .16;
  const kick = a.kickAt != null ? (sim.time - a.kickAt) / .45 : 9;
  const carrying = sim.ball.state === 'carried' && sim.ball.carrier === a.id;
  const cyc = (a.dist % TOUCH) / TOUCH, touch = Math.floor(a.dist / TOUCH) % 3;
  const swing = Math.sin(ph + Math.PI / 2);
  for (let i = 0; i < 2; i++) { // plain loops here and below: this runs for six players every frame
    const { hip, knee } = u.legs[i], sgn = i ? 1 : -1, sw = swing * sgn;
    // Standing still: a ready stance (defenders crouch a bit more) with a slow breath.
    const ready = (1 - run) * (a.team === 'them' ? .34 : .16) + (1 - run) * .04 * Math.sin(sim.time * 2.2 + a.x);
    let h = -sw * .7 * run - ready * .45, k = run * (.15 + .9 * Math.max(0, -sw)) + ready, turn = 0;
    if (carrying && i === 1 && run > .2 && cyc < .18) turn = TOUCH_TURN[touch] * run;
    if (i === 1 && kick < 1) {
      const t = kick;
      h = t < .4 ? lerp(0, .9, t / .4) : t < .62 ? lerp(.9, -1.25, (t - .4) / .22) : lerp(-1.25, 0, (t - .62) / .38);
      k = t < .4 ? lerp(.1, 1.3, t / .4) : t < .62 ? lerp(1.3, .1, (t - .4) / .22) : .1;
    }
    hip.rotation.set(0, h, turn); knee.rotation.y = k;
  }
  for (let i = 0; i < 2; i++) { const sgn = i ? 1 : -1; u.arms[i].rotation.y = swing * sgn * .8 * run + (kick < 1 ? -.6 * sgn : 0); }
  if (mood > 0) {
    const hop = Math.abs(Math.sin(moodT * 7.5 + u.seed));
    g.position.z += .34 * hop * mood;
    for (let i = 0; i < 2; i++) {
      const arm = u.arms[i], knee = u.legs[i].knee;
      arm.rotation.y = lerp(arm.rotation.y, -2.75 + .3 * Math.sin(moodT * 15 + i * 2 + u.seed), mood);
      knee.rotation.y = lerp(knee.rotation.y, .7 * (1 - hop), mood);
    }
  } else if (mood < 0) g.rotation.y = lerp(g.rotation.y, .26, -mood);
}

// A curved arrow lying on the ground: a band of radius r and width w from angle a0 to a1 (either direction),
// ending in an arrowhead at a1. Angles are in the pitch's x/y plane, around the player's feet.
function turnArrowGeo(a0, a1, r, w) {
  const sh = new THREE.Shape(), dir = Math.sign(a1 - a0) || 1, head = Math.min(.55 / r, Math.abs(a1 - a0) * .45) * dir, aEnd = a1 - head;
  const P = (rad, a) => [Math.cos(a) * rad, Math.sin(a) * rad];
  sh.moveTo(...P(r + w / 2, a0));
  sh.absarc(0, 0, r + w / 2, a0, aEnd, dir < 0);
  sh.lineTo(...P(r + w * 1.15, aEnd)); sh.lineTo(...P(r, a1)); sh.lineTo(...P(r - w * 1.15, aEnd)); sh.lineTo(...P(r - w / 2, aEnd));
  sh.absarc(0, 0, r - w / 2, aEnd, a0, dir > 0);
  return new THREE.ShapeGeometry(sh, 32);
}

// Soccer ball: a smooth sphere painted per pixel as a truncated icosahedron (12 black pentagons, 20 white hexagons).
// Each pixel takes the panel whose face plane its direction hits first; seams go where the two best panels are close.
function makeBall(r) {
  const t = (1 + Math.sqrt(5)) / 2, v3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(p => v3(...p));
  const hex = [];
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) {
    const near = (i, j) => V[i].dot(V[j]) > .4; // neighbours on the icosahedron
    if (near(a, b) && near(b, c) && near(a, c)) hex.push(V[a].clone().add(V[b]).add(V[c]).normalize());
  }
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPent = { value: V }; sh.uniforms.uHex = { value: hex };
    sh.vertexShader = 'varying vec3 vBallPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallPos = position;');
    sh.fragmentShader = 'varying vec3 vBallPos;\nuniform vec3 uPent[12];\nuniform vec3 uHex[20];\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 bp = normalize(vBallPos);
      float b1 = -2.0, b2 = -2.0, pent = 0.0;
      for (int i = 0; i < 12; i++) { float s = dot(bp, uPent[i]) * 0.9742; if (s > b1) { b2 = b1; b1 = s; pent = 1.0; } else if (s > b2) b2 = s; }
      for (int i = 0; i < 20; i++) { float s = dot(bp, uHex[i]); if (s > b1) { b2 = b1; b1 = s; pent = 0.0; } else if (s > b2) b2 = s; }
      float e = b1 - b2, fw = fwidth(e) + 1e-4;
      vec3 panel = mix(vec3(0.96, 0.96, 0.94), vec3(0.08, 0.08, 0.1), pent);
      diffuseColor.rgb *= mix(panel, vec3(0.2, 0.2, 0.24), 1.0 - smoothstep(0.018 - fw, 0.018 + fw, e));`);
  };
  return new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), mat);
}

const WALLS = [{ a: [L + 6, -6], b: [L + 6, W + 6], o: [1, 0] }, { a: [-6, W + 6], b: [-6, -6], o: [-1, 0] },
  { a: [L + 6, W + 6], b: [-6, W + 6], o: [0, 1] }, { a: [-6, -6], b: [L + 6, -6], o: [0, -1] }];

export class World {
  constructor(canvas, { art = 'lowpoly' } = {}) {
    ART.smooth = art === 'smooth';
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // sharp enough with antialias, and leaves the phone room for sound
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffc89a'); scene.fog = new THREE.Fog('#ffd6b0', 45, 170);
    // Sky: a big dome fading from warm peach at the horizon to soft blue overhead, with a few low-poly clouds.
    const dome = new THREE.SphereGeometry(300, 24, 12), cols = [], v = new THREE.Vector3(), lo = new THREE.Color('#ffd2a6'), hi = new THREE.Color('#7fb8e8');
    for (let i = 0; i < dome.attributes.position.count; i++) { v.fromBufferAttribute(dome.attributes.position, i); const t = Math.max(0, Math.min(1, v.y / 160)); const c = lo.clone().lerp(hi, Math.pow(t, .7)); cols.push(c.r, c.g, c.b); }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); dome.rotateX(Math.PI / 2);
    const sky = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false }));
    sky.position.set(CX, CY, 0); scene.add(sky);
    const cloudM = new THREE.MeshLambertMaterial({ color: '#fff6ee', flatShading: true, emissive: '#ffe9d6', emissiveIntensity: .45, fog: false });
    this.clouds = new THREE.Group(); this.clouds.position.set(CX, CY, 0); scene.add(this.clouds); // they drift slowly around the pitch
    for (let k = 0; k < 11; k++) {
      const a = k / 11 * Math.PI * 2 + .3, d = 140 + (k % 3) * 28, cl = new THREE.Group(), n = 3 + k % 3;
      for (let j = 0; j < n; j++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + ((j + k) % 3) * 3.5, 0), cloudM); b.position.set((j - (n - 1) / 2) * 10, (j % 2) * 4 - 2, (j % 2) * 3); b.scale.z = .55; cl.add(b); }
      cl.position.set(Math.cos(a) * d, Math.sin(a) * d, 36 + (k % 4) * 8); cl.rotation.z = a + Math.PI / 2; this.clouds.add(cl);
    }
    this.camera = new THREE.PerspectiveCamera(40, 2, .1, 500); this.camera.up.set(0, 0, 1);
    const hemi = new THREE.HemisphereLight('#ffe0c0', '#6e9a5a', .95); hemi.position.set(0, 0, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe6c4', 1.9); sun.position.set(-8, -12, 30); sun.target.position.set(CX, CY, 0); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.bias = -.0004; Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 }); scene.add(sun);
    this.sun = sun;

    this.buildPitch(); this.buildEnv(); this.buildMarkers();
    this.ball = makeBall(.2); this.ballPrev = null;
    this.ball.castShadow = true; scene.add(this.ball);
    this.ballBlob = new THREE.Mesh(new THREE.CircleGeometry(.3, 16), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); scene.add(this.ballBlob);
    this.particles = new Particles(scene); this.shake = 0; this.punch = 0; this.mood = null;
    this.rigs = new Map(); this.teamKeys = { us: null, them: null }; this.tmp = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.axis = new THREE.Vector3();
    // The canvas size in CSS px (`width`, `height`) is kept here, so nothing asks the page for it every frame:
    // reading clientWidth makes the browser lay the page out again. It is measured again whenever the canvas
    // box, the window or the screen's orientation changes; `render` then resizes the picture to match.
    this.width = this.height = 0; this.resized = true;
    const measure = () => this.measure();
    this.watched = typeof ResizeObserver !== 'undefined'; // an old browser without it: `render` measures every frame, as before
    if (this.watched) new ResizeObserver(measure).observe(canvas);
    addEventListener('resize', measure); addEventListener('orientationchange', measure);
    this.measure();
  }
  measure() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.width || h !== this.height) { this.width = w; this.height = h; this.resized = true; }
  }

  buildPitch() {
    const ppm = 40, TW = (L + 12) * ppm, TH = (W + 12) * ppm;
    const tex = canvasTex(TW, TH, g => {
      const X = x => (x + 6) * ppm, Y = y => (W + 6 - y) * ppm;
      g.fillStyle = '#a9d67a'; g.fillRect(0, 0, TW, TH);
      // Mown bands along the pitch and lighter ones across it, for a soft checker like a real match pitch.
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#8cc65b' : '#9dd56a'; g.fillRect(X(i * 3), Y(W), 3 * ppm, W * ppm); }
      for (let j = 0; j < 5; j++) { g.fillStyle = j % 2 ? 'rgba(255,255,215,.085)' : 'rgba(20,80,20,.035)'; g.fillRect(X(0), Y((j + 1) * 4), L * ppm, 4 * ppm); }
      const pool = g.createRadialGradient(X(CX), Y(CY), 2 * ppm, X(CX), Y(CY), 20 * ppm); // sunlight pooling in the middle
      pool.addColorStop(0, 'rgba(255,250,200,.13)'); pool.addColorStop(1, 'rgba(255,250,200,0)'); g.fillStyle = pool; g.fillRect(0, 0, TW, TH);
      let sd = 5; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 16000; k++) { g.fillStyle = rr() < .5 ? 'rgba(40,90,30,.10)' : 'rgba(255,255,210,.09)'; g.fillRect(rr() * TW, rr() * TH, 2, 6); }
      // Lines, drawn as strokes so the circle and the corners stay smooth.
      g.strokeStyle = g.fillStyle = 'rgba(255,255,255,.96)'; g.lineWidth = Math.round(.14 * ppm); g.lineJoin = 'round';
      const line = (x0, y0, x1, y1) => { g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke(); };
      const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(X(x), Y(y), r * ppm, a0, a1); g.stroke(); };
      g.strokeRect(X(0), Y(W), L * ppm, W * ppm); line(CX, 0, CX, W);
      for (const [x0, x1] of [[0, 3], [L, L - 3]]) { line(x0, gy0 - 2, x1, gy0 - 2); line(x0, gy1 + 2, x1, gy1 + 2); line(x1, gy0 - 2, x1, gy1 + 2); }
      arc(CX, CY, 2.5, 0, Math.PI * 2);
      g.beginPath(); g.arc(X(CX), Y(CY), .2 * ppm, 0, Math.PI * 2); g.fill();
      const Q = Math.PI / 2; // corner arcs (canvas y runs down, so the angles are mirrored)
      arc(0, 0, .8, -Q, 0); arc(L, 0, .8, Math.PI, Math.PI + Q); arc(0, W, .8, 0, Q); arc(L, W, .8, Q, Math.PI);
    });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 12, W + 12), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.position.set(CX, CY, 0); pitch.receiveShadow = true; this.scene.add(pitch);
    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: '#a9d67a' }));
    this.outer.position.set(CX, CY, -.02); this.outer.receiveShadow = true; this.scene.add(this.outer);
    // Goals: white frame and a simple box net (back, sides and a flat top), with a faint fill so it reads as netting.
    const netCanvas = document.createElement('canvas'); netCanvas.width = netCanvas.height = 64;
    const ng = netCanvas.getContext('2d'); ng.fillStyle = 'rgba(255,255,255,.16)'; ng.fillRect(0, 0, 64, 64);
    ng.strokeStyle = 'rgba(255,255,255,.95)'; ng.lineWidth = 6; ng.strokeRect(0, 0, 64, 64);
    const netMat = (w, h) => {
      const t = new THREE.CanvasTexture(netCanvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / .2, h / .2); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    };
    const depth = 1.1, gw = gy1 - gy0, frame = M('#ffffff'), rear = M('#d9dde3');
    const bar = (len, r, m, axis) => { const g = new THREE.CylinderGeometry(r, r, len, 8); if (axis === 'z') g.rotateX(Math.PI / 2); if (axis === 'x') g.rotateZ(Math.PI / 2); const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
    this.nets = [];
    for (const [gx, dir] of [[L, 1], [0, -1]]) {
      const bx = gx + dir * depth, add = (o, x, y, z) => { o.position.set(x, y, z); this.scene.add(o); return o; };
      for (const y of [gy0, gy1]) {
        add(bar(gh, .07, frame, 'z'), gx, y, gh / 2);           // front posts
        add(bar(gh, .03, rear, 'z'), bx, y, gh / 2);            // back posts
        add(bar(depth, .03, rear, 'x'), gx + dir * depth / 2, y, gh); // top side bars
        add(bar(depth, .03, rear, 'x'), gx + dir * depth / 2, y, .03);
      }
      add(bar(gw, .07, frame), gx, CY, gh);                       // crossbar
      add(bar(gw, .03, rear), bx, CY, gh);
      add(bar(gw, .03, rear), bx, CY, .03);
      // The back net has enough points to bulge when a shot hits it (see `fx('goal')` and `moveNets`).
      const back = add(new THREE.Mesh(new THREE.PlaneGeometry(gw, gh, 20, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), netMat(gw, gh)), bx, CY, gh / 2);
      this.nets.push({ mesh: back, base: back.geometry.attributes.position.array.slice(), dir, x: gx, t: 9, y: 0, z: 0 });
      for (const y of [gy0, gy1]) add(new THREE.Mesh(new THREE.PlaneGeometry(depth, gh).rotateX(Math.PI / 2), netMat(depth, gh)), gx + dir * depth / 2, y, gh / 2);
      add(new THREE.Mesh(new THREE.PlaneGeometry(depth, gw), netMat(depth, gw)), gx + dir * depth / 2, CY, gh);
    }
    // Corner flags that wave a little.
    const poleM = M('#fff8e8'), flagM = new THREE.MeshLambertMaterial({ color: '#ff6b5e', side: THREE.DoubleSide });
    const flagG = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.45, .55, 0, 1.3, 0, 0, 1.15], 3)); flagG.computeVertexNormals();
    this.flags = [[0, 0], [L, 0], [0, W], [L, W]].map(([x, y]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.5, 5).rotateX(Math.PI / 2), poleM); pole.position.set(x, y, .75); pole.castShadow = true;
      const flag = new THREE.Mesh(flagG, flagM); flag.position.set(x, y, 0); flag.castShadow = true;
      this.scene.add(pole, flag); return flag;
    });
  }
  // A shot that hits the net pushes it out around the ball; it swings back and settles.
  moveNets(dt) {
    for (const n of this.nets) {
      if (n.t > 1.8) continue;
      n.t += dt;
      const pos = n.mesh.geometry.attributes.position, amp = n.t > 1.8 ? 0 : .6 * Math.min(1, n.t / .05) * Math.exp(-2.6 * n.t) * Math.cos(10 * n.t);
      for (let i = 0; i < pos.count; i++) {
        const y = n.base[i * 3 + 1], z = n.base[i * 3 + 2], pin = Math.cos(Math.PI * y / (gy1 - gy0)) * Math.cos(Math.PI * z / gh); // the edges are tied to the frame
        const d2 = (y - n.y) ** 2 + (z - n.z) ** 2;
        pos.array[i * 3] = n.base[i * 3] + n.dir * amp * pin * (.35 + Math.exp(-d2 / .7));
      }
      pos.needsUpdate = true;
    }
  }

  buildEnv() {
    const park = this.park = new THREE.Group(), stands = this.stands = new THREE.Group(), crowd = this.crowd = new THREE.Group();
    let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Trees: pines (two cones) and round trees, all drawn as three instanced meshes.
    const trees = [], tree = (x, y, s) => trees.push({ x, y, s, round: rand() < .3, c: Math.floor(rand() * 3) });
    for (let x = -12; x <= L + 12; x += 4) { tree(x + rand() * 2, -11 - rand() * 4, 4 + rand() * 2.5); tree(x + rand() * 2, W + 11 + rand() * 4, 4 + rand() * 2.5); }
    for (let y = -6; y <= W + 6; y += 4) { tree(-13 - rand() * 4, y + rand() * 2, 4 + rand() * 2.5); tree(L + 13 + rand() * 4, y + rand() * 2, 4 + rand() * 2.5); }
    for (let k = 0; k < 46; k++) { const a = rand() * Math.PI * 2, d = 30 + rand() * 38; tree(CX + Math.cos(a) * d * 1.25, CY + Math.sin(a) * d, 3.5 + rand() * 4); } // a thinner ring further out
    const pines = trees.filter(t => !t.round), rounds = trees.filter(t => t.round), GREENS = ['#5fae7a', '#7cc58a', '#3f8f6e'], BLOSSOM = ['#7cc58a', '#f6b7c1', '#9ccf86'];
    const inst = (geo, n) => { const m = new THREE.InstancedMesh(geo, M('#ffffff'), n); m.castShadow = true; park.add(m); return m; };
    const trunks = inst(new THREE.CylinderGeometry(.18, .25, 1, 5).rotateX(Math.PI / 2), trees.length);
    const cones = inst(new THREE.ConeGeometry(1, 2.2, 6).rotateX(Math.PI / 2), pines.length * 2), balls = inst(new THREE.IcosahedronGeometry(1, 0), rounds.length);
    const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3(), tc = new THREE.Color();
    const put = (mesh, k, x, y, z, sx, sz, color, spin = 0) => { mesh.setMatrixAt(k, tm.compose(tv.set(x, y, z), tq.setFromAxisAngle(UP, spin), ts.set(sx, sx, sz))); mesh.setColorAt(k, tc.set(color)); };
    trees.forEach((t, k) => put(trunks, k, t.x, t.y, t.s * .225, 1, t.s * .45, '#7a5434'));
    pines.forEach((t, k) => {
      put(cones, k * 2, t.x, t.y, t.s * .68, t.s * .36, t.s * .3, GREENS[t.c], k);
      put(cones, k * 2 + 1, t.x, t.y, t.s * 1.02, t.s * .25, t.s * .24, tc.set(GREENS[t.c]).lerp(new THREE.Color('#d8f0a8'), .22).getStyle(), k + .5);
    });
    rounds.forEach((t, k) => put(balls, k, t.x, t.y, t.s * .7, t.s * .34, t.s * .32, BLOSSOM[t.c], k));
    const hillM = [M('#8cc47a'), M('#7ab38a'), M('#9ccf86')];
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2, d = 90 + rand() * 30, s = 18 + rand() * 16;
      const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), hillM[k % 3]); h.scale.set(s, s, s * .45);
      h.position.set(CX + Math.cos(a) * d, CY + Math.sin(a) * d, -s * .1); park.add(h);
    }
    const ROWS = 6, off = r => 1.5 + r * 1.1, rz = r => 1 + r * .9, ADS = ['#f2a65a', '#ffffff', '#5fae7a', '#e46a5a', '#6aa6d8'];
    const seats = [], fans = [];
    WALLS.forEach(w => {
      const alongY = !!w.o[0], len0 = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      for (let r = 0; r < ROWS; r++) {
        const h = rz(r) - .18, len = len0 + 2 * off(r);
        const m = new THREE.Mesh(alongY ? new THREE.BoxGeometry(1.1, len, h) : new THREE.BoxGeometry(len, 1.1, h), M('#d8b4a0'));
        m.position.set(mid[0] + w.o[0] * off(r), mid[1] + w.o[1] * off(r), h / 2); m.receiveShadow = true; stands.add(m);
        const n = Math.floor(len0 / .9);
        for (let k = 0; k < n; k++) {
          const t = (k + .5) / n, x = w.a[0] + (w.b[0] - w.a[0]) * t + w.o[0] * off(r), y = w.a[1] + (w.b[1] - w.a[1]) * t + w.o[1] * off(r);
          seats.push({ x, y, z: rz(r), c: r % 2 ? '#6aa6d8' : '#5b93c7' });
          if (rand() < .56) fans.push({ x, y, z: rz(r), ph: rand() * 6.3, pick: rand(), c: ['#e46a5a', '#f2c14e', '#ffffff', '#6aa6d8', '#a36ad8'][Math.floor(rand() * 5)], s: ['#f0c8a6', '#b07a52', '#7a4e30'][Math.floor(rand() * 3)] });
        }
      }
      for (let k = 0; k < 8; k++) {
        const t = (k + .5) / 8, len = len0 / 8;
        const b = new THREE.Mesh(alongY ? new THREE.BoxGeometry(.1, len, .9) : new THREE.BoxGeometry(len, .1, .9), M(ADS[k % ADS.length]));
        b.position.set(w.a[0] + (w.b[0] - w.a[0]) * t + w.o[0] * .2, w.a[1] + (w.b[1] - w.a[1]) * t + w.o[1] * .2, .45); stands.add(b);
      }
    });
    const mtx = new THREE.Matrix4(), col = new THREE.Color();
    const seatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.45, .45, .3), M('#ffffff'), seats.length);
    seats.forEach((s, k) => { mtx.makeTranslation(s.x, s.y, s.z); seatMesh.setMatrixAt(k, mtx); seatMesh.setColorAt(k, col.set(s.c)); });
    stands.add(seatMesh);
    const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.2, .3, 1, 6).rotateX(Math.PI / 2), M('#ffffff'), fans.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(.14, 6, 5), M('#ffffff'), fans.length);
    fans.forEach((s, k) => { mtx.makeTranslation(s.x, s.y, s.z + .45); bodies.setMatrixAt(k, mtx); bodies.setColorAt(k, col.set(s.c)); mtx.makeTranslation(s.x, s.y, s.z + .85); heads.setMatrixAt(k, mtx); heads.setColorAt(k, col.set(s.s)); });
    crowd.add(bodies, heads);
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage); heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fans = fans; this.fanMeshes = { bodies, heads }; this.excite = 0;
    // Floodlight towers at the four corners (stadium only).
    const lampGlow = canvasTex(128, 128, g => {
      const r = g.createRadialGradient(64, 64, 2, 64, 64, 62); r.addColorStop(0, 'rgba(255,250,225,1)'); r.addColorStop(.3, 'rgba(255,240,190,.5)'); r.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    });
    const poleM = M('#e9e2da'), lampM = new THREE.MeshLambertMaterial({ color: '#fffbe8', emissive: '#fff3c2', emissiveIntensity: 1 });
    for (const [x, y] of [[-10, -10], [L + 10, -10], [-10, W + 10], [L + 10, W + 10]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.25, .35, 16, 6).rotateX(Math.PI / 2), poleM); pole.position.set(x, y, 8);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 2), lampM); lamp.position.set(x, y, 16.5); lamp.lookAt(CX, CY, 0);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .8 }));
      glow.position.set(x, y, 16.5); glow.scale.setScalar(13);
      stands.add(pole, lamp, glow);
    }
    this.scene.add(park, stands, crowd);
    this.setEnv('crowd');
  }
  setEnv(env) { this.park.visible = env === 'park'; this.stands.visible = env !== 'park'; this.crowd.visible = env === 'crowd'; }
  // The crowd sways a little all the time and jumps when `excite` is up (a goal, or the ball near a goal).
  moveCrowd(time) {
    if (!this.crowd.visible) return;
    const { bodies, heads } = this.fanMeshes, B = bodies.instanceMatrix.array, H = heads.instanceMatrix.array, e = this.excite;
    for (let k = 0; k < this.fans.length; k++) {
      const f = this.fans[k], up = .035 * Math.sin(time * 1.7 + f.ph) + e * .42 * Math.abs(Math.sin(time * 6.5 + f.ph));
      B[k * 16 + 14] = f.z + .45 + up; H[k * 16 + 14] = f.z + .85 + up;
    }
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  }
  // Most fans wear our colours, some wear theirs, the rest wear what they like.
  dressCrowd(us, them) {
    const { bodies } = this.fanMeshes, col = new THREE.Color(), shirt = t => (t.kit.colors[0].toLowerCase() === '#ffffff' && t.kit.colors[1]) || t.kit.colors[0];
    this.fans.forEach((f, k) => bodies.setColorAt(k, col.set(f.pick < .55 ? shirt(us) : f.pick < .75 ? shirt(them) : f.c)));
    bodies.instanceColor.needsUpdate = true;
  }

  buildMarkers() {
    const gold = () => new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
    this.heroRing = new THREE.Mesh(new THREE.RingGeometry(.46, .6, 24), gold()); this.scene.add(this.heroRing);
    // Dribble arrows: one flat shape each, gold with a rounded white outline, painted into a texture.
    const X0 = .85, X1 = 5, HALF = 1.05, TW = 512, TH = Math.round(TW * 2 * HALF / (X1 - X0));
    const arrowTex = canvasTex(TW, TH, g => {
      const px = ([x, y]) => [(x - X0) / (X1 - X0) * TW, TH / 2 - y / HALF * TH / 2];
      g.beginPath(); [[1.15, -.32], [3.5, -.32], [3.5, -.82], [4.75, 0], [3.5, .82], [3.5, .32], [1.15, .32]].map(px).forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
      g.lineJoin = 'round'; g.lineWidth = 22; g.strokeStyle = '#ffffff'; g.stroke();
      const grad = g.createLinearGradient(0, 0, TW, 0); grad.addColorStop(0, '#ffcc33'); grad.addColorStop(1, '#ffe27a');
      g.fillStyle = grad; g.fill();
    });
    const arrowGeo = new THREE.PlaneGeometry(X1 - X0, 2 * HALF).translate((X0 + X1) / 2, 0, 0);
    this.arrows = Object.fromEntries(Object.entries(DRIBBLE_DIRS).map(([k, a]) => {
      const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, depthWrite: false, toneMapped: false }));
      m.rotation.z = a; m.visible = false; this.scene.add(m); return [k, m];
    }));
    this.arrowList = Object.entries(this.arrows); // the same pairs as a list, so `render` makes no new one each frame
    // A soft gold square under each player, shown when he can be picked. They don't depend on the teams, so they
    // are made once here and kept.
    this.glows = new Map();
    const glowGeo = new THREE.PlaneGeometry(2.2, 2.2);
    for (const id of IDS) {
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.visible = false; this.scene.add(glow); this.glows.set(id, glow);
    }
    // "Peek, then turn": two curved arrows on the grass around him, each sweeping from facing the ball around to
    // the way that turn takes him. Gold with a white edge; rebuilt only when the angles change.
    this.turnArrows = new Map(); this.frame = 0;
    this.lines = new THREE.Group(); this.scene.add(this.lines); this.linesKey = ''; this.linesList = null;
    // A soft pulse under the ball when it is loose (hint for the 1v1 "Steal it!" lesson).
    this.ballGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ballGlow.visible = false; this.scene.add(this.ballGlow);
    // Defense: spots he can run to, drawn as pulsing gold rings with a soft glow.
    this.spotPool = Array.from({ length: 4 }, () => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .75, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false, toneMapped: false }));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(.18, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      ring.position.z = dot.position.z = .01; g.add(disc, ring, dot); g.visible = false; this.scene.add(g); return g;
    });
  }

  // Builds the six players. The home screen calls this on every tap of a team picker, so a side whose team did
  // not change keeps its bodies, and a body that is replaced gives back its shapes, materials and textures.
  setTeams(us, them) {
    this.resetRigs(); // every sim id drives its own body again, as it does with freshly built ones
    this.mood = null;
    let changed = false;
    for (const [side, team, ids] of [['us', us, IDS.slice(0, 3)], ['them', them, IDS.slice(3)]]) {
      const key = lookKey(team);
      if (this.teamKeys[side] === key) { for (const id of ids) this.rigs.get(id).userData.yaw = null; continue; } // kept bodies face the new way at once, like new ones
      this.teamKeys[side] = key; changed = true;
      ids.forEach((id, i) => {
        const old = this.rigs.get(id); if (old) { this.scene.remove(old); disposeRig(old); }
        const g = makeRig(team.players[i], team.kit, id === 'hero'); this.scene.add(g); this.rigs.set(id, g);
      });
    }
    if (!changed) return;
    this.home = { rigs: new Map(this.rigs), glows: new Map(this.glows) };
    this.dressCrowd(us, them);
    const kitColors = t => [...new Set([...t.kit.colors, t.kit.trim, '#ffd23f', '#ffffff'])];
    this.confetti = { us: kitColors(us), them: kitColors(them) };
  }
  // In a continuous match the child takes over whichever teammate has the ball: swap which body each sim id drives.
  swapRigs(a, b) {
    for (const m of [this.rigs, this.glows]) { const t = m.get(a); m.set(a, m.get(b)); m.set(b, t); }
  }
  resetRigs() { if (this.home) { this.rigs = new Map(this.home.rigs); this.glows = new Map(this.home.glows); } }

  // Feedback lines on the grass. The game makes a new list whenever the lines change, so the same list as last
  // frame means nothing to do; a new list is compared by its contents before anything is rebuilt.
  setLines(lines) {
    if (lines === this.linesList) return; this.linesList = lines;
    const key = lines?.length ? JSON.stringify(lines) : ''; if (key === this.linesKey) return; this.linesKey = key;
    for (const m of this.lines.children) { m.geometry.dispose(); m.material.dispose(); } // a bar and its head share one material; freeing it twice is harmless
    this.lines.clear();
    for (const l of lines || []) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, len = Math.hypot(dx, dy), m = new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: .9, depthWrite: false });
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(.1, len - .6), .32), m);
      bar.position.set(l.a.x + dx / 2 - dx / len * .3, l.a.y + dy / 2 - dy / len * .3, .05); bar.rotation.z = Math.atan2(dy, dx);
      const head = new THREE.Mesh(new THREE.CircleGeometry(.6, 3), m); head.position.set(l.b.x - dx / len * .5, l.b.y - dy / len * .5, .05); head.rotation.z = Math.atan2(dy, dx);
      this.lines.add(bar, head);
    }
  }

  // Game moments that get an effect: 'kick' (v = ball speed), 'touch', and the results of a play.
  fx(ev, v) {
    const sim = this.sim, b = sim?.ball; if (!b) return;
    const P = this.particles;
    if (ev === 'kick') { P.puff(b.x, b.y, v >= 15 ? 10 : 5); if (v >= 15) { this.shake = Math.max(this.shake, .5); P.sparks(b.x, b.y, .2, 6, ['#ffffff', '#fff3b0']); } }
    else if (ev === 'touch') P.puff(b.x, b.y, 2);
    else if (ev === 'goal' || ev === 'goalAgainst') {
      const net = this.nets[b.x > CX ? 0 : 1], team = ev === 'goal' ? 'us' : 'them', colors = this.confetti?.[team] || ['#ffd23f', '#ffffff'];
      Object.assign(net, { t: 0, y: clamp(b.y, gy0 + .3, gy1 - .3) - CY, z: clamp(.2 + (b.z || 0), .2, gh - .2) - gh / 2 });
      for (const y of [gy0 - 1.2, gy1 + 1.2]) P.confetti(net.x, y, .4, colors, team === 'us' ? 70 : 28, [-net.dir * 2.5, (CY - y) * .5]);
      if (team === 'us') P.confetti(net.x - net.dir * 4, CY, 5, colors, 50);
      this.excite = 1; this.shake = Math.max(this.shake, team === 'us' ? 1 : .6); this.punch = team === 'us' ? 1 : .4;
      this.mood = { team, t: 0, hero: sim.a('hero') };
    }
    else if (ev === 'won' || ev === 'held') { P.sparks(b.x, b.y, .3, 18); this.excite = Math.max(this.excite, .6); this.shake = Math.max(this.shake, .3); }
    else if (ev === 'kept') P.sparks(b.x, b.y, .3, 9, ['#ffffff', '#bfe8ff', '#fff3b0']);
    else if (ev === 'stolen') P.puff(b.x, b.y, 8, ['#c9b38a', '#e6d7b5', '#9ed46c']);
  }

  // Screen position (CSS px) of a world point, for tap targets.
  project(x, y, z) {
    const v = this.tmp.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.width, (1 - v.y) / 2 * this.height];
  }

  // ui: { glow: {id: 0..1}, arrows: {dir: 0..1}, lines: [...], heroRing }
  render(sim, cam, ui, time) {
    if (!this.watched) this.measure();
    const Wpx = this.width, Hpx = this.height, c = this.camera, eye = cam.eye, tgt = cam.tgt;
    if (this.resized) { this.resized = false; this.renderer.setSize(Wpx, Hpx, false); }
    // Focal length from height (Ff) and width (Fw) so wide phones don't see extra field.
    const F = Math.max(Hpx * cam.Ff, Wpx * (cam.Fw || 0)), aspect = Wpx / Hpx;
    let fov = 2 * Math.atan(Hpx / 2 / F) * 180 / Math.PI;
    c.position.set(eye[0], eye[1], eye[2]); c.lookAt(tgt[0], tgt[1], tgt[2]);
    const dt = Math.min(.05, Math.max(0, time - (this.time ?? time))); this.time = time; this.sim = sim;
    // A big moment shakes the camera for a moment and pushes in a little.
    if (this.shake > .01) {
      const k = this.shake * .09;
      c.position.x += Math.sin(time * 83) * k; c.position.y += Math.sin(time * 67 + 1) * k; c.position.z += Math.sin(time * 97 + 2) * k;
      this.shake *= Math.exp(-dt * 7);
    }
    if (this.punch > .01) { fov *= 1 - .05 * this.punch; this.punch *= Math.exp(-dt * 2.2); }
    // The lens is worked out again only when the picture's shape or the zoom changed.
    if (fov !== c.fov || aspect !== c.aspect) { c.fov = fov; c.aspect = aspect; c.updateProjectionMatrix(); }
    // Goal celebration: it ends when the next play is set up (the sim makes new players then).
    let mood = this.mood;
    if (mood && (sim.a('hero') !== mood.hero || (mood.t += dt) > 6)) mood = this.mood = null;
    const moodK = mood ? Math.min(1, mood.t / .18) * Math.min(1, (6 - mood.t) / .5) : 0;
    const pulse = .75 + .25 * Math.sin(time * 6);
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i], g = this.rigs.get(id); if (!g) continue; // no players before the first setTeams
      const a = sim.a(id), glow = this.glows.get(id);
      g.visible = !!a; glow.visible = false; if (!a) continue;
      // Anyone standing right next to the camera would fill the screen as a blur: leave them out of the picture.
      if (Math.hypot(a.x - eye[0], a.y - eye[1]) < 1.7 && eye[2] < 5) { g.visible = false; continue; }
      animate(g, a, sim, mood ? (a.team === mood.team ? moodK : -moodK) : 0, mood ? mood.t : 0);
      const s = ui.glow?.[id] || 0, mats = g.userData.mats;
      for (let j = 0; j < mats.length; j++) { mats[j].emissive.setRGB(1, .78, .2); mats[j].emissiveIntensity = s * pulse * .22; }
      if (s) { glow.visible = true; glow.position.set(a.x, a.y, .03); glow.material.opacity = s * pulse; glow.scale.setScalar(.8 + .4 * s); }
    }
    const h = sim.a('hero');
    this.heroRing.visible = !!ui.heroRing && !!h; if (h) this.heroRing.position.set(h.x, h.y, .02);
    for (let i = 0; i < this.arrowList.length; i++) {
      const k = this.arrowList[i][0], m = this.arrowList[i][1], s = ui.arrows?.[k] || 0; m.visible = !!s && !!h;
      if (m.visible) { m.position.set(h.x, h.y, .03); m.material.opacity = s >= 1 ? .92 + .08 * Math.sin(time * 5) : s * .9; }
    }
    // Turn arrows: each one is stamped with this frame's number when it is asked for; the others are hidden.
    const turns = ui.turnArrows, frame = ++this.frame;
    if (turns) for (let i = 0; i < turns.length; i++) {
      const t = turns[i], a0 = Math.round(t.a0 * 100), a1 = Math.round(t.a1 * 100); // angles to 1/100 radian, as whole numbers
      let a = this.turnArrows.get(t.id);
      if (!a || a.a0 !== a0 || a.a1 !== a1) {
        const edgeGeo = turnArrowGeo(t.a0, t.a1, 1.35, .46), fillGeo = turnArrowGeo(t.a0, t.a1, 1.35, .3);
        if (a) { a.edge.geometry.dispose(); a.fill.geometry.dispose(); a.edge.geometry = edgeGeo; a.fill.geometry = fillGeo; } // new angles: new shapes on the same meshes
        else {
          const g = new THREE.Group();
          const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, depthWrite: false, toneMapped: false }));
          const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0xffc21a, transparent: true, depthWrite: false, toneMapped: false }));
          fill.position.z = .004; g.add(edge, fill); this.scene.add(g);
          a = { g, edge, fill }; this.turnArrows.set(t.id, a);
        }
        a.a0 = a0; a.a1 = a1;
      }
      a.seen = frame; a.g.visible = !!h; if (h) a.g.position.set(h.x, h.y, .03);
      a.fill.material.opacity = .85 + .15 * Math.sin(time * 5);
    }
    for (const a of this.turnArrows.values()) if (a.seen !== frame) a.g.visible = false;
    for (let i = 0; i < this.spotPool.length; i++) {
      const g = this.spotPool[i], sp = ui.spots?.[i]; g.visible = !!sp; if (!sp) continue;
      g.position.set(sp.x, sp.y, .035); g.scale.setScalar(1 + .1 * Math.sin(time * 5 + i));
    }
    this.setLines(ui.lines);
    // Roll the ball by the distance it moved, around the axis perpendicular to its motion.
    const b = sim.ball, bp = this.ballPrev;
    if (bp) {
      const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy);
      if (d > 1e-4 && d < 3) this.ball.quaternion.premultiply(this.q.setFromAxisAngle(this.axis.set(-dy / d, dx / d, 0), d / .2));
      if (dt && b.state === 'flying' && d / dt > 13) this.particles.trail(b.x, b.y, .2 + (b.z || 0)); // a hard shot leaves a trail
      bp.x = b.x; bp.y = b.y;
    } else this.ballPrev = { x: b.x, y: b.y };
    this.ballGlow.visible = !!ui.ballGlow; if (ui.ballGlow) { this.ballGlow.position.set(b.x, b.y, .03); this.ballGlow.material.opacity = pulse; }
    this.ball.position.set(b.x, b.y, .2 + (b.z || 0));
    // The ball's own soft spot on the grass, smaller and fainter the higher it flies, so its height is easy to read.
    const bz = b.z || 0; this.ballBlob.position.set(b.x, b.y, .014); this.ballBlob.scale.setScalar(1 / (1 + bz * .5)); this.ballBlob.material.opacity = .9 / (1 + bz * .8);
    // The crowd gets louder as the ball nears a goal and calms down after.
    const nearGoal = this.crowd.visible ? clamp(1 - Math.min(Math.hypot(b.x - L, b.y - CY), Math.hypot(b.x, b.y - CY)) / 9, 0, 1) * .3 : 0;
    this.excite = Math.max(nearGoal, this.excite * Math.exp(-dt * .55));
    this.moveCrowd(time); this.moveNets(dt); this.particles.update(dt, c);
    this.clouds.rotation.z = time * .0035;
    for (let i = 0; i < this.flags.length; i++) this.flags[i].rotation.z = .6 + i * 1.3 + Math.sin(time * 3.1 + i) * .35 + Math.sin(time * 7.3 + i * 2) * .1;
    this.heroRing.scale.setScalar(1 + .05 * Math.sin(time * 4));
    this.renderer.render(this.scene, c);
  }
}
