// The 'pro' art style: a match on TV. Training is a sunny day at the training ground; matches are at night in a
// full stadium under four floodlights. It keeps the game side of `World` (markers, effects, camera) and replaces
// the sky, the lights, the grass, the surroundings, the players and the last step that draws a frame.
import * as THREE from 'three';
import { PITCH } from './skills.js';
import { World, canvasTex, IDS, CX, CY } from './world.js';
import { makeRig, animateRig, RIM } from './pro/rig.js';
import { makePost } from './pro/post.js';
import { buildStadium, TOWERS } from './pro/stadium.js';
import { buildPark } from './pro/park.js';

const { L, W } = PITCH;
// Everything that differs between the two times of day. `key` is the sun by day; by night it and three `fill`
// lights are the four floodlights.
const LOOKS = {
  day: { top: '#1f6fd6', horizon: '#9fcbf3', fog: ['#b4d6f3', 80, 300], hemi: ['#d8eaff', '#7a9c5c', 1.15], key: ['#fff0d0', 2.9], fill: 0, exposure: 1.05, bloom: .2, rim: ['#fff3da', .3], vig: .25, sat: 1.12 },
  night: { top: '#02040b', horizon: '#111c40', fog: ['#0a1230', 90, 320], hemi: ['#9db0ff', '#24502a', .42], key: ['#f2f6ff', 1.35], fill: 1.3, exposure: 1.1, bloom: .5, rim: ['#d2e2ff', .55], vig: .42, sat: 1.16 },
};
const SUN = [-13, -16, 26], LAMP_Z = 26;

export class ProWorld extends World {
  constructor(canvas, opts) {
    super(canvas, opts);
    makePost(this.renderer, this.scene, this.camera).then(post => {
      if (!post) return;
      this.post = post; post.setSize(this.width, this.height); this.applyLook();
    });
  }
  makeRig(p, kit, isHero) { return makeRig(p, kit, isHero); }
  animate(g, a, sim, mood, moodT) { animateRig(g, a, sim, mood, moodT); }
  resize(w, h) { super.resize(w, h); this.post?.setSize(w, h); }
  draw(camera) { if (this.post) this.post.render(); else this.renderer.render(this.scene, camera); }

