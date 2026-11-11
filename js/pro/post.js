// The last steps of a frame: bright things glow (bloom), then one pass adds the glow, sets the exposure, squeezes
// the bright range into what a screen can show (tone curve), deepens the colours and darkens the corners a little.
// (The bloom pass would add its glow onto the picture itself; the grade pass adding it saves drawing the whole
// picture once more, and on a phone that is a big part of the frame.)
// The same pass splits the colours a hair toward the corners, as a camera lens does, and adds a grain too fine
// to see that stops smooth skies from showing steps (banding).
// The extra three.js parts load after the game has started; until they arrive, or if they can't, `makePost`
// gives nothing back and the world draws straight to the screen.
import * as THREE from 'three';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, uBloom: { value: 1 }, uExposure: { value: 1 }, uSat: { value: 1.12 }, uVig: { value: .35 }, uLift: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tBloom; uniform float uBloom, uExposure, uSat, uVig; uniform vec3 uLift; varying vec2 vUv;
    vec3 curve(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 at(vec2 uv) { vec4 b = texture2D(tBloom, uv); return texture2D(tDiffuse, uv).rgb + b.rgb * b.a * uBloom; } // the picture and its glow (as the bloom pass blends it)
    void main() {
      vec2 o = (vUv - 0.5) * dot(vUv - 0.5, vUv - 0.5) * 0.006; // colours split a little towards the corners, as in a real lens
      vec3 c = curve(vec3(at(vUv - o).r, at(vUv).g, at(vUv + o).b) * uExposure);
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
    // The glow is added by the grade pass, so the bloom pass skips its last step (blending it onto the picture).
    const quad = bloom.fsQuad, draw = quad.render.bind(quad);
    quad.render = r => { if (quad.material !== bloom.blendMaterial) draw(r); };
    grade.uniforms.tBloom.value = bloom.renderTargetsHorizontal[0].texture;
    let css = [1, 1], scale = 1;
    const post = {
      bloom, grade: grade.uniforms, composer,
      setSize(w, h) {
        css = [w, h]; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
        if (scale < 1) bloom.setSize(Math.round(w * renderer.getPixelRatio() * scale), Math.round(h * renderer.getPixelRatio() * scale));
      },
      // For slow devices (see the governor in world.js): 1 is the full glow, .5 works it out on a quarter of the
      // pixels (a little softer), 0 turns it off.
      setBloom(k) { scale = k; bloom.enabled = k > 0; grade.uniforms.uBloom.value = k > 0 ? 1 : 0; post.setSize(...css); },
      render() { composer.render(); },
    };
    return post;
  } catch (e) { console.warn('No glow effects: drawing the plain picture.', e); return null; }
}
