// What the soccer puzzles draw on the grass (v96: the puzzle in the 3D world, mini/puzzle-ui.js), in the 3D scene as
// Live's marks are (fast/marks.js): every mesh, material and picture made once in makePzMarks (before play, behind the
// start), shown or hidden and moved after; warm() draws each once so its shader is ready. Nothing here is made in play.
// The choices: the places he can run to (gold rings), a ring at each friend's feet (gold with an open line, pale with a
// shut one), a friend's run (a gold arrow), the three goal spots (gold: open; grey and crossed: the keeper covers it).
// The rest: each red player's tackle reach (a soft red square, three places wide), the lanes (white: open; red up to the
// red player who cuts it), the shot lines to open spots, the box he shoots from, a marker's link to his man, the ball
// carrier's ring, the red cross on what stopped a move, and the solution's ball path (gold) as it replays.
import * as THREE from 'three';

function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const ring = (g, c, r, lw, col) => { g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); g.arc(c, c, r, 0, 7); g.stroke(); };
const INK = 'rgba(36,25,58,.6)';
// a place he can run to: a gold ring edged white and ink, a white dot
const spotT = () => tex(128, 128, (g, w) => { const c = w / 2; ring(g, c, 40, 16, INK); ring(g, c, 40, 11, '#ffffff'); ring(g, c, 40, 7, '#ffcf2e'); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, 10, 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); });
// a friend's ring: open (gold, a soft glow) or shut (pale)
const friendT = open => tex(128, 128, (g, w) => { const c = w / 2; if (open) { const rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, 'rgba(255,220,90,.45)'); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); }
  ring(g, c, 48, 15, INK); ring(g, c, 48, 10, open ? '#ffffff' : 'rgba(255,255,255,.75)'); ring(g, c, 48, 6, open ? '#ffcf2e' : 'rgba(220,214,232,.9)'); });
