/* Table detection from ruling lines.
 *
 * PyMuPDF's find_tables(strategy="lines") is a vendored port of pdfplumber;
 * this is the same algorithm in JS, tuned with pdfplumber's default
 * tolerances, and it must agree with fitz on the committed fixtures (the
 * phase-2 parity check holds it to that). Pipeline: orient segments -> snap
 * to shared rails -> merge collinear -> intersect -> smallest cells ->
 * connected components -> row/column grid, fitz-shaped.
 */

const SNAP_TOL = 3;
const JOIN_TOL = 3;
const INTERSECT_TOL = 3;
const EDGE_MIN_LENGTH = 3;

/* ---- column-alignment inference for UNRULED tables ----------------------
 * Statement ledgers frequently ship with no ruling lines at all, so the
 * lines-strategy detector never sees them and every transaction lands as a
 * loose text box. The signal that remains is alignment: N consecutive
 * baseline rows whose spans cluster at shared x-rails (left OR right edge,
 * so right-aligned money columns count), usually with a header row on top.
 *
 * Deliberately conservative so prose can never tabulate:
 *   - a run can only START at a row with >= MIN_COLS spans;
 *   - >= MIN_DATA_ROWS + header, >= MIN_COLS supported columns;
 *   - every span of every row must sit on a shared rail (a single stray
 *     span breaks the run);
 *   - column x-extents must not overlap.
 */
const COL_TOL = 3.5;          // rail alignment tolerance, pt
const MIN_DATA_ROWS = 3;
const MIN_COLS = 3;
const ROW_PITCH_FACTOR = 2.6; // max baseline pitch between member rows

function groupRows(lines) {
  const sorted = [...lines].sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
  const rows = [];
  for (const ln of sorted) {
    const cy = (ln.y0 + ln.y1) / 2;
    const r = rows.length ? rows[rows.length - 1] : null;
    if (r && Math.abs(cy - r.cy) <= 0.5 * Math.max(ln.size || 8, r.size || 8)) {
      r.segs.push(ln);
      r.cy = (r.cy * (r.segs.length - 1) + cy) / r.segs.length;
      r.size = Math.max(r.size, ln.size || 0);
    } else {
      rows.push({ cy, size: ln.size || 8, segs: [ln] });
    }
  }
  for (const r of rows) {
    r.segs.sort((a, b) => a.x0 - b.x0);
    r.y0 = Math.min(...r.segs.map((s) => s.y0));
    r.y1 = Math.max(...r.segs.map((s) => s.y1));
  }
  return rows;
}

function matchCluster(clusters, seg) {
  for (const c of clusters) {
    if (Math.abs(seg.x0 - c.x0m) <= COL_TOL || Math.abs(seg.x1 - c.x1m) <= COL_TOL) return c;
  }
  return null;
}

function overlapsAnyCluster(clusters, seg) {
  return clusters.some((c) => Math.min(seg.x1, c.maxX1) - Math.max(seg.x0, c.minX0) > 1);
}

function addToCluster(c, seg) {
  c.x0m = (c.x0m * c.n + seg.x0) / (c.n + 1);
  c.x1m = (c.x1m * c.n + seg.x1) / (c.n + 1);
  c.minX0 = Math.min(c.minX0, seg.x0);
  c.maxX1 = Math.max(c.maxX1, seg.x1);
  c.n++;
}

function newCluster(seg) {
  return { x0m: seg.x0, x1m: seg.x1, minX0: seg.x0, maxX1: seg.x1, n: 1 };
}

