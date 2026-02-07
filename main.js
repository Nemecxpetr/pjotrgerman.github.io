import { initBackgroundFx } from "./js/background-fx.js";
import { initReleases } from "./js/releases.js";
import { playPluck, playSineTone, unlockAudioContext } from "./js/audio-pluck.js";

/**
 * Main app bootstrap.
 *
 * Architecture:
 * - `initReleases()` only acts if release containers exist on the page.
 * - `initBackgroundFx()` only acts if background canvas exists.
 *
 * This lets one shared entry point power both `index.html` and `releases.html`.
 */

function initYearLabel() {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
}

function bootstrap() {
  initYearLabel();
  initReleases();

  // Audio must be resumed from a user gesture in most browsers.
  window.addEventListener("pointerdown", unlockAudioContext, { passive: true });

  initBackgroundFx({
    playPluck,
    playSineTone
  });
}

bootstrap();
