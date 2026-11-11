// Textures painted on a canvas, shared by the world and the parts in js/pro/.
import * as THREE from 'three';

export function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// Soft dark spot under each player and under the ball, so they sit on the grass.
export const blobTex = canvasTex(64, 64, g => {
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(30,20,40,.42)'); r.addColorStop(1, 'rgba(30,20,40,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});
