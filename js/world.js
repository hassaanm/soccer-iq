// The 3D world, drawn like a match on TV. Training is a sunny day at the training ground; matches are at night in
// a full stadium under four floodlights. It also draws what the game puts on the pitch: markers, arrows, effects.
import * as THREE from 'three';
import { PITCH } from './skills.js';
import { DRIBBLE_DIRS, clamp } from './geom.js';
import { Particles } from './fx.js';
import { canvasTex, blobTex } from './tex.js';
import { makeRig, RIM } from './pro/rig.js';
import { animateRig } from './pro/motion.js';
import { makePost } from './pro/post.js';
import { buildStadium, TOWERS } from './pro/stadium.js';
import { buildPark } from './pro/park.js';
import { makeEnv, buildBeams, sunSprite } from './pro/light.js';
import { makeSky } from './pro/sky.js';
import { turf } from './pro/grass.js';

const { L, W, gy0, gy1, gh } = PITCH;
const CX = L / 2, CY = W / 2, BALL_R = .125; // the ball's radius: in proportion to the players, about as wide as a head
const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .72 });
// Everything that differs between the two times of day. `key` is the sun by day; by night it and three `fill`
// lights are the four floodlights.
const LOOKS = {
  day: { top: '#1a55c8', mid: '#62a8f2', horizon: '#ffe6c2', cloudC: '#fff6ea', shadeC: '#a9b4cc', cloud: 1, fog: ['#ead9c2', 80, 300], hemi: ['#cfe2ff', '#86a35f', .8], key: ['#ffdcae', 3.1], fill: 0, exposure: 1.05, bloom: .28, rim: ['#ffe6bd', .45], vig: .28, sat: 1.14, sun: '#ffcf90' },
  night: { top: '#02040b', mid: '#0a1230', horizon: '#111c40', cloudC: '#1d2a55', shadeC: '#070b1a', cloud: .45, fog: ['#0a1230', 90, 320], hemi: ['#9db0ff', '#24502a', .42], key: ['#f2f6ff', 1.35], fill: 1.3, exposure: 1.1, bloom: .5, rim: ['#d2e2ff', .55], vig: .42, sat: 1.16, sun: '#000000' },
};
// Picture quality, best first. `pr`: the most screen pixels per CSS pixel (a phone's screen has 2 or 3; 1.5 is sharp
// enough with smoothing and leaves the phone room for sound); `bloom`: the glow (1 full, .5 on a quarter of the
// pixels, 0 none; see pro/post.js); `shadow`: the shadow map's size. Only a slow device goes down the list (see `pace`).
const QUALITY = [{ pr: 1.5, bloom: 1, shadow: 2048 }, { pr: 1.25, bloom: 1, shadow: 2048 }, { pr: 1, bloom: 1, shadow: 2048 },
  { pr: 1, bloom: .5, shadow: 2048 }, { pr: 1, bloom: .5, shadow: 1024 }, { pr: 1, bloom: 0, shadow: 1024 }];
const SUN = [10, -28, 15], LAMP_Z = 26; // the sun is low on one side (late afternoon), measured from the middle of the pitch
// What shiny things reflect, by day and by night (see pro/light.js).
const ENV = {
  day: { top: '#3f7fd8', horizon: '#f0dcc0', ground: '#3f6a30', lamps: [[...SUN, '#ffe0b0', 60, 3]] },
  night: { top: '#05070f', horizon: '#1a2748', ground: '#0e2a12', lamps: TOWERS.map(t => [t[0] - CX, t[1] - CY, LAMP_Z, '#eaf1ff', 40, 2.5]) },
};

const glowTex = canvasTex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(255,230,120,1)'); r.addColorStop(.55, 'rgba(255,210,63,.55)'); r.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const IDS = ['hero', 'm1', 'm2', 'o1', 'o2', 'o3']; // the sim's player ids: three of ours, three of theirs

