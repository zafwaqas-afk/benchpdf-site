/* The browser PDF->PPTX engine: orchestrator + PPTX placement.
 *
 * A port of app/converter.py's convert_pdf_to_pptx over the extraction layer
 * in extract.js. Same constants, same page walk, same placement policy:
 *
 *   TABLES  from ruling lines, rebuilt as native PowerPoint tables with
 *           sampled cell fills; table regions excluded from backgrounds.
 *   TEXT    clustered into logical paragraph blocks; zero-inset text boxes;
 *           wrapped lines joined with a single space, never a separator.
 *   IMAGES  placed at their true position (native mode).
 *   HYBRID  pages with genuine non-table vector art get a background render
 *           with the text operators filtered out and tables whited out.
 *
 * The writer is PptxGenJS: it can express everything this engine needs
 * (custom slide size, z-ordered images, rich-run text boxes with zero insets,
 * native tables with per-cell fills and geometry), so the OOXML is not built
 * by hand. The per-engine fidelity suite holds the output to the same
 * invariants as the desktop engine's.
 */

import { initOps, extractLines, extractVectors, renderBackground, renderFull, sampleFill,
         inheritGlyphColors }
  from "./extract.js";
import { embeddedFontMetrics } from "./fontmetrics.js";
import { FontMapper, FLAG_ITALIC, FLAG_BOLD } from "./fonts.js";
import { attachMarkers, clusterLines, splitParagraphs, lineAlignment } from "./cluster.js";
import { detectTables, inferAlignedTables } from "./tables.js";

const HYBRID_DPI = 200;
const SAMPLE_DPI = 150;
const NONTABLE_ART_COVERAGE = 0.03;

const IN = 72;   // points per inch; PptxGenJS speaks inches

function centerIn(bbox, x, y, tol = 2.0) {
  return (bbox[0] - tol) <= x && x <= (bbox[2] + tol)
      && (bbox[1] - tol) <= y && y <= (bbox[3] + tol);
}

function hex6(n) {
  return (n & 0xffffff).toString(16).toUpperCase().padStart(6, "0");
}

/* ---- text runs: the _emit_paragraph / _style_run port ------------------- */
function styleRun(span, fonts) {
  const flags = span.flags | 0;
  return {
    fontFace: fonts.map(span.font || "", flags),
    fontSize: Math.max(span.size > 0 ? span.size : 10, 1),
    bold: !!(flags & FLAG_BOLD),
    italic: !!(flags & FLAG_ITALIC),
    color: hex6(span.color | 0),
  };
}

function paragraphRuns(paraLines, fonts, align) {
  const runs = [];
  let prevText = "";
  for (let li = 0; li < paraLines.length; li++) {
    const ln = paraLines[li];
    if (li > 0 && prevText && !/\s$/.test(prevText)) {
      // join wrapped lines with a single space - never a separator character
      runs.push({ text: " ", options: styleRun({ ...ln.spans[0] }, fonts) });
    }
    for (const sp of ln.spans) {
      runs.push({ text: sp.text, options: styleRun(sp, fonts) });
      prevText = sp.text;
    }
  }
  if (runs.length) {
    const last = runs[runs.length - 1].options;
    runs[runs.length - 1] = { text: runs[runs.length - 1].text,
      options: { ...last, breakLine: true } };
  }
  if (align) for (const r of runs) r.options.align = align;
  for (const r of runs) { r.options.paraSpaceBefore = 0; r.options.paraSpaceAfter = 0; }
  return runs;
}

/* ---- text blocks -------------------------------------------------------- */
const NOWRAP_MAX_WORDS = 5;    // blocks this short keep their source line breaks
const WORD_FIT_SAFETY = 1.1;   // substituted fonts can run a little wider

function longestWordWidth(cluster) {
  // chars-proportional estimate from source geometry: enough to guarantee the
  // box can hold its longest word, which is what stops mid-word wrapping
  let maxW = 0;
  for (const ln of cluster) {
    const text = ln.spans.map((s) => s.text).join("");
    const charW = (ln.x1 - ln.x0) / Math.max(text.length, 1);
    for (const wd of text.trim().split(/\s+/)) {
      maxW = Math.max(maxW, wd.length * charW);
    }
  }
  return maxW;
}

