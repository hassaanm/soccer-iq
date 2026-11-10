// Player bodies for the 'pro' art style: a young athlete about five heads tall, with a separate shirt, shorts,
// socks and boots, knees and elbows that bend, and a soft light along his edges (rim light) so he stands out
// from the grass. The body faces +x, z is up, and his left side is +y.
import * as THREE from 'three';
import { canvasTex, addHair, blobTex, lerp, STEP, TOUCH, TOUCH_TURN } from '../world.js';

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

// Heights (meters above the grass) of the joints.
const HIP = .78, THIGH = .36, SHIN = .36, WAIST = .8, SHOULDER = .335, HEAD = .555, R = .15; // SHOULDER and HEAD are above the waist
const Z0 = -.04, Z1 = .41; // the shirt runs from just below the waist to the collar; its picture maps to this range
const SHIRT = [[.128, Z0], [.13, 0], [.127, .08], [.135, .18], [.15, .27], [.152, .32], [.13, .355], [.078, .385], [.054, .4], [.05, Z1]];

const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg).rotateX(Math.PI / 2);
// An arm or leg part hanging down from its joint: radius r0 at the joint, r1 at the far end, both ends rounded.
const limb = (len, r0, r1, bulge = 0) => lathe([[0, -len - r1 * .9], [r1 * .72, -len - r1 * .62], [r1, -len], [(r0 + r1) / 2 + bulge, -len * .45], [r0, 0], [r0 * .72, r0 * .62], [0, r0 * .9]], 14);
const ball = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h).rotateX(Math.PI / 2);

// The shirt's picture. Around the body: the right side seam is at x = 0, the chest at 256, the left side at 512,
// the back at 768. Up the body: `y(z)` is the row for a height z above the waist.
function shirtTex(kit, p) {
  return canvasTex(1024, 512, g => {
    const y = z => 512 * (1 - (z - Z0) / (Z1 - Z0)), [c0, c1] = kit.colors;
    g.fillStyle = c0; g.fillRect(0, 0, 1024, 512);
    if (kit.pattern === 'stripes') { g.fillStyle = c1; for (let k = 0; k < 8; k++) g.fillRect(96 + k * 128, 0, 64, 512); }
    if (kit.pattern === 'band') for (const c of [256, 768]) { g.fillStyle = '#fff'; g.fillRect(c - 60, 0, 120, 512); g.fillStyle = c1; g.fillRect(c - 40, 0, 80, 512); }
    for (const x of [0, 512, 1024]) { const s = g.createLinearGradient(x - 70, 0, x + 70, 0); s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(.5, 'rgba(0,0,0,.16)'); s.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = s; g.fillRect(x - 70, 0, 140, 512); } // darker under the arms
    g.fillStyle = kit.trim; g.fillRect(0, 0, 1024, y(.385)); g.fillRect(0, y(Z0 + .012), 1024, 14);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.55)';
    const text = (s, x, row, size, max, lw) => { g.font = `900 ${size}px system-ui,sans-serif`; g.lineWidth = lw; g.strokeText(s, x, row, max); g.fillStyle = kit.num; g.fillText(s, x, row, max); };
    text(p.name, 768, y(.305), 50, 300, 9); text(p.num, 768, y(.15), 168, 250, 13);   // back: name over a big number
    text(p.num, 256, y(.13), 76, 120, 8);                                              // chest: a small number
    g.fillStyle = '#fff'; g.beginPath(); g.arc(310, y(.27), 19, 0, 7); g.fill();       // badge over the heart
    g.fillStyle = kit.trim; g.beginPath(); g.arc(310, y(.27), 14, 0, 7); g.fill();
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
  const skin = mat(p.skin, .62), shorts = mat(kit.shorts, .85), sock = mat(kit.socks, .9), boot = mat(isHero ? '#ff8a1c' : '#16181f', .32), sole = mat(isHero ? '#ffffff' : '#e8e8ec', .6);
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(0, s * .085, HIP); g.add(hip);
    add(hip, limb(THIGH, .078, .058, .006), skin);
    add(hip, lathe([[.072, -.2], [.1, -.21], [.102, -.1], [.094, .02], [0, .06]], 14), shorts);                    // the leg of the shorts
    const knee = new THREE.Group(); knee.position.z = -THIGH; hip.add(knee);
    add(knee, limb(SHIN - .02, .058, .043, .012), sock);
    add(knee, new THREE.CylinderGeometry(.061, .061, .035, 14).rotateX(Math.PI / 2), mat(kit.trim, .9)).position.z = -.03; // sock top
    const b = add(knee, ball(.072, 16, 12), boot); b.scale.set(1.8, .8, .6); b.position.set(.06, 0, -SHIN - .012);
    const so = add(knee, ball(.07, 12, 8), sole); so.scale.set(1.75, .72, .2); so.position.set(.06, 0, -SHIN - .045);
    legs.push({ hip, knee });
  }
  const pelvis = add(g, ball(.1), shorts); pelvis.scale.set(1.02, 1.5, .9); pelvis.position.z = WAIST - .01;
  // Everything above the waist hangs on `torso`, so he can lean and twist over his legs.
  const torso = new THREE.Group(); torso.position.z = WAIST; g.add(torso);
  const shirtGeo = lathe(SHIRT, 28), uv = shirtGeo.attributes.uv, pos = shirtGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getZ(i) - Z0) / (Z1 - Z0));
  add(torso, shirtGeo, mat('#ffffff', .86, { map: shirtTex(kit, p) })).scale.set(.66, 1.13, 1);
  add(torso, new THREE.TorusGeometry(.054, .014, 8, 18), mat(kit.trim, .86)).position.z = Z1 - .006;      // collar
  add(torso, new THREE.CylinderGeometry(.046, .052, .13, 14).rotateX(Math.PI / 2), skin).position.z = Z1 + .03; // neck
  const sleeve = mat(kit.pattern === 'sleeves' ? kit.colors[1] : kit.colors[0], .86), cuff = mat(kit.trim, .86);
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0, s * .176, SHOULDER); torso.add(piv); arms.push(piv);
    add(piv, limb(.125, .06, .054), sleeve);
    add(piv, new THREE.CylinderGeometry(.056, .056, .022, 14).rotateX(Math.PI / 2), cuff).position.z = -.135;
    add(piv, limb(.21, .042, .037), skin);
    const elbow = new THREE.Group(); elbow.position.z = -.21; piv.add(elbow); elbows.push(elbow);
    add(elbow, limb(.19, .037, .03), skin);
    add(elbow, ball(.037, 12, 10), skin).position.z = -.215;
  }
  const head = new THREE.Group(); head.position.z = HEAD; head.scale.set(1, .93, 1.1); torso.add(head);
  add(head, ball(R, 28, 20), mat('#ffffff', .62, { map: faceTex(p) }));
  for (const s of [-1, 1]) add(head, ball(.034, 10, 8), skin).position.set(-.005, s * .147, -.012);          // ears
  addHair(head, p, kit, 0, R, c => mat(c, .75), add);
  const blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); blob.position.z = .012; g.add(blob);
  g.rotation.order = 'ZYX';
  g.userData = { mats, legs, arms, elbows, torso, head, blob, yaw: null, seed: Math.random() * 6 };
  return g;
}

