// What Fast mode draws on the grass, in the 3D scene (not over it, so nothing is painted over the picture each frame):
// the guide round him (makeMarks), his own ring, where he is going, hints, and the warning on a defender about to tackle.
// Made once, reused; hidden ones are just not visible; the far ring's dashes are one instanced mesh, set only when they move.
import * as THREE from 'three';

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const ring = (g, c, r, lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); };
const glow = (g, w, a = .38) => { const c = w / 2, rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, `rgba(255,220,90,${a})`); rg.addColorStop(.7, `rgba(255,210,63,${a * .4})`); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); };
const ball = (g, c, r) => { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill(); g.lineWidth = r * .28; g.strokeStyle = '#24193a'; g.stroke(); g.fillStyle = '#24193a'; g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(c + Math.cos(a) * r * .42, c + Math.sin(a) * r * .42); } g.fill(); };
const dot = withBall => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .28); ring(g, c, 36, 10, 'rgba(255,255,255,.85)'); ring(g, c, 36, 6, '#ffcf2e'); if (withBall) ball(g, c, 17); else { g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(c, c, 7, 0, 7); g.fill(); } });
const tick = withBall => tex(64, 64, (g, w) => { const c = w / 2; g.fillStyle = withBall ? '#ff9f1c' : '#ffd23f'; g.beginPath(); g.arc(c, c, 18, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke(); });
const mine = () => tex(256, 256, (g, w) => { const c = w / 2; ring(g, c, 104, 20, 'rgba(36,25,58,.55)'); ring(g, c, 104, 12, '#ffd23f'); });
const warn = () => tex(256, 256, (g, w) => { const c = w / 2, rg = g.createRadialGradient(c, c, 10, c, c, c); rg.addColorStop(0, 'rgba(255,80,60,.0)'); rg.addColorStop(.6, 'rgba(255,80,60,.35)'); rg.addColorStop(1, 'rgba(255,80,60,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); ring(g, c, 92, 16, '#ff5a3c'); });
const goTo = () => tex(128, 128, (g, w) => { const c = w / 2; ring(g, c, 44, 12, 'rgba(255,255,255,.95)'); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(c, c, 14, 0, 7); g.fill(); });
const hintT = () => tex(128, 128, (g, w) => { glow(g, w, .55); });
const mat = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
// (v93) The fixed spots: a gold ring with a white dot (with the ball: a ball in it); pressing their carrier: an orange ring
// with a red middle. A miss of STEAL: three small stars turning round his feet. A target the keeper covers: grey, crossed.
const pressT = () => tex(128, 128, (g, w) => { const c = w / 2; glow(g, w, .28); ring(g, c, 38, 11, 'rgba(255,255,255,.9)'); ring(g, c, 38, 7, '#ff7a3c'); g.fillStyle = '#e8443a'; g.beginPath(); g.arc(c, c, 12, 0, 7); g.fill(); });
const dizzyT = () => tex(128, 128, (g, w) => { const c = w / 2; for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3, x = c + Math.cos(a) * 42, y = c + Math.sin(a) * 42; g.fillStyle = '#ffe14d'; g.strokeStyle = '#24193a'; g.lineWidth = 3; g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 6 : 15, b = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(x + Math.cos(b) * r, y + Math.sin(b) * r); } g.closePath(); g.fill(); g.stroke(); } });
const shutT = () => tex(128, 128, (g, w) => { const c = w / 2; g.fillStyle = 'rgba(36,25,58,.45)'; g.beginPath(); g.arc(c, c, 56, 0, 7); g.fill(); ring(g, c, 44, 12, 'rgba(200,196,210,.95)'); g.strokeStyle = 'rgba(200,196,210,.95)'; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(c - 24, c - 24); g.lineTo(c + 24, c + 24); g.moveTo(c + 24, c - 24); g.lineTo(c - 24, c + 24); g.stroke(); });

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
  const F = { dot: [dot(false), dot(true)], press: pressT() }, fixM = Array.from({ length: 8 }, () => add(F.dot[0], 1.3, 2, .9)), dizzy = add(dizzyT(), 1.1, 4), shutM = Array.from({ length: 6 }, () => { const m = add(shutT(), .8, 5); m.material.side = THREE.DoubleSide; return m; });
  return {
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
        m.material.opacity = chosen ? (lit ? 1 : .32) : p === best ? .7 + .3 * k : .85;
        m.scale.setScalar(lit ? 1.9 + .1 * k : p === best ? 1.5 + .45 * k : 1.5); // (v93: big enough to see and hit from behind him, far ones too)
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
    hide() { for (const m of [...dotM, ...tickM, me, danger, go, ...hintM, ...fixM, dizzy, ...shutM]) m.visible = false; dash.count = 0; dashKey = ''; },
  };
}

// A shirt in the kit's colours with a number, as an SVG string (as the Lab's eyes.js draws it).
export function shirt(team, num, size = 64) {
  const k = team.kit, c0 = k.colors[0], c1 = k.colors[1] || c0, id = 'fs' + Math.random().toString(36).slice(2, 7);
  const body = 'M18 8 L30 4 Q36 10 42 4 L54 8 L64 22 L54 28 L52 60 L20 60 L18 28 L8 22 Z';
  const pat = k.pattern === 'stripes' ? `<pattern id="${id}" width="12" height="10" patternUnits="userSpaceOnUse"><rect width="6" height="10" fill="${c0}"/><rect x="6" width="6" height="10" fill="${c1}"/></pattern>` : '';
  return `<svg viewBox="0 0 72 64" width="${size}" height="${Math.round(size * 64 / 72)}" aria-hidden="true"><defs>${pat}</defs><path d="${body}" fill="${pat ? `url(#${id})` : c0}" stroke="#24193a" stroke-width="2.5" stroke-linejoin="round"/>${k.pattern === 'sleeves' ? `<path d="M8 22 L18 8 L18 28 Z M64 22 L54 8 L54 28 Z" fill="${c1}"/>` : ''}<text x="36" y="44" text-anchor="middle" font-family="Fredoka,system-ui,sans-serif" font-weight="700" font-size="20" fill="${k.num || '#fff'}" stroke="#24193a" stroke-width=".8">${num}</text></svg>`;
}