function addTextBlock(slide, cluster, scale, offX, offY, fonts, pageW) {
  const x0 = Math.min(...cluster.map((c) => c.x0));
  const y0 = Math.min(...cluster.map((c) => c.y0));
  const x1 = Math.max(...cluster.map((c) => c.x1));
  const y1 = Math.max(...cluster.map((c) => c.y1));

  const align = lineAlignment(cluster, x0, x1);
  const words = cluster
    .flatMap((l) => l.spans.map((s) => s.text).join("").trim().split(/\s+/))
    .filter(Boolean).length;
  // Short header blocks ("END OF DAY / ACCOUNT BALANCE") must never re-wrap:
  // keep the source's own line breaks and switch wrapping off entirely.
  const noWrapShort = cluster.length > 1 && words <= NOWRAP_MAX_WORDS;

  const runs = [];
  if (noWrapShort) {
    for (const ln of cluster) {
      for (let si = 0; si < ln.spans.length; si++) {
        const sp = ln.spans[si];
        const opts = styleRun(sp, fonts);
        opts.paraSpaceBefore = 0; opts.paraSpaceAfter = 0;
        if (align) opts.align = align;
        if (si === ln.spans.length - 1) opts.breakLine = true;
        runs.push({ text: sp.text, options: opts });
      }
    }
  } else {
    const paras = splitParagraphs(cluster);
    for (const para of paras) runs.push(...paragraphRuns(para, fonts, align));
  }

  const wrap = cluster.length > 1 && !noWrapShort;
  // a wrapping box must at minimum fit its longest word, or PowerPoint breaks
  // mid-word; cap at the page's right edge
  let wPt = Math.max(x1 - x0, 1);
  if (wrap) {
    wPt = Math.max(wPt, WORD_FIT_SAFETY * longestWordWidth(cluster));
    if (pageW) wPt = Math.min(wPt, Math.max(pageW - x0, x1 - x0));
  }

  slide.addText(runs, {
    x: (offX + x0 * scale) / IN,
    y: (offY + y0 * scale) / IN,
    w: Math.max(wPt * scale / IN, 1 / IN),
    h: Math.max((y1 - y0) * scale / IN, 0.5 / IN),
    // single-line blocks never need to wrap; with substituted fonts running
    // wider than the source, wrap:true breaks headings into two lines
    margin: 0, valign: "top", wrap,
    ...(align ? { align } : {}),
  });
}

/* ---- native tables ------------------------------------------------------ */
function linesIn(bbox, lines) {
  return lines.filter((ln) =>
    centerIn(bbox, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2));
}

// Every shape must land inside the slide with a real size. Values outside
// this are the signature of unresolved geometry, and PowerPoint refuses to
// open a file containing them.
// Cell sizes are consistent when each is real and positive and together they
// stay near the frame they are meant to fill.
function sizesFit(sizes, extent) {
  if (!sizes.length) return false;
  if (sizes.some((v) => !Number.isFinite(v) || v <= 0)) return false;
  const total = sizes.reduce((a, b) => a + b, 0);
  return total <= extent * 1.5 + 0.5;
}

function onSlide(x, y, w, h, slideW, slideH) {
  const vals = [x, y, w, h];
  if (vals.some((v) => !Number.isFinite(v))) return false;
  if (w <= 0.01 || h <= 0.01) return false;
  if (w > slideW * 4 || h > slideH * 4) return false;
  return x > -slideW && y > -slideH && x < slideW * 2 && y < slideH * 2;
}

