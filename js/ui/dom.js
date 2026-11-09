// Small DOM helpers shared by the screens.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
// Game buttons act the moment a finger lands (no wait for the click), and the touch stays on the button.
export const onPress = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(e); });
// A sheet closes from its ✕ button or with a tap on the dimmed backdrop.
export function wireSheet(sheet, closeBtn) {
  const el = $(sheet), close = () => el.classList.add('hidden');
  $(closeBtn).onclick = close; el.onclick = e => { if (e.target === el) close(); };
}
// Restarts a CSS animation that is tied to a class.
export const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
