// Turns the flat grass picture into turf. Close to the camera you see single blades; a little
// further off, lighter and darker patches; the mown bands change strength with the side you look from, as real
// ones do; and far grass seen at a low angle catches the light. All of it is worked out per pixel on the
// graphics card from where the pixel is on the ground, so it costs no extra pictures.
// The world sets `TURF` for the time of day: by day slow cloud shadows drift over the grass; by night the
// floodlights make a pool of light on the pitch that falls off past the lines, as on TV.
import * as THREE from 'three';

// uTurf: x cloud shadows (0 off), y time (s), z floodlight pool (0 off), w colour strength (1 as painted).
// uTurfC: the pitch's middle (x, y) and half its length and width (z, w).
export const TURF = { uTurf: { value: new THREE.Vector4(0, 0, 0, 1) }, uTurfC: { value: new THREE.Vector4(15, 10, 15, 10) } };
const HEAD = `
varying vec3 vTurf;
uniform vec4 uTurf, uTurfC;
float thash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(thash(i), thash(i + vec2(1.0, 0.0)), f.x), mix(thash(i + vec2(0.0, 1.0)), thash(i + vec2(1.0, 1.0)), f.x), f.y); }
// Detail of a given size that fades out before it gets smaller than a pixel (so far grass does not shimmer).
// Where it has faded out, the noise is not worked out at all: most far grass skips the fine layers.
float tlayer(vec2 p) { vec2 w = fwidth(p); float k = smoothstep(1.1, 0.25, max(w.x, w.y)); return k > 0.0 ? (tnoise(p) - 0.5) * k : 0.0; }
`;
const BODY = bands => `
  vec3 tv = cameraPosition - vTurf; tv /= length(tv);
  float blades = tlayer(vTurf.xy * vec2(120.0, 64.0)) * 0.26 + tlayer(vTurf.xy * vec2(46.0, 31.0)) * 0.34 + tlayer(vTurf.xy * 14.0 + 7.0) * 0.16;
  float patches = tlayer(vTurf.xy * 2.7) * 0.10 + tlayer(vTurf.xy * 0.6 + 3.0) * 0.10;
  float band = ${bands ? '(mod(floor(vTurf.x / 3.0), 2.0) < 0.5 ? 1.0 : -1.0) * (0.07 + 0.05 * uTurf.z) * tv.x' : '0.0'};
  float graze = pow(1.0 - clamp(tv.z, 0.0, 1.0), 5.0);
  diffuseColor.rgb *= (1.0 + blades + patches + band) * (1.0 + 0.22 * graze);
  diffuseColor.rgb += vec3(0.030, 0.040, 0.010) * graze;
  diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, uTurf.w);
  if (uTurf.x > 0.0) {   // day: soft cloud shadows drifting slowly across
    vec2 q = vTurf.xy * 0.045 + uTurf.y * vec2(0.012, 0.005);
    float c = tnoise(q) * 0.65 + tnoise(q * 2.3 + 5.0) * 0.35;
    diffuseColor.rgb *= 1.0 - uTurf.x * smoothstep(0.4, 0.6, c);
  }
  if (uTurf.z > 0.0) {   // night: the floodlights' pool, brightest on the pitch, falling off past the lines
    vec2 e = max(abs(vTurf.xy - uTurfC.xy) - uTurfC.zw, 0.0);
    diffuseColor.rgb *= 1.0 - uTurf.z * smoothstep(0.0, 9.0, length(e));
  }
`;

export function turf(mat, bands = true) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, TURF);
    sh.vertexShader = 'varying vec3 vTurf;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTurf = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = HEAD + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + BODY(bands));
  };
  mat.customProgramCacheKey = () => 'turf' + bands;
  mat.needsUpdate = true;
  return mat;
}