// Can this table be placed as a native table at all? Judged before the page
// treats its region as one, because a region that is not going to ship as a
// table must fall back to text and pixels rather than vanish.
export function tablePlaceable(table, scale, offX, offY) {
  const nrows = table.row_count, ncols = table.col_count;
  if (nrows < 1 || ncols < 1) return false;
  const [bx0, by0, bx1, by1] = table.bbox;
  const row0 = (table.rows[0] || {}).cells || [];
  const colW = [];
  for (let ci = 0; ci < ncols; ci++) {
    const cb = row0[ci];
    colW.push(cb ? Math.max((cb[2] - cb[0]) * scale / IN, 0.01)
                 : ((bx1 - bx0) / ncols) * scale / IN);
  }
  const rowH = [];
  for (let ri = 0; ri < nrows; ri++) {
    const rcells = ((table.rows[ri] || {}).cells || []).filter(Boolean);
    const rh = rcells.length
      ? Math.max(...rcells.map((c) => c[3])) - Math.min(...rcells.map((c) => c[1]))
      : (by1 - by0) / nrows;
    rowH.push(Math.max(rh * scale / IN, 0.02));
  }
  const tx = (offX + bx0 * scale) / IN, ty = (offY + by0 * scale) / IN;
  const tw = (bx1 - bx0) * scale / IN, th = (by1 - by0) * scale / IN;
  const slideW = (offX * 2 + (bx1 - bx0) * scale) / IN + 12;
  return onSlide(tx, ty, tw, th, slideW, slideW * 2)
      && sizesFit(colW, tw) && sizesFit(rowH, th);
}

function addTable(slide, table, pageLines, sampleCtx, z, cw, ch, scale, offX, offY, fonts) {
  const nrows = table.row_count, ncols = table.col_count;
  if (nrows < 1 || ncols < 1) return false;
  const [bx0, by0, bx1, by1] = table.bbox;

  const row0 = table.rows[0].cells;
  const colW = [];
  for (let ci = 0; ci < ncols; ci++) {
    const cb = row0[ci];
    colW.push(cb ? Math.max((cb[2] - cb[0]) * scale / IN, 0.01)
                 : ((bx1 - bx0) / ncols) * scale / IN);
  }
  const rowH = [];
  for (let ri = 0; ri < nrows; ri++) {
    const rcells = table.rows[ri].cells.filter(Boolean);
    const rh = rcells.length
      ? Math.max(...rcells.map((c) => c[3])) - Math.min(...rcells.map((c) => c[1]))
      : (by1 - by0) / nrows;
    rowH.push(Math.max(rh * scale / IN, 0.02));
  }

  const rows = [];
  for (let ri = 0; ri < nrows; ri++) {
    const row = [];
    for (let ci = 0; ci < ncols; ci++) {
      const cb = table.rows[ri].cells[ci];
      if (cb === null) {
        row.push({ text: "", options: {} });
        continue;
      }
      const fill = sampleFill(sampleCtx, cb, z, cw, ch);
      const cellLines = linesIn(cb, pageLines)
        .sort((a, b) => (Math.round(a.y0 * 10) - Math.round(b.y0 * 10)) || (a.x0 - b.x0));
      let runs = [];
      if (cellLines.length) {
        for (const para of splitParagraphs(cellLines)) {
          runs.push(...paragraphRuns(para, fonts, null));
        }
      }
      row.push({
        text: runs.length ? runs : "",
        options: {
          fill: { color: hex6((fill[0] << 16) | (fill[1] << 8) | fill[2]) },
          valign: "top",
          margin: [1, 4, 1, 4],
          // explicit thin grid: the stamped tableStyleId names a style that
          // PptxGenJS's tableStyles.xml never defines, so PowerPoint draws
          // no borders from it. Corpus invoices exposed this.
          // An INFERRED (unruled) table gets no borders at all: the source
          // drew none, so drawing a grid would add ink the page never had.
          border: table.inferred ? { type: "none" }
                                 : { type: "solid", pt: 0.5, color: "000000" },
        },
      });
    }
    rows.push(row);
  }

  // A degenerate bbox (a table inferred from spans whose geometry did not
  // resolve) once produced an offset of -209,031,840,000 inches, and
  // PowerPoint calls the whole deck corrupt rather than ignoring the shape.
  // Anything that cannot sit on the slide does not ship as a table.
  const tx = (offX + bx0 * scale) / IN;
  const ty = (offY + by0 * scale) / IN;
  const tw = (bx1 - bx0) * scale / IN;
  const th = (by1 - by0) * scale / IN;
  // cw/ch arrive as sample-canvas pixels, so derive the real slide box
  // from the page geometry the caller already scaled.
  const slideW = (offX * 2 + (bx1 - bx0) * scale) / IN + 12;
  const slideH = slideW * 2;
  if (!onSlide(tx, ty, tw, th, slideW, slideH)) return false;
  // Row heights and column widths must add up to the frame the caller
  // computed. When they do not, the cell geometry never resolved: a page-wide
  // grid whose rows total 30in inside an 11in frame is the signature, and
  // pptxgenjs lays it out at an offset PowerPoint calls corrupt rather than
  // ignoring. Two SEC filings in the corpus failed exactly this way.
  if (!sizesFit(colW, tw) || !sizesFit(rowH, th)) return false;

  slide.addTable(rows, { x: tx, y: ty, w: tw, h: th, colW, rowH });
  return true;
}

