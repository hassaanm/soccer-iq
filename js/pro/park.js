// The training ground, on a sunny day: a white fence round the pitch, rounded trees, training
// cones along one side, and soft green hills far away.
import * as THREE from 'three';
import { PITCH } from '../skills.js';
import { canvasTex } from '../tex.js';
import { shell } from './stadium.js';

const { L, W } = PITCH, CX = L / 2, CY = W / 2, UP = new THREE.Vector3(0, 0, 1);

export function buildPark(w) {
  const park = w.park;
  let seed = 23; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const soft = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .9, ...o });
  // The fence: posts and three rails painted on a see-through strip, one post every two metres.
  const fence = canvasTex(128, 64, g => {
    g.clearRect(0, 0, 128, 64); g.fillStyle = '#f4f6f8';
    g.fillRect(0, 0, 128, 7); g.fillRect(0, 26, 128, 5); g.fillRect(0, 48, 128, 5); g.fillRect(0, 0, 9, 64);
    g.fillStyle = 'rgba(120,140,160,.5)'; g.fillRect(0, 5, 128, 2); g.fillRect(0, 30, 128, 1); g.fillRect(0, 52, 128, 1); g.fillRect(8, 0, 1, 64);
  });
  fence.wrapS = THREE.RepeatWrapping; fence.repeat.set(.5, 1);
  const rail = shell().ring(0, 0, 0, 1.05).mesh(new THREE.MeshStandardMaterial({ map: fence, alphaTest: .5, side: THREE.DoubleSide, roughness: .7 }));
  park.add(rail);

  // Trees: a trunk and three round clumps of leaves each. Near ones stand in rows behind the fence.
  const trees = [], tree = (x, y, s) => trees.push({ x, y, s, c: rand() });
  for (let x = -14; x <= L + 14; x += 5.5) { tree(x + rand() * 2, -12 - rand() * 5, 5 + rand() * 3); tree(x + rand() * 2, W + 12 + rand() * 5, 5 + rand() * 3); }
  for (let y = -6; y <= W + 6; y += 5.5) { tree(-14 - rand() * 5, y + rand() * 2, 5 + rand() * 3); tree(L + 14 + rand() * 5, y + rand() * 2, 5 + rand() * 3); }
  for (let k = 0; k < 70; k++) { const a = rand() * Math.PI * 2, d = 34 + rand() * 50; tree(CX + Math.cos(a) * d * 1.2, CY + Math.sin(a) * d, 5 + rand() * 5); }
  const inst = (geo, n) => { const m = new THREE.InstancedMesh(geo, soft('#ffffff'), n); m.castShadow = true; park.add(m); return m; };
  const trunks = inst(new THREE.CylinderGeometry(.14, .24, 1, 8).rotateX(Math.PI / 2), trees.length), leaves = inst(new THREE.IcosahedronGeometry(1, 2), trees.length * 3);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color(), dark = new THREE.Color('#2f7a3c'), light = new THREE.Color('#7cc060');
  const put = (mesh, k, x, y, z, sx, sz, c, spin = 0) => { mesh.setMatrixAt(k, mtx.compose(v.set(x, y, z), q.setFromAxisAngle(UP, spin), sc.set(sx, sx, sz))); mesh.setColorAt(k, c); };
  trees.forEach((t, k) => {
    const s = t.s, a = k * 2.4;
    put(trunks, k, t.x, t.y, s * .22, s * .2, s * .44, col.set('#6b4a2e'));
    put(leaves, k * 3, t.x, t.y, s * .62, s * .34, s * .3, col.copy(dark).lerp(light, t.c * .6), a);
    put(leaves, k * 3 + 1, t.x + Math.cos(a) * s * .16, t.y + Math.sin(a) * s * .16, s * .78, s * .26, s * .24, col.copy(dark).lerp(light, .3 + t.c * .6), a);
    put(leaves, k * 3 + 2, t.x - Math.cos(a) * s * .14, t.y - Math.sin(a) * s * .14, s * .9, s * .2, s * .19, col.copy(dark).lerp(light, .55 + t.c * .45), a);
  });

  // Training cones in two rows behind the far touchline.
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(.16, .3, 12).rotateX(Math.PI / 2), soft('#ffffff', { roughness: .6 }), 12);
  for (let k = 0; k < 12; k++) put(cones, k, 4 + k * 2, W + 3.2 + (k % 2) * .8, .15, 1, 1, col.set(k % 3 ? '#ff7a1a' : '#ffe14a'));
  cones.castShadow = true; park.add(cones);

  // Hills far away: wide, low and smooth, lighter the further they are (the air does the rest).
  const hill = new THREE.SphereGeometry(1, 28, 14), HILLS = ['#6fae62', '#83bd72', '#5f9f5c'];
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2 + rand() * .2, d = 120 + rand() * 60, s = 30 + rand() * 30;
    const h = new THREE.Mesh(hill, soft(HILLS[k % 3])); h.scale.set(s * 1.5, s * 1.5, s * .32); h.rotation.z = a;
    h.position.set(CX + Math.cos(a) * d, CY + Math.sin(a) * d, -s * .06); park.add(h);
  }
}
