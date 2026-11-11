// The sky, drawn per pixel on a big dome: three bands of colour from the horizon up, a warm
// glow around the sun, and clouds made from layered noise that drift slowly. The clouds are bright at their thin
// edges, darker in their thick middles, and catch the sun's colour on the side that faces it.
import * as THREE from 'three';

const FRAG = `
uniform vec3 top, mid, horizon, sun, sunC, cloudC, shadeC; uniform float uTime, cloud;
varying vec3 vD;
float sh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * sn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vD); float z = clamp(d.z, 0.0, 1.0), s = max(dot(d, sun), 0.0);
  vec3 c = mix(mix(horizon, mid, smoothstep(0.0, 0.2, z)), top, smoothstep(0.1, 0.8, z));
  c += sunC * (pow(s, 60.0) * 0.6 + pow(s, 5.0) * 0.3);
  vec2 p = d.xy / (z + 0.14) * 0.9 + vec2(uTime * 0.004, 0.0);   // the dome flattened into a ceiling of cloud
  float f = fbm(p) + 0.25 * fbm(p * 3.1 + 5.0) - 0.12;
  float cover = smoothstep(0.46, 0.74, f) * smoothstep(0.03, 0.22, z) * cloud;
  vec3 cc = mix(cloudC, shadeC, smoothstep(0.55, 0.95, f)) + sunC * pow(s, 3.0) * 0.5 * (1.0 - smoothstep(0.5, 0.8, f));
  gl_FragColor = vec4(mix(c, cc, cover), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// `sun` is the direction to the sun. Returns the dome and its settings (`u`): the colours, `cloud` (how much
// cloud, 0 to 1) and `uTime` (seconds, which moves the clouds).
export function makeSky(sun) {
  const col = () => ({ value: new THREE.Color() });
  const u = { top: col(), mid: col(), horizon: col(), sunC: col(), cloudC: col(), shadeC: col(), sun: { value: new THREE.Vector3(...sun).normalize() }, uTime: { value: 0 }, cloud: { value: 1 } };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: u, fragmentShader: FRAG,
    vertexShader: 'varying vec3 vD; void main() { vD = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  }));
  mesh.rotation.x = Math.PI / 2;
  return { mesh, u };
}
