import { clamp01, lerp, rgba } from "./math-utils.js";

/**
 * Background FX module
 * - "Mini mode" is active only in the background area (outside text + bottom dead zone)
 * - Dark mask hits create blue dots (or words while left mouse is held)
 * - Every pair of consecutive blue dots stores the traced path and loops as an audio pattern
 */

const GRAY_LINE = "143, 143, 143";
const GRAY_DOT = "154, 154, 154";
const ACCENT_COLOR = "29,170,218";

/**
 * @param {{
 *   canvasId?: string,
 *   maskImgId?: string,
 *   wrapSelector?: string,
 *   wordPoolUrl?: string,
 *   playPluck?: (size:number, sizeRange:{min:number,max:number}) => void,
 *   playSineTone?: (frequencyHz:number) => void
 * }} options
 */
export function initBackgroundFx({
  canvasId = "fx",
  maskImgId = "maskImg",
  wrapSelector = ".wrap",
  wordPoolUrl = "assets/wordpool.txt",
  playPluck = () => {},
  playSineTone = () => {}
} = {}) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas ? canvas.getContext("2d") : null;
  if (!canvas || !ctx) {
    return;
  }

  const maskImg = document.getElementById(maskImgId);
  const contentWrap = document.querySelector(wrapSelector);
  const secretVideoBlock = document.getElementById("secret-video-block");
  const secretVideoFrame = document.getElementById("secret-video-frame");
  const secretVideoStatus = document.getElementById("secret-video-status");
  const wordShuffleThreshold = 0.7;
  const wordPickMode = "shuffle"; // "shuffle" or "ordered"

  const pointer = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    targetX: window.innerWidth * 0.5,
    targetY: window.innerHeight * 0.5,
    active: false
  };

  const trail = [];
  const lockedConnections = [];
  let pendingTrace = [];
  let pairStartAnchor = null;
  let miniModeActive = false;
  let secretZoneActive = false;
  let wordSessionActive = false;
  let gameStopped = false;
  let secretShapesCompleted = 0;
  let secretUnlocked = false;
  let leftMouseHeld = false;
  let lastAccentX = null;
  let lastAccentY = null;
  let lastAccentEmitAt = -Infinity;
  let lastEmitX = pointer.x;
  let lastEmitY = pointer.y;
  let lastEmitAt = 0;

  let wordPool = null;
  let wordFont = null;
  let wordRemainingIndices = [];
  let wordShuffleCutoff = 0;
  let wordUsedCount = 0;
  let wordIndex = 0;
  let lastWordX = null;
  let lastWordY = null;
  let wordsActive = false;

  /**
   * Tunable values for trail appearance and pointer responsiveness.
   */
  const settings = {
    baseDotSize: 1.85,
    baseLife: 54,
    accentMaxExtraSize: 6.5,
    accentLife: 126,
    accentMinSpacing: 18,
    accentCooldownMs: 20,
    maxPoints: 180,
    smoothness: 0.22,
    minTrailSpacing: 14,
    maxTrailSpacing: 58,
    speedForMaxSpacing: 1.6,
    speedResponse: 2,
    speedDecayPerFrame: 0.92,
    slowIdleEmitMs: 32,
    fastIdleEmitMs: 16,
    wordMinSpacing: 46,
    traceSampleSpacing: 6,
    bottomDeadZonePx: 88,
    maxConnections: 10,
    minLoopBpm: 1,
    maxLoopBpm: 100,
    secretGoalShapes: 3,
    secretTargetLengthPx: 220,
    secretLengthTolerancePx: 60
  };

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;

  let maskData = null;
  let maskW = 0;
  let maskH = 0;
  let cursorSpeed = 0;
  let lastInputX = pointer.targetX;
  let lastInputY = pointer.targetY;
  let lastInputAt = performance.now();

  function distSq(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function updateWordFont() {
    const baseFont = window.getComputedStyle(document.body).fontFamily || "serif";
    wordFont = baseFont
      .replace(/ui-sans-serif/g, "ui-serif")
      .replace(/sans-serif/g, "serif");
  }

  function resetWordShuffle() {
    if (!wordPool || wordPool.length === 0) {
      wordRemainingIndices = [];
      wordShuffleCutoff = 0;
      wordUsedCount = 0;
      lastWordX = null;
      lastWordY = null;
      return;
    }

    wordRemainingIndices = Array.from({ length: wordPool.length }, (_, i) => i);
    wordShuffleCutoff = Math.max(1, Math.ceil(wordPool.length * wordShuffleThreshold));
    wordUsedCount = 0;
  }

  function resetWordOrder() {
    wordIndex = 0;
    lastWordX = null;
    lastWordY = null;
  }

  async function loadWordPool() {
    try {
      const resp = await fetch(wordPoolUrl, { cache: "no-store" });
      const text = resp.ok ? await resp.text() : "";
      const words = text
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => {
          if (!word) {
            return false;
          }
          const lower = word.toLowerCase();
          if (lower === "the") {
            return false;
          }
          return !/^\d+$/.test(word);
        })
        .filter((word) => /^[A-Za-z]+$/.test(word));

      wordPool = words.length ? words : null;
    } catch (_err) {
      wordPool = null;
    }

    resetWordShuffle();
    resetWordOrder();
  }

  function setWordsActive(next) {
    if (wordsActive === next) {
      return;
    }

    wordsActive = next;
    lastWordX = null;
    lastWordY = null;
    document.body.style.userSelect = next ? "none" : "";
  }

  function pickWord() {
    if (!wordPool || wordPool.length === 0) {
      return null;
    }

    if (wordPickMode === "ordered") {
      const word = wordPool[wordIndex];
      wordIndex = (wordIndex + 1) % wordPool.length;
      return word;
    }

    if (wordRemainingIndices.length === 0) {
      resetWordShuffle();
    }

    if (wordUsedCount < wordShuffleCutoff && wordRemainingIndices.length) {
      const pos = Math.floor(Math.random() * wordRemainingIndices.length);
      const idx = wordRemainingIndices[pos];
      wordRemainingIndices.splice(pos, 1);
      wordUsedCount += 1;
      return wordPool[idx];
    }

    const idx = Math.floor(Math.random() * wordPool.length);
    const remainingPos = wordRemainingIndices.indexOf(idx);
    if (remainingPos !== -1) {
      wordRemainingIndices.splice(remainingPos, 1);
    }
    return wordPool[idx];
  }

  function resizeCanvas() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isMiniGameArea(clientX, clientY, target) {
    if (clientY >= h - settings.bottomDeadZonePx) {
      return false;
    }
    if (!(target instanceof Element)) {
      return true;
    }
    if (target === canvas) {
      return true;
    }
    if (!contentWrap) {
      return true;
    }
    return !contentWrap.contains(target);
  }

  function setMiniModeActive(next) {
    if (miniModeActive === next) {
      return;
    }

    miniModeActive = next;

    if (!next) {
      cursorSpeed = 0;
      setWordsActive(false);
      if (!wordSessionActive) {
        pendingTrace = pairStartAnchor
          ? [{ x: pairStartAnchor.x, y: pairStartAnchor.y, generatedAt: lastInputAt, size: settings.baseDotSize }]
          : [];
      }
      return;
    }

    if (leftMouseHeld) {
      if (!wordSessionActive) {
        startWordSession();
      }
      setWordsActive(true);
    }
  }

  function isPointInsideElement(clientX, clientY, el) {
    if (!el) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function updateSecretStatus() {
    if (!secretVideoStatus) {
      return;
    }
    if (secretUnlocked) {
      secretVideoStatus.hidden = true;
      return;
    }
    secretVideoStatus.hidden = false;
    secretVideoStatus.textContent = `${secretShapesCompleted}/${settings.secretGoalShapes}`;
  }

  function revealSecretVideo() {
    if (!secretVideoBlock || !secretVideoFrame) {
      return;
    }
    secretVideoBlock.classList.add("is-unlocked");
    secretVideoFrame.hidden = false;
    if (secretVideoStatus) {
      secretVideoStatus.hidden = true;
      secretVideoStatus.textContent = "";
    }
  }

  function completeSecretChallenge() {
    if (secretUnlocked) {
      return;
    }
    secretUnlocked = true;
    gameStopped = false;
    wordSessionActive = false;
    clearAllGameVisuals();
    setWordsActive(false);
    lastEmitX = pointer.x;
    lastEmitY = pointer.y;
    lastEmitAt = performance.now();
    revealSecretVideo();
    updateSecretStatus();
  }

  function traceLengthToSineHz(traceLength) {
    const minLen = Math.max(1, settings.secretTargetLengthPx - settings.secretLengthTolerancePx);
    const maxLen = settings.secretTargetLengthPx + settings.secretLengthTolerancePx;
    const normalized = clamp01((traceLength - minLen) / Math.max(1, maxLen - minLen));
    return lerp(220, 880, normalized);
  }

  function clearAllGameVisuals() {
    trail.length = 0;
    lockedConnections.length = 0;
    pendingTrace = [];
    pairStartAnchor = null;
    lastAccentX = null;
    lastAccentY = null;
    lastAccentEmitAt = -Infinity;
    lastWordX = null;
    lastWordY = null;
  }

  function startWordSession() {
    if (wordSessionActive) {
      return;
    }
    wordSessionActive = true;
    clearAllGameVisuals();
  }

  function endWordSession() {
    if (!wordSessionActive) {
      return;
    }
    wordSessionActive = false;
    clearAllGameVisuals();
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

  /**
   * Sample local darkness around a screen coordinate.
   * Dark regions in the mask are used as accent trigger zones.
   */
  function sampleMaskAt(screenX, screenY) {
    if (!maskData || !maskW || !maskH) {
      return { hit: false, strength: 0 };
    }

    const placement = getImagePlacement();
    if (!placement) {
      return { hit: false, strength: 0 };
    }

    const srcX = Math.floor(((screenX - placement.offsetX) / placement.drawW) * maskW);
    const srcY = Math.floor(((screenY - placement.offsetY) / placement.drawH) * maskH);
    if (srcX < 0 || srcY < 0 || srcX >= maskW || srcY >= maskH) {
      return { hit: false, strength: 0 };
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
        if (lum < 52) {
          darkCount += 1;
        }
        samples += 1;
      }
    }

    if (!samples) {
      return { hit: false, strength: 0 };
    }

    const density = darkCount / samples;
    const centerDarkness = (255 - centerLum) / 255;
    const hit = centerLum < 70 || density > 0.25;
    const strength = Math.max(0, Math.min(1, centerDarkness * 0.72 + density * 0.9));
    return { hit, strength };
  }

  function pushPoint({ x, y, accent, size, word }) {
    trail.push({
      x,
      y,
      life: accent ? settings.accentLife : settings.baseLife,
      maxLife: accent ? settings.accentLife : settings.baseLife,
      size,
      accent,
      word
    });

    if (trail.length > settings.maxPoints) {
      trail.splice(0, trail.length - settings.maxPoints);
    }
  }

  function appendPendingTracePoint(x, y, ts) {
    if (!(miniModeActive || secretZoneActive) || !pairStartAnchor) {
      return;
    }
    if (pendingTrace.length === 0) {
      pendingTrace.push({ x: pairStartAnchor.x, y: pairStartAnchor.y, generatedAt: ts, size: settings.baseDotSize });
    }
    const lastPoint = pendingTrace[pendingTrace.length - 1];
    const minSpacingSq = settings.traceSampleSpacing * settings.traceSampleSpacing;
    if (distSq(x, y, lastPoint.x, lastPoint.y) >= minSpacingSq) {
      pendingTrace.push({ x, y, generatedAt: ts, size: settings.baseDotSize });
    }
  }

  function polylineLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.sqrt(distSq(points[i].x, points[i].y, points[i - 1].x, points[i - 1].y));
    }
    return total;
  }

  function intervalFromTraceLength(traceLength) {
    const viewportDiagonal = Math.max(1, Math.hypot(w, h));
    const normalized = clamp01(traceLength / (viewportDiagonal * 1.5));
    const bpm = lerp(settings.maxLoopBpm, settings.minLoopBpm, normalized);
    return 60000 / bpm;
  }

  function registerPairAnchor(anchor, ts) {
    // Pair mode: first anchor arms the pair, second anchor closes it.
    if (!pairStartAnchor) {
      pairStartAnchor = anchor;
      pendingTrace = [{ x: anchor.x, y: anchor.y, generatedAt: ts, size: settings.baseDotSize }];
      return;
    }

    const trace = pendingTrace.length
      ? pendingTrace.map((point) => ({ ...point }))
      : [{ x: pairStartAnchor.x, y: pairStartAnchor.y, generatedAt: pairStartAnchor.generatedAt, size: settings.baseDotSize }];
    const traceLast = trace[trace.length - 1];
    if (!traceLast || distSq(traceLast.x, traceLast.y, anchor.x, anchor.y) > 4) {
      trace.push({ x: anchor.x, y: anchor.y, generatedAt: ts, size: settings.baseDotSize });
    }

    const traceLength = polylineLength(trace);
    if (trace.length >= 2) {
      const isSecretShape = Boolean(pairStartAnchor.isSecretZone && anchor.isSecretZone);
      const isLengthMatch = Math.abs(traceLength - settings.secretTargetLengthPx) <= settings.secretLengthTolerancePx;
      const soundType = isSecretShape || isLengthMatch ? "sine" : "pluck";
      const sineFrequencyHz = soundType === "sine" ? traceLengthToSineHz(traceLength) : 0;
      const intervalMs = intervalFromTraceLength(traceLength);
      const connection = {
        a: { ...pairStartAnchor },
        b: { ...anchor },
        trace,
        createdAt: ts,
        intervalMs,
        nextPlayAt: soundType === "sine" ? ts + intervalMs : ts,
        nextAnchorIndex: 0,
        isLengthMatch,
        soundType,
        sineFrequencyHz
      };
      lockedConnections.push(connection);

      if (lockedConnections.length > settings.maxConnections) {
        lockedConnections.splice(0, lockedConnections.length - settings.maxConnections);
      }

      if (soundType === "sine") {
        playSineTone(sineFrequencyHz);
      }

      if (isSecretShape && isLengthMatch && !secretUnlocked) {
        secretShapesCompleted += 1;
        updateSecretStatus();
        if (secretShapesCompleted >= settings.secretGoalShapes) {
          completeSecretChallenge();
        }
      }
    }

    pairStartAnchor = null;
    pendingTrace = [];
  }

  function registerBlueDot(x, y, size, ts, isSecretZone = false) {
    registerPairAnchor({
      x,
      y,
      size,
      generatedAt: ts,
      isSecretZone,
      isWord: false,
      word: null
    }, ts);
  }

  function getTraceWaveAlpha(ts, generatedAt, beatMs) {
    if (!beatMs || !Number.isFinite(beatMs) || !Number.isFinite(generatedAt)) {
      return 1;
    }
    const safeBeatMs = Math.max(24, beatMs);
    const phase = ((ts - generatedAt) / safeBeatMs) * Math.PI * 2;
    return 0.24 + 0.76 * (0.5 + 0.5 * Math.sin(phase));
  }

  function renderTraceAsTrail(points, ts, beatMs = null, lineRgb = GRAY_LINE) {
    if (!points || points.length === 0) {
      return;
    }

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const prevAlpha = getTraceWaveAlpha(ts, prev.generatedAt, beatMs);
      const currAlpha = getTraceWaveAlpha(ts, curr.generatedAt, beatMs);
      const lineAlpha = Math.min(prevAlpha, currAlpha);
      if (lineAlpha <= 0) {
        continue;
      }

      ctx.strokeStyle = rgba(lineRgb, lineAlpha * 0.5);
      ctx.lineWidth = Math.max(0.6, ((prev.size + curr.size) * 0.38) * (0.35 + lineAlpha));
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const alpha = getTraceWaveAlpha(ts, p.generatedAt, beatMs);
      if (alpha <= 0) {
        continue;
      }

      ctx.fillStyle = rgba(GRAY_DOT, alpha * 0.72);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.72 + alpha * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function tryEmitWord(x, y, size, ts) {
    if (!wordsActive || !wordPool || wordPool.length === 0) {
      return "not_applicable";
    }
    if (lastWordX !== null && lastWordY !== null) {
      const wordSpacingSq = settings.wordMinSpacing * settings.wordMinSpacing;
      if (distSq(x, y, lastWordX, lastWordY) < wordSpacingSq) {
        return "skipped_spacing";
      }
    }

    const word = pickWord();
    if (!word) {
      return "not_applicable";
    }

    pushPoint({
      x,
      y,
      accent: true,
      size,
      word
    });
    if (miniModeActive && wordSessionActive) {
      registerPairAnchor({
        x,
        y,
        size,
        generatedAt: ts,
        isSecretZone: secretZoneActive,
        isWord: true,
        word
      }, ts);
    }
    lastWordX = x;
    lastWordY = y;
    return "emitted";
  }

  function playConnections(ts) {
    if (gameStopped) {
      return;
    }

    for (let i = 0; i < lockedConnections.length; i += 1) {
      const connection = lockedConnections[i];
      while (ts >= connection.nextPlayAt) {
        if (connection.soundType === "sine") {
          playSineTone(connection.sineFrequencyHz);
        } else {
          const anchor = connection.nextAnchorIndex === 0 ? connection.a : connection.b;
          playPluck(anchor.size, {
            min: settings.baseDotSize,
            max: settings.baseDotSize + settings.accentMaxExtraSize
          });
        }

        connection.nextAnchorIndex = connection.nextAnchorIndex === 0 ? 1 : 0;
        connection.nextPlayAt += connection.intervalMs;
      }
    }
  }

  function render(ts) {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < lockedConnections.length; i += 1) {
      const connection = lockedConnections[i];
      if (connection.trace.length < 2) {
        continue;
      }

      const lineRgb = connection.isLengthMatch ? ACCENT_COLOR : GRAY_LINE;
      renderTraceAsTrail(connection.trace, ts, connection.intervalMs, lineRgb);
    }

    if ((miniModeActive || secretZoneActive) && pendingTrace.length > 1) {
      renderTraceAsTrail(pendingTrace, ts);
    }

    for (let i = 1; i < trail.length; i += 1) {
      const prev = trail[i - 1];
      const curr = trail[i];
      const lineAlpha = Math.min(prev.life / prev.maxLife, curr.life / curr.maxLife);
      if (lineAlpha <= 0) {
        continue;
      }
      if (prev.accent || curr.accent) {
        continue;
      }

      ctx.strokeStyle = rgba(GRAY_LINE, lineAlpha * 0.5);
      ctx.lineWidth = Math.max(0.6, ((prev.size + curr.size) * 0.38) * (0.35 + lineAlpha));
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
    }

    for (let i = 0; i < trail.length; i += 1) {
      const p = trail[i];
      const alpha = p.life / p.maxLife;
      if (alpha <= 0) {
        continue;
      }

      if (p.accent && p.word) {
        const fontSize = Math.max(10, p.size * 3.8);
        ctx.font = `600 ${Math.round(fontSize)}px ${wordFont || "serif"}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(ACCENT_COLOR, alpha);
        ctx.fillText(p.word, p.x, p.y);
      } else {
        ctx.fillStyle = p.accent ? rgba(ACCENT_COLOR, alpha) : rgba(GRAY_DOT, alpha * 0.72);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.72 + alpha * 0.28), 0, Math.PI * 2);
        ctx.fill();
      }
      p.life -= 1;
    }

    const pulse = 0.56 + 0.44 * (0.5 + 0.5 * Math.sin(performance.now() * 0.01));
    for (let i = 0; i < lockedConnections.length; i += 1) {
      const connection = lockedConnections[i];
      const anchors = [connection.a, connection.b];
      for (let j = 0; j < anchors.length; j += 1) {
        const anchor = anchors[j];
        if (anchor.isWord && anchor.word) {
          const fontSize = Math.max(12, anchor.size * (3.3 + pulse * 0.45));
          ctx.font = `600 ${Math.round(fontSize)}px ${wordFont || "serif"}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = rgba(ACCENT_COLOR, 0.94);
          ctx.fillText(anchor.word, anchor.x, anchor.y);
          continue;
        }

        const radius = Math.max(2.4, anchor.size * (0.78 + pulse * 0.32));
        ctx.fillStyle = rgba(ACCENT_COLOR, 0.28 + pulse * 0.36);
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, radius + 2.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgba(ACCENT_COLOR, 1);
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (pairStartAnchor) {
      if (pairStartAnchor.isWord && pairStartAnchor.word) {
        const fontSize = Math.max(12, pairStartAnchor.size * 3.4);
        ctx.font = `600 ${Math.round(fontSize)}px ${wordFont || "serif"}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(ACCENT_COLOR, 0.96);
        ctx.fillText(pairStartAnchor.word, pairStartAnchor.x, pairStartAnchor.y);
      } else {
        const radius = Math.max(2.8, pairStartAnchor.size);
        ctx.fillStyle = rgba(ACCENT_COLOR, 1);
        ctx.beginPath();
        ctx.arc(pairStartAnchor.x, pairStartAnchor.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    while (trail.length > 0 && trail[0].life <= 0) {
      trail.shift();
    }
  }

  function tick(ts) {
    pointer.x += (pointer.targetX - pointer.x) * settings.smoothness;
    pointer.y += (pointer.targetY - pointer.y) * settings.smoothness;
    if (!gameStopped) {
      appendPendingTracePoint(pointer.x, pointer.y, ts);
    }

    const speedT = clamp01(cursorSpeed / settings.speedForMaxSpacing);
    const spacing = lerp(settings.minTrailSpacing, settings.maxTrailSpacing, speedT);
    const idleEmitMs = lerp(settings.slowIdleEmitMs, settings.fastIdleEmitMs, speedT);
    const dx = pointer.x - lastEmitX;
    const dy = pointer.y - lastEmitY;
    const emitDistSq = dx * dx + dy * dy;
    const shouldEmit = !gameStopped && pointer.active && (emitDistSq > spacing * spacing || ts - lastEmitAt > idleEmitMs);

    if (shouldEmit) {
      const accentInfo = sampleMaskAt(pointer.x, pointer.y);
      const accentSize = settings.baseDotSize + settings.accentMaxExtraSize * accentInfo.strength;
      const accentSpacingSq = settings.accentMinSpacing * settings.accentMinSpacing;
      const accentCooldownReady = ts - lastAccentEmitAt >= settings.accentCooldownMs;
      const hasAccentGap = lastAccentX === null || distSq(pointer.x, pointer.y, lastAccentX, lastAccentY) >= accentSpacingSq;
      const canCreateShape = miniModeActive || secretZoneActive;

      if (accentInfo.hit && hasAccentGap && accentCooldownReady) {
        if (wordsActive) {
          const wordResult = tryEmitWord(pointer.x, pointer.y, accentSize, ts);
          if (wordResult === "emitted") {
            lastAccentX = pointer.x;
            lastAccentY = pointer.y;
            lastAccentEmitAt = ts;
          }
        } else {
          pushPoint({
            x: pointer.x,
            y: pointer.y,
            accent: true,
            size: accentSize,
            word: null
          });
          if (!secretZoneActive) {
            playPluck(accentSize, {
              min: settings.baseDotSize,
              max: settings.baseDotSize + settings.accentMaxExtraSize
            });
          }
          if (canCreateShape) {
            registerBlueDot(pointer.x, pointer.y, accentSize, ts, secretZoneActive);
          }
          lastAccentX = pointer.x;
          lastAccentY = pointer.y;
          lastAccentEmitAt = ts;
        }
      } else if (!wordsActive) {
        pushPoint({
          x: pointer.x,
          y: pointer.y,
          accent: false,
          size: settings.baseDotSize,
          word: null
        });
      }

      lastEmitX = pointer.x;
      lastEmitY = pointer.y;
      lastEmitAt = ts;
    }

    playConnections(ts);
    render(ts);
    cursorSpeed *= settings.speedDecayPerFrame;
    window.requestAnimationFrame(tick);
  }

  function onPointerMove(ev) {
    const now = performance.now();
    const moveDx = ev.clientX - lastInputX;
    const moveDy = ev.clientY - lastInputY;
    const dt = Math.max(1, now - lastInputAt);
    const instantSpeed = Math.sqrt(moveDx * moveDx + moveDy * moveDy) / dt;

    cursorSpeed += (instantSpeed - cursorSpeed) * settings.speedResponse;
    lastInputX = ev.clientX;
    lastInputY = ev.clientY;
    lastInputAt = now;
    pointer.targetX = ev.clientX;
    pointer.targetY = ev.clientY;
    pointer.active = true;
    const target = ev.target instanceof Element
      ? ev.target
      : document.elementFromPoint(ev.clientX, ev.clientY);
    secretZoneActive = isPointInsideElement(ev.clientX, ev.clientY, secretVideoBlock);
    const nextMiniMode = isMiniGameArea(ev.clientX, ev.clientY, target);
    setMiniModeActive(nextMiniMode);
  }

  function onPointerDown(ev) {
    const isMouse = ev.pointerType === "mouse";
    const isLeft = !isMouse || ev.button === 0;
    if (isLeft) {
      leftMouseHeld = true;
    }
    onPointerMove(ev);
    const allowWords = isLeft && miniModeActive && !gameStopped;
    if (allowWords) {
      startWordSession();
    }
    setWordsActive(allowWords);
    if (allowWords) {
      ev.preventDefault();
    }
  }

  function onPointerUp(ev) {
    const isMouse = ev.pointerType === "mouse";
    const isLeft = !isMouse || ev.button === 0;
    if (isLeft) {
      leftMouseHeld = false;
      endWordSession();
      setWordsActive(false);
    }
  }

  function onPointerLeave() {
    pointer.active = false;
    secretZoneActive = false;
    leftMouseHeld = false;
    endWordSession();
    setMiniModeActive(false);
    setWordsActive(false);
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  window.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("blur", onPointerLeave);

  if (maskImg) {
    if (maskImg.complete) {
      loadMaskData();
    } else {
      maskImg.addEventListener("load", loadMaskData, { once: true });
    }
  }

  updateWordFont();
  loadWordPool();
  updateSecretStatus();
  resizeCanvas();
  window.requestAnimationFrame(tick);
}
