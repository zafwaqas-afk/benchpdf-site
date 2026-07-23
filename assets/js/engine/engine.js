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
import { attachMarkers, clusterLines, splitParagraphs,
         lineAlignment } from "./cluster.js";
import { detectTables, inferAlignedTables } from "./tables.js";

const HYBRID_DPI = 200;
const SAMPLE_DPI = 150;
const NONTABLE_ART_COVERAGE = 0.03;
const ART_MIN_PT = 3;          // smaller than this is a hairline artefact
const ART_JOIN_PT = 8;         // art this close belongs to one picture
const ART_MAX_REGIONS = 24;    // a page of scattered paths is a hybrid, not this
const PAGE_FURNITURE_COVERAGE = 0.85;  // a grid this big is the page itself
const PAGE_FURNITURE_MIN_CELLS = 12;   // unless it has the cells of a real table
const PROSE_CELL_CHARS = 300;      // a cell holding this much text holds a paragraph
const MIN_TABULAR_CELLS = 2;       // one populated cell states no relationship
const PROSE_MAX_TEXT_CELLS = 3;    // ... and neither does a paragraph plus a label

const IN = 72;   // points per inch; PptxGenJS speaks inches
const EMU_PER_PT = 12700;

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

/* Reflow fidelity: make the substituted text occupy the SOURCE's width.
 *
 * A wrapping paragraph is re-broken by PowerPoint, and the metric-compatible
 * substitute is never exactly the source font, so it wraps at different words
 * and the column drifts. Measured against the corpus, the PDF's own line
 * breaks (layout mode) are worth about 0.025 of real median over reflowed
 * ones, and the drift is what compounds into blocks overflowing their box.
 *
 * Rather than give up reflow - which is what keeps the text editable, a
 * paragraph the reader can retype and have re-wrap - each source line gets
 * the tracking that restores its original width. PowerPoint's greedy wrap
 * then breaks it where the source broke it. Clamped hard, because a bad
 * measurement must degrade to slightly-wrong spacing, never to unreadable
 * text; unmeasurable text gets no tracking at all.
 */
const TRACK_MAX_EM = 0.08;     // never squeeze or open more than this per char
let _measureCtx = null;

/* Is this family actually installed here?
 *
 * The conversion runs in the visitor's browser but the output is opened in
 * PowerPoint elsewhere. A visitor without Georgia measures Georgia as the
 * default serif, and tracking computed from that is worse than none. The
 * standard probe: a family that does not resolve measures identically to a
 * nonsense one. */
const _fontOK = new Map();
const _PROBE = "mmmmmmmmmmlliWWWWWWWWWW0123456789";

function fontAvailable(family) {
  if (!family) return false;
  if (_fontOK.has(family)) return _fontOK.get(family);
  _measureCtx.font = `40px "____nofont____"`;
  const base = _measureCtx.measureText(_PROBE).width;
  _measureCtx.font = `40px "${family}", "____nofont____"`;
  const ok = Math.abs(_measureCtx.measureText(_PROBE).width - base) > 0.01;
  _fontOK.set(family, ok);
  return ok;
}

function textWidthPt(text, fontFace, sizePt, bold, italic) {
  if (!text || !(sizePt > 0)) return 0;
  if (_measureCtx === null) {
    try {
      _measureCtx = document.createElement("canvas").getContext("2d");
    } catch (e) { _measureCtx = false; }
  }
  if (!_measureCtx) return 0;
  if (!fontAvailable(fontFace)) return 0;
  // px set to the point value: the ratio is what matters, and it keeps the
  // returned width in the same units as the source geometry
  _measureCtx.font = `${italic ? "italic " : ""}${bold ? "bold " : ""}`
                   + `${sizePt}px "${fontFace}"`;
  return _measureCtx.measureText(text).width;
}

