// three.js renderer in a low-poly pastel style (inspired by A Short Hike).
// All art lives here so another style can replace this file later.
import * as THREE from 'three';
import { PITCH } from './skills.js';
import { DRIBBLE_DIRS } from './geom.js';

const { L, W, gy0, gy1, gh } = PITCH;
const CX = L / 2, CY = W / 2;
const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o });

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Shirt + shorts wrapped around the body. u = 0.25 is the chest, u = 0.75 the back.
function bodyTex(kit, p) {
  return canvasTex(512, 256, g => {
    g.fillStyle = kit.colors[0]; g.fillRect(0, 0, 512, 256);
    if (kit.pattern === 'stripes') { g.fillStyle = kit.colors[1]; for (let i = 0; i < 16; i += 2) g.fillRect(i * 32 + 16, 0, 32, 256); }
    if (kit.pattern === 'band') for (const c of [128, 384]) { g.fillStyle = '#fff'; g.fillRect(c - 30, 0, 60, 256); g.fillStyle = kit.colors[1]; g.fillRect(c - 20, 0, 40, 256); }
    g.fillStyle = kit.shorts; g.fillRect(0, 176, 512, 80);
    g.fillStyle = kit.trim; g.fillRect(0, 0, 512, 12);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.font = '900 90px system-ui,sans-serif'; g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.45)';
    g.strokeText(p.num, 384, 110); g.fillStyle = kit.num; g.fillText(p.num, 384, 110);
    g.font = '800 28px system-ui,sans-serif'; g.lineWidth = 6; g.strokeText(p.name, 384, 46, 170); g.fillText(p.name, 384, 46, 170);
    g.fillStyle = kit.trim; g.beginPath(); g.arc(150, 60, 11, 0, 7); g.fill();
  });
}
// Simple face: two dark eyes and a small smile, painted at u = 0.5 (front after rotateX).
function faceTex(p) {
  return canvasTex(512, 256, g => {
    g.fillStyle = p.skin; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#1d1410';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(256 + s * 26, 116, 6, 8, 0, 0, 7); g.fill(); }
    g.strokeStyle = '#5a2a1c'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.arc(256, 132, 7, .2 * Math.PI, .8 * Math.PI); g.stroke();
  });
}
const glowTex = canvasTex(128, 128, g => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(255,230,120,1)'); r.addColorStop(.55, 'rgba(255,210,63,.55)'); r.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});

// One-piece body (lathe) with capsule legs and arms and a sphere head. Low segment counts give the faceted look.
const PROFILE = [[0, 0], [.15, 0], [.185, .05], [.19, .15], [.165, .27], [.17, .36], [.2, .48], [.215, .56], [.2, .63], [.14, .68], [.06, .705], [0, .71]];
function makeRig(p, kit, isHero) {
  const g = new THREE.Group(), mats = [], legs = [], arms = [];
  const mat = c => { const m = M(c); mats.push(m); return m; };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 1, 6).rotateX(Math.PI / 2);
  const sph = r => new THREE.SphereGeometry(r, 8, 6).rotateX(Math.PI / 2);
  const add = (parent, geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const Lg = .42, hipZ = Lg + .06, skin = mat(p.skin), bodyH = .62, hs = bodyH / .71;
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(0, s * .08, hipZ); g.add(piv); legs.push(piv);
    add(piv, cap(.06, Lg * .3), skin).position.z = -Lg * .22;
    add(piv, cap(.068, Lg * .36), mat(kit.socks)).position.z = -Lg * .62;
    const bt = add(piv, sph(.085), mat(isHero ? '#f59e0b' : '#1d1f26')); bt.scale.set(1.5, .95, .7); bt.position.set(.05, 0, -Lg + .03);
  }
  const body = add(g, new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 8).rotateX(Math.PI / 2),
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
  add(g, new THREE.SphereGeometry(R * 1.06, 8, 6, 0, Math.PI * 2, 0, Math.PI * .5).rotateX(Math.PI / 2).rotateY(-.4), mat(p.hair)).position.set(-.01, 0, hz + .01);
  g.userData = { mats, legs, arms };
  return g;
}

