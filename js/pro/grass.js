// Turns the flat grass picture into turf for the 'pro' style. Close to the camera you see single blades; a little
// further off, lighter and darker patches; the mown bands change strength with the side you look from, as real
// ones do; and far grass seen at a low angle catches the light. All of it is worked out per pixel on the
// graphics card from where the pixel is on the ground, so it costs no extra pictures.
const HEAD = `
varying vec3 vTurf;
float thash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(thash(i), thash(i + vec2(1.0, 0.0)), f.x), mix(thash(i + vec2(0.0, 1.0)), thash(i + vec2(1.0, 1.0)), f.x), f.y); }
// Detail of a given size that fades out before it gets smaller than a pixel (so far grass does not shimmer).
float tlayer(vec2 p) { vec2 w = fwidth(p); return (tnoise(p) - 0.5) * smoothstep(1.1, 0.25, max(w.x, w.y)); }
`;
const BODY = bands => `
  vec3 tv = cameraPosition - vTurf; tv /= length(tv);
  float blades = tlayer(vTurf.xy * vec2(120.0, 64.0)) * 0.26 + tlayer(vTurf.xy * vec2(46.0, 31.0)) * 0.34 + tlayer(vTurf.xy * 14.0 + 7.0) * 0.16;
  float patches = tlayer(vTurf.xy * 2.7) * 0.10 + tlayer(vTurf.xy * 0.6 + 3.0) * 0.10;
  float band = ${bands ? '(mod(floor(vTurf.x / 3.0), 2.0) < 0.5 ? 1.0 : -1.0) * 0.07 * tv.x' : '0.0'};
  float graze = pow(1.0 - clamp(tv.z, 0.0, 1.0), 5.0);
  diffuseColor.rgb *= (1.0 + blades + patches + band) * (1.0 + 0.22 * graze);
  diffuseColor.rgb += vec3(0.030, 0.040, 0.010) * graze;
`;

export function turf(mat, bands = true) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vTurf;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTurf = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = HEAD + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + BODY(bands));
  };
  mat.customProgramCacheKey = () => 'turf' + bands;
  mat.needsUpdate = true;
  return mat;
}
