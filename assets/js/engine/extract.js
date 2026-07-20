/* Extraction layer of the browser PDF->PPTX engine.
 *
 * This is a port of app/extraction.py's INPUT side plus the pieces PyMuPDF
 * gave the desktop engine for free: positioned text lines with font metadata,
 * vector line segments for table detection, image placements, and a page
 * render with the text operators filtered out of the operator list so the
 * background layer is clean.
 *
 * Coordinates everywhere are PDF points with a TOP-LEFT origin (y down), the
 * same convention as PyMuPDF, so the ported clustering and placement logic
 * reads identically to the Python it came from.
 */

import { resolveMetrics } from "./fontmetrics.js";

let OPS = null;

export function initOps(pdfjs) {
  OPS = pdfjs.OPS;
}

const TEXT_SHOW_OPS = () => [
  OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
];

/* ------------------------------------------------------------------------- */
/* Matrix helpers (PDF 6-tuple [a,b,c,d,e,f])                                */
/* ------------------------------------------------------------------------- */
const MAT_ID = [1, 0, 0, 1, 0, 0];

function matMul(m1, m2) {
  // apply m2 then m1 (m1 is the outer/current transform)
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function matApply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/* pdf.js delivers matrices either bare ([a,b,c,d,e,f]) or wrapped in a
 * one-element args array ([Float32Array(6)]), varying by op and build.
 * Normalise before any multiply, or one wrapped matrix NaNs the whole walk. */
function asMat(a) {
  if (!a) return null;
  if (a.length === 6 && typeof a[0] === "number") return a;
  if (a[0] && a[0].length === 6 && typeof a[0][0] === "number") return a[0];
  return null;
}

/* ------------------------------------------------------------------------- */
/* Font info from the page's common objects                                  */
/* ------------------------------------------------------------------------- */
async function fontInfo(page, styles, fontName, embeddedMetrics) {
  let info = { name: "", bold: false, italic: false };
  try {
    const f = await new Promise((res) => page.commonObjs.get(fontName, res));
    if (f) info = { name: f.name || "", bold: !!f.bold, italic: !!f.italic };
  } catch (e) { /* font not resolvable; style fallback below */ }
  const st = styles[fontName] || {};
  const [ascent, descent] = resolveMetrics(
    info.name || fontName, embeddedMetrics, st.ascent, st.descent);
  // When the real name is unrecoverable, carry pdf.js's own serif/sans/mono
  // classification so the mapper lands on the right family instead of a
  // silent Arial, and say so in the console.
  let name = info.name;
  if (!name || /^g_d\d+_f\d+$/.test(name)) {
    const fam = st.fontFamily || "";
    name = fam.includes("mono") ? "unmappable-mono"
         : fam.includes("serif") && !fam.includes("sans") ? "unmappable-serif"
         : "unmappable-sans";
    console.warn(`BenchPDF engine: font ${fontName} has no recoverable name; ` +
                 `classified as ${fam || "sans-serif"} for mapping`);
  }
  return {
    name,
    bold: info.bold || /bold|black|heavy/i.test(info.name || ""),
    italic: info.italic || /italic|oblique/i.test(info.name || ""),
    ascent, descent,
  };
}

/* ------------------------------------------------------------------------- */
/* Text ops walked with a cursor simulation: each show op knows its start    */
/* position in user space, its fill colour, and how much trailing-space      */
/* advance pdf.js will silently drop from the corresponding text item.       */
/* ------------------------------------------------------------------------- */
export function textOps(opList) {
  const shows = TEXT_SHOW_OPS();
  const stack = [];
  let fill = 0x000000;
  let ctm = MAT_ID.slice();
  const ctmStack = [];
  let lineMat = MAT_ID.slice();   // text line matrix (Tm; advanced by Td/T*)
  let cursor = 0;                 // x advance within the line, text space
  let fontSize = 0, charSpacing = 0, wordSpacing = 0, leading = 0, hScale = 1;
  let textRise = 0, fontRef = null;
  const out = [];

  const startPos = () => matApply(matMul(ctm, lineMat), cursor, textRise);

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const a = opList.argsArray[i];
    if (fn === OPS.save) { stack.push(fill); ctmStack.push(ctm.slice()); }
    else if (fn === OPS.restore) {
      fill = stack.length ? stack.pop() : fill;
      ctm = ctmStack.length ? ctmStack.pop() : ctm;
    }
    else if (fn === OPS.transform) { const m = asMat(a); if (m) ctm = matMul(ctm, m); }
    else if (fn === OPS.paintFormXObjectBegin) {
      // a form's content replays inline under its own matrix: compose it, or
      // every op position inside the form (and after a desync, the whole rest
      // of the page) comes out in the wrong space. This was the statement bug.
      ctmStack.push(ctm.slice());
      const m = asMat(a);
      if (m) ctm = matMul(ctm, m);
    }
    else if (fn === OPS.paintFormXObjectEnd) {
      ctm = ctmStack.length ? ctmStack.pop() : ctm;
    }
    else if (fn === OPS.setTextRise) textRise = a[0];
    else if (fn === OPS.setFillRGBColor) {
      if (a.length >= 3) fill = ((a[0] & 255) << 16) | ((a[1] & 255) << 8) | (a[2] & 255);
      else if (typeof a[0] === "number") fill = a[0] & 0xffffff;
      else if (typeof a[0] === "string") fill = parseInt(a[0].replace("#", ""), 16) || 0;
    }
    else if (fn === OPS.beginText) { lineMat = MAT_ID.slice(); cursor = 0; }
    else if (fn === OPS.setTextMatrix) {
      const m = asMat(a);
      if (m) lineMat = Array.from(m);
      cursor = 0;
    }
    else if (fn === OPS.moveText) { lineMat = matMul(lineMat, [1, 0, 0, 1, a[0], a[1]]); cursor = 0; }
    else if (fn === OPS.setLeading) leading = a[0];
    else if (fn === OPS.nextLine) { lineMat = matMul(lineMat, [1, 0, 0, 1, 0, -leading]); cursor = 0; }
    else if (fn === OPS.setFont) { fontRef = a[0]; fontSize = a[1]; }
    else if (fn === OPS.setCharSpacing) charSpacing = a[0];
    else if (fn === OPS.setWordSpacing) wordSpacing = a[0];
    else if (fn === OPS.setHScale) hScale = a[0] / 100;
    else if (shows.includes(fn)) {
      let glyphs = Array.isArray(a && a[0]) ? a[0] : a;
      if (fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
        if (fn === OPS.nextLineSetSpacingShowText) {
          wordSpacing = a[0]; charSpacing = a[1];
          glyphs = Array.isArray(a && a[2]) ? a[2] : glyphs;
        }
        lineMat = matMul(lineMat, [1, 0, 0, 1, 0, -leading]);
        cursor = 0;
      }
      const [ux, uy] = startPos();
      let advance = 0, trail = 0, allSpace = true, anyGlyph = false;
      if (Array.isArray(glyphs)) {
        for (const gl of glyphs) {
          if (typeof gl === "number") { advance -= (gl / 1000) * fontSize * hScale; continue; }
          if (!gl) continue;
          anyGlyph = true;
          if (gl.unicode !== " ") allSpace = false;
          const w = ((gl.width || 0) / 1000) * fontSize;
          advance += (w + charSpacing + (gl.unicode === " " ? wordSpacing : 0)) * hScale;
        }
        for (let g = glyphs.length - 1; g >= 0; g--) {
          const gl = glyphs[g];
          if (typeof gl === "number") continue;
          if (gl && gl.unicode === " ") trail += (gl.width || 0) / 1000;
          else if (gl) break;
        }
      }
      cursor += advance;
      const [ex, ey] = startPos();
      const m = matMul(ctm, lineMat);
      // effective size comes from the composed matrix's scale, never Tf alone
      const scale = Math.hypot(m[0], m[1]) || Math.abs(m[3]) || 1;
      out.push({ fill, trail, ux, uy, ex, ey, fontRef,
                 size: fontSize * scale, allSpace: allSpace && anyGlyph });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Space advance measured through the FontFace pdf.js registered              */
/* ------------------------------------------------------------------------- */
let _measureCtx = null;
const _spaceCache = new Map();

function spaceAdvance(pdfjsFontName, size) {
  const key = pdfjsFontName;
  if (!_spaceCache.has(key)) {
    try {
      if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
      _measureCtx.font = `100px "${pdfjsFontName}", sans-serif`;
      const w = _measureCtx.measureText(" ").width / 100;
      _spaceCache.set(key, w > 0.05 && w < 1.5 ? w : 0.25);
    } catch (e) {
      _spaceCache.set(key, 0.25);
    }
  }
  return _spaceCache.get(key) * size;
}

/* ------------------------------------------------------------------------- */
/* Text: items -> spans -> lines (PyMuPDF-shaped)                            */
/* ------------------------------------------------------------------------- */
export async function extractLines(page, opList, embeddedMetrics) {
  const vp = page.getViewport({ scale: 1 });
  const pageH = vp.viewBox[3] - vp.viewBox[1];
  const tc = await page.getTextContent();
  const ops = textOps(opList);

  // Positional two-pointer join: pdf.js emits a show op's items consecutively,
  // and the FIRST item of each op starts exactly at the op's simulated start
  // position. So advance the op pointer whenever the next op's start matches
  // the item's transform origin; every item until then belongs to the current
  // op. The op's trailing-space advance applies only to its LAST item.
  const fontCache = new Map();
  const spans = [];
  let oi = -1;
  const consumed = new Array(ops.length).fill(false);
  const rawItems = tc.items.filter((it) => it.str !== "");
  const matchesOp = (item, op) => op
    && Math.abs(item.transform[4] - op.ux) < 1.0
    && Math.abs(item.transform[5] - op.uy) < 1.0;
  // Both sequences are in content order, so the scan is monotonic and
  // unbounded: an item either starts a later op (jump there) or continues
  // the current one. A fixed window desyncs on long runs of item-less ops.
  for (let ii = 0; ii < rawItems.length; ii++) {
    const it = rawItems[ii];
    for (let j = oi + 1; j < ops.length; j++) {
      if (matchesOp(it, ops[j])) { oi = j; consumed[j] = true; break; }
    }
    const op = oi >= 0 ? ops[oi] : null;
    // pdf.js fabricates whitespace-only items to bridge gaps between ops;
    // they start at no op. Skip them when deciding whether this item is the
    // last of its op, or a real trailing space dies on every table row.
    let ni = ii + 1;
    while (ni < rawItems.length && rawItems[ni].str.trim() === "") ni++;
    const nxt = rawItems[ni];
    let nextStarts = !nxt;
    if (nxt) {
      for (let j = oi + 1; j < ops.length; j++) {
        if (matchesOp(nxt, ops[j])) { nextStarts = true; break; }
      }
    }
    it._fill = op ? op.fill : 0;
    it._trail = (op && nextStarts) ? op.trail : 0;

    if (!fontCache.has(it.fontName)) {
      fontCache.set(it.fontName, await fontInfo(page, tc.styles, it.fontName, embeddedMetrics));
    }
    const fi = fontCache.get(it.fontName);
    const size = Math.hypot(it.transform[0], it.transform[1]) || Math.abs(it.transform[3]) || 10;
    const x = it.transform[4];
    const baseline = it.transform[5];           // PDF user space, y-up
    const y0 = pageH - (baseline + fi.ascent * size);
    const y1 = pageH - (baseline + fi.descent * size);
    // PyMuPDF-compatible span flags
    let flags = 0;
    if (fi.italic) flags |= 1 << 1;
    if (/mono|courier|consol/i.test(fi.name)) flags |= 1 << 3;
    if (fi.bold) flags |= 1 << 4;
    // The content stream may end this run with space glyphs that pdf.js drops
    // from both str and width. MuPDF keeps them: in the text AND as advance in
    // the span bbox. Restore both from the op-list glyph data.
    let x1 = x + it.width;
    let text = it.str;
    if (it._trail > 0 && !/\s$/.test(text)) {
      x1 += it._trail * size;
      text += " ";
    }
    spans.push({
      text,
      font: fi.name || it.fontName,
      fontRef: it.fontName,
      size,
      flags,
      color: it._fill,
      x0: x, y0, x1, y1,
      baseline: pageH - baseline,
      spaceW: size * 0.25,
    });
  }

  // Space-only show ops (a trailing space written as its own Tj) produce no
  // text item at all in pdf.js, but MuPDF counts their advance in the line
  // bbox. Synthesize a whitespace span for each so the assembler sees it.
  for (let j = 0; j < ops.length; j++) {
    const op = ops[j];
    if (consumed[j] || !op.allSpace) continue;
    const w = Math.abs(op.ex - op.ux);
    if (w <= 0 || !(op.size > 0)) continue;
    spans.push({
      text: " ", font: "", fontRef: op.fontRef, size: op.size, flags: 0, color: op.fill,
      x0: Math.min(op.ux, op.ex), x1: Math.max(op.ux, op.ex),
      y0: pageH - (op.uy + 0.8 * op.size), y1: pageH - (op.uy - 0.2 * op.size),
      baseline: pageH - op.uy, spaceW: op.size * 0.25,
    });
  }

  // Assemble spans into lines the way MuPDF's text device does: same baseline,
  // reading order, split on a horizontal gap large enough to be a column or
  // table-cell boundary rather than word spacing.
  spans.sort((a, b) => (a.baseline - b.baseline) || (a.x0 - b.x0));
  const lines = [];
  let cur = null;
  let forceBreak = false;
  for (const sp of spans) {
    // pdf.js emits whitespace-only items across wide advances; MuPDF treats
    // those same advances as line boundaries. A wide space span IS the
    // separator: drop it and force a break. A narrow one is a real space.
    if (sp.text.trim() === "") {
      const w = sp.x1 - sp.x0;
      const onCur = cur && Math.abs(sp.baseline - cur.baseline) <=
        Math.max(0.5 * Math.min(sp.size, cur.sizeLast), 1.0);
      const sameFont = cur && cur.spans.length &&
        cur.spans[cur.spans.length - 1].fontRef === sp.fontRef;
      if (!onCur || (sameFont && w > 1.2 * sp.size)) {
        forceBreak = true;
      } else if (!sameFont) {
        // foreign-font whitespace: MuPDF's text device discards it entirely
      } else {
        // A narrow whitespace span is a real space op (writers like
        // LibreOffice emit trailing spaces as their own Tj). MuPDF counts its
        // advance in the line bbox, so extend x1 as well as the text.
        const prev = cur.spans[cur.spans.length - 1];
        if (!/\s$/.test(prev.text)) prev.text += " ";
        cur.x1 = Math.max(cur.x1, sp.x1);
        prev.x1 = Math.max(prev.x1, sp.x1);
      }
      continue;
    }
    const sameBaseline = cur &&
      Math.abs(sp.baseline - cur.baseline) <= Math.max(0.5 * Math.min(sp.size, cur.sizeLast), 1.0);
    const gap = cur ? sp.x0 - cur.x1 : 0;
    // Calibrated on the fixtures: pdf.js splits items on wide advances that
    // MuPDF keeps inside one line as spaces. The smallest gap MuPDF treats as
    // a genuine line boundary measures 1.41x the font size, so merge up to
    // 1.2x and restore the swallowed space below.
    const gapLimit = cur ? 1.2 * Math.max(sp.size, cur.sizeLast) : 0;
    if (!forceBreak && sameBaseline && gap <= gapLimit && gap > -2.0) {
      const prev = cur.spans[cur.spans.length - 1];
      if (gap > 0.15 * sp.size && !/\s$/.test(prev.text) && !/^\s/.test(sp.text)) {
        prev.text += " ";
      }
      cur.spans.push(sp);
      cur.x1 = Math.max(cur.x1, sp.x1);
      cur.y0 = Math.min(cur.y0, sp.y0);
      cur.y1 = Math.max(cur.y1, sp.y1);
      cur.sizeLast = sp.size;
      cur.spaceWLast = sp.spaceW;
    } else {
      if (cur) lines.push(cur);
      cur = {
        spans: [sp], baseline: sp.baseline,
        x0: sp.x0, y0: sp.y0, x1: sp.x1, y1: sp.y1,
        sizeLast: sp.size, spaceWLast: sp.spaceW,
      };
    }
    forceBreak = false;
  }
  if (cur) lines.push(cur);

  // Shape them exactly like app/extraction.py's _collect_lines output.
  return lines
    .filter((ln) => ln.spans.some((s) => s.text.trim() !== ""))
    .map((ln) => ({
      bbox: [ln.x0, ln.y0, ln.x1, ln.y1],
      spans: ln.spans.map((s) => ({
        text: s.text, font: s.font, size: s.size, flags: s.flags, color: s.color,
      })),
      size: Math.max(...ln.spans.map((s) => s.size)),
      x0: ln.x0, y0: ln.y0, x1: ln.x1, y1: ln.y1,
    }));
}

/* ------------------------------------------------------------------------- */
/* Vector geometry: segments for table detection, drawing areas for the      */
/* hybrid decision, image placements                                          */
/* ------------------------------------------------------------------------- */
export function extractVectors(page, opList) {
  const vp = page.getViewport({ scale: 1 });
  const pageH = vp.viewBox[3] - vp.viewBox[1];
  const toTop = (y) => pageH - y;

  const segments = [];   // {x0,y0,x1,y1, kind:'stroke'|'rectedge'|'fill'}
  const drawings = [];   // {x0,y0,x1,y1} painted vector paths (page space, top-down)
  const images = [];     // {x0,y0,x1,y1, objId}
  const fills = [];      // filled rects, for cell shading knowledge

  const ctmStack = [];
  let ctm = MAT_ID.slice();
  const paintOps = new Set([
    OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
    OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  ].filter((v) => v !== undefined));
  const strokeOps = new Set([
    OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke,
    OPS.closeFillStroke, OPS.closeEOFillStroke,
  ].filter((v) => v !== undefined));

  const fn = opList.fnArray, args = opList.argsArray;
  for (let i = 0; i < fn.length; i++) {
    const f = fn[i];
    if (f === OPS.save) ctmStack.push(ctm.slice());
    else if (f === OPS.restore) ctm = ctmStack.length ? ctmStack.pop() : ctm;
    else if (f === OPS.transform) { const m = asMat(args[i]); if (m) ctm = matMul(ctm, m); }
    else if (f === OPS.paintFormXObjectBegin) {
      ctmStack.push(ctm.slice());
      const m = asMat(args[i]);
      if (m) ctm = matMul(ctm, m);
    }
    else if (f === OPS.paintFormXObjectEnd) ctm = ctmStack.length ? ctmStack.pop() : ctm;
    else if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject
             || f === OPS.paintImageMaskXObject) {
      // the image fills the unit square under the current CTM
      const corners = [matApply(ctm, 0, 0), matApply(ctm, 1, 0), matApply(ctm, 0, 1), matApply(ctm, 1, 1)];
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      images.push({
        x0: Math.min(...xs), x1: Math.max(...xs),
        y0: toTop(Math.max(...ys)), y1: toTop(Math.min(...ys)),
        objId: Array.isArray(args[i]) ? args[i][0] : null,
      });
    } else if (f === OPS.constructPath) {
      const [paintOp, dataArr, minMax] = args[i];
      if (!paintOps.has(paintOp)) continue;
      const buf = dataArr && dataArr[0];
      if (!buf || !buf.length) continue;

      // decode: 0=moveTo(x,y) 1=lineTo(x,y) 2=curveTo(6) 3=curve variant(4) 4=closePath
      const pts = [];       // current subpath (page space, y-up)
      let startPt = null;
      const localSegs = [];
      let k = 0;
      const push = (x, y) => matApply(ctm, x, y);
      while (k < buf.length) {
        const cmd = buf[k++];
        if (cmd === 0) { startPt = push(buf[k], buf[k + 1]); pts.length = 0; pts.push(startPt); k += 2; }
        else if (cmd === 1) {
          const p = push(buf[k], buf[k + 1]); k += 2;
          if (pts.length) localSegs.push([pts[pts.length - 1], p]);
          pts.push(p);
        } else if (cmd === 2) { const p = push(buf[k + 4], buf[k + 5]); k += 6; pts.push(p); }
        else if (cmd === 3) { const p = push(buf[k + 2], buf[k + 3]); k += 4; pts.push(p); }
        else if (cmd === 4) {
          if (pts.length > 1 && startPt) localSegs.push([pts[pts.length - 1], startPt]);
        } else { break; /* unknown encoding: bail on this path */ }
      }

      // path bbox for the hybrid-decision drawing list
      const allPts = localSegs.flat().concat(pts);
      if (allPts.length) {
        const xs = allPts.map((p) => p[0]), ys = allPts.map((p) => p[1]);
        const rect = {
          x0: Math.min(...xs), x1: Math.max(...xs),
          y0: toTop(Math.max(...ys)), y1: toTop(Math.min(...ys)),
        };
        drawings.push(rect);

        const isStroke = strokeOps.has(paintOp);
        if (isStroke) {
          for (const [p1, p2] of localSegs) {
            segments.push({ x0: p1[0], y0: toTop(p1[1]), x1: p2[0], y1: toTop(p2[1]), kind: "stroke" });
          }
        } else {
          // Filled path: a rectangle contributes its four edges (pdfplumber's
          // rect_edges); a hairline fill IS a ruling line.
          const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
          fills.push(rect);
          if (w > 2 && h > 2) {
            segments.push({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y0, kind: "rectedge" });
            segments.push({ x0: rect.x0, y0: rect.y1, x1: rect.x1, y1: rect.y1, kind: "rectedge" });
            segments.push({ x0: rect.x0, y0: rect.y0, x1: rect.x0, y1: rect.y1, kind: "rectedge" });
            segments.push({ x0: rect.x1, y0: rect.y0, x1: rect.x1, y1: rect.y1, kind: "rectedge" });
          } else if (w > 2 || h > 2) {
            const cy = (rect.y0 + rect.y1) / 2, cx = (rect.x0 + rect.x1) / 2;
            if (w >= h) segments.push({ x0: rect.x0, y0: cy, x1: rect.x1, y1: cy, kind: "fill" });
            else segments.push({ x0: cx, y0: rect.y0, x1: cx, y1: rect.y1, kind: "fill" });
          }
        }
      }
    }
  }
  return { segments, drawings, images, pageW: vp.viewBox[2] - vp.viewBox[0], pageH };
}

/* ------------------------------------------------------------------------- */
/* Background render with the text operators filtered out                    */
/* ------------------------------------------------------------------------- */
export async function renderBackground(page, opList, dpi, whiteRects = []) {
  // render() replays the operator list cached under the DISPLAY intent, which
  // is a different cache entry from the one getOperatorList() returns. Warm
  // that cache with a 1px render, then neutralise the text-showing operators
  // in it: the real render below replays the filtered list and simply never
  // paints text. Ops are restored afterwards.
  {
    const warmVp = page.getViewport({ scale: 1 / Math.max(page.view[2] - page.view[0], 1) });
    const wc = document.createElement("canvas");
    wc.width = Math.max(Math.round(warmVp.width), 1);
    wc.height = Math.max(Math.round(warmVp.height), 1);
    await page.render({ canvasContext: wc.getContext("2d"), viewport: warmVp }).promise;
  }
  const shows = TEXT_SHOW_OPS();
  const saved = [];
  const lists = [];
  for (const [, st] of page._intentStates || []) {
    if (st && st.operatorList && st.operatorList.fnArray) lists.push(st.operatorList);
  }
  for (const list of lists) {
    for (let i = 0; i < list.fnArray.length; i++) {
      if (shows.includes(list.fnArray[i])) {
        saved.push([list, i, list.fnArray[i], list.argsArray[i]]);
        list.fnArray[i] = OPS.setCharSpacing;   // harmless inside BT/ET
        list.argsArray[i] = [0];
      }
    }
  }
  try {
    const scale = dpi / 72;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.fillStyle = "#FFFFFF";
    for (const r of whiteRects) {
      ctx.fillRect(r[0] * scale, r[1] * scale, (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
    }
    return canvas;
  } finally {
    for (const [list, i, f, a] of saved) {
      list.fnArray[i] = f;
      list.argsArray[i] = a;
    }
  }
}

/* Full render (no filtering) for scanned pages and cell-fill sampling. */
export async function renderFull(page, dpi) {
  const scale = dpi / 72;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

/* Median background colour of a cell, sampled away from its text: the same
 * five sample points and median as app/extraction.py _sample_fill. */
export function sampleFill(ctx, bbox, z, canvasW, canvasH) {
  const [x0, y0, x1, y1] = bbox;
  const samples = [];
  for (const [fx, fy] of [[0.10, 0.22], [0.10, 0.7], [0.9, 0.22], [0.9, 0.7], [0.5, 0.12]]) {
    const sx = Math.min(Math.max(Math.round((x0 + (x1 - x0) * fx) * z), 0), canvasW - 1);
    const sy = Math.min(Math.max(Math.round((y0 + (y1 - y0) * fy) * z), 0), canvasH - 1);
    const d = ctx.getImageData(sx, sy, 1, 1).data;
    samples.push([d[0], d[1], d[2]]);
  }
  const med = (idx) => samples.map((s) => s[idx]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return [med(0), med(1), med(2)];
}