/* ---- hybrid decision ---------------------------------------------------- */
function nontableArtRatio(pageW, pageH, drawings, tableBboxes) {
  const pageArea = Math.abs(pageW * pageH) || 1.0;
  let area = 0.0;
  for (const d of drawings) {
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    if (w <= 2 || h <= 2) continue;
    if (w > 0.92 * pageW && h > 0.92 * pageH) continue;
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
    if (tableBboxes.some((tb) => centerIn(tb, cx, cy))) continue;
    area += w * h;
  }
  return area / pageArea;
}

/* ---- per-page confidence -------------------------------------------------
 * The floor is "looks right, less editable": when extraction geometry is not
 * trustworthy, the page ships as a full render instead of broken boxes. */
function pageConfidence(lines, clusters) {
  const spans = lines.flatMap((l) => l.spans.map((sp) => ({ ...sp, l })));
  const n = Math.max(spans.length, 1);
  let deg = 0, sub4 = 0, unmapped = 0;
  const origins = new Map();
  for (const l of lines) {
    if (!(l.size > 0) || !isFinite(l.x0) || !isFinite(l.y0) || l.y1 <= l.y0) deg++;
    if (l.size < 4) sub4++;
    const k = Math.round(l.x0) + "," + Math.round(l.y0);
    origins.set(k, (origins.get(k) || 0) + 1);
    for (const sp of l.spans) if ((sp.font || "").startsWith("unmappable-")) unmapped++;
  }
  const piled = [...origins.values()].filter((v) => v > 2).reduce((a, v) => a + v - 2, 0);
  let overlaps = 0;
  const boxes = clusters.map((cl) => [
    Math.min(...cl.map((c) => c.x0)), Math.min(...cl.map((c) => c.y0)),
    Math.max(...cl.map((c) => c.x1)), Math.max(...cl.map((c) => c.y1))]);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
      const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      const min = Math.max(1, Math.min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1])));
      if (ix * iy > 0.10 * min) overlaps++;
    }
  }
  const nl = Math.max(lines.length, 1);
  // Font-mapping misses do NOT count toward fallback: an unrecoverable name
  // maps to a metric-compatible substitute (the engine's one documented
  // parity gap) and that text is still fully editable. Editability must
  // never be the price of a substituted font. The count stays in the
  // breakdown so the report can say what happened.
  const bad = (deg + piled) / nl + 0.3 * (sub4 / nl);
  return { ok: bad <= 0.15 && overlaps <= 5, bad, overlaps,
    // per-signal breakdown: what actually drove the score, for the report
    // and for the diagnostics harness. Counts, not weights.
    signals: { lines: lines.length, spans: spans.length, degenerate: deg,
               piledAtOrigin: piled, sub4pt: sub4, unmappedFonts: unmapped,
               overlaps } };
}

/* ---- region-level fallback ----------------------------------------------
 * When the page's confidence trips, the floor used to be the whole page as
 * one image. Now the suspect elements are bounded into minimal regions and
 * only those regions ship as image; every clean span and table stays
 * editable text. The full-page render survives as a last resort, for pages
 * whose geometry cannot even be bounded or where the suspect regions cover
 * more than SUSPECT_PAGE_LIMIT of the content area. */
