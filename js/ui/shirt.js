// Draws a team's shirt (kit colors, pattern, number) for the team picker and the cup path.
export function drawShirt(cv, kit, num) {
  const g = cv.getContext('2d'), Wd = cv.width; g.clearRect(0, 0, Wd, Wd); g.save(); g.scale(Wd / 160, Wd / 160);
  const body = new Path2D('M50 22 Q60 16 68 13 Q80 30 92 13 Q100 16 110 22 L143 46 Q138 60 124 70 L110 61 L111 146 Q80 152 49 146 L50 61 L36 70 Q22 60 17 46 Z');
  const sleeveL = new Path2D('M50 22 L17 46 Q22 60 36 70 L50 61 Z'), sleeveR = new Path2D('M110 22 L143 46 Q138 60 124 70 L110 61 Z');
  g.fillStyle = kit.colors[0]; g.fill(body);
  g.save(); g.clip(body);
  if (kit.pattern === 'stripes') { g.fillStyle = kit.colors[1]; for (let x = 44; x < 116; x += 24) g.fillRect(x, 0, 12, 160); }
  if (kit.pattern === 'band') { g.fillStyle = '#fff'; g.fillRect(65, 0, 30, 160); g.fillStyle = kit.colors[1]; g.fillRect(70, 0, 20, 160); }
  if (kit.pattern === 'sleeves') { g.fillStyle = kit.colors[1]; g.fill(sleeveL); g.fill(sleeveR); }
  // Cuffs in the trim color.
  g.lineWidth = 5; g.strokeStyle = kit.trim;
  for (const [x0, y0, x1, y1] of [[22, 52, 34, 64], [138, 52, 126, 64]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  const shade = g.createLinearGradient(0, 0, 160, 0); shade.addColorStop(0, 'rgba(255,255,255,.22)'); shade.addColorStop(.45, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,.18)');
  g.fillStyle = shade; g.fillRect(0, 0, 160, 160);
  g.restore();
  g.strokeStyle = kit.trim; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(67, 14); g.quadraticCurveTo(80, 32, 93, 14); g.stroke();
  g.font = '700 50px Fredoka, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.3)';
  g.strokeText(num, 80, 94); g.fillStyle = kit.num; g.fillText(num, 80, 94);
  g.strokeStyle = 'rgba(36,25,58,.55)'; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke(body);
  g.restore();
}
// A team's shirt as a small image (drawn once per team).
const images = {};
export function shirtImg(t) {
  if (!images[t.id]) { const cv = document.createElement('canvas'); cv.width = cv.height = 96; drawShirt(cv, t.kit, t.players[0].num); images[t.id] = cv.toDataURL(); }
  return images[t.id];
}