export function inferAlignedTables(lines, existingBboxes = []) {
  const inBox = (b, x, y) => (b[0] - 2) <= x && x <= (b[2] + 2) && (b[1] - 2) <= y && y <= (b[3] + 2);
  const loose = lines.filter((ln) => {
    const cx = (ln.x0 + ln.x1) / 2, cy = (ln.y0 + ln.y1) / 2;
    return ln.spans.some((s) => s.text.trim() !== "")
        && !existingBboxes.some((b) => inBox(b, cx, cy));
  });
  const rows = groupRows(loose);
  const tables = [];
  let i = 0;
  while (i < rows.length) {
    const start = rows[i];
    if (start.segs.length < MIN_COLS) { i++; continue; }
    const clusters = start.segs.map(newCluster);
    const run = [start];
    let j = i + 1;
    while (j < rows.length) {
      const row = rows[j];
      const prev = run[run.length - 1];
      const pitch = row.cy - prev.cy;
      if (pitch > ROW_PITCH_FACTOR * Math.max(prev.size, row.size, 8)) break;
      if (row.segs.length < 2) break;
      // every span must land on a shared rail or open a clean new column
      let matched = 0;
      const plan = [];
      let ok = true;
      for (const seg of row.segs) {
        const c = matchCluster(clusters, seg);
        if (c) { matched++; plan.push([c, seg]); }
        else if (!overlapsAnyCluster(clusters, seg)) plan.push([null, seg]);
        else { ok = false; break; }
      }
      if (!ok || matched < 2) break;
      for (const [c, seg] of plan) {
        if (c) addToCluster(c, seg);
        else clusters.push(newCluster(seg));
      }
      run.push(row);
      j++;
    }
    const supported = clusters.filter((c) => c.n >= Math.max(3, Math.ceil(0.5 * run.length)));
    const denseRows = run.filter((r) => r.segs.length >= MIN_COLS).length;
    if (run.length >= MIN_DATA_ROWS + 1 && supported.length >= MIN_COLS
        && denseRows >= MIN_DATA_ROWS) {
      tables.push(buildInferredTable(run, supported));
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function buildInferredTable(run, cols) {
  cols = [...cols].sort((a, b) => a.minX0 - b.minX0);
  const colBounds = [cols[0].minX0 - 2];
  for (let k = 0; k < cols.length - 1; k++) {
    colBounds.push((cols[k].maxX1 + cols[k + 1].minX0) / 2);
  }
  colBounds.push(cols[cols.length - 1].maxX1 + 2);
  const rowBounds = [run[0].y0 - 2];
  for (let k = 0; k < run.length - 1; k++) {
    rowBounds.push((run[k].y1 + run[k + 1].y0) / 2);
  }
  rowBounds.push(run[run.length - 1].y1 + 2);
  const rows = [];
  for (let ri = 0; ri < run.length; ri++) {
    const cells = [];
    for (let ci = 0; ci < cols.length; ci++) {
      cells.push([colBounds[ci], rowBounds[ri], colBounds[ci + 1], rowBounds[ri + 1]]);
    }
    rows.push({ cells });
  }
  return {
    bbox: [colBounds[0], rowBounds[0], colBounds[colBounds.length - 1], rowBounds[rowBounds.length - 1]],
    row_count: run.length,
    col_count: cols.length,
    rows,
    inferred: true,   // no ruling lines in the source: draw no borders
  };
}

function orient(segments) {
  const h = [], v = [];
  for (const s of segments) {
    const dx = Math.abs(s.x1 - s.x0), dy = Math.abs(s.y1 - s.y0);
    if (dx >= EDGE_MIN_LENGTH && dy <= 1) {
      h.push({ x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1), y: (s.y0 + s.y1) / 2 });
    } else if (dy >= EDGE_MIN_LENGTH && dx <= 1) {
      v.push({ y0: Math.min(s.y0, s.y1), y1: Math.max(s.y0, s.y1), x: (s.x0 + s.x1) / 2 });
    }
  }
  return { h, v };
}

/* Snap edges whose rail coordinate sits within SNAP_TOL onto their mean. */
function snap(edges, key) {
  const sorted = [...edges].sort((a, b) => a[key] - b[key]);
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(e[key] - g.val / g.n) <= SNAP_TOL) {
      g.edges.push(e); g.val += e[key]; g.n++;
    } else {
      groups.push({ edges: [e], val: e[key], n: 1 });
    }
  }
  for (const g of groups) {
    const mean = g.val / g.n;
    for (const e of g.edges) e[key] = mean;
  }
  return edges;
}

/* Merge collinear edges separated by at most JOIN_TOL along the run axis. */
function mergeRuns(edges, railKey, lo, hi) {
  const byRail = new Map();
  for (const e of edges) {
    const k = Math.round(e[railKey] * 100) / 100;
    if (!byRail.has(k)) byRail.set(k, []);
    byRail.get(k).push(e);
  }
  const out = [];
  for (const group of byRail.values()) {
    group.sort((a, b) => a[lo] - b[lo]);
    let cur = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      const e = group[i];
      if (e[lo] <= cur[hi] + JOIN_TOL) {
        cur[hi] = Math.max(cur[hi], e[hi]);
      } else {
        out.push(cur);
        cur = { ...e };
      }
    }
    out.push(cur);
  }
  return out;
}

