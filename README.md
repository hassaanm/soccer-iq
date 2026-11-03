# Heads Up! Soccer

A phone game that teaches young kids soccer decisions: look up, pass to the open friend, dribble into space.
Static site (three.js from a CDN, progress in localStorage). Play in landscape; "Add to Home Screen" for full screen.

- Run locally: `python3 -m http.server 5180`, then open http://localhost:5180
- Tests: `npm test`
- Grown-ups menu: hold the ⚙️ on the home screen.
- Code: `js/main.js` (screens), `js/game.js` (lesson flow, camera, input), `js/sim.js` (movement), `js/world.js` (art style), `js/skills.js` (skill path + scenarios), `js/progress.js` (Leitner review).
- Research: `research/skill-tree.md`, `research/learning-design.md`. Style experiments: `prototypes/art-styles-3.html`.