  buildSky() {
    const scene = this.scene;
    scene.background = new THREE.Color(); scene.fog = new THREE.Fog('#000000', 80, 300);
    this.skyU = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU,
      vertexShader: 'varying float vH; void main() { vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float vH; void main() { gl_FragColor = vec4(mix(horizon, top, pow(clamp(vH, 0.0, 1.0), 0.5)), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    }));
    sky.rotation.x = Math.PI / 2; sky.position.set(CX, CY, 0); scene.add(sky);
    // Night: stars. Day: a few soft clouds that drift slowly around the pitch (`render` turns `clouds`).
    let seed = 3; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = [];
    for (let k = 0; k < 700; k++) { const a = rand() * Math.PI * 2, e = .12 + rand() * 1.4, d = 280; pts.push(CX + Math.cos(a) * Math.cos(e) * d, CY + Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d); }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.7, 2), size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: .85 }));
    scene.add(this.stars);
    const puff = canvasTex(128, 128, g => {
      const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(.6, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    });
    const cloudM = new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false, fog: false, opacity: .9 });
    this.clouds = new THREE.Group(); this.clouds.position.set(CX, CY, 0); scene.add(this.clouds);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + rand(), d = 170 + rand() * 60, z = 42 + rand() * 40, n = 5 + Math.floor(rand() * 4), s = 26 + rand() * 18;
      for (let j = 0; j < n; j++) {
        const sp = new THREE.Sprite(cloudM), o = (j - (n - 1) / 2) * s * .45;
        sp.position.set(Math.cos(a) * d - Math.sin(a) * o, Math.sin(a) * d + Math.cos(a) * o, z + (j % 2) * s * .14 + rand() * 3);
        sp.scale.set(s * (1 - Math.abs(o) / (n * s * .45) * .7), s * .55 * (1 - Math.abs(o) / (n * s * .45) * .6), 1); this.clouds.add(sp);
      }
    }
  }
  buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight('#ffffff', '#ffffff', 1); this.hemi.position.set(0, 0, 1); scene.add(this.hemi);
    this.keys = TOWERS.map((t, i) => {
      const l = new THREE.DirectionalLight('#ffffff', 1); l.position.set(t[0], t[1], LAMP_Z); l.target.position.set(CX, CY, 0); scene.add(l, l.target);
      if (!i) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -.0004; l.shadow.normalBias = .02; Object.assign(l.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 }); }
      return l;
    });
    this.sun = this.keys[0];
  }

  // Deeper, mown grass: stripes across the pitch, a soft checker, blades, and a little wear in front of each goal.
  paintGrass(g, X, Y, ppm, TW, TH) {
    g.fillStyle = '#3d8f3a'; g.fillRect(0, 0, TW, TH);
    for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#368634' : '#48a043'; g.fillRect(X(i * 3), 0, 3 * ppm, TH); }
    for (let j = -2; j < 7; j++) { g.fillStyle = j % 2 ? 'rgba(255,255,190,.03)' : 'rgba(0,40,10,.03)'; g.fillRect(0, Y((j + 1) * 4), TW, 4 * ppm); }
    let sd = 7; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 90000; k++) { g.fillStyle = rr() < .5 ? 'rgba(10,60,20,.10)' : 'rgba(210,255,150,.08)'; g.fillRect(rr() * TW, rr() * TH, 1.5, 2 + rr() * 3); }
    for (const x of [1.2, L - 1.2]) { const w = g.createRadialGradient(X(x), Y(CY), 0, X(x), Y(CY), 3.2 * ppm); w.addColorStop(0, 'rgba(150,130,70,.2)'); w.addColorStop(1, 'rgba(150,130,70,0)'); g.fillStyle = w; g.fillRect(X(x) - 4 * ppm, Y(CY) - 4 * ppm, 8 * ppm, 8 * ppm); }
  }
  buildPitch() {
    super.buildPitch();
    this.outer.material.color.set('#3a8a37');
    // Under four floodlights every player throws four shadows. The key light draws one for real; the other three
    // are soft streaks on the grass, one row of this mesh each, pointed away from their lamp every frame.
    const streak = canvasTex(128, 64, g => {
      const a = g.createLinearGradient(0, 0, 128, 0); a.addColorStop(0, 'rgba(0,0,0,.55)'); a.addColorStop(.35, 'rgba(0,0,0,.4)'); a.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = a; g.fillRect(0, 0, 128, 64);
      g.globalCompositeOperation = 'destination-in';
      const v = g.createLinearGradient(0, 0, 0, 64); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = v; g.fillRect(0, 0, 128, 64);
    });
    this.streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, .5).translate(.42, 0, 0), new THREE.MeshBasicMaterial({ map: streak, transparent: true, depthWrite: false, opacity: .5 }), IDS.length * 3 + 3);
    this.streaks.frustumCulled = false; this.streaks.count = 0; this.streaks.renderOrder = 1; this.scene.add(this.streaks);
    this.m4 = new THREE.Matrix4(); this.e3 = new THREE.Euler(); this.q4 = new THREE.Quaternion(); this.p3 = new THREE.Vector3(); this.s3 = new THREE.Vector3();
  }

  buildEnv() {
    this.park = new THREE.Group(); this.stands = new THREE.Group(); this.crowd = new THREE.Group(); this.excite = 0;
    buildStadium(this); buildPark(this);
    this.scene.add(this.park, this.stands, this.crowd);
    this.setEnv('crowd');
  }
  setEnv(env) {
    super.setEnv(env);
    this.night = env !== 'park'; this.look = LOOKS[this.night ? 'night' : 'day'];
    const k = this.look, scene = this.scene;
    scene.background.set(k.horizon); scene.fog.color.set(k.fog[0]); scene.fog.near = k.fog[1]; scene.fog.far = k.fog[2];
    this.skyU.top.value.set(k.top); this.skyU.horizon.value.set(k.horizon);
    this.stars.visible = this.night; this.clouds.visible = !this.night;
    this.hemi.color.set(k.hemi[0]); this.hemi.groundColor.set(k.hemi[1]); this.hemi.intensity = k.hemi[2];
    this.keys.forEach((l, i) => { l.color.set(k.key[0]); l.intensity = i ? k.fill : k.key[1]; });
    const t = this.night ? [...TOWERS[0], LAMP_Z] : SUN; this.keys[0].position.set(t[0], t[1], t[2]);
    RIM.color.value.set(k.rim[0]); RIM.k.value = k.rim[1];
    this.applyLook();
  }
  applyLook() {
    const k = this.look; this.renderer.toneMappingExposure = k.exposure;
    if (!this.post) return;
    this.post.bloom.strength = k.bloom; this.post.grade.uExposure.value = k.exposure; this.post.grade.uVig.value = k.vig; this.post.grade.uSat.value = k.sat;
  }
  moveCrowd(time) { this.crowdU.uTime.value = time; this.crowdU.uExcite.value = this.excite; } // the fans move in the shader (see pro/stadium.js)

  beforeDraw(sim, dt, time) {
    this.boards.offset.x = time * .012;
    // Floodlight shadows: one streak per player and lamp (not the key lamp), and the same for the ball.
    let n = 0;
    if (this.night) {
      const put = (x, y, h) => {
        for (let i = 1; i < TOWERS.length; i++) {
          const dx = x - TOWERS[i][0], dy = y - TOWERS[i][1], d = Math.hypot(dx, dy);
          this.streaks.setMatrixAt(n++, this.m4.compose(this.p3.set(x, y, .017), this.q4.setFromEuler(this.e3.set(0, 0, Math.atan2(dy, dx))), this.s3.set(h * d / LAMP_Z * 1.25, h * .62, 1)));
        }
      };
      for (let i = 0; i < IDS.length; i++) { const g = this.rigs.get(IDS[i]); if (g?.visible) put(g.position.x, g.position.y, 1.5); }
      if ((sim.ball.z || 0) < .5) put(sim.ball.x, sim.ball.y, .45);
      this.streaks.instanceMatrix.needsUpdate = true;
    }
    this.streaks.count = n;
  }
}
