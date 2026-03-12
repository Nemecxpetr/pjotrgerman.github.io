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
  if (document.body?.dataset.soundToggle === "off") {
    return;
  }

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

function getBackgroundFxOptions() {
  const canvas = document.getElementById("fx");
  const options = {
    playPluck,
    playSineTone
  };

  if (!canvas) {
    return options;
  }

  const { wordPoolUrl, wrapSelector, maskImgId } = canvas.dataset;
  if (wordPoolUrl) {
    options.wordPoolUrl = wordPoolUrl;
  }
  if (wrapSelector) {
    options.wrapSelector = wrapSelector;
  }
  if (maskImgId) {
    options.maskImgId = maskImgId;
  }
  if (canvas.dataset.activeZoneSelector) {
    options.activeZoneSelector = canvas.dataset.activeZoneSelector;
  }
  if (canvas.dataset.maskAreaSelector) {
    options.maskAreaSelector = canvas.dataset.maskAreaSelector;
  }
  if (canvas.dataset.wordSourceSelector) {
    options.wordSourceSelector = canvas.dataset.wordSourceSelector;
  }
  if (canvas.dataset.emitOnlyMiniMode) {
    options.emitOnlyInMiniMode = canvas.dataset.emitOnlyMiniMode === "true";
  }

  return options;
}

function initPrintFxBridge() {
  const fxCanvas = document.getElementById("fx");
  if (!fxCanvas) {
    return;
  }

  const canvasHasVisibleFxPixels = (canvas) => {
    const width = Number(canvas.width);
    const height = Number(canvas.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
      return false;
    }

    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return false;
      }

      // Probe a sparse grid so we avoid reading the full frame buffer.
      const cols = 18;
      const rows = 12;
      const alphaThreshold = 10;
      for (let yi = 0; yi < rows; yi += 1) {
        const y = Math.max(0, Math.min(height - 1, Math.floor(((yi + 0.5) / rows) * height)));
        for (let xi = 0; xi < cols; xi += 1) {
          const x = Math.max(0, Math.min(width - 1, Math.floor(((xi + 0.5) / cols) * width)));
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          if (pixel && pixel[3] > alphaThreshold) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  const markPrintState = () => {
    const styles = window.getComputedStyle(fxCanvas);
    const rect = fxCanvas.getBoundingClientRect();
    const canvasVisible = styles.display !== "none"
      && styles.visibility !== "hidden"
      && Number.parseFloat(styles.opacity || "1") > 0
      && rect.width > 0
      && rect.height > 0;
    const visible = canvasVisible && canvasHasVisibleFxPixels(fxCanvas);

    document.documentElement.classList.toggle("print-include-fx", visible);
    document.body.classList.toggle("print-include-fx", visible);
  };

  const clearPrintState = () => {
    document.documentElement.classList.remove("print-include-fx");
    document.body.classList.remove("print-include-fx");
  };

  window.addEventListener("beforeprint", markPrintState);
  window.addEventListener("afterprint", clearPrintState);
}

function bootstrap() {
  initYearLabel();
  initReleases();
  initSoundToggle();
  initPrintFxBridge();

  initBackgroundFx(getBackgroundFxOptions());
}

bootstrap();
