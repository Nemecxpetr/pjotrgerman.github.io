import { initBackgroundFx } from "./js/background-fx.js";
import { initReleases } from "./js/releases.js";
import {
  isAudioEnabled,
  playPluck,
  playSineTone,
  setAudioEnabled,
  unlockAudioContext
} from "./js/audio-pluck.js";

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

function initSoundToggle() {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sound-toggle";

  const positionToggle = () => {
    const vv = window.visualViewport;
    if (!vv) {
      toggle.style.right = "10px";
      toggle.style.top = "10px";
      return;
    }

    const baseOffsetPx = 10;
    const rightOffsetPx = Math.max(
      baseOffsetPx,
      window.innerWidth - (vv.offsetLeft + vv.width) + baseOffsetPx
    );
    const topOffsetPx = Math.max(baseOffsetPx, vv.offsetTop + baseOffsetPx);

    toggle.style.right = `${Math.round(rightOffsetPx)}px`;
    toggle.style.top = `${Math.round(topOffsetPx)}px`;
  };

  const syncState = () => {
    const enabled = isAudioEnabled();
    toggle.textContent = enabled ? "Sound: On" : "Sound: Off";
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", enabled ? "Turn sound off" : "Turn sound on");
  };

  toggle.addEventListener("click", () => {
    const nextEnabled = !isAudioEnabled();
    setAudioEnabled(nextEnabled);
    if (nextEnabled) {
      unlockAudioContext();
    }
    syncState();
  });

  syncState();
  document.body.appendChild(toggle);
  positionToggle();

  window.addEventListener("resize", positionToggle, { passive: true });
  window.addEventListener("orientationchange", positionToggle, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", positionToggle, { passive: true });
    window.visualViewport.addEventListener("scroll", positionToggle, { passive: true });
  }
}

function bootstrap() {
  initYearLabel();
  initReleases();
  initSoundToggle();

  initBackgroundFx({
    playPluck,
    playSineTone
  });
}

bootstrap();
