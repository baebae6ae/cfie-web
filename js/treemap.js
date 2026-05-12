/* static/js/treemap.js — Squarify Treemap Renderer */

/**
 * squarify(items, x, y, w, h) → [{item, x, y, w, h}, ...]
 * items: [{value, ...}]  (value > 0)
 */
function squarify(items, x, y, w, h) {
  if (!items.length) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return [];
  return _squarify(items.map(d => ({...d})), x, y, w, h, total);
}

function _squarify(items, x, y, w, h, total) {
  if (!items.length) return [];
  if (items.length === 1) {
    return [{ item: items[0], x, y, w, h }];
  }

  let area = w * h;
  const rects = [];
  let remaining = [...items];

  while (remaining.length) {
    const horiz = w >= h;
    const stripe = horiz ? h : w;
    let row = [];
    let rowArea = 0;
    let bestAR = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const testRow = [...row, candidate];
      const testArea = rowArea + candidate.value / total * area;
      const testLen  = testArea / stripe;
      let worst = 0;
      for (const d of testRow) {
        const cellArea = d.value / total * area;
        const cellW    = horiz ? testLen : cellArea / testLen;
        const cellH    = horiz ? cellArea / testLen : testLen;
        const ar = Math.max(cellW / cellH, cellH / cellW);
        if (ar > worst) worst = ar;
      }
      if (worst < bestAR || row.length === 0) {
        row = testRow;
        rowArea = testArea;
        bestAR = worst;
      } else {
        break;
      }
    }

    // lay out current row
    const rowLen = rowArea / stripe;
    let pos = horiz ? y : x;
    for (const d of row) {
      const cellArea = d.value / total * area;
      const cellSize = cellArea / rowLen;
      let rx, ry, rw, rh;
      if (horiz) {
        rx = x; ry = pos; rw = rowLen; rh = cellSize;
      } else {
        rx = pos; ry = y; rw = cellSize; rh = rowLen;
      }
      rects.push({ item: d, x: rx, y: ry, w: rw, h: rh });
      pos += cellSize;
    }

    // recurse remaining
    const usedCount = row.length;
    remaining = remaining.slice(usedCount);
    total -= row.reduce((s, d) => s + d.value, 0);
    area  -= rowArea;
    if (horiz) { x += rowLen; w -= rowLen; }
    else        { y += rowLen; h -= rowLen; }
  }
  return rects;
}


/**
 * renderTreemap(container, data, mode)
 * mode: "sector" | "stock"
 * data: { stocks:[{ticker,name,short,change_pct,sector}], sectors:[{name,change_pct,count}] }
 */
function renderTreemap(container, data, mode) {
  container.innerHTML = "";
  const cw = container.clientWidth  || 700;
  // aspect-ratio 16:9 CSS가 적용되지 않은 경우 fallback
  const ch = container.clientHeight  || Math.round(cw * 9 / 16) || 400;

  if (mode === "sector") {
    _renderSectorMap(container, data, cw, ch);
  } else {
    _renderStockMap(container, data, cw, ch);
  }
}

function _pctColor(pct) {
  if (pct >=  4)  return { bg: "#14532D", text: "#4ADE80", border: "#166534" };
  if (pct >=  2)  return { bg: "#15803D", text: "#86EFAC", border: "#16A34A" };
  if (pct >=  0.5)return { bg: "#166534", text: "#BBF7D0", border: "#15803D" };
  if (pct >= -0.5)return { bg: "#1E293B", text: "#94A3B8", border: "#334155" };
  if (pct >= -2)  return { bg: "#7F1D1D", text: "#FCA5A5", border: "#991B1B" };
  if (pct >= -4)  return { bg: "#991B1B", text: "#FECACA", border: "#B91C1C" };
  return              { bg: "#B91C1C", text: "#FEE2E2", border: "#DC2626" };
}

function _renderSectorMap(container, data, cw, ch) {
  if (!data.sectors || !data.sectors.length) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748B;font-size:13px">데이터 없음</div>';
    return;
  }
  const items = data.sectors.map(s => ({ ...s, value: s.count || 1 }));
  const rects = squarify(items, 0, 0, cw, ch);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", cw);
  svg.setAttribute("height", ch);
  svg.style.cssText = "display:block;border-radius:8px;overflow:hidden";

  for (const { item, x, y, w, h } of rects) {
    const c   = _pctColor(item.change_pct);
    const pad = 3;
    const sign = item.change_pct >= 0 ? "+" : "";

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.style.cursor = "pointer";

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x + pad);
    rect.setAttribute("y", y + pad);
    rect.setAttribute("width",  Math.max(w - pad*2, 0));
    rect.setAttribute("height", Math.max(h - pad*2, 0));
    rect.setAttribute("rx", "6");
    rect.setAttribute("fill", c.bg);
    rect.setAttribute("stroke", c.border);
    rect.setAttribute("stroke-width", "1");
    g.appendChild(rect);

    if (w > 50 && h > 32) {
      const cx = x + w/2, cy = y + h/2;
      const nameEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      nameEl.setAttribute("x", cx);
      nameEl.setAttribute("y", h > 60 ? cy - 10 : cy - 6);
      nameEl.setAttribute("text-anchor", "middle");
      nameEl.setAttribute("dominant-baseline", "middle");
      nameEl.setAttribute("fill", c.text);
      nameEl.setAttribute("font-size", Math.min(14, Math.max(10, w/8)));
      nameEl.setAttribute("font-weight", "700");
      nameEl.setAttribute("font-family", "'Noto Sans KR', sans-serif");
      nameEl.textContent = item.name;
      g.appendChild(nameEl);

      const pctEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pctEl.setAttribute("x", cx);
      pctEl.setAttribute("y", h > 60 ? cy + 10 : cy + 10);
      pctEl.setAttribute("text-anchor", "middle");
      pctEl.setAttribute("dominant-baseline", "middle");
      pctEl.setAttribute("fill", c.text);
      pctEl.setAttribute("font-size", Math.min(12, Math.max(9, w/10)));
      pctEl.setAttribute("font-weight", "600");
      pctEl.setAttribute("font-family", "'Noto Sans KR', sans-serif");
      pctEl.setAttribute("opacity", "0.9");
      pctEl.textContent = `${sign}${item.change_pct.toFixed(2)}%`;
      g.appendChild(pctEl);
    }
    svg.appendChild(g);
  }
  container.appendChild(svg);
}

