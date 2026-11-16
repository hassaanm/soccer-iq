// Pictures for the two shot lessons and "Our ball? Spread out!" (v64), where an emoji says too little: "Shoot to the space!" is the goal with its six
// gold targets, "Inside or laces?" the laces shot of the foot buttons (index.html #footLaces). Anywhere else a lesson
// shows its emoji.
const GOAL6 = '<svg class="lpic" viewBox="0 0 34 24" aria-hidden="true"><path d="M3 23V3h28v20M10 3v20M17 3v20M24 3v20M3 10h28M3 16.5h28" fill="none" stroke="#cfc8db" stroke-width="1"/>'
  + '<path d="M3 23V3h28v20" fill="none" stroke="#24193a" stroke-width="2.8" stroke-linejoin="round"/>'
  + [8.5, 17, 25.5].flatMap(x => [8.6, 16.4].map(y => `<circle cx="${x}" cy="${y}" r="2.7" fill="#ffd23f" stroke="#24193a" stroke-width=".9"/>`)).join('') + '</svg>';
const LACES = '<svg class="lpic" viewBox="0 0 120 72" aria-hidden="true"><g transform="translate(26 1) rotate(48) scale(1.2)"><path d="M3 0H17C21 0 23 4 28 6C38 9 50 10 54 14C57.5 17.5 57 23 51 23H3C0 23 -1 20 -1 16Z" fill="#24193a"/><path d="M0 19.5H55" stroke="#fff" stroke-width="1.8"/><path d="M17.5 1.2C21.5 1.8 24 5 28.5 7C35 9.2 40 10 45 11L46 20C39 19.5 32 18 26 16C22 14.5 19 12 16.5 11Z" fill="#ff7a1a" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M21 5l5 8M26 5l-5 8M30.5 8l5 8M35.5 8l-5 8M39.5 10.5l5 7.5M44.5 10.5l-5 7.5" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></g><circle cx="62" cy="44" r="13.5" fill="#fff" stroke="#24193a" stroke-width="2.6"/><path d="M62 38.33l5.4 3.9149999999999996-2.025 6.345h-6.75l-2.025-6.345z" fill="#24193a"/><path d="M78 35C90 28 98 19 105 9" fill="none" stroke="#24193a" stroke-width="3.4" stroke-linecap="round"/><path d="M99 10l8-2 0 8" fill="none" stroke="#24193a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M77 50h13M80 57h11M84 43h9" stroke="#24193a" stroke-width="2.6" stroke-linecap="round" opacity=".55"/></svg>';
// "Our ball? Spread out!" (v64): the ball still on the side line with a friend by it, and a friend running away into space.
const SPREAD = '<svg class="lpic" viewBox="0 0 34 24" aria-hidden="true"><rect x="1" y="1" width="32" height="22" rx="4" fill="#3f9a4a"/><path d="M1 19.5h32" stroke="#fff" stroke-width="1.8"/>'
  + '<circle cx="6.5" cy="13.5" r="3" fill="#5a8dff" stroke="#24193a" stroke-width="1"/><circle cx="11" cy="18.6" r="2.3" fill="#fff" stroke="#24193a" stroke-width="1"/>'
  + '<path d="M11.5 11.5L22 6.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="2.2 1.8"/><path d="M19.6 5.2l3.4 1-1.8 3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="27" cy="7.5" r="3" fill="#5a8dff" stroke="#24193a" stroke-width="1"/></svg>';
export const LESSON_PIC = { 'shoot-space': GOAL6, 'inside-laces': LACES, 'spread-out': SPREAD };
const esc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
// A lesson's picture as HTML: its own drawing, or its emoji.
export const lessonPic = (id, emoji) => LESSON_PIC[id] || esc(emoji);