// Points per character to add (or remove) so this line occupies srcWidth.
function lineTracking(ln, fonts, srcWidth) {
  if (!(srcWidth > 0)) return 0;
  let measured = 0, chars = 0, maxSize = 0;
  for (const sp of ln.spans) {
    const text = sp.text || "";
    if (!text) continue;
    const flags = sp.flags | 0;
    const size = sp.size > 0 ? sp.size : 10;
    measured += textWidthPt(text, fonts.map(sp.font || "", flags), size,
                            !!(flags & FLAG_BOLD), !!(flags & FLAG_ITALIC));
    chars += text.length;
    maxSize = Math.max(maxSize, size);
  }
  if (!measured || chars < 2) return 0;
  const track = (srcWidth - measured) / chars;
  const limit = TRACK_MAX_EM * (maxSize || 10);
  return Math.max(-limit, Math.min(limit, track));
}

function paragraphRuns(paraLines, fonts, align, spaceBefore = 0) {
  const runs = [];
  let prevText = "";
  for (let li = 0; li < paraLines.length; li++) {
    const ln = paraLines[li];
    if (li > 0 && prevText && !/\s$/.test(prevText)) {
      // join wrapped lines with a single space - never a separator character
      runs.push({ text: " ", options: styleRun({ ...ln.spans[0] }, fonts) });
    }
    // Only lines that actually WRAPPED are tracked, which is every line of
    // the paragraph but its last. A line that ended because the paragraph
    // ended - a list item, a closing line - never broke, gains nothing from
    // being restored to its width, and only picks up distorted letter
    // spacing. Tracking every line cost boe_mpr_2025_08 p3 0.108 and
    // w3c_svg10_2001 0.021 of mean while helping the prose pages.
    const wrapped = li < paraLines.length - 1;
    const track = wrapped ? lineTracking(ln, fonts, ln.x1 - ln.x0) : 0;
    for (const sp of ln.spans) {
      const opts = styleRun(sp, fonts);
      if (track) opts.charSpacing = track;
      runs.push({ text: sp.text, options: opts });
      prevText = sp.text;
    }
  }
  if (runs.length) {
    const last = runs[runs.length - 1].options;
    runs[runs.length - 1] = { text: runs[runs.length - 1].text,
      options: { ...last, breakLine: true } };
  }
  if (align) for (const r of runs) r.options.align = align;
  // every run carries it: PptxGenJS emits an a:pPr per run, not per
  // paragraph, so the value must be the same on all of them
  for (const r of runs) { r.options.paraSpaceBefore = spaceBefore; r.options.paraSpaceAfter = 0; }
  return runs;
}

/* ---- text blocks -------------------------------------------------------- */
const NOWRAP_MAX_WORDS = 5;    // blocks this short keep their source line breaks
const WORD_FIT_SAFETY = 1.1;   // substituted fonts can run a little wider
const WRAP_SLACK_PT = 2.0;     // breathing room at the box edge (source points)

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

/* The source's own line pitch, in points, or 0 when there isn't one to read.
 *
 * PowerPoint otherwise sets its own leading from the font, which is tighter
 * than most documents': the W3C working draft leads 14pt text at 18.7pt, so a
 * 25-item list ended 130pt above where it should and the whole page read as
 * vertically compressed. Bounded, because a block whose lines are not evenly
 * pitched (a heading over a paragraph) has no single leading to impose.
 */
function sourceLeading(cluster) {
  if (cluster.length < 2) return 0;
  const deltas = [];
  for (let i = 1; i < cluster.length; i++) {
    const d = cluster[i].y0 - cluster[i - 1].y0;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length < 2) return 0;
  deltas.sort((a, b) => a - b);
  const med = deltas[Math.floor(deltas.length / 2)];
  const size = Math.max(...cluster.map((l) => l.size || 0), 1);
  if (med < size * 0.9 || med > size * 2.5) return 0;
  return med;
}

