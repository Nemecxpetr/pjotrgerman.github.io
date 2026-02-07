import { lerp } from "./math-utils.js";

/**
 * Mini game module
 * - User draws on an empty canvas area
 * - Blue dots + connecting trace are generated while drawing
 * - Each emitted dot triggers a pluck sound
 * - If stroke endpoints are far enough apart, keep those two dots blinking
 *   and keep the exact traced connection path visible.
 */

/**
 * @param {{
 *   canvasId?: string,
 *   maskImgId?: string,
 *   wrapSelector?: string,
 *   playPluck?: (size:number, sizeRange:{min:number,max:number}) => void,
 *   unlockAudioContext?: () => void
 * }} options
 */
export function initMiniGame({
  canvasId = "mini-game-canvas",
  maskImgId = "maskImg",
  wrapSelector = ".wrap",
  playPluck = () => {},
  unlockAudioContext = () => {}
} = {}) {
  const miniGameCanvas = document.getElementById(canvasId);
  if (!miniGameCanvas) {
    return;
  }

  const miniCtx = miniGameCanvas.getContext("2d");
  if (!miniCtx) {
    return;
  }

  const maskImg = document.getElementById(maskImgId);
  const contentWrap = document.querySelector(wrapSelector);

  /**
   * Main tuning block for game feel.
   * Increase `minConnectionDistancePx` / ratio for stricter locks.
   */
  const miniConfig = {
    dotMinSize: 2.8,
    dotMaxSize: 9.2,
    dotLife: 138,
    maxDots: 280,
    emitSpacing: 20,
    minConnectionDistancePx: 500,
    minConnectionDistanceRatio: 0.46,
    blinkSpeed: 0.009,
    darkPixelThreshold: 70,
    darkPixelDensity: 0.25,
    accentCooldownMs: 20,
    soundRepeatMinMs: 200,
    soundRepeatMaxMs: 2000
  };

  const gameDots = [];
  let lockedConnection = null;
  let currentStroke = [];
  let strokeId = 0;
  let miniDpr = Math.max(1, window.devicePixelRatio || 1);
  let miniW = 0;
  let miniH = 0;
  let drawing = false;
  let activePointerId = null;
  let lastEmitX = 0;
  let lastEmitY = 0;
  let lastMoveAt = performance.now();
  let miniGameActive = false;
  let maskData = null;
  let maskW = 0;
  let maskH = 0;
  let soundPattern = null;
  let lastSoundPlayAt = 0;
  let lastAccentEmitAt = -Infinity;

  function resizeMiniGameCanvas() {
    const rect = miniGameCanvas.getBoundingClientRect();
    miniDpr = Math.max(1, window.devicePixelRatio || 1);
    miniW = Math.max(1, rect.width);
    miniH = Math.max(1, rect.height);
    miniGameCanvas.width = Math.floor(miniW * miniDpr);
    miniGameCanvas.height = Math.floor(miniH * miniDpr);
    miniCtx.setTransform(miniDpr, 0, 0, miniDpr, 0, 0);
  }

  function loadMaskData() {
    if (!maskImg || !maskImg.complete || !maskImg.naturalWidth || !maskImg.naturalHeight) {
      return;
    }

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = maskImg.naturalWidth;
    sampleCanvas.height = maskImg.naturalHeight;
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sampleCtx) {
      return;
    }

    try {
      sampleCtx.drawImage(maskImg, 0, 0);
      maskW = sampleCanvas.width;
      maskH = sampleCanvas.height;
      maskData = sampleCtx.getImageData(0, 0, maskW, maskH).data;
    } catch (_err) {
      maskData = null;
    }
  }

  function getImagePlacement() {
    if (!maskW || !maskH) {
      return null;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.max(w / maskW, h / maskH);
    const drawW = maskW * scale;
    const drawH = maskH * scale;

    return {
      scale,
      offsetX: (w - drawW) * 0.5,
      offsetY: (h - drawH) * 0.5,
      drawW,
      drawH
    };
  }

  function sampleMaskAt(screenX, screenY) {
    if (!maskData || !maskW || !maskH) {
      return { isDarkLine: false, strength: 0 };
    }

    const placement = getImagePlacement();
    if (!placement) {
      return { isDarkLine: false, strength: 0 };
    }

    const srcX = Math.floor(((screenX - placement.offsetX) / placement.drawW) * maskW);
    const srcY = Math.floor(((screenY - placement.offsetY) / placement.drawH) * maskH);
    if (srcX < 0 || srcY < 0 || srcX >= maskW || srcY >= maskH) {
      return { isDarkLine: false, strength: 0 };
    }

    const sourcePixelsPerScreenPixel = 1 / placement.scale;
    const radius = Math.max(1, Math.min(24, Math.round(6 * sourcePixelsPerScreenPixel)));

    let darkCount = 0;
    let samples = 0;
    let centerLum = 255;

    for (let yy = -radius; yy <= radius; yy += 1) {
      const py = srcY + yy;
      if (py < 0 || py >= maskH) {
        continue;
      }

      for (let xx = -radius; xx <= radius; xx += 1) {
        const px = srcX + xx;
        if (px < 0 || px >= maskW) {
          continue;
        }

        const idx = (py * maskW + px) * 4;
        const r = maskData[idx];
        const g = maskData[idx + 1];
        const b = maskData[idx + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        if (xx === 0 && yy === 0) {
          centerLum = lum;
        }
        if (lum < miniConfig.darkPixelThreshold) {
          darkCount += 1;
        }
        samples += 1;
      }
    }

    if (!samples) {
      return { isDarkLine: false, strength: 0 };
    }

    const density = darkCount / samples;
    const centerDarkness = (255 - centerLum) / 255;
    const isDarkLine = centerLum < miniConfig.darkPixelThreshold || density > miniConfig.darkPixelDensity;
    const strength = Math.max(0, Math.min(1, centerDarkness * 0.72 + density * 0.9));
    return { isDarkLine, strength };
  }

  function isMiniGameActive() {
    // Check if cursor is over non-text content area
    if (!contentWrap) {
      return true;
    }
    return !contentWrap.contains(document.activeElement);
  }

  function createSoundPattern(traceLength) {
    // Pattern duration based on trace length
    // Longer trace = slower repetition rate
    const minMs = miniConfig.soundRepeatMinMs;
    const maxMs = miniConfig.soundRepeatMaxMs;
    const normalizedLength = Math.max(0, Math.min(1, traceLength / 1000));
    const intervalMs = minMs + (maxMs - minMs) * normalizedLength;

    return {
      traceLength,
      intervalMs,
      lastPlayAt: 0
    };
  }

  function getLocalPointerPosition(ev) {
    const rect = miniGameCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
    return { x, y };
  }

  function emitGameDot(x, y, size, strength = 1, ts = performance.now()) {
    if (ts - lastAccentEmitAt < miniConfig.accentCooldownMs) {
      return false;
    }
    lastAccentEmitAt = ts;

    const clampedSize = Math.max(miniConfig.dotMinSize, Math.min(miniConfig.dotMaxSize, size));
    gameDots.push({
      x,
      y,
      size: clampedSize,
      life: miniConfig.dotLife,
      maxLife: miniConfig.dotLife,
      strokeId,
      strength: strength
    });
    currentStroke.push({ x, y, size: clampedSize, strength: strength });

    playPluck(clampedSize, {
      min: miniConfig.dotMinSize,
      max: miniConfig.dotMaxSize
    });

    if (gameDots.length > miniConfig.maxDots) {
      gameDots.splice(0, gameDots.length - miniConfig.maxDots);
    }
    return true;
  }

  function beginDrawing(ev) {
    const isMouse = ev.pointerType === "mouse";
    const isLeftButton = !isMouse || ev.button === 0;
    if (!isLeftButton || !miniGameActive) {
      return;
    }

    unlockAudioContext();
    const pos = getLocalPointerPosition(ev);
    drawing = true;
    activePointerId = ev.pointerId;
    strokeId += 1;
    currentStroke = [];
    lastEmitX = pos.x;
    lastEmitY = pos.y;
    lastMoveAt = performance.now();
    
    // Check if starting on a dark line
    const screenPos = { x: ev.clientX, y: ev.clientY };
    const darkLineInfo = sampleMaskAt(screenPos.x, screenPos.y);
    
    if (darkLineInfo.isDarkLine) {
      emitGameDot(
        pos.x,
        pos.y,
        (miniConfig.dotMinSize + miniConfig.dotMaxSize) * 0.5,
        darkLineInfo.strength,
        lastMoveAt
      );
    }

    if (typeof miniGameCanvas.setPointerCapture === "function") {
      try {
        miniGameCanvas.setPointerCapture(ev.pointerId);
      } catch (_err) {
        // Ignore if pointer capture is unavailable.
      }
    }

    ev.preventDefault();
  }

  function drawPointerPath(ev) {
    if (!drawing || ev.pointerId !== activePointerId) {
      return;
    }

    const pos = getLocalPointerPosition(ev);
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveAt);
    const dx = pos.x - lastEmitX;
    const dy = pos.y - lastEmitY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < miniConfig.emitSpacing) {
      return;
    }

    const steps = Math.max(1, Math.floor(distance / miniConfig.emitSpacing));
    const speed = distance / dt;
    const speedUnit = Math.max(0, Math.min(1, speed / 0.9));
    
    const screenBaseX = ev.clientX;
    const screenBaseY = ev.clientY;

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const interpolatedX = lastEmitX + dx * t;
      const interpolatedY = lastEmitY + dy * t;
      
      // Calculate screen position for dark line sampling
      const screenX = screenBaseX - dx * (1 - t);
      const screenY = screenBaseY - dy * (1 - t);
      
      const darkLineInfo = sampleMaskAt(screenX, screenY);
      const dotSize = lerp(miniConfig.dotMinSize, miniConfig.dotMaxSize, speedUnit);
      
      if (darkLineInfo.isDarkLine) {
        emitGameDot(interpolatedX, interpolatedY, dotSize, darkLineInfo.strength, now);
      }
    }

    lastEmitX = pos.x;
    lastEmitY = pos.y;
    lastMoveAt = now;
    ev.preventDefault();
  }

  function endDrawing(ev) {
    if (!drawing || ev.pointerId !== activePointerId) {
      return;
    }

    drawing = false;
    activePointerId = null;

    if (
      typeof miniGameCanvas.releasePointerCapture === "function" &&
      typeof miniGameCanvas.hasPointerCapture === "function" &&
      miniGameCanvas.hasPointerCapture(ev.pointerId)
    ) {
      miniGameCanvas.releasePointerCapture(ev.pointerId);
    }

    if (currentStroke.length >= 2) {
      const start = currentStroke[0];
      const end = currentStroke[currentStroke.length - 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minDistance = Math.max(
        miniConfig.minConnectionDistancePx,
        miniW * miniConfig.minConnectionDistanceRatio
      );

      if (distance >= minDistance) {
        lockedConnection = {
          a: { x: start.x, y: start.y, size: start.size },
          b: { x: end.x, y: end.y, size: end.size },
          trace: currentStroke.map((point) => ({ x: point.x, y: point.y })),
          distance: distance
        };
        
        // Create sound pattern based on trace length
        soundPattern = createSoundPattern(distance);
        lastSoundPlayAt = performance.now();
      }
    }

    currentStroke = [];
    ev.preventDefault();
  }

  function renderMiniGame(ts) {
    miniCtx.clearRect(0, 0, miniW, miniH);
    
    // Handle repeating sound pattern for locked connection
    if (lockedConnection && soundPattern) {
      const now = performance.now();
      if (now - soundPattern.lastPlayAt >= soundPattern.intervalMs) {
        // Play sound using the size of the first anchor
        playPluck(lockedConnection.a.size, {
          min: miniConfig.dotMinSize,
          max: miniConfig.dotMaxSize
        });
        soundPattern.lastPlayAt = now;
      }
    }

    if (lockedConnection && lockedConnection.trace.length > 1) {
      miniCtx.strokeStyle = "rgba(29,170,218,0.82)";
      miniCtx.lineWidth = 2.1;
      miniCtx.beginPath();
      miniCtx.moveTo(lockedConnection.trace[0].x, lockedConnection.trace[0].y);
      for (let i = 1; i < lockedConnection.trace.length; i += 1) {
        miniCtx.lineTo(lockedConnection.trace[i].x, lockedConnection.trace[i].y);
      }
      miniCtx.stroke();

      const blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ts * miniConfig.blinkSpeed));
      [lockedConnection.a, lockedConnection.b].forEach((anchor) => {
        const radius = Math.max(3, anchor.size * (0.8 + blink * 0.35));
        miniCtx.fillStyle = `rgba(29,170,218,${0.42 + blink * 0.48})`;
        miniCtx.beginPath();
        miniCtx.arc(anchor.x, anchor.y, radius + 2.4, 0, Math.PI * 2);
        miniCtx.fill();

        miniCtx.fillStyle = "rgba(29,170,218,1)";
        miniCtx.beginPath();
        miniCtx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
        miniCtx.fill();
      });
    }

    for (let i = 1; i < gameDots.length; i += 1) {
      const prev = gameDots[i - 1];
      const curr = gameDots[i];
      if (prev.strokeId !== curr.strokeId) {
        continue;
      }
      const alpha = Math.min(prev.life / prev.maxLife, curr.life / curr.maxLife);
      if (alpha <= 0) {
        continue;
      }
      miniCtx.strokeStyle = `rgba(29,170,218,${alpha * 0.52})`;
      miniCtx.lineWidth = Math.max(0.8, (prev.size + curr.size) * 0.26);
      miniCtx.beginPath();
      miniCtx.moveTo(prev.x, prev.y);
      miniCtx.lineTo(curr.x, curr.y);
      miniCtx.stroke();
    }

    for (let i = 0; i < gameDots.length; i += 1) {
      const dot = gameDots[i];
      const alpha = dot.life / dot.maxLife;
      if (alpha <= 0) {
        continue;
      }
      miniCtx.fillStyle = `rgba(29,170,218,${alpha * 0.88})`;
      miniCtx.beginPath();
      miniCtx.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
      miniCtx.fill();
      dot.life -= 1;
    }

    while (gameDots.length > 0 && gameDots[0].life <= 0) {
      gameDots.shift();
    }

    window.requestAnimationFrame(renderMiniGame);
  }

  function updateMiniGameActive(ev) {
    // Check if pointer is outside content wrap (text areas)
    if (!contentWrap) {
      miniGameActive = true;
      return;
    }
    
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    miniGameActive = !contentWrap.contains(target);
  }

  miniGameCanvas.addEventListener("pointerdown", beginDrawing, { passive: false });
  miniGameCanvas.addEventListener("pointermove", drawPointerPath, { passive: false });
  miniGameCanvas.addEventListener("pointermove", updateMiniGameActive, { passive: true });
  miniGameCanvas.addEventListener("pointerup", endDrawing, { passive: false });
  miniGameCanvas.addEventListener("pointercancel", endDrawing, { passive: false });
  document.addEventListener("pointermove", updateMiniGameActive, { passive: true });
  window.addEventListener("resize", resizeMiniGameCanvas);

  resizeMiniGameCanvas();
  
  if (maskImg) {
    if (maskImg.complete && maskImg.naturalWidth) {
      // Image is already loaded
      loadMaskData();
    } else {
      // Wait for image to load
      maskImg.addEventListener("load", loadMaskData, { once: true });
    }
  }
  
  window.requestAnimationFrame(renderMiniGame);
}