const WALLS = [{ a: [L + 6, -6], b: [L + 6, W + 6], o: [1, 0] }, { a: [-6, W + 6], b: [-6, -6], o: [-1, 0] },
  { a: [L + 6, W + 6], b: [-6, W + 6], o: [0, 1] }, { a: [-6, -6], b: [L + 6, -6], o: [0, -1] }];

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffc89a'); scene.fog = new THREE.Fog('#ffd9b3', 35, 140);
    this.camera = new THREE.PerspectiveCamera(40, 2, .1, 500); this.camera.up.set(0, 0, 1);
    const hemi = new THREE.HemisphereLight('#ffd2a8', '#6e9a5a', 1.0); hemi.position.set(0, 0, 1); scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe2b8', 1.6); sun.position.set(-8, -12, 30); sun.target.position.set(CX, CY, 0); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 120 }); scene.add(sun);

    this.buildPitch(); this.buildEnv(); this.buildMarkers();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), M('#ffffff', {
      map: canvasTex(256, 128, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#222'; for (let i = 0; i < 10; i++) { g.beginPath(); g.arc((i * 53) % 256, (i * 37) % 128, 14, 0, 7); g.fill(); } }) }));
    this.ball.castShadow = true; scene.add(this.ball);
    this.rigs = new Map(); this.tmp = new THREE.Vector3(); this.camDir = new THREE.Vector3();
  }

  buildPitch() {
    const ppm = 40;
    const tex = canvasTex((L + 12) * ppm, (W + 12) * ppm, g => {
      const X = x => Math.round((x + 6) * ppm), Y = y => Math.round((W + 6 - y) * ppm);
      g.fillStyle = '#a9d67a'; g.fillRect(0, 0, (L + 12) * ppm, (W + 12) * ppm);
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#92c862' : '#9fd36e'; g.fillRect(X(i * 3), Y(W), 3 * ppm, W * ppm); }
      g.fillStyle = '#ffffff'; const lw = Math.round(.14 * ppm);
      const hl = (x0, x1, y) => g.fillRect(X(x0), Y(y), X(x1) - X(x0), lw), vl = (x, y0, y1) => g.fillRect(X(x), Y(y1), lw, Y(y0) - Y(y1));
      hl(0, L, 0); hl(0, L, W); vl(0, 0, W); vl(L, 0, W); vl(CX, 0, W);
      hl(0, 3, gy0 - 2); hl(0, 3, gy1 + 2); vl(3, gy0 - 2, gy1 + 2); hl(L - 3, L, gy0 - 2); hl(L - 3, L, gy1 + 2); vl(L - 3, gy0 - 2, gy1 + 2);
      for (let a = 0; a < 360; a += .5) { const q = a * Math.PI / 180; g.fillRect(X(CX + 2.5 * Math.cos(q)), Y(CY + 2.5 * Math.sin(q)), lw, lw); }
    });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 12, W + 12), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.position.set(CX, CY, 0); pitch.receiveShadow = true; this.scene.add(pitch);
    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ color: '#a9d67a' }));
    this.outer.position.set(CX, CY, -.02); this.outer.receiveShadow = true; this.scene.add(this.outer);
    for (const [gx, dir] of [[L, 1], [0, -1]]) {
      const white = M('#ffffff'), post = new THREE.CylinderGeometry(.06, .06, gh, 6).rotateX(Math.PI / 2);
      for (const y of [gy0, gy1]) { const m = new THREE.Mesh(post, white); m.position.set(gx, y, gh / 2); m.castShadow = true; this.scene.add(m); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, gy1 - gy0, 6), white); bar.position.set(gx, CY, gh); bar.castShadow = true; this.scene.add(bar);
      const net = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false });
      const back = new THREE.Mesh(new THREE.PlaneGeometry(gy1 - gy0, gh * .8).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), net);
      back.position.set(gx + dir, CY, gh * .4); this.scene.add(back);
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(1, gy1 - gy0), net); roof.position.set(gx + dir / 2, CY, gh * .9); roof.rotation.y = dir * .2; this.scene.add(roof);
    }
  }

  buildEnv() {
    const park = this.park = new THREE.Group(), stands = this.stands = new THREE.Group(), crowd = this.crowd = new THREE.Group();
    let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trunkG = new THREE.CylinderGeometry(.18, .25, 1, 5).rotateX(Math.PI / 2), leafG = new THREE.ConeGeometry(1, 2.2, 6).rotateX(Math.PI / 2);
    const leafM = [M('#5fae7a'), M('#7cc58a'), M('#3f8f6e')], trunkM = M('#7a5434');
    const tree = (x, y, s, i) => {
      const tr = new THREE.Mesh(trunkG, trunkM); tr.scale.z = s * .45; tr.position.set(x, y, s * .225);
      const lf = new THREE.Mesh(leafG, leafM[i % 3]); lf.scale.set(s * .34, s * .34, s * .32); lf.position.set(x, y, s * .75);
      tr.castShadow = lf.castShadow = true; park.add(tr, lf);
    };
    let i = 0;
    for (let x = -12; x <= L + 12; x += 4) { tree(x + rand() * 2, -11 - rand() * 4, 4 + rand() * 2.5, i++); tree(x + rand() * 2, W + 11 + rand() * 4, 4 + rand() * 2.5, i++); }
    for (let y = -6; y <= W + 6; y += 4) { tree(-13 - rand() * 4, y + rand() * 2, 4 + rand() * 2.5, i++); tree(L + 13 + rand() * 4, y + rand() * 2, 4 + rand() * 2.5, i++); }
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
          if (rand() < .3) fans.push({ x, y, z: rz(r), c: ['#e46a5a', '#f2c14e', '#ffffff', '#6aa6d8', '#a36ad8'][Math.floor(rand() * 5)], s: ['#f0c8a6', '#b07a52', '#7a4e30'][Math.floor(rand() * 3)] });
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
    this.scene.add(park, stands, crowd);
    this.setEnv('park');
  }
  setEnv(env) { this.park.visible = env === 'park'; this.stands.visible = env !== 'park'; this.crowd.visible = env === 'crowd'; }

  buildMarkers() {
    const gold = () => new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .9, depthWrite: false });
    this.heroRing = new THREE.Mesh(new THREE.RingGeometry(.46, .6, 24), gold()); this.scene.add(this.heroRing);
    const sh = new THREE.Shape();
    [[1, -.35], [3.3, -.35], [3.3, -.9], [4.6, 0], [3.3, .9], [3.3, .35], [1, .35]].forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
    const ag = new THREE.ShapeGeometry(sh);
    this.arrows = Object.fromEntries(Object.entries(DRIBBLE_DIRS).map(([k, a]) => { const m = new THREE.Mesh(ag, gold()); m.rotation.z = a; m.visible = false; this.scene.add(m); return [k, m]; }));
    this.glows = new Map();
    this.lines = new THREE.Group(); this.scene.add(this.lines); this.linesKey = '';
  }

  setTeams(us, them) {
    for (const g of this.rigs.values()) this.scene.remove(g);
    this.rigs.clear();
    const ids = [['hero', us, 0], ['m1', us, 1], ['m2', us, 2], ['o1', them, 0], ['o2', them, 1], ['o3', them, 2]];
    for (const [id, team, i] of ids) {
      const g = makeRig(team.players[i], team.kit, id === 'hero'); this.scene.add(g); this.rigs.set(id, g);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.visible = false; this.scene.add(glow); this.glows.get(id) && this.scene.remove(this.glows.get(id)); this.glows.set(id, glow);
    }
  }

  setLines(lines) {
    const key = JSON.stringify(lines); if (key === this.linesKey) return; this.linesKey = key;
    this.lines.clear();
    for (const l of lines) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, len = Math.hypot(dx, dy), m = new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: .9, depthWrite: false });
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(.1, len - .6), .32), m);
      bar.position.set(l.a.x + dx / 2 - dx / len * .3, l.a.y + dy / 2 - dy / len * .3, .05); bar.rotation.z = Math.atan2(dy, dx);
      const head = new THREE.Mesh(new THREE.CircleGeometry(.6, 3), m); head.position.set(l.b.x - dx / len * .5, l.b.y - dy / len * .5, .05); head.rotation.z = Math.atan2(dy, dx);
      this.lines.add(bar, head);
    }
  }

  // Screen position (CSS px) of a world point, for tap targets.
  project(x, y, z) {
    const v = this.tmp.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.canvas.clientWidth, (1 - v.y) / 2 * this.canvas.clientHeight];
  }

  // ui: { glow: {id: 0..1}, arrows: {dir: 0..1}, lines: [...], heroRing }
  render(sim, cam, ui, time) {
    const cv = this.canvas, Wpx = cv.clientWidth, Hpx = cv.clientHeight;
    if (cv.width !== Math.round(Wpx * this.renderer.getPixelRatio())) this.renderer.setSize(Wpx, Hpx, false);
    // Focal length from height (Ff) and width (Fw) so wide phones don't see extra field.
    const F = Math.max(Hpx * cam.Ff, Wpx * (cam.Fw || 0)), c = this.camera;
    c.aspect = Wpx / Hpx; c.fov = 2 * Math.atan(Hpx / 2 / F) * 180 / Math.PI; c.updateProjectionMatrix();
    c.position.set(...cam.eye); c.lookAt(...cam.tgt);
    const pulse = .75 + .25 * Math.sin(time * 6);
    for (const [id, g] of this.rigs) {
      const a = sim.a(id), glow = this.glows.get(id);
      g.visible = !!a; glow.visible = false; if (!a) continue;
      g.position.set(a.x, a.y, 0); g.rotation.z = Math.atan2(a.face[1], a.face[0]);
      const sw = Math.sin(time * 11 + a.x) * Math.min(1, a.sp / 4);
      g.userData.legs.forEach((l, i) => l.rotation.y = sw * .6 * (i ? 1 : -1));
      g.userData.arms.forEach((l, i) => l.rotation.y = -sw * .7 * (i ? 1 : -1));
      const s = ui.glow?.[id] || 0;
      for (const m of g.userData.mats) { m.emissive.setRGB(1, .78, .2); m.emissiveIntensity = s * pulse * .22; }
      if (s) { glow.visible = true; glow.position.set(a.x, a.y, .03); glow.material.opacity = s * pulse; glow.scale.setScalar(.8 + .4 * s); }
    }
    const h = sim.a('hero');
    this.heroRing.visible = !!ui.heroRing && !!h; if (h) this.heroRing.position.set(h.x, h.y, .02);
    for (const [k, m] of Object.entries(this.arrows)) {
      const s = ui.arrows?.[k] || 0; m.visible = !!s && !!h;
      if (m.visible) { m.position.set(h.x, h.y, .03); m.material.opacity = (.45 + .35 * s) * (.8 + .2 * Math.sin(time * 6)); }
    }
    this.setLines(ui.lines || []);
    const b = sim.ball; this.ball.position.set(b.x, b.y, .2 + (b.z || 0)); this.ball.rotation.y = b.x * 3; this.ball.rotation.x = b.y * 3;
    this.renderer.render(this.scene, c);
  }
}
