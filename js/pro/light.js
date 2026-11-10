// Light effects of the 'pro' style. `makeEnv` paints a small picture of the surroundings (sky, ground, the sun or
// the four lamps) that boots, the ball and skin reflect. `buildBeams` adds what floodlights do to night air: a
// soft cone of light from each tower and a wide streak across each lamp. `sunSprite` is the sun's glare by day.
import * as THREE from 'three';
import { canvasTex, CX, CY } from '../world.js';

const DOME = {
  vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top, horizon, ground; varying vec3 vD; void main() { float h = normalize(vD).z; gl_FragColor = vec4(h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, pow(-h, 0.35)), 1.0); }',
};
const col = (c, k = 1) => new THREE.Color(c).multiplyScalar(k);

// `lamps` is a list of [x, y, z (from the middle of the pitch), colour, brightness, size].
export function makeEnv(renderer, { top, horizon, ground, lamps }) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ ...DOME, side: THREE.BackSide, uniforms: { top: { value: col(top) }, horizon: { value: col(horizon) }, ground: { value: col(ground) } } })));
  const ball = new THREE.SphereGeometry(1, 16, 10);
  for (const [x, y, z, c, k, size] of lamps) {
    const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: col(c, k) })), d = 40 / Math.hypot(x, y, z);
    m.position.set(x * d, y * d, z * d); m.scale.setScalar(size); scene.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(scene, .035, .1, 100).texture;
  pm.dispose(); scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

const glare = (w, h, stops) => canvasTex(w, h, g => {
  g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2); g.scale(1, h / w);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, w / 2); stops.forEach(([at, a]) => r.addColorStop(at, `rgba(255,255,255,${a})`));
  g.fillStyle = r; g.fillRect(-w / 2, -w / 2, w, w);
});
const sprite = (map, opacity, sx, sy) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity }));
  s.scale.set(sx, sy, 1); return s;
};

export function buildBeams(group, towers, z) {
  const H = 46, geo = new THREE.CylinderGeometry(1.6, 15, H, 40, 1, true).translate(0, -H / 2, 0), down = new THREE.Vector3(0, -1, 0), dir = new THREE.Vector3();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying float vT; varying vec3 vN, vV; void main() { vT = -position.y / ${H}.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: 'varying float vT; varying vec3 vN, vV; void main() { float f = abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(vec3(0.62, 0.74, 1.0) * pow(f, 3.0) * pow(clamp(1.0 - vT, 0.0, 1.0), 2.2) * 0.2, 1.0); }',
  });
  const streak = glare(256, 32, [[0, .9], [.12, .35], [1, 0]]), star = glare(128, 128, [[0, 1], [.08, .6], [.3, .12], [1, 0]]);
  for (const [x, y] of towers) {
    const beam = new THREE.Mesh(geo, mat); beam.position.set(x, y, z);
    beam.quaternion.setFromUnitVectors(down, dir.set(CX - x, CY - y, -z).normalize()); beam.renderOrder = 3; group.add(beam);
    const a = sprite(streak, .55, 90, 5), b = sprite(star, .8, 13, 13);
    a.position.set(x, y, z); b.position.set(x, y, z); group.add(a, b);
  }
}

// The sun: a small hot middle, a wide warm glow and a thin streak, far away in the direction the light comes from.
export function sunSprite(group, from) {
  const d = 250 / Math.hypot(...from), at = [CX + from[0] * d, CY + from[1] * d, from[2] * d];
  const glow = sprite(glare(256, 256, [[0, 1], [.05, .9], [.12, .3], [.4, .07], [1, 0]]), 1, 150, 150), streak = sprite(glare(256, 32, [[0, .6], [.2, .15], [1, 0]]), .5, 340, 12);
  glow.material.color.set('#ffe2b0'); streak.material.color.set('#ffd9a0');
  glow.position.set(...at); streak.position.set(...at); group.add(glow, streak);
}
