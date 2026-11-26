// What Fast mode draws on the grass, in the 3D scene (not over it, so nothing is painted over the picture each frame):
// the guide round him (makeMarks), his own ring, where he is going, hints, and the warning on a defender about to tackle.
// Made once, reused; hidden ones are just not visible; the far ring's dashes are one instanced mesh, set only when they move.
import * as THREE from 'three';
import { PLACE_PIC } from './variant.js';

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const ring = (g, c, r, lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); };
const glow = (g, w, a = .38) => { const c = w / 2, rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, `rgba(255,220,90,${a})`); rg.addColorStop(.7, `rgba(255,210,63,${a * .4})`); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); };
const ball = (g, c, r) => { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill(); g.lineWidth = r * .28; g.strokeStyle = '#24193a'; g.stroke(); g.fillStyle = '#24193a'; g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(c + Math.cos(a) * r * .42, c + Math.sin(a) * r * .42); } g.fill(); };
// (v93 tidy) A spot: a thick gold ring edged in white and then dark ink, so it reads on the bright day grass and the dark
// night grass alike; a white dot in it (with the ball: a ball). Lit (the one he chose): filled gold.
const dot = withBall => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .3); ring(g, c, 38, 16, 'rgba(36,25,58,.55)'); ring(g, c, 38, 11, '#ffffff'); ring(g, c, 38, 7, '#ffcf2e'); if (withBall) ball(g, c, 17); else { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 9, 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(36,25,58,.55)'; g.stroke(); } });
const litT = press => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .55); g.fillStyle = press ? 'rgba(255,122,60,.55)' : 'rgba(255,207,46,.55)'; g.beginPath(); g.arc(c, c, 38, 0, 7); g.fill(); ring(g, c, 38, 16, 'rgba(36,25,58,.55)'); ring(g, c, 38, 11, '#ffffff'); ring(g, c, 38, 7, press ? '#ff7a3c' : '#ffcf2e'); g.fillStyle = press ? '#e8443a' : '#ffffff'; g.beginPath(); g.arc(c, c, 12, 0, 7); g.fill(); });
export const SPOT_M = 1.5;
const tick = withBall => tex(64, 64, (g, w) => { const c = w / 2; g.fillStyle = withBall ? '#ff9f1c' : '#ffd23f'; g.beginPath(); g.arc(c, c, 18, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke(); });
const mine = () => tex(256, 256, (g, w) => { const c = w / 2; ring(g, c, 104, 20, 'rgba(36,25,58,.55)'); ring(g, c, 104, 12, '#ffd23f'); });
const warn = () => tex(256, 256, (g, w) => { const c = w / 2, rg = g.createRadialGradient(c, c, 10, c, c, c); rg.addColorStop(0, 'rgba(255,80,60,.0)'); rg.addColorStop(.6, 'rgba(255,80,60,.35)'); rg.addColorStop(1, 'rgba(255,80,60,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); ring(g, c, 92, 16, '#ff5a3c'); });
const goTo = () => tex(128, 128, (g, w) => { const c = w / 2; ring(g, c, 44, 12, 'rgba(255,255,255,.95)'); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(c, c, 14, 0, 7); g.fill(); });
const hintT = () => tex(128, 128, (g, w) => { glow(g, w, .55); });
const mat = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
// (v93) The fixed spots: a gold ring with a white dot (with the ball: a ball in it); pressing their carrier: an orange ring
// with a red middle. A miss of STEAL: three small stars turning round his feet. A target the keeper covers: grey, crossed.
const pressT = () => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .3); ring(g, c, 38, 16, 'rgba(36,25,58,.55)'); ring(g, c, 38, 11, '#ffffff'); ring(g, c, 38, 7, '#ff7a3c'); g.fillStyle = '#e8443a'; g.beginPath(); g.arc(c, c, 12, 0, 7); g.fill(); });
const dizzyT = () => tex(128, 128, (g, w) => { const c = w / 2; for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3, x = c + Math.cos(a) * 42, y = c + Math.sin(a) * 42; g.fillStyle = '#ffe14d'; g.strokeStyle = '#24193a'; g.lineWidth = 3; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 6 : 15, b = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(x + Math.cos(b) * r, y + Math.sin(b) * r); } g.closePath(); g.fill(); g.stroke(); } });
const shutT = () => tex(128, 128, (g, w) => { const c = w / 2; g.fillStyle = 'rgba(36,25,58,.45)'; g.beginPath(); g.arc(c, c, 56, 0, 7); g.fill(); ring(g, c, 44, 12, 'rgba(200,196,210,.95)'); g.strokeStyle = 'rgba(200,196,210,.95)'; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(c - 24, c - 24); g.lineTo(c + 24, c + 24); g.moveTo(c + 24, c - 24); g.lineTo(c - 24, c + 24); g.stroke(); });