// The run cycle follows the distance covered (so feet don't skate). Stride and ball touches match sim.js.
const Q = Math.SQRT1_2;
export function animateRig(g, a, sim, mood = 0, moodT = 0) {
  const u = g.userData, run = Math.min(1, a.sp / 4.5), idle = 1 - run, ph = a.dist / STEP * Math.PI;
  const want = Math.atan2(a.face[1], a.face[0]);
  if (u.yaw === null) u.yaw = want;
  u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * .3;
  const kick = a.kickAt != null ? (sim.time - a.kickAt) / .45 : 9, strike = kick < 1 ? Math.sin(Math.PI * kick) : 0;
  const carrying = sim.ball.state === 'carried' && sim.ball.carrier === a.id;
  const cyc = (a.dist % TOUCH) / TOUCH, touch = Math.floor(a.dist / TOUCH) % 3;
  const swing = Math.cos(ph), drive = -Math.sin(ph);
  // Standing still: knees bent and weight forward, ready to move (defenders sit lower), with a slow breath.
  const ready = idle * (a.team === 'them' ? .52 : .3) + idle * .03 * Math.sin(sim.time * 2.2 + a.x);
  g.position.set(a.x, a.y, run * .045 * Math.abs(Math.sin(ph)) - 2 * THIGH * (1 - Math.cos(ready * .5)));
  g.rotation.z = u.yaw; g.rotation.y = run * .07;
  for (let i = 0; i < 2; i++) { // plain loops: this runs for six players every frame
    const { hip, knee } = u.legs[i], sgn = i ? 1 : -1, sw = swing * sgn, flex = Math.max(0, Q * drive * sgn - Q * sw); // the knee folds as the leg comes through
    let h = -sw * .62 * run - ready * .5, k = run * (.2 + 1.25 * flex) + ready, turn = 0;
    if (carrying && i === 1 && run > .2 && cyc < .18) turn = TOUCH_TURN[touch] * run;
    if (i === 1 && kick < 1) {
      const t = kick;
      h = t < .4 ? lerp(0, .9, t / .4) : t < .62 ? lerp(.9, -1.25, (t - .4) / .22) : lerp(-1.25, 0, (t - .62) / .38);
      k = t < .4 ? lerp(.1, 1.3, t / .4) : t < .62 ? lerp(1.3, .1, (t - .4) / .22) : .1;
    }
    hip.rotation.set(0, h, turn); knee.rotation.y = k;
    const arm = u.arms[i], back = swing * sgn; // each arm swings against the leg on its side
    arm.rotation.set(sgn * (.1 + .1 * run + .5 * strike), back * .85 * run - ready * .45 - strike * .5 * sgn, 0);
    u.elbows[i].rotation.y = -(.3 + 1.15 * run - .3 * run * back + ready * 1.1);
  }
  u.torso.rotation.set(0, run * .2 + ready * .42 - strike * .22, swing * .14 * run);
  u.head.rotation.set(0, -u.torso.rotation.y * .6, -u.torso.rotation.z * .7);
  if (mood > 0) { // his team scored: jumping with both arms up
    const hop = Math.abs(Math.sin(moodT * 7.5 + u.seed));
    g.position.z += .34 * hop * mood;
    for (let i = 0; i < 2; i++) {
      const arm = u.arms[i], knee = u.legs[i].knee;
      arm.rotation.y = lerp(arm.rotation.y, -2.75 + .3 * Math.sin(moodT * 15 + i * 2 + u.seed), mood);
      u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.25, mood);
      knee.rotation.y = lerp(knee.rotation.y, .7 * (1 - hop), mood);
    }
    u.torso.rotation.y = lerp(u.torso.rotation.y, -.08, mood); u.head.rotation.y = lerp(u.head.rotation.y, -.3, mood);
  } else if (mood < 0) { // the other team scored: shoulders and head drop
    u.torso.rotation.y = lerp(u.torso.rotation.y, .3, -mood); u.head.rotation.y = lerp(u.head.rotation.y, .45, -mood);
    for (let i = 0; i < 2; i++) u.elbows[i].rotation.y = lerp(u.elbows[i].rotation.y, -.12, -mood);
  }
}