// Frees what one player's body owns: its shapes, its materials, its bones' texture and the two painted textures
// (shirt and face). The canvases behind those textures are emptied too: iOS counts canvas memory until the garbage
// collector runs. The shared spot under him (see pro/rig.js) is left alone.
function disposeRig(g) {
  g.traverse(o => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
  g.userData.skeleton.dispose();
  for (const m of g.userData.mats) {
    if (m.map) { const cv = m.map.image; m.map.dispose(); cv.width = cv.height = 0; }
    m.dispose();
  }
}
// Everything about a team that changes how its players look. Same key: the bodies already built can stay.
const lookKey = team => JSON.stringify([team.kit, team.players.slice(0, 3)]);

// Parts that never move and share a material, as one mesh: one draw (and one shadow draw) instead of one each.
function merged(parts, mat) {
  const pos = [], nor = [], idx = []; let n = 0;
  for (const o of parts) {
    o.updateMatrix(); const g = o.geometry.clone().applyMatrix4(o.matrix);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (const i of g.index.array) idx.push(i + n);
    n += g.attributes.position.count; o.geometry.dispose(); g.dispose();
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setIndex(idx);
  return new THREE.Mesh(geo, mat);
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
  const mat = new THREE.MeshStandardMaterial({ roughness: .3 }); // a glossy ball
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

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    // No smoothing (antialias) or stencil on the page's own picture: the picture is drawn, smoothed, in the post
    // passes' buffer (pro/post.js), and the page only gets one flat square of it.
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio, QUALITY[0].pr)); this.level = 0; this.pacer = { win: [], t: 0, slow: 0, skip: 3, first: 0, steps: 0, done: false };
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; // the exposure comes with the time of day (see `applyLook`)
    const scene = this.scene = new THREE.Scene();
    this.envs = { day: makeEnv(r, ENV.day), night: makeEnv(r, ENV.night) };
    this.buildSky();
    this.camera = new THREE.PerspectiveCamera(40, 2, .1, 500); this.camera.up.set(0, 0, 1);
    this.buildLights();
    this.buildPitch(); this.buildEnv(); this.buildMarkers();
    this.ball = makeBall(BALL_R); this.ballPrev = null;
    this.ball.castShadow = true; scene.add(this.ball);
    this.ballBlob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.5, 16), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); scene.add(this.ballBlob);
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
    makePost(r, scene, this.camera).then(post => {
      if (!post) return;
      this.post = post; post.setSize(this.width, this.height); this.applyLook();
      if (QUALITY[this.level].bloom < 1) post.setBloom(QUALITY[this.level].bloom);
    });
  }
  // The safety net for slow devices (a governor), called by main.js with the real time (ms) since the last frame.
  // Every second it takes the middle frame time (the median, so a few hitches don't count); the first three seconds
  // (loading, first shaders) are not judged. After two slow seconds in a row (median over 22 ms: under about 45
  // frames a second) it takes one step down QUALITY, then lets the new quality settle for a second. It never steps
  // back up, so the picture never goes back and forth. If two steps made frames no faster (by 15%), the time is not
  // going on drawing (a phone in low-power mode, for one, shows only 30 frames a second): it goes back to full
  // quality and stops watching. A fast device is never slow, so nothing ever changes there.
  pace(ms) {
    const p = this.pacer; if (p.done || ms > 250) return; // a hidden tab or a long hitch tells nothing
    p.win.push(ms); if ((p.t += ms) < 1000 || p.win.length < 15) return;
    const med = p.win.sort((a, b) => a - b)[p.win.length >> 1]; p.win.length = 0; p.t = 0;
    if (p.skip > 0) { p.skip--; return; }
    if (med <= 22) { p.slow = 0; return; }
    if (++p.slow < 2) return;
    p.slow = 0; p.first ||= med;
    if (p.steps >= 2 && med > p.first * .85) { this.setQuality(0); p.done = true; return; }
    let next = this.level + 1; const same = (a, b) => Math.min(devicePixelRatio, a.pr) === Math.min(devicePixelRatio, b.pr) && a.bloom === b.bloom && a.shadow === b.shadow;
    while (next < QUALITY.length && same(QUALITY[next], QUALITY[this.level])) next++; // skip a step that changes nothing here (a 1x screen has no pixels to save)
    if (next >= QUALITY.length) { p.done = true; return; }
    this.setQuality(next); p.steps++; p.skip = 1;
  }
  setQuality(i) {
    const q = QUALITY[this.level = i], l = this.keys[0].shadow;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr)); this.resized = true; // `render` sizes the picture again
    this.post?.setBloom(q.bloom);
    if (l.mapSize.x !== q.shadow) { l.mapSize.set(q.shadow, q.shadow); l.map?.dispose(); l.map = null; }
  }
  buildSky() {
    const scene = this.scene;
    scene.background = new THREE.Color(); scene.fog = new THREE.Fog('#000000', 80, 300);
    const sky = makeSky(SUN); this.skyU = sky.u; sky.mesh.position.set(CX, CY, 0); scene.add(sky.mesh);
    // Night: stars.
    let seed = 3; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = [];
    for (let k = 0; k < 700; k++) { const a = rand() * Math.PI * 2, e = .12 + rand() * 1.4, d = 280; pts.push(CX + Math.cos(a) * Math.cos(e) * d, CY + Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d); }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.7, 2), size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: .85 }));
    scene.add(this.stars);
  }
  buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight('#ffffff', '#ffffff', 1); this.hemi.position.set(0, 0, 1); scene.add(this.hemi);
    this.keys = TOWERS.map((t, i) => {
      const l = new THREE.DirectionalLight('#ffffff', 1); l.position.set(t[0], t[1], LAMP_Z); l.target.position.set(CX, CY, 0); scene.add(l, l.target);
      if (!i) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -.0004; l.shadow.normalBias = .02; Object.assign(l.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 }); }
      return l;
    });
  }
  resize(w, h) { this.renderer.setSize(w, h, false); this.post?.setSize(w, h); }
  measure() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.width || h !== this.height) { this.width = w; this.height = h; this.resized = true; }
  }

  buildPitch() {
    const ppm = 40, TW = (L + 12) * ppm, TH = (W + 12) * ppm;
    const tex = canvasTex(TW, TH, g => {
      const X = x => (x + 6) * ppm, Y = y => (W + 6 - y) * ppm;
      // Deeper, mown grass: stripes across the pitch, a soft checker, blades, and a little wear in front of each goal.
      g.fillStyle = '#3d8f3a'; g.fillRect(0, 0, TW, TH);
      for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#368634' : '#48a043'; g.fillRect(X(i * 3), 0, 3 * ppm, TH); }
      for (let j = -2; j < 7; j++) { g.fillStyle = j % 2 ? 'rgba(255,255,190,.03)' : 'rgba(0,40,10,.03)'; g.fillRect(0, Y((j + 1) * 4), TW, 4 * ppm); }
      let sd = 7; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (let k = 0; k < 90000; k++) { g.fillStyle = rr() < .5 ? 'rgba(10,60,20,.10)' : 'rgba(210,255,150,.08)'; g.fillRect(rr() * TW, rr() * TH, 1.5, 2 + rr() * 3); }
      for (const x of [1.2, L - 1.2]) { const w = g.createRadialGradient(X(x), Y(CY), 0, X(x), Y(CY), 3.2 * ppm); w.addColorStop(0, 'rgba(150,130,70,.2)'); w.addColorStop(1, 'rgba(150,130,70,0)'); g.fillStyle = w; g.fillRect(X(x) - 4 * ppm, Y(CY) - 4 * ppm, 8 * ppm, 8 * ppm); }
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
    const pitch = this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 12, W + 12), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.position.set(CX, CY, 0); pitch.receiveShadow = true; this.scene.add(pitch);
    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: '#3a8a37' }));
    this.outer.position.set(CX, CY, -.02); this.outer.receiveShadow = true; this.scene.add(this.outer);
    this.buildGoals(); turf(pitch.material); turf(this.outer.material, false);
    // Under four floodlights every player throws four shadows. The key light draws one for real; the other three
    // are soft streaks on the grass, one row of this mesh each, pointed away from their lamp every frame.
    const streak = canvasTex(128, 64, g => {
      const a = g.createLinearGradient(0, 0, 128, 0); a.addColorStop(0, 'rgba(0,0,0,.55)'); a.addColorStop(.35, 'rgba(0,0,0,.4)'); a.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = a; g.fillRect(0, 0, 128, 64);
      g.globalCompositeOperation = 'destination-in';
      const v = g.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = v; g.fillRect(0, 0, 128, 64);
    });
    this.streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, .5).translate(.42, 0, 0), new THREE.MeshBasicMaterial({ map: streak, transparent: true, depthWrite: false, opacity: .5 }), IDS.length * 3 + 3);
    this.streaks.frustumCulled = false; this.streaks.count = 0; this.streaks.renderOrder = 1; this.scene.add(this.streaks);
    this.m4 = new THREE.Matrix4(); this.e3 = new THREE.Euler(); this.q4 = new THREE.Quaternion(); this.p3 = new THREE.Vector3(); this.s3 = new THREE.Vector3();
  }
  buildGoals() {
    // Goals: white frame and a simple box net (back, sides and a flat top), with a faint fill so it reads as netting.
    const netCanvas = document.createElement('canvas'); netCanvas.width = netCanvas.height = 64;
    const ng = netCanvas.getContext('2d'); ng.fillStyle = 'rgba(255,255,255,.16)'; ng.fillRect(0, 0, 64, 64);
    ng.strokeStyle = 'rgba(255,255,255,.95)'; ng.lineWidth = 6; ng.strokeRect(0, 0, 64, 64);
    const netMat = (w, h) => {
      const t = new THREE.CanvasTexture(netCanvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / .2, h / .2); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    };
    const depth = 1.1, gw = gy1 - gy0, frame = M('#ffffff'), rear = M('#d9dde3'), bars = new Map([[frame, []], [rear, []]]);
    const bar = (len, r, m, axis) => { const g = new THREE.CylinderGeometry(r, r, len, 8); if (axis === 'z') g.rotateX(Math.PI / 2); if (axis === 'x') g.rotateZ(Math.PI / 2); return new THREE.Mesh(g, m); };
    const put = (o, x, y, z) => { o.position.set(x, y, z); bars.get(o.material).push(o); }; // the bars never move: both goals' bars of one colour are drawn as one mesh
    this.nets = [];
    for (const [gx, dir] of [[L, 1], [0, -1]]) {
      const bx = gx + dir * depth, add = (o, x, y, z) => { o.position.set(x, y, z); this.scene.add(o); return o; };
      for (const y of [gy0, gy1]) {
        put(bar(gh, .07, frame, 'z'), gx, y, gh / 2);           // front posts
        put(bar(gh, .03, rear, 'z'), bx, y, gh / 2);            // back posts
        put(bar(depth, .03, rear, 'x'), gx + dir * depth / 2, y, gh); // top side bars
        put(bar(depth, .03, rear, 'x'), gx + dir * depth / 2, y, .03);
      }
      put(bar(gw, .07, frame), gx, CY, gh);                       // crossbar
      put(bar(gw, .03, rear), bx, CY, gh);
      put(bar(gw, .03, rear), bx, CY, .03);
      // The back net has enough points to bulge when a shot hits it (see `fx('goal')` and `moveNets`).
      const back = add(new THREE.Mesh(new THREE.PlaneGeometry(gw, gh, 20, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), netMat(gw, gh)), bx, CY, gh / 2);
      this.nets.push({ mesh: back, base: back.geometry.attributes.position.array.slice(), dir, x: gx, t: 9, y: 0, z: 0 });
      for (const y of [gy0, gy1]) add(new THREE.Mesh(new THREE.PlaneGeometry(depth, gh).rotateX(Math.PI / 2), netMat(depth, gh)), gx + dir * depth / 2, y, gh / 2);
      add(new THREE.Mesh(new THREE.PlaneGeometry(depth, gw), netMat(depth, gw)), gx + dir * depth / 2, CY, gh);
    }
    // Corner flags that wave a little (the four poles are one mesh).
    const poleM = M('#fff8e8'), flagM = new THREE.MeshLambertMaterial({ color: '#ff6b5e', side: THREE.DoubleSide }), poles = [];
    const flagG = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.45, .55, 0, 1.3, 0, 0, 1.15], 3)); flagG.computeVertexNormals();
    this.flags = [[0, 0], [L, 0], [0, W], [L, W]].map(([x, y]) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.5, 5).rotateX(Math.PI / 2), poleM); pole.position.set(x, y, .75); poles.push(pole);
      const flag = new THREE.Mesh(flagG, flagM); flag.position.set(x, y, 0); flag.castShadow = true;
      this.scene.add(flag); return flag;
    });
    for (const [m, list] of [...bars, [poleM, poles]]) { const o = merged(list, m); o.castShadow = true; this.scene.add(o); }
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
    this.park = new THREE.Group(); this.stands = new THREE.Group(); this.crowd = new THREE.Group(); this.excite = 0;
    buildStadium(this); buildPark(this); buildBeams(this.stands, TOWERS, LAMP_Z + 1); sunSprite(this.park, SUN);
    this.scene.add(this.park, this.stands, this.crowd);
    this.setEnv('park'); this.shadeOnlyNear(this.park); this.setEnv('crowd');
  }
  // Most trees stand outside the sun's shadow box, so their shadows fall on nothing that is drawn. Those trees move
  // to a copy of their mesh that throws no shadow, and the shadow pass skips them (the same picture, a third of the work).
  shadeOnlyNear(group) {
    const l = this.keys[0]; this.scene.updateMatrixWorld(true); l.shadow.camera.updateProjectionMatrix(); l.shadow.updateMatrices(l);
    const box = l.shadow.getFrustum(), m4 = new THREE.Matrix4(), ball = new THREE.Sphere(), col = new THREE.Color();
    for (const mesh of group.children.filter(o => o.isInstancedMesh && o.castShadow)) {
      const geo = mesh.geometry; if (!geo.boundingSphere) geo.computeBoundingSphere();
      const all = [...Array(mesh.count).keys()], near = all.filter(k => { mesh.getMatrixAt(k, m4); return box.intersectsSphere(ball.copy(geo.boundingSphere).applyMatrix4(m4)); });
      if (near.length === all.length) continue;
      const fill = (to, list) => { list.forEach((k, j) => { mesh.getMatrixAt(k, m4); mesh.getColorAt(k, col); to.setMatrixAt(j, m4); to.setColorAt(j, col); }); to.count = list.length; to.computeBoundingSphere(); };
      const far = new THREE.InstancedMesh(geo, mesh.material, all.length - near.length); fill(far, all.filter(k => !near.includes(k))); group.add(far);
      fill(mesh, near);
    }
  }
  // 'park': the training ground by day. 'crowd': the stadium at night, full of fans.
  setEnv(env) {
    this.park.visible = env === 'park'; this.stands.visible = env !== 'park'; this.crowd.visible = env === 'crowd';
    this.night = env !== 'park'; this.look = LOOKS[this.night ? 'night' : 'day'];
    const k = this.look, scene = this.scene;
    scene.background.set(k.horizon); scene.fog.color.set(k.fog[0]); scene.fog.near = k.fog[1]; scene.fog.far = k.fog[2];
    for (const n of ['top', 'mid', 'horizon', 'cloudC', 'shadeC']) this.skyU[n].value.set(k[n]);
    this.skyU.sunC.value.set(k.sun); this.skyU.cloud.value = k.cloud;
    scene.environment = this.envs[this.night ? 'night' : 'day'];
    this.stars.visible = this.night;
    this.hemi.color.set(k.hemi[0]); this.hemi.groundColor.set(k.hemi[1]); this.hemi.intensity = k.hemi[2];
    this.keys.forEach((l, i) => { l.color.set(k.key[0]); l.intensity = i ? k.fill : k.key[1]; });
    const t = this.night ? [...TOWERS[0], LAMP_Z] : [CX + SUN[0], CY + SUN[1], SUN[2]]; this.keys[0].position.set(t[0], t[1], t[2]);
    RIM.color.value.set(k.rim[0]); RIM.k.value = k.rim[1];
    this.applyLook();
  }
  applyLook() {
    const k = this.look; this.renderer.toneMappingExposure = k.exposure;
    if (!this.post) return;
    this.post.bloom.strength = k.bloom; this.post.grade.uExposure.value = k.exposure; this.post.grade.uVig.value = k.vig; this.post.grade.uSat.value = k.sat;
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
      Object.assign(net, { t: 0, y: clamp(b.y, gy0 + .3, gy1 - .3) - CY, z: clamp(BALL_R + (b.z || 0), .2, gh - .2) - gh / 2 });
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
    if (this.resized) { this.resized = false; this.resize(Wpx, Hpx); }
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
      animateRig(g, a, sim, mood ? (a.team === mood.team ? moodK : -moodK) : 0, mood ? mood.t : 0, time);
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
      if (d > 1e-4 && d < 3) this.ball.quaternion.premultiply(this.q.setFromAxisAngle(this.axis.set(-dy / d, dx / d, 0), d / BALL_R));
      if (dt && b.state === 'flying' && d / dt > 13) this.particles.trail(b.x, b.y, BALL_R + (b.z || 0)); // a hard shot leaves a trail
      bp.x = b.x; bp.y = b.y;
    } else this.ballPrev = { x: b.x, y: b.y };
    this.ballGlow.visible = !!ui.ballGlow; if (ui.ballGlow) { this.ballGlow.position.set(b.x, b.y, .03); this.ballGlow.material.opacity = pulse; }
    this.ball.position.set(b.x, b.y, BALL_R + (b.z || 0));
    // The ball's own soft spot on the grass, smaller and fainter the higher it flies, so its height is easy to read.
    const bz = b.z || 0; this.ballBlob.position.set(b.x, b.y, .014); this.ballBlob.scale.setScalar(1 / (1 + bz * .5)); this.ballBlob.material.opacity = .9 / (1 + bz * .8);
    // The crowd gets louder as the ball nears a goal and calms down after.
    const nearGoal = this.crowd.visible ? clamp(1 - Math.min(Math.hypot(b.x - L, b.y - CY), Math.hypot(b.x, b.y - CY)) / 9, 0, 1) * .3 : 0;
    this.excite = Math.max(nearGoal, this.excite * Math.exp(-dt * .55));
    this.crowdU.uTime.value = time; this.crowdU.uExcite.value = this.excite; // the fans move in the shader (see pro/stadium.js)
    this.moveNets(dt); this.particles.update(dt, c);
    this.boards.offset.x = time * .012; this.skyU.uTime.value = time;
    for (let i = 0; i < this.flags.length; i++) this.flags[i].rotation.z = .6 + i * 1.3 + Math.sin(time * 3.1 + i) * .35 + Math.sin(time * 7.3 + i * 2) * .1;
    this.heroRing.scale.setScalar(1 + .05 * Math.sin(time * 4));
    this.moveStreaks(sim);
    if (this.post) this.post.render(); else this.renderer.render(this.scene, c);
  }
  // Floodlight shadows at night: one streak per player and lamp (not the key lamp), and the same for the ball.
  moveStreaks(sim) {
    let n = 0;
    if (this.night) {
      const put = (x, y, h) => {
        for (let i = 1; i < TOWERS.length; i++) {
          const dx = x - TOWERS[i][0], dy = y - TOWERS[i][1], d = Math.hypot(dx, dy);
          this.streaks.setMatrixAt(n++, this.m4.compose(this.p3.set(x, y, .017), this.q4.setFromEuler(this.e3.set(0, 0, Math.atan2(dy, dx))), this.s3.set(h * d / LAMP_Z * 1.25, h * .62, 1)));
        }
      };
      for (let i = 0; i < IDS.length; i++) { const g = this.rigs.get(IDS[i]); if (g?.visible) put(g.position.x, g.position.y, 1.6); }
      if ((sim.ball.z || 0) < .5) put(sim.ball.x, sim.ball.y, .3);
      this.streaks.instanceMatrix.needsUpdate = true;
    }
    this.streaks.count = n;
  }
}
