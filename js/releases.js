/**
 * Releases module
 * - Loads `assets/releases.json`
 * - Renders "upcoming", "latest", and "all releases" blocks depending on page
 * - Computes a consistent side-column width based on longest link word
 */

const DEFAULT_RELEASES_URL = "assets/releases.json";
const RELEASE_FOCUS_CLASS = "release-focus-flash";
const RELEASE_FOCUS_DURATION_MS = 1200;
const RELEASE_MODE_PAST = "past";
const RELEASE_MODE_UPCOMING = "upcoming";
const RELEASE_MODE_SWITCH_THRESHOLD = 0.5;
const RELEASE_MODE_HOVER_BLEND_WIDTH = 0.07;

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
    const dateParts = parseIsoDateParts(item.date);
    if (dateParts) {
      return dateParts.year;
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

function getYearRange(items) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const yearValues = items
    .map((item) => getReleaseYear(item))
    .filter((year) => Number.isFinite(year));
  if (!yearValues.length) {
    return null;
  }
  return {
    min: Math.min(...yearValues),
    max: Math.max(...yearValues)
  };
}

function getReleaseTintValue(item) {
  const dateValue = toDateValue(item && item.date);
  if (Number.isFinite(dateValue) && dateValue > 0) {
    return dateValue;
  }
  return getReleaseYear(item);
}

function getTintRange(items) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const values = items
    .map((item) => getReleaseTintValue(item))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function applyReleaseTint(card, value, range, invert = false) {
  if (!card || !range || !Number.isFinite(value)) {
    return;
  }
  const minValue = range.min;
  const maxValue = range.max;
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return;
  }
  const span = Math.max(1, maxValue - minValue);
  let t = Math.max(0, Math.min(1, (value - minValue) / span));
  if (invert) {
    t = 1 - t;
  }
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
  return `${String(day).padStart(2, "0")} ${monthName} ${year}`;
}

function parseIsoDateParts(iso) {
  if (typeof iso !== "string") {
    return null;
  }
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const utcValue = Date.UTC(year, month - 1, day);
  const parsedDate = new Date(utcValue);
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toDateValue(iso) {
  const dateParts = parseIsoDateParts(iso);
  if (!dateParts) {
    return 0;
  }
  const { year, month, day } = dateParts;
  return Date.UTC(year, month - 1, day);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(1, number));
}

function mapHoverRatioToModeProgress(ratio) {
  const clampedRatio = clamp01(ratio);
  const bandWidth = Math.max(0.01, Math.min(1, RELEASE_MODE_HOVER_BLEND_WIDTH));
  const halfBand = bandWidth / 2;
  const bandStart = 0.5 - halfBand;
  const bandEnd = 0.5 + halfBand;

  if (clampedRatio <= bandStart) {
    return 0;
  }
  if (clampedRatio >= bandEnd) {
    return 1;
  }
  return (clampedRatio - bandStart) / bandWidth;
}

function getTodayUtcDateValue() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function getReleaseKey(item) {
  if (!item) {
    return "";
  }
  if (typeof item.releaseKey === "string" && item.releaseKey.trim()) {
    return item.releaseKey.trim();
  }
  if (Number.isFinite(item._index)) {
    return String(item._index);
  }
  return "";
}

function buildReleaseFocusHref(item) {
  const releaseKey = getReleaseKey(item);
  if (!releaseKey) {
    return "releases.html";
  }
  const params = new URLSearchParams({ focus: releaseKey });
  return `releases.html?${params.toString()}`;
}

function appendDetailText(lineEl, text) {
  const value = cleanText(text);
  if (!lineEl || !value) {
    return;
  }
  if (lineEl.childNodes.length > 0) {
    lineEl.appendChild(document.createTextNode(" | "));
  }
  lineEl.appendChild(document.createTextNode(value));
}