// a goal spot: open (a gold ring with a ball in it) or covered by the keeper (grey, crossed)
const ballIn = (g, c, r) => { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill(); g.lineWidth = r * .25; g.strokeStyle = '#24193a'; g.stroke(); g.fillStyle = '#24193a'; g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.lineTo(c + Math.cos(a) * r * .42, c + Math.sin(a) * r * .42); } g.fill(); };
const goalOpenT = () => tex(128, 128, (g, w) => { const c = w / 2, rg = g.createRadialGradient(c, c, 8, c, c, c); rg.addColorStop(0, 'rgba(255,220,90,.6)'); rg.addColorStop(1, 'rgba(255,210,63,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, w); ring(g, c, 44, 16, INK); ring(g, c, 44, 11, '#ffffff'); ring(g, c, 44, 7, '#ffcf2e'); ballIn(g, c, 20); });
const goalShutT = () => tex(128, 128, (g, w) => { const c = w / 2; g.fillStyle = 'rgba(36,25,58,.5)'; g.beginPath(); g.arc(c, c, 50, 0, 7); g.fill(); ring(g, c, 44, 11, 'rgba(205,200,216,.95)'); g.strokeStyle = 'rgba(205,200,216,.95)'; g.lineWidth = 11; g.lineCap = 'round'; g.beginPath(); g.moveTo(c - 22, c - 22); g.lineTo(c + 22, c + 22); g.moveTo(c + 22, c - 22); g.lineTo(c - 22, c + 22); g.stroke(); });
// a red player's reach: a soft red square with rounded corners, a brighter edge
const reachT = () => tex(128, 128, (g, w) => { const r = 26, p = 6, q = w - 2 * p; g.beginPath(); g.roundRect(p, p, q, q, r); g.fillStyle = 'rgba(255,60,60,.16)'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(255,100,100,.5)'; g.stroke(); });
// the board: the part of the pitch the puzzle is played on (a faint lighter patch, a soft white edge)
const areaT = () => tex(256, 256, (g, w) => { const p = 6, q = w - 2 * p; g.beginPath(); g.roundRect(p, p, q, q, 18); g.fillStyle = 'rgba(255,255,255,.07)'; g.fill(); g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.4)'; g.stroke(); });
// a lane: a band, its edges soft (white or red: the colour comes from the material)
const bandT = () => tex(16, 64, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(.3, 'rgba(255,255,255,1)'); lg.addColorStop(.7, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
// a friend's run: a fat gold arrow (pointing +x in the picture)
const arrowT = () => tex(256, 96, (g, w, h) => { const c = h / 2, path = () => { g.beginPath(); g.moveTo(8, c - 14); g.lineTo(w - 96, c - 14); g.lineTo(w - 96, c - 38); g.lineTo(w - 10, c); g.lineTo(w - 96, c + 38); g.lineTo(w - 96, c + 14); g.lineTo(8, c + 14); g.closePath(); }; g.lineJoin = 'round'; path(); g.lineWidth = 12; g.strokeStyle = INK; g.stroke(); g.lineWidth = 7; g.strokeStyle = '#ffffff'; g.stroke(); const lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, 'rgba(255,207,46,.55)'); lg.addColorStop(.6, '#ffcf2e'); lg.addColorStop(1, '#ffe27a'); g.fillStyle = lg; g.fill(); });
// the carrier's ring
const meT = () => tex(128, 128, (g, w) => { const c = w / 2; ring(g, c, 50, 14, INK); ring(g, c, 50, 8, '#ffd23f'); });
// what stopped a move: a red disc with a white cross (stands up, over everything)
const badT = () => tex(128, 128, (g, w) => { const c = w / 2; g.fillStyle = '#e8213a'; g.beginPath(); g.arc(c, c, 54, 0, 7); g.fill(); g.lineWidth = 10; g.strokeStyle = '#ffffff'; g.stroke(); g.lineCap = 'round'; g.lineWidth = 15; g.beginPath(); g.moveTo(c - 24, c - 24); g.lineTo(c + 24, c + 24); g.moveTo(c + 24, c - 24); g.lineTo(c - 24, c + 24); g.stroke(); });

const MAX = { spots: 8, friends: 3, lanes: 6, reach: 5, goal: 3, tether: 4, arrows: 3, path: 8 };
export function makePzMarks(world) {
  const geo = new THREE.PlaneGeometry(1, 1), T = { spot: spotT(), fOpen: friendT(true), fShut: friendT(false), gOpen: goalOpenT(), gShut: goalShutT(), reach: reachT(), area: areaT(), band: bandT(), arrow: arrowT(), me: meT(), bad: badT() };
  const mat = (map, o = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, ...o });
  const all = [];
  const add = (m, order) => { const o = new THREE.Mesh(geo, m); o.renderOrder = order; o.visible = false; world.scene.add(o); all.push(o); return o; };
  const many = (n, mk, order) => Array.from({ length: n }, () => add(mk(), order));
  const area = add(mat(T.area), 0), reach = many(MAX.reach, () => mat(T.reach), 1);
  const laneW = mat(T.band, { color: 0xffffff, opacity: .5 }), laneR = mat(T.band, { color: 0xff4a4a, opacity: .8 }), laneG = mat(T.band, { color: 0xffd23f, opacity: .75 }), teth = mat(T.band, { color: 0xffb0b0, opacity: .5 }), pathM = mat(T.band, { color: 0xffd23f, opacity: .95 });
  const lanes = many(MAX.lanes, () => laneW, 2), tethers = many(MAX.tether, () => teth, 2), path = many(MAX.path, () => pathM, 6);
  const spotMat = mat(T.spot), spots = many(MAX.spots, () => spotMat, 3);
  const friends = many(MAX.friends, () => mat(T.fOpen), 3), goal = many(MAX.goal, () => mat(T.gOpen), 3);
  const arrowMat = mat(T.arrow), arrows = many(MAX.arrows, () => arrowMat, 4), me = add(mat(T.me), 3);
  // the box he shoots from: four thin gold lines on the grass
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .25, depthWrite: false, toneMapped: false }), box = many(4, () => boxMat, 2);
  const bad = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.bad, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); bad.renderOrder = 30; bad.visible = false; world.scene.add(bad); all.push(bad);
  const band = (m, a, b, w, z) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); m.visible = l > .05; if (!m.visible) return; m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z); m.rotation.set(0, 0, Math.atan2(dy, dx)); m.scale.set(l, w, 1); };
  const flat = (m, p, size, z) => { m.visible = true; m.position.set(p.x, p.y, z); m.rotation.set(0, 0, 0); m.scale.set(size, size, 1); m.userData.base = size; };
  const hideAll = list => { for (const m of list) m.visible = false; };
  let pulse = 0, flashT = -9, boxT = -9, show = { spots: [], friends: [], goal: [] };
  return {
    // The choices and the picture for one moment of his move (all at once; called only when they change).
    // o: { carrier {x,y}, spots [{x,y}], friends [{x,y,open}], arrows [{a,b}], goal [{x,y,open,active}], reach [{x,y}],
    //      lanes [{a,b,cut}], shots [{a,b}], tethers [{a,b}], box {x0,y0,x1,y1}, cell (m) }
    set(o) {
      const C = o.cell;
      hideAll([...spots, ...friends, ...goal, ...reach, ...lanes, ...tethers, ...arrows, ...box]); me.visible = area.visible = false;
      if (o.area) { const a = o.area; area.visible = true; area.position.set((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, .012); area.rotation.set(0, 0, 0); area.scale.set(Math.abs(a.x1 - a.x0), Math.abs(a.y1 - a.y0), 1); }
      o.reach?.forEach((p, i) => { const m = reach[i]; if (!m) return; flat(m, p, C * 3, .018); if (p.w) m.scale.set(p.w, p.h, 1); });
      let li = 0;
      for (const l of o.lanes || []) { const m = lanes[li++]; if (!m) break; m.material = l.cut ? laneR : laneW; band(m, l.a, l.cut || l.b, .34, .026); }
      for (const l of o.shots || []) { const m = lanes[li++]; if (!m) break; m.material = laneG; band(m, l.a, l.b, .3, .028); }
      o.tethers?.forEach((t, i) => { const m = tethers[i]; if (m) band(m, t.a, t.b, .1, .022); });
      o.spots?.forEach((p, i) => { const m = spots[i]; if (m) flat(m, p, C * .62, .04); });
      o.friends?.forEach((p, i) => { const m = friends[i]; if (!m) return; m.material.map = p.open ? T.fOpen : T.fShut; flat(m, p, C * .78, .045); });
      o.goal?.forEach((p, i) => { const m = goal[i]; if (!m) return; m.material.map = p.open ? T.gOpen : T.gShut; m.material.opacity = p.active ? 1 : .55; flat(m, p, C * .7, .05); });
      o.arrows?.forEach((r, i) => { const m = arrows[i]; if (m) band(m, r.a, r.b, C * .55, .05); });
      if (o.carrier) { flat(me, o.carrier, C * .62, .035); }
      if (o.box) { const { x0, y0, x1, y1 } = o.box, w = .12; band(box[2], { x: x0, y: y0 }, { x: x0, y: y1 }, w, .02); if (o.box.top) band(box[0], { x: x0, y: y0 }, { x: x1, y: y0 }, w, .02); if (o.box.bottom) band(box[1], { x: x0, y: y1 }, { x: x1, y: y1 }, w, .02); } // (the box's edge across the board; its ends only where they are not the board's own edge)
      show = { spots: spots.filter(m => m.visible), friends: friends.filter(m => m.visible), goal: goal.filter(m => m.visible), arrows: arrows.filter(m => m.visible) };
    },
    hideChoices() { hideAll([...spots, ...friends, ...lanes, ...arrows]); me.visible = false; },
    // The ball's path as the solution replays (gold): a list of segments.
    path(segs) { hideAll(path); (segs || []).forEach((s, i) => { const m = path[i]; if (m) band(m, s.a, s.b, .3, .06); }); },
    // The red cross on what stopped a move ({x, y, z} or null).
    bad(p) { bad.visible = !!p; if (p) { bad.position.set(p.x, p.y, p.z ?? 1.9); bad.scale.setScalar(.9); } },
    // A tap that is not a move: every choice pulses for a moment (and the box, for a shot from outside it).
    refuse(t, boxToo = false) { flashT = t; if (boxToo) boxT = t; },
    // Each frame: the soft pulse of the choices (opacity and size only).
    frame(t) {
      pulse = .5 + .5 * Math.sin(t * 4.5);
      const f = Math.max(0, 1 - (t - flashT) / .9), k = 1 + .08 * pulse + .35 * f * Math.abs(Math.sin((t - flashT) * 14));
      spotMat.opacity = .8 + .2 * pulse;
      for (const m of show.spots) m.scale.setScalar(m.userData.base * k);
      for (const m of show.friends) m.scale.setScalar(m.userData.base * k);
      for (const m of show.goal) m.scale.setScalar(m.userData.base * (1 + .05 * pulse + .3 * f));
      const b = Math.max(0, 1 - (t - boxT) / 1.1); boxMat.opacity = .25 + .7 * b * Math.abs(Math.sin((t - boxT) * 9));
    },
    hide() { for (const m of all) m.visible = false; },
    // Each mark, and each picture a mark may switch to, drawn once for one frame through the world's own drawing (so its
    // shader and textures are ready), tiny and in front of the camera, then put back.
    warm(more = []) {
      const r = world.renderer, cam = world.camera; if (!r || !cam) return;
      const objs = [...all, ...more];
      const was = objs.map(o => ({ v: o.visible, p: o.position.clone(), s: o.scale.clone() }));
      const at = new THREE.Vector3(); cam.getWorldDirection(at); at.multiplyScalar(cam.near * 4).add(cam.position);
      for (const o of objs) { o.visible = true; o.position.copy(at); o.scale.setScalar(1e-4); }
      for (const t of Object.values(T)) try { r.initTexture?.(t); } catch (e) { console.error(e); }
      try { if (world.post) world.post.render(); else r.render(world.scene, cam); } catch (e) { console.error(e); }
      objs.forEach((o, i) => { const w = was[i]; o.visible = w.v; o.position.copy(w.p); o.scale.copy(w.s); });
    },
  };
}