const SUSPECT_PAGE_LIMIT = 0.40;

function lineFinite(l) {
  return isFinite(l.x0) && isFinite(l.y0) && isFinite(l.x1) && isFinite(l.y1);
}

/* Suspect loose lines: the same signals the confidence scorer counts,
 * attributed to the individual elements so they can be bounded. Overlapping
 * cluster pairs are suspect on both sides: either box might be the corrupt
 * one, and a region must cover whatever it is drawn over. */
function collectSuspects(allLines, looseLines, clusters) {
  const origins = new Map();
  for (const l of allLines) {
    const k = Math.round(l.x0) + "," + Math.round(l.y0);
    origins.set(k, (origins.get(k) || 0) + 1);
  }
  const suspects = new Set();
  let unplaceable = false;
  for (const l of looseLines) {
    if (!lineFinite(l)) { unplaceable = true; continue; }
    const piled = origins.get(Math.round(l.x0) + "," + Math.round(l.y0)) > 2;
    if (!(l.size > 0) || l.y1 <= l.y0 || l.size < 4 || piled) suspects.add(l);
  }
  const boxes = clusters.map((cl) => [
    Math.min(...cl.map((c) => c.x0)), Math.min(...cl.map((c) => c.y0)),
    Math.max(...cl.map((c) => c.x1)), Math.max(...cl.map((c) => c.y1))]);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.some((v) => !isFinite(v)) || b.some((v) => !isFinite(v))) continue;
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
      const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      const min = Math.max(1, Math.min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1])));
      if (ix * iy > 0.10 * min) {
        for (const l of clusters[i]) suspects.add(l);
        for (const l of clusters[j]) suspects.add(l);
      }
    }
  }
  return { suspects, unplaceable };
}