function appendDetailLink(lineEl, label, url) {
  const textLabel = cleanText(label);
  const href = cleanText(url);
  if (!lineEl || !textLabel || !href) {
    appendDetailText(lineEl, textLabel);
    return;
  }
  if (lineEl.childNodes.length > 0) {
    lineEl.appendChild(document.createTextNode(" | "));
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = textLabel;
  if (/^https?:\/\//i.test(href)) {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
  }
  lineEl.appendChild(anchor);
}

function createReleaseCard(item, options) {
  const opts = options || {};
  const event = cleanText(item.event);
  const workText = cleanText(item.work);
  const workHtml = cleanText(item.workHtml);
  const role = cleanText(item.role);
  const place = cleanText(item.place);
  const placeUrl = cleanText(item.placeUrl);
  const notes = cleanText(item.notes);
  const dateLabel = cleanText(item.dateLabel) || formatDateFromIso(item.date);
  const hasWork = Boolean(workHtml || workText);
  const dateValue = toDateValue(item.date);
  const todayUtcDateValue = Number.isFinite(opts.todayUtcDateValue)
    ? opts.todayUtcDateValue
    : getTodayUtcDateValue();
  const isUpcoming = dateValue >= todayUtcDateValue;

  const card = document.createElement("article");
  card.className = "work release";
  card.classList.add(isUpcoming ? "release-upcoming" : "release-past");
  if (opts.showTemporalStatus) {
    card.classList.add("release-has-status");
  }
  applyReleaseTint(
    card,
    getReleaseTintValue(item),
    opts.tintRange || opts.yearRange,
    opts.invertTint === true
  );
  const releaseKey = getReleaseKey(item);
  if (releaseKey) {
    card.dataset.releaseKey = releaseKey;
  }

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

  if (opts.showTemporalStatus) {
    const status = document.createElement("p");
    status.className = "release-status";
    status.textContent = isUpcoming ? "Upcoming" : "Past";
    meta.appendChild(status);
  }

  if (event && hasWork) {
    const eventLine = document.createElement("p");
    eventLine.className = "work-desc";
    eventLine.textContent = event;
    meta.appendChild(eventLine);
  }

  const detailLine = document.createElement("p");
  detailLine.className = "work-desc";
  appendDetailText(detailLine, dateLabel);
  appendDetailText(detailLine, role);
  const wrapsWholeCardAsLink = typeof opts.cardHref === "string" && opts.cardHref && opts.showLinks === false;
  if (placeUrl && !wrapsWholeCardAsLink) {
    appendDetailLink(detailLine, place, placeUrl);
  } else {
    appendDetailText(detailLine, place);
  }
  if (detailLine.childNodes.length > 0) {
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
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
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
    } else {
      grid.classList.add("release-grid-spacer");
    }
  } else if (allowLinks) {
    grid.classList.add("release-grid-spacer");
  } else {
    grid.classList.add("release-grid-full");
  }

  card.appendChild(grid);
  if (typeof opts.cardHref === "string" && opts.cardHref && !allowLinks) {
    const cardLink = document.createElement("a");
    cardLink.className = "release-card-link";
    cardLink.href = opts.cardHref;
    cardLink.setAttribute("aria-label", cleanText(opts.cardAriaLabel) || "Open release");
    cardLink.appendChild(card);
    return cardLink;
  }

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
    const cardOptions = { ...(options || {}) };
    if (typeof cardOptions.cardHref === "function") {
      cardOptions.cardHref = cardOptions.cardHref(items[i]);
    }
    if (typeof cardOptions.cardAriaLabel === "function") {
      cardOptions.cardAriaLabel = cardOptions.cardAriaLabel(items[i]);
    }
    target.appendChild(createReleaseCard(items[i], cardOptions));
    count += 1;
  }

  if (!count) {
    const empty = document.createElement("p");
    empty.className = "work-desc";
    empty.textContent = cleanText(options && options.emptyText) || "No releases yet.";
    target.appendChild(empty);
  }
}