export function detectTables(segments) {
  let { h, v } = orient(segments);
  if (!h.length || !v.length) return [];
  snap(h, "y"); snap(v, "x");
  h = mergeRuns(h, "y", "x0", "x1");
  v = mergeRuns(v, "x", "y0", "y1");

  // intersections keyed "x,y" with the pair of edges that made them
  const pts = new Map();
  for (const ve of v) {
    for (const he of h) {
      if (ve.x >= he.x0 - INTERSECT_TOL && ve.x <= he.x1 + INTERSECT_TOL
          && he.y >= ve.y0 - INTERSECT_TOL && he.y <= ve.y1 + INTERSECT_TOL) {
        const key = `${Math.round(ve.x * 10)},${Math.round(he.y * 10)}`;
        if (!pts.has(key)) pts.set(key, { x: ve.x, y: he.y, hs: new Set(), vs: new Set() });
        const p = pts.get(key);
        p.hs.add(he); p.vs.add(ve);
      }
    }
  }
  const points = [...pts.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  if (points.length < 4) return [];

  const at = (x, y) => pts.get(`${Math.round(x * 10)},${Math.round(y * 10)}`);
  const shareH = (p1, p2) => [...p1.hs].some((e) => p2.hs.has(e));
  const shareV = (p1, p2) => [...p1.vs].some((e) => p2.vs.has(e));

  const xs = [...new Set(points.map((p) => Math.round(p.x * 10) / 10))].sort((a, b) => a - b);
  const ys = [...new Set(points.map((p) => Math.round(p.y * 10) / 10))].sort((a, b) => a - b);

  // smallest cell to the lower-right of each intersection (pdfplumber's rule:
  // the four corners exist and the four sides run along shared edges)
  const cells = [];
  for (const p of points) {
    let found = null;
    for (const x2 of xs) {
      if (found) break;
      if (x2 <= p.x + 0.1) continue;
      for (const y2 of ys) {
        if (y2 <= p.y + 0.1) continue;
        const tr = at(x2, p.y), bl = at(p.x, y2), br = at(x2, y2);
        if (!tr || !bl || !br) continue;
        if (shareH(p, tr) && shareH(bl, br) && shareV(p, bl) && shareV(tr, br)) {
          found = [p.x, p.y, x2, y2];
        }
        break;   // only the NEAREST y2 for this x2; then try next x2
      }
    }
    if (found) cells.push(found);
  }
  if (!cells.length) return [];

  // group cells into tables by shared corners (connected components)
  const cornerKey = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const parent = cells.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const cornerOwner = new Map();
  cells.forEach((c, i) => {
    for (const [cx, cy] of [[c[0], c[1]], [c[2], c[1]], [c[0], c[3]], [c[2], c[3]]]) {
      const k = cornerKey(cx, cy);
      if (cornerOwner.has(k)) union(cornerOwner.get(k), i);
      else cornerOwner.set(k, i);
    }
  });
  const groups = new Map();
  cells.forEach((c, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(c);
  });

  // fitz-shaped tables: rows of cells with None for covered/missing slots
  const tables = [];
  for (const cellList of groups.values()) {
    // A lone cell is a drawn rectangle (page background, chart bar, text
    // frame), not a table; fitz reports none of these and neither do we.
    if (cellList.length < 2) continue;
    const colXs = [...new Set(cellList.map((c) => Math.round(c[0] * 10) / 10))].sort((a, b) => a - b);
    const rowYs = [...new Set(cellList.map((c) => Math.round(c[1] * 10) / 10))].sort((a, b) => a - b);
    const rows = rowYs.map((ry) => {
      const rowCells = colXs.map((cx) => {
        const cell = cellList.find((c) =>
          Math.abs(c[0] - cx) <= 0.2 && Math.abs(c[1] - ry) <= 0.2);
        return cell || null;
      });
      return { cells: rowCells };
    });
    const bbox = [
      Math.min(...cellList.map((c) => c[0])), Math.min(...cellList.map((c) => c[1])),
      Math.max(...cellList.map((c) => c[2])), Math.max(...cellList.map((c) => c[3])),
    ];
    tables.push({
      bbox,
      row_count: rowYs.length,
      col_count: colXs.length,
      rows,
    });
  }
  tables.sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]));
  return tables;
}
