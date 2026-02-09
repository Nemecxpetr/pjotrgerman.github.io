/**
 * Legacy note:
 * This project was refactored from one large `script.js` into modules.
 *
 * Runtime entry point:
 * - `main.js`
 *
 * Feature modules:
 * - `js/releases.js`      data loading + release rendering
 * - `js/background-fx.js` background canvas trail + mask accents
 * - `js/mini-game.js`     bottom mini game interaction
 * - `js/audio-pluck.js`   procedural pluck synthesis
 * - `js/math-utils.js`    shared helper functions
 *
 * Both HTML pages now load `main.js` as an ES module.
 */