/* The air the source leaves above each paragraph, in points.
 *
 * A block used to emit its paragraphs hard against each other, because
 * paraSpaceBefore was pinned to zero. Documents separate paragraphs with a
 * blank line: the SEC chairman's letter (the corpus's worst page) leaves
 * about half a line above each one, and without it the whole column runs
 * together and ends short. What the source leaves is whatever exceeds the
 * block's own leading, so it is only readable once that leading is known.
 *
 * The gaps are clamped to the room the source actually left for them. The box
 * is sized to the source line span, which already includes those gaps, but
 * PowerPoint stacks the lines at the full leading AND then adds the gaps on
 * top - so the raw gaps overshoot the box and push the last line out the
 * bottom. On w3c_svg10_2001 p2 that dropped the final line onto the heading
 * below: 35 lines * 15.2pt = 532pt of pitch left only 112pt for gaps in a
 * 644pt box, but the raw gaps summed 127. Scale them to fit the 112.
 */
function paragraphGaps(paras, lead, boxHeight) {
  const gaps = paras.map(() => 0);
  if (!lead) return gaps;
  for (let i = 1; i < paras.length; i++) {
    const prev = paras[i - 1][paras[i - 1].length - 1];
    const extra = paras[i][0].y0 - prev.y0 - lead;
    gaps[i] = extra > 0.5 ? extra : 0;
  }
  const nLines = paras.reduce((n, p) => n + p.length, 0);
  const avail = boxHeight - nLines * lead;
  const total = gaps.reduce((a, b) => a + b, 0);
  if (total > avail && total > 0) {
    const scale = Math.max(avail, 0) / total;
    for (let i = 0; i < gaps.length; i++) gaps[i] *= scale;
  }
  return gaps;
}

/* Where each paragraph sits inside its block, in points from the block's left
 * edge: [marginLeft, firstLineOffset].
 *
 * A list is one text box of paragraphs, and every paragraph used to start at
 * the box's left edge. On the W3C working draft that flattened two nesting
 * levels onto one margin and threw away the hanging indent that puts a
 * wrapped line clear of its own bullet. Both are in the source geometry: the
 * first line's x0 gives the outdent, the continuation lines' give the margin.
 */
function paragraphIndents(paras, blockX0) {
  return paras.map((para) => {
    const firstX = para[0].x0 - blockX0;
    const rest = para.slice(1);
    // marL applies to every line; indent shifts only the first, and is
    // negative for a hanging indent and positive for a first-line one.
    const contX = rest.length ? Math.min(...rest.map((l) => l.x0)) - blockX0 : firstX;
    const marL = Math.max(contX, 0);
    return [marL, firstX - marL];
  });
}

