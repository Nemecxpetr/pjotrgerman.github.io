import { playPluck, playSineTone } from "../js/audio-pluck.js";

(function () {
  const DEFAULT_ARTICLE = "czech-scene-sound";
  const EDGE_BASE_WIDTH = 0.9;
  const EDGE_HIT_COLOR = "rgba(0, 0, 0, 0)";
  const EDGE_WAVE_DAMPING = 0.0105;
  const NODE_WAVE_DAMPING = 0.009;
  const EDGE_WAVE_SPEED = 0.018;
  const NODE_WAVE_SPEED = 0.02;
  const CONTEXT_ALIGN_EPSILON_PX = 0.26;
  const CONTEXT_ALIGN_MAX_PASSES = 10;
  const CONTEXT_ALIGN_INTERNAL_PASSES = 3;
  const CONTEXT_ALIGN_X_OVERSHOOT_MOBILE = 84;
  const CONTEXT_ALIGN_X_OVERSHOOT_TABLET = 220;
  const CONTEXT_ALIGN_X_OVERSHOOT_DESKTOP = 460;
  const CONTEXT_ALIGN_VIRTUAL_SCROLL_MIN_DESKTOP = 260;
  const CONTEXT_ALIGN_MAX_SPACER_PX = 6000;
  const PARAGRAPH_ENTITY_SELECTOR = "p, ul, ol, blockquote";
  const DESKTOP_PREVIEW_QUERY = "(min-width: 1200px)";
  const PREVIEW_SOURCE_GRAPH = "graph";
  const PREVIEW_SOURCE_TEXT = "text";
  const activeClass = "active";
  const pageBaseUrl = getPageBaseUrl();

  const articleKey = new URLSearchParams(window.location.search).get("article") || DEFAULT_ARTICLE;

  const titleEl = document.getElementById("article-title");
  const subtitleEl = document.getElementById("article-subtitle");
  const desktopTitleEl = document.getElementById("article-title-desktop");
  const desktopSubtitleEl = document.getElementById("article-subtitle-desktop");
  const essayLayout = document.querySelector(".essay-layout");
  const mapPane = document.querySelector(".map-pane");
  const paneResizer = document.getElementById("pane-resizer");
  const columnResizer = document.getElementById("column-resizer");
  const articlePane = document.getElementById("article-pane");
  const articleContent = document.getElementById("article-content");
  const mapContainer = document.getElementById("mind-map");
  const contextPreviewPane = document.getElementById("context-preview");
  const contextPreviewTitle = document.getElementById("context-preview-title");
  const contextPreviewMeta = document.getElementById("context-preview-meta");
  const contextPreviewBody = document.getElementById("context-preview-body");
  const desktopPreviewMedia = window.matchMedia(DESKTOP_PREVIEW_QUERY);

  let network = null;
  let nodesDataSet = null;
  let sectionByNodeId = new Map();
  let nodeBySectionId = new Map();
  let nodeBaseSizeById = new Map();
  let sectionEls = [];
  let edgeDataSet = null;
  let edgeIdByPairKey = new Map();
  let edgeIdsByNodeId = new Map();
  let edgeWaveStateById = new Map();
  let nodeWaveStateById = new Map();
  let highlightedEdgeIds = new Set();
  let highlightedNodeIds = new Set();
  let mentionMetaByEl = new WeakMap();
  let threadMentionsById = new Map();
  let selectedSectionId = null;
  let mapIsInteracting = false;
  let mapZoomIdleTimer = null;
  let hoveredEdgeId = null;
  let edgeWaveFrameId = null;
  let edgeWaveLastTick = 0;
  let lastStringDrawAt = 0;
  let nodeMotionById = new Map();
  let prevNodePositionById = new Map();
  let edgeLastSoundAtById = new Map();
  let pointerSpeedPxMs = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastPointerAt = 0;
  let lastNodeImpulseId = null;
  let lastNodeImpulseAt = 0;
  let nodeSizeRange = { min: 10, max: 24 };
  let pulsingNodeId = null;
  let pulseFrameId = null;
  let pulsePhase = 0;
  let activeContextShiftBlock = null;
  let contextShiftDragState = null;
  let contextShiftHandlersInstalled = false;
  let contextAnchorSpacerTopPx = 0;
  let contextAnchorSpacerBottomPx = 0;
  let lastArticlePaneScrollTop = 0;
  let suppressContextAnchorScrollReset = false;
  let contextJumpAligning = false;
  let activePreviewSource = "";
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
    hydrateThreadPlaceholders();

    sectionEls = [...articleContent.querySelectorAll("section[id]")];
    sectionEls.forEach((section) => {
      section.classList.add("article-section");
    });

    initContextPreview();
    initMobileMapScrollLock();
    initPaneResizer();
    initColumnResizer();
    initContextShiftSystem();
    installMap(mapConfig);
    installTextPathHover();
    installThreadLinks();
    restoreHash();
  }

  function hydrateThreadPlaceholders() {
    const sourceByThreadId = new Map();
    const sources = [...articleContent.querySelectorAll("[data-thread-source]")];
    for (const source of sources) {
      const threadId = String(source.dataset.threadSource || "").trim();
      if (!threadId || sourceByThreadId.has(threadId)) {
        continue;
      }
      sourceByThreadId.set(threadId, source.innerHTML);
      if (!source.dataset.thread) {
        source.dataset.thread = threadId;
      }
    }

    const placeholders = [...articleContent.querySelectorAll("[data-thread-placeholder]")];
    for (const placeholder of placeholders) {
      const threadId = String(placeholder.dataset.threadPlaceholder || "").trim();
      if (!threadId) {
        continue;
      }
      const markup = sourceByThreadId.get(threadId);
      if (typeof markup !== "string") {
        continue;
      }

      placeholder.innerHTML = markup;
      if (!placeholder.dataset.thread) {
        placeholder.dataset.thread = threadId;
      }
    }
  }

  function renderMeta(meta) {
    const resolvedTitle = meta.title || "Untitled Listening Notes";
    const resolvedSubtitle = [meta.subtitle, meta.author, meta.updated].filter(Boolean).join(" / ");
    titleEl.textContent = resolvedTitle;
    subtitleEl.textContent = resolvedSubtitle;
    if (desktopTitleEl) {
      desktopTitleEl.textContent = resolvedTitle;
    }
    if (desktopSubtitleEl) {
      desktopSubtitleEl.textContent = resolvedSubtitle;
    }

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
    nodeSizeRange = getNodeSizeRange();

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
        hoverConnectedEdges: false,
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
          color: "#000000",
          highlight: "#000000",
          hover: "#000000",
          inherit: false,
          opacity: 0
        },
        width: 10,
        hoverWidth: 0,
        selectionWidth: 0,
        chosen: {
          edge(values) {
            values.color = EDGE_HIT_COLOR;
            values.width = 0;
          }
        },
        smooth: {
          enabled: true,
          type: "continuous",
          roundness: 0.16
        }
      }
    });

    network.once("stabilizationIterationsDone", () => {
      network.setOptions({ physics: { enabled: false } });
    });

    initMapImpulseTracking();

    network.on("dragStart", () => {
      mapIsInteracting = true;
      startEdgeWaveLoop();
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

    network.on("hoverEdge", (params) => {
      hoveredEdgeId = params && params.edge ? params.edge : null;
      if (hoveredEdgeId) {
        triggerEdgeWave(hoveredEdgeId, getPointerImpulseStrength() * 0.85);
      }
      startEdgeWaveLoop();
    });

    network.on("blurEdge", () => {
      hoveredEdgeId = null;
      network.redraw();
    });

    network.on("hoverNode", (params) => {
      const nodeId = params && params.node ? params.node : null;
      if (!nodeId) {
        return;
      }
      const now = performance.now();
      if (nodeId === lastNodeImpulseId && now - lastNodeImpulseAt < 120) {
        return;
      }
      lastNodeImpulseId = nodeId;
      lastNodeImpulseAt = now;
      triggerNodeImpulse(nodeId, getPointerImpulseStrength());
      startEdgeWaveLoop();

      const sectionId = getSectionIdForNode(nodeId);
      if (sectionId) {
        const nodeData = getNodeData(nodeId);
        showContextPreviewForSection(sectionId, {
          source: PREVIEW_SOURCE_GRAPH,
          title: nodeData && nodeData.label ? String(nodeData.label) : "",
          meta: ""
        });
      }
    });

    network.on("blurNode", () => {
      clearContextPreview(PREVIEW_SOURCE_GRAPH);
    });

    network.on("afterDrawing", (ctx) => {
      drawStringEdges(ctx);
    });

    network.on("click", (params) => {
      const nodeId = params.nodes[0];
      if (!nodeId) {
        return;
      }
      const sectionId = getSectionIdForNode(nodeId);
      if (sectionId) {
        scrollToSection(sectionId);
      }
    });
  }

  function scrollToSection(sectionId, options = {}) {
    const {
      resetScroll = true,
      scrollBehavior = "smooth",
      shouldFocusNode = false,
      updateHash = true
    } = options;

    const target = articleContent.querySelector(`#${cssEscape(sectionId)}`);
    if (!target) {
      return;
    }

    selectSection(sectionId, true);
    syncSelectedNode(sectionId, shouldFocusNode);
    if (resetScroll) {
      articlePane.scrollTo({ top: 0, behavior: scrollBehavior });
    }
    if (updateHash) {
      window.history.replaceState(null, "", `#${sectionId}`);
    }
  }

  function selectSection(sectionId, force) {
    if (!force && selectedSectionId === sectionId) {
      return;
    }

    selectedSectionId = sectionId;

    for (const section of sectionEls) {
      const isActive = section.id === sectionId;
      section.classList.toggle(activeClass, isActive);
      section.classList.toggle("is-hidden", !isActive);
      section.hidden = !isActive;
    }
    resetContextShiftBlocks();
  }

  function initContextShiftSystem() {
    if (contextShiftHandlersInstalled || !articlePane) {
      return;
    }
    contextShiftHandlersInstalled = true;
    lastArticlePaneScrollTop = articlePane.scrollTop;

    articlePane.addEventListener("pointerdown", onContextShiftPointerDown);
    articlePane.addEventListener("scroll", onContextShiftPaneScroll, { passive: true });
    window.addEventListener("pointermove", onContextShiftPointerMove, { passive: false });
    window.addEventListener("pointerup", onContextShiftPointerUp, { passive: true });
    window.addEventListener("pointercancel", onContextShiftPointerUp, { passive: true });
  }

  function onContextShiftPaneScroll() {
    const currentScrollTop = articlePane ? articlePane.scrollTop : 0;
    const deltaY = currentScrollTop - lastArticlePaneScrollTop;
    lastArticlePaneScrollTop = currentScrollTop;

    if (suppressContextAnchorScrollReset || contextJumpAligning) {
      return;
    }
    if (Math.abs(deltaY) < 0.15) {
      return;
    }
    if (contextAnchorSpacerTopPx > 0.5 || contextAnchorSpacerBottomPx > 0.5) {
      consumeContextAnchorSpacer(deltaY);
    }
  }

  function consumeContextAnchorSpacer(deltaY) {
    const magnitude = Math.max(0.3, Math.abs(deltaY));
    let nextTop = contextAnchorSpacerTopPx;
    let nextBottom = contextAnchorSpacerBottomPx;

    if (nextTop > 0.5 && nextBottom <= 0.5) {
      const factor = deltaY > 0 ? 0.55 : 0.28;
      nextTop = Math.max(0, nextTop - magnitude * factor);
    } else if (nextBottom > 0.5 && nextTop <= 0.5) {
      const factor = deltaY < 0 ? 0.55 : 0.28;
      nextBottom = Math.max(0, nextBottom - magnitude * factor);
    } else {
      const decay = magnitude * 0.42;
      nextTop = Math.max(0, nextTop - decay);
      nextBottom = Math.max(0, nextBottom - decay);
    }

    if (nextTop <= 0.5 && nextBottom <= 0.5) {
      clearContextAnchorSpacer();
      return;
    }
    setContextAnchorSpacers(nextTop, nextBottom);
  }

  function onContextShiftPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (target.closest(".graph-thread, a, button, input, textarea, select")) {
      return;
    }

    const block = target.closest(".context-shift-active");
    if (!(block instanceof HTMLElement)) {
      return;
    }
    const section = block.closest("section[id]");
    if (!(section instanceof HTMLElement) || section.id !== selectedSectionId) {
      return;
    }

    const shift = getCurrentContextShift(block);
    contextShiftDragState = {
      pointerId: event.pointerId,
      block,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startShiftX: shift.x,
      startShiftY: shift.y
    };

    block.classList.add("is-dragging");
    if (block.setPointerCapture) {
      block.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  }

  function onContextShiftPointerMove(event) {
    if (!contextShiftDragState || event.pointerId !== contextShiftDragState.pointerId) {
      return;
    }

    const limits = getContextShiftLimits(contextShiftDragState.block, { mode: "drag" });
    const dx = event.clientX - contextShiftDragState.startClientX;
    const dy = event.clientY - contextShiftDragState.startClientY;
    const nextX = clampNumber(contextShiftDragState.startShiftX + dx, limits.minX, limits.maxX);
    const nextY = clampNumber(contextShiftDragState.startShiftY + dy, -limits.y, limits.y);
    applyContextShift(contextShiftDragState.block, nextX, nextY);
    event.preventDefault();
  }

  function onContextShiftPointerUp(event) {
    if (!contextShiftDragState || event.pointerId !== contextShiftDragState.pointerId) {
      return;
    }

    const { block } = contextShiftDragState;
    block.classList.remove("is-dragging");
    if (block.releasePointerCapture && block.hasPointerCapture(event.pointerId)) {
      block.releasePointerCapture(event.pointerId);
    }
    contextShiftDragState = null;
  }

  function getContextShiftLimits(block, options = {}) {
    const mode = options.mode || "drag";
    let baseX = 420;
    let baseY = 120;
    if (window.innerWidth < 680) {
      baseX = 72;
      baseY = 24;
    } else if (window.innerWidth < 960) {
      baseX = 180;
      baseY = 64;
    }

    let minX = -baseX;
    let maxX = baseX;
    const geometryBounds = getContextShiftBoundsFromGeometry(block);
    if (geometryBounds) {
      if (mode === "align") {
        const overshoot = getContextAlignXOvershoot();
        minX = geometryBounds.minX - overshoot;
        maxX = geometryBounds.maxX + overshoot;
      } else {
        minX = Math.max(-baseX, geometryBounds.minX);
        maxX = Math.min(baseX, geometryBounds.maxX);
      }
    }

    if (maxX < minX) {
      const pivot = (minX + maxX) / 2;
      minX = pivot;
      maxX = pivot;
    }
    return { minX, maxX, y: baseY };
  }

  function getContextAlignXOvershoot() {
    if (window.innerWidth < 680) {
      return CONTEXT_ALIGN_X_OVERSHOOT_MOBILE;
    }
    if (window.innerWidth < 960) {
      return CONTEXT_ALIGN_X_OVERSHOOT_TABLET;
    }
    return CONTEXT_ALIGN_X_OVERSHOOT_DESKTOP;
  }

  function getContextShiftBoundsFromGeometry(block) {
    if (!(block instanceof HTMLElement) || !articlePane) {
      return null;
    }

    const paneRect = articlePane.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    if (!paneRect.width || !blockRect.width) {
      return null;
    }

    const padding = 6;
    const currentShift = getCurrentContextShift(block);
    const unshiftedLeft = blockRect.left - currentShift.x;
    const unshiftedRight = blockRect.right - currentShift.x;
    const minX = (paneRect.left + padding) - unshiftedLeft;
    const maxX = (paneRect.right - padding) - unshiftedRight;
    return { minX, maxX };
  }

  function applyContextShift(block, shiftX, shiftY) {
    if (!(block instanceof HTMLElement)) {
      return;
    }
    const x = Math.abs(shiftX) < 0.35 ? 0 : shiftX;
    const y = Math.abs(shiftY) < 0.35 ? 0 : shiftY;
    block.style.transform = `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0)`;
    block.dataset.contextShiftX = String(x);
    block.dataset.contextShiftY = String(y);
    block.classList.add("context-shifted");
  }

  function getCurrentContextShift(block) {
    const x = Number.parseFloat(block.dataset.contextShiftX || "0");
    const y = Number.parseFloat(block.dataset.contextShiftY || "0");
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0
    };
  }

  function setActiveContextShiftBlock(block) {
    if (activeContextShiftBlock && activeContextShiftBlock !== block) {
      activeContextShiftBlock.classList.remove("context-shift-active");
    }
    activeContextShiftBlock = block || null;
    if (activeContextShiftBlock) {
      activeContextShiftBlock.classList.add("context-shift-active");
    }
  }

  function resetContextShiftBlocks() {
    const shiftedBlocks = articleContent.querySelectorAll(".context-shifted, .context-shift-active");
    for (const block of shiftedBlocks) {
      if (!(block instanceof HTMLElement)) {
        continue;
      }
      block.classList.remove("context-shifted", "context-shift-active", "is-dragging");
      block.style.transform = "";
      delete block.dataset.contextShiftX;
      delete block.dataset.contextShiftY;
    }
    activeContextShiftBlock = null;
    contextShiftDragState = null;
    clearContextAnchorSpacer();
  }

  function alignMarkerContextBlock(marker, desiredRowPx, desiredColumnPx) {
    if (!(marker instanceof Element)) {
      return false;
    }
    const block = marker.closest(PARAGRAPH_ENTITY_SELECTOR);
    if (!(block instanceof HTMLElement)) {
      return false;
    }
    const section = block.closest("section[id]");
    if (!(section instanceof HTMLElement) || section.id !== selectedSectionId) {
      return false;
    }

    setActiveContextShiftBlock(block);

    const limits = getContextShiftLimits(block, { mode: "align" });
    if (contextJumpAligning && isDesktopPreviewLayout()) {
      ensureVirtualScrollRange(Math.max(
        CONTEXT_ALIGN_VIRTUAL_SCROLL_MIN_DESKTOP,
        articlePane ? articlePane.clientHeight * 0.4 : CONTEXT_ALIGN_VIRTUAL_SCROLL_MIN_DESKTOP
      ));
    }

    for (let i = 0; i < CONTEXT_ALIGN_INTERNAL_PASSES; i += 1) {
      let markerPoint = getMarkerPointInArticlePane(marker);
      if (!markerPoint) {
        return false;
      }

      if (Number.isFinite(desiredColumnPx)) {
        const currentShift = getCurrentContextShift(block);
        const correctionX = desiredColumnPx - markerPoint.x;
        const nextShiftX = clampNumber(currentShift.x + correctionX, limits.minX, limits.maxX);
        applyContextShift(block, nextShiftX, 0);
      }

      markerPoint = getMarkerPointInArticlePane(marker);
      if (!markerPoint) {
        return false;
      }

      if (Number.isFinite(desiredRowPx)) {
        applyPaneScrollDelta(markerPoint.y - desiredRowPx);
      }

      markerPoint = getMarkerPointInArticlePane(marker);
      if (!markerPoint) {
        return false;
      }

      if (Number.isFinite(desiredRowPx)) {
        const residualY = desiredRowPx - markerPoint.y;
        if (residualY > CONTEXT_ALIGN_EPSILON_PX) {
          const nextTop = Math.min(
            CONTEXT_ALIGN_MAX_SPACER_PX,
            contextAnchorSpacerTopPx + residualY
          );
          setContextAnchorSpacers(nextTop, contextAnchorSpacerBottomPx);
          if (articlePane) {
            void articlePane.offsetHeight;
          }
          markerPoint = getMarkerPointInArticlePane(marker);
          if (markerPoint) {
            applyPaneScrollDelta(markerPoint.y - desiredRowPx);
          }
        } else if (residualY < -CONTEXT_ALIGN_EPSILON_PX) {
          const nextBottom = Math.min(
            CONTEXT_ALIGN_MAX_SPACER_PX,
            contextAnchorSpacerBottomPx + Math.abs(residualY)
          );
          setContextAnchorSpacers(contextAnchorSpacerTopPx, nextBottom);
          if (articlePane) {
            void articlePane.offsetHeight;
          }
          markerPoint = getMarkerPointInArticlePane(marker);
          if (markerPoint) {
            applyPaneScrollDelta(markerPoint.y - desiredRowPx);
          }
        }
      }

      const finalPoint = getMarkerPointInArticlePane(marker);
      if (!finalPoint) {
        return false;
      }
      const dx = Number.isFinite(desiredColumnPx) ? (desiredColumnPx - finalPoint.x) : 0;
      const dy = Number.isFinite(desiredRowPx) ? (desiredRowPx - finalPoint.y) : 0;
      if (Math.abs(dx) <= CONTEXT_ALIGN_EPSILON_PX && Math.abs(dy) <= CONTEXT_ALIGN_EPSILON_PX) {
        return true;
      }
    }

    const finalPoint = getMarkerPointInArticlePane(marker);
    if (!finalPoint) {
      return false;
    }
    const dx = Number.isFinite(desiredColumnPx) ? (desiredColumnPx - finalPoint.x) : 0;
    const dy = Number.isFinite(desiredRowPx) ? (desiredRowPx - finalPoint.y) : 0;
    return Math.abs(dx) <= CONTEXT_ALIGN_EPSILON_PX && Math.abs(dy) <= CONTEXT_ALIGN_EPSILON_PX;
  }

  function getMarkerPointInArticlePane(marker) {
    if (!marker || !articlePane) {
      return null;
    }
    const paneRect = articlePane.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return {
      x: markerRect.left - paneRect.left,
      y: markerRect.top - paneRect.top
    };
  }

  function applyPaneScrollDelta(deltaY) {
    if (!articlePane || !Number.isFinite(deltaY) || Math.abs(deltaY) < 0.2) {
      return;
    }
    let maxScrollTop = Math.max(0, articlePane.scrollHeight - articlePane.clientHeight);
    if (maxScrollTop < 0.5 && contextJumpAligning && isDesktopPreviewLayout()) {
      const expanded = ensureVirtualScrollRange(Math.max(
        CONTEXT_ALIGN_VIRTUAL_SCROLL_MIN_DESKTOP,
        Math.abs(deltaY) + articlePane.clientHeight * 0.25
      ));
      if (expanded) {
        maxScrollTop = Math.max(0, articlePane.scrollHeight - articlePane.clientHeight);
      }
    }
    const targetScrollTop = clampNumber(articlePane.scrollTop + deltaY, 0, maxScrollTop);
    suppressContextAnchorScrollReset = true;
    articlePane.scrollTop = targetScrollTop;
    window.requestAnimationFrame(() => {
      suppressContextAnchorScrollReset = false;
    });
  }

  function setContextAnchorSpacers(topPx, bottomPx) {
    const nextTop = clampNumber(
      Number.isFinite(topPx) ? topPx : 0,
      0,
      CONTEXT_ALIGN_MAX_SPACER_PX
    );
    const nextBottom = clampNumber(
      Number.isFinite(bottomPx) ? bottomPx : 0,
      0,
      CONTEXT_ALIGN_MAX_SPACER_PX
    );
    contextAnchorSpacerTopPx = nextTop;
    contextAnchorSpacerBottomPx = nextBottom;
    if (!articleContent) {
      return;
    }
    articleContent.style.setProperty("--context-anchor-spacer-top", `${nextTop.toFixed(3)}px`);
    articleContent.style.setProperty("--context-anchor-spacer-bottom", `${nextBottom.toFixed(3)}px`);
  }

  function ensureVirtualScrollRange(minRangePx) {
    if (!articlePane || !articleContent) {
      return false;
    }
    const currentRange = Math.max(0, articlePane.scrollHeight - articlePane.clientHeight);
    const targetRange = Math.max(0, Number.isFinite(minRangePx) ? minRangePx : 0);
    if (currentRange >= targetRange - 0.5) {
      return false;
    }

    const deficit = targetRange - currentRange;
    const half = deficit * 0.5;
    setContextAnchorSpacers(
      contextAnchorSpacerTopPx + half,
      contextAnchorSpacerBottomPx + half
    );
    void articlePane.offsetHeight;
    return true;
  }

  function clearContextAnchorSpacer() {
    contextAnchorSpacerTopPx = 0;
    contextAnchorSpacerBottomPx = 0;
    if (!articleContent) {
      return;
    }
    articleContent.style.setProperty("--context-anchor-spacer-top", "0px");
    articleContent.style.setProperty("--context-anchor-spacer-bottom", "0px");
  }

  function isDesktopPreviewLayout() {
    return Boolean(desktopPreviewMedia && desktopPreviewMedia.matches);
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
    edgeIdsByNodeId = new Map();
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
      if (!edgeIdsByNodeId.has(from)) {
        edgeIdsByNodeId.set(from, []);
      }
      if (!edgeIdsByNodeId.has(to)) {
        edgeIdsByNodeId.set(to, []);
      }
      edgeIdsByNodeId.get(from).push(normalized.id);
      edgeIdsByNodeId.get(to).push(normalized.id);
      return normalized;
    });
  }

  function installTextPathHover() {
    mentionMetaByEl = new WeakMap();
    const markerSet = new Set([
      ...articleContent.querySelectorAll("[data-graph-path]"),
      ...articleContent.querySelectorAll("[data-thread]"),
      ...articleContent.querySelectorAll("[data-thread-source]"),
      ...articleContent.querySelectorAll("[data-thread-placeholder]")
    ]);
    const markers = [...markerSet];
    const threadAutoMetaById = buildThreadAutoMetaById(markers);

    markers.forEach((marker) => {
      marker.classList.add("graph-mention");
      const pathSpec = marker.dataset.graphPath || "";
      const threadId = getMarkerThreadId(marker);
      const section = marker.closest("section[id]");
      const sectionId = section ? section.id : "";

      let edgeIds = [];
      let nodeIds = [];

      if (pathSpec.trim()) {
        edgeIds = resolveEdgeIdsForMarker(pathSpec);
        nodeIds = resolveNodeIdsForPath(pathSpec);
      } else if (threadId && threadAutoMetaById.has(threadId)) {
        const autoMeta = threadAutoMetaById.get(threadId);
        edgeIds = [...autoMeta.edgeIds];
        nodeIds = [...autoMeta.nodeIds];
      } else if (sectionId) {
        nodeIds = getSectionNodeIds(sectionId);
      }

      mentionMetaByEl.set(marker, {
        edgeIds,
        nodeIds,
        pathSpec
      });
      if (!nodeIds.length && !edgeIds.length) {
        return;
      }

      const onEnter = () => {
        marker.classList.add("is-active");
        setHighlightedPath(edgeIds, nodeIds);
        centerGraphOnNodes(nodeIds);
        const previewTarget = resolvePreviewTargetForMarker(marker, sectionId, nodeIds);
        if (previewTarget) {
          showContextPreviewForSection(previewTarget.sectionId, {
            source: PREVIEW_SOURCE_TEXT,
            title: previewTarget.title,
            meta: previewTarget.meta,
            focusText: previewTarget.focusText
          });
        }
      };
      const onLeave = () => {
        marker.classList.remove("is-active");
        clearHighlightedPath();
        clearContextPreview(PREVIEW_SOURCE_TEXT);
      };

      marker.addEventListener("mouseenter", onEnter);
      marker.addEventListener("mouseleave", onLeave);
      marker.addEventListener("focus", onEnter);
      marker.addEventListener("blur", onLeave);
    });
  }

  function getMarkerThreadId(marker) {
    if (!marker || !marker.dataset) {
      return "";
    }
    return String(
      marker.dataset.thread
      || marker.dataset.threadSource
      || marker.dataset.threadPlaceholder
      || ""
    ).trim();
  }

  function buildThreadAutoMetaById(markers) {
    const threadMarkersById = new Map();
    for (const marker of markers) {
      const threadId = getMarkerThreadId(marker);
      if (!threadId) {
        continue;
      }
      if (!threadMarkersById.has(threadId)) {
        threadMarkersById.set(threadId, []);
      }
      threadMarkersById.get(threadId).push(marker);
    }

    if (!threadMarkersById.size) {
      return new Map();
    }

    const adjacency = buildNodeAdjacency();
    const result = new Map();

    for (const [threadId, threadMarkers] of threadMarkersById.entries()) {
      const sectionNodeIds = [];
      for (const marker of threadMarkers) {
        const section = marker.closest("section[id]");
        const sectionId = section ? section.id : "";
        const nodeIds = getSectionNodeIds(sectionId);
        if (nodeIds.length) {
          sectionNodeIds.push(String(nodeIds[0]));
        }
      }

      const orderedUniqueNodeIds = [];
      for (const nodeId of sectionNodeIds) {
        if (orderedUniqueNodeIds[orderedUniqueNodeIds.length - 1] !== nodeId) {
          orderedUniqueNodeIds.push(nodeId);
        }
      }

      const nodeIds = new Set(orderedUniqueNodeIds);
      const edgeIds = new Set();

      for (let i = 0; i < orderedUniqueNodeIds.length - 1; i += 1) {
        const fromId = orderedUniqueNodeIds[i];
        const toId = orderedUniqueNodeIds[i + 1];
        const chain = findNodePathBfs(fromId, toId, adjacency);
        if (chain.length < 2) {
          continue;
        }

        for (const nodeId of chain) {
          nodeIds.add(nodeId);
        }
        for (let j = 0; j < chain.length - 1; j += 1) {
          const edgeId = edgeIdByPairKey.get(`${chain[j]}->${chain[j + 1]}`);
          if (edgeId !== undefined) {
            edgeIds.add(edgeId);
          }
        }
      }

      result.set(threadId, {
        nodeIds: [...nodeIds],
        edgeIds: [...edgeIds]
      });
    }

    return result;
  }

  function buildNodeAdjacency() {
    const adjacency = new Map();
    const edges = edgeDataSet ? edgeDataSet.get() : [];
    for (const edge of edges) {
      const fromId = String(edge.from);
      const toId = String(edge.to);
      if (!adjacency.has(fromId)) {
        adjacency.set(fromId, new Set());
      }
      if (!adjacency.has(toId)) {
        adjacency.set(toId, new Set());
      }
      adjacency.get(fromId).add(toId);
      adjacency.get(toId).add(fromId);
    }
    return adjacency;
  }

  function findNodePathBfs(fromNodeId, toNodeId, adjacency) {
    const fromId = String(fromNodeId || "");
    const toId = String(toNodeId || "");
    if (!fromId || !toId) {
      return [];
    }
    if (fromId === toId) {
      return [fromId];
    }
    if (!adjacency.has(fromId) || !adjacency.has(toId)) {
      return [fromId, toId];
    }

    const queue = [fromId];
    const prevById = new Map();
    const visited = new Set([fromId]);
    let found = false;

    while (queue.length) {
      const current = queue.shift();
      const neighbors = adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        prevById.set(neighbor, current);
        if (neighbor === toId) {
          found = true;
          queue.length = 0;
          break;
        }
        queue.push(neighbor);
      }
    }

    if (!found) {
      return [fromId, toId];
    }

    const chain = [toId];
    let cursor = toId;
    while (cursor !== fromId) {
      cursor = prevById.get(cursor);
      if (!cursor) {
        return [fromId, toId];
      }
      chain.push(cursor);
    }
    chain.reverse();
    return chain;
  }

  function installThreadLinks() {
    threadMentionsById = new Map();
    const threadMarkers = [...articleContent.querySelectorAll("[data-thread]")];
    for (const marker of threadMarkers) {
      const rawThreadId = marker.dataset.thread || "";
      const threadId = rawThreadId.trim();
      if (!threadId) {
        continue;
      }

      const section = marker.closest("section[id]");
      const sectionId = section ? section.id : "";
      if (!sectionId) {
        continue;
      }

      const pathMeta = mentionMetaByEl.get(marker) || {
        edgeIds: resolveEdgeIdsForMarker(marker.dataset.graphPath || ""),
        nodeIds: resolveNodeIdsForPath(marker.dataset.graphPath || "")
      };

      const nodeIds = pathMeta.nodeIds && pathMeta.nodeIds.length
        ? pathMeta.nodeIds
        : getSectionNodeIds(sectionId);
      const edgeIds = pathMeta.edgeIds || [];

      const instance = {
        marker,
        threadId,
        sectionId,
        nodeIds,
        edgeIds
      };

      if (!threadMentionsById.has(threadId)) {
        threadMentionsById.set(threadId, []);
      }
      threadMentionsById.get(threadId).push(instance);

      marker.classList.add("graph-thread");
      if (!isNaturallyFocusable(marker) && !marker.hasAttribute("tabindex")) {
        marker.setAttribute("tabindex", "0");
      }

      marker.addEventListener("click", (event) => {
        event.preventDefault();
        cycleThreadContext(threadId, marker);
      });

      marker.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        cycleThreadContext(threadId, marker);
      });
    }
  }

  function isNaturallyFocusable(el) {
    if (!el || typeof el.tagName !== "string") {
      return false;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) {
      return true;
    }
    return tag === "button" || tag === "input" || tag === "select" || tag === "textarea";
  }

  function cycleThreadContext(threadId, currentMarker) {
    const mentions = threadMentionsById.get(threadId) || [];
    if (mentions.length < 2) {
      return;
    }

    const currentIndex = mentions.findIndex((item) => item.marker === currentMarker);
    if (currentIndex < 0) {
      return;
    }

    const nextIndex = findNextThreadIndex(mentions, currentIndex);
    if (nextIndex < 0 || nextIndex === currentIndex) {
      return;
    }

    const desiredRowPx = getMarkerRowInArticlePane(currentMarker);
    const desiredColumnPx = getMarkerColumnInArticlePane(currentMarker);
    jumpToThreadMention(mentions[nextIndex], desiredRowPx, desiredColumnPx);
  }

  function findNextThreadIndex(mentions, currentIndex) {
    if (!mentions.length) {
      return -1;
    }

    const currentSectionId = mentions[currentIndex] ? mentions[currentIndex].sectionId : "";
    for (let offset = 1; offset < mentions.length; offset += 1) {
      const index = (currentIndex + offset) % mentions.length;
      if (mentions[index].sectionId !== currentSectionId) {
        return index;
      }
    }

    return (currentIndex + 1) % mentions.length;
  }

  function resolvePreviewTargetForMarker(marker, sectionId, nodeIds) {
    const threadId = getMarkerThreadId(marker);
    if (threadId) {
      const mentions = threadMentionsById.get(threadId) || [];
      const currentIndex = mentions.findIndex((item) => item.marker === marker);
      if (mentions.length > 1 && currentIndex >= 0) {
        const nextIndex = findNextThreadIndex(mentions, currentIndex);
        const nextMention = mentions[nextIndex];
        if (nextMention && nextMention.sectionId) {
          return {
            sectionId: nextMention.sectionId,
            title: getSectionHeading(nextMention.sectionId),
            meta: "",
            focusText: getPreviewTextFromMarker(nextMention.marker)
          };
        }
      }
    }

    if (Array.isArray(nodeIds) && nodeIds.length) {
      const candidates = nodeIds
        .map((nodeId) => getSectionIdForNode(nodeId))
        .filter(Boolean);
      const firstOther = candidates.find((candidate) => candidate !== sectionId);
      const targetSectionId = firstOther || candidates[0];
      if (targetSectionId) {
        return {
          sectionId: targetSectionId,
          title: getSectionHeading(targetSectionId),
          meta: ""
        };
      }
    }

    if (sectionId) {
      return {
        sectionId,
        title: getSectionHeading(sectionId),
        meta: ""
      };
    }

    return null;
  }

  function jumpToThreadMention(target, desiredRowPx, desiredColumnPx) {
    if (!target || !target.sectionId) {
      return;
    }

    contextJumpAligning = true;
    scrollToSection(target.sectionId, {
      resetScroll: true,
      scrollBehavior: "auto",
      shouldFocusNode: false,
      updateHash: true
    });

    window.requestAnimationFrame(() => {
      centerGraphForMention(target);
      activateThreadMention(target);
      const settle = (pass) => {
        const done = alignMarkerContextBlock(target.marker, desiredRowPx, desiredColumnPx);
        if (done || pass >= CONTEXT_ALIGN_MAX_PASSES) {
          window.requestAnimationFrame(() => {
            contextJumpAligning = false;
          });
          return;
        }
        window.requestAnimationFrame(() => settle(pass + 1));
      };
      settle(0);
    });
  }

  function getMarkerRowInArticlePane(marker) {
    if (!marker || !articlePane) {
      return Number.NaN;
    }
    const paneRect = articlePane.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return markerRect.top - paneRect.top;
  }

  function getMarkerColumnInArticlePane(marker) {
    if (!marker || !articlePane) {
      return Number.NaN;
    }
    const paneRect = articlePane.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return markerRect.left - paneRect.left;
  }

  function centerGraphForMention(mention) {
    if (!mention) {
      return;
    }
    const nodeIds = Array.isArray(mention.nodeIds) && mention.nodeIds.length
      ? mention.nodeIds
      : getSectionNodeIds(mention.sectionId);
    const edgeIds = Array.isArray(mention.edgeIds) ? mention.edgeIds : [];

    setHighlightedPath(edgeIds, nodeIds);
    centerGraphOnNodes(nodeIds);
    startEdgeWaveLoop();
  }

  function activateThreadMention(mention) {
    if (!mention || !mention.marker) {
      return;
    }
    const threadId = mention.threadId;
    const mentions = threadMentionsById.get(threadId) || [];
    for (const item of mentions) {
      item.marker.classList.remove("is-thread-active");
    }
    mention.marker.classList.add("is-thread-active");
  }

  function getSectionNodeIds(sectionId) {
    const nodeId = nodeBySectionId.get(sectionId);
    if (!nodeId) {
      return [];
    }
    return [nodeId];
  }

  function getSectionIdForNode(nodeId) {
    if (sectionByNodeId.has(nodeId)) {
      return sectionByNodeId.get(nodeId) || "";
    }
    const asString = String(nodeId);
    if (sectionByNodeId.has(asString)) {
      return sectionByNodeId.get(asString) || "";
    }
    const isNumericId = /^-?\d+(?:\.\d+)?$/.test(asString);
    const asNumber = isNumericId ? Number(asString) : Number.NaN;
    if (Number.isFinite(asNumber) && sectionByNodeId.has(asNumber)) {
      return sectionByNodeId.get(asNumber) || "";
    }
    return "";
  }

  function getNodeData(nodeId) {
    if (!nodesDataSet) {
      return null;
    }
    const direct = nodesDataSet.get(nodeId);
    if (direct) {
      return direct;
    }
    const asString = String(nodeId);
    const stringNode = nodesDataSet.get(asString);
    if (stringNode) {
      return stringNode;
    }
    const isNumericId = /^-?\d+(?:\.\d+)?$/.test(asString);
    const asNumber = isNumericId ? Number(asString) : Number.NaN;
    if (Number.isFinite(asNumber)) {
      return nodesDataSet.get(asNumber) || null;
    }
    return null;
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

  function setHighlightedPath(edgeIds, nodeIds) {
    highlightedEdgeIds = new Set(Array.isArray(edgeIds) ? edgeIds : []);
    highlightedNodeIds = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    if (network) {
      network.redraw();
    }
  }

  function clearHighlightedPath() {
    highlightedEdgeIds = new Set();
    highlightedNodeIds = new Set();
    if (network) {
      network.redraw();
    }
  }

  function triggerEdgeWave(edgeId, strength) {
    if (!edgeId) {
      return;
    }
    const state = ensureEdgeWaveState(edgeId);
    state.amplitude = Math.max(state.amplitude, clampNumber(strength, 0.18, 3.2));
    state.phase += Math.random() * Math.PI * 0.8;
    maybePlayEdgeSine(edgeId, strength);
  }

  function ensureEdgeWaveState(edgeId) {
    if (!edgeWaveStateById.has(edgeId)) {
      edgeWaveStateById.set(edgeId, {
        amplitude: 0,
        phase: Math.random() * Math.PI * 2
      });
    }
    return edgeWaveStateById.get(edgeId);
  }

  function triggerNodeImpulse(nodeId, strength) {
    if (!nodeId) {
      return;
    }
    const nodeKey = String(nodeId);
    const impulse = clampNumber(strength, 0.2, 3.4);
    const nodeState = ensureNodeWaveState(nodeKey);
    nodeState.amplitude = Math.max(nodeState.amplitude, impulse);
    nodeState.phase += Math.random() * Math.PI * 1.1;
    maybePlayNodePluck(nodeKey, impulse);

    const linkedEdges = edgeIdsByNodeId.get(nodeKey) || [];
    for (const edgeId of linkedEdges) {
      triggerEdgeWave(edgeId, impulse * 0.95);
    }
  }

  function ensureNodeWaveState(nodeId) {
    if (!nodeWaveStateById.has(nodeId)) {
      nodeWaveStateById.set(nodeId, {
        amplitude: 0,
        phase: Math.random() * Math.PI * 2
      });
    }
    return nodeWaveStateById.get(nodeId);
  }

  function startEdgeWaveLoop() {
    if (edgeWaveFrameId !== null) {
      return;
    }

    const tick = (ts) => {
      edgeWaveFrameId = null;
      if (!network) {
        return;
      }

      const dt = edgeWaveLastTick ? Math.max(8, Math.min(40, ts - edgeWaveLastTick)) : 16;
      edgeWaveLastTick = ts;
      let hasActiveWave = false;

      for (const state of edgeWaveStateById.values()) {
        if (state.amplitude > 0.001) {
          state.amplitude *= Math.exp(-dt * EDGE_WAVE_DAMPING);
          state.phase += dt * EDGE_WAVE_SPEED;
        }
        if (state.amplitude > 0.03) {
          hasActiveWave = true;
        }
      }

      for (const state of nodeWaveStateById.values()) {
        if (state.amplitude > 0.001) {
          state.amplitude *= Math.exp(-dt * NODE_WAVE_DAMPING);
          state.phase += dt * NODE_WAVE_SPEED;
        }
        if (state.amplitude > 0.03) {
          hasActiveWave = true;
        }
      }

      network.redraw();
      if (hasActiveWave || mapIsInteracting) {
        edgeWaveFrameId = window.requestAnimationFrame(tick);
      }
    };

    edgeWaveFrameId = window.requestAnimationFrame(tick);
  }

  function drawStringEdges(ctx) {
    if (!network || !edgeDataSet || !nodesDataSet) {
      return;
    }

    const edges = edgeDataSet.get();
    if (!edges.length) {
      return;
    }

    const ts = performance.now();
    const allNodeIds = nodesDataSet.getIds();
    const positions = network.getPositions(allNodeIds);
    updateNodeMotion(positions, ts);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const edge of edges) {
      const edgeId = edge.id;
      const fromId = String(edge.from);
      const toId = String(edge.to);
      const from = positions[fromId];
      const to = positions[toId];
      if (!from || !to) {
        continue;
      }

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const rawDistance = Math.hypot(dx, dy);
      if (!Number.isFinite(rawDistance) || rawDistance < 2) {
        continue;
      }

      const unitX = dx / rawDistance;
      const unitY = dy / rawDistance;
      const normalX = -unitY;
      const normalY = unitX;
      const fromRadius = getNodeRadius(fromId);
      const toRadius = getNodeRadius(toId);

      const startX = from.x + unitX * fromRadius;
      const startY = from.y + unitY * fromRadius;
      const endX = to.x - unitX * toRadius;
      const endY = to.y - unitY * toRadius;
      const distance = Math.hypot(endX - startX, endY - startY);
      if (distance < 2) {
        continue;
      }

      const motion = (nodeMotionById.get(fromId) || 0) + (nodeMotionById.get(toId) || 0);
      const motionBoost = Math.min(7, motion * 140);

      const waveState = ensureEdgeWaveState(edgeId);
      const waveAmplitude = waveState.amplitude * 7.5 + motionBoost * 0.22;
      const bowAmplitude = clampNumber(distance * 0.012 + motionBoost * 0.45, 2.2, 13);
      const isPathHighlighted = highlightedEdgeIds.has(edgeId);
      const strokeColor = getEdgeStrokeColor(edge, isPathHighlighted);
      const baseWidth = Number(edge.width) || 1.25;
      const strokeWidth = baseWidth + (isPathHighlighted ? 0.35 : 0);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();

      const segments = Math.max(12, Math.min(26, Math.round(distance / 18)));
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const envelope = Math.sin(Math.PI * t);
        const baseX = lerpNumber(startX, endX, t);
        const baseY = lerpNumber(startY, endY, t);
        const wave = Math.sin((t * Math.PI * 2.2) + waveState.phase) * waveAmplitude * envelope;
        const offset = bowAmplitude * envelope + wave;
        const x = baseX + normalX * offset;
        const y = baseY + normalY * offset;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      if (isPathHighlighted) {
        ctx.save();
        ctx.strokeStyle = toRgbaColor(theme.accentBlue, 0.34);
        ctx.lineWidth = strokeWidth + 2.6;
        ctx.shadowColor = toRgbaColor(theme.accentBlue, 0.7);
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let i = 0; i <= segments; i += 1) {
          const t = i / segments;
          const envelope = Math.sin(Math.PI * t);
          const baseX = lerpNumber(startX, endX, t);
          const baseY = lerpNumber(startY, endY, t);
          const wave = Math.sin((t * Math.PI * 2.2) + waveState.phase) * waveAmplitude * envelope;
          const offset = bowAmplitude * envelope + wave;
          const x = baseX + normalX * offset;
          const y = baseY + normalY * offset;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    drawHighlightedPathNodes(ctx, positions);
    drawNodeImpulses(ctx, positions);

    ctx.restore();
    lastStringDrawAt = ts;
  }

  function drawHighlightedPathNodes(ctx, positions) {
    if (!highlightedNodeIds.size) {
      return;
    }

    for (const nodeId of highlightedNodeIds) {
      const pos = positions[nodeId];
      if (!pos) {
        continue;
      }
      const radius = getNodeRadius(nodeId);
      const outer = radius + 6.5;
      const inner = radius + 2.6;

      ctx.fillStyle = toRgbaColor(theme.accentBlue, 0.12);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius + 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = toRgbaColor(theme.accentBlue, 0.42);
      ctx.shadowColor = toRgbaColor(theme.accentBlue, 0.72);
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, outer, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.lineWidth = 1;
      ctx.strokeStyle = toRgbaColor(theme.accentBlue, 0.62);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, inner, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawNodeImpulses(ctx, positions) {
    for (const [nodeId, state] of nodeWaveStateById.entries()) {
      if (!state || state.amplitude <= 0.03) {
        continue;
      }
      const pos = positions[nodeId];
      if (!pos) {
        continue;
      }
      const baseRadius = getNodeRadius(nodeId);
      const amp = state.amplitude;
      const wobble = Math.sin(state.phase) * (0.8 + amp * 0.4);

      const r1 = baseRadius + 2.2 + amp * 2.3 + wobble;
      const r2 = baseRadius + 6.2 + amp * 3.6 + wobble * 1.1;

      ctx.lineWidth = 1.1;
      ctx.strokeStyle = toRgbaColor(theme.accentBlue, clampNumber(0.34 + amp * 0.18, 0.2, 0.72));
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r1, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 0.9;
      ctx.strokeStyle = toRgbaColor(theme.accentBlue, clampNumber(0.16 + amp * 0.1, 0.08, 0.42));
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function updateNodeMotion(positions, ts) {
    const dt = lastStringDrawAt ? Math.max(8, Math.min(40, ts - lastStringDrawAt)) : 16;
    nodeMotionById = new Map();

    for (const [id, pos] of Object.entries(positions)) {
      const prev = prevNodePositionById.get(id);
      if (prev) {
        const vx = (pos.x - prev.x) / dt;
        const vy = (pos.y - prev.y) / dt;
        nodeMotionById.set(id, Math.hypot(vx, vy));
      } else {
        nodeMotionById.set(id, 0);
      }
      prevNodePositionById.set(id, { x: pos.x, y: pos.y });
    }
  }

  function getNodeRadius(nodeId) {
    const node = nodesDataSet ? nodesDataSet.get(nodeId) : null;
    const size = Number(node && node.size);
    if (Number.isFinite(size) && size > 0) {
      return size;
    }
    return 10;
  }

  function maybePlayNodePluck(nodeId, impulseStrength) {
    if (!nodesDataSet) {
      return;
    }
    const node = nodesDataSet.get(nodeId);
    if (!node) {
      return;
    }
    const size = Number(node.size);
    if (!Number.isFinite(size)) {
      return;
    }

    const boostedSize = size + clampNumber(impulseStrength * 1.2, 0, 4);
    playPluck(boostedSize, nodeSizeRange);
  }

  function maybePlayEdgeSine(edgeId, impulseStrength) {
    if (!edgeDataSet || !network) {
      return;
    }

    const now = performance.now();
    const lastAt = edgeLastSoundAtById.get(edgeId) || 0;
    const cooldownMs = 82;
    if (now - lastAt < cooldownMs) {
      return;
    }
    edgeLastSoundAtById.set(edgeId, now);

    const edge = edgeDataSet.get(edgeId);
    if (!edge) {
      return;
    }
    const fromId = String(edge.from);
    const toId = String(edge.to);
    const positions = network.getPositions([fromId, toId]);
    const from = positions[fromId];
    const to = positions[toId];
    if (!from || !to) {
      return;
    }

    const lengthPx = Math.hypot(to.x - from.x, to.y - from.y);
    const freqHz = edgeLengthToHz(lengthPx, impulseStrength);
    playSineTone(freqHz);
  }

  function edgeLengthToHz(lengthPx, impulseStrength) {
    const normalized = clampNumber((lengthPx - 60) / 520, 0, 1);
    const baseHz = lerpNumber(860, 190, normalized);
    const impulseBend = 1 + clampNumber((impulseStrength - 1) * 0.045, -0.1, 0.14);
    return baseHz * impulseBend;
  }

  function getNodeSizeRange() {
    const values = [...nodeBaseSizeById.values()].filter((value) => Number.isFinite(value));
    if (!values.length) {
      return { min: 10, max: 24 };
    }
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }

  function getEdgeStrokeColor(edge, isPathHighlighted) {
    if (isPathHighlighted) {
      return toRgbaColor(theme.accentBlue, 0.95);
    }
    return theme.edge;
  }

  function initMapImpulseTracking() {
    if (!mapContainer) {
      return;
    }

    mapContainer.addEventListener("pointerdown", (event) => {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      lastPointerAt = performance.now();
      pointerSpeedPxMs = 0;
    }, { passive: true });

    mapContainer.addEventListener("pointermove", (event) => {
      const now = performance.now();
      if (!lastPointerAt) {
        lastPointerAt = now;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        return;
      }

      const dt = Math.max(8, now - lastPointerAt);
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      const instant = Math.hypot(dx, dy) / dt;
      pointerSpeedPxMs = pointerSpeedPxMs * 0.62 + instant * 0.38;

      lastPointerAt = now;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    }, { passive: true });

    mapContainer.addEventListener("pointerleave", () => {
      pointerSpeedPxMs *= 0.35;
    }, { passive: true });
  }

  function getPointerImpulseStrength() {
    // Convert pointer speed (px/ms) to impulse amplitude.
    return clampNumber(0.28 + pointerSpeedPxMs * 5.4, 0.25, 3.4);
  }

  function lerpNumber(a, b, t) {
    return a + (b - a) * t;
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function initPaneResizer() {
    if (!essayLayout || !mapPane || !paneResizer) {
      return;
    }

    const getMinHeights = () => (window.matchMedia("(max-width: 900px)").matches
      ? { top: 160, bottom: 170 }
      : { top: 180, bottom: 180 });

    const clampMapHeight = (requested) => {
      const layoutRect = essayLayout.getBoundingClientRect();
      const dividerHeight = paneResizer.getBoundingClientRect().height || 10;
      const mins = getMinHeights();
      const maxTop = Math.max(mins.top, layoutRect.height - dividerHeight - mins.bottom);
      return Math.min(maxTop, Math.max(mins.top, requested));
    };

    const setMapPaneHeight = (pixels) => {
      const clamped = clampMapHeight(pixels);
      essayLayout.style.setProperty("--map-pane-size", `${Math.round(clamped)}px`);
      paneResizer.setAttribute("aria-valuenow", String(Math.round(clamped)));
      if (network) {
        network.redraw();
      }
    };

    const state = {
      active: false,
      startY: 0,
      startHeight: 0
    };

    paneResizer.addEventListener("pointerdown", (event) => {
      state.active = true;
      state.startY = event.clientY;
      state.startHeight = mapPane.getBoundingClientRect().height;
      paneResizer.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing");
      event.preventDefault();
    });

    paneResizer.addEventListener("pointermove", (event) => {
      if (!state.active) {
        return;
      }
      const deltaY = event.clientY - state.startY;
      setMapPaneHeight(state.startHeight + deltaY);
    });

    const stopResize = (event) => {
      if (!state.active) {
        return;
      }
      state.active = false;
      if (event && paneResizer.hasPointerCapture(event.pointerId)) {
        paneResizer.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove("is-resizing");
    };

    paneResizer.addEventListener("pointerup", stopResize);
    paneResizer.addEventListener("pointercancel", stopResize);

    paneResizer.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 42 : 22;
      const current = mapPane.getBoundingClientRect().height;
      if (event.key === "ArrowUp") {
        setMapPaneHeight(current - step);
        event.preventDefault();
      } else if (event.key === "ArrowDown") {
        setMapPaneHeight(current + step);
        event.preventDefault();
      }
    });
  }

  function initColumnResizer() {
    if (!essayLayout || !articlePane || !columnResizer) {
      return;
    }

    const getMinWidths = () => ({ left: 520, right: 320 });

    const clampArticleWidth = (requested) => {
      const layoutRect = essayLayout.getBoundingClientRect();
      const dividerWidth = columnResizer.getBoundingClientRect().width || 10;
      const mins = getMinWidths();
      const maxLeft = Math.max(mins.left, layoutRect.width - dividerWidth - mins.right);
      return Math.min(maxLeft, Math.max(mins.left, requested));
    };

    const setArticlePaneWidth = (pixels) => {
      if (!desktopPreviewMedia.matches) {
        return;
      }
      const clamped = clampArticleWidth(pixels);
      essayLayout.style.setProperty("--article-pane-size", `${Math.round(clamped)}px`);
      columnResizer.setAttribute("aria-valuenow", String(Math.round(clamped)));
      if (network) {
        network.redraw();
      }
    };

    const syncToViewport = () => {
      if (!desktopPreviewMedia.matches) {
        essayLayout.style.removeProperty("--article-pane-size");
        return;
      }
      const current = articlePane.getBoundingClientRect().width;
      setArticlePaneWidth(current);
    };

    const state = {
      active: false,
      startX: 0,
      startWidth: 0
    };

    columnResizer.addEventListener("pointerdown", (event) => {
      if (!desktopPreviewMedia.matches) {
        return;
      }
      state.active = true;
      state.startX = event.clientX;
      state.startWidth = articlePane.getBoundingClientRect().width;
      columnResizer.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing");
      event.preventDefault();
    });

    columnResizer.addEventListener("pointermove", (event) => {
      if (!state.active) {
        return;
      }
      const deltaX = event.clientX - state.startX;
      setArticlePaneWidth(state.startWidth + deltaX);
    });

    const stopResize = (event) => {
      if (!state.active) {
        return;
      }
      state.active = false;
      if (event && columnResizer.hasPointerCapture(event.pointerId)) {
        columnResizer.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove("is-resizing");
    };

    columnResizer.addEventListener("pointerup", stopResize);
    columnResizer.addEventListener("pointercancel", stopResize);

    columnResizer.addEventListener("keydown", (event) => {
      if (!desktopPreviewMedia.matches) {
        return;
      }
      const step = event.shiftKey ? 64 : 30;
      const current = articlePane.getBoundingClientRect().width;
      if (event.key === "ArrowLeft") {
        setArticlePaneWidth(current - step);
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        setArticlePaneWidth(current + step);
        event.preventDefault();
      }
    });

    if (typeof desktopPreviewMedia.addEventListener === "function") {
      desktopPreviewMedia.addEventListener("change", syncToViewport);
    } else if (typeof desktopPreviewMedia.addListener === "function") {
      desktopPreviewMedia.addListener(syncToViewport);
    }
    window.addEventListener("resize", syncToViewport, { passive: true });
    syncToViewport();
  }

  function initMobileMapScrollLock() {
    if (!mapPane) {
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 900px)");
    mapPane.addEventListener("touchmove", (event) => {
      if (!mobileQuery.matches) {
        return;
      }
      event.preventDefault();
    }, { passive: false });
  }

  function initContextPreview() {
    if (!contextPreviewPane || !contextPreviewTitle || !contextPreviewMeta || !contextPreviewBody) {
      return;
    }

    const syncPreviewByViewport = () => {
      if (isContextPreviewEnabled()) {
        renderContextPreviewPlaceholder();
      } else {
        activePreviewSource = "";
        contextPreviewBody.innerHTML = "";
      }
    };

    syncPreviewByViewport();
    if (typeof desktopPreviewMedia.addEventListener === "function") {
      desktopPreviewMedia.addEventListener("change", syncPreviewByViewport);
    } else if (typeof desktopPreviewMedia.addListener === "function") {
      desktopPreviewMedia.addListener(syncPreviewByViewport);
    }
  }

  function isContextPreviewEnabled() {
    return Boolean(contextPreviewPane && contextPreviewTitle && contextPreviewMeta && contextPreviewBody)
      && desktopPreviewMedia.matches;
  }

  function clearContextPreview(source) {
    if (!isContextPreviewEnabled()) {
      return;
    }
    if (source && activePreviewSource && activePreviewSource !== source) {
      return;
    }
    renderContextPreviewPlaceholder();
  }

  function renderContextPreviewPlaceholder() {
    if (!contextPreviewTitle || !contextPreviewMeta || !contextPreviewBody) {
      return;
    }
    activePreviewSource = "";
    contextPreviewTitle.textContent = "";
    contextPreviewMeta.textContent = "";
    contextPreviewBody.innerHTML = "";
  }

  function showContextPreviewForSection(sectionId, options = {}) {
    if (!isContextPreviewEnabled()) {
      return;
    }
    const section = articleContent.querySelector(`#${cssEscape(sectionId)}`);
    if (!(section instanceof HTMLElement)) {
      return;
    }

    const title = options.title || getSectionHeading(sectionId);
    const paragraphs = buildSectionPreviewParagraphs(section);
    const focusText = trimPreviewText(options.focusText || "", 220);

    contextPreviewTitle.textContent = title || "Context";
    contextPreviewMeta.textContent = options.meta || "";
    if (paragraphs.length || focusText) {
      const blocks = [];
      if (focusText) {
        blocks.push(`<p><strong>${escapeHtml(focusText)}</strong></p>`);
      }
      for (const paragraph of paragraphs) {
        blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
      }
      contextPreviewBody.innerHTML = blocks.join("");
    } else {
      contextPreviewBody.innerHTML = "<p>No preview text available.</p>";
    }

    activePreviewSource = options.source || "";
  }

  function buildSectionPreviewParagraphs(section) {
    const blocks = [...section.querySelectorAll("p, li, blockquote")]
      .map((el) => trimPreviewText(el.textContent || "", 220))
      .filter(Boolean);
    return blocks.slice(0, 3);
  }

  function getSectionHeading(sectionId) {
    const section = articleContent.querySelector(`#${cssEscape(sectionId)}`);
    if (!(section instanceof HTMLElement)) {
      return sectionId;
    }
    const heading = section.querySelector("h2");
    if (heading && heading.textContent) {
      return heading.textContent.trim();
    }
    return sectionId;
  }

  function getPreviewTextFromMarker(marker) {
    if (!(marker instanceof HTMLElement)) {
      return "";
    }
    return trimPreviewText(marker.textContent || "", 180);
  }

  function trimPreviewText(value, maxLength) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
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
    return new URL(".", import.meta.url);
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
