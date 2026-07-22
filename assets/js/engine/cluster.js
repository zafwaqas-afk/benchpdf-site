/* Paragraph clustering: a line-for-line port of app/extraction.py's
 * _line_alignment, _is_marker, _attach_markers, _cluster_lines and
 * _split_paragraphs. Same constants, same comparisons, same order, so a
 * change in either engine's behaviour is a diff you can read side by side.
 */

export const PARA_GAP_FACTOR = 1.45;
export const PARA_BREAK_FACTOR = 1.6;
export const SIZE_TOLERANCE = 1.2;
export const LEFT_TOLERANCE = 0.16;
// A first-line indent runs about one em; wider than this is a quotation
// block or a table column, not a paragraph start.
export const INDENT_MIN_EM = 0.35;
export const INDENT_MAX_EM = 4.0;
// A strip this wide that no line crosses is a column gutter.
export const GUTTER_MIN_PT = 18;
export const COLUMN_MIN_LINES = 12;
export const COLUMN_MIN_LINES_PER_BAND = 4;

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

// A list whose markers were never separate glyph runs. Bank of England
// reports draw each item as one line already reading " Andrew Bailey,
// Chair": there is no marker line for attachMarkers to find, so nothing
// flagged the item as a list item, and nine evenly-leaded bullets clustered
// into ONE paragraph and reflowed onto two lines. A line that opens with a
// bullet glyph and a space is a list item however the marker got there.
export function startsWithMarker(line) {
  const txt = line.spans.map((s) => s.text || "").join("");
  const m = /^\s*(\S)\s/.exec(txt);
  if (!m) return false;
  const c = m[1];
  const code = c.codePointAt(0);
  return BULLET_LIKE.has(c) || (code >= 0xF000 && code <= 0xF0FF);
}

export function attachMarkers(lines) {
  const markers = lines.filter(isMarker);
  const texts = lines.filter((l) => !isMarker(l));
  for (const t of texts) if (startsWithMarker(t)) t.bullet = true;
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

/* Column bands.
 *
 * A two-column page clustered as one column produces blocks whose box spans
 * both columns, so the left column re-wraps at full width and overprints the
 * right. Find the gutters, the vertical strips no line crosses, and cluster
 * inside each band instead.
 *
 * Returns null when the page is a single column, when a candidate band holds
 * too little text to be a column, or when there is too little text on the
 * page to judge: a centred heading over a short paragraph must not read as
 * two columns.
 */
export function columnBands(lines, pageW) {
  if (!pageW || lines.length < COLUMN_MIN_LINES) return null;
  const BIN = 4;
  const bins = new Array(Math.max(1, Math.ceil(pageW / BIN))).fill(0);
  for (const ln of lines) {
    const a = Math.max(0, Math.floor(ln.x0 / BIN));
    const b = Math.min(bins.length - 1, Math.ceil(ln.x1 / BIN));
    for (let i = a; i <= b; i++) bins[i]++;
  }
  const cuts = [];
  let run = 0;
  for (let i = 0; i <= bins.length; i++) {
    const empty = i < bins.length && bins[i] === 0;
    if (empty) { run++; continue; }
    if (run * BIN >= GUTTER_MIN_PT) {
      const x0 = (i - run) * BIN, x1 = i * BIN;
      // a gutter at the page edge is a margin, not a column break
      if (x0 > pageW * 0.15 && x1 < pageW * 0.85) cuts.push((x0 + x1) / 2);
    }
    run = 0;
  }
  if (!cuts.length) return null;
  const edges = [0, ...cuts, pageW];
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) bands.push([edges[i], edges[i + 1]]);
  for (const b of bands) {
    const n = lines.filter((l) => {
      const c = (l.x0 + l.x1) / 2;
      return c >= b[0] && c < b[1];
    }).length;
    if (n < COLUMN_MIN_LINES_PER_BAND) return null;
  }
  return bands;
}

/* Cluster within columns when the page has them, across the page when not.
 *
 * PARKED on 2026-07-22: correct in principle, and engine.js does not call it.
 * Measured on a clean corpus cache it cost 0.056 of synthetic median
 * (0.7131 -> 0.6567) and bought nothing: it fires on 1 of 134 real pages, and
 * every real score is identical to four decimals with it off.
 *
 * The cost is not in this function. Clustering a column correctly produces one
 * multi-line block, and a multi-line block REFLOWS; the substituted font runs
 * wider than the source, so it wraps at different points and the column
 * drifts. Interleaved single-line clusters used to preserve the source's line
 * breaks by accident. Re-wire this once a reflowed block reproduces the
 * source's line breaks - size the box to its longest SOURCE LINE in the
 * substituted font, not just its longest word.
 */
export function clusterLinesByColumn(lines, pageW) {
  const bands = columnBands(lines, pageW);
  if (!bands) return clusterLines(lines);
  const out = [];
  for (const b of bands) {
    const inBand = lines.filter((l) => {
      const c = (l.x0 + l.x1) / 2;
      return c >= b[0] && c < b[1];
    });
    if (inBand.length) out.push(...clusterLines(inBand));
  }
  return out;
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
  const indentStart = firstLineIndents(cluster);
  const paras = [];
  let cur = [cluster[0]];
  for (let i = 1; i < cluster.length; i++) {
    const step = cluster[i].y0 - cluster[i - 1].y0;
    if (cluster[i].bullet || step > PARA_BREAK_FACTOR * leading || indentStart.has(i)) {
      paras.push(cur);
      cur = [cluster[i]];
    } else {
      cur.push(cluster[i]);
    }
  }
  paras.push(cur);
  return paras;
}

/* Which lines begin a paragraph purely because they are indented?
 *
 * Typeset prose, LaTeX papers above all, marks a new paragraph with a
 * first-line indent and no extra leading at all. Splitting on vertical gaps
 * alone therefore merged whole pages of an arXiv paper into single blocks.
 *
 * An indent only means "new paragraph" when the block otherwise sits flush:
 * if most lines are already indented the block is a hanging indent or a
 * centred run, and the signal means nothing.
 */
export function firstLineIndents(cluster) {
  const starts = new Set();
  if (cluster.length < 3) return starts;
  const size = cluster[0].size || 10;
  const bodyLeft = Math.min(...cluster.map((l) => l.x0));
  const flush = cluster.filter((l) => l.x0 - bodyLeft <= 1.0).length;
  if (flush < cluster.length * 0.6) return starts;
  for (let i = 1; i < cluster.length; i++) {
    const indent = cluster[i].x0 - bodyLeft;
    if (indent > INDENT_MIN_EM * size && indent < INDENT_MAX_EM * size) starts.add(i);
  }
  return starts;
}
