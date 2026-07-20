/* Paragraph clustering: a line-for-line port of app/extraction.py's
 * _line_alignment, _is_marker, _attach_markers, _cluster_lines and
 * _split_paragraphs. Same constants, same comparisons, same order, so a
 * change in either engine's behaviour is a diff you can read side by side.
 */

export const PARA_GAP_FACTOR = 1.45;
export const PARA_BREAK_FACTOR = 1.6;
export const SIZE_TOLERANCE = 1.2;
export const LEFT_TOLERANCE = 0.16;

const FLAG_BOLD = 1 << 4;

export function lineAlignment(lines, regionX0, regionX1) {
  if (lines.length < 2) return null;
  const width = Math.max(regionX1 - regionX0, 1.0);
  const lefts = lines.map((ln) => ln.x0 - regionX0);
  const rights = lines.map((ln) => regionX1 - ln.x1);
  const centers = lines.map((ln) => ((ln.x0 + ln.x1) / 2) - ((regionX0 + regionX1) / 2));
  const spread = (v) => (Math.max(...v) - Math.min(...v)) / width;

  if (spread(centers) < 0.05 && spread(lefts) > 0.08 && spread(rights) > 0.08) return "center";
  if (spread(rights) < 0.05 && spread(lefts) > 0.08) return "right";
  return "left";
}

const BULLET_LIKE = new Set(["•", "◦", "‣", "·", "∙",
                             "▪", "▫", "◾", "-", "‐", "*"]);

export function isMarker(line) {
  const txt = line.spans.map((s) => s.text || "").join("").trim();
  if (!txt || txt.length > 2) return false;
  if ((line.x1 - line.x0) > 14) return false;
  for (const c of txt) {
    const code = c.codePointAt(0);
    if (!(BULLET_LIKE.has(c) || (code >= 0xF000 && code <= 0xF0FF))) return false;
  }
  return true;
}

export function attachMarkers(lines) {
  const markers = lines.filter(isMarker);
  const texts = lines.filter((l) => !isMarker(l));
  for (const m of markers) {
    const mcy = (m.y0 + m.y1) / 2;
    let best = null, bestD = 1e9;
    for (const t of texts) {
      if (t.x0 <= m.x0 + 1 || t.bullet) continue;
      const tcy = (t.y0 + t.y1) / 2;
      if (Math.abs(tcy - mcy) <= Math.max(t.y1 - t.y0, t.size) * 0.9) {
        const d = Math.abs(tcy - mcy) + Math.abs(t.x0 - m.x1) * 0.01;
        if (d < bestD) { bestD = d; best = t; }
      }
    }
    if (best !== null) {
      const first = best.spans[0];
      best.spans = [{
        text: "• ", font: first.font || "",
        size: best.size, flags: (first.flags | 0) & ~FLAG_BOLD,
        color: first.color || 0,
      }, ...best.spans];
      best.bullet = true;
    }
  }
  return texts;
}

export function clusterLines(lines) {
  if (!lines.length) return [];
  const sorted = [...lines].sort((a, b) =>
    (Math.round(a.y0 * 10) - Math.round(b.y0 * 10)) || (a.x0 - b.x0));
  const clusters = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const ln = sorted[i];
    const prev = current[current.length - 1];
    const lineH = Math.max(prev.y1 - prev.y0, prev.size, 1.0);
    const gap = ln.y0 - prev.y1;
    const blockW = Math.max(
      Math.max(...current.map((c) => c.x1)) - Math.min(...current.map((c) => c.x0)), 1.0);
    const leftClose = Math.abs(ln.x0 - prev.x0) <= LEFT_TOLERANCE * blockW + 4;
    const overlap = Math.min(ln.x1, prev.x1) - Math.max(ln.x0, prev.x0);
    const xOverlap = overlap > 0.3 * Math.min(ln.x1 - ln.x0, prev.x1 - prev.x0);
    const sizeClose = Math.abs(ln.size - prev.size) <= SIZE_TOLERANCE;
    const verticalClose = gap >= -0.4 * lineH && gap <= PARA_GAP_FACTOR * lineH;

    if (sizeClose && verticalClose && (leftClose || xOverlap)) {
      current.push(ln);
    } else {
      clusters.push(current);
      current = [ln];
    }
  }
  clusters.push(current);
  return clusters;
}

export function splitParagraphs(cluster) {
  if (cluster.length === 1) return [cluster];
  const deltas = [];
  for (let i = 0; i < cluster.length - 1; i++) deltas.push(cluster[i + 1].y0 - cluster[i].y0);
  const sortedD = [...deltas].sort((a, b) => a - b);
  const leading = deltas.length ? sortedD[Math.floor(deltas.length / 2)] : cluster[0].size;
  const paras = [];
  let cur = [cluster[0]];
  for (let i = 1; i < cluster.length; i++) {
    const step = cluster[i].y0 - cluster[i - 1].y0;
    if (cluster[i].bullet || step > PARA_BREAK_FACTOR * leading) {
      paras.push(cur);
      cur = [cluster[i]];
    } else {
      cur.push(cluster[i]);
    }
  }
  paras.push(cur);
  return paras;
}
