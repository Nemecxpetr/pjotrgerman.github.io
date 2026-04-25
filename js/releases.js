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
const PRINT_PAGE_HEIGHT_MM = 285;
const PRINT_PAGE_FIT_SAFETY_PX = 12;
const RELEASE_ROLE_COLORS = {
  "composer": "#FFFFFF",
  "performer": "#373737",
  "sound-artist": "#d7afea",
  "installation-artist": "#ad91ba",
  "sound-designer": "#8d6a70",
  "live-electronics": "#d78c8c",
  "improviser": "#95b795",
  "lecturer": "#c996ff",
  "researcher": "#9cceff",
  "collaborator": "#d39464",
  "release-artist": "#ffde84",
  "maker": "#e0c9e5"
};

const releaseRuntimeState = {
  latestItems: [],
  latestOptions: null,
  latestReleasesEl: null,
  latestSectionEl: null,
  printListenersBound: false,
  printMediaQueryList: null,
  fitTimerId: null
};

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

function getReleaseTintRatio(value, range, invert = false) {
  if (!range || !Number.isFinite(value)) {
    return null;
  }
  const minValue = range.min;
  const maxValue = range.max;
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return null;
  }
  const span = Math.max(1, maxValue - minValue);
  let t = Math.max(0, Math.min(1, (value - minValue) / span));
  if (invert) {
    t = 1 - t;
  }
  return t;
}

function applyReleaseTint(card, value, range, invert = false) {
  if (!card) {
    return null;
  }
  const t = getReleaseTintRatio(value, range, invert);
  if (t === null) {
    return null;
  }
  const darkAlpha = 0.08 * (1 - t);
  const lightAlpha = 0.12 * t;
  card.style.setProperty("--release-dark", darkAlpha.toFixed(3));
  card.style.setProperty("--release-light", lightAlpha.toFixed(3));
  return t;
}

function normalizeReleaseRole(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function getArtistRoles(item) {
  if (!item) {
    return [];
  }
  const rawRoles = Array.isArray(item.artistRoles)
    ? item.artistRoles
    : typeof item.artistRoles === "string"
      ? item.artistRoles.split(",")
      : [];

  return rawRoles
    .map(normalizeReleaseRole)
    .filter(Boolean);
}

function parseHexColor(hex) {
  const match = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  };
}

function toHexChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function rgbToHex(color) {
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}`;
}

function darkenColorByRatio(hex, ratio) {
  const color = parseHexColor(hex);
  if (!color) {
    return hex;
  }
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 1;
  const factor = 0.58 + (0.42 * safeRatio);
  return rgbToHex({
    r: color.r * factor,
    g: color.g * factor,
    b: color.b * factor
  });
}

function multiplyRoleColors(roles) {
  const colors = roles
    .map((role) => parseHexColor(RELEASE_ROLE_COLORS[role]))
    .filter(Boolean);

  if (!colors.length) {
    return "";
  }

  const multiplied = colors.reduce(
    (acc, color) => ({
      r: (acc.r * color.r) / 255,
      g: (acc.g * color.g) / 255,
      b: (acc.b * color.b) / 255
    }),
    { r: 255, g: 255, b: 255 }
  );

  return rgbToHex(multiplied);
}

function applyReleaseRoleColor(card, roles, tintRatio) {
  const baseColor = multiplyRoleColors(roles);
  const color = darkenColorByRatio(baseColor, tintRatio);
  if (!card || !color) {
    return;
  }
  card.classList.add("release-has-roles");
  card.style.setProperty("--release-role-color", color);
  card.dataset.releaseRoles = roles.join(" ");
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

function formatDateRange(item) {
  if (!item) {
    return "";
  }
  const label = cleanText(item.dateLabel);
  if (label) {
    return label;
  }
  const start = formatDateFromIso(item.date);
  const end = formatDateFromIso(item.dateEnd);
  if (start && end && start !== end) {
    return `${start} - ${end}`;
  }
  return start || end;
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

function mmToPx(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return (value * 96) / 25.4;
}

function isPrintModeActive() {
  const params = new URLSearchParams(window.location.search);
  const printFlag = String(params.get("print") || "").trim().toLowerCase();
  return (
    printFlag === "1"
    || printFlag === "true"
    || printFlag === "yes"
    || document.documentElement.classList.contains("print-mode")
  );
}

function getTodayUtcDateValue() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function getReleaseTemporalMode(item, todayUtcDateValue = getTodayUtcDateValue()) {
  const status = (cleanText(item && item.status) || cleanText(item && item.temporalStatus)).toLowerCase();
  if (status === RELEASE_MODE_PAST || status === RELEASE_MODE_UPCOMING) {
    return status;
  }
  const dateValue = toDateValue(item && item.date);
  return dateValue >= todayUtcDateValue ? RELEASE_MODE_UPCOMING : RELEASE_MODE_PAST;
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

function getLocationText(item) {
  if (!item) {
    return "";
  }
  const venue = cleanText(item.venue) || cleanText(item.place);
  const city = cleanText(item.city);
  const country = cleanText(item.country);
  return [venue, city, country].filter(Boolean).join(", ");
}

function normalizeReleaseLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }
  const label = cleanText(link.label);
  const url = cleanText(link.url);
  if (!label || !url) {
    return null;
  }
  return {
    label,
    url,
    platform: cleanText(link.platform)
  };
}

function getPrimaryReleaseLink(item) {
  if (!item || !item.links) {
    return null;
  }
  if (Array.isArray(item.links)) {
    return normalizeReleaseLink(item.links[0]);
  }
  return normalizeReleaseLink(item.links.primary)
    || normalizeReleaseLink(item.links.portfolio)
    || normalizeReleaseLink(item.links.venue);
}

function getSecondaryReleaseLinks(item, primaryLink) {
  if (!item || !item.links) {
    return [];
  }
  const sourceLinks = Array.isArray(item.links)
    ? item.links.slice(1)
    : Array.isArray(item.links.secondary)
      ? item.links.secondary
      : [
        ...(Array.isArray(item.links.documentation) ? item.links.documentation : []),
        item.links.portfolio,
        item.links.venue
      ];
  const primaryUrl = primaryLink ? primaryLink.url : "";
  const seen = new Set(primaryUrl ? [primaryUrl] : []);
  return sourceLinks
    .map(normalizeReleaseLink)
    .filter(Boolean)
    .filter((link) => {
      if (seen.has(link.url)) {
        return false;
      }
      seen.add(link.url);
      return true;
    });
}

function formatCollaborators(collaborators) {
  if (!Array.isArray(collaborators) || !collaborators.length) {
    return "";
  }
  const names = collaborators
    .map((collaborator) => {
      if (typeof collaborator === "string") {
        return cleanText(collaborator);
      }
      if (!collaborator || typeof collaborator !== "object") {
        return "";
      }
      const name = cleanText(collaborator.name);
      const role = cleanText(collaborator.role);
      if (!name) {
        return "";
      }
      return role ? `${name} (${role})` : name;
    })
    .filter(Boolean);
  return names.join(", ");
}

function createReleaseCard(item, options) {
  const opts = options || {};
  const titleText = cleanText(item.title) || cleanText(item.work);
  const event = cleanText(item.event);
  const workText = titleText;
  const workHtml = cleanText(item.workHtml);
  const format = cleanText(item.format) || cleanText(item.type);
  const place = getLocationText(item);
  const placeUrl = cleanText(item.placeUrl);
  const artistRoles = getArtistRoles(item);
  const collaborators = formatCollaborators(item.collaborators);
  const notes = cleanText(item.context) || cleanText(item.notes);
  const dateLabel = formatDateRange(item);
  const hasWork = Boolean(workHtml || titleText);
  const todayUtcDateValue = Number.isFinite(opts.todayUtcDateValue)
    ? opts.todayUtcDateValue
    : getTodayUtcDateValue();
  const releaseMode = getReleaseTemporalMode(item, todayUtcDateValue);
  const isUpcoming = releaseMode === RELEASE_MODE_UPCOMING;

  const card = document.createElement("article");
  card.className = "work release";
  card.classList.add(isUpcoming ? "release-upcoming" : "release-past");
  if (opts.showTemporalStatus) {
    card.classList.add("release-has-status");
  }
  const tintRatio = applyReleaseTint(
    card,
    getReleaseTintValue(item),
    opts.tintRange || opts.yearRange,
    opts.invertTint === true
  );
  applyReleaseRoleColor(card, artistRoles, tintRatio);
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
  appendDetailText(detailLine, format);
  const wrapsWholeCardAsLink = typeof opts.cardHref === "string" && opts.cardHref && opts.showLinks === false;
  if (placeUrl && !wrapsWholeCardAsLink) {
    appendDetailLink(detailLine, place, placeUrl);
  } else {
    appendDetailText(detailLine, place);
  }
  if (detailLine.childNodes.length > 0) {
    meta.appendChild(detailLine);
  }

  if (collaborators) {
    const collaboratorLine = document.createElement("p");
    collaboratorLine.className = "work-desc release-collaborators";
    collaboratorLine.textContent = `With ${collaborators}`;
    meta.appendChild(collaboratorLine);
  }

  if (notes && opts.showNotes !== false) {
    const notesLine = document.createElement("p");
    notesLine.className = "work-desc";
    notesLine.textContent = notes;
    meta.appendChild(notesLine);
  }

  grid.appendChild(meta);

  const allowLinks = opts.showLinks !== false;
  if (allowLinks) {
    const primary = getPrimaryReleaseLink(item);
    const secondaryLinks = getSecondaryReleaseLinks(item, primary);

    if (primary || secondaryLinks.length) {
      const actions = document.createElement("div");
      actions.className = "release-actions";

      if (primary) {
        const primaryAction = document.createElement("a");
        primaryAction.className = "release-primary-action";
        primaryAction.href = primary.url;
        primaryAction.textContent = primary.label;
        if (/^https?:\/\//i.test(primary.url)) {
          primaryAction.target = "_blank";
          primaryAction.rel = "noreferrer";
        }
        actions.appendChild(primaryAction);
      }

      secondaryLinks.forEach((link) => {
        const anchor = document.createElement("a");
        anchor.className = "release-secondary-action";
        anchor.href = link.url;
        anchor.textContent = link.label;
        if (/^https?:\/\//i.test(link.url)) {
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
        }
        actions.appendChild(anchor);
      });

      meta.appendChild(actions);
    }
  }

  grid.classList.add("release-grid-full");
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

function fitLatestReleasesForPrint() {
  const latestSectionEl = releaseRuntimeState.latestSectionEl;
  const latestReleasesEl = releaseRuntimeState.latestReleasesEl;
  if (!latestSectionEl || !latestReleasesEl || !isPrintModeActive()) {
    return;
  }

  const itemEls = Array.from(latestReleasesEl.children);
  if (!itemEls.length) {
    return;
  }

  for (const itemEl of itemEls) {
    itemEl.hidden = false;
    itemEl.style.display = "";
  }

  const pageHeightPx = mmToPx(PRINT_PAGE_HEIGHT_MM);
  if (pageHeightPx <= 0) {
    return;
  }

  const sectionRect = latestSectionEl.getBoundingClientRect();
  const sectionTop = sectionRect.top + window.scrollY;
  const pageIndex = Math.floor(Math.max(0, sectionTop) / pageHeightPx);
  const pageBottom = ((pageIndex + 1) * pageHeightPx) - PRINT_PAGE_FIT_SAFETY_PX;

  let overflowStarted = false;
  for (const itemEl of itemEls) {
    if (overflowStarted) {
      itemEl.hidden = true;
      itemEl.style.display = "none";
      continue;
    }

    const rect = itemEl.getBoundingClientRect();
    const itemBottom = rect.bottom + window.scrollY;
    if (itemBottom > pageBottom) {
      itemEl.hidden = true;
      itemEl.style.display = "none";
      overflowStarted = true;
    }
  }
}

function scheduleLatestReleasesPrintFit() {
  if (releaseRuntimeState.fitTimerId !== null) {
    window.clearTimeout(releaseRuntimeState.fitTimerId);
    releaseRuntimeState.fitTimerId = null;
  }

  window.requestAnimationFrame(() => {
    fitLatestReleasesForPrint();
    releaseRuntimeState.fitTimerId = window.setTimeout(() => {
      releaseRuntimeState.fitTimerId = null;
      fitLatestReleasesForPrint();
    }, 120);
  });
}

function renderLatestReleasesForCurrentMode() {
  if (!releaseRuntimeState.latestReleasesEl || !releaseRuntimeState.latestOptions) {
    return;
  }

  const limit = isPrintModeActive()
    ? releaseRuntimeState.latestItems.length
    : 3;

  renderReleases(
    releaseRuntimeState.latestReleasesEl,
    releaseRuntimeState.latestItems,
    {
      ...releaseRuntimeState.latestOptions,
      limit
    }
  );

  if (isPrintModeActive()) {
    scheduleLatestReleasesPrintFit();
  }
}

function ensureLatestReleasesPrintLifecycle() {
  if (releaseRuntimeState.printListenersBound) {
    return;
  }

  const rerenderForPrintState = () => {
    renderLatestReleasesForCurrentMode();
  };

  window.addEventListener("beforeprint", rerenderForPrintState);
  window.addEventListener("afterprint", rerenderForPrintState);
  window.addEventListener("resize", () => {
    if (isPrintModeActive()) {
      scheduleLatestReleasesPrintFit();
    }
  }, { passive: true });

  if (typeof window.matchMedia === "function") {
    releaseRuntimeState.printMediaQueryList = window.matchMedia("print");
    const onPrintQueryChange = () => {
      rerenderForPrintState();
    };
    if (typeof releaseRuntimeState.printMediaQueryList.addEventListener === "function") {
      releaseRuntimeState.printMediaQueryList.addEventListener("change", onPrintQueryChange);
    } else if (typeof releaseRuntimeState.printMediaQueryList.addListener === "function") {
      releaseRuntimeState.printMediaQueryList.addListener(onPrintQueryChange);
    }
  }

  releaseRuntimeState.printListenersBound = true;
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
      .filter((item) => getReleaseTemporalMode(item, todayUtc) === RELEASE_MODE_UPCOMING)
      .sort((a, b) => {
        const diff = toDateValue(a.date) - toDateValue(b.date);
        return diff !== 0 ? diff : a._index - b._index;
      });
    const latest = indexed.filter((item) => getReleaseTemporalMode(item, todayUtc) === RELEASE_MODE_PAST);
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
          const label = cleanText(item.title) || cleanText(item.event) || cleanText(item.work) || "release";
          return `Open ${label} in all releases`;
        }
      });
    }
    if (latestReleasesEl) {
      const latestOptions = {
        showLinks: false,
        showNotes: false,
        yearRange: pastYearRange,
        tintRange: pastTintRange,
        cardHref: buildReleaseFocusHref,
        cardAriaLabel: (item) => {
          const label = cleanText(item.title) || cleanText(item.event) || cleanText(item.work) || "release";
          return `Open ${label} in all releases`;
        }
      };
      releaseRuntimeState.latestItems = latest;
      releaseRuntimeState.latestOptions = latestOptions;
      releaseRuntimeState.latestReleasesEl = latestReleasesEl;
      releaseRuntimeState.latestSectionEl = latestReleasesEl.closest("#releases");
      renderLatestReleasesForCurrentMode();
      ensureLatestReleasesPrintLifecycle();
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
      releaseRuntimeState.latestItems = [];
      releaseRuntimeState.latestOptions = {};
      releaseRuntimeState.latestReleasesEl = latestReleasesEl;
      releaseRuntimeState.latestSectionEl = latestReleasesEl.closest("#releases");
      renderLatestReleasesForCurrentMode();
      ensureLatestReleasesPrintLifecycle();
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
    if (isPrintModeActive()) {
      scheduleLatestReleasesPrintFit();
    }
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
}
