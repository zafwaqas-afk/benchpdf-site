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

import { initOps, extractLines, extractVectors, renderBackground, renderFull, sampleFill }
  from "./extract.js";
import { embeddedFontMetrics } from "./fontmetrics.js";
import { FontMapper, FLAG_ITALIC, FLAG_BOLD } from "./fonts.js";
import { attachMarkers, clusterLines, splitParagraphs, lineAlignment } from "./cluster.js";
import { detectTables } from "./tables.js";

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
function addTextBlock(slide, cluster, scale, offX, offY, fonts) {
  const x0 = Math.min(...cluster.map((c) => c.x0));
  const y0 = Math.min(...cluster.map((c) => c.y0));
  const x1 = Math.max(...cluster.map((c) => c.x1));
  const y1 = Math.max(...cluster.map((c) => c.y1));

  const align = lineAlignment(cluster, x0, x1);
  const runs = [];
  const paras = splitParagraphs(cluster);
  for (const para of paras) runs.push(...paragraphRuns(para, fonts, align));

  slide.addText(runs, {
    x: (offX + x0 * scale) / IN,
    y: (offY + y0 * scale) / IN,
    w: Math.max((x1 - x0) * scale / IN, 1 / IN),
    h: Math.max((y1 - y0) * scale / IN, 0.5 / IN),
    // single-line blocks never need to wrap; with substituted fonts running
    // wider than the source, wrap:true breaks headings into two lines
    margin: 0, valign: "top", wrap: cluster.length > 1,
    ...(align ? { align } : {}),
  });
}

/* ---- native tables ------------------------------------------------------ */
function linesIn(bbox, lines) {
  return lines.filter((ln) =>
    centerIn(bbox, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2));
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
          border: { type: "solid", pt: 0.5, color: "000000" },
        },
      });
    }
    rows.push(row);
  }

  slide.addTable(rows, {
    x: (offX + bx0 * scale) / IN,
    y: (offY + by0 * scale) / IN,
    w: (bx1 - bx0) * scale / IN,
    h: (by1 - by0) * scale / IN,
    colW, rowH,
  });
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
  const bad = (deg + piled) / nl + 0.5 * (unmapped / n) + 0.3 * (sub4 / nl);
  return { ok: bad <= 0.15 && overlaps <= 5, bad, overlaps };
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

  for (let i = 1; i <= doc.numPages; i++) {
    onProgress(i - 1, doc.numPages, `Converting page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i);
    const slide = pptx.addSlide();
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

    // ---- tables ----
    const tables = detectTables(vec.segments)
      .filter((t) => t.row_count >= 1 && t.col_count >= 1);
    const tableBboxes = tables.map((t) => t.bbox);

    const looseLines = allLines.filter((ln) =>
      !tableBboxes.some((tb) =>
        centerIn(tb, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2)));

    // ---- hybrid decision (non-table vector art only) ----
    const artRatio = nontableArtRatio(pw, ph, vec.drawings, tableBboxes);
    const useHybrid = artRatio > NONTABLE_ART_COVERAGE;

    if (useHybrid) {
      pr.mode = "hybrid";
      const canvas = await renderBackground(page, opList, HYBRID_DPI, tableBboxes);
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
        }
      }
    }

    // ---- loose text as logical blocks, confidence permitting ----
    const attached = attachMarkers(looseLines);
    const clusters = clusterLines(attached);
    const conf = pageConfidence(allLines, clusters);
    if (!conf.ok) {
      // untrustworthy geometry: replace everything placed so far with the
      // one thing guaranteed to look right, the page itself
      while (slide._slideObjects && slide._slideObjects.length) slide._slideObjects.pop();
      const canvas = await renderFull(page, HYBRID_DPI);
      slide.addImage({ data: canvas.toDataURL("image/png"),
        x: offX / IN, y: offY / IN, w: pw * scale / IN, h: ph * scale / IN });
      pr.mode = "image-fallback";
      pr.tables = 0; pr.images = 0;
      report.notes = report.notes || [];
      report.notes.push(`page ${i}: preserved as image for accuracy`);
      report.pages.push(pr);
      continue;
    }
    for (const cluster of clusters) {
      addTextBlock(slide, cluster, scale, offX, offY, fonts);
      pr.textBoxes++;
    }
    report.pages.push(pr);
  }

  onProgress(doc.numPages, doc.numPages, "Saving presentation");
  let blob = await pptx.write({ outputType: "blob" });
  if (deps.JSZip) blob = await applyTableGridStyle(blob, deps.JSZip);
  report.substitutions = [...fonts.substitutions.entries()].map(([a, b]) => `${a} -> ${b}`);
  return { blob, report };
}

/* PptxGenJS cannot express a:tableStyleId, so stamp it into the OOXML the
 * same way app/converter.py does through python-pptx: "No Style, Table Grid",
 * thin borders drawn by the style, fills stay per-cell. */
const TABLE_GRID_STYLE = "{5940675A-B579-460E-94D1-54222C63F5DA}";

async function applyTableGridStyle(blob, JSZip) {
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const n of names) {
    let xml = await zip.file(n).async("string");
    if (!xml.includes("<a:tbl>") && !xml.includes("<a:tblPr")) continue;
    xml = xml.replace(/<a:tblPr([^>]*)\/>/g,
      `<a:tblPr$1><a:tableStyleId>${TABLE_GRID_STYLE}</a:tableStyleId></a:tblPr>`);
    xml = xml.replace(/<a:tblPr([^>]*[^\/])>(?![\s\S]{0,80}tableStyleId)/g,
      `<a:tblPr$1>`);
    // open-tag form: insert as the LAST child of tblPr (schema order)
    xml = xml.replace(/<\/a:tblPr>/g, (m, off) => m);
    if (!xml.includes("tableStyleId")) {
      xml = xml.replace(/<\/a:tblPr>/g,
        `<a:tableStyleId>${TABLE_GRID_STYLE}</a:tableStyleId></a:tblPr>`);
    }
    zip.file(n, xml);
  }
  return await zip.generateAsync({ type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
