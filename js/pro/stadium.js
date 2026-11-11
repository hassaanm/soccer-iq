// The night stadium: moving advert boards, one bowl of seats all the way round with a roof,
// a few thousand fans, camera flashes, and four floodlight towers. Everything is built once; the fans and the
// flashes then move inside the graphics card (the world only gives them the time and how excited the crowd is).
import * as THREE from 'three';
import { PITCH } from '../skills.js';
import { canvasTex } from '../tex.js';

const { L, W } = PITCH, CX = L / 2, CY = W / 2;
const X0 = -6, X1 = L + 6, Y0 = -6, Y1 = W + 6; // the walls round the pitch
const WALLS = [{ a: [X1, Y0], b: [X1, Y1], o: [1, 0] }, { a: [X0, Y1], b: [X0, Y0], o: [-1, 0] }, { a: [X1, Y1], b: [X0, Y1], o: [0, 1] }, { a: [X0, Y0], b: [X1, Y0], o: [0, -1] }];
const ROWS = 14, off = r => 1.2 + r * .8, rz = r => 1.1 + r * .55, TOP = rz(ROWS - 1) + 4.6, LAMP = 26;
export const TOWERS = [[X0 - 15, Y0 - 15], [X1 + 15, Y0 - 15], [X1 + 15, Y1 + 15], [X0 - 15, Y1 + 15]];

// Collects flat strips that run all the way round the pitch. A strip goes from `o0` metres outside the walls at
// height `z0` to `o1` metres outside at `z1`; its picture (if any) runs along it in metres.
export function shell() {
  const pos = [], uv = [];
  const corners = o => [[X0 - o, Y0 - o], [X0 - o, Y1 + o], [X1 + o, Y1 + o], [X1 + o, Y0 - o]]; // clockwise from above: writing reads left to right from the pitch
  return {
    ring(o0, z0, o1, z1) {
      const A = corners(o0), B = corners(o1); let u = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, len = Math.hypot(A[j][0] - A[i][0], A[j][1] - A[i][1]);
        pos.push(A[i][0], A[i][1], z0, A[j][0], A[j][1], z0, B[j][0], B[j][1], z1, A[i][0], A[i][1], z0, B[j][0], B[j][1], z1, B[i][0], B[i][1], z1);
        uv.push(u, 0, u + len, 0, u + len, 1, u, 0, u + len, 1, u, 1); u += len;
      }
      return this;
    },
    mesh(mat) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals(); return new THREE.Mesh(g, mat);
    },
  };
}
const flat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide, ...o });

