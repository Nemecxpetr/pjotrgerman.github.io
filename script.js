(() => {
  const canvas = document.getElementById("fx");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const maskImg = document.getElementById("maskImg");
  const yearEl = document.getElementById("year");
  const contentWrap = document.querySelector(".wrap");
  const releasesUrl = "assets/releases.json";
  const latestReleasesEl = document.getElementById("latest-releases");
  const allReleasesEl = document.getElementById("all-releases");
  const wordPoolUrl = "assets/wordpool.txt";
  const wordShuffleThreshold = 0.7;
  const wordPickMode = "shuffle"; // "shuffle" or "ordered"

  let wordPool = null;
  let wordFont = null;
  let wordRemainingIndices = [];
  let wordShuffleCutoff = 0;
  let wordUsedCount = 0;
  let wordIndex = 0;
  let lastWordX = null;
  let lastWordY = null;
  let wordsActive = false;

  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  function cleanText(value) {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === "---") {
      return "";
    }
    return trimmed;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getReleaseYear(item) {
    if (!item) {
      return null;
    }
    if (typeof item.date === "string") {
      const year = Number(item.date.slice(0, 4));
      if (Number.isFinite(year)) {
        return year;
      }
    }
    if (typeof item.dateLabel === "string") {
      const match = item.dateLabel.match(/(19|20)\d{2}/);
      if (match) {
        const year = Number(match[0]);
        if (Number.isFinite(year)) {
          return year;
        }
      }
    }
    return null;
  }

  function applyReleaseTint(card, year, range) {
    if (!card || !range || !Number.isFinite(year)) {
      return;
    }
    const minYear = range.min;
    const maxYear = range.max;
    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
      return;
    }
    const span = Math.max(1, maxYear - minYear);
    const t = Math.max(0, Math.min(1, (year - minYear) / span));
    const darkAlpha = 0.08 * (1 - t);
    const lightAlpha = 0.12 * t;
    card.style.setProperty("--release-dark", darkAlpha.toFixed(3));
    card.style.setProperty("--release-light", lightAlpha.toFixed(3));
  }

  function formatDateFromIso(iso) {
    if (typeof iso !== "string") {
      return "";
    }
    const parts = iso.split("-");
    if (parts.length !== 3) {
      return iso;
    }
    const year = parts[0];
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) {
      return iso;
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = months[month - 1];
    if (!monthName) {
      return iso;
    }
    const dayLabel = String(day).padStart(2, "0");
    return `${dayLabel} ${monthName} ${year}`;
  }

  function toDateValue(iso) {
    if (typeof iso !== "string") {
      return 0;
    }
    const parts = iso.split("-");
    if (parts.length !== 3) {
      return 0;
    }
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) {
      return 0;
    }
    return Date.UTC(year, month - 1, day);
  }

  function createReleaseCard(item, options) {
    const opts = options || {};
    const event = cleanText(item.event);
    const workText = cleanText(item.work);
    const workHtml = cleanText(item.workHtml);
    const role = cleanText(item.role);
    const place = cleanText(item.place);
    const notes = cleanText(item.notes);
    const dateLabel = cleanText(item.dateLabel) || formatDateFromIso(item.date);
    const hasWork = Boolean(workHtml || workText);

    const card = document.createElement("article");
    card.className = "work release";
    applyReleaseTint(card, getReleaseYear(item), opts.yearRange);

    const grid = document.createElement("div");
    grid.className = "release-grid";

    const meta = document.createElement("div");
    meta.className = "work-meta";

    const title = document.createElement("h3");
    if (hasWork) {
      if (workHtml) {
        title.innerHTML = workHtml;
      } else if (item.workItalic) {
        title.innerHTML = `<em>${escapeHtml(workText)}</em>`;
      } else {
        title.textContent = workText;
      }
    } else if (event) {
      title.textContent = event;
    } else {
      title.textContent = "Release";
    }
    meta.appendChild(title);

    if (event && hasWork) {
      const eventLine = document.createElement("p");
      eventLine.className = "work-desc";
      eventLine.textContent = event;
      meta.appendChild(eventLine);
    }

    const detailParts = [];
    if (dateLabel) {
      detailParts.push(dateLabel);
    }
    if (role) {
      detailParts.push(role);
    }
    if (place) {
      detailParts.push(place);
    }
    if (detailParts.length) {
      const detailLine = document.createElement("p");
      detailLine.className = "work-desc";
      detailLine.textContent = detailParts.join(" • ");
      meta.appendChild(detailLine);
    }

    if (notes && opts.showNotes !== false) {
      const notesLine = document.createElement("p");
      notesLine.className = "work-desc";
      notesLine.textContent = notes;
      meta.appendChild(notesLine);
    }

    grid.appendChild(meta);

    const allowLinks = opts.showLinks !== false;
    if (allowLinks && Array.isArray(item.links) && item.links.length) {
      const validLinks = item.links
        .filter((link) => link && typeof link.url === "string" && typeof link.label === "string")
        .map((link) => ({
          label: link.label.trim(),
          url: link.url.trim()
        }))
        .filter((link) => link.label && link.url);

      if (validLinks.length) {
        const primary = validLinks[0];
        const column = document.createElement("a");
        column.className = "release-column";
        column.href = primary.url;
        column.textContent = primary.label;
        if (/^https?:\/\//i.test(primary.url)) {
          column.target = "_blank";
          column.rel = "noreferrer";
        }
        grid.appendChild(column);

        if (validLinks.length > 1) {
          const secondaryWrap = document.createElement("div");
          secondaryWrap.className = "release-secondary";
          validLinks.slice(1).forEach((link) => {
            const anchor = document.createElement("a");
            anchor.className = "release-secondary-link";
            anchor.href = link.url;
            anchor.textContent = link.label;
            if (/^https?:\/\//i.test(link.url)) {
              anchor.target = "_blank";
              anchor.rel = "noreferrer";
            }
            secondaryWrap.appendChild(anchor);
          });
          meta.appendChild(secondaryWrap);
        }
      }
    }

    card.appendChild(grid);
    return card;
  }

  function renderReleases(target, items, options) {
    if (!target) {
      return;
    }
    target.innerHTML = "";
    const limit = options && typeof options.limit === "number" ? options.limit : items.length;
    let count = 0;
    for (let i = 0; i < items.length; i += 1) {
      if (count >= limit) {
        break;
      }
      const card = createReleaseCard(items[i], options);
      target.appendChild(card);
      count += 1;
    }
    if (!count) {
      const empty = document.createElement("p");
      empty.className = "work-desc";
      empty.textContent = "No releases yet.";
      target.appendChild(empty);
    }
  }

  function syncReleaseColumnWidth() {
    const columns = document.querySelectorAll(".release-column");
    if (!columns.length) {
      return;
    }

    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);

    const firstStyle = window.getComputedStyle(columns[0]);
    const padLeft = parseFloat(firstStyle.paddingLeft) || 0;
    const padRight = parseFloat(firstStyle.paddingRight) || 0;
    const borderLeft = parseFloat(firstStyle.borderLeftWidth) || 0;
    const borderRight = parseFloat(firstStyle.borderRightWidth) || 0;

    let maxWidth = 0;
    columns.forEach((column) => {
      const style = window.getComputedStyle(column);
      probe.style.font = style.font;
      probe.style.letterSpacing = style.letterSpacing;
      const label = column.textContent ? column.textContent.trim() : "";
      if (!label) {
        return;
      }
      const words = label.split(/\s+/);
      words.forEach((word) => {
        if (!word) {
          return;
        }
        probe.textContent = word;
        const textWidth = probe.getBoundingClientRect().width;
        const total = Math.ceil(textWidth + padLeft + padRight + borderLeft + borderRight);
        if (total > maxWidth) {
          maxWidth = total;
        }
      });
    });

    if (maxWidth > 0) {
      document.documentElement.style.setProperty("--release-col-width", `${maxWidth}px`);
    }

    probe.remove();
  }

  function loadReleases() {
    if (!latestReleasesEl && !allReleasesEl) {
      return;
    }
    fetch(releasesUrl, { cache: "no-store" })
      .then((resp) => (resp.ok ? resp.text() : ""))
      .then((text) => {
        const cleaned = text.replace(/^\uFEFF/, "");
        if (!cleaned) {
          return [];
        }
        try {
          return JSON.parse(cleaned);
        } catch (_err) {
          return [];
        }
      })
      .then((items) => {
        if (!Array.isArray(items)) {
          return;
        }
        const indexed = items.map((item, index) => ({ ...item, _index: index }));
        indexed.sort((a, b) => {
          const diff = toDateValue(b.date) - toDateValue(a.date);
          if (diff !== 0) {
            return diff;
          }
          return a._index - b._index;
        });
        const yearValues = indexed
          .map((item) => getReleaseYear(item))
          .filter((year) => Number.isFinite(year));
        const yearRange = yearValues.length
          ? { min: Math.min(...yearValues), max: Math.max(...yearValues) }
          : null;
        if (latestReleasesEl) {
          renderReleases(latestReleasesEl, indexed, {
            limit: 3,
            showLinks: false,
            showNotes: false,
            yearRange
          });
        }
        if (allReleasesEl) {
          renderReleases(allReleasesEl, indexed, {
            showLinks: true,
            showNotes: true,
            yearRange
          });
        }
        window.requestAnimationFrame(syncReleaseColumnWidth);
      })
      .catch(() => {
        if (latestReleasesEl) {
          renderReleases(latestReleasesEl, [], { limit: 0 });
        }
        if (allReleasesEl) {
          renderReleases(allReleasesEl, [], { limit: 0 });
        }
        window.requestAnimationFrame(syncReleaseColumnWidth);
      });
  }

  loadReleases();
  window.addEventListener("resize", syncReleaseColumnWidth);

  if (!canvas || !ctx) {
    return;
  }

  const pointer = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    targetX: window.innerWidth * 0.5,
    targetY: window.innerHeight * 0.5,
    active: false
  };

  const trail = [];
  let lastEmitX = pointer.x;
  let lastEmitY = pointer.y;
  let lastEmitAt = 0;

  const settings = {
    baseDotSize: 1.85,
    baseLife: 64,
    accentMaxExtraSize: 6.5,
    accentLife: 126,
    accentMinSpacing: 10,
    maxPoints: 120,
    smoothness: 0.22,
    minTrailSpacing: 40,
    maxTrailSpacing: 2000,
    speedForMaxSpacing: 5,
    speedResponse: 2,
    speedDecayPerFrame: 0.92,
    slowIdleEmitMs: 52,
    fastIdleEmitMs: 24,
    wordMinSpacing: 46
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

  function updateWordFont() {
    const baseFont = window.getComputedStyle(document.body).fontFamily || "serif";
    wordFont = baseFont
      .replace(/ui-sans-serif/g, "ui-serif")
      .replace(/sans-serif/g, "serif");
  }

  function loadWordPool() {
    return fetch(wordPoolUrl, { cache: "no-store" })
      .then((resp) => (resp.ok ? resp.text() : ""))
      .then((text) => {
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
        resetWordShuffle();
        resetWordOrder();
      })
      .catch(() => {
        wordPool = null;
        resetWordShuffle();
        resetWordOrder();
      });
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

  function setWordsActive(next) {
    if (wordsActive === next) {
      return;
    }

    wordsActive = next;
    lastWordX = null;
    lastWordY = null;
    document.body.style.userSelect = next ? "none" : "";
  }

  function isBackgroundTarget(target) {
    if (!(target instanceof Element)) {
      return true;
    }

    if (target === canvas) {
      return true;
    }

    if (!contentWrap) {
      return true;
    }

    return !target.closest(".wrap");
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

  function pushPoint(x, y, accentInfo) {
    const accent = accentInfo.hit;
    const strength = accentInfo.strength;

    const word = accent && wordsActive ? pickWord() : null;
    if (word) {
      lastWordX = x;
      lastWordY = y;
    }

    trail.push({
      x,
      y,
      life: accent ? settings.accentLife : settings.baseLife,
      maxLife: accent ? settings.accentLife : settings.baseLife,
      size: accent
        ? settings.baseDotSize + settings.accentMaxExtraSize * strength
        : settings.baseDotSize,
      accent,
      word
    });

    if (trail.length > settings.maxPoints) {
      trail.splice(0, trail.length - settings.maxPoints);
    }
  }

  function rgba(rgb, alpha) {
    const a = Math.max(0, Math.min(1, alpha));
    return `rgba(${rgb}, ${a})`;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  const grayLine = "143, 143, 143";
  const grayDot = "154, 154, 154";
  const accentColor = "29,170,218";

  function render() {
    ctx.clearRect(0, 0, w, h);

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

      ctx.strokeStyle = rgba(grayLine, lineAlpha * 0.5);
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
        ctx.fillStyle = rgba(accentColor, alpha);
        ctx.fillText(p.word, p.x, p.y);
      } else {
        ctx.fillStyle = p.accent
          ? rgba(accentColor, alpha)
          : rgba(grayDot, alpha * 0.72);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.72 + alpha * 0.28), 0, Math.PI * 2);
        ctx.fill();
      }
      p.life -= 1;
    }

    while (trail.length > 0 && trail[0].life <= 0) {
      trail.shift();
    }
  }

  function tick(ts) {
    pointer.x += (pointer.targetX - pointer.x) * settings.smoothness;
    pointer.y += (pointer.targetY - pointer.y) * settings.smoothness;

    const speedT = clamp01(cursorSpeed / settings.speedForMaxSpacing);
    const spacing = lerp(settings.minTrailSpacing, settings.maxTrailSpacing, speedT);
    const idleEmitMs = lerp(settings.slowIdleEmitMs, settings.fastIdleEmitMs, speedT);
    const dx = pointer.x - lastEmitX;
    const dy = pointer.y - lastEmitY;
    const distSq = dx * dx + dy * dy;
    const shouldEmit = pointer.active && (distSq > spacing * spacing || ts - lastEmitAt > idleEmitMs);

    if (shouldEmit) {
      const accentInfo = sampleMaskAt(pointer.x, pointer.y);
      const lastPoint = trail.length ? trail[trail.length - 1] : null;

      if (accentInfo.hit && wordsActive && wordPool && wordPool.length) {
        if (lastWordX !== null && lastWordY !== null) {
          const wordDx = pointer.x - lastWordX;
          const wordDy = pointer.y - lastWordY;
          const wordDistSq = wordDx * wordDx + wordDy * wordDy;
          const wordSpacingSq = settings.wordMinSpacing * settings.wordMinSpacing;
          if (wordDistSq < wordSpacingSq) {
            accentInfo.hit = false;
            accentInfo.strength = 0;
          }
        }
      }

      if (accentInfo.hit && lastPoint && lastPoint.accent) {
        const accentDx = pointer.x - lastPoint.x;
        const accentDy = pointer.y - lastPoint.y;
        const accentSpacing = wordsActive && wordPool && wordPool.length
          ? Math.max(settings.accentMinSpacing, settings.wordMinSpacing)
          : settings.accentMinSpacing;
        const accentSpacingSq = accentSpacing * accentSpacing;
        const accentDistSq = accentDx * accentDx + accentDy * accentDy;

        if (accentDistSq < accentSpacingSq) {
          render();
          cursorSpeed *= settings.speedDecayPerFrame;
          window.requestAnimationFrame(tick);
          return;
        }
      }

      pushPoint(pointer.x, pointer.y, accentInfo);
      lastEmitX = pointer.x;
      lastEmitY = pointer.y;
      lastEmitAt = ts;
    }

    render();
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
  }

  function onPointerDown(ev) {
    const isMouse = ev.pointerType === "mouse";
    const isLeft = !isMouse || ev.button === 0;
    const allowWords = isLeft && isBackgroundTarget(ev.target);
    setWordsActive(allowWords);
    onPointerMove(ev);
    if (allowWords) {
      ev.preventDefault();
    }
  }

  function onPointerUp(ev) {
    const isMouse = ev.pointerType === "mouse";
    const isLeft = !isMouse || ev.button === 0;
    if (isLeft) {
      setWordsActive(false);
    }
  }

  function onPointerLeave() {
    pointer.active = false;
    cursorSpeed = 0;
    setWordsActive(false);
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
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
  resizeCanvas();
  window.requestAnimationFrame(tick);
})();
