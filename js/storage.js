// Where the save lives (round 13). Normally the browser's localStorage. A test page (dev/speed.html, dev/review.html) sets
// globalThis.SOCCER_THROWAWAY = { map: { key: text }, onWrite? } before any game module loads: then every read and write of
// the game goes to that in-memory copy and the real storage is never touched. (Safari has refused pages that replace
// window.localStorage itself, so the pages do not rely on that.)
const mem = globalThis.SOCCER_THROWAWAY;
function inMemory(m) {
  const map = m.map && typeof m.map === 'object' ? m.map : (m.map = {});
  const wrote = () => { try { m.onWrite?.(); } catch { /* the page's own copy */ } };
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); wrote(); },
    removeItem: k => { delete map[k]; wrote(); },
    clear: () => { for (const k of Object.keys(map)) delete map[k]; wrote(); },
    key: i => Object.keys(map)[i] ?? null,
    get length() { return Object.keys(map).length; },
  };
}
export const throwaway = !!(mem && typeof mem === 'object');
export const storage = throwaway ? inMemory(mem) : (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
// (v76) The play log ("Record play", js/log.js) lives under its own key, never in the save. In the throwaway mode above
// it is not kept at all.
export const PLAY_LOG = 'soccer-iq:playlog';
