// The 'pro' art style: a match on TV. Training is a sunny day at the training ground; matches are at night in a
// full stadium under four floodlights. It keeps the game side of `World` (markers, effects, camera) and replaces
// the sky, the lights, the grass, the surroundings, the players and the last step that draws a frame.
import * as THREE from 'three';
import { PITCH } from './skills.js';
import { World, canvasTex, IDS, CX, CY } from './world.js';
import { makeRig, RIM } from './pro/rig.js';
import { animateRig } from './pro/motion.js';
import { makePost } from './pro/post.js';
import { buildStadium, TOWERS } from './pro/stadium.js';
import { buildPark } from './pro/park.js';
import { makeEnv, buildBeams, sunSprite } from './pro/light.js';
import { makeSky } from './pro/sky.js';
import { turf } from './pro/grass.js';

const { L, W } = PITCH;
// Everything that differs between the two times of day. `key` is the sun by day; by night it and three `fill`
// lights are the four floodlights.
const LOOKS = {
  day: { top: '#1a55c8', mid: '#62a8f2', horizon: '#ffe6c2', cloudC: '#fff6ea', shadeC: '#a9b4cc', cloud: 1, fog: ['#ead9c2', 80, 300], hemi: ['#cfe2ff', '#86a35f', .8], key: ['#ffdcae', 3.1], fill: 0, exposure: 1.05, bloom: .28, rim: ['#ffe6bd', .45], vig: .28, sat: 1.14, sun: '#ffcf90' },
  night: { top: '#02040b', mid: '#0a1230', horizon: '#111c40', cloudC: '#1d2a55', shadeC: '#070b1a', cloud: .45, fog: ['#0a1230', 90, 320], hemi: ['#9db0ff', '#24502a', .42], key: ['#f2f6ff', 1.35], fill: 1.3, exposure: 1.1, bloom: .5, rim: ['#d2e2ff', .55], vig: .42, sat: 1.16, sun: '#000000' },
};
const SUN = [10, -28, 15], LAMP_Z = 26; // the sun is low on one side (late afternoon), measured from the middle of the pitch
// What shiny things reflect, by day and by night (see pro/light.js).
const ENV = {
  day: { top: '#3f7fd8', horizon: '#f0dcc0', ground: '#3f6a30', lamps: [[...SUN, '#ffe0b0', 60, 3]] },
  night: { top: '#05070f', horizon: '#1a2748', ground: '#0e2a12', lamps: TOWERS.map(t => [t[0] - CX, t[1] - CY, LAMP_Z, '#eaf1ff', 40, 2.5]) },
};

export class ProWorld extends World {
  get ballR() { return .125; } // a ball in proportion to the players: about as wide as a head
  constructor(canvas, opts) {
    super(canvas, opts);
    this.envs = { day: makeEnv(this.renderer, ENV.day), night: makeEnv(this.renderer, ENV.night) };
    this.scene.environment = this.envs[this.night ? 'night' : 'day'];
    this.ball.material = Object.assign(new THREE.MeshStandardMaterial({ roughness: .3 }), { onBeforeCompile: this.ball.material.onBeforeCompile }); // a glossy ball
    makePost(this.renderer, this.scene, this.camera).then(post => {
      if (!post) return;
      this.post = post; post.setSize(this.width, this.height); this.applyLook();
    });
  }
  makeRig(p, kit, isHero) { return makeRig(p, kit, isHero); }
  animate(g, a, sim, mood, moodT) { animateRig(g, a, sim, mood, moodT, this.time); }
  resize(w, h) { super.resize(w, h); this.post?.setSize(w, h); }
  draw(camera) { if (this.post) this.post.render(); else this.renderer.render(this.scene, camera); }

  buildSky() {
    const scene = this.scene;
    scene.background = new THREE.Color(); scene.fog = new THREE.Fog('#000000', 80, 300);
    const sky = makeSky(SUN); this.skyU = sky.u; sky.mesh.position.set(CX, CY, 0); scene.add(sky.mesh);
    // Night: stars.
    let seed = 3; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = [];
    for (let k = 0; k < 700; k++) { const a = rand() * Math.PI * 2, e = .12 + rand() * 1.4, d = 280; pts.push(CX + Math.cos(a) * Math.cos(e) * d, CY + Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d); }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.7, 2), size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: .85 }));
    scene.add(this.stars);
    this.clouds = new THREE.Group(); // the base class turns this group; here the clouds drift inside the sky itself
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
    this.outer.material.color.set('#3a8a37'); turf(this.pitch.material); turf(this.outer.material, false);
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
    buildStadium(this); buildPark(this); buildBeams(this.stands, TOWERS, LAMP_Z + 1); sunSprite(this.park, SUN);
    this.scene.add(this.park, this.stands, this.crowd);
    this.setEnv('crowd');
  }
  setEnv(env) {
    super.setEnv(env);
    this.night = env !== 'park'; this.look = LOOKS[this.night ? 'night' : 'day'];
    const k = this.look, scene = this.scene;
    scene.background.set(k.horizon); scene.fog.color.set(k.fog[0]); scene.fog.near = k.fog[1]; scene.fog.far = k.fog[2];
    for (const n of ['top', 'mid', 'horizon', 'cloudC', 'shadeC']) this.skyU[n].value.set(k[n]);
    this.skyU.sunC.value.set(k.sun); this.skyU.cloud.value = k.cloud;
    if (this.envs) scene.environment = this.envs[this.night ? 'night' : 'day'];
    this.stars.visible = this.night;
    this.hemi.color.set(k.hemi[0]); this.hemi.groundColor.set(k.hemi[1]); this.hemi.intensity = k.hemi[2];
    this.keys.forEach((l, i) => { l.color.set(k.key[0]); l.intensity = i ? k.fill : k.key[1]; });
    const t = this.night ? [...TOWERS[0], LAMP_Z] : [CX + SUN[0], CY + SUN[1], SUN[2]]; this.keys[0].position.set(t[0], t[1], t[2]);
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
    this.boards.offset.x = time * .012; this.skyU.uTime.value = time;
    // Floodlight shadows: one streak per player and lamp (not the key lamp), and the same for the ball.
    let n = 0;
    if (this.night) {
      const put = (x, y, h) => {
        for (let i = 1; i < TOWERS.length; i++) {
          const dx = x - TOWERS[i][0], dy = y - TOWERS[i][1], d = Math.hypot(dx, dy);
          this.streaks.setMatrixAt(n++, this.m4.compose(this.p3.set(x, y, .017), this.q4.setFromEuler(this.e3.set(0, 0, Math.atan2(dy, dx))), this.s3.set(h * d / LAMP_Z * 1.25, h * .62, 1)));
        }
      };
      for (let i = 0; i < IDS.length; i++) { const g = this.rigs.get(IDS[i]); if (g?.visible) put(g.position.x, g.position.y, 1.6); }
      if ((sim.ball.z || 0) < .5) put(sim.ball.x, sim.ball.y, .3);
      this.streaks.instanceMatrix.needsUpdate = true;
    }
    this.streaks.count = n;
  }
}