function _renderStockMap(container, data, cw, ch) {
  const stocks = (data.stocks || []).slice();
  if (!stocks.length) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748B;font-size:13px">데이터 없음</div>';
    return;
  }

  // 섹터별로 그룹화, 각 셀 value = 1 (균등 크기)
  const sectorGroups = {};
  for (const s of stocks) {
    if (!sectorGroups[s.sector]) sectorGroups[s.sector] = [];
    sectorGroups[s.sector].push(s);
  }

  // 섹터 블록 배치 (섹터 value = 종목 수)
  const sectorItems = Object.entries(sectorGroups).map(([name, arr]) => ({
    name, stocks: arr, value: arr.length
  }));
  const sectorRects = squarify(sectorItems, 0, 0, cw, ch);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", cw);
  svg.setAttribute("height", ch);
  svg.style.cssText = "display:block;border-radius:8px;overflow:hidden";

  for (const { item: sector, x, y, w, h } of sectorRects) {
    const pad = 3;
    const stockItems = sector.stocks.map(s => ({ ...s, value: 1 }));
    const innerRects = squarify(stockItems, x+pad, y+pad, w-pad*2, h-pad*2);

    // 섹터 배경 (흐리게)
    const sectorBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    sectorBg.setAttribute("x", x);
    sectorBg.setAttribute("y", y);
    sectorBg.setAttribute("width",  w);
    sectorBg.setAttribute("height", h);
    sectorBg.setAttribute("fill", "rgba(255,255,255,0.03)");
    sectorBg.setAttribute("stroke", "rgba(148,163,184,0.15)");
    sectorBg.setAttribute("stroke-width", "1");
    sectorBg.setAttribute("rx", "6");
    svg.appendChild(sectorBg);

    // 섹터 레이블 (상단)
    if (h > 40 && w > 60) {
      const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      lbl.setAttribute("x", x + 6);
      lbl.setAttribute("y", y + 12);
      lbl.setAttribute("fill", "#94A3B8");
      lbl.setAttribute("font-size", "9");
      lbl.setAttribute("font-weight", "600");
      lbl.setAttribute("font-family", "'Noto Sans KR', sans-serif");
      lbl.textContent = sector.name;
      svg.appendChild(lbl);
    }

    for (const { item: stock, x: sx, y: sy, w: sw, h: sh } of innerRects) {
      const c    = _pctColor(stock.change_pct);
      const sp   = 2;
      const sign = stock.change_pct >= 0 ? "+" : "";

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.style.cursor = "pointer";
      g.addEventListener("click", () => { if (window.goAnalyze) goAnalyze(stock.ticker); });

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x",      sx + sp);
      rect.setAttribute("y",      sy + sp);
      rect.setAttribute("width",  Math.max(sw - sp*2, 0));
      rect.setAttribute("height", Math.max(sh - sp*2, 0));
      rect.setAttribute("rx", "4");
      rect.setAttribute("fill", c.bg);
      rect.setAttribute("stroke", c.border);
      rect.setAttribute("stroke-width", "1");
      g.appendChild(rect);

      const ew = sw - sp*2, eh = sh - sp*2;
      if (ew > 32 && eh > 22) {
        const cx = sx + sw/2, cy = sy + sh/2;

        const nameEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        nameEl.setAttribute("x", cx);
        nameEl.setAttribute("y", eh > 40 ? cy - 7 : cy - 5);
        nameEl.setAttribute("text-anchor", "middle");
        nameEl.setAttribute("dominant-baseline", "middle");
        nameEl.setAttribute("fill", c.text);
        nameEl.setAttribute("font-size", Math.min(13, Math.max(8, sw/6)));
        nameEl.setAttribute("font-weight", "700");
        nameEl.setAttribute("font-family", "'Noto Sans KR', sans-serif");
        nameEl.textContent = stock.short;
        g.appendChild(nameEl);

        if (eh > 36) {
          const pctEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
          pctEl.setAttribute("x", cx);
          pctEl.setAttribute("y", cy + 9);
          pctEl.setAttribute("text-anchor", "middle");
          pctEl.setAttribute("dominant-baseline", "middle");
          pctEl.setAttribute("fill", c.text);
          pctEl.setAttribute("font-size", Math.min(11, Math.max(8, sw/8)));
          pctEl.setAttribute("font-weight", "600");
          pctEl.setAttribute("font-family", "'Noto Sans KR', sans-serif");
          pctEl.setAttribute("opacity", "0.9");
          pctEl.textContent = `${sign}${stock.change_pct.toFixed(1)}%`;
          g.appendChild(pctEl);
        }
      }
      svg.appendChild(g);
    }
  }
  container.appendChild(svg);
}


