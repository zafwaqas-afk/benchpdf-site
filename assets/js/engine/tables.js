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