function applyFocusFromQuery(searchRoot, setMode) {
  if (!searchRoot) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const focusKey = cleanText(params.get("focus"));
  if (!focusKey) {
    return;
  }

  const focusCard = Array.from(searchRoot.querySelectorAll("[data-release-key]"))
    .find((element) => element.dataset.releaseKey === focusKey);
  if (!focusCard) {
    return;
  }

  const hostPanel = focusCard.closest(".release-panel[data-release-mode]");
  if (hostPanel && typeof setMode === "function") {
    setMode(hostPanel.dataset.releaseMode);
  }

  window.requestAnimationFrame(() => {
    focusCard.classList.add(RELEASE_FOCUS_CLASS);
    focusCard.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    window.setTimeout(() => {
      focusCard.classList.remove(RELEASE_FOCUS_CLASS);
    }, RELEASE_FOCUS_DURATION_MS);
  });
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
    label.split(/\s+/).forEach((word) => {
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

function initReleaseModeControl(modeControlEl, modeStageEl, initialMode) {
  const safeInitial = initialMode === RELEASE_MODE_UPCOMING ? RELEASE_MODE_UPCOMING : RELEASE_MODE_PAST;
  if (!modeControlEl || !modeStageEl) {
    return {
      setMode: () => {},
      getMode: () => safeInitial
    };
  }

  const slider = modeControlEl.querySelector(".release-mode-slider");
  const panels = Array.from(modeStageEl.querySelectorAll(".release-panel[data-release-mode]"));
  let mode = safeInitial;
  let progress = safeInitial === RELEASE_MODE_UPCOMING ? 1 : 0;

  const setPanelInteractivity = (activeMode) => {
    panels.forEach((panel) => {
      const isActive = panel.dataset.releaseMode === activeMode;
      panel.hidden = false;
      panel.classList.toggle("is-interactive", isActive);
      panel.setAttribute("aria-hidden", String(!isActive));
    });
  };

  const applyProgress = (nextProgress, options = {}) => {
    progress = clamp01(nextProgress);
    const nextMode = progress >= RELEASE_MODE_SWITCH_THRESHOLD ? RELEASE_MODE_UPCOMING : RELEASE_MODE_PAST;
    mode = nextMode;
    modeControlEl.dataset.mode = nextMode;
    modeControlEl.style.setProperty("--release-mode-progress", progress.toFixed(3));
    modeStageEl.style.setProperty("--release-mode-progress", progress.toFixed(3));
    setPanelInteractivity(nextMode);
    if (slider && options.syncSlider !== false) {
      slider.value = progress.toFixed(2);
    }
  };

  const applyMode = (nextMode) => {
    const normalized = nextMode === RELEASE_MODE_UPCOMING ? RELEASE_MODE_UPCOMING : RELEASE_MODE_PAST;
    applyProgress(normalized === RELEASE_MODE_UPCOMING ? 1 : 0);
  };

  if (slider) {
    slider.addEventListener("input", () => {
      applyProgress(slider.value, { syncSlider: false });
    });
  }

  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    modeStageEl.classList.add("release-mode-stage-hover");
    modeStageEl.addEventListener("pointermove", (event) => {
      if (event.pointerType && event.pointerType !== "mouse") {
        return;
      }
      const rect = modeStageEl.getBoundingClientRect();
      if (rect.width <= 1) {
        return;
      }
      const ratio = (event.clientX - rect.left) / rect.width;
      applyProgress(mapHoverRatioToModeProgress(ratio));
    });
  }

  applyMode(safeInitial);
  return {
    setMode: applyMode,
    getMode: () => mode
  };
}

async function loadReleases({
  releasesUrl,
  upcomingReleasesEl,
  latestReleasesEl,
  allReleasesEl,
  fullPastReleasesEl,
  fullUpcomingReleasesEl,
  modeControlEl,
  modeStageEl
}) {
  if (
    !upcomingReleasesEl
    && !latestReleasesEl
    && !allReleasesEl
    && !fullPastReleasesEl
    && !fullUpcomingReleasesEl
  ) {
    return;
  }

  let modeControl = null;
  let focusSearchRoot = allReleasesEl || modeStageEl || fullPastReleasesEl || fullUpcomingReleasesEl;

  try {
    const resp = await fetch(releasesUrl, { cache: "no-store" });
    const text = resp.ok ? await resp.text() : "";
    const cleaned = text.replace(/^\uFEFF/, "");
    const items = cleaned ? JSON.parse(cleaned) : [];

    if (!Array.isArray(items)) {
      return;
    }

    const indexed = items.map((item, index) => ({
      ...item,
      _index: index,
      releaseKey: String(index)
    }));
    indexed.sort((a, b) => {
      const diff = toDateValue(b.date) - toDateValue(a.date);
      return diff !== 0 ? diff : a._index - b._index;
    });
    const todayUtc = getTodayUtcDateValue();
    const upcoming = indexed
      .filter((item) => toDateValue(item.date) >= todayUtc)
      .sort((a, b) => {
        const diff = toDateValue(a.date) - toDateValue(b.date);
        return diff !== 0 ? diff : a._index - b._index;
      });
    const latest = indexed.filter((item) => toDateValue(item.date) < todayUtc);
    const past = latest;

    const yearRange = getYearRange(indexed);
    const tintRange = getTintRange(indexed);
    const pastYearRange = getYearRange(past);
    const pastTintRange = getTintRange(past);
    const upcomingYearRange = getYearRange(upcoming);
    const upcomingTintRange = getTintRange(upcoming);

    if (upcomingReleasesEl) {
      renderReleases(upcomingReleasesEl, upcoming, {
        limit: 3,
        showLinks: false,
        showNotes: false,
        yearRange: upcomingYearRange,
        tintRange: upcomingTintRange,
        invertTint: true,
        emptyText: "No upcoming events yet.",
        cardHref: buildReleaseFocusHref,
        cardAriaLabel: (item) => {
          const label = cleanText(item.event) || cleanText(item.work) || "release";
          return `Open ${label} in all releases`;
        }
      });
    }
    if (latestReleasesEl) {
      renderReleases(latestReleasesEl, latest, {
        limit: 3,
        showLinks: false,
        showNotes: false,
        yearRange: pastYearRange,
        tintRange: pastTintRange,
        cardHref: buildReleaseFocusHref,
        cardAriaLabel: (item) => {
          const label = cleanText(item.event) || cleanText(item.work) || "release";
          return `Open ${label} in all releases`;
        }
      });
    }
    if (fullPastReleasesEl) {
      renderReleases(fullPastReleasesEl, past, {
        showLinks: true,
        showNotes: true,
        yearRange: pastYearRange,
        tintRange: pastTintRange,
        emptyText: "No past releases yet."
      });
    }
    if (fullUpcomingReleasesEl) {
      renderReleases(fullUpcomingReleasesEl, upcoming, {
        showLinks: true,
        showNotes: true,
        yearRange: upcomingYearRange,
        tintRange: upcomingTintRange,
        invertTint: true,
        emptyText: "No upcoming events yet."
      });
    }
    if (allReleasesEl && !fullPastReleasesEl && !fullUpcomingReleasesEl) {
      renderReleases(allReleasesEl, indexed, {
        showLinks: true,
        showNotes: true,
        yearRange,
        tintRange
      });
    }

    if (modeControlEl && modeStageEl && fullPastReleasesEl && fullUpcomingReleasesEl) {
      modeControl = initReleaseModeControl(modeControlEl, modeStageEl, RELEASE_MODE_PAST);
      focusSearchRoot = modeStageEl;
    }
  } catch (_err) {
    if (upcomingReleasesEl) {
      renderReleases(upcomingReleasesEl, [], {
        limit: 0,
        emptyText: "No upcoming events yet."
      });
    }
    if (latestReleasesEl) {
      renderReleases(latestReleasesEl, [], { limit: 0 });
    }
    if (fullPastReleasesEl) {
      renderReleases(fullPastReleasesEl, [], {
        limit: 0,
        emptyText: "No past releases yet."
      });
    }
    if (fullUpcomingReleasesEl) {
      renderReleases(fullUpcomingReleasesEl, [], {
        limit: 0,
        emptyText: "No upcoming events yet."
      });
    }
    if (allReleasesEl) {
      renderReleases(allReleasesEl, [], { limit: 0 });
    }

    if (modeControlEl && modeStageEl && fullPastReleasesEl && fullUpcomingReleasesEl) {
      modeControl = initReleaseModeControl(modeControlEl, modeStageEl, RELEASE_MODE_PAST);
      focusSearchRoot = modeStageEl;
    }
  }

  window.requestAnimationFrame(() => {
    syncReleaseColumnWidth();
    applyFocusFromQuery(focusSearchRoot, modeControl ? modeControl.setMode : null);
  });
}

/**
 * Entry point for releases rendering.
 * Safe to call on pages that only have one of the containers.
 */
export function initReleases({
  releasesUrl = DEFAULT_RELEASES_URL,
  upcomingContainerId = "upcoming-releases",
  latestContainerId = "latest-releases",
  allContainerId = "all-releases",
  fullPastContainerId = "past-releases",
  fullUpcomingContainerId = "upcoming-releases-full",
  modeControlId = "release-mode-control",
  modeStageId = "release-mode-stage"
} = {}) {
  const upcomingReleasesEl = document.getElementById(upcomingContainerId);
  const latestReleasesEl = document.getElementById(latestContainerId);
  const allReleasesEl = document.getElementById(allContainerId);
  const fullPastReleasesEl = document.getElementById(fullPastContainerId);
  const fullUpcomingReleasesEl = document.getElementById(fullUpcomingContainerId);
  const modeControlEl = document.getElementById(modeControlId);
  const modeStageEl = document.getElementById(modeStageId);

  if (
    !upcomingReleasesEl
    && !latestReleasesEl
    && !allReleasesEl
    && !fullPastReleasesEl
    && !fullUpcomingReleasesEl
  ) {
    return;
  }

  loadReleases({
    releasesUrl,
    upcomingReleasesEl,
    latestReleasesEl,
    allReleasesEl,
    fullPastReleasesEl,
    fullUpcomingReleasesEl,
    modeControlEl,
    modeStageEl
  });
  window.addEventListener("resize", syncReleaseColumnWidth);
}
