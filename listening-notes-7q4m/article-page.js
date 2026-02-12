(function () {
  const DEFAULT_ARTICLE = "czech-scene-sound";
  const activeClass = "active";
  const pageBaseUrl = getPageBaseUrl();

  const articleKey = new URLSearchParams(window.location.search).get("article") || DEFAULT_ARTICLE;

  const titleEl = document.getElementById("article-title");
  const subtitleEl = document.getElementById("article-subtitle");
  const articlePane = document.getElementById("article-pane");
  const articleContent = document.getElementById("article-content");
  const mapContainer = document.getElementById("mind-map");

  let network = null;
  let nodesDataSet = null;
  let sectionByNodeId = new Map();
  let nodeBySectionId = new Map();
  let nodeBaseSizeById = new Map();
  let sectionEls = [];
  let edgeDataSet = null;
  let edgeIdByPairKey = new Map();
  let highlightedEdgeIds = new Set();
  let selectedSectionId = null;
  let mapIsInteracting = false;
  let mapZoomIdleTimer = null;
  let pulsingNodeId = null;
  let pulseFrameId = null;
  let pulsePhase = 0;
  const theme = readThemeValues();

  init().catch((error) => {
    articleContent.innerHTML = `<p class="error">Failed to load "${articleKey}". ${escapeHtml(error.message)}</p>`;
  });

  async function init() {
    const [mapConfig, articleHtml] = await Promise.all([
      readJson(resolvePagePath(`content/${articleKey}.map.json`)),
      readText(resolvePagePath(`content/${articleKey}.html`))
    ]);

    renderMeta(mapConfig.meta || {});
    articleContent.innerHTML = articleHtml;

    sectionEls = [...articleContent.querySelectorAll("section[id]")];
    sectionEls.forEach((section) => {
      section.classList.add("article-section");
    });

    installMap(mapConfig);
    installTextPathHover();
    restoreHash();
  }

  function renderMeta(meta) {
    titleEl.textContent = meta.title || "Untitled Listening Notes";
    subtitleEl.textContent = [meta.subtitle, meta.author, meta.updated].filter(Boolean).join(" / ");

    const existingMeta = articleContent.querySelector(".article-meta");
    if (existingMeta) {
      existingMeta.remove();
    }

    const metaBlock = document.createElement("div");
    metaBlock.className = "article-meta";
    metaBlock.innerHTML = `<p>Article: ${escapeHtml(titleEl.textContent)}</p>`;
    articleContent.prepend(metaBlock);
  }

  function installMap(mapConfig) {
    if (!window.vis || !Array.isArray(mapConfig.nodes)) {
      throw new Error("Map library or node data missing.");
    }

    nodeBaseSizeById = new Map();
    const maxImportanceLevel = getMaxImportanceLevel(mapConfig.nodes);
    const nodes = mapConfig.nodes.map((node) => {
      const sectionId = String(node.section || "");
      sectionByNodeId.set(node.id, sectionId);
      nodeBySectionId.set(sectionId, node.id);
      const level = getNodeImportanceLevel(node);
      const importanceStyle = buildImportanceStyle(level, maxImportanceLevel);
      const baseSize = Math.max(6, (node.size || 17) + importanceStyle.sizeDelta);

      nodeBaseSizeById.set(node.id, baseSize);
      return {
        ...node,
        shape: node.shape || "dot",
        font: {
          face: "IBM Plex Mono",
          size: node.fontSize || 18,
          color: theme.nodeFont
        },
        color: node.color || importanceStyle.color,
        borderWidth: node.borderWidth || importanceStyle.borderWidth,
        size: baseSize
      };
    });

    const edges = buildMapEdges(mapConfig.edges);
    edgeDataSet = new vis.DataSet(edges);

    nodesDataSet = new vis.DataSet(nodes);
    const visData = {
      nodes: nodesDataSet,
      edges: edgeDataSet
    };

    network = new vis.Network(mapContainer, visData, {
      autoResize: true,
      interaction: {
        hover: true,
        dragNodes: true,
        dragView: true,
        zoomView: true
      },
      layout: {
        improvedLayout: true
      },
      physics: {
        enabled: true,
        solver: "forceAtlas2Based",
        forceAtlas2Based: {
          springLength: 110,
          springConstant: 0.032
        },
        stabilization: {
          iterations: 260,
          fit: true
        }
      },
      nodes: {
        shape: "dot"
      },
      edges: {
        color: {
          color: theme.edge,
          highlight: theme.edgeHighlight
        },
        width: 1.25,
        smooth: {
          type: "dynamic"
        }
      }
    });

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
    });

    network.on("dragStart", () => {
      mapIsInteracting = true;
    });

    network.on("dragEnd", () => {
      mapIsInteracting = false;
    });

    network.on("zoom", () => {
      mapIsInteracting = true;
      if (mapZoomIdleTimer) {
        window.clearTimeout(mapZoomIdleTimer);
      }
      mapZoomIdleTimer = window.setTimeout(() => {
        mapIsInteracting = false;
      }, 140);
    });

    network.on("click", (params) => {
      const nodeId = params.nodes[0];
      if (!nodeId) {
        return;
      }
      const sectionId = sectionByNodeId.get(nodeId);
      if (sectionId) {
        scrollToSection(sectionId);
      }
    });
  }

  function scrollToSection(sectionId) {
    const target = articleContent.querySelector(`#${cssEscape(sectionId)}`);
    if (!target) {
      return;
    }

    selectSection(sectionId, true);
    syncSelectedNode(sectionId, false);
    articlePane.scrollTo({ top: 0, behavior: "smooth" });
    window.history.replaceState(null, "", `#${sectionId}`);
  }

  function selectSection(sectionId, force) {
    if (!force && selectedSectionId === sectionId) {
      return;
    }

    selectedSectionId = sectionId;
    setHighlightedEdges([]);

    for (const section of sectionEls) {
      const isActive = section.id === sectionId;
      section.classList.toggle(activeClass, isActive);
      section.classList.toggle("is-hidden", !isActive);
      section.hidden = !isActive;
    }
  }

  function syncSelectedNode(sectionId, shouldFocus) {
    if (!network) {
      return;
    }
    const nodeId = nodeBySectionId.get(sectionId);
    if (!nodeId) {
      return;
    }
    network.selectNodes([nodeId], false);
    setPulsingNode(nodeId);
    if (!shouldFocus || mapIsInteracting) {
      return;
    }
    network.focus(nodeId, {
      scale: 1.02,
      animation: { duration: 220, easingFunction: "easeInOutQuad" }
    });
  }

  function restoreHash() {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
    if (!hash) {
      const firstSection = sectionEls[0];
      if (firstSection) {
        selectSection(firstSection.id, true);
        syncSelectedNode(firstSection.id, false);
      }
      return;
    }

    const exists = articleContent.querySelector(`#${cssEscape(hash)}`);
    if (exists) {
      scrollToSection(hash);
      return;
    }

    const fallbackSection = sectionEls[0];
    if (fallbackSection) {
      selectSection(fallbackSection.id, true);
      syncSelectedNode(fallbackSection.id, false);
    }
  }

  function buildMapEdges(rawEdges) {
    edgeIdByPairKey = new Map();
    if (!Array.isArray(rawEdges)) {
      return [];
    }

    return rawEdges.map((edge, index) => {
      const normalized = {
        ...edge,
        id: edge.id || `edge-${index}-${edge.from}-${edge.to}`
      };

      const from = String(normalized.from);
      const to = String(normalized.to);
      edgeIdByPairKey.set(`${from}->${to}`, normalized.id);
      edgeIdByPairKey.set(`${to}->${from}`, normalized.id);
      return normalized;
    });
  }

  function installTextPathHover() {
    const markers = [...articleContent.querySelectorAll("[data-graph-path]")];
    markers.forEach((marker) => {
      marker.classList.add("graph-mention");
      const pathSpec = marker.dataset.graphPath || "";
      const edgeIds = resolveEdgeIdsForMarker(pathSpec);
      const nodeIds = resolveNodeIdsForPath(pathSpec);
      if (!edgeIds.length) {
        return;
      }

      const onEnter = () => {
        marker.classList.add("is-active");
        setHighlightedEdges(edgeIds);
        centerGraphOnNodes(nodeIds);
      };
      const onLeave = () => {
        marker.classList.remove("is-active");
        setHighlightedEdges([]);
      };

      marker.addEventListener("mouseenter", onEnter);
      marker.addEventListener("mouseleave", onLeave);
      marker.addEventListener("focus", onEnter);
      marker.addEventListener("blur", onLeave);
    });
  }

  function resolveEdgeIdsForMarker(pathSpec) {
    if (!pathSpec) {
      return [];
    }

    const ids = new Set();
    const fragments = pathSpec
      .split(/[;,]+/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);

    for (const fragment of fragments) {
      const chain = fragment
        .replaceAll("->", ">")
        .split(">")
        .map((nodeId) => nodeId.trim())
        .filter(Boolean);

      if (chain.length < 2) {
        continue;
      }

      for (let i = 0; i < chain.length - 1; i += 1) {
        const key = `${chain[i]}->${chain[i + 1]}`;
        const edgeId = edgeIdByPairKey.get(key);
        if (edgeId !== undefined) {
          ids.add(edgeId);
        }
      }
    }

    return [...ids];
  }

  function resolveNodeIdsForPath(pathSpec) {
    if (!pathSpec) {
      return [];
    }

    const ids = new Set();
    const fragments = pathSpec
      .split(/[;,]+/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);

    for (const fragment of fragments) {
      const chain = fragment
        .replaceAll("->", ">")
        .split(">")
        .map((nodeId) => nodeId.trim())
        .filter(Boolean);

      for (const nodeId of chain) {
        ids.add(nodeId);
      }
    }

    return [...ids];
  }

  function centerGraphOnNodes(nodeIds) {
    if (!network || !Array.isArray(nodeIds) || !nodeIds.length || mapIsInteracting) {
      return;
    }

    if (nodeIds.length === 1) {
      network.focus(nodeIds[0], {
        scale: 1.08,
        animation: { duration: 220, easingFunction: "easeInOutQuad" }
      });
      return;
    }

    network.fit({
      nodes: nodeIds,
      animation: { duration: 240, easingFunction: "easeInOutQuad" }
    });
  }

  function setHighlightedEdges(nextEdgeIds) {
    if (!edgeDataSet) {
      return;
    }

    const nextIds = new Set(nextEdgeIds);
    const baseEdgeStyle = {
      width: 1.25,
      color: {
        color: theme.edge,
        highlight: theme.edgeHighlight
      }
    };
    const highlightedStyle = {
      width: 3.2,
      color: {
        color: theme.edgeHighlight,
        highlight: theme.edgeHighlight
      }
    };

    const idsToReset = [...highlightedEdgeIds].filter((id) => !nextIds.has(id));
    const idsToHighlight = [...nextIds].filter((id) => !highlightedEdgeIds.has(id));

    if (idsToReset.length) {
      edgeDataSet.update(idsToReset.map((id) => ({ id, ...baseEdgeStyle })));
    }
    if (idsToHighlight.length) {
      edgeDataSet.update(idsToHighlight.map((id) => ({ id, ...highlightedStyle })));
    }

    highlightedEdgeIds = nextIds;
  }

  function getNodeImportanceLevel(node) {
    if (node && node.important === true) {
      return 1;
    }
    const value = Number(node && node.importance);
    if (Number.isFinite(value) && value >= 1) {
      return Math.round(value);
    }
    return 3;
  }

  function getMaxImportanceLevel(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) {
      return 3;
    }
    let maxLevel = 3;
    for (const node of nodes) {
      maxLevel = Math.max(maxLevel, getNodeImportanceLevel(node));
    }
    return maxLevel;
  }

  function buildImportanceStyle(level, maxLevel) {
    const normalizedMax = Math.max(1, maxLevel - 1);
    const t = Math.max(0, Math.min(1, (level - 1) / normalizedMax));
    const emphasis = 1 - t;
    const alpha = 0.22 + emphasis * 0.78;
    const highlightAlpha = Math.min(1, alpha + 0.15);
    const isBluePriority = level <= 2;
    const baseColor = isBluePriority ? theme.accentBlue : theme.nodeBg;
    const borderColor = isBluePriority ? theme.accentBlue : theme.nodeBorder;

    return {
      borderWidth: isBluePriority ? 2 : 1,
      sizeDelta: Math.round((emphasis - 0.5) * 8),
      color: {
        background: toRgbaColor(baseColor, alpha),
        border: toRgbaColor(borderColor, Math.min(1, alpha + 0.08)),
        highlight: {
          background: toRgbaColor(baseColor, highlightAlpha),
          border: toRgbaColor(borderColor, Math.min(1, highlightAlpha + 0.08))
        }
      }
    };
  }

  function setPulsingNode(nodeId) {
    if (pulsingNodeId === nodeId) {
      return;
    }

    stopPulse();
    pulsingNodeId = nodeId || null;
    if (!pulsingNodeId || !nodesDataSet) {
      return;
    }

    pulsePhase = 0;
    const animatePulse = () => {
      if (!pulsingNodeId || !nodesDataSet) {
        return;
      }

      const baseSize = nodeBaseSizeById.get(pulsingNodeId);
      if (!Number.isFinite(baseSize)) {
        return;
      }

      pulsePhase += 0.14;
      const pulseOffset = Math.sin(pulsePhase) * 0.6 + 0.6;
      nodesDataSet.update({
        id: pulsingNodeId,
        size: baseSize + pulseOffset
      });

      pulseFrameId = window.requestAnimationFrame(animatePulse);
    };

    pulseFrameId = window.requestAnimationFrame(animatePulse);
  }

  function stopPulse() {
    if (pulseFrameId !== null) {
      window.cancelAnimationFrame(pulseFrameId);
      pulseFrameId = null;
    }

    if (!pulsingNodeId || !nodesDataSet) {
      return;
    }

    const baseSize = nodeBaseSizeById.get(pulsingNodeId);
    if (Number.isFinite(baseSize)) {
      nodesDataSet.update({
        id: pulsingNodeId,
        size: baseSize
      });
    }
  }

  function toRgbaColor(colorValue, alpha) {
    const rgb = parseRgbTriplet(colorValue);
    if (!rgb) {
      return colorValue;
    }
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  function parseRgbTriplet(colorValue) {
    if (typeof colorValue !== "string") {
      return null;
    }

    const value = colorValue.trim();
    const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const raw = hexMatch[1];
      const hex = raw.length === 3
        ? raw.split("").map((ch) => `${ch}${ch}`).join("")
        : raw;
      const intVal = Number.parseInt(hex, 16);
      if (!Number.isFinite(intVal)) {
        return null;
      }
      return [
        (intVal >> 16) & 255,
        (intVal >> 8) & 255,
        intVal & 255
      ];
    }

    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgbMatch) {
      return null;
    }
    const parts = rgbMatch[1]
      .split(",")
      .map((part) => Number.parseFloat(part.trim()))
      .filter((part) => Number.isFinite(part));
    if (parts.length < 3) {
      return null;
    }
    return [parts[0], parts[1], parts[2]];
  }

  async function readJson(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Unable to fetch ${path}.`);
    }
    return response.json();
  }

  async function readText(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Unable to fetch ${path}.`);
    }
    return response.text();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function getPageBaseUrl() {
    const scriptEl = document.currentScript;
    if (scriptEl && scriptEl.src) {
      return new URL(".", scriptEl.src);
    }
    return new URL(".", window.location.href);
  }

  function resolvePagePath(relativePath) {
    return new URL(relativePath, pageBaseUrl).toString();
  }

  function readThemeValues() {
    const rootStyles = window.getComputedStyle(document.documentElement);
    return {
      nodeBg: getCssVar(rootStyles, "--map-node-bg", "#0b0b0b"),
      nodeBorder: getCssVar(rootStyles, "--map-node-border", "#2f2f2f"),
      nodeFont: getCssVar(rootStyles, "--map-node-font", "#faf5ef"),
      accentBlue: getCssVar(rootStyles, "--accent-blue", "#1daada"),
      edge: getCssVar(rootStyles, "--map-edge", "rgba(11,11,11,0.26)"),
      edgeHighlight: getCssVar(rootStyles, "--map-edge-highlight", "#0b0b0b")
    };
  }

  function getCssVar(rootStyles, variable, fallback) {
    const value = rootStyles.getPropertyValue(variable).trim();
    return value || fallback;
  }
})();
