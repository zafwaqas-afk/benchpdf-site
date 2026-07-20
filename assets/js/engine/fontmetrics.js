/* Font vertical metrics, resolved the way PyMuPDF resolves them, so line
 * bounding boxes agree between the two engines.
 *
 * fitz takes ascender/descender from the font program's hhea table (via
 * FreeType). For embedded TrueType/OpenType fonts we do the same: pull the
 * font file out of the PDF with pdf-lib and read hhea/head directly. For the
 * base-14 fonts, which are never embedded, the table below is calibrated
 * against MuPDF's bundled Nimbus fonts (measured, not guessed). Anything
 * else falls back to pdf.js's own metrics, which are close but typo-flavoured.
 */

const BASE14 = {
  "helvetica": [1.075, -0.299],
  "helvetica-oblique": [1.07, -0.284],
  "helvetica-bold": [1.07, -0.307],
  "helvetica-boldoblique": [1.073, -0.309],
  "arial": [1.075, -0.299],
  "arial-bold": [1.07, -0.307],
  "times-roman": [1.053, -0.281],
  "times-italic": [0.951, -0.27],
  "times-bold": [1.044, -0.341],
  "times-bolditalic": [0.972, -0.324],
  "courier": [0.932, -0.317],
  "courier-oblique": [0.92, -0.317],
  "courier-bold": [1.007, -0.393],
  "courier-boldoblique": [0.997, -0.393],
  "symbol": [1.01, -0.293],
  "zapfdingbats": [0.85, -0.15],
};

function stripSubset(name) {
  return (name || "").replace(/^[A-Z]{6}\+/, "");
}

/* Minimal sfnt reader: unitsPerEm from head, ascender/descender from hhea.
 * Works for TrueType ('true'/0x00010000) and OpenType-CFF ('OTTO') alike,
 * both of which carry these tables. */
function sfntVerticalMetrics(bytes) {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag0 = dv.getUint32(0);
    if (![0x00010000, 0x74727565 /*true*/, 0x4f54544f /*OTTO*/].includes(tag0)) return null;
    const numTables = dv.getUint16(4);
    let head = null, hhea = null;
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1),
                                      dv.getUint8(off + 2), dv.getUint8(off + 3));
      const tOff = dv.getUint32(off + 8);
      if (tag === "head") head = tOff;
      if (tag === "hhea") hhea = tOff;
    }
    if (head === null || hhea === null) return null;
    const upm = dv.getUint16(head + 18);
    if (!upm) return null;
    const asc = dv.getInt16(hhea + 4) / upm;
    const desc = dv.getInt16(hhea + 6) / upm;
    if (!(asc > 0.3 && asc < 2.5)) return null;
    return [asc, desc];
  } catch (e) {
    return null;
  }
}

/* Walk the PDF's objects for FontDescriptors and read the /Ascent and
 * /Descent entries. This is what MuPDF itself uses for embedded fonts (the
 * OpenSymbol case proves it: descriptor says 926/-312 while the font file's
 * hhea says 693/-216, and fitz spans measure 926/-312). The font program is
 * only parsed when a descriptor omits the metrics. */
export async function embeddedFontMetrics(pdfBytes, PDFLib) {
  const out = new Map();
  if (!PDFLib) return out;
  try {
    const doc = await PDFLib.PDFDocument.load(pdfBytes, {
      ignoreEncryption: true, updateMetadata: false,
    });
    const ctx = doc.context;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      let dict = null;
      if (obj instanceof PDFLib.PDFDict) dict = obj;
      else if (obj && obj.dict instanceof PDFLib.PDFDict) dict = obj.dict;
      if (!dict) continue;
      const type = dict.get(PDFLib.PDFName.of("Type"));
      if (!type || type.encodedName !== "/FontDescriptor") continue;
      const fname = dict.get(PDFLib.PDFName.of("FontName"));
      if (!fname) continue;
      const clean = stripSubset(fname.encodedName.slice(1)).toLowerCase();

      const num = (key) => {
        const v = ctx.lookup(dict.get(PDFLib.PDFName.of(key)));
        return (v && typeof v.asNumber === "function") ? v.asNumber() : null;
      };
      const asc = num("Ascent");
      const desc = num("Descent");
      if (asc !== null && desc !== null && asc > 200 && asc < 2500) {
        out.set(clean, [asc / 1000, Math.min(desc, 0) / 1000]);
        continue;
      }
      // descriptor without usable metrics: fall back to the font program
      for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
        const ref = dict.get(PDFLib.PDFName.of(key));
        if (!ref) continue;
        const stream = ctx.lookup(ref);
        if (!stream) continue;
        try {
          const bytes = PDFLib.decodePDFRawStream(stream).decode();
          const m = sfntVerticalMetrics(bytes);
          if (m) out.set(clean, m);
        } catch (e) { /* undecodable: base14/style fallback still applies */ }
        break;
      }
    }
  } catch (e) { /* unparseable by pdf-lib: base14/style fallback still applies */ }
  return out;
}

/* Resolve [ascent, descent] for a pdf.js font, PyMuPDF-style. */
export function resolveMetrics(fontName, embedded, styleAscent, styleDescent) {
  const clean = stripSubset(fontName).toLowerCase();
  if (embedded && embedded.has(clean)) return embedded.get(clean);
  if (BASE14[clean]) return BASE14[clean];
  const compact = clean.replace(/[^a-z-]/g, "");
  if (BASE14[compact]) return BASE14[compact];
  const a = typeof styleAscent === "number" && styleAscent !== 0 ? styleAscent : 0.8;
  const d = typeof styleDescent === "number" ? styleDescent : -0.2;
  return [a, d];
}
