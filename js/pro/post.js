// The last steps of a 'pro' frame: bright things glow (bloom), then one pass sets the exposure, squeezes the
// bright range into what a screen can show (tone curve), deepens the colours and darkens the corners a little.
// The same pass splits the colours a hair toward the corners, as a camera lens does, and adds a grain too fine
// to see that stops smooth skies from showing steps (banding).
// The extra three.js parts load after the game has started; until they arrive, or if they can't, `makePost`
// gives nothing back and the world draws straight to the screen.
import * as THREE from 'three';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uExposure: { value: 1 }, uSat: { value: 1.12 }, uVig: { value: .35 }, uLift: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uExposure, uSat, uVig; uniform vec3 uLift; varying vec2 vUv;
    vec3 curve(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 o = (vUv - 0.5) * dot(vUv - 0.5, vUv - 0.5) * 0.006; // colours split a little towards the corners, as in a real lens
      vec3 c = curve(vec3(texture2D(tDiffuse, vUv - o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + o).b) * uExposure);
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSat);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      c *= 1.0 - uVig * smoothstep(0.32, 0.86, length(d));
      c += uLift * (1.0 - c);
      c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0001)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); // to the screen's colour space (sRGB)
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // a little noise, so dark skies have no bands
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export async function makePost(renderer, scene, camera) {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] = await Promise.all(
      ['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'ShaderPass'].map(n => import(`three/addons/postprocessing/${n}.js`)));
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Colours are kept with room above white (half-float), so lamps can be much brighter than a white shirt.
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), .5, .6, 1), grade = new ShaderPass(GRADE);
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(grade);
    return {
      bloom, grade: grade.uniforms,
      setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
      render() { composer.render(); },
    };
  } catch (e) { console.warn('No glow effects: drawing the plain picture.', e); return null; }
}