export function buildStadium(w) {
  const stands = w.stands, crowd = w.crowd;
  let seed = 11; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Advert boards: bright blocks with a word each, sliding slowly sideways (the world moves `boards`).
  const WORDS = [['HEADS UP!', '#e5263a'], ['LOOK', '#1668e3'], ['PASS', '#0aa35a'], ['DRIBBLE', '#f5a400'], ['SHOOT', '#7a2ee6'], ['GOAL!', '#0c9bb5']];
  const led = w.boards = canvasTex(2048, 64, g => {
    const bw = 2048 / WORDS.length; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 46px Fredoka, system-ui, sans-serif';
    WORDS.forEach(([word, c], i) => { g.fillStyle = c; g.fillRect(i * bw, 0, bw, 64); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(i * bw, 0, 6, 64); g.fillStyle = '#fff'; g.fillText(word, (i + .5) * bw, 35); });
  });
  led.wrapS = THREE.RepeatWrapping; led.repeat.set(1 / 32, 1);
  stands.add(shell().ring(.25, .06, .25, 1.06).mesh(new THREE.MeshBasicMaterial({ map: led, side: THREE.DoubleSide, color: new THREE.Color(1.08, 1.08, 1.08) })));

  // The bowl: a track, a front wall, then steps. The fronts of the steps are the seat colour.
  const concrete = shell().ring(.3, .015, off(0), .015).ring(off(0), 0, off(0), rz(0)), seats = shell();
  for (let r = 0; r < ROWS; r++) { concrete.ring(off(r), rz(r), off(r + 1), rz(r)); if (r) seats.ring(off(r), rz(r - 1), off(r), rz(r)); }
  concrete.ring(off(ROWS), rz(ROWS - 1), off(ROWS), TOP + .3);
  const roof = shell().ring(off(ROWS) + .4, TOP, off(ROWS) - 8, TOP + 1.7), strip = shell().ring(off(ROWS) - 8, TOP + 1.7, off(ROWS) - 8.5, TOP + 1.5);
  stands.add(concrete.mesh(flat('#1d2233')), seats.mesh(flat('#1b3170')), roof.mesh(flat('#161b2b')), strip.mesh(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.1, 3.5), side: THREE.DoubleSide })));

  // Fans: one on most seats, right round the corners.
  const fans = [], SHIRTS = ['#e46a5a', '#f2c14e', '#ffffff', '#6aa6d8', '#a36ad8', '#30343f'], SKINS = ['#f0c8a6', '#c9955f', '#8a5a36', '#5b3a22'];
  WALLS.forEach(wl => {
    const len0 = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]), dx = (wl.b[0] - wl.a[0]) / len0, dy = (wl.b[1] - wl.a[1]) / len0;
    for (let r = 0; r < ROWS; r++) {
      const d = off(r) + .4, n = Math.floor((len0 + 2 * d) / .64);
      for (let k = 0; k < n; k++) {
        const s = -d + (k + .5) * (len0 + 2 * d) / n; if (rand() > .9) continue;
        fans.push({ x: wl.a[0] + dx * s + wl.o[0] * d, y: wl.a[1] + dy * s + wl.o[1] * d, z: rz(r), ph: rand() * 6.3, pick: rand(), c: SHIRTS[Math.floor(rand() * SHIRTS.length)], s: SKINS[Math.floor(rand() * SKINS.length)] });
      }
    }
  });
  const U = w.crowdU = { uTime: { value: 0 }, uExcite: { value: 0 } }, ph = new Float32Array(fans.map(f => f.ph));
  // Each fan sways a little all the time and jumps when the crowd is excited, a little out of step with the next.
  const lively = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'attribute float aPh; uniform float uTime, uExcite;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += 0.03 * sin(uTime * 1.7 + aPh) + uExcite * 0.4 * abs(sin(uTime * 6.5 + aPh));');
    };
    return m;
  };
  const part = (geo, dz, colour) => {
    geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    const mesh = new THREE.InstancedMesh(geo, lively(new THREE.MeshLambertMaterial({ color: '#8e8e9c' })), fans.length), mtx = new THREE.Matrix4(), col = new THREE.Color();
    fans.forEach((f, k) => { mesh.setMatrixAt(k, mtx.makeTranslation(f.x, f.y, f.z + dz)); mesh.setColorAt(k, col.set(colour(f))); });
    mesh.frustumCulled = false; crowd.add(mesh); return mesh;
  };
  const bodies = part(new THREE.CylinderGeometry(.12, .19, .56, 6).rotateX(Math.PI / 2), .28, f => f.c), heads = part(new THREE.SphereGeometry(.125, 6, 4), .7, f => f.s);
  w.fans = fans; w.fanMeshes = { bodies, heads };

  // Camera flashes: a few fans at a time, more when the crowd is excited.
  const fp = [], fph = [];
  for (let k = 0; k < 420; k++) { const f = fans[Math.floor(rand() * fans.length)]; fp.push(f.x, f.y, f.z + .8); fph.push(rand()); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('aPh', new THREE.Float32BufferAttribute(fph, 1));
  const flashes = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aPh; uniform float uTime, uExcite; varying float vA; void main() { float t = fract(uTime * (0.09 + 0.07 * fract(aPh * 7.3)) + aPh); vA = step(0.988 - 0.05 * uExcite, t); gl_PointSize = 7.0 * vA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vA; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(3.0, 3.1, 3.6) * vA * smoothstep(0.5, 0.1, d), 1.0); }',
  }));
  flashes.frustumCulled = false; crowd.add(flashes);

  // Floodlight towers behind the four corners: a mast, a bank of lamps tipped at the pitch, and a soft glow.
  const lamps = canvasTex(256, 128, g => {
    g.fillStyle = '#0b0d14'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(16 + i * 32, 16 + j * 32, 11, 0, 7); g.fill(); }
  });
  const glow = canvasTex(128, 128, g => {
    const r = g.createRadialGradient(64, 64, 2, 64, 64, 62); r.addColorStop(0, 'rgba(235,242,255,.9)'); r.addColorStop(.25, 'rgba(200,220,255,.35)'); r.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
  const mastM = flat('#3a4258'), lampM = new THREE.MeshBasicMaterial({ map: lamps, color: new THREE.Color(5, 5.2, 5.8), side: THREE.DoubleSide }), glowM = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: .75 });
  for (const [x, y] of TOWERS) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.35, .6, LAMP, 8).rotateX(Math.PI / 2), mastM); mast.position.set(x, y, LAMP / 2);
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.6), lampM); bank.up.set(0, 0, 1); bank.position.set(x, y, LAMP + 1); bank.lookAt(CX, CY, 0);
    const halo = new THREE.Sprite(glowM); halo.position.set(x, y, LAMP + 1); halo.scale.setScalar(22);
    stands.add(mast, bank, halo);
  }
}