// (v93 variants) A big choice: a fat gold arrow on the grass from his feet, white-edged and ink-outlined (reads on day and
// night grass), pointing +x in the texture. A friend he can pass to: a big gold ring at the friend's feet. A blocked
// lane tapped: a red band for a moment. The ring that drains (variant D): ticks round his feet.
const arrowT = () => tex(256, 64, (g, w, h) => { const c = h / 2, path = () => { g.beginPath(); g.moveTo(6, c - 11); g.lineTo(w - 74, c - 11); g.lineTo(w - 74, c - 27); g.lineTo(w - 8, c); g.lineTo(w - 74, c + 27); g.lineTo(w - 74, c + 11); g.lineTo(6, c + 11); g.closePath(); }; g.lineJoin = 'round'; path(); g.lineWidth = 10; g.strokeStyle = 'rgba(36,25,58,.6)'; g.stroke(); g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke(); const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, 'rgba(255,207,46,.6)'); lg.addColorStop(.5, 'rgba(255,207,46,.95)'); lg.addColorStop(1, '#ffcf2e'); g.fillStyle = lg; g.fill(); });
const friendT = () => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .5); ring(g, c, 50, 16, 'rgba(36,25,58,.55)'); ring(g, c, 50, 11, '#ffffff'); ring(g, c, 50, 7, '#ffcf2e'); });
const laneT = () => tex(64, 16, (g, w, h) => { g.fillStyle = 'rgba(232,68,58,.75)'; g.fillRect(0, 3, w, h - 6); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); });
const tickT = red => tex(32, 32, (g, w) => { g.fillStyle = red ? '#ff5a3c' : '#ffcf2e'; g.strokeStyle = 'rgba(36,25,58,.7)'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, w / 2, 11, 0, 7); g.fill(); g.stroke(); });
export const RING_TICKS = 20, RING_R = 1.25;
// (v96, variant E) A place off the ball: a thick ring on the grass in the colour of what it is for (gold: get open,
// sky blue: goal-side or cover, orange: go to the ball), and standing over it, facing him, a round white card with its
// picture (PLACE_PIC: an open hand, a shield, a foot). The crawl: a soft ring that spreads slowly from his feet.
const PLACE_COL = { open: '#ffcf2e', cover: '#6cc4ff', press: '#ff7a3c', ball: '#ff7a3c' };
const placeT = kind => tex(128, 128, (g, w) => { const c = w / 2, col = PLACE_COL[kind]; glow(g, w, .32); ring(g, c, 40, 18, 'rgba(36,25,58,.6)'); ring(g, c, 40, 12, '#ffffff'); ring(g, c, 40, 8, col); g.fillStyle = col; g.globalAlpha = .35; g.beginPath(); g.arc(c, c, 34, 0, 7); g.fill(); g.globalAlpha = 1; });
const cardT = pic => tex(128, 128, (g, w) => { const c = w / 2; g.fillStyle = 'rgba(36,25,58,.35)'; g.beginPath(); g.arc(c, c + 4, 54, 0, 7); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 54, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = '#24193a'; g.stroke(); g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pic, c, c + 5); });
const waveT = () => tex(128, 128, (g, w) => { const c = w / 2; ring(g, c, 56, 6, 'rgba(255,255,255,.9)'); ring(g, c, 56, 14, 'rgba(190,220,255,.25)'); });

