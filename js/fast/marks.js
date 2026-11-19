// What Fast mode draws on the grass, in the 3D scene (not over it, so nothing is painted over the picture each frame):
// the spots he can tap (near ring: one gold ring; far ring: a bigger double ring, for "far and fast"; with the ball, a
// white ball in the middle), his own ring (his spot: "stay"), and the warning ring on a defender who is about to tackle.
// Made once, reused; hidden ones are just not visible.
import * as THREE from 'three';

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const ring = (g, c, r, lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); };
const glow = (g, w, a = .38) => { const c = w / 2, rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, `rgba(255,220,90,${a})`); rg.addColorStop(.7, `rgba(255,210,63,${a * .4})`); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); };
const ball = (g, c, r) => { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill(); g.lineWidth = r * .28; g.strokeStyle = '#24193a'; g.stroke(); g.fillStyle = '#24193a'; g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(c + Math.cos(a) * r * .42, c + Math.sin(a) * r * .42); } g.fill(); };
const near = withBall => tex(256, 256, (g, w) => { const c = w / 2; glow(g, w); ring(g, c, 80, 24, 'rgba(255,255,255,.95)'); ring(g, c, 80, 14, '#ffcf2e'); if (withBall) ball(g, c, 30); else { g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 14, 0, 7); g.fill(); } });
const far = withBall => tex(256, 256, (g, w) => { const c = w / 2; glow(g, w, .3); ring(g, c, 98, 20, 'rgba(255,255,255,.95)'); ring(g, c, 98, 11, '#ff9f1c'); ring(g, c, 66, 18, 'rgba(255,255,255,.95)'); ring(g, c, 66, 10, '#ffcf2e'); if (withBall) ball(g, c, 26); else { g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 12, 0, 7); g.fill(); } });
const mine = () => tex(256, 256, (g, w) => { const c = w / 2; ring(g, c, 104, 20, 'rgba(36,25,58,.55)'); ring(g, c, 104, 12, '#ffd23f'); });
const warn = () => tex(256, 256, (g, w) => { const c = w / 2, rg = g.createRadialGradient(c, c, 10, c, c, c); rg.addColorStop(0, 'rgba(255,80,60,.0)'); rg.addColorStop(.6, 'rgba(255,80,60,.35)'); rg.addColorStop(1, 'rgba(255,80,60,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); ring(g, c, 92, 16, '#ff5a3c'); });
const mat = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });

export function makeMarks(world) {
  const T = { near: [near(false), near(true)], far: [far(false), far(true)] };
  const geo = new THREE.PlaneGeometry(1, 1), add = (map, size, order = 2) => { const m = new THREE.Mesh(geo, mat(map)); m.scale.setScalar(size); m.visible = false; m.renderOrder = order; world.scene.add(m); return m; };
  const nearM = Array.from({ length: 8 }, () => add(T.near[0], 1.45)), farM = Array.from({ length: 8 }, () => add(T.far[0], 1.8));
  const me = add(mine(), 1.6, 3), danger = add(warn(), 2, 3);
  let withBall = null;
  return {
    // spots: [{ x, y, ring }] (ring 1 near, 2 far; ring 0, his own, is his ring); t: the clock, for a soft pulse
    draw(spots, at, hasBall, t, warnAt = null, show = true) {
      if (withBall !== hasBall) { withBall = hasBall; for (const m of nearM) m.material.map = T.near[hasBall ? 1 : 0]; for (const m of farM) m.material.map = T.far[hasBall ? 1 : 0]; }
      let ni = 0, fi = 0; const p = 1 + .05 * Math.sin(t * 4);
      if (show) for (const s of spots) {
        const m = s.ring === 1 ? nearM[ni++] : s.ring === 2 ? farM[fi++] : null; if (!m) continue;
        m.visible = true; m.position.set(s.x, s.y, .04); m.material.opacity = s.dim ? .35 : .9;
      }
      for (; ni < nearM.length; ni++) nearM[ni].visible = false; for (; fi < farM.length; fi++) farM[fi].visible = false;
      for (const m of nearM) if (m.visible) m.scale.setScalar(1.45 * p); for (const m of farM) if (m.visible) m.scale.setScalar(1.8 * p);
      me.visible = !!at; if (at) { me.position.set(at.x, at.y, .035); me.scale.setScalar(1.6 * (1 + .04 * Math.sin(t * 3))); }
      danger.visible = !!warnAt; if (warnAt) { danger.position.set(warnAt.x, warnAt.y, .03); danger.scale.setScalar(2 * (1 + .12 * Math.sin(t * 14))); }
    },
    hide() { for (const m of [...nearM, ...farM, me, danger]) m.visible = false; },
  };
}

// A shirt in the kit's colours with a number, as an SVG string (as the Lab's eyes.js draws it).
export function shirt(team, num, size = 64) {
  const k = team.kit, c0 = k.colors[0], c1 = k.colors[1] || c0, id = 'fs' + Math.random().toString(36).slice(2, 7);
  const body = 'M18 8 L30 4 Q36 10 42 4 L54 8 L64 22 L54 28 L52 60 L20 60 L18 28 L8 22 Z';
  const pat = k.pattern === 'stripes' ? `<pattern id="${id}" width="12" height="10" patternUnits="userSpaceOnUse"><rect width="6" height="10" fill="${c0}"/><rect x="6" width="6" height="10" fill="${c1}"/></pattern>` : '';
  return `<svg viewBox="0 0 72 64" width="${size}" height="${Math.round(size * 64 / 72)}" aria-hidden="true"><defs>${pat}</defs><path d="${body}" fill="${pat ? `url(#${id})` : c0}" stroke="#24193a" stroke-width="2.5" stroke-linejoin="round"/>${k.pattern === 'sleeves' ? `<path d="M8 22 L18 8 L18 28 Z M64 22 L54 8 L54 28 Z" fill="${c1}"/>` : ''}<text x="36" y="44" text-anchor="middle" font-family="Fredoka,system-ui,sans-serif" font-weight="700" font-size="20" fill="${k.num || '#fff'}" stroke="#24193a" stroke-width=".8">${num}</text></svg>`;
}
