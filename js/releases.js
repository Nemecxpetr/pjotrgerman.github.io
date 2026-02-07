/**
 * Releases module
 * - Loads `assets/releases.json`
 * - Renders "latest" and "all releases" blocks depending on page
 * - Computes a consistent side-column width based on longest link word
 */

const DEFAULT_RELEASES_URL = "assets/releases.json";

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
  return `${String(day).padStart(2, "0")} ${monthName} ${year}`;
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
    detailLine.textContent = detailParts.join(" | ");
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
      grid.classList.add("release-grid-full");
    }
  } else {
    grid.classList.add("release-grid-full");
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
    target.appendChild(createReleaseCard(items[i], options));
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

async function loadReleases(releasesUrl, latestReleasesEl, allReleasesEl) {
  if (!latestReleasesEl && !allReleasesEl) {
    return;
  }

  try {
    const resp = await fetch(releasesUrl, { cache: "no-store" });
    const text = resp.ok ? await resp.text() : "";
    const cleaned = text.replace(/^\uFEFF/, "");
    const items = cleaned ? JSON.parse(cleaned) : [];

    if (!Array.isArray(items)) {
      return;
    }

    const indexed = items.map((item, index) => ({ ...item, _index: index }));
    indexed.sort((a, b) => {
      const diff = toDateValue(b.date) - toDateValue(a.date);
      return diff !== 0 ? diff : a._index - b._index;
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
  } catch (_err) {
    if (latestReleasesEl) {
      renderReleases(latestReleasesEl, [], { limit: 0 });
    }
    if (allReleasesEl) {
      renderReleases(allReleasesEl, [], { limit: 0 });
    }
  }

  window.requestAnimationFrame(syncReleaseColumnWidth);
}

/**
 * Entry point for releases rendering.
 * Safe to call on pages that only have one of the containers.
 */
export function initReleases({
  releasesUrl = DEFAULT_RELEASES_URL,
  latestContainerId = "latest-releases",
  allContainerId = "all-releases"
} = {}) {
  const latestReleasesEl = document.getElementById(latestContainerId);
  const allReleasesEl = document.getElementById(allContainerId);

  if (!latestReleasesEl && !allReleasesEl) {
    return;
  }

  loadReleases(releasesUrl, latestReleasesEl, allReleasesEl);
  window.addEventListener("resize", syncReleaseColumnWidth);
}
