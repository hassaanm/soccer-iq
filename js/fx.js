// Small visual effects: one pool of little squares, drawn in a single call, for confetti, grass bits,
// sparkles and the trail behind a hard shot. Pieces shrink away instead of fading, so nothing needs sorting.
import * as THREE from 'three';

const MAX = 420;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
// What a piece starts as, before `spawn` adds what the caller asked for.
const BASE = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: -9, drag: 0, size: .1, life: 1, spin: 0, face: false, flutter: 0, round: false };
const GRASS = ['#7fbf52', '#9ed46c', '#6aa84a', '#c9e89a'], GOLD = ['#ffd23f', '#fff3b0', '#ffffff', '#ffb02e'], TRAIL = ['#ffffff', '#fff6d0', '#ffe27a'];
export const TURF_BITS = ['#6aa84a', '#7fbf52', '#5d8f3c', '#7a6a45', '#8f7d55']; // grass and a little earth, for a hard kick

export class Particles {
  constructor(scene) {
    // Each piece is a square (confetti, grass) or a round dot (sparkles, the trail): `aRound` 1 cuts it to a disc.
    const geo = new THREE.PlaneGeometry(1, 1), mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.round = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1); this.round.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aRound', this.round);
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aRound; varying float vRound; varying vec2 vQ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRound = aRound; vQ = position.xy;');
      sh.fragmentShader = 'varying float vRound; varying vec2 vQ;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vRound > 0.5 && dot(vQ, vQ) > 0.25) discard;');
    };
    const mesh = this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.col = new THREE.Color('#ffffff');
    for (let i = 0; i < MAX; i++) { mesh.setMatrixAt(i, this.zero); mesh.setColorAt(i, this.col); }
    this.list = Array.from({ length: MAX }, () => ({ life: 0 }));
    this.next = 0; this.live = 0;
    this.m = new THREE.Matrix4(); this.pos = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
    this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.zAxis = new THREE.Vector3(0, 0, 1);
    scene.add(mesh);
  }

  // One piece. g: gravity, drag: air drag per second, spin: tumble speed, face: always turned to the camera.
  spawn(o) {
    const i = this.next, p = this.list[i]; this.next = (i + 1) % MAX;
    if (!p.life) this.live++;
    Object.assign(p, BASE, o);
    p.age = 0; p.rx = rnd(0, 6.3); p.ry = rnd(0, 6.3); p.rz = rnd(0, 6.3); p.landed = false;
    this.mesh.setColorAt(i, this.col.set(o.color || '#ffffff')); this.mesh.instanceColor.needsUpdate = true;
    if (this.round.array[i] !== +!!o.round) { this.round.array[i] = +!!o.round; this.round.needsUpdate = true; }
  }

  // Paper squares shot up and out from a point; they flutter down and lie on the grass for a moment.
  confetti(x, y, z, colors, n = 60, [dx, dy] = [0, 0]) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(.5, 3.2);
      this.spawn({ x, y, z, vx: Math.cos(a) * r + dx * rnd(.4, 1.3), vy: Math.sin(a) * r + dy * rnd(.4, 1.3), vz: rnd(7, 14), g: -7, drag: 1.7,
        size: rnd(.11, .2), life: rnd(2.6, 4.2), spin: rnd(4, 11), flutter: rnd(.6, 1.6), color: pick(colors) });
    }
  }
  // Bits of grass kicked up where a boot meets the ball.
  puff(x, y, n = 5, colors = GRASS) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(.4, 1.8);
      this.spawn({ x, y, z: .05, vx: Math.cos(a) * r, vy: Math.sin(a) * r, vz: rnd(1.2, 3.2), g: -9, drag: 1, size: rnd(.04, .08), life: rnd(.35, .7), spin: rnd(6, 14), color: pick(colors) });
    }
  }
  // A ring of sparkles for a won ball or a clever play.
  sparks(x, y, z, n = 14, colors = GOLD) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd(-.2, .2), r = rnd(2.2, 4.5);
      this.spawn({ x, y, z, vx: Math.cos(a) * r, vy: Math.sin(a) * r, vz: rnd(1.5, 4.5), g: -6, drag: 2.4, size: rnd(.08, .15), life: rnd(.45, .8), spin: rnd(3, 8), face: true, round: true, color: pick(colors) });
    }
  }
  // One dot left behind a fast ball.
  trail(x, y, z) {
    this.spawn({ x: x + rnd(-.05, .05), y: y + rnd(-.05, .05), z, g: 0, size: rnd(.08, .14), life: rnd(.2, .34), spin: 2, face: true, round: true, color: pick(TRAIL) });
  }

  update(dt, camera) {
    if (!this.live) return;
    const { mesh, m, pos, q, q2, e, s, list } = this;
    for (let i = 0; i < MAX; i++) {
      const p = list[i]; if (!p.life) continue;
      p.age += dt;
      if (p.age >= p.life) { p.life = 0; this.live--; mesh.setMatrixAt(i, this.zero); continue; }
      if (!p.landed) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vz += p.g * dt; p.vx *= k; p.vy *= k; p.vz *= k;
        if (p.flutter && p.vz < 0) { p.vx += Math.sin(p.age * 5 + p.rx) * p.flutter * dt * 3; p.vy += Math.cos(p.age * 4 + p.ry) * p.flutter * dt * 3; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.spin * dt; p.ry += p.spin * .7 * dt; p.rz += p.spin * .4 * dt;
        if (p.z <= .02 && p.vz < 0) { p.z = .02 + i * 1e-5; p.landed = true; p.rx = p.ry = 0; }
      }
      const size = p.size * Math.min(1, p.age / .06) * Math.min(1, (p.life - p.age) / .3);
      if (p.face) q.copy(camera.quaternion).multiply(q2.setFromAxisAngle(this.zAxis, p.rz));
      else q.setFromEuler(e.set(p.rx, p.ry, p.rz));
      mesh.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), q, s.setScalar(size)));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
