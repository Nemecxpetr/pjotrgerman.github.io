import { playPluck, playSineTone } from "../js/audio-pluck.js";

(function () {
  const DEFAULT_ARTICLE = "czech-scene-sound";
  const EDGE_BASE_WIDTH = 0.9;
  const EDGE_HIT_COLOR = "rgba(0, 0, 0, 0)";
  const EDGE_WAVE_DAMPING = 0.0105;
  const NODE_WAVE_DAMPING = 0.009;
  const EDGE_WAVE_SPEED = 0.018;
  const NODE_WAVE_SPEED = 0.02;
  const activeClass = "active";
  const pageBaseUrl = getPageBaseUrl();

  const articleKey = new URLSearchParams(window.location.search).get("article") || DEFAULT_ARTICLE;

  const titleEl = document.getElementById("article-title");
  const subtitleEl = document.getElementById("article-subtitle");
  const essayLayout = document.querySelector(".essay-layout");
  const mapPane = document.querySelector(".map-pane");
  const paneResizer = document.getElementById("pane-resizer");
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
  let edgeIdsByNodeId = new Map();
  let edgeWaveStateById = new Map();
  let nodeWaveStateById = new Map();
  let highlightedEdgeIds = new Set();
  let highlightedNodeIds = new Set();
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

    initMobileMapScrollLock();
    initPaneResizer();
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
    });

    network.on("afterDrawing", (ctx) => {
      drawStringEdges(ctx);
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
    const markers = [...articleContent.querySelectorAll("[data-graph-path]")];
    markers.forEach((marker) => {
      marker.classList.add("graph-mention");
      const pathSpec = marker.dataset.graphPath || "";
      const edgeIds = resolveEdgeIdsForMarker(pathSpec);
      const nodeIds = resolveNodeIdsForPath(pathSpec);
      if (!nodeIds.length && !edgeIds.length) {
        return;
      }

      const onEnter = () => {
        marker.classList.add("is-active");
        setHighlightedPath(edgeIds, nodeIds);
        centerGraphOnNodes(nodeIds);
      };
      const onLeave = () => {
        marker.classList.remove("is-active");
        clearHighlightedPath();
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