// The guide (v84 round 2): two soft circles round him. Near: eight small dots. Far: a faint broken ring with twelve
// ticks ("you can tap out here"; orange with the ball: a big push). Also: where he chose to go (until he is there), the
// two or three hinted places (a gentle pulse), his own ring and the warning on a defender about to tackle.
export function makeMarks(world) {
  const T = { dot: [dot(false), dot(true)], tick: [tick(false), tick(true)] };
  const geo = new THREE.PlaneGeometry(1, 1), add = (map, size, order = 2, op = 1) => { const m = new THREE.Mesh(geo, mat(map)); m.material.opacity = op; m.scale.setScalar(size); m.visible = false; m.renderOrder = order; world.scene.add(m); return m; };
  const dotM = Array.from({ length: 8 }, () => add(T.dot[0], .95, 2, .75)), tickM = Array.from({ length: 12 }, () => add(T.tick[0], .42, 2, .8));
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: .32, depthWrite: false, toneMapped: false });
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(.55, .07), dashMat, 48); dash.count = 0; dash.renderOrder = 1; dash.frustumCulled = false; world.scene.add(dash);
  const me = add(mine(), 1.6, 3), danger = add(warn(), 2, 3), go = add(goTo(), .8, 3, .9), hintM = Array.from({ length: 3 }, () => add(hintT(), 1.9, 1));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 1);
  let withBall = null, dashKey = '';
  const F = { dot: [dot(false), dot(true)], press: pressT(), lit: [litT(false), litT(true)] }, fixM = Array.from({ length: 8 }, () => add(F.dot[0], 1.3, 2, .9)), dizzy = add(dizzyT(), 1.1, 4), shutM = Array.from({ length: 6 }, () => { const m = add(shutT(), .8, 5); m.material.side = THREE.DoubleSide; return m; });
  const VT = { arrow: arrowT(), friend: friendT(), lane: laneT(), tick: [tickT(false), tickT(true)] };
  const arrows = Array.from({ length: 3 }, () => add(VT.arrow, 1, 3)), friendM = Array.from({ length: 4 }, () => add(VT.friend, 2.2, 3)), laneM = add(VT.lane, 1, 4), tickM2 = Array.from({ length: RING_TICKS }, () => add(VT.tick[0], .32, 5));
  const ET = { place: Object.fromEntries(Object.keys(PLACE_COL).map(k => [k, placeT(k)])), card: Object.fromEntries(Object.entries(PLACE_PIC).map(([k, p]) => [k, cardT(p)])), wave: waveT() };
  const placeM = Array.from({ length: 3 }, () => add(ET.place.open, 1.7, 3)), cardM = Array.from({ length: 3 }, () => { const m = add(ET.card.open, .95, 6); m.up.set(0, 0, 1); m.material.side = THREE.DoubleSide; m.material.depthTest = false; return m; }), waveM = Array.from({ length: 2 }, () => add(ET.wave, 1, 2));
  const eAll = [...placeM, ...cardM, ...waveM];
  return {
    // (v96, variant E) places: [{ x, y, kind }] off the ball, or null; chosen: the one he took (lit, the rest hidden); t:
    // a clock for the gentle pulse. The cards stand CARD_Z m over their rings and turn to face the camera.
    places(places, chosen, t) {
      const cp = world.camera.position;
      placeM.forEach((m, i) => { const p = chosen ? (i === 0 ? chosen : null) : places?.[i], c = cardM[i]; m.visible = c.visible = !!p; if (!p) return;
        if (m.material.map !== ET.place[p.kind]) m.material.map = ET.place[p.kind]; if (c.material.map !== ET.card[p.kind]) c.material.map = ET.card[p.kind];
        const k = .5 + .5 * Math.sin(t * 3.2 + i * 2.1); m.position.set(p.x, p.y, .045); m.scale.setScalar(1.7 * (1 + .07 * k)); m.material.opacity = chosen ? .7 : .85 + .15 * k;
        c.position.set(p.x, p.y, 1.05 + .08 * k); c.lookAt(cp.x, cp.y, c.position.z); c.material.opacity = chosen ? 0 : 1; c.visible = !chosen; });
    },
    // (v96, variant E) the crawl's look in the scene: two soft rings spreading slowly from his feet, k (0 … 1) as strong
    // as the crawl is deep; t: real s (the crawl's own clock, not the game's).
    crawl(at, k, t) {
      waveM.forEach((m, i) => { m.visible = !!at && k > .02; if (!m.visible) return; const ph = (t / 1.8 + i / 2) % 1; m.position.set(at.x, at.y, .03); m.scale.setScalar(1.4 + 4.2 * ph); m.material.opacity = k * .55 * (1 - ph) * Math.min(1, ph * 6); });
    },
    // (v93 variants) choices: [{ x, y, a, d }] from `at` (his feet); chosen: the one he took (lit, the rest hidden);
    // friends: [{ x, y }] he can pass to; lane: { a, b } a blocked lane flashing red, or null; ring: 0 … 1 left of the
    // draining ring round his feet (variant D), or null.
    big(at, choices, chosen, friends, lane, ring, t, rr = RING_R) { // (rr: the ring's radius, m: v96 E's is its own)
      arrows.forEach((m, i) => { const c = chosen ? (i === 0 ? chosen : null) : choices?.[i]; m.visible = !!(c && at); if (!m.visible) return;
        const sx = at.x, sy = at.y, a = Math.atan2(c.y - sy, c.x - sx), l = Math.max(1, Math.hypot(c.x - sx, c.y - sy) - .5), k = .5 + .5 * Math.sin(t * 4 + i);
        m.position.set(sx + Math.cos(a) * (.5 + l / 2), sy + Math.sin(a) * (.5 + l / 2), .05); m.rotation.set(0, 0, a); m.scale.set(l, 1.5, 1); m.material.opacity = chosen ? .6 : .85 + .15 * k; });
      friendM.forEach((m, i) => { const f = friends?.[i]; m.visible = !!f; if (f) { m.position.set(f.x, f.y, .045); m.scale.setScalar(2.2 * (1 + .06 * Math.sin(t * 5))); } });
      laneM.visible = !!lane; if (lane) { const dx = lane.b.x - lane.a.x, dy = lane.b.y - lane.a.y, l = Math.hypot(dx, dy) || 1; laneM.position.set((lane.a.x + lane.b.x) / 2, (lane.a.y + lane.b.y) / 2, .06); laneM.rotation.set(0, 0, Math.atan2(dy, dx)); laneM.scale.set(l, .8, 1); }
      const n = ring == null || !at ? 0 : Math.ceil(ring * RING_TICKS), red = ring != null && ring < .3;
      tickM2.forEach((m, i) => { m.visible = i < n; if (!m.visible) return; const a = Math.PI / 2 - i / RING_TICKS * 2 * Math.PI; m.position.set(at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr, .07); if (m.material.map !== VT.tick[red ? 1 : 0]) m.material.map = VT.tick[red ? 1 : 0]; });
    },
    // (v93) The fixed spots (rules.js spotSet), drawn where they are on the pitch: the chosen one lit and the rest faint
    // while he runs to it; the best one pulsing (the hint). dizzyAt: his place while he stumbles after a missed STEAL.
    // shut: the targets in the goal the keeper covers while he aims (grey, crossed: the gold ones are js/world.js's).
    fixed(spots, chosen, best, hasBall, t, dizzyAt = null, shut = null) {
      let i = 0;
      for (const p of spots) {
        const m = fixM[i++]; if (!m) break; const lit = p === chosen;
        m.material.map = p.kind === 'press' ? F.press : F.dot[p.kind === 'ball' || hasBall ? 1 : 0];
        m.visible = true; m.position.set(p.x, p.y, .04);
        const k = .5 + .5 * Math.sin(t * 5);
        m.material.map = lit ? F.lit[p.kind === 'press' ? 1 : 0] : m.material.map;
        m.material.opacity = chosen ? (lit ? 1 : .4) : p === best ? .75 + .25 * k : 1;
        m.scale.setScalar(SPOT_M); // (v93 tidy: every spot the same size on the grass, big enough to see and hit from behind him; the best one pulses in brightness, the chosen one is lit)
      }
      for (; i < fixM.length; i++) fixM[i].visible = false;
      dizzy.visible = !!dizzyAt; if (dizzyAt) { dizzy.position.set(dizzyAt.x, dizzyAt.y, .06); dizzy.rotation.z = t * 6; }
      const cp = world.camera.position;
      shutM.forEach((m, j) => { const a = shut?.[j]; m.visible = !!a; if (a) { m.position.set(a.x + .03, a.y, a.z); m.rotation.set(0, -Math.PI / 2, Math.atan2(cp.y - a.y, cp.x - a.x) - Math.PI, 'ZYX'); } });
    },
    // spots: rules.js spots (ring 1 dots, ring 2 ticks); ring: rules.js dashes; t: the clock, for the pulse
    draw(spots, ringPts, at, hasBall, t, warnAt = null, show = true, goAt = null, hinted = null) {
      if (withBall !== hasBall) { withBall = hasBall; for (const m of dotM) m.material.map = T.dot[hasBall ? 1 : 0]; for (const m of tickM) m.material.map = T.tick[hasBall ? 1 : 0]; }
      let di = 0, ti = 0;
      if (show) for (const s of spots) {
        if (s.hid) continue; const m = s.ring === 1 ? dotM[di++] : s.ring === 2 ? tickM[ti++] : null; if (!m) continue;
        m.visible = true; m.position.set(s.x, s.y, .04);
      }
      for (; di < dotM.length; di++) dotM[di].visible = false; for (; ti < tickM.length; ti++) tickM[ti].visible = false;
      const pts = show ? ringPts : [], key = pts.length ? `${pts.length} ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}` : '';
      if (key !== dashKey) { dashKey = key; pts.forEach((p, i) => { Q.setFromAxisAngle(Z, p.a + Math.PI / 2); M4.compose(V.set(p.x, p.y, .03), Q, S); dash.setMatrixAt(i, M4); }); dash.count = pts.length; dash.instanceMatrix.needsUpdate = true; }
      me.visible = !!at; if (at) { me.position.set(at.x, at.y, .035); me.scale.setScalar(1.6 * (1 + .04 * Math.sin(t * 3))); }
      danger.visible = !!warnAt; if (warnAt) { danger.position.set(warnAt.x, warnAt.y, .03); danger.scale.setScalar(2 * (1 + .12 * Math.sin(t * 14))); }
      go.visible = !!goAt && show; if (go.visible) go.position.set(goAt.x, goAt.y, .045);
      hintM.forEach((m, i) => { const h = show && hinted?.[i]; m.visible = !!h; if (h) { m.position.set(h.x, h.y, .025); const k = .5 + .5 * Math.sin(t * 4); m.material.opacity = .35 + .45 * k; m.scale.setScalar(1.7 + .35 * k); } });
    },
    hide() { for (const m of [...dotM, ...tickM, me, danger, go, ...hintM, ...fixM, dizzy, ...shutM, ...arrows, ...friendM, laneM, ...tickM2, ...eAll]) m.visible = false; dash.count = 0; dashKey = ''; },
    // (v95, the owner's phone: "shader compiled +2, mesh made +8, texture made +4" and a 228 ms frame at the first SHOOT)
    // Everything Live draws on the grass and in the goal, and every picture a mark may switch to, drawn once before play
    // (fast.js pick, behind the player sheet): each mark (and `more`, the world's own Live objects: the shot targets) is
    // shown for one picture through the world's own drawing path (so the shaders are the ones play uses), a millimetre in
    // front of the camera and too small to cover a pixel, then put back as it was. Nothing is made or compiled in play.
    warm(more = []) {
      const r = world.renderer, cam = world.camera; if (!r || !cam) return;
      const objs = [...dotM, ...tickM, me, danger, go, ...hintM, ...fixM, dizzy, ...shutM, ...arrows, ...friendM, laneM, ...tickM2, ...eAll, dash, ...more];
      const was = objs.map(o => ({ v: o.visible, p: o.position.clone(), s: o.scale.clone(), f: o.frustumCulled, c: o.count }));
      const at = new THREE.Vector3(); cam.getWorldDirection(at); at.multiplyScalar(cam.near * 4).add(cam.position);
      const kids = more.flatMap(g => g.children.map(c => [c, c.visible])); // (a group's own parts: shown with it, put back after)
      for (const o of objs) { o.visible = true; o.position.copy(at); o.scale.setScalar(1e-4); if (o.isInstancedMesh) o.count = 1; for (const c of o.children) c.visible = true; }
      for (const t of [...T.dot, ...T.tick, ...F.dot, F.press, ...F.lit, VT.arrow, VT.friend, VT.lane, ...VT.tick, ...Object.values(ET.place), ...Object.values(ET.card), ET.wave]) try { r.initTexture?.(t); } catch (e) { console.error(e); }
      try { if (world.post) world.post.render(); else r.render(world.scene, cam); } catch (e) { console.error(e); }
      objs.forEach((o, i) => { const w = was[i]; o.visible = w.v; o.position.copy(w.p); o.scale.copy(w.s); o.frustumCulled = w.f; if (o.isInstancedMesh) o.count = w.c; });
      for (const [c, v] of kids) c.visible = v;
    },
  };
}