/* Union overlapping/touching boxes until a fixed point: minimal regions. */
function mergeRegions(boxes, pad = 2) {
  const regs = boxes.map((b) => [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < regs.length && !changed; i++) {
      for (let j = i + 1; j < regs.length; j++) {
        const [a, b] = [regs[i], regs[j]];
        if (a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]) {
          regs[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                     Math.max(a[2], b[2]), Math.max(a[3], b[3])];
          regs.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return regs;
}

/* ---- main entry --------------------------------------------------------- */
export async function convertPdfToPptx(bytes, deps, onProgress = () => {}) {
  const { pdfjs, PptxGenJS, PDFLib } = deps;
  initOps(pdfjs);

  const metrics = await embeddedFontMetrics(bytes.slice(0), PDFLib);
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const fonts = new FontMapper();
  const report = { pageCount: doc.numPages, pages: [], scannedWarning: false };

  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const slideWpt = vp1.viewBox[2] - vp1.viewBox[0];
  const slideHpt = vp1.viewBox[3] - vp1.viewBox[1];

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PDFSIZE", width: slideWpt / IN, height: slideHpt / IN });
  pptx.layout = "PDFSIZE";

  const tableKindsBySlide = [];   // per slide, "grid" | "plain" per native table
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress(i - 1, doc.numPages, `Converting page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i);
    const slide = pptx.addSlide();
    tableKindsBySlide[i - 1] = [];
    const opList = await page.getOperatorList();
    const vec = extractVectors(page, opList);
    const pw = vec.pageW, ph = vec.pageH;
    const scale = pw && ph ? Math.min(slideWpt / pw, slideHpt / ph) : 1.0;
    const offX = (slideWpt - pw * scale) / 2.0;
    const offY = (slideHpt - ph * scale) / 2.0;

    const allLines = await extractLines(page, opList, metrics);
    const pr = { page: i, mode: "native", textBoxes: 0, tables: 0, images: 0 };

    // ---- scanned / image-only ----
    const hasText = allLines.some((ln) => ln.spans.some((s) => s.text.trim() !== ""));
    if (!hasText) {
      const canvas = await renderFull(page, HYBRID_DPI);
      slide.addImage({ data: canvas.toDataURL("image/png"),
        x: offX / IN, y: offY / IN, w: pw * scale / IN, h: ph * scale / IN });
      pr.mode = "image-only";
      report.scannedWarning = true;
      report.pages.push(pr);
      continue;
    }

    // ---- run colours: text painted as glyph-outline paths carries its real
    // colour on the paths, not on the (often invisible) text layer ----
    inheritGlyphColors(allLines, vec.fills, pw, ph);

    // ---- tables ----
    // A detected grid must contain text to be promoted to a native table: a
    // decorative squares mark is graphics, not an empty 1xN table.
    const detected = detectTables(vec.segments)
      .filter((t) => t.row_count >= 1 && t.col_count >= 1);
    const hasCellText = (t) => allLines.some((ln) =>
      centerIn(t.bbox, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2));
    const ruled = detected.filter(hasCellText);
    const demotedGrids = detected.length - ruled.length;
    // Unruled tables (statement ledgers without ruling lines) are recovered
    // from column alignment and emitted native like any other table.
    const inferred = inferAlignedTables(allLines, ruled.map((t) => t.bbox));
    let tables = ruled.concat(inferred);
    // A table that cannot be placed is not a table for any purpose: its
    // region must keep flowing through the text and background paths, or the
    // page ships blank. Two SEC covers did exactly that once.
    const rejected = tables.filter((t) => !tablePlaceable(t, scale, offX, offY));
    if (rejected.length) {
      tables = tables.filter((t) => tablePlaceable(t, scale, offX, offY));
      pr.tablesRejected = rejected.length;
    }
    const tableBboxes = tables.map((t) => t.bbox);

    const looseLines = allLines.filter((ln) =>
      !tableBboxes.some((tb) =>
        centerIn(tb, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2)));

    // ---- hybrid decision (non-table vector art only) ----
    // A demoted text-less grid forces the hybrid background so the decoration
    // still ships, as pixels in the background layer.
    const artRatio = nontableArtRatio(pw, ph, vec.drawings, tableBboxes);
    const useHybrid = artRatio > NONTABLE_ART_COVERAGE || demotedGrids > 0;
    if (demotedGrids > 0) {
      report.notes = report.notes || [];
      report.notes.push(`page ${i}: ${demotedGrids} decorative grid${demotedGrids === 1 ? "" : "s"} ` +
                        `kept as graphics (no cell text)`);
    }

    if (useHybrid) {
      pr.mode = "hybrid";
      const canvas = await renderBackground(page, opList, HYBRID_DPI, tableBboxes, allLines);
      slide.addImage({ data: canvas.toDataURL("image/png"),
        x: offX / IN, y: offY / IN, w: pw * scale / IN, h: ph * scale / IN });
    } else {
      // pdf.js decodes image XObjects during rendering, so a page that was
      // never rendered has nothing in page.objs yet. Warm it cheaply first.
      if (vec.images.length) await renderFull(page, 24);
      for (const im of vec.images) {
        const cx = (im.x0 + im.x1) / 2, cy = (im.y0 + im.y1) / 2;
        if (tableBboxes.some((tb) => centerIn(tb, cx, cy))) continue;
        // re-render just the image area from the page at sample DPI would lose
        // resolution; pdf.js exposes decoded image objects per page instead
        try {
          const obj = await Promise.race([
            new Promise((res, rej) => {
              try { page.objs.get(im.objId, res); } catch (e) { rej(e); }
            }),
            new Promise((res) => setTimeout(() => res(null), 3000)),
          ]);
          if (obj && (obj.bitmap || obj.data)) {
            const c = document.createElement("canvas");
            c.width = obj.width; c.height = obj.height;
            const cctx = c.getContext("2d");
            if (obj.bitmap) cctx.drawImage(obj.bitmap, 0, 0);
            else {
              const imgData = cctx.createImageData(obj.width, obj.height);
              imgData.data.set(obj.data.length === imgData.data.length
                ? obj.data : Uint8ClampedArray.from(obj.data));
              cctx.putImageData(imgData, 0, 0);
            }
            slide.addImage({ data: c.toDataURL("image/png"),
              x: (offX + im.x0 * scale) / IN, y: (offY + im.y0 * scale) / IN,
              w: (im.x1 - im.x0) * scale / IN, h: (im.y1 - im.y0) * scale / IN });
            pr.images++;
          }
        } catch (e) { /* image object unavailable: leave it out, as python does */ }
      }
    }

    // ---- native tables ----
    if (tables.length) {
      const sc = await renderFull(page, SAMPLE_DPI);
      const sampleCtx = sc.getContext("2d", { willReadFrequently: true });
      const z = SAMPLE_DPI / 72.0;
      for (const t of tables) {
        if (addTable(slide, t, allLines, sampleCtx, z, sc.width, sc.height,
                     scale, offX, offY, fonts)) {
          pr.tables++;
          if (t.inferred) pr.unruledTables = (pr.unruledTables || 0) + 1;
          tableKindsBySlide[i - 1].push(t.inferred ? "plain" : "grid");
        }
      }
    }

    // ---- loose text as logical blocks, confidence permitting ----
    const attached = attachMarkers(looseLines);
    const clusters = clusterLines(attached);
    const conf = pageConfidence(allLines, clusters);
    pr.confidence = { ok: conf.ok, score: Math.round(conf.bad * 1000) / 1000,
                      ...conf.signals };
    let textClusters = clusters;
    if (!conf.ok) {
      const { suspects, unplaceable } = collectSuspects(allLines, looseLines, clusters);
      let regions = mergeRegions([...suspects].map((l) => [l.x0, l.y0, l.x1, l.y1]));
      // Absorb any clean line a region already covers, growing the region to
      // hold its whole bbox: nothing may be drawn twice, once as pixels and
      // once as text. Growth can cover further lines, so iterate.
      const absorbed = new Set(suspects);
      for (let pass = 0; pass < 4; pass++) {
        let grew = false;
        for (const l of looseLines) {
          if (absorbed.has(l) || !lineFinite(l)) continue;
          const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
          const r = regions.find((rg) =>
            rg[0] <= cx && cx <= rg[2] && rg[1] <= cy && cy <= rg[3]);
          if (r) {
            absorbed.add(l);
            r[0] = Math.min(r[0], l.x0 - 2); r[1] = Math.min(r[1], l.y0 - 2);
            r[2] = Math.max(r[2], l.x1 + 2); r[3] = Math.max(r[3], l.y1 + 2);
            grew = true;
          }
        }
        if (!grew) break;
        regions = mergeRegions(regions, 0);
      }

      const contentBoxes = allLines.filter(lineFinite)
        .map((l) => [l.x0, l.y0, l.x1, l.y1]).concat(tableBboxes);
      const contentArea = contentBoxes.length
        ? Math.max(1,
            (Math.max(...contentBoxes.map((b) => b[2])) - Math.min(...contentBoxes.map((b) => b[0]))) *
            (Math.max(...contentBoxes.map((b) => b[3])) - Math.min(...contentBoxes.map((b) => b[1]))))
        : pw * ph;
      const suspectArea = regions.reduce(
        (a, r) => a + Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]), 0);

      if (unplaceable || suspectArea > SUSPECT_PAGE_LIMIT * contentArea) {
        // last resort: geometry cannot even be bounded, or most of the page
        // is suspect. Replace everything placed so far with the one thing
        // guaranteed to look right, the page itself.
        while (slide._slideObjects && slide._slideObjects.length) slide._slideObjects.pop();
        const canvas = await renderFull(page, HYBRID_DPI);
        slide.addImage({ data: canvas.toDataURL("image/png"),
          x: offX / IN, y: offY / IN, w: pw * scale / IN, h: ph * scale / IN });
        pr.mode = "image-fallback";
        pr.tables = 0; pr.images = 0;
        tableKindsBySlide[i - 1] = [];
        report.notes = report.notes || [];
        report.notes.push(`page ${i}: preserved as image for accuracy`);
        report.pages.push(pr);
        continue;
      }
      if (regions.length) {
        // render only the suspect regions into the image layer; every clean
        // span and table stays editable text
        const full = await renderFull(page, HYBRID_DPI);
        const z = HYBRID_DPI / 72;
        for (const rg of regions) {
          const rx0 = Math.max(0, Math.floor(rg[0] * z));
          const ry0 = Math.max(0, Math.floor(rg[1] * z));
          const rx1 = Math.min(full.width, Math.ceil(rg[2] * z));
          const ry1 = Math.min(full.height, Math.ceil(rg[3] * z));
          if (rx1 - rx0 < 1 || ry1 - ry0 < 1) continue;
          const c = document.createElement("canvas");
          c.width = rx1 - rx0; c.height = ry1 - ry0;
          c.getContext("2d").drawImage(full, rx0, ry0, c.width, c.height,
                                       0, 0, c.width, c.height);
          slide.addImage({ data: c.toDataURL("image/png"),
            x: (offX + (rx0 / z) * scale) / IN, y: (offY + (ry0 / z) * scale) / IN,
            w: (c.width / z) * scale / IN, h: (c.height / z) * scale / IN });
        }
        pr.mode = "region-fallback";
        pr.imageRegions = regions.length;
        report.notes = report.notes || [];
        report.notes.push(`${regions.length} region${regions.length === 1 ? "" : "s"} ` +
                          `on page ${i} preserved as image`);
        textClusters = clusters
          .map((cl) => cl.filter((l) => !absorbed.has(l)))
          .filter((cl) => cl.length);
      }
    }
    for (const cluster of textClusters) {
      addTextBlock(slide, cluster, scale, offX, offY, fonts, pw);
      pr.textBoxes++;
    }
    report.pages.push(pr);
  }

  onProgress(doc.numPages, doc.numPages, "Saving presentation");
  let blob = await pptx.write({ outputType: "blob" });
  if (deps.JSZip) blob = await applyTableGridStyle(blob, deps.JSZip, tableKindsBySlide);
  report.substitutions = [...fonts.substitutions.entries()].map(([a, b]) => `${a} -> ${b}`);
  return { blob, report };
}

/* PptxGenJS cannot express a:tableStyleId, so stamp it into the OOXML the
 * same way app/converter.py does through python-pptx. Ruled tables get
 * "No Style, Table Grid" (thin borders drawn by the style, fills per cell);
 * INFERRED unruled tables get "No Style, No Grid", because the source drew
 * no ruling lines and the output must not invent them. Tables appear in the
 * slide XML in insertion order, which is the order tableKinds records. */
const TABLE_GRID_STYLE = "{5940675A-B579-460E-94D1-54222C63F5DA}";
const TABLE_NO_GRID_STYLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}";

async function applyTableGridStyle(blob, JSZip, tableKindsBySlide = []) {
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const n of names) {
    let xml = await zip.file(n).async("string");
    if (!xml.includes("<a:tbl>") && !xml.includes("<a:tblPr")) continue;
    const slideIdx = parseInt(n.match(/slide(\d+)\.xml$/)[1], 10) - 1;
    const kinds = tableKindsBySlide[slideIdx] || [];
    let ti = 0;
    const styleFor = () => {
      const kind = kinds[ti] || "grid";
      ti++;
      return kind === "plain" ? TABLE_NO_GRID_STYLE : TABLE_GRID_STYLE;
    };
    xml = xml.replace(/<a:tblPr([^>]*)\/>/g,
      (m, attrs) => `<a:tblPr${attrs}><a:tableStyleId>${styleFor()}</a:tableStyleId></a:tblPr>`);
    if (xml.includes("<a:tblPr") && !xml.includes("tableStyleId")) {
      // open-tag form: insert as the LAST child of tblPr (schema order)
      xml = xml.replace(/<\/a:tblPr>/g,
        () => `<a:tableStyleId>${styleFor()}</a:tableStyleId></a:tblPr>`);
    }
    zip.file(n, xml);
  }
  return await zip.generateAsync({ type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
