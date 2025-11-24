// app.js
// Layered Canvas -> SVG editor (full feature set)
// - layers with reorder (move up/down changes layer order)
// - grid snap (X/Y), snapping applies while dragging even if turned on later
// - per-point smoothingRequested (slider stores requested, applied is clamped)
// - closed shapes support smoothing at wrap-around corner
// - movement constraint modes
// - undo / redo

(function () {
  // --- Elements (main UI) ---
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const previewSvg = document.getElementById('previewSvg');
  const pathOutput = document.getElementById('pathOutput');

  const layersList = document.getElementById('layersList');
  const addLayerBtn = document.getElementById('addLayerBtn');
  const deleteLayerBtn = document.getElementById('deleteLayerBtn');
  const moveUpBtn = document.getElementById('moveUpBtn');
  const moveDownBtn = document.getElementById('moveDownBtn');

  const layerNameInput = document.getElementById('layerName');
  const strokeColorInput = document.getElementById('strokeColor');
  const strokeWidthInput = document.getElementById('strokeWidth');
  const closedCheckbox = document.getElementById('closedCheckbox');
  const visibleCheckbox = document.getElementById('visibleCheckbox');

  const smoothingSlider = document.getElementById('smoothingSlider');
  const smoothingValue = document.getElementById('smoothingValue');

  const gridXInput = document.getElementById('gridX');
  const gridYInput = document.getElementById('gridY');
  const snapCheckbox = document.getElementById('snapCheckbox');
  const otherOpacityInput = document.getElementById('otherOpacity');

  const movementModeSelect = document.getElementById('movementMode');

  const downloadSvgBtn = document.getElementById('downloadSvgBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearLayerBtn = document.getElementById('clearLayerBtn');

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  // preview transform controls (optional)
  const previewScaleInput = document.getElementById('previewScale');
  const previewOffsetXInput = document.getElementById('previewOffsetX');
  const previewOffsetYInput = document.getElementById('previewOffsetY');

  const previewScaleVal = document.getElementById('previewScaleVal');
  const previewOffsetXVal = document.getElementById('previewOffsetXVal');
  const previewOffsetYVal = document.getElementById('previewOffsetYVal');

  const previewFitBtn = document.getElementById('previewFitBtn');
  const previewResetBtn = document.getElementById('previewResetBtn');

  // NEW: line cap selector (expects a select with id="lineCapSelect" in the HTML)
  const lineCapSelect = document.getElementById('lineCapSelect');

  // --- State ---
  let layers = []; // each: { id, name, points: [{x,y,smoothingRequested}], strokeColor, strokeWidth, closed, visible }
  let currentLayerIndex = -1;
  let selectedPointIndex = -1; // index in current layer
  let draggingIndex = -1;
  let dragMouseStart = null;        // raw pointer start {x,y}
  let dragInitialPoint = null;      // initial point position {x,y}
  let dragHasMoved = false;
  let lastRect = null;

  const DEFAULT_OTHER_OPACITY = parseFloat(otherOpacityInput ? otherOpacityInput.value : 0.28) || 0.28;

  // point drawing & hit sizes (tweak here)
  const POINT_RADIUS = 8;       // visible radius (slightly bigger than before)
  const POINT_HIT_RADIUS = 10;  // hitbox radius for pointer detection

  // ---------- UNDO / REDO HISTORY ----------
  let history = [];
  let historyIndex = -1;

  function captureState() {
    return JSON.stringify({
      layers: JSON.parse(JSON.stringify(layers)),
      currentLayerIndex,
      selectedPointIndex
    });
  }

  function applyState(stateStr) {
    try {
      const obj = JSON.parse(stateStr);
      layers = obj.layers || [];
      currentLayerIndex = obj.currentLayerIndex;
      selectedPointIndex = obj.selectedPointIndex;
      refreshLayersList();
      syncLayerControls();
      draw();
    } catch (err) {
      console.error('Failed to apply history state', err);
    }
  }

  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function pushHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(captureState());
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    applyState(history[historyIndex]);
    updateUndoRedoButtons();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    applyState(history[historyIndex]);
    updateUndoRedoButtons();
  }

  // --- helpers ---
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
  function normalize(v) { const L = Math.hypot(v.x, v.y); return L === 0 ? { x: 0, y: 0 } : { x: v.x / L, y: v.y / L }; }

  // --- preview policy ---
  const previewTransformState = {
    scale: 1.0,
    offsetXpct: 0, // offset expressed as percent of canvas width
    offsetYpct: 0  // offset expressed as percent of canvas height
  };

  const PREVIEW_PRESERVE_ASPECT = 'slice'; // 'slice' or 'meet'

  // --- canvas sizing ---
  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (previewSvg) {
      try {
        const vw = Math.max(1, Math.round(rect.width));
        const vh = Math.max(1, Math.round(rect.height));
        previewSvg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
        const prevRect = previewSvg.getBoundingClientRect();
        const prevW = Math.max(1, Math.round(prevRect.width));
        const prevH = Math.max(1, Math.round(prevRect.height));
        previewSvg.setAttribute('width', String(prevW));
        previewSvg.setAttribute('height', String(prevH));
        previewSvg.setAttribute('preserveAspectRatio', `xMidYMid ${PREVIEW_PRESERVE_ASPECT}`);
        previewSvg.style.pointerEvents = 'none';
      } catch (err) {
        console.warn('previewSvg sizing not ready yet', err);
      }
    }

    draw();
  }

  function resizeCanvasIfNeeded() {
    const rect = canvas.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key !== lastRect) {
      lastRect = key;
      resizeCanvas();
    }
  }

  // get mouse in canvas coordinate (CSS pixels)
  function getMousePos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  // snapping
  function snapPos(pos) {
    if (!snapCheckbox || !snapCheckbox.checked) return pos;
    const gx = Math.max(1, Number(gridXInput.value) || 32);
    const gy = Math.max(1, Number(gridYInput.value) || 32);
    return {
      x: Math.round(pos.x / gx) * gx,
      y: Math.round(pos.y / gy) * gy
    };
  }

  // movement constraints projection
  function applyMovementConstraint(candidate, dragStartMouse, initialPoint) {
    const mode = movementModeSelect ? movementModeSelect.value || 'free' : 'free';
    if (mode === 'free') return candidate;
    if (mode === 'horizontal') return { x: candidate.x, y: initialPoint.y };
    if (mode === 'vertical') return { x: initialPoint.x, y: candidate.y };

    const dx = candidate.x - initialPoint.x;
    const dy = candidate.y - initialPoint.y;
    const u1 = normalize({ x: 1, y: 1 });
    const u2 = normalize({ x: 1, y: -1 });
    const p1 = dx * u1.x + dy * u1.y;
    const p2 = dx * u2.x + dy * u2.y;
    if (Math.abs(p1) >= Math.abs(p2)) {
      return { x: initialPoint.x + u1.x * p1, y: initialPoint.y + u1.y * p1 };
    } else {
      return { x: initialPoint.x + u2.x * p2, y: initialPoint.y + u2.y * p2 };
    }
  }

  // --- layer helpers ---
  function getActiveLayer() {
    if (currentLayerIndex < 0 || currentLayerIndex >= layers.length) return null;
    return layers[currentLayerIndex];
  }

  function findPointNearLayer(pos, radius = POINT_HIT_RADIUS) {
    const active = getActiveLayer();
    if (!active) return -1;
    for (let i = active.points.length - 1; i >= 0; i--) {
      if (dist(active.points[i], pos) <= radius) return i;
    }
    return -1;
  }

  // --- smoothing / tangents (per-layer) ---
  function computeTangentPointsFor(layer, i) {
    const pts = layer.points;
    const n = pts.length;
    if (n < 2) return null;
    const closed = !!layer.closed;

    // For open paths: endpoints do not have full both-sided tangents
    if (!closed && (i === 0 || i === n - 1)) return null;

    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;

    const A = pts[prevIdx], B = pts[i], C = pts[nextIdx];
    const vAB = { x: A.x - B.x, y: A.y - B.y };
    const vCB = { x: C.x - B.x, y: C.y - B.y };
    const lenAB = dist(A, B), lenCB = dist(C, B);

    const requested = (B.smoothingRequested !== undefined) ? B.smoothingRequested : B.smoothing || 0;
    const r = Math.max(0, Math.min(requested, lenAB / 2, lenCB / 2));

    const nAB = normalize(vAB);
    const nCB = normalize(vCB);

    return {
      tPrev: { x: B.x + nAB.x * r, y: B.y + nAB.y * r },
      tNext: { x: B.x + nCB.x * r, y: B.y + nCB.y * r },
      r
    };
  }

  // build SVG path d string for a layer (handles closed/open uniformly)
  function buildPathDFor(layer) {
    const pts = layer.points;
    const n = pts.length;
    if (n === 0) return '';
    if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;

    const closed = !!layer.closed;
    const tangents = new Array(n);
    for (let i = 0; i < n; i++) tangents[i] = computeTangentPointsFor(layer, i);

    const parts = [];

    // For closed path: if point0 has tangents, start at its tPrev, otherwise start at pts[0].
    const start = (closed && tangents[0]) ? tangents[0].tPrev : pts[0];
    parts.push(`M ${start.x} ${start.y}`);

    if (!closed) {
      if (n === 2) {
        parts.push(`L ${pts[1].x} ${pts[1].y}`);
        return parts.join(' ');
      }

      // --- handle first segment specially: allow smoothing when second point has tangents ---
      if (tangents[0]) {
        // original behavior: use tangents[0] to do Q from start -> tNext
        parts.push(`Q ${pts[0].x} ${pts[0].y} ${tangents[0].tNext.x} ${tangents[0].tNext.y}`);
        if (tangents[1]) parts.push(`L ${tangents[1].tPrev.x} ${tangents[1].tPrev.y}`);
        else parts.push(`L ${pts[1].x} ${pts[1].y}`);
      } else if (tangents[1]) {
        // fallback: use a control point between pts[0] and pts[1] (avoid using pts[1] directly
        // which can cause an initial overshoot). The control is weighted by the smoothing radius.
        const T1 = tangents[1];
        const d01 = dist(pts[0], pts[1]) || 1;
        // factor = 0..0.5 (0 = control at pts[0] => straight, 0.5 = midpoint)
        const factor = Math.min(0.5, (T1.r / d01));
        const cx = pts[0].x + (pts[1].x - pts[0].x) * factor;
        const cy = pts[0].y + (pts[1].y - pts[0].y) * factor;
        parts.push(`Q ${cx} ${cy} ${T1.tPrev.x} ${T1.tPrev.y}`);
      } else {
        parts.push(`L ${pts[1].x} ${pts[1].y}`);
      }

      // middle segments
      for (let i = 1; i <= n - 2; i++) {
        const T = tangents[i];
        const next = i + 1;
        if (T) {
          // Quadratic from pts[i] to T.tNext
          parts.push(`Q ${pts[i].x} ${pts[i].y} ${T.tNext.x} ${T.tNext.y}`);
          // Then either line to the next point or to its tPrev (if available)
          if (next <= n - 2 && tangents[next]) parts.push(`L ${tangents[next].tPrev.x} ${tangents[next].tPrev.y}`);
          else parts.push(`L ${pts[next].x} ${pts[next].y}`);
        } else {
          parts.push(`L ${pts[i].x} ${pts[i].y}`);
        }
      }

      // Final destination (last point) — always land on it explicitly
      parts.push(`L ${pts[n - 1].x} ${pts[n - 1].y}`);
      return parts.join(' ');
    } else {
      // closed path: per-point curve + line to next point's tPrev (if available)
      for (let i = 0; i < n; i++) {
        const T = tangents[i];
        if (T) parts.push(`Q ${pts[i].x} ${pts[i].y} ${T.tNext.x} ${T.tNext.y}`);
        else parts.push(`L ${pts[i].x} ${pts[i].y}`);

        const ni = (i + 1) % n;
        if (tangents[ni]) parts.push(`L ${tangents[ni].tPrev.x} ${tangents[ni].tPrev.y}`);
        else parts.push(`L ${pts[ni].x} ${pts[ni].y}`);
      }
      parts.push('Z');
      return parts.join(' ');
    }
  }

  // draw a layer path on canvas (mirrors buildPathDFor)
  function drawPathOnCanvas(layer, alpha = 1) {
    const pts = layer.points;
    const n = pts.length;
    if (n === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Number(layer.strokeWidth) || 2;
    ctx.strokeStyle = layer.strokeColor || '#0b5cff';
    ctx.lineJoin = 'round';

    // Respect the UI line cap selector (fallback to 'round')
    const lineCap = (lineCapSelect && lineCapSelect.value) ? lineCapSelect.value : 'round';
    ctx.lineCap = lineCap;

    const closed = !!layer.closed;
    const tangents = new Array(n);
    for (let i = 0; i < n; i++) tangents[i] = computeTangentPointsFor(layer, i);

    // Special-case single point: draw a small filled dot in stroke color so first point is visible.
    if (n === 1) {
      const p = pts[0];
      ctx.beginPath();
      const dotR = Math.max(1, (ctx.lineWidth / 2));
      ctx.fillStyle = layer.strokeColor || '#0b5cff';
      ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const start = (closed && tangents[0]) ? tangents[0].tPrev : pts[0];
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);

    if (!closed) {
      if (n === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (tangents[0]) {
        ctx.quadraticCurveTo(pts[0].x, pts[0].y, tangents[0].tNext.x, tangents[0].tNext.y);
        if (tangents[1]) ctx.lineTo(tangents[1].tPrev.x, tangents[1].tPrev.y);
        else ctx.lineTo(pts[1].x, pts[1].y);
      } else if (tangents[1]) {
        // fallback: create a control between pts[0] and pts[1] (avoids overshoot)
        const T1 = tangents[1];
        const d01 = dist(pts[0], pts[1]) || 1;
        const factor = Math.min(0.5, (T1.r / d01)); // 0..0.5; tweak 0.5 -> 0.33 for more conservative
        const cx = pts[0].x + (pts[1].x - pts[0].x) * factor;
        const cy = pts[0].y + (pts[1].y - pts[0].y) * factor;
        ctx.quadraticCurveTo(cx, cy, T1.tPrev.x, T1.tPrev.y);
      } else {
        ctx.lineTo(pts[1].x, pts[1].y);
      }

      for (let i = 1; i <= n - 2; i++) {
        const T = tangents[i];
        const next = i + 1;
        if (T) {
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, T.tNext.x, T.tNext.y);
          if (next <= n - 2 && tangents[next]) ctx.lineTo(tangents[next].tPrev.x, tangents[next].tPrev.y);
          else ctx.lineTo(pts[next].x, pts[next].y);
        } else {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      }
      ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    } else {
      for (let i = 0; i < n; i++) {
        const T = tangents[i];
        if (T) ctx.quadraticCurveTo(pts[i].x, pts[i].y, T.tNext.x, T.tNext.y);
        else ctx.lineTo(pts[i].x, pts[i].y);
        const ni = (i + 1) % n;
        if (tangents[ni]) ctx.lineTo(tangents[ni].tPrev.x, tangents[ni].tPrev.y);
        else ctx.lineTo(pts[ni].x, pts[ni].y);
      }
      ctx.closePath();
    }

    ctx.stroke();
    ctx.restore();
  }

  // draw grid background
  function drawGridBackground() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const gx = Math.max(1, Number(gridXInput ? gridXInput.value : 32) || 32);
    const gy = Math.max(1, Number(gridYInput ? gridYInput.value : 32) || 32);

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(180,180,200,0.12)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = 0; x <= w; x += gx) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y <= h; y += gy) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // apply the transform to the preview group's transform attribute
  function updatePreviewTransform() {
    if (!previewSvg) return;
    const g = previewSvg.querySelector('#previewTransform');
    if (!g) return;

    const rect = canvas.getBoundingClientRect();
    const vw = Math.max(1, Math.round(rect.width));
    const vh = Math.max(1, Math.round(rect.height));

    const s = previewTransformState.scale;
    const ox = (previewTransformState.offsetXpct / 100) * vw; // viewBox units
    const oy = (previewTransformState.offsetYpct / 100) * vh;

    const cx = vw / 2;
    const cy = vh / 2;

    const tx = cx + ox;
    const ty = cy + oy;

    g.setAttribute('transform', `translate(${tx} ${ty}) scale(${s}) translate(${-cx} ${-cy})`);
  }

  // --- build SVG for export that includes preview transform ---
  function buildCombinedSVGMarkup() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);

    const s = previewTransformState.scale;
    const ox = (previewTransformState.offsetXpct / 100) * w;
    const oy = (previewTransformState.offsetYpct / 100) * h;
    const cx = w / 2;
    const cy = h / 2;
    const tx = cx + ox;
    const ty = cy + oy;
    const transformAttr = `translate(${tx} ${ty}) scale(${s}) translate(${-cx} ${-cy})`;

    const svgLineCap = (lineCapSelect && lineCapSelect.value) ? lineCapSelect.value : 'round';

    const header = `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;

    let body = '';

    body += `  <g id="previewTransform" transform="${transformAttr}">\n`;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.visible || layer.points.length === 0) continue;
      const d = buildPathDFor(layer);
      if (!d) continue;
      body += `    <path d="${d}" fill="none" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth}" stroke-linecap="${svgLineCap}" stroke-linejoin="round"/>\n`;
    }

    body += '  </g>\n';
    const footer = '</svg>';
    return header + body + footer;
  }

  function buildCombinedSVGMarkupForPreviewOnly() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    const svgLineCap = (lineCapSelect && lineCapSelect.value) ? lineCapSelect.value : 'round';
    const header = `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;
    let body = '';
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.visible || layer.points.length === 0) continue;
      const d = buildPathDFor(layer);
      if (!d) continue;
      body += `  <path d="${d}" fill="none" stroke="${layer.strokeColor}" stroke-width="${layer.strokeWidth}" stroke-linecap="${svgLineCap}" stroke-linejoin="round"/>\n`;
    }
    const footer = '</svg>';
    return header + body + footer;
  }

  // main draw: grid + layers + points + preview SVG
  function draw() {
    resizeCanvasIfNeeded();
    drawGridBackground();

    const otherAlpha = clamp(Number(otherOpacityInput ? otherOpacityInput.value : DEFAULT_OTHER_OPACITY) || DEFAULT_OTHER_OPACITY, 0.05, 1);

    if (previewSvg) previewSvg.innerHTML = '';

    if (previewSvg) {
      let g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('id', 'previewTransform');
      previewSvg.appendChild(g);

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (!layer.visible) continue;
        const alpha = (li === currentLayerIndex) ? 1 : otherAlpha;

        // draw on canvas
        drawPathOnCanvas(layer, alpha);

        // draw points + smoothing indicators on canvas
        for (let pi = 0; pi < layer.points.length; pi++) {
          const p = layer.points[pi];
          ctx.beginPath();
          ctx.fillStyle = (li === currentLayerIndex && pi === selectedPointIndex) ? '#ff6a00' : '#ffffff';
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1.4;
          ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // compute prev/next indices correctly for open paths (avoid wrapping for open)
          const closed = !!layer.closed;
          const n = layer.points.length;
          const prevIdx = closed ? (pi - 1 + n) % n : (pi - 1 >= 0 ? pi - 1 : null);
          const nextIdx = closed ? (pi + 1) % n : (pi + 1 < n ? pi + 1 : null);

          const T = computeTangentPointsFor(layer, pi);
          if (T && T.r && T.r > 0 && prevIdx !== null && nextIdx !== null) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(11,92,255,0.35)';
            ctx.lineWidth = 2;
            const prev = layer.points[prevIdx];
            const next = layer.points[nextIdx];
            const v1 = normalize({ x: prev.x - p.x, y: prev.y - p.y });
            const v2 = normalize({ x: next.x - p.x, y: next.y - p.y });
            const bis = normalize({ x: v1.x + v2.x, y: v1.y + v2.y });
            const half = Math.min(T.r, 40);
            ctx.moveTo(p.x - bis.x * half, p.y - bis.y * half);
            ctx.lineTo(p.x + bis.x * half, p.y + bis.y * half);
            ctx.stroke();
          }
        }

        // add path to preview SVG group
        if (layer.points.length > 0 && layer.visible) {
          const d = buildPathDFor(layer);
          if (d) {
            const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('d', d);
            pathEl.setAttribute('fill', 'none');
            pathEl.setAttribute('stroke', layer.strokeColor || '#0b5cff');
            pathEl.setAttribute('stroke-width', String(layer.strokeWidth || 2));
            const svgLineCap = (lineCapSelect && lineCapSelect.value) ? lineCapSelect.value : 'round';
            pathEl.setAttribute('stroke-linecap', svgLineCap);
            pathEl.setAttribute('stroke-linejoin', 'round');
            pathEl.setAttribute('opacity', String(alpha));
            g.appendChild(pathEl);
          }
        }
      }

      updatePreviewTransform();
    } else {
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (!layer.visible) continue;
        const alpha = (li === currentLayerIndex) ? 1 : otherAlpha;
        drawPathOnCanvas(layer, alpha);
      }
    }

    pathOutput.value = buildCombinedSVGMarkup();
    refreshLayersList();
    syncLayerControls();
  }

  // --- layers UI ---
  function addLayer(name) {
    const l = {
      id: uid(),
      name: name || `Layer ${layers.length + 1}`,
      points: [],
      strokeColor: '#0b5cff',
      strokeWidth: 2,
      closed: false,
      visible: true
    };
    layers.push(l);
    currentLayerIndex = layers.length - 1;
    selectedPointIndex = -1;
    refreshLayersList();
    syncLayerControls();
    draw();
    pushHistory();
  }

  function deleteLayer(index) {
    if (index < 0 || index >= layers.length) return;
    layers.splice(index, 1);
    if (layers.length === 0) addLayer('Layer 1');
    currentLayerIndex = clamp(index - 1, 0, layers.length - 1);
    selectedPointIndex = -1;
    refreshLayersList();
    syncLayerControls();
    draw();
    pushHistory();
  }

  function moveLayer(up) {
    const i = currentLayerIndex;
    if (i < 0) return;
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= layers.length) return;
    const tmp = layers[i];
    layers[i] = layers[j];
    layers[j] = tmp;
    currentLayerIndex = j;
    refreshLayersList();
    syncLayerControls();
    draw();
    pushHistory(); // record reorder
  }

  function refreshLayersList() {
    if (!layersList) return;
    layersList.innerHTML = '';
    layers.forEach((layer, i) => {
      const li = document.createElement('li');
      li.className = 'layer-item' + (i === currentLayerIndex ? ' selected' : '');
      const title = document.createElement('div');
      title.style.flex = '1';
      title.style.overflow = 'hidden';
      title.style.whiteSpace = 'nowrap';
      title.style.textOverflow = 'ellipsis';
      title.textContent = layer.name;
      const actions = document.createElement('div');
      actions.className = 'layer-actions';

      const eye = document.createElement('button');
      eye.textContent = layer.visible ? '👁' : '🚫';
      eye.title = 'Toggle visibility';
      eye.onclick = (ev) => { ev.stopPropagation(); layer.visible = !layer.visible; draw(); pushHistory(); };

      const selectBtn = document.createElement('button');
      selectBtn.textContent = 'Edit';
      selectBtn.onclick = (ev) => { ev.stopPropagation(); currentLayerIndex = i; selectedPointIndex = -1; syncLayerControls(); draw(); };

      actions.appendChild(eye);
      actions.appendChild(selectBtn);

      li.appendChild(title);
      li.appendChild(actions);

      li.onclick = () => { currentLayerIndex = i; selectedPointIndex = -1; syncLayerControls(); draw(); };
      layersList.appendChild(li);
    });
  }

  function syncLayerControls() {
    const active = getActiveLayer();
    if (!active) {
      if (layerNameInput) layerNameInput.value = '';
      if (strokeColorInput) strokeColorInput.value = '#0b5cff';
      if (strokeWidthInput) strokeWidthInput.value = 2;
      if (closedCheckbox) closedCheckbox.checked = false;
      if (visibleCheckbox) visibleCheckbox.checked = true;
      if (smoothingSlider) { smoothingSlider.disabled = true; smoothingSlider.value = 0; }
      if (smoothingValue) smoothingValue.textContent = '-';
      return;
    }
    if (layerNameInput) layerNameInput.value = active.name || '';
    if (strokeColorInput) strokeColorInput.value = active.strokeColor || '#0b5cff';
    if (strokeWidthInput) strokeWidthInput.value = active.strokeWidth || 2;
    if (closedCheckbox) closedCheckbox.checked = !!active.closed;
    if (visibleCheckbox) visibleCheckbox.checked = !!active.visible;

    if (selectedPointIndex === -1) {
      if (smoothingSlider) { smoothingSlider.disabled = true; smoothingSlider.value = 0; }
      if (smoothingValue) smoothingValue.textContent = '-';
    } else {
      const pt = active.points[selectedPointIndex];
      const requested = (pt && pt.smoothingRequested !== undefined) ? pt.smoothingRequested : (pt && pt.smoothing) || 0;
      if (smoothingSlider) smoothingSlider.value = requested;

      if (!active.closed && (selectedPointIndex === 0 || selectedPointIndex === active.points.length - 1)) {
        if (smoothingSlider) smoothingSlider.disabled = true;
        if (smoothingValue) smoothingValue.textContent = '0';
      } else {
        if (smoothingSlider) smoothingSlider.disabled = false;
        const T = computeTangentPointsFor(active, selectedPointIndex);
        const applied = (T && T.r) ? T.r : 0;
        if (smoothingValue) smoothingValue.textContent = Math.round(applied);
      }
    }
    refreshLayersList();
  }

  // --- input handlers & interactions ---
  function onMouseDown(e) {
    if (e.button !== 0) return;
    const rawPos = getMousePos(e);
    const active = getActiveLayer();
    if (!active) return;

    const idx = findPointNearLayer(rawPos);
    if (idx >= 0) {
      draggingIndex = idx;
      selectedPointIndex = idx;
      dragMouseStart = rawPos;
      dragInitialPoint = { x: active.points[idx].x, y: active.points[idx].y };
      dragHasMoved = false;
      syncLayerControls();
      draw();
      e.preventDefault();
    } else {
      const snapped = snapPos(rawPos);
      active.points.push({ x: snapped.x, y: snapped.y, smoothing: 0, smoothingRequested: 0 });
      selectedPointIndex = active.points.length - 1;
      draggingIndex = selectedPointIndex;
      dragMouseStart = rawPos;
      dragInitialPoint = { x: snapped.x, y: snapped.y };
      dragHasMoved = false;
      syncLayerControls();
      draw();
      pushHistory(); // record add
      e.preventDefault();
    }
  }

  function onMouseMove(e) {
    const rawPos = getMousePos(e);
    const active = getActiveLayer();
    if (draggingIndex >= 0 && active) {
      const dx = rawPos.x - dragMouseStart.x;
      const dy = rawPos.y - dragMouseStart.y;
      let candidate = { x: dragInitialPoint.x + dx, y: dragInitialPoint.y + dy };

      candidate = applyMovementConstraint(candidate, dragMouseStart, dragInitialPoint);
      candidate = snapPos(candidate);

      active.points[draggingIndex].x = candidate.x;
      active.points[draggingIndex].y = candidate.y;

      dragHasMoved = true;
      draw();
    } else {
      const idx = findPointNearLayer(rawPos);
      canvas.style.cursor = idx >= 0 ? 'pointer' : 'crosshair';
    }
  }

  function onMouseUp(/*e*/) {
    if (dragHasMoved) {
      pushHistory(); // commit move once
    }
    draggingIndex = -1;
    dragHasMoved = false;
  }

  function onDblClick(e) {
    const rawPos = getMousePos(e);
    const active = getActiveLayer();
    if (!active) return;
    const idx = findPointNearLayer(rawPos);
    if (idx >= 0) {
      active.points.splice(idx, 1);
      if (selectedPointIndex === idx) selectedPointIndex = -1;
      if (selectedPointIndex >= active.points.length) selectedPointIndex = active.points.length - 1;
      syncLayerControls();
      draw();
      pushHistory(); // record delete
    }
  }

  // smoothing slider: live preview on input, commit on change
  if (smoothingSlider) {
    smoothingSlider.addEventListener('input', (ev) => {
      const requested = Number(ev.target.value);
      const active = getActiveLayer();
      if (!active || selectedPointIndex === -1) return;
      active.points[selectedPointIndex].smoothingRequested = requested;
      const T = computeTangentPointsFor(active, selectedPointIndex);
      const applied = (T && T.r) ? T.r : 0;
      if (smoothingValue) smoothingValue.textContent = Math.round(applied);
      draw();
    });
    smoothingSlider.addEventListener('change', () => {
      pushHistory(); // commit smoothing change once user releases
    });
  }

  // grid / snap / other UI
  if (gridXInput) gridXInput.addEventListener('input', draw);
  if (gridYInput) gridYInput.addEventListener('input', draw);
  if (snapCheckbox) snapCheckbox.addEventListener('change', draw);
  if (otherOpacityInput) otherOpacityInput.addEventListener('input', draw);
  if (movementModeSelect) movementModeSelect.addEventListener('change', () => { /* no-op */ });

  // NEW: line cap change should redraw preview (don't record in history to avoid noise)
  if (lineCapSelect) {
    lineCapSelect.addEventListener('change', () => {
      draw();
    });
  }

  // layer controls
  if (addLayerBtn) addLayerBtn.addEventListener('click', () => addLayer());
  if (deleteLayerBtn) deleteLayerBtn.addEventListener('click', () => { if (currentLayerIndex >= 0) deleteLayer(currentLayerIndex); });
  if (moveUpBtn) moveUpBtn.addEventListener('click', () => moveLayer(true));
  if (moveDownBtn) moveDownBtn.addEventListener('click', () => moveLayer(false));

  if (layerNameInput) layerNameInput.addEventListener('input', (e) => {
    const active = getActiveLayer(); if (!active) return;
    active.name = e.target.value || active.name; refreshLayersList(); pushHistory();
  });

  if (strokeColorInput) strokeColorInput.addEventListener('change', (e) => {
    const active = getActiveLayer(); if (!active) return;
    active.strokeColor = e.target.value; draw(); pushHistory();
  });

  if (strokeWidthInput) strokeWidthInput.addEventListener('change', (e) => {
    const active = getActiveLayer(); if (!active) return;
    active.strokeWidth = Number(e.target.value) || 1; draw(); pushHistory();
  });

  if (closedCheckbox) closedCheckbox.addEventListener('change', (e) => {
    const active = getActiveLayer(); if (!active) return;
    active.closed = !!e.target.checked; draw(); pushHistory();
  });

  if (visibleCheckbox) visibleCheckbox.addEventListener('change', (e) => {
    const active = getActiveLayer(); if (!active) return;
    active.visible = !!e.target.checked; draw(); pushHistory();
  });

  // download/export/clear
  if (downloadSvgBtn) downloadSvgBtn.addEventListener('click', () => {
    const svgText = buildCombinedSVGMarkup();
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'drawing.svg'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  if (exportBtn) exportBtn.addEventListener('click', () => {
    const data = JSON.stringify(layers, null, 2);
    const w = window.open('', '_blank');
    w.document.body.innerHTML = `<pre>${escapeHtml(data)}</pre>`;
  });

  if (clearLayerBtn) clearLayerBtn.addEventListener('click', () => {
    const a = getActiveLayer(); if (!a) return;
    a.points = [];
    selectedPointIndex = -1;
    syncLayerControls();
    draw();
    pushHistory();
  });

  // undo/redo wiring
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);

  // helper to escape text for export
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // --- preview control wiring (if controls exist) ---
  function updatePreviewUIValues() {
    if (previewScaleVal) previewScaleVal.textContent = previewTransformState.scale.toFixed(2);
    if (previewOffsetXVal) previewOffsetXVal.textContent = `${previewTransformState.offsetXpct}%`;
    if (previewOffsetYVal) previewOffsetYVal.textContent = `${previewTransformState.offsetYpct}%`;
  }

  function initPreviewControls() {
    if (previewScaleInput) {
      previewTransformState.scale = Number(previewScaleInput.value) || previewTransformState.scale;
      previewScaleInput.addEventListener('input', (e) => {
        previewTransformState.scale = Number(e.target.value);
        updatePreviewUIValues();
        updatePreviewTransform();
        pathOutput.value = buildCombinedSVGMarkup();
      });
    }
    if (previewOffsetXInput) {
      previewTransformState.offsetXpct = Number(previewOffsetXInput.value) || previewTransformState.offsetXpct;
      previewOffsetXInput.addEventListener('input', (e) => {
        previewTransformState.offsetXpct = Number(e.target.value);
        updatePreviewUIValues();
        updatePreviewTransform();
        pathOutput.value = buildCombinedSVGMarkup();
      });
    }
    if (previewOffsetYInput) {
      previewTransformState.offsetYpct = Number(previewOffsetYInput.value) || previewTransformState.offsetYpct;
      previewOffsetYInput.addEventListener('input', (e) => {
        previewTransformState.offsetYpct = Number(e.target.value);
        updatePreviewUIValues();
        updatePreviewTransform();
        pathOutput.value = buildCombinedSVGMarkup();
      });
    }

    if (previewFitBtn) previewFitBtn.addEventListener('click', () => {
      previewTransformState.scale = 1;
      previewTransformState.offsetXpct = 0;
      previewTransformState.offsetYpct = 0;
      if (previewScaleInput) previewScaleInput.value = previewTransformState.scale;
      if (previewOffsetXInput) previewOffsetXInput.value = previewTransformState.offsetXpct;
      if (previewOffsetYInput) previewOffsetYInput.value = previewTransformState.offsetYpct;
      updatePreviewUIValues();
      updatePreviewTransform();
      pathOutput.value = buildCombinedSVGMarkup();
    });

    if (previewResetBtn) previewResetBtn.addEventListener('click', () => {
      previewTransformState.scale = 1;
      previewTransformState.offsetXpct = 0;
      previewTransformState.offsetYpct = 0;
      if (previewScaleInput) previewScaleInput.value = previewTransformState.scale;
      if (previewOffsetXInput) previewOffsetXInput.value = previewTransformState.offsetXpct;
      if (previewOffsetYInput) previewOffsetYInput.value = previewTransformState.offsetYpct;
      updatePreviewUIValues();
      updatePreviewTransform();
      pathOutput.value = buildCombinedSVGMarkup();
    });

    updatePreviewUIValues();
  }

  // init
  function init() {
    if (layers.length === 0) addLayer('Layer 1');

    if (canvas) {
      canvas.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('dblclick', onDblClick);
    }

    window.addEventListener('resize', resizeCanvas);

    initPreviewControls();

    pushHistory();
    updateUndoRedoButtons();

    syncLayerControls();
    draw();
  }

  init();
})();