// A shirt in the kit's colours with a number, as an SVG string (as the Lab's eyes.js draws it).
export function shirt(team, num, size = 64) {
  const k = team.kit, c0 = k.colors[0], c1 = k.colors[1] || c0, id = 'fs' + Math.random().toString(36).slice(2, 7);
  const body = 'M18 8 L30 4 Q36 10 42 4 L54 8 L64 22 L54 28 L52 60 L20 60 L18 28 L8 22 Z';
  const pat = k.pattern === 'stripes' ? `<pattern id="${id}" width="12" height="10" patternUnits="userSpaceOnUse"><rect width="6" height="10" fill="${c0}"/><rect x="6" width="6" height="10" fill="${c1}"/></pattern>` : '';
  return `<svg viewBox="0 0 72 64" width="${size}" height="${Math.round(size * 64 / 72)}" aria-hidden="true"><defs>${pat}</defs><path d="${body}" fill="${pat ? `url(#${id})` : c0}" stroke="#24193a" stroke-width="2.5" stroke-linejoin="round"/>${k.pattern === 'sleeves' ? `<path d="M8 22 L18 8 L18 28 Z M64 22 L54 8 L54 28 Z" fill="${c1}"/>` : ''}<text x="36" y="44" text-anchor="middle" font-family="Fredoka,system-ui,sans-serif" font-weight="700" font-size="20" fill="${k.num || '#fff'}" stroke="#24193a" stroke-width=".8">${num}</text></svg>`;
}