function addTextBlock(slide, cluster, scale, offX, offY, fonts, pageW, mode, indentSink) {
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
  // Layout mode extends that promise to every block: a substituted font sets
  // its own line breaks otherwise, and the page stops matching the original.
  const keepBreaks = cluster.length > 1
    && (mode === "layout" || words <= NOWRAP_MAX_WORDS);

  const runs = [];
  let indents = null;
  if (keepBreaks) {
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
    const gaps = paragraphGaps(paras, sourceLeading(cluster), y1 - y0);
    for (let pi = 0; pi < paras.length; pi++) {
      runs.push(...paragraphRuns(paras[pi], fonts, align, gaps[pi] * scale));
    }
    indents = paragraphIndents(paras, x0);
  }

  const lead = sourceLeading(cluster);
  const wrap = cluster.length > 1 && !keepBreaks;
  // a wrapping box must at minimum fit its longest word, or PowerPoint breaks
  // mid-word; cap at the page's right edge
  let wPt = Math.max(x1 - x0, 1);
  if (wrap) {
    wPt = Math.max(wPt, WORD_FIT_SAFETY * longestWordWidth(cluster));
    // A hair of breathing room. The box is pinned to the widest source line's
    // exact extent, so a full line whose substitute width lands within a
    // tenth of a point of that extent tips over PowerPoint's own metrics -
    // which are not PyMuPDF's or canvas's - and wraps one line early. Too
    // small to drag a word across a line (words are wider than this); just
    // enough to clear the metric divergence at the box edge.
    wPt += WRAP_SLACK_PT;
    if (pageW) wPt = Math.min(wPt, Math.max(pageW - x0, x1 - x0));
  }

  // PptxGenJS cannot express a:pPr/@marL, so a block that needs per-paragraph
  // indents is named here and stamped into the OOXML afterwards, the same way
  // a:tableStyleId already is.
  const needsIndent = indentSink && indents
    && indents.some(([m, i]) => Math.abs(m) > 0.5 || Math.abs(i) > 0.5);
  const objectName = needsIndent ? `bpIndent${indentSink.length}` : undefined;
  if (needsIndent) {
    indentSink.push({ name: objectName,
      indents: indents.map(([m, i]) => [m * scale, i * scale]) });
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
    ...(lead ? { lineSpacing: lead * scale } : {}),
    ...(objectName ? { objectName } : {}),
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
export function tablePlaceable(table, scale, offX, offY, pageW, pageH) {
  // A grid that covers the page with barely any cells is the page's own
  // background rectangles, not a table. One shipped as a 2x1 table with a
  // solid fill across the whole slide, painting over the background picture
  // and hiding the HMRC crest underneath it.
  if (pageW && pageH) {
    const [ax0, ay0, ax1, ay1] = table.bbox;
    const coverage = Math.abs((ax1 - ax0) * (ay1 - ay0)) / Math.abs(pageW * pageH);
    const cells = (table.row_count || 0) * (table.col_count || 0);
    if (coverage > PAGE_FURNITURE_COVERAGE && cells < PAGE_FURNITURE_MIN_CELLS) return false;
  }
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

// A bordered callout is not a table. Judged on cell CONTENT, so it applies to
// every table however it was detected: a govuk guidance page shipped a ruled
// 2x2 holding one 1,600-character paragraph in one cell, two cells empty and
// the page number in the last. It is a box drawn around prose, and inside a
// native table that prose reflows into a column the width of one cell.
// A table earns its cells by using them: two of them must carry text, and a
// cell-sized paragraph is only tabular when enough other cells answer it.
export function tableCellsTabular(table, lines) {
  const cells = [];
  for (const row of table.rows || []) {
    for (const cb of row.cells || []) if (cb) cells.push(cb);
  }
  if (!cells.length) return false;
  const lens = cells.map((cb) => {
    let n = 0;
    for (const ln of lines) {
      if (!centerIn(cb, (ln.bbox[0] + ln.bbox[2]) / 2, (ln.bbox[1] + ln.bbox[3]) / 2)) continue;
      for (const s of ln.spans) n += s.text.trim().length;
    }
    return n;
  });
  const textCells = lens.filter((n) => n > 0).length;
  if (textCells < MIN_TABULAR_CELLS) return false;
  if (textCells <= PROSE_MAX_TEXT_CELLS && Math.max(...lens) >= PROSE_CELL_CHARS) return false;
  return true;
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

/* Vector art on a page that stays native.
 *
 * The hybrid render only fires when art covers a real share of the page, so
 * anything smaller, a crest, a rule, a chart's axes, used to ship nowhere at
 * all: the HMRC crown was simply missing from our worst-scoring page. These
 * regions let that art ride along as pixels while the text stays editable.
 *
 * Boxes that overlap or nearly touch merge, so a logo built from thirty paths
 * arrives as one picture rather than thirty.
 */
export function artRegions(drawings, tableBboxes, pageW, pageH) {
  const keep = [];
  for (const d of drawings) {
    const w = d.x1 - d.x0, h = d.y1 - d.y0;
    if (w <= ART_MIN_PT || h <= ART_MIN_PT) continue;
    if (w > 0.92 * pageW && h > 0.92 * pageH) continue;
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
    if (tableBboxes.some((tb) => centerIn(tb, cx, cy))) continue;
    keep.push([d.x0, d.y0, d.x1, d.y1]);
  }
  const merged = [];
  for (const box of keep) {
    let cur = box.slice();
    let joined = true;
    while (joined) {
      joined = false;
      for (let i = merged.length - 1; i >= 0; i--) {
        const m = merged[i];
        const near = cur[0] <= m[2] + ART_JOIN_PT && m[0] <= cur[2] + ART_JOIN_PT
                  && cur[1] <= m[3] + ART_JOIN_PT && m[1] <= cur[3] + ART_JOIN_PT;
        if (near) {
          cur = [Math.min(cur[0], m[0]), Math.min(cur[1], m[1]),
                 Math.max(cur[2], m[2]), Math.max(cur[3], m[3])];
          merged.splice(i, 1);
          joined = true;
        }
      }
    }
    merged.push(cur);
  }
  return merged.slice(0, ART_MAX_REGIONS);
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
export async function convertPdfToPptx(bytes, deps, onProgress = () => {},
                                       opts = {}) {
  // "flow" keeps paragraphs reflowing for editing; "layout" keeps the
  // source's line breaks so the page matches the original.
  const mode = opts.mode === "layout" ? "layout" : "flow";
  const { pdfjs, PptxGenJS, PDFLib } = deps;
  initOps(pdfjs);

  const metrics = await embeddedFontMetrics(bytes.slice(0), PDFLib);
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const fonts = new FontMapper();
  const report = { pageCount: doc.numPages, pages: [], scannedWarning: false, textMode: mode };

  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const slideWpt = vp1.viewBox[2] - vp1.viewBox[0];
  const slideHpt = vp1.viewBox[3] - vp1.viewBox[1];

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PDFSIZE", width: slideWpt / IN, height: slideHpt / IN });
  pptx.layout = "PDFSIZE";

  const tableKindsBySlide = [];   // per slide, "grid" | "plain" per native table
  const indentedBlocks = [];      // text boxes needing a:pPr/@marL, by objectName
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
    // A single-column grid cannot express a tabular relationship: it is a
    // bordered or shaded BOX, not data. A Starling statement's shaded Summary
    // panel (heading over right-aligned balances) was promoted to a 2x1 table
    // here, gaining a hard border and losing its shading and alignment, while
    // the desktop engine (fitz, stroked lines only) never saw a table at all.
    // Demoting it feeds the region to the hybrid background, which preserves
    // the panel as pixels with editable text on top - matching desktop.
    const ruled = detected.filter((t) => hasCellText(t) && t.col_count >= 2);
    const demotedGrids = detected.length - ruled.length;
    // Unruled tables (statement ledgers without ruling lines) are recovered
    // from column alignment and emitted native like any other table.
    const inferred = inferAlignedTables(allLines, ruled.map((t) => t.bbox));
    // An inferred grid needs the shape of a real table. Two rows by two
    // columns, half of it empty, is a column of prose with a page number
    // beside it: one shipped as a table over a two-column guidance page.
    let tables = ruled.concat(
      inferred.filter((t) => t.row_count >= 3 && t.col_count >= 2));
    // A table that cannot be placed (two SEC covers shipped blank pages once),
    // or whose cells hold prose rather than
    // tabular content, is not a table for any purpose: its region must keep
    // flowing through the text and background paths (the border ships as
    // background pixels, the prose as ordinary text boxes).
    const keep = (t) => tablePlaceable(t, scale, offX, offY, pw, ph)
                     && tableCellsTabular(t, allLines);
    const rejected = tables.filter((t) => !keep(t));
    if (rejected.length) {
      tables = tables.filter(keep);
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
      const regions = artRegions(vec.drawings, tableBboxes, pw, ph);
      if (regions.length) {
        // one text-stripped render, cropped per region, so art ships without
        // costing the page its editable text
        const bg = await renderBackground(page, opList, HYBRID_DPI, tableBboxes, allLines);
        const k = HYBRID_DPI / 72.0;
        for (const [rx0, ry0, rx1, ry1] of regions) {
          const cw2 = Math.round((rx1 - rx0) * k), ch2 = Math.round((ry1 - ry0) * k);
          if (cw2 < 4 || ch2 < 4) continue;
          const c = document.createElement("canvas");
          c.width = cw2; c.height = ch2;
          c.getContext("2d").drawImage(bg, Math.round(rx0 * k), Math.round(ry0 * k),
                                       cw2, ch2, 0, 0, cw2, ch2);
          slide.addImage({ data: c.toDataURL("image/png"),
            x: (offX + rx0 * scale) / IN, y: (offY + ry0 * scale) / IN,
            w: (rx1 - rx0) * scale / IN, h: (ry1 - ry0) * scale / IN });
          pr.artRegions = (pr.artRegions || 0) + 1;
        }
      }
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
    // Column-aware clustering is parked, not deleted: see clusterLinesByColumn.
    // It is correct in principle and costs 0.056 of synthetic median today,
    // because a correctly clustered column REFLOWS and a reflowed column does
    // not reproduce the source's line breaks. Re-wire it once it does.
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
      addTextBlock(slide, cluster, scale, offX, offY, fonts, pw, mode, indentedBlocks);
      pr.textBoxes++;
    }
    report.pages.push(pr);
  }

  onProgress(doc.numPages, doc.numPages, "Saving presentation");
  let blob = await pptx.write({ outputType: "blob" });
  if (deps.JSZip) {
    blob = await applyTableGridStyle(blob, deps.JSZip, tableKindsBySlide);
    blob = await applyParagraphIndents(blob, deps.JSZip, indentedBlocks);
  }
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

/* Stamp a:pPr/@marL and @indent onto the paragraphs of the named text boxes.
 *
 * Located by the shape's own name rather than by position, so a slide that
 * also carries pictures, tables or untagged boxes cannot shift the mapping.
 * Values are EMU. PptxGenJS always writes an <a:pPr .../> per paragraph, so
 * the attributes go onto the existing tag.
 */
async function applyParagraphIndents(blob, JSZip, blocks = []) {
  if (!blocks.length) return blob;
  const byName = new Map(blocks.map((b) => [b.name, b.indents]));
  const zip = await JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const n of names) {
    let xml = await zip.file(n).async("string");
    if (!xml.includes("bpIndent")) continue;
    xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
      const m = /<p:cNvPr[^>]*name="(bpIndent\d+)"/.exec(sp);
      if (!m) return sp;
      const indents = byName.get(m[1]);
      if (!indents) return sp;
      // Walk PARAGRAPHS, not a:pPr tags: PptxGenJS emits one a:pPr per run
      // (57 of them for 22 paragraphs on the WCAG page), so counting tags
      // consumed the indents out of order and ran off the end. Every a:pPr
      // inside one a:p gets the same value, so it does not matter which one
      // PowerPoint honours.
      let pi = 0;
      return sp.replace(/<a:p>[\s\S]*?<\/a:p>/g, (para) => {
        const pair = indents[pi++];
        if (!pair) return para;
        const [marL, indent] = pair;
        const attr = ` marL="${Math.round(marL * EMU_PER_PT)}"`
                   + ` indent="${Math.round(indent * EMU_PER_PT)}"`;
        return para.replace(/<a:pPr([^>]*?)(\/?)>/g, (tag, attrs, selfClose) =>
          `<a:pPr${attrs.replace(/\s*marL="[^"]*"/, "").replace(/\s*indent="[^"]*"/, "")}${attr}${selfClose}>`);
      });
    });
    zip.file(n, xml);
  }
  return await zip.generateAsync({ type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

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
