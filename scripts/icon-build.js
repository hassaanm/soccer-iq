// Draws the home screen icon (icon.svg) as a classic black-and-white soccer ball on the game's peach colour.
// Run: npm run icon (writes icon.svg, then renders icon.png and apple-touch-icon.png).
import { writeFileSync } from 'node:fs';
const S = 1024, cx = S / 2, cy = S / 2 + 10, R = 350, INK = '#2c2039';
const pt = (r, deg, ox = cx, oy = cy) => [ox + r * Math.cos(deg * Math.PI / 180), oy + r * Math.sin(deg * Math.PI / 180)];
const poly = ps => ps.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
const pent = (ox, oy, r, rot) => [0, 1, 2, 3, 4].map(k => pt(r, rot + 72 * k, ox, oy));

const a = R * .3, outerC = R * .9, outerR = R * .3;
const centre = pent(cx, cy, a, -90);
let shapes = `<polygon points="${poly(centre)}"/>`, lines = '';
for (let k = 0; k < 5; k++) {
  const ang = -90 + 72 * k;
  const [ox, oy] = pt(outerC, ang);
  const outer = pent(ox, oy, outerR, ang + 180);              // one corner points back at the middle
  shapes += `<polygon points="${poly(outer)}"/>`;
  lines += `M${poly([centre[k]])} L${poly([outer[0]])} `;     // seam from the middle patch out to this patch
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <radialGradient id="shade" cx="40%" cy="35%" r="70%"><stop offset="60%" stop-color="#fff"/><stop offset="100%" stop-color="#d9d4e4"/></radialGradient>
  <clipPath id="ball"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
</defs>
<rect width="${S}" height="${S}" fill="#ffc89a"/>
<ellipse cx="${cx}" cy="${cy + R + 34}" rx="${R * .8}" ry="34" fill="#e8a777"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#shade)"/>
<g clip-path="url(#ball)" fill="${INK}" stroke="${INK}" stroke-width="16" stroke-linejoin="round" stroke-linecap="round">
  ${shapes}<path d="${lines}" fill="none"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${INK}" stroke-width="26"/>
</svg>`;
writeFileSync('icon.svg', svg);
